"""Facts kesh: jonli holatni yig'ib agents/state/support_facts.json ga yozadi (KOD 5).

- Har 5 daqiqa: bot ichida facts_scheduler() yoki qo'lda `python3 -m agents.support_facts`.
- Har bo'lim alohida _safe(): biri yiqilsa {"error": ...}, qolganlari yangilanadi.
- Biznes jadvallar FAQAT o'qiladi: db.tx('facts', readonly=True, 15 s). Oynalar Python'da
  hisoblanadi (NOW()/CURRENT_DATE yo'q), parametr tz'siz UTC (Prisma ustunlari).
- Manba, filtr, TAQIQ ustunlar va `izoh` matni: LOYIHA_QIYMATLARI.md FACTS_MANBALARI (harfma-harf).
  Jadval/ustun nomlari backend/prisma/schema.prisma @@map/@map dan.
- `settings` jadvali hech qachon to'liq o'qilmaydi: faqat oq ro'yxatdagi kalitlar; token kalitlarining
  qiymati o'qilmaydi, faqat bor-yo'qligi.
- Erkin matn tozalanadi: leader-facts.service.ts::clean naqshlari (Python nusxasi) + C.SIR_NAQSHLARI.
- Fayl: valid JSON, bir yozuv = bir qator (Grep uchun), .tmp + os.replace.

Faqat stdlib + agents.*. Python 3.10+ mos.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from . import config
from . import contract as C
from . import db

log = logging.getLogger("agents.support_facts")

# ---------------------------------------------------------------------------
# Sozlamalar
# ---------------------------------------------------------------------------
KESH_S = 15 * 60                 # C.FACTS_KESH_15_DAQ kalitlari keshi
LEASE_TTL_S = 240                # C.KV_FACTS_LEASE
GIT_TIMEOUT_S = 10
SYSTEMCTL_TIMEOUT_S = 5
DEPLOY_LOG_QATOR = 200           # deploy.log dan oxirgi 200 ta [deploy] qatori
DEPLOY_LOG_MAX_BAYT = 512 * 1024
DEPLOY_RUNNING_S = 600           # log shu vaqt ichida yozilgan va tugamagan run = RUNNING
DEPLOY_OXIRGI = 10
INLINE_MAX = 160                 # ichma-ich dict shundan qisqa bo'lsa bitta qatorda
SEKIN_MS = 5000
SOM = "so'm"
BIRLIK_SOM = "so'm (UZS)"

# Har loyiha kalitining birinchi maydoni (FACTS_MANBALARI "izoh" ustuni, harfma-harf). DB matni qo'shilmaydi.
IZOH: Dict[str, str] = {
    "client_income": (
        "OplatyKv vznos to'lovlari, so'm, Toshkent kuni. Bugunni kechaning shu vaqtgacha qismi bilan "
        "solishtir, to'liq kun bilan emas. Jami ichida 'ot imeni klienta' ham bor: u tushum emas, alohida "
        "ayt. Bu bank kirimi emas (u bank_flow). Panel kunlik xulosasi server soatiga bog'liq, bu yerdagisi "
        "aniq Toshkent."
    ),
    "bank_flow": (
        "Jami faqat COMPLETED va UZS, so'm, Toshkent kuni. TRANSFER (o'z hisoblar orasidagi o'tkazma) jamida "
        "bor, tashqi kirimni alohida ayt. PENDING jamiga kirmaydi, panel dashboard esa qo'shadi: farq "
        "shundan. Hamkor karta to'lovlari settlement kuniga to'planadi, shishgan kun xato emas."
    ),
    "balances": (
        "Qoldiq so'm, valyuta alohida. Jamiga faqat sync yoqilgan va bank faol hisob kiradi, qolgani "
        "noma'lum, 0 emas. Vaqt = oxirgi sync (Toshkent), qoldiq vaqti emas. Backfill qoldiqni yangilamaydi. "
        "Hamkor qoldig'i ishonchsiz (faqat vipiska saldosi kelganda yangilanadi)."
    ),
    "bank_sync": (
        "Har hisob bitta qator, signal: stale, login_suspect, hung, failed; vaqt Toshkent. last_synced_at "
        "login xatosida ham yangilanadi: sog'likni signal bilan ayt. interval 0 = avto-sync o'chiq, muammo "
        "emas. Parol muddati ma'lumoti yo'q. Importlar: tur, vaqt, qator va xato soni; fayl mazmuni yo'q. "
        "Sync, ulanish testi, importni o'chirish panel ishi."
    ),
    "hamkorbank": (
        "Hamkor uchun faqat sync va ID inspektor ishlaydi. Sverka, vipiska sahifasi va memorial order Hamkor "
        "uchun yo'q: 'farq yo'q' dema. O'tgan davr faqat vipiska importi bilan keladi (API backfill bank "
        "tomonida buzuq). Import yozuvi real to'lov. txn_date = hisobga tushgan sana, karta surilgan kun "
        "emas. Summa so'm, vaqt Toshkent."
    ),
    "sverka": (
        "Avtomat sverka (har 30 daqiqa) saqlagan bugungi farqlar, so'm, vaqt Toshkent. Faqat Kapitalbank va "
        "Ipak Yo'li. Saqlangan sana bugun emas yoki chatlar soni 0 bo'lsa: noma'lum, 'farq yo'q' emas. "
        "Aybni faqat ishonch high bo'lsa ayt. Jonli sverka panel ishi."
    ),
    "crm_sverka": (
        "Oxirgi run holati va sonlar, vaqt Toshkent. Farqli shartnomalar ro'yxati DB'da yo'q, faqat panelda "
        "(Sverka CRM sahifasi): to'qima. crashed odatda server restart. Avtomat run 07:00, 12:00, 17:00. "
        "CRM faqat o'qiladi. Mijoz ismi va telefon yo'q."
    ),
    "xato": (
        "Ikki ta'rif bor: tranzaksiya tomoni va OplatyKv tomoni, qaysi ekanini ayt. Qiymat 15 daqiqa "
        "keshlangan, hisoblangan vaqtini (Toshkent) ayt. Summa so'm. Arizalar va AI agent holati shu yerda. "
        "Tasdiqlash va tuzatish panel ishi. Mijoz ismi yo'q."
    ),
    "oplatykv_sync": (
        "CLIENT bank to'lovidan OplatyKv qatori yaratilmaganlar (3 kun), yetim qatorlar (30 kun), kelajak "
        "updated_at. Summa so'm, vaqt Toshkent. XATO shartnoma ham sync bo'ladi, sabab emas. Avto-sync logi "
        "DB'da yo'q, oxirgi cron qatori taxminiy belgi. sync_xatolar = oxirgi sync yoza olmagan to'lovlar: to'lov "
        "ID, shartnoma va sababini ayt (masalan shartnoma raqami 50 belgidan uzun -> panelda shartnomani tuzatish). "
        "Yetim qatorni o'chirishni taklif qilma."
    ),
    "bank_changes": (
        "DELETED, EDITED, MOVED, aniqlangan vaqt (Toshkent), summa so'm. MOVED o'chirish emas: sana "
        "o'zgargan, OplatyKv bog'lanishi saqlanadi. Tiklash panelda (O'zgargan to'lovlar sahifasi)."
    ),
    "xonpay": (
        "Sync logi (Toshkent) va 7 kunlik moslanmagan to'lovlar (so'm). orfan = server restartida uzilgan "
        "sync, nosozlik emas. Bugungi va kechagi moslanmagan hali bankka tushmagan bo'lishi mumkin. "
        "Avto-sync faqat 07-23 soatlarida. Mijoz ismi yo'q."
    ),
    "google_export": (
        "Har sheet bitta qator: oxirgi 2 ishga tushish (Toshkent), ok yoki error, qatorlar soni. Ketma-ket "
        "2 xato jiddiy. 30 kunda log yo'q = cron ishlamagan, 'yaxshi' dema. Qayta eksport panel ishi "
        "(Admin, Export)."
    ),
    "api_usage": (
        "Oxirgi 24 soat (Toshkent): status sinflari, top yo'llar, kalit nomi bo'yicha, 5xx namunalar, "
        "kalitlar muddati. IP faqat soni. Kalit siri va key_id yo'q, so'rama."
    ),
    "telegram_notify": (
        "Har bildirishnoma bitta qator: yoqilgan, token bor-yo'q, oxirgi natija (Toshkent). Token va guruh "
        "ID yo'q, so'rama. Sverka chati 0 = avtomat sverka ishlamaydi. SHMITD empty = o'lchov yo'q, xato "
        "emas. Xabar yuborish panel yoki bot ishi."
    ),
    "counterparties": (
        "Faol soni, yangilanish xatolari, oxirgi yangilanish (Toshkent), ta'minot sync natijasi. Direktor, "
        "telefon, email, PINFL, ta'sischilar yo'q. DIDOX avto-yangilash 08:00-22:00."
    ),
    "panel_activity": (
        "Oxirgi 24 soat (Toshkent), faqat POST, PATCH, PUT, DELETE: ko'rish yozilmaydi. Xodim ismi bor, IP "
        "va email yo'q. Muvaffaqiyatsiz kirishlar soni bor. Foydalanuvchini bloklashni taklif qilma."
    ),
}

# SQL naqsh parametrlari (FACTS_MANBALARI literallari, harfma-harf; bog'lama parametr bo'lib beriladi)
P_VZNOS = "%взнос%"
P_OT_IMENI = "%от имени%"
P_VOZVRAT = "возврат%"
P_CRON = "cron%"
# Oxirgi avto-sync qatori (taxminiy belgi). created_at/created_by_name indekssiz: oyna (updated_at, id)
# indeksi orqali toraytiriladi (@updatedAt yaratilishda ham yoziladi, updated_at >= created_at).
# Parametrlar: (P_CRON, oyna, oyna). Oynada qator yo'q -> null.
_SQL_CRON_QATOR = ("SELECT MAX(created_at) AS ts FROM oplata_kv WHERE created_by_name LIKE %s"
                   " AND updated_at >= %s AND created_at >= %s")
P_BACKFILL = "%backfill%"
P_RESTART = "Server restart%"
P_LOGIN = "%/login"

# settings: qiymati o'qilishi mumkin bo'lgan kalitlar (boshqasi -> ValueError)
SETTINGS_QIYMAT = frozenset({
    "bulkSync.enabled", "bulkSync.timeOfDay", "bulkSync.intervalDays", "bulkSync.lastRunAt", "sync.minDate",
    "sverka.telegram.notifiedToday", "sverka.telegram.history",
    "crmSverka.lastRun",
    "agent.dateFrom", "agent.aiEnabled", "agent.aiModel", "agent.aiIntervalMin", "agent.aiFromHour",
    "agent.aiToHour", "agent.aiName",
    "oplatykv.txAutoSyncMinutes", "oplatykv.txMinDate", "oplatykv.dayStart", "oplatykv.dayEnd",
    "oplatykv.nightStart", "oplatykv.nightEnd",
    "xonpay.cron.enabled", "xonpay.cron.intervalMinutes",
    "agent.enabled", "agent.dailyTime", "agent.lastResult", "corrbot.enabled", "chekorder.tg.enabled",
    "autsourcing.cronEnabled", "autsourcing.cronTime", "shmitd.enabled", "shmitd.cronTimes", "shmitd.dateOffset",
    "counterparties.autoRefreshEnabled", "counterparties.xontaminot.autoSync",
    "counterparties.xontaminot.intervalMin", "counterparties.xontaminot.startHour",
    "counterparties.xontaminot.endHour", "counterparties.xontaminot.lastSyncAt",
    "counterparties.xontaminot.lastSyncStats",
})
# settings: faqat (value IS NOT NULL AND value <> '') va updated_at; value SELECT qilinmaydi
SETTINGS_BOR = frozenset({
    "agent.botToken", "sverka.telegram.botToken", "corrbot.botToken", "chekorder.tg.botToken",
    "shmitd.botToken", "autsourcing.botToken", "agent.aiKey", "chek.tg.config", "crmSverka.snapshot",
    "sverka.telegram.notifiedToday",
})
_LR_AJRATGICH = " " + chr(0x00B7) + " "  # agent.lastResult: "<ISO> . <matn>"
KEY_SVERKA_CHATS = "sverka.telegram.chats"  # faqat SQL ichida son/rol hisoblanadi, qiymat chiqmaydi
# faqat SQL ichida msgs soni va date; chatId/messageId chiqmaydi. "Bo'sh emas" yaramaydi: 23:00 '{"msgs":[]}' yozadi
KEY_EVENING_REMINDER = "sverka.telegram.eveningReminder"

# ---------------------------------------------------------------------------
# Matn tozalash (leader-facts.service.ts::clean + redactSecrets asosiy naqshlari)
# ---------------------------------------------------------------------------
_MASK = "***"
_PEM_RE = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)")
_CLEAN_NAQSHLAR: Tuple[Tuple["re.Pattern[str]", str], ...] = (
    (re.compile(r"-100\d{9,13}\b"), _MASK),                                   # Telegram guruh ID
    (re.compile(r"\b\d{8,10}:[A-Za-z0-9_-]{30,}"), _MASK),                    # bot token
    (re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}"), _MASK),                        # Anthropic
    (re.compile(r"\bx[sk]_live_\w+"), _MASK),                                 # developer API kalit
    (re.compile(r"\bxt_[A-Za-z0-9]{20,}\b"), _MASK),                          # forwarder siri shakli
    (re.compile(r"\bghp_\w+|\bgithub_pat_\w+|\bgh[ousr]_[A-Za-z0-9]{20,}"), _MASK),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b"), _MASK),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"), _MASK),  # JWT
    (re.compile(r"(//)[^/\s:@]+:[^/\s@]+@"), r"\1***@"),                      # URL login:parol
    (re.compile(r"\b(Basic|Bearer)\s+[A-Za-z0-9+/=._~-]{8,}"), r"\1 ***"),
    (re.compile(
        r"\b(password|passwd|pwd|parol|secret|token|api[_-]?key|apikey|sid|authorization|login)"
        r"(\s*[:=]\s*)(\"?)[^\s\"',;&]+", re.I), r"\1\2\3***"),
    (re.compile(r"([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)"), r"\1***@\2"),  # email
    (re.compile(r"\+?998[\s\-()]*\d{2}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b"), _MASK),  # telefon
    (re.compile(r"\b\d{14}\b"), _MASK),                                       # PINFL
)
_BLOB_RE = re.compile(r"[A-Za-z0-9+/=_-]{40,}")  # uzun kalit/hash bo'lagi
_RAQAM_RE = re.compile(r"\d")
_HARF_RE = re.compile(r"[A-Za-z]")
_WS_RE = re.compile(r"\s+")


def _mask_sir(m: "re.Match[str]") -> str:
    return m.group(0) if _MASK in m.group(0) else _MASK


def _mask_blob(m: "re.Match[str]") -> str:
    s = m.group(0)
    return _MASK if (_RAQAM_RE.search(s) and _HARF_RE.search(s)) else s


def _clean(v: Any, n: int = 200) -> Optional[str]:
    """Erkin matn: sirlar maskalanadi, [ ] -> ( ), bo'shliqlar bittaga, n belgidan kesiladi."""
    if v is None:
        return None
    t = v if isinstance(v, str) else str(v)
    if not t:
        return ""
    t = _PEM_RE.sub(_MASK, t)
    for rx, rep in _CLEAN_NAQSHLAR:
        t = rx.sub(rep, t)
    for rx in C.SIR_NAQSHLARI:
        t = rx.sub(_mask_sir, t)
    t = _BLOB_RE.sub(_mask_blob, t)
    t = t.replace("[", "(").replace("]", ")")
    t = _WS_RE.sub(" ", t).strip()
    return t if len(t) <= n else t[:n].rstrip() + "..."


def _kim(v: Any, n: int = 60) -> Optional[str]:
    """triggered_by/detected_by/imported_by: manual:<email> -> manual, boshqa email maskalanadi."""
    if v is None:
        return None
    s = str(v).strip()
    if s.lower().startswith("manual:"):
        return "manual"
    return _clean(s, n)


def _err(exc: BaseException) -> str:
    return _clean("%s: %s" % (exc.__class__.__name__, exc), 300) or exc.__class__.__name__


