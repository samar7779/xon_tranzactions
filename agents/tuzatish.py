"""To'lovni tuzatish — TR Support (egasi [Ha] bosgach to'lov ustunlarini tahrirlash).

Oqim (LLM'siz, deterministik; Leader faqat egasi matnini `TUZATISH:` qatoriga aylantiradi):
1. `TUZATISH: tx=<to'lov ID> kontragent=<..> kategoriya=<..> shartnoma=<..> tasdiq=<ism> izoh=<matn>`
   (bir nechta to'lov: bir nechta qator). Noma'lum qiymat `?` yoki yo'q -> bot to'lovning hozirgi holatini va
   BARCHA variantlarni ko'rsatib so'raydi. `qolsin` -> ustun o'zgarmaydi.
2. Hammasi ma'lum -> backend tekshiruvi (GET tx-edit/preview: variant bormi, kategoriya shu kontragentdami,
   shartnoma CRM'da bormi). Xato bo'lsa egasiga aytiladi ("CRM'da topilmadi — boshqa shartnoma bering"), tugma yo'q.
3. Hammasi to'g'ri -> oldin/keyin ko'rinishi + [Ha, tahrirla] [Yo'q]. Tasdiq APPROVAL_TTL_S amal qiladi.
4. [Ha] -> POST tx-edit/apply (panelning setManual/setContract yo'llari, tarix tr_support_edits) va BITTA
   OplatyKv sync. Natija egasiga; ortga qaytarish panelda (TR Support tabi).
Ko'prik: faqat loopback, kalit header'da (payment_check bilan bir xil manzil va kalit).
"""
from __future__ import annotations

import asyncio
import html
import json
import logging
import re
import secrets
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode, urlsplit

from . import config
from . import contract as C
from . import db
from . import history

log = logging.getLogger("agents.tuzatish")

_KALITLAR = ("tx", "kontragent", "kategoriya", "shartnoma", "tasdiq", "izoh")
_KALIT_RE = re.compile(r"(?i)\b(%s)\s*=\s*" % "|".join(_KALITLAR))
_TOKEN_RE = re.compile(r"^[0-9a-f]{16}$")
_TX_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{5,199}$")
_NOMALUM = {"", "?", "??", "nomalum", "noma'lum"}
_MAYDON_NOMI = {"kontragent": "Kontragent", "kategoriya": "Kategoriya", "shartnoma": "Shartnoma"}
_YOLLAR = (C.TUZATISH_KOPRIK_OPTIONS, C.TUZATISH_KOPRIK_PREVIEW, C.TUZATISH_KOPRIK_APPLY)
_BG_TASKS: set = set()


class KoprikXato(Exception):
    def __init__(self, sabab: str) -> None:
        super().__init__(sabab)
        self.sabab = sabab


@dataclass
class Qator:
    tx: str = ""
    kontragent: Optional[str] = None      # None = aytilmagan (so'raladi); "qolsin" = o'zgarmaydi
    kategoriya: Optional[str] = None
    shartnoma: Optional[str] = None
    tasdiq: Optional[str] = None
    izoh: Optional[str] = None

    def yetishmaydi(self) -> List[str]:
        return [k for k in ("kontragent", "kategoriya", "shartnoma", "tasdiq", "izoh") if getattr(self, k) is None]


# ---------------------------------------------------------------------------
# Parse
# ---------------------------------------------------------------------------
def _qiymat(v: str) -> Optional[str]:
    t = re.sub(r"\s+", " ", (v or "").strip().strip(",;")).strip()
    return None if t.lower() in _NOMALUM else t[:200]


def parse(text: Any) -> List[Qator]:
    """Matndagi barcha `TUZATISH:` qatorlari (ko'pi bilan TUZATISH_MAX)."""
    out: List[Qator] = []
    for m in C.TUZATISH_RE.finditer(str(text or "")):
        body = m.group(1)
        q = Qator()
        topilgan = list(_KALIT_RE.finditer(body))
        for i, km in enumerate(topilgan):
            oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(body)
            kalit = km.group(1).lower()
            v = _qiymat(body[km.end():oxir])
            if kalit == "tx":
                q.tx = (v or "").split(" ")[0].strip("\"'")
            elif getattr(q, kalit) is None:
                setattr(q, kalit, v)
        out.append(q)
        if len(out) >= C.TUZATISH_MAX:
            break
    return out


