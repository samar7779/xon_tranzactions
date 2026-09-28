"""[WRITE_MEMORY] bloklari, "Teacher uchun:" qatorlari va xotira yozuvi (KOD 4, Q4-Q6, P28).

- Blokni faqat Teacher javobidan qo'llash chaqiruvchining ishi (leader_bot, teacher_daily).
  Bu modul yo'l oq ro'yxati, sir, kunlik chegara va yozishni bajaradi.
- Yo'l oq ro'yxati: learned.md (faqat append), daily/<sana>.md (append|write, faqat bugun).
- FON va FORWARD manbali blok hech qachon avtomat qo'llanmaydi: preview + [Ha]/[Yo'q].
- Fayl yozuvi jarayonlararo qulf ostida (fcntl.flock, P28): fon append va kunlik tahlil
  bir-birining yozuvini yo'qotmaydi.

aiogram va psycopg2 import qilinmaydi (testlar DB'siz ishlaydi).
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import secrets
import threading
import time
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple

from . import config
from . import contract as C
from . import db, history, notify, runner

try:  # Linux (server). Windows lokal: faqat jarayon ichidagi qulf.
    import fcntl  # type: ignore
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore

log = logging.getLogger("agents.memory_blocks")

_T = C.DB_SCHEMA + "."
_LOCK = threading.Lock()
_LOCK_FILE_NAME = "memory.lock"          # agents/state/ ichida (gitignore)
_TW_TOKEN_RE = re.compile(r"^[0-9a-f]{12}$")  # secrets.token_hex(6)
_PREVIEW_BLOK_MAX = 1500
_PREVIEW_JAMI = 3000                      # 4000 chegarasiga sig'sin (<pre> bo'linmasin)
_TW_APPR_PREFIX = C.KV_TW_APPR.split("{", 1)[0]

# Kontraktda yo'q, faqat shu modul ichidagi qisqa matnlar (toza lotin)
_RAD_BOSH = "mazmun bo'sh"
_RAD_IO_TPL = "yozish xatosi: {xato}"
_TOAST_HA = "Qabul qilindi."
_TOAST_YOQ = "Rad etildi."
_TOAST_XATO = "Xato: yozuv holati o'qilmadi."
_RAD_QATOR_TPL = "RAD: {sabab}"


@dataclass
class WriteBlock:
    path: str
    mode: str          # append | write (boshqasi -> append)
    content: str


@dataclass
class ApplyResult:
    ok: bool
    path: str
    natija: str = ""   # C.NATIJA_APPEND_TPL / C.NATIJA_WRITE_TPL
    sabab: str = ""    # rad sababi (C.TW_RAD_*)


# ---------------------------------------------------------------------------
# Ajratish (sof)
# ---------------------------------------------------------------------------
def _tidy(text: str) -> str:
    """Olib tashlangan bloklardan qolgan bo'sh qatorlarni yig'adi."""
    text = re.sub(r"[ \t]+\n", "\n", text or "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _norm_mode(mode: Optional[str]) -> str:
    m = (mode or "").strip().strip("`'\"").lower()
    return m if m in C.WM_MODES else C.WM_MODE_DEFAULT


def _parse_block(inner: str) -> Optional[WriteBlock]:
    """Blok ichi: path/mode sarlavhada, `content:` dan keyingi hamma qator mazmun."""
    cm = C.WM_CONTENT_RE.search(inner or "")
    if not cm:
        return None
    head = inner[: cm.start()]
    content = cm.group(1).replace("\r\n", "\n").replace("\r", "\n")
    content = content.lstrip("\n").rstrip()
    pm = C.WM_PATH_RE.search(head)
    path = pm.group(1).strip().strip("`'\"") if pm else ""
    if not path or not content.strip():
        return None
    mm = C.WM_MODE_RE.search(head)
    return WriteBlock(path=path, mode=_norm_mode(mm.group(1) if mm else ""), content=content)


def extract_write_blocks(text: str) -> Tuple[str, List[WriteBlock]]:
    """Bloklarni ajratadi va matndan olib tashlaydi. path yoki mazmunsiz blok e'tiborsiz."""
    blocks: List[WriteBlock] = []
    for m in C.WRITE_MEMORY_RE.finditer(text or ""):
        b = _parse_block(m.group(1))
        if b is not None:
            blocks.append(b)
    rest = C.WRITE_MEMORY_RE.sub("", text or "")
    return _tidy(rest), blocks


