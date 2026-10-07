"""AI Perebroska — TR Support (egasi qarori, 2026-10-05): perebroska arizasi (fayl) botga kelsa, panel
OplatyKv > "+" > AI Perebroska bilan AYNAN bir xil ishlaydi. Egasi qarori (2026-10-07): TASDIQ SO'RALMAYDI —
to'siq bo'lmasa bot darrov yaratadi va natijani formatlangan xabar bilan yuboradi.

Oqim (LLM'siz; Leader egasining xabari/faylini `PEREBROSKA:` qatoriga aylantiradi):
1. `PEREBROSKA: fayl=<leader_bot_...pdf> [tasdiq=<ism>] [izoh=<matn>]`. Fayl berilmasa shu xabardagi fayl olinadi.
2. POST agent-bridge/perebroska/tahlil -> panel agenti (analyzePerereboskaAriza) arizani o'qiydi: manba va maqsad
   shartnoma(lar), summa, arizachi, ogohlantirishlar.
3. To'siq bo'lsa (shartnoma topilmadi, obyekt boshqa, summa teng emas, qoldiq yetmaydi, TAKROR bo'lishi mumkin) —
   yaratilmaydi, sababi aytiladi.
4. Aks holda darrov POST agent-bridge/perebroska/yarat (createPerereboska, panelda "Yaratish" bilan bir xil) ->
   natija kartasi (manba, obyekt, summa, maqsadlar, OplatyKv qatorlari, guruh ID).
Himoya: bir fayl bo'yicha bir marta (pb_yaratildi_<hex> claim) — qayta yuborilsa ikkinchi marta yaratilmaydi.
"""
from __future__ import annotations

import asyncio
import html
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from . import config
from . import contract as C
from . import db
from . import tuzatish as TZ

log = logging.getLogger("agents.perebroska")

_KALITLAR = ("fayl", "tasdiq", "izoh")
_KALIT_RE = re.compile(r"(?i)\b(%s)\s*=\s*" % "|".join(_KALITLAR))
_FAYL_RE = re.compile(r"^leader_bot_([0-9a-f]{16})\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$")
_O_QILADI_RE = re.compile(r"\.(jpg|jpeg|png|webp|gif|pdf)$")     # AI Perebroska faqat PDF va rasmni o'qiydi


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


def _kun(iso: Any) -> str:
    dt = config.parse_iso(str(iso or ""))
    return config.fmt_local(dt, "%d.%m.%Y") if dt else "-"


def toskiqlar(r: Dict[str, Any]) -> List[str]:
    """Yaratilmaydigan sabablar. createPerereboska rad etadiganlari + TAKROR (tasdiqsiz rejimda avtomat yaratilmaydi)."""
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
    takror = r.get("duplicates") or []
    if takror:
        out.append("takror bo'lishi mumkin: %s dan shu summada allaqachon %d ta perebroska bor (%s)" % (
            e.get("fromContractNo") or "-", len(takror), ", ".join(_kun(x.get("date")) for x in takror[:5])))
    return out


def _qism_tahlil(r: Dict[str, Any]) -> List[str]:
    """Agent tahlili (arizachi, xulosa, ogohlantirishlar) — natija va rad kartasining umumiy qismi."""
    e, ex = r.get("extracted") or {}, TZ._e
    q: List[str] = []
    mos = e.get("applicantMatchesHolder")
    q.append("Arizachi: %s%s" % (ex(e.get("applicantName") or "o'qilmadi"),
                                 {True: " (maqsad egasiga mos)", False: " (maqsad egasiga MOS EMAS)"}.get(mos, "")))
    q.append("Agent xulosasi: %s%s" % ("hujjat mos" if r.get("agentState") == "verified" else "tekshirish kerak",
                                       " (agent arizadagi summani tuzatdi)" if e.get("amountCorrected") else ""))
    ogoh = [w for w in (r.get("warnings") or []) if w]
    if ogoh:
        q.append("Ogohlantirishlar:")
        q += ["• " + ex(_toza(w, 300)) for w in ogoh[:8]]
    return q


def rad_html(r: Dict[str, Any], tosiq: List[str]) -> str:
    """To'siq bo'lsa: agent o'qigani + sabab. Hech narsa yaratilmaydi."""
    e, ex = r.get("extracted") or {}, TZ._e
    q = ["<b>Perebroska yaratilmadi</b>", ""]
    q.append("Manba: <code>%s</code> — %s" % (ex(e.get("fromContractNo") or "-"), ex(e.get("fromClient") or "-")))
    if e.get("objectName"):
        q.append("Obyekt: <b>%s</b>" % ex(e["objectName"]))
    q.append("Summa: <b>%s so'm</b>" % TZ._pul(e.get("totalAmount")))
    dests = e.get("destinations") or []
    q.append("")
    q.append("Maqsad (%d):" % len(dests))
    for d in dests:
        q.append("• <code>%s</code> · %s so'm — %s%s" % (
            ex(d.get("contractNo") or "-"), TZ._pul(d.get("amount")), ex(d.get("client") or "-"),
            "" if d.get("found") else " (TOPILMADI)"))
    q.append("")
    q += _qism_tahlil(r)
    q += ["", "<b>Sabab:</b> " + ex("; ".join(tosiq)) + ".",
          ex("Panelda OplatyKv > + > AI Perebroska orqali shu arizani tekshiring.")]
    return "\n".join(q)


