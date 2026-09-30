"""Leader bot (aiogram 3, long polling) — KOD 1.

Ishga tushirish: python3 -m agents.leader_bot  (systemd: xon-tranzactions-leader, Restart=always).

- Faqat egasi (LEADER_TG_ID) va faqat shaxsiy chat. Boshqa odam, guruh, kanal: to'liq jim (R13: guruh yo'q).
- Egasi xabarlari navbatma-navbat (asyncio.Lock); buyruq va tugmalar navbatsiz.
- Agentlar faqat runner orqali (Claude Code CLI + setup token). SDK/API yo'q.
- Fon vazifalar shu jarayonda: manba kuzatuvchi (15 s), heartbeat, va'da eslatmasi (25 daq x3),
  tozalash (24 soat), Facts (5 daq), Checker (4 soat), Teacher kunlik (22:30 Toshkent).
- Ixtiyoriy modullar (reja, memory_blocks, support_facts, checker_worker, teacher_daily, payment_check)
  kerak paytda yuklanadi: biri buzilsa bot ishlashda davom etadi va Support REJA orqali tuzatish mumkin.
- To'lov tekshiruvi (payment_check): /tolov (LLM'siz jadval) va checker delegatsiyasida (intent
  payment_check yoki topshiriqda "TOLOV:" qatori) bot blokni topshiriqqa qo'shadi. Faqat o'qish.
"""
from __future__ import annotations

import asyncio
import contextvars
import html
import importlib
import logging
import os
import re
import secrets
import time
from datetime import timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable, Collection, Dict, List, Optional, Sequence, Set, Tuple

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest, TelegramRetryAfter
from aiogram.filters import Command
from aiogram.types import (
    BufferedInputFile,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    ReactionTypeEmoji,
)

from . import config
from . import contract as C
from . import db
from . import db_migrations
from . import history
from . import leader_logic as L
from . import notify
from . import runner

log = logging.getLogger("agents.leader_bot")

# ---------------------------------------------------------------------------
# Sozlamalar (kod ichidagi, sir emas)
# ---------------------------------------------------------------------------
_MAX_DOWNLOAD = 20 * 1024 * 1024          # Bot API getFile chegarasi
_IMG_EXT = frozenset({"jpg", "jpeg", "png", "webp", "gif"})
# Ariza fayli: PDF va Word ham (XATO sahifasidagi "Shartnoma biriktirish" qabul qiladigan turlar)
_DOC_EXT = frozenset({"pdf", "doc", "docx"})
_DOC_MIME = {"application/pdf": "pdf", "application/msword": "doc",
             "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"}
_MIME_EXT = {"image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
_TOKEN_RE = re.compile(r"^[0-9a-f]{6,32}$")
_TOLOV_CMD_RE = re.compile(r"^\s*/tolov(?:@\S+)?\s*", re.I)
_TUZAT_CMD_RE = re.compile(r"^\s*/tuzat(?:@\S+)?\s*", re.I)  # /tuzat <to'lov ID> [kalit=qiymat ...]  # /tolov yoki /tolov@bot_nomi
_JAVOB_TURLARI = frozenset({"sticker", "video", "animation", "document", "location", "contact",
                            "venue", "poll", "dice", "story"})
_WATCH_INTERVAL_S = 15
_WATCH_MAX_DEFER_S = 900                  # egasi suhbati tugashini ko'pi bilan shuncha kutadi
_HEARTBEAT_S = 60
_REMINDER_TICK_S = 60
_CLEANUP_EVERY_S = 24 * 3600
_CLI_TMP_MAX_AGE_S = 24 * 3600
_SUPERVISE_RETRY_S = 30
_AGENT_NAME_MAX = 32
_INTENT_MAX = 32
_TASK_MAX = 2000
_PREVIEW_MAX = 500
_TOAST_MAX = 200
_ALBUM_QUIET_S = 1.5                      # albomning oxirgi qismidan keyin shuncha jimlik: albom tugadi
_ALBUM_MAX_WAIT_S = 6.0                   # albomni ko'pi bilan shuncha yig'adi
_ALBUM_DONE_TTL_S = 600                   # ishlangan albom ID si shuncha eslab qolinadi

# LLM'siz matnlar (contract'da yo'qlari). Toza lotin, emoji yo'q.
_MSG_START = "Assalomu alaykum, shefim. Savolingizni yozing: holat, tushum, xato yoki kod tuzatish."
_MSG_SIR = "Yozmadim: sirga o'xshash qiymat bor."
_MSG_YOZMADIM_TPL = "Yozmadim: {sabab}."
_MSG_RASM_KATTA = "Shefim, rasm juda katta (20 MB dan ortiq). Kichikroq yuboring."
_MSG_RASM_FORMAT = "Shefim, bu rasm formatini o'qiy olmayman. jpg, png, webp yoki gif yuboring."
_MSG_RASM_XATO = "Shefim, rasmni yuklab ololmadim. Qayta yuboring."
_MSG_RASM_KOP_TPL = "Shefim, albomdan faqat birinchi {n} ta rasmni ko'raman."
_MSG_TUR_YOQ = "Shefim, bu turdagi xabarni o'qiy olmayman. Matn, rasm, PDF yoki Word yuboring."
_MSG_MODUL_YOQ_TPL = "Shefim, {modul} moduli yuklanmadi. Bot logini tekshirish kerak."
_MSG_RESTART_TPL = "Bot qayta ishga tushdi. {holat}."
_MSG_CLI_YOQ = "Shefim, claude CLI topilmadi. Agentlar ishlamaydi, CLAUDE_CMD ni tekshirish kerak."
_SABAB_BOSH = "bo'sh javob keldi"
_SABAB_FORMAT = "javob formati buzuq"
_SABAB_ICHKI = "ichki xato"
_HIST_RASM = "(rasm yubordi)"
_HIST_RASM_BILAN = "(rasm bilan)"
_HIST_OVOZ = "(ovozli xabar)"

# ---------------------------------------------------------------------------
# Holat (faqat shu jarayon; umumiy holat kv_store'da)
# ---------------------------------------------------------------------------
_BOT: Optional[Bot] = None
_OUTBOX: Optional["AiogramOutbox"] = None
_OWNER_LOCK: Optional[asyncio.Lock] = None
_FON_LOCK: Optional[asyncio.Lock] = None
_BG: Set["asyncio.Task[Any]"] = set()
_MODS: Dict[str, Any] = {}
_MOD_ERR: Dict[str, str] = {}
_REACT_SINK: "contextvars.ContextVar[Optional[Dict[str, Any]]]" = contextvars.ContextVar("react_sink", default=None)
_ALBUMS: Dict[str, List[Any]] = {}        # media_group_id -> yig'ilayotgan qismlar
_ALBUM_DONE: Dict[str, float] = {}        # yig'ib bo'lingan media_group_id -> monotonic vaqt


def _mod(name: str) -> Any:
    """Ixtiyoriy modulni yuklaydi. Yiqilsa None (bir marta logga), bot ishlashda davom etadi."""
    if name in _MODS:
        return _MODS[name]
    if name in _MOD_ERR:
        return None
    try:
        module = importlib.import_module("." + name, __package__ or "agents")
    except Exception as exc:
        log.exception("modul yuklanmadi: %s", name)
        _MOD_ERR[name] = "%s: %s" % (exc.__class__.__name__, _safe_err(exc))
        return None
    _MODS[name] = module
    return module


def _owner_id() -> int:
    return config.get_settings().owner_id


def _owner_lock() -> asyncio.Lock:
    global _OWNER_LOCK
    if _OWNER_LOCK is None:
        _OWNER_LOCK = asyncio.Lock()
    return _OWNER_LOCK


def _fon_lock() -> asyncio.Lock:
    global _FON_LOCK
    if _FON_LOCK is None:
        _FON_LOCK = asyncio.Lock()
    return _FON_LOCK


def _outbox() -> notify.Outbox:
    return _OUTBOX if _OUTBOX is not None else notify.get_outbox()


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=False)


def _mask_secrets(text: str) -> str:
    """Sirga o'xshash qiymatlar tarix va LLM topshirig'iga tushmasin."""
    out = text or ""
    for pattern in C.SIR_NAQSHLARI:
        out = pattern.sub("***", out)
    return out


_URL_TOKEN_RE = re.compile(r"bot\d+:[A-Za-z0-9_-]+")


def _safe_err(exc: BaseException) -> str:
    """Log uchun xato matni: URL ichidagi bot tokeni va boshqa sirlar maskalanadi, 200 belgi."""
    return _mask_secrets(_URL_TOKEN_RE.sub("bot***", str(exc)))[:200]


def _row_get(row: Any, key: str, idx: int = 0) -> Any:
    if row is None:
        return None
    return row.get(key) if isinstance(row, dict) else row[idx]


# ---------------------------------------------------------------------------
# AiogramOutbox (notify.Outbox protokoli; chat_id = egasi)
# ---------------------------------------------------------------------------
def _markup(keyboard: Optional[notify.Keyboard]) -> Optional[InlineKeyboardMarkup]:
    if not keyboard:
        return None
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t, callback_data=d) for t, d in row] for row in keyboard
    ])


