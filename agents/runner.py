"""Runner: agentni Claude Code CLI subprocess orqali chaqiradi (KOD 2, 8#1-2).

Egasi qoidasi (serverda sinalgan, qat'iy):
- Claude faqat `claude --print` CLI orqali. Anthropic SDK/API yo'li YO'Q (KOD 2.6).
- Env NOLDAN oq ro'yxat bilan quriladi: PATH HOME LANG LC_ALL TZ USER +
  CLAUDE_CODE_OAUTH_TOKEN (= ANTHROPIC_SETUP_TOKEN) + ixtiyoriy ANTHROPIC_BASE_URL.
  ANTHROPIC_API_KEY hech qachon berilmaydi (ikki auth CLI'ni 60-180 s osiltiradi).
- stdin=DEVNULL, stderr=STDOUT (alohida pipe CLI'ni osiltiradi), encoding utf-8 replace.
- HOME albatta bor (agent foydalanuvchisi bo'lsa uning uy papkasi: ~/.claude shu yerda).
- Timeout 180 s (AGENT_TIMEOUT_S, AGENT_TIMEOUT_S_<AGENT>). Timeout'da jarayon guruhi o'ldiriladi.

Bypass rejimida settings 'allow' cheklamaydi. Himoya: --disallowedTools (KOD 2.3 aynan),
--tools oq ro'yxati (bor bo'lsa), agents/claude_settings.json deny + PreToolUse hook (bash_guard.py),
alohida imtiyozsiz OS foydalanuvchisi (AGENT_OS_USER).

Qo'lda sinash (serverda, README 9-qadam):
  python3 -m agents.runner --probe
  python3 -m agents.runner support "git log -3 ni ishga tushir"
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import functools
import getpass
import logging
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, NamedTuple, Optional, Tuple, TypeVar

from . import config
from . import contract as C

log = logging.getLogger("agents.runner")

DEFAULT_PATH = "/usr/local/bin:/usr/bin:/bin"
DEFAULT_LANG = "C.UTF-8"
DEFAULT_TZ = "Asia/Tashkent"
MODEL_RE = re.compile(r"^[A-Za-z0-9.\-\[\]_]+$")

PREVIEW_MAX = 500
GIT_LOG_TIMEOUT_S = 20
COMMITS_CACHE_S = 60
PROBE_TIMEOUT_S = 30
PROBE_RETRY_S = 60
KILL_GRACE_S = 5
STALE_PROMPT_S = 3600
MIN_TIMEOUT_S = 10

# Uzun bloklovchi ish (CLI, tsc/push, Facts) uchun alohida cheklangan pool. asyncio default pool'i
# (1-2 vCPU'da 5-6 thread) qisqa kv/history chaqiruvlariga qoladi: uzun ish ularni to'sib qo'ymaydi.
# 6 = eng yomon holat: CLI <= 4 (owner, fon, checker, teacher_daily qulf bilan bittadan) + tsc + Facts.
LONG_WORKERS = 6
LONG_THREAD_PREFIX = "agents-long"

TASK_CUT_MARKER = "\n...(kesildi)...\n"
SP_CUT_MARKER = "\n...(kesildi)"
HEAD_CUT_MARKER = "\n(... oxiri kesildi)"
TAIL_CUT_MARKER = "(... boshi kesildi)\n"

# --tools oq ro'yxati (hamma agentga Read Grep Glob; Bash faqat DISALLOWED_TOOLS da yo'q bo'lsa)
BASE_TOOLS: Tuple[str, ...] = ("Read", "Grep", "Glob")

# Kunlik chegarada sanalmaydigan statuslar (CLI chaqirilmagan)
UNCOUNTED_STATUSES: Tuple[str, ...] = (C.RUN_DISABLED, C.RUN_CAPPED, C.RUN_RATE_LIMITED, C.RUN_BAD_NAME)

# XATOGA UCHRADI <xato> erkin qismi (KOD 2.2 dagilari contract'da: XATO_TIMEOUT_TPL, XATO_EXIT_TPL, ...)
XATO_USE_CLI = "AGENTS_USE_CLI=1 emas"
XATO_TOKEN_YOQ = "ANTHROPIC_SETUP_TOKEN yo'q"
XATO_OS_USER = "AGENT_OS_USER topilmadi"
XATO_SUDO = "sudo ruxsati yo'q (sudoers)"
XATO_ISHGA_TUSHMADI = "CLI ishga tushmadi"
XATO_SETTINGS = "sozlama fayli qo'llanmadi (--settings), himoyasiz ishga tushirilmadi"

_SUDO_ERR_RE = re.compile(
    r"(?im)^sudo: .*(password is required|terminal is required|not in the sudoers|not allowed)"
    r"|^Sorry, user .* is not allowed"
)
_CMD_NOT_FOUND_RE = re.compile(r"(?im)^sudo: .*command not found")


# ---------------------------------------------------------------------------
# Natija
# ---------------------------------------------------------------------------
@dataclass
class AgentResult:
    agent: str
    status: str                 # C.RUN_*
    text: str = ""              # ok: stdout.strip()
    error: str = ""             # SISTEMA <xato>/<sabab> uchun qisqa matn (<=500)
    model: str = ""
    returncode: Optional[int] = None
    duration_ms: int = 0
    timeout_s: int = 0
    run_id: Optional[int] = None

    @property
    def ok(self) -> bool:
        return self.status == C.RUN_OK


# ---------------------------------------------------------------------------
# Kichik yordamchilar
# ---------------------------------------------------------------------------
_warned: set = set()
_warn_lock = threading.Lock()


def _warn_once(key: str, msg: str) -> None:
    with _warn_lock:
        if key in _warned:
            return
        _warned.add(key)
    log.warning(msg)


def _mask(text: str) -> str:
    """Log va DB uchun: token/parol ko'rinishidagi qiymatlarni yashiradi."""
    out = text or ""
    try:
        s = config.get_settings()
        for secret in (s.setup_token, s.bot_token):
            if secret and len(secret) >= 8:
                out = out.replace(secret, "***")
    except Exception:  # noqa: BLE001 - maskalash hech qachon yiqitmasin
        pass
    for pat in C.SIR_NAQSHLARI:
        out = pat.sub("***", out)
    return out