def extract_teacher_lines(text: str) -> Tuple[str, List[Tuple[str, str]]]:
    """`Teacher uchun: <tur> — <matn>` qatorlari (Q6 regex). Qatorlar va boshqa shakllari olib tashlanadi."""
    lines: List[Tuple[str, str]] = []
    seen = set()
    for m in C.TEACHER_UCHUN_RE.finditer(text or ""):
        tur, matn = m.group(1), m.group(2).strip()
        if not matn or (tur, matn) in seen:
            continue
        seen.add((tur, matn))
        lines.append((tur, matn))
    rest = C.TEACHER_UCHUN_STRIP_RE.sub("", text or "")
    return _tidy(rest), lines


# ---------------------------------------------------------------------------
# Yo'l tekshiruvi (oq ro'yxat + Q3 qoidalari)
# ---------------------------------------------------------------------------
def _norm_rel(path: str) -> Optional[str]:
    """Q3: absolyut, '~', '-', '..', '\\', .env* komponenti -> None."""
    raw = (path or "").strip().strip("`'\"")
    if not raw or "\x00" in raw or "\\" in raw:
        return None
    if raw.startswith(("/", "~", "-")) or re.match(r"^[A-Za-z]:", raw):
        return None
    raw_parts = raw.split("/")
    if ".." in raw_parts:
        return None
    parts = [p for p in raw_parts if p not in ("", ".")]
    if not parts or any(p.lower().startswith(".env") for p in parts):
        return None
    return "/".join(parts)


def check_memory_path(path: str, mode: str, today: Optional[date]) -> Optional[str]:
    """None = ruxsat. learned.md faqat append; daily/<bugun>.md append|write. Aks holda C.TW_RAD_YOL."""
    rel = _norm_rel(path)
    if rel is None:
        return C.TW_RAD_YOL
    mode = _norm_mode(mode)
    if rel == C.LEARNED_PATH:
        return None if mode == "append" else C.TW_RAD_YOL
    m = C.DAILY_PATH_RE.match(rel)
    day = today or config.today_local()
    if m and m.group(1) == day.isoformat():
        return None
    return C.TW_RAD_YOL


def _memory_abs(rel: str, repo: Path) -> Optional[Path]:
    """realpath MEMORY_DIR ichida bo'lishi shart (symlink orqali qochish yo'q)."""
    base = os.path.realpath(os.path.join(str(repo), "agents", "memory"))
    target = os.path.realpath(os.path.join(str(repo), rel))
    try:
        if os.path.commonpath([base, target]) != base:
            return None
    except ValueError:
        return None
    return Path(target)


# ---------------------------------------------------------------------------
# Yozish (qulf ostida)
# ---------------------------------------------------------------------------
@contextmanager
def _memory_lock(repo: Path) -> Iterator[None]:
    """Jarayon ichida threading.Lock, jarayonlararo fcntl.flock (agents/state/memory.lock)."""
    with _LOCK:
        fh = None
        try:
            lock_path = Path(repo) / "agents" / "state" / _LOCK_FILE_NAME
            os.makedirs(lock_path.parent, exist_ok=True)
            fh = open(lock_path, "a")
            if fcntl is not None:
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        except OSError as exc:
            log.warning("xotira qulfi olinmadi: %s", exc.__class__.__name__)
        try:
            yield
        finally:
            if fh is not None:
                try:
                    if fcntl is not None:
                        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
                finally:
                    fh.close()


def _chmod_readable(p: Path) -> None:
    try:
        os.chmod(p, 0o644)  # agent OS foydalanuvchisi o'qiy olsin
    except OSError:
        pass


def _append_file(abs_path: Path, content: str) -> None:
    os.makedirs(abs_path.parent, exist_ok=True)
    existed = abs_path.exists()
    size = abs_path.stat().st_size if existed else 0
    data = ("\n" if size else "") + content.rstrip("\n") + "\n"
    with open(abs_path, "a", encoding="utf-8", newline="") as fh:
        fh.write(data)
    if not existed:
        _chmod_readable(abs_path)


