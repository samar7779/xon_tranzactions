"""XATO to'lovga ariza — TR Support (egasi [Ha] bosgach XATO sahifasidagi "Shartnoma biriktirish" kabi ariza).

Oqim (LLM'siz; Leader egasining rasmi/xabarini `ARIZA:` qatoriga aylantiradi):
1. `ARIZA: tx=<to'lov ID>|summa=<raqam> sana=YYYY-MM-DD [hisob=<qabul qiluvchi>] shartnoma=<to'g'ri shartnoma>
   [tolovchi=<ism>] [fayl=<leader_bot_...jpg>] [tasdiq=<ism>]`. Fayl berilmasa shu xabardagi rasm olinadi.
2. XATO to'lovlar ro'yxatidan to'lov topiladi (xato-list bilan bir xil filtr; summa, sana ±3 kun, hisob), shartnoma
   CRM'da tekshiriladi; to'lovchi ismi CRM mijozi bilan, obyekt izohdagi shartnoma bilan solishtiriladi.
3. Oldin/keyin ko'rinishi + [Ha, ariza yubor] [Yo'q] (yoki "tasdiqlayman" / "yo'q" matni).
4. [Ha] -> backend CorrectionService.createRequestWithFile (xato_correction_requests + ariza fayli), AI tekshiruvchi
   (agent.aiName) darrov ko'radi; bot natijani ARIZA_KUTISH_S gacha kutib egasiga yozadi.
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

log = logging.getLogger("agents.ariza")

_KALITLAR = ("tx", "summa", "sana", "hisob", "shartnoma", "tolovchi", "fayl", "tasdiq")
_KALIT_RE = re.compile(r"(?i)\b(%s)\s*=\s*" % "|".join(_KALITLAR))
_FAYL_RE = re.compile(r"^leader_bot_[0-9a-f]{16}\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$")
_TOKEN_RE = re.compile(r"^[0-9a-f]{16}$")
_BG_TASKS: set = set()


@dataclass
class Ariza:
    tx: Optional[str] = None
    summa: Optional[str] = None
    sana: Optional[str] = None
    hisob: Optional[str] = None
    shartnoma: Optional[str] = None
    tolovchi: Optional[str] = None
    fayl: Optional[str] = None
    tasdiq: Optional[str] = None


def parse(text: Any) -> Optional[Ariza]:
    """Birinchi `ARIZA:` qatori. Summa bo'shliqsiz raqamga, sana ISO ga keltiriladi."""
    m = C.ARIZA_RE.search(str(text or ""))
    if not m:
        return None
    body = m.group(1)
    a = Ariza()
    topilgan = list(_KALIT_RE.finditer(body))
    for i, km in enumerate(topilgan):
        oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(body)
        v = TZ._qiymat(body[km.end():oxir])
        k = km.group(1).lower()
        if v is not None and getattr(a, k) is None:
            setattr(a, k, v)
    if a.tx:
        a.tx = a.tx.split(" ")[0].strip("\"'")
    if a.summa:
        s = re.sub(r"[\s ]", "", a.summa).replace(",", ".")
        s = re.sub(r"\.(?=\d{3}(\D|$))", "", s)          # 7.100.000 -> 7100000
        a.summa = s if re.fullmatch(r"\d{1,13}(\.\d{1,2})?", s) else None
    if a.sana:
        d = re.match(r"^(\d{2})\.(\d{2})\.(\d{4})$", a.sana)
        a.sana = "%s-%s-%s" % (d.group(3), d.group(2), d.group(1)) if d else a.sana
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.sana):
            a.sana = None
    if a.hisob:
        a.hisob = re.sub(r"\D", "", a.hisob) or None
    if a.shartnoma:
        a.shartnoma = re.sub(r"[\s№]", "", a.shartnoma).upper() or None
    return a


def _fayl_nomi(a: Ariza, rasmlar: Sequence[str]) -> Optional[str]:
    """Ariza fayli: `fayl=` yoki shu xabardagi birinchi rasm; faqat bot papkasidagi leader_bot_<hex>.<ext>."""
    for c in ([a.fayl] if a.fayl else []) + [str(p) for p in rasmlar]:
        base = os.path.basename(str(c).strip())
        if _FAYL_RE.match(base) and (config.UPLOADS_DIR / base).is_file():
            return base
    return None


def _tokenlar(s: Any) -> List[str]:
    from . import payment_check as pc
    t = pc._lotin(str(s or "")).lower().replace("kh", "x").replace("h", "x")
    return [w for w in re.split(r"[^a-z]+", re.sub(r"['‘’ʻʼ`]", "", t)) if len(w) >= 3]


