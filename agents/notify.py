"""Egasiga xabar yuborish: Outbox protokoli va ikki amalga oshirish.

- Faqat egasining shaxsiy chatiga (settings.owner_id). HttpOutbox chat_id C.EGASI_TG_ID
  bilan mos kelmasa hech narsa yubormaydi (xato logga yoziladi).
- html=True -> parse_mode=HTML; Telegram "can't parse entities" desa shu bo'lak oddiy matn
  (teglarsiz, entity'lar ochilgan) bilan qayta yuboriladi.
- Matn 4000 belgidan qator chegarasida bo'linadi, HTML teglari bo'laklar orasida yopilib/ochiladi.
  Keyboard oxirgi bo'lakka, reply_to birinchi bo'lakka.
- Xatolar yutiladi va logga yoziladi (None qaytadi): alert yoki hisobot yuborilmasa jarayon yiqilmaydi.
- Outbox matnni o'zgartirmaydi (normalize_latin chaqiruvchi ishi).
- Token hech qachon logga chiqmaydi.

aiogram import QILINMAYDI (bot ichidagi AiogramOutbox leader_bot.py da).
Qo'lda sinov: python3 -m agents.notify [--dry-run] [matn]
"""
from __future__ import annotations

import argparse
import asyncio
import html as html_lib
import itertools
import json
import logging
import re
import time
import urllib.error
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

try:  # Python 3.8+
    from typing import Protocol
except ImportError:  # pragma: no cover
    Protocol = object  # type: ignore[assignment,misc]

from . import config
from . import contract as C

log = logging.getLogger("agents.notify")

Keyboard = List[List[Tuple[str, str]]]  # qatorlar; (matn, callback_data)

TELEGRAM_HARD_LIMIT = 4096
CAPTION_LIMIT = 1024
_RETRY_AFTER_MAX_S = 30

# Telegram HTML teglari (bo'laklar orasida muvozanat va oddiy matnga o'tish uchun)
_HTML_TEGLAR = frozenset({
    "b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a",
    "span", "tg-spoiler", "tg-emoji", "blockquote",
})
_TAG_RE = re.compile(r"<(/?)([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*)?>")


# ---------------------------------------------------------------------------
# Protokol
# ---------------------------------------------------------------------------
class Outbox(Protocol):
    async def send_text(self, text: str, *, html: bool = True, keyboard: Optional[Keyboard] = None,
                        reply_to: Optional[int] = None) -> Optional[int]:
        """Oxirgi bo'lak message_id si yoki None."""
        ...

    async def send_document(self, filename: str, data: bytes, *,
                            caption: Optional[str] = None) -> Optional[int]:
        ...

    async def edit_keyboard(self, message_id: int, keyboard: Optional[Keyboard] = None) -> None:
        ...

    async def set_reaction(self, message_id: int, emoji: Optional[str]) -> None:
        """emoji=None reaksiyani olib tashlaydi."""
        ...

    async def delete(self, message_id: int) -> None:
        ...


# ---------------------------------------------------------------------------
# Matnni bo'lish (sof)
# ---------------------------------------------------------------------------
def _cut_point(s: str, limit: int) -> int:
    """Juda uzun qatorni kesish nuqtasi: bo'shliqda, teg yoki entity ichida emas."""
    cut = limit
    ws = s.rfind(" ", int(limit * 0.8), limit)
    if ws > 0:
        cut = ws + 1
    lt, gt = s.rfind("<", 0, cut), s.rfind(">", 0, cut)
    if lt > gt and lt > 0:
        cut = lt
    amp, semi = s.rfind("&", 0, cut), s.rfind(";", 0, cut)
    if amp > semi and amp > 0 and cut - amp <= 10:
        cut = amp
    return max(cut, 1)


def split_text(text: str, limit: int = C.TELEGRAM_LIMIT) -> List[str]:
    """Matnni qator chegarasidan <= limit bo'laklarga bo'ladi. Bo'sh matn -> []."""
    text = text or ""
    if not text.strip():
        return []
    if len(text) <= limit:
        return [text]
    chunks: List[str] = []
    cur = ""
    for piece in text.split("\n"):
        cand = piece if not cur else cur + "\n" + piece
        if len(cand) <= limit:
            cur = cand
            continue
        if cur:
            chunks.append(cur)
            cur = ""
        while len(piece) > limit:
            cut = _cut_point(piece, limit)
            chunks.append(piece[:cut])
            piece = piece[cut:]
        cur = piece
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c.strip()]