# ---------------------------------------------------------------------------
# Qiymat yordamchilari
# ---------------------------------------------------------------------------
def _pul(v: Any) -> Any:
    """Pul: Decimal/BigInt -> son, 2 xona (butun bo'lsa int). None -> 0."""
    if v is None:
        return 0
    try:
        x = round(float(v), 2)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(x):
        return 0
    return int(x) if x.is_integer() else x


def _pul_n(v: Any) -> Any:
    return None if v is None else _pul(v)


def _int(v: Any) -> int:
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        try:
            return int(float(v))
        except (TypeError, ValueError):
            return 0


def _int_n(v: Any) -> Optional[int]:
    return None if v is None or v == "" else _int(v)


def _iso_vaqt(v: Any) -> Optional[str]:
    """ISO satr (settings/JSON) -> 'YYYY-MM-DD HH:MM' Toshkent; o'qib bo'lmasa qisqa matn."""
    if v is None:
        return None
    s = str(v).strip()
    if not s:
        return None
    dt = config.parse_iso(s)
    return config.fmt_local(dt) if dt else _clean(s, 40)


def _vaqt(v: Any) -> Optional[str]:
    """DB vaqti (tz'siz UTC yoki aware) -> 'YYYY-MM-DD HH:MM' Toshkent; date -> 'YYYY-MM-DD'."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return config.fmt_local(v)
    if isinstance(v, date):
        return v.isoformat()
    return _iso_vaqt(v)


def _flag_1(v: Any) -> bool:
    """Backend semantikasi: settings.set(K, enabled ? '1' : null) — faqat '1' yoqiq, NULL/yo'q = o'chiq."""
    return v is not None and str(v).strip() == "1"


def _flag_1_true(v: Any) -> bool:
    """chekorder.tg.enabled: backend enabled === '1' || enabled === 'true'."""
    return v is not None and str(v).strip() in ("1", "true")


def _flag(v: Any) -> Optional[bool]:
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in ("1", "true", "yes", "on"):
        return True
    if s in ("0", "false", "no", "off"):
        return False
    return None


def _json(s: Any) -> Any:
    if not s:
        return None
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return None


_SANA_RE = re.compile(r"^\s*(\d{4})-(\d{2})-(\d{2})")


def _sana_param(v: Any) -> Optional[date]:
    """'YYYY-MM-DD...' -> date (Toshkent kalendari); boshqasi None."""
    m = _SANA_RE.match(str(v or ""))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _day_utc(d: date) -> Tuple[datetime, datetime]:
    """Toshkent kuni [00:00, ertasi 00:00) -> tz'siz UTC (Prisma ustunlari uchun parametr)."""
    a, b = config.local_day_bounds_utc(d)
    return config.naive_utc(a), config.naive_utc(b)


def _gb(b: float) -> float:
    return round(b / (1024 ** 3), 2)


def _acc() -> Dict[str, Any]:
    return {"summa": Decimal(0), "soni": 0}


def _acc_add(a: Dict[str, Any], summa: Any, soni: Any) -> None:
    a["summa"] += Decimal(summa or 0)
    a["soni"] += _int(soni)


def _acc_out(a: Dict[str, Any]) -> Dict[str, Any]:
    return {"summa": _pul(a["summa"]), "soni": a["soni"]}


# ---------------------------------------------------------------------------
# DB yordamchilari
# ---------------------------------------------------------------------------
def _fx() -> Any:
    """Biznes jadvallar (public): faqat o'qish, statement_timeout 15 s."""
    return db.tx("facts", readonly=True, timeout_ms=C.FACTS_STATEMENT_TIMEOUT_MS)


def _ax() -> Any:
    """Bot jadvallari (agents sxemasi): faqat o'qish."""
    return db.tx("agents", readonly=True, timeout_ms=C.FACTS_STATEMENT_TIMEOUT_MS)


def _rows(cur: Any, sql: str, params: Any = None) -> List[Dict[str, Any]]:
    """Savepoint ichida so'rov: xato bo'lsa tranzaksiya buzilmaydi, keyingi so'rov ishlaydi."""
    cur.execute("SAVEPOINT facts_q")
    try:
        cur.execute(sql, params if params else None)
        rows = cur.fetchall() if cur.description is not None else []
    except Exception:
        try:
            cur.execute("ROLLBACK TO SAVEPOINT facts_q")
        except Exception:  # noqa: BLE001 - ulanish singan bo'lsa tashqi xato ko'tariladi
            pass
        raise
    cur.execute("RELEASE SAVEPOINT facts_q")
    return [dict(r) for r in rows]


def _row(cur: Any, sql: str, params: Any = None) -> Dict[str, Any]:
    rows = _rows(cur, sql, params)
    return rows[0] if rows else {}


def _settings(cur: Any, keys: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """Oq ro'yxatdagi settings kalitlari: {key: {"v": value, "u": updated_at}}."""
    keys = list(keys)
    bad = [k for k in keys if k not in SETTINGS_QIYMAT]
    if bad:
        raise ValueError("settings oq ro'yxatda yo'q: " + ", ".join(bad))
    out: Dict[str, Dict[str, Any]] = {k: {"v": None, "u": None} for k in keys}
    for r in _rows(cur, "SELECT key, value, updated_at FROM settings WHERE key = ANY(%s)", (keys,)):
        out[r["key"]] = {"v": r["value"], "u": r["updated_at"]}
    return out


def _settings_bor(cur: Any, keys: Sequence[str]) -> Dict[str, Dict[str, Any]]:
    """Qiymatni o'qimasdan: {key: {"bor": bool, "u": updated_at}}."""
    keys = list(keys)
    bad = [k for k in keys if k not in SETTINGS_BOR]
    if bad:
        raise ValueError("settings (bor) oq ro'yxatda yo'q: " + ", ".join(bad))
    out: Dict[str, Dict[str, Any]] = {k: {"bor": False, "u": None} for k in keys}
    sql = "SELECT key, (value IS NOT NULL AND value <> '') AS bor, updated_at FROM settings WHERE key = ANY(%s)"
    for r in _rows(cur, sql, (keys,)):
        out[r["key"]] = {"bor": bool(r["bor"]), "u": r["updated_at"]}
    return out


def _kechki_eslatma(cur: Any) -> Dict[str, Any]:
    """20:00 kechki eslatma: {"soni": msgs soni, "sana": date, "u": updated_at} (+ "error"). Qiymat chiqmaydi.

    deleteEveningReminderMessages sozlamani bo'shatmaydi, '{"msgs":[]}' yozadi: turibdi = soni > 0.
    """
    out: Dict[str, Any] = {"soni": 0, "sana": None, "u": None}
    try:
        r = _row(cur, "SELECT CASE WHEN jsonb_typeof(value::jsonb->'msgs') = 'array'"
                      " THEN jsonb_array_length(value::jsonb->'msgs') ELSE 0 END AS n,"
                      " value::jsonb->>'date' AS sana, updated_at FROM settings WHERE key = %s",
                 (KEY_EVENING_REMINDER,))
    except Exception as exc:  # noqa: BLE001 - buzuq JSON: faqat updated_at
        out["error"] = _err(exc)
        u = _row(cur, "SELECT updated_at FROM settings WHERE key = %s", (KEY_EVENING_REMINDER,))
        out["u"] = u.get("updated_at")
        return out
    out.update(soni=_int(r.get("n")), sana=_clean(r.get("sana"), 20), u=r.get("updated_at"))
    return out


def _sv(st: Dict[str, Dict[str, Any]], key: str, n: int = 60) -> Optional[str]:
    """Setting qiymati (qisqa, tozalangan)."""
    return _clean(st.get(key, {}).get("v"), n)


# ---------------------------------------------------------------------------
# Bo'lim qobig'i, kesh
# ---------------------------------------------------------------------------
def _safe(name: str, fn: Callable[[], Any]) -> Any:
    """Bo'lim xatosi boshqalarni to'xtatmaydi: xato -> {"error": "<tozalangan, 300>"}."""
    t0 = time.monotonic()
    try:
        return fn()
    except Exception as exc:  # noqa: BLE001 - har bo'lim o'z xatosini qaytaradi
        msg = _err(exc)
        log.warning("facts %s xato: %s", name, msg)
        return {"error": msg}
    finally:
        ms = int((time.monotonic() - t0) * 1000)
        if ms > SEKIN_MS:
            log.warning("facts %s sekin: %d ms", name, ms)


def _with_izoh(kalit: str, val: Any) -> Dict[str, Any]:
    """Loyiha kaliti: birinchi maydon statik izoh (xato bo'lsa ham)."""
    out: Dict[str, Any] = {"izoh": IZOH.get(kalit, "")}
    if isinstance(val, dict):
        for k, v in val.items():
            if k != "izoh":
                out[k] = v
    else:
        out["qiymat"] = val
    return out


def _cached(kalit: str, fn: Callable[[], Dict[str, Any]]) -> Dict[str, Any]:
    """15 daqiqalik kesh (kv_store). Qiymatga `hisoblangan` (Toshkent) va `keshdan` qo'shiladi."""
    key = C.kv_key(C.KV_FACTS_CACHE, kalit=kalit)
    now = config.now_utc()
    try:
        saved = db.kv_get_json(key)
    except Exception as exc:  # noqa: BLE001 - kesh yo'q bo'lsa hisoblanadi
        log.debug("facts kesh o'qilmadi (%s): %s", kalit, _err(exc))
        saved = None
    if isinstance(saved, dict) and isinstance(saved.get("value"), dict):
        ts = config.parse_iso(str(saved.get("ts") or ""))
        if ts is not None and 0 <= (now - ts).total_seconds() < KESH_S:
            val = saved["value"]
            out = {"hisoblangan": val.get("hisoblangan"), "keshdan": True}
            out.update((k, v) for k, v in val.items() if k not in ("hisoblangan", "keshdan"))
            return out
    data = fn()
    out = {"hisoblangan": config.fmt_local(now), "keshdan": False}
    out.update((k, v) for k, v in data.items() if k not in ("hisoblangan", "keshdan"))
    try:
        store = {k: v for k, v in out.items() if k != "keshdan"}
        db.kv_set_json(key, {"ts": config.iso_utc(now), "value": store})
    except Exception as exc:  # noqa: BLE001
        log.warning("facts kesh yozilmadi (%s): %s", kalit, _err(exc))
    return out


# ---------------------------------------------------------------------------
# Tashqi buyruqlar (systemctl, git)
# ---------------------------------------------------------------------------
def _cmd_env() -> Dict[str, str]:
    return {
        "PATH": os.environ.get("PATH") or "/usr/local/bin:/usr/bin:/bin",
        "HOME": os.environ.get("HOME") or os.path.expanduser("~"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
    }


def _run(cmd: List[str], timeout: int, cwd: Optional[str] = None) -> str:
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, env=_cmd_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", timeout=timeout,
        )
    except FileNotFoundError:
        raise RuntimeError(cmd[0] + " topilmadi") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError("%s %d s ichida javob bermadi" % (cmd[0], timeout)) from None
    if proc.returncode != 0:
        raise RuntimeError("%s exit %d: %s" % (cmd[0], proc.returncode, _clean(proc.stderr, 200)))
    return proc.stdout or ""


# ---------------------------------------------------------------------------
# system
# ---------------------------------------------------------------------------
_SYSTEMCTL_PROPS = "LoadState,ActiveState,SubState,ActiveEnterTimestamp,ActiveEnterTimestampMonotonic,NRestarts"


def _systemd_since(props: Dict[str, str]) -> Optional[str]:
    """Servis qachon active bo'lgan: monotonic soatdan (TZ'ga bog'liq emas), bo'lmasa xom matn."""
    try:
        us = int(props.get("ActiveEnterTimestampMonotonic") or 0)
    except ValueError:
        us = 0
    if us > 0:
        started = time.time() - (time.monotonic() - us / 1e6)
        return config.fmt_local(datetime.fromtimestamp(started, timezone.utc))
    raw = (props.get("ActiveEnterTimestamp") or "").strip()
    return _clean(raw, 40) if raw and raw != "n/a" else None


def _service(name: str) -> Dict[str, Any]:
    out = _run(["systemctl", "show", name, "--no-pager", "--property=" + _SYSTEMCTL_PROPS], SYSTEMCTL_TIMEOUT_S)
    props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    if props.get("LoadState") == "not-found":
        return {"faol": False, "holat": "topilmadi", "ishga_tushgan": None, "restartlar": None}
    active = props.get("ActiveState", "")
    return {
        "faol": active == "active",
        "holat": "%s/%s" % (active, props.get("SubState", "")),
        "ishga_tushgan": _systemd_since(props),
        "restartlar": _int_n(props.get("NRestarts")),
    }


def _services() -> Dict[str, Any]:
    return {name: _safe("system.services." + name, lambda n=name: _service(n)) for name in C.FACTS_SERVISLAR}


def _disk() -> Dict[str, Any]:
    u = shutil.disk_usage("/")
    band = u.used + u.free
    return {
        "yol": "/",
        "jami_gb": _gb(u.total),
        "bosh_gb": _gb(u.free),
        "band_foiz": round(u.used * 100.0 / band, 1) if band else None,
    }


def _ram() -> Dict[str, Any]:
    vals: Dict[str, int] = {}
    with open("/proc/meminfo", encoding="ascii", errors="replace") as fh:
        for line in fh:
            k, _, rest = line.partition(":")
            parts = rest.split()
            if parts and parts[0].isdigit():
                vals[k.strip()] = int(parts[0]) * 1024
    total = vals.get("MemTotal", 0)
    avail = vals.get("MemAvailable", vals.get("MemFree", 0))
    swap_total = vals.get("SwapTotal", 0)
    swap_free = vals.get("SwapFree", 0)
    return {
        "jami_gb": _gb(total),
        "bosh_gb": _gb(avail),
        "band_foiz": round((total - avail) * 100.0 / total, 1) if total else None,
        "swap_jami_gb": _gb(swap_total),
        "swap_band_gb": _gb(max(0, swap_total - swap_free)),
    }


def _load() -> Dict[str, Any]:
    m1, m5, m15 = os.getloadavg()
    return {"m1": round(m1, 2), "m5": round(m5, 2), "m15": round(m15, 2), "cpu": os.cpu_count()}


def _uptime_soat() -> float:
    with open("/proc/uptime", encoding="ascii") as fh:
        return round(float(fh.read().split()[0]) / 3600.0, 1)


def _db_ms() -> int:
    t0 = time.monotonic()
    with _fx() as cur:
        _row(cur, "SELECT 1 AS ok")
    return int((time.monotonic() - t0) * 1000)


def _health() -> List[Dict[str, Any]]:
    """Checker yozgan oxirgi holat (har komponent, 24 soat ichida)."""
    since = config.now_utc() - timedelta(hours=24)
    with _ax() as cur:
        rows = _rows(
            cur,
            "SELECT DISTINCT ON (component) component, status, message, ts FROM " + C.DB_SCHEMA
            + ".agent_health WHERE ts >= %s ORDER BY component, ts DESC",
            (since,),
        )
    return [
        {"komponent": r["component"], "status": r["status"], "xabar": _clean(r["message"], 200), "vaqt": _vaqt(r["ts"])}
        for r in rows
    ]


def _collect_system() -> Dict[str, Any]:
    return {
        "services": _safe("system.services", _services),
        "disk": _safe("system.disk", _disk),
        "ram": _safe("system.ram", _ram),
        "load": _safe("system.load", _load),
        "uptime_soat": _safe("system.uptime", _uptime_soat),
        "db_ms": _safe("system.db_ms", _db_ms),
        "health": _safe("system.health", _health),
    }


# ---------------------------------------------------------------------------
# schedulers (LOYIHA_QIYMATLARI SCHEDULERLAR "iz" ustuni). Izi yo'q vazifalar yo'q.
# ---------------------------------------------------------------------------
def _scheduler_db_items() -> List[Dict[str, Any]]:
    now = config.now_utc()
    d2 = config.naive_utc(now - timedelta(days=2))
    d3 = config.naive_utc(now - timedelta(days=3))
    d7 = config.naive_utc(now - timedelta(days=7))
    d30 = config.naive_utc(now - timedelta(days=30))
    items: List[Dict[str, Any]] = []
    with _fx() as cur:

        def add(nomi: str, jadval: str, iz: str, fn: Callable[[], Dict[str, Any]]) -> None:
            rec: Dict[str, Any] = {"nomi": nomi, "jadval": jadval, "iz": iz}
            try:
                rec.update(fn())
            except Exception as exc:  # noqa: BLE001 - bitta vazifa xatosi qolganini to'xtatmaydi
                rec["error"] = _err(exc)
            items.append(rec)

        def oxirgi_log(sql: str, params: Any = None) -> Dict[str, Any]:
            r = _row(cur, sql, params)
            out: Dict[str, Any] = {"oxirgi": _vaqt(r.get("ts"))}
            if "status" in r:
                out["status"] = r.get("status")
            if r.get("xato"):
                out["xato"] = _clean(r.get("xato"), 150)
            return out

        def setting_vaqt(key: str) -> Dict[str, Any]:
            return {"oxirgi": _iso_vaqt(_settings(cur, [key])[key]["v"])}

        def agent_last() -> Dict[str, Any]:
            raw = _settings(cur, ["agent.lastResult"])["agent.lastResult"]["v"] or ""
            vaqt, _, matn = raw.partition(_LR_AJRATGICH)
            if not matn:
                return {"oxirgi": None, "natija": _clean(raw, 150) or None}
            return {"oxirgi": _iso_vaqt(vaqt), "natija": _clean(matn, 150)}

        def crm_run() -> Dict[str, Any]:
            run = _json(_settings(cur, ["crmSverka.lastRun"])["crmSverka.lastRun"]["v"])
            if not isinstance(run, dict):
                return {"oxirgi": None}
            return {"oxirgi": _iso_vaqt(run.get("startedAt")), "tugagan": _iso_vaqt(run.get("finishedAt")),
                    "status": _clean(run.get("status"), 20)}

        def bor_vaqt(key: str) -> Dict[str, Any]:
            return {"oxirgi": _vaqt(_settings_bor(cur, [key])[key]["u"])}

        def eslatma() -> Dict[str, Any]:
            e = _kechki_eslatma(cur)
            out: Dict[str, Any] = {"oxirgi": _vaqt(e["u"]), "eslatma_turibdi": e["soni"] > 0,
                                   "eslatma_sana": e["sana"]}
            if e.get("error"):
                out["error"] = e["error"]
            return out

        def crm_navbat(sql: str) -> Dict[str, Any]:
            return {"navbatda": _int(_row(cur, sql).get("n"))}

        add("SyncService.tick", "har daqiqa, har hisob banks.sync_interval_minutes bo'yicha",
            "sync_logs.started_at",
            lambda: oxirgi_log("SELECT started_at AS ts, status::text AS status, error_message AS xato FROM sync_logs"
                               " WHERE started_at >= %s ORDER BY started_at DESC LIMIT 1", (d2,)))
        add("SyncService.bulkScheduleTick", "kuniga 1 marta (bulkSync.timeOfDay, default 18:00)",
            "settings bulkSync.lastRunAt", lambda: setting_vaqt("bulkSync.lastRunAt"))
        add("OplataKvService.autoSyncTick", "kunduz 08:00-22:00 har N daqiqa, tun 01:00-07:50 bir marta",
            "oplata_kv cron qatori (taxminiy)",
            lambda: oxirgi_log(_SQL_CRON_QATOR, (P_CRON, d3, d3)))
        add("OplataKvService.crmStatusBackfillTick", "har daqiqa, 200 tadan",
            "crm_contracts virtual_status NULL va found soni",
            lambda: crm_navbat("SELECT COUNT(*) AS n FROM crm_contracts WHERE virtual_status IS NULL AND found"))
        add("CrmContractCacheService.crmMetaBackfillTick", "har daqiqa, 200 tadan",
            "crm_contracts branch_name NULL soni",
            lambda: crm_navbat("SELECT COUNT(*) AS n FROM crm_contracts WHERE branch_name IS NULL"))
        add("SverkaTelegramService.autoSverkaNotify", "har 30 daqiqa",
            "settings sverka.telegram.notifiedToday updated_at",
            lambda: bor_vaqt("sverka.telegram.notifiedToday"))
        add("SverkaTelegramService.eveningReminder", "20:00 yuboradi, 23:00 o'chiradi",
            "settings sverka.telegram.eveningReminder msgs soni", eslatma)
        add("AgentService.tick", "kuniga 1 marta (agent.dailyTime, default 09:00)",
            "settings agent.lastResult", agent_last)
        add("AgentAiService.tick", "ish soatida har N daqiqa (default 5)",
            "xato_correction_requests.agent_at",
            lambda: oxirgi_log("SELECT MAX(agent_at) AS ts FROM xato_correction_requests"))
        add("ChekService.notifyCron", "09-21 soatlarda har 5 daqiqa", "chek_dog.tg_sent_at",
            lambda: oxirgi_log("SELECT MAX(tg_sent_at) AS ts FROM chek_dog"))
        add("CounterpartiesCron.refreshHourly", "08:00-22:00 har soat", "counterparties.last_fetched_at",
            lambda: oxirgi_log("SELECT MAX(last_fetched_at) AS ts FROM counterparties"))
        add("CounterpartiesCron.xontaminotSyncTick", "har 5 daqiqa, ichki gate",
            "settings counterparties.xontaminot.lastSyncAt",
            lambda: setting_vaqt("counterparties.xontaminot.lastSyncAt"))
        add("CrmSverkaService.autoRefresh", "07:00, 12:00, 17:00 va backend start", "settings crmSverka.lastRun",
            crm_run)
        add("GoogleExportService.exportSheetsCronTick", "har daqiqa, har sheet o'z jadvali",
            "export_cron_logs.started_at",
            lambda: oxirgi_log("SELECT started_at AS ts, status, error AS xato FROM export_cron_logs"
                               " WHERE started_at >= %s ORDER BY started_at DESC LIMIT 1", (d30,)))
        add("ShmitdService.cronTick", "shmitd.cronTimes vaqtlarida", "shmitd_logs.sent_at",
            lambda: oxirgi_log("SELECT sent_at AS ts, status, error AS xato FROM shmitd_logs"
                               " ORDER BY sent_at DESC LIMIT 1"))
        add("xonpay-auto-sync", "xonpay.cron.intervalMinutes (default 60), faqat 07-23",
            "xonpay_sync_logs.started_at",
            lambda: oxirgi_log("SELECT started_at AS ts, status, error_message AS xato FROM xonpay_sync_logs"
                               " ORDER BY started_at DESC LIMIT 1"))
        add("LeaderAlertService.tick (v1)", "har 15 daqiqa", "leader_alerts.created_at (faqat alert bo'lsa)",
            lambda: oxirgi_log("SELECT MAX(created_at) AS ts FROM leader_alerts WHERE created_at >= %s", (d7,)))
        add("LeaderOrchestratorService.teacherDaily (v1)", "22:30", "leader_runs (agent teacher)",
            lambda: oxirgi_log("SELECT created_at AS ts, status, error AS xato FROM leader_runs"
                               " WHERE agent = 'teacher' AND created_at >= %s ORDER BY created_at DESC LIMIT 1",
                               (d7,)))
    return items


def _scheduler_bot_items() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []

    def kv_item(nomi: str, jadval: str, key: str, parse: Callable[[Any], Any]) -> None:
        rec: Dict[str, Any] = {"nomi": nomi, "jadval": jadval, "iz": "kv_store " + key}
        try:
            rec["oxirgi"] = parse(db.kv_get(key))
        except Exception as exc:  # noqa: BLE001
            rec["error"] = _err(exc)
        items.append(rec)

    kv_item("Leader bot heartbeat", "har 60 s", C.KV_HEARTBEAT, _iso_vaqt)
    kv_item("Checker scheduler", "start 45 s, keyin har 4 soat", C.KV_CHECKER_LAST, _iso_vaqt)
    kv_item("Teacher kunlik", "22:30 (Toshkent)", C.KV_TEACHER_LAST, lambda v: _clean(v, 20))
    items.append({"nomi": "Facts cron", "jadval": "har 5 daqiqa", "iz": "updated_at kaliti"})
    rec: Dict[str, Any] = {"nomi": "Va'da eslatmasi", "jadval": "har 60 s tekshiradi, 25 daqiqada eslatadi",
                           "iz": C.DB_SCHEMA + ".agent_promises"}
    try:
        with _ax() as cur:
            r = _row(cur, "SELECT COUNT(*) AS n, MIN(due_at) AS eng_yaqin FROM " + C.DB_SCHEMA
                     + ".agent_promises WHERE status = 'open'")
        rec["ochiq"] = _int(r.get("n"))
        rec["eng_yaqin_muddat"] = _vaqt(r.get("eng_yaqin"))
    except Exception as exc:  # noqa: BLE001
        rec["error"] = _err(exc)
    items.append(rec)
    return items


def _collect_schedulers() -> Dict[str, Any]:
    return {
        "vazifalar": _safe("schedulers.db", _scheduler_db_items),
        "bot": _safe("schedulers.bot", _scheduler_bot_items),
    }


# ---------------------------------------------------------------------------
# deploy: git HEAD + agents/state/deploy_log.json, bo'lmasa deploy.log dumi (deploy.sh ga tegilmaydi)
# ---------------------------------------------------------------------------
_CH_XATO = chr(0x2717)    # deploy.sh "x" belgisi
_CH_OGOH = chr(0x26A0)    # deploy.sh ogohlantirish belgisi
_CH_CHIZIQ = chr(0x2501)  # deploy.sh sarlavha chizig'i
_NUQTA = chr(0x00B7)      # deploy.sh START qatori ajratgichi
_DEPLOY_QATOR_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} \[deploy\] (.*)$")
_DEPLOY_OK_RE = re.compile(r"DEPLOY OK\D*?(\d+)s")
_DEPLOY_FAIL_RE = re.compile(r"^FAIL:\s*(.*)$")
_DEPLOY_KV_RE = re.compile(
    r"\b(branch|pusher|services)=([^" + _CH_CHIZIQ + r"]*?)\s*(?:" + _NUQTA + "|" + _CH_CHIZIQ + r"|$)"
)
_BUILD_XATO_RE = re.compile(r"error TS\d+|Cannot find|Module not found", re.I)


