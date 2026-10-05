"""Ma'lumot — TR Support (faqat o'qish, tasdiq kerak emas; egasi qarori 2026-10-05).

1. `HISOB: <hisob raqam>[, <raqam>...]` yoki `/hisob <raqam>` -> GET agent-bridge/hisob: hisob egasi (to'lovlardagi
   nom), MFO va bank, INN, korxona (DIDOX: to'liq nom, direktor, manzil...), bizning hisobmi, shu hisobdan/ga
   to'lovlar, shartnomalar, oxirgi to'lovlar (to'liq ID bilan). Matn.
2. `XATO_FAYL: [filtr]` yoki `/xato [filtr]` -> GET agent-bridge/xato-royxat: XATO to'lovlar ro'yxati (xato-list
   sahifasi bilan bir xil filtr va sana) Excel fayl, Telegram'ga hujjat bo'lib.
Ko'prik: tuzatish._koprik (faqat loopback, kalit header'da, yo'l oq ro'yxatda).
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import re
from typing import Any, Dict, List, Optional

from . import config
from . import contract as C
from . import history
from . import tuzatish as TZ

log = logging.getLogger("agents.malumot")

_HISOB_TOZA_RE = re.compile(r"[\s\-]")
_HISOB_OK_RE = re.compile(r"^\d{16,25}$")


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------
def hisob_parse(text: Any) -> Optional[List[str]]:
    """`HISOB:` qatori bo'lmasa None; bo'lsa yaroqli raqamlar (bo'shliqlar olinadi, 16-25 xona, HISOB_MAX gacha)."""
    m = C.HISOB_RE.search(str(text or ""))
    if not m:
        return None
    out: List[str] = []
    for qism in re.split(r"[,;]", m.group(1)):
        s = _HISOB_TOZA_RE.sub("", qism)
        if _HISOB_OK_RE.match(s) and s not in out:
            out.append(s)
    return out[:C.HISOB_MAX]


def xato_parse(text: Any) -> Optional[str]:
    """`XATO_FAYL:` qatori bo'lmasa None; bo'lsa filtr ('' = hammasi)."""
    m = C.XATO_FAYL_RE.search(str(text or ""))
    if not m:
        return None
    return re.sub(r"\s+", " ", m.group(1)).strip().strip("\"'")[:60]


# ---------------------------------------------------------------------------
# Matnlar (oddiy matn, lotin)
# ---------------------------------------------------------------------------
def _kun(iso: Any) -> str:
    dt = config.parse_iso(str(iso or ""))
    return config.fmt_local(dt, "%d.%m.%Y") if dt else "-"


def _tomon(nom: str, t: Dict[str, Any]) -> str:
    if not t or not t.get("soni"):
        return "%s: yo'q." % nom
    return "%s: %d ta, %s so'm (%s - %s)." % (nom, int(t["soni"]), TZ._pul(t.get("summa")), _kun(t.get("birinchi")),
                                           _kun(t.get("oxirgi")))


def hisob_matni(r: Dict[str, Any]) -> str:
    q = ["Hisob raqam: %s" % r.get("hisob"),
         "Balans kodi %s, valyuta %s." % (r.get("balansKod") or "-", r.get("valyuta") or "-")]
    if not r.get("topildi"):
        q.append("Bu hisob bo'yicha ma'lumot topilmadi: bizning hisoblarda ham, to'lovlarda ham, kontragentlar"
                 " ro'yxatida ham yo'q.")
        return "\n".join(q)
    for b in r.get("bizniki") or []:
        bank = b.get("bank") or "-"
        if b.get("bankNomi"):
            bank += " (%s)" % b["bankNomi"]
        q.append("Bizning hisob: %s, MFO %s; egasi: %s; sync %s%s." % (
            bank, b.get("mfo") or "-", b.get("egasi") or "-", "yoqilgan" if b.get("sync") else "o'chiq",
            (", oxirgi " + TZ._sana(b["oxirgiSync"])) if b.get("oxirgiSync") else ""))
    nomlar = r.get("nomlar") or []
    if nomlar:
        n0 = nomlar[0]
        q.append("Egasi (to'lovlardagi nom): %s" % (n0.get("nom") or "-"))
        q.append("MFO: %s%s" % (n0.get("mfo") or "-", (" - " + n0["bankNomi"]) if n0.get("bankNomi") else ""))
        q.append("INN/PINFL: %s" % (n0.get("inn") or "-"))
        boshqa = [n for n in nomlar[1:] if n.get("nom") and n.get("nom") != n0.get("nom")]
        if boshqa:
            q.append("Boshqa yozilishlar: " + "; ".join("%s (%d)" % (n["nom"], int(n.get("soni") or 0))
                                                         for n in boshqa[:4]))
    for k in r.get("korxonalar") or []:
        q.append("Korxona (DIDOX): %s" % (k.get("toliqNom") or k.get("nom") or "-"))
        tafsil = [("INN", k.get("inn")), ("direktor", k.get("direktor")), ("manzil", k.get("manzil")),
                  ("telefon", k.get("telefon")), ("QQS", k.get("qqs")), ("OKED", k.get("oked")),
                  ("ro'yxatdan o'tgan", _kun(k["royxatdan"]) if k.get("royxatdan") else None),
                  ("bank", k.get("bankNomi"))]
        q.append("  " + "; ".join("%s: %s" % (a, v) for a, v in tafsil if v))
        if k.get("faol") is False:
            q.append("  Kontragent panelda nofaol.")
    q.append(_tomon("Shu hisobdan to'lovlar", r.get("jonatuvchi") or {}))
    q.append(_tomon("Shu hisobga to'lovlar", r.get("qabulQiluvchi") or {}))
    sh = r.get("shartnomalar") or []
    if sh:
        q.append("Shartnomalar: " + ", ".join("%s (%d)" % (x.get("shartnoma"), int(x.get("soni") or 0)) for x in sh))
    ox = r.get("oxirgi") or []
    if ox:
        q.append("Oxirgi to'lovlar:")
        for i, t in enumerate(ox, 1):
            yon = "shu hisobdan -> %s" % (t.get("qarshi") or "-") if t.get("jonatuvchi") else \
                "%s -> shu hisobga" % (t.get("qarshi") or "-")
            q.append("%d. %s · %s so'm · %s%s" % (i, _kun(t.get("sana")), TZ._pul(t.get("summa")), yon,
                                                  (" · " + t["shartnoma"]) if t.get("shartnoma") else ""))
            q.append("   ID %s" % t.get("id"))
    if r.get("kesilgan"):
        q.append("(Nom va shartnomalar oxirgi 3000 to'lov bo'yicha; jamilar to'liq.)")
    return "\n".join(q)


def xato_izohi(r: Dict[str, Any]) -> str:
    q = ["XATO to'lovlar: %d ta, jami %s so'm; ariza kutilmoqda %d, rad etilgan %d." % (
        int(r.get("soni") or 0), TZ._pul(r.get("summa")), int(r.get("kutilmoqda") or 0), int(r.get("rad") or 0))]
    if r.get("filtr"):
        q.append('Filtr: "%s" (%d tadan).' % (r["filtr"], int(r.get("jami") or 0)))
    q.append("Manba: XATO to'lovlar sahifasi bilan bir xil%s." % (
        (", %s dan" % _kun(r["dateFrom"])) if r.get("dateFrom") else ""))
    if r.get("kesilgan"):
        q.append("Diqqat: ro'yxat 2000 qator bilan cheklangan, undan ko'p bo'lishi mumkin.")
    return "\n".join(q)


# ---------------------------------------------------------------------------
# Oqim
# ---------------------------------------------------------------------------
async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None) -> bool:
    """`HISOB:` yoki `XATO_FAYL:` qatori bo'lsa ishlaydi va True. Hech qachon exception."""
    raqamlar = hisob_parse(text)
    filtr = None if raqamlar is not None else xato_parse(text)
    if raqamlar is None and filtr is None:
        return False
    try:
        if raqamlar is not None:
            await _hisob(raqamlar, outbox, reply_to)
        else:
            await _xato(filtr or "", outbox, reply_to)
    except Exception:  # noqa: BLE001
        log.exception("malumot yiqildi")
        await TZ._say(outbox, "Ma'lumot olinmadi: ichki xato. Qayta urinib ko'ring.", reply_to=reply_to)
    return True