class AiogramOutbox(notify.Outbox):
    """Bot orqali egasining shaxsiy chatiga. Xatolar yutiladi va logga (None qaytadi)."""

    def __init__(self, bot: Bot, chat_id: int) -> None:
        self._bot = bot
        self._chat_id = chat_id

    @staticmethod
    async def _call(factory: Callable[[], Awaitable[Any]]) -> Any:
        try:
            return await factory()
        except TelegramRetryAfter as exc:
            await asyncio.sleep(min(float(exc.retry_after), 30.0))
            return await factory()

    async def _send_chunk(self, chunk: str, html_mode: bool, markup: Optional[InlineKeyboardMarkup],
                          reply_to: Optional[int]) -> Optional[int]:
        def go(text: str, mode: Optional[str]) -> Callable[[], Awaitable[Any]]:
            return lambda: self._bot.send_message(
                self._chat_id, text, parse_mode=mode, reply_markup=markup,
                reply_to_message_id=reply_to, allow_sending_without_reply=True if reply_to else None,
                disable_web_page_preview=True,
            )
        try:
            sent = await self._call(go(chunk, "HTML" if html_mode else None))
        except TelegramBadRequest as exc:
            if not (html_mode and notify.is_parse_error(str(exc))):
                log.warning("send_message xato: %s", _safe_err(exc))
                return None
            try:
                sent = await self._call(go(notify.plain_fallback(chunk), None))
            except Exception as exc2:
                log.warning("send_message (oddiy matn) xato: %s", _safe_err(exc2))
                return None
        except Exception as exc:
            log.warning("send_message yiqildi: %s", exc.__class__.__name__)
            return None
        return sent.message_id

    async def send_text(self, text: str, *, html: bool = True, keyboard: Optional[notify.Keyboard] = None,
                        reply_to: Optional[int] = None) -> Optional[int]:
        chunks = notify.chunks_for_send(text, html)
        if not chunks:
            log.warning("bo'sh xabar yuborilmadi")
            return None
        last: Optional[int] = None
        for i, chunk in enumerate(chunks):
            is_last = i == len(chunks) - 1
            last = await self._send_chunk(chunk, html, _markup(keyboard) if is_last else None,
                                          reply_to if i == 0 else None)
        return last

    async def send_document(self, filename: str, data: bytes, *,
                            caption: Optional[str] = None) -> Optional[int]:
        cap = (caption or "")[:notify.CAPTION_LIMIT] or None
        doc = BufferedInputFile(bytes(data), filename=notify.safe_filename(filename))
        try:
            sent = await self._call(lambda: self._bot.send_document(
                self._chat_id, doc, caption=cap, parse_mode="HTML" if cap else None))
        except TelegramBadRequest as exc:
            if not (cap and notify.is_parse_error(str(exc))):
                log.warning("send_document xato: %s", _safe_err(exc))
                return None
            try:
                plain = notify.plain_fallback(cap)[:notify.CAPTION_LIMIT]
                sent = await self._call(lambda: self._bot.send_document(
                    self._chat_id, doc, caption=plain, parse_mode=None))
            except Exception as exc2:
                log.warning("send_document (oddiy) xato: %s", _safe_err(exc2))
                return None
        except Exception as exc:
            log.warning("send_document yiqildi: %s", exc.__class__.__name__)
            return None
        return sent.message_id

    async def edit_keyboard(self, message_id: int, keyboard: Optional[notify.Keyboard] = None) -> None:
        try:
            await self._call(lambda: self._bot.edit_message_reply_markup(
                chat_id=self._chat_id, message_id=message_id, reply_markup=_markup(keyboard)))
        except Exception as exc:
            if "message is not modified" not in str(exc).lower():
                log.info("edit_keyboard: %s", _safe_err(exc))

    async def set_reaction(self, message_id: int, emoji: Optional[str]) -> None:
        reaction = [ReactionTypeEmoji(emoji=emoji)] if emoji else []
        try:
            await self._call(lambda: self._bot.set_message_reaction(
                chat_id=self._chat_id, message_id=message_id, reaction=reaction))
        except Exception as exc:  # reaksiya xatosi egasiga chiqmaydi
            log.debug("set_reaction: %s", _safe_err(exc))

    async def delete(self, message_id: int) -> None:
        try:
            await self._call(lambda: self._bot.delete_message(self._chat_id, message_id))
        except Exception as exc:
            log.debug("delete: %s", _safe_err(exc))


# ---------------------------------------------------------------------------
# Kichik yordamchilar: tarix, yuborish, sabab
# ---------------------------------------------------------------------------
async def _hist(role: str, text: str, is_forward: bool = False) -> None:
    await asyncio.to_thread(history.add_history, role, text, is_forward=is_forward)


async def _sys(inner: str) -> None:
    await asyncio.to_thread(history.add_system, inner)


async def _say(text: str, *, escape: bool = False, latin: bool = True, keyboard: Optional[notify.Keyboard] = None,
               record: bool = True, hist: Optional[str] = None,
               outbox: Optional[notify.Outbox] = None, reply_to: Optional[int] = None) -> Optional[int]:
    """Egasiga LLM'siz yoki tayyor matn. Kirill lotinga, kerak bo'lsa HTML escape, tarixga yoziladi.
    reply_to: egasi xabariga javob (faqat suhbat oqimida; fon xabarlari reply emas)."""
    t = L.normalize_latin(text) if latin else text
    shown = html.escape(t, quote=False) if escape else t
    mid = await (outbox or _outbox()).send_text(shown, html=True, keyboard=keyboard, reply_to=reply_to)
    if record:
        await _hist(C.ROLE_LEADER, hist if hist is not None else t)
    return mid


def _sabab_for(res: Any) -> str:
    """MSG_*_XATO_TPL uchun sabab: SISTEMA'dagi sabab yoki runner xatosi."""
    status = getattr(res, "status", "")
    if status in C.RUN_STATUS_TO_CHQ:
        return C.RUN_STATUS_TO_CHQ[status]
    if status == C.RUN_EMPTY:
        return _SABAB_BOSH
    return getattr(res, "error", "") or status or _SABAB_ICHKI


def _is_forwarded(msg: Any) -> bool:
    """0-qadam (Q11): forward belgilaridan biri bo'lsa True."""
    for attr in ("forward_origin", "forward_from", "forward_from_chat", "forward_sender_name", "forward_date"):
        if getattr(msg, attr, None):
            return True
    return bool(getattr(msg, "is_automatic_forward", False))


def _is_owner_private(msg: Any) -> bool:
    chat = getattr(msg, "chat", None)
    user = getattr(msg, "from_user", None)
    return (chat is not None and chat.type == "private" and user is not None
            and user.id == _owner_id())


def _spawn(coro: Awaitable[Any], name: str) -> "asyncio.Task[Any]":
    task = asyncio.ensure_future(coro)
    try:
        task.set_name(name)
    except AttributeError:  # pragma: no cover
        pass
    _BG.add(task)
    task.add_done_callback(_bg_done)
    return task


def _bg_done(task: "asyncio.Task[Any]") -> None:
    _BG.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.error("fon vazifa yiqildi (%s): %s", task.get_name(), exc, exc_info=exc)


async def _supervise(name: str, factory: Callable[[], Awaitable[Any]]) -> None:
    """Fon vazifa o'z xatosini yutib qayta aylanadi."""
    while True:
        try:
            await factory()
            log.warning("%s tugadi, %d s dan keyin qayta", name, _SUPERVISE_RETRY_S)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("%s yiqildi, %d s dan keyin qayta", name, _SUPERVISE_RETRY_S)
        await asyncio.sleep(_SUPERVISE_RETRY_S)


# ---------------------------------------------------------------------------
# DB yordamchilari (sinxron, asyncio.to_thread ichida chaqiriladi)
# ---------------------------------------------------------------------------
def _task_start(agent: str, intent: str, is_fwd: bool, task: str) -> Optional[int]:
    now = config.now_utc()
    try:
        with db.tx("agents") as cur:
            cur.execute(
                "INSERT INTO agents.agent_tasks (created_at, updated_at, agent, intent, source, is_forward, task, status) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (now, now, agent, (intent or "")[:_INTENT_MAX] or None, "dm", bool(is_fwd),
                 _mask_secrets(task or "")[:_TASK_MAX], "in_progress"),
            )
            row = cur.fetchone()
        value = _row_get(row, "id")
        return int(value) if value is not None else None
    except Exception as exc:
        log.warning("agent_tasks yozilmadi: %s: %s", exc.__class__.__name__, _safe_err(exc))
        return None


def _task_finish(task_id: Optional[int], status: str, preview: str, run_id: Optional[int]) -> None:
    if task_id is None:
        return
    try:
        db.execute(
            "UPDATE agents.agent_tasks SET status = %s, updated_at = %s, result_preview = %s, run_id = %s "
            "WHERE id = %s",
            (status, config.now_utc(), (preview or "")[:_PREVIEW_MAX], run_id, task_id),
        )
    except Exception as exc:
        log.warning("agent_tasks yangilanmadi: %s: %s", exc.__class__.__name__, _safe_err(exc))


def _save_promise(reply: str) -> None:
    """KOD 1.6: human_reply'da va'da so'zi bo'lsa agents.agent_promises ga."""
    plain = notify.plain_fallback(reply or "")
    found = L.detect_promise(plain)
    if not found:
        return
    trigger, seconds = found
    now = config.now_utc()
    try:
        db.execute(
            "INSERT INTO agents.agent_promises (created_at, due_at, text, trigger, status, reminder_count) "
            "VALUES (%s, %s, %s, %s, 'open', 0)",
            (now, now + timedelta(seconds=seconds), C.short(plain, _PREVIEW_MAX), trigger[:32]),
        )
    except Exception as exc:
        log.warning("va'da yozilmadi: %s: %s", exc.__class__.__name__, _safe_err(exc))


def _claim_due_promises() -> List[str]:
    """Muddati o'tgan ochiq va'dalar: eslatma soni +1, 3 ga yetgach yopiladi (jim). Matnlar qaytadi."""
    now = config.now_utc()
    cutoff = now - timedelta(seconds=C.VADA_ESLATMA_ORALIQ_S)
    out: List[str] = []
    with db.tx("agents") as cur:
        cur.execute(
            "SELECT id FROM agents.agent_promises WHERE status = 'open' AND due_at <= %s "
            "AND (last_reminded_at IS NULL OR last_reminded_at <= %s) ORDER BY due_at LIMIT 10",
            (now, cutoff),
        )
        ids = [_row_get(r, "id") for r in cur.fetchall()]
        for pid in ids:
            cur.execute(
                "UPDATE agents.agent_promises SET reminder_count = reminder_count + 1, last_reminded_at = %s, "
                "status = CASE WHEN reminder_count + 1 >= %s THEN 'closed' ELSE status END "
                "WHERE id = %s AND status = 'open' AND (last_reminded_at IS NULL OR last_reminded_at <= %s) "
                "RETURNING text",
                (now, C.VADA_MAX_ESLATMA, pid, cutoff),
            )
            row = cur.fetchone()
            if row is not None:
                out.append(str(_row_get(row, "text") or ""))
    return out


def _fresh_recent(cur: Any) -> Tuple[List[str], List[str], bool]:
    """KV_RECENT_PHOTO qiymatidan: 5 daqiqadan yangi bo'lsa (yo'llar, file_unique_id lar, forward).
    uids yo'llar bilan bir tartibda; eski yozuvda uids yo'q, '' bilan to'ldiriladi."""
    if not isinstance(cur, dict):
        return [], [], False
    ts = config.parse_iso(str(cur.get("ts") or ""))
    if ts is None or (config.now_utc() - ts).total_seconds() > C.PHOTO_WAIT_S:
        return [], [], False
    paths = [str(p) for p in (cur.get("paths") or [])]
    raw = cur.get("uids")
    uids = [str(u or "") for u in raw] if isinstance(raw, list) else []
    uids = (uids + [""] * len(paths))[:len(paths)]
    return paths, uids, bool(cur.get("fwd"))