def _git_head() -> Dict[str, Any]:
    repo = str(config.REPO)
    base = ["git", "-c", "safe.directory=" + repo, "-C", repo]
    out = _run(base + ["log", "-1", "--format=%H|%ad|%s", "--date=iso-strict"], GIT_TIMEOUT_S).strip()
    parts = out.split("|", 2)
    if len(parts) < 3:
        raise RuntimeError("git log natijasi tushunarsiz")
    head: Dict[str, Any] = {
        "commit": parts[0].strip(),
        "qisqa": parts[0].strip()[:8],
        "vaqt": _iso_vaqt(parts[1].strip()),
        "xabar": _clean(parts[2], 150),
    }
    try:
        head["branch"] = _run(base + ["rev-parse", "--abbrev-ref", "HEAD"], GIT_TIMEOUT_S).strip() or None
    except RuntimeError:
        head["branch"] = None
    return head


def _sanitize(v: Any, depth: int = 0) -> Any:
    """deploy_log.json yozuvi: matnlar tozalanadi, chuqurlik va ro'yxat cheklanadi."""
    if depth > 4:
        return None
    if isinstance(v, str):
        return _clean(v, 200)
    if isinstance(v, (bool, int, float)) or v is None:
        return v
    if isinstance(v, list):
        return [_sanitize(x, depth + 1) for x in v[:20]]
    if isinstance(v, dict):
        return {str(k)[:40]: _sanitize(x, depth + 1) for k, x in list(v.items())[:30]}
    return _clean(v, 200)


def _natija_of(e: Dict[str, Any]) -> Optional[str]:
    for k in ("natija", "status", "result"):
        if e.get(k) not in (None, ""):
            return _clean(e.get(k), 20)
    if isinstance(e.get("ok"), bool):
        return "OK" if e["ok"] else "FAIL"
    return None


def _deploys_from_json(path: Path) -> List[Dict[str, Any]]:
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    if isinstance(raw, dict):
        raw = raw.get("deploys") or raw.get("items") or []
    if not isinstance(raw, list):
        raise ValueError("deploy_log.json ro'yxat emas")
    out: List[Dict[str, Any]] = []
    for e in [x for x in raw if isinstance(x, dict)][-DEPLOY_OXIRGI:][::-1]:
        rec = _sanitize(e)
        if "natija" not in rec:
            rec = dict({"natija": _natija_of(e)}, **rec)
        out.append(rec)
    return out


def _tail_lines(path: str, max_bytes: int) -> List[str]:
    with open(path, "rb") as fh:
        fh.seek(0, os.SEEK_END)
        size = fh.tell()
        fh.seek(max(0, size - max_bytes))
        data = fh.read()
    lines = data.decode("utf-8", errors="replace").splitlines()
    if size > max_bytes and lines:
        lines = lines[1:]  # birinchi qator kesilgan bo'lishi mumkin
    return lines


def _yangi_run(vaqt: Optional[str]) -> Dict[str, Any]:
    return {"vaqt": vaqt, "boshlangan": vaqt, "tugagan": None, "natija": None, "davomiylik_s": None,
            "branch": None, "pusher": None, "servislar": None, "xatolar": [], "build_xatolari": []}


def _parse_deploy_log(lines: List[str], yaqinda_yozilgan: bool) -> List[Dict[str, Any]]:
    """deploy.sh log() qatorlari: DEPLOY START / DEPLOY OK / x FAIL. Natija eng yangisi birinchi."""
    idx = [i for i, line in enumerate(lines) if _DEPLOY_QATOR_RE.match(line)]
    if not idx:
        return []
    boshi = idx[-DEPLOY_LOG_QATOR] if len(idx) > DEPLOY_LOG_QATOR else idx[0]
    runs: List[Dict[str, Any]] = []
    cur: Optional[Dict[str, Any]] = None
    for line in lines[boshi:]:
        m = _DEPLOY_QATOR_RE.match(line)
        if not m:
            if cur is not None and _BUILD_XATO_RE.search(line) and len(cur["build_xatolari"]) < 3:
                cur["build_xatolari"].append(_clean(line, 200))
            continue
        vaqt = m.group(1) + " " + m.group(2)
        msg = m.group(3).strip()
        if "DEPLOY START" in msg:
            cur = _yangi_run(vaqt)
            for k, v in _DEPLOY_KV_RE.findall(msg):
                if k == "branch":
                    cur["branch"] = _clean(v, 60)
                elif k == "pusher":
                    cur["pusher"] = _kim(v, 60)
                else:
                    cur["servislar"] = _clean(v, 80)
            runs.append(cur)
            continue
        if "deploy lock" in msg and "ololmadi" in msg:
            cur = _yangi_run(vaqt)
            cur.update({"tugagan": vaqt, "natija": "FAIL", "xatolar": ["deploy lock olinmadi"]})
            runs.append(cur)
            continue
        if cur is None:  # boshi logdan tashqarida qolgan run
            cur = _yangi_run(None)
            cur["qisman"] = True
            runs.append(cur)
        if "DEPLOY OK" in msg:
            cur["natija"] = "OK"
            cur["tugagan"] = vaqt
            cur["vaqt"] = vaqt
            dm = _DEPLOY_OK_RE.search(msg)
            if dm:
                cur["davomiylik_s"] = int(dm.group(1))
            if "no-restart" in msg:
                cur["restartsiz"] = True
            continue
        if msg.startswith(_CH_XATO):
            text = msg[len(_CH_XATO):].strip()
            fm = _DEPLOY_FAIL_RE.match(text)
            if fm:
                cur["xatolar"].append(_clean(fm.group(1), 120))
                if cur["natija"] != "OK":
                    cur["natija"] = "FAIL"
                    cur["tugagan"] = vaqt
                    cur["vaqt"] = vaqt
            else:
                cur["xatolar"].append(_clean(text, 120))
            continue
        if msg.startswith(_CH_OGOH):
            cur.setdefault("ogohlantirishlar", []).append(_clean(msg[len(_CH_OGOH):].strip(), 120))
    for i, r in enumerate(runs):
        if r["natija"] is None:
            r["natija"] = "RUNNING" if (i == len(runs) - 1 and yaqinda_yozilgan) else "noma'lum"
        if not r["build_xatolari"]:
            del r["build_xatolari"]
    return runs[-DEPLOY_OXIRGI:][::-1]