def _write_file(abs_path: Path, content: str) -> None:
    os.makedirs(abs_path.parent, exist_ok=True)
    tmp = abs_path.with_name("." + abs_path.name + ".tmp-" + secrets.token_hex(4))
    try:
        with open(tmp, "w", encoding="utf-8", newline="") as fh:
            fh.write(content.rstrip("\n") + "\n")
        _chmod_readable(tmp)
        os.replace(tmp, abs_path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _parcha(content: str) -> str:
    return C.short(content, C.NATIJA_PARCHA_MAX)


def _mask_secrets(text: str) -> str:
    out = text or ""
    for p in C.SIR_NAQSHLARI:
        out = p.sub("***", out)
    return out


def _record(*, path: str, mode: str, source: str, agent: Optional[str], content: str, result: str) -> None:
    """agents.agent_memory qatori. DB xatosi yutiladi."""
    try:
        db.execute(
            "INSERT INTO " + _T + "agent_memory (ts, path, mode, source, agent, content, result) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                config.now_utc(), (path or "")[:255], (mode or "")[:8], (source or "")[:24],
                agent[:32] if agent else None, _mask_secrets(content or "") or "-", (result or "")[:255],
            ),
        )
    except Exception as exc:  # DB yo'q bo'lsa ham yozuv qoladi
        log.warning("agent_memory yozilmadi: %s", exc.__class__.__name__)


def apply_write_blocks(blocks: List[WriteBlock], *, source: str, agent: str = "teacher",
                       today: Optional[date] = None, repo: Optional[Path] = None,
                       max_learned: Optional[int] = None, record: bool = True) -> List[ApplyResult]:
    """Bloklarni tartib bilan qo'llaydi. Har blok uchun natija (ok yoki rad sababi)."""
    day = today or config.today_local()
    base = Path(repo or config.REPO)
    results: List[ApplyResult] = []
    learned_n = 0
    for b in blocks or []:
        mode = _norm_mode(b.mode)
        content = (b.content or "").replace("\r\n", "\n")
        rel = _norm_rel(b.path)
        shown = rel or C.short(b.path, 120)
        sabab: Optional[str] = None
        if agent != "teacher":
            sabab = C.TW_RAD_EMAS_TPL.format(agent=agent)
        if sabab is None:
            sabab = check_memory_path(b.path, mode, day)
        if sabab is None and not content.strip():
            sabab = _RAD_BOSH
        if sabab is None and C.has_secret(content):
            sabab = C.TW_RAD_SIR
        if sabab is None and rel == C.LEARNED_PATH and max_learned is not None:
            if learned_n >= max_learned:
                sabab = C.TW_RAD_KUNLIK
        abs_path = _memory_abs(rel, base) if (sabab is None and rel) else None
        if sabab is None and abs_path is None:
            sabab = C.TW_RAD_YOL
        if sabab is None and abs_path is not None:
            try:
                with _memory_lock(base):
                    if mode == "write":
                        _write_file(abs_path, content)
                    else:
                        _append_file(abs_path, content)
            except OSError as exc:
                sabab = _RAD_IO_TPL.format(xato=exc.__class__.__name__)
        if sabab is None:
            if rel == C.LEARNED_PATH:
                learned_n += 1
            tpl = C.NATIJA_WRITE_TPL if mode == "write" else C.NATIJA_APPEND_TPL
            res = ApplyResult(ok=True, path=shown, natija=tpl.format(parcha=_parcha(content)))
        else:
            res = ApplyResult(ok=False, path=shown, sabab=sabab)
        results.append(res)
        if record:
            _record(path=shown, mode=mode, source=source, agent=agent, content=content,
                    result=res.natija if res.ok else _RAD_QATOR_TPL.format(sabab=res.sabab))
    return results


