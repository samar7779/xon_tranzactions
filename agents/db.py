"""PostgreSQL qatlami: bot jadvallari (agents sxemasi) va biznes jadvallarni o'qish.

- psycopg2 funksiya ichida (lazy) import qilinadi: testlar DB'siz ishlaydi.
- Har kind ("agents", "facts") uchun alohida ThreadedConnectionPool(1, 5). Semafor bilan
  kutiladi: pool to'lsa PoolError emas, navbat.
- Ulanishda: SET TIME ZONE 'UTC', application_name = 'xon-agents'.
- Bot jadvallari FAQAT agents sxemasida (public'ni deploy `prisma db push --accept-data-loss` o'chiradi).
- Biznes jadvallar faqat o'qiladi: tx("facts", readonly=True, timeout_ms=...).
- Vaqt Python'dan parametr bo'lib yoziladi (NOW() ga tayanilmaydi).

Python 3.10+ mos.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any, Dict, Iterator, List, Mapping, Optional, Sequence, Tuple, Union

from . import config
from . import contract as C

log = logging.getLogger("agents.db")

KINDS: Tuple[str, ...] = ("agents", "facts")
POOL_MIN = 1
POOL_MAX = 5
CONNECT_TIMEOUT_S = 10
CHECKOUT_TIMEOUT_S = 30
RETRY_AFTER_FAIL_S = 10  # ulanish yiqilgach shu vaqt ichida qayta urinilmaydi
APP_NAME = "xon-agents"
KV_TABLE = C.DB_SCHEMA + ".kv_store"

Params = Union[Sequence[Any], Mapping[str, Any]]


class DbUnavailable(RuntimeError):
    """URL yo'q, psycopg2 yo'q yoki bazaga ulanib bo'lmadi."""


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------
class _PoolState:
    def __init__(self, kind: str, url: str) -> None:
        self.kind = kind
        self.url = url
        self.pool: Any = None
        self.sem = threading.BoundedSemaphore(POOL_MAX)
        self.inited: Dict[int, Any] = {}  # id(conn) -> conn (SET TIME ZONE bajarilgan)
        self.failed_at = 0.0


_lock = threading.Lock()
_pools: Dict[str, _PoolState] = {}


def _pg() -> Any:
    try:
        import psycopg2  # noqa: F401
        import psycopg2.extras  # noqa: F401
        import psycopg2.pool  # noqa: F401
    except ImportError as exc:
        raise DbUnavailable("psycopg2 o'rnatilmagan (pip install psycopg2-binary)") from exc
    return psycopg2


def _mask(text: str) -> str:
    out = text or ""
    for pat in C.SIR_NAQSHLARI:
        out = pat.sub("***", out)
    return out


def _url_for(kind: str) -> str:
    s = config.get_settings()
    if kind == "agents":
        return s.agents_db_url
    if kind == "facts":
        return s.facts_db_url
    raise ValueError("noma'lum kind: " + str(kind))


def _close_state(st: _PoolState) -> None:
    try:
        if st.pool is not None:
            st.pool.closeall()
    except Exception:  # noqa: BLE001 - yopishda xato muhim emas
        pass
    st.pool = None
    st.inited.clear()


def _state(kind: str) -> _PoolState:
    url = _url_for(kind)
    if not url:
        raise DbUnavailable(kind + ": DATABASE_URL yo'q")
    with _lock:
        st = _pools.get(kind)
        if st is None or st.url != url:
            if st is not None:
                _close_state(st)
            st = _PoolState(kind, url)
            _pools[kind] = st
        if st.pool is None:
            if st.failed_at and time.monotonic() - st.failed_at < RETRY_AFTER_FAIL_S:
                raise DbUnavailable(kind + ": baza yaqinda javob bermadi, keyinroq")
            pg = _pg()
            try:
                st.pool = pg.pool.ThreadedConnectionPool(
                    POOL_MIN, POOL_MAX, dsn=url,
                    connect_timeout=CONNECT_TIMEOUT_S, application_name=APP_NAME,
                )
            except pg.Error as exc:
                st.failed_at = time.monotonic()
                msg = _mask(C.short(str(exc), 200))
                raise DbUnavailable("%s: ulanib bo'lmadi (%s: %s)" % (kind, exc.__class__.__name__, msg)) from None
            st.failed_at = 0.0
        return st


def close_all() -> None:
    """Hamma pool'ni yopadi (testlar, jarayon oxiri)."""
    with _lock:
        for st in _pools.values():
            _close_state(st)
        _pools.clear()


def _init_conn(st: _PoolState, conn: Any) -> None:
    if st.inited.get(id(conn)) is conn:
        return
    with conn.cursor() as cur:
        cur.execute("SET TIME ZONE 'UTC'")
    conn.commit()
    if len(st.inited) > POOL_MAX * 4:  # yopilgan ulanishlar qoldig'ini tozalash
        for key in [k for k, c in st.inited.items() if getattr(c, "closed", 1)]:
            st.inited.pop(key, None)
    st.inited[id(conn)] = conn