def _collect_deploy() -> Dict[str, Any]:
    out: Dict[str, Any] = {"head": _safe("deploy.head", _git_head)}
    json_path = config.DEPLOY_LOG_JSON
    log_path = config.get_settings().deploy_log
    xatolar: List[str] = []
    if json_path.exists():
        try:
            out["manba"] = config.rel_to_repo(json_path)
            out["deploys"] = _deploys_from_json(json_path)
            return out
        except (OSError, ValueError) as exc:
            xatolar.append("deploy_log.json o'qilmadi: " + _err(exc))
    try:
        lines = _tail_lines(log_path, DEPLOY_LOG_MAX_BAYT)
        yaqinda = (time.time() - os.path.getmtime(log_path)) < DEPLOY_RUNNING_S
        out["manba"] = log_path + " (oxirgi " + str(DEPLOY_LOG_QATOR) + " ta [deploy] qatori)"
        out["vaqt_zonasi"] = "deploy.log vaqti server soatida (zonasiz)"
        out["deploys"] = _parse_deploy_log(lines, yaqinda)
        if xatolar:
            out["ogohlantirish"] = "; ".join(xatolar)
        return out
    except OSError as exc:
        xatolar.append("deploy.log o'qilmadi: " + _err(exc))
    out["deploys"] = []
    out["error"] = _clean("; ".join(xatolar), 300)
    return out


# ---------------------------------------------------------------------------
# agent_tasks (agents sxemasi)
# ---------------------------------------------------------------------------
def _collect_agent_tasks() -> Dict[str, Any]:
    t = C.DB_SCHEMA
    with _ax() as cur:
        tasks = _rows(
            cur,
            "SELECT id, created_at, updated_at, agent, intent, source, is_forward, task, status, result_preview"
            " FROM " + t + ".agent_tasks ORDER BY created_at DESC, id DESC LIMIT 60",
        )
        promises = _rows(
            cur,
            "SELECT id, created_at, due_at, \"text\", \"trigger\", status, reminder_count, last_reminded_at"
            " FROM " + t + ".agent_promises ORDER BY created_at DESC, id DESC LIMIT 40",
        )
    return {
        "tasks": [
            {
                "id": _int(r["id"]), "vaqt": _vaqt(r["created_at"]), "yangilangan": _vaqt(r["updated_at"]),
                "agent": r["agent"], "intent": r["intent"], "manba": r["source"], "forward": bool(r["is_forward"]),
                "holat": r["status"], "topshiriq": _clean(r["task"], 300), "natija": _clean(r["result_preview"], 300),
            }
            for r in tasks
        ],
        "promises": [
            {
                "id": _int(r["id"]), "vaqt": _vaqt(r["created_at"]), "muddat": _vaqt(r["due_at"]),
                "matn": _clean(r["text"], 200), "trigger": r["trigger"], "holat": r["status"],
                "eslatmalar": _int(r["reminder_count"]), "oxirgi_eslatma": _vaqt(r["last_reminded_at"]),
            }
            for r in promises
        ],
    }


# ---------------------------------------------------------------------------
# client_income (oplata_kv; filtr oplata-kv.service.ts::dailySummary bilan bir xil). TAQIQ: client, purpose, contract_no
# ---------------------------------------------------------------------------
_CI_SUM_SQL = (
    "SELECT COALESCE(SUM(payment_amount), 0) AS summa,"
    " COALESCE(SUM(first_installment), 0) AS boshlangich,"
    " COALESCE(SUM(monthly_amount), 0) AS oylik,"
    " COUNT(*) AS soni,"
    " COALESCE(SUM(payment_amount) FILTER (WHERE tx_type ILIKE %(ot)s), 0) AS ot_imeni_summa,"
    " COUNT(*) FILTER (WHERE tx_type ILIKE %(ot)s) AS ot_imeni_soni"
    " FROM oplata_kv"
    " WHERE payment_amount > 0 AND tx_type ILIKE %(vznos)s"
    " AND \"date\" >= %(d0)s AND \"date\" <= %(d1)s"
)
_CI_KUNLIK_SQL = (
    "SELECT \"date\" AS kun, COALESCE(SUM(payment_amount), 0) AS summa,"
    " COALESCE(SUM(first_installment), 0) AS boshlangich, COALESCE(SUM(monthly_amount), 0) AS oylik,"
    " COUNT(*) AS soni"
    " FROM oplata_kv"
    " WHERE payment_amount > 0 AND tx_type ILIKE %(vznos)s AND \"date\" >= %(d0)s AND \"date\" <= %(d1)s"
    " GROUP BY \"date\" ORDER BY \"date\""
)
_CI_TOP_SQL = (
    "SELECT COALESCE(object, '') AS obyekt, COALESCE(SUM(payment_amount), 0) AS summa, COUNT(*) AS soni"
    " FROM oplata_kv"
    " WHERE payment_amount > 0 AND tx_type ILIKE %(vznos)s AND NOT tx_type ILIKE %(ot)s"
    " AND \"date\" >= %(d0)s AND \"date\" <= %(d1)s"
    " GROUP BY COALESCE(object, '') ORDER BY summa DESC LIMIT 10"
)
_CI_QAYTARISH_SQL = (
    "SELECT ABS(COALESCE(SUM(payment_amount), 0)) AS summa, COUNT(*) AS soni"
    " FROM oplata_kv"
    " WHERE payment_amount < 0 AND tx_type ILIKE %(voz)s AND \"date\" >= %(d0)s AND \"date\" <= %(d1)s"
)


def _ci_bolim(cur: Any, d0: date, d1: date, created_max: Optional[datetime] = None) -> Dict[str, Any]:
    sql = _CI_SUM_SQL
    params: Dict[str, Any] = {"ot": P_OT_IMENI, "vznos": P_VZNOS, "d0": d0, "d1": d1}
    if created_max is not None:
        sql += " AND created_at <= %(cmax)s"
        params["cmax"] = created_max
    r = _row(cur, sql, params)
    return {
        "summa": _pul(r.get("summa")), "boshlangich": _pul(r.get("boshlangich")), "oylik": _pul(r.get("oylik")),
        "soni": _int(r.get("soni")), "ot_imeni_summa": _pul(r.get("ot_imeni_summa")),
        "ot_imeni_soni": _int(r.get("ot_imeni_soni")),
    }


def _ci_top(cur: Any, d0: date, d1: date) -> List[Dict[str, Any]]:
    rows = _rows(cur, _CI_TOP_SQL, {"vznos": P_VZNOS, "ot": P_OT_IMENI, "d0": d0, "d1": d1})
    return [{"obyekt": _clean(r["obyekt"], 80) or "(obyektsiz)", "summa": _pul(r["summa"]), "soni": _int(r["soni"])}
            for r in rows]


def _ci_qaytarish(cur: Any, d0: date, d1: date) -> Dict[str, Any]:
    r = _row(cur, _CI_QAYTARISH_SQL, {"voz": P_VOZVRAT, "d0": d0, "d1": d1})
    return {"summa": _pul(r.get("summa")), "soni": _int(r.get("soni"))}


def _collect_client_income() -> Dict[str, Any]:
    now_loc = config.now_local()
    today = now_loc.date()
    yest = today - timedelta(days=1)
    m0 = today.replace(day=1)
    pm0 = (m0 - timedelta(days=1)).replace(day=1)
    pm_same = pm0.replace(day=min(today.day, monthrange(pm0.year, pm0.month)[1]))
    # kecha shu vaqtgacha: kecha sanasi + hozirgi Toshkent HH:MM:SS, UTC'ga o'girilgan
    cutoff = config.naive_utc(datetime.combine(yest, now_loc.timetz()))
    d14 = today - timedelta(days=13)
    with _fx() as cur:
        bugun = _ci_bolim(cur, today, today)
        kecha = _ci_bolim(cur, yest, yest)
        kecha_sv = _ci_bolim(cur, yest, yest, cutoff)
        oy = _ci_bolim(cur, m0, today)
        otgan = _ci_bolim(cur, pm0, pm_same)
        kun_rows = _rows(cur, _CI_KUNLIK_SQL, {"vznos": P_VZNOS, "d0": d14, "d1": today})
        top_bugun = _ci_top(cur, today, today)
        top_oy = _ci_top(cur, m0, today)
        qayt_bugun = _ci_qaytarish(cur, today, today)
        qayt_oy = _ci_qaytarish(cur, m0, today)
    by_day = {r["kun"]: r for r in kun_rows}
    kunlik = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        r = by_day.get(d, {})
        kunlik.append({"sana": d.isoformat(), "summa": _pul(r.get("summa")), "boshlangich": _pul(r.get("boshlangich")),
                       "oylik": _pul(r.get("oylik")), "soni": _int(r.get("soni"))})

    def ot(b: Dict[str, Any]) -> Dict[str, Any]:
        return {"summa": b["ot_imeni_summa"], "soni": b["ot_imeni_soni"]}

    return {
        "birlik": SOM,
        "bugun": dict({"sana": today.isoformat()}, **bugun),
        "kecha_toliq": dict({"sana": yest.isoformat()}, **kecha),
        "kecha_shu_vaqtgacha": dict({"sana": yest.isoformat(), "gacha": now_loc.strftime("%H:%M")}, **kecha_sv),
        "oy_boshidan": dict({"dan": m0.isoformat(), "gacha": today.isoformat()}, **oy),
        "otgan_oy_shu_kungacha": dict({"dan": pm0.isoformat(), "gacha": pm_same.isoformat()}, **otgan),
        "kunlik": kunlik,
        "top_obyektlar": {"bugun": top_bugun, "oy_boshidan": top_oy},
        "ot_imeni": {"bugun": ot(bugun), "kecha_toliq": ot(kecha), "oy_boshidan": ot(oy)},
        "qaytarishlar": {"bugun": qayt_bugun, "oy_boshidan": qayt_oy},
    }


# ---------------------------------------------------------------------------
# bank_flow (transactions). TAQIQ: from_*/to_* nom, inn, hisob, description, metadata, raw_extra
# ---------------------------------------------------------------------------
_BF_KUN_SQL = (
    "SELECT t.direction::text AS dir, t.status::text AS st, t.currency AS valyuta,"
    " COALESCE(bk.code, '') AS bank, COALESCE(c.code = 'TRANSFER', false) AS transfer,"
    " COALESCE(SUM(t.amount), 0) AS summa, COUNT(*) AS soni"
    " FROM transactions t"
    " LEFT JOIN banks bk ON bk.id = t.bank_id"
    " LEFT JOIN categories c ON c.id = t.category_id"
    " WHERE t.txn_date >= %(a)s AND t.txn_date < %(b)s"
    " GROUP BY 1, 2, 3, 4, 5"
)
_BF_KUNLIK_SQL = (
    "SELECT ((t.txn_date + interval '5 hours')::date) AS kun, t.direction::text AS dir,"
    " COALESCE(SUM(t.amount), 0) AS summa, COUNT(*) AS soni,"
    " COALESCE(SUM(t.amount) FILTER (WHERE c.code = 'TRANSFER'), 0) AS transfer"
    " FROM transactions t LEFT JOIN categories c ON c.id = t.category_id"
    " WHERE t.txn_date >= %(a)s AND t.txn_date < %(b)s AND t.status = 'COMPLETED' AND t.currency = 'UZS'"
    " GROUP BY 1, 2 ORDER BY 1"
)


def _bf_kun(cur: Any, d: date) -> Dict[str, Any]:
    a, b = _day_utc(d)
    rows = _rows(cur, _BF_KUN_SQL, {"a": a, "b": b})
    kirim, chiqim, tr_in, tr_out = _acc(), _acc(), _acc(), _acc()
    banks: Dict[str, Dict[str, Any]] = {}
    holat: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    boshqa: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for r in rows:
        yon, st, val = str(r["dir"]), str(r["st"]), str(r["valyuta"])
        _acc_add(holat.setdefault((yon, st, val), _acc()), r["summa"], r["soni"])
        if st != "COMPLETED":
            continue
        if val != "UZS":
            _acc_add(boshqa.setdefault((yon, val), _acc()), r["summa"], r["soni"])
            continue
        kirim_mi = yon == "IN"
        _acc_add(kirim if kirim_mi else chiqim, r["summa"], r["soni"])
        bk = banks.setdefault(r["bank"] or "(bank yo'q)", {"kirim": _acc(), "chiqim": _acc()})
        _acc_add(bk["kirim" if kirim_mi else "chiqim"], r["summa"], r["soni"])
        if r["transfer"]:
            _acc_add(tr_in if kirim_mi else tr_out, r["summa"], r["soni"])
    bank_kesimi = [
        {"bank": code, "kirim": _pul(v["kirim"]["summa"]), "kirim_soni": v["kirim"]["soni"],
         "chiqim": _pul(v["chiqim"]["summa"]), "chiqim_soni": v["chiqim"]["soni"]}
        for code, v in sorted(banks.items(), key=lambda kv: -kv[1]["kirim"]["summa"])
    ]
    return {
        "sana": d.isoformat(),
        "kirim": _acc_out(kirim),
        "chiqim": _acc_out(chiqim),
        "sof": _pul(kirim["summa"] - chiqim["summa"]),
        "transfer": {"kirim": _acc_out(tr_in), "chiqim": _acc_out(tr_out)},
        "tashqi_kirim": _pul(kirim["summa"] - tr_in["summa"]),
        "tashqi_chiqim": _pul(chiqim["summa"] - tr_out["summa"]),
        "bank_kesimi": bank_kesimi,
        "holat_kesimi": [dict({"yonalish": k[0], "holat": k[1], "valyuta": k[2]}, **_acc_out(v))
                         for k, v in sorted(holat.items())],
        "boshqa_valyuta": [dict({"yonalish": k[0], "valyuta": k[1]}, **_acc_out(v))
                           for k, v in sorted(boshqa.items())],
    }


def _collect_bank_flow() -> Dict[str, Any]:
    today = config.today_local()
    d7 = today - timedelta(days=6)
    with _fx() as cur:
        bugun = _bf_kun(cur, today)
        kecha = _bf_kun(cur, today - timedelta(days=1))
        a, _ = _day_utc(d7)
        _, b = _day_utc(today)
        rows = _rows(cur, _BF_KUNLIK_SQL, {"a": a, "b": b})
    by_day: Dict[date, Dict[str, Any]] = {}
    for r in rows:
        rec = by_day.setdefault(r["kun"], {"kirim": _acc(), "chiqim": _acc(), "tr_in": Decimal(0)})
        if r["dir"] == "IN":
            _acc_add(rec["kirim"], r["summa"], r["soni"])
            rec["tr_in"] += Decimal(r["transfer"] or 0)
        else:
            _acc_add(rec["chiqim"], r["summa"], r["soni"])
    kunlik = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        rec = by_day.get(d) or {"kirim": _acc(), "chiqim": _acc(), "tr_in": Decimal(0)}
        kunlik.append({
            "sana": d.isoformat(), "kirim": _pul(rec["kirim"]["summa"]), "kirim_soni": rec["kirim"]["soni"],
            "chiqim": _pul(rec["chiqim"]["summa"]), "chiqim_soni": rec["chiqim"]["soni"],
            "tashqi_kirim": _pul(rec["kirim"]["summa"] - rec["tr_in"]),
        })
    return {"birlik": BIRLIK_SOM, "bugun": bugun, "kecha": kecha, "kunlik": kunlik}