def _recent_photo_add(path: str, is_fwd: bool, uid: str = "") -> None:
    """Izohsiz rasm 5 daqiqa kutadi (KV_RECENT_PHOTO, ko'pi bilan PHOTO_MAX).
    uid: Telegram file_unique_id (shu rasmga reply qilinsa qayta yuklanmaydi). Shu uid allaqachon
    kutayotgan bo'lsa eski o'rni o'chadi va rasm oxiriga o'tadi (kesishda eng eskisi tushadi)."""
    paths, uids, fwd = _fresh_recent(db.kv_get_json(C.KV_RECENT_PHOTO) or {})
    if uid and uid in uids:
        i = uids.index(uid)
        del paths[i]
        del uids[i]
    paths = (paths + [path])[-C.PHOTO_MAX:]
    uids = (uids + [uid or ""])[-C.PHOTO_MAX:]
    db.kv_set_json(C.KV_RECENT_PHOTO, {"paths": paths, "uids": uids, "fwd": fwd or bool(is_fwd),
                                       "ts": config.iso_utc()})


def _recent_photo_add_many(paths: Sequence[str], is_fwd: bool, uids: Sequence[str] = ()) -> None:
    for i, path in enumerate(paths):
        _recent_photo_add(path, is_fwd, uids[i] if i < len(uids) else "")


def _recent_photo_pending() -> Tuple[List[str], List[str]]:
    """Kutayotgan izohsiz rasmlar: (yo'llar, file_unique_id lar), faqat uid li va fayli borlari.
    Kalit o'chirilmaydi. Xatoda ([], [])."""
    try:
        paths, uids, _ = _fresh_recent(db.kv_get_json(C.KV_RECENT_PHOTO))
    except Exception as exc:
        log.warning("recent_photo o'qilmadi: %s", exc.__class__.__name__)
        return [], []
    keep = [i for i, p in enumerate(paths) if uids[i] and _valid_upload(p)]
    return [paths[i] for i in keep], [uids[i] for i in keep]


def _valid_upload(path: str) -> bool:
    try:
        p = Path(path).resolve()
        return (p.parent == config.UPLOADS_DIR.resolve() and p.name.startswith(C.UPLOAD_PREFIX)
                and p.is_file())
    except OSError:
        return False


def _recent_photo_take() -> Tuple[List[str], bool, List[str]]:
    """5 daqiqadan yangi izohsiz rasmlar, forward flagi va file_unique_id lari; kalit o'chiriladi."""
    try:
        cur = db.kv_get_json(C.KV_RECENT_PHOTO)
        if not cur:
            return [], False, []
        db.kv_del(C.KV_RECENT_PHOTO)
    except Exception as exc:
        log.warning("recent_photo o'qilmadi: %s", exc.__class__.__name__)
        return [], False, []
    paths, uids, fwd = _fresh_recent(cur)
    keep = [i for i, p in enumerate(paths) if _valid_upload(p)]
    return [paths[i] for i in keep], fwd, [uids[i] for i in keep]


# ---------------------------------------------------------------------------
# Rasm (R7)
# ---------------------------------------------------------------------------
def _image_ext(file_name: Optional[str], mime: Optional[str]) -> str:
    suffix = Path(file_name or "").suffix.lower().lstrip(".")
    if suffix in _IMG_EXT:
        return "jpg" if suffix == "jpeg" else suffix
    return _MIME_EXT.get((mime or "").lower(), "")


def _image_of(msg: Any) -> Tuple[Any, str, int, Optional[str]]:
    """(fayl obyekti, kengaytma, hajm, xato matni). Rasm bo'lmasa (None, '', 0, None)."""
    if getattr(msg, "photo", None):
        photo = msg.photo[-1]
        return photo, "jpg", int(photo.file_size or 0), None
    doc = getattr(msg, "document", None)
    if doc is not None and (doc.mime_type or "").lower().startswith("image/"):
        ext = _image_ext(doc.file_name, doc.mime_type)
        if not ext:
            return None, "", 0, _MSG_RASM_FORMAT
        return doc, ext, int(doc.file_size or 0), None
    if doc is not None:
        suffix = Path(doc.file_name or "").suffix.lower().lstrip(".")
        ext = suffix if suffix in _DOC_EXT else _DOC_MIME.get((doc.mime_type or "").lower(), "")
        if ext:
            return doc, ext, int(doc.file_size or 0), None
    return None, "", 0, None


async def _download_image(fobj: Any, ext: str) -> Optional[str]:
    """static/tg_uploads/leader_bot_<token_hex(8)>.<ext>, 0644 (agent foydalanuvchisi o'qiy olsin)."""
    if _BOT is None:
        return None
    path = config.UPLOADS_DIR / ("%s%s.%s" % (C.UPLOAD_PREFIX, secrets.token_hex(8), ext))
    try:
        os.makedirs(config.UPLOADS_DIR, exist_ok=True)
        await _BOT.download(fobj, destination=str(path))
        os.chmod(path, 0o644)
    except Exception as exc:
        log.warning("rasm yuklanmadi: %s", exc.__class__.__name__)
        try:
            path.unlink()
        except OSError:
            pass
        return None
    return str(path)


def _image_uid(fobj: Any) -> str:
    """Telegram file_unique_id (bir rasm ikki marta yuklanmasin). Yo'q bo'lsa ''."""
    return str(getattr(fobj, "file_unique_id", "") or "")


async def _collect_images(msgs: Sequence[Any]) -> Tuple[List[str], List[str], List[str], int]:
    """Xabar(lar)dagi rasmlarni yuklaydi, ko'pi bilan PHOTO_MAX.
    (yo'llar, file_unique_id lar (yo'llar tartibida), xato matnlari, chegaradan ortgan rasmlar soni)."""
    paths: List[str] = []
    uids: List[str] = []
    errs: List[str] = []
    skipped = 0
    for m in msgs:
        fobj, ext, size, err = _image_of(m)
        if err:
            errs.append(err)
            continue
        if fobj is None:
            continue
        if len(paths) >= C.PHOTO_MAX:
            skipped += 1
            continue
        if size > _MAX_DOWNLOAD:
            errs.append(_MSG_RASM_KATTA)
            continue
        path = await _download_image(fobj, ext)
        if path is None:
            errs.append(_MSG_RASM_XATO)
            continue
        paths.append(path)
        uids.append(_image_uid(fobj))
    return paths, uids, errs, skipped


# ---------------------------------------------------------------------------
# Reply: egasi reply qilgan xabar (matni MUHIM KONTEKST, rasmi image_paths ga)
# ---------------------------------------------------------------------------
def _replied_of(msgs: Sequence[Any]) -> Any:
    """Egasi reply qilgan xabar (albomda reply belgisi bor birinchi qismdan) yoki None."""
    for m in msgs:
        replied = getattr(m, "reply_to_message", None)
        if replied is not None:
            return replied
    return None


def _reply_quote(replied: Any) -> Optional[str]:
    """Reply qilingan xabar matni yoki izohi, sirlar maskalangan. Tashqi matn: forward bo'lsa ham
    history.muhim_kontekst uni clean_external bilan tozalaydi. Matn bo'lmasa None."""
    if replied is None:
        return None
    return _mask_secrets(getattr(replied, "text", None) or getattr(replied, "caption", None) or "") or None


def _pending_index(replied: Any, uids: Sequence[str], own_uids: Collection[str] = ()) -> Optional[int]:
    """Reply qilingan rasm kutayotgan izohsiz rasmlar (uids) ichida bo'lsa uning indeksi, aks holda None.
    Egasining o'z rasmlari (own_uids) ichida bo'lsa ham None: u allaqachon bor."""
    if replied is None:
        return None
    fobj = _image_of(replied)[0]
    uid = _image_uid(fobj) if fobj is not None else ""
    if not uid or uid in own_uids or uid not in uids:
        return None
    return list(uids).index(uid)


async def _reply_images(replied: Any, *, room: int, skip_uids: Collection[str] = ()) -> Tuple[List[str], List[str]]:
    """Reply qilingan xabardagi rasm (photo yoki rasm document) o'sha R7 oqimi bilan yuklanadi.
    room: rasm chegarasida (PHOTO_MAX) qolgan joy. skip_uids: allaqachon olingan rasmlar.
    Yuklab bo'lmasa egasiga xabar yo'q, faqat log: oqim rasmsiz davom etadi. (yo'llar, uids)."""
    if replied is None:
        return [], []
    mid = getattr(replied, "message_id", "?")
    fobj, ext, size, err = _image_of(replied)
    if err:
        log.warning("reply rasmi olinmadi (message_id %s): format o'qilmadi", mid)
        return [], []
    if fobj is None:
        return [], []
    uid = _image_uid(fobj)
    if uid and uid in skip_uids:
        return [], []  # shu rasm allaqachon bor (masalan kutayotgan izohsiz rasm)
    if room <= 0:
        log.warning("reply rasmi olinmadi (message_id %s): %d ta rasm chegarasi to'lgan", mid, C.PHOTO_MAX)
        return [], []
    if size > _MAX_DOWNLOAD:
        log.warning("reply rasmi olinmadi (message_id %s): juda katta (%d bayt)", mid, size)
        return [], []
    path = await _download_image(fobj, ext)
    if path is None:
        log.warning("reply rasmi yuklanmadi (message_id %s)", mid)
        return [], []
    return [path], [uid]


# ---------------------------------------------------------------------------
# Albom (media_group): Telegram har rasmni alohida Message qiladi, izoh odatda bittasida
# ---------------------------------------------------------------------------
def _album_gc(now: float) -> None:
    for gid in [g for g, ts in _ALBUM_DONE.items() if now - ts > _ALBUM_DONE_TTL_S]:
        _ALBUM_DONE.pop(gid, None)


async def _album_collect(group_id: str, msg: Any) -> Optional[List[Any]]:
    """Albomning birinchi kelgan qismi jimlik tugaguncha kutadi va barcha qismlarni qaytaradi
    (message_id tartibida). Qolgan qismlar ro'yxatga qo'shiladi va None qaytadi (ular alohida
    ishlanmaydi: MSG_RASM_QABUL yo'q, KV_RECENT_PHOTO ga yozilmaydi)."""
    now = time.monotonic()
    _album_gc(now)
    if group_id in _ALBUM_DONE:  # albom allaqachon ishlangan: kechikkan qism
        log.warning("albom qismi kechikib keldi, e'tiborsiz (message_id %s)", getattr(msg, "message_id", "?"))
        return None
    parts = _ALBUMS.get(group_id)
    if parts is not None:
        parts.append(msg)
        return None
    parts = [msg]
    _ALBUMS[group_id] = parts
    try:
        while True:
            seen = len(parts)
            await asyncio.sleep(_ALBUM_QUIET_S)
            if len(parts) == seen or time.monotonic() - now >= _ALBUM_MAX_WAIT_S:
                break
    finally:
        _ALBUMS.pop(group_id, None)
        _ALBUM_DONE[group_id] = time.monotonic()
    return sorted(parts, key=lambda m: int(getattr(m, "message_id", 0) or 0))


