"""Checker worker (KOD 6): health tekshiruvlari, agent_health, alert throttle, alert tahlili.

- Tekshiruv: fn() -> (status, xabar, details), status ok|warn|error|unknown.
- Natija agents.agent_health ga; alert throttle agents.agent_alert_log da (komponent+status, 1 soat).
- Bir tickda faqat bitta (eng jiddiy, throttle'dan o'tgan) muammoga LLM tahlili.
- Tashqi ma'lumot LLM'ga JSON fence ichida, ichidagi ``` neytrallangan, "KO'RSATMA emas" ogohlantirishi bilan.
- Xavfli avtomat (restart, IP blok) YO'Q.

Qo'lda: python3 -m agents.checker_worker          (blokni chop etadi, LLM yo'q, yubormaydi)
         python3 -m agents.checker_worker --alert  (to'liq tick: LLM + Telegram)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Iterator, List, Optional, Set, Tuple

from . import config
from . import contract as C
from . import db, history, leader_logic, memory_blocks, notify, runner

log = logging.getLogger("agents.checker_worker")

_T = C.DB_SCHEMA + "."
CheckFn = Callable[[], Tuple[str, str, Optional[dict]]]
TeacherLinesCb = Callable[[str, List[Tuple[str, str]]], Awaitable[None]]

# Chegaralar
_DISK_WARN = 85.0
_DISK_ERROR = 95.0
_DB_SLOW_MS = 2000
_HEARTBEAT_WARN_MIN = 3
_HEARTBEAT_ERROR_MIN = 10
_AGENT_BAD_WARN = 3
_AGENT_BAD_ERROR = 10
_OPLATYKV_KECHIKISH_MIN = 120
# backend settings.service getTimeStr default'lari (OplatyKv avto-sync jadvali, Toshkent)
_OKV_VAQT_DEFAULT = {"oplatykv.dayStart": "08:00", "oplatykv.dayEnd": "22:00", "oplatykv.nightStart": "01:00"}
_XONPAY_DEFAULT_INTERVAL_MIN = 60
_XONPAY_SOAT = (7, 23)                   # avto-sync faqat 07-23
_SYSTEMCTL_TIMEOUT_S = 15
_LEASE_TTL_S = 1800
_MAX_SLEEP_S = 600
_BAND_SLEEP_S = 120
_XATO_SLEEP_S = 300
_MSG_MAX = 300
_DETAILS_DB_MAX = 4000
_ALERT_DETAILS_MAX = 3000

# LLM ko'rsatmasi va LLM'siz matnlar (toza lotin)
_ALERT_KORSATMA = (
    "Alert rejimi: CHECKER_WORKER bloki yo'q, manba faqat shu JSON. Javob 3 gap: "
    "1-gap hukm, 2-gap nom + identifikator + raqam, 3-gap kim tuzatadi (kerak bo'lsa bitta buyruq)."
)
_ALERT_FALLBACK_TPL = "Shefim, e'tibor kerak.\n{qator}\nTahlil qilinmadi: {sabab}."
_BOSHQA_TPL = "Boshqa ogohlantirishlar: {royxat}."
_BOSH_JAVOB = "bo'sh javob"

_SIGNAL_ERROR = ("hung", "failed", "login_suspect")
_SIGNAL_WARN = ("stale",)

_BG_TASKS: Set["asyncio.Task[Any]"] = set()
_MEM_ALERTS: Dict[Tuple[str, str], float] = {}   # DB yo'q paytidagi throttle
_MEM_LAST_RUN: Optional[datetime] = None
_FACTS_CACHE: Dict[str, Any] = {}


@dataclass
class CheckResult:
    component: str
    status: str                 # ok | warn | error | unknown
    message: str
    details: Optional[dict] = None


# ---------------------------------------------------------------------------
# Yordamchilar
# ---------------------------------------------------------------------------
def _mask(text: str) -> str:
    out = text or ""
    for p in C.SIR_NAQSHLARI:
        out = p.sub("***", out)
    return out


def _clean_msg(text: Any, n: int = _MSG_MAX) -> str:
    """Bir qator, sirsiz, blok chegarasini soxtalashtirmaydi."""
    s = _mask(re.sub(r"\s+", " ", "" if text is None else str(text))).strip()
    s = re.sub(r"={3,}", "==", s)  # replace bir marta: "====" -> "===" bo'lardi (idempotent emas)
    return C.short(s, n)


def _exc_text(exc: BaseException) -> str:
    return _clean_msg("%s: %s" % (exc.__class__.__name__, exc), 200)


_TZ_SUFFIX_RE = re.compile(r"(Z|[+-]\d{2}(:?\d{2})?)$")


def _parse_time(value: Any) -> Optional[datetime]:
    """ISO (offset bilan) yoki 'YYYY-MM-DD HH:MM[:SS]' (offsetsiz = Toshkent) -> aware UTC."""
    if value is None or isinstance(value, bool):
        return None
    s = str(value).strip()
    if not s:
        return None
    if _TZ_SUFFIX_RE.search(s):
        return config.parse_iso(s)
    s = re.sub(r"\.\d+$", "", s).replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=config.TZ_LOCAL).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _age_min(dt: datetime) -> float:
    return (config.now_utc() - dt).total_seconds() / 60.0


def _worst(statuses: List[str]) -> str:
    return max(statuses or ["ok"], key=lambda s: C.CHECK_SEVERITY.get(s, 0))


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(" ", "").replace(",", "."))
        except ValueError:
            return None
    if isinstance(value, dict):
        for k in ("soni", "son", "count", "cnt", "n", "jami_soni"):
            if k in value:
                return _num(value[k])
    return None


def _walk(obj: Any, depth: int = 0) -> Iterator[dict]:
    """Ichma-ich barcha dict'lar (Facts tuzilmasi aniq bo'lmagani uchun ehtiyotkor qidiruv)."""
    if depth > 8:
        return
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, depth + 1)


def _find_key(obj: Any, *names: str) -> Any:
    for d in _walk(obj):
        for n in names:
            if n in d and d[n] not in (None, ""):
                return d[n]
    return None


def _mask_acc(value: Any) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return "****" + digits[-4:] if len(digits) >= 4 else _clean_msg(value, 40)


def _ident(d: dict) -> str:
    parts: List[str] = []
    for k in ("bankName", "bank_name", "bank", "code", "bank_code", "sheet_name", "sheetName", "name"):
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            parts.append(_clean_msg(v, 40))
            break
    for k in ("accountNo", "account_no", "hisob"):
        v = d.get(k)
        if v:
            parts.append(_mask_acc(v))
            break
    return " ".join(parts) or "(nomsiz)"


def _is_error_section(v: Any) -> bool:
    return isinstance(v, dict) and "error" in v and set(v) <= {"error", "izoh"}


def _load_facts() -> Tuple[Optional[dict], Optional[str]]:
    """Facts JSON (mtime bo'yicha kesh). (data, xato)."""
    p = config.FACTS_PATH
    rel = config.rel_to_repo(p)
    try:
        st = p.stat()
    except OSError:
        return None, "Facts fayli yo'q: %s" % rel
    key = (st.st_mtime_ns, st.st_size)
    if _FACTS_CACHE.get("key") == key:
        return _FACTS_CACHE.get("data"), _FACTS_CACHE.get("err")
    data: Optional[dict] = None
    err: Optional[str] = None
    try:
        with open(p, encoding="utf-8") as fh:
            raw = json.load(fh)
        if isinstance(raw, dict):
            data = raw
        else:
            err = "Facts fayli JSON obyekt emas: %s" % rel
    except (OSError, ValueError) as exc:
        err = "Facts fayli o'qilmadi (%s): %s" % (rel, exc.__class__.__name__)
    _FACTS_CACHE.update({"key": key, "data": data, "err": err})
    return data, err


def _facts_section(name: str) -> Tuple[Any, Optional[str]]:
    data, err = _load_facts()
    if err or data is None:
        return None, err or "Facts yo'q"
    if name not in data:
        return None, "%s facts'da yo'q" % name
    sec = data[name]
    if _is_error_section(sec):
        return None, "facts'da %s bo'limi xato berdi: %s" % (name, _clean_msg(sec.get("error"), 160))
    return sec, None


# ---------------------------------------------------------------------------
# Tekshiruvlar
# ---------------------------------------------------------------------------
_SD_TS_RE = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*(\S+)?")


def _systemd_ts(value: str) -> Optional[datetime]:
    m = _SD_TS_RE.search(value or "")
    if not m:
        return None
    base = datetime.strptime(m.group(1), "%Y-%m-%d %H:%M:%S")
    tzs = m.group(2) or ""
    if tzs in ("UTC", "GMT"):
        return base.replace(tzinfo=timezone.utc)
    om = re.match(r"^([+-])(\d{2}):?(\d{2})?$", tzs)
    if om:
        sign = 1 if om.group(1) == "+" else -1
        off = timedelta(hours=int(om.group(2)), minutes=int(om.group(3) or 0)) * sign
        return base.replace(tzinfo=timezone(off)).astimezone(timezone.utc)
    return base.replace(tzinfo=config.TZ_LOCAL).astimezone(timezone.utc)


def _check_services() -> Tuple[str, str, Optional[dict]]:
    props = "Id,LoadState,ActiveState,SubState,ActiveEnterTimestamp,InactiveEnterTimestamp,NRestarts"
    cmd = ["systemctl", "show"] + list(C.FACTS_SERVISLAR) + ["--property=" + props]
    try:
        out = subprocess.run(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                             text=True, encoding="utf-8", errors="replace", timeout=_SYSTEMCTL_TIMEOUT_S).stdout
    except FileNotFoundError:
        return "unknown", "systemctl yo'q (bu server emas)", None
    except subprocess.TimeoutExpired:
        return "unknown", "systemctl %d s ichida javob bermadi" % _SYSTEMCTL_TIMEOUT_S, None
    units: Dict[str, Dict[str, str]] = {}
    for block in re.split(r"\n\s*\n", out or ""):
        kv = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        uid = kv.get("Id", "")
        if uid:
            units[uid[:-8] if uid.endswith(".service") else uid] = kv
    statuses: List[str] = []
    muammo: List[str] = []
    details: Dict[str, Any] = {}
    for name in C.FACTS_SERVISLAR:
        kv = units.get(name)
        if kv is None:
            statuses.append("unknown")
            muammo.append("%s holati olinmadi" % name)
            continue
        active, sub, load = kv.get("ActiveState", ""), kv.get("SubState", ""), kv.get("LoadState", "")
        details[name] = {"active": active, "sub": sub, "restarts": kv.get("NRestarts", "")}
        if load == "not-found":
            statuses.append("error")
            muammo.append("%s unit topilmadi" % name)
        elif active == "active":
            statuses.append("ok")
        elif active in ("activating", "reloading"):
            statuses.append("warn")
            muammo.append("%s %s (%s)" % (name, active, sub))
        else:
            statuses.append("error")
            since = _systemd_ts(kv.get("InactiveEnterTimestamp", ""))
            qachon = ", %d daq oldin to'xtagan" % _age_min(since) if since else ""
            muammo.append("%s %s%s" % (name, active or "noma'lum", qachon))
    st = _worst(statuses)
    if not muammo:
        return "ok", "%d servis faol: %s" % (len(C.FACTS_SERVISLAR), ", ".join(C.FACTS_SERVISLAR)), details
    return st, "; ".join(muammo), details


def _check_db() -> Tuple[str, str, Optional[dict]]:
    s = config.get_settings()
    details: Dict[str, Any] = {}
    try:
        t0 = time.monotonic()
        db.fetchone("SELECT 1 AS x")
        ms = int((time.monotonic() - t0) * 1000)
        details["agents_ms"] = ms
    except Exception as exc:
        return "error", "%s (agents ulanishi) SELECT 1 xato: %s" % (C.DB_NOMI, _exc_text(exc)), None
    if s.facts_db_url and s.facts_db_url != s.agents_db_url:
        try:
            t1 = time.monotonic()
            db.fetchone("SELECT 1 AS x", kind="facts", readonly=True, timeout_ms=5000)
            details["facts_ms"] = int((time.monotonic() - t1) * 1000)
        except Exception as exc:
            return "error", "%s (facts ulanishi) SELECT 1 xato: %s" % (C.DB_NOMI, _exc_text(exc)), details
    slow = max(details.values())
    st = "warn" if slow > _DB_SLOW_MS else "ok"
    return st, "%s SELECT 1: %d ms" % (C.DB_NOMI, slow), details


def _check_disk() -> Tuple[str, str, Optional[dict]]:
    u = shutil.disk_usage("/")
    pct = u.used * 100.0 / u.total if u.total else 0.0
    free_gb = u.free / (1024 ** 3)
    st = "error" if pct >= _DISK_ERROR else "warn" if pct >= _DISK_WARN else "ok"
    return st, "disk / %.1f%% band, bo'sh %.1f GB, chegara %d%% (xato %d%%)" % (
        pct, free_gb, _DISK_WARN, _DISK_ERROR), {
        "foiz": round(pct, 1), "bosh_gb": round(free_gb, 1)}


def _check_facts() -> Tuple[str, str, Optional[dict]]:
    data, err = _load_facts()
    if err or data is None:
        return "error", err or "Facts yo'q", None
    upd = _parse_time(data.get("updated_at"))
    if upd is None:
        return "error", "Facts updated_at o'qilmadi (%s)" % config.rel_to_repo(config.FACTS_PATH), None
    age = _age_min(upd)
    eski = C.FACTS_ESKI_S / 60.0
    st = "error" if age > 2 * eski else "warn" if age > eski else "ok"
    bad = [k for k, v in data.items() if _is_error_section(v)]
    msg = "Facts %d daq oldin yangilangan (%s)" % (max(0, round(age)), config.fmt_local(upd))
    if bad:
        st = _worst([st, "warn"])
        msg += "; xato bergan bo'limlar %d ta: %s" % (len(bad), ", ".join(bad))
    return st, msg, {"yosh_daq": round(age, 1), "xato_bolimlar": bad} if bad else {"yosh_daq": round(age, 1)}


def _check_leader_bot() -> Tuple[str, str, Optional[dict]]:
    nom = "%s (%s)" % (C.BOT_NOMI, C.BOT_SERVIS)
    raw = db.kv_get(C.KV_HEARTBEAT)
    dt = _parse_time(raw) if raw else None
    if dt is None:
        return "warn", "%s heartbeat yo'q" % nom, None
    age = _age_min(dt)
    st = "error" if age > _HEARTBEAT_ERROR_MIN else "warn" if age > _HEARTBEAT_WARN_MIN else "ok"
    return st, "%s heartbeat %d daq oldin" % (nom, max(0, round(age))), None


def _deploy_entries(obj: Any) -> List[dict]:
    if isinstance(obj, list):
        return [x for x in obj if isinstance(x, dict)]
    if isinstance(obj, dict):
        for k in ("natijalar", "log", "items", "oxirgi", "entries", "deploys", "tarix"):
            v = obj.get(k)
            if isinstance(v, list) and any(isinstance(x, dict) for x in v):
                return [x for x in v if isinstance(x, dict)]
    return []


def _entry_time(e: dict) -> Optional[datetime]:
    for k in ("vaqt", "time", "ts", "at", "finished_at", "started_at", "date"):
        if k in e:
            t = _parse_time(e.get(k))
            if t:
                return t
    return None


def _check_deploy() -> Tuple[str, str, Optional[dict]]:
    entries: List[dict] = []
    manba = config.rel_to_repo(config.DEPLOY_LOG_JSON)
    try:
        with open(config.DEPLOY_LOG_JSON, encoding="utf-8") as fh:
            entries = _deploy_entries(json.load(fh))
    except (OSError, ValueError):
        entries = []
    head = None
    if not entries:
        sec, err = _facts_section("deploy")
        if err:
            return "unknown", "deploy logi yo'q (%s); %s" % (manba, err), None
        entries = _deploy_entries(sec)
        head = _find_key(sec, "head")
        manba = "facts deploy"
    if not entries:
        msg = "deploy natijasi yo'q (deploy.sh hali yozmaydi)"
        if head:
            msg += "; HEAD: %s" % _clean_msg(head, 120)
        return "unknown", msg, None
    entries.sort(key=lambda e: _entry_time(e) or datetime.min.replace(tzinfo=timezone.utc))
    last = entries[-1]
    status_raw = ""
    for k in ("status", "natija", "result", "holat"):
        if last.get(k) not in (None, ""):
            status_raw = str(last.get(k))
            break
    if not status_raw and isinstance(last.get("ok"), bool):
        status_raw = "OK" if last["ok"] else "FAIL"
    up = status_raw.upper()
    commit = _clean_msg(last.get("commit") or last.get("hash") or last.get("sha") or "?", 12)
    t = _entry_time(last)
    vaqt = config.fmt_local(t) if t else "vaqti noma'lum"
    if any(x in up for x in ("FAIL", "ERROR", "XATO")):
        xato = _clean_msg(last.get("xatolar") or last.get("error") or last.get("errors") or "", 160)
        return "error", "oxirgi deploy FAIL: commit %s, %s%s" % (commit, vaqt, (", " + xato) if xato else ""), {
            "manba": manba}
    if up in ("OK", "SUCCESS", "DONE", "PASSED"):
        return "ok", "oxirgi deploy OK: commit %s, %s" % (commit, vaqt), {"manba": manba}
    return "unknown", "oxirgi deploy holati aniqlanmadi: commit %s, %s" % (commit, vaqt), {"manba": manba}


def _signals_of(d: dict) -> Tuple[Set[str], bool]:
    """(yoqilgan signallar, signal maydoni bormi)."""
    names = _SIGNAL_ERROR + _SIGNAL_WARN
    found: Set[str] = set()
    known = False
    for k in names:
        if k in d:
            known = True
            if d.get(k) is True:
                found.add(k)
    sig = d.get("signallar", d.get("signals"))
    if isinstance(sig, list):
        known = True
        found.update(str(x) for x in sig if str(x) in names)
    elif isinstance(sig, dict):
        known = True
        found.update(k for k, v in sig.items() if k in names and v is True)
    return found, known


def _check_bank_sync() -> Tuple[str, str, Optional[dict]]:
    sec, err = _facts_section("bank_sync")
    if err:
        return "unknown", err, None
    problems: List[Tuple[str, Set[str]]] = []
    any_known = False
    for d in _walk(sec):
        found, known = _signals_of(d)
        any_known = any_known or known
        if found:
            problems.append((_ident(d), found))
    if not any_known:
        return "unknown", "bank_sync signal maydonlari facts'da topilmadi", None
    if not problems:
        return "ok", "bank_sync: faol hisoblarda signal yo'q", None
    st = "error" if any(s & set(_SIGNAL_ERROR) for _, s in problems) else "warn"
    parts = ["%s (%s)" % (who, ", ".join(sorted(s))) for who, s in problems[:6]]
    return st, "bank_sync: %d hisobda signal: %s" % (len(problems), "; ".join(parts)), None


def _check_sverka() -> Tuple[str, str, Optional[dict]]:
    sec, err = _facts_section("sverka")
    if err:
        return "unknown", err, None
    today = config.today_local().isoformat()
    sana = _find_key(sec, "date", "sana")
    if sana and str(sana)[:10] != today:
        return "unknown", "sverka: saqlangan sana %s, bugun emas (farq noma'lum)" % _clean_msg(sana, 20), None
    farqlar: List[str] = []
    seen = False
    for d in _walk(sec):
        if "totalFarq" not in d:
            continue
        seen = True
        farq = _num(d.get("totalFarq")) or 0.0
        if abs(farq) >= 1 and not d.get("dismissed"):
            farqlar.append("%s farq %s so'm" % (_ident(d), "{:,.0f}".format(farq).replace(",", " ")))
    if not sana and not seen:
        return "unknown", "sverka: bugungi natija facts'da topilmadi", None
    if not farqlar:
        return "ok", "sverka: bugun ochiq farq yo'q", None
    return "warn", "sverka: %d hisobda ochiq farq: %s" % (len(farqlar), "; ".join(farqlar[:5])), None


def _check_xonpay() -> Tuple[str, str, Optional[dict]]:
    sec, err = _facts_section("xonpay")
    if err:
        return "unknown", err, None
    enabled = _find_key(sec, "xonpay.cron.enabled", "cron_enabled", "enabled")
    if str(enabled).lower() == "false":
        return "ok", "xonpay: avto-sync o'chiq (xonpay.cron.enabled = false)", None
    interval = _num(_find_key(sec, "xonpay.cron.intervalMinutes", "intervalMinutes", "interval")) \
        or _XONPAY_DEFAULT_INTERVAL_MIN
    last_ok = _parse_time(_find_key(sec, "oxirgi_muvaffaqiyatli"))
    hour = config.now_local().hour
    if last_ok is None:
        return "unknown", "xonpay: oxirgi_muvaffaqiyatli facts'da topilmadi", None
    age = _age_min(last_ok)
    chegara = max(3 * interval, 180)
    if _XONPAY_SOAT[0] <= hour < _XONPAY_SOAT[1] and age > chegara:
        return "warn", "xonpay: oxirgi muvaffaqiyatli sync %d daq oldin (%s), interval %d daq" % (
            round(age), config.fmt_local(last_ok), round(interval)), None
    return "ok", "xonpay: oxirgi muvaffaqiyatli sync %d daq oldin" % max(0, round(age)), None


def _check_google_export() -> Tuple[str, str, Optional[dict]]:
    sec, err = _facts_section("google_export")
    if err:
        return "unknown", err, None
    known = False
    bad: List[str] = []
    for d in _walk(sec):
        if "ketma_ket_2_xato" in d:
            known = True
            if d.get("ketma_ket_2_xato") is True:
                bad.append(_ident(d))
    if not known:
        return "unknown", "google_export: ketma_ket_2_xato maydoni facts'da topilmadi", None
    if bad:
        return "error", "google_export: %d sheet ketma-ket 2 marta xato: %s" % (len(bad), ", ".join(bad[:5])), None
    return "ok", "google_export: ketma-ket xato yo'q", None


_HHMM_RE = re.compile(r"\d{1,2}:\d{2}")


def _okv_daq(sozlama: dict, kalit: str) -> int:
    """oplatykv HH:MM sozlamasi -> kun boshidan daqiqa (backend kabi: format noto'g'ri -> default)."""
    v = sozlama.get(kalit)
    s = v if isinstance(v, str) and _HHMM_RE.fullmatch(v) else _OKV_VAQT_DEFAULT[kalit]
    h, m = s.split(":")
    return int(h) * 60 + int(m)


def _okv_interval(sozlama: dict) -> float:
    """txAutoSyncMinutes: musbat son, aks holda 0 (backend: kunduzgi sync o'chiq)."""
    try:
        n = float(str(sozlama.get("oplatykv.txAutoSyncMinutes") or "").strip() or 0)
    except ValueError:
        return 0.0
    return n if 0 < n < float("inf") else 0.0


def _hhmm(daq: int) -> str:
    return "%02d:%02d" % divmod(daq, 60)


def _okv_kutish_boshi(eng_eski: datetime, kun_bosh: datetime, tun_daq: int, interval: float) -> datetime:
    """To'lov backend sync'ini qachondan kutadi (kechikish shundan o'lchanadi, UTC)."""
    if interval > 0:
        # kunduzgi sync: undan oldingi to'lov ham bugungi dayStart'da olinadi
        return max(eng_eski, kun_bosh)
    # kunduzgi sync o'chiq: faqat tungi batch (nightStart, kuniga bir marta)
    kun0, _ = config.local_day_bounds_utc(config.to_local(eng_eski).date())
    tun = kun0 + timedelta(minutes=tun_daq)
    return tun if tun >= eng_eski else tun + timedelta(days=1)


def _check_oplatykv_sync() -> Tuple[str, str, Optional[dict]]:
    """Tushmagan CLIENT to'lov kechikishi backend avto-sync jadvaliga nisbatan.

    Backend (oplata-kv.service autoSyncTick, Toshkent): kunduz [dayStart, dayEnd) har
    txAutoSyncMinutes, tunda nightStart'da bir marta. Kunduzgi oynadan tashqaridagi to'lov
    keyingi sync'ni kutadi, bu nosozlik emas: warn faqat [dayStart + 120 daq, dayEnd) ichida,
    kechikish max(eng_eski, bugungi dayStart) dan (kunduzgi sync o'chiq bo'lsa tungi batch'dan).
    """
    sec, err = _facts_section("oplatykv_sync")
    if err:
        return "unknown", err, None
    tushmagan = _find_key(sec, "tushmagan")
    kelajak = _num(_find_key(sec, "kelajak_updated_at"))
    if tushmagan is None and kelajak is None:
        return "unknown", "oplatykv_sync: tushmagan maydoni facts'da topilmadi", None
    msgs: List[str] = []
    izoh = "kechikish chegaradan past"
    st = "ok"
    n = _num(tushmagan) or 0.0
    if n > 0:
        eng_eski = None
        if isinstance(tushmagan, dict):
            for k, v in tushmagan.items():
                if "min" in k.lower() or "eski" in k.lower():
                    eng_eski = _parse_time(v)
                    if eng_eski:
                        break
        raw = _find_key(sec, "sozlamalar")
        sozlama = raw if isinstance(raw, dict) else {}
        ds, de = _okv_daq(sozlama, "oplatykv.dayStart"), _okv_daq(sozlama, "oplatykv.dayEnd")
        interval = _okv_interval(sozlama)
        chegara = max(float(_OPLATYKV_KECHIKISH_MIN), 2 * interval)   # siyrak interval ham kutiladi
        now = config.now_utc()
        kun0, _ = config.local_day_bounds_utc(config.today_local())
        kun_bosh = kun0 + timedelta(minutes=ds)
        # facts snapshot vaqti (15 daq kesh): eskirgan ma'lumot soxta kechikish bermasin
        kuzatildi = min(_parse_time(_find_key(sec, "hisoblangan")) or now, now)
        # tekshiruv oynasi: dayStart'dagi birinchi sync tungi to'lovlarni olishga ulgursin
        tek_bosh = ds + _OPLATYKV_KECHIKISH_MIN
        oyna_ichida = kun0 + timedelta(minutes=tek_bosh) <= now < kun0 + timedelta(minutes=de)
        kechikish: Optional[float] = None   # oyna ichida None -> eng_eski noma'lum (eski xulq: warn)
        if not oyna_ichida:
            izoh = "tekshiruv oynasi %s-%s dan tashqari (backend sync %s-%s), kechikish baholanmadi" % (
                _hhmm(tek_bosh), _hhmm(de), _hhmm(ds), _hhmm(de))
        elif eng_eski is not None:
            boshi = _okv_kutish_boshi(eng_eski, kun_bosh, _okv_daq(sozlama, "oplatykv.nightStart"), interval)
            kechikish = (kuzatildi - boshi).total_seconds() / 60.0
            if interval <= 0:
                izoh = "kunduzgi sync o'chiq, tungi batch kutiladi"
        if oyna_ichida and (kechikish is None or kechikish > chegara):
            st = "warn"
            qachon = ", eng eskisi %s" % config.fmt_local(eng_eski) if eng_eski else ""
            if kechikish is not None:
                qachon += ", backend sync jadvalidan %d daq kechikkan" % round(kechikish)
            msgs.append("%d ta CLIENT to'lov oplata_kv ga tushmagan (3 kun)%s" % (round(n), qachon))
    # 2026-10-07: sync yoza olmagan to'lovlar — sababi bilan (bitta buzuq to'lov endi boshqalarini to'smaydi)
    xat = _find_key(sec, "sync_xatolar")
    if isinstance(xat, dict) and (_num(xat.get("soni")) or 0) > 0:
        st = "warn"
        namuna = "; ".join("%s (%s): %s" % (x.get("tx") or "-", x.get("shartnoma") or "-", x.get("sabab") or "-")
                           for x in (xat.get("namunalar") or [])[:3] if isinstance(x, dict))
        msgs.append("sync %d ta to'lovni yoza olmadi%s — %s" % (
            round(_num(xat.get("soni")) or 0), (" (%s)" % xat["vaqt"]) if xat.get("vaqt") else "", namuna or "sabab yo'q"))
    # egasi qarori 2026-09-30: kelajak updated_at yolg'iz warn bermaydi, soni info bo'lib qoladi
    jim_izoh = ""
    if kelajak and kelajak > 0:
        jim_izoh = "; kelajak updated_at: %d (ogohlantirish jim)" % round(kelajak)
    if not msgs:
        return "ok", "oplatykv_sync: tushmagan %d, %s%s" % (round(n), izoh, jim_izoh), None
    return st, "oplatykv_sync: " + "; ".join(msgs) + jim_izoh, None


def _check_agents() -> Tuple[str, str, Optional[dict]]:
    start, _end = config.local_day_bounds_utc(config.today_local())
    rows = db.fetchall(
        "SELECT status, COUNT(*) AS n FROM " + _T + "agent_runs WHERE ts >= %s GROUP BY status", (start,))
    counts = {str(r["status"]): int(r["n"]) for r in rows}
    jami = sum(counts.values())
    bad = counts.get(C.RUN_TIMEOUT, 0) + counts.get(C.RUN_ERROR, 0)
    limit = counts.get(C.RUN_RATE_LIMITED, 0) + counts.get(C.RUN_CAPPED, 0)
    st = "error" if bad >= _AGENT_BAD_ERROR else "warn" if (bad >= _AGENT_BAD_WARN or limit) else "ok"
    msg = "bugun agent_runs: jami %d, timeout %d, error %d, rate_limited %d, capped %d" % (
        jami, counts.get(C.RUN_TIMEOUT, 0), counts.get(C.RUN_ERROR, 0),
        counts.get(C.RUN_RATE_LIMITED, 0), counts.get(C.RUN_CAPPED, 0))
    return st, msg, counts or None


CHECKS: List[Tuple[str, CheckFn]] = [
    ("services", _check_services),
    ("db", _check_db),
    ("disk", _check_disk),
    ("facts", _check_facts),
    ("leader_bot", _check_leader_bot),
    ("deploy", _check_deploy),
    ("bank_sync", _check_bank_sync),
    ("sverka", _check_sverka),
    ("xonpay", _check_xonpay),
    ("google_export", _check_google_export),
    ("oplatykv_sync", _check_oplatykv_sync),
    ("agents", _check_agents),
]


# ---------------------------------------------------------------------------
# Ishga tushirish, yozish, format
# ---------------------------------------------------------------------------
def _safe_check(name: str, fn: CheckFn) -> CheckResult:
    try:
        st, msg, details = fn()
    except Exception as exc:
        log.warning("tekshiruv %s yiqildi: %s", name, exc.__class__.__name__)
        return CheckResult(name, "unknown", "tekshiruv xato berdi: %s" % _exc_text(exc), None)
    st = st if st in C.CHECK_STATUSES else "unknown"
    return CheckResult(name, st, _clean_msg(msg), details if isinstance(details, dict) else None)


def _record(results: List[CheckResult]) -> None:
    ts = config.now_utc()
    try:
        with db.tx() as cur:
            for r in results:
                det = json.dumps(r.details, ensure_ascii=False, default=str)[:_DETAILS_DB_MAX] if r.details else None
                cur.execute(
                    "INSERT INTO " + _T + "agent_health (ts, component, status, message, details) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (ts, r.component[:64], r.status, r.message, det),
                )
    except Exception as exc:
        log.warning("agent_health yozilmadi: %s", exc.__class__.__name__)


def run_all_checks_once(record: bool = True) -> List[CheckResult]:
    """Hamma tekshiruv (har biri alohida himoyalangan). record -> agents.agent_health."""
    _FACTS_CACHE.clear()
    results = [_safe_check(name, fn) for name, fn in CHECKS]
    if record:
        _record(results)
    return results


def _qator(r: CheckResult) -> str:
    return C.CHECKER_QATOR_TPL.format(komponent=r.component, status=r.status.upper(), xabar=_clean_msg(r.message))


def format_block(results: List[CheckResult]) -> str:
    """=== CHECKER_WORKER OLDINDAN OLINGAN NATIJALAR === ... === TUGADI ==="""
    lines = [C.CHECKER_BLOK_BOSH]
    for r in results:
        lines.append(_qator(r))
        if r.details:
            j = json.dumps(r.details, ensure_ascii=False, default=str).replace("===", "==")
            j = _mask(j)
            if len(j) > C.CHECKER_BATAFSIL_MAX:
                j = j[: C.CHECKER_BATAFSIL_MAX - 3] + "..."
            lines.append(C.CHECKER_BATAFSIL_TPL.format(json=j))
    lines.append(C.CHECKER_BLOK_OXIR)
    return "\n".join(lines)


def _should_alert(component: str, status: str) -> bool:
    """agent_alert_log: shu komponent+status oxirgi 1 soatda yo'q bo'lsa True. DB yo'q -> jarayon xotirasi."""
    since = config.now_utc() - timedelta(seconds=C.CHECKER_ALERT_THROTTLE_S)
    try:
        row = db.fetchone(
            "SELECT 1 AS x FROM " + _T + "agent_alert_log WHERE component = %s AND status = %s AND ts > %s LIMIT 1",
            (component, status, since),
        )
        return row is None
    except Exception as exc:
        log.warning("alert throttle DB'siz: %s", exc.__class__.__name__)
        last = _MEM_ALERTS.get((component, status))
        return last is None or time.time() - last > C.CHECKER_ALERT_THROTTLE_S


def _record_alert(component: str, status: str, message: str) -> None:
    _MEM_ALERTS[(component, status)] = time.time()
    try:
        db.execute(
            "INSERT INTO " + _T + "agent_alert_log (ts, component, status, message) VALUES (%s, %s, %s, %s)",
            (config.now_utc(), component[:64], status, (message or "")[:1000]),
        )
    except Exception as exc:
        log.warning("agent_alert_log yozilmadi: %s", exc.__class__.__name__)


def _ask_claude(result: CheckResult) -> "runner.AgentResult":
    """Alert rejimi: bitta komponent JSON fence ichida (data, ko'rsatma emas)."""
    details: Any = result.details
    if details is not None:
        dj = json.dumps(details, ensure_ascii=False, default=str)
        if len(dj) > _ALERT_DETAILS_MAX:
            details = {"qisqa": dj[:_ALERT_DETAILS_MAX]}
    data = {
        "component": result.component,
        "status": result.status,
        "message": result.message,
        "details": details,
        "tekshirilgan": config.fmt_local(config.now_utc()),
    }
    j = _mask(json.dumps(data, ensure_ascii=False, indent=1, default=str)).replace("```", "'''")
    body = C.CHECKER_ALERT_OGOHLANTIRISH + "\n" + "```json\n" + j + "\n```" + "\n" + _ALERT_KORSATMA
    task = history.build_sub_task(body)
    return runner.run_agent("checker", task, {"source": "checker", "complexity": "simple"})


def _spawn(coro: Awaitable[Any]) -> None:
    task = asyncio.ensure_future(coro)
    _BG_TASKS.add(task)

    def _done(t: "asyncio.Task[Any]") -> None:
        _BG_TASKS.discard(t)
        if not t.cancelled() and t.exception() is not None:
            log.error("fon vazifa xatosi: %s", t.exception().__class__.__name__)

    task.add_done_callback(_done)


def _add_system(inner: str) -> None:
    try:
        history.add_system(inner)
    except Exception as exc:
        log.warning("SISTEMA yozilmadi: %s", exc.__class__.__name__)


def jim_komponentlar() -> Tuple[str, ...]:
    """Telegram ogohlantirishi o'chirilgan komponentlar (C.CHECKER_JIM_ENV; env yo'q -> default)."""
    if config.env_source(C.CHECKER_JIM_ENV) == "none":
        return C.CHECKER_JIM_DEFAULT
    return tuple(x.strip().lower() for x in config.env(C.CHECKER_JIM_ENV, "").split(",") if x.strip())


async def checker_tick(outbox: "notify.Outbox", on_teacher_lines: TeacherLinesCb) -> None:
    """Tekshiruv -> eng jiddiy throttle'dan o'tgan muammo -> bitta LLM tahlili -> egasiga.
    Jim komponentlar (jim_komponentlar) tekshiriladi va yoziladi, lekin egasiga ogohlantirish bo'lmaydi."""
    results = await asyncio.to_thread(run_all_checks_once)
    jim = set(jim_komponentlar())
    problems = [r for r in results if r.status in ("warn", "error") and r.component.lower() not in jim]
    if not problems:
        log.info("checker: muammo yo'q (%d tekshiruv; jim: %s)", len(results), ", ".join(sorted(jim)) or "-")
        return
    problems.sort(key=lambda r: -C.CHECK_SEVERITY.get(r.status, 0))
    target: Optional[CheckResult] = None
    for r in problems:
        if await asyncio.to_thread(_should_alert, r.component, r.status):
            target = r
            break
    if target is None:
        log.info("checker: %d muammo, hammasi throttle ichida", len(problems))
        return

    res = await asyncio.to_thread(_ask_claude, target)
    lines: List[Tuple[str, str]] = []
    text = ""
    if res.ok:
        rest, blocks = memory_blocks.extract_write_blocks(res.text)
        if blocks:
            _add_system(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_EMAS_TPL.format(agent="checker")))
        rest, lines = memory_blocks.extract_teacher_lines(rest)
        text = rest.strip()
    else:
        _add_system(runner.sistema_for(res))
    if not text:
        sabab = _BOSH_JAVOB if res.ok else (res.error or res.status)
        text = _ALERT_FALLBACK_TPL.format(qator=_qator(target), sabab=_clean_msg(sabab, 160))
    others = [r for r in problems if r is not target]
    if others:
        text += "\n\n" + _BOSHQA_TPL.format(
            royxat=", ".join("%s (%s)" % (r.component, r.status.upper()) for r in others))
    text = leader_logic.normalize_latin(text)

    mid = await outbox.send_text(text, html=False)
    if mid is not None:
        await asyncio.to_thread(_record_alert, target.component, target.status, text)
        try:
            await asyncio.to_thread(history.add_history, C.ROLE_LEADER, text)
        except Exception as exc:
            log.warning("tarixga yozilmadi: %s", exc.__class__.__name__)
    else:
        log.warning("checker alert yuborilmadi (%s)", target.component)
    if lines:
        _spawn(on_teacher_lines("checker", lines))


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------
def _lease_owner(prefix: str = "") -> str:
    return "%s%s:%d" % (prefix, socket.gethostname(), os.getpid())