def write_runtime_memory(text: str, *, repo: Optional[Path] = None, record: bool = True) -> ApplyResult:
    """Xotira triggeri (KOD 1.2 6-qadam): leader-runtime.md ga sana/vaqt bilan append."""
    base = Path(repo or config.REPO)
    matn = (text or "").replace("\r\n", "\n").strip()
    sabab: Optional[str] = None
    if not matn:
        sabab = _RAD_BOSH
    elif C.has_secret(matn):
        sabab = C.TW_RAD_SIR
    abs_path = _memory_abs(C.RUNTIME_PATH, base) if sabab is None else None
    if sabab is None and abs_path is None:
        sabab = C.TW_RAD_YOL
    if sabab is None and abs_path is not None:
        loc = config.now_local()
        entry = C.RUNTIME_YOZUV_TPL.format(sana=loc.strftime("%Y-%m-%d"), vaqt=loc.strftime("%H:%M"), matn=matn)
        try:
            with _memory_lock(base):
                _append_file(abs_path, entry)
        except OSError as exc:
            sabab = _RAD_IO_TPL.format(xato=exc.__class__.__name__)
    if sabab is None:
        res = ApplyResult(ok=True, path=C.RUNTIME_PATH, natija=C.NATIJA_APPEND_TPL.format(parcha=_parcha(matn)))
    else:
        res = ApplyResult(ok=False, path=C.RUNTIME_PATH, sabab=sabab)
    if record:
        _record(path=C.RUNTIME_PATH, mode="append", source="trigger", agent=None, content=matn,
                result=res.natija if res.ok else _RAD_QATOR_TPL.format(sabab=res.sabab))
    return res


def sistema_for_results(results: List[ApplyResult]) -> List[str]:
    """Har natija uchun SISTEMA ichki matni (history.add_system ga beriladi)."""
    out: List[str] = []
    for r in results or []:
        if r.ok:
            out.append(C.sistema(C.SIS_TEACHER_YOZDI, path=r.path, natija=r.natija))
        else:
            out.append(C.sistema(C.SIS_TEACHER_RAD, sabab=r.sabab))
    return out


def results_text(results: List[ApplyResult]) -> str:
    """Egasiga: 'path: natija' yoki 'RAD: sabab (path)' qatorlari."""
    rows = []
    for r in results or []:
        if r.ok:
            rows.append("%s: %s" % (r.path, r.natija))
        else:
            rows.append(_RAD_QATOR_TPL.format(sabab=r.sabab) + " (%s)" % r.path)
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Fon topshiriq va tasdiq (Q6)
# ---------------------------------------------------------------------------
def _task_start(task: str) -> Optional[int]:
    """agents.agent_tasks (source 'fon'). DB xatosi yutiladi."""
    now = config.now_utc()
    try:
        with db.tx() as cur:
            cur.execute(
                "INSERT INTO " + _T + "agent_tasks (created_at, updated_at, agent, intent, source, is_forward, task, status) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (now, now, "teacher", "remember", "fon", False, (task or "")[:2000], "in_progress"),
            )
            row = cur.fetchone()
            return int(row["id"]) if row else None
    except Exception as exc:
        log.warning("agent_tasks yozilmadi: %s", exc.__class__.__name__)
        return None


def _task_finish(task_id: Optional[int], status: str, preview: str, run_id: Optional[int]) -> None:
    if task_id is None:
        return
    try:
        db.execute(
            "UPDATE " + _T + "agent_tasks SET status = %s, updated_at = %s, result_preview = %s, run_id = %s "
            "WHERE id = %s",
            (status, config.now_utc(), (preview or "")[:500], run_id, task_id),
        )
    except Exception as exc:
        log.warning("agent_tasks yangilanmadi: %s", exc.__class__.__name__)


def _add_system(inner: str) -> None:
    try:
        history.add_system(inner)
    except Exception as exc:  # tarix yozilmasa ham jarayon davom etadi
        log.warning("SISTEMA yozilmadi: %s", exc.__class__.__name__)


async def teacher_fon(manba: str, tur: str, matn: str, outbox: "notify.Outbox") -> None:
    """Sub-agentning `Teacher uchun:` qatori -> Teacher FON. Blok hech qachon avtomat qo'llanmaydi.

    agent_tasks qatori har yo'lda (xato, bekor qilish ham) yopiladi: yakunlanmagan bo'lsa
    'failed' + xato klassi. os._exit/crash holatini leader_bot.run() startdagi tiklash yopadi.
    """
    task_id: Optional[int] = None
    status, preview, run_id = "failed", "", None
    try:
        if tur in C.FON_TAQIQ_TURLAR:
            _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_FON_TUR_TPL.format(tur=tur)))
            return
        if C.has_secret(matn):
            _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_SIR))
            return
        body = C.FON_BODY_TPL.format(tur=tur, matn=history.clean_external(matn))
        task = history.build_sub_task(body, header=C.TEACHER_FON_TPL.format(agent=C.clean_dynamic(manba)))
        task_id = await asyncio.to_thread(_task_start, task)
        res = await runner.run_agent_async("teacher", task, {"source": "fon"})
        run_id = res.run_id
        if not res.ok:
            preview = res.error or res.status
            _add_system(runner.sistema_for(res))
            return
        rest, blocks = extract_write_blocks(res.text)
        if blocks:
            await request_teacher_approval(blocks, manba=manba, sabab_turi="fon", outbox=outbox)
        else:
            _add_system(runner.sistema_for(res))  # "Yozmadim: ..." holati
        status, preview = "done", rest or res.text
    except asyncio.CancelledError:
        status, preview = "failed", "CancelledError"
        raise
    except Exception as exc:
        status, preview = "failed", exc.__class__.__name__
        log.exception("teacher_fon xatosi (manba=%s, tur=%s)", manba, tur)
    finally:
        if task_id is not None:
            try:  # bekor qilinsa ham thread yozuvni oxiriga yetkazadi
                await asyncio.to_thread(_task_finish, task_id, status, preview, run_id)
            except Exception as exc:
                log.warning("agent_tasks yopilmadi: %s", exc.__class__.__name__)