def _msg_text(msg: Any) -> str:
    return getattr(msg, "text", None) or getattr(msg, "caption", None) or ""


def _primary(msgs: Sequence[Any]) -> Any:
    """Izohli qism (albomda odatda birinchisi), aks holda birinchi qism."""
    for m in msgs:
        if _msg_text(m).strip():
            return m
    return msgs[0]


def _owner_text(msgs: Sequence[Any]) -> str:
    """Bitta xabar: matn yoki izoh o'zi. Albom: bo'sh bo'lmagan izohlar qatorma-qator."""
    if len(msgs) == 1:
        return _msg_text(msgs[0])
    return "\n".join(t for t in (_msg_text(m) for m in msgs) if t.strip())


# ---------------------------------------------------------------------------
# Leader javobini tozalash (WRITE_MEMORY, Teacher uchun, REACT)
# ---------------------------------------------------------------------------
async def _clean_reply(text: str) -> Tuple[str, Optional[str]]:
    """Leader bloki qo'llanmaydi (KOD 4): olib tashlanadi + SISTEMA RAD. 'Teacher uchun:' qatori ko'rsatilmaydi."""
    mb = _mod("memory_blocks")
    if mb is not None:
        text, blocks = mb.extract_write_blocks(text or "")
    else:
        blocks = C.WRITE_MEMORY_RE.findall(text or "")
        text = C.WRITE_MEMORY_RE.sub("", text or "")
    if blocks:
        await _sys(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_EMAS_TPL.format(agent="leader")))
    text = C.TEACHER_UCHUN_STRIP_RE.sub("", text)
    text, emoji = L.extract_react(text)
    return text.strip(), emoji


async def _leader_format_error(raw: str, data: Dict[str, Any], outbox: Optional[notify.Outbox] = None,
                               reply_to: Optional[int] = None) -> bool:
    """JSON o'qilmagan va xom matn JSON'ga o'xshasa: xom JSON egasiga chiqmaydi."""
    if data.get("parse_error") and L.looks_like_json(raw):
        await _sys(C.sistema(C.SIS_AGENT_XATO, agent="leader", xato=_SABAB_FORMAT))
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_SABAB_FORMAT), escape=True, outbox=outbox,
                   reply_to=reply_to)
        return True
    return False


# ---------------------------------------------------------------------------
# on_text (KOD 1.2)
# ---------------------------------------------------------------------------
async def on_text(msg: Message) -> None:
    if not _is_owner_private(msg):
        log.debug("begona xabar e'tiborsiz (chat turi: %s)", getattr(getattr(msg, "chat", None), "type", "?"))
        return
    msgs: List[Any] = [msg]
    group_id = getattr(msg, "media_group_id", None)
    if group_id:  # albom: qismlar bitta turn bo'lib ishlanadi
        collected = await _album_collect(str(group_id), msg)
        if collected is None:
            return
        msgs = collected
    primary = _primary(msgs)
    is_fwd = any(_is_forwarded(m) for m in msgs)  # 0-qadam: hamma handlerdan oldin
    lock = _owner_lock()
    queued = lock.locked()
    if queued:  # navbatda: egasi xabari ko'rilganini bilsin
        await _outbox().set_reaction(primary.message_id, C.ACK_REAKSIYA)
    async with lock:
        state: Dict[str, Any] = {"reacted": queued, "react": None}
        token = _REACT_SINK.set(state)
        try:
            await _handle_owner_message(msgs, is_fwd, state)
        except Exception:
            log.exception("on_text yiqildi")
            await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_SABAB_ICHKI), escape=True, reply_to=primary.message_id)
        finally:
            _REACT_SINK.reset(token)
            if state["reacted"] or state["react"]:
                await _outbox().set_reaction(primary.message_id, state["react"])


async def _matn_tasdiq(text: str, replied: Any, msg: Any) -> bool:
    """Qisqa "tasdiqlayman" / "yo'q" matni kutilayotgan TR Support tasdig'iga (tahrir yoki ariza) tugma kabi.
    Reply qilingan tasdiq xabari aniqlaydi; reply bo'lmasa faqat bitta kutilayotgan tasdiq bo'lsa. True = hal qilindi."""
    fn = getattr(_mod("tuzatish"), "matn_qaror", None)
    qaror = fn(text) if callable(fn) else None
    if qaror is None:
        return False
    kutilgan: List[Tuple[Any, str, Dict[str, Any]]] = []
    for name in ("tuzatish", "ariza"):
        mod = _mod(name)
        if mod is None or not callable(getattr(mod, "kutilayotgan", None)):
            continue
        try:
            kutilgan += [(mod, tok, p) for tok, p in await asyncio.to_thread(mod.kutilayotgan)]
        except Exception:
            log.exception("%s: kutilayotgan tasdiqlar o'qilmadi", name)
    if not kutilgan:
        return False
    reply_mid = getattr(replied, "message_id", None) if replied is not None else None
    tanlov = [x for x in kutilgan if reply_mid and x[2].get("mid") == reply_mid]
    if not tanlov and len(kutilgan) == 1:
        tanlov = kutilgan
    await _hist(C.ROLE_OWNER, text)
    if len(tanlov) != 1:
        await _say(C.MSG_TASDIQ_QAYSI, escape=True, reply_to=getattr(msg, "message_id", None))
        return True
    mod, tok, p = tanlov[0]
    toast = await mod.decide(tok, qaror, _outbox(), p.get("mid"))
    if qaror and toast in (C.MSG_TUZATISH_QABUL, C.MSG_ARIZA_QABUL):
        await _say(toast, escape=True, reply_to=getattr(msg, "message_id", None))
    elif qaror and toast not in (C.MSG_TUZATISH_BEKOR, C.MSG_ARIZA_BEKOR, C.MSG_MUDDAT_OTGAN):
        await _say(toast, escape=True, reply_to=getattr(msg, "message_id", None))
    return True


async def _handle_owner_message(msgs: Sequence[Message], is_fwd: bool, state: Dict[str, Any]) -> None:
    """msgs: bitta xabar yoki albom qismlari (message_id tartibida)."""
    outbox = _outbox()
    msg = _primary(msgs)
    raw_text = _owner_text(msgs)

    # 1. Xotira triggeri: faqat forward bo'lmagan shaxsiy xabar, LLM chaqirilmaydi
    if not is_fwd:
        content = L.detect_memory_command(raw_text)
        if content is not None:
            await _memory_command(raw_text, content)
            return

    text = _mask_secrets(raw_text)

    # 2. Ovoz, rasm, boshqa turlar
    if any(getattr(m, "voice", None) or getattr(m, "video_note", None) or getattr(m, "audio", None)
           for m in msgs):
        await _hist(C.ROLE_OWNER, text or _HIST_OVOZ, is_forward=is_fwd)
        await _say(C.MSG_OVOZ_YOQ)
        return
    image_paths, image_uids, img_errs, skipped = await _collect_images(msgs)
    if img_errs and not image_paths:
        await _hist(C.ROLE_OWNER, text or _HIST_RASM, is_forward=is_fwd)
        await _say(img_errs[0])
        return
    replied = _replied_of(msgs)
    # 2b. TR Support tasdig'i matn bilan ("tasdiqlayman", "ha", "yo'q"): kutilayotgan tasdiq bo'lsa tugma kabi
    if not is_fwd and not image_paths and text.strip() and await _matn_tasdiq(text, replied, msg):
        return
    if image_paths:
        # albomning bir qismi o'qilmadi yoki chegaradan ortdi: egasi bilsin, qolgani bilan davom
        if img_errs:
            await _say(img_errs[0], record=False)
        if skipped:
            await _say(_MSG_RASM_KOP_TPL.format(n=C.PHOTO_MAX), record=False)
        if not text.strip():
            # izohsiz rasm savolni kutadi; reply qilingan rasm ham u bilan birga (egasining rasmi ustun)
            add_fwd = is_fwd
            if replied is not None:
                pend_paths, pend_uids = await asyncio.to_thread(_recent_photo_pending)
                idx = _pending_index(replied, pend_uids, image_uids)
                if idx is not None:
                    # kutayotgan rasmga reply: qayta yuklanmaydi, egasining rasmidan oldinga ko'chadi
                    # (_recent_photo_add eski o'rnini o'chiradi, kesishda aynan u tushib qolmaydi)
                    r_paths, r_uids = [pend_paths[idx]], [pend_uids[idx]]
                else:
                    r_paths, r_uids = await _reply_images(replied, room=C.PHOTO_MAX - len(image_paths),
                                                          skip_uids=set(pend_uids) | set(image_uids))
                image_paths, image_uids = r_paths + image_paths, r_uids + image_uids
                # forward xabardagi rasm kutayotganlarga qo'shildi: ular ham forward (Q11)
                add_fwd = is_fwd or (bool(r_paths) and _is_forwarded(replied))
            await asyncio.to_thread(_recent_photo_add_many, image_paths, add_fwd, image_uids)
            await _hist(C.ROLE_OWNER, _HIST_RASM, is_forward=is_fwd)
            await _say(C.MSG_RASM_QABUL)
            return
    elif not text.strip():
        kind = getattr(msg, "content_type", "")
        kind = str(getattr(kind, "value", kind) or "")
        if kind in _JAVOB_TURLARI:
            await _hist(C.ROLE_OWNER, "(%s)" % kind, is_forward=is_fwd)
            await _say(_MSG_TUR_YOQ)
        return  # xizmat xabarlari jim

    recent, recent_fwd, recent_uids = await asyncio.to_thread(_recent_photo_take)
    if recent:
        is_fwd = is_fwd or recent_fwd
    # Reply qilingan rasm egasining o'z rasmlaridan keyin qolgan joyga.
    # Tartib: kutayotgan -> reply -> o'z rasmi; chegara oshsa eng eskisi tushadi.
    idx = _pending_index(replied, recent_uids, image_uids)
    if idx is not None:
        # kutayotgan rasmga reply: qayta yuklanmaydi, lekin reply o'rniga o'tadi (kesishda tushib qolmasin)
        r_paths = [recent.pop(idx)]
        recent_uids.pop(idx)
    else:
        r_paths, _ = await _reply_images(replied, room=C.PHOTO_MAX - len(image_paths),
                                         skip_uids=set(recent_uids) | set(image_uids))
    image_paths = (recent + r_paths + image_paths)[-C.PHOTO_MAX:]

    # 3. Ack: reaksiya + "Ko'rib chiqyapman" (egasi xabariga reply), finally'da olinadi
    ack_id: Optional[int] = None
    try:
        await outbox.set_reaction(msg.message_id, C.ACK_REAKSIYA)
        state["reacted"] = True
        ack_id = await outbox.send_text(C.ACK_MATN, html=False, reply_to=msg.message_id)
        await _leader_turn(msg, text, is_fwd, image_paths, state, replied=replied)
    finally:
        if ack_id:
            await outbox.delete(ack_id)


