"""Google Sheets eksportini bot orqali qayta ishga tushirish (egasi [Ha] bosgach).

Oqim (LLM'siz; Leader egasi so'rovini `EKSPORT:` qatoriga aylantiradi yoki /eksport [nom]):
1. Eksportlar ro'yxati (GET agent-bridge/exports): nom egasi aytgan so'zga bitta mos kelsa — darrov tasdiq so'rovi;
   aks holda ro'yxat (oxirgi ish vaqti, holati, qatorlar) va har eksport uchun tugma.
2. Tanlangan eksport: sheet, rejim, manba, oxirgi ish + [Ha, ishga tushir] [Yo'q] (yoki "tasdiqlayman" / "yo'q").
3. [Ha] -> POST agent-bridge/exports/<id>/run (panel "Bajarish" bilan bir xil runAndLog), natija egasiga.
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import secrets
from typing import Any, Dict, List, Optional, Tuple

from . import config
from . import contract as C
from . import db
from . import tuzatish as TZ

log = logging.getLogger("agents.eksport")

_TOKEN_RE = re.compile(r"^[0-9a-f]{16}$")
_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_BG_TASKS: set = set()


def parse(text: Any) -> Optional[str]:
    """`EKSPORT:` qatori bo'lsa egasi aytgan nom ('' = ro'yxat), aks holda None."""
    m = C.EKSPORT_RE.search(str(text or ""))
    if not m:
        return None
    v = m.group(1).strip()
    v = re.sub(r"(?i)^(nomi|nom|id)\s*=\s*", "", v).strip().strip("\"'«»")
    return "" if v.lower() in ("", "?", "hammasi", "ro'yxat", "royxat") else v[:80]


def _norm(s: Any) -> str:
    from . import payment_check as pc
    return re.sub(r"[^a-z0-9]+", " ", pc._lotin(str(s or "")).lower().replace("'", "")).strip()


def _mos(items: List[Dict[str, Any]], nomi: str) -> List[Dict[str, Any]]:
    n = _norm(nomi)
    if not n:
        return []
    aniq = [it for it in items if str(it.get("id")) == nomi or _norm(it.get("name")) == n]
    if aniq:
        return aniq
    return [it for it in items if all(w in _norm(it.get("name")) for w in n.split())]


def _oxirgi(it: Dict[str, Any]) -> str:
    lr = it.get("lastRun") or {}
    if not lr:
        return "hali ishlamagan"
    dt = config.parse_iso(str(lr.get("startedAt") or ""))
    vaqt = config.fmt_local(dt, "%d.%m %H:%M") if dt else "-"
    if lr.get("status") == "ok":
        return "%s, OK, %s qator" % (vaqt, TZ._pul(lr.get("rowsWritten")))
    return "%s, XATO: %s" % (vaqt, str(lr.get("error") or "-")[:120])


def _cron(it: Dict[str, Any]) -> str:
    c = it.get("cron") or {}
    if not c.get("enabled"):
        return "avtomatik o'chiq"
    soat = ""
    if c.get("hourFrom") is not None and c.get("hourTo") is not None:
        soat = ", %02d-%02d" % (int(c["hourFrom"]), int(c["hourTo"]))
    return "avtomatik har %s daq%s" % (c.get("everyMinutes") or "?", soat)


async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None) -> bool:
    """`EKSPORT:` qatori bo'lsa ishlaydi va True qaytaradi. Hech qachon exception chiqarmaydi."""
    nomi = parse(text)
    if nomi is None:
        return False
    try:
        await _handle(nomi, outbox, reply_to)
    except Exception:  # noqa: BLE001
        log.exception("eksport yiqildi")
        await TZ._say(outbox, "Eksportlar ro'yxati tayyorlanmadi: ichki xato.", reply_to=reply_to)
    return True


async def _royxat(outbox: Any) -> Optional[List[Dict[str, Any]]]:
    try:
        r = await asyncio.to_thread(TZ._koprik, C.TOLOV_KOPRIK_EKSPORT_YOL)
    except TZ.KoprikXato as exc:
        await TZ._say(outbox, "Eksportlar ro'yxati o'qilmadi: %s." % exc.sabab)
        return None
    return [it for it in (r.get("items") or []) if isinstance(it, dict) and _ID_RE.match(str(it.get("id") or ""))]


