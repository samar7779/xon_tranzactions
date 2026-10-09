"""Eski tarixni yuklash — TR Support (egasi qarori, 2026-10-09): panel Tranzaksiyalar > "Eski tarixni yuklash" bilan
AYNAN bir xil (backend SyncService backfill). Faqat QO'SHADI: o'chirish/o'zgartirish aniqlash va qoldiq yangilash
backfill rejimida o'chiq — shuning uchun tasdiq so'ralmaydi.

1. `TARIX: dan=YYYY-MM-DD [gacha=YYYY-MM-DD] [bank=<nom>] [hisob=<raqam>]` yoki `/tarix 01.10.2026 05.10.2026 [bank|hisob]`.
   `TARIX: holat` yoki `/tarix holat` — oxirgi yuklash qayerda.
2. POST agent-bridge/tarix/yukla -> fonda boshlanadi (bir vaqtda bitta, ko'pi bilan 62 kun). Tugagach backend yangi to'lov
   bo'lsa bitta OplatyKv sync qiladi.
3. Bot GET agent-bridge/tarix/holat ni kuzatadi va tugagach natija yozadi: hisoblar, bankdan olindi, yangi qo'shildi,
   OplatyKv, xatolar (hisob va sabab). Uzoq vaqt siljimasa — "to'xtab qoldi". Oxirgi yuklash kv'da (bot qayta ishga
   tushsa ham `/tarix holat` bilan ko'rinadi).
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date
from typing import Any, Dict, Optional

from . import config
from . import contract as C
from . import db
from . import tuzatish as TZ

log = logging.getLogger("agents.tarix")

_KALITLAR = ("dan", "gacha", "bank", "hisob")
_KALIT_RE = re.compile(r"(?i)\b(%s)\s*=\s*" % "|".join(_KALITLAR))
_SANA_RE = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})")
_HOLAT_SOZ = ("holat", "holati", "status", "qayerda", "natija")
_BG_TASKS: set = set()


def _iso(s: Any) -> Optional[str]:
    t = str(s or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if not m:
        m2 = re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", t)
        if not m2:
            return None
        t = "%s-%02d-%02d" % (m2.group(3), int(m2.group(2)), int(m2.group(1)))
    try:
        return date.fromisoformat(t).isoformat()
    except ValueError:
        return None


def parse(text: Any) -> Optional[Dict[str, Optional[str]]]:
    """`TARIX:` qatori: {dan, gacha, bank, hisob, holat}. Kalitsiz ham ("TARIX: 01.10.2026 05.10.2026 Kapitalbank")."""
    m = C.TARIX_RE.search(str(text or ""))
    if not m:
        return None
    body = m.group(1)
    q: Dict[str, Optional[str]] = {"dan": None, "gacha": None, "bank": None, "hisob": None, "holat": None}
    if body.strip().lower().strip(".?!") in _HOLAT_SOZ:
        q["holat"] = "1"
        return q
    topilgan = list(_KALIT_RE.finditer(body))
    if topilgan:
        for i, km in enumerate(topilgan):
            oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(body)
            v = TZ._qiymat(body[km.end():oxir])
            if v is not None and q[km.group(1).lower()] is None:
                q[km.group(1).lower()] = v
    else:
        sanalar = _SANA_RE.findall(body)
        q["dan"] = sanalar[0] if sanalar else None
        q["gacha"] = sanalar[1] if len(sanalar) > 1 else None
        qolgan = _SANA_RE.sub(" ", body).strip()
        raqam = re.sub(r"[\s\-]", "", qolgan)
        if re.fullmatch(r"\d{16,25}", raqam):
            q["hisob"] = raqam
        elif qolgan:
            q["bank"] = qolgan[:60]
    q["dan"] = _iso(q["dan"])
    q["gacha"] = _iso(q["gacha"]) or q["dan"]
    if q["hisob"]:
        q["hisob"] = re.sub(r"[\s\-]", "", q["hisob"]) or None
    if q["bank"] and q["bank"].strip().lower() in ("hammasi", "barchasi", "barcha", "all", "-"):
        q["bank"] = None
    return q


def _kun(iso: Any) -> str:
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(iso or ""))
    return "%s.%s.%s" % (m.group(3), m.group(2), m.group(1)) if m else "-"


def _okv_qatori(h: Dict[str, Any]) -> str:
    ish = h.get("ish") or {}
    okv = ish.get("okv")
    if okv:
        s = "OplatyKv: qo'shildi %d, yangilandi %d." % (int(okv.get("qoshildi") or 0), int(okv.get("yangilandi") or 0))
        if int(okv.get("yozilmadi") or 0):
            s += " Yozilmadi %d ta (sabablari: \"OplatyKv'ga tushyaptimi?\" deb so'rang)." % int(okv["yozilmadi"])
        return s
    if ish.get("okvXato"):
        return "OplatyKv sync bajarilmadi: %s. Panelda OplatyKv > Sync ni bosing." % ish["okvXato"]
    if not int(h.get("yangi") or 0):
        return "Yangi to'lov yo'q — OplatyKv o'zgarmadi."
    return "Yangi to'lovlar OplatyKv'ga keyingi sync bilan tushadi."


def natija_matni(boshi: Dict[str, Any], h: Dict[str, Any], holat: str) -> str:
    sarlavha = {"tugadi": "Eski tarix yuklandi", "toxtadi": "Eski tarix yuklash TO'XTAB QOLDI",
                "vaqt": "Eski tarix yuklash hali tugamadi", "jarayon": "Eski tarix yuklash davom etyapti"}[holat]
    q = ["%s: %s, %s - %s." % (sarlavha, boshi.get("qamrov") or "-", _kun(boshi.get("dan")), _kun(boshi.get("gacha"))),
         "Hisoblar: %d / %d tugadi." % (int(h.get("tugagan") or 0), int(boshi.get("hisoblar") or 0)),
         "Bankdan olindi: %s ta, yangi qo'shildi: %s ta." % (TZ._pul(h.get("olindi")), TZ._pul(h.get("yangi")))]
    if holat == "tugadi":
        q.append(_okv_qatori(h))
    xatolar = h.get("xatolar") or []
    if xatolar:
        q.append("Xatolar (%d hisob):" % len(xatolar))
        q += ["• %s: %s" % (x.get("hisob") or "-", x.get("xabar") or "-") for x in xatolar[:5]]
    if holat == "toxtadi":
        q.append("Jarayon %d daqiqadan beri siljimayapti — server qayta ishga tushgan bo'lishi mumkin. Qolgan hisoblar uchun"
                 " shu buyruqni qayta yuboring (qo'shilganlar takrorlanmaydi)." % (C.TARIX_TOXTADI_S // 60))
    elif holat in ("vaqt", "jarayon"):
        q.append("Jarayon fonda davom etyapti. Keyinroq: /tarix holat.")
    return "\n".join(q)


def _tugadimi(boshi: Dict[str, Any], h: Dict[str, Any]) -> bool:
    jami = int(boshi.get("hisoblar") or 0)
    ish = h.get("ish")
    return jami > 0 and int(h.get("tugagan") or 0) >= jami and (not ish or bool(ish.get("tugadi")))


# ---------------------------------------------------------------------------
# Oqim
# ---------------------------------------------------------------------------
async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None) -> bool:
    q = parse(text)
    if q is None:
        return False
    try:
        if q.get("holat"):
            await _holat(outbox, reply_to)
        else:
            await _handle(q, outbox, reply_to)
    except Exception:  # noqa: BLE001
        log.exception("tarix yiqildi")
        await TZ._say(outbox, "Eski tarix yuklash bajarilmadi: ichki xato. Qayta urinib ko'ring.", reply_to=reply_to)
    return True


async def _handle(q: Dict[str, Optional[str]], outbox: Any, reply_to: Optional[int]) -> None:
    say = TZ._say
    if not q.get("dan"):
        await say(outbox, C.MSG_TARIX_FOYDALANISH, reply_to=reply_to)
        return
    body = {"dan": q["dan"], "gacha": q["gacha"] or q["dan"]}
    if q.get("hisob"):
        body["hisob"] = q["hisob"]
    elif q.get("bank"):
        body["bank"] = q["bank"]
    try:
        r = await asyncio.to_thread(TZ._koprik, C.TARIX_KOPRIK_YUKLA, body=body, timeout=60)
    except TZ.KoprikXato as exc:
        await say(outbox, "Eski tarix yuklash boshlanmadi: %s." % exc.sabab, reply_to=reply_to)
        return
    await asyncio.to_thread(db.kv_set_json, C.KV_TARIX_OXIRGI,
                            {"boshi": r, "xabar": False, "ts": config.now_utc().timestamp()})
    matn = "Eski tarix yuklash boshlandi: %s, %s - %s (%d kun), %d hisob. Tugagach natijani yozaman." % (
        r.get("qamrov") or "-", _kun(r.get("dan")), _kun(r.get("gacha")), int(r.get("kunlar") or 0),
        int(r.get("hisoblar") or 0))
    if r.get("ogohlantirish"):
        matn += "\nDiqqat: %s." % r["ogohlantirish"]
    await say(outbox, matn, reply_to=reply_to)
    task = asyncio.create_task(_kuzat(r, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


async def _holat(outbox: Any, reply_to: Optional[int]) -> None:
    oxirgi = await asyncio.to_thread(db.kv_get_json, C.KV_TARIX_OXIRGI)
    if not isinstance(oxirgi, dict) or not isinstance(oxirgi.get("boshi"), dict) or \
            config.now_utc().timestamp() - float(oxirgi.get("ts") or 0) > C.TARIX_HOLAT_ESKI_S:
        await TZ._say(outbox, "Oxirgi 24 soatda bot orqali boshlangan eski tarix yuklash yo'q.", reply_to=reply_to)
        return
    boshi = oxirgi["boshi"]
    try:
        h = await asyncio.to_thread(TZ._koprik, C.TARIX_KOPRIK_HOLAT, params={"since": str(boshi.get("startedAt"))})
    except TZ.KoprikXato as exc:
        await TZ._say(outbox, "Yuklash holati olinmadi: %s." % exc.sabab, reply_to=reply_to)
        return
    await TZ._say(outbox, natija_matni(boshi, h, "tugadi" if _tugadimi(boshi, h) else "jarayon"), reply_to=reply_to)


async def _kut(soniya: float) -> None:
    await asyncio.sleep(soniya)


async def _belgila() -> None:
    try:
        oxirgi = await asyncio.to_thread(db.kv_get_json, C.KV_TARIX_OXIRGI)
        if isinstance(oxirgi, dict):
            oxirgi["xabar"] = True
            await asyncio.to_thread(db.kv_set_json, C.KV_TARIX_OXIRGI, oxirgi)
    except Exception:  # noqa: BLE001
        log.exception("tarix: kv belgilanmadi")


async def _kuzat(boshi: Dict[str, Any], outbox: Any) -> None:
    """Holatni kuzatadi: hammasi tugasa (OplatyKv sync ham) — natija; TARIX_TOXTADI_S siljimasa — to'xtadi;
    TARIX_KUTISH_S — "fonda davom etyapti"."""
    oxirgi_iz: Any = None
    siljimadi = 0.0
    otdi = 0.0
    h: Dict[str, Any] = {}
    while otdi < C.TARIX_KUTISH_S:
        await _kut(C.TARIX_QADAM_S)
        otdi += C.TARIX_QADAM_S
        try:
            h = await asyncio.to_thread(TZ._koprik, C.TARIX_KOPRIK_HOLAT, params={"since": str(boshi.get("startedAt"))})
        except TZ.KoprikXato:
            siljimadi += C.TARIX_QADAM_S            # server qayta ishga tushayotgan bo'lishi mumkin
        else:
            if _tugadimi(boshi, h):
                await TZ._say(outbox, natija_matni(boshi, h, "tugadi"))
                await _belgila()
                return
            ish = h.get("ish") or {}
            iz = (h.get("boshlangan"), h.get("tugagan"), h.get("olindi"), bool(ish.get("tugadi")))
            if iz != oxirgi_iz:
                oxirgi_iz, siljimadi = iz, 0.0
            else:
                siljimadi += C.TARIX_QADAM_S
        if siljimadi >= C.TARIX_TOXTADI_S:
            await TZ._say(outbox, natija_matni(boshi, h, "toxtadi"))
            await _belgila()
            return
    await TZ._say(outbox, natija_matni(boshi, h, "vaqt"))