async def _memory_command(raw_text: str, content: str) -> None:
    """KOD 1.2 6-qadam: leader-runtime.md ga kod yozadi (Teacher chetlab o'tiladi)."""
    await _hist(C.ROLE_OWNER, _mask_secrets(raw_text))
    if C.has_secret(content):
        await _say(_MSG_SIR, escape=True)
        return
    mb = _mod("memory_blocks")
    if mb is None:
        await _say(_MSG_MODUL_YOQ_TPL.format(modul="memory_blocks"), escape=True)
        return
    res = await asyncio.to_thread(mb.write_runtime_memory, content)
    if getattr(res, "ok", False):
        fayl = getattr(res, "path", "") or C.RUNTIME_PATH
        await _sys(C.sistema(C.SIS_KOD_YOZDI, fayl=fayl, natija=res.natija))
        await _say(C.YOZIB_QOYDIM_TPL.format(natija="%s: %s" % (fayl, res.natija)), escape=True)
    else:
        await _say(_MSG_YOZMADIM_TPL.format(sabab=getattr(res, "sabab", "") or _SABAB_ICHKI), escape=True)


async def _leader_turn(msg: Message, text: str, is_fwd: bool, image_paths: List[str],
                       state: Dict[str, Any], *, replied: Any = None) -> None:
    """Javoblar (yakuniy, synth, xato) egasi xabariga reply: reply_to = msg.message_id.
    is_fwd: egasi xabarining o'zi forward (topshiriq, delegatsiya, synth va tarix shu bilan).
    Reply qilingan xabar forward bo'lsa: uning matni MUHIM KONTEKST (tashqi matn, tozalangan),
    egasining o'z buyrug'i oddiy buyruq bo'lib qoladi; faqat Teacher bloki [Ha] bilan (teacher_fwd)."""
    reply_to = msg.message_id
    # 4. Topshiriq (tarixga qo'shishdan OLDIN, aks holda OXIRGI SUHBAT'da takrorlanadi)
    if replied is None:
        replied = getattr(msg, "reply_to_message", None)
    reply_quote = _reply_quote(replied)
    # forward xabarga reply: iqtibos tashqi matn (MUHIM KONTEKST), Teacher bloki faqat [Ha] bilan
    quote_fwd = replied is not None and _is_forwarded(replied)
    task = await asyncio.to_thread(history.build_leader_task, text, is_fwd=is_fwd,
                                   image_paths=image_paths, reply_quote=reply_quote)
    hist_text = text
    if image_paths:
        hist_text = ("%s %s" % (text, _HIST_RASM_BILAN)).strip()
    await _hist(C.ROLE_OWNER, hist_text, is_forward=is_fwd)

    # 5. Leader
    res = await runner.run_agent_async("leader", task, {"complexity": "strong", "source": "dm"})
    if not res.ok:
        await _sys(runner.sistema_for(res))
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_sabab_for(res)), escape=True, reply_to=reply_to)
        return

    # 6. JSON, WRITE_MEMORY (Leader bloki qo'llanmaydi), REACT
    data = L.parse_leader_response(res.text)
    if await _leader_format_error(res.text, data, reply_to=reply_to):
        return
    human_reply, emoji = await _clean_reply(data["human_reply"])

    # 6b. To'lovni tuzatish (TR Support): TUZATISH qatori bo'lsa bot o'zi so'raydi / tekshiradi / [Ha] so'raydi.
    #     Leader'ning delegatsiyasi va human_reply o'rniga (tahrirni faqat bot, egasi tasdig'i bilan qiladi).
    tz_matn = "\n".join(str(x) for x in (data.get("task_for_agent"), data.get("human_reply")) if x)
    if C.ARIZA_RE.search(tz_matn):
        ar = _mod("ariza")
        if ar is None:
            await _say(_MSG_MODUL_YOQ_TPL.format(modul="ariza"), escape=True, reply_to=reply_to)
            return
        state["react"] = emoji
        await ar.handle(tz_matn, _outbox(), reply_to=reply_to, rasmlar=image_paths)
        return
    if C.TUZATISH_RE.search(tz_matn):
        tz = _mod("tuzatish")
        if tz is None:
            await _say(_MSG_MODUL_YOQ_TPL.format(modul="tuzatish"), escape=True, reply_to=reply_to)
            return
        state["react"] = emoji
        await tz.handle(tz_matn, _outbox(), reply_to=reply_to)
        return

    # 7. Delegat oq ro'yxati
    agent = L.normalize_delegate(data.get("delegate_to"))
    if agent and agent not in C.DELEGATE_AGENTS:
        name = agent[:_AGENT_NAME_MAX]
        await _sys(C.sistema(C.SIS_AGENT_CHAQIRILMADI, agent=name, sabab=C.CHQ_NOMALUM))
        await _say(C.MSG_SUB_XATO_TPL.format(agent=name, sabab=C.CHQ_NOMALUM), escape=True, reply_to=reply_to)
        return

    # 8-9. Delegatsiya: human_reply egasiga ko'rsatilmaydi, tarixga "Qabul qildim." (soxta va'da yo'q)
    if agent:
        await _hist(C.ROLE_LEADER, C.DELEG_HUMAN_REPLY)
        state["react"] = emoji
        body = data.get("task_for_agent") or text
        await delegate(agent, body, intent=str(data.get("intent") or ""), is_fwd=is_fwd,
                       teacher_fwd=quote_fwd, image_paths=image_paths, outbox=_outbox(),
                       reply_to=reply_to, reply_quote=reply_quote)
        return

    if not human_reply:
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_SABAB_BOSH), escape=True, reply_to=reply_to)
        return
    reply = L.normalize_latin(human_reply)
    await _hist(C.ROLE_LEADER, reply)
    await asyncio.to_thread(_save_promise, reply)
    await _outbox().send_text(reply, html=True, reply_to=reply_to)
    state["react"] = emoji


# ---------------------------------------------------------------------------
# Delegatsiya (KOD 1.3)
# ---------------------------------------------------------------------------
async def delegate(agent: str, task_for_agent: str, *, intent: str, is_fwd: bool,
                   image_paths: List[str], outbox: notify.Outbox, reply_to: Optional[int] = None,
                   reply_quote: Optional[str] = None, teacher_fwd: bool = False) -> None:
    """reply_to: synth javobi (yoki xatosi) shu egasi xabariga reply bo'ladi.
    reply_quote: egasi reply qilgan xabar matni, sub-agentga MUHIM KONTEKST bo'lib boradi."""
    task_id = await asyncio.to_thread(_task_start, agent, intent, is_fwd, task_for_agent)
    status, preview, run_id = "failed", "", None
    try:
        status, preview, run_id = await _delegate_body(
            agent, task_for_agent, is_fwd=is_fwd, image_paths=image_paths, outbox=outbox,
            reply_to=reply_to, reply_quote=reply_quote, teacher_fwd=teacher_fwd, intent=intent)
    except Exception as exc:
        log.exception("delegatsiya yiqildi: %s", agent)
        preview = exc.__class__.__name__
        await _sys(C.sistema(C.SIS_AGENT_XATO, agent=agent, xato=_SABAB_ICHKI))
        await _say(C.MSG_SUB_XATO_TPL.format(agent=agent, sabab=_SABAB_ICHKI), escape=True, outbox=outbox,
                   reply_to=reply_to)
    finally:
        await asyncio.to_thread(_task_finish, task_id, status, preview, run_id)


def _checker_block_stub(izoh: str) -> str:
    return "\n".join([C.CHECKER_BLOK_BOSH, izoh, C.CHECKER_BLOK_OXIR])


def _tolov_block_stub(izoh: str) -> str:
    return "\n".join([C.TOLOV_BLOK_BOSH, izoh, C.TOLOV_BLOK_OXIR])


def _is_tolov(agent: str, intent: str, task_for_agent: str) -> bool:
    """Checker'ga to'lov tekshiruvi: intent payment_check yoki (LLM intent'ni adashtirsa) TOLOV: qatori."""
    if agent != "checker":
        return False
    return intent == C.INTENT_TOLOV or bool(C.TOLOV_TOPSHIRIQ_RE.search(task_for_agent or ""))


async def _tolov_prefetch(pc: Any, matn: str) -> Any:
    """Thread bekor qilinmaydi: ichki deadline'lar (DB/CRM, ko'prik TOLOV_KOPRIK_DEADLINE_S) asosiy
    himoya, tashqarida TOLOV_TASHQI_TIMEOUT_S."""
    return await asyncio.wait_for(asyncio.to_thread(pc.prefetch, matn), C.TOLOV_TASHQI_TIMEOUT_S)


async def _tolov_block(task_for_agent: str) -> str:
    """TOLOV TEKSHIRUV NATIJALARI bloki (neytrallanmagan topshiriqdan parse). Yiqilsa stub."""
    pc = _mod("payment_check")
    if pc is None:
        return _tolov_block_stub(C.TOLOV_STUB_MODUL_YOQ)
    try:
        return pc.format_block(await _tolov_prefetch(pc, task_for_agent or ""))
    except Exception as exc:
        log.exception("tolov prefetch yiqildi")
        return _tolov_block_stub(C.TOLOV_STUB_YIQILDI_TPL.format(xato=exc.__class__.__name__))