@contextmanager
def _connection(kind: str) -> Iterator[Any]:
    pg = _pg()
    st = _state(kind)
    if not st.sem.acquire(timeout=CHECKOUT_TIMEOUT_S):
        raise DbUnavailable(kind + ": ulanish navbati " + str(CHECKOUT_TIMEOUT_S) + " s dan oshdi")
    pool = st.pool
    conn = None
    broken = False
    try:
        for _ in range(2):
            try:
                conn = pool.getconn()
            except (pg.Error, pg.pool.PoolError) as exc:
                raise DbUnavailable("%s: ulanish olinmadi (%s)" % (kind, exc.__class__.__name__)) from None
            if conn.closed:
                pool.putconn(conn, close=True)
                st.inited.pop(id(conn), None)
                conn = None
                continue
            break
        if conn is None:
            raise DbUnavailable(kind + ": ulanish yopiq")
        try:
            _init_conn(st, conn)
        except (pg.OperationalError, pg.InterfaceError) as exc:
            broken = True
            raise DbUnavailable("%s: ulanish ishlamadi (%s)" % (kind, exc.__class__.__name__)) from None
        yield conn
    except BaseException as exc:
        if conn is not None and (conn.closed or isinstance(exc, (pg.OperationalError, pg.InterfaceError))):
            broken = True
        raise
    finally:
        if conn is not None:
            close = broken or bool(conn.closed)
            try:
                pool.putconn(conn, close=close)
            except Exception:  # noqa: BLE001 - pool almashgan yoki yopilgan
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass
            if close:
                st.inited.pop(id(conn), None)
        st.sem.release()


@contextmanager
def tx(kind: str = "agents", *, readonly: bool = False, timeout_ms: Optional[int] = None) -> Iterator[Any]:
    """Bitta tranzaksiya. Kursor RealDictCursor (qator = dict).

    readonly: birinchi so'rov SET TRANSACTION READ ONLY.
    timeout_ms: SET LOCAL statement_timeout.
    Muvaffaqiyat -> commit, xato -> rollback va qayta ko'tarish.
    """
    pg = _pg()
    with _connection(kind) as conn:
        cur = conn.cursor(cursor_factory=pg.extras.RealDictCursor)
        try:
            if readonly:
                cur.execute("SET TRANSACTION READ ONLY")
            if timeout_ms:
                cur.execute("SET LOCAL statement_timeout = %s", (int(timeout_ms),))
            yield cur
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001 - singan ulanish
                pass
            raise
        finally:
            try:
                cur.close()
            except Exception:  # noqa: BLE001
                pass


def _params(params: Optional[Params]) -> Optional[Params]:
    # bo'sh parametr berilsa psycopg2 '%' ni formatlaydi: None beramiz
    return params if params else None


def fetchall(sql: str, params: Params = (), *, kind: str = "agents", readonly: bool = False,
             timeout_ms: Optional[int] = None) -> List[Dict[str, Any]]:
    with tx(kind, readonly=readonly, timeout_ms=timeout_ms) as cur:
        cur.execute(sql, _params(params))
        if cur.description is None:
            return []
        return [dict(r) for r in cur.fetchall()]


def fetchone(sql: str, params: Params = (), *, kind: str = "agents", readonly: bool = False,
             timeout_ms: Optional[int] = None) -> Optional[Dict[str, Any]]:
    with tx(kind, readonly=readonly, timeout_ms=timeout_ms) as cur:
        cur.execute(sql, _params(params))
        if cur.description is None:
            return None
        row = cur.fetchone()
        return dict(row) if row is not None else None


def execute(sql: str, params: Params = (), *, kind: str = "agents") -> int:
    """rowcount qaytaradi."""
    with tx(kind) as cur:
        cur.execute(sql, _params(params))
        return cur.rowcount


def available(kind: str = "agents") -> bool:
    try:
        row = fetchone("SELECT 1 AS ok", kind=kind, timeout_ms=5000)
        return bool(row and row.get("ok") == 1)
    except Exception as exc:  # noqa: BLE001
        log.debug("db %s mavjud emas: %s", kind, exc.__class__.__name__)
        return False


# ---------------------------------------------------------------------------
# kv_store (agents.kv_store). Umumiy holat faqat shu yerda (ko'p jarayon).
# ---------------------------------------------------------------------------
def _check_key(k: str) -> str:
    if not isinstance(k, str) or not k:
        raise ValueError("kv kalit bo'sh")
    if len(k) > C.KV_KEY_MAX:
        raise ValueError("kv kalit 64 belgidan uzun: " + k[:80])
    return k


def _like_prefix(prefix: str) -> str:
    return prefix.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"


def kv_get(k: str) -> Optional[str]:
    row = fetchone("SELECT value FROM " + KV_TABLE + " WHERE k = %s", (_check_key(k),))
    return None if row is None else row["value"]


def kv_get_json(k: str, default: Any = None) -> Any:
    raw = kv_get(k)
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except ValueError:
        log.warning("kv %s: JSON buzuq", k)
        return default


