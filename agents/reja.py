"""Support REJA oqimi (KOD 3.1-3.4, Q13, Q14, R4, R5, D6).

Parse -> tekshiruv -> preview + [Ha]/[Yo'q] -> ijro (qulf, xesh, tekshiruv, commit, push) -> qaytarish.

- aiogram import qilinmaydi: Telegram faqat Outbox orqali (notify.py).
- apply_plan sinxron, kv va Telegram'siz: testlar uni tmp git repo'da to'g'ridan chaqiradi.
- Agent QAYTA chaqirilmaydi. Hamma git chaqiruvi ro'yxat argumentlari bilan (shell=False).
- Ijro davomida: asyncio.Lock + kv lease sup_exec_lock + sup_exec_active. Deploy flock faqat
  yozish bosqichida (qayta tekshiruv, os.replace, commit, push): tsc paytida deploy.sh kutmaydi.
- Egasiga boradigan LLM'siz xabarlar tarixga ham yoziladi (KOD 1.5, Q10: agent_chat_log).

Faqat stdlib + agents.*. Python 3.10+ mos.
"""
from __future__ import annotations

import asyncio
import base64
import difflib
import hashlib
import html
import json
import logging
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import time
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set, Tuple, Union

from . import config
from . import contract as C
from . import db
from . import history

if TYPE_CHECKING:  # faqat tip uchun (notify aiogram'siz, lekin runtime bog'liqlik kerak emas)
    from .notify import Outbox

log = logging.getLogger("agents.reja")

# ---------------------------------------------------------------------------
# Ichki doimiylar (shartnoma satrlari contract.py da)
# ---------------------------------------------------------------------------
_APPR_PREFIX = C.KV_SUP_APPR.split("{", 1)[0]   # "sup_appr_"
_RUN_PREFIX = C.KV_SUP_RUN.split("{", 1)[0]     # "sup_run_"
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
_RISK_YUQORI = "yuqori"
assert _RISK_YUQORI in C.RISK_VALUES

_DETAIL_MAX = 1500
_PREVIEW_MAX = 3800          # Telegram 4096; split_text HTML teglarini bo'lmasin
_RENEW_EVERY_S = 60
_REMOTE_TIMEOUT_S = 60
_TIMEOUT_RC = 124
_QAYTARISH_XATO = "QAYTARISH TO'LIQ EMAS"
_QOLDIQ_SUFFIX = ".qoldiq"   # qaytarish xato bo'lsa asl nusxa shu nom bilan qoladi

_TSC_IGNORE_NAMES = ("node_modules", "dist", "uploads")
_TSC_IGNORE_PREFIXES = (".next", ".env")
_TOOL_ENV_KEYS = (
    "PATH", "HOME", "LANG", "LC_ALL", "TZ", "USER",
    "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "PATHEXT", "COMSPEC",
)
_NODE_OPTIONS_DEFAULT = "--max-old-space-size=2048"  # deploy.sh bilan bir xil

# Egasiga boradigan qo'shimcha matnlar (contract.py da yo'q; toza lotin, emoji yo'q)
_MSG_DB_XATO = "Baza bilan aloqa yo'q, reja hal qilinmadi. Birozdan keyin qayta bosing."
_MSG_DEPLOY_KUTISH_TPL = "Deploy ishlayapti, tugashini kutyapman (ko'pi bilan {daq} daqiqa)."
_MSG_QAYTARISH_DIQQAT = "DIQQAT: qaytarish to'liq bo'lmadi, serverda qo'lda tekshiring."
_DIFF_CAPTION_TPL = "REJA to'liq diff: {n} fayl, {m} edit."
_TEKSHIRUV_YOQ = "kerak emas (kod fayli yo'q)"

_QUOTES = "`'\""
_DANGER_NONE_SET = frozenset(C.norm_apostrophe(x).lower() for x in C.DANGER_NONE)

_exec_lock: Optional[asyncio.Lock] = None
_BG_TASKS: Set["asyncio.Task[Any]"] = set()


# ---------------------------------------------------------------------------
# Ma'lumot tuzilmalari
# ---------------------------------------------------------------------------
@dataclass
class Edit:
    file: str
    find: str
    replace: str


@dataclass
class Plan:
    files: List[str]
    summary: str
    risk: str                    # past | orta | yuqori
    danger_flags: List[str]
    edits: List[Edit]
    test: str
    warnings: List[str] = field(default_factory=list)   # sezgir fayl ogohlantirishlari


class PlanReject(Exception):
    """Preview bosqichida rad. kind: "env" | "rad"; sabab: C.RAD_* (env uchun bo'sh)."""

    def __init__(self, kind: str, sabab: str) -> None:
        super().__init__("%s: %s" % (kind, sabab))
        self.kind = kind
        self.sabab = sabab


@dataclass
class ApplyOutcome:
    ok: bool
    reason: Optional[str]        # C.BAJ_* (yoki "find N marta")
    commit: Optional[str]        # qisqa hash
    files: List[str]
    checks: List[str]            # ["py_compile agents/x.py: ok", "tsc backend: ok"]
    detail: str = ""             # tsc/py_compile/git chiqishi, 1500 belgi


class _Abort(Exception):
    """apply_plan ichida: yozishdan keyingi xato, qaytarish kerak."""

    def __init__(self, reason: str, detail: str = "") -> None:
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


# ---------------------------------------------------------------------------
# 3.1 Parse
# ---------------------------------------------------------------------------
def extract_request_approval(text: str) -> Tuple[Optional[str], str]:
    """(birinchi blok ichi yoki None, bloklardan tashqari matn).

    Faqat birinchi blok parse qilinadi; qolgan bloklar ham tashqi matndan olib tashlanadi
    (ichidagi namuna WRITE_MEMORY/Teacher qatorlari qo'llanmasin).
    """
    src = text or ""
    m = C.REQUEST_APPROVAL_RE.search(src)
    if not m:
        return None, src
    return m.group(1), C.REQUEST_APPROVAL_RE.sub("", src)


def has_blockless_trigger(text: str) -> bool:
    """R4: blok yo'q, lekin tasdiq so'zlari bor (harf farqsiz, substring)."""
    low = C.norm_apostrophe(text or "").lower()
    return any(w in low for w in C.BLOKSIZ_SOZLAR)


def _clean_path(raw: str) -> str:
    p = (raw or "").strip()
    while len(p) >= 2 and p[0] == p[-1] and p[0] in _QUOTES:
        p = p[1:-1].strip()
    return p


def _split_files(s: str) -> List[str]:
    out: List[str] = []
    for piece in s.split(","):
        p = _clean_path(re.sub(r"^-\s*", "", piece.strip()))
        if p:
            out.append(p)
    return out


def _add_flag(flags: List[str], raw: str) -> None:
    s = raw.strip()
    if s.startswith("-"):
        s = s[1:].strip()
    if not s:
        return
    if C.norm_apostrophe(s).strip().strip(".").strip().lower() in _DANGER_NONE_SET:
        return
    if s not in flags:
        flags.append(s)


def _dedupe(items: List[str]) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def parse_plan(inner: str) -> Plan:
    """Holat mashinasi (KOD 3.1). Buzuq -> PlanReject("rad", C.RAD_BUZUQ).

    `<<<M` ochilgach yopuvchi `M` qatorigacha kalit qidirilmaydi; mazmun = orasidagi qatorlar
    `\\n` bilan (yopuvchi marker oldidagi yangi qator kirmaydi). Fayl nomi matndan taxmin qilinmaydi.
    """
    lines = (inner or "").replace("\r\n", "\n").split("\n")
    files_raw: List[str] = []
    summary_parts: List[str] = []
    risk_raw = ""
    flags: List[str] = []
    test_inline = ""
    test_lines: List[str] = []
    edits: List[Edit] = []

    section = ""
    cur: Optional[Dict[str, Optional[str]]] = None
    marker = ""
    target = ""
    buf: List[str] = []

    def buzuq() -> PlanReject:
        return PlanReject("rad", C.RAD_BUZUQ)

    def finish_edit() -> None:
        nonlocal cur
        if cur is None:
            return
        f, fi, rp = cur.get("file"), cur.get("find"), cur.get("replace")
        if not f or fi is None or rp is None:
            raise buzuq()
        edits.append(Edit(f, fi, rp))
        cur = None

    for line in lines:
        if marker:
            if line.strip() == marker:
                assert cur is not None
                cur[target] = "\n".join(buf)
                marker, target, buf = "", "", []
            else:
                buf.append(line)
            continue

        km = C.PLAN_KEY_RE.match(line.lstrip())
        if km:
            finish_edit()
            section = km.group(1).lower()
            rest = km.group(2).strip()
            if section == "files" and rest:
                files_raw.extend(_split_files(rest))
            elif section == "summary" and rest:
                summary_parts.append(rest)
            elif section == "risk":
                risk_raw = rest
            elif section == "danger_flags" and rest:
                _add_flag(flags, rest)
            elif section == "test":
                test_inline = rest
            continue

        if section == "edits":
            fm = C.EDIT_FILE_RE.match(line)
            if fm:
                finish_edit()
                cur = {"file": _clean_path(fm.group(1)), "find": None, "replace": None}
                continue
            m = C.EDIT_FIND_RE.match(line)
            if m:
                if cur is None or cur.get("find") is not None:
                    raise buzuq()
                marker, target, buf = m.group(1), "find", []
                continue
            m = C.EDIT_REPLACE_RE.match(line)
            if m:
                if cur is None or cur.get("find") is None or cur.get("replace") is not None:
                    raise buzuq()
                marker, target, buf = m.group(1), "replace", []
                continue
            continue  # markerdan tashqaridagi boshqa qator e'tiborsiz

        s = line.strip()
        if section == "files":
            if s:
                im = C.FILES_ITEM_RE.match(line)
                files_raw.extend([_clean_path(im.group(1))] if im else _split_files(s))
        elif section == "summary":
            if s:
                summary_parts.append(s)
        elif section == "risk":
            if not risk_raw and s:
                risk_raw = s
        elif section == "danger_flags":
            if s:
                _add_flag(flags, s)
        elif section == "test":
            test_lines.append(line.rstrip())
        # diff:, teacher_rules_read: va birinchi kalitdan oldingi qatorlar e'tiborsiz

    if marker:
        raise buzuq()  # marker yopilmagan
    finish_edit()

    files: List[str] = []
    for p in files_raw:
        if p and C.VALID_PATH_RE.match(p):
            files.append(p)
        else:
            log.info("files: yaroqsiz yo'l tashlandi: %r", p[:120])
    files = _dedupe(files)
    summary = " ".join(summary_parts).strip()
    risk = risk_raw.strip().lower()
    if risk not in C.RISK_VALUES:
        risk = C.RISK_DEFAULT
    body = textwrap.dedent("\n".join(test_lines)).strip("\n")
    test = "\n".join(x for x in (test_inline, body) if x).strip()

    if not files or not edits or not summary:
        raise buzuq()
    return Plan(files=files, summary=summary, risk=risk, danger_flags=flags, edits=edits, test=test)