async def _delegate_body(agent: str, task_for_agent: str, *, is_fwd: bool, image_paths: Sequence[str],
                         outbox: notify.Outbox, reply_to: Optional[int] = None,
                         reply_quote: Optional[str] = None,
                         teacher_fwd: bool = False, intent: str = "") -> Tuple[str, str, Optional[int]]:
    """(agent_tasks status, result_preview, run_id). Egasiga javob (synth, xato, blokisiz REJA,
    yolg'on almashtirish, yozib qo'ydim) reply_to ga reply; REJA/xotira tasdiq so'rovlari reply emas.
    To'lov tekshiruvida health bloki qo'shilmaydi (ikki "=== TUGADI ===" chalkashmasin)."""
    body = history.neutralize(task_for_agent or "")
    if _is_tolov(agent, intent, task_for_agent):
        body += "\n\n" + (await _tolov_block(task_for_agent or ""))
    elif agent == "checker":
        cw = _mod("checker_worker")
        if cw is None:
            body += "\n\n" + _checker_block_stub("(checker_worker yuklanmadi)")
        else:
            try:
                results = await asyncio.to_thread(cw.run_all_checks_once)
                body += "\n\n" + cw.format_block(results)
            except Exception as exc:
                log.exception("run_all_checks_once yiqildi")
                body += "\n\n" + _checker_block_stub("(tekshiruv yiqildi: %s)" % exc.__class__.__name__)

    # reply qilingan rasm image_paths ichida (egasining rasmlari bilan birga), matni MUHIM KONTEKST
    task = await asyncio.to_thread(history.build_sub_task, body, is_fwd=is_fwd, image_paths=list(image_paths),
                                   reply_quote=reply_quote)
    res = await runner.run_agent_async(agent, task, {"source": "deleg"})
    if not res.ok:
        await _sys(runner.sistema_for(res))
        await _say(C.MSG_SUB_XATO_TPL.format(agent=agent, sabab=_sabab_for(res)), escape=True, outbox=outbox,
                   reply_to=reply_to)
        return "failed", res.error or res.status, res.run_id

    raw = res.text or ""
    rest = raw
    # 5. Support: avval xom matndan REQUEST_APPROVAL (REJA preview synth'dan OLDIN)
    rj_blockless: Any = None  # blok yo'q: R4 filtri tozalangan matnga (6-7 dan keyin)
    if agent == "support":
        rj = _mod("reja")
        if rj is None:
            rest = C.REQUEST_APPROVAL_RE.sub("", raw)
            if rest != raw:
                await _sys(C.sistema(C.SIS_SUPPORT_REJA_RAD, sabab=C.RAD_PREVIEW))
                await _say(_MSG_MODUL_YOQ_TPL.format(modul="reja"), escape=True, outbox=outbox)
        else:
            inner, rest = rj.extract_request_approval(raw)
            if inner is not None:
                await rj.offer_plan(inner, outbox)
            else:
                rj_blockless = rj

    # 6. WRITE_MEMORY: faqat Teacher; forward manbali blok faqat [Ha] bilan
    applied = 0
    results: List[Any] = []
    lines: List[Tuple[str, str]] = []
    mb = _mod("memory_blocks")
    if mb is None:
        blocks_raw = C.WRITE_MEMORY_RE.findall(rest)
        rest = C.TEACHER_UCHUN_STRIP_RE.sub("", C.WRITE_MEMORY_RE.sub("", rest))
        if blocks_raw:
            await _sys(C.sistema(C.SIS_TEACHER_RAD, sabab="memory_blocks moduli yuklanmadi"))
    else:
        rest, blocks = mb.extract_write_blocks(rest)
        if blocks and agent == "teacher":
            if is_fwd or teacher_fwd:  # forward xabar yoki forward xabarga reply: faqat [Ha] bilan
                # preview + [Ha]/[Yo'q]; applied = 0 qoladi (Q8: kutilayotgan blok qo'llanmagan)
                await mb.request_teacher_approval(blocks, manba="teacher", sabab_turi="forward", outbox=outbox)
            else:
                results = await asyncio.to_thread(mb.apply_write_blocks, blocks, source="deleg")
                for inner in mb.sistema_for_results(results):
                    await _sys(inner)
                applied = sum(1 for r in results if getattr(r, "ok", False))
        elif blocks:
            await _sys(C.sistema(C.SIS_TEACHER_RAD, sabab=C.TW_RAD_EMAS_TPL.format(agent=agent)))
        # 7. "Teacher uchun:" qatorlari (Teacher bo'lmagan agent) -> fon topshiriq
        if agent != "teacher":
            rest, lines = mb.extract_teacher_lines(rest)
        else:
            rest = C.TEACHER_UCHUN_STRIP_RE.sub("", rest)
    rest = rest.strip()

    # 8. Blokisiz REJA (R4, synth yo'q) -> yolg'on detektori -> blok qo'llangan -> synth
    status = "done"
    if rj_blockless is not None and rj_blockless.has_blockless_trigger(rest):
        shown = C.MSG_BLOKSIZ_TPL.format(izoh=C.BLOKSIZ_IZOH, matn=html.escape(rest, quote=False))
        await outbox.send_text(shown, html=True, reply_to=reply_to)
        await _hist(C.ROLE_LEADER, C.MSG_BLOKSIZ_TPL.format(izoh=C.BLOKSIZ_IZOH, matn=C.short(rest, 1500)))
        await _sys(C.sistema(C.SIS_AGENT_OK, agent=agent, qisqa=C.short(rest, 200)))
    elif L.is_lie(rest, applied):
        matn = C.YOLGON_ALMASHTIRISH_TPL.format(agent=agent)
        await _sys(C.sistema(C.SIS_AGENT_OK, agent=agent, qisqa=C.short(matn, 200)))
        await _say(matn, escape=True, outbox=outbox, reply_to=reply_to)
        status = "failed"
    elif applied > 0:
        natija = "; ".join("%s: %s" % (r.path, r.natija) for r in results if getattr(r, "ok", False))
        await _say(C.YOZIB_QOYDIM_TPL.format(natija=natija), escape=True, outbox=outbox, reply_to=reply_to)
    else:
        await _sys(C.sistema(C.SIS_AGENT_OK, agent=agent, qisqa=C.short(rest, 200)))
        status = await _synth(agent, rest, is_fwd=is_fwd, outbox=outbox, reply_to=reply_to)

    # 9. Teacher fon topshiriqlari (javobdan keyin, ketma-ket)
    if lines:
        _spawn(_teacher_fon_seq(agent, lines), "teacher_fon")
    return status, C.short(rest or raw, _PREVIEW_MAX), res.run_id


async def _synth(agent: str, rest: str, *, is_fwd: bool, outbox: notify.Outbox,
                 reply_to: Optional[int] = None) -> str:
    """Leader synth: faqat human_reply (delegate_to e'tiborsiz). Natija: 'done' | 'failed'.
    reply_to: egasining asl xabari (javob unga reply bo'ladi)."""
    task = await asyncio.to_thread(history.build_synth_task, agent, rest, is_fwd=is_fwd)
    sres = await runner.run_agent_async("leader", task, {"source": "synth", "complexity": "strong"})
    if not sres.ok:
        await _sys(runner.sistema_for(sres))
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_sabab_for(sres)), escape=True, outbox=outbox,
                   reply_to=reply_to)
        return "failed"
    data = L.parse_leader_response(sres.text)
    if await _leader_format_error(sres.text, data, outbox=outbox, reply_to=reply_to):
        return "failed"
    reply, emoji = await _clean_reply(data["human_reply"])
    if not reply:
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=_SABAB_BOSH), escape=True, outbox=outbox,
                   reply_to=reply_to)
        return "failed"
    reply = L.normalize_latin(reply)
    await _hist(C.ROLE_LEADER, reply)
    await asyncio.to_thread(_save_promise, reply)
    await outbox.send_text(reply, html=True, reply_to=reply_to)
    sink = _REACT_SINK.get()
    if sink is not None and emoji:
        sink["react"] = emoji
    return "done"


async def _teacher_fon_seq(agent: str, lines: Sequence[Tuple[str, str]]) -> None:
    """'Teacher uchun:' qatorlari ketma-ket (bir vaqtda bitta fon Teacher)."""
    mb = _mod("memory_blocks")
    if mb is None:
        return
    async with _fon_lock():
        for tur, matn in lines:
            try:
                await mb.teacher_fon(agent, tur, matn, _outbox())
            except Exception:
                log.exception("teacher_fon yiqildi (manba: %s)", agent)


async def _on_teacher_lines(agent: str, lines: List[Tuple[str, str]]) -> None:
    """checker_worker uchun: qatorlar fon Teacher'ga (tickni to'xtatmaydi)."""
    if lines:
        _spawn(_teacher_fon_seq(agent, list(lines)), "teacher_fon")


# ---------------------------------------------------------------------------
# Tugmalar (KOD 3.2, 4; R5)
# ---------------------------------------------------------------------------
async def _answer(cb: CallbackQuery, text: Optional[str] = None) -> None:
    try:
        await cb.answer(text=(text or None) and text[:_TOAST_MAX])
    except Exception as exc:
        log.debug("callback answer: %s", _safe_err(exc))


async def on_callback(cb: CallbackQuery) -> None:
    message = cb.message
    chat_type = getattr(getattr(message, "chat", None), "type", None)
    if cb.from_user is None or cb.from_user.id != _owner_id() or message is None or chat_type != "private":
        await _answer(cb)
        return
    data = cb.data or ""
    message_id = message.message_id
    toast: Optional[str] = None
    try:
        if data.startswith(C.CB_SUP_OK) or data.startswith(C.CB_SUP_NO):
            approve = data.startswith(C.CB_SUP_OK)
            token = data[len(C.CB_SUP_OK if approve else C.CB_SUP_NO):]
            rj = _mod("reja")
            if not _TOKEN_RE.match(token):
                toast = C.MSG_MUDDAT_OTGAN
            elif rj is None:
                toast = _MSG_MODUL_YOQ_TPL.format(modul="reja")
            else:
                toast = await rj.decide(token, approve, _outbox(), message_id)
        elif data.startswith(C.CB_AR_OK) or data.startswith(C.CB_AR_NO):
            approve = data.startswith(C.CB_AR_OK)
            token = data[len(C.CB_AR_OK if approve else C.CB_AR_NO):]
            ar = _mod("ariza")
            if not _TOKEN_RE.match(token):
                toast = C.MSG_MUDDAT_OTGAN
            elif ar is None:
                toast = _MSG_MODUL_YOQ_TPL.format(modul="ariza")
            else:
                toast = await ar.decide(token, approve, _outbox(), message_id)
        elif data.startswith(C.CB_TZ_OK) or data.startswith(C.CB_TZ_NO):
            approve = data.startswith(C.CB_TZ_OK)
            token = data[len(C.CB_TZ_OK if approve else C.CB_TZ_NO):]
            tz = _mod("tuzatish")
            if not _TOKEN_RE.match(token):
                toast = C.MSG_MUDDAT_OTGAN
            elif tz is None:
                toast = _MSG_MODUL_YOQ_TPL.format(modul="tuzatish")
            else:
                toast = await tz.decide(token, approve, _outbox(), message_id)
        elif data.startswith(C.CB_TW_OK) or data.startswith(C.CB_TW_NO):
            approve = data.startswith(C.CB_TW_OK)
            token = data[len(C.CB_TW_OK if approve else C.CB_TW_NO):]
            mb = _mod("memory_blocks")
            if not _TOKEN_RE.match(token):
                toast = C.MSG_MUDDAT_OTGAN
            elif mb is None:
                toast = _MSG_MODUL_YOQ_TPL.format(modul="memory_blocks")
            else:
                toast = await mb.teacher_decision(token, approve, _outbox(), message_id)
    except Exception:
        log.exception("callback yiqildi")
        toast = C.MSG_LEADER_XATO_TPL.format(sabab=_SABAB_ICHKI)
    await _answer(cb, toast)