def _balance_html(chunks: Sequence[str]) -> List[str]:
    """Bo'lak oxirida ochiq teglar yopiladi, keyingi bo'lak boshida qayta ochiladi."""
    out: List[str] = []
    carry: List[Tuple[str, str]] = []
    for chunk in chunks:
        prefix = "".join(tag for _, tag in carry)
        stack = list(carry)
        for m in _TAG_RE.finditer(chunk):
            name = m.group(2).lower()
            if name not in _HTML_TEGLAR:
                continue
            if m.group(1):
                for k in range(len(stack) - 1, -1, -1):
                    if stack[k][0] == name:
                        del stack[k]
                        break
            else:
                stack.append((name, m.group(0)))
        suffix = "".join("</%s>" % name for name, _ in reversed(stack))
        out.append(prefix + chunk + suffix)
        carry = stack
    return out


def chunks_for_send(text: str, html: bool) -> List[str]:
    """Yuborish uchun bo'laklar (HTML bo'lsa teglar muvozanatlangan)."""
    chunks = split_text(text)
    if html and len(chunks) > 1:
        chunks = _balance_html(chunks)
    return chunks


def plain_fallback(chunk: str) -> str:
    """HTML parse xatosida: ma'lum teglar olib tashlanadi, entity'lar ochiladi."""
    stripped = _TAG_RE.sub(lambda m: "" if m.group(2).lower() in _HTML_TEGLAR else m.group(0), chunk)
    return html_lib.unescape(stripped)


def is_parse_error(desc: str) -> bool:
    return C.HTML_PARSE_XATO in (desc or "").lower()


def _is_not_modified(desc: str) -> bool:
    return "message is not modified" in (desc or "").lower()


def safe_filename(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name or "fayl")[:64]
    return name or "fayl"


