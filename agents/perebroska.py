"""AI Perebroska — TR Support (egasi qarori, 2026-10-05): perebroska arizasi (fayl) botga kelsa, panel
OplatyKv > "+" > AI Perebroska bilan AYNAN bir xil ishlaydi.

Oqim (LLM'siz; Leader egasining xabari/faylini `PEREBROSKA:` qatoriga aylantiradi):
1. `PEREBROSKA: fayl=<leader_bot_...pdf> [tasdiq=<ism>] [izoh=<matn>]`. Fayl berilmasa shu xabardagi fayl olinadi.
2. POST agent-bridge/perebroska/tahlil -> panel agenti (analyzePerereboskaAriza) arizani o'qiydi: manba va maqsad
   shartnoma(lar), summa, arizachi, ogohlantirishlar. Natija fayl bo'yicha PEREBROSKA_TAHLIL_TTL_S keshlanadi
   (tasdiqlovchi ismi keyin aytilsa AI qayta chaqirilmaydi).
3. Yaratib bo'lmaydigan holat (shartnoma topilmadi, obyekt boshqa, summa teng emas, qoldiq yetmaydi) -> sababi, tasdiq yo'q.
   Aks holda ko'rinish + "tasdiqlayman" (tugmasiz). Tasdiqlovchi ismi majburiy.
4. "tasdiqlayman" -> POST agent-bridge/perebroska/yarat (createPerereboska, panelda "Yaratish" bilan bir xil) -> natija.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
import secrets
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import config
from . import contract as C
from . import db
from . import tuzatish as TZ

log = logging.getLogger("agents.perebroska")

_KALITLAR = ("fayl", "tasdiq", "izoh")
_KALIT_RE = re.compile(r"(?i)\b(%s)\s*=\s*" % "|".join(_KALITLAR))
_FAYL_RE = re.compile(r"^leader_bot_([0-9a-f]{16})\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$")
_O_QILADI_RE = re.compile(r"\.(jpg|jpeg|png|webp|gif|pdf)$")     # AI Perebroska faqat PDF va rasmni o'qiydi
_TOKEN_RE = re.compile(r"^[0-9a-f]{16}$")
_BG_TASKS: set = set()


@dataclass
class Sorov:
    fayl: Optional[str] = None
    tasdiq: Optional[str] = None
    izoh: Optional[str] = None


def parse(text: Any) -> Optional[Sorov]:
    m = C.PEREBROSKA_RE.search(str(text or ""))
    if not m:
        return None
    body = m.group(1)
    s = Sorov()
    topilgan = list(_KALIT_RE.finditer(body))
    for i, km in enumerate(topilgan):
        oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(body)
        v = TZ._qiymat(body[km.end():oxir])
        k = km.group(1).lower()
        if v is not None and getattr(s, k) is None:
            setattr(s, k, v)
    if s.fayl:
        s.fayl = s.fayl.split(" ")[0].strip("\"'")
    return s


def _fayl_nomi(s: Sorov, rasmlar: Sequence[str]) -> Optional[str]:
    for c in ([s.fayl] if s.fayl else []) + [str(p) for p in rasmlar]:
        base = os.path.basename(str(c).strip())
        if _FAYL_RE.match(base) and (config.UPLOADS_DIR / base).is_file():
            return base
    return None


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _toza(s: Any, n: int = 400) -> str:
    t = re.sub(r"[*_`#>]+", "", str(s or ""))
    t = re.sub(r"\s*\n\s*", "; ", t).strip(" ;")
    return t[:n]


def toskiqlar(r: Dict[str, Any]) -> List[str]:
    """Yaratib bo'lmaydigan sabablar (createPerereboska ham rad etadi) — bo'lsa tasdiq so'ralmaydi."""
    e = r.get("extracted") or {}
    out: List[str] = []
    if not e.get("fromContractNo"):
        out.append("manba shartnoma aniqlanmadi")
    elif not e.get("fromFound"):
        out.append("manba shartnoma %s topilmadi (CRM va to'lovlarda yo'q)" % e["fromContractNo"])
    dests = e.get("destinations") or []
    if not dests:
        out.append("maqsadli shartnoma aniqlanmadi")
    for d in dests:
        if not d.get("found"):
            out.append("maqsadli shartnoma %s topilmadi" % d.get("contractNo"))
        elif e.get("objectName") and d.get("object") and d["object"] != e["objectName"]:
            out.append("obyekt mos emas: %s (%s), manba %s" % (d.get("contractNo"), d["object"], e["objectName"]))
        if _f(d.get("amount")) <= 0:
            out.append("maqsad summasi aniqlanmadi: %s" % d.get("contractNo"))
    total = _f(e.get("totalAmount"))
    if total <= 0:
        out.append("o'tkaziladigan summa aniqlanmadi")
    elif dests and abs(sum(_f(d.get("amount")) for d in dests) - total) > 0.01:
        out.append("maqsad summalari jami o'tkaziladigan summaga teng emas")
    if r.get("balanceEnough") is False:
        out.append("manba qoldig'i yetarli emas")
    return out