def _is_root() -> bool:
    return hasattr(os, "geteuid") and os.geteuid() == 0


def _getpwnam(name: str) -> Any:
    try:
        import pwd  # POSIX
    except ImportError:
        return None
    try:
        return pwd.getpwnam(name)
    except KeyError:
        return None


def _current_user() -> str:
    try:
        import pwd
        return pwd.getpwuid(os.geteuid()).pw_name
    except Exception:  # noqa: BLE001 - Windows yoki pwd yo'q
        try:
            return getpass.getuser()
        except Exception:  # noqa: BLE001
            return ""


def _home_of(user: Optional[str]) -> Optional[str]:
    if not user:
        return None
    pw = _getpwnam(user)
    return pw.pw_dir if pw else None


def _read_text(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return None
    except OSError as exc:
        log.warning("fayl o'qilmadi %s: %s", path, exc.__class__.__name__)
        return None


def _valid_agent_name(agent: Any) -> bool:
    return (
        isinstance(agent, str)
        and bool(C.AGENT_NAME_RE.match(agent))
        and "/" not in agent and "\\" not in agent and ".." not in agent
    )


# ---------------------------------------------------------------------------
# KOD 2.6 va 2.3
# ---------------------------------------------------------------------------
def require_cli_mode() -> None:
    """AGENTS_USE_CLI != '1' -> sababni logga yozib to'xtaydi (SDK yo'li yo'q)."""
    if not config.get_settings().use_cli:
        log.error("AGENTS_USE_CLI=1 emas: runner faqat Claude Code CLI bilan ishlaydi "
                  "(SDK yo'lida asbob, Facts va xotira yo'q). To'xtayapman.")
        raise SystemExit(2)


def agent_disallowed_tools(agent: str) -> str:
    """KOD 2.3 aynan. Noma'lum agent -> eng qattiq (leader) ro'yxati."""
    return C.DISALLOWED_TOOLS.get(agent) or C.DISALLOWED_TOOLS["leader"]


def agent_tools(agent: str, disallowed: Optional[str] = None) -> str:
    """--tools oq ro'yxati: Read,Grep,Glob (+Bash, agar taqiqlanmagan bo'lsa)."""
    banned = set((disallowed if disallowed is not None else agent_disallowed_tools(agent)).split())
    tools = [t for t in BASE_TOOLS if t not in banned]
    if "Bash" not in banned:
        tools.append("Bash")
    return ",".join(tools)


def pick_model(context: Optional[Mapping[str, Any]]) -> str:
    """KOD 2.6: context.model ('sonnet'|'opus'|to'liq ID) yoki complexity='simple' -> tez, default kuchli."""
    s = config.get_settings()
    ctx = context or {}
    model = str(ctx.get("model") or "").strip()
    if model:
        low = model.lower()
        if low == "sonnet":
            return s.model_fast
        if low == "opus":
            return s.model_strong
        if MODEL_RE.match(model):
            return model
        log.warning("context.model yaroqsiz, e'tiborsiz qoldirildi")
    if str(ctx.get("complexity") or "").strip().lower() == "simple":
        return s.model_fast
    return s.model_strong


# ---------------------------------------------------------------------------
# KOD 2.4: env oq ro'yxati
# ---------------------------------------------------------------------------
def _allowed_env_keys() -> set:
    return set(C.AGENT_ENV_OS_KEYS) | {C.AGENT_ENV_TOKEN_KEY} | set(C.AGENT_ENV_OPTIONAL_KEYS)


def build_agent_env(source: Mapping[str, str], *, setup_token: str, agent_user: Optional[str] = None,
                    agent_home: Optional[str] = None, base_url: str = "") -> Dict[str, str]:
    """Agent jarayoni env'i NOLDAN. Manbadan faqat PATH HOME LANG LC_ALL TZ USER olinadi."""
    env: Dict[str, str] = {}
    env["PATH"] = source.get("PATH") or DEFAULT_PATH
    home = agent_home or _home_of(agent_user) or source.get("HOME") or os.path.expanduser("~")
    if home:
        env["HOME"] = home
    env["LANG"] = source.get("LANG") or DEFAULT_LANG
    if source.get("LC_ALL"):
        env["LC_ALL"] = source["LC_ALL"]
    env["TZ"] = source.get("TZ") or DEFAULT_TZ
    user = agent_user or source.get("USER") or _current_user()
    if user:
        env["USER"] = user
    if setup_token:
        env[C.AGENT_ENV_TOKEN_KEY] = setup_token
    if base_url:
        env["ANTHROPIC_BASE_URL"] = base_url
    allowed = _allowed_env_keys()
    for key in list(env):
        if key not in allowed or key in C.AGENT_ENV_FORBIDDEN:
            del env[key]
    return env


def _extend_path(env: Dict[str, str], claude_cmd: str) -> None:
    """CLAUDE_CMD absolyut bo'lsa uning papkasi PATH boshiga (npm/nvm: node shebang uchun)."""
    if not os.path.isabs(claude_cmd):
        return
    folder = os.path.dirname(claude_cmd)
    parts = env.get("PATH", "").split(os.pathsep)
    if folder and folder not in parts:
        env["PATH"] = os.pathsep.join([folder] + [p for p in parts if p])


# ---------------------------------------------------------------------------
# KOD 2.5: memory inject
# ---------------------------------------------------------------------------
def _cut(text: str, limit: int, part: str, label: str) -> str:
    if len(text) <= limit:
        return text
    log.warning("memory inject: %s %d belgidan uzun (%d), %s %d belgi olindi",
                label, limit, len(text), "oxirgi" if part == "tail" else "bosh", limit)
    if part == "tail":
        return TAIL_CUT_MARKER + text[-limit:]
    return text[:limit] + HEAD_CUT_MARKER


_commits_cache: Dict[str, Tuple[float, str]] = {}
_commits_lock = threading.Lock()


def _neutralize_commits(text: str) -> str:
    """Commit sarlavhasi tashqi matn: soxta [SISTEMA va === blok belgilarini buzadi."""
    text = C.SISTEMA_FAKE_RE.sub("(SISTEMA", text)
    return text.replace("===", "= = =")


def recent_commits(*, repo: Optional[Path] = None) -> str:
    """git log --since=7.days (GIT_LOG_ARGS), 4000 belgi. Xatoda '(git log olinmadi)'."""
    base = Path(repo or config.REPO)
    key = str(base)
    now = time.monotonic()
    with _commits_lock:
        hit = _commits_cache.get(key)
        if hit and now - hit[0] < COMMITS_CACHE_S:
            return hit[1]
    env = dict(os.environ)
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_PAGER": "cat", "PAGER": "cat"})
    try:
        proc = subprocess.run(
            ["git"] + list(C.GIT_LOG_ARGS), cwd=str(base), env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", errors="replace", timeout=GIT_LOG_TIMEOUT_S,
        )
        ok = proc.returncode == 0
        raw = (proc.stdout or "").strip()
    except (OSError, subprocess.SubprocessError) as exc:
        log.warning("git log olinmadi: %s", exc.__class__.__name__)
        ok, raw = False, ""
    if not ok:
        text = "(git log olinmadi)"
    elif not raw:
        text = "(oxirgi 7 kunda commit yo'q)"
    else:
        text = _neutralize_commits(raw)
        if len(text) > C.GIT_LOG_LIMIT:
            cut = text[: C.GIT_LOG_LIMIT]
            nl = cut.rfind("\n")
            text = (cut[:nl] if nl > 0 else cut) + HEAD_CUT_MARKER
    with _commits_lock:
        _commits_cache[key] = (now, text)
    return text


def load_memory_block(agent: str, *, repo: Optional[Path] = None) -> str:
    """MAJBURIY blok (INDEX, leader, leader-runtime, learned, <agent>) + alohida OXIRGI COMMITLAR bloki."""
    base = Path(repo or config.REPO)
    files: List[Tuple[str, int, str]] = list(C.MEMORY_FILES)
    if agent != "leader" and _valid_agent_name(agent):
        files.append((C.AGENT_MEMORY_TPL.format(agent=agent), C.AGENT_MEMORY_LIMIT, "head"))
    lines: List[str] = [C.MAJBURIY_BOSH]
    for rel, limit, part in files:
        text = _read_text(base / rel)
        if text is None or not text.strip():
            continue
        lines.append(C.MEMORY_FAYL_BOSH_TPL.format(path=rel))
        lines.append(_cut(text, limit, part, rel).rstrip("\n"))
    lines.append(C.MEMORY_TUGADI)
    lines.append("")
    lines.append(C.COMMITLAR_BOSH)
    lines.append(recent_commits(repo=base))
    lines.append(C.COMMITLAR_TUGADI)
    return "\n".join(lines)


def build_system_prompt(agent: str, *, repo: Optional[Path] = None) -> Optional[str]:
    """agents/<agent>.md + memory. None = prompt fayl yo'q (yoki nom yaroqsiz)."""
    if not _valid_agent_name(agent):
        return None
    base = Path(repo or config.REPO)
    prompt = _read_text(base / "agents" / (agent + ".md"))
    if prompt is None or not prompt.strip():
        return None
    return prompt.rstrip("\n") + "\n\n" + load_memory_block(agent, repo=base)


# ---------------------------------------------------------------------------
# OS foydalanuvchisi (KOD 2.3 oxiri)
# ---------------------------------------------------------------------------
class LaunchSpec(NamedTuple):
    prefix: List[str]          # sudo prefiksi yoki []
    popen_kw: Dict[str, Any]   # root bo'lsa user/group/extra_groups
    user: Optional[str]
    home: Optional[str]
    error: str                 # bo'sh bo'lmasa CLI chaqirilmaydi


def _launch_spec(s: config.Settings, *, for_probe: bool = False) -> LaunchSpec:
    name = s.agent_os_user
    root = _is_root()
    if not name:
        _warn_once("no_os_user", "AGENT_OS_USER bo'sh: agent CLI bot foydalanuvchisi ostida ishlaydi "
                                 "(tavsiya: alohida imtiyozsiz foydalanuvchi)")
        if root and not for_probe:
            return LaunchSpec([], {}, None, None, C.XATO_ROOT_BYPASS)
        return LaunchSpec([], {}, None, None, "")
    pw = _getpwnam(name)
    if root:
        if pw is None:
            return LaunchSpec([], {}, None, None, XATO_OS_USER)
        if pw.pw_uid == 0 and not for_probe:
            return LaunchSpec([], {}, None, None, C.XATO_ROOT_BYPASS)
        kw = {"user": pw.pw_uid, "group": pw.pw_gid, "extra_groups": []}
        return LaunchSpec([], kw, name, pw.pw_dir, "")
    if name == _current_user():
        return LaunchSpec([], {}, name, pw.pw_dir if pw else None, "")
    if os.name != "posix":
        return LaunchSpec([], {}, None, None, XATO_OS_USER)
    # env oq ro'yxati sudoers env_keep orqali o'tadi (ORNATISH.md); token argv'ga tushmaydi
    return LaunchSpec(["sudo", "-n", "-H", "-u", name, "--"], {}, name, pw.pw_dir if pw else None, "")


# ---------------------------------------------------------------------------
# CLI probe (API chaqirmaydi): yo'q fayl bilan flag tanilishini tekshiradi
# ---------------------------------------------------------------------------
_probe_lock = threading.Lock()
_probe_cache: Optional[Dict[str, bool]] = None
_probe_at = 0.0


def _cleanup_stale_prompts() -> None:
    try:
        now = time.time()
        for p in config.CLI_TMP_DIR.glob("sp_*.md"):
            try:
                if now - p.stat().st_mtime > STALE_PROMPT_S:
                    p.unlink()
            except OSError:
                pass
    except OSError:
        pass


def _do_probe() -> Dict[str, bool]:
    s = config.get_settings()
    res = {"found": False, "append_file": False, "settings": False, "no_session": False,
           "tools": False, "strict_mcp": False}
    spec = _launch_spec(s, for_probe=True)
    if spec.error:
        log.error("claude CLI probe: %s", spec.error)
        return res
    env = build_agent_env(os.environ, setup_token="", agent_user=spec.user, agent_home=spec.home)
    _extend_path(env, s.claude_cmd)
    missing = str(config.CLI_TMP_DIR / ("probe_yoq_" + secrets.token_hex(6) + ".json"))
    kw: Dict[str, Any] = dict(
        cwd=str(config.REPO), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", timeout=PROBE_TIMEOUT_S,
    )
    kw.update(spec.popen_kw)

    def run(args: List[str]) -> Tuple[Optional[int], str]:
        try:
            proc = subprocess.run(spec.prefix + [s.claude_cmd] + args, **kw)
            return proc.returncode, proc.stdout or ""
        except subprocess.TimeoutExpired:
            return None, "timeout"
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            return None, exc.__class__.__name__

    rc, out = run(["--version"])
    if rc != 0:
        log.error("claude CLI topilmadi yoki ishlamadi (CLAUDE_CMD=%s): %s", s.claude_cmd, _mask(out)[:300])
        return res
    res["found"] = True
    version = (out.strip().splitlines() or ["?"])[0][:80]

    def known(args: List[str]) -> bool:
        code, text = run(["--print"] + args + ["--", "x"])
        return code is not None and "unknown option" not in text.lower()

    res["settings"] = known(["--settings", missing])
    res["append_file"] = known(["--append-system-prompt-file", missing])
    guard: Optional[List[str]] = None
    if res["settings"]:
        guard = ["--settings", missing]
    elif res["append_file"]:
        guard = ["--append-system-prompt-file", missing]
    if guard:  # guard yo'q faylga ishora qiladi: CLI API'ga bormay to'xtaydi
        res["no_session"] = known(["--no-session-persistence"] + guard)
        res["tools"] = known(["--tools", ",".join(BASE_TOOLS)] + guard)
        res["strict_mcp"] = known(["--strict-mcp-config"] + guard)
    log.info("claude CLI %s: settings=%s append_file=%s no_session=%s tools=%s strict_mcp=%s user=%s",
             version, res["settings"], res["append_file"], res["no_session"], res["tools"],
             res["strict_mcp"], spec.user or _current_user())
    if not res["settings"]:
        log.error("claude CLI --settings flagini bilmaydi: bash_guard hook ishlamaydi, Bash hamma agentda yopiladi")
    return res


def probe_cli(force: bool = False) -> Dict[str, bool]:
    """{"found","append_file","settings","no_session", +"tools","strict_mcp"}; keshlangan.

    CLI topilmagan natija keshda PROBE_RETRY_S turadi, keyin qayta tekshiriladi.
    """
    global _probe_cache, _probe_at
    with _probe_lock:
        now = time.monotonic()
        if not force and _probe_cache is not None:
            if _probe_cache.get("found") or now - _probe_at < PROBE_RETRY_S:
                return dict(_probe_cache)
        try:
            os.makedirs(config.CLI_TMP_DIR, exist_ok=True)
        except OSError:
            pass
        _cleanup_stale_prompts()
        _probe_cache = _do_probe()
        _probe_at = now
        return dict(_probe_cache)


# ---------------------------------------------------------------------------
# Buyruq
# ---------------------------------------------------------------------------
def _cut_bytes_head(text: str, limit: int) -> str:
    return text.encode("utf-8")[: max(0, limit)].decode("utf-8", "ignore")


def _cut_bytes_tail(text: str, limit: int) -> str:
    if limit <= 0:
        return ""
    return text.encode("utf-8")[-limit:].decode("utf-8", "ignore")


def fit_task(task: str) -> str:
    """Linux: bitta argv 128 KB dan oshmasin. Oshsa bosh 40% + belgi + oxir 60%."""
    size = len(task.encode("utf-8"))
    if size <= C.ARGV_MAX_BYTES:
        return task
    budget = C.ARGV_MAX_BYTES - len(TASK_CUT_MARKER.encode("utf-8"))
    log.warning("topshiriq %d bayt, %d baytga qisqartirildi", size, C.ARGV_MAX_BYTES)
    return _cut_bytes_head(task, int(budget * 0.4)) + TASK_CUT_MARKER + _cut_bytes_tail(task, int(budget * 0.6))


def fit_system_prompt(text: str) -> str:
    """argv yo'li: boshidan saqlanadi (agents/<nom>.md butun), memory qismi qisqaradi."""
    size = len(text.encode("utf-8"))
    if size <= C.ARGV_MAX_BYTES:
        return text
    log.warning("system prompt %d bayt (argv), %d baytgacha qisqartirildi", size, C.ARGV_MAX_BYTES)
    return _cut_bytes_head(text, C.ARGV_MAX_BYTES - len(SP_CUT_MARKER.encode("utf-8"))) + SP_CUT_MARKER


def build_cli_cmd(*, claude_cmd: str, model: str, disallowed: str, task: str,
                  settings_file: Optional[str], system_prompt: Optional[str] = None,
                  system_prompt_file: Optional[str] = None, no_session: bool = False,
                  tools: Optional[str] = None, strict_mcp: bool = False) -> List[str]:
    """[claude, --print, --dangerously-skip-permissions, --model, M, --disallowedTools, <BITTA arg>,
    (--tools T), (--settings F), (--append-system-prompt-file F | --append-system-prompt S),
    (--no-session-persistence), (--strict-mcp-config), --, task]. `--` majburiy: '-' bilan
    boshlanadigan topshiriq 'unknown option' bermasin."""
    cmd = [claude_cmd, "--print", "--dangerously-skip-permissions", "--model", model,
           "--disallowedTools", disallowed]
    if tools:
        cmd += ["--tools", tools]
    if settings_file:
        cmd += ["--settings", settings_file]
    if system_prompt_file:
        cmd += ["--append-system-prompt-file", system_prompt_file]
    elif system_prompt:
        cmd += ["--append-system-prompt", fit_system_prompt(system_prompt)]
    if no_session:
        cmd.append("--no-session-persistence")
    if strict_mcp:
        cmd.append("--strict-mcp-config")
    cmd += ["--", fit_task(task)]
    return cmd


def _write_prompt_file(text: str) -> str:
    """System prompt vaqtinchalik faylga (0644, agent foydalanuvchisi o'qiy oladi)."""
    os.makedirs(config.CLI_TMP_DIR, exist_ok=True)
    path = config.CLI_TMP_DIR / ("sp_" + secrets.token_hex(8) + ".md")
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    try:
        os.chmod(str(path), 0o644)
    except OSError:
        pass
    return str(path)


# ---------------------------------------------------------------------------
# Subprocess
# ---------------------------------------------------------------------------
def _kill_group(proc: "subprocess.Popen[str]") -> str:
    """Timeout: jarayon guruhiga SIGTERM (sudo uzatadi), KILL_GRACE_S dan keyin SIGKILL."""
    out: Optional[str] = ""
    try:
        if os.name == "posix":
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                out, _ = proc.communicate(timeout=KILL_GRACE_S)
                return out or ""
            except subprocess.TimeoutExpired:
                pass
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()
        else:
            proc.kill()
        out, _ = proc.communicate(timeout=10)
    except Exception:  # noqa: BLE001 - chiqishni yig'ib bo'lmasa ham davom etamiz
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass
    return out or ""


def _set_rate_limit() -> None:
    try:
        from . import db
        until = config.now_utc() + timedelta(seconds=C.RATE_LIMIT_PAUSE_S)
        db.kv_set(C.KV_RATE_LIMIT, config.iso_utc(until))
        log.warning("rate-limit: agentlar %d s to'xtatildi", C.RATE_LIMIT_PAUSE_S)
    except Exception as exc:  # noqa: BLE001
        log.warning("rate-limit kv yozilmadi (%s)", exc.__class__.__name__)


def _spawn(agent: str, cmd: List[str], env: Dict[str, str], spec: LaunchSpec, res: AgentResult,
           timeout: int) -> Tuple[AgentResult, str]:
    kw: Dict[str, Any] = dict(
        cwd=str(config.REPO), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
    )
    if os.name == "posix":
        kw["start_new_session"] = True  # killpg uchun alohida guruh
    kw.update(spec.popen_kw)
    try:
        proc = subprocess.Popen(spec.prefix + cmd, **kw)
    except FileNotFoundError:
        res.error = C.XATO_CLI_YOQ
        return res, ""
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        res.error = XATO_ISHGA_TUSHMADI
        return res, exc.__class__.__name__ + ": " + _mask(str(exc))[:300]
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        partial = _kill_group(proc)
        res.status = C.RUN_TIMEOUT
        res.error = C.XATO_TIMEOUT_TPL.format(n=timeout)
        res.returncode = proc.returncode
        log.warning("%s agent: timeout %d s", agent, timeout)
        return res, _mask(partial)[-PREVIEW_MAX:]
    out = out or ""
    rc = proc.returncode
    res.returncode = rc
    if rc != 0:
        masked = _mask(out)
        res.status = C.RUN_ERROR
        res.error = C.XATO_EXIT_TPL.format(n=rc)
        if spec.prefix and _SUDO_ERR_RE.search(out):
            res.error = XATO_SUDO
        elif spec.prefix and _CMD_NOT_FOUND_RE.search(out):
            res.error = C.XATO_CLI_YOQ
        log.warning("%s agent: CLI exit %s: %s", agent, rc, masked[:PREVIEW_MAX])
        if C.RATE_LIMIT_RE.search(out):
            _set_rate_limit()
        return res, masked[:PREVIEW_MAX]
    text = out.strip()
    if not text:
        res.status = C.RUN_EMPTY
        return res, ""
    res.status = C.RUN_OK
    res.text = text
    return res, ""


def _timeout_for(agent: str, ctx: Mapping[str, Any]) -> int:
    raw = ctx.get("timeout_s")
    if raw is not None:
        try:
            return max(MIN_TIMEOUT_S, int(raw))
        except (TypeError, ValueError):
            log.warning("context.timeout_s yaroqsiz, e'tiborsiz")
    return config.agent_timeout_s(agent)


def _call_cli(agent: str, task: str, system_prompt: str, model: str, ctx: Mapping[str, Any],
              s: config.Settings) -> Tuple[AgentResult, str]:
    timeout = _timeout_for(agent, ctx)
    res = AgentResult(agent=agent, status=C.RUN_ERROR, model=model, timeout_s=timeout)
    if not s.use_cli:
        res.error = XATO_USE_CLI
        return res, ""
    if not s.setup_token:
        res.error = XATO_TOKEN_YOQ
        return res, ""
    spec = _launch_spec(s)
    if spec.error:
        res.error = spec.error
        return res, ""
    probe = probe_cli()
    disallowed = agent_disallowed_tools(agent)
    # Fail-closed: deny ro'yxati (.env, /proc, ~) va bash_guard hook faqat --settings
    # orqali keladi. Ular qo'llanmasa bypass rejimida agent himoyasiz qoladi — chaqirmaymiz.
    if not (probe.get("settings") and config.SETTINGS_FILE.is_file()):
        _warn_once("no_settings", "sozlama fayli berilmaydi (--settings yo'q yoki fayl yo'q): agent chaqirilmadi")
        res.error = XATO_SETTINGS
        return res, ""
    settings_file: Optional[str] = str(config.SETTINGS_FILE)
    tools = agent_tools(agent, disallowed) if probe.get("tools") else None
    sp_file: Optional[str] = None
    try:
        if probe.get("append_file"):
            try:
                sp_file = _write_prompt_file(system_prompt)
            except OSError as exc:
                log.warning("system prompt fayli yozilmadi (%s), argv ishlatiladi", exc.__class__.__name__)
                sp_file = None
        cmd = build_cli_cmd(
            claude_cmd=s.claude_cmd, model=model, disallowed=disallowed, task=task,
            settings_file=settings_file, system_prompt=None if sp_file else system_prompt,
            system_prompt_file=sp_file, no_session=bool(probe.get("no_session")),
            tools=tools, strict_mcp=bool(probe.get("strict_mcp")),
        )
        env = build_agent_env(os.environ, setup_token=s.setup_token, agent_user=spec.user,
                              agent_home=spec.home, base_url=s.anthropic_base_url)
        _extend_path(env, s.claude_cmd)
        return _spawn(agent, cmd, env, spec, res, timeout)
    finally:
        if sp_file:
            try:
                os.unlink(sp_file)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# KOD 2.1: oldingi tekshiruvlar va agent_runs
# ---------------------------------------------------------------------------
def _precheck(agent: str, s: config.Settings) -> Optional[str]:
    """2-4 qadamlar. DB yo'q bo'lsa o'tkaziladi (ogohlantirish), CLI baribir ishlaydi."""
    try:
        from . import db
    except Exception as exc:  # noqa: BLE001
        log.warning("db moduli yuklanmadi (%s): tekshiruvlar o'tkazildi", exc.__class__.__name__)
        return None
    try:
        enabled = db.kv_get(C.kv_key(C.KV_AGENT_ENABLED, agent=agent))
        if enabled is not None and enabled.strip() == "0":
            return C.RUN_DISABLED
    except Exception as exc:  # noqa: BLE001
        log.warning("agent_enabled tekshirilmadi (%s)", exc.__class__.__name__)
    try:
        start, _end = config.local_day_bounds_utc(config.today_local())
        row = db.fetchone(
            "SELECT count(*) AS n FROM " + C.DB_SCHEMA + ".agent_runs "
            "WHERE agent = %s AND ts >= %s AND status NOT IN (%s, %s, %s, %s)",
            (agent, start) + UNCOUNTED_STATUSES,
        )
        if row is not None and int(row["n"]) >= s.daily_cap:
            return C.RUN_CAPPED
    except Exception as exc:  # noqa: BLE001
        log.warning("kunlik chegara tekshirilmadi (%s)", exc.__class__.__name__)
    try:
        until = config.parse_iso(db.kv_get(C.KV_RATE_LIMIT) or "")
        if until is not None and until > config.now_utc():
            return C.RUN_RATE_LIMITED
    except Exception as exc:  # noqa: BLE001
        log.warning("rate-limit tekshirilmadi (%s)", exc.__class__.__name__)
    return None


def _task_preview(task: str) -> str:
    """Teacher kunlik IN uchun: OXIRGI SUHBAT bloki tashlanadi, sarlavha va topshiriq qoladi."""
    head, sep, rest = task.partition(C.OXIRGI_SUHBAT_BOSH)
    if sep:
        _hist, sep2, body = rest.partition(C.OXIRGI_SUHBAT_OXIR)
        keep = [ln for ln in head.splitlines() if ln.strip() and not ln.startswith("[HOZIRGI VAQT")]
        text = "\n".join(keep + [(body if sep2 else "").strip()])
    else:
        text = task
    return _mask(text.strip())[:PREVIEW_MAX]


def _log_run(res: AgentResult, task: str, source: str, detail: str = "") -> Optional[int]:
    """Har natija agents.agent_runs ga. DB xatosi yutiladi (log)."""
    err = res.error or ""
    if detail:
        err = (err + " | " + detail) if err else detail
    try:
        from . import db
        row = db.fetchone(
            "INSERT INTO " + C.DB_SCHEMA + ".agent_runs "
            "(ts, agent, model, status, source, duration_ms, returncode, task_preview, response_preview, error) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                config.now_utc(), (res.agent or "?")[:32], (res.model or "")[:64] or None, res.status[:24],
                (source or "manual")[:32], int(res.duration_ms), res.returncode, _task_preview(task) or None,
                _mask(res.text)[:PREVIEW_MAX] or None, _mask(err)[:PREVIEW_MAX] or None,
            ),
        )
        return int(row["id"]) if row else None
    except Exception as exc:  # noqa: BLE001
        log.warning("agent_runs yozilmadi (%s)", exc.__class__.__name__)
        return None