async def _hisob(raqamlar: List[str], outbox: Any, reply_to: Optional[int]) -> None:
    if not raqamlar:
        await TZ._say(outbox, C.MSG_HISOB_FOYDALANISH, reply_to=reply_to)
        return
    for raqam in raqamlar:
        try:
            r = await asyncio.to_thread(TZ._koprik, C.HISOB_KOPRIK, params={"raqam": raqam},
                                        timeout=C.HISOB_TIMEOUT_S)
        except TZ.KoprikXato as exc:
            await TZ._say(outbox, "Hisob %s bo'yicha ma'lumot olinmadi: %s." % (raqam, exc.sabab), reply_to=reply_to)
            continue
        await TZ._say(outbox, hisob_matni(r), reply_to=reply_to)


async def _xato(filtr: str, outbox: Any, reply_to: Optional[int]) -> None:
    try:
        r = await asyncio.to_thread(TZ._koprik, C.XATO_FAYL_KOPRIK, params={"filtr": filtr} if filtr else None,
                                    timeout=C.XATO_FAYL_TIMEOUT_S)
    except TZ.KoprikXato as exc:
        await TZ._say(outbox, "XATO ro'yxati olinmadi: %s." % exc.sabab, reply_to=reply_to)
        return
    izoh = xato_izohi(r)
    if not int(r.get("soni") or 0):
        await TZ._say(outbox, izoh + "\nFayl yuborilmadi: qator yo'q.", reply_to=reply_to)
        return
    try:
        data = base64.b64decode(str(r.get("base64") or ""), validate=True)
    except (binascii.Error, ValueError):
        await TZ._say(outbox, "XATO ro'yxati olinmadi: fayl buzilgan.", reply_to=reply_to)
        return
    nom = str(r.get("filename") or "xato-tolovlar.xlsx")
    if not re.fullmatch(r"[A-Za-z0-9_.\-]{1,80}\.xlsx", nom):
        nom = "xato-tolovlar.xlsx"
    mid = await outbox.send_document(nom, data, caption=izoh[:1000])
    if mid is None:
        await TZ._say(outbox, "Fayl Telegram'ga yuborilmadi. Qayta urinib ko'ring.", reply_to=reply_to)
        return
    try:
        await asyncio.to_thread(history.add_history, C.ROLE_LEADER, "Fayl yuborildi: %s\n%s" % (nom, izoh))
    except Exception:  # noqa: BLE001
        log.exception("malumot: tarix yozilmadi")