def natija_html(t: Dict[str, Any], r: Dict[str, Any], kim: str) -> str:
    """Yaratilgandan keyin: panel guruh xabari tuzilishida (manba, obyekt, summa, maqsadlar, kim, ID) + OplatyKv."""
    e, ex = t.get("extracted") or {}, TZ._e
    qatorlar = r.get("qatorlar") or []
    manba = next((x for x in qatorlar if _f(x.get("summa")) < 0), None) or {}
    maqsad = [x for x in qatorlar if _f(x.get("summa")) > 0]
    q = ["<b>Perebroska yaratildi</b>", ""]
    q.append("Manba: <code>%s</code> — %s" % (ex(manba.get("contractNo") or e.get("fromContractNo") or "-"),
                                            ex(manba.get("mijoz") or e.get("fromClient") or "-")))
    obyekt = manba.get("obyekt") or e.get("objectName")
    if obyekt:
        q.append("Obyekt: <b>%s</b>" % ex(obyekt))
    q.append("Summa: <b>%s so'm</b>" % TZ._pul(r.get("amount")))
    q.append("Sana: %s" % _kun(manba.get("sana") or (maqsad[0].get("sana") if maqsad else None)))
    q.append("")
    q.append("Maqsad (%d):" % len(maqsad))
    for x in maqsad:
        q.append("• <code>%s</code> · +%s so'm — %s" % (ex(x.get("contractNo") or "-"), TZ._pul(x.get("summa")),
                                                     ex(x.get("mijoz") or "-")))
    q.append("")
    q += _qism_tahlil(t)
    q.append("")
    q.append("OplatyKv: %d qator qo'shildi (manba %s, maqsad +%s so'm)." % (
        len(qatorlar), TZ._pul(manba.get("summa")) if manba else "-", TZ._pul(sum(_f(x.get("summa")) for x in maqsad))))
    q.append("Kim: TR Support (%s)" % ex(kim))
    q.append("Guruh ID: <code>%s</code>" % ex(r.get("groupId") or "-"))
    q.append(ex("Orqaga qaytarish: OplatyKv > + > AI Perebroska > Tarix."))
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
        await TZ._say(outbox, "Perebroska bajarilmadi: ichki xato. Panelda AI Perebroska > Tarix ni tekshiring.",
                      reply_to=reply_to)
    return True


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
    hex_ = _FAYL_RE.match(fayl).group(1)          # type: ignore[union-attr]
    belgi = C.kv_key(C.KV_PB_YARATILDI, token=hex_)
    oldin = await asyncio.to_thread(db.kv_get_json, belgi)
    if oldin is not None:
        g = oldin.get("groupId") if isinstance(oldin, dict) else None
        await say(outbox, "Bu ariza bo'yicha perebroska allaqachon %s. Qayta yaratilmaydi; kerak bo'lsa panelda"
                          " AI Perebroska > Tarix." % (("yaratilgan (guruh ID %s)" % g) if g else "bajarilmoqda"),
                  reply_to=reply_to)
        return

    await say(outbox, C.MSG_PEREBROSKA_TAHLIL, reply_to=reply_to)
    try:
        t = await asyncio.to_thread(TZ._koprik, C.PEREBROSKA_KOPRIK_TAHLIL, body={"fayl": fayl},
                                    timeout=C.PEREBROSKA_TAHLIL_TIMEOUT_S)
    except TZ.KoprikXato as exc:
        await say(outbox, "AI Perebroska tahlili bajarilmadi: %s." % exc.sabab, reply_to=reply_to)
        return
    tosiq = toskiqlar(t)
    if tosiq:
        matn = rad_html(t, tosiq)
        await say(outbox, matn, html_mode=True, reply_to=reply_to, hist=re.sub(r"<[^>]+>", "", html.unescape(matn)))
        return

    # bir fayl — bir perebroska: parallel yoki qayta yuborishda ikkinchi marta yaratilmaydi
    if not await asyncio.to_thread(db.kv_claim, belgi, config.iso_utc()):
        await say(outbox, "Bu ariza bo'yicha perebroska allaqachon bajarilmoqda. Qayta yaratilmaydi.", reply_to=reply_to)
        return
    e = t.get("extracted") or {}
    dests = [{"contractNo": str(d.get("contractNo")), "amount": _f(d.get("amount"))} for d in e.get("destinations") or []]
    sana = str(e.get("date") or "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", sana):
        sana = config.fmt_local(config.now_utc(), "%Y-%m-%d")
    kim = (s.tasdiq or "").strip()[:120] or C.PEREBROSKA_KIM_DEFAULT
    body = {"fayl": fayl, "fromContractNo": e.get("fromContractNo"), "amount": round(sum(d["amount"] for d in dests), 2),
            "date": sana, "destinations": dests, "agentState": t.get("agentState"), "agentReason": t.get("agentReason"),
            "agentData": e, "tasdiq": kim, "izoh": (s.izoh or None)}
    try:
        r = await asyncio.to_thread(TZ._koprik, C.PEREBROSKA_KOPRIK_YARAT, body=body, timeout=C.PEREBROSKA_YARAT_TIMEOUT_S)
    except TZ.KoprikXato as exc:
        await asyncio.to_thread(db.kv_del, belgi)      # yaratilmadi — qayta urinish mumkin
        await say(outbox, "Perebroska yaratilmadi: %s. Panelda AI Perebroska orqali tekshiring." % exc.sabab,
                  reply_to=reply_to)
        return
    await asyncio.to_thread(db.kv_set_json, belgi, {"groupId": r.get("groupId"), "at": config.iso_utc()})
    matn = natija_html(t, r, kim)
    await say(outbox, matn, html_mode=True, reply_to=reply_to, hist=re.sub(r"<[^>]+>", "", html.unescape(matn)))