# ---------------------------------------------------------------------------
# Buyruqlar (LLM'siz; forward qilingan buyruq bajarilmaydi)
# ---------------------------------------------------------------------------
async def cmd_start(msg: Message) -> None:
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    await _hist(C.ROLE_OWNER, msg.text or "/start")
    await _say(_MSG_START)


async def cmd_status(msg: Message) -> None:
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    await _hist(C.ROLE_OWNER, "/status")
    text = await asyncio.to_thread(_status_text)
    await _say(text, hist=notify.plain_fallback(text))


async def cmd_health(msg: Message) -> None:
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    await _hist(C.ROLE_OWNER, "/health")
    cw = _mod("checker_worker")
    if cw is None:
        await _say(_MSG_MODUL_YOQ_TPL.format(modul="checker_worker"), escape=True)
        return
    try:
        results = await asyncio.to_thread(cw.run_all_checks_once, record=False)
    except Exception as exc:
        log.exception("/health yiqildi")
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=exc.__class__.__name__), escape=True)
        return
    lines = [C.CHECKER_QATOR_TPL.format(komponent=r.component, status=str(r.status).upper(), xabar=r.message)
             for r in results]
    body = "\n".join(lines) or "(tekshiruv yo'q)"
    text = "<b>Health</b> — %s\n<pre>%s</pre>" % (_esc(config.fmt_local(config.now_utc())), _esc(body))
    await _say(text, hist=body)


def _tolov_tahlil(pc: Any, arg: str) -> Tuple[Any, bool]:
    """(kirish, savolmi): payment_check.tolov_savol (eski modulda yo'q bo'lsa faqat parse_kirish, savolsiz)."""
    fn = getattr(pc, "tolov_savol", None)
    return fn(arg) if callable(fn) else (pc.parse_kirish(arg), False)


async def _tolov_savol_delegatsiya(msg: Message, pc: Any, kirish: Any, arg: str) -> None:
    """Matnli /tolov (identifikator + savol): Checker'ga payment_check delegatsiyasi, javob Leader synth orqali.
    Topshiriq: 'TOLOV: <identifikatorlar>\\nEgasining savoli: <to'liq matn>' (to'lov bloki _delegate_body'da)."""
    task = pc.tolov_topshiriq(kirish, arg)
    await _hist(C.ROLE_LEADER, C.DELEG_HUMAN_REPLY)
    outbox = _outbox()
    async with _owner_lock():
        ack_id = await outbox.send_text(C.ACK_MATN, html=False, reply_to=msg.message_id)
        try:
            await delegate("checker", task, intent=C.INTENT_TOLOV, is_fwd=False, image_paths=[], outbox=outbox,
                           reply_to=msg.message_id)
        finally:
            if ack_id:
                await outbox.delete(ack_id)


async def cmd_tolov(msg: Message) -> None:
    """/tolov <shartnoma | ID | summa sana | mijoz ...> [batafsil]: LLM'siz to'lov tekshiruvi (faqat o'qish).
    Identifikatordan tashqari savol bo'lsa Checker'ga delegatsiya (Leader synth); identifikatorsiz matn Leader'ga
    oddiy xabar. Tarixga faqat qisqa qator (jadval agent_chat_log'ga yozilmaydi)."""
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    arg = _TOLOV_CMD_RE.sub("", _mask_secrets(getattr(msg, "text", None) or ""), count=1).strip()
    pc = _mod("payment_check") if arg else None
    kirish, savol = _tolov_tahlil(pc, arg) if pc is not None else (None, False)
    if savol and kirish is None:
        await on_text(msg)                                # identifikatorsiz matn: Leader'ga oddiy
        return
    await _hist(C.ROLE_OWNER, ("/tolov " + C.short(arg, 60)).strip())
    if not arg:
        await _say(C.MSG_TOLOV_FOYDALANISH, escape=True)
        return
    if pc is None:
        await _say(_MSG_MODUL_YOQ_TPL.format(modul="payment_check"), escape=True)
        return
    if kirish is None:
        await _say(C.MSG_TOLOV_FOYDALANISH, escape=True)
        return
    if savol:
        await _tolov_savol_delegatsiya(msg, pc, kirish, arg)
        return
    try:
        natija = await _tolov_prefetch(pc, arg)
        text, qisqa = pc.format_owner(natija), pc.qisqa(natija)
    except Exception as exc:
        log.exception("/tolov yiqildi")
        await _say(C.MSG_LEADER_XATO_TPL.format(sabab=exc.__class__.__name__), escape=True)
        return
    await _say(text, hist=qisqa)


async def cmd_tuzat(msg: Message) -> None:
    """/tuzat <to'lov ID> [kontragent=.. kategoriya=.. shartnoma=.. tasdiq=.. izoh=..]: to'lov ustunlarini
    tahrirlash (LLM'siz). Yetishmagan ma'lumotni bot variantlar bilan so'raydi; tahrir faqat [Ha] bilan."""
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    arg = _TUZAT_CMD_RE.sub("", _mask_secrets(getattr(msg, "text", None) or ""), count=1).strip()
    await _hist(C.ROLE_OWNER, ("/tuzat " + C.short(arg, 60)).strip())
    if not arg:
        await _say(C.MSG_TUZATISH_FOYDALANISH, escape=True)
        return
    tz = _mod("tuzatish")
    if tz is None:
        await _say(_MSG_MODUL_YOQ_TPL.format(modul="tuzatish"), escape=True)
        return
    matn = "TUZATISH: " + (arg if "=" in arg.split()[0] else "tx=" + arg)
    await tz.handle(matn, _outbox(), reply_to=msg.message_id)


async def cmd_reset(msg: Message) -> None:
    if not _is_owner_private(msg):
        return
    if _is_forwarded(msg):
        await on_text(msg)
        return
    await asyncio.to_thread(history.clear_history)
    for name in ("reja", "memory_blocks", "tuzatish", "ariza"):
        module = _mod(name)
        if module is None:
            continue
        try:
            await asyncio.to_thread(module.purge_pending)
        except Exception:
            log.exception("%s.purge_pending yiqildi", name)
    try:
        await asyncio.to_thread(db.kv_del, C.KV_RECENT_PHOTO)
    except Exception as exc:
        log.debug("recent_photo o'chirilmadi: %s", exc.__class__.__name__)
    await _hist(C.ROLE_OWNER, "/reset")
    await _say(C.MSG_RESET)


def _kv_prefix(template: str) -> str:
    return template.split("{", 1)[0]


def _age_s(value: Any) -> float:
    """created_ts (epoch float yoki ISO) dan beri soniya; o'qilmasa katta son."""
    try:
        return time.time() - float(value)
    except (TypeError, ValueError):
        dt = config.parse_iso(str(value or ""))
        return (config.now_utc() - dt).total_seconds() if dt else 1e12


def _pending_count(template: str) -> int:
    n = 0
    for key in db.kv_keys(_kv_prefix(template)):
        obj = db.kv_get_json(key) or {}
        if isinstance(obj, dict) and _age_s(obj.get("created_ts")) <= C.APPROVAL_TTL_S:
            n += 1
    return n


def _facts_updated_at() -> Optional[Any]:
    try:
        with open(config.FACTS_PATH, "rb") as fh:
            head = fh.read(4096).decode("utf-8", "replace")
    except OSError:
        return None
    m = re.search(r'"updated_at"\s*:\s*"([^"]+)"', head)
    return config.parse_iso(m.group(1)) if m else None