def _finish(res: AgentResult, task: str, source: str, t0: float, detail: str = "") -> AgentResult:
    res.duration_ms = int((time.monotonic() - t0) * 1000)
    res.run_id = _log_run(res, task, source, detail)
    log.info("agent=%s status=%s model=%s ms=%d rc=%s run_id=%s%s", res.agent, res.status, res.model,
             res.duration_ms, res.returncode, res.run_id, (" xato=" + res.error) if res.error else "")
    return res


# ---------------------------------------------------------------------------
# Ommaviy API
# ---------------------------------------------------------------------------
def run_agent(agent: str, task: str, context: Optional[Mapping[str, Any]] = None) -> AgentResult:
    """Blocking. context: model, complexity, source, timeout_s (boshqasi e'tiborsiz)."""
    ctx = dict(context or {})
    source = str(ctx.get("source") or "manual")
    t0 = time.monotonic()
    task = "" if task is None else str(task)
    s = config.get_settings()
    # 1. nom
    if not (_valid_agent_name(agent) and agent in C.AGENTS):
        name = C.short(agent if isinstance(agent, str) else repr(agent), 32) or "?"
        return _finish(AgentResult(agent=name, status=C.RUN_BAD_NAME), task, source, t0)
    model = pick_model(ctx)
    # 2-4. o'chirilgan, kunlik chegara, rate-limit
    pre = _precheck(agent, s)
    if pre:
        return _finish(AgentResult(agent=agent, status=pre, model=model), task, source, t0)
    # 5. prompt
    system_prompt = build_system_prompt(agent)
    if system_prompt is None:
        return _finish(AgentResult(agent=agent, status=C.RUN_NO_PROMPT, model=model), task, source, t0)
    # 7-8. CLI
    try:
        res, detail = _call_cli(agent, task, system_prompt, model, ctx, s)
    except Exception as exc:  # noqa: BLE001 - kutilmagan xato ham agent_runs'ga tushsin
        log.exception("%s agent: runner xatosi", agent)
        res = AgentResult(agent=agent, status=C.RUN_ERROR, model=model, error=XATO_ISHGA_TUSHMADI)
        detail = exc.__class__.__name__
    # 9. agent_runs
    return _finish(res, task, source, t0, detail)