def tahlil_html(r: Dict[str, Any], tasdiq: Optional[str], tosiq: List[str]) -> str:
    e, ex = r.get("extracted") or {}, TZ._e
    q = ["<b>AI Perebroska</b> — %s" % ("tasdiqlang" if not tosiq and tasdiq else "agent tahlili"), ""]
    q.append("Manba: <b>%s</b> — %s; to'langan %s so'm" % (
        ex(e.get("fromContractNo") or "-"), ex(", ".join(x for x in (e.get("fromClient"), e.get("objectName")) if x) or "-"),
        TZ._pul(e.get("fromBalance")) if e.get("fromBalance") is not None else "-"))
    q.append("O'tkaziladigan summa: <b>%s so'm</b>%s" % (
        TZ._pul(e.get("totalAmount")), " (agent arizadagi summani tuzatdi)" if e.get("amountCorrected") else ""))
    q.append("Maqsad:")
    for i, d in enumerate(e.get("destinations") or [], 1):
        q.append("%d. <b>%s</b> — %s so'm (%s)%s" % (
            i, ex(d.get("contractNo") or "-"), TZ._pul(d.get("amount")),
            ex(", ".join(x for x in (d.get("client"), d.get("object")) if x) or "-"),
            "" if d.get("found") else " — TOPILMADI"))
    mos = e.get("applicantMatchesHolder")
    q.append("Arizachi: %s%s" % (ex(e.get("applicantName") or "o'qilmadi"),
                                 {True: " (maqsad egasiga mos)", False: " (maqsad egasiga MOS EMAS)"}.get(mos, "")))
    q.append("Agent xulosasi: %s" % ("hujjat mos" if r.get("agentState") == "verified" else "tekshirish kerak"))
    ogoh = [w for w in (r.get("warnings") or []) if w]
    if ogoh:
        q.append("Ogohlantirishlar:")
        q += ["• " + ex(_toza(w, 300)) for w in ogoh[:8]]
    if e.get("notes"):
        q.append("Agent izohi: " + ex(_toza(e["notes"])))
    q.append("")
    if tosiq:
        q.append("<b>Yaratib bo'lmaydi:</b> " + ex("; ".join(tosiq)) + ".")
        q.append("Panelda OplatyKv > + > AI Perebroska orqali shu arizani tekshiring.")
    elif not tasdiq:
        q.append(ex(C.MSG_PEREBROSKA_KIM))
    else:
        q.append("Tasdiqladi: <b>%s</b>. Yaratilsa OplatyKv'da manbadan minus, maqsadga plus qator qo'shiladi;"
                 " orqaga qaytarish panelda (AI Perebroska > Tarix)." % ex(tasdiq))
        q += ["", ex(C.TASDIQ_YOZING.format(daq=max(1, C.APPROVAL_TTL_S // 60)))]
    return "\n".join(q)


# ---------------------------------------------------------------------------
# Oqim
# ---------------------------------------------------------------------------
async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None, rasmlar: Sequence[str] = ()) -> bool:
    """`PEREBROSKA:` qatori bo'lsa ishlaydi va True. Hech qachon exception chiqarmaydi."""
    s = parse(text)
    if s is None:
        return False
    try:
        await _handle(s, outbox, reply_to, list(rasmlar or ()))
    except Exception:  # noqa: BLE001
        log.exception("perebroska yiqildi")
        await TZ._say(outbox, "Perebroska tayyorlanmadi: ichki xato. Qayta urinib ko'ring.", reply_to=reply_to)
    return True


async def _tahlil(fayl: str, outbox: Any, reply_to: Optional[int]) -> Optional[Dict[str, Any]]:
    """Kesh (fayl bo'yicha) yoki AI tahlili. Xato bo'lsa egasiga aytiladi va None."""
    m = _FAYL_RE.match(fayl)
    key = C.kv_key(C.KV_PB_TAHLIL, token=m.group(1)) if m else ""
    kesh = await asyncio.to_thread(db.kv_get_json, key) if key else None
    if isinstance(kesh, dict) and kesh.get("fayl") == fayl and \
            config.now_utc().timestamp() - float(kesh.get("created_ts") or 0) <= C.PEREBROSKA_TAHLIL_TTL_S:
        return kesh.get("r")
    await TZ._say(outbox, C.MSG_PEREBROSKA_TAHLIL, reply_to=reply_to)
    try:
        r = await asyncio.to_thread(TZ._koprik, C.PEREBROSKA_KOPRIK_TAHLIL, body={"fayl": fayl},
                                    timeout=C.PEREBROSKA_TAHLIL_TIMEOUT_S)
    except TZ.KoprikXato as exc:
        await TZ._say(outbox, "AI Perebroska tahlili bajarilmadi: %s." % exc.sabab, reply_to=reply_to)
        return None
    if key:
        await asyncio.to_thread(db.kv_set_json, key, {"fayl": fayl, "created_ts": config.now_utc().timestamp(), "r": r})
    return r


async def _handle(s: Sorov, outbox: Any, reply_to: Optional[int], rasmlar: List[str]) -> None:
    say = TZ._say
    fayl = _fayl_nomi(s, rasmlar)
    if not fayl:
        await say(outbox, "Perebroska arizasi faylini yuboring (PDF yoki rasm): bot uni AI Perebroska agentiga beradi.",
                  reply_to=reply_to)
        return
    if not _O_QILADI_RE.search(fayl):
        await say(outbox, "AI Perebroska faqat PDF yoki rasmni o'qiydi. Arizani PDF yoki rasm qilib yuboring.",
                  reply_to=reply_to)
        return
    r = await _tahlil(fayl, outbox, reply_to)
    if r is None:
        return
    tosiq = toskiqlar(r)
    tasdiq = (s.tasdiq or "").strip() or None
    matn = tahlil_html(r, tasdiq, tosiq)
    hist = re.sub(r"<[^>]+>", "", html.unescape(matn))
    if tosiq or not tasdiq:
        await say(outbox, matn, html_mode=True, reply_to=reply_to, hist=hist)
        return
    e = r.get("extracted") or {}
    dests = [{"contractNo": str(d.get("contractNo")), "amount": _f(d.get("amount"))} for d in e.get("destinations") or []]
    sana = str(e.get("date") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sana):
        sana = config.fmt_local(config.now_utc(), "%Y-%m-%d")
    token = secrets.token_hex(8)
    payload = {
        "token": token, "created_ts": config.now_utc().timestamp(), "tasdiq": tasdiq[:120],
        "body": {"fayl": fayl, "fromContractNo": e.get("fromContractNo"), "amount": round(sum(d["amount"] for d in dests), 2),
                 "date": sana, "destinations": dests, "agentState": r.get("agentState"),
                 "agentReason": r.get("agentReason"), "agentData": e, "tasdiq": tasdiq[:120],
                 "izoh": (s.izoh or None)},
    }
    key = C.kv_key(C.KV_PB_APPR, token=token)
    await asyncio.to_thread(db.kv_set_json, key, payload)
    mid = await say(outbox, matn, html_mode=True, reply_to=reply_to, hist=hist)
    if mid is None:
        await asyncio.to_thread(db.kv_del, key)
    else:
        payload["mid"] = mid
        await asyncio.to_thread(db.kv_set_json, key, payload)


def kutilayotgan() -> List[Tuple[str, Dict[str, Any]]]:
    out: List[Tuple[str, Dict[str, Any]]] = []
    for key in db.kv_keys(C.KV_PB_APPR.split("{", 1)[0]):
        p = db.kv_get_json(key)
        if isinstance(p, dict) and _TOKEN_RE.match(str(p.get("token") or "")) and not TZ._eskirgan(p):
            out.append((str(p["token"]), p))
    return out


async def decide(token: str, approve: bool, outbox: Any, message_id: Optional[int]) -> str:
    """Matnli tasdiq ("tasdiqlayman" / "yo'q"). Bir martalik (pb_run_<token> claim). Toast qaytaradi."""
    if not _TOKEN_RE.match(token or ""):
        return C.MSG_MUDDAT_OTGAN
    appr, run = C.kv_key(C.KV_PB_APPR, token=token), C.kv_key(C.KV_PB_RUN, token=token)
    payload = await asyncio.to_thread(db.kv_get_json, appr)
    if not isinstance(payload, dict) or payload.get("token") != token:
        return C.MSG_MUDDAT_OTGAN
    if not await asyncio.to_thread(db.kv_claim, run, config.iso_utc()):
        return "Bu so'rov allaqachon hal qilingan."
    await asyncio.to_thread(db.kv_del, appr)
    if TZ._eskirgan(payload):
        await TZ._say(outbox, "Tasdiq muddati o'tdi. Perebroska yaratilmadi, qaytadan so'rang.")
        return C.MSG_MUDDAT_OTGAN
    if not approve:
        await TZ._say(outbox, C.MSG_PEREBROSKA_BEKOR)
        return C.MSG_PEREBROSKA_BEKOR
    task = asyncio.create_task(_yarat(payload, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return C.MSG_PEREBROSKA_QABUL


def natija_matni(r: Dict[str, Any], tasdiq: str) -> str:
    q = ["Perebroska yaratildi (tasdiq: %s), %s so'm:" % (tasdiq, TZ._pul(r.get("amount")))]
    for x in r.get("qatorlar") or []:
        summa = _f(x.get("summa"))
        q.append("• %s: %s%s so'm, %s%s" % (
            x.get("contractNo") or "-", "+" if summa > 0 else "", TZ._pul(summa),
            TZ._sana(x.get("sana")).split(" ")[0] if x.get("sana") else "-",
            (" — " + ", ".join(v for v in (x.get("mijoz"), x.get("obyekt")) if v)) if (x.get("mijoz") or x.get("obyekt")) else ""))
    q.append("OplatyKv'ga %d qator qo'shildi. Tarix va orqaga qaytarish: OplatyKv > + > AI Perebroska > Tarix." % len(
        r.get("qatorlar") or []))
    return "\n".join(q)


async def _yarat(payload: Dict[str, Any], outbox: Any) -> None:
    try:
        r = await asyncio.to_thread(TZ._koprik, C.PEREBROSKA_KOPRIK_YARAT, body=payload.get("body") or {},
                                    timeout=C.PEREBROSKA_YARAT_TIMEOUT_S)
    except TZ.KoprikXato as exc:
        await TZ._say(outbox, "Perebroska yaratilmadi: %s. Panelda AI Perebroska orqali tekshiring." % exc.sabab)
        return
    except Exception:  # noqa: BLE001
        log.exception("perebroska yarat yiqildi")
        await TZ._say(outbox, "Perebroska yaratilmadi: ichki xato. Panelda AI Perebroska > Tarix ni tekshiring.")
        return
    await TZ._say(outbox, natija_matni(r, str(payload.get("tasdiq") or "-")))


def purge_pending() -> int:
    return db.kv_del_prefix(C.KV_PB_APPR.split("{", 1)[0])