def _seconds_until_due() -> float:
    last: Optional[datetime] = None
    try:
        raw = db.kv_get(C.KV_CHECKER_LAST)
        last = config.parse_iso(raw) if raw else None
    except Exception as exc:
        log.warning("checker:last_full_run o'qilmadi: %s", exc.__class__.__name__)
        last = _MEM_LAST_RUN
    if last is None:
        return 0.0
    elapsed = (config.now_utc() - last).total_seconds()
    if elapsed < 0:  # soat farqi: kelajakdagi qiymatga ishonilmaydi
        return 0.0
    return max(0.0, C.CHECKER_INTERVAL_S - elapsed)


def _lease_acquire(owner: str) -> bool:
    try:
        return bool(db.kv_lease_acquire(C.KV_CHECKER_LEASE, owner, _LEASE_TTL_S))
    except Exception as exc:  # DB yo'q: bitta bot jarayoni, xotiradagi throttle bilan davom
        log.warning("checker lease DB'siz: %s", exc.__class__.__name__)
        return True


def _mark_done(owner: str) -> None:
    global _MEM_LAST_RUN
    _MEM_LAST_RUN = config.now_utc()
    try:
        db.kv_set(C.KV_CHECKER_LAST, config.iso_utc(_MEM_LAST_RUN))
        db.kv_lease_release(C.KV_CHECKER_LEASE, owner)
    except Exception as exc:
        log.warning("checker holati saqlanmadi: %s", exc.__class__.__name__)