async def _handle(nomi: str, outbox: Any, reply_to: Optional[int]) -> None:
    items = await _royxat(outbox)
    if items is None:
        return
    if not items:
        await TZ._say(outbox, "Google Sheets eksporti sozlanmagan (Admin > Export).", reply_to=reply_to)
        return
    mos = _mos(items, nomi) if nomi else []
    if len(mos) == 1:
        await _tasdiq_sorovi(mos[0], outbox, reply_to)
        return
    token = secrets.token_hex(8)
    roy = {"token": token, "created_ts": config.now_utc().timestamp(), "ids": [str(it["id"]) for it in items[:20]]}
    roy_key = C.kv_key(C.KV_EK_ROY, token=token)
    await asyncio.to_thread(db.kv_set_json, roy_key, roy)
    bosh = ("\"%s\" ga mos eksport topilmadi. " % nomi if nomi and not mos else
            ("\"%s\" ga bir nechta eksport mos keldi. " % nomi if nomi else ""))
    q = [bosh + "Qaysi eksportni ishga tushiray?"]
    for i, it in enumerate(items[:20], 1):
        q.append("%d. %s — oxirgi: %s; %s" % (i, it.get("name") or it.get("id"), _oxirgi(it), _cron(it)))
    q += ["", "Raqamini yozing (masalan: 1)."]
    mid = await TZ._say(outbox, "\n".join(q), reply_to=reply_to)
    if mid is not None:
        roy["mid"] = mid
        await asyncio.to_thread(db.kv_set_json, roy_key, roy)


async def matn_tanlov(text: Any, reply_mid: Optional[int], outbox: Any) -> bool:
    """Ro'yxatdan raqam bilan tanlash ("1", "2."). Kutilayotgan ro'yxat bo'lmasa yoki raqam emas — False."""
    m = C.TANLOV_RE.match(str(text or ""))
    if not m:
        return False
    royxatlar = []
    for key in await asyncio.to_thread(db.kv_keys, C.KV_EK_ROY.split("{", 1)[0]):
        r = await asyncio.to_thread(db.kv_get_json, key)
        if isinstance(r, dict) and _TOKEN_RE.match(str(r.get("token") or "")) and not TZ._eskirgan(r):
            royxatlar.append((key, r))
    if not royxatlar:
        return False
    tanlov = [x for x in royxatlar if reply_mid and x[1].get("mid") == reply_mid]
    key, roy = tanlov[0] if tanlov else max(royxatlar, key=lambda x: float(x[1].get("created_ts") or 0))
    ids = roy.get("ids") or []
    idx = int(m.group(1)) - 1
    if not 0 <= idx < len(ids):
        await TZ._say(outbox, "Bunday raqam yo'q: 1 dan %d gacha yozing." % len(ids))
        return True
    items = await _royxat(outbox)
    it = next((x for x in (items or []) if str(x.get("id")) == str(ids[idx])), None)
    if it is None:
        await TZ._say(outbox, "Eksport topilmadi (sozlama o'zgargan bo'lishi mumkin). Qaytadan /eksport yozing.")
        return True
    await asyncio.to_thread(db.kv_del, key)
    await _tasdiq_sorovi(it, outbox, None)
    return True


async def tanla(data: str, outbox: Any, message_id: Optional[int]) -> str:
    """Ro'yxat tugmasi: ek_t:<token>:<i>. Toast qaytaradi."""
    try:
        token, idx_s = data[len(C.CB_EK_TANLA):].split(":", 1)
        idx = int(idx_s)
    except (ValueError, AttributeError):
        return C.MSG_MUDDAT_OTGAN
    if not _TOKEN_RE.match(token):
        return C.MSG_MUDDAT_OTGAN
    roy = await asyncio.to_thread(db.kv_get_json, C.kv_key(C.KV_EK_ROY, token=token))
    if not isinstance(roy, dict) or TZ._eskirgan(roy) or not (0 <= idx < len(roy.get("ids") or [])):
        return C.MSG_MUDDAT_OTGAN
    sid = str(roy["ids"][idx])
    items = await _royxat(outbox)
    it = next((x for x in (items or []) if str(x.get("id")) == sid), None)
    if it is None:
        return "Eksport topilmadi (sozlama o'zgargan bo'lishi mumkin)."
    if message_id:
        try:
            await outbox.edit_keyboard(message_id, None)
        except Exception:  # noqa: BLE001
            log.exception("eksport: tugmalar olinmadi")
    await _tasdiq_sorovi(it, outbox, None)
    return "Tanlandi: %s" % str(it.get("name") or sid)[:40]


