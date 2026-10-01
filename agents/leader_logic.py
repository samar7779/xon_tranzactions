"""Leader bot sof mantiqi: JSON parse, delegat, triggerlar, detektorlar, lotinlashtirish.

Faqat contract + stdlib (testlar DB va aiogram'siz ishlaydi).
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional, Tuple

from . import contract as C

_VADA_MAX_S = 7 * 24 * 3600
_VADA_MIN_S = 60

_FIELD_STR_TPL = r'"%s"\s*:\s*"((?:[^"\\]|\\.)*)"'
_VALUE_END_RE = re.compile(
    r'"\s*(?:,\s*"(?:%s)"\s*:|\})' % "|".join(re.escape(k) for k in C.LEADER_JSON_KEYS)
)
_HTML_TEG_RE = re.compile(r"(<[^<>]+>)")


# ---------------------------------------------------------------------------
# Leader JSON (KOD 1.2 8-qadam)
# ---------------------------------------------------------------------------
def looks_like_json(raw: str) -> bool:
    """Xom javob JSON'ga o'xshaydimi (bunday xom matn egasiga chiqmaydi)."""
    s = (raw or "").lstrip()
    return s.startswith("{") or s.startswith("```") or '"human_reply"' in s or '"delegate_to"' in s


def _as_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _finish(obj: Dict[str, Any], parse_error: bool) -> Dict[str, Any]:
    out: Dict[str, Any] = {k: obj.get(k) for k in C.LEADER_JSON_KEYS}
    out["human_reply"] = _as_text(out["human_reply"]) or ""
    out["intent"] = _as_text(out["intent"])
    task = _as_text(out["task_for_agent"])
    if task is not None and task.strip().lower() in C.NULL_DELEGATES:
        task = None
    out["task_for_agent"] = task
    out["parse_error"] = parse_error
    return out


def _loose_unescape(s: str) -> str:
    try:
        return json.loads('"' + s + '"', strict=False)
    except ValueError:
        return s.replace("\\n", "\n").replace('\\"', '"').replace("\\\\", "\\")


def _lenient_fields(text: str) -> Dict[str, Any]:
    """Buzuq JSON'dan satr maydonlarini ajratib olish (qochirilmagan qo'shtirnoq, vergul xatosi)."""
    out: Dict[str, Any] = {}
    for key in C.LEADER_JSON_KEYS:
        m = re.search(_FIELD_STR_TPL % re.escape(key), text)
        if not m:
            continue
        tail = text[m.end():].lstrip()
        if tail[:1] in (",", "}"):
            out[key] = _loose_unescape(m.group(1))
            continue
        # Qiymat ichida qochirilmagan qo'shtirnoq: qiymat keyingi ma'lum kalit yoki '"}' gacha
        start = re.search(r'"%s"\s*:\s*"' % re.escape(key), text)
        end = _VALUE_END_RE.search(text, start.end()) if start else None
        out[key] = _loose_unescape(text[start.end():end.start()] if (start and end) else m.group(1))
    return out


def parse_leader_response(raw: str) -> Dict[str, Any]:
    """1) ```json {..} ```, 2) birinchi '{' .. oxirgi '}', json.loads. Natijada 4 kalit har doim bor.

    Qo'shimcha kalit `parse_error`: True bo'lsa JSON o'qilmadi va human_reply = xom matn.
    Bot JSON'ga o'xshagan xom matnni egasiga ko'rsatmaydi (looks_like_json).
    """
    text = (raw or "").strip()
    candidates = []
    m = C.JSON_FENCE_RE.search(text)
    if m:
        candidates.append(m.group(1))
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        candidates.append(text[i:j + 1])
    for cand in candidates:
        try:
            obj = json.loads(cand, strict=False)
        except ValueError:
            continue
        if isinstance(obj, dict):
            return _finish(obj, False)
    lenient = _lenient_fields(text)
    if "human_reply" in lenient:
        return _finish(lenient, False)
    return _finish({"human_reply": text}, True)


def normalize_delegate(value: Any) -> Optional[str]:
    """None / "null" / "none" / "" -> None; aks holda strip().lower()."""
    if value is None or value is False:
        return None
    s = str(value).strip().lower()
    return None if s in C.NULL_DELEGATES else s


# ---------------------------------------------------------------------------
# Xotira triggeri (KOD 1.2 6-qadam, R14)
# ---------------------------------------------------------------------------
def detect_memory_command(text: str) -> Optional[str]:
    """Xabar BOSHIDA trigger bo'lsa mazmun, aks holda None. Mazmun bo'sh bo'lsa None."""
    m = C.XOTIRA_RE.match(text or "")
    if not m:
        return None
    content = (m.group(2) or "").strip()
    return content or None


