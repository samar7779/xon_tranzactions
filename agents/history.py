"""Suhbat tarixi va topshiriq prefikslari (KOD 1.5, Q9, Q10, Q11, Q12).

- Holat Python dict'da EMAS: kv_store['leader_chat_history'] (JSON, 20 ta, har matn 2000 belgi).
  Bot va `python3 -m agents.<modul>` jarayonlari bir tarixni bo'lishadi (FOR UPDATE bilan).
- Har yozuv agents.agent_chat_log ga ham tushadi (Teacher kunlik manbasi, Q10).
- `[SISTEMA: ...]` yozuvini faqat add_system yaratadi. add_history har matnda `[SISTEMA` ni
  `(SISTEMA` ga, qator boshidagi SHEFIM:/MEN (LEADER): prefikslarini buzadi (Q12).
- DB yo'q bo'lsa logga yoziladi, jarayon davom etadi.

Qo'lda ko'rish: python3 -m agents.history  (OXIRGI SUHBAT blokini chop etadi)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from . import config
from . import contract as C
from . import db

log = logging.getLogger("agents.history")

CHAT_LOG_TEXT_MAX = 10000  # agent_chat_log matni (bitta Telegram xabari 4096 dan kam)
_NATIJA_OXIR_BUZILGAN = "(NATIJA TUGADI)"


# ---------------------------------------------------------------------------
# Tozalash (sof)
# ---------------------------------------------------------------------------
def neutralize(text: str) -> str:
    """[SISTEMA -> (SISTEMA; qator boshidagi SHEFIM:/SHEFIM (FORWARD):/MEN (LEADER): -> '... -'."""
    t = "" if text is None else str(text)
    t = C.SISTEMA_FAKE_RE.sub("(SISTEMA", t)
    return C.PREFIX_FAKE_RE.sub(r"\1\2 -", t)


def clean_external(text: str) -> str:
    """Tashqi matn: neytrallash + yangi qatorlar bo'shliqqa, [ ] -> ( )."""
    return C.clean_dynamic(neutralize(text))


# ---------------------------------------------------------------------------
# Saqlash (kv_store + agent_chat_log)
# ---------------------------------------------------------------------------
def _loads(value: Any) -> List[Dict[str, Any]]:
    try:
        items = json.loads(value or "[]")
    except (TypeError, ValueError):
        return []
    return [x for x in items if isinstance(x, dict)] if isinstance(items, list) else []


def _row_value(row: Any) -> Any:
    if row is None:
        return None
    if isinstance(row, dict):
        return row.get("value")
    return row[0]


def _append(item: Dict[str, Any], chat_text: str) -> None:
    """Bitta tranzaksiyada: tarixga qo'shish (kesish bilan) + chat_log qatori."""
    now = config.now_utc()
    item = dict(item, ts=config.iso_utc(now))
    try:
        with db.tx("agents") as cur:
            cur.execute(
                "INSERT INTO agents.kv_store (k, value, updated_at) VALUES (%s, %s, %s) "
                "ON CONFLICT (k) DO NOTHING",
                (C.KV_HISTORY, "[]", now),
            )
            cur.execute("SELECT value FROM agents.kv_store WHERE k = %s FOR UPDATE", (C.KV_HISTORY,))
            items = _loads(_row_value(cur.fetchone()))
            items.append(item)
            items = items[-C.HISTORY_MAX:]
            cur.execute(
                "UPDATE agents.kv_store SET value = %s, updated_at = %s WHERE k = %s",
                (json.dumps(items, ensure_ascii=False), now, C.KV_HISTORY),
            )
            cur.execute(
                "INSERT INTO agents.agent_chat_log (ts, role, text, is_forward) VALUES (%s, %s, %s, %s)",
                (now, item["r"], chat_text[:CHAT_LOG_TEXT_MAX], bool(item.get("f"))),
            )
    except Exception as exc:  # DB yo'q yoki xato: bot ishlashda davom etadi
        log.warning("tarix yozilmadi: %s: %s", exc.__class__.__name__, str(exc)[:200])


def add_history(role: str, text: str, *, is_forward: bool = False) -> None:
    """role: owner | leader. Har matn neytrallanadi; egasining forwardi tashqi matndek tozalanadi."""
    if role not in (C.ROLE_OWNER, C.ROLE_LEADER):
        raise ValueError("add_history role: owner | leader")
    fwd = bool(is_forward) and role == C.ROLE_OWNER
    t = clean_external(text) if fwd else neutralize(text)
    t = t.strip()
    if not t:
        return
    _append({"r": role, "t": t[:C.HISTORY_ITEM_MAX], "f": fwd}, t)


def add_system(inner: str) -> None:
    """inner = C.sistema(...) natijasi (allaqachon tozalangan). Tarixda [SISTEMA: inner] bo'lib chiqadi."""
    t = ("" if inner is None else str(inner)).strip()
    if not t:
        return
    _append({"r": C.ROLE_SYSTEM, "t": t[:C.HISTORY_ITEM_MAX], "f": False}, t)


def get_history() -> List[Dict[str, Any]]:
    """[{"r","t","f","ts"}], eng eskisi birinchi. Xatoda []."""
    try:
        return _loads(db.kv_get(C.KV_HISTORY))
    except Exception as exc:
        log.warning("tarix o'qilmadi: %s: %s", exc.__class__.__name__, str(exc)[:200])
        return []


def clear_history() -> None:
    """kv tarixi tozalanadi (agent_chat_log qoladi)."""
    try:
        db.kv_set(C.KV_HISTORY, "[]")
    except Exception as exc:
        log.warning("tarix tozalanmadi: %s: %s", exc.__class__.__name__, str(exc)[:200])


# ---------------------------------------------------------------------------
# Ko'rinish (sof)
# ---------------------------------------------------------------------------
def render_history(items: Sequence[Dict[str, Any]]) -> List[str]:
    """'SHEFIM: ...' | 'SHEFIM (FORWARD): ...' | 'MEN (LEADER): ...' | '[SISTEMA: ...]'."""
    lines: List[str] = []
    for it in items:
        role = it.get("r")
        text = str(it.get("t") or "")
        if role == C.ROLE_OWNER:
            lines.append((C.PFX_SHEFIM_FWD if it.get("f") else C.PFX_SHEFIM) + text)
        elif role == C.ROLE_LEADER:
            lines.append(C.PFX_LEADER + text)
        elif role == C.ROLE_SYSTEM:
            lines.append(C.sistema_line(text))
    return lines


def history_block(items: Sequence[Dict[str, Any]]) -> str:
    """OXIRGI SUHBAT bloki (sof)."""
    lines = render_history(items) or [C.OXIRGI_SUHBAT_BOSH_MATN]
    return "\n".join([C.OXIRGI_SUHBAT_BOSH] + lines + [C.OXIRGI_SUHBAT_OXIR])


def history_context(n: int = C.HISTORY_CONTEXT_N) -> str:
    """Oxirgi n xabar (SISTEMA bilan) OXIRGI SUHBAT bloki ichida."""
    items = get_history()
    return history_block(items[-n:] if n > 0 else [])


# ---------------------------------------------------------------------------
# Topshiriq quruvchilar (Q9, Q11, KOD 1.2, 1.3). history=None -> history_context()
# ---------------------------------------------------------------------------
def _hist(history: Optional[str]) -> str:
    return history_context() if history is None else history


def muhim_kontekst(reply_quote: Optional[str]) -> Optional[str]:
    """MUHIM KONTEKST qatori: egasi reply qilgan xabar matni tashqi matn (clean_external),
    MUHIM_KONTEKST_MAX gacha. Iqtibos bo'sh bo'lsa None."""
    if not reply_quote or not reply_quote.strip():
        return None
    quote = clean_external(reply_quote).strip()[:C.MUHIM_KONTEKST_MAX]
    return C.MUHIM_KONTEKST_TPL.format(iqtibos=quote)


def build_leader_task(text: str, *, is_fwd: bool, image_paths: Sequence[str] = (),
                      reply_quote: Optional[str] = None, now: Optional[datetime] = None,
                      history: Optional[str] = None) -> str:
    """FORWARD -> rasm -> HOZIRGI VAQT -> OXIRGI SUHBAT (+bo'sh qator) -> MUHIM KONTEKST -> matn."""
    parts: List[str] = []
    if is_fwd:
        parts.append(C.FORWARD_QATOR)
    for path in image_paths:
        parts.append(C.fayl_qatori(path))
    parts.append(config.now_line(now))
    parts.append(_hist(history) + "\n")
    kontekst = muhim_kontekst(reply_quote)
    if kontekst:
        parts.append(kontekst)
    parts.append(clean_external(text) if is_fwd else neutralize(text))
    return "\n".join(parts)


def build_sub_task(body: str, *, header: Optional[str] = None, is_fwd: bool = False,
                   image_paths: Sequence[str] = (), reply_quote: Optional[str] = None,
                   now: Optional[datetime] = None, history: Optional[str] = None) -> str:
    """Rejim sarlavhasi -> FORWARD -> rasm -> HOZIRGI VAQT -> OXIRGI SUHBAT (+bo'sh qator)
    -> MUHIM KONTEKST (egasi reply qilgan bo'lsa) -> topshiriq.

    body o'zgartirilmaydi (Teacher kunlik kirishidagi haqiqiy [SISTEMA: ...] qatorlari saqlansin);
    tashqi matnni chaqiruvchi tozalaydi. reply_quote esa shu yerda tozalanadi (Leader'dagi kabi).
    """
    parts: List[str] = []
    if header:
        parts.append(header)
    if is_fwd:
        parts.append(C.FORWARD_QATOR)
    for path in image_paths:
        parts.append(C.fayl_qatori(path))
    parts.append(config.now_line(now))
    parts.append(_hist(history) + "\n")
    kontekst = muhim_kontekst(reply_quote)
    if kontekst:
        parts.append(kontekst)
    parts.append(body or "")
    return "\n".join(parts)


def build_synth_task(agent: str, result_text: str, *, is_fwd: bool = False,
                     now: Optional[datetime] = None, history: Optional[str] = None) -> str:
    """FORWARD -> HOZIRGI VAQT -> OXIRGI SUHBAT (+bo'sh qator) -> natija bloki -> ohang ko'rsatmasi."""
    parts: List[str] = []
    if is_fwd:
        parts.append(C.FORWARD_QATOR)
    parts.append(config.now_line(now))
    parts.append(_hist(history) + "\n")
    result = neutralize(result_text or "").replace(C.SYNTH_BLOK_OXIR, _NATIJA_OXIR_BUZILGAN)
    parts.append(
        C.SYNTH_BOSH_TPL.format(agent=agent) + "\n"
        + C.SYNTH_BLOK_BOSH_TPL.format(agent=agent) + "\n"
        + result + "\n"
        + C.SYNTH_BLOK_OXIR + "\n\n"
        + C.SYNTH_OHANG
    )
    return "\n".join(parts)


def main(argv: Optional[List[str]] = None) -> int:
    """python3 -m agents.history — OXIRGI SUHBAT blokini chop etadi."""
    config.configure_logging()
    print(history_context())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