def ism_mos(tolovchi: Any, mijoz: Any) -> Optional[bool]:
    """Arizadagi to'lovchi va CRM mijozi bir odammi (taxminiy): familiya va ismning birinchi 4 harfi."""
    a, b = _tokenlar(tolovchi), _tokenlar(mijoz)
    if not a or not b:
        return None
    mos = sum(1 for w in a[:3] if any(w[:4] == v[:4] for v in b))
    return True if mos >= 2 else (False if mos == 0 else None)


def obyekt(sh: Any) -> str:
    m = re.match(r"^\d+([A-Z]{2,4})\d", str(sh or "").upper())
    return m.group(1) if m else ""


def _qisqa_izoh(s: Any, n: int = 160) -> str:
    from . import payment_check as pc
    return pc._izoh_pii(s, n)


def preview_html(k: Dict[str, Any], crm: Dict[str, Any], a: Ariza, hisob_mos: Optional[bool], ai: str,
                 yubordi: str, fayl: str = "") -> str:
    e = TZ._e
    d = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(k.get("date") or ""))
    sana = "%s.%s.%s" % (d.group(3), d.group(2), d.group(1)) if d else (k.get("date") or "-")
    q = ["<b>XATO to'lovga ariza</b> — tasdiqlang", "",
         "To'lov: %s · %s so'm" % (e(sana), e(TZ._pul(k.get("amount")))),
         "ID: <code>%s</code>" % e(k.get("txId") or "-"),
         "Hozir: shartnoma %s" % e(k.get("contractNo") or "yo'q") + ("" if str(k.get("contractNo") or "").upper() == "XATO"
                                                                     else " (XATO)")]
    if k.get("purpose"):
        q.append("Izoh: " + e(_qisqa_izoh(k.get("purpose"))))
    q += ["", "Yangi shartnoma: <b>%s</b>" % e(crm.get("contract")),
          "CRM: %s" % e(", ".join(x for x in (crm.get("customerName"), crm.get("objectName")) if x) or "bor")]
    if a.tolovchi:
        mos = ism_mos(a.tolovchi, crm.get("customerName"))
        q.append("Arizadagi to'lovchi: %s — %s" % (e(a.tolovchi), {True: "CRM mijozi bilan mos",
                                                                   False: "CRM mijozi bilan MOS EMAS, tekshiring",
                                                                   None: "mosligi aniq emas"}[mos]))
    if hisob_mos is False:
        q.append("Diqqat: arizadagi hisob raqami bu to'lov hisobiga mos kelmadi.")
    eski, yangi = obyekt(k.get("contractNo")), obyekt(crm.get("contract"))
    if eski and yangi and eski != yangi:
        q.append("Diqqat: izohdagi shartnoma boshqa obyektda (%s, yangisi %s) — %s arizani xodimga yuborishi mumkin."
                 % (e(eski), e(yangi), e(ai)))
    tur = {"pdf": "PDF", "doc": "Word", "docx": "Word"}.get(str(fayl).rsplit(".", 1)[-1].lower(), "rasm")
    q += ["", "Ariza fayli: shu %s" % tur, "Yuboruvchi: %s" % e(yubordi),
          "Yuborilgach %s o'zi tekshiradi, natijani shu yerga yozaman. Tasdiq %d daqiqa amal qiladi: tugmani bosing"
          " yoki \"tasdiqlayman\" / \"yo'q\" deb yozing." % (e(ai), max(1, C.APPROVAL_TTL_S // 60))]
    return "\n".join(q)


async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None, rasmlar: Sequence[str] = ()) -> bool:
    """`ARIZA:` qatori bo'lsa ishlaydi va True qaytaradi. Hech qachon exception chiqarmaydi."""
    a = parse(text)
    if a is None:
        return False
    try:
        await _handle(a, outbox, reply_to, list(rasmlar or ()))
    except Exception:  # noqa: BLE001
        log.exception("ariza yiqildi")
        await TZ._say(outbox, "Ariza tayyorlanmadi: ichki xato. Qayta urinib ko'ring.", reply_to=reply_to)
    return True


async def _handle(a: Ariza, outbox: Any, reply_to: Optional[int], rasmlar: List[str]) -> None:
    say = TZ._say
    fayl = _fayl_nomi(a, rasmlar)
    if not fayl:
        await say(outbox, "Ariza faylini yuboring (rasm, PDF yoki Word): bot shu faylni ariza fayli sifatida"
                          " biriktiradi.", reply_to=reply_to)
        return
    if not a.shartnoma:
        await say(outbox, "Qaysi shartnomaga biriktirilsin? To'g'ri shartnoma raqamini yozing.", reply_to=reply_to)
        return
    if not a.tx and not (a.summa and a.sana):
        await say(outbox, "To'lovni topish uchun summa va sana (yoki to'lov ID) kerak.", reply_to=reply_to)
        return
    params = {"tx": a.tx} if a.tx else {"summa": a.summa, "sana": a.sana}
    if a.hisob and len(a.hisob) >= 6:
        params["hisob"] = a.hisob
    params["shartnoma"] = a.shartnoma
    try:
        r = await asyncio.to_thread(TZ._koprik, C.ARIZA_KOPRIK_FIND, params=params)
    except TZ.KoprikXato as exc:
        await say(outbox, "XATO ro'yxati o'qilmadi: %s." % exc.sabab, reply_to=reply_to)
        return
    kands = r.get("candidates") or []
    crm = r.get("crm") or {}
    ai = str(r.get("aiName") or "AI tekshiruvchi")
    qidiruv = ("ID %s" % a.tx) if a.tx else ("%s so'm, %s (±3 kun)" % (TZ._pul(a.summa), a.sana))
    if not kands:
        await say(outbox, "XATO to'lovlar ro'yxatida bunday to'lov topilmadi (%s). To'lov shartnomasiz bo'lsa, avval"
                          " uni XATO ro'yxatiga tushirish kerak: \"shu to'lovni XATO deb belgila\" (shartnoma"
                          " XATO), keyin ariza." % qidiruv, reply_to=reply_to)
        return
    if len(kands) > 1:
        q = ["XATO ro'yxatida %d ta mos to'lov bor (%s). Qaysi biri? ID bilan qayta yozing:" % (len(kands), qidiruv)]
        for k in kands[:10]:
            q.append("• %s · %s so'm · %s · ID %s" % (k.get("date") or "-", TZ._pul(k.get("amount")),
                                                     k.get("contractNo") or "-", k.get("txId") or "-"))
        await say(outbox, "\n".join(q), reply_to=reply_to)
        return
    k = kands[0]
    if k.get("pending"):
        p = k["pending"]
        await say(outbox, "Bu to'lovga ariza allaqachon yuborilgan (%s, %s, taklif: %s). Natijani kuting." % (
            p.get("by") or "-", str(p.get("at") or "-")[:10], p.get("contract") or "-"), reply_to=reply_to)
        return
    if not crm.get("found"):
        await say(outbox, "Shartnoma %s CRM'da topilmadi — boshqa shartnoma bering." % (crm.get("contract") or a.shartnoma),
                  reply_to=reply_to)
        return
    yubordi = ("TR Support · %s" % a.tasdiq) if a.tasdiq else "TR Support bot (egasi)"
    token = secrets.token_hex(8)
    payload = {"token": token, "created_ts": config.now_utc().timestamp(), "oplataKvId": k.get("oplataKvId"),
               "contractNo": crm.get("contract"), "fayl": fayl, "yubordi": yubordi[:120], "txId": k.get("txId"),
               "ai": ai}
    key = C.kv_key(C.KV_AR_APPR, token=token)
    await asyncio.to_thread(db.kv_set_json, key, payload)
    matn = preview_html(k, crm, a, r.get("hisobMos"), ai, yubordi, fayl)
    keyboard = [[(C.KNOPKA_AR_HA, C.CB_AR_OK + token), (C.KNOPKA_YOQ, C.CB_AR_NO + token)]]
    mid = await say(outbox, matn, html_mode=True, keyboard=keyboard, reply_to=reply_to,
                    hist=re.sub(r"<[^>]+>", "", html.unescape(matn)))
    if mid is None:
        await asyncio.to_thread(db.kv_del, key)
    else:
        payload["mid"] = mid
        await asyncio.to_thread(db.kv_set_json, key, payload)


def kutilayotgan() -> List[Tuple[str, Dict[str, Any]]]:
    out: List[Tuple[str, Dict[str, Any]]] = []
    for key in db.kv_keys(C.KV_AR_APPR.split("{", 1)[0]):
        p = db.kv_get_json(key)
        if isinstance(p, dict) and _TOKEN_RE.match(str(p.get("token") or "")) and not TZ._eskirgan(p):
            out.append((str(p["token"]), p))
    return out


async def decide(token: str, approve: bool, outbox: Any, message_id: Optional[int]) -> str:
    """[Ha]/[Yo'q] yoki matnli tasdiq. Bir martalik (ar_run_<token> claim). Toast qaytaradi."""
    if not _TOKEN_RE.match(token or ""):
        return C.MSG_MUDDAT_OTGAN
    appr, run = C.kv_key(C.KV_AR_APPR, token=token), C.kv_key(C.KV_AR_RUN, token=token)
    payload = await asyncio.to_thread(db.kv_get_json, appr)
    if not isinstance(payload, dict) or payload.get("token") != token:
        return C.MSG_MUDDAT_OTGAN
    if not await asyncio.to_thread(db.kv_claim, run, config.iso_utc()):
        return "Bu so'rov allaqachon hal qilingan."
    await asyncio.to_thread(db.kv_del, appr)
    if message_id:
        try:
            await outbox.edit_keyboard(message_id, None)
        except Exception:  # noqa: BLE001
            log.exception("ariza: tugmalar olinmadi")
    if TZ._eskirgan(payload):
        await TZ._say(outbox, "Tasdiq muddati o'tdi. Ariza yuborilmadi, qaytadan so'rang.")
        return C.MSG_MUDDAT_OTGAN
    if not approve:
        await TZ._say(outbox, C.MSG_ARIZA_BEKOR)
        return C.MSG_ARIZA_BEKOR
    task = asyncio.create_task(_yubor(payload, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return C.MSG_ARIZA_QABUL


async def _kut(soniya: float) -> None:
    await asyncio.sleep(soniya)


def _natija_matni(st: Dict[str, Any], ai: str) -> Optional[str]:
    holat, agent = str(st.get("status") or ""), str(st.get("agentState") or "")
    sabab = st.get("agentReason") or st.get("rejectReason") or ""
    if holat == "approved":
        return "%s: ariza tasdiqlandi — to'lov %s shartnomasiga biriktirildi.%s" % (
            ai, st.get("contract") or "-", (" Sabab: " + sabab) if sabab else "")
    if holat == "rejected":
        return "%s: ariza rad etildi.%s" % (ai, (" Sabab: " + sabab) if sabab else "")
    if agent == "needs_review":
        return "%s: xodim ko'rishi kerak (ariza kutilmoqda).%s" % (ai, (" Sabab: " + sabab) if sabab else "")
    return None


async def _yubor(payload: Dict[str, Any], outbox: Any) -> None:
    say = TZ._say
    body = {k: payload.get(k) for k in ("oplataKvId", "contractNo", "fayl", "yubordi")}
    try:
        r = await asyncio.to_thread(TZ._koprik, C.ARIZA_KOPRIK_SUBMIT, body=body, timeout=120)
    except TZ.KoprikXato as exc:
        await say(outbox, "Ariza yuborilmadi: %s." % exc.sabab)
        return
    except Exception:  # noqa: BLE001
        log.exception("ariza submit yiqildi")
        await say(outbox, "Ariza yuborilmadi: ichki xato.")
        return
    ai = str(r.get("aiName") or payload.get("ai") or "AI tekshiruvchi")
    rid = str(r.get("id") or "-")
    if r.get("alreadyPending"):
        await say(outbox, "Bu to'lovga ariza allaqachon bor (#%s) — yangi ariza yuborilmadi. Natijani kuting." % rid)
        return
    boshi = "Ariza yuborildi (#%s): to'lov ID %s, shartnoma %s." % (rid, payload.get("txId") or "-", r.get("contract"))
    if not r.get("aiEnabled"):
        await say(outbox, boshi + " AI tekshiruvchi o'chiq: xodim tasdiqlaydi (XATO ro'yxati > Arizalar).")
        return
    await say(outbox, boshi + " %s tekshiryapti, natijani shu yerga yozaman." % ai)
    kutildi = 0.0
    while kutildi < C.ARIZA_KUTISH_S:
        await _kut(C.ARIZA_KUT_QADAM_S)
        kutildi += C.ARIZA_KUT_QADAM_S
        try:
            st = await asyncio.to_thread(TZ._koprik, C.ARIZA_KOPRIK_STATUS, params={"id": rid})
        except TZ.KoprikXato:
            continue
        matn = _natija_matni(st, str(st.get("aiName") or ai))
        if matn:
            await say(outbox, matn)
            return
    await say(outbox, "%s hali tugatmadi (#%s). Natija XATO ro'yxatidagi \"Arizalar\" tabida va guruhda ko'rinadi." % (ai, rid))


def purge_pending() -> int:
    return db.kv_del_prefix(C.KV_AR_APPR.split("{", 1)[0])