# ---------------------------------------------------------------------------
# Va'da detektori (KOD 1.6, R1)
# ---------------------------------------------------------------------------
def detect_promise(text: str) -> Optional[Tuple[str, int]]:
    """(trigger, soniya) yoki None. Muddat: 'N daqiqa/soat' -> shu, 'ertaga' -> 12 soat, aks holda 2 soat."""
    low = C.norm_apostrophe(text or "").lower()
    # Iqtibos ichidagi so'z va'da emas; "va'da" haqidagi javob (eslatmaga javob, uzr) o'zi yangi va'da emas —
    # aks holda eslatma -> javob -> yangi va'da -> eslatma zanjiri (egasi 2026-10-01 xabari).
    low = C.VADA_IQTIBOS_RE.sub(" ", low)
    if C.VADA_OZI in low:
        return None
    trigger = next((t for t in C.VADA_TRIGGERS if t in low), None)
    if trigger is None:
        return None
    seconds = 0
    m = C.VADA_MUDDAT_RE.search(low)
    if m:
        n = int(m.group(1))
        seconds = n * 3600 if m.group(2).lower() == "soat" else n * 60
    if seconds <= 0:
        seconds = C.VADA_ERTAGA_S if C.VADA_ERTAGA in low else C.VADA_DEFAULT_S
    return trigger, max(_VADA_MIN_S, min(seconds, _VADA_MAX_S))


# ---------------------------------------------------------------------------
# Yolg'on detektori (Q8, KOD 1.3)
# ---------------------------------------------------------------------------
def strip_for_lie_check(text: str) -> str:
    """REQUEST_APPROVAL, WRITE_MEMORY bloklari, 'Teacher uchun:' qatorlari, kod va backtick olib tashlanadi."""
    t = text or ""
    t = C.REQUEST_APPROVAL_RE.sub(" ", t)
    t = C.WRITE_MEMORY_RE.sub(" ", t)
    t = C.TEACHER_UCHUN_STRIP_RE.sub("", t)
    t = C.CODE_FENCE_RE.sub(" ", t)
    t = C.BACKTICK_RE.sub(" ", t)
    return t


def has_lie_words(text: str) -> bool:
    low = C.norm_apostrophe(text or "").lower()
    return any(w in low for w in C.YOLGON_SOZLAR)


def is_lie(text: str, applied_count: int) -> bool:
    return applied_count == 0 and has_lie_words(strip_for_lie_check(text))


# ---------------------------------------------------------------------------
# Reaksiya (leader.md 16)
# ---------------------------------------------------------------------------
def extract_react(text: str) -> Tuple[str, Optional[str]]:
    """[REACT:<belgi>] bloklari matndan olinadi. Ro'yxatda yo'q belgi jim tashlanadi."""
    src = text or ""
    emoji: Optional[str] = None
    values = set(C.REACT_MAP.values())
    for m in C.REACT_RE.finditer(src):
        raw = m.group(1).strip()
        name = raw.strip(":").lower()
        if name in C.REACT_MAP:
            emoji = emoji or C.REACT_MAP[name]
        elif raw in values:
            emoji = emoji or raw
    return C.REACT_RE.sub("", src).strip(), emoji


# ---------------------------------------------------------------------------
# Kirill -> lotin (<code>, <pre> va HTML teg ichiga tegmaydi)
# ---------------------------------------------------------------------------
def _translit(segment: str) -> str:
    def rep(m: "re.Match[str]") -> str:
        ch = m.group(0)
        lat = C.KIRILL_LOTIN[ch]
        if len(lat) > 1 and ch.isupper():
            i = m.start()
            nxt = segment[i + 1:i + 2]
            prv = segment[i - 1:i] if i > 0 else ""
            if (nxt.isalpha() and nxt.isupper()) or (not nxt.isalpha() and prv.isalpha() and prv.isupper()):
                return lat.upper()
        return lat
    return C.KIRILL_RE.sub(rep, segment)


def normalize_latin(text: str) -> str:
    """Kirill harflarni o'zbek lotiniga o'giradi. <code>/<pre> ichi va teg atributlari o'zgarmaydi."""
    src = text or ""
    if not C.KIRILL_RE.search(src):
        return src
    parts = C.KOD_TEGLAR_RE.split(src)
    out = []
    for idx, part in enumerate(parts):
        if idx % 2 == 1:  # <code>..</code> yoki <pre>..</pre>
            out.append(part)
            continue
        pieces = _HTML_TEG_RE.split(part)
        out.append("".join(p if k % 2 == 1 else _translit(p) for k, p in enumerate(pieces)))
    return "".join(out)