def _status_text() -> str:
    """/status: bugungi agent_runs, Facts yoshi, kutilayotgan tasdiqlar, ochiq va'dalar, oxirgi 3 xato."""
    now = config.now_utc()
    out = ["<b>Holat</b> — %s" % _esc(config.fmt_local(now))]
    try:
        start, end = config.local_day_bounds_utc(config.today_local())
        rows = db.fetchall(
            "SELECT agent, status, COUNT(*) AS n FROM agents.agent_runs WHERE ts >= %s AND ts < %s "
            "GROUP BY agent, status ORDER BY agent, status",
            (start, end),
        )
        by_agent: Dict[str, List[str]] = {}
        for r in rows:
            by_agent.setdefault(str(_row_get(r, "agent")), []).append(
                "%s %s" % (_row_get(r, "status", 1), _row_get(r, "n", 2)))
        out += ["", "<b>Bugungi chaqiruvlar</b>"]
        out += ["• %s: %s" % (_esc(a), _esc(", ".join(v))) for a, v in by_agent.items()] or ["• yo'q"]
    except Exception as exc:
        out.append("DB xato: %s" % _esc(exc.__class__.__name__))

    out.append("")
    ts = _facts_updated_at()
    if ts is None:
        out.append("Facts: fayl yo'q yoki updated_at o'qilmadi")
    else:
        age = (now - ts).total_seconds()
        eski = " (eski)" if age > C.FACTS_ESKI_S else ""
        out.append("Facts: %s, %d daqiqa oldin%s" % (_esc(config.fmt_local(ts, "%H:%M")), int(age // 60), eski))

    try:
        out.append("Kutilayotgan tasdiqlar: reja %d, xotira %d"
                   % (_pending_count(C.KV_SUP_APPR), _pending_count(C.KV_TW_APPR)))
        row = db.fetchone("SELECT COUNT(*) AS n FROM agents.agent_promises WHERE status = 'open'")
        out.append("Ochiq va'dalar: %s" % (_row_get(row, "n") or 0))
        errs = db.fetchall(
            "SELECT ts, agent, status, error FROM agents.agent_runs WHERE status IN (%s, %s) "
            "ORDER BY ts DESC LIMIT 3",
            (C.RUN_ERROR, C.RUN_TIMEOUT),
        )
        out += ["", "<b>Oxirgi xatolar</b>"]
        out += ["• %s %s %s: %s" % (_esc(config.fmt_local(_row_get(r, "ts"), "%m-%d %H:%M")),
                                   _esc(_row_get(r, "agent", 1)), _esc(_row_get(r, "status", 2)),
                                   _esc(C.short(_row_get(r, "error", 3) or "", 120)))
                for r in errs] or ["• yo'q"]
    except Exception as exc:
        out.append("DB xato: %s" % _esc(exc.__class__.__name__))

    try:
        probe = runner.probe_cli()
        out.append("")
        out.append("CLI: %s" % ("bor" if probe.get("found") else "topilmadi"))
    except Exception as exc:
        out.append("CLI: tekshirilmadi (%s)" % _esc(exc.__class__.__name__))
    if _MOD_ERR:
        out.append("Yuklanmagan modullar: %s" % _esc(", ".join(sorted(_MOD_ERR))))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Fon vazifalar
# ---------------------------------------------------------------------------
def _snapshot() -> Dict[str, float]:
    snap: Dict[str, float] = {}
    try:
        for p in config.AGENTS_DIR.glob("*.py"):
            try:
                snap[p.name] = p.stat().st_mtime
            except OSError:
                pass
    except OSError:
        pass
    return snap


def _exec_active() -> bool:
    try:
        return bool(db.kv_lease_active(C.KV_SUP_EXEC_ACTIVE))
    except Exception:
        return False


async def _source_watcher() -> None:
    """KOD 1.8: agents/*.py o'zgarsa os._exit(0), systemd ko'taradi. REJA ijrosi va egasi suhbatini kutadi."""
    base = _snapshot()
    reja_logged = False
    owner_wait_since: Optional[float] = None
    while True:
        await asyncio.sleep(_WATCH_INTERVAL_S)
        if _snapshot() == base:
            continue
        if await asyncio.to_thread(_exec_active):  # REJA ijrosi: cheksiz kutiladi (lease TTL bilan)
            if not reja_logged:
                log.info("kod o'zgardi, REJA ijrosi tugashi kutilyapti")
                reja_logged = True
            continue
        if _owner_lock().locked():  # egasi suhbati: ko'pi bilan _WATCH_MAX_DEFER_S
            if owner_wait_since is None:
                owner_wait_since = time.monotonic()
            if time.monotonic() - owner_wait_since < _WATCH_MAX_DEFER_S:
                continue
        log.warning("agents/*.py o'zgardi: jarayon qayta ishga tushadi (systemd ko'taradi)")
        logging.shutdown()
        os._exit(0)


async def _heartbeat() -> None:
    while True:
        try:
            await asyncio.to_thread(db.kv_set, C.KV_HEARTBEAT, config.iso_utc())
        except Exception as exc:
            log.debug("heartbeat yozilmadi: %s", exc.__class__.__name__)
        await asyncio.sleep(_HEARTBEAT_S)


async def _reminder_scheduler(outbox: notify.Outbox) -> None:
    """KOD 1.6: muddati o'tgan va'da 25 daqiqada eslatiladi, 3 martadan keyin jim."""
    while True:
        await asyncio.sleep(_REMINDER_TICK_S)
        try:
            due = await asyncio.to_thread(_claim_due_promises)
        except Exception as exc:
            log.warning("va'dalar o'qilmadi: %s", exc.__class__.__name__)
            continue
        for text in due:
            await _say(C.VADA_ESLATMA_TPL.format(matn=C.short(text, 300)), escape=True, outbox=outbox)


def _cleanup_files(folder: Path, pattern: str, max_age_s: float) -> int:
    n = 0
    now = time.time()
    try:
        for p in folder.glob(pattern):
            try:
                if p.is_file() and now - p.stat().st_mtime > max_age_s:
                    p.unlink()
                    n += 1
            except OSError:
                pass
    except OSError:
        pass
    return n


def _cleanup_once() -> None:
    result: Dict[str, Any] = {}
    try:
        result = dict(db_migrations.cleanup_old() or {})
    except Exception as exc:
        log.warning("cleanup_old yiqildi: %s: %s", exc.__class__.__name__, _safe_err(exc))
    result["tg_uploads"] = _cleanup_files(config.UPLOADS_DIR, C.UPLOAD_PREFIX + "*", C.UPLOAD_MAX_AGE_S)
    result["cli_tmp"] = _cleanup_files(config.CLI_TMP_DIR, "sp_*", _CLI_TMP_MAX_AGE_S)
    try:
        db.kv_set(C.KV_CLEANUP_LAST, config.iso_utc())
    except Exception:
        pass
    log.info("tozalash: %s", result)


async def _cleanup_scheduler() -> None:
    """Startda va har 24 soatda: eski DB yozuvlari (RETENTION_DAYS) va 7 kunlik rasmlar."""
    while True:
        await asyncio.to_thread(_cleanup_once)
        await asyncio.sleep(_CLEANUP_EVERY_S)


def _start_background(outbox: notify.Outbox) -> None:
    _spawn(_supervise("source_watcher", _source_watcher), "source_watcher")
    _spawn(_supervise("heartbeat", _heartbeat), "heartbeat")
    _spawn(_supervise("reminder", lambda: _reminder_scheduler(outbox)), "reminder")
    _spawn(_supervise("cleanup", _cleanup_scheduler), "cleanup")
    facts = _mod("support_facts")
    if facts is not None:
        _spawn(_supervise("facts", facts.facts_scheduler), "facts")
    checker = _mod("checker_worker")
    if checker is not None:
        _spawn(_supervise("checker", lambda: checker.checker_scheduler(outbox, _on_teacher_lines)), "checker")
    teacher = _mod("teacher_daily")
    if teacher is not None:
        _spawn(_supervise("teacher_daily", lambda: teacher.teacher_daily_scheduler(outbox)), "teacher_daily")


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
def _register(dp: Dispatcher) -> None:
    dp.message.register(cmd_start, Command("start"), ~F.forward_origin)
    dp.message.register(cmd_status, Command("status"), ~F.forward_origin)
    dp.message.register(cmd_health, Command("health"), ~F.forward_origin)
    dp.message.register(cmd_tolov, Command("tolov"), ~F.forward_origin)
    dp.message.register(cmd_tuzat, Command("tuzat"), ~F.forward_origin)
    dp.message.register(cmd_reset, Command("reset"), ~F.forward_origin)
    dp.message.register(on_text)
    dp.callback_query.register(on_callback)


async def run() -> None:
    global _BOT, _OUTBOX
    config.configure_logging()
    errors = config.config_errors()
    if errors:
        for err in errors:
            log.error("sozlama xatosi: %s", err)
        raise SystemExit(2)
    # v1 leader (backend EnvironmentFile=backend/.env) shu tokenda poll qilsa: 409 va xabarlar ikki
    # botga bo'linadi. Polling boshlanmaydi (ORNATISH 6-qadam: A yoki B variant).
    if config.v1_leader_conflict():
        log.error("sozlama xatosi: backend/.env dagi v1 leader shu tokenni ishlatadi: LEADER_ENABLED=0 qiling "
                  "(yoki AGENTS_ENV_FILE da alohida LEADER_BOT_TOKEN)")
        raise SystemExit(2)
    runner.require_cli_mode()
    for warn in config.config_warnings():
        log.warning("ogohlantirish: %s", warn)
    settings = config.get_settings()
    log.info("sozlamalar: %r", settings)  # repr sirlarni maskalaydi

    try:
        config.ensure_dirs()
    except OSError as exc:
        log.error("papkalar yaratilmadi: %s", exc)
    try:
        await asyncio.to_thread(db_migrations.ensure_tables)
    except Exception as exc:
        log.error("jadvallar tekshirilmadi (bot DB'siz cheklangan ishlaydi): %s: %s",
                  exc.__class__.__name__, _safe_err(exc))
    # Oldingi jarayondan (os._exit, crash, restart) yopilmay qolgan vazifalar.
    # Fon vazifalar va polling boshlanishidan oldin: yangi qatorlarga tegmaydi.
    try:
        n = await asyncio.to_thread(
            db.execute,
            "UPDATE agents.agent_tasks SET status = 'failed', result_preview = 'restart', updated_at = %s "
            "WHERE status = 'in_progress'",
            (config.now_utc(),),
        )
        if n:
            log.warning("restart: %s ta yakunlanmagan agent_tasks qatori 'failed' qilindi", n)
    except Exception as exc:
        log.warning("agent_tasks tiklanmadi: %s: %s", exc.__class__.__name__, _safe_err(exc))

    try:
        bot = Bot(token=settings.bot_token)
    except Exception as exc:
        log.error("LEADER_BOT_TOKEN formati noto'g'ri (%s)", exc.__class__.__name__)
        raise SystemExit(2)
    _BOT = bot
    outbox = AiogramOutbox(bot, settings.owner_id)
    _OUTBOX = outbox
    notify.set_outbox(outbox)
    _owner_lock()
    _fon_lock()

    recovered: List[str] = []
    reja_mod = _mod("reja")
    if reja_mod is not None:
        try:
            recovered = list(await asyncio.to_thread(reja_mod.recover_interrupted) or [])
        except Exception:
            log.exception("recover_interrupted yiqildi")
    probe: Dict[str, Any] = {}
    try:
        probe = dict(await asyncio.to_thread(runner.probe_cli) or {})
    except Exception:
        log.exception("probe_cli yiqildi")
    log.info("claude CLI: %s", probe)
    for name in ("memory_blocks", "support_facts", "checker_worker", "teacher_daily", "payment_check"):
        _mod(name)

    dp = Dispatcher()
    _register(dp)
    try:
        await bot.delete_webhook(drop_pending_updates=False)
    except Exception as exc:
        log.warning("delete_webhook: %s", _safe_err(exc))
    _start_background(outbox)

    for inner in recovered:
        await _say(_MSG_RESTART_TPL.format(holat=inner), escape=True, record=False)
    if probe and not probe.get("found", True):
        await _say(_MSG_CLI_YOQ, record=False)
    if _MOD_ERR:
        await _say(_MSG_MODUL_YOQ_TPL.format(modul=", ".join(sorted(_MOD_ERR))), escape=True, record=False)

    log.info("bot ishga tushdi (long polling)")
    try:
        # handle_as_tasks: har update alohida vazifa (albom yig'ish kutishi pollingni to'xtatmaydi)
        await dp.start_polling(bot, allowed_updates=["message", "callback_query"], handle_as_tasks=True)
    finally:
        for task in list(_BG):
            task.cancel()
        await asyncio.gather(*list(_BG), return_exceptions=True)
        try:
            await bot.session.close()
        except Exception:
            pass


def main() -> None:
    """python3 -m agents.leader_bot"""
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
