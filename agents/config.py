"""Sozlamalar: env o'qish, yo'llar, Toshkent vaqti, repo yo'li tekshiruvi.

- Env: avval os.environ, keyin AGENTS_ENV_FILE (default: <repo>/backend/.env). Fayl oddiy
  parser bilan o'qiladi va os.environ ga YOZILMAYDI: backend sirlari bot jarayoniga ham,
  bola jarayonlarga ham o'tmaydi. Faqat nomi so'ralgan kalit olinadi.
- Sir qiymatlari logga chiqmaydi (Settings.__repr__ maskalaydi).
- Toshkent = UTC+5, yozgi vaqt yo'q: tzdata kerak emas.

Faqat stdlib. Python 3.10+ mos.
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, fields
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import contract as C

# ---------------------------------------------------------------------------
# Yo'llar
# ---------------------------------------------------------------------------
REPO = Path(os.environ.get("AGENTS_REPO") or Path(__file__).resolve().parent.parent).resolve()
AGENTS_DIR = REPO / "agents"
BIN_DIR = AGENTS_DIR / "bin"
BASH_GUARD = BIN_DIR / "bash_guard.py"
STATE_DIR = AGENTS_DIR / "state"
MEMORY_DIR = AGENTS_DIR / "memory"
DAILY_DIR = MEMORY_DIR / "daily"
KNOWLEDGE_DIR = AGENTS_DIR / "knowledge"
UPLOADS_DIR = REPO / "static" / "tg_uploads"
FACTS_PATH = STATE_DIR / "support_facts.json"
DEPLOY_LOG_JSON = STATE_DIR / "deploy_log.json"
SUP_ORIG_DIR = STATE_DIR / "sup_orig"
CLI_TMP_DIR = STATE_DIR / "cli"
TSC_TMP_DIR = STATE_DIR / "tsc"
SETTINGS_FILE = AGENTS_DIR / "claude_settings.json"
INDEX_FILE = MEMORY_DIR / "INDEX.md"
LEARNED_FILE = REPO / C.LEARNED_PATH
RUNTIME_FILE = REPO / C.RUNTIME_PATH

ENV_FILE_DEFAULT = REPO / "backend" / ".env"
BACKEND_ENV_FILE = REPO / "backend" / ".env"
DEPLOY_LOCK_DEFAULT = "/var/run/xon-tranzactions-deploy.lock"
DEPLOY_LOG_DEFAULT = "/var/log/xon-tranzactions/deploy.log"

MODEL_STRONG_DEFAULT = "claude-opus-5-5"
MODEL_FAST_DEFAULT = "claude-sonnet-5"
CLAUDE_CMD_DEFAULT = "claude"

log = logging.getLogger("agents.config")


def rel_to_repo(path: Path | str, repo: Optional[Path] = None) -> str:
    """Repo ildiziga nisbatan posix yo'l."""
    base = Path(repo or REPO).resolve()
    return Path(os.path.relpath(Path(path).resolve(), base)).as_posix()


def ensure_dirs() -> None:
    """Runtime papkalarini yaratadi (idempotent). Yuklamalar papkasi gitdan yashiriladi."""
    for d in (STATE_DIR, CLI_TMP_DIR, SUP_ORIG_DIR, TSC_TMP_DIR, DAILY_DIR, UPLOADS_DIR):
        os.makedirs(d, exist_ok=True)
    ignore = UPLOADS_DIR / ".gitignore"
    if not ignore.exists():
        try:
            ignore.write_text("*\n", encoding="utf-8")
        except OSError as exc:  # faqat ogohlantirish
            log.warning("tg_uploads/.gitignore yozilmadi: %s", exc)


def configure_logging(level: int = logging.INFO) -> None:
    """Bir marta chaqiriladi (bot yoki `python3 -m agents.<modul>` boshida)."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# ---------------------------------------------------------------------------
# Env
# ---------------------------------------------------------------------------
_ENV_LINE_RE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_env_cache: Dict[str, Dict[str, str]] = {}


def parse_env_text(text: str) -> Dict[str, str]:
    """KEY=VALUE qatorlari. # izoh, bo'sh qator, 'export ' prefiksi, '...' va "..." qo'llanadi."""
    out: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _ENV_LINE_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            quote, val = val[0], val[1:-1]
            if quote == '"':
                val = val.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")
        else:
            hash_at = val.find(" #")
            if hash_at >= 0:
                val = val[:hash_at].rstrip()
        out[key] = val
    return out


def env_file_path() -> Path:
    raw = os.environ.get("AGENTS_ENV_FILE", "").strip()
    return Path(raw) if raw else ENV_FILE_DEFAULT