# ---------------------------------------------------------------------------
# balances (bank_accounts + banks)
# ---------------------------------------------------------------------------
def _collect_balances() -> Dict[str, Any]:
    with _fx() as cur:
        rows = _rows(
            cur,
            "SELECT b.code AS bank, b.name AS bank_nomi, b.api_kind::text AS api_kind, b.is_active AS bank_faol,"
            " a.account_no, a.owner_name, a.currency, a.balance, a.sync_enabled, a.last_synced_at"
            " FROM bank_accounts a JOIN banks b ON b.id = a.bank_id",
        )
    hisoblar: List[Dict[str, Any]] = []
    kesim: Dict[Tuple[str, str], Dict[str, Any]] = {}
    umumiy: Dict[str, Decimal] = {}
    for r in rows:
        counted = bool(r["sync_enabled"] and r["bank_faol"] and r["balance"] is not None)
        rec: Dict[str, Any] = {
            "bank": r["bank"], "bank_nomi": _clean(r["bank_nomi"], 60), "hisob": r["account_no"],
            "egasi": _clean(r["owner_name"], 80), "valyuta": r["currency"], "qoldiq": _pul_n(r["balance"]),
            "sync_enabled": bool(r["sync_enabled"]), "bank_faol": bool(r["bank_faol"]),
            "last_synced_at": _vaqt(r["last_synced_at"]), "jamiga_kirgan": counted,
        }
        if r["api_kind"] == "HAMKORBANK_V1":
            rec["qoldiq_ishonchsiz"] = True
        hisoblar.append(rec)
        if counted:
            k = kesim.setdefault((str(r["bank"]), str(r["currency"])), {"jami": Decimal(0), "hisoblar": 0})
            k["jami"] += Decimal(r["balance"])
            k["hisoblar"] += 1
            umumiy[str(r["currency"])] = umumiy.get(str(r["currency"]), Decimal(0)) + Decimal(r["balance"])
    hisoblar.sort(key=lambda x: (not x["jamiga_kirgan"], -float(x["qoldiq"] or 0)))
    return {
        "birlik": "hisob valyutasida (UZS = so'm)",
        "umumiy": {cur_: _pul(v) for cur_, v in sorted(umumiy.items())},
        "bank_kesimi": [
            {"bank": k[0], "valyuta": k[1], "jami": _pul(v["jami"]), "hisoblar": v["hisoblar"]}
            for k, v in sorted(kesim.items(), key=lambda kv: -kv[1]["jami"])
        ],
        "hisoblar_soni": len(hisoblar),
        "jamiga_kirmagan": sum(1 for h in hisoblar if not h["jamiga_kirgan"]),
        "hisoblar": hisoblar,
    }


# ---------------------------------------------------------------------------
# bank_sync. TAQIQ: password_enc, login_name, login_prefix, client_id_ext, sid*, banks.api_base_url
# ---------------------------------------------------------------------------
_SYNC_AKTIV_SQL = (
    "SELECT a.id, b.code AS bank, b.api_kind::text AS api_kind, b.sync_interval_minutes AS interval_daq,"
    " a.account_no, a.owner_name, a.last_synced_at"
    " FROM bank_accounts a"
    " JOIN banks b ON b.id = a.bank_id"
    " JOIN bank_credentials c ON c.id = a.credential_id"
    " WHERE a.sync_enabled AND b.is_active AND c.is_active"
    " AND b.api_kind IN ('KAPITALBANK_V3', 'IPAK_YOLI_V1', 'HAMKORBANK_V1')"
    " ORDER BY b.code, a.account_no"
)
_SYNC_LOG3_SQL = (
    "SELECT account_id, status, fetched, saved, errors, error_message, started_at, finished_at, backfill FROM ("
    " SELECT l.account_id, l.status::text AS status, l.fetched, l.saved, l.errors, l.error_message,"
    " l.started_at, l.finished_at, (l.source ILIKE %(bf)s) AS backfill,"
    " ROW_NUMBER() OVER (PARTITION BY l.account_id ORDER BY l.started_at DESC) AS rn"
    " FROM sync_logs l WHERE l.account_id = ANY(%(ids)s) AND l.started_at >= %(since)s"
    ") x WHERE rn <= 3 ORDER BY account_id, started_at DESC"
)


def _log_rec(l: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "status": l["status"], "fetched": _int(l["fetched"]), "saved": _int(l["saved"]), "errors": _int(l["errors"]),
        "xato": _clean(l["error_message"], 200), "boshlangan": _vaqt(l["started_at"]),
        "tugagan": _vaqt(l["finished_at"]), "backfill": bool(l["backfill"]),
    }


def _signals(now: datetime, interval: int, last_synced: Optional[datetime],
             logs: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
    """leader-health.service.ts::checkBankSync signallari. (nomlar, izohlar)."""
    nomlar: List[str] = []
    izohlar: List[str] = []
    if interval > 0:
        if last_synced is None:
            nomlar.append("stale")
            izohlar.append("stale: hech qachon sync bo'lmagan")
        elif (now - config.to_utc(last_synced)).total_seconds() > 3 * interval * 60:
            nomlar.append("stale")
            izohlar.append("stale: oxirgi sync 3 x interval dan eski (interval %d daq)" % interval)
    done = next((x for x in logs if x["status"] != "RUNNING"), None)
    if done and done["status"] == "PARTIAL" and _int(done["fetched"]) == 0 and _int(done["errors"]) >= 10:
        nomlar.append("login_suspect")
        izohlar.append("login_suspect: oxirgi yakunlangan sync PARTIAL, 0 ta olindi, %d xato" % _int(done["errors"]))
    if logs and logs[0]["status"] == "RUNNING" and logs[0]["started_at"] is not None \
            and (now - config.to_utc(logs[0]["started_at"])).total_seconds() > 15 * 60:
        nomlar.append("hung")
        izohlar.append("hung: RUNNING 15 daqiqadan uzoq (restartda uzilgan bo'lishi mumkin)")
    if len(logs) >= 3 and all(x["status"] == "FAILED" for x in logs[:3]):
        nomlar.append("failed")
        izohlar.append("failed: oxirgi 3 ta sync FAILED")
    return nomlar, izohlar


def _collect_bank_sync() -> Dict[str, Any]:
    now = config.now_utc()
    since24 = config.naive_utc(now - timedelta(hours=24))
    since30 = config.naive_utc(now - timedelta(days=30))
    a0, a1 = _day_utc(config.today_local())
    with _fx() as cur:
        accounts = _rows(cur, _SYNC_AKTIV_SQL)
        ids = [r["id"] for r in accounts]
        logs = _rows(cur, _SYNC_LOG3_SQL, {"bf": P_BACKFILL, "ids": ids, "since": since24}) if ids else []
        banks = _rows(cur, "SELECT code, api_kind::text AS api_kind, is_active, sync_interval_minutes"
                           " FROM banks ORDER BY code")
        bugun_rows = _rows(
            cur,
            "SELECT status::text AS status, COUNT(*) AS n, COALESCE(SUM(fetched), 0) AS fetched,"
            " COALESCE(SUM(saved), 0) AS saved, COALESCE(SUM(errors), 0) AS errors"
            " FROM sync_logs WHERE started_at >= %(a)s AND started_at < %(b)s GROUP BY 1",
            {"a": a0, "b": a1},
        )
        creds = _rows(
            cur,
            "SELECT b.code AS bank, c.label, c.is_active, c.auth_mode::text AS auth_mode, c.use_proxy,"
            " c.last_verified_at, c.last_error"
            " FROM bank_credentials c JOIN banks b ON b.id = c.bank_id ORDER BY b.code, c.label",
        )
        st = _settings(cur, ("bulkSync.enabled", "bulkSync.timeOfDay", "bulkSync.intervalDays",
                             "bulkSync.lastRunAt", "sync.minDate"))
        imports = _rows(
            cur,
            "SELECT kind, file_name, imported_by, imported_at, rows_total, rows_added, rows_skipped, rows_errors, notes"
            " FROM import_batches ORDER BY imported_at DESC LIMIT 10",
        )
        imports30 = _rows(
            cur,
            "SELECT kind, COUNT(*) AS n, COALESCE(SUM(rows_added), 0) AS added, COALESCE(SUM(rows_errors), 0) AS errs"
            " FROM import_batches WHERE imported_at >= %s GROUP BY kind ORDER BY kind",
            (since30,),
        )
    by_acc: Dict[str, List[Dict[str, Any]]] = {}
    for l in logs:
        by_acc.setdefault(l["account_id"], []).append(l)
    hisoblar: List[Dict[str, Any]] = []
    per_bank: Dict[str, Dict[str, int]] = {}
    for a in accounts:
        interval = _int(a["interval_daq"])
        al = by_acc.get(a["id"], [])
        nomlar, izohlar = _signals(now, interval, a["last_synced_at"], al)
        pb = per_bank.setdefault(str(a["bank"]), {"hisoblar": 0, "sog": 0, "muammoli": 0})
        pb["hisoblar"] += 1
        pb["muammoli" if nomlar else "sog"] += 1
        hisoblar.append({
            "bank": a["bank"], "hisob": a["account_no"], "egasi": _clean(a["owner_name"], 80),
            "interval_daq": interval, "avto_sync": interval > 0, "last_synced_at": _vaqt(a["last_synced_at"]),
            "signallar": nomlar, "signal_izoh": izohlar, "oxirgi_loglar": [_log_rec(x) for x in al],
        })
    hisoblar.sort(key=lambda h: (not h["signallar"], str(h["bank"]), str(h["hisob"])))
    bugun_holat = {r["status"]: _int(r["n"]) for r in bugun_rows}
    return {
        "hisoblar": hisoblar,
        "banklar": [
            {"bank": b["code"], "api_kind": b["api_kind"], "is_active": bool(b["is_active"]),
             "interval_daq": _int(b["sync_interval_minutes"]),
             **per_bank.get(str(b["code"]), {"hisoblar": 0, "sog": 0, "muammoli": 0})}
            for b in banks
        ],
        "bugun": {
            "loglar": sum(bugun_holat.values()),
            "fetched": sum(_int(r["fetched"]) for r in bugun_rows),
            "saved": sum(_int(r["saved"]) for r in bugun_rows),
            "errors": sum(_int(r["errors"]) for r in bugun_rows),
            "holat": bugun_holat,
        },
        "ulanishlar": [
            {"bank": c["bank"], "nomi": _clean(c["label"], 80), "is_active": bool(c["is_active"]),
             "auth_mode": c["auth_mode"], "use_proxy": bool(c["use_proxy"]),
             "last_verified_at": _vaqt(c["last_verified_at"]), "last_error": _clean(c["last_error"], 200)}
            for c in creds
        ],
        "sozlamalar": {
            "bulkSync.enabled": _sv(st, "bulkSync.enabled", 10),
            "bulkSync.timeOfDay": _sv(st, "bulkSync.timeOfDay", 10),
            "bulkSync.intervalDays": _sv(st, "bulkSync.intervalDays", 10),
            "bulkSync.lastRunAt": _iso_vaqt(st["bulkSync.lastRunAt"]["v"]),
            "sync.minDate": _sv(st, "sync.minDate", 30),
        },
        "importlar": [
            {"tur": r["kind"], "fayl": _clean(r["file_name"], 80), "kim": _kim(r["imported_by"]),
             "vaqt": _vaqt(r["imported_at"]), "rows_total": _int(r["rows_total"]), "rows_added": _int(r["rows_added"]),
             "rows_skipped": _int(r["rows_skipped"]), "rows_errors": _int(r["rows_errors"]),
             "izoh_matn": _clean(r["notes"], 100)}
            for r in imports
        ],
        "importlar_30_kun": [
            {"tur": r["kind"], "soni": _int(r["n"]), "rows_added": _int(r["added"]), "rows_errors": _int(r["errs"])}
            for r in imports30
        ],
    }


# ---------------------------------------------------------------------------
# hamkorbank. TAQIQ: api_base_url, login/parol, hb_dedup_key, metadata, raw_extra
# ---------------------------------------------------------------------------
def _collect_hamkorbank() -> Dict[str, Any]:
    now = config.now_utc()
    today = config.today_local()
    a7, _ = _day_utc(today - timedelta(days=6))
    _, b7 = _day_utc(today)
    since7 = config.naive_utc(now - timedelta(days=7))
    with _fx() as cur:
        bank = _row(cur, "SELECT id, api_kind::text AS api_kind, is_active, sync_interval_minutes"
                         " FROM banks WHERE code = 'HAMKORBANK'")
        if not bank:
            return {"birlik": SOM, "bank_topilmadi": True}
        bid = bank["id"]
        accounts = _rows(cur, "SELECT id, account_no, owner_name, sync_enabled, last_synced_at FROM bank_accounts"
                              " WHERE bank_id = %s ORDER BY account_no", (bid,))
        ids = [r["id"] for r in accounts]
        last_logs = _rows(
            cur,
            "SELECT DISTINCT ON (account_id) account_id, status::text AS status, fetched, saved, errors, error_message,"
            " started_at, finished_at, (source ILIKE %(bf)s) AS backfill"
            " FROM sync_logs WHERE account_id = ANY(%(ids)s) AND started_at >= %(since)s"
            " ORDER BY account_id, started_at DESC",
            {"bf": P_BACKFILL, "ids": ids, "since": since7},
        ) if ids else []
        tx = _rows(
            cur,
            "SELECT source::text AS manba, direction::text AS dir, COUNT(*) AS soni, COALESCE(SUM(amount), 0) AS summa"
            " FROM transactions WHERE bank_id = %(bank)s AND status = 'COMPLETED'"
            " AND txn_date >= %(a)s AND txn_date < %(b)s GROUP BY 1, 2 ORDER BY 1, 2",
            {"bank": bid, "a": a7, "b": b7},
        )
        imports = _rows(
            cur,
            "SELECT file_name, imported_at, rows_total, rows_added, rows_skipped, rows_errors FROM import_batches"
            " WHERE kind = 'hamkor-vipiska' ORDER BY imported_at DESC LIMIT 5",
        )
        ranges = _rows(
            cur,
            "SELECT a.account_no, r.date_from, r.date_to, r.source, r.created_at"
            " FROM sync_exclusion_ranges r JOIN bank_accounts a ON a.id = r.account_id"
            " WHERE a.bank_id = %s ORDER BY r.created_at DESC LIMIT 20",
            (bid,),
        )
        creds = _rows(cur, "SELECT label, is_active, last_verified_at, last_error FROM bank_credentials"
                           " WHERE bank_id = %s ORDER BY label", (bid,))
    lmap = {r["account_id"]: r for r in last_logs}
    return {
        "birlik": SOM,
        "bank": {"api_kind": bank["api_kind"], "is_active": bool(bank["is_active"]),
                 "interval_daq": _int(bank["sync_interval_minutes"])},
        "hisoblar": [
            {"hisob": r["account_no"], "egasi": _clean(r["owner_name"], 80), "sync_enabled": bool(r["sync_enabled"]),
             "last_synced_at": _vaqt(r["last_synced_at"]),
             "oxirgi_log": _log_rec(lmap[r["id"]]) if r["id"] in lmap else None}
            for r in accounts
        ],
        "tranzaksiyalar_7_kun": {
            "dan": (today - timedelta(days=6)).isoformat(), "gacha": today.isoformat(),
            "kesim": [{"manba": r["manba"], "yonalish": r["dir"], "soni": _int(r["soni"]), "summa": _pul(r["summa"])}
                      for r in tx],
        },
        "vipiska_importlari": [
            {"fayl": _clean(r["file_name"], 80), "vaqt": _vaqt(r["imported_at"]), "rows_total": _int(r["rows_total"]),
             "rows_added": _int(r["rows_added"]), "rows_skipped": _int(r["rows_skipped"]),
             "rows_errors": _int(r["rows_errors"])}
            for r in imports
        ],
        "sync_istisno_oraliqlari": [
            {"hisob": r["account_no"], "dan": _vaqt(r["date_from"]), "gacha": _vaqt(r["date_to"]),
             "manba": _clean(r["source"], 16), "yaratilgan": _vaqt(r["created_at"])}
            for r in ranges
        ],
        "ulanishlar": [
            {"nomi": _clean(c["label"], 80), "is_active": bool(c["is_active"]),
             "last_verified_at": _vaqt(c["last_verified_at"]), "last_error": _clean(c["last_error"], 200)}
            for c in creds
        ],
    }


# ---------------------------------------------------------------------------
# sverka (settings; digest.msgs chiqarilmaydi)
# ---------------------------------------------------------------------------
_HIST_DROP = frozenset({"chat", "chatid", "chat_id", "chats", "name", "botusername", "token"})
_RAQAM_ISM_RE = re.compile(r"-?\d+")


def _sverka_hist_details(action: Any, details: Any) -> Optional[str]:
    if not isinstance(details, dict):
        return None
    if str(action or "").lower().startswith("chat_"):
        return None
    safe = {k: v for k, v in details.items() if str(k).lower() not in _HIST_DROP}
    return _clean(json.dumps(safe, ensure_ascii=False, default=str), 150) if safe else None


def _collect_sverka() -> Dict[str, Any]:
    today = config.today_local().isoformat()
    with _fx() as cur:
        st = _settings(cur, ("sverka.telegram.notifiedToday", "sverka.telegram.history"))
        try:
            chats: Any = _int(_row(
                cur,
                "SELECT CASE WHEN jsonb_typeof(value::jsonb) = 'array' THEN jsonb_array_length(value::jsonb)"
                " ELSE 0 END AS n FROM settings WHERE key = %s",
                (KEY_SVERKA_CHATS,),
            ).get("n"))
        except Exception as exc:  # noqa: BLE001 - buzuq JSON
            chats = {"error": _err(exc)}
    store = _json(st["sverka.telegram.notifiedToday"]["v"])
    store = store if isinstance(store, dict) else {}
    sana = store.get("date") if isinstance(store.get("date"), str) else None
    bugungimi = sana == today
    farqlar: List[Dict[str, Any]] = []
    accs = store.get("accounts") if isinstance(store.get("accounts"), dict) else {}
    if bugungimi:
        for a in accs.values():
            if not isinstance(a, dict):
                continue
            farqlar.append({
                "bankName": _clean(a.get("bankName"), 60), "accountNo": _clean(a.get("accountNo"), 40),
                "ownerName": _clean(a.get("ownerName"), 80), "totalFarq": _pul(a.get("totalFarq")),
                "culprit": _clean(a.get("culprit"), 200), "confidence": _clean(a.get("confidence"), 20),
                "dismissed": bool(a.get("dismissed")),
            })
        farqlar.sort(key=lambda x: (x["dismissed"], -abs(float(x["totalFarq"] or 0))))
    tarix: List[Dict[str, Any]] = []
    hist = _json(st["sverka.telegram.history"]["v"])
    if isinstance(hist, list):
        for h in hist[:10]:
            if not isinstance(h, dict):
                continue
            actor = str(h.get("actorName") or "").strip()
            tarix.append({
                "vaqt": _iso_vaqt(h.get("timestamp")), "amal": _clean(h.get("action"), 40),
                "manba": _clean(h.get("source"), 40),
                "kim": "(chat)" if _RAQAM_ISM_RE.fullmatch(actor) else _clean(actor, 60),
                "tafsilot": _sverka_hist_details(h.get("action"), h.get("details")),
            })
    ochiq = sum(1 for f in farqlar if not f["dismissed"])
    return {
        "birlik": SOM,
        "bugun": today,
        "sana": sana,
        "bugungimi": bugungimi,
        "oxirgi_yangilanish": _vaqt(st["sverka.telegram.notifiedToday"]["u"]),
        "sverka_chatlari_soni": chats,
        "ochiq_farqlar": ochiq if bugungimi else None,
        "yopilganlar": (len(farqlar) - ochiq) if bugungimi else None,
        "farqlar": farqlar[:30],
        "tarix": tarix,
    }


# ---------------------------------------------------------------------------
# crm_sverka. snapshot value SELECT QILINMAYDI. TAQIQ: phone, raw_snapshot, customer_name
# ---------------------------------------------------------------------------
def _collect_crm_sverka() -> Dict[str, Any]:
    with _fx() as cur:
        st = _settings(cur, ["crmSverka.lastRun"])
        snap = _settings_bor(cur, ["crmSverka.snapshot"])["crmSverka.snapshot"]
        kesh = _row(
            cur,
            "SELECT COUNT(*) FILTER (WHERE found) AS topilgan, COUNT(*) FILTER (WHERE NOT found) AS topilmagan,"
            " MAX(last_verified_at) AS oxirgi_tekshiruv, COUNT(*) FILTER (WHERE branch_name IS NULL) AS branch_null"
            " FROM crm_contracts",
        )
    run = _json(st["crmSverka.lastRun"]["v"])
    oxirgi_run: Optional[Dict[str, Any]] = None
    if isinstance(run, dict):
        # run.warning/run.error -> ogohlantirish/xato: "error" kaliti Facts'da "bo'lim yiqildi" degani
        oxirgi_run = {
            "status": _clean(run.get("status"), 20), "startedAt": _iso_vaqt(run.get("startedAt")),
            "finishedAt": _iso_vaqt(run.get("finishedAt")), "crmCount": _int_n(run.get("crmCount")),
            "ourCount": _int_n(run.get("ourCount")), "ogohlantirish": _clean(run.get("warning"), 200),
            "xato": _clean(run.get("error"), 200), "actor": _kim(run.get("actor")),
        }
    return {
        "oxirgi_run": oxirgi_run,
        "snapshot_yangilangan": _vaqt(snap["u"]) if snap["bor"] else None,
        "crm_kesh": {
            "topilgan": _int(kesh.get("topilgan")), "topilmagan": _int(kesh.get("topilmagan")),
            "oxirgi_tekshiruv": _vaqt(kesh.get("oxirgi_tekshiruv")), "branch_name_null": _int(kesh.get("branch_null")),
        },
        "avtomat_jadval": "07:00, 12:00, 17:00 (Toshkent)",
    }


# ---------------------------------------------------------------------------
# xato (15 daqiqa kesh). TAQIQ: submitted_by_chat_id, snap_client, snap_purpose, attachment_*
# ---------------------------------------------------------------------------
_XATO_TX_WHERE = (
    " FROM transactions t JOIN categories c ON c.id = t.category_id AND c.code = 'CLIENT'"
    " WHERE t.is_contract_manual = false AND t.source NOT IN ('IMPORT','ALOQA_BANK')"
    " AND t.contract_number IS NOT NULL"
    " AND NOT EXISTS (SELECT 1 FROM crm_contracts cc WHERE cc.contract_number = t.contract_number AND cc.found)"
)
_XATO_OKV_WHERE = (
    " FROM oplata_kv o"
    " WHERE o.source_tx_id IS NOT NULL"
    " AND NOT EXISTS (SELECT 1 FROM crm_contracts cc WHERE cc.contract_number = o.contract_no AND cc.found)"
    " AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.xato_hidden"
    " AND (t.id = o.source_tx_id OR t.external_id = o.source_tx_id))"
)
_AI_KALITLAR = ("agent.aiEnabled", "agent.aiModel", "agent.aiIntervalMin", "agent.aiFromHour", "agent.aiToHour",
                "agent.aiName")


def _collect_xato() -> Dict[str, Any]:
    d0, d1 = _day_utc(config.today_local())
    with _fx() as cur:
        tx = _row(
            cur,
            "SELECT COUNT(*) FILTER (WHERE t.xato_hidden IS NOT TRUE) AS faol,"
            " COALESCE(SUM(t.amount) FILTER (WHERE t.xato_hidden IS NOT TRUE), 0) AS faol_summa,"
            " COUNT(*) FILTER (WHERE t.xato_hidden) AS yashirilgan" + _XATO_TX_WHERE,
        )
        top = _rows(
            cur,
            "SELECT t.contract_number AS shartnoma, COUNT(*) AS soni, COALESCE(SUM(t.amount), 0) AS summa,"
            " MAX(t.txn_date) AS oxirgi" + _XATO_TX_WHERE + " AND t.xato_hidden IS NOT TRUE"
            " GROUP BY t.contract_number ORDER BY summa DESC LIMIT 10",
        )
        st = _settings(cur, ("agent.dateFrom",) + _AI_KALITLAR)
        ai_key = _settings_bor(cur, ["agent.aiKey"])["agent.aiKey"]
        date_from = _sana_param(st["agent.dateFrom"]["v"])
        sql = ("SELECT COUNT(*) AS soni, COALESCE(SUM(o.payment_amount), 0) AS summa,"
               " COUNT(*) FILTER (WHERE o.agent_notified_at IS NULL")
        params: Dict[str, Any] = {}
        if date_from is not None:
            sql += " AND o.\"date\" >= %(dfrom)s"
            params["dfrom"] = date_from
        sql += ") AS yuborilmagan" + _XATO_OKV_WHERE
        okv = _row(cur, sql, params or None)
        ariza_gr = _rows(cur, "SELECT status, agent_state, COUNT(*) AS n FROM xato_correction_requests"
                              " GROUP BY status, agent_state")
        ariza = _row(
            cur,
            "SELECT COUNT(*) FILTER (WHERE submitted_at >= %(d0)s AND submitted_at < %(d1)s) AS bugun_yuborilgan,"
            " COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_by_type = 'agent') AS agent_jami,"
            " COUNT(*) FILTER (WHERE status = 'approved' AND reviewed_by_type = 'agent'"
            " AND reviewed_at >= %(d0)s AND reviewed_at < %(d1)s) AS agent_bugun,"
            " MIN(submitted_at) FILTER (WHERE status = 'pending') AS eng_eski"
            " FROM xato_correction_requests",
            {"d0": d0, "d1": d1},
        )
        korildi = _rows(
            cur,
            "SELECT status, reviewed_by_type, COUNT(*) AS n FROM xato_correction_requests"
            " WHERE reviewed_at >= %(d0)s AND reviewed_at < %(d1)s GROUP BY status, reviewed_by_type",
            {"d0": d0, "d1": d1},
        )
        namunalar = _rows(
            cur,
            "SELECT submitted_at, submitted_by_name, source, proposed_contract_no, snap_contract_no, snap_amount,"
            " snap_object, agent_state, agent_reason FROM xato_correction_requests WHERE status = 'pending'"
            " ORDER BY submitted_at DESC LIMIT 5",
        )
    holat: Dict[str, int] = {}
    agent_holati: Dict[str, int] = {}
    kutayotgan_agent: Dict[str, int] = {}
    for g in ariza_gr:
        n = _int(g["n"])
        holat[str(g["status"])] = holat.get(str(g["status"]), 0) + n
        a = str(g["agent_state"] or "yo'q")
        agent_holati[a] = agent_holati.get(a, 0) + n
        if g["status"] == "pending":
            kutayotgan_agent[a] = kutayotgan_agent.get(a, 0) + n
    return {
        "birlik": SOM,
        "tranzaksiya_tomoni": {
            "faol": _int(tx.get("faol")), "faol_summa": _pul(tx.get("faol_summa")),
            "yashirilgan": _int(tx.get("yashirilgan")),
            "top_shartnomalar": [
                {"shartnoma": _clean(r["shartnoma"], 60), "soni": _int(r["soni"]), "summa": _pul(r["summa"]),
                 "oxirgi": _vaqt(r["oxirgi"])}
                for r in top
            ],
        },
        "oplatykv_tomoni": {
            "soni": _int(okv.get("soni")), "summa": _pul(okv.get("summa")),
            "guruhga_yuborilmagan": _int(okv.get("yuborilmagan")),
            "agent_dateFrom": date_from.isoformat() if date_from else None,
        },
        "arizalar": {
            "holat": holat,
            "agent_holati": agent_holati,
            "kutayotganlar_agent_holati": kutayotgan_agent,
            "bugun_yuborilgan": _int(ariza.get("bugun_yuborilgan")),
            "bugun_korildi": {"%s/%s" % (r["status"], r["reviewed_by_type"] or "?"): _int(r["n"]) for r in korildi},
            "agent_hal_qilgan": {"jami": _int(ariza.get("agent_jami")), "bugun": _int(ariza.get("agent_bugun"))},
            "eng_eski_kutayotgan": _vaqt(ariza.get("eng_eski")),
            "namunalar": [
                {"yuborilgan": _vaqt(r["submitted_at"]), "kim": _clean(r["submitted_by_name"], 60),
                 "manba": _clean(r["source"], 16), "taklif_shartnoma": _clean(r["proposed_contract_no"], 60),
                 "asl_shartnoma": _clean(r["snap_contract_no"], 60), "summa": _pul_n(r["snap_amount"]),
                 "obyekt": _clean(r["snap_object"], 60), "agent_holati": r["agent_state"],
                 "agent_izohi": _clean(r["agent_reason"], 150)}
                for r in namunalar
            ],
        },
        "ai_agent": {
            "aiEnabled": _flag_1(st["agent.aiEnabled"]["v"]),
            "aiModel": _sv(st, "agent.aiModel", 60),
            "aiIntervalMin": _int_n(_sv(st, "agent.aiIntervalMin", 10)),
            "aiFromHour": _int_n(_sv(st, "agent.aiFromHour", 10)),
            "aiToHour": _int_n(_sv(st, "agent.aiToHour", 10)),
            "aiName": _sv(st, "agent.aiName", 60),
            "ai_kalit_bor": ai_key["bor"],
        },
    }


# ---------------------------------------------------------------------------
# oplatykv_sync (15 daqiqa kesh)
# ---------------------------------------------------------------------------
_OKV_SOZLAMALAR = ("oplatykv.txAutoSyncMinutes", "oplatykv.txMinDate", "oplatykv.dayStart", "oplatykv.dayEnd",
                   "oplatykv.nightStart", "oplatykv.nightEnd")
_OKV_XATOLAR_KALIT = "oplatykv.syncXatolar"      # backend syncFromTransactions yozadi (2026-10-07)
_TX_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+\-]{2,199}$")