_T = TypeVar("_T")
_long_pool: Optional[ThreadPoolExecutor] = None
_long_pool_lock = threading.Lock()


def long_executor() -> ThreadPoolExecutor:
    """Uzun ish pool'i (LONG_WORKERS). Jarayon bo'yi bitta, birinchi chaqiruvda yaratiladi."""
    global _long_pool
    with _long_pool_lock:
        if _long_pool is None:
            _long_pool = ThreadPoolExecutor(max_workers=LONG_WORKERS, thread_name_prefix=LONG_THREAD_PREFIX)
        return _long_pool


async def run_long(func: Callable[..., _T], /, *args: Any, **kwargs: Any) -> _T:
    """asyncio.to_thread o'rniga uzun ish uchun (CLI, apply_plan, Facts): default pool'ni band qilmaydi.
    to_thread kabi contextvars nusxasi uzatiladi. Qisqa kv/history chaqiruvlari to_thread'da qoladi."""
    loop = asyncio.get_running_loop()
    call = functools.partial(contextvars.copy_context().run, func, *args, **kwargs)
    return await loop.run_in_executor(long_executor(), call)


async def run_agent_async(agent: str, task: str, context: Optional[Mapping[str, Any]] = None) -> AgentResult:
    return await run_long(run_agent, agent, task, context)