# ---------------------------------------------------------------------------
# HttpOutbox: urllib + Bot API (standalone skriptlar uchun)
# ---------------------------------------------------------------------------
class HttpOutbox:
    """Bot API'ga to'g'ridan urllib bilan. Bloklovchi chaqiruv asyncio.to_thread ichida."""

    API = "https://api.telegram.org"

    def __init__(self, token: Optional[str] = None, chat_id: Optional[int] = None, timeout: int = 30) -> None:
        settings = config.get_settings()
        self._token = settings.bot_token if token is None else token
        self._chat_id = settings.owner_id if chat_id is None else chat_id
        self._timeout = timeout
        # Faqat egasi (C.EGASI_TG_ID): LEADER_TG_ID xato bo'lsa begona chatga hech narsa ketmaydi
        self._blocked = _as_int(self._chat_id) != C.EGASI_TG_ID
        if self._blocked:
            log.error("HttpOutbox o'chirildi: chat_id egasi ID si bilan mos emas (LEADER_TG_ID ni tekshiring)")

    def __repr__(self) -> str:  # token logga chiqmasin
        return "HttpOutbox(chat_id=%r)" % (self._chat_id,)

    # --- past daraja -------------------------------------------------------
    def _request(self, method: str, payload: Dict[str, Any],
                 files: Optional[Dict[str, Tuple[str, bytes]]] = None) -> Tuple[bool, Any, str, int]:
        """(ok, result, description, retry_after). Hech qachon ko'tarmaydi."""
        if self._blocked:
            log.error("%s yuborilmadi: chat_id egasi ID si emas", method)
            return False, None, "chat_id egasi ID si emas", 0
        if not self._token:
            return False, None, "LEADER_BOT_TOKEN yo'q", 0
        url = "%s/bot%s/%s" % (self.API, self._token, method)
        if files:
            body, ctype = _multipart(payload, files)
        else:
            body, ctype = json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json"
        req = urllib.request.Request(url, data=body, headers={"Content-Type": ctype}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            try:
                data = json.loads(exc.read().decode("utf-8", "replace"))
            except (ValueError, OSError):
                data = {"ok": False, "description": "HTTP %s" % exc.code}
        except (urllib.error.URLError, OSError, ValueError) as exc:
            # URL (token bilan) logga chiqmasin: faqat klass nomi
            return False, None, exc.__class__.__name__, 0
        if not isinstance(data, dict):
            return False, None, "javob JSON emas", 0
        params = data.get("parameters") or {}
        retry_after = int(params.get("retry_after") or 0) if isinstance(params, dict) else 0
        return bool(data.get("ok")), data.get("result"), str(data.get("description") or ""), retry_after

    def _call(self, method: str, payload: Dict[str, Any],
              files: Optional[Dict[str, Tuple[str, bytes]]] = None) -> Tuple[bool, Any, str]:
        ok, result, desc, retry_after = self._request(method, payload, files)
        if not ok and retry_after:
            time.sleep(min(retry_after, _RETRY_AFTER_MAX_S))
            ok, result, desc, _ = self._request(method, payload, files)
        return ok, result, desc

    def _send_chunk(self, chunk: str, html: bool, markup: Optional[Dict[str, Any]],
                    reply_to: Optional[int]) -> Optional[int]:
        payload: Dict[str, Any] = {"chat_id": self._chat_id, "text": chunk,
                                   "disable_web_page_preview": True}
        if html:
            payload["parse_mode"] = "HTML"
        if markup:
            payload["reply_markup"] = markup
        if reply_to:
            payload["reply_to_message_id"] = reply_to
            payload["allow_sending_without_reply"] = True
        ok, result, desc = self._call("sendMessage", payload)
        if not ok and html and is_parse_error(desc):
            payload.pop("parse_mode", None)
            payload["text"] = plain_fallback(chunk)
            ok, result, desc = self._call("sendMessage", payload)
        if not ok:
            log.warning("sendMessage xato: %s", desc[:200])
            return None
        return int(result.get("message_id")) if isinstance(result, dict) else None

    # --- Outbox ------------------------------------------------------------
    def _send_text_sync(self, text: str, html: bool, keyboard: Optional[Keyboard],
                        reply_to: Optional[int]) -> Optional[int]:
        chunks = chunks_for_send(text, html)
        if not chunks:
            log.warning("bo'sh xabar yuborilmadi")
            return None
        last: Optional[int] = None
        for i, chunk in enumerate(chunks):
            is_last = i == len(chunks) - 1
            markup = _markup_json(keyboard) if (keyboard and is_last) else None
            last = self._send_chunk(chunk, html, markup, reply_to if i == 0 else None)
        return last

    async def send_text(self, text: str, *, html: bool = True, keyboard: Optional[Keyboard] = None,
                        reply_to: Optional[int] = None) -> Optional[int]:
        try:
            return await asyncio.to_thread(self._send_text_sync, text, html, keyboard, reply_to)
        except Exception as exc:  # hech qachon yiqilmasin
            log.warning("send_text yiqildi: %s", exc.__class__.__name__)
            return None

    def _send_document_sync(self, filename: str, data: bytes, caption: Optional[str]) -> Optional[int]:
        payload: Dict[str, Any] = {"chat_id": str(self._chat_id)}
        cap = (caption or "")[:CAPTION_LIMIT]
        if cap:
            payload["caption"] = cap
            payload["parse_mode"] = "HTML"
        files = {"document": (safe_filename(filename), data)}
        ok, result, desc = self._call("sendDocument", payload, files)
        if not ok and cap and is_parse_error(desc):
            payload.pop("parse_mode", None)
            payload["caption"] = plain_fallback(cap)[:CAPTION_LIMIT]
            ok, result, desc = self._call("sendDocument", payload, files)
        if not ok:
            log.warning("sendDocument xato: %s", desc[:200])
            return None
        return int(result.get("message_id")) if isinstance(result, dict) else None

    async def send_document(self, filename: str, data: bytes, *,
                            caption: Optional[str] = None) -> Optional[int]:
        try:
            return await asyncio.to_thread(self._send_document_sync, filename, data, caption)
        except Exception as exc:
            log.warning("send_document yiqildi: %s", exc.__class__.__name__)
            return None

    async def edit_keyboard(self, message_id: int, keyboard: Optional[Keyboard] = None) -> None:
        payload: Dict[str, Any] = {"chat_id": self._chat_id, "message_id": message_id}
        if keyboard:
            payload["reply_markup"] = _markup_json(keyboard)
        try:
            ok, _, desc = await asyncio.to_thread(self._call, "editMessageReplyMarkup", payload)
            if not ok and not _is_not_modified(desc):
                log.info("editMessageReplyMarkup: %s", desc[:200])
        except Exception as exc:
            log.warning("edit_keyboard yiqildi: %s", exc.__class__.__name__)

    async def set_reaction(self, message_id: int, emoji: Optional[str]) -> None:
        reaction = [{"type": "emoji", "emoji": emoji}] if emoji else []
        payload = {"chat_id": self._chat_id, "message_id": message_id, "reaction": reaction}
        try:
            ok, _, desc = await asyncio.to_thread(self._call, "setMessageReaction", payload)
            if not ok:
                log.debug("setMessageReaction: %s", desc[:200])
        except Exception as exc:
            log.debug("set_reaction yiqildi: %s", exc.__class__.__name__)

    async def delete(self, message_id: int) -> None:
        payload = {"chat_id": self._chat_id, "message_id": message_id}
        try:
            ok, _, desc = await asyncio.to_thread(self._call, "deleteMessage", payload)
            if not ok:
                log.debug("deleteMessage: %s", desc[:200])
        except Exception as exc:
            log.debug("delete yiqildi: %s", exc.__class__.__name__)


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _markup_json(keyboard: Keyboard) -> Dict[str, Any]:
    return {"inline_keyboard": [[{"text": t, "callback_data": d} for t, d in row] for row in keyboard]}


def _multipart(fields: Dict[str, Any], files: Dict[str, Tuple[str, bytes]]) -> Tuple[bytes, str]:
    boundary = "xonagents" + uuid.uuid4().hex
    parts: List[bytes] = []
    for name, value in fields.items():
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n" % (boundary, name)).encode("utf-8"))
        parts.append(str(value).encode("utf-8") + b"\r\n")
    for name, (filename, data) in files.items():
        head = ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n" % (boundary, name, safe_filename(filename)))
        parts.append(head.encode("utf-8"))
        parts.append(bytes(data) + b"\r\n")
    parts.append(("--%s--\r\n" % boundary).encode("utf-8"))
    return b"".join(parts), "multipart/form-data; boundary=%s" % boundary


# ---------------------------------------------------------------------------
# PrintOutbox: stdout ga (dry-run, testlar)
# ---------------------------------------------------------------------------
class PrintOutbox:
    """Hech narsa yubormaydi, stdout ga chop etadi. sent ro'yxati testlar uchun."""

    def __init__(self) -> None:
        self._ids = itertools.count(1)
        self.sent: List[Dict[str, Any]] = []

    def _record(self, kind: str, **data: Any) -> int:
        mid = next(self._ids)
        self.sent.append(dict(kind=kind, message_id=mid, **data))
        return mid

    async def send_text(self, text: str, *, html: bool = True, keyboard: Optional[Keyboard] = None,
                        reply_to: Optional[int] = None) -> Optional[int]:
        chunks = chunks_for_send(text, html)
        if not chunks:
            return None
        last: Optional[int] = None
        for i, chunk in enumerate(chunks):
            kb = keyboard if i == len(chunks) - 1 else None
            last = self._record("text", text=chunk, html=html, keyboard=kb)
            print("[notify #%d]%s\n%s" % (last, " (html)" if html else "", chunk))
            if kb:
                print("[tugmalar] " + " | ".join("%s=%s" % (t, d) for row in kb for t, d in row))
        return last

    async def send_document(self, filename: str, data: bytes, *,
                            caption: Optional[str] = None) -> Optional[int]:
        mid = self._record("document", filename=filename, size=len(data), caption=caption)
        print("[notify #%d] hujjat %s (%d bayt) %s" % (mid, filename, len(data), caption or ""))
        return mid

    async def edit_keyboard(self, message_id: int, keyboard: Optional[Keyboard] = None) -> None:
        self._record("edit_keyboard", target=message_id, keyboard=keyboard)
        print("[notify] #%d tugmalar %s" % (message_id, "almashtirildi" if keyboard else "olib tashlandi"))

    async def set_reaction(self, message_id: int, emoji: Optional[str]) -> None:
        self._record("reaction", target=message_id, emoji=emoji)

    async def delete(self, message_id: int) -> None:
        self._record("delete", target=message_id)
        print("[notify] #%d o'chirildi" % message_id)


# ---------------------------------------------------------------------------
# Ro'yxatga olish
# ---------------------------------------------------------------------------
_OUTBOX: Optional[Outbox] = None


def set_outbox(o: Outbox) -> None:
    global _OUTBOX
    _OUTBOX = o


def get_outbox() -> Outbox:
    """Ro'yxatdan o'tgan (bot ichida AiogramOutbox) yoki HttpOutbox (keshlanadi)."""
    global _OUTBOX
    if _OUTBOX is None:
        _OUTBOX = HttpOutbox()
    return _OUTBOX


def main(argv: Optional[List[str]] = None) -> int:
    """python3 -m agents.notify [--dry-run] [matn] — egasiga sinov xabari."""
    config.configure_logging()
    ap = argparse.ArgumentParser(prog="agents.notify")
    ap.add_argument("--dry-run", action="store_true", help="yubormaydi, stdout ga chop etadi")
    ap.add_argument("matn", nargs="*")
    args = ap.parse_args(argv)
    text = " ".join(args.matn) or "Sinov xabari."
    outbox: Outbox = PrintOutbox() if args.dry_run else HttpOutbox()
    mid = asyncio.run(outbox.send_text(text, html=False))
    print("message_id: %s" % mid)
    return 0 if mid else 1


if __name__ == "__main__":
    raise SystemExit(main())