# ---------------------------------------------------------------------------
# 3.2 / 3.4 Tekshiruv
# ---------------------------------------------------------------------------
def _repo_base(repo: Optional[Path] = None) -> Path:
    return Path(os.path.realpath(str(repo if repo is not None else config.REPO)))


def _lexical_ok(base: Path, rel: str) -> bool:
    """Yo'lda symlink yo'q: realpath leksik yo'l bilan bir xil (base allaqachon realpath)."""
    lex = os.path.normpath(os.path.join(str(base), rel))
    return os.path.normcase(lex) == os.path.normcase(os.path.realpath(lex))


def validate_plan(plan: Plan, *, repo: Optional[Path] = None) -> Plan:
    """safe_repo_path (env -> "env", boshqa rad -> RAD_HIMOYA), files ⊇ edits, sezgir -> yuqori."""
    base = _repo_base(repo)
    checked: Dict[str, config.SafePath] = {}
    for p in list(plan.files) + [e.file for e in plan.edits]:
        if p not in checked:
            checked[p] = config.safe_repo_path(p, base)
    if any(sp.reason == "env" for sp in checked.values()):
        raise PlanReject("env", "")
    for sp in checked.values():
        if not sp.ok or not _lexical_ok(base, sp.rel):
            raise PlanReject("rad", C.RAD_HIMOYA)

    files = _dedupe([checked[p].rel for p in plan.files])
    edits = [Edit(checked[e.file].rel, e.find, e.replace) for e in plan.edits]
    fset = set(files)
    for e in edits:
        if e.file not in fset:
            raise PlanReject("rad", C.RAD_FILES)

    warnings = list(plan.warnings)
    edited = {e.file for e in edits}
    extra = [f for f in files if f not in edited]
    if extra:  # commit faqat haqiqatan o'zgargan fayllar bilan
        warnings.append("files ro'yxatida, lekin edit yo'q (e'tiborsiz): " + ", ".join(extra))
        files = [f for f in files if f in edited]

    risk = plan.risk if plan.risk in C.RISK_VALUES else C.RISK_DEFAULT
    flags = list(plan.danger_flags)
    for f in files:
        # prefiks (config.is_sensitive) + naqsh (C.SEZGIR_RE: yangi agents/*.py, ildiz *.py, */__init__.py)
        if config.is_sensitive(f) or C.SEZGIR_RE.match(f):
            risk = _RISK_YUQORI
            w = C.SEZGIR_XAVF_TPL.format(path=f)
            if w not in flags:
                flags.append(w)
            if w not in warnings:
                warnings.append(w)
    return Plan(files=files, summary=plan.summary, risk=risk, danger_flags=flags,
                edits=edits, test=plan.test, warnings=warnings)


def file_sha256(path: Path) -> str:
    """Fayl sha256 hex; yo'q (yoki oddiy fayl emas) -> ""."""
    p = str(path)
    if not os.path.isfile(p):
        return ""
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def build_payload(plan: Plan, token: str, *, repo: Optional[Path] = None,
                  now: Optional[datetime] = None) -> dict:
    """kv_store['sup_appr_<token>'] mazmuni. created_ts = ilova vaqti (DB soati emas)."""
    base = _repo_base(repo)
    ts = config.to_utc(now) if now is not None else config.now_utc()
    return {
        "v": 1,
        "token": token,
        "created": config.iso_utc(ts),
        "created_ts": ts.timestamp(),
        "files": list(plan.files),
        "summary": plan.summary,
        "risk": plan.risk,
        "danger_flags": list(plan.danger_flags),
        "edits": [{"file": e.file, "find": e.find, "replace": e.replace} for e in plan.edits],
        "test": plan.test,
        "hashes": {f: file_sha256(base / f) for f in plan.files},
    }


def payload_too_big(payload: dict) -> bool:
    return len(json.dumps(payload, ensure_ascii=False)) > C.PAYLOAD_MAX


def needs_diff_document(plan: Plan) -> bool:
    """5 dan ortiq edit yoki 280 belgidan uzun find/replace."""
    if len(plan.edits) > C.PREVIEW_EDITS:
        return True
    return any(len(e.find) > C.PREVIEW_SNIPPET or len(e.replace) > C.PREVIEW_SNIPPET for e in plan.edits)