def _preview_html(blocks: List[WriteBlock], manba_txt: str) -> str:
    per = max(200, min(_PREVIEW_BLOK_MAX, _PREVIEW_JAMI // max(1, len(blocks))))
    parts = [html.escape(C.MSG_TW_PREVIEW_SARLAVHA_TPL.format(manba=manba_txt), quote=False)]
    for b in blocks:
        content = b.content if len(b.content) <= per else b.content[: per - 3].rstrip() + "..."
        parts.append("")
        parts.append("<b>%s</b> (%s)" % (html.escape(b.path, quote=False), html.escape(b.mode, quote=False)))
        parts.append("<pre>%s</pre>" % html.escape(content, quote=False))
    return "\n".join(parts)


async def request_teacher_approval(blocks: List[WriteBlock], *, manba: str, sabab_turi: str,
                                   outbox: "notify.Outbox") -> Optional[str]:
    """FON/FORWARD bloklari: oldindan tekshiruv, kv payload, preview + [Ha]/[Yo'q]. Token yoki None."""
    today = config.today_local()
    turi = sabab_turi if sabab_turi in ("fon", "forward") else "fon"
    ok_blocks: List[WriteBlock] = []
    for b in blocks or []:
        mode = _norm_mode(b.mode)
        sabab = check_memory_path(b.path, mode, today)
        if sabab is None and C.has_secret(b.content):
            sabab = C.TW_RAD_SIR
        if sabab is not None:
            _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=sabab))
            await asyncio.to_thread(
                _record, path=_norm_rel(b.path) or C.short(b.path, 120), mode=mode, source=turi,
                agent="teacher", content=b.content, result=_RAD_QATOR_TPL.format(sabab=sabab),
            )
            continue
        ok_blocks.append(WriteBlock(path=_norm_rel(b.path) or b.path, mode=mode, content=b.content))
    if not ok_blocks:
        return None
    token = secrets.token_hex(6)
    key = C.kv_key(C.KV_TW_APPR, token=token)
    payload: Dict[str, Any] = {
        "v": 1,
        "created_ts": time.time(),
        "created": config.iso_utc(),
        "manba": manba,
        "sabab_turi": turi,
        "blocks": [asdict(b) for b in ok_blocks],
    }
    try:
        await asyncio.to_thread(db.kv_set_json, key, payload)
    except Exception as exc:
        log.warning("tw_appr saqlanmadi: %s", exc.__class__.__name__)
        return None
    keyboard = [[(C.KNOPKA_HA, C.CB_TW_OK + token), (C.KNOPKA_YOQ, C.CB_TW_NO + token)]]
    # Preview qisqartirsa, egasi yoziladigan matnni to'liq ko'rishi shart: avval hujjat.
    # Hujjat yuborilmasa tasdiq so'ralmaydi (preview bilan yozuv farq qilmasin).
    per = max(200, min(_PREVIEW_BLOK_MAX, _PREVIEW_JAMI // max(1, len(ok_blocks))))
    mid: Optional[int] = None
    doc_ok = True
    if any(len(b.content) > per for b in ok_blocks):
        full = "\n\n".join("### %s (%s)\n%s" % (b.path, b.mode, b.content) for b in ok_blocks)
        try:
            doc_ok = await outbox.send_document("teacher_%s.md" % token, full.encode("utf-8")) is not None
        except Exception as exc:
            log.warning("teacher hujjati yuborilmadi: %s", exc.__class__.__name__)
            doc_ok = False
    if doc_ok:
        mid = await outbox.send_text(_preview_html(ok_blocks, "%s, %s" % (manba, turi)), html=True, keyboard=keyboard)
    if mid is None:
        try:
            await asyncio.to_thread(db.kv_del, key)
        except Exception as exc:
            log.warning("tw_appr o'chirilmadi: %s", exc.__class__.__name__)
        _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.RAD_PREVIEW))
        return None
    _add_system(C.SIS_TEACHER_KUTMOQDA)
    return token