def _okv_sync_xatolar(qiymat: Any) -> Optional[Dict[str, Any]]:
    """settings 'oplatykv.syncXatolar' (JSON): oxirgi sync yoza olmagan to'lovlar sabab bilan. Yo'q/buzuq -> None."""
    try:
        d = json.loads(qiymat) if isinstance(qiymat, str) and qiymat.strip() else None
    except ValueError:
        return None
    if not isinstance(d, dict) or not _int(d.get("soni")):
        return None
    vaqt = None
    try:
        vaqt = config.fmt_local(datetime.fromisoformat(str(d.get("vaqt")).replace("Z", "+00:00")))
    except ValueError:
        vaqt = None
    namunalar = []
    for x in (d.get("namunalar") or [])[:10]:
        if not isinstance(x, dict):
            continue
        tx = str(x.get("tx") or "")
        namunalar.append({"tx": tx if _TX_ID_RE.match(tx) else _clean(tx, 80), "shartnoma": _clean(x.get("shartnoma"), 60),
                          "sabab": _clean(x.get("sabab"), 200)})
    return {"vaqt": vaqt, "kim": _clean(d.get("actor"), 60), "soni": _int(d.get("soni")), "namunalar": namunalar}


def _collect_oplatykv_sync() -> Dict[str, Any]:
    now = config.now_utc()
    today = config.today_local()
    d3 = config.naive_utc(now - timedelta(days=3))
    a3, _ = _day_utc(today - timedelta(days=2))
    _, b3 = _day_utc(today)
    with _fx() as cur:
        st = _settings(cur, _OKV_SOZLAMALAR)
        min_d = _sana_param(st["oplatykv.txMinDate"]["v"])
        sql = ("SELECT COUNT(*) AS soni, COALESCE(SUM(t.amount), 0) AS summa, MIN(t.txn_date) AS eng_eski,"
               " COUNT(*) FILTER (WHERE t.direction = 'IN') AS kirim_soni,"
               " COUNT(*) FILTER (WHERE t.direction = 'OUT') AS chiqim_soni"
               " FROM transactions t JOIN categories c ON c.id = t.category_id AND c.code = 'CLIENT'"
               " WHERE t.contract_number IS NOT NULL AND t.txn_date >= %(a)s AND t.txn_date < %(b)s")
        params: Dict[str, Any] = {"a": a3, "b": b3}
        if min_d is not None:
            # txMinDate kuni 23:59:59 Toshkent (syncFromTransactions bilan bir xil)
            params["min"] = config.naive_utc(config.local_day_bounds_utc(min_d)[1] - timedelta(milliseconds=1))
            sql += " AND t.txn_date > %(min)s"
        sql += " AND NOT EXISTS (SELECT 1 FROM oplata_kv o WHERE o.source_tx_id = COALESCE(t.external_id, t.id))"
        tushmagan = _row(cur, sql, params)
        cron = _row(cur, _SQL_CRON_QATOR, (P_CRON, d3, d3))
        yetim = _row(
            cur,
            "SELECT COUNT(*) AS soni, COALESCE(SUM(o.payment_amount), 0) AS summa FROM oplata_kv o"
            " WHERE o.source_tx_id IS NOT NULL AND o.\"date\" >= %s"
            " AND NOT EXISTS (SELECT 1 FROM transactions t"
            " WHERE t.external_id = o.source_tx_id OR t.id = o.source_tx_id)",
            (today - timedelta(days=30),),
        )
        kelajak = _row(cur, "SELECT COUNT(*) AS n FROM oplata_kv WHERE updated_at > %s", (config.naive_utc(now),))
        xatolar = _row(cur, "SELECT value FROM settings WHERE key = %s", (_OKV_XATOLAR_KALIT,))
    return {
        "birlik": SOM,
        "tushmagan": {
            "dan": (today - timedelta(days=2)).isoformat(), "gacha": today.isoformat(),
            "soni": _int(tushmagan.get("soni")), "summa": _pul(tushmagan.get("summa")),
            "eng_eski": _vaqt(tushmagan.get("eng_eski")), "kirim_soni": _int(tushmagan.get("kirim_soni")),
            "chiqim_soni": _int(tushmagan.get("chiqim_soni")),
            "txMinDate_chegara": min_d.isoformat() if min_d else None,
        },
        "oxirgi_cron_qator": _vaqt(cron.get("ts")),  # null = oxirgi 3 kunda avto-sync qator yaratmagan
        "oxirgi_cron_qator_oyna_kun": 3,
        "yetim": {"oxirgi_kun": 30, "soni": _int(yetim.get("soni")), "summa": _pul(yetim.get("summa"))},
        "kelajak_updated_at": _int(kelajak.get("n")),
        "sync_xatolar": _okv_sync_xatolar(xatolar.get("value")),   # null = oxirgi sync hammasini yozgan
        "sozlamalar": {k: _sv(st, k, 30) for k in _OKV_SOZLAMALAR},
    }