# ---------------------------------------------------------------------------
# Xotirada qo'llash (apply_plan va unified_diff uchun umumiy)
# ---------------------------------------------------------------------------
def _to_crlf(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\n", "\r\n")


def _count(text: str, sub: str) -> int:
    """Ustma-ust tushganlarini ham sanaydi (noaniq joy ham 'N marta' bo'lsin)."""
    n, i = 0, text.find(sub)
    while i >= 0:
        n += 1
        i = text.find(sub, i + 1)
    return n


def _apply_edits_memory(edits: List[Dict[str, str]], texts: Dict[str, Optional[str]]
                        ) -> Tuple[Dict[str, Optional[str]], Optional[str], str]:
    """(yangi matnlar, sabab yoki None, izoh). texts: rel -> matn yoki None (fayl yo'q)."""
    cur: Dict[str, Optional[str]] = dict(texts)
    crlf = {f: (t is not None and "\r\n" in t) for f, t in texts.items()}
    for i, e in enumerate(edits, 1):
        f, find, rep = e["file"], e["find"], e["replace"]
        where = "edit %d: %s" % (i, f)
        if f not in cur:
            return cur, C.BAJ_COMMIT, where + ": files ro'yxatida yo'q"
        if find == "":  # yangi fayl
            if cur[f] is not None:
                return cur, C.BAJ_FAYL_OZGARGAN, where + ": yangi fayl, lekin fayl mavjud"
            cur[f] = rep
            continue
        text = cur[f]
        if text is None:
            return cur, C.BAJ_FIND_YOQ, where + ": fayl yo'q"
        if crlf.get(f):
            find, rep = _to_crlf(find), _to_crlf(rep)
        n = _count(text, find)
        if n == 0:
            return cur, C.BAJ_FIND_YOQ, where
        if n > 1:
            return cur, C.BAJ_FIND_N_TPL.format(n=n), where
        cur[f] = text.replace(find, rep, 1)
    return cur, None, ""


def _read_bytes(path: Path) -> Optional[bytes]:
    p = str(path)
    if not os.path.isfile(p):
        return None
    with open(p, "rb") as fh:
        return fh.read()


def _payload_parts(payload: Any) -> Tuple[List[str], List[Dict[str, str]], Dict[str, str], str]:
    if not isinstance(payload, dict):
        raise ValueError("payload dict emas")
    files = payload.get("files")
    edits = payload.get("edits")
    hashes = payload.get("hashes") or {}
    if not isinstance(files, list) or not files or not all(isinstance(f, str) and f for f in files):
        raise ValueError("files bo'sh yoki buzuq")
    if len(set(files)) != len(files):
        raise ValueError("files takrorlangan")
    if not isinstance(edits, list) or not edits:
        raise ValueError("edits bo'sh")
    if not isinstance(hashes, dict):
        raise ValueError("hashes buzuq")
    fset = set(files)
    out: List[Dict[str, str]] = []
    for e in edits:
        if not isinstance(e, dict):
            raise ValueError("edit buzuq")
        f, fi, rp = e.get("file"), e.get("find"), e.get("replace")
        if not isinstance(f, str) or not isinstance(fi, str) or not isinstance(rp, str):
            raise ValueError("edit maydonlari buzuq")
        if f not in fset:
            raise ValueError("edit fayli files da yo'q: " + f)
        out.append({"file": f, "find": fi, "replace": rp})
    return list(files), out, {str(k): str(v) for k, v in hashes.items()}, str(payload.get("summary") or "")


def unified_diff(payload: dict, *, repo: Optional[Path] = None) -> str:
    """To'liq unified diff (xotirada qo'llab). Qo'llab bo'lmasa izoh + xom edit bloklari."""
    base = _repo_base(repo)
    try:
        files, edits, _h, _s = _payload_parts(payload)
    except ValueError as exc:
        return "# REJA diff tuzilmadi: %s\n" % exc
    head = "# REJA %s: %d fayl, %d edit\n" % (payload.get("token", ""), len(files), len(edits))
    texts: Dict[str, Optional[str]] = {}
    for f in files:
        try:
            b = _read_bytes(base / f)
        except OSError:
            b = None
        texts[f] = None if b is None else b.decode("utf-8", errors="replace")
    new, reason, detail = _apply_edits_memory(edits, texts)
    chunks: List[str] = [head]
    if reason:
        chunks.append("# DIQQAT: hozirgi faylga qo'llab bo'lmadi: %s (%s). Quyida xom edit bloklari.\n"
                      % (reason, detail))
        for i, e in enumerate(edits, 1):
            chunks.append("\n### edit %d: %s\n--- find\n%s\n+++ replace\n%s\n" % (i, e["file"], e["find"], e["replace"]))
        return "".join(chunks)
    for f in files:
        old, nt = texts.get(f), new.get(f)
        a = [] if old is None else old.splitlines(True)
        b = [] if nt is None else nt.splitlines(True)
        fromfile = "/dev/null" if old is None else "a/" + f
        for line in difflib.unified_diff(a, b, fromfile=fromfile, tofile="b/" + f, n=3):
            if not line.endswith("\n"):
                line += "\n\\ No newline at end of file\n"
            chunks.append(line)
    return "".join(chunks)


# ---------------------------------------------------------------------------
# 3.2 Preview (html.escape, normalize_latin YO'Q)
# ---------------------------------------------------------------------------
def _cut(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n].rstrip() + "\n..."


def _preview_html(plan: Plan, *, snippet: int, test_max: int, files_max: int, diff_doc: bool) -> str:
    new_files = {e.file for e in plan.edits if e.find == ""}
    L: List[str] = ["<b>Support REJA</b> — ruxsat kerak", "Xavf: <b>%s</b>" % html.escape(plan.risk), ""]
    L.append("<b>Fayllar (%d):</b>" % len(plan.files))
    for f in plan.files[:files_max]:
        L.append("- <code>%s</code>%s" % (html.escape(f), " (yangi)" if f in new_files else ""))
    if len(plan.files) > files_max:
        L.append("- ... yana %d ta" % (len(plan.files) - files_max))
    L.append("")
    L.append("<b>Qisqacha:</b> %s" % html.escape(_cut(plan.summary, 600)))
    L.append("")
    flags = list(plan.danger_flags) + [w for w in plan.warnings if w not in plan.danger_flags]
    if flags:
        L.append("<b>Xavf belgilari:</b>")
        for fl in flags[:10]:
            L.append("- " + html.escape(_cut(fl, 300)))
        if len(flags) > 10:
            L.append("- ... yana %d ta" % (len(flags) - 10))
    else:
        L.append("Xavf belgilari: yo'q")
    L.append("")
    shown = plan.edits[: C.PREVIEW_EDITS]
    if len(plan.edits) > len(shown):
        L.append("<b>O'zgarishlar: %d ta, birinchi %d tasi:</b>" % (len(plan.edits), len(shown)))
    else:
        L.append("<b>O'zgarishlar: %d ta</b>" % len(plan.edits))
    for i, e in enumerate(shown, 1):
        kind = "yangi fayl" if e.find == "" else ("o'chirish" if e.replace == "" else "almashtirish")
        L.append("%d. <code>%s</code> — %s" % (i, html.escape(e.file), kind))
        if e.find != "":
            L.append("Topiladi:")
            L.append("<pre>%s</pre>" % html.escape(_cut(e.find, snippet)))
        if e.replace != "":
            L.append("Yangi matn:" if e.find == "" else "O'rniga:")
            L.append("<pre>%s</pre>" % html.escape(_cut(e.replace, snippet)))
    if plan.test.strip():
        L.append("")
        L.append("<b>Test:</b>")
        L.append(html.escape(_cut(plan.test, test_max)))
    L.append("")
    if diff_doc:
        L.append("To'liq diff yuqoridagi .diff hujjatda.")
    L.append("[Ha] bosilsa bot o'zgarishni qo'llaydi, tekshiradi, commit va push qiladi (%s). "
             "Tasdiq %d daqiqa amal qiladi." % (C.BRANCH, max(1, C.APPROVAL_TTL_S // 60)))
    return "\n".join(L)


def _build_preview(plan: Plan) -> Tuple[str, bool]:
    """(preview HTML, .diff hujjat kerakmi). Uzun bo'lsa bo'laklar qisqaradi va hujjat majburiy."""
    base_doc = needs_diff_document(plan)
    steps = ((C.PREVIEW_SNIPPET, 800, 20), (C.PREVIEW_SNIPPET, 300, 12), (160, 200, 8), (80, 120, 5), (40, 80, 3))
    text, doc = "", True
    for snip, tmax, fmax in steps:
        hidden = len(plan.files) > fmax or any(
            len(e.find) > snip or len(e.replace) > snip for e in plan.edits[: C.PREVIEW_EDITS])
        doc = base_doc or hidden
        text = _preview_html(plan, snippet=snip, test_max=tmax, files_max=fmax, diff_doc=doc)
        if len(text) <= _PREVIEW_MAX:
            return text, doc
    return text, True


def format_preview_html(plan: Plan) -> str:
    return _build_preview(plan)[0]


# ---------------------------------------------------------------------------
# Kichik yordamchilar: SISTEMA, kv, maskalash
# ---------------------------------------------------------------------------
def _sis(inner: str) -> None:
    try:
        history.add_system(inner)
    except Exception:  # tarix yozilmasa ham oqim davom etadi
        log.exception("SISTEMA yozilmadi: %s", inner[:200])


async def _hist(text: str) -> None:
    """Egasiga ketgan LLM'siz xabar (oddiy matn) tarixga va agent_chat_log ga (KOD 1.5, Q10).

    leader_bot._say bilan bir xil: yuborilgach yoziladi, xato yutiladi."""
    try:
        await asyncio.to_thread(history.add_history, C.ROLE_LEADER, text)
    except Exception:
        log.exception("tarix yozilmadi: %s", (text or "")[:200])


async def _send_plain(outbox: "Outbox", text: str) -> None:
    """Oddiy matn egasiga + tarix."""
    await outbox.send_text(text, html=False)
    await _hist(text)


def _kv_claim(key: str) -> bool:
    """R5: bir martalik claim (INSERT ... ON CONFLICT DO NOTHING, rowcount == 1)."""
    return bool(db.kv_claim(key, config.iso_utc()))


def _kv_del_quiet(key: str) -> None:
    try:
        db.kv_del(key)
    except Exception:
        log.exception("kv o'chirilmadi: %s", key)


def _mask(text: str) -> str:
    out = text or ""
    for pat in C.SIR_NAQSHLARI:
        out = pat.sub("***", out)
    return out


def _cut_detail(detail: str) -> str:
    d = _mask(detail or "").strip()
    return d if len(d) <= _DETAIL_MAX else d[:_DETAIL_MAX] + "\n..."


def _fail(reason: str, files: List[str], checks: List[str], detail: str = "") -> ApplyOutcome:
    return ApplyOutcome(ok=False, reason=reason, commit=None, files=list(files), checks=list(checks),
                        detail=_cut_detail(detail))


def _keys(token: str) -> Tuple[str, str, str]:
    return (C.kv_key(C.KV_SUP_APPR, token=token), C.kv_key(C.KV_SUP_RUN, token=token),
            C.kv_key(C.KV_SUP_DONE, token=token))


# ---------------------------------------------------------------------------
# 3.2 Taklif (preview + tugma)
# ---------------------------------------------------------------------------
async def _reject(rej: PlanReject, outbox: "Outbox") -> None:
    if rej.kind == "env":
        _sis(C.sistema(C.SIS_SUPPORT_ENV))
        await _send_plain(outbox, C.MSG_REJA_ENV)
    else:
        _sis(C.sistema(C.SIS_SUPPORT_REJA_RAD, sabab=rej.sabab))
        await _send_plain(outbox, C.MSG_REJA_RAD_TPL.format(sabab=rej.sabab))


async def offer_plan(inner: str, outbox: "Outbox") -> Optional[str]:
    """Parse + tekshiruv + preview. Token (preview yuborildi) yoki None (rad)."""
    try:
        plan = validate_plan(parse_plan(inner))
    except PlanReject as rej:
        await _reject(rej, outbox)
        return None
    except Exception:
        log.exception("REJA parse/tekshiruv xatosi")
        await _reject(PlanReject("rad", C.RAD_BUZUQ), outbox)
        return None

    token = uuid.uuid4().hex[:16]
    try:
        payload = build_payload(plan, token)
    except Exception:
        log.exception("REJA payload tuzilmadi")
        await _reject(PlanReject("rad", C.RAD_PREVIEW), outbox)
        return None
    if payload_too_big(payload):
        await _reject(PlanReject("rad", C.RAD_HAJM), outbox)
        return None

    appr_key = C.kv_key(C.KV_SUP_APPR, token=token)
    try:
        db.kv_set_json(appr_key, payload)
    except Exception:
        log.exception("sup_appr yozilmadi")
        await _reject(PlanReject("rad", C.RAD_PREVIEW), outbox)
        return None

    sent = False
    try:
        preview, doc = _build_preview(plan)
        doc_ok = True
        if doc:  # to'liq diff tugmadan OLDIN
            data = unified_diff(payload).encode("utf-8")
            caption = _DIFF_CAPTION_TPL.format(n=len(plan.files), m=len(plan.edits))
            doc_ok = await outbox.send_document("reja_%s.diff" % token, data, caption=caption) is not None
        if doc_ok:
            keyboard = [[(C.KNOPKA_HA, C.CB_SUP_OK + token), (C.KNOPKA_YOQ, C.CB_SUP_NO + token)]]
            sent = await outbox.send_text(preview, html=True, keyboard=keyboard) is not None
    except Exception:
        log.exception("REJA preview yuborishda xato")
        sent = False

    if not sent:
        _kv_del_quiet(appr_key)
        await _reject(PlanReject("rad", C.RAD_PREVIEW), outbox)
        return None
    _sis(C.sistema(C.SIS_SUPPORT_RUXSAT, n=len(plan.files), risk=plan.risk))
    return token


# ---------------------------------------------------------------------------
# 3.2 / R5 Qaror ([Ha] / [Yo'q])
# ---------------------------------------------------------------------------
def _expired(payload: dict) -> bool:
    try:
        created = float(payload.get("created_ts") or 0)
    except (TypeError, ValueError):
        return True
    return config.now_utc().timestamp() - created > C.APPROVAL_TTL_S


async def _drop_keyboard(outbox: "Outbox", message_id: Optional[int]) -> None:
    if message_id:
        try:
            await outbox.edit_keyboard(message_id, None)
        except Exception:
            log.exception("tugmalar olinmadi")


async def decide(token: str, approve: bool, outbox: "Outbox", message_id: Optional[int]) -> str:
    """egasi (chaqiruvchi tekshirgan) -> muddat -> _kv_claim('sup_run_<token>'). Toast qaytaradi."""
    if not _TOKEN_RE.match(token or ""):
        return C.MSG_MUDDAT_OTGAN
    appr_key, run_key, done_key = _keys(token)
    try:
        payload = db.kv_get_json(appr_key)
        if payload is not None and not isinstance(payload, dict):
            payload = None
        if payload is None and db.kv_get(run_key) is not None:
            await _drop_keyboard(outbox, message_id)
            return C.MSG_REJA_HAL_QILINGAN
        if payload is None or _expired(payload) or payload.get("token") != token:
            if not _kv_claim(run_key):
                return C.MSG_REJA_HAL_QILINGAN
            db.kv_set(done_key, config.iso_utc())
            if payload is not None:
                db.kv_del(appr_key)
            await _drop_keyboard(outbox, message_id)
            if approve:
                _sis(C.sistema(C.SIS_SUPPORT_BAJARILMADI, sabab=C.BAJ_MUDDAT))
            else:
                _sis(C.sistema(C.SIS_SUPPORT_RAD_ETILDI))
            return C.MSG_MUDDAT_OTGAN
        if not _kv_claim(run_key):
            return C.MSG_REJA_HAL_QILINGAN
    except Exception:
        log.exception("REJA qarori: DB xatosi")
        return _MSG_DB_XATO

    if not approve:
        try:  # darhol: restart buni uzilgan ijro deb olmasin
            db.kv_set(done_key, config.iso_utc())
        except Exception:
            log.exception("sup_done yozilmadi")
        _kv_del_quiet(appr_key)
        await _drop_keyboard(outbox, message_id)
        _sis(C.sistema(C.SIS_SUPPORT_RAD_ETILDI))
        await _send_plain(outbox, C.MSG_REJA_RAD_ETILDI)
        return C.MSG_REJA_RAD_ETILDI

    # [Ha]: sup_done_ bu yerda YOZILMAYDI (restart tiklashi uchun), ijro finally'da
    await _drop_keyboard(outbox, message_id)
    task = asyncio.create_task(execute_approved(token, payload, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return C.MSG_REJA_QABUL


# ---------------------------------------------------------------------------
# 3.3 Ijro (qulf, lease, deploy flock)
# ---------------------------------------------------------------------------
def _get_exec_lock() -> asyncio.Lock:
    global _exec_lock
    if _exec_lock is None:
        _exec_lock = asyncio.Lock()
    return _exec_lock


def _lease_acquire(key: str, token: str) -> bool:
    try:
        return bool(db.kv_lease_acquire(key, token, C.SUP_EXEC_LEASE_S))
    except Exception:
        log.exception("lease olinmadi: %s", key)
        return False


def _lease_release(key: str, token: str) -> None:
    try:
        db.kv_lease_release(key, token)
    except Exception:
        log.exception("lease bo'shatilmadi: %s", key)


async def _renew_leases(token: str, keys: Tuple[str, ...]) -> None:
    while True:
        await asyncio.sleep(_RENEW_EVERY_S)
        for k in keys:
            try:
                db.kv_lease_renew(k, token, C.SUP_EXEC_LEASE_S)
            except Exception:
                log.exception("lease yangilanmadi: %s", k)


async def _acquire_deploy_lock(path: str, outbox: "Outbox") -> Optional[int]:
    """Deploy flock (deploy.sh bilan umumiy). fd; -1 = fcntl yo'q (Windows); None = olinmadi."""
    try:
        import fcntl  # POSIX
    except ImportError:
        log.warning("fcntl yo'q: deploy qulfi o'tkazib yuborildi")
        return -1
    try:
        try:
            fd = os.open(path, os.O_RDONLY)
        except FileNotFoundError:
            os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
            fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError:
        log.exception("deploy qulf fayli ochilmadi: %s", path)
        return None
    deadline = time.monotonic() + C.DEPLOY_LOCK_WAIT_S
    notified = False
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return fd
            except OSError:
                if time.monotonic() >= deadline:
                    break
            if not notified:
                notified = True
                try:  # xabar xatosi qulf kutishini buzmasin
                    await _send_plain(outbox, _MSG_DEPLOY_KUTISH_TPL.format(daq=max(1, C.DEPLOY_LOCK_WAIT_S // 60)))
                except Exception:
                    log.exception("deploy kutish xabari yuborilmadi")
            await asyncio.sleep(2)
    except BaseException:  # bekor qilinsa ham fd ochiq qolmasin
        os.close(fd)
        raise
    os.close(fd)
    return None


def _release_deploy_lock(fd: Optional[int]) -> None:
    if fd is None or fd < 0:
        return
    try:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_UN)
    except (ImportError, OSError):
        pass
    try:
        os.close(fd)
    except OSError:
        pass


def _rmtree_quiet(path: Path) -> None:
    if os.path.lexists(str(path)):
        shutil.rmtree(str(path), ignore_errors=True)


def _finish(token: str) -> None:
    """Har natijada: sup_done_, token o'chiriladi, asl nusxalar o'chiriladi."""
    appr_key, _run_key, done_key = _keys(token)
    done_ok = True
    try:
        db.kv_set(done_key, config.iso_utc())
    except Exception:
        done_ok = False
        log.exception("sup_done yozilmadi: %s", token)
    _kv_del_quiet(appr_key)
    if done_ok:  # sup_done yozilmasa nusxa qoladi: restart tiklaydi
        _rmtree_quiet(config.SUP_ORIG_DIR / token)


async def _report(outcome: ApplyOutcome, outbox: "Outbox") -> None:
    if outcome.ok:
        _sis(C.sistema(C.SIS_SUPPORT_APPROVED, hash=outcome.commit or "", n=len(outcome.files)))
        text = C.MSG_REJA_BAJARILDI_TPL.format(
            hash=outcome.commit or "", n=len(outcome.files), fayllar=", ".join(outcome.files),
            tekshiruv="; ".join(outcome.checks) or _TEKSHIRUV_YOQ)
        if outcome.detail:
            text += "\n" + outcome.detail
        await _send_plain(outbox, text)
        return
    reason = outcome.reason or C.BAJ_COMMIT
    _sis(C.sistema(C.SIS_SUPPORT_BAJARILMADI, sabab=reason))
    plain: List[str] = []  # egasi ko'rgan matn, HTML'siz (tarix uchun)
    if _QAYTARISH_XATO in (outcome.detail or ""):
        plain.append(_MSG_QAYTARISH_DIQQAT)
    plain.append(C.MSG_REJA_BAJARILMADI_TPL.format(sabab=reason))
    msg = "\n".join(html.escape(x) for x in plain)
    if outcome.detail:
        detail = outcome.detail[:_DETAIL_MAX]
        plain.append(detail)
        msg += "\n<pre>" + html.escape(detail) + "</pre>"
    await outbox.send_text(msg, html=True)
    await _hist("\n".join(plain))


async def execute_approved(token: str, payload: dict, outbox: "Outbox") -> ApplyOutcome:
    """[Ha] dan keyin fon vazifa. Agent qayta chaqirilmaydi."""
    files = [str(f) for f in (payload.get("files") or [])] if isinstance(payload, dict) else []
    lock = _get_exec_lock()
    got_lock = got_lease = got_active = False
    fd: Optional[int] = None
    renew: Optional["asyncio.Task[Any]"] = None
    finished = False
    outcome: Optional[ApplyOutcome] = None
    try:
        try:
            if lock.locked():
                outcome = _fail(C.BAJ_BAND, files, [], "shu jarayonda boshqa reja ishlayapti")
            else:
                await lock.acquire()
                got_lock = True
                got_lease = _lease_acquire(C.KV_SUP_EXEC_LOCK, token)
                if not got_lease:
                    outcome = _fail(C.BAJ_BAND, files, [], "sup_exec_lock boshqa rejada")
                else:
                    got_active = _lease_acquire(C.KV_SUP_EXEC_ACTIVE, token)
                    held = (C.KV_SUP_EXEC_LOCK,) + ((C.KV_SUP_EXEC_ACTIVE,) if got_active else ())
                    renew = asyncio.create_task(_renew_leases(token, held))
                    # 1-bosqich qulfsiz: shartlar, xotirada edit, py_compile/tsc vaqtinchalik nusxada
                    prep = await asyncio.to_thread(_prepare_apply, payload, token=token)
                    if isinstance(prep, ApplyOutcome):
                        outcome = prep
                    else:
                        # 2-bosqich deploy flock ostida (bir necha soniya): qayta tekshiruv, yozish, commit, push
                        fd = await _acquire_deploy_lock(config.get_settings().deploy_lock, outbox)
                        if fd is None:
                            outcome = _fail(C.BAJ_BAND, prep.files, prep.checks, "deploy qulfi olinmadi")
                        else:
                            try:
                                outcome = await asyncio.to_thread(_write_apply, prep)
                            finally:
                                # push'dan keyin deploy darhol qulfni olsin (deploy.sh 60 s kutadi)
                                _release_deploy_lock(fd)
                                fd = None
        except asyncio.CancelledError:
            raise  # jarayon to'xtayapti: sup_done yozilmaydi, restart tiklaydi
        except Exception as exc:
            log.exception("REJA ijrosida kutilmagan xato")
            outcome = _fail(C.BAJ_COMMIT, files, [], "kutilmagan xato: %s" % exc)
        if outcome is None:
            outcome = _fail(C.BAJ_COMMIT, files, [], "natija yo'q")
        try:  # xabar xatosi natijani o'zgartirmaydi
            await _report(outcome, outbox)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("REJA natijasi yuborilmadi")
        finished = True
        return outcome
    finally:
        if renew is not None:
            renew.cancel()
        _release_deploy_lock(fd)
        if finished:
            _finish(token)
        if got_active:
            _lease_release(C.KV_SUP_EXEC_ACTIVE, token)
        if got_lease:
            _lease_release(C.KV_SUP_EXEC_LOCK, token)
        if got_lock:
            lock.release()


# ---------------------------------------------------------------------------
# Subprocess yordamchilari (shell=False, timeout, jarayon guruhi)
# ---------------------------------------------------------------------------
def _run(cmd: List[str], cwd: Path, timeout: float, env: Optional[Dict[str, str]] = None
         ) -> Tuple[int, str, str]:
    """(rc, stdout, stderr). stdout va stderr alohida (git ogohlantirishi natijani buzmasin);
    communicate ikkalasini o'qiydi, osilish yo'q. claude CLI bu yerda chaqirilmaydi (runner.py)."""
    kw: Dict[str, Any] = {}
    if os.name == "posix":
        kw["start_new_session"] = True  # terminal yo'q: ssh/git parol so'rab osilmaydi
    try:
        proc = subprocess.Popen(cmd, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding="utf-8", errors="replace", **kw)
    except FileNotFoundError:
        return 127, "", "topilmadi: %s" % cmd[0]
    except OSError as exc:
        return 126, "", "ishga tushmadi: %s: %s" % (cmd[0], exc)
    try:
        out, err = proc.communicate(timeout=timeout)
        return proc.returncode, out or "", err or ""
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                import signal
                os.killpg(proc.pid, signal.SIGKILL)
            else:
                proc.kill()
        except OSError:
            pass
        try:
            out, err = proc.communicate(timeout=10)
        except Exception:
            out, err = "", ""
        return _TIMEOUT_RC, out or "", (err or "") + "\n(timeout %d s)" % int(timeout)


def _both(out: str, err: str) -> str:
    return "\n".join(x.strip() for x in (out, err) if x and x.strip())


def _git_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_EDITOR"] = "true"
    return env


def _git(base: Path, args: List[str], timeout: float = C.GIT_TIMEOUT_S) -> Tuple[int, str, str]:
    return _run(["git"] + list(args), base, timeout, _git_env())


def _rev(base: Path, *args: str) -> str:
    rc, out, _err = _git(base, ["rev-parse"] + list(args))
    return out.strip() if rc == 0 else ""


def _remote_sha(base: Path, branch: str) -> str:
    rc, out, _err = _git(base, ["ls-remote", "origin", "refs/heads/" + branch], timeout=_REMOTE_TIMEOUT_S)
    if rc != 0 or not out.strip():
        return ""
    return out.strip().split()[0]


def _tool_env() -> Dict[str, str]:
    env = {k: os.environ[k] for k in _TOOL_ENV_KEYS if k in os.environ}
    env.setdefault("PATH", "/usr/local/bin:/usr/bin:/bin")
    env.setdefault("HOME", os.path.expanduser("~"))
    env.setdefault("LANG", "C.UTF-8")
    env["NODE_OPTIONS"] = os.environ.get("NODE_OPTIONS") or _NODE_OPTIONS_DEFAULT
    return env


def _commit_message(summary: str) -> str:
    """feat(support): + summary'ning birinchi 60 belgisi (yangi qator va boshqaruv belgilarisiz)."""
    cleaned = "".join(" " if unicodedata.category(ch) in ("Cc", "Cf", "Zl", "Zp") else ch
                      for ch in (summary or ""))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return C.COMMIT_PREFIX + (cleaned[: C.COMMIT_SUMMARY_MAX].rstrip() or "support reja")


# ---------------------------------------------------------------------------
# Fayl yozish va holat (agents/state/sup_orig/<token>/state.json)
# ---------------------------------------------------------------------------
def _atomic_write(path: Path, data: bytes, mode: Optional[int], owner: Optional[Tuple[int, int]],
                  token: str, created_dirs: Optional[List[Path]] = None) -> None:
    """Shu papkada tmp + os.replace. Baytlar o'zgarishsiz (newline='' bilan teng), chmod saqlanadi."""
    parent = path.parent
    if not parent.exists():
        missing: List[Path] = []
        d = parent
        while not d.exists():
            missing.append(d)
            d = d.parent
        os.makedirs(str(parent), exist_ok=True)
        if created_dirs is not None:
            created_dirs.extend(reversed(missing))
    tmp = parent / (".%s.sup_%s.tmp" % (path.name, token))
    try:
        with open(str(tmp), "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(str(tmp), mode if mode is not None else 0o644)
        if owner is not None and hasattr(os, "chown"):
            try:
                os.chown(str(tmp), owner[0], owner[1])
            except OSError:
                pass
        os.replace(str(tmp), str(path))
    except BaseException:
        try:
            os.remove(str(tmp))
        except OSError:
            pass
        raise


def _write_state(tdir: Path, state: dict) -> None:
    os.makedirs(str(tdir), mode=0o700, exist_ok=True)
    p = tdir / "state.json"
    tmp = tdir / "state.json.tmp"
    with open(str(tmp), "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=True)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(str(tmp), str(p))


def _read_state(tdir: Path) -> Optional[dict]:
    p = tdir / "state.json"
    try:
        with open(str(p), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def _keep_backup(tdir: Path) -> str:
    """Qaytarish to'liq bo'lmasa asl nusxa o'chirilmasin (finally faqat <token> ni o'chiradi)."""
    if not os.path.isdir(str(tdir)):
        return ""
    dst = Path(str(tdir) + _QOLDIQ_SUFFIX)
    try:
        _rmtree_quiet(dst)
        os.replace(str(tdir), str(dst))
        return config.rel_to_repo(dst) if str(dst).startswith(str(config.REPO)) else str(dst)
    except OSError:
        log.exception("asl nusxa saqlanmadi: %s", tdir)
        return str(tdir)


# ---------------------------------------------------------------------------
# D6 tekshiruvlari: py_compile (sys.executable) va tsc (vaqtinchalik nusxada)
# ---------------------------------------------------------------------------
def _tsc_ignore(_dir: str, names: List[str]) -> List[str]:
    out: List[str] = []
    for n in names:
        low = n.lower()
        if low in _TSC_IGNORE_NAMES or low.startswith(_TSC_IGNORE_PREFIXES) or low.endswith(".tsbuildinfo"):
            out.append(n)
    return out


def _unlink_link(p: str) -> None:
    try:
        os.unlink(p)
    except OSError:
        try:
            os.rmdir(p)  # Windows: papka symlinki
        except OSError:
            pass


def _cleanup_tree(root: Path) -> None:
    """Avval ichidagi symlink papkalar (node_modules) uziladi, keyin rmtree: asl node_modules'ga tegilmaydi."""
    r = str(root)
    if not os.path.lexists(r):
        return
    if os.path.islink(r):
        _unlink_link(r)
        return
    for dirpath, dirnames, _files in os.walk(r):
        for name in list(dirnames):
            p = os.path.join(dirpath, name)
            if os.path.islink(p):
                _unlink_link(p)
                dirnames.remove(name)
                if os.path.lexists(p):
                    log.error("symlink uzilmadi, vaqtinchalik papka qoldi: %s", p)
                    return
    shutil.rmtree(r, ignore_errors=True)


def _tsc_cmd(real_proj: Path) -> List[str]:
    bin_dir = real_proj / "node_modules" / ".bin"
    for name in (("tsc.cmd", "tsc") if os.name == "nt" else ("tsc",)):
        p = bin_dir / name
        if p.is_file():
            return [str(p)]
    return [shutil.which("npx") or "npx", "--no-install", "tsc"]


def _tsc_check(base: Path, prefix: str, tsconfig_rel: str, files: List[str],
               new_texts: Dict[str, Optional[str]], token: str) -> Tuple[Optional[str], str]:
    proj = prefix.rstrip("/")
    real_proj = base / proj
    if not (base / tsconfig_rel).is_file():
        return C.BAJ_TSC, "%s topilmadi" % tsconfig_rel
    env = _tool_env()
    if shutil.which("node", path=env.get("PATH")) is None:
        return C.BAJ_TSC, "node PATH da topilmadi (bot servisi PATH ini tekshiring)"
    tmp_root = Path(config.TSC_TMP_DIR) / token
    tmp_proj = tmp_root / proj
    try:
        _cleanup_tree(tmp_root)
        os.makedirs(str(tmp_root), exist_ok=True)
        shutil.copytree(str(real_proj), str(tmp_proj), symlinks=True, ignore=_tsc_ignore)
        nm = real_proj / "node_modules"
        if nm.is_dir():
            try:
                os.symlink(str(nm), str(tmp_proj / "node_modules"), target_is_directory=True)
            except OSError as exc:
                log.warning("node_modules symlink qilinmadi: %s", exc)
        for f in files:
            text = new_texts.get(f)
            if not f.startswith(prefix) or text is None:
                continue
            dst = tmp_proj / f[len(prefix):]
            os.makedirs(str(dst.parent), exist_ok=True)
            with open(str(dst), "wb") as fh:
                fh.write(text.encode("utf-8"))
        cmd = _tsc_cmd(real_proj) + ["--noEmit", "--pretty", "false", "-p", str(tmp_root / tsconfig_rel)]
        rc, out, err = _run(cmd, tmp_proj, C.TSC_TIMEOUT_S, env)
    except (OSError, shutil.Error) as exc:
        return C.BAJ_TSC, "vaqtinchalik nusxa: %s" % exc
    finally:
        _cleanup_tree(tmp_root)
    if rc != 0:
        out = _both(out, err)
        out = out.replace(str(tmp_proj) + os.sep, proj + "/").replace(str(tmp_proj), proj)
        return C.BAJ_TSC, "tsc %s (exit %d):\n%s" % (proj, rc, out.strip())
    return None, ""


def _run_checks(files: List[str], new_texts: Dict[str, Optional[str]], token: str, base: Path,
                checks: List[str]) -> Tuple[Optional[str], str]:
    py_files = [f for f in files if f.endswith(".py") and new_texts.get(f) is not None]
    if py_files:
        tmpd = tempfile.mkdtemp(prefix="sup_pyc_")
        try:
            for f in py_files:
                tp = Path(tmpd) / f
                os.makedirs(str(tp.parent), exist_ok=True)
                with open(str(tp), "wb") as fh:
                    fh.write((new_texts[f] or "").encode("utf-8"))
                rc, out, err = _run([sys.executable, "-m", "py_compile", str(tp)], Path(tmpd),
                                    C.PY_COMPILE_TIMEOUT_S, _tool_env())
                if rc != 0:
                    out = _both(out, err).replace(str(tp), f).replace(tmpd + os.sep, "")
                    return C.BAJ_PY_COMPILE, "py_compile %s:\n%s" % (f, out.strip())
                checks.append("py_compile %s: ok" % f)
        finally:
            shutil.rmtree(tmpd, ignore_errors=True)
    for prefix, exts, tsconfig_rel in C.TSC_LOYIHALAR:
        if not any(f.startswith(prefix) and f.endswith(exts) for f in files):
            continue
        reason, detail = _tsc_check(base, prefix, tsconfig_rel, files, new_texts, token)
        if reason:
            return reason, detail
        checks.append("tsc %s: ok" % prefix.rstrip("/"))
    return None, ""


# ---------------------------------------------------------------------------
# 3.3 apply_plan (sinxron; kv/Telegram yo'q)
# ---------------------------------------------------------------------------
def _preconditions(base: Path, files: List[str], hashes: Dict[str, str], branch: str,
                   check_remote: bool = True) -> Tuple[Optional[str], str, str]:
    """(sabab, izoh, HEAD). Branch, index, porcelain, yo'l, xesh, gitignore, HEAD == origin.

    check_remote (push bo'lsa): lokal branch origin'dan oldinda bo'lsa (qaytarish to'liq bo'lmagan
    yoki qo'lda commit) push o'sha commitlarni ham tasdiqsiz olib ketardi (KOD 3.4) -> branch."""
    rc, out, err = _git(base, ["rev-parse", "--abbrev-ref", "HEAD"])
    if rc != 0:
        return C.BAJ_BRANCH, "git rev-parse: " + _both(out, err), ""
    if out.strip() != branch:
        return C.BAJ_BRANCH, "joriy branch %s, kerak %s" % (out.strip(), branch), ""
    head = _rev(base, "HEAD")
    if not head:
        return C.BAJ_BRANCH, "HEAD commit yo'q", ""
    rc, out, err = _git(base, ["diff", "--cached", "--name-only", "-z"])
    staged = [x for x in out.split("\0") if x.strip()]
    if rc != 0 or staged:
        return C.BAJ_BRANCH, "index'da boshqa o'zgarish bor: %s %s" % (", ".join(staged[:10]), err.strip()), head
    for f in files:
        rc, out, err = _git(base, ["status", "--porcelain", "--", f])
        if rc != 0 or out.strip():
            return C.BAJ_BRANCH, "git status --porcelain: " + _both(out, err), head
    for f in files:
        sp = config.safe_repo_path(f, base)
        if not sp.ok or sp.rel != f or not _lexical_ok(base, f):
            return C.BAJ_FAYL_OZGARGAN, "%s: yo'l ruxsatsiz" % f, head
        if file_sha256(base / f) != hashes.get(f):
            return C.BAJ_FAYL_OZGARGAN, "%s: preview'dan keyin o'zgargan (sha256)" % f, head
    for f in files:
        rc, _out, _err = _git(base, ["check-ignore", "-q", "--", f])
        if rc == 0:
            return C.BAJ_COMMIT, "%s .gitignore ichida, commit qilib bo'lmaydi" % f, head
    if check_remote:  # tarmoq: oxirida, lokal tekshiruvlardan keyin
        remote = _remote_sha(base, branch)
        if not remote:
            return C.BAJ_BRANCH, ("lokal %s origin bilan bir xil emas: origin/%s o'qilmadi (git ls-remote)"
                                  % (branch, branch)), head
        if remote != head:
            return C.BAJ_BRANCH, ("lokal %s origin bilan bir xil emas: HEAD %s, origin/%s %s"
                                  % (branch, head[:7], branch, remote[:7])), head
    return None, "", head


def _rollback(base: Path, written: List[str], originals: Dict[str, Optional[bytes]],
              meta: Dict[str, dict], created_dirs: List[Path], committed: str, token: str) -> List[str]:
    """Commit bo'lsa reset --soft HEAD~1, unstage, asl mazmun, yangi fayl/papkalar o'chiriladi."""
    errs: List[str] = []
    if committed:
        if _rev(base, "HEAD") == committed:
            rc, out, err = _git(base, ["reset", "--soft", "HEAD~1"])
            if rc != 0:
                errs.append("git reset --soft: " + _both(out, err))
        else:
            errs.append("HEAD kutilgan commit emas, reset qilinmadi")
    if written:
        rc, out, err = _git(base, ["reset", "-q", "--"] + written)
        if rc != 0 and "fatal" in (out + err).lower():
            errs.append("git reset (unstage): " + _both(out, err))
    for f in reversed(written):
        p = base / f
        try:
            orig = originals.get(f)
            if orig is None:
                if os.path.lexists(str(p)):
                    os.remove(str(p))
            else:
                m = meta.get(f) or {}
                owner = (m["uid"], m["gid"]) if "uid" in m and "gid" in m else None
                _atomic_write(p, orig, m.get("mode"), owner, token)
        except OSError as exc:
            errs.append("%s: %s" % (f, exc))
    for d in reversed(created_dirs):
        try:
            os.rmdir(str(d))
        except OSError:
            pass
    if written:
        rc, out, _err = _git(base, ["status", "--porcelain", "--"] + written)
        if rc == 0 and out.strip():
            errs.append("qaytarishdan keyin holat toza emas: " + out.strip()[:300])
    return errs


@dataclass
class _Prepared:
    """1-bosqich natijasi (repo'ga hali hech narsa yozilmagan). 2-bosqich shu bilan yozadi."""
    base: Path
    token: str
    branch: str
    push: bool
    tdir: Path
    files: List[str]
    hashes: Dict[str, str]
    summary: str
    head: str                                # tayyorlash paytidagi HEAD (push bo'lsa == origin)
    originals: Dict[str, Optional[bytes]]
    meta: Dict[str, dict]
    new_bytes: Dict[str, bytes]
    state: Dict[str, Any]
    checks: List[str]


def apply_plan(payload: dict, *, token: str, repo: Optional[Path] = None, branch: str = C.BRANCH,
               push: bool = True, orig_dir: Optional[Path] = None, run_checks: bool = True) -> ApplyOutcome:
    """KOD 3.3 / Q14: shartlar -> asl nusxa -> xotirada edit -> tekshiruv -> os.replace -> git add ->
    diff --cached == files -> commit -> push. Commitgacha har xatoda hammasi asliga; commit/push
    xatosida reset --soft HEAD~1 + unstage + asl mazmun. Commit lokalda QOLMAYDI.

    Ikki bosqich: _prepare_apply (uzoq, repo'ga yozmaydi) + _write_apply (qisqa). execute_approved
    deploy flock'ni faqat 2-bosqichga oladi; bu yerda ikkalasi ketma-ket (testlar)."""
    prep = _prepare_apply(payload, token=token, repo=repo, branch=branch, push=push,
                          orig_dir=orig_dir, run_checks=run_checks)
    if isinstance(prep, ApplyOutcome):
        return prep
    return _write_apply(prep)


def _prepare_apply(payload: dict, *, token: str, repo: Optional[Path] = None, branch: str = C.BRANCH,
                   push: bool = True, orig_dir: Optional[Path] = None, run_checks: bool = True
                   ) -> Union[ApplyOutcome, _Prepared]:
    """1-bosqich (deploy flock'siz): shartlar -> asl nusxa (state.json) -> xotirada edit ->
    py_compile/tsc vaqtinchalik nusxada. Repo fayllari va git holati o'zgarmaydi."""
    base = _repo_base(repo)
    checks: List[str] = []
    try:
        files, edits, hashes, summary = _payload_parts(payload)
    except ValueError as exc:
        return _fail(C.BAJ_COMMIT, [], checks, "payload buzuq: %s" % exc)
    if not _TOKEN_RE.match(token or ""):
        return _fail(C.BAJ_COMMIT, files, checks, "token yaroqsiz")
    tdir = Path(orig_dir if orig_dir is not None else config.SUP_ORIG_DIR) / token

    # 1. Old shartlar (push bo'lsa HEAD == origin ham)
    try:
        reason, detail, head_before = _preconditions(base, files, hashes, branch, check_remote=push)
    except OSError as exc:
        return _fail(C.BAJ_BRANCH, files, checks, "git: %s" % exc)
    if reason:
        return _fail(reason, files, checks, detail)

    # 2. Asl nusxalar: xotirada va state.json da (restart uchun)
    originals: Dict[str, Optional[bytes]] = {}
    meta: Dict[str, dict] = {}
    try:
        for f in files:
            p = base / f
            if os.path.isfile(str(p)):
                st = os.stat(str(p))
                originals[f] = _read_bytes(p)
                meta[f] = {"mode": stat.S_IMODE(st.st_mode), "uid": getattr(st, "st_uid", 0),
                           "gid": getattr(st, "st_gid", 0)}
            elif os.path.lexists(str(p)):
                return _fail(C.BAJ_FAYL_OZGARGAN, files, checks, "%s: oddiy fayl emas" % f)
            else:
                originals[f] = None
                meta[f] = {}
        state: Dict[str, Any] = {
            "v": 1, "token": token, "stage": "applying", "repo": str(base), "branch": branch,
            "head": head_before, "commit": None, "created": config.iso_utc(),
            "files": {
                f: {"existed": originals[f] is not None,
                    "b64": None if originals[f] is None else base64.b64encode(originals[f] or b"").decode("ascii"),
                    "sha256": hashes.get(f, ""), "mode": meta[f].get("mode"), "uid": meta[f].get("uid"),
                    "gid": meta[f].get("gid"), "new_sha256": None}
                for f in files
            },
        }
        _write_state(tdir, state)
    except OSError as exc:
        return _fail(C.BAJ_COMMIT, files, checks, "asl nusxa saqlanmadi: %s" % exc)

    # 3. Barcha edit xotirada
    texts: Dict[str, Optional[str]] = {}
    for f in files:
        b = originals[f]
        if b is None:
            texts[f] = None
            continue
        try:
            texts[f] = b.decode("utf-8")
        except UnicodeDecodeError:
            return _fail(C.BAJ_FIND_YOQ, files, checks, "%s: utf-8 matn emas" % f)
    new_texts, reason, detail = _apply_edits_memory(edits, texts)
    if reason:
        return _fail(reason, files, checks, detail)
    unchanged = [f for f in files if new_texts.get(f) == texts.get(f)]
    if unchanged:  # aks holda diff --cached != files
        return _fail(C.BAJ_COMMIT, files, checks, "o'zgarish yo'q: " + ", ".join(unchanged))
    new_bytes = {f: (new_texts[f] or "").encode("utf-8") for f in files}

    # 4. Tekshiruv (vaqtinchalik nusxada): py_compile, keyin tsc (D6)
    if run_checks:
        try:
            reason, detail = _run_checks(files, new_texts, token, base, checks)
        except OSError as exc:
            reason, detail = C.BAJ_PY_COMPILE, "tekshiruv ishga tushmadi: %s" % exc
        if reason:
            return _fail(reason, files, checks, detail)

    return _Prepared(base=base, token=token, branch=branch, push=push, tdir=tdir, files=files,
                     hashes=hashes, summary=summary, head=head_before, originals=originals, meta=meta,
                     new_bytes=new_bytes, state=state, checks=checks)


def _write_apply(prep: _Prepared) -> ApplyOutcome:
    """2-bosqich (bot uni deploy flock ostida chaqiradi, bir necha soniya): shartlar qayta (HEAD
    tayyorlashdagi bilan bir xil, xesh, origin) -> os.replace -> git add -> diff --cached == files ->
    commit -> push. Yozishdan keyingi har xatoda qaytarish."""
    base, token, branch, push, tdir = prep.base, prep.token, prep.branch, prep.push, prep.tdir
    files, checks, originals, meta, new_bytes = prep.files, prep.checks, prep.originals, prep.meta, prep.new_bytes
    head_before, state = prep.head, prep.state

    # 5a. Tekshiruv qulfsiz o'tgan: shu orada deploy yoki boshqa commit bo'lgan bo'lishi mumkin
    try:
        reason, detail, head_now = _preconditions(base, files, prep.hashes, branch, check_remote=push)
    except OSError as exc:
        return _fail(C.BAJ_BRANCH, files, checks, "git: %s" % exc)
    if reason:
        return _fail(reason, files, checks, detail)
    if head_now != head_before:  # tsc/py_compile boshqa daraxtda o'tgan: eski natija bilan yozilmaydi
        return _fail(C.BAJ_BRANCH, files, checks,
                     "tekshiruv paytida HEAD o'zgardi (%s -> %s, deploy bo'lgan bo'lishi mumkin). "
                     "Rejani qayta so'rang." % (head_before[:7], head_now[:7]))

    try:
        for f in files:
            state["files"][f]["new_sha256"] = hashlib.sha256(new_bytes[f]).hexdigest()
        _write_state(tdir, state)
    except OSError as exc:
        return _fail(C.BAJ_COMMIT, files, checks, "holat saqlanmadi: %s" % exc)

    # 5-6. Yozish, git add, commit, push
    written: List[str] = []
    created_dirs: List[Path] = []
    committed = ""
    try:
        for f in files:
            sp = config.safe_repo_path(f, base)
            if not sp.ok or not _lexical_ok(base, f):
                raise _Abort(C.BAJ_FAYL_OZGARGAN, "%s: yo'l ruxsatsiz" % f)
            if _read_bytes(base / f) != originals[f]:
                raise _Abort(C.BAJ_FAYL_OZGARGAN, "%s: tekshiruv paytida o'zgargan" % f)
            m = meta.get(f) or {}
            owner = (m["uid"], m["gid"]) if "uid" in m and "gid" in m else None
            _atomic_write(base / f, new_bytes[f], m.get("mode"), owner, token, created_dirs)
            written.append(f)

        for f in files:
            rc, out, err = _git(base, ["add", "--", f])
            if rc != 0:
                raise _Abort(C.BAJ_COMMIT, "git add %s: %s" % (f, _both(out, err)))
        rc, out, err = _git(base, ["diff", "--cached", "--name-only", "-z"])
        staged = {x for x in out.split("\0") if x.strip()}
        if rc != 0 or staged != set(files):
            raise _Abort(C.BAJ_COMMIT, "git diff --cached: %s != files %s %s"
                         % (sorted(staged)[:20], sorted(files)[:20], err.strip()))

        rc, out, err = _git(base, ["commit", "-q", "-m", _commit_message(prep.summary)])
        new_head = _rev(base, "HEAD")
        if new_head and new_head != head_before:
            committed = new_head
        if rc != 0 or not committed:
            raise _Abort(C.BAJ_COMMIT, "git commit: " + _both(out, err))
        short = _rev(base, "--short", "HEAD") or committed[:7]
        state["stage"], state["commit"] = "committed", committed
        try:
            _write_state(tdir, state)
        except OSError:
            log.exception("state (committed) yozilmadi")

        note = ""
        if push:
            rc, out, err = _git(base, ["push", "origin", branch], timeout=C.GIT_TIMEOUT_S)
            if rc != 0:
                if _remote_sha(base, branch) != committed:
                    raise _Abort(C.BAJ_PUSH, "git push: " + _both(out, err))
                note = "git push xato qaytardi, lekin origin/%s da commit bor." % branch
            state["stage"] = "pushed"
            try:
                _write_state(tdir, state)
            except OSError:
                log.exception("state (pushed) yozilmadi")
        return ApplyOutcome(ok=True, reason=None, commit=short, files=list(files), checks=list(checks),
                            detail=_cut_detail(note))
    except _Abort as ab:
        reason, detail = ab.reason, ab.detail
    except Exception as exc:  # kutilmagan (OSError va h.k.)
        log.exception("apply_plan: kutilmagan xato")
        reason = C.BAJ_PUSH if committed and push else C.BAJ_COMMIT
        detail = "kutilmagan xato: %s" % exc

    errs = _rollback(base, written, originals, meta, created_dirs, committed, token)
    if errs:
        kept = _keep_backup(tdir)
        detail = "%s\n%s: %s\nasl nusxa: %s" % (detail, _QAYTARISH_XATO, "; ".join(errs), kept)
        log.error("REJA qaytarish to'liq emas (%s): %s", token, "; ".join(errs))
    return _fail(reason, files, checks, detail)


# ---------------------------------------------------------------------------
# 3.3 Restart tiklash va /reset
# ---------------------------------------------------------------------------
def _restore_from_state(base: Path, files_meta: Dict[str, dict], token: str) -> List[str]:
    """Faqat biz yozgan (sha256 == new_sha256) fayllar asliga qaytadi; boshqa o'zgarishga tegilmaydi."""
    errs: List[str] = []
    touched = [f for f, m in files_meta.items() if isinstance(m, dict) and m.get("new_sha256")]
    if not touched:
        return errs  # hali hech narsa yozilmagan
    ours: List[str] = []
    for f in touched:
        m = files_meta[f]
        sp = config.safe_repo_path(f, base)
        if not sp.ok:
            errs.append("%s: yo'l ruxsatsiz" % f)
            continue
        cur = file_sha256(base / f)
        if cur == m.get("new_sha256"):
            ours.append(f)
        elif cur != (m.get("sha256") or ""):
            errs.append("%s: keyin boshqa o'zgarish bo'lgan, tegilmadi" % f)
    rc, out, err = _git(base, ["reset", "-q", "--"] + touched)
    if rc != 0 and "fatal" in (out + err).lower():
        errs.append("git reset (unstage): " + _both(out, err))
    for f in ours:
        m = files_meta[f]
        p = base / f
        try:
            if m.get("existed"):
                owner = (int(m["uid"]), int(m["gid"])) if m.get("uid") is not None and m.get("gid") is not None else None
                _atomic_write(p, base64.b64decode(m.get("b64") or ""), m.get("mode"), owner, token)
            elif os.path.lexists(str(p)):
                os.remove(str(p))
        except (OSError, ValueError) as exc:
            errs.append("%s: %s" % (f, exc))
    return errs


def _recover_one(base: Path, state: Optional[dict], token: str) -> Tuple[str, bool]:
    """(SISTEMA ichki matni, qaytarish to'liqmi)."""
    restart = C.sistema(C.SIS_SUPPORT_BAJARILMADI, sabab=C.BAJ_RESTART)
    if not state:
        return restart, True  # ijro holat yozilishidan oldin uzilgan: hech narsa o'zgarmagan
    files_meta = state.get("files") if isinstance(state.get("files"), dict) else {}
    n = len(files_meta or {})
    commit = str(state.get("commit") or "")
    branch = str(state.get("branch") or C.BRANCH)
    stage = state.get("stage")
    if stage == "pushed":
        return C.sistema(C.SIS_SUPPORT_APPROVED, hash=commit[:7], n=n), True
    errs: List[str] = []
    if stage == "committed" and commit:
        if _remote_sha(base, branch) == commit:  # push o'tgan, holat yozilmay qolgan
            return C.sistema(C.SIS_SUPPORT_APPROVED, hash=commit[:7], n=n), True
        if _rev(base, "HEAD") == commit:
            rc, out, err = _git(base, ["reset", "--soft", "HEAD~1"])
            if rc != 0:
                errs.append("git reset --soft: " + _both(out, err))
    errs.extend(_restore_from_state(base, files_meta or {}, token))
    if errs:
        log.error("REJA restart tiklash to'liq emas (%s): %s", token, "; ".join(errs))
    return restart, not errs


def recover_interrupted() -> List[str]:
    """Startda: sup_run_ bor, sup_done_ yo'q -> tiklash + SISTEMA. Yozilgan ichki matnlar qaytadi."""
    written: List[str] = []
    try:
        keys = db.kv_keys(_RUN_PREFIX)
    except Exception:
        log.exception("recover: kv o'qilmadi")
        return written
    base = _repo_base()
    for key in keys:
        token = key[len(_RUN_PREFIX):]
        try:
            if not _TOKEN_RE.match(token):
                continue
            appr_key, _run_key, done_key = _keys(token)
            if db.kv_get(done_key) is not None:
                continue
            tdir = config.SUP_ORIG_DIR / token
            inner, complete = _recover_one(base, _read_state(tdir), token)
            _sis(inner)
            written.append(inner)
            db.kv_set(done_key, config.iso_utc())
            _kv_del_quiet(appr_key)
            if complete:
                _rmtree_quiet(tdir)
            else:
                _keep_backup(tdir)
            _lease_release(C.KV_SUP_EXEC_ACTIVE, token)
            _lease_release(C.KV_SUP_EXEC_LOCK, token)
        except Exception:
            log.exception("recover: token %s tiklanmadi", token)
    return written


def purge_pending() -> int:
    """/reset: kutilayotgan sup_appr_* o'chiriladi (keyin bosilgan [Ha] -> muddat o'tgan)."""
    try:
        return int(db.kv_del_prefix(_APPR_PREFIX) or 0)
    except Exception:
        log.exception("purge_pending: kv o'chirilmadi")
        return 0


# ---------------------------------------------------------------------------
# Qo'lda tekshiruv: python3 -m agents.reja --check <fayl> (DB va Telegram'siz)
# ---------------------------------------------------------------------------
def main(argv: Optional[List[str]] = None) -> int:
    import argparse

    config.configure_logging()
    ap = argparse.ArgumentParser(prog="python3 -m agents.reja",
                                 description="Support REJA blokini DB va Telegram'siz tekshiradi.")
    ap.add_argument("--check", metavar="FAYL", required=True, help="Support javobi yoki blok ichi")
    args = ap.parse_args(argv)
    with open(args.check, encoding="utf-8") as fh:
        text = fh.read()
    inner, _rest = extract_request_approval(text)
    try:
        plan = validate_plan(parse_plan(inner if inner is not None else text))
    except PlanReject as rej:
        print("RAD: %s %s" % (rej.kind, rej.sabab))
        return 1
    payload = build_payload(plan, "tekshiruv")
    size = len(json.dumps(payload, ensure_ascii=False))
    print("hajm: %d (%s)" % (size, C.RAD_HAJM if payload_too_big(payload) else "ok"))
    print(format_preview_html(plan))
    print()
    print(unified_diff(payload))
    return 0


if __name__ == "__main__":
    sys.exit(main())