async def _tasdiq_sorovi(it: Dict[str, Any], outbox: Any, reply_to: Optional[int]) -> None:
    e = TZ._e
    token = secrets.token_hex(8)
    payload = {"token": token, "created_ts": config.now_utc().timestamp(), "id": str(it["id"]),
               "nomi": str(it.get("name") or it["id"])[:120]}
    key = C.kv_key(C.KV_EK_APPR, token=token)
    await asyncio.to_thread(db.kv_set_json, key, payload)
    rejim = "almashtirish (replace)" if it.get("writeMode") != "upsert" else "yangilash (upsert)"
    manba = "Tranzaksiyalar" if it.get("source") == "transaction" else "OplatyKv"
    matn = "\n".join([
        "<b>Eksportni ishga tushirish</b> — tasdiqlang", "",
        "Sheet: <b>%s</b>%s" % (e(payload["nomi"]), (" / " + e(it.get("tabName"))) if it.get("tabName") else ""),
        "Manba: %s · rejim: %s" % (e(manba), e(rejim)),
        "Oxirgi ish: %s" % e(_oxirgi(it)), "Jadval: %s" % e(_cron(it)), "",
        "Ishga tushirilsa sheet yangilanadi (bir necha daqiqa olishi mumkin).", "",
        e(C.TASDIQ_YOZING.format(daq=max(1, C.APPROVAL_TTL_S // 60))),
    ])
    mid = await TZ._say(outbox, matn, html_mode=True, reply_to=reply_to,
                        hist=re.sub(r"<[^>]+>", "", html.unescape(matn)))
    if mid is None:
        await asyncio.to_thread(db.kv_del, key)
    else:
        payload["mid"] = mid
        await asyncio.to_thread(db.kv_set_json, key, payload)


def kutilayotgan() -> List[Tuple[str, Dict[str, Any]]]:
    out: List[Tuple[str, Dict[str, Any]]] = []
    for key in db.kv_keys(C.KV_EK_APPR.split("{", 1)[0]):
        p = db.kv_get_json(key)
        if isinstance(p, dict) and _TOKEN_RE.match(str(p.get("token") or "")) and not TZ._eskirgan(p):
            out.append((str(p["token"]), p))
    return out


async def decide(token: str, approve: bool, outbox: Any, message_id: Optional[int]) -> str:
    """[Ha]/[Yo'q] yoki matnli tasdiq. Bir martalik (ek_run_<token> claim). Toast qaytaradi."""
    if not _TOKEN_RE.match(token or ""):
        return C.MSG_MUDDAT_OTGAN
    appr, run = C.kv_key(C.KV_EK_APPR, token=token), C.kv_key(C.KV_EK_RUN, token=token)
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
            log.exception("eksport: tugmalar olinmadi")
    if TZ._eskirgan(payload):
        await TZ._say(outbox, "Tasdiq muddati o'tdi. Eksport ishga tushirilmadi, qaytadan so'rang.")
        return C.MSG_MUDDAT_OTGAN
    if not approve:
        await TZ._say(outbox, C.MSG_EKSPORT_BEKOR)
        return C.MSG_EKSPORT_BEKOR
    task = asyncio.create_task(_run(payload, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return C.MSG_EKSPORT_QABUL


async def _run(payload: Dict[str, Any], outbox: Any) -> None:
    sid, nomi = str(payload.get("id") or ""), str(payload.get("nomi") or "")
    if not _ID_RE.match(sid):
        await TZ._say(outbox, "Eksport ishga tushirilmadi: ID noto'g'ri.")
        return
    try:
        r = await asyncio.to_thread(TZ._koprik, C.EKSPORT_RUN_YOL_TPL.format(id=sid), body={},
                                    timeout=C.EKSPORT_RUN_TIMEOUT_S, ruxsat_run=True)
    except TZ.KoprikXato as exc:
        sabab = exc.sabab
        if "409" in sabab:
            sabab = "bu eksport hozir ishlayapti, birozdan keyin qayta urining"
        await TZ._say(outbox, "Eksport \"%s\" bajarilmadi: %s." % (nomi, sabab))
        return
    except Exception:  # noqa: BLE001
        log.exception("eksport run yiqildi")
        await TZ._say(outbox, "Eksport \"%s\" bajarilmadi: ichki xato." % nomi)
        return
    soniya = round(float(r.get("durationMs") or 0) / 1000)
    await TZ._say(outbox, "Eksport \"%s\" bajarildi: %s qator yozildi (%s ta olindi), %d soniya." % (
        nomi, TZ._pul(r.get("rowsWritten")), TZ._pul(r.get("rowsFetched")), soniya))


def purge_pending() -> int:
    return (db.kv_del_prefix(C.KV_EK_APPR.split("{", 1)[0])
            + db.kv_del_prefix(C.KV_EK_ROY.split("{", 1)[0]))