# ---------------------------------------------------------------------------
# bank_changes (transaction_change_logs, 7 kun). TAQIQ: old_data, new_data
# ---------------------------------------------------------------------------
def _collect_bank_changes() -> Dict[str, Any]:
    today = config.today_local()
    a7, _ = _day_utc(today - timedelta(days=6))
    t0, t1 = _day_utc(today)
    with _fx() as cur:
        hafta = _rows(
            cur,
            "SELECT change_type::text AS tur, COUNT(*) AS soni, COALESCE(SUM(amount), 0) AS summa"
            " FROM transaction_change_logs WHERE detected_at >= %(a)s AND detected_at < %(b)s GROUP BY 1 ORDER BY 1",
            {"a": a7, "b": t1},
        )
        bugun = _rows(
            cur,
            "SELECT change_type::text AS tur, COUNT(*) AS soni, COALESCE(SUM(amount), 0) AS summa"
            " FROM transaction_change_logs WHERE detected_at >= %(a)s AND detected_at < %(b)s GROUP BY 1 ORDER BY 1",
            {"a": t0, "b": t1},
        )
        oxirgi = _rows(
            cur,
            "SELECT change_type::text AS tur, detected_at, txn_date, amount, direction::text AS dir, contract_number,"
            " account_no_snap, bank_name_snap, fields_changed, detected_by, note"
            " FROM transaction_change_logs WHERE detected_at >= %(a)s AND detected_at < %(b)s"
            " ORDER BY detected_at DESC LIMIT 15",
            {"a": a7, "b": t1},
        )

    def kesim(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"tur": r["tur"], "soni": _int(r["soni"]), "summa": _pul(r["summa"])} for r in rows]

    return {
        "birlik": SOM,
        "davr": {"dan": (today - timedelta(days=6)).isoformat(), "gacha": today.isoformat()},
        "kesim_7_kun": kesim(hafta),
        "bugun": kesim(bugun),
        "oxirgi": [
            {"tur": r["tur"], "aniqlangan": _vaqt(r["detected_at"]), "tx_vaqti": _vaqt(r["txn_date"]),
             "summa": _pul_n(r["amount"]), "yonalish": r["dir"], "shartnoma": _clean(r["contract_number"], 60),
             "hisob": _clean(r["account_no_snap"], 40), "bank": _clean(r["bank_name_snap"], 60),
             "ozgargan_maydonlar": [_clean(x, 40) for x in (r["fields_changed"] or [])[:10]],
             "kim": _kim(r["detected_by"]), "izoh_matn": _clean(r["note"], 150)}
            for r in oxirgi
        ],
    }


# ---------------------------------------------------------------------------
# xonpay. TAQIQ: full_name, purpose, crm_uuid
# ---------------------------------------------------------------------------
def _collect_xonpay() -> Dict[str, Any]:
    today = config.today_local()
    with _fx() as cur:
        st = _settings(cur, ("xonpay.cron.enabled", "xonpay.cron.intervalMinutes"))
        logs = _rows(
            cur,
            "SELECT \"trigger\" AS trig, status, fetched, inserted, updated, matched, errors, error_message,"
            " started_at, finished_at, duration_ms,"
            " (status = 'failed' AND COALESCE(error_message, '') ILIKE %s) AS orfan"
            " FROM xonpay_sync_logs ORDER BY started_at DESC LIMIT 5",
            (P_RESTART,),
        )
        ok = _row(cur, "SELECT MAX(COALESCE(finished_at, started_at)) AS ts FROM xonpay_sync_logs"
                       " WHERE status = 'success'")
        mos7 = _row(
            cur,
            "SELECT COUNT(*) AS soni, COALESCE(SUM(amount), 0) AS summa FROM xonpay_transactions"
            " WHERE is_matched = false AND date_paid BETWEEN %s AND %s",
            (today - timedelta(days=6), today),
        )
        bugun = _row(
            cur,
            "SELECT COUNT(*) AS soni, COALESCE(SUM(amount), 0) AS summa,"
            " COUNT(*) FILTER (WHERE is_matched) AS moslangan"
            " FROM xonpay_transactions WHERE date_paid = %s",
            (today,),
        )
    raw_en = st["xonpay.cron.enabled"]["v"]
    iv = _int_n(_sv(st, "xonpay.cron.intervalMinutes", 10))
    return {
        "birlik": SOM,
        "sozlamalar": {"xonpay.cron.enabled": _clean(raw_en, 10),
                       "xonpay.cron.intervalMinutes": _sv(st, "xonpay.cron.intervalMinutes", 10)},
        "cron_yoqilgan": str(raw_en).strip().lower() != "false" if raw_en is not None else True,
        "interval_daq": iv if iv is not None and 1 <= iv <= 1440 else 60,
        "oxirgi_synclar": [
            {"trigger": r["trig"], "status": r["status"], "orfan": bool(r["orfan"]), "fetched": _int(r["fetched"]),
             "inserted": _int(r["inserted"]), "updated": _int(r["updated"]), "matched": _int(r["matched"]),
             "errors": _int(r["errors"]), "xato": _clean(r["error_message"], 200), "boshlangan": _vaqt(r["started_at"]),
             "tugagan": _vaqt(r["finished_at"]), "davomiylik_ms": _int_n(r["duration_ms"])}
            for r in logs
        ],
        "oxirgi_muvaffaqiyatli": _vaqt(ok.get("ts")),
        "moslanmagan_7kun": {"dan": (today - timedelta(days=6)).isoformat(), "gacha": today.isoformat(),
                             "soni": _int(mos7.get("soni")), "summa": _pul(mos7.get("summa"))},
        "bugun": {"sana": today.isoformat(), "soni": _int(bugun.get("soni")), "summa": _pul(bugun.get("summa")),
                  "moslangan": _int(bugun.get("moslangan"))},
    }


# ---------------------------------------------------------------------------
# google_export. TAQIQ: settings export.credentials, export.sheets, export.writtenIds.*, export.upsertKeys.*
# ---------------------------------------------------------------------------
def _eksport_run(r: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "status": r["status"], "mode": r["mode"], "rows_fetched": _int(r["rows_fetched"]),
        "rows_written": _int(r["rows_written"]), "davomiylik_ms": _int(r["duration_ms"]),
        "xato": _clean(r["error"], 200), "kim": _kim(r["triggered_by"]), "vaqt": _vaqt(r["started_at"]),
    }


def _collect_google_export() -> Dict[str, Any]:
    since = config.naive_utc(config.now_utc() - timedelta(days=30))
    with _fx() as cur:
        rows = _rows(
            cur,
            "SELECT sheet_id, sheet_name, source, write_mode, mode, status, rows_fetched, rows_written, duration_ms,"
            " error, triggered_by, started_at, rn FROM ("
            " SELECT sheet_id, sheet_name, source, write_mode, mode, status, rows_fetched, rows_written, duration_ms,"
            " error, triggered_by, started_at,"
            " ROW_NUMBER() OVER (PARTITION BY sheet_id ORDER BY started_at DESC) AS rn"
            " FROM export_cron_logs WHERE started_at >= %s"
            ") x WHERE rn <= 2 ORDER BY sheet_id, rn",
            (since,),
        )
    by_sheet: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        by_sheet.setdefault(str(r["sheet_id"]), []).append(r)
    sheetlar: List[Dict[str, Any]] = []
    for runs in by_sheet.values():
        last = runs[0]
        prev = runs[1] if len(runs) > 1 else None
        sheetlar.append({
            "sheet_name": _clean(last["sheet_name"], 80), "manba": _clean(last["source"], 20),
            "write_mode": _clean(last["write_mode"], 20), "oxirgi": _eksport_run(last),
            "oldingi": _eksport_run(prev) if prev else None,
            "ketma_ket_2_xato": bool(prev is not None and last["status"] == "error" and prev["status"] == "error"),
        })
    sheetlar.sort(key=lambda s: str(s["oxirgi"]["vaqt"] or ""), reverse=True)
    out: Dict[str, Any] = {"davr_kun": 30, "sheetlar": sheetlar}
    if not sheetlar:
        out["eslatma"] = "30 kunda export_cron_logs yozuvi yo'q"
    return out


# ---------------------------------------------------------------------------
# api_usage (24 soat). TAQIQ: key_id, secret_*, last_used_ip, allowed_ips, ip, user_agent, query
# ---------------------------------------------------------------------------
def _collect_api_usage() -> Dict[str, Any]:
    now = config.now_utc()
    since = config.naive_utc(now - timedelta(hours=24))
    with _fx() as cur:
        agg = _row(
            cur,
            "SELECT COUNT(*) AS jami, AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms,"
            " COUNT(DISTINCT ip) AS ip_soni FROM api_request_logs WHERE created_at >= %s",
            (since,),
        )
        sinflar = _rows(cur, "SELECT (status_code / 100) AS sinf, COUNT(*) AS n FROM api_request_logs"
                             " WHERE created_at >= %s GROUP BY 1 ORDER BY 1", (since,))
        top = _rows(cur, "SELECT path, COUNT(*) AS n FROM api_request_logs WHERE created_at >= %s"
                         " GROUP BY path ORDER BY n DESC LIMIT 10", (since,))
        by_key = _rows(
            cur,
            "SELECT k.name AS nomi, (l.api_key_id IS NULL) AS kalitsiz, COUNT(*) AS n"
            " FROM api_request_logs l LEFT JOIN api_keys k ON k.id = l.api_key_id"
            " WHERE l.created_at >= %s GROUP BY l.api_key_id, k.name ORDER BY n DESC LIMIT 15",
            (since,),
        )
        err5 = _rows(
            cur,
            "SELECT created_at, method, path, status_code, error_message FROM api_request_logs"
            " WHERE created_at >= %s AND status_code >= 500 ORDER BY created_at DESC LIMIT 5",
            (since,),
        )
        keys = _rows(
            cur,
            "SELECT name, scopes, is_active, expires_at, revoked_at, last_used_at, total_requests FROM api_keys"
            " ORDER BY created_at DESC LIMIT 20",
        )
    now_naive = config.naive_utc(now)
    return {
        "oyna": {"soat": 24, "dan": config.fmt_local(now - timedelta(hours=24))},
        "jami": _int(agg.get("jami")),
        "ortacha_ms": _int_n(agg.get("avg_ms")),
        "maks_ms": _int_n(agg.get("max_ms")),
        "noyob_ip_soni": _int(agg.get("ip_soni")),
        "status_sinflari": {"%sxx" % _int(r["sinf"]): _int(r["n"]) for r in sinflar},
        "top_yollar": [{"yol": _clean(r["path"], 120), "soni": _int(r["n"])} for r in top],
        "kalit_boyicha": [
            {"kalit": "(kalitsiz)" if r["kalitsiz"] else (_clean(r["nomi"], 80) or "(o'chirilgan kalit)"),
             "soni": _int(r["n"])}
            for r in by_key
        ],
        "oxirgi_5xx": [
            {"vaqt": _vaqt(r["created_at"]), "method": r["method"], "yol": _clean(r["path"], 120),
             "status": _int(r["status_code"]), "xato": _clean(r["error_message"], 150)}
            for r in err5
        ],
        "kalitlar": [
            {"nomi": _clean(k["name"], 80), "scopes": [_clean(s, 40) for s in (k["scopes"] or [])[:10]],
             "is_active": bool(k["is_active"]), "expires_at": _vaqt(k["expires_at"]),
             "muddati_otgan": bool(k["expires_at"] is not None and k["expires_at"] < now_naive),
             "revoked_at": _vaqt(k["revoked_at"]), "last_used_at": _vaqt(k["last_used_at"]),
             "total_requests": _int(k["total_requests"])}
            for k in keys
        ],
    }


# ---------------------------------------------------------------------------
# telegram_notify. Token qiymati, guruh ID, webhook siri, parol, chek.tg.config mazmuni O'QILMAYDI.
# ---------------------------------------------------------------------------
_TG_QIYMAT = ("agent.enabled", "agent.dailyTime", "agent.dateFrom", "agent.lastResult", "corrbot.enabled",
              "chekorder.tg.enabled", "autsourcing.cronEnabled", "autsourcing.cronTime", "shmitd.enabled",
              "shmitd.cronTimes", "shmitd.dateOffset", "sverka.telegram.notifiedToday")
_TG_BOR = ("agent.botToken", "sverka.telegram.botToken", "corrbot.botToken", "chekorder.tg.botToken",
           "shmitd.botToken", "autsourcing.botToken", "chek.tg.config")


def _collect_telegram_notify() -> Dict[str, Any]:
    with _fx() as cur:
        st = _settings(cur, _TG_QIYMAT)
        bor = _settings_bor(cur, _TG_BOR)
        evening = _kechki_eslatma(cur)
        try:
            rollar: Any = {
                str(r["rol"]): _int(r["n"])
                for r in _rows(
                    cur,
                    "SELECT COALESCE(e.elem->>'role', '?') AS rol, COUNT(*) AS n"
                    " FROM (SELECT value FROM settings WHERE key = %s) s"
                    " CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.value::jsonb) = 'array'"
                    " THEN s.value::jsonb ELSE '[]'::jsonb END) AS e(elem)"
                    " GROUP BY 1 ORDER BY 1",
                    (KEY_SVERKA_CHATS,),
                )
            }
        except Exception as exc:  # noqa: BLE001 - buzuq JSON
            rollar = {"error": _err(exc)}
        chek = _row(cur, "SELECT COUNT(*) FILTER (WHERE tg_send = false) AS yuborilmagan,"
                         " MAX(tg_sent_at) AS oxirgi FROM chek_dog")
        shmitd_logs = _rows(
            cur,
            "SELECT target_date, sent_at, status, total_count, yellow_count, red_count, error, triggered_by"
            " FROM shmitd_logs ORDER BY sent_at DESC LIMIT 5",
        )
    lr = st["agent.lastResult"]["v"] or ""
    lr_vaqt, _, lr_matn = lr.partition(_LR_AJRATGICH)
    agent_natija = {"vaqt": _iso_vaqt(lr_vaqt), "matn": _clean(lr_matn, 250)} if lr_matn else \
        {"vaqt": None, "matn": _clean(lr, 250) or None}
    notified = _json(st["sverka.telegram.notifiedToday"]["v"])
    notified_sana = notified.get("date") if isinstance(notified, dict) and isinstance(notified.get("date"), str) \
        else None
    kechki: Dict[str, Any] = {"turibdi": evening["soni"] > 0, "xabar_soni": evening["soni"],
                              "sana": evening["sana"], "bugungi": evening["sana"] == config.today_local().isoformat(),
                              "yangilangan": _vaqt(evening["u"])}
    if evening.get("error"):
        kechki["error"] = evening["error"]
    botlar = [
        {"nomi": "xato_notifikator", "yoqilgan": _flag_1(st["agent.enabled"]["v"]),
         "token_bor": bor["agent.botToken"]["bor"], "kunlik_vaqt": _sv(st, "agent.dailyTime", 10) or "09:00",
         "dateFrom": _sv(st, "agent.dateFrom", 20), "oxirgi_natija": agent_natija},
        {"nomi": "sverka_bot", "token_bor": bor["sverka.telegram.botToken"]["bor"],
         "chatlar_rol_boyicha": rollar, "notifiedToday_sana": _clean(notified_sana, 20),
         "notifiedToday_yangilangan": _vaqt(st["sverka.telegram.notifiedToday"]["u"]),
         "kechki_eslatma": kechki},
        {"nomi": "tuzatish_boti", "yoqilgan": _flag_1(st["corrbot.enabled"]["v"]),
         "token_bor": bor["corrbot.botToken"]["bor"]},
        {"nomi": "chek_order_bot", "yoqilgan": _flag_1_true(st["chekorder.tg.enabled"]["v"]),
         "token_bor": bor["chekorder.tg.botToken"]["bor"]},
        {"nomi": "chek_dog", "config_bor": bor["chek.tg.config"]["bor"],
         "yuborilmagan": _int(chek.get("yuborilmagan")), "oxirgi_yuborilgan": _vaqt(chek.get("oxirgi"))},
        {"nomi": "autsourcing", "yoqilgan": _flag_1(st["autsourcing.cronEnabled"]["v"]),
         "cron_vaqt": _sv(st, "autsourcing.cronTime", 10), "token_bor": bor["autsourcing.botToken"]["bor"]},
        {"nomi": "shmitd", "yoqilgan": _flag_1(st["shmitd.enabled"]["v"]), "token_bor": bor["shmitd.botToken"]["bor"],
         "cron_vaqtlar": _sv(st, "shmitd.cronTimes", 60), "dateOffset": _sv(st, "shmitd.dateOffset", 10),
         "oxirgi_loglar": [
             {"hisobot_sanasi": _clean(r["target_date"], 20), "yuborilgan": _vaqt(r["sent_at"]), "status": r["status"],
              "total_count": _int(r["total_count"]), "yellow_count": _int(r["yellow_count"]),
              "red_count": _int(r["red_count"]), "xato": _clean(r["error"], 200), "kim": _kim(r["triggered_by"])}
             for r in shmitd_logs
         ]},
    ]
    return {"botlar": botlar}