def sistema_for(res: AgentResult) -> str:
    """SISTEMA ichki matni (KOD 1.4, R2). history.add_system() ga beriladi."""
    agent = res.agent or "?"
    st = res.status
    if st == C.RUN_OK:
        return C.sistema(C.SIS_AGENT_OK, agent=agent, qisqa=C.short(res.text, 200))
    if st == C.RUN_EMPTY:
        return C.sistema(C.SIS_AGENT_BOSH, agent=agent)
    if st in C.RUN_STATUS_TO_CHQ:
        return C.sistema(C.SIS_AGENT_CHAQIRILMADI, agent=agent, sabab=C.RUN_STATUS_TO_CHQ[st])
    return C.sistema(C.SIS_AGENT_XATO, agent=agent, xato=res.error or "noma'lum xato")


# ---------------------------------------------------------------------------
# python3 -m agents.runner
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    config.configure_logging()
    parser = argparse.ArgumentParser(prog="python3 -m agents.runner",
                                     description="Agentni qo'lda chaqirish (README 9-qadam sinovlari)")
    parser.add_argument("--probe", action="store_true", help="CLI flaglari va agent env kalitlari")
    parser.add_argument("--model", default="", help="sonnet | opus | to'liq ID")
    parser.add_argument("agent", nargs="?", help="leader | support | checker | teacher")
    parser.add_argument("task", nargs="?", help="topshiriq matni")
    args = parser.parse_args(argv)
    if args.probe:
        s = config.get_settings()
        print("probe:", probe_cli(force=True))
        spec = _launch_spec(s)
        env = build_agent_env(os.environ, setup_token=s.setup_token, agent_user=spec.user,
                              agent_home=spec.home, base_url=s.anthropic_base_url)
        print("agent foydalanuvchisi:", spec.user or _current_user(), "| xato:", spec.error or "yo'q")
        print("agent env kalitlari:", ", ".join(sorted(env)))
        return 0
    if not args.agent or args.task is None:
        parser.print_usage()
        return 2
    require_cli_mode()
    ctx: Dict[str, Any] = {"source": "manual"}
    if args.model:
        ctx["model"] = args.model
    res = run_agent(args.agent, args.task, ctx)
    print("status:", res.status, "| model:", res.model, "| ms:", res.duration_ms, "| rc:", res.returncode,
          "| run_id:", res.run_id)
    print("SISTEMA:", C.sistema_line(sistema_for(res)))
    if res.text:
        print(res.text)
    return 0 if res.ok else 1


if __name__ == "__main__":
    sys.exit(main())