def _qolsin(v: Optional[str]) -> bool:
    return (v or "").strip().lower() in (C.TUZATISH_QOLSIN, "o'zgarmasin", "ozgarmasin")


def _param(v: Optional[str]) -> str:
    """Ko'prikka: qolsin -> '' (backend: bo'sh = o'zgarmaydi)."""
    return "" if v is None or _qolsin(v) else v


# ---------------------------------------------------------------------------
# Ko'prik (payment_check bilan bir xil manzil, kalit va himoya)
# ---------------------------------------------------------------------------
def _urlopen(req: urllib.request.Request, timeout: float) -> Any:
    """Tarmoq (testda almashtiriladi): proxy yo'q, redirect taqiq."""
    from . import payment_check as pc
    return pc._opener().open(req, timeout=timeout)


def _koprik(yol: str, *, params: Optional[Dict[str, str]] = None, body: Optional[Dict[str, Any]] = None,
            timeout: float = 90.0) -> Dict[str, Any]:
    """GET (params) yoki POST (body) — faqat _YOLLAR. Kalit faqat header'da, xato matni kalitsiz."""
    from . import payment_check as pc
    if yol not in _YOLLAR:
        raise ValueError("ko'prik yo'li oq ro'yxatda yo'q")
    base = pc._koprik_base()
    if not base:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_MANZIL)
    kalit = config.env(C.TOLOV_KOPRIK_ENV_KEY, "").strip()
    if not kalit:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_KALIT)
    url = base + yol + ("?" + urlencode(params) if params else "")
    if urlsplit(url).netloc != urlsplit(base).netloc:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_MANZIL)
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json", C.TOLOV_KOPRIK_HEADER: kalit, "User-Agent": "xon-agents/tuzatish"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET", headers=headers)
    try:
        with _urlopen(req, timeout) as resp:
            raw = resp.read(C.TOLOV_KOPRIK_JAVOB_MAX + 1)
    except urllib.error.HTTPError as exc:
        code = int(getattr(exc, "code", 0) or 0)
        xabar = ""
        try:
            xabar = str(json.loads(exc.read(4096).decode("utf-8", "replace")).get("message") or "")
        except Exception:  # noqa: BLE001
            xabar = ""
        izoh = C.TOLOV_KOPRIK_HTTP_IZOH.get(code, "")
        raise KoprikXato(pc._sirsiz(("HTTP %d" % code) + (" (%s)" % izoh if izoh else "")
                                    + (": " + xabar[:200] if xabar else ""), kalit)) from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as exc:
        sabab = getattr(exc, "reason", exc)
        if isinstance(exc, (socket.timeout, TimeoutError)) or isinstance(sabab, (socket.timeout, TimeoutError)):
            raise KoprikXato("timeout") from None
        raise KoprikXato(pc._sirsiz("%s: %s" % (exc.__class__.__name__, sabab), kalit)) from None
    finally:
        del kalit
    if len(raw) > C.TOLOV_KOPRIK_JAVOB_MAX:
        raise KoprikXato("javob juda katta")
    try:
        out = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise KoprikXato("javob JSON emas") from None
    if not isinstance(out, dict) or out.get("ok") is not True:
        raise KoprikXato("javob shakli kutilmagan")
    return out


# ---------------------------------------------------------------------------
# Matnlar (oddiy matn va HTML; lotin, emoji yo'q)
# ---------------------------------------------------------------------------
def _e(s: Any) -> str:
    return html.escape(str(s if s is not None else ""), quote=False)


def _pul(v: Any) -> str:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return "-"
    butun = int(round(abs(n)))
    return ("-" if n < 0 else "") + "{:,}".format(butun).replace(",", " ")


def _sana(iso: Any) -> str:
    dt = config.parse_iso(str(iso or ""))
    return config.fmt_local(dt, "%d.%m.%Y %H:%M") if dt else "-"


def _tx_sarlavha(tx: Optional[Dict[str, Any]], ref: str) -> str:
    if not tx:
        return "To'lov %s" % ref
    return "%s · %s so'm · ID %s" % (_sana(tx.get("date")), _pul(tx.get("amount")), tx.get("externalId") or tx.get("id"))


def _hozir(tx: Optional[Dict[str, Any]]) -> str:
    if not tx:
        return "-"
    k = (tx.get("kontragent") or {}).get("name") or "yo'q"
    c = (tx.get("kategoriya") or {}).get("name") or "yo'q"
    return "Kontragent: %s; Kategoriya: %s; Shartnoma: %s" % (k, c, tx.get("shartnoma") or "yo'q")