# ---------------------------------------------------------------------------
# counterparties. TAQIQ: director_pinfl, director, phone, email, address, founders, bank_accounts, raw_didox_brief
# ---------------------------------------------------------------------------
_CP_SOZLAMALAR = ("counterparties.autoRefreshEnabled", "counterparties.xontaminot.autoSync",
                  "counterparties.xontaminot.intervalMin", "counterparties.xontaminot.startHour",
                  "counterparties.xontaminot.endHour", "counterparties.xontaminot.lastSyncAt",
                  "counterparties.xontaminot.lastSyncStats")


def _collect_counterparties() -> Dict[str, Any]:
    with _fx() as cur:
        agg = _row(
            cur,
            "SELECT COUNT(*) AS faol, COUNT(*) FILTER (WHERE last_fetch_error IS NOT NULL) AS xatoli,"
            " MAX(last_fetched_at) AS oxirgi FROM counterparties WHERE is_active",
        )
        namuna = _rows(
            cur,
            "SELECT name, last_fetch_error, last_fetched_at FROM counterparties"
            " WHERE is_active AND last_fetch_error IS NOT NULL ORDER BY last_fetched_at DESC NULLS LAST LIMIT 5",
        )
        st = _settings(cur, _CP_SOZLAMALAR)
    return {
        "faol": _int(agg.get("faol")),
        "yangilanish_xatoli": _int(agg.get("xatoli")),
        "oxirgi_yangilangan": _vaqt(agg.get("oxirgi")),
        "xato_namunalar": [
            {"nomi": _clean(r["name"], 80), "xato": _clean(r["last_fetch_error"], 150),
             "vaqt": _vaqt(r["last_fetched_at"])}
            for r in namuna
        ],
        "sozlamalar": {
            "autoRefreshEnabled": _sv(st, "counterparties.autoRefreshEnabled", 10),
            "xontaminot.autoSync": _sv(st, "counterparties.xontaminot.autoSync", 10),
            "xontaminot.intervalMin": _sv(st, "counterparties.xontaminot.intervalMin", 10),
            "xontaminot.startHour": _sv(st, "counterparties.xontaminot.startHour", 10),
            "xontaminot.endHour": _sv(st, "counterparties.xontaminot.endHour", 10),
        },
        "xontaminot_oxirgi_sync": _iso_vaqt(st["counterparties.xontaminot.lastSyncAt"]["v"]),
        "xontaminot_natija": _clean(st["counterparties.xontaminot.lastSyncStats"]["v"], 300),
    }


# ---------------------------------------------------------------------------
# panel_activity (audit_logs, 24 soat). TAQIQ: ip, meta, user_email, path (chiqishda), email, password_hash
# ---------------------------------------------------------------------------
def _collect_panel_activity() -> Dict[str, Any]:
    now = config.now_utc()
    s24 = config.naive_utc(now - timedelta(hours=24))
    s15 = config.naive_utc(now - timedelta(minutes=15))
    with _fx() as cur:
        jami = _row(cur, "SELECT COUNT(*) AS n FROM audit_logs WHERE created_at >= %s", (s24,))
        by_user = _rows(cur, "SELECT user_name, COUNT(*) AS n FROM audit_logs WHERE created_at >= %s"
                             " AND user_name IS NOT NULL GROUP BY user_name ORDER BY n DESC LIMIT 10", (s24,))
        by_mod = _rows(cur, "SELECT module, COUNT(*) AS n FROM audit_logs WHERE created_at >= %s"
                            " GROUP BY module ORDER BY n DESC LIMIT 10", (s24,))
        fail = _row(
            cur,
            "SELECT COUNT(*) AS n24, COUNT(*) FILTER (WHERE created_at >= %(s15)s) AS n15 FROM audit_logs"
            " WHERE created_at >= %(s24)s AND module = 'auth' AND success = false AND path LIKE %(login)s",
            {"s15": s15, "s24": s24, "login": P_LOGIN},
        )
        last = _rows(
            cur,
            "SELECT created_at, user_name, module, action, method, status_code, success FROM audit_logs"
            " WHERE created_at >= %s ORDER BY created_at DESC LIMIT 20",
            (s24,),
        )
        users = _rows(
            cur,
            "SELECT a.full_name, COALESCE(r.name, a.role::text) AS rol, a.is_active, a.last_login_at"
            " FROM admin_users a LEFT JOIN roles r ON r.id = a.role_id"
            " ORDER BY a.last_login_at DESC NULLS LAST LIMIT 10",
        )
        counts = _rows(cur, "SELECT is_active, COUNT(*) AS n FROM admin_users GROUP BY is_active")
    return {
        "oyna": {"soat": 24, "dan": config.fmt_local(now - timedelta(hours=24))},
        "jami_amallar": _int(jami.get("n")),
        "muvaffaqiyatsiz_kirish": {"soat_24": _int(fail.get("n24")), "daqiqa_15": _int(fail.get("n15"))},
        "foydalanuvchi_boyicha": [{"kim": _clean(r["user_name"], 60), "soni": _int(r["n"])} for r in by_user],
        "modul_boyicha": [{"modul": _clean(r["module"], 40), "soni": _int(r["n"])} for r in by_mod],
        "oxirgi_amallar": [
            {"vaqt": _vaqt(r["created_at"]), "kim": _clean(r["user_name"], 60) or "(ism yo'q)",
             "modul": _clean(r["module"], 40), "amal": _clean(r["action"], 120), "method": r["method"],
             "status": _int_n(r["status_code"]), "muvaffaqiyatli": bool(r["success"])}
            for r in last
        ],
        "oxirgi_kirganlar": [
            {"kim": _clean(u["full_name"], 60) or "(ism yo'q)", "rol": _clean(u["rol"], 40),
             "faol": bool(u["is_active"]), "oxirgi_kirish": _vaqt(u["last_login_at"])}
            for u in users
        ],
        "foydalanuvchilar_soni": {("faol" if r["is_active"] else "nofaol"): _int(r["n"]) for r in counts},
    }


# ---------------------------------------------------------------------------
# Yig'ish
# ---------------------------------------------------------------------------
_UMUMIY_COLLECTORS: Dict[str, Callable[[], Any]] = {
    "system": _collect_system,
    "schedulers": _collect_schedulers,
    "deploy": _collect_deploy,
    "agent_tasks": _collect_agent_tasks,
}
_LOYIHA_COLLECTORS: Dict[str, Callable[[], Dict[str, Any]]] = {
    "client_income": _collect_client_income,
    "bank_flow": _collect_bank_flow,
    "balances": _collect_balances,
    "bank_sync": _collect_bank_sync,
    "hamkorbank": _collect_hamkorbank,
    "sverka": _collect_sverka,
    "crm_sverka": _collect_crm_sverka,
    "xato": _collect_xato,
    "oplatykv_sync": _collect_oplatykv_sync,
    "bank_changes": _collect_bank_changes,
    "xonpay": _collect_xonpay,
    "google_export": _collect_google_export,
    "api_usage": _collect_api_usage,
    "telegram_notify": _collect_telegram_notify,
    "counterparties": _collect_counterparties,
    "panel_activity": _collect_panel_activity,
}


def build_facts() -> dict:
    """Tartib: updated_at, system, schedulers, deploy, agent_tasks, 16 loyiha kaliti (C.FACTS_LOYIHA_KALITLARI)."""
    t0 = time.monotonic()
    facts: Dict[str, Any] = {"updated_at": None}  # birinchi kalit; qiymati oxirida qo'yiladi
    for name in C.FACTS_UMUMIY_KALITLAR:
        if name == "updated_at":
            continue
        fn = _UMUMIY_COLLECTORS.get(name)
        facts[name] = _safe(name, fn) if fn else {"error": "collector yo'q"}
    for kalit in C.FACTS_LOYIHA_KALITLARI:
        fn = _LOYIHA_COLLECTORS.get(kalit)
        if fn is None:
            val: Any = {"error": "collector yo'q"}
        elif kalit in C.FACTS_KESH_15_DAQ:
            val = _safe(kalit, lambda k=kalit, f=fn: _cached(k, f))
        else:
            val = _safe(kalit, fn)
        facts[kalit] = _with_izoh(kalit, val)
    facts["updated_at"] = config.to_local(config.now_utc()).isoformat(timespec="seconds")
    xato = [k for k, v in facts.items() if isinstance(v, dict) and "error" in v]
    log.info("facts yig'ildi: %d ms%s", int((time.monotonic() - t0) * 1000),
             (", xato bo'limlar: " + ", ".join(xato)) if xato else "")
    return facts


# ---------------------------------------------------------------------------
# Yozish: valid JSON, bir yozuv = bir qator
# ---------------------------------------------------------------------------
def _json_default(o: Any) -> Any:
    if isinstance(o, Decimal):
        return _pul(o)
    if isinstance(o, datetime):
        return config.fmt_local(o)
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, (set, frozenset)):
        return list(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        return None
    return str(o)


def _compact(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(", ", ": "), default=_json_default)


def _is_scalar(v: Any) -> bool:
    return not isinstance(v, (dict, list, tuple))


def _inline_ok(d: Dict[str, Any]) -> bool:
    """Tekis dict (bitta yozuv) yoki qisqa ichma-ich dict bitta qatorda."""
    return all(_is_scalar(x) for x in d.values()) or len(_compact(d)) <= INLINE_MAX


def _render(v: Any, indent: int, force: bool = False) -> List[str]:
    pad_in = "  " * (indent + 1)
    if isinstance(v, dict) and v and (force or not _inline_ok(v)):
        keys = list(v.keys())
        lines = ["{"]
        for i, k in enumerate(keys):
            sub = _render(v[k], indent + 1)
            sub[0] = pad_in + json.dumps(str(k), ensure_ascii=False) + ": " + sub[0]
            if i < len(keys) - 1:
                sub[-1] += ","
            lines.extend(sub)
        lines.append("  " * indent + "}")
        return lines
    if isinstance(v, (list, tuple)) and v and not all(_is_scalar(x) for x in v):
        lines = ["["]
        for i, x in enumerate(v):  # ro'yxat elementi (yozuv) doim bitta qatorda
            lines.append(pad_in + _compact(x) + ("," if i < len(v) - 1 else ""))
        lines.append("  " * indent + "]")
        return lines
    return [_compact(v)]


def _dump_grep_friendly(facts: dict) -> str:
    """Valid JSON, bir yozuv = bir qator: Grep yozuvni butunicha beradi, keyin Read offset/limit."""
    return "\n".join(_render(facts, 0, force=True)) + "\n"


def save_facts(facts: dict, path: Optional[Path] = None) -> Path:
    """Atomik yozish: shu papkada .tmp + os.replace. Agent foydalanuvchisi o'qiy olishi uchun 0644."""
    target = Path(path) if path else config.FACTS_PATH
    os.makedirs(target.parent, exist_ok=True)
    text = _dump_grep_friendly(facts)
    try:
        json.loads(text)
    except ValueError as exc:  # bo'lmasligi kerak; ehtiyot uchun oddiy format
        log.error("facts dump buzuq JSON berdi, oddiy formatga o'tildi: %s", exc)
        text = json.dumps(facts, ensure_ascii=False, indent=1, default=_json_default) + "\n"
    tmp = target.with_name("%s.%d.tmp" % (target.name, os.getpid()))
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.chmod(tmp, 0o644)
        except OSError:
            pass
        os.replace(tmp, target)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
    return target


def _lease_owner() -> str:
    return "facts:%s:%d" % (socket.gethostname(), os.getpid())


def collect_and_save() -> dict:
    """build + save. Ko'p jarayonda bitta ijro: kv lease C.KV_FACTS_LEASE (240 s). Band bo'lsa {}."""
    owner = _lease_owner()
    lease = False
    try:
        lease = db.kv_lease_acquire(C.KV_FACTS_LEASE, owner, LEASE_TTL_S)
        if not lease:
            log.info("facts: boshqa jarayon yig'yapti (%s band), o'tkazib yuborildi", C.KV_FACTS_LEASE)
            return {}
    except Exception as exc:  # noqa: BLE001 - bot jadvallari yo'q bo'lsa ham Facts yig'iladi
        log.warning("facts lease olinmadi (%s), leasesiz davom etiladi", _err(exc))
    try:
        facts = build_facts()
        path = save_facts(facts)
        log.info("facts yozildi: %s (updated_at=%s)", path, facts.get("updated_at"))
        return facts
    finally:
        if lease:
            try:
                db.kv_lease_release(C.KV_FACTS_LEASE, owner)
            except Exception as exc:  # noqa: BLE001
                log.warning("facts lease bo'shatilmadi: %s", _err(exc))


def _fresh(path: Path, max_age_s: float) -> bool:
    try:
        return (time.time() - path.stat().st_mtime) < max_age_s
    except OSError:
        return False


async def facts_scheduler() -> None:
    """Bot ichida: darhol, keyin har C.FACTS_INTERVAL_S. Tashqi cron yaqinda yozgan bo'lsa tick o'tkaziladi."""
    while True:
        t0 = time.monotonic()
        try:
            if _fresh(config.FACTS_PATH, C.FACTS_INTERVAL_S / 2):
                log.debug("facts yangi (tashqi cron yozgan), tick o'tkazildi")
            else:
                await asyncio.to_thread(collect_and_save)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - scheduler to'xtamaydi
            log.exception("facts_scheduler: yig'ish yiqildi")
        await asyncio.sleep(max(30.0, C.FACTS_INTERVAL_S - (time.monotonic() - t0)))


def main(argv: Optional[List[str]] = None) -> int:
    """python3 -m agents.support_facts [--stdout]"""
    config.configure_logging()
    parser = argparse.ArgumentParser(
        prog="python3 -m agents.support_facts",
        description="Facts keshini yig'adi va agents/state/support_facts.json ga yozadi.",
    )
    parser.add_argument("--stdout", action="store_true", help="faylga yozmasdan JSON'ni chiqaradi")
    args = parser.parse_args(argv)
    if args.stdout:
        sys.stdout.write(_dump_grep_friendly(build_facts()))
        return 0
    facts = collect_and_save()
    if not facts:
        print("Facts yig'ilmadi: boshqa jarayon yig'yapti (%s band)." % C.KV_FACTS_LEASE)
        return 1
    print("%s: updated_at=%s" % (config.FACTS_PATH, facts.get("updated_at")))
    xato = [k for k, v in facts.items() if isinstance(v, dict) and "error" in v]
    if xato:
        print("xato bo'limlar: " + ", ".join(xato))
    return 0


if __name__ == "__main__":
    sys.exit(main())