def load_env_file(path: Optional[Path | str] = None) -> Dict[str, str]:
    """Faylni o'qiydi (keshlangan). Yo'q yoki o'qib bo'lmasa bo'sh lug'at."""
    p = str(Path(path) if path else env_file_path())
    if p not in _env_cache:
        try:
            with open(p, encoding="utf-8") as fh:
                _env_cache[p] = parse_env_text(fh.read())
        except OSError as exc:
            log.warning("env fayli o'qilmadi (%s): %s", p, exc.__class__.__name__)
            _env_cache[p] = {}
    return _env_cache[p]


def reload_env() -> None:
    _env_cache.clear()
    get_settings.cache = None  # type: ignore[attr-defined]


def env(name: str, default: str = "") -> str:
    """os.environ ustun, keyin env fayli. Fayl os.environ ni ustiga yozmaydi."""
    if name in os.environ:
        return os.environ[name]
    return load_env_file().get(name, default)


def env_source(name: str) -> str:
    """'os' | 'file' | 'none' (qiymat emas, faqat manba)."""
    if name in os.environ:
        return "os"
    return "file" if name in load_env_file() else "none"


def env_int(name: str, default: int, min_value: Optional[int] = None) -> int:
    raw = env(name, "").strip()
    try:
        value = int(raw) if raw else default
    except ValueError:
        log.warning("%s butun son emas, default %s", name, default)
        value = default
    if min_value is not None and value < min_value:
        value = min_value
    return value