def savol_matni(q: Qator, opt: Optional[Dict[str, Any]]) -> str:
    """Yetishmayotgan ma'lumotni so'rash: hozirgi holat, BARCHA variantlar, ma'lum bo'lganlar."""
    tx = (opt or {}).get("tx")
    qator = ["To'lovni tuzatish uchun aniq ma'lumot kerak.", "To'lov: " + _tx_sarlavha(tx, q.tx),
             "Hozir: " + _hozir(tx)]
    if tx and tx.get("editable") is False:
        qator.append("Diqqat: bu to'lov (Aloqa Bank importi) tahrirlanmaydi.")
    tanlangan = [("%s: %s" % (_MAYDON_NOMI.get(k, k.capitalize()), getattr(q, k))) for k in
                 ("kontragent", "kategoriya", "shartnoma", "tasdiq", "izoh") if getattr(q, k) is not None]
    if tanlangan:
        qator += ["", "Ma'lum: " + "; ".join(tanlangan)]
    qator.append("")
    kerak = q.yetishmaydi()
    tree = (opt or {}).get("kontragentlar") or []
    n = 1
    if "kontragent" in kerak:
        qator.append("%d) Kontragent (yoki \"qolsin\"): %s" % (n, " · ".join(t.get("name", "") for t in tree) or "-"))
        n += 1
    if "kategoriya" in kerak:
        qator.append("%d) Kategoriya (yoki \"qolsin\", \"yo'q\"):" % n)
        for t in tree:
            bola = ", ".join(c.get("name", "") for c in (t.get("kategoriyalar") or []))
            qator.append("   %s: %s" % (t.get("name", ""), bola or "kategoriyasiz"))
        n += 1
    if "shartnoma" in kerak:
        qator.append("%d) Shartnoma raqami (CRM'da tekshiriladi; yoki \"qolsin\", \"tozalash\")" % n)
        n += 1
    if "tasdiq" in kerak:
        qator.append("%d) Kim tasdiqlaydi (ism)" % n)
        n += 1
    if "izoh" in kerak:
        qator.append("%d) Izoh: nima uchun o'zgartirilmoqda" % n)
    qator += ["", "Bitta xabarda yozing. Masalan: \"shartnoma 206FZO25A2, qolganlari qolsin, tasdiqladi Samar,"
                  " izoh: chek bo'yicha\"."]
    return "\n".join(qator)


def _ozgarish_matni(ch: Dict[str, Any]) -> str:
    return "%s: %s -> %s" % (_MAYDON_NOMI.get(ch.get("field"), ch.get("field")), ch.get("from") or "yo'q",
                             ch.get("to") or "yo'q")