async def checker_scheduler(outbox: "notify.Outbox", on_teacher_lines: TeacherLinesCb) -> None:
    """Start 45 s, keyin har 4 soat. Restartda checker:last_full_run bo'yicha qolgan vaqtni kutadi."""
    await asyncio.sleep(C.CHECKER_START_DELAY_S)
    owner = _lease_owner()
    while True:
        try:
            wait = await asyncio.to_thread(_seconds_until_due)
            if wait > 0:
                await asyncio.sleep(min(wait, _MAX_SLEEP_S))
                continue
            if not await asyncio.to_thread(_lease_acquire, owner):
                await asyncio.sleep(_BAND_SLEEP_S)
                continue
            try:
                await checker_tick(outbox, on_teacher_lines)
            finally:
                await asyncio.to_thread(_mark_done, owner)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("checker scheduler xatosi")
            await asyncio.sleep(_XATO_SLEEP_S)


async def _main_alert() -> int:
    outbox = notify.get_outbox()
    owner = _lease_owner("manual:")

    async def on_lines(agent: str, lines: List[Tuple[str, str]]) -> None:
        for tur, matn in lines:
            await memory_blocks.teacher_fon(agent, tur, matn, outbox)

    if not await asyncio.to_thread(_lease_acquire, owner):
        print("checker band: boshqa jarayon tekshiruv qilyapti")
        return 1
    try:
        await checker_tick(outbox, on_lines)
        if _BG_TASKS:
            await asyncio.gather(*list(_BG_TASKS), return_exceptions=True)
    finally:
        await asyncio.to_thread(_mark_done, owner)
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    config.configure_logging()
    ap = argparse.ArgumentParser(prog="python3 -m agents.checker_worker")
    ap.add_argument("--alert", action="store_true", help="to'liq tick: LLM tahlili va Telegram")
    ap.add_argument("--record", action="store_true", help="natijani agent_health ga ham yozish")
    args = ap.parse_args(argv)
    if not args.alert:
        print(format_block(run_all_checks_once(record=args.record)))
        return 0
    runner.require_cli_mode()
    try:
        return asyncio.run(_main_alert())
    except db.DbUnavailable as exc:
        print("DB ishlamayapti: %s" % C.short(str(exc), 200))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