def env_bool(name: str, default: bool = False) -> bool:
    raw = env(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


_PRISMA_ONLY_PARAMS = frozenset({
    "schema", "connection_limit", "pool_timeout", "pgbouncer", "statement_cache_size",
    "socket_timeout", "sslaccept", "sslidentity",
})


def clean_db_url(url: str) -> str:
    """Prisma URL'idan psycopg2 tushunmaydigan parametrlarni (?schema=... va h.k.) olib tashlaydi."""
    url = (url or "").strip().strip('"').strip("'")
    if not url:
        return ""
    parts = urlsplit(url)
    if not parts.query:
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k not in _PRISMA_ONLY_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


def _mask(value: str) -> str:
    return "" if not value else "***(%d)" % len(value)


@dataclass(frozen=True)
class Settings:
    bot_token: str
    owner_id: int
    setup_token: str
    use_cli: bool
    claude_cmd: str
    model_strong: str
    model_fast: str
    daily_cap: int
    timeout_s: int
    agent_os_user: str
    database_url: str
    agents_db_url: str
    facts_db_url: str
    anthropic_base_url: str
    deploy_lock: str
    deploy_log: str
    env_file: str

    _SECRET = ("bot_token", "setup_token", "database_url", "agents_db_url", "facts_db_url")

    def __repr__(self) -> str:  # sir qiymatlari logga chiqmasin
        items = []
        for f in fields(self):
            v = getattr(self, f.name)
            items.append("%s=%s" % (f.name, _mask(v) if f.name in self._SECRET else repr(v)))
        return "Settings(" + ", ".join(items) + ")"

    __str__ = __repr__


def _owner_id() -> int:
    raw = env("LEADER_TG_ID", "").strip()
    if not raw:
        return C.EGASI_TG_ID
    return int(raw) if raw.isdigit() else 0


def get_settings(reload: bool = False) -> Settings:
    """Keshlangan sozlamalar. reload=True env faylini qayta o'qiydi."""
    if reload:
        _env_cache.clear()
        get_settings.cache = None  # type: ignore[attr-defined]
    cached = getattr(get_settings, "cache", None)
    if cached is not None:
        return cached
    database_url = clean_db_url(env("DATABASE_URL"))
    agents_db_url = clean_db_url(env("AGENTS_DB_URL")) or database_url
    facts_db_url = clean_db_url(env("AGENTS_FACTS_DB_URL")) or agents_db_url
    s = Settings(
        bot_token=env("LEADER_BOT_TOKEN").strip(),
        owner_id=_owner_id(),
        setup_token=env("ANTHROPIC_SETUP_TOKEN").strip(),
        use_cli=env("AGENTS_USE_CLI").strip() == "1",
        claude_cmd=env("CLAUDE_CMD").strip() or CLAUDE_CMD_DEFAULT,
        model_strong=env("AGENTS_MODEL_STRONG").strip() or MODEL_STRONG_DEFAULT,
        model_fast=env("AGENTS_MODEL_FAST").strip() or MODEL_FAST_DEFAULT,
        daily_cap=env_int("AGENT_DAILY_CAP", C.AGENT_DAILY_CAP_DEFAULT, min_value=1),
        timeout_s=env_int("AGENT_TIMEOUT_S", C.AGENT_TIMEOUT_DEFAULT_S, min_value=10),
        agent_os_user=env("AGENT_OS_USER").strip(),
        database_url=database_url,
        agents_db_url=agents_db_url,
        facts_db_url=facts_db_url,
        anthropic_base_url=env("ANTHROPIC_BASE_URL").strip(),
        deploy_lock=env("DEPLOY_LOCK").strip() or DEPLOY_LOCK_DEFAULT,
        deploy_log=env("DEPLOY_LOG").strip() or DEPLOY_LOG_DEFAULT,
        env_file=str(env_file_path()),
    )
    get_settings.cache = s  # type: ignore[attr-defined]
    return s


get_settings.cache = None  # type: ignore[attr-defined]


def agent_timeout_s(agent: str) -> int:
    """AGENT_TIMEOUT_S_<AGENT> (ixtiyoriy) -> AGENT_TIMEOUT_S -> 180."""
    base = get_settings().timeout_s
    return env_int("AGENT_TIMEOUT_S_" + agent.upper(), base, min_value=10)


def v1_leader_conflict() -> bool:
    """backend/.env dagi v1 leader shu bot tokeni bilan poll qiladimi (409 va ikki javob)."""
    s = get_settings()
    if not s.bot_token:
        return False
    backend = load_env_file(BACKEND_ENV_FILE)
    v1_token = backend.get("LEADER_BOT_TOKEN", "").strip()
    v1_on = backend.get("LEADER_ENABLED", "").strip() != "0" and bool(backend.get("LEADER_OWNER_TG_IDS", "").strip())
    return bool(v1_on and v1_token and v1_token == s.bot_token)


def config_errors() -> List[str]:
    """Botni to'xtatadigan xatolar (qiymatsiz, faqat nomlar)."""
    s = get_settings()
    errs: List[str] = []
    if not s.bot_token:
        errs.append("LEADER_BOT_TOKEN yo'q")
    if s.owner_id != C.EGASI_TG_ID:
        errs.append("LEADER_TG_ID egasi ID si bilan mos emas")
    if not s.use_cli:
        errs.append("AGENTS_USE_CLI=1 emas (runner faqat Claude Code CLI bilan ishlaydi)")
    if not s.setup_token:
        errs.append("ANTHROPIC_SETUP_TOKEN yo'q")
    return errs


def config_warnings() -> List[str]:
    """Ishlashga to'sqinlik qilmaydigan, lekin xavfli holatlar."""
    s = get_settings()
    warns: List[str] = []
    if not s.agent_os_user:
        warns.append("AGENT_OS_USER bo'sh: agent CLI bot foydalanuvchisi ostida ishlaydi")
    if hasattr(os, "geteuid") and os.geteuid() == 0 and not s.agent_os_user:
        warns.append("bot root ostida va AGENT_OS_USER bo'sh: CLI bypass rejimini rad etadi")
    if v1_leader_conflict():
        warns.append("backend/.env dagi v1 leader ham shu LEADER_BOT_TOKEN bilan poll qiladi (409)")
    if not s.agents_db_url:
        warns.append("DATABASE_URL yo'q: bot jadvallari ishlamaydi")
    if env("ANTHROPIC_API_KEY") and env_source("ANTHROPIC_API_KEY") == "os":
        warns.append("ANTHROPIC_API_KEY bot jarayoni env'ida bor (agentga berilmaydi)")
    return warns


# ---------------------------------------------------------------------------
# Vaqt (Toshkent = UTC+5)
# ---------------------------------------------------------------------------
TZ_LOCAL = timezone(timedelta(hours=5), "Asia/Tashkent")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_local() -> datetime:
    return now_utc().astimezone(TZ_LOCAL)


def today_local() -> date:
    return now_local().date()


def to_utc(dt: datetime) -> datetime:
    """tz'siz qiymat UTC deb olinadi (Prisma DateTime ustunlari)."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def to_local(dt: datetime) -> datetime:
    return to_utc(dt).astimezone(TZ_LOCAL)


def naive_utc(dt: datetime) -> datetime:
    """Prisma tz'siz ustunlari uchun parametr: UTC, tzinfo'siz."""
    return to_utc(dt).replace(tzinfo=None)


def local_day_bounds_utc(d: date) -> Tuple[datetime, datetime]:
    """Toshkent kuni [00:00, ertasi 00:00) UTC da (aware)."""
    start = datetime.combine(d, time(0, 0), TZ_LOCAL).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


def local_window_utc(d: date, h_from: int, h_to: int) -> Tuple[datetime, datetime]:
    """Toshkent kunining [h_from, h_to) soat oynasi UTC da (Teacher oynalari: 0-6, 6-12 ...)."""
    start = datetime.combine(d, time(0, 0), TZ_LOCAL) + timedelta(hours=h_from)
    end = datetime.combine(d, time(0, 0), TZ_LOCAL) + timedelta(hours=h_to)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def fmt_local(dt: Optional[datetime], fmt: str = "%Y-%m-%d %H:%M") -> str:
    return "" if dt is None else to_local(dt).strftime(fmt)


def iso_utc(dt: Optional[datetime] = None) -> str:
    return to_utc(dt or now_utc()).isoformat(timespec="seconds")


def parse_iso(s: str) -> Optional[datetime]:
    """ISO satr -> aware datetime (tz'siz bo'lsa UTC). Xato bo'lsa None."""
    try:
        raw = (s or "").strip().replace("Z", "+00:00")
        return to_utc(datetime.fromisoformat(raw)) if raw else None
    except ValueError:
        return None


def weekday_uz(d: date) -> str:
    return C.HAFTA_KUNLARI[d.weekday()]


def now_line(dt: Optional[datetime] = None) -> str:
    """[HOZIRGI VAQT (Toshkent): YYYY-MM-DD HH:MM — <kun>]"""
    loc = to_local(dt) if dt else now_local()
    return C.HOZIRGI_VAQT_TPL.format(
        shahar=C.SHAHAR, sana=loc.strftime("%Y-%m-%d"), vaqt=loc.strftime("%H:%M"), kun=weekday_uz(loc.date()),
    )


def seconds_until_local(hour: int, minute: int, now: Optional[datetime] = None) -> float:
    """Keyingi mahalliy HH:MM gacha soniya (bugun o'tgan bo'lsa ertaga)."""
    loc = to_local(now) if now else now_local()
    target = loc.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= loc:
        target += timedelta(days=1)
    return (target - loc).total_seconds()


# ---------------------------------------------------------------------------
# Repo yo'li tekshiruvi (Q3 _safe_repo_path). Parse paytida va har yozishdan oldin.
# ---------------------------------------------------------------------------
class SafePath(NamedTuple):
    ok: bool
    reason: Optional[str]  # None | "env" | "himoya" | "yaroqsiz"
    rel: str
    abs: Optional[Path]


def _prefix_hit(rel: str, prefixes: Tuple[str, ...]) -> bool:
    low = rel.lower()
    return any(low == p.lower() or low.startswith(p.lower() + "/") for p in prefixes)


def _components_bad(parts: List[str]) -> Optional[str]:
    for comp in parts:
        low = comp.lower()
        if low.startswith(".env"):
            return "env"
    for comp in parts:
        if comp.lower() in C.HIMOYA_KOMPONENTLAR:
            return "himoya"
    return None


def safe_repo_path(p: str, repo: Optional[Path] = None) -> SafePath:
    """Q3: absolyut, '..', '-' bilan boshlanish, repo tashqarisi, .env*, himoyalangan yo'l -> rad.

    Sabab xaritasi: "env" -> SIS_SUPPORT_ENV; "himoya" va "yaroqsiz" -> RAD_HIMOYA.
    """
    raw = (p or "").strip()
    bad = SafePath(False, "yaroqsiz", raw, None)
    if not raw or "\x00" in raw or "\\" in raw:
        return bad
    raw_parts = raw.split("/")
    parts = [x for x in raw_parts if x not in ("", ".")]
    env_hit = _components_bad(parts)
    if env_hit == "env":
        return SafePath(False, "env", raw, None)
    if raw.startswith(("/", "~", "-")) or re.match(r"^[A-Za-z]:", raw):
        return bad
    if not parts or ".." in raw_parts:
        return bad
    rel = "/".join(parts)
    if env_hit == "himoya" or _prefix_hit(rel, C.HIMOYA_PREFIKSLAR):
        return SafePath(False, "himoya", rel, None)
    base = os.path.realpath(str(repo or REPO))
    target = os.path.realpath(os.path.join(base, rel))
    try:
        if os.path.commonpath([base, target]) != base:
            return SafePath(False, "yaroqsiz", rel, None)
    except ValueError:
        return SafePath(False, "yaroqsiz", rel, None)
    real_rel = Path(os.path.relpath(target, base)).as_posix()
    real_parts = real_rel.split("/")
    hit = _components_bad(real_parts)
    if hit:
        return SafePath(False, hit, rel, None)
    if _prefix_hit(real_rel, C.HIMOYA_PREFIKSLAR):
        return SafePath(False, "himoya", rel, None)
    return SafePath(True, None, rel, Path(target))


def is_sensitive(rel: str) -> bool:
    """KOD 3.4: sezgir fayl (rad emas, risk majburan 'yuqori')."""
    return _prefix_hit(rel, C.SEZGIR_PREFIKSLAR)