def preview_html(previews: List[Tuple[Qator, Dict[str, Any]]], tasdiq: str, izoh: str) -> str:
    q = ["<b>To'lovni tahrirlash</b> — tasdiqlang"]
    for i, (qt, p) in enumerate(previews, 1):
        tx = p.get("tx")
        q.append("")
        q.append("<b>%d. %s</b>" % (i, _e(_tx_sarlavha(tx, qt.tx))))
        for ch in p.get("changes") or []:
            q.append("• " + _e(_ozgarish_matni(ch)))
        crm = p.get("crm")
        if crm and crm.get("found"):
            q.append("  CRM: %s" % _e(", ".join(x for x in (crm.get("customerName"), crm.get("objectName")) if x) or "bor"))
        qolgan = [_MAYDON_NOMI[f] for f in ("kontragent", "kategoriya", "shartnoma")
                  if f not in {c.get("field") for c in (p.get("changes") or [])}]
        if qolgan:
            q.append("  O'zgarmaydi: " + _e(", ".join(qolgan)))
    q += ["", "Tasdiqladi: <b>%s</b>" % _e(tasdiq), "Izoh: %s" % _e(izoh),
          "Keyin OplatyKv sync bir marta ishlaydi. Tasdiq %d daqiqa amal qiladi." % max(1, C.APPROVAL_TTL_S // 60)]
    return "\n".join(q)


def natija_matni(r: Dict[str, Any]) -> str:
    holat = {"applied": "bajarildi", "failed": "qisman (xato)", "skipped": "bajarilmadi"}
    q = ["To'lov tahriri natijasi:"]
    for i, x in enumerate(r.get("results") or [], 1):
        q.append("%d. %s — %s" % (i, x.get("tx"), holat.get(x.get("status"), x.get("status"))))
        for ch in x.get("changes") or []:
            q.append("   " + _ozgarish_matni(ch))
        for err in x.get("errors") or []:
            q.append("   sabab: " + str(err)[:300])
    s = r.get("sync")
    if s is None:
        q.append("OplatyKv sync ishlamadi (tahrir bo'lmadi).")
    elif s.get("ok") is False:
        q.append("OplatyKv sync xato: %s. Panelda OplatyKv > Sync ni bosing." % (s.get("error") or "-"))
    else:
        q.append("OplatyKv sync bajarildi: qo'shildi %s, yangilandi %s." % (s.get("added", 0), s.get("updated", 0)))
    q.append(C.MSG_TUZATISH_PANEL)
    return "\n".join(q)


# ---------------------------------------------------------------------------
# Oqim
# ---------------------------------------------------------------------------
async def _say(outbox: Any, text: str, *, html_mode: bool = False, keyboard: Any = None,
               reply_to: Optional[int] = None, hist: Optional[str] = None) -> Optional[int]:
    mid = await outbox.send_text(text, html=html_mode, keyboard=keyboard, reply_to=reply_to)
    try:
        await asyncio.to_thread(history.add_history, C.ROLE_LEADER, hist if hist is not None else text)
    except Exception:  # noqa: BLE001 - tarix yozilmasa ham oqim davom etadi
        log.exception("tuzatish: tarix yozilmadi")
    return mid


async def handle(text: Any, outbox: Any, reply_to: Optional[int] = None) -> bool:
    """`TUZATISH:` qatorlari bo'lsa ishlaydi va True qaytaradi (Leader javobi o'rniga). Hech qachon exception."""
    qatorlar = parse(text)
    if not qatorlar:
        return False
    try:
        await _handle(qatorlar, outbox, reply_to)
    except Exception:  # noqa: BLE001
        log.exception("tuzatish yiqildi")
        await _say(outbox, "To'lov tahriri tayyorlanmadi: ichki xato. Qayta urinib ko'ring.", reply_to=reply_to)
    return True


async def _handle(qatorlar: List[Qator], outbox: Any, reply_to: Optional[int]) -> None:
    for q in qatorlar:
        if not _TX_RE.match(q.tx or ""):
            await _say(outbox, "To'lov ID si yo'q yoki noto'g'ri. Avval to'lovni toping (/tolov ...), keyin"
                               " \"shu to'lovni tuzat\" deng yoki /tuzat <to'lov ID>.", reply_to=reply_to)
            return
    # bir tasdiqda tasdiqlovchi va izoh bitta: bitta qatorda aytilgani hammasiga
    umumiy_tasdiq = next((q.tasdiq for q in qatorlar if q.tasdiq), None)
    umumiy_izoh = next((q.izoh for q in qatorlar if q.izoh), None)
    for q in qatorlar:
        q.tasdiq = q.tasdiq if q.tasdiq is not None else umumiy_tasdiq
        q.izoh = q.izoh if q.izoh is not None else umumiy_izoh
    # 1) yetishmayotgan ma'lumot -> variantlar bilan so'rash (birinchi to'liqmas to'lov uchun)
    tasdiqlar = {q.tasdiq for q in qatorlar if q.tasdiq}
    for q in qatorlar:
        if q.yetishmaydi():
            try:
                opt = await asyncio.to_thread(_koprik, C.TUZATISH_KOPRIK_OPTIONS, params={"tx": q.tx})
            except KoprikXato as exc:
                await _say(outbox, "Variantlar olinmadi: %s." % exc.sabab, reply_to=reply_to)
                return
            if opt.get("tx") is None:
                await _say(outbox, "To'lov topilmadi: %s. ID ni tekshiring." % q.tx, reply_to=reply_to)
                return
            await _say(outbox, savol_matni(q, opt), reply_to=reply_to)
            return
    if len(tasdiqlar) > 1:
        await _say(outbox, "Bir tasdiqda bitta tasdiqlovchi bo'ladi. Kim tasdiqlaydi: %s?" % ", ".join(sorted(tasdiqlar)),
                   reply_to=reply_to)
        return
    tasdiq = next(iter(tasdiqlar))
    izoh = "; ".join(dict.fromkeys(q.izoh for q in qatorlar if q.izoh))[:1000]

    # 2) backend tekshiruvi (faqat o'qish; CRM'da shartnoma bormi)
    previews: List[Tuple[Qator, Dict[str, Any]]] = []
    xatolar: List[str] = []
    for q in qatorlar:
        try:
            p = await asyncio.to_thread(_koprik, C.TUZATISH_KOPRIK_PREVIEW, params={
                "tx": q.tx, "kontragent": _param(q.kontragent), "kategoriya": _param(q.kategoriya),
                "shartnoma": _param(q.shartnoma)})
        except KoprikXato as exc:
            await _say(outbox, "Tekshiruv bajarilmadi: %s." % exc.sabab, reply_to=reply_to)
            return
        if not p.get("valid"):
            xatolar.append("%s:\n%s" % (_tx_sarlavha(p.get("tx"), q.tx),
                                        "\n".join("• " + str(e) for e in (p.get("errors") or ["tekshiruvdan o'tmadi"]))))
        previews.append((q, p))
    if xatolar:
        await _say(outbox, "Tahrirlab bo'lmaydi, to'g'rilang:\n\n" + "\n\n".join(xatolar), reply_to=reply_to)
        return

    # 3) tasdiq so'rovi
    token = secrets.token_hex(8)
    payload = {
        "token": token, "created_ts": config.now_utc().timestamp(), "tasdiq": tasdiq, "izoh": izoh,
        "items": [{"tx": q.tx, "kontragent": _param(q.kontragent), "kategoriya": _param(q.kategoriya),
                   "shartnoma": _param(q.shartnoma)} for q in qatorlar],
    }
    await asyncio.to_thread(db.kv_set_json, C.kv_key(C.KV_TZ_APPR, token=token), payload)
    matn = preview_html(previews, tasdiq, izoh)
    keyboard = [[(C.KNOPKA_TZ_HA, C.CB_TZ_OK + token), (C.KNOPKA_YOQ, C.CB_TZ_NO + token)]]
    mid = await _say(outbox, matn, html_mode=True, keyboard=keyboard, reply_to=reply_to,
                     hist=re.sub(r"<[^>]+>", "", html.unescape(matn)))
    if mid is None:
        await asyncio.to_thread(db.kv_del, C.kv_key(C.KV_TZ_APPR, token=token))


def _eskirgan(payload: Dict[str, Any]) -> bool:
    try:
        return config.now_utc().timestamp() - float(payload.get("created_ts") or 0) > C.APPROVAL_TTL_S
    except (TypeError, ValueError):
        return True


async def decide(token: str, approve: bool, outbox: Any, message_id: Optional[int]) -> str:
    """[Ha]/[Yo'q] (egasi chaqiruvchida tekshirilgan). Bir martalik: tz_run_<token> claim. Toast qaytaradi."""
    if not _TOKEN_RE.match(token or ""):
        return C.MSG_MUDDAT_OTGAN
    appr = C.kv_key(C.KV_TZ_APPR, token=token)
    run = C.kv_key(C.KV_TZ_RUN, token=token)
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
            log.exception("tuzatish: tugmalar olinmadi")
    if _eskirgan(payload):
        await _say(outbox, "Tasdiq muddati o'tdi. Hech narsa o'zgarmadi, qaytadan so'rang.")
        return C.MSG_MUDDAT_OTGAN
    if not approve:
        await _say(outbox, C.MSG_TUZATISH_BEKOR)
        return C.MSG_TUZATISH_BEKOR
    task = asyncio.create_task(_bajar(payload, outbox))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)
    return C.MSG_TUZATISH_QABUL


async def _bajar(payload: Dict[str, Any], outbox: Any) -> None:
    body = {"items": payload.get("items") or [], "approvedBy": payload.get("tasdiq") or "",
            "comment": payload.get("izoh") or None}
    try:
        r = await asyncio.to_thread(_koprik, C.TUZATISH_KOPRIK_APPLY, body=body, timeout=C.TUZATISH_APPLY_TIMEOUT_S)
    except KoprikXato as exc:
        await _say(outbox, "Tahrir bajarilmadi: %s. Holatni panelda (TR Support) tekshiring." % exc.sabab)
        return
    except Exception:  # noqa: BLE001
        log.exception("tuzatish apply yiqildi")
        await _say(outbox, "Tahrir bajarilmadi: ichki xato. Holatni panelda (TR Support) tekshiring.")
        return
    await _say(outbox, natija_matni(r))


def purge_pending() -> int:
    """/reset: kutilayotgan tasdiqlar o'chiriladi."""
    return db.kv_del_prefix(C.KV_TZ_APPR.split("{", 1)[0])