def kv_set(k: str, value: str) -> None:
    execute(
        "INSERT INTO " + KV_TABLE + " (k, value, updated_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (k) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
        (_check_key(k), "" if value is None else str(value), config.now_utc()),
    )


def kv_set_json(k: str, obj: Any) -> None:
    kv_set(k, json.dumps(obj, ensure_ascii=False, default=str))


def kv_del(k: str) -> None:
    execute("DELETE FROM " + KV_TABLE + " WHERE k = %s", (_check_key(k),))


def kv_keys(prefix: str) -> List[str]:
    rows = fetchall(
        "SELECT k FROM " + KV_TABLE + " WHERE k LIKE %s ESCAPE '!' ORDER BY k",
        (_like_prefix(prefix or ""),),
    )
    return [r["k"] for r in rows]


def kv_del_prefix(prefix: str) -> int:
    if not prefix:
        raise ValueError("bo'sh prefiks bilan hammasini o'chirish taqiq")
    return execute("DELETE FROM " + KV_TABLE + " WHERE k LIKE %s ESCAPE '!'", (_like_prefix(prefix),))


def kv_updated_at(k: str) -> Optional[datetime]:
    row = fetchone("SELECT updated_at FROM " + KV_TABLE + " WHERE k = %s", (_check_key(k),))
    return None if row is None else row["updated_at"]


def kv_claim(k: str, value: str = "1") -> bool:
    """R5: bir martalik olish. INSERT ... ON CONFLICT DO NOTHING, natija rowcount == 1 (upsert emas)."""
    n = execute(
        "INSERT INTO " + KV_TABLE + " (k, value, updated_at) VALUES (%s, %s, %s) ON CONFLICT (k) DO NOTHING",
        (_check_key(k), value, config.now_utc()),
    )
    return n == 1


# --- Muddatli qulf (lease): value = {"owner": ..., "until": iso} ------------
def _lease_value(owner: str, ttl_s: int) -> Tuple[str, datetime]:
    until = config.now_utc() + timedelta(seconds=max(1, int(ttl_s)))
    return json.dumps({"owner": str(owner), "until": config.iso_utc(until)}), until


def _lease_parse(raw: Optional[str]) -> Tuple[Optional[str], Optional[datetime]]:
    if not raw:
        return None, None
    try:
        data = json.loads(raw)
    except ValueError:
        return None, None
    if not isinstance(data, dict):
        return None, None
    owner = data.get("owner")
    until = config.parse_iso(str(data.get("until") or ""))
    return (None if owner is None else str(owner)), until


def kv_lease_acquire(k: str, owner: str, ttl_s: int) -> bool:
    """Bo'sh, muddati o'tgan yoki o'ziniki bo'lsa oladi. Bitta tranzaksiyada qator qulfi bilan (atomik)."""
    key = _check_key(k)
    value, _ = _lease_value(owner, ttl_s)
    now = config.now_utc()
    with tx() as cur:
        for _ in range(2):
            cur.execute(
                "INSERT INTO " + KV_TABLE + " (k, value, updated_at) VALUES (%s, %s, %s) ON CONFLICT (k) DO NOTHING",
                (key, value, now),
            )
            if cur.rowcount == 1:
                return True
            cur.execute("SELECT value FROM " + KV_TABLE + " WHERE k = %s FOR UPDATE", (key,))
            row = cur.fetchone()
            if row is None:  # orada o'chirildi: qayta INSERT
                continue
            cur_owner, until = _lease_parse(row["value"])
            if until is None or until <= now or cur_owner == str(owner):
                cur.execute(
                    "UPDATE " + KV_TABLE + " SET value = %s, updated_at = %s WHERE k = %s",
                    (value, now, key),
                )
                return True
            return False
    return False


def kv_lease_renew(k: str, owner: str, ttl_s: int) -> bool:
    """Faqat egasi uzaytiradi."""
    key = _check_key(k)
    value, _ = _lease_value(owner, ttl_s)
    with tx() as cur:
        cur.execute("SELECT value FROM " + KV_TABLE + " WHERE k = %s FOR UPDATE", (key,))
        row = cur.fetchone()
        if row is None:
            return False
        cur_owner, _until = _lease_parse(row["value"])
        if cur_owner != str(owner):
            return False
        cur.execute(
            "UPDATE " + KV_TABLE + " SET value = %s, updated_at = %s WHERE k = %s",
            (value, config.now_utc(), key),
        )
        return True


def kv_lease_release(k: str, owner: str) -> None:
    """Faqat owner mos bo'lsa o'chiradi (boshqa jarayon qulfiga tegilmaydi)."""
    key = _check_key(k)
    with tx() as cur:
        cur.execute("SELECT value FROM " + KV_TABLE + " WHERE k = %s FOR UPDATE", (key,))
        row = cur.fetchone()
        if row is None:
            return
        cur_owner, _until = _lease_parse(row["value"])
        if cur_owner == str(owner):
            cur.execute("DELETE FROM " + KV_TABLE + " WHERE k = %s", (key,))


def kv_lease_active(k: str) -> bool:
    _owner, until = _lease_parse(kv_get(k))
    return until is not None and until > config.now_utc()