async def _drop_keyboard(outbox: "notify.Outbox", message_id: Optional[int]) -> None:
    if message_id:
        try:
            await outbox.edit_keyboard(message_id, None)
        except Exception as exc:
            log.debug("tugma olinmadi: %s", exc.__class__.__name__)


async def teacher_decision(token: str, approve: bool, outbox: "notify.Outbox", message_id: Optional[int]) -> str:
    """[Ha]/[Yo'q]: TTL -> bir martalik claim -> qo'llash yoki RAD. Qaytadi: toast matni."""
    if not _TW_TOKEN_RE.match(token or ""):
        await _drop_keyboard(outbox, message_id)
        return C.MSG_MUDDAT_OTGAN
    appr_key = C.kv_key(C.KV_TW_APPR, token=token)
    run_key = C.kv_key(C.KV_TW_RUN, token=token)
    try:
        payload = await asyncio.to_thread(db.kv_get_json, appr_key, None)
        expired = (
            not isinstance(payload, dict)
            or time.time() - float(payload.get("created_ts") or 0) > C.APPROVAL_TTL_S
        )
        if expired:
            # /reset yoki muddat: bir marta SISTEMA, qayta bosish "hal qilingan"
            if not await asyncio.to_thread(db.kv_claim, run_key):
                return C.MSG_YOZUV_HAL_QILINGAN
            await _drop_keyboard(outbox, message_id)
            await asyncio.to_thread(db.kv_del, appr_key)
            _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_MUDDAT))
            return C.MSG_MUDDAT_OTGAN
        if not await asyncio.to_thread(db.kv_claim, run_key):
            return C.MSG_YOZUV_HAL_QILINGAN
    except Exception:
        log.exception("teacher_decision: kv xatosi")
        return _TOAST_XATO

    await _drop_keyboard(outbox, message_id)
    turi = payload.get("sabab_turi") if payload.get("sabab_turi") in ("fon", "forward") else "fon"
    blocks = [
        WriteBlock(path=str(b.get("path", "")), mode=str(b.get("mode", "")), content=str(b.get("content", "")))
        for b in payload.get("blocks") or [] if isinstance(b, dict)
    ]
    try:
        await asyncio.to_thread(db.kv_del, appr_key)
    except Exception as exc:
        log.warning("tw_appr o'chirilmadi: %s", exc.__class__.__name__)

    if not approve:
        _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_EGASI))
        for b in blocks:
            await asyncio.to_thread(
                _record, path=b.path, mode=_norm_mode(b.mode), source=turi, agent="teacher",
                content=b.content, result=_RAD_QATOR_TPL.format(sabab=C.TW_RAD_EGASI),
            )
        await outbox.send_text(C.MSG_TW_RAD, html=False)
        return _TOAST_YOQ

    results = await asyncio.to_thread(apply_write_blocks, blocks, source=turi)
    for inner in sistema_for_results(results):
        _add_system(inner)
    ok = [r for r in results if r.ok]
    rad = [r for r in results if not r.ok]
    if ok:
        msg = C.YOZIB_QOYDIM_TPL.format(natija="; ".join("%s: %s" % (r.path, r.natija) for r in ok))
    else:
        msg = C.MSG_TW_RAD
    if rad:
        msg += "\n" + results_text(rad)
    await outbox.send_text(html.escape(msg, quote=False), html=True)
    return _TOAST_HA


def purge_pending() -> int:
    """/reset: kutilayotgan tw_appr_* tokenlari o'chiriladi (keyin [Ha] -> muddat o'tgan)."""
    try:
        return int(db.kv_del_prefix(_TW_APPR_PREFIX) or 0)
    except Exception as exc:
        log.warning("tw_appr tozalanmadi: %s", exc.__class__.__name__)
        return 0
