"""To'lov tekshiruvi: CRM <-> transactions <-> oplata_kv <-> Google Sheet (faqat o'qish).

- Kirish: /tolov argumenti yoki Leader topshirig'idagi "TOLOV: ..." qatori (zaxira: erkin matndagi
  shartnoma raqami). Egasi matni SQL'ga faqat parametr bo'lib tushadi.
- DB: bitta db.tx("facts", readonly=True, 15 s) ichida (support_facts._fx), har so'rov SAVEPOINT'da
  (support_facts._rows). TAQIQ ustunlar (telefon, raw_snapshot, metadata, raw_extra, INN, hisob
  raqamlari, note) o'qilmaydi. Oynalar Python'da hisoblanadi, NOW() yo'q.
- Panel ko'prigi (asosiy CRM va Sheet manbasi): GET http://127.0.0.1:<PORT>/api/agent-bridge/payment-check
  (_koprik_get yagona funksiya). Backend panel Chek payment hisobini qaytaradi: OplatyKv, CRM (panel
  yo'li) va ulangan sheetlar. Faqat loopback, redirect taqiq, proxy yo'q, 90 s, javob <= 5 MB. Kalit
  (AGENT_BRIDGE_KEY) faqat header'da, logga, xato matniga va blokka tushmaydi. Xato bo'lsa panel
  bo'limlari UNKNOWN, qolgan tekshiruv davom etadi.
- Eski yo'l (default O'CHIQ, prod'da 404): GET {XONSAROY_CLIENT_BASE}/payment-history (_crm_get). Yo'l,
  parametrlar va host qat'iy, redirect taqiq, TLS tekshiruvi yoqilgan. Kalit har so'rovda config.env
  dan olinadi, global'da saqlanmaydi, logga va blokka tushmaydi. Parallellik 1, bir prefetch'da
  <= 7 so'rov, har so'rov umumiy muddati cheklangan (javob bo'laklab o'qiladi), kesh 10 daqiqa
  (xotirada), kunlik cheklov (agents.kv_store hisoblagichi), AGENTS_TOLOV_CRM=1 yoqadi (ikkalasi
  env fayli o'zgarsa restartsiz). CRM'ga yozadigan kod yo'q (egasi qoidasi: CRM faqat o'qiladi).
- Juftlash va farq kodlari Python'da: LLM faqat tushuntiradi. prefetch() hech qachon exception
  chiqarmaydi: xato o'z bo'limiga UNKNOWN bo'lib yoziladi; manba qisman o'qilsa "yo'q" kodlari
  chiqmaydi. 2-3 shartnomada summa/sana juftlash va solishtirish har shartnoma ichida.
- Natija: format_block (agentga), format_owner (/tolov, HTML), qisqa (tarixga bir qator, PII'siz).
  To'lovchi erkin matni (purpose, bank izohi) agentga berilmaydi: faqat undagi shartnoma raqami.
- XonPay (egasi qoidasi): to'lov CRM'da darhol, pul bizning hisobga 1-3 bank ish kunida. [xonpay] bo'limi
  xonpay_transactions (Billing) qatorlarini TUSHGAN / KUTILMOQDA / KECHIKDI deb beradi; yo'ldagi to'lov
  BIZDA_YOQ yoki CRM_FARQ emas, XONPAY_KUTILMOQDA (info) yoki XONPAY_KECHIKDI (warn). Kirish: /tolov <UUID>.

Faqat stdlib + agents.*. Python 3.10+ mos.
"""
from __future__ import annotations

import base64
import html
import json
import logging
import os
import re
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import urlencode, urlsplit

from . import checker_worker as CW
from . import config
from . import contract as C
from . import db
from . import support_facts as SF

log = logging.getLogger("agents.payment_check")

FARQ_TUZATISH: Dict[str, str] = C.TOLOV_FARQ_TUZATISH

_NOL = Decimal(0)
_TIYIN = Decimal("0.01")
_TARIX_KUN = 180
_IZOH_OYNA_KUN = 120
_DB_ZAXIRA_S = 10.0          # DB bosqichi CRM uchun shuncha vaqt qoldiradi
_MIN_QOLGAN_S = 1.0          # undan kam qolsa yangi so'rov boshlanmaydi
_IZOH_MAX = 80
_IZOH_QISQA = 40
_NOMZOD_MAX = 10
_TXID_MAX = 5
_KESH_MAX = 200
_VARIANT_JAMI_MAX = 48

_SEV_RANK = {"error": 0, "warn": 1, "info": 2}
_KOD_TARTIB = {k: i for i, k in enumerate(C.TOLOV_FARQ_KODLARI)}
# Farq qaysi komponent qatorining statusini ko'taradi (info kodlar ko'tarmaydi)
_KOD_KOMPONENT: Dict[str, str] = {
    "CRM_YOQ": "crm", "BIZDA_YOQ": "crm", "SUMMA_FARQ": "crm", "SPLIT_FARQ": "crm",
    "BOSHQA_SHARTNOMA": "crm", "XATO": "oplata_kv", "KANONIK_EMAS": "oplata_kv", "OKV_YOQ": "oplata_kv",
    "TX_YOQ": "oplata_kv", "DUBLIKAT": "oplata_kv", "SPLIT_YOQ": "oplata_kv", "DRIFT": "transactions",
    "TX_HOLAT": "transactions", "KATEGORIYA": "transactions", "BANK_OCHIRGAN": "bank_izi",
    "BANK_KOCHIRGAN": "bank_izi", "BANK_TAHRIRLAGAN": "bank_izi", "OKV_OCHIRILGAN": "bank_izi",
    "CRM_FARQ": "crm_panel", "CRM_SPLIT": "crm_panel", "SHEET_YOQ": "sheet", "SHEET_FARQ": "sheet",
    "XONPAY_KECHIKDI": "xonpay", "XONPAY_KUTILMOQDA": "xonpay",
}

# Jarayon holati: CRM keshi (F.I.O. qisqartirilgan, diskka yozilmaydi), parallellik 1
_KESH: Dict[Tuple[Tuple[str, str], ...], Tuple[float, List[Dict[str, Any]]]] = {}
_KESH_LOCK = threading.Lock()
_CRM_LOCK = threading.Lock()
_KUNLIK_XOTIRA: Dict[str, int] = {}   # kv_store ishlamasa zaxira hisoblagich
_KUNLIK_LOCK = threading.Lock()


def _mono() -> float:
    """Deadline soati (testda almashtiriladi)."""
    return time.monotonic()


# ---------------------------------------------------------------------------
# Ma'lumot turlari
# ---------------------------------------------------------------------------
@dataclass
class Kirish:
    tur: str                                  # shartnoma | id | xonpay | summa_sana | mijoz | chek
    shartnomalar: List[str] = field(default_factory=list)
    id: str = ""                              # xonpay: UUID (kichik harf)
    summa: Optional[Decimal] = None
    sana: Optional[date] = None
    kun: int = 3
    bank: str = ""
    mijoz: str = ""
    order: str = ""                           # chek: order № (bank hujjat raqami = transactions.doc_number)
    hisob: str = ""                           # chek: oluvchi hisob raqami (ixtiyoriy)
    xom: str = ""
    tashlangan: int = 0                       # 3 tadan ortiq shartnoma tashlandi
    batafsil: bool = False                    # '/tolov ... batafsil': egasiga eski texnik chiqish


@dataclass
class Bolim:
    komponent: str
    status: str                               # ok | warn | error | unknown
    xabar: str
    qatorlar: List[str] = field(default_factory=list)


@dataclass
class Farq:
    kod: str
    jiddiylik: str                            # error | warn | info
    sana: str = ""
    summa: Optional[Decimal] = None
    dalil: str = ""
    izoh: str = ""
    tuzatish: str = ""
    raqam: int = 0                            # F1, F2 ... (saralashdan keyin)
    komponent: str = ""
    ochiq: str = ""                           # to'lovchi erkin matni (maskalangan): FAQAT format_owner
    ochiq_raqam: str = ""                     # o'sha matndan faqat shartnoma raqamlari: agent bloki uchun
    sabab: str = ""                           # SHEET_YOQ / SHEET_FARQ: "<kod> — <izoh>" (nega sheetda yo'q)
    hodisa: str = ""                          # tarix izi aniqlangan kun (ISO): shovqin filtri uchun
    yashirin: bool = False                    # tarix shovqini: texnik chiqishda ko'rsatilmaydi, oxirida raqamlanadi


@dataclass
class Tx:
    id: str
    external_id: str = ""
    holat: str = ""
    vaqt: Optional[datetime] = None           # txn_date (tz'siz UTC)
    summa: Decimal = _NOL                     # ishorasiz (so'm)
    yon: str = "IN"
    shartnoma: str = ""
    manual: bool = False
    xato_hidden: bool = False
    manba: str = ""
    kat: str = ""
    subkat: str = ""
    bank: str = ""
    hisob4: str = ""
    gid: str = ""
    okv_id: str = ""                          # shu tx'dan olingan OKV qatori (boshqa shartnomada bo'lishi mumkin)
    okv_shartnoma: str = ""
    izoh: str = ""                            # bank izohi (faqat Q8)

    @property
    def ishorali(self) -> Decimal:
        return self.summa if self.yon == "IN" else -self.summa

    @property
    def sana(self) -> str:
        return config.to_local(self.vaqt).date().isoformat() if self.vaqt else ""


@dataclass
class Okv:
    id: str
    shartnoma: str = ""
    sana: str = ""
    summa: Decimal = _NOL                     # ishorali
    first: Optional[Decimal] = None
    monthly: Optional[Decimal] = None
    turi: str = ""                            # FIRST | MONTHLY | GENERAL | ""
    tx_type: str = ""
    usul: str = ""
    obyekt: str = ""
    purpose: str = ""
    source_tx_id: str = ""
    batch: str = ""
    pgroup: str = ""
    qolda: bool = False
    tx: Optional[Tx] = None
    tx_kalit: str = ""
    yaratilgan: Optional[datetime] = None     # created_at (tz'siz UTC): EKSPORT_ESKI tekshiruvi
    yangilangan: Optional[datetime] = None    # updated_at (tz'siz UTC)


@dataclass
class CrmTolov:
    contract: str
    amount: Decimal = _NOL
    initial: Decimal = _NOL
    monthly: Decimal = _NOL
    other: Decimal = _NOL
    sana: str = ""
    external_id: str = ""
    type_key: str = ""
    type: str = ""
    method: str = ""
    status: str = ""
    problematic: bool = False
    from_bank: bool = False
    order_id: str = ""
    obyekt: str = ""
    xonpay_uuid: str = ""
    purpose: str = ""                         # maskalangan erkin matn: faqat format_owner
    izoh_raqam: str = ""                      # purpose'dagi shartnoma raqamlari: agent bloki uchun
    ism: str = ""
    manba: str = "contract"                   # contract | trashed | transaction_id

    @property
    def kind(self) -> str:
        return crm_kind({"key": self.type_key} if self.type_key else None, self.type, self.initial, self.monthly)


@dataclass
class XonpayQator:
    """xonpay_transactions qatori (panel OplatyKv > Billing) va holati (C.TOLOV_XONPAY_HOLATLAR yoki NOMALUM)."""
    ext: str                                  # CRM external_id (UUID; pul tushgach kompozit bo'lishi mumkin)
    uuid: str = ""                            # XONPAY:(UUID), kichik harf
    shartnoma: str = ""
    summa: Decimal = _NOL                     # butun so'm
    sana: str = ""                            # date_paid ISO: CRM'dagi to'lov sanasi
    holat: str = ""                           # TUSHGAN | KUTILMOQDA | KECHIKDI | CRMDA_YOQ | NOMALUM (sana yo'q)
    ish_kun: Optional[int] = None             # date_paid dan bugungacha bank ish kunlari (tushmaganda)
    tushgan_sana: str = ""                    # matched_date ISO
    tushgan_id: str = ""                      # bizning bank kompozit ID (matched_external_id)
    tushgan_tx: str = ""                      # matched_tx_id (transactions.id)
    tushgan_summa: Optional[Decimal] = None   # matched_amount
    tekshirilgan: Optional[datetime] = None   # last_checked_at (tz'siz UTC)
    kompozit_crm: bool = False                # CRM external_id bank kompoziti: pul tushgan, Billing moslamagan
    izoh_qosh: str = ""                       # CRM'dan tuzilgan (Billing'da yo'q yoki o'qilmadi): izohga qo'shiladi
    crm_orqali: bool = False                  # TUSHGAN CRM kompoziti orqali (Billing'da eski TOPILMAGAN qatori)
    crm_holat: str = ""                       # xonpay_transactions.status (CRM holati, lotinda)
    muammoli: bool = False                    # xonpay_transactions.is_problematic
    bekor: bool = False                       # status bekor/qaytarim ma'nosida (cancel, отмен, возврат, refund, fail)

    @property
    def yolda(self) -> bool:
        return self.holat in ("KUTILMOQDA", "KECHIKDI")


@dataclass
class Juft:
    crm: Optional[CrmTolov] = None
    okv: Optional[Okv] = None
    tx: Optional[Tx] = None
    moslik: str = "-"                         # kuchli | yadro | gid | xonpay | kuchsiz | -
    kodlar: List[str] = field(default_factory=list)
    maqsad: bool = False
    farqlar: List[Farq] = field(default_factory=list, repr=False)
    xato_nomalum: bool = False                # crm_kesh o'qilmadi: bu qator XATO bo'lishi mumkin (jadvalda "?")


@dataclass
class Kontekst:
    topilgan: Optional[Set[str]] = None       # crm_contracts found=true (None = kesh o'qilmadi)
    kanon: List[str] = field(default_factory=list)
    vznos: Set[str] = field(default_factory=set)
    xonpay: List[Dict[str, Any]] = field(default_factory=list)
    xonpay_holat: Optional[List["XonpayQator"]] = None   # CRM bilan kelishtirilgan Billing (None = xonpay'dan)
    loglar: List[Dict[str, Any]] = field(default_factory=list)
    tarix: List[Dict[str, Any]] = field(default_factory=list)
    arizalar: List[Dict[str, Any]] = field(default_factory=list)
    izoh_tx: List[Tx] = field(default_factory=list)
    tx_min: Optional[date] = None
    sync_daq: int = 0
    hozir: Optional[datetime] = None
    maqsad: Set[str] = field(default_factory=set)
    bizning_oyna: str = ""                    # bizda qisman (400): shu sanadan eski CRM qatori BIZDA_YOQ emas
    crm_oyna: str = ""                        # CRM qisman (500): shu sanadan eski bizning qator CRM_YOQ emas
    bizda_qisman: str = ""                    # Q2/Q3 qatorlari o'qilmadi (sabab): faqat-CRM qatorlari solishtirilmaydi


@dataclass
class Jami:
    soni: int = 0
    jami: Decimal = _NOL
    bosh: Decimal = _NOL
    oylik: Decimal = _NOL
    boshqa: Decimal = _NOL
    qaytarim: Decimal = _NOL                  # manfiy summalar (CRM qaytarim / OKV manfiy)
    kirim: Decimal = _NOL                     # tx IN
    chiqim: Decimal = _NOL                    # tx OUT
    qisman: bool = False


@dataclass
class Jamilar:
    crm: Optional[Jami]                       # None = CRM tekshirilmadi
    okv: Jami
    tx: Jami
    okv_bank: Decimal = _NOL                  # OKV qatorlari, source_tx_id bor (bankdan kelgan)
    tx_client: Decimal = _NOL                 # tx CLIENT, ishorali


@dataclass
class Natija:
    kirish: Optional[Kirish] = None
    bolimlar: List[Bolim] = field(default_factory=list)
    farqlar: List[Farq] = field(default_factory=list)
    juftlar: List[Juft] = field(default_factory=list)
    jamilar: Optional[Jamilar] = None
    ms: int = 0
    qisman: bool = False
    vaqt: Optional[datetime] = None
    shartnomalar: List[str] = field(default_factory=list)
    crm_ok: bool = False
    koprik: Optional["KoprikNatija"] = None   # panel ko'prigi (None = chaqirilmadi)
    xonpay: Optional[List[XonpayQator]] = None   # [xonpay] qatorlari (None = o'qilmadi)
    xulosa: Optional["Xulosa"] = None         # egasi uchun oddiy tildagi xulosa (None = shartnoma yo'q / baza yiqildi)
    chek: Optional["ChekNatija"] = None       # /tolov chek: panel Chek order matchOrder natijasi
    crm_id: Optional["CrmIdNatija"] = None    # shartnomasiz to'lov: bank ID bo'yicha CRM (ko'prik)
    yolgiz: Optional[Dict[str, Any]] = None   # kirish bitta aniq to'lovga olib kelgan bo'lsa (sana, summa, ID)


class CrmXato(Exception):
    """CRM so'rovi bajarilmadi. sabab: tozalangan qisqa matn (kalitsiz)."""

    def __init__(self, sabab: str, qayta: bool = False) -> None:
        super().__init__(sabab)
        self.sabab = sabab
        self.qayta = qayta


# ---------------------------------------------------------------------------
# Kichik sof yordamchilar
# ---------------------------------------------------------------------------
def _dec(v: Any) -> Decimal:
    """Pul -> Decimal (float yo'q). None va buzuq qiymat -> 0."""
    if v is None or isinstance(v, bool):
        return _NOL
    if isinstance(v, Decimal):
        return v
    if isinstance(v, int):
        return Decimal(v)
    s = str(v).strip().replace(" ", "").replace("\u00a0", "").replace(",", "")
    if not s:
        return _NOL
    try:
        d = Decimal(s)
    except (InvalidOperation, ValueError):
        return _NOL
    return d if d.is_finite() else _NOL


def _dec_n(v: Any) -> Optional[Decimal]:
    return None if v is None else _dec(v)


def _bool(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return str(v or "").strip().lower() in ("1", "true", "yes", "ha")


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def pul(v: Any) -> str:
    """123 456 789 (oddiy bo'shliq); tiyin faqat 0 bo'lmasa: ',50'."""
    d = _dec(v).quantize(_TIYIN, rounding=ROUND_HALF_UP)
    belgi = "-" if d < 0 else ""
    d = abs(d)
    butun = int(d)
    tiyin = int((d - butun) * 100)
    matn = "{:,}".format(butun).replace(",", " ")
    if tiyin:
        matn += ",%02d" % tiyin
    return belgi + matn


def _lotin(s: str) -> str:
    """Kirill -> o'zbek lotin (ism, holat, obyekt kabi matnlar uchun; shartnoma raqamiga emas)."""
    return C.KIRILL_RE.sub(lambda m: C.KIRILL_LOTIN[m.group(0)], s or "")


_BLOK_CHEGARA_RE = re.compile(r"={3,}")


def _bir_qator(v: Any, n: int) -> str:
    """Bitta qator, sirsiz; har qanday '===...' ketma-ketligi '==' ga (blok chegarasi soxtalashmaydi).
    CW._clean_msg ustiga o'z himoyasi: regex idempotent, takror qo'llansa ham '===' qaytmaydi."""
    return C.short(_BLOK_CHEGARA_RE.sub("==", CW._clean_msg(v, n)), n)


def _toza(v: Any, n: int = 200) -> str:
    """Blokka tushadigan dinamik matn: sir, telefon, PINFL, email maskalanadi; [ ] -> ( ); ={3,} -> ==;
    bitta qator; n belgi."""
    t = SF._clean(v, n * 2) or ""
    return _bir_qator(t, n)


# To'lovchi erkin matni (bank izohi, OKV/CRM purpose): SF._clean ustiga mahalliy telefon, pasport, karta
_PASPORT_RE = re.compile(r"(?i)(?<![A-Z0-9])[A-Z]{2}\s?\d{7}(?!\d)")
_TEL_MAHALLIY_RE = re.compile(
    r"(?<!\d)(?:33|50|55|6[1-9]|7\d|88|9\d)[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)")
_KARTA_RE = re.compile(r"(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)")


def _izoh_pii(v: Any, n: int = 80) -> str:
    """Erkin izoh (faqat egasiga, format_owner): lotin, keyin pasport, mahalliy telefon, karta raqami
    maskalanadi, so'ng SF._clean (+998, PINFL, email, sirlar). F.I.O. qoladi: shu sabab agent blokiga
    xom izoh BERILMAYDI, faqat undan topilgan shartnoma raqamlari (_izoh_raqam)."""
    t = _lotin(_s(v))
    for rx in (_KARTA_RE, _PASPORT_RE, _TEL_MAHALLIY_RE):
        t = rx.sub("***", t)
    return SF._clean(t, n) or ""


def mijoz_ismi(s: Any) -> str:
    """Mijozning to'liq ismi lotinda: 'AHMEDOV ANVAR OLIMOVICH' -> 'Ahmedov Anvar Olimovich'.
    Egasi qarori (2026-09-28): ism to'liq ko'rsatiladi. Ko'pi bilan 4 so'z, 60 belgi. Bo'sh -> ''."""
    qism = [p[:30].capitalize() for p in re.split(r"\s+", _lotin(_s(s))) if p][:4]
    return " ".join(qism)[:60]


def repair_mojibake(s: Any) -> str:
    """UTF-8 baytlari cp1251 deb o'qilgan matnni tiklaydi. Xato yoki U+FFFD bo'lsa asl matn qoladi."""
    t = "" if s is None else str(s)
    if not t or t.isascii():
        return t
    try:
        out = t.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return t
    if "\ufffd" in out or len(out) >= len(t):
        return t
    return out


def _ru(v: Any) -> str:
    """CRM ko'p tilli maydoni: satr, {ru,uz,en}, {name: ...}, {value: ...} (backend ru()/getRu nusxasi)."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        for k in ("ru", "uz", "en"):
            if isinstance(v.get(k), str) and v.get(k):
                return v[k]
        for key in ("name", "value"):
            x = v.get(key)
            if isinstance(x, str) and x:
                return x
            if isinstance(x, dict):
                for k in ("ru", "uz", "en"):
                    if isinstance(x.get(k), str) and x.get(k):
                        return x[k]
        return ""
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    return ""


_BOSH_LABEL_RE = re.compile(r"перв|нач|boshlang|1\s*[-. ]?\s*взнос", re.I)


def crm_kind(type_obj: Any = None, label: Any = "", initial: Any = 0, monthly: Any = 0) -> str:
    """'initial' | 'monthly' | 'mixed'. initial_amount/monthly_amount ustun, keyin type.key
    (init, boshlang, перво; crm-sverka.service.ts), keyin ko'rinadigan label."""
    i, m = _dec(initial), _dec(monthly)
    if i or m:
        if i and m:
            return "mixed"
        return "initial" if i else "monthly"
    key = ""
    if isinstance(type_obj, dict):
        key = repair_mojibake(_s(type_obj.get("key"))).lower()
    if key:
        return "initial" if ("init" in key or "boshlang" in key or "перво" in key) else "monthly"
    lab = repair_mojibake(_s(label) or _ru(type_obj))
    return "initial" if _BOSH_LABEL_RE.search(lab) else "monthly"


def crm_split(c: CrmTolov) -> Tuple[Decimal, Decimal]:
    """(boshlang'ich, oylik): CRM qatoridagi split, bo'lmasa kind bo'yicha butun summa."""
    if c.initial or c.monthly or c.other:
        return c.initial, c.monthly
    return (c.amount, _NOL) if c.kind == "initial" else (_NOL, c.amount)


# ---------------------------------------------------------------------------
# Shartnoma raqami: normallashtirish, skelet, variantlar (backend nusxasi)
# ---------------------------------------------------------------------------
_AJRAT_RE = re.compile(r"[\s\-_./]")
_SKELET_RE = re.compile(r"[\s\-_./№]")
_SKELET_TABLE = str.maketrans("OI", "01")
_AMBIG: Dict[str, Tuple[str, str]] = {"O": ("O", "0"), "0": ("O", "0"), "I": ("I", "1"), "1": ("1", "I")}
_SH_RE = re.compile(r"^(.+?)\s*[/\-]\s*SH$")


def norm_contract(s: Any) -> str:
    """paymentsByContract bilan bir xil: [\\s-_./] olib tashlanadi, katta harf."""
    return _AJRAT_RE.sub("", _s(s)).upper()


def skelet(s: Any) -> str:
    """translate(upper(regexp_replace(x,'[\\s\\-_./№]','','g')),'OI','01') (SQL bilan bir xil)."""
    return _SKELET_RE.sub("", _s(s)).upper().translate(_SKELET_TABLE)


def _uniq(items: Iterable[str]) -> List[str]:
    out: List[str] = []
    for x in items:
        if x and x not in out:
            out.append(x)
    return out


def _ozgarish_variantlari(s: str) -> List[str]:
    """contractVariants: O<->0, I<->1 (bosh raqamlar tegilmaydi), Hamming masofasi tartibida."""
    lead = len(re.match(r"^\d*", s).group(0))  # type: ignore[union-attr]
    pos = [i for i, ch in enumerate(s) if i >= lead and ch in _AMBIG]
    if not pos:
        return [s]
    if len(pos) > 10:  # 2^n portlashi: faqat "hammasi bir xil" shakllar
        bosh, dum = s[:lead], s[lead:]
        return _uniq([s] + [bosh + dum.replace(a, b) for a, b in (("0", "O"), ("O", "0"), ("1", "I"), ("I", "1"))])
    out: List[Tuple[int, str]] = []
    for mask in range(1 << len(pos)):
        arr = list(s)
        dist = 0
        for b, p in enumerate(pos):
            pick = _AMBIG[s[p]][(mask >> b) & 1]
            arr[p] = pick
            if pick != s[p]:
                dist += 1
        out.append((dist, "".join(arr)))
    out.sort(key=lambda x: x[0])  # barqaror: bir xil masofada mask tartibi
    return _uniq(v for _, v in out)


def variantlar(s: Any, limit: int = C.TOLOV_VARIANT_MAX) -> List[str]:
    """Qidiruv variantlari (<= 16): asl (upper, trim), ajratuvchilarsiz, /SH bilan va /SH siz, O<->0, I<->1."""
    base = _s(s).upper()
    if not base:
        return []
    out = [base, norm_contract(base)]
    m = _SH_RE.match(base)
    if m:
        out += [m.group(1), m.group(1) + "SH"]
    else:
        out.append(base + "/SH")
    for v in _ozgarish_variantlari(base):
        out.append(v)
        if len(_uniq(out)) >= limit:
            break
    return _uniq(out)[:limit]


# ---------------------------------------------------------------------------
# Kompozit bank ID: [IP_|HB_]general_id_num_ddate_accCt_accDt_amount(tiyin)_sign
# ---------------------------------------------------------------------------
_NO_TOKENLAR = ("no_general_id", "no_num", "no_date", "no_acc_ct", "no_acc_dt", "no_amount")
_DDATE_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})")
_SANASIZ_RE = re.compile(r"_\d{2}\.\d{2}\.\d{4}_")


@dataclass
class Kompozit:
    general_id: str
    num: str
    ddate: str
    iso: str
    acc_ct: str
    acc_dt: str
    amount: Optional[Decimal]
    sign: str


def parse_composite(s: Any) -> Optional[Kompozit]:
    """Kompozit ID bo'laklari. 7 bo'lakdan kam -> None. no_* bo'laklar bo'sh deb olinadi."""
    t = _s(s)
    if not t:
        return None
    body = re.sub(r"^(IP|HB)_", "", t)
    for tok in _NO_TOKENLAR:
        body = body.replace(tok, tok.replace("_", "-"))
    parts = body.split("_")
    if len(parts) < 7:
        return None
    gid, num, ddate, acc_ct, acc_dt, amount, sign = parts[:7]

    def bosh(x: str) -> str:
        return "" if x.startswith("no-") else x

    gid = "" if gid == "IMP" else bosh(gid)
    m = _DDATE_RE.match(ddate)
    iso = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1)) if m else ""
    amt = Decimal(amount) if re.fullmatch(r"-?\d+", amount or "") else None
    return Kompozit(gid, bosh(num), bosh(ddate), iso, bosh(acc_ct), bosh(acc_dt), amt, sign)


def composite_core(s: Any) -> str:
    """Yadro: general_id_num_ddate (prefiks va no_* bo'laklarsiz). general_id ham num ham yo'q -> ''."""
    k = parse_composite(s)
    if k is None or not (k.general_id or k.num) or not k.ddate:
        return ""
    return "_".join(x for x in (k.general_id, k.num, k.ddate) if x)


def _gid(s: Any) -> str:
    k = parse_composite(s)
    return k.general_id if k and k.general_id.isdigit() else ""


def komp_summa_mos(komp_summa: Any, som: Any) -> bool:
    """Kompozit summasi tiyinda bo'lishi mumkin: so'm, x100, /100 variantlari (backend amtMatch)."""
    a, b = _dec(komp_summa), abs(_dec(som))
    a = abs(a)
    return abs(a - b) < 1 or abs(b * 100 - a) < 1 or abs(b - a / 100) < 1


def qisqa_id(s: Any) -> str:
    """Kompozit -> yadro (hisob raqamlarisiz), cuid -> oxirgi 8 belgi, qolgani 40 belgi."""
    t = _s(s)
    if not t:
        return "-"
    core = composite_core(t)
    if core:
        return core
    if _CUID_RE.match(t):
        return "..." + t[-8:]
    return t[:40]


# ---------------------------------------------------------------------------
# XonPay: bank ish kunlari va Billing holati (sof)
# ---------------------------------------------------------------------------
_UUID_RE = re.compile(r"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$")
_UUID_MATN_RE = re.compile(
    r"(?<![0-9A-Za-z-])([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})(?![0-9A-Za-z-])")


_XONPAY_BEKOR_RE = re.compile(r"(?i)cancel|отмен|возврат|refund|fail|bekor|qaytar")


def ish_kunlari(dan: date, gacha: date) -> int:
    """(dan, gacha] oralig'idagi bank ish kunlari (dushanba-juma). gacha <= dan -> 0. Bayramlar hisobga olinmaydi.
    Juma to'lovi: shanba, yakshanba 0; dushanba 1; keyingi payshanba 4."""
    if gacha <= dan:
        return 0
    toliq, qoldiq = divmod((gacha - dan).days, 7)
    n = toliq * 5                              # har 7 ketma-ket kunda 5 ish kuni
    for i in range(1, qoldiq + 1):
        if (dan + timedelta(days=toliq * 7 + i)).weekday() < 5:
            n += 1
    return n


def _sana_d(s: str) -> Optional[date]:
    try:
        return date.fromisoformat(s[:10]) if s else None
    except ValueError:
        return None


def xonpay_qatorlari(rows: Optional[Sequence[Dict[str, Any]]], hozir: Optional[datetime] = None
                     ) -> List[XonpayQator]:
    """xonpay_transactions qatorlari -> XonpayQator (eng yangisi birinchi). Holat: is_matched -> TUSHGAN;
    CRM external_id bank kompoziti -> TUSHGAN (pul tushgan, Billing moslamagan); aks holda date_paid dan
    bugungacha (Toshkent) ish kunlari <= TOLOV_XONPAY_ISH_KUNI -> KUTILMOQDA, ko'p -> KECHIKDI. Bir UUID bir
    necha qatorda bo'lsa (external_id UUID dan kompozitga o'tgan) bittasi qoladi, TUSHGAN ustun."""
    bugun = config.to_local(hozir or config.now_utc()).date()
    tanlov: Dict[str, XonpayQator] = {}
    for r in rows or ():
        ext = _s(r.get("external_id"))
        uuid = _s(r.get("xonpay_uuid")).lower() or (ext.lower() if _UUID_RE.match(ext) else "")
        tek = r.get("last_checked_at")
        x = XonpayQator(
            ext=ext, uuid=uuid, shartnoma=_s(r.get("contract")), summa=_dec(r.get("amount")),
            sana=_sana_of(r.get("date_paid")) if r.get("date_paid") is not None else "",
            tushgan_sana=_sana_of(r.get("matched_date")) if r.get("matched_date") is not None else "",
            tushgan_id=_s(r.get("matched_external_id")), tushgan_tx=_s(r.get("matched_tx_id")),
            tushgan_summa=_dec_n(r.get("matched_amount")), tekshirilgan=tek if isinstance(tek, datetime) else None,
            crm_holat=_toza(_lotin(repair_mojibake(_s(r.get("status")))), 40), muammoli=_bool(r.get("is_problematic")),
            bekor=bool(_XONPAY_BEKOR_RE.search(repair_mojibake(_s(r.get("status"))))),
        )
        if _bool(r.get("is_matched")):
            # Billing bilan bir xil: faqat is_matched (tryMatchOne topolmasa is_matched=false qiladi, eski
            # matched_* maydonlarini tozalamaydi)
            x.holat = "TUSHGAN"
        elif parse_composite(ext) is not None:
            x.holat, x.kompozit_crm, x.tushgan_id = "TUSHGAN", True, ext
        else:
            d0 = _sana_d(x.sana)
            if d0 is None:
                x.holat = "NOMALUM"
            else:
                x.ish_kun = ish_kunlari(d0, bugun)
                x.holat = "KECHIKDI" if x.ish_kun > C.TOLOV_XONPAY_ISH_KUNI else "KUTILMOQDA"
        kalit = uuid or "ext:" + ext
        eski = tanlov.get(kalit)
        if eski is None or (eski.holat != "TUSHGAN" and x.holat == "TUSHGAN"):
            tanlov[kalit] = x
    return sorted(tanlov.values(), key=lambda x: (x.sana, x.summa, x.ext), reverse=True)


def _uuid_qisqa(x: XonpayQator) -> str:
    """UUID birinchi 8 belgi (CRM'dagi kabi kichik harf); UUID yo'q bo'lsa qisqa external_id."""
    return x.uuid[:8] if x.uuid else qisqa_id(x.ext)[:16]


def _xonpay_usul(method: Any) -> bool:
    """CRM Способ matnida 'xon pay' / 'xonpay' (bo'shliq va katta-kichik harf farqsiz, mojibake tiklanadi)."""
    return "xonpay" in re.sub(r"\s+", "", _lotin(repair_mojibake(_s(method)))).lower()


def _xonpay_crmdan(uuid: str, shartnoma: str, summa: Decimal, sana: str, hozir: Optional[datetime],
                   izoh_qosh: str = C.TOLOV_XONPAY_BILLINGSIZ) -> XonpayQator:
    """Billing'da hali yo'q XonPay to'lovi (CRM Внешний ID = UUID): holat CRM sanasidan, ish kunlari bilan.
    Sana yo'q bo'lsa KUTILMOQDA, 0 ish kuni (pul tushgani ma'lum emas)."""
    x = XonpayQator(ext=uuid, uuid=uuid.lower(), shartnoma=shartnoma, summa=summa, sana=sana, izoh_qosh=izoh_qosh)
    d0 = _sana_d(sana)
    x.ish_kun = ish_kunlari(d0, config.to_local(hozir or config.now_utc()).date()) if d0 else 0
    x.holat = "KECHIKDI" if x.ish_kun > C.TOLOV_XONPAY_ISH_KUNI else "KUTILMOQDA"
    return x


def _ext_qisqa(ext: str) -> str:
    """CRM Внешний ID qisqa: UUID birinchi 8 belgi, kompozit general_id (yo'q bo'lsa num) va sana, boshqasi 16."""
    if _UUID_RE.match(ext):
        return ext[:8].lower()
    k = parse_composite(ext)
    if k is not None and (k.general_id or k.num):
        return "%s/%s" % (k.general_id or k.num, k.ddate or "-")
    return ext[:16]


def _xonpay_tafsil(x: XonpayQator) -> str:
    """TUSHGAN: bizga tushgan kun va bank kompozit ID (qisqa, hisob raqamlarisiz); yo'lda: o'tgan ish kunlari."""
    if x.holat == "TUSHGAN":
        if x.crm_orqali:
            t = "bizga %s, tx=%s (CRM orqali)" % (x.tushgan_sana or "-", qisqa_id(x.tushgan_id))
        elif x.kompozit_crm:
            t = "CRM ID bank kompoziti %s, Billing moslamagan" % qisqa_id(x.tushgan_id)
        else:
            t = "bizga %s, tx=%s" % (x.tushgan_sana or "-", qisqa_id(x.tushgan_id or x.tushgan_tx))
        if x.tushgan_summa is not None and abs(x.tushgan_summa - x.summa) >= 1:
            t += "; bizda summa %s" % pul(x.tushgan_summa)
        return t + "; " + x.izoh_qosh if x.izoh_qosh else t
    if x.yolda:
        t = C.TOLOV_XONPAY_IZOH_TPL.format(n=x.ish_kun, chegara=C.TOLOV_XONPAY_ISH_KUNI)
        t = t + "; " + x.izoh_qosh if x.izoh_qosh else t
    elif x.holat == "CRMDA_YOQ":
        t = C.TOLOV_XONPAY_CRMDA_YOQ
    else:
        t = "sana yo'q"
    if x.crm_holat:
        t += "; %s (status: %s)" % ("bekor qilingan" if x.bekor else "CRM holati", x.crm_holat)
    return t + "; muammoli" if x.muammoli else t


def _xonpay_holat_matn(x: XonpayQator) -> str:
    """'KUTILMOQDA (to'langan 2026-09-28, 10 000 000; 1 ish kuni o'tdi (chegara 3))' kabi bir qator."""
    return "%s (to'langan %s, %s; %s)" % (x.holat, x.sana or "-", pul(x.summa), _xonpay_tafsil(x))


# ---------------------------------------------------------------------------
# Kirish (parse)
# ---------------------------------------------------------------------------
_OBJECT_CODES: Tuple[str, ...] = (
    "AFS", "YLZ", "MSO", "FZO", "VDY", "ZUR", "SLQ", "OCN", "VTN", "PRL", "ORZ", "SRH", "BHR", "RMZ", "VHA",
)
_OSET = "[O0\u041e]"  # lotin O, raqam 0, kirill O
_SHARTNOMA_MATN_RE = re.compile(
    r"(\d{1,6})\s*(" + "|".join(re.sub("[O0]", _OSET, c) for c in _OBJECT_CODES) + r")\s*([A-Z0-9]{2,6})", re.I,
)
_SH_KEYIN_RE = re.compile(r"^\s*[/\-]\s*SH(?=\s|[.,;)/\-]|$)", re.I)
# Kirill -> lotin SHAKL bo'yicha (contract-parser.ts CYR_TO_LAT), faqat shartnoma qidirish uchun
_CYR_SHAKL = str.maketrans({
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T",
    "У": "Y", "Х": "X", "Ё": "E", "а": "A", "в": "B", "е": "E", "к": "K", "м": "M", "н": "H", "о": "O",
    "р": "P", "с": "C", "т": "T", "у": "Y", "х": "X", "ё": "E",
})
_SANA_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
_SANA_DMY_RE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
_KOMP_ICHIDA_SANA_RE = re.compile(r"_\d{2}\.\d{2}\.\d{4}(?:_|$)")
_CUID_RE = re.compile(r"^c[a-z0-9]{24}$")
_ID_BELGI_RE = re.compile(r"^[A-Za-z0-9_.\-+:]{8,190}$")
_SHARTNOMA_TOKEN_RE = re.compile(r"^[0-9A-Z][0-9A-Z/\-_.]{2,63}$")
_BANK_RE = re.compile(r"^[A-Z0-9_]{2,32}$")
_TOLOV_KALIT_RE = re.compile(r"(?i)\b(shartnoma|id|xonpay|summa|sana|kun|bank|mijoz|order|hisob)\s*=\s*")
_ORDER_RE = re.compile(r"^\d{1,30}$")
_HISOB_RE = re.compile(r"^\d{6,30}$")
_KUN_RE = re.compile(r"(?i)^kun=(\d{1,2})$")
_BANK_TOKEN_RE = re.compile(r"(?i)^bank=([A-Za-z0-9_]{2,32})$")


def _shartnoma_ok(s: str) -> Optional[str]:
    t = s.strip().translate(_CYR_SHAKL).upper().replace("№", "")
    if len(t) > 64 or not _SHARTNOMA_TOKEN_RE.match(t) or _UUID_RE.match(t):   # UUID shartnoma emas (XonPay)
        return None
    if not re.search(r"\d", t) or not re.search(r"[A-Z]", t):
        return None
    return t


def _sana_ok(s: str) -> Optional[date]:
    t = s.strip()
    m = _SANA_ISO_RE.match(t)
    try:
        if m:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        else:
            m = _SANA_DMY_RE.match(t)
            if not m:
                return None
            d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None
    bugun = config.today_local()
    if d > bugun + timedelta(days=1) or d < bugun - timedelta(days=5 * 366):
        return None
    return d


def _summa_ok(s: str) -> Optional[Decimal]:
    t = re.sub(r"\s+", " ", s.replace("\u00a0", " ")).strip()
    if re.fullmatch(r"\d{1,3}(?:[ .]\d{3})+(?:,\d{1,2})?", t):
        t = t.replace(" ", "").replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d+(?:[.,]\d{1,2})?", t):
        t = t.replace(",", ".")
    else:
        return None
    d = _dec(t)
    if d <= 0 or d >= Decimal(10) ** 12:
        return None
    return d


def _mijoz_ok(s: str) -> Optional[str]:
    qism = [p for p in re.split(r"\s+", s.strip()) if p]
    if not qism or len(qism) > 3 or len(" ".join(qism)) > 60:
        return None
    for p in qism:
        harf = re.sub(r"['‘’ʻʼ`]", "", p)
        if len(harf) < 3 or not harf.isalpha():
            return None
    return " ".join(qism)


def _id_ok(s: str) -> Optional[str]:
    t = s.strip()
    if _CUID_RE.match(t):
        return t
    if re.fullmatch(r"\d{8,}", t) and len(t) <= 64:
        return t
    if _ID_BELGI_RE.match(t) and "_" in t and _KOMP_ICHIDA_SANA_RE.search(t):
        return t
    return None


def _xom(matn: Any) -> str:
    return _toza(matn, 120)


def _uuid_ok(s: str) -> Optional[str]:
    """XonPay UUID (8-4-4-4-12 hex) yoki XONPAY:(UUID) -> kichik harfli UUID; aks holda None."""
    t = s.strip().strip(".,;:\"'")
    m = _XONPAY_RE.fullmatch(t)
    if m:
        return m.group(1).lower()
    return t.lower() if _UUID_RE.match(t) else None


def _tolov_qatori(qator: str, matn: str) -> Optional[Kirish]:
    """TOLOV: shartnoma=... | id=... (XonPay UUID ham) | xonpay=<UUID> | summa=... sana=... [kun=..] [bank=..]
    | mijoz=..."""
    qiymat: Dict[str, str] = {}
    topilgan = list(_TOLOV_KALIT_RE.finditer(qator))
    for i, m in enumerate(topilgan):
        oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(qator)
        qiymat.setdefault(m.group(1).lower(), qator[m.end():oxir].strip())
    if "shartnoma" in qiymat:
        return _shartnomalar_kirish(re.split(r"[,;\s]+", qiymat["shartnoma"]), matn)
    for kalit in ("xonpay", "id"):
        birinchi = qiymat.get(kalit, "").split()
        u = _uuid_ok(birinchi[0]) if birinchi else None
        if u is not None:
            return Kirish(tur="xonpay", id=u, xom=_xom(matn))
    if "xonpay" in qiymat:
        return None
    if "id" in qiymat:
        s = _id_ok(qiymat["id"].split()[0] if qiymat["id"].split() else "")
        return Kirish(tur="id", id=s, xom=_xom(matn)) if s else None
    if "order" in qiymat:
        return _chek_kirish(qiymat, matn)
    if "summa" in qiymat and "sana" in qiymat:
        summa = _summa_ok(qiymat["summa"])
        sana = _sana_ok(qiymat["sana"].split()[0] if qiymat["sana"].split() else "")
        if summa is None or sana is None:
            return None
        kun = 3
        if "kun" in qiymat and qiymat["kun"].split() and qiymat["kun"].split()[0].isdigit():
            kun = min(10, int(qiymat["kun"].split()[0]))
        bank = qiymat.get("bank", "").split()[0].upper() if qiymat.get("bank", "").split() else ""
        if bank and not _BANK_RE.match(bank):
            return None
        return Kirish(tur="summa_sana", summa=summa, sana=sana, kun=kun, bank=bank, xom=_xom(matn))
    if "mijoz" in qiymat:
        ism = _mijoz_ok(qiymat["mijoz"])
        return Kirish(tur="mijoz", mijoz=ism, xom=_xom(matn)) if ism else None
    return None


def _birinchi(v: str) -> str:
    return v.split()[0] if v and v.split() else ""


def _chek_kirish(qiymat: Dict[str, str], matn: str) -> Optional[Kirish]:
    """TOLOV: order=<№> [summa=..] [sana=..] [hisob=..] -> Kirish(tur='chek'). Yaroqsiz qism -> None."""
    order = _birinchi(qiymat.get("order", "")).lstrip("№#")
    if not _ORDER_RE.match(order):
        return None
    summa = sana = None
    if qiymat.get("summa", "").strip():
        summa = _summa_ok(qiymat["summa"].strip())
        if summa is None:
            return None
    if _birinchi(qiymat.get("sana", "")):
        sana = _sana_ok(_birinchi(qiymat["sana"]))
        if sana is None:
            return None
    hisob = _birinchi(qiymat.get("hisob", ""))
    if hisob and not _HISOB_RE.match(hisob):
        return None
    return Kirish(tur="chek", order=order, summa=summa, sana=sana, hisob=hisob, xom=_xom(matn))


def _chek_argument(tokens: Sequence[str], arg: str) -> Optional[Kirish]:
    """/tolov chek <order №> [summa] [sana]: birinchi raqam order, qolgani (bo'lsa) summa va sana."""
    if not tokens or not _ORDER_RE.match(tokens[0]):
        return None
    k = Kirish(tur="chek", order=tokens[0], xom=_xom(arg))
    qolgan = list(tokens[1:])
    if not qolgan:
        return k
    sanalar = [(i, _sana_ok(t)) for i, t in enumerate(qolgan)]
    sanalar = [(i, d) for i, d in sanalar if d is not None]
    if len(sanalar) != 1:
        return None
    k.sana = sanalar[0][1]
    raqam = [t for i, t in enumerate(qolgan) if i != sanalar[0][0]]
    if raqam:
        k.summa = _summa_ok(" ".join(raqam))
        if k.summa is None:
            return None
    return k


def _shartnomalar_kirish(tokens: Sequence[str], matn: str) -> Optional[Kirish]:
    toza: List[str] = []
    for t in tokens:
        if not t.strip():
            continue
        s = _shartnoma_ok(t)
        if s is None:
            return None
        if s not in toza:
            toza.append(s)
    if not toza:
        return None
    return Kirish(tur="shartnoma", shartnomalar=toza[:C.TOLOV_SHARTNOMA_MAX],
                  tashlangan=max(0, len(toza) - C.TOLOV_SHARTNOMA_MAX), xom=_xom(matn))


def _argument(arg: str) -> Optional[Kirish]:
    """/tolov argumenti (bitta qator)."""
    tokens = arg.split()
    if not tokens:
        return None
    if tokens[0].lower() == "mijoz":
        ism = _mijoz_ok(" ".join(tokens[1:]))
        return Kirish(tur="mijoz", mijoz=ism, xom=_xom(arg)) if ism else None
    if tokens[0].lower() in ("chek", "order"):
        return _chek_argument(tokens[1:], arg)
    if len(tokens) == 1:
        u = _uuid_ok(tokens[0])
        if u is not None:
            return Kirish(tur="xonpay", id=u, xom=_xom(arg))
        s = _id_ok(tokens[0])
        if s is not None:
            return Kirish(tur="id", id=s, xom=_xom(arg))
    sanalar = [(i, _sana_ok(t)) for i, t in enumerate(tokens)]
    sanalar = [(i, d) for i, d in sanalar if d is not None]
    if len(sanalar) == 1:
        qolgan = [t for i, t in enumerate(tokens) if i != sanalar[0][0]]
        kun, bank = 3, ""
        raqam: List[str] = []
        for t in qolgan:
            mk, mb = _KUN_RE.match(t), _BANK_TOKEN_RE.match(t)
            if mk:
                kun = min(10, int(mk.group(1)))
            elif mb:
                bank = mb.group(1).upper()
            else:
                raqam.append(t)
        summa = _summa_ok(" ".join(raqam)) if raqam else None
        if summa is not None:
            return Kirish(tur="summa_sana", summa=summa, sana=sanalar[0][1], kun=kun, bank=bank, xom=_xom(arg))
        return None
    return _shartnomalar_kirish(re.split(r"[,;\s]+", arg), arg)


def _matn_shartnomalar(matn: Any) -> List[str]:
    """Erkin matndagi shartnoma raqamlari (contract-parser.ts nusxasi: bosh raqamlar ochko'z, /SH olinadi)."""
    toza = _s(matn).translate(_CYR_SHAKL).upper().replace("№", "").replace("N°", "")
    topilgan: List[str] = []
    for m in _SHARTNOMA_MATN_RE.finditer(toza):
        kod = re.sub("[0\u041e]", "O", m.group(2).upper())  # obyekt kodlarida faqat lotin O
        s = re.sub(r"\s+", "", m.group(1) + kod + m.group(3)).upper()
        if _SH_KEYIN_RE.match(toza[m.end():m.end() + 12]):
            s += "/SH"
        if s not in topilgan:
            topilgan.append(s)
    return topilgan


def _izoh_raqam(matn: Any) -> str:
    """Agent bloki uchun erkin izoh o'rnida: faqat undan topilgan shartnoma raqamlari (ism, telefon yo'q)."""
    if not _s(matn):
        return ""
    raqam = _matn_shartnomalar(matn)[:3]
    return "izohda: " + ", ".join(raqam) if raqam else "izohda raqam yo'q"


def _skelet_naqsh(sk: str) -> "re.Pattern[str]":
    """Skeletni matnda chegarali qidirish: oldida raqam yo'q, ortida harf/raqam yo'q, orada ajratuvchi
    bo'lishi mumkin; 0 = [0O], 1 = [1I] (skelet bilan bir xil)."""
    sinf = {"0": "[0O]", "1": "[1I]"}
    ichi = r"[\s\-_./№]*".join(sinf.get(ch, re.escape(ch)) for ch in sk)
    return re.compile(r"(?<![0-9])" + ichi + r"(?![A-Z0-9])")


def _izoh_mos(izoh: Any, skeletlar: Iterable[str]) -> bool:
    """Q8 post-filtri: izohdagi raqam aynan shu shartnomami (ILIKE '%18MSOP26LA%' '118MSOP26LA' ni ham
    topadi). 1) contract-parser nomzodlaridan biri skelet bo'yicha teng; 2) aks holda chegarali moslik
    (OBJECT_CODES da yo'q obyekt kodi uchun)."""
    sk = {x for x in skeletlar if x}
    if not sk:
        return False
    if any(skelet(x) in sk for x in _matn_shartnomalar(izoh)):
        return True
    matn = _s(izoh).translate(_CYR_SHAKL).upper()
    return any(_skelet_naqsh(x).search(matn) for x in sk)


def _erkin_matn(matn: str) -> Optional[Kirish]:
    """Zaxira: erkin matndagi shartnoma raqamlari (contract-parser.ts), keyin XonPay UUID, keyin kompozit ID."""
    topilgan = _matn_shartnomalar(matn)
    if topilgan:
        return Kirish(tur="shartnoma", shartnomalar=topilgan[:C.TOLOV_SHARTNOMA_MAX],
                      tashlangan=max(0, len(topilgan) - C.TOLOV_SHARTNOMA_MAX), xom=_xom(matn))
    m = _UUID_MATN_RE.search(matn)
    if m:
        return Kirish(tur="xonpay", id=m.group(1).lower(), xom=_xom(matn))
    for tok in re.split(r"\s+", matn):
        s = _id_ok(tok.strip(".,;:()\"'"))
        if s is not None and not s.isdigit():
            return Kirish(tur="id", id=s, xom=_xom(matn))
    return _matn_tolov(matn)


# Erkin matndan chek/to'lov belgilari (shartnoma, UUID va ID topilmaganda oxirgi zaxira).
# Taxmin qilinmaydi: summa va sana har biri matnda AYNAN bitta bo'lsagina olinadi.
_MATN_ORDER_RE = re.compile(r"(?i)(?:№|#|\border\b|ордер|\bhujjat\b|документ|\bдок\b\.?)\s*(?:№|n|raqami)?\s*[:.]?\s*"
                            r"(\d{5,15})(?!\d)")   # 20 xonali hisob raqami order emas
_MATN_SANA_RE = re.compile(r"(?<![\d.])(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?)(?![\d])")
_MATN_SUMMA_RE = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,12})(?:[.,](\d{1,2}))?(?![\d])"
    r"(\s*(?:so['‘’ʻʼ`]?m|сум|сўм|sum(?!ma)|uzs))?", re.I)   # "so'mga" ham
_MATN_TEL_RE = re.compile(r"\+?998[\s\-()]*\d{2}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}")


def _matn_sana(g: Sequence[Optional[str]]) -> Optional[date]:
    try:
        if g[0]:
            return _sana_ok("%s-%s-%s" % (g[0], g[1], g[2]))
        kun, oy = int(g[3]), int(g[4])
        yil = int(g[5]) if g[5] else config.today_local().year
        d = date(yil, oy, kun)
        if not g[5] and d > config.today_local() + timedelta(days=1):
            d = date(yil - 1, oy, kun)               # yilsiz sana kelajakda bo'lsa o'tgan yil
        return _sana_ok(d.isoformat())
    except (ValueError, TypeError):
        return None


def _matn_tolov(matn: str) -> Optional[Kirish]:
    """Erkin matn: order № (№/order/hujjat/док belgisi bilan), summa va sana -> chek yoki summa_sana.
    Telefon raqamlari avval olib tashlanadi; summa: kamida 2 ta minglik guruhi ("8 132 000") yoki pul birligi
    ("500 000 so'm", "8132000 so'm"). Bir nechta turli summa yoki sana bo'lsa olinmaydi (Leader aniqlashtiradi)."""
    t = _MATN_TEL_RE.sub(" ", _s(matn))
    t = _TEL_MAHALLIY_RE.sub(" ", t)
    orderlar = _uniq(m.group(1) for m in _MATN_ORDER_RE.finditer(t))
    t = _MATN_ORDER_RE.sub(" ", t)
    sanalar: List[date] = []
    for m in _MATN_SANA_RE.finditer(t):
        d = _matn_sana(m.groups())
        if d is not None and d not in sanalar:
            sanalar.append(d)
    t = _MATN_SANA_RE.sub(" ", t)
    summalar: List[Decimal] = []
    for m in _MATN_SUMMA_RE.finditer(t):
        butun, tiyin, birlik = m.group(1), m.group(2), m.group(3)
        guruhli = bool(re.search(r"[ \u00a0.,]", butun))
        if not (birlik or (guruhli and len(re.split(r"[ \u00a0.,]", butun)) >= 3)):
            continue
        v = _summa_ok(re.sub(r"[ \u00a0.,]", "", butun) + ("." + tiyin if tiyin else ""))
        if v is not None and v >= 1000 and v not in summalar:
            summalar.append(v)
    summa = summalar[0] if len(summalar) == 1 else None
    sana = sanalar[0] if len(sanalar) == 1 else None
    if len(orderlar) == 1:
        return Kirish(tur="chek", order=orderlar[0], summa=summa, sana=sana, xom=_xom(matn))
    if summa is not None and sana is not None:
        return Kirish(tur="summa_sana", summa=summa, sana=sana, xom=_xom(matn))
    return None


_BATAFSIL_RE = re.compile(r"(?i)\s+%s\s*$" % C.TOLOV_BATAFSIL_SOZ)


def parse_kirish(matn: Any) -> Optional[Kirish]:
    """TOLOV: qatori -> /tolov argumenti (bir qator) -> erkin matn. Yaroqsiz -> None.
    Bir qatorli argument oxiridagi 'batafsil' so'zi olib tashlanadi va Kirish.batafsil = True (texnik chiqish)."""
    t = _s(matn)
    if not t or len(t) > 20000:
        return None
    m = C.TOLOV_TOPSHIRIQ_RE.search(t)
    if m:
        # buzuq TOLOV: qatori (LLM xatosi) -> erkin matndagi shartnoma raqami
        return _tolov_qatori(m.group(1).strip(), t) or _erkin_matn(t)
    batafsil = False
    if "\n" not in t and _BATAFSIL_RE.search(" " + t):
        t, batafsil = _BATAFSIL_RE.sub("", " " + t).strip(), True
        if not t:
            return None
    k = _argument(t) if "\n" not in t and len(t) <= 200 else None
    k = k or _erkin_matn(t)
    if k is not None:
        k.batafsil = batafsil
    return k


def tolov_savol(matn: Any) -> Tuple[Optional[Kirish], bool]:
    """/tolov argumenti: (kirish, savolmi). savolmi=False: faqat identifikatorlar (shartnoma, ID/UUID, summa+sana,
    mijoz, 'batafsil') -> LLM'siz javob (kirish None bo'lsa foydalanish matni). savolmi=True: identifikatorlardan
    tashqari erkin matn yoki savol (kamida 2 so'z yoki bir necha qator) -> kirish bo'lsa Checker'ga delegatsiya
    (TOLOV: qatori + egasining savoli), kirish None bo'lsa Leader'ga oddiy xabar."""
    t = _s(matn)
    if not t or len(t) > 20000:
        return None, False
    k = parse_kirish(t)
    if "\n" not in t:
        sof = _BATAFSIL_RE.sub("", " " + t).strip() if _BATAFSIL_RE.search(" " + t) else t
        if sof and len(sof) <= 200 and _argument(sof) is not None:
            return k, False
    return k, len(t.split()) >= 2 or "\n" in t


def tolov_topshiriq(k: Kirish, savol: Any) -> str:
    """Checker topshirig'i: 'TOLOV: <identifikatorlar>' (leader.md 5-bo'lim shakli) va egasining to'liq savoli."""
    if k.tur == "shartnoma":
        qator = "shartnoma=" + ",".join(k.shartnomalar)
    elif k.tur in ("id", "xonpay"):
        qator = "id=" + k.id
    elif k.tur == "summa_sana":
        qator = "summa=%s sana=%s kun=%d" % (_s(k.summa), k.sana.isoformat() if k.sana else "", k.kun) + (
            " bank=" + k.bank if k.bank else "")
    elif k.tur == "chek":
        qator = "order=" + k.order + (" summa=" + _s(k.summa) if k.summa is not None else "") + (
            " sana=" + k.sana.isoformat() if k.sana else "") + (" hisob=" + k.hisob if k.hisob else "")
    else:
        qator = "mijoz=" + k.mijoz
    return "TOLOV: %s\n%s" % (qator, C.TOLOV_SAVOL_TPL.format(savol=_s(savol)))


def kirish_nomi(k: Optional[Kirish], shartnomalar: Sequence[str] = ()) -> str:
    """Sarlavha uchun qisqa nom (ismsiz)."""
    if shartnomalar:
        return ", ".join(shartnomalar)
    if k is None:
        return "-"
    if k.tur == "shartnoma":
        return ", ".join(k.shartnomalar)
    if k.tur == "id":
        return "ID " + qisqa_id(k.id)
    if k.tur == "xonpay":
        return "XonPay " + k.id[:8]
    if k.tur == "summa_sana":
        return "%s / %s" % (pul(k.summa), k.sana.isoformat() if k.sana else "-")
    if k.tur == "chek":
        return "chek №" + k.order
    return "mijoz"


# ---------------------------------------------------------------------------
# SQL (modul konstantalari: egasi matni faqat %(nom)s parametri)
# ---------------------------------------------------------------------------
_SQL_KESH = (
    "SELECT contract_number, found, status, virtual_status, object_name, apartment_number, crm_order_id,"
    " branch_name, property_type, last_verified_at, left(last_error, 200) AS last_error, customer_name"
    " FROM crm_contracts WHERE contract_number = ANY(%(v)s::text[]) LIMIT 30"
)
_TX_LATERAL_USTUN = (
    " x.external_id, x.status, x.txn_date, x.amount, x.direction, x.contract_number, x.is_contract_manual,"
    " x.xato_hidden, x.source, x.bank_general_id, x.category_id, x.subcategory_id, x.bank_id, x.account_id"
)
_SQL_OKV = (
    "SELECT o.id, o.contract_no, o.\"date\" AS sana, o.payment_amount, o.first_installment, o.monthly_amount,"
    " o.payment_category::text AS turi, o.tx_type, o.payment_method, o.object, left(o.purpose, 300) AS purpose,"
    " o.source_tx_id, o.import_batch_id, o.perereboska_group_id, o.was_manually_edited, o.created_at,"
    " o.updated_at, t.id AS tx_id, t.kalit AS tx_kalit, t.external_id AS tx_ext, t.status::text AS tx_holat,"
    " t.txn_date AS tx_vaqt, t.amount AS tx_summa, t.direction::text AS tx_yon,"
    " t.contract_number AS tx_shartnoma, t.is_contract_manual AS tx_manual, t.xato_hidden AS tx_xato_hidden,"
    " t.source::text AS tx_manba, t.bank_general_id AS tx_gid, c.code AS tx_kat, sc.code AS tx_subkat,"
    " bk.code AS tx_bank, right(ba.account_no, 4) AS tx_hisob4"
    " FROM oplata_kv o"
    " LEFT JOIN LATERAL ("
    " SELECT x.id, 'ext'::text AS kalit," + _TX_LATERAL_USTUN +
    " FROM transactions x WHERE o.source_tx_id IS NOT NULL AND x.external_id = o.source_tx_id"
    " UNION ALL SELECT x.id, 'id'::text," + _TX_LATERAL_USTUN +
    " FROM transactions x WHERE o.source_tx_id IS NOT NULL AND x.id = o.source_tx_id"
    " UNION ALL SELECT x.id, 'excel'::text," + _TX_LATERAL_USTUN +
    " FROM transactions x WHERE o.source_tx_id IS NULL AND x.external_id = o.id"
    " LIMIT 1) t ON true"
    " LEFT JOIN categories c ON c.id = t.category_id"
    " LEFT JOIN categories sc ON sc.id = t.subcategory_id"
    " LEFT JOIN banks bk ON bk.id = t.bank_id"
    " LEFT JOIN bank_accounts ba ON ba.id = t.account_id"
    " WHERE o.contract_no = ANY(%(v)s::text[])"
    " ORDER BY o.\"date\" DESC, o.created_at DESC LIMIT %(lim)s"
)
_SQL_OKV_JAMI = (
    "SELECT o.contract_no, COUNT(*) AS soni, COALESCE(SUM(o.payment_amount), 0) AS jami,"
    " COALESCE(SUM(o.first_installment), 0) AS bosh, COALESCE(SUM(o.monthly_amount), 0) AS oylik,"
    " COUNT(*) FILTER (WHERE o.payment_category IS NULL) AS turisiz_soni,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.payment_category IS NULL), 0) AS turisiz,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.payment_category = 'GENERAL'), 0) AS umumiy,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.payment_amount < 0), 0) AS manfiy,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.perereboska_group_id IS NOT NULL), 0) AS perebroska,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.source_tx_id IS NOT NULL), 0) AS bankdan,"
    " COUNT(*) FILTER (WHERE o.source_tx_id IS NOT NULL) AS bankdan_soni,"
    " COALESCE(SUM(o.payment_amount) FILTER (WHERE o.import_batch_id IS NOT NULL), 0) AS exceldan,"
    " MIN(o.\"date\") AS min_sana, MAX(o.\"date\") AS max_sana"
    " FROM oplata_kv o WHERE o.contract_no = ANY(%(v)s::text[]) GROUP BY o.contract_no"
)
_SQL_TX = (
    "SELECT t.id, t.external_id, t.status::text AS holat, t.txn_date AS vaqt, t.amount AS summa,"
    " t.direction::text AS yon, t.contract_number AS shartnoma, t.is_contract_manual AS manual, t.xato_hidden,"
    " t.source::text AS manba, t.bank_general_id AS gid, c.code AS kat, sc.code AS subkat, bk.code AS bank,"
    " right(ba.account_no, 4) AS hisob4, ok.id AS okv_id, ok.contract_no AS okv_shartnoma"
    " FROM transactions t"
    " LEFT JOIN categories c ON c.id = t.category_id"
    " LEFT JOIN categories sc ON sc.id = t.subcategory_id"
    " LEFT JOIN banks bk ON bk.id = t.bank_id"
    " LEFT JOIN bank_accounts ba ON ba.id = t.account_id"
    " LEFT JOIN LATERAL ("
    " SELECT o.id, o.contract_no FROM oplata_kv o WHERE t.external_id IS NOT NULL AND o.source_tx_id = t.external_id"
    " UNION ALL SELECT o.id, o.contract_no FROM oplata_kv o WHERE o.source_tx_id = t.id"
    " UNION ALL SELECT o.id, o.contract_no FROM oplata_kv o"
    " WHERE t.external_id IS NOT NULL AND o.source_tx_id IS NULL AND o.id = t.external_id"
    " LIMIT 1) ok ON true"
    " WHERE t.contract_number = ANY(%(v)s::text[]) OR t.external_id = ANY(%(k)s::text[]) OR t.id = ANY(%(k)s::text[])"
    " ORDER BY t.txn_date DESC LIMIT %(lim)s"
)
_SQL_TX_JAMI = (
    "SELECT t.contract_number, t.direction::text AS yon, t.status::text AS holat,"
    " COALESCE(c.code = 'CLIENT', false) AS mijoz, COUNT(*) AS soni, COALESCE(SUM(t.amount), 0) AS summa"
    " FROM transactions t LEFT JOIN categories c ON c.id = t.category_id"
    " WHERE t.contract_number = ANY(%(v)s::text[]) GROUP BY 1, 2, 3, 4"
)
_SKELET_SQL_IFODA = "translate(upper(regexp_replace({ustun}, '[\\s\\-_./№]', '', 'g')), 'OI', '01')"
_SQL_SKELET: Tuple[str, ...] = (
    "SELECT DISTINCT contract_number AS s FROM crm_contracts WHERE "
    + _SKELET_SQL_IFODA.format(ustun="contract_number") + " = ANY(%(sk)s::text[]) LIMIT 10",
    "SELECT DISTINCT contract_no AS s FROM oplata_kv WHERE "
    + _SKELET_SQL_IFODA.format(ustun="contract_no") + " = ANY(%(sk)s::text[]) LIMIT 10",
    "SELECT DISTINCT contract_number AS s FROM transactions WHERE contract_number IS NOT NULL AND "
    + _SKELET_SQL_IFODA.format(ustun="contract_number") + " = ANY(%(sk)s::text[]) LIMIT 10",
)
_SQL_LOG = (
    "SELECT change_type::text AS tur, detected_at, txn_date, amount, direction::text AS yon, contract_number,"
    " external_id, fields_changed FROM transaction_change_logs"
    " WHERE detected_at >= %(dan)s AND (contract_number = ANY(%(v)s::text[]) OR external_id = ANY(%(k)s::text[]))"
    " ORDER BY detected_at DESC LIMIT 30"
)
_SQL_OKV_TARIX = (
    "SELECT h.oplata_kv_id, h.action, h.created_at, left(h.actor_name, 60) AS kim,"
    " COALESCE(h.changes->'contractNo'->>'old', h.changes->'snapshot'->>'contractNo',"
    " h.changes->>'contractNo') AS eski,"
    " h.changes->'contractNo'->>'new' AS yangi,"
    " COALESCE(h.changes->'paymentAmount'->>'old', h.changes->'snapshot'->>'paymentAmount',"
    " h.changes->>'paymentAmount') AS summa,"
    " COALESCE(h.changes->'date'->>'old', h.changes->'snapshot'->>'date', h.changes->>'date') AS sana"
    " FROM oplata_kv_history h"
    " WHERE h.action IN ('deleted', 'edited') AND h.created_at >= %(dan)s"
    " AND (h.changes->'contractNo'->>'old' = ANY(%(v)s::text[])"
    " OR (h.action = 'deleted' AND (h.changes->'snapshot'->>'contractNo' = ANY(%(v)s::text[])"
    " OR h.changes->>'contractNo' = ANY(%(v)s::text[]))))"
    " ORDER BY h.created_at DESC LIMIT 30"
)
_SQL_VZNOS = (
    "SELECT v.contract_no, v.status, v.in_crm FROM vznos_contract v"
    " WHERE v.contract_no = ANY(%(v)s::text[]) LIMIT 20"
)
_SQL_PEREBROSKA = (
    "SELECT g.id, g.from_contract_no, g.amount, g.\"date\" AS sana, g.status FROM perereboska_group g"
    " WHERE g.from_contract_no = ANY(%(v)s::text[]) OR g.id = ANY(%(g)s::text[])"
    " OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(g.destinations) = 'array'"
    " THEN g.destinations ELSE '[]'::jsonb END) d WHERE d->>'contractNo' = ANY(%(v)s::text[]))"
    " ORDER BY g.\"date\" DESC LIMIT 20"
)
_SQL_ARIZA = (
    "SELECT r.id, r.tx_id, r.oplata_kv_id, r.proposed_contract_no, r.snap_contract_no, r.snap_amount,"
    " r.snap_date, r.submitted_at, r.agent_state FROM xato_correction_requests r"
    " WHERE r.status = 'pending' AND (r.proposed_contract_no = ANY(%(v)s::text[])"
    " OR r.snap_contract_no = ANY(%(v)s::text[]) OR r.tx_id = ANY(%(t)s::text[])"
    " OR r.oplata_kv_id = ANY(%(o)s::text[]))"
    " ORDER BY r.submitted_at DESC LIMIT 20"
)
# xonpay_transactions (Billing): full_name, purpose, crm_uuid o'qilmaydi
_XONPAY_USTUN = (
    "x.external_id, x.xonpay_uuid, x.contract, x.amount, x.date_paid, x.is_matched, x.matched_tx_id,"
    " x.matched_external_id, x.matched_amount, x.matched_date, x.last_checked_at, x.is_received_from_bank,"
    " x.status, x.is_problematic"
)
_SQL_XONPAY = (
    "SELECT " + _XONPAY_USTUN + " FROM xonpay_transactions x"
    " WHERE x.contract = ANY(%(v)s::text[]) OR x.matched_tx_id = ANY(%(t)s::text[])"
    " ORDER BY x.date_paid DESC NULLS LAST LIMIT 100"
)
# /tolov <UUID>: xonpay_uuid katta harfda saqlanadi, CRM external_id kichik harfda keladi (ikkalasi ham so'raladi)
_SQL_XONPAY_UUID = (
    "SELECT " + _XONPAY_USTUN + " FROM xonpay_transactions x"
    " WHERE x.xonpay_uuid = ANY(%(u)s::text[]) OR x.external_id = ANY(%(u)s::text[])"
    " ORDER BY x.date_paid DESC NULLS LAST LIMIT 10"
)
# zaxira: Billing'da yo'q UUID bank izohida (XONPAY:(UUID)) bormi; izoh matni o'qilmaydi, faqat qidiriladi
_SQL_XONPAY_TX = (
    "SELECT t.id, t.external_id, t.contract_number, t.txn_date, t.amount, t.direction::text AS yon"
    " FROM transactions t WHERE t.txn_date >= %(dan)s AND t.description ILIKE %(p)s"
    " ORDER BY t.txn_date DESC LIMIT 5"
)
# panel CRM to'lovi Внешний ID = bank kompoziti, bizning shartnoma qatorlarida yo'q: butun transactions'dan
# (aniq external_id yoki general_id; yadro Python'da). Boshqa shartnomada bo'lsa ham topiladi.
_SQL_KOMP_TX = (
    "SELECT t.id, t.external_id, t.status::text AS holat, t.txn_date AS vaqt, t.amount AS summa,"
    " t.direction::text AS yon, t.contract_number AS shartnoma, t.bank_general_id AS gid, c.code AS kat"
    " FROM transactions t LEFT JOIN categories c ON c.id = t.category_id"
    " WHERE t.external_id = ANY(%(k)s::text[]) OR t.bank_general_id = ANY(%(g)s::text[]) LIMIT 60"
)
_SQL_IZOH = (
    "SELECT t.id, t.external_id, t.status::text AS holat, t.txn_date AS vaqt, t.amount AS summa,"
    " t.direction::text AS yon, t.contract_number AS shartnoma, t.bank_general_id AS gid, c.code AS kat,"
    " bk.code AS bank, left(t.description, 200) AS izoh"
    " FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN banks bk ON bk.id = t.bank_id"
    " WHERE t.txn_date >= %(dan)s AND (t.contract_number IS NULL OR t.contract_number <> ALL(%(v)s::text[]))"
    " AND (t.description ILIKE ANY(%(p)s::text[])"
    " OR upper(regexp_replace(COALESCE(t.description, ''), '[\\s\\-_./№]', '', 'g')) LIKE ANY(%(q)s::text[]))"
    " ORDER BY t.txn_date DESC LIMIT 30"
)
_SQL_ID_TX = (
    "SELECT t.id, t.external_id, t.contract_number, t.txn_date, t.amount, t.direction::text AS yon,"
    " t.bank_general_id, left(t.from_name, 120) AS tolovchi, left(t.description, 300) AS izoh FROM transactions t"
    " WHERE t.id = %(s)s OR t.external_id = %(s)s OR t.bank_b2_id = %(s)s OR t.bank_general_id = %(g)s LIMIT 20"
)
_SQL_ID_OKV = (
    "SELECT o.id, o.contract_no, o.\"date\" AS sana, o.payment_amount, o.source_tx_id FROM oplata_kv o"
    " WHERE o.source_tx_id = ANY(%(k)s::text[]) OR o.id = ANY(%(k)s::text[]) LIMIT 20"
)
_SQL_ID_LOG = (
    "SELECT external_id, contract_number, change_type::text AS tur FROM transaction_change_logs"
    " WHERE external_id = ANY(%(k)s::text[]) LIMIT 20"
)
_SQL_SS_TX = (
    "SELECT t.id, t.external_id, t.contract_number, t.txn_date, t.amount, t.direction::text AS yon,"
    " t.status::text AS holat, bk.code AS bank, left(t.from_name, 120) AS tolovchi,"
    " left(t.description, 300) AS izoh FROM transactions t LEFT JOIN banks bk ON bk.id = t.bank_id"
    " WHERE t.txn_date >= %(a)s AND t.txn_date < %(b)s AND t.amount BETWEEN %(s0)s AND %(s1)s"
    " AND (%(bank)s::text IS NULL OR bk.code = %(bank)s::text)"
    " ORDER BY t.txn_date DESC LIMIT 30"
)
_SQL_SS_OKV = (
    "SELECT o.id, o.contract_no, o.\"date\" AS sana, o.payment_amount, o.source_tx_id FROM oplata_kv o"
    " WHERE o.\"date\" BETWEEN %(d0)s AND %(d1)s AND abs(o.payment_amount) BETWEEN %(s0)s AND %(s1)s"
    " ORDER BY o.\"date\" DESC LIMIT 30"
)
_SQL_MIJOZ_OKV = (
    "SELECT o.contract_no, min(o.client) AS client, COUNT(*) AS soni, COALESCE(SUM(o.payment_amount), 0) AS jami"
    " FROM oplata_kv o WHERE o.client ILIKE ALL(%(p)s::text[]) GROUP BY o.contract_no ORDER BY soni DESC LIMIT 20"
)
_SQL_MIJOZ_CRM = (
    "SELECT contract_number, customer_name FROM crm_contracts"
    " WHERE found AND customer_name ILIKE ALL(%(p)s::text[]) LIMIT 20"
)
_SOZLAMALAR = ("oplatykv.txMinDate", "oplatykv.txAutoSyncMinutes")
_BEKOR_RE = re.compile(r"(?i)растор|отмен|bekor|cancel|trash")


# ---------------------------------------------------------------------------
# DB yig'ish
# ---------------------------------------------------------------------------
@dataclass
class DbNatija:
    shartnomalar: List[str] = field(default_factory=list)     # kirish shartnomalari (asl)
    kanon: List[str] = field(default_factory=list)            # har biri uchun CRM keshidagi found shakli
    variantlar: List[str] = field(default_factory=list)
    kesh: Optional[List[Dict[str, Any]]] = None
    topilgan: Optional[Set[str]] = None
    okv: List[Okv] = field(default_factory=list)
    okv_qisman: bool = False
    okv_xato: bool = False                                    # Q2 qatorlari o'qilmadi (d.okv bo'sh = noma'lum)
    okv_jami: Optional[List[Dict[str, Any]]] = None
    tx: List[Tx] = field(default_factory=list)
    tx_qisman: bool = False
    tx_xato: bool = False                                     # Q3 qatorlari o'qilmadi
    tx_jami: Optional[List[Dict[str, Any]]] = None
    skelet: List[str] = field(default_factory=list)
    loglar: Optional[List[Dict[str, Any]]] = None
    tarix: Optional[List[Dict[str, Any]]] = None
    vznos: Optional[List[Dict[str, Any]]] = None
    perebroska: Optional[List[Dict[str, Any]]] = None
    arizalar: Optional[List[Dict[str, Any]]] = None
    xonpay: Optional[List[Dict[str, Any]]] = None
    xonpay_kirish: List[Dict[str, Any]] = field(default_factory=list)   # /tolov <UUID>: Billing qatori
    xonpay_tx: List[Dict[str, Any]] = field(default_factory=list)       # /tolov <UUID>: bank izohidagi tx (zaxira)
    izoh_tx: List[Tx] = field(default_factory=list)
    tx_min: Optional[date] = None
    sync_daq: int = 0
    maqsad: Set[str] = field(default_factory=set)
    nomzodlar: List[str] = field(default_factory=list)
    nomzod_soni: int = 0
    gid: str = ""
    manba: str = ""                                           # shartnoma qayerdan: kirish | baza | crm
    xatolar: Dict[str, str] = field(default_factory=dict)     # bo'lim -> sabab (UNKNOWN)
    ulanish_xato: str = ""
    chiqarilgan: List[str] = field(default_factory=list)      # boshqa found shartnoma (variant) chiqarildi
    yolgiz: Optional[Dict[str, Any]] = None                   # kirish -> bitta aniq to'lov (_yolgiz_of)


class _Sorovchi:
    """Bitta kursor ustida bo'limli so'rovlar: xato va deadline shu bo'limga yoziladi."""

    def __init__(self, cur: Any, d: DbNatija, dl: float) -> None:
        self.cur, self.d, self.dl = cur, d, dl

    def __call__(self, bolim: str, sql: str, params: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        qolgan = self.dl - _mono()
        if qolgan < _MIN_QOLGAN_S:
            self.d.xatolar.setdefault(bolim, C.TOLOV_SABAB_VAQT)
            return None
        try:
            if qolgan * 1000 < C.FACTS_STATEMENT_TIMEOUT_MS:
                self.cur.execute("SET LOCAL statement_timeout = %s", (int(qolgan * 1000),))
            return SF._rows(self.cur, sql, params)
        except Exception as exc:  # noqa: BLE001 - bo'lim xatosi qolganlarini to'xtatmaydi
            msg = SF._err(exc)
            log.warning("tolov %s so'rovi yiqildi: %s", bolim, msg)
            self.d.xatolar.setdefault(bolim, _toza(msg, 160))
            return None


def _tx_of(r: Dict[str, Any], p: str = "") -> Tx:
    g = r.get
    return Tx(
        id=_s(g(p + "id") if p else g("id")), external_id=_s(g(p + "ext" if p else "external_id")),
        holat=_s(g(p + "holat")), vaqt=g(p + "vaqt"), summa=abs(_dec(g(p + "summa"))),
        yon=_s(g(p + "yon")) or "IN", shartnoma=_s(g(p + "shartnoma")), manual=bool(g(p + "manual")),
        xato_hidden=bool(g(p + "xato_hidden")), manba=_s(g(p + "manba")), kat=_s(g(p + "kat")),
        subkat=_s(g(p + "subkat")), bank=_s(g(p + "bank")), hisob4=_s(g(p + "hisob4")), gid=_s(g(p + "gid")),
        okv_id=_s(g("okv_id")) if not p else "", okv_shartnoma=_s(g("okv_shartnoma")) if not p else "",
        izoh=_s(g("izoh")) if not p else "",
    )


def _okv_of(r: Dict[str, Any]) -> Okv:
    sana = r.get("sana")
    o = Okv(
        id=_s(r.get("id")), shartnoma=_s(r.get("contract_no")),
        sana=sana.isoformat() if isinstance(sana, (date, datetime)) else _s(sana)[:10],
        summa=_dec(r.get("payment_amount")), first=_dec_n(r.get("first_installment")),
        monthly=_dec_n(r.get("monthly_amount")), turi=_s(r.get("turi")), tx_type=_s(r.get("tx_type")),
        usul=_s(r.get("payment_method")), obyekt=_s(r.get("object")), purpose=_s(r.get("purpose")),
        source_tx_id=_s(r.get("source_tx_id")), batch=_s(r.get("import_batch_id")),
        pgroup=_s(r.get("perereboska_group_id")), qolda=bool(r.get("was_manually_edited")),
        tx_kalit=_s(r.get("tx_kalit")),
        yaratilgan=r.get("created_at") if isinstance(r.get("created_at"), datetime) else None,
        yangilangan=r.get("updated_at") if isinstance(r.get("updated_at"), datetime) else None,
    )
    if r.get("tx_id"):
        o.tx = _tx_of(r, "tx_")
        o.tx.id = _s(r.get("tx_id"))
    return o


def _like(s: str) -> str:
    return "%" + s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _kun_chegarasi(d: date) -> datetime:
    """Toshkent kunining oxiri (23:59:59.999) tz'siz UTC: syncFromTransactions txMinDate bilan bir xil."""
    return config.naive_utc(config.local_day_bounds_utc(d)[1] - timedelta(milliseconds=1))


def _resolve(q: _Sorovchi, k: Kirish, d: DbNatija) -> None:
    """Kirishdan shartnoma(lar)ni topadi: id, summa+sana, mijoz. Ko'p nomzod -> d.nomzodlar."""
    if k.tur == "shartnoma":
        d.shartnomalar, d.manba = list(k.shartnomalar), "kirish"
        return
    if k.tur == "id":
        komp = parse_composite(k.id)
        g = komp.general_id if komp and komp.general_id.isdigit() else (k.id if k.id.isdigit() else "")
        d.gid = g
        d.maqsad.add(k.id)
        txlar = q("kirish", _SQL_ID_TX, {"s": k.id, "g": g or None}) or []
        kalitlar = _uniq([k.id] + [_s(r.get("external_id")) for r in txlar] + [_s(r.get("id")) for r in txlar])
        okvlar = q("kirish", _SQL_ID_OKV, {"k": kalitlar}) or []
        loglar = q("kirish", _SQL_ID_LOG, {"k": kalitlar}) or []
        for r in txlar:
            d.maqsad.update(x for x in (_s(r.get("id")), _s(r.get("external_id"))) if x)
        for r in okvlar:
            d.maqsad.update(x for x in (_s(r.get("id")), _s(r.get("source_tx_id"))) if x)
        d.shartnomalar = _uniq([_s(r.get("contract_number")) for r in txlar]
                               + [_s(r.get("contract_no")) for r in okvlar]
                               + [_s(r.get("contract_number")) for r in loglar])[:C.TOLOV_SHARTNOMA_MAX]
        d.manba = "baza"
        tanlov = [r for r in txlar if k.id in (_s(r.get("id")), _s(r.get("external_id")))] or (
            txlar if len(txlar) == 1 else [])
        if tanlov:
            d.yolgiz = _yolgiz_of(tanlov[0], okvlar)
        elif not txlar and parse_composite(k.id) is not None:
            d.yolgiz = _yolgiz_komp(k.id, okvlar)
        if not d.shartnomalar:
            for r in txlar[:_NOMZOD_MAX]:
                d.nomzodlar.append("tx %s | %s | %s | shartnoma yo'q" % (
                    qisqa_id(r.get("external_id") or r.get("id")), SF._vaqt(r.get("txn_date")) or "-",
                    pul(_dec(r.get("amount")) * (1 if _s(r.get("yon")) != "OUT" else -1))))
            d.nomzod_soni = len(txlar)
        return
    if k.tur == "xonpay":
        _resolve_xonpay(q, k, d)
        return
    if k.tur == "summa_sana" and k.sana is not None and k.summa is not None:
        d0, d1 = k.sana - timedelta(days=k.kun), k.sana + timedelta(days=k.kun)
        a, b = config.local_day_bounds_utc(d0)[0], config.local_day_bounds_utc(d1)[1]
        s0, s1 = k.summa - _TIYIN, k.summa + _TIYIN
        txlar = q("kirish", _SQL_SS_TX, {"a": config.naive_utc(a), "b": config.naive_utc(b), "s0": s0, "s1": s1,
                                         "bank": k.bank or None}) or []
        okvlar = q("kirish", _SQL_SS_OKV, {"d0": d0, "d1": d1, "s0": s0, "s1": s1}) or []
        tolovlar: Dict[str, Tuple[str, str, str]] = {}   # kalit -> (shartnoma, sana, qator)
        tx_qator: Dict[str, Dict[str, Any]] = {}
        for r in txlar:
            kalit = _s(r.get("external_id")) or _s(r.get("id"))
            tx_qator[kalit] = r
            sh, vaqt = _s(r.get("contract_number")), SF._vaqt(r.get("txn_date")) or ""
            tolovlar[kalit] = (sh, vaqt, "tx %s | %s | %s | %s %s" % (
                qisqa_id(kalit), sh or "shartnoma yo'q", vaqt or "-", _s(r.get("holat")), _s(r.get("bank"))))
        for r in okvlar:
            kalit = _s(r.get("source_tx_id")) or _s(r.get("id"))
            if kalit in tolovlar:
                continue
            sh, sana = _s(r.get("contract_no")), SF._vaqt(r.get("sana")) or ""
            tolovlar[kalit] = (sh, sana, "okv %s | %s | %s | %s" % (
                qisqa_id(kalit), sh, sana or "-", pul(r.get("payment_amount"))))
        d.nomzod_soni = len(tolovlar)
        if len(tolovlar) == 1:
            kalit, (sh, _sana, _q) = next(iter(tolovlar.items()))
            d.maqsad.add(kalit)
            if kalit in tx_qator:
                d.yolgiz = _yolgiz_of(tx_qator[kalit], okvlar)
            if sh:
                d.shartnomalar, d.manba = [sh], "baza"
        if not d.shartnomalar:
            for _k, (_sh, _sana, qator) in sorted(tolovlar.items(), key=lambda x: x[1][1], reverse=True)[:_NOMZOD_MAX]:
                d.nomzodlar.append(qator)
        return
    if k.tur == "mijoz":
        qismlar = [_like(p) for p in k.mijoz.split()]
        okvlar = q("kirish", _SQL_MIJOZ_OKV, {"p": qismlar}) or []
        crmlar = q("kirish", _SQL_MIJOZ_CRM, {"p": qismlar}) or []
        nomzod: Dict[str, str] = {}
        for r in okvlar:
            nomzod.setdefault(_s(r.get("contract_no")), "okv %s | %s | %s qator | jami %s" % (
                _s(r.get("contract_no")), mijoz_ismi(r.get("client")) or "-", r.get("soni"), pul(r.get("jami"))))
        for r in crmlar:
            nomzod.setdefault(_s(r.get("contract_number")), "crm_kesh %s | %s" % (
                _s(r.get("contract_number")), mijoz_ismi(r.get("customer_name")) or "-"))
        nomzod.pop("", None)
        d.nomzod_soni = len(nomzod)
        if len(nomzod) == 1:
            d.shartnomalar, d.manba = list(nomzod), "baza"
        else:
            d.nomzodlar = list(nomzod.values())[:_NOMZOD_MAX]


_OT_RE = re.compile(r"(?i)(?:^|[\s,.;:])(?:от|ot)\s+([^\d,;:()\[\]\"]{5,80})\s*$")


def _tolovchi(ism: Any, izoh: Any) -> str:
    """To'lovchi: izoh oxiridagi 'от <F.I.O.>' (tranzit/boshqa bank o'tkazmasi), bo'lmasa from_name. Lotinda."""
    m = _OT_RE.search(_s(izoh))
    return mijoz_ismi(m.group(1)) if m else mijoz_ismi(ism)


def _okv_holati(kalit: str, tx_id: str, okvlar: Sequence[Dict[str, Any]]) -> Tuple[bool, str]:
    """Shu to'lovning OplatyKv qatori: (bormi, shartnomasi)."""
    for r in okvlar:
        if (kalit and _s(r.get("source_tx_id")) in (kalit, tx_id)) or _s(r.get("id")) in (kalit, tx_id):
            return True, _s(r.get("contract_no"))
    return False, ""


def _yolgiz_of(r: Dict[str, Any], okvlar: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    """Tranzaksiya qatori -> bitta aniq to'lov: CRM ID qidiruvi va shartnomasiz xulosa uchun."""
    kalit = _s(r.get("external_id")) or _s(r.get("id"))
    vaqt = r.get("txn_date")
    sana = config.to_local(vaqt).date().isoformat() if isinstance(vaqt, datetime) else _s(vaqt)[:10]
    okv_bor, okv_sh = _okv_holati(kalit, _s(r.get("id")), okvlar)
    return {"kalit": kalit, "tx_id": _s(r.get("id")), "sana": sana, "summa": abs(_dec(r.get("amount"))),
            "shartnoma": _s(r.get("contract_number")), "tolovchi": _tolovchi(r.get("tolovchi"), r.get("izoh")),
            "izoh": _s(r.get("izoh")), "bizda": True, "okv_bor": okv_bor, "okv_sh": okv_sh}


def _yolgiz_komp(kid: str, okvlar: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    """Bizda tranzaksiyasi yo'q kompozit ID: sana va summa (tiyin -> so'm) ID ning o'zidan."""
    k = parse_composite(kid)
    sana = k.iso if k is not None else ""
    summa = abs(k.amount) / 100 if k is not None and k.amount is not None else _NOL
    okv_bor, okv_sh = _okv_holati(kid, "", okvlar)
    return {"kalit": kid, "tx_id": "", "sana": sana, "summa": summa, "shartnoma": "", "tolovchi": "", "izoh": "",
            "bizda": False, "okv_bor": okv_bor, "okv_sh": okv_sh}


def _resolve_xonpay(q: _Sorovchi, k: Kirish, d: DbNatija) -> None:
    """/tolov <UUID>: xonpay_transactions (xonpay_uuid yoki external_id) -> shartnoma; Billing'da bo'lmasa bank
    izohidagi XONPAY:(UUID) (so'nggi 120 kun). To'lovning o'zi (UUID, external_id, bank tx) maqsad belgisi oladi."""
    u = k.id.lower()
    d.maqsad.update((u, u.upper()))
    rows = q("kirish", _SQL_XONPAY_UUID, {"u": [u, u.upper()]}) or []
    d.xonpay_kirish = rows
    for r in rows:
        d.maqsad.update(x for x in (_s(r.get("external_id")), _s(r.get("matched_tx_id")),
                                    _s(r.get("matched_external_id"))) if x)
    shlar = _uniq(_s(r.get("contract")) for r in rows)
    if not shlar:
        dan = config.naive_utc(config.now_utc() - timedelta(days=_IZOH_OYNA_KUN))
        d.xonpay_tx = q("kirish", _SQL_XONPAY_TX, {"dan": dan, "p": _like(u)}) or []
        for r in d.xonpay_tx:
            d.maqsad.update(x for x in (_s(r.get("id")), _s(r.get("external_id"))) if x)
        shlar = _uniq(_s(r.get("contract_number")) for r in d.xonpay_tx)
    d.shartnomalar, d.manba = shlar[:C.TOLOV_SHARTNOMA_MAX], "baza"
    if d.shartnomalar:
        return
    for r in d.xonpay_tx[:_NOMZOD_MAX]:
        d.nomzodlar.append("tx %s | %s | %s | shartnoma yo'q" % (
            qisqa_id(r.get("external_id") or r.get("id")), SF._vaqt(r.get("txn_date")) or "-",
            pul(_dec(r.get("amount")) * (1 if _s(r.get("yon")) != "OUT" else -1))))
    for x in xonpay_qatorlari(rows)[:_NOMZOD_MAX]:
        d.nomzodlar.append("xonpay %s | shartnoma yo'q | %s" % (_uuid_qisqa(x), _xonpay_holat_matn(x)))
    d.nomzod_soni = len(d.nomzodlar)
    if not d.nomzodlar and "kirish" not in d.xatolar:
        d.nomzodlar.append(C.TOLOV_XONPAY_TOPILMADI)


def _asosiy(q: _Sorovchi, d: DbNatija) -> None:
    """Shartnoma(lar) bo'yicha Q1-Q8."""
    v = _uniq(x for s in d.shartnomalar for x in variantlar(s))[:_VARIANT_JAMI_MAX]
    d.variantlar = v
    _yadro(q, d, v)
    asosiy_xato = any(b in d.xatolar for b in ("crm_kesh", "oplata_kv", "transactions"))
    if not d.kesh and not d.okv and not d.tx and not asosiy_xato:
        topildi: List[str] = []
        sk = _uniq(skelet(s) for s in d.shartnomalar)
        for sql in _SQL_SKELET:
            for r in q("kirish", sql, {"sk": sk}) or []:
                topildi.append(_s(r.get("s")))
        topildi = [x for x in _uniq(topildi) if x not in v][:10]
        if topildi:
            d.skelet = topildi
            d.variantlar = v = v + topildi
            _yadro(q, d, v)
    _kanonla(d)
    kalitlar = _uniq([o.source_tx_id for o in d.okv] + [t.external_id for t in d.tx] + list(d.maqsad))
    dan = config.naive_utc(config.now_utc() - timedelta(days=_TARIX_KUN))
    d.loglar = q("bank_izi", _SQL_LOG, {"dan": dan, "v": v, "k": kalitlar})
    d.tarix = q("okv_tarix", _SQL_OKV_TARIX, {"dan": dan, "v": v})
    txids = _uniq([t.id for t in d.tx] + [o.tx.id for o in d.okv if o.tx])
    # XonPay kontekstdan oldin: u farq kodini o'zgartiradi (yo'ldagi to'lov BIZDA_YOQ / CRM_FARQ emas)
    d.xonpay = q("xonpay", _SQL_XONPAY, {"v": v, "t": txids})
    d.vznos = q("kontekst", _SQL_VZNOS, {"v": v})
    d.perebroska = q("kontekst", _SQL_PEREBROSKA, {"v": v, "g": _uniq(o.pgroup for o in d.okv)})
    d.arizalar = q("kontekst", _SQL_ARIZA, {"v": v, "t": txids, "o": [o.id for o in d.okv]})
    if _izoh_kerak(d):
        dan_izoh = config.naive_utc(config.now_utc() - timedelta(days=_IZOH_OYNA_KUN))
        p = [_like(s) for s in d.shartnomalar]
        qq = ["%" + norm_contract(x) + "%" for x in v if norm_contract(x)]
        # alohida bo'lim: izoh qidiruvi yiqilsa [transactions] UNKNOWN bo'lmaydi
        rows = q("izoh", _SQL_IZOH, {"dan": dan_izoh, "v": v, "p": p, "q": qq}) or []
        # LIKE qism satrni ham topadi ('18MSOP26LA' -> '118MSOP26LA'): skelet bo'yicha aniq filtr
        sk = {skelet(x) for x in v}
        d.izoh_tx = [_tx_of(r) for r in rows if _izoh_mos(r.get("izoh"), sk)]


def _yadro(q: _Sorovchi, d: DbNatija, v: List[str]) -> None:
    kesh = q("crm_kesh", _SQL_KESH, {"v": v})
    d.kesh = kesh
    d.topilgan = None if kesh is None else {_s(r.get("contract_number")) for r in kesh if r.get("found")}
    rows = q("oplata_kv", _SQL_OKV, {"v": v, "lim": C.TOLOV_QATOR_MAX + 1})
    d.okv_xato = rows is None
    if rows is not None:
        d.okv_qisman = len(rows) > C.TOLOV_QATOR_MAX
        d.okv = [_okv_of(r) for r in rows[:C.TOLOV_QATOR_MAX]]
    d.okv_jami = q("oplata_kv", _SQL_OKV_JAMI, {"v": v})
    kalitlar = _uniq([o.source_tx_id for o in d.okv] + list(d.maqsad))
    rows = q("transactions", _SQL_TX, {"v": v, "k": kalitlar, "lim": C.TOLOV_QATOR_MAX + 1})
    d.tx_xato = rows is None
    if rows is not None:
        d.tx_qisman = len(rows) > C.TOLOV_QATOR_MAX
        d.tx = [_tx_of(r) for r in rows[:C.TOLOV_QATOR_MAX]]
    d.tx_jami = q("transactions", _SQL_TX_JAMI, {"v": v})


def _izoh_kerak(d: DbNatija) -> bool:
    """Q8 faqat XATO, kanonik emas yoki 0 natija bo'lsa."""
    if not d.okv and not d.tx:
        return True
    if d.topilgan is None:
        return False
    kanon = set(d.kanon) or set(d.shartnomalar)
    for o in d.okv:
        if o.source_tx_id and o.shartnoma not in d.topilgan:
            return True
        if o.shartnoma not in kanon and o.shartnoma not in d.topilgan:
            return True
    return False


def _kanonla(d: DbNatija) -> None:
    """Har kirish shartnomasi uchun found=true variant (variantlar tartibida), bo'lmasa asl."""
    d.kanon = []
    for s in d.shartnomalar:
        tanlov = s
        if d.topilgan:
            for v in variantlar(s) + d.skelet:
                if v in d.topilgan:
                    tanlov = v
                    break
        if tanlov not in d.kanon:
            d.kanon.append(tanlov)


def _db_collect(k: Kirish, dl: float, shartnomalar: Optional[List[str]] = None,
                maqsad: Optional[Set[str]] = None) -> DbNatija:
    """Q0-Q11 (dizayn 1.4). Hech qachon exception chiqarmaydi."""
    d = DbNatija()
    if maqsad:
        d.maqsad.update(maqsad)
    if k.tur == "shartnoma" and not shartnomalar:
        d.shartnomalar, d.manba = list(k.shartnomalar), "kirish"
    try:
        with SF._fx() as cur:
            q = _Sorovchi(cur, d, dl)
            st = q("kirish", "SELECT key, value, updated_at FROM settings WHERE key = ANY(%(k)s::text[])",
                   {"k": list(_SOZLAMALAR)}) or []
            sv = {_s(r.get("key")): r.get("value") for r in st}
            d.tx_min = SF._sana_param(sv.get("oplatykv.txMinDate"))
            d.sync_daq = max(0, SF._int(sv.get("oplatykv.txAutoSyncMinutes")))
            if shartnomalar:
                d.shartnomalar, d.manba = list(shartnomalar)[:C.TOLOV_SHARTNOMA_MAX], "crm"
            else:
                _resolve(q, k, d)
            if d.shartnomalar:
                _asosiy(q, d)
    except Exception as exc:  # noqa: BLE001 - ulanish yoki tranzaksiya xatosi
        d.ulanish_xato = _toza(SF._err(exc), 160) or C.TOLOV_SABAB_DB
        log.warning("tolov DB yiqildi: %s", d.ulanish_xato)
    return d


def _tegishli_filtr(d: DbNatija) -> None:
    """Variant boshqa (found=true) CRM shartnomasi bo'lsa, uning qatorlari chiqariladi."""
    if not d.topilgan:
        return
    kanon = set(d.kanon)
    begona = {s for s in d.topilgan if s not in kanon}
    if not begona:
        return
    d.chiqarilgan = sorted(begona)
    d.okv = [o for o in d.okv if o.shartnoma not in begona]
    d.tx = [t for t in d.tx if t.shartnoma not in begona or t.okv_shartnoma in kanon]
    if d.okv_jami is not None:
        d.okv_jami = [r for r in d.okv_jami if _s(r.get("contract_no")) not in begona]
    if d.tx_jami is not None:
        d.tx_jami = [r for r in d.tx_jami if _s(r.get("contract_number")) not in begona]
    if d.loglar is not None:
        d.loglar = [r for r in d.loglar if _s(r.get("contract_number")) not in begona]
    if d.tarix is not None:
        d.tarix = [r for r in d.tarix if _s(r.get("eski")) not in begona]
    if d.xonpay is not None:
        d.xonpay = [r for r in d.xonpay if _s(r.get("contract")) not in begona]
    if d.vznos is not None:
        d.vznos = [r for r in d.vznos if _s(r.get("contract_no")) not in begona]


# ---------------------------------------------------------------------------
# CRM: faqat GET /payment-history
# ---------------------------------------------------------------------------
class _RedirectTaqiq(urllib.request.HTTPRedirectHandler):
    """Redirect taqiq: Authorization boshqa hostga ketmasin."""

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        raise urllib.error.HTTPError(req.full_url, code, "redirect taqiqlangan", headers, fp)


def _opener() -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(
        urllib.request.ProxyHandler({}),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        _RedirectTaqiq(),
    )


def _urlopen(req: urllib.request.Request, timeout: float) -> Any:
    """Tarmoq (testda almashtiriladi)."""
    return _opener().open(req, timeout=timeout)


def _crm_base() -> str:
    base = config.env(C.TOLOV_CRM_ENV_BASE, "").strip() or C.TOLOV_CRM_BASE_DEFAULT
    parts = urlsplit(base)
    if parts.scheme != "https" or not parts.netloc or parts.query or parts.fragment or "@" in parts.netloc:
        return ""
    return base.rstrip("/")


_ENV_JONLI: Dict[str, Tuple[Tuple[str, int, int], str]] = {}   # nom -> ((fayl, mtime_ns, hajm), qiymat)
_ENV_JONLI_LOCK = threading.Lock()
_ENV_JONLI_KALITLAR = (C.TOLOV_CRM_ENV_YOQ, C.TOLOV_CRM_ENV_KUNLIK)   # faqat shular; sir emas


def _env_jonli(nom: str, default: str) -> str:
    """Kill switch va kunlik cheklov restartsiz: env fayli (AGENTS_ENV_FILE) o'zgarsa (mtime/hajm) qayta
    o'qiladi. config.env fayl keshi jarayon umri davomida o'zgarmaydi. os.environ ustun (config.env kabi).
    Xotirada faqat shu kalit qiymati turadi, fayldagi boshqa kalitlar (sirlar) saqlanmaydi."""
    if nom not in _ENV_JONLI_KALITLAR:
        raise ValueError("jonli env faqat kill switch va kunlik cheklov uchun")
    if nom in os.environ:
        return os.environ[nom]
    yol = config.env_file_path()
    try:
        st = os.stat(yol)
    except OSError:
        return config.env(nom, default)
    belgi = (str(yol), st.st_mtime_ns, st.st_size)
    with _ENV_JONLI_LOCK:
        e = _ENV_JONLI.get(nom)
        if e is not None and e[0] == belgi:
            return e[1]
    try:
        with open(yol, encoding="utf-8") as fh:
            qiymat = config.parse_env_text(fh.read()).get(nom, default)
    except (OSError, UnicodeDecodeError, ValueError):
        return config.env(nom, default)
    with _ENV_JONLI_LOCK:
        _ENV_JONLI[nom] = (belgi, qiymat)
    return qiymat


def _crm_yoqilgan() -> bool:
    """Eski to'g'ridan GET: default o'chiq (prod'da 404), AGENTS_TOLOV_CRM=1 yoqadi."""
    raw = _env_jonli(C.TOLOV_CRM_ENV_YOQ, C.TOLOV_CRM_YOQ_DEFAULT).strip().lower()
    return raw not in ("", "0", "false", "no", "off")


def _kunlik_limit() -> int:
    raw = _env_jonli(C.TOLOV_CRM_ENV_KUNLIK, "").strip()
    try:
        return max(0, int(raw)) if raw else C.TOLOV_CRM_KUNLIK_DEFAULT
    except ValueError:
        log.warning("%s butun son emas, default %s", C.TOLOV_CRM_ENV_KUNLIK, C.TOLOV_CRM_KUNLIK_DEFAULT)
        return C.TOLOV_CRM_KUNLIK_DEFAULT


def _crm_holati() -> Optional[str]:
    """CRM chaqirish mumkinmi: None yoki UNKNOWN sababi (qiymatlar o'qilmaydi, faqat bor-yo'qligi)."""
    if not _crm_yoqilgan():
        return C.TOLOV_SABAB_OCHIRILGAN
    if not config.env(C.TOLOV_CRM_ENV_KEY, "").strip() or not config.env(C.TOLOV_CRM_ENV_SECRET, "").strip():
        return C.TOLOV_SABAB_KALIT_YOQ
    if not _crm_base():
        return C.TOLOV_SABAB_MANZIL
    return None


def _crm_params(params: Dict[str, Any]) -> Dict[str, str]:
    """Parametrlar oq ro'yxati. Begona kalit yoki limit > 500 -> ValueError."""
    out: Dict[str, str] = {}
    for key, val in params.items():
        if key not in C.TOLOV_CRM_PARAMLAR:
            raise ValueError("CRM parametri oq ro'yxatda yo'q: " + str(key)[:40])
        sval = _s(val)
        if not sval or len(sval) > 190:
            raise ValueError("CRM parametri bo'sh yoki uzun: " + key)
        if key == "limit" and (not sval.isdigit() or not 1 <= int(sval) <= C.TOLOV_CRM_LIMIT_MAX):
            raise ValueError("CRM limit 1..500")
        out[key] = sval
    return out


def _rows_of(data: Any) -> List[Any]:
    """Konvert: raw = d.data ?? d; rows = raw.data ?? raw (ro'yxat bo'lmasa [])."""
    raw = data.get("data", data) if isinstance(data, dict) else data
    rows = raw.get("data", raw) if isinstance(raw, dict) else raw
    return rows if isinstance(rows, list) else []


def _sirsiz(text: str, *sirlar: str) -> str:
    out = text or ""
    for s in sirlar:
        if s and len(s) >= 4:
            out = out.replace(s, "***")
    return _toza(out, 160)


_BOLAK = 64 * 1024


def _sokit_muddat(resp: Any, soniya: float) -> None:
    """Keyingi recv kutishini qolgan vaqtga tushiradi (best-effort; javob obyektida soket bo'lmasa jim)."""
    try:
        sock = resp.fp.raw._sock
        sock.settimeout(max(0.05, soniya))
    except (AttributeError, OSError, ValueError):
        pass


def _javob_oqi(resp: Any, req_dl: float, maks: int = C.TOLOV_CRM_JAVOB_MAX) -> bytes:
    """Javob tanasi 64 KB bo'laklab: umumiy muddat (req_dl) va 5 MB chegarasi har bo'lakdan keyin.
    read1: bitta chaqiruvda ko'pi bilan bitta recv (sekin server bir read ichida osilib qolmaydi)."""
    oqi = getattr(resp, "read1", None) or resp.read
    buf = bytearray()
    while True:
        qolgan = req_dl - _mono()
        if qolgan <= 0:
            raise CrmXato("timeout", qayta=True)
        _sokit_muddat(resp, qolgan)
        bolak = oqi(_BOLAK)
        if not bolak:
            return bytes(buf)
        buf += bolak
        if len(buf) > maks:
            raise CrmXato("javob %d MB dan katta" % (maks // (1024 * 1024)))
        if _mono() > req_dl:
            raise CrmXato("timeout", qayta=True)


def _crm_get(params: Dict[str, Any], *, timeout_s: float = C.TOLOV_CRM_TIMEOUT_S,
             dl: Optional[float] = None) -> List[Dict[str, Any]]:
    """YAGONA tarmoq funksiyasi: GET {CLIENT_BASE}/payment-history?<oq ro'yxat>. Bitta urinish.

    Qaytadi: qisqartirilgan qatorlar (_crm_qisqa). Xato -> CrmXato (qayta=True: 5xx yoki tarmoq).
    Kalit faqat shu funksiya ichida, so'rov obyektida turadi. Muddat: so'rov boshidan
    min(timeout_s, dl gacha qolgan) (socket timeout har amalga alohida, shu sabab o'qish bo'laklab).
    """
    qs = _crm_params(params)
    base = _crm_base()
    if not base:
        raise CrmXato(C.TOLOV_SABAB_MANZIL)
    host = urlsplit(base).netloc
    url = base + C.TOLOV_CRM_YOL + "?" + urlencode(qs)
    if urlsplit(url).netloc != host or urlsplit(url).scheme != "https":
        raise CrmXato(C.TOLOV_SABAB_MANZIL)
    kalit = config.env(C.TOLOV_CRM_ENV_KEY, "").strip()
    sir = config.env(C.TOLOV_CRM_ENV_SECRET, "").strip()
    if not kalit or not sir:
        raise CrmXato(C.TOLOV_SABAB_KALIT_YOQ)
    token = base64.b64encode(("%s:%s" % (kalit, sir)).encode("utf-8")).decode("ascii")
    req = urllib.request.Request(url, data=None, method="GET", headers={
        "Accept": "application/json", "Authorization": "Basic " + token, "User-Agent": "xon-agents/tolov",
    })
    bosh = _mono()
    muddat = float(timeout_s) if dl is None else min(float(timeout_s), dl - bosh)
    muddat = max(1.0, muddat)
    req_dl = bosh + muddat
    try:
        with _urlopen(req, timeout=muddat) as resp:
            oxirgi = resp.geturl() if hasattr(resp, "geturl") else url
            if urlsplit(oxirgi).netloc != host:
                raise CrmXato("boshqa hostga yo'naltirildi")
            raw = _javob_oqi(resp, req_dl)
    except CrmXato:
        raise
    except urllib.error.HTTPError as exc:
        code = int(getattr(exc, "code", 0) or 0)
        if 300 <= code < 400:
            raise CrmXato("redirect taqiqlangan (%d)" % code) from None
        raise CrmXato("HTTP %d" % code, qayta=code >= 500) from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as exc:
        sabab = "timeout" if isinstance(exc, (socket.timeout, TimeoutError)) else _sirsiz(
            "%s: %s" % (exc.__class__.__name__, getattr(exc, "reason", exc)), kalit, sir, token)
        raise CrmXato(sabab or "tarmoq xatosi", qayta=True) from None
    except Exception as exc:  # noqa: BLE001 - kutilmagan: matn kalitsiz
        raise CrmXato(_sirsiz("%s: %s" % (exc.__class__.__name__, exc), kalit, sir, token)) from None
    finally:
        del token, kalit, sir
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise CrmXato("javob JSON emas") from None
    return [x for x in (_crm_qisqa(p) for p in _rows_of(data)) if x is not None]


_XONPAY_RE = re.compile(
    r"XONPAY[:\s]*\(?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\)?", re.I)


def _crm_qisqa(p: Any) -> Optional[Dict[str, Any]]:
    """CRM qatoridan faqat kerakli maydonlar. full_name -> to'liq ism (lotin), purpose -> XonPay UUID + 80 belgi."""
    if not isinstance(p, dict):
        return None
    typ = p.get("type")
    purpose = repair_mojibake(_s(p.get("purpose")))
    m = _XONPAY_RE.search(purpose)
    return {
        "contract": repair_mojibake(_ru(p.get("contract"))).strip()[:128],
        "amount": _dec(p.get("amount")), "initial": _dec(p.get("initial_amount")),
        "monthly": _dec(p.get("monthly_amount")), "other": _dec(p.get("other_amount")),
        "sana": _s(p.get("date_paid"))[:10], "external_id": _s(p.get("external_id"))[:255],
        "type_key": repair_mojibake(_s(typ.get("key")))[:60] if isinstance(typ, dict) else "",
        "type": repair_mojibake(_ru(typ))[:60], "method": repair_mojibake(_ru(p.get("payment_method")))[:60],
        "status": repair_mojibake(_ru(p.get("status")))[:40], "problematic": _bool(p.get("is_problematic")),
        "from_bank": _bool(p.get("is_received_from_bank")), "order_id": _s(p.get("order_id"))[:32],
        "obyekt": repair_mojibake(_ru(p.get("object_name")))[:60],
        "xonpay_uuid": m.group(1).upper() if m else "",
        # purpose: faqat egasiga (pasport, telefon, karta maskalangan); agent blokiga faqat raqamlar
        "purpose": _izoh_pii(purpose, _IZOH_MAX),
        "izoh_raqam": _izoh_raqam(purpose),
        "ism": mijoz_ismi(repair_mojibake(_ru(p.get("full_name")))),
    }


def _crm_row(d: Dict[str, Any], manba: str) -> CrmTolov:
    return CrmTolov(manba=manba, **{k: d.get(k) for k in (
        "contract", "amount", "initial", "monthly", "other", "sana", "external_id", "type_key", "type", "method",
        "status", "problematic", "from_bank", "order_id", "obyekt", "xonpay_uuid", "purpose", "izoh_raqam",
        "ism")})


def _kesh_kalit(params: Dict[str, Any]) -> Tuple[Tuple[str, str], ...]:
    return tuple(sorted((k, _s(v)) for k, v in params.items()))


def _kesh_ol(kalit: Tuple[Tuple[str, str], ...]) -> Optional[List[Dict[str, Any]]]:
    with _KESH_LOCK:
        e = _KESH.get(kalit)
        if e is None:
            return None
        if _mono() - e[0] >= C.TOLOV_CRM_KESH_S:
            _KESH.pop(kalit, None)
            return None
        return list(e[1])


def _kesh_qoy(kalit: Tuple[Tuple[str, str], ...], rows: List[Dict[str, Any]]) -> None:
    with _KESH_LOCK:
        _KESH[kalit] = (_mono(), list(rows))
        if len(_KESH) > _KESH_MAX:
            for k in sorted(_KESH, key=lambda x: _KESH[x][0])[: len(_KESH) - _KESH_MAX]:
                _KESH.pop(k, None)


def kesh_tozala() -> None:
    with _KESH_LOCK:
        _KESH.clear()


def _kunlik_oshir() -> int:
    """Kunlik CRM so'rov hisoblagichi (agents.kv_store, bot sxemasi; biznes jadval emas). Yangi qiymat.
    kv_store ishlamasa jarayon xotirasidagi zaxira hisoblagich."""
    kalit = C.kv_key(C.KV_TOLOV_CRM_KUN, sana=config.today_local().strftime("%Y%m%d"))
    try:
        row = db.fetchone(
            "INSERT INTO " + db.KV_TABLE + " AS kv (k, value, updated_at) VALUES (%s, '1', %s)"
            " ON CONFLICT (k) DO UPDATE SET value = (CASE WHEN kv.value ~ '^[0-9]{1,9}$'"
            " THEN kv.value::bigint + 1 ELSE 1 END)::text, updated_at = EXCLUDED.updated_at RETURNING value",
            (kalit, config.now_utc()), kind="agents",
        )
        return SF._int((row or {}).get("value")) or 1
    except Exception as exc:  # noqa: BLE001 - hisoblagich xatosi CRM'ni to'xtatmaydi
        log.warning("tolov kunlik hisoblagich (kv) yozilmadi: %s", exc.__class__.__name__)
        with _KUNLIK_LOCK:
            _KUNLIK_XOTIRA[kalit] = _KUNLIK_XOTIRA.get(kalit, 0) + 1
            return _KUNLIK_XOTIRA[kalit]


class _CrmSessiya:
    """Bir prefetch: <= 7 tarmoq so'rovi, deadline, kesh, kunlik cheklov, parallellik 1."""

    def __init__(self, dl: float) -> None:
        self.dl = dl
        self.soni = 0
        self.kesh = 0
        self.vaqt: Optional[datetime] = None

    def olish(self, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        _crm_params(params)  # oq ro'yxat (tarmoqdan oldin)
        kalit = _kesh_kalit(params)
        hit = _kesh_ol(kalit)
        if hit is not None:
            self.kesh += 1
            return hit
        qolgan = self.dl - _mono()
        if qolgan < _MIN_QOLGAN_S or not _CRM_LOCK.acquire(timeout=max(0.0, qolgan)):
            raise CrmXato(C.TOLOV_SABAB_VAQT)
        try:
            hit = _kesh_ol(kalit)
            if hit is not None:
                self.kesh += 1
                return hit
            urinish = 0
            while True:
                if self.soni >= C.TOLOV_CRM_MAX_SOROV:
                    raise CrmXato(C.TOLOV_SABAB_SOROV)
                qolgan = self.dl - _mono()
                if qolgan < _MIN_QOLGAN_S:
                    raise CrmXato(C.TOLOV_SABAB_VAQT)
                if _kunlik_oshir() > _kunlik_limit():
                    raise CrmXato(C.TOLOV_SABAB_KUNLIK)
                self.soni += 1
                urinish += 1
                try:
                    rows = _crm_get(params, timeout_s=min(float(C.TOLOV_CRM_TIMEOUT_S), qolgan), dl=self.dl)
                except CrmXato as exc:
                    log.warning("tolov CRM GET: %s (urinish %d)", exc.sabab, urinish)
                    if exc.qayta and urinish < 2:
                        continue
                    raise
                self.vaqt = config.now_utc()
                _kesh_qoy(kalit, rows)
                return rows
        finally:
            _CRM_LOCK.release()


@dataclass
class CrmNatija:
    rows: List[CrmTolov] = field(default_factory=list)
    xato: str = ""
    toliq: bool = True
    trashed: List[str] = field(default_factory=list)
    izohlar: List[str] = field(default_factory=list)


def _crm_collect(kanon: Sequence[str], d: DbNatija, ses: _CrmSessiya) -> CrmNatija:
    """Reja: har shartnoma contract=<kanon>&limit=500; 0 qator va bekor bo'lsa trashed takrori."""
    cn = CrmNatija()
    kesh = {(_s(r.get("contract_number"))): r for r in (d.kesh or [])}
    for sh in kanon:
        maqsad = norm_contract(sh)
        try:
            rows = ses.olish({"contract": sh, "limit": C.TOLOV_CRM_LIMIT_MAX})
            if len(rows) >= C.TOLOV_CRM_LIMIT_MAX:
                cn.toliq = False
            mos = [r for r in rows if norm_contract(r.get("contract")) == maqsad]
            manba = "contract"
            k = kesh.get(sh)
            bekor = k is None or not k.get("found") or bool(_BEKOR_RE.search(_s(k.get("status"))))
            if not mos and bekor:
                rows = ses.olish({"contract": sh, "limit": C.TOLOV_CRM_LIMIT_MAX, "is_trashed": 1,
                                  "trashed_status": 1, "with_trashed": 1})
                if len(rows) >= C.TOLOV_CRM_LIMIT_MAX:
                    cn.toliq = False
                mos = [r for r in rows if norm_contract(r.get("contract")) == maqsad]
                if mos:
                    cn.trashed.append(sh)
                    manba = "trashed"
        except CrmXato as exc:
            cn.xato = exc.sabab
            return cn
        cn.rows += [_crm_row(r, manba) for r in mos]
    return cn


def _crm_txid(birlik_gids: Sequence[str], cn: CrmNatija, ses: _CrmSessiya) -> None:
    """Jufti topilmagan bank to'lovlari: transaction_id=<general_id>&limit=20 (shartnoma filtri yo'q)."""
    bor = {c.external_id for c in cn.rows if c.external_id}
    gids = list(birlik_gids[:_TXID_MAX])
    for i, g in enumerate(gids):
        if ses.soni >= C.TOLOV_CRM_MAX_SOROV:
            cn.izohlar.append("transaction_id qidiruvi: %d tasi so'ralmadi (%s)" % (len(gids) - i, C.TOLOV_SABAB_SOROV))
            return
        try:
            rows = ses.olish({"transaction_id": g, "limit": 20})
        except CrmXato as exc:
            cn.izohlar.append("transaction_id qidiruvi: " + exc.sabab)
            return
        for r in rows:
            ext = _s(r.get("external_id"))
            if ext and ext in bor:
                continue
            if ext:
                bor.add(ext)
            cn.rows.append(_crm_row(r, "transaction_id"))


# ---------------------------------------------------------------------------
# Panel ko'prigi: GET http://127.0.0.1:<PORT>/api/agent-bridge/payment-check (faqat o'qish)
# ---------------------------------------------------------------------------
class KoprikXato(Exception):
    """Ko'prik so'rovi bajarilmadi. sabab: tozalangan qisqa matn (kalitsiz)."""

    def __init__(self, sabab: str) -> None:
        super().__init__(sabab)
        self.sabab = sabab


@dataclass
class _KT:
    """Ko'prik to'lovi (ro'yxat juftlash uchun): ISO sana yoki '' (sheetda sana yo'q), ishorali summa va
    uning boshlang'ich/oylik qismi (CRM: turi bo'yicha butun summa; OplatyKv va sheet: first/monthly)."""
    sana: str
    summa: Decimal
    tur: str = ""
    qator: int = 0                            # sheet qatori (1 dan)
    bosh: Decimal = _NOL
    oylik: Decimal = _NOL
    ext: str = ""                             # CRM Внешний ID (XonPay UUID yoki bank kompoziti); faqat CRM
    usul: str = ""                            # CRM Способ (lotin, tozalangan); faqat CRM


@dataclass
class KoprikOkv:
    bosh: Decimal = _NOL
    oylik: Decimal = _NOL
    jami: Decimal = _NOL
    soni: int = 0
    tolovlar: List[_KT] = field(default_factory=list)


@dataclass
class KoprikCrm:
    topildi: bool = False
    xato: str = ""
    zaxira: bool = False                      # viaPaymentHistory: narx, reja va qoldiq yo'q
    narx: Optional[Decimal] = None
    reja_bosh: Optional[Decimal] = None
    reja_oylik: Optional[Decimal] = None
    bosh: Decimal = _NOL
    oylik: Decimal = _NOL
    jami: Decimal = _NOL
    qoldiq: Optional[Decimal] = None
    soni: int = 0
    tolovlar: List[_KT] = field(default_factory=list)


@dataclass
class KoprikSheet:
    id: str
    nomi: str
    mavjud: bool = False
    sabab: str = ""
    bosh: Decimal = _NOL
    oylik: Decimal = _NOL
    jami: Decimal = _NOL
    qatorlar: int = 0
    tolovlar: List[_KT] = field(default_factory=list)


@dataclass
class KoprikShartnoma:
    shartnoma: str
    mos: bool
    okv: KoprikOkv
    crm: KoprikCrm
    sheetlar: List[KoprikSheet] = field(default_factory=list)


@dataclass
class KoprikEksport:
    """GET exports elementi: qaysi qatorlar sheetga tushadi (faqat sozlama, sir yo'q) va oxirgi ish."""
    id: str
    nomi: str
    manba: str = "oplatakv"                   # oplatakv | transaction
    rejim: str = "replace"
    sana_dan: str = ""                        # dateFrom (YYYY-MM-DD) yoki ''
    obyektlar: List[str] = field(default_factory=list)
    kategoriyalar: List[str] = field(default_factory=list)
    turlar: List[str] = field(default_factory=list)
    hisoblar: List[str] = field(default_factory=list)
    belgi: str = ""                           # pos | neg | ''
    cron_yoq: bool = False
    cron_har: Optional[int] = None
    soat_dan: Optional[int] = None
    soat_gacha: Optional[int] = None
    kunlar: List[int] = field(default_factory=list)   # 0 = yakshanba .. 6 = shanba
    oxirgi_vaqt: Optional[datetime] = None    # lastRun.startedAt (aware UTC); None = hech ishlamagan
    oxirgi_holat: str = ""                    # ok | error
    oxirgi_qator: int = 0
    oxirgi_xato: str = ""


@dataclass
class KoprikNatija:
    xato: str = ""                            # butun ko'prik UNKNOWN sababi ('' = javob keldi)
    sheetlar: List[Tuple[str, str]] = field(default_factory=list)   # (id, nomi) ulangan sheetlar
    sheet_xom: Dict[str, str] = field(default_factory=dict)         # id -> asl nomi (tanlash uchun, blokka emas)
    shartnomalar: List[KoprikShartnoma] = field(default_factory=list)
    tashlangan: List[str] = field(default_factory=list)            # formati mos emas: so'ralmadi
    eksportlar: Dict[str, KoprikEksport] = field(default_factory=dict)
    eksport_xato: str = ""                    # exports o'qilmadi (sabab tahlili cheklanadi)
    ms: int = 0
    # CRM Внешний ID bank kompoziti, bizning d.tx/d.okv da yo'q: qo'shimcha SELECT (_komp_qidir) natijasi
    komp_tx: List["Tx"] = field(default_factory=list)
    komp_qidirildi: Set[str] = field(default_factory=set)   # qidirilgan (topilmasa: bank sync muammosi)
    komp_xato: str = ""
    xonpay_crm: List[XonpayQator] = field(default_factory=list)   # Billing'da yo'q XonPay (koprik_tahlil yozadi)
    # CRM_FARQ: shartnoma -> (faqat CRM'da, faqat OplatyKv'da) to'lovlar (egasi javobida har biri alohida)
    mos_emas: Dict[str, Tuple[List[_KT], List[_KT]]] = field(default_factory=dict)


def _koprik_urlopen(req: urllib.request.Request, timeout: float) -> Any:
    """Ko'prik tarmog'i (testda almashtiriladi). _opener: proxy yo'q, redirect taqiq."""
    return _opener().open(req, timeout=timeout)


def _koprik_base() -> str:
    """AGENT_BRIDGE_URL (faqat http, 127.0.0.1 yoki localhost, yo'lsiz) yoki http://127.0.0.1:<PORT>.
    Yaroqsiz -> ''."""
    raw = config.env(C.TOLOV_KOPRIK_ENV_URL, "").strip()
    if raw:
        p = urlsplit(raw)
        try:
            port = p.port
        except ValueError:
            return ""
        if (p.scheme != "http" or p.hostname not in C.TOLOV_KOPRIK_HOSTLAR or "@" in p.netloc
                or p.path not in ("", "/") or p.query or p.fragment or port == 0):
            return ""
        return "http://%s%s" % (p.hostname, ":%d" % port if port else "")
    port_s = config.env(C.TOLOV_KOPRIK_ENV_PORT, "").strip()
    if not port_s:
        return "http://127.0.0.1:%d" % C.TOLOV_KOPRIK_PORT_DEFAULT
    if not port_s.isdigit() or not 1 <= int(port_s) <= 65535:
        return ""
    return "http://127.0.0.1:%d" % int(port_s)


# faqat GET; exports/:id/run yo'q. Qiymat: javobdagi majburiy ro'yxat maydoni (None = ro'yxat shart emas)
_KOPRIK_ROYXAT: Dict[str, Optional[str]] = {
    C.TOLOV_KOPRIK_YOL: "results", C.TOLOV_KOPRIK_EKSPORT_YOL: "items",
    C.TOLOV_KOPRIK_CRM_YOL: "exact", C.TOLOV_KOPRIK_CHEK_YOL: None,
}
_KOPRIK_YOLLAR = tuple(_KOPRIK_ROYXAT)


def _koprik_get(yol: str, params: Dict[str, str], dl: float) -> Dict[str, Any]:
    """YAGONA ko'prik tarmoq funksiyasi: GET <base><yol>?<params>, yol faqat payment-check yoki exports.
    Bitta urinish. Kalit faqat shu funksiya ichida, so'rov header'ida; xato matni kalitsiz.
    Muddat: min(90 s, dl gacha qolgan). Xato -> KoprikXato (yo'l oq ro'yxatda bo'lmasa ValueError)."""
    if yol not in _KOPRIK_YOLLAR:
        raise ValueError("ko'prik yo'li oq ro'yxatda yo'q")
    base = _koprik_base()
    if not base:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_MANZIL)
    kalit = config.env(C.TOLOV_KOPRIK_ENV_KEY, "").strip()
    if not kalit:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_KALIT)
    host = urlsplit(base).netloc
    url = base + yol + ("?" + urlencode(params) if params else "")
    if urlsplit(url).netloc != host or urlsplit(url).scheme != "http" or urlsplit(url).hostname not in \
            C.TOLOV_KOPRIK_HOSTLAR:
        raise KoprikXato(C.TOLOV_SABAB_KOPRIK_MANZIL)
    bosh = _mono()
    muddat = min(float(C.TOLOV_KOPRIK_TIMEOUT_S), dl - bosh)
    if muddat < _MIN_QOLGAN_S:
        raise KoprikXato(C.TOLOV_SABAB_VAQT)
    req = urllib.request.Request(url, data=None, method="GET", headers={
        "Accept": "application/json", C.TOLOV_KOPRIK_HEADER: kalit, "User-Agent": "xon-agents/tolov",
    })
    req_dl = bosh + muddat
    try:
        with _koprik_urlopen(req, timeout=muddat) as resp:
            oxirgi = resp.geturl() if hasattr(resp, "geturl") else url
            if urlsplit(oxirgi).netloc != host:
                raise KoprikXato("boshqa hostga yo'naltirildi")
            raw = _javob_oqi(resp, req_dl, C.TOLOV_KOPRIK_JAVOB_MAX)
    except KoprikXato:
        raise
    except CrmXato as exc:                    # _javob_oqi: umumiy muddat yoki 5 MB
        raise KoprikXato(exc.sabab) from None
    except urllib.error.HTTPError as exc:
        code = int(getattr(exc, "code", 0) or 0)
        if 300 <= code < 400:
            raise KoprikXato("redirect taqiqlangan (%d)" % code) from None
        izoh = C.TOLOV_KOPRIK_HTTP_IZOH.get(code)
        raise KoprikXato("HTTP %d" % code + (" (%s)" % izoh if izoh else "")) from None
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, OSError) as exc:
        sabab_obj = getattr(exc, "reason", exc)
        if isinstance(exc, (socket.timeout, TimeoutError)) or isinstance(sabab_obj, (socket.timeout, TimeoutError)):
            sabab = "timeout"
        elif isinstance(exc, ConnectionRefusedError) or isinstance(sabab_obj, ConnectionRefusedError):
            sabab = "ulanish rad etildi (backend ishlamayapti yoki PORT noto'g'ri)"
        else:
            sabab = _sirsiz("%s: %s" % (exc.__class__.__name__, sabab_obj), kalit)
        raise KoprikXato(sabab or "tarmoq xatosi") from None
    except Exception as exc:  # noqa: BLE001 - kutilmagan: matn kalitsiz
        raise KoprikXato(_sirsiz("%s: %s" % (exc.__class__.__name__, exc), kalit)) from None
    finally:
        del kalit
    try:
        data = json.loads(raw.decode("utf-8"), parse_float=Decimal)
    except (UnicodeDecodeError, ValueError):
        raise KoprikXato("javob JSON emas") from None
    if yol == C.TOLOV_KOPRIK_CRM_YOL and isinstance(data, dict) and data.get("ok") is False:
        raise KoprikXato("CRM: " + (_toza(_lotin(_s(data.get("error"))), 120) or "javob bermadi"))
    royxat = _KOPRIK_ROYXAT[yol]
    if not isinstance(data, dict) or data.get("ok") is not True or (
            royxat is not None and not isinstance(data.get(royxat), list)):
        raise KoprikXato("javob shakli kutilmagan")
    return data


def _lugat(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _lugatlar(v: Any) -> List[Dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _okv_tur(first: Decimal, monthly: Decimal) -> str:
    if first and monthly:
        return "aralash"
    return "bosh." if first else ("oylik" if monthly else "-")


def _koprik_parse(data: Dict[str, Any]) -> KoprikNatija:
    """Ko'prik javobi -> KoprikNatija. Dinamik matn (sheet nomi, sabab, CRM turi) lotin va tozalangan."""
    kn = KoprikNatija()
    nomlar: Dict[str, str] = {}
    for s in _lugatlar(_lugat(data.get("sources")).get("sheets")):
        sid = _s(s.get("id"))[:80]
        if sid and sid not in nomlar:
            nomlar[sid] = _toza(_lotin(_s(s.get("name"))), 60) or sid
            kn.sheetlar.append((sid, nomlar[sid]))
            kn.sheet_xom[sid] = _s(s.get("name"))[:120]
    for r in _lugatlar(data.get("results")):
        o = _lugat(r.get("oplata"))
        okv = KoprikOkv(bosh=_dec(o.get("initial")), oylik=_dec(o.get("monthly")), jami=_dec(o.get("total")),
                        soni=SF._int(o.get("count")))
        for p in _lugatlar(o.get("payments")):
            f, m = _dec(p.get("first")), _dec(p.get("monthly"))
            okv.tolovlar.append(_KT(_s(p.get("date"))[:10], _dec(p.get("total")), _okv_tur(f, m), bosh=f, oylik=m))
        c = _lugat(r.get("crm"))
        if c.get("found") is True:
            crm = KoprikCrm(topildi=True, zaxira=c.get("viaPaymentHistory") is True, narx=_dec_n(c.get("price")),
                            reja_bosh=_dec_n(c.get("initialPlan")), reja_oylik=_dec_n(c.get("monthlyPlan")),
                            bosh=_dec(c.get("initial")), oylik=_dec(c.get("monthly")), jami=_dec(c.get("total")),
                            qoldiq=_dec_n(c.get("remaining")), soni=SF._int(c.get("count")))
            for p in _lugatlar(c.get("payments")):
                bosh = p.get("kind") == "initial"
                tur = "bosh." if bosh else "oylik"
                yorliq = _toza(_lotin(repair_mojibake(_s(p.get("type")))), 24)
                amt = _dec(p.get("amount"))
                crm.tolovlar.append(_KT(_s(p.get("date"))[:10], amt, "%s (%s)" % (tur, yorliq) if yorliq else tur,
                                        bosh=amt if bosh else _NOL, oylik=_NOL if bosh else amt,
                                        ext=_s(p.get("externalId"))[:255],
                                        usul=_toza(_lotin(repair_mojibake(_s(p.get("method")))), 24)))
        else:
            crm = KoprikCrm(xato=_toza(_lotin(_s(c.get("error"))), 160))
        sheetlar: List[KoprikSheet] = []
        for s in _lugatlar(r.get("sheets")):
            sid = _s(s.get("id"))[:80]
            sh = KoprikSheet(id=sid, nomi=_toza(_lotin(_s(s.get("name"))), 60) or nomlar.get(sid, sid),
                             mavjud=s.get("available") is True, sabab=_toza(_lotin(_s(s.get("reason"))), 160),
                             bosh=_dec(s.get("initial")), oylik=_dec(s.get("monthly")), jami=_dec(s.get("total")),
                             qatorlar=SF._int(s.get("matchedRows")))
            for p in _lugatlar(s.get("payments")):
                f, m = _dec(p.get("first")), _dec(p.get("monthly"))
                sh.tolovlar.append(_KT("", _dec(p.get("total")), _okv_tur(f, m), SF._int(p.get("row")), f, m))
            sheetlar.append(sh)
            if sid and sid not in nomlar:
                nomlar[sid] = sh.nomi
                kn.sheetlar.append((sid, sh.nomi))
                kn.sheet_xom[sid] = _s(s.get("name"))[:120]
        kn.shartnomalar.append(KoprikShartnoma(shartnoma=_s(r.get("contract")).upper()[:64],
                                               mos=r.get("allMatch") is True, okv=okv, crm=crm, sheetlar=sheetlar))
    return kn


def _butun_n(v: Any) -> Optional[int]:
    return None if v is None or isinstance(v, bool) or not re.fullmatch(r"-?\d+", _s(v)) else int(_s(v))


def _matnlar(v: Any, n: int = 200) -> List[str]:
    """Filtr ro'yxati: satrlar AYNAN (backend `in` filtri trim qilmaydi), ko'pi bilan n ta."""
    return [str(x)[:120] for x in v if isinstance(x, (str, int)) and str(x)][:n] if isinstance(v, list) else []


def _koprik_eksportlar(data: Dict[str, Any]) -> Dict[str, KoprikEksport]:
    """GET exports javobi -> {id: KoprikEksport}. Sheet nomi lotin va tozalangan."""
    out: Dict[str, KoprikEksport] = {}
    for it in _lugatlar(data.get("items")):
        sid = _s(it.get("id"))[:80]
        if not sid or sid in out:
            continue
        f, cr, lr = _lugat(it.get("filter")), _lugat(it.get("cron")), _lugat(it.get("lastRun"))
        e = KoprikEksport(
            id=sid, nomi=_toza(_lotin(_s(it.get("name"))), 60) or sid,
            manba="transaction" if it.get("source") == "transaction" else "oplatakv",
            rejim="upsert" if it.get("writeMode") == "upsert" else "replace",
            sana_dan=_s(it.get("dateFrom"))[:10] if _SANA_ISO_RE.match(_s(it.get("dateFrom"))[:10]) else "",
            obyektlar=_matnlar(f.get("objects")), kategoriyalar=_matnlar(f.get("categories")),
            turlar=_matnlar(f.get("txTypes")), hisoblar=_matnlar(f.get("accounts")),
            belgi=_s(f.get("amountSign")) if f.get("amountSign") in ("pos", "neg") else "",
            cron_yoq=cr.get("enabled") is True, cron_har=_butun_n(cr.get("everyMinutes")),
            soat_dan=_butun_n(cr.get("hourFrom")), soat_gacha=_butun_n(cr.get("hourTo")),
            kunlar=[d for d in (_butun_n(x) for x in (cr.get("days") if isinstance(cr.get("days"), list) else []))
                    if d is not None and 0 <= d <= 6],
        )
        if lr:
            e.oxirgi_vaqt = config.parse_iso(_s(lr.get("startedAt")))
            e.oxirgi_holat = "ok" if lr.get("status") == "ok" else "error"
            e.oxirgi_qator = SF._int(lr.get("rowsWritten"))
            e.oxirgi_xato = _toza(_lotin(_s(lr.get("error"))), 120)
        out[sid] = e
    return out


@dataclass
class ChekNatija:
    """/tolov chek: panel Chek order > Tekshirish (matchOrder) natijasi ko'prik orqali."""
    xato: str = ""                            # '' = javob keldi
    natija: str = ""                          # found | mismatch | not_found
    shartlar: Dict[str, Optional[bool]] = field(default_factory=dict)   # order, account, date, amount, contract
    tx: Optional[Dict[str, Any]] = None       # topilgan tranzaksiya (id, ext, summa, sana, hujjat, shartnoma)


@dataclass
class CrmIdNatija:
    """Shartnomasiz to'lov: bank kompozit ID bo'yicha CRM (ko'prik crm-lookup)."""
    xato: str = ""
    via: str = ""                             # sana (panel XATO -> CRM ham topadi) | transaction_id | ''
    aniq: List[Dict[str, Any]] = field(default_factory=list)        # ID bo'yicha aniq mos CRM to'lovlari
    summa_teng: List[Dict[str, Any]] = field(default_factory=list)  # aniq yo'q: shu kuni shu summa (ID'siz)
    eski: Optional[List[str]] = None          # CRM topgach almashtirilgan bizdagi shartnoma(lar); None = almashmadi


_KOMP_PARAM_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{7,199}$")   # backend COMPOSITE_ID_RE bilan bir xil


def _summa_param(v: Any) -> str:
    """Decimal -> '8132000' yoki '8132000.5' (backend: ^\\d{1,13}(\\.\\d{1,2})?$)."""
    d = abs(_dec(v)).quantize(_TIYIN, rounding=ROUND_HALF_UP)
    t = format(d, "f")
    return t[:-3] if t.endswith(".00") else t.rstrip("0")


def _chek_top(k: Kirish, kdl: Optional[float]) -> ChekNatija:
    """Chek (order №, summa, sana, hisob) -> tranzaksiya: ko'prik chek-find. Hech qachon exception chiqarmaydi."""
    if kdl is None:
        return ChekNatija(xato=C.TOLOV_KOPRIK_PREFIKS + C.TOLOV_SABAB_OCHIRILGAN)
    params = {"order": k.order}
    if k.summa is not None:
        params["amount"] = _summa_param(k.summa)
    if k.sana is not None:
        params["date"] = k.sana.isoformat()
    if k.hisob:
        params["account"] = k.hisob
    try:
        data = _koprik_get(C.TOLOV_KOPRIK_CHEK_YOL, params, kdl)
    except KoprikXato as exc:
        log.warning("tolov chek-find: %s", exc.sabab)
        return ChekNatija(xato=C.TOLOV_KOPRIK_PREFIKS + exc.sabab)
    except Exception as exc:  # noqa: BLE001
        return ChekNatija(xato=C.TOLOV_KOPRIK_PREFIKS + "ichki xato: " + exc.__class__.__name__)
    natija = _s(data.get("result"))
    c = ChekNatija(natija=natija if natija in ("found", "mismatch", "not_found") else "not_found")
    for nom, v in _lugat(data.get("conditions")).items():
        if nom in ("order", "account", "date", "amount", "contract") and v in (True, False, None):
            c.shartlar[nom] = v
    t = _lugat(data.get("tx"))
    if _s(t.get("id")) and c.natija != "not_found":
        c.tx = {"id": _s(t.get("id"))[:64], "external_id": _s(t.get("externalId"))[:255],
                "summa": abs(_dec(t.get("amount"))), "vaqt": config.parse_iso(_s(t.get("txnDate"))),
                "hujjat": _toza(t.get("docNumber"), 40), "shartnoma": _s(t.get("contractNumber")).upper()[:64]}
    return c


def _crm_id_top(y: Dict[str, Any], kdl: float) -> CrmIdNatija:
    """Bitta to'lov (y) bank ID si bo'yicha CRM: ko'prik crm-lookup. Hech qachon exception chiqarmaydi."""
    kalit = _s(y.get("kalit"))
    if "_" not in kalit or not _KOMP_PARAM_RE.match(kalit):
        return CrmIdNatija(xato="to'lov ID si bank kompoziti emas: CRM'da ID bo'yicha qidirib bo'lmaydi")
    params = {"id": kalit}
    if _SANA_ISO_RE.match(_s(y.get("sana"))):
        params["date"] = _s(y.get("sana"))
    if _dec(y.get("summa")) > 0:
        params["amount"] = _summa_param(y.get("summa"))
    try:
        data = _koprik_get(C.TOLOV_KOPRIK_CRM_YOL, params, kdl)
    except KoprikXato as exc:
        log.warning("tolov crm-lookup: %s", exc.sabab)
        return CrmIdNatija(xato=C.TOLOV_KOPRIK_PREFIKS + exc.sabab)
    except Exception as exc:  # noqa: BLE001
        return CrmIdNatija(xato=C.TOLOV_KOPRIK_PREFIKS + "ichki xato: " + exc.__class__.__name__)

    def qator(p: Dict[str, Any]) -> Dict[str, Any]:
        return {"shartnoma": _s(p.get("contract")).upper()[:64], "sana": _s(p.get("date"))[:10],
                "summa": _dec(p.get("amount")), "bosh": _dec(p.get("initialAmount")),
                "oylik": _dec(p.get("monthlyAmount")), "obyekt": _toza(_lotin(_s(p.get("object"))), 40),
                "mijoz": mijoz_ismi(p.get("client")), "ext": _s(p.get("externalId"))[:255]}

    via = _s(data.get("via"))
    return CrmIdNatija(via=via if via in ("sana", "transaction_id") else "",
                       aniq=[qator(p) for p in _lugatlar(data.get("exact"))[:5] if _s(p.get("contract"))],
                       summa_teng=[qator(p) for p in _lugatlar(data.get("sameAmount"))[:5] if _s(p.get("contract"))])


def _koprik_collect(shartnomalar: Sequence[str], dl: float) -> KoprikNatija:
    """Panel natijasi (<= 3 shartnoma) va eksport sozlamalari: bitta prefetch'da ikki GET (payment-check,
    keyin exports). Hech qachon exception chiqarmaydi: xato KoprikNatija.xato (yoki eksport_xato) ga."""
    t0 = _mono()
    sorov: List[str] = []
    tashlangan: List[str] = []
    for s in shartnomalar:
        u = _s(s).upper()
        if C.TOLOV_KOPRIK_SHARTNOMA_RE.match(u):
            if u not in sorov:
                sorov.append(u)
        elif u and u not in tashlangan:
            tashlangan.append(u)
    kn = KoprikNatija()
    try:
        if not sorov:
            kn.xato = C.TOLOV_SABAB_KOPRIK_FORMAT
        else:
            kn = _koprik_parse(_koprik_get(C.TOLOV_KOPRIK_YOL,
                                           {"contracts": ",".join(sorov[:C.TOLOV_SHARTNOMA_MAX])}, dl))
    except KoprikXato as exc:
        kn = KoprikNatija(xato=exc.sabab)
        log.warning("tolov ko'prik: %s", exc.sabab)
    except Exception as exc:  # noqa: BLE001 - ichki xato: qolgan tekshiruv davom etadi
        kn = KoprikNatija(xato="ichki xato: " + exc.__class__.__name__)
        log.warning("tolov ko'prik natijasi o'qilmadi: %s", exc.__class__.__name__)
    if not kn.xato:
        # eksport sozlamasi: "nega sheetda ko'rinmayapti" tahlili uchun (xato bo'lsa faqat tahlil cheklanadi)
        try:
            kn.eksportlar = _koprik_eksportlar(_koprik_get(C.TOLOV_KOPRIK_EKSPORT_YOL, {}, dl))
        except KoprikXato as exc:
            kn.eksport_xato = exc.sabab
            log.warning("tolov ko'prik exports: %s", exc.sabab)
        except Exception as exc:  # noqa: BLE001
            kn.eksport_xato = "ichki xato: " + exc.__class__.__name__
            log.warning("tolov ko'prik exports o'qilmadi: %s", exc.__class__.__name__)
    kn.tashlangan = tashlangan
    kn.ms = int((_mono() - t0) * 1000)
    return kn


def _kt_kalit(x: _KT) -> Tuple[str, int, Decimal]:
    return x.sana, x.qator, x.summa


def _royxat_juftla(a: Sequence[_KT], b: Sequence[_KT], oyna: int = C.TOLOV_KOPRIK_SANA_OYNA
                   ) -> Tuple[List[Tuple[_KT, _KT]], List[_KT], List[_KT]]:
    """Ikki to'lov ro'yxatini juftlaydi (sof, deterministik). Summa tengligi |d| < 1 so'm.
    1) sana va summa teng; 2) summa teng, sana farqi <= oyna kun (eng yaqini); 3) bir tomonda sana yo'q
    (sheet): avval summa, bosh. va oylik teng, keyin faqat summa; tartib bo'yicha (eng eski juftlanadi, eng
    yangisi ortib qoladi).
    Qaytadi: (juftlar, faqat a, faqat b)."""
    aa, bb = sorted(a, key=_kt_kalit), sorted(b, key=_kt_kalit)
    juft: Dict[int, int] = {}
    band: Set[int] = set()

    def teng(x: _KT, y: _KT) -> bool:
        return abs(x.summa - y.summa) < 1

    for i, x in enumerate(aa):
        if not x.sana:
            continue
        j = next((j for j, y in enumerate(bb) if j not in band and y.sana == x.sana and teng(x, y)), None)
        if j is not None:
            juft[i] = j
            band.add(j)
    for i, x in enumerate(aa):
        if i in juft or not x.sana:
            continue
        eng: Optional[Tuple[int, int]] = None
        for j, y in enumerate(bb):
            if j in band or not y.sana or not teng(x, y):
                continue
            dd = _kun_farq(x.sana, y.sana)
            if dd is not None and dd <= oyna and (eng is None or dd < eng[0]):
                eng = (dd, j)
        if eng is not None:
            juft[i] = eng[1]
            band.add(eng[1])
    for aniq in (True, False):   # sanasiz: avval summa + bosh. + oylik teng, keyin faqat summa
        for i, x in enumerate(aa):
            if i in juft:
                continue
            j = next((j for j, y in enumerate(bb) if j not in band and (not x.sana or not y.sana) and teng(x, y)
                      and (not aniq or (abs(x.bosh - y.bosh) < 1 and abs(x.oylik - y.oylik) < 1))), None)
            if j is not None:
                juft[i] = j
                band.add(j)
    juftlar = [(aa[i], bb[j]) for i, j in sorted(juft.items())]
    return juftlar, [x for i, x in enumerate(aa) if i not in juft], [y for j, y in enumerate(bb) if j not in band]


def _kt_str(x: _KT) -> str:
    """'<sana> <summa> <tur>'; CRM to'lovida Способ va Внешний ID qisqa: 'Xon Pay id=bc843be4'."""
    q = [x.sana or ("#%d" % x.qator if x.qator else "-"), pul(x.summa)]
    if x.tur and x.tur != "-":
        q.append(x.tur)
    if x.usul:
        q.append(x.usul)
    if x.ext:
        q.append("id=" + _ext_qisqa(x.ext))
    return " ".join(q)


def _kt_royxat(xs: Sequence[_KT], n: int = C.TOLOV_KOPRIK_OXIRGI) -> str:
    """Eng yangisi birinchi, n tagacha; qolgani '+N'."""
    tart = sorted(xs, key=_kt_kalit, reverse=True)
    matn = ", ".join(_kt_str(x) for x in tart[:n]) or "yo'q"
    return matn + (" +%d" % (len(tart) - n) if len(tart) > n else "")


_USTUNLAR = (("bosh.", "bosh"), ("oylik", "oylik"), ("jami", "jami"))


def _ustun_farq(a: Any, b: Any) -> List[Tuple[str, Decimal]]:
    """(ustun, a - b) faqat |farq| >= 1 so'm bo'lganlari (panel resAllMatch bilan bir xil chegara)."""
    return [(nom, getattr(a, k) - getattr(b, k)) for nom, k in _USTUNLAR if abs(getattr(a, k) - getattr(b, k)) >= 1]


def _farq_matn(fs: Sequence[Tuple[str, Decimal]]) -> str:
    return ", ".join("%s %s" % (nom, pul(d)) for nom, d in fs)


def _pul_n(v: Optional[Decimal]) -> str:
    return "-" if v is None else pul(v)


def _sheet_norm(s: Any) -> str:
    """google-export readContractsPayments: [\\s-_./№] olib tashlanadi, upper (O/I almashtirilmaydi)."""
    return _SKELET_RE.sub("", _s(s)).upper()


def _cron_matn(e: KoprikEksport) -> str:
    if not e.cron_yoq:
        return "o'chiq"
    q = ["har %d daq" % (e.cron_har or 60)]
    if e.soat_dan is not None or e.soat_gacha is not None:
        q.append("%02d-%02d" % (e.soat_dan if e.soat_dan is not None else 0,
                                e.soat_gacha if e.soat_gacha is not None else 23))
    q.append("kunlar " + ", ".join(C.HAFTA_KUNLARI[(k + 6) % 7][:3] for k in sorted(set(e.kunlar)))
             if e.kunlar else "har kun")
    return ", ".join(q)


def _eksport_holati(e: KoprikEksport) -> str:
    """'eksport oxirgi marta <vaqt> da ishlagan (<holat>), cron: ...' (Toshkent vaqti)."""
    if e.oxirgi_vaqt is None:
        return C.TOLOV_EKSPORT_HECH_TPL.format(cron=_cron_matn(e))
    holat = e.oxirgi_holat + (": " + e.oxirgi_xato if e.oxirgi_holat == "error" and e.oxirgi_xato else "")
    return C.TOLOV_EKSPORT_ESKI_TPL.format(vaqt=config.fmt_local(e.oxirgi_vaqt), holat=holat, cron=_cron_matn(e))


def _eksport_sozlama(e: KoprikEksport) -> str:
    """Sheet bo'limi ostidagi qator: manba, rejim, dateFrom, filtrlar, cron, oxirgi ish."""
    f = ["obyekt %s" % (", ".join(e.obyektlar[:5]) + (" +%d" % (len(e.obyektlar) - 5) if len(e.obyektlar) > 5 else "")
                         if e.obyektlar else "hammasi"),
         "kategoriya %s" % (", ".join(e.kategoriyalar) or "hammasi"), "tur %s" % (", ".join(e.turlar[:5]) or "hammasi"),
         "belgi %s" % {"pos": "> 0", "neg": "< 0"}.get(e.belgi, "hammasi")]
    if e.manba == "transaction":
        f = ["hisob %s" % (", ".join("*" + h[-4:] for h in e.hisoblar[:5]) or "hammasi")]
    oxirgi = ("oxirgi ish %s (%s, %d qator)" % (config.fmt_local(e.oxirgi_vaqt), e.oxirgi_holat, e.oxirgi_qator)
              if e.oxirgi_vaqt is not None else "oxirgi ish yo'q")
    return "eksport: manba %s, %s; dateFrom %s; filtr: %s; cron %s; %s" % (
        e.manba, e.rejim, e.sana_dan or "yo'q", ", ".join(f), _cron_matn(e), oxirgi)


def _eskimi(vaqt: Optional[datetime], e: KoprikEksport) -> bool:
    return e.oxirgi_vaqt is None or e.oxirgi_holat == "error" or (
        vaqt is not None and config.to_utc(vaqt) > e.oxirgi_vaqt)


def _eski_izoh(vaqt: Optional[datetime], e: KoprikEksport, nima: str) -> str:
    if e.oxirgi_vaqt is not None and e.oxirgi_holat != "error" and vaqt is not None:
        return "%s %s da, eksportdan keyin" % (nima, config.fmt_local(vaqt))
    return "oxirgi ish yo'q" if e.oxirgi_vaqt is None else "oxirgi ish xato"


def _okv_sababi(o: Okv, e: KoprikEksport, kanon: str, topilgan: Optional[Set[str]]) -> Tuple[str, str]:
    """OplatyKv qatori nega sheetga tushmaydi: (kod, izoh), TOLOV_SHEET_SABABLAR tartibida birinchi mos
    kelgani; ('', '') = sabab yo'q. Filtrlar google-export -> oplataKv.getRowsForExport nusxasi (aniq `in`)."""
    if e.obyektlar and o.obyekt not in e.obyektlar:
        return "FILTR_OBYEKT", "obyekt %s filtrda yo'q" % (_lotin(o.obyekt)[:40] or "bo'sh")
    if e.kategoriyalar and o.turi not in e.kategoriyalar:
        return "FILTR_KATEGORIYA", "%s; filtr %s" % (
            "kategoriya " + o.turi if o.turi else "kategoriya yo'q (split qilinmagan)", ", ".join(e.kategoriyalar))
    if e.turlar and o.tx_type not in e.turlar:
        return "FILTR_TUR", "tur %s filtrda yo'q" % (_lotin(o.tx_type)[:40] or "bo'sh")
    if e.sana_dan and o.sana and o.sana < e.sana_dan:
        return "FILTR_SANA", "sana %s, dateFrom %s" % (o.sana, e.sana_dan)
    if (e.belgi == "pos" and o.summa <= 0) or (e.belgi == "neg" and o.summa >= 0):
        return "FILTR_BELGI", "summa %s, filtr %s" % (pul(o.summa), "> 0" if e.belgi == "pos" else "< 0")
    oz = max((x for x in (o.yaratilgan, o.yangilangan) if x is not None), default=None, key=config.to_utc)
    if _eskimi(oz, e):
        return "EKSPORT_ESKI", _eski_izoh(oz, e, "qator o'zgargan")
    if o.source_tx_id and topilgan is not None and o.shartnoma not in topilgan and not (o.tx is not None
                                                                                       and o.tx.manual):
        return "XATO_RAQAM", "XATO: %s CRM'da topilmagan, sheetda XATO yoziladi" % o.shartnoma
    if _sheet_norm(o.shartnoma) != _sheet_norm(kanon):
        return "XATO_RAQAM", "contract_no %s, sheet %s ni qidiradi" % (o.shartnoma, kanon)
    return "", ""


def _tx_sababi(t: Tx, e: KoprikEksport, kanon: str) -> Tuple[str, str]:
    """Manba transaction: tranzaksiya qatori nega sheetga tushmaydi (transactions.getRowsForExport: faqat
    hisob va sana filtri; tur, obyekt, kategoriya, belgi qo'llanmaydi)."""
    if e.hisoblar and not (t.hisob4 and any(h[-4:] == t.hisob4 for h in e.hisoblar)):
        return "FILTR_HISOB", "hisob *%s filtrda yo'q" % (t.hisob4 or "?")
    kun = config.to_utc(t.vaqt).date().isoformat() if t.vaqt is not None else ""   # backend UTC kuni bilan
    if e.sana_dan and kun and kun < e.sana_dan:
        return "FILTR_SANA", "sana %s, dateFrom %s" % (kun, e.sana_dan)
    if _eskimi(t.vaqt, e):
        return "EKSPORT_ESKI", _eski_izoh(t.vaqt, e, "tx")
    if _sheet_norm(t.shartnoma) != _sheet_norm(kanon):
        return "XATO_RAQAM", "tx shartnomasi %s, sheet %s ni qidiradi" % (t.shartnoma or "bo'sh", kanon)
    return "", ""


def _sheet_sababi(kanon: str, nomi: str, sid: str, kn: KoprikNatija, okv: Optional[Sequence[Okv]],
                  tx: Optional[Sequence[Tx]], topilgan: Optional[Set[str]]) -> Tuple[str, str, List[str]]:
    """SHEET_YOQ / SHEET_FARQ sababi: (farq qatoridagi sabab matni, tuzatish, qator sabablari ro'yxati).
    Har qator TOLOV_SHEET_SABABLAR tartibida tekshiriladi; farq qatorida kodlar shu tartibda, soni bilan."""
    umumiy = C.TOLOV_TUZ_SHEET_TPL.format(sheet=nomi)
    e = kn.eksportlar.get(sid)
    if e is None:
        return ("%s — eksport sozlamasi o'qilmadi: %s" % (C.TOLOV_SABAB_ANIQLANMADI, kn.eksport_xato)
                if kn.eksport_xato else "%s — eksport sozlamasi topilmadi" % C.TOLOV_SABAB_ANIQLANMADI), umumiy, []
    rows = tx if e.manba == "transaction" else okv
    if rows is None:
        return "%s — %s qatorlari o'qilmadi; %s" % (
            C.TOLOV_SABAB_ANIQLANMADI, "transactions" if e.manba == "transaction" else "oplata_kv",
            _eksport_holati(e)), umumiy, []
    g = _guruh_xarita([s.shartnoma for s in kn.shartnomalar])
    i = next((k for k, s in enumerate(kn.shartnomalar) if s.shartnoma == kanon), 0)
    topildi: List[Tuple[str, str, str, Decimal, str]] = []    # (kod, izoh, sana, summa, raqam)
    if e.manba == "transaction":
        for t in tx or ():
            if g(t.shartnoma) == i:
                kod, izoh = _tx_sababi(t, e, kanon)
                if kod:
                    topildi.append((kod, izoh, t.sana, t.ishorali, t.shartnoma))
    else:
        for o in okv or ():
            if g(o.shartnoma) == i:
                kod, izoh = _okv_sababi(o, e, kanon, topilgan)
                if kod:
                    topildi.append((kod, izoh, o.sana, o.summa, o.shartnoma))
    if not topildi:
        return ("%s — filtr, eksport vaqti va raqam mos (sheet qo'lda o'zgargan bo'lishi mumkin); %s" % (
            C.TOLOV_SABAB_ANIQLANMADI, _eksport_holati(e)), umumiy, [])
    qism: List[str] = []
    for kod in C.TOLOV_SHEET_SABABLAR:
        bu = [x for x in topildi if x[0] == kod]
        if not bu:
            continue
        if kod == "EKSPORT_ESKI":
            izoh = _eksport_holati(e)
        else:   # izohlar bir xil bo'lsa aynan, aks holda kod ma'nosi (har qator sheet bo'limida)
            izoh = bu[0][1] if len({x[1] for x in bu}) == 1 else C.TOLOV_SHEET_SABABLAR[kod]
        qism.append("%s — %s (%d qator)" % (kod, izoh, len(bu)))
    asosiy = next(k for k in C.TOLOV_SHEET_SABABLAR if any(x[0] == k for x in topildi))
    tart = sorted(topildi, key=lambda x: (x[2], x[3]), reverse=True)
    qatorlar = ["%s %s %s: %s" % (x[2] or "-", pul(x[3]), x[0], x[1]) for x in tart[:C.TOLOV_KOPRIK_OXIRGI]]
    if len(tart) > C.TOLOV_KOPRIK_OXIRGI:
        qatorlar.append("+%d qator" % (len(tart) - C.TOLOV_KOPRIK_OXIRGI))
    return "; ".join(qism), C.TOLOV_SHEET_SABAB_TUZATISH[asosiy].format(sheet=nomi), qatorlar


def _sheet_tanlangan(kn: KoprikNatija) -> Set[str]:
    """Solishtiriladigan sheet id'lari: AGENTS_TOLOV_SHEETLAR (id yoki nom, vergul bilan) bo'lsa shular, aks holda
    nomi (lotinga o'girilgan, kichik harf) TOLOV_SHEET_DEFAULT_NAQSHLAR dan birini o'z ichiga olganlar.
    Qolganlari faqat ma'lumot: ular uchun SHEET_YOQ / SHEET_FARQ chiqmaydi."""
    def kalit(v: Any) -> str:
        return _lotin(_s(v)).casefold()

    raw = config.env(C.TOLOV_SHEETLAR_ENV, "").strip()
    out: Set[str] = set()
    if raw:
        istak = {kalit(x) for x in raw.split(",") if x.strip()}
        for sid, nomi in kn.sheetlar:
            if {kalit(sid), kalit(kn.sheet_xom.get(sid, "")), kalit(nomi)} & istak:
                out.add(sid)
        return out
    for sid, nomi in kn.sheetlar:
        k = kalit(kn.sheet_xom.get(sid) or nomi)
        if any(n in k for n in C.TOLOV_SHEET_DEFAULT_NAQSHLAR):
            out.add(sid)
    return out


def _crm_yigindi(c: KoprikCrm) -> Tuple[Decimal, Decimal, Decimal]:
    """CRM to'lovlar ro'yxati yig'indisi (bosh., oylik, jami). Panel jamlari (grafik/tarix MAX) aralash to'lovni
    ikki marta sanashi mumkin: farq hisobi shu ro'yxatdan."""
    return (sum((x.bosh for x in c.tolovlar), _NOL), sum((x.oylik for x in c.tolovlar), _NOL),
            sum((x.summa for x in c.tolovlar), _NOL))


def _split_juft(juftlar: Sequence[Tuple[_KT, _KT]]) -> List[Tuple[_KT, _KT]]:
    return [(x, y) for x, y in juftlar if abs(x.bosh - y.bosh) >= 1 or abs(x.oylik - y.oylik) >= 1]


def _shu_shartnoma(a: Any, b: Any) -> bool:
    """a shartnoma satri b kirish shartnomasiga tegishlimi (skelet, /SH va O/0, I/1 variantlari bilan)."""
    sk = skelet(a)
    return bool(sk) and sk in ({skelet(v) for v in variantlar(b)} | {skelet(b)})


def _xonpay_yolda(tolovlar: Sequence[_KT], kutish: Sequence[XonpayQator]) -> Tuple[List[_KT], List[_KT]]:
    """CRM to'lovlari ichidan XonPay yo'ldagi (KUTILMOQDA/KECHIKDI) to'lovlar: summa teng (|d| < 1), avval sana bir
    xil, keyin +-TOLOV_XONPAY_SANA_OYNA kun; har Billing qatori bitta CRM to'lovini oladi.
    Qaytadi: (yo'ldagilar, qolgan CRM to'lovlari)."""
    olingan: Dict[int, int] = {}              # Billing indeksi -> CRM to'lovi indeksi
    for aniq in (True, False):
        for xi, x in enumerate(kutish):
            if xi in olingan:
                continue
            for ti, t in enumerate(tolovlar):
                if ti in olingan.values() or abs(t.summa - x.summa) >= 1:
                    continue
                dd = _kun_farq(t.sana, x.sana)
                if dd is not None and (dd == 0 if aniq else dd <= C.TOLOV_XONPAY_SANA_OYNA):
                    olingan[xi] = ti
                    break
    band = set(olingan.values())
    return ([t for i, t in enumerate(tolovlar) if i in band], [t for i, t in enumerate(tolovlar) if i not in band])


@dataclass
class _Tasnif:
    """Bitta shartnomaning CRM (panel) to'lovlari Внешний ID (ext) va Способ (usul) bo'yicha."""
    qolgan: List[_KT] = field(default_factory=list)          # OplatyKv bilan solishtiriladi
    yolda: List[_KT] = field(default_factory=list)           # XonPay: CRM'da bor, bizda hali yo'q
    sync_yoq: List[_KT] = field(default_factory=list)        # kompozit (bizga tushgan), bizning tx'da yo'q
    xp_crm: List[XonpayQator] = field(default_factory=list)  # yo'ldagi, Billing'da yo'q: farq shu yerdan
    boshqa: List[Tuple[_KT, Tx]] = field(default_factory=list)   # kompozit bizda boshqa shartnoma tx'ida
    son: Dict[str, int] = field(default_factory=dict)


def _komp_moslik(ext: str, bir: Sequence["_Birlik"]) -> Tuple[str, Optional["_Birlik"]]:
    """CRM kompozit Внешний ID -> bizning birlik (OplatyKv/tx): kuchli (to'liq ID), yadro, gid. Topilmasa ('', None)."""
    core, gid = composite_core(ext), _gid(ext)
    bosqichlar: Tuple[Tuple[str, str, Callable[[Any], str]], ...] = (
        ("kuchli", ext, lambda b: b.full), ("yadro", core, lambda b: b.core), ("gid", gid, lambda b: b.gid))
    for nom, kalit, ol in bosqichlar:
        if kalit:
            b = next((b for b in bir if ol(b) == kalit), None)
            if b is not None:
                return nom, b
    return "", None


def _crm_tasnif(tolovlar: Sequence[_KT], sh: str, xp_id: Dict[str, XonpayQator], kutish: Sequence[XonpayQator],
                bir: Sequence["_Birlik"], qidirildi: Set[str], hozir: Optional[datetime],
                billing_oqildi: bool) -> _Tasnif:
    """1) Внешний ID UUID va Способ 'Xon Pay' (yoki UUID Billing'da bor): XonPay. Billing qatori UUID bo'yicha
    aniq (summa+sana taxminidan ustun); TUSHGAN solishtiriladi, yo'ldagi chiqariladi; Billing'da yo'q bo'lsa holat
    CRM sanasidan (xp_crm). 2) Bank kompoziti: bizda kuchli/yadro/gid juft -> solishtiriladi; qidirilgan va
    topilmagan -> sync_yoq (BIZDA_YOQ). 3) Внешний ID yo'q (yoki boshqa): Billing yo'ldagilari bilan summa+sana."""
    t = _Tasnif()

    def sanoq(k: str) -> None:
        t.son[k] = t.son.get(k, 0) + 1

    band: Set[int] = set()                    # UUID bilan olingan Billing qatorlari (id())
    oddiy: List[_KT] = []
    for x in tolovlar:
        ext = x.ext
        if ext and _UUID_RE.match(ext):
            b = xp_id.get(ext.lower())
            if b is not None or _xonpay_usul(x.usul):
                sanoq("uuid")
                if b is not None:
                    band.add(id(b))
                if b is not None and b.holat != "NOMALUM":
                    sanoq(b.holat)
                    (t.yolda if b.yolda else t.qolgan).append(x)
                else:
                    xq = _xonpay_crmdan(ext, sh, x.summa, x.sana, hozir, C.TOLOV_XONPAY_BILLINGSIZ if billing_oqildi
                                        else C.TOLOV_XONPAY_BILLING_OQILMADI)
                    sanoq(xq.holat)
                    sanoq("billingsiz")
                    t.yolda.append(x)
                    t.xp_crm.append(xq)
                continue
        elif ext and parse_composite(ext) is not None:
            sanoq("kompozit")
            nom, b = _komp_moslik(ext, bir)
            if nom and b is not None:
                sanoq(nom)
                t.qolgan.append(x)
                if b.okv is None and b.tx is not None and not _shu_shartnoma(b.tx.shartnoma, sh):
                    t.boshqa.append((x, b.tx))
            elif ext in qidirildi:
                sanoq("yoq")
                t.sync_yoq.append(x)
            else:
                sanoq("tekshirilmadi")
                t.qolgan.append(x)
            continue
        sanoq("oddiy")
        oddiy.append(x)
    yolda, qolgan = _xonpay_yolda(oddiy, [k for k in kutish if id(k) not in band])
    t.yolda += yolda
    t.qolgan += qolgan
    return t


def _tasnif_matn(son: Dict[str, int]) -> str:
    """[crm_panel] ostida: 'CRM ID: kompozit 3 (bizda: kuchli 2, gid 1; yo'q 0); XonPay UUID 1 (KUTILMOQDA 1;
    Billing'da yo'q 1); ID'siz yoki boshqa 2'. ID bo'lmasa ''."""
    q: List[str] = []
    if son.get("kompozit"):
        bizda = ", ".join("%s %d" % (k, son[k]) for k in ("kuchli", "yadro", "gid") if son.get(k)) or "0"
        q.append("kompozit %d (bizda: %s; yo'q %d%s)" % (
            son["kompozit"], bizda, son.get("yoq", 0),
            ", tekshirilmadi %d" % son["tekshirilmadi"] if son.get("tekshirilmadi") else ""))
    if son.get("uuid"):
        holat = ", ".join("%s %d" % (h, son[h]) for h in C.TOLOV_XONPAY_HOLATLAR if son.get(h))
        q.append("XonPay UUID %d (%s%s)" % (son["uuid"], holat or "-", "; %s %d" % (
            C.TOLOV_XONPAY_BILLINGSIZ, son["billingsiz"]) if son.get("billingsiz") else ""))
    if q and son.get("oddiy"):
        q.append("ID'siz yoki boshqa %d" % son["oddiy"])
    return "; ".join(q)


def _komp_yoq_farq(x: _KT) -> Farq:
    """Внешний ID bank kompoziti (egasi qoidasi: pul bizga tushgan), bizning transactions'da yo'q: BIZDA_YOQ,
    sabab TOLOV_KOMPOZIT_YOQ_TPL (kompozit sanasi), tuzatish bank sync."""
    k = parse_composite(x.ext)
    f = _farq("BIZDA_YOQ", sana=x.sana, summa=x.summa, dalil="crm=" + qisqa_id(x.ext),
              izoh="bankdan: ha (kompozit); usul: %s" % (x.usul or "-"), komponent="crm_panel",
              tuzatish=C.TOLOV_TUZ_BANK_SYNC)
    f.sabab = C.TOLOV_KOMPOZIT_YOQ_TPL.format(sana=(k.iso if k else "") or "-")
    return f


def _crm_royxatlari(kn: Optional[KoprikNatija], crm_eski: Optional[Sequence[CrmTolov]],
                    kanon: Sequence[str] = ()) -> Optional[Dict[str, List[_KT]]]:
    """XonPay kelishtiruvi uchun shartnoma -> CRM to'lovlari (Внешний ID bilan). Panel ko'prigi ustun, bo'lmasa eski
    CRM GET. CRM ma'lumoti umuman yo'q -> None; shartnoma CRM'da topilmagan yoki javob bermagan -> lug'atda yo'q."""
    if kn is not None and not kn.xato and any(s.crm.topildi for s in kn.shartnomalar):
        return {s.shartnoma: list(s.crm.tolovlar) for s in kn.shartnomalar if s.crm.topildi}
    if crm_eski is None:
        return None
    out: Dict[str, List[_KT]] = {sh: [] for sh in kanon}
    for c in crm_eski:
        if c.manba == "transaction_id":
            continue
        sh = next((k for k in out if _shu_shartnoma(c.contract, k)), c.contract)
        out.setdefault(sh, []).append(_KT(c.sana, c.amount, ext=c.external_id,
                                          usul=_toza(_lotin(repair_mojibake(c.method)), 24)))
    return out


def xonpay_kelishtir(xp: List[XonpayQator], crm: Optional[Dict[str, List[_KT]]],
                     bir: Optional[Sequence["_Birlik"]] = None) -> List[XonpayQator]:
    """Billing'ning is_matched=false (vaqt bo'yicha KUTILMOQDA/KECHIKDI) qatorlarini CRM bilan kelishtiradi (joyida):
    a) CRM to'lovlarida shu UUID Внешний ID sifatida bor -> haqiqatan yo'lda (holat o'zgarmaydi); a') CRM
       to'lovida Внешний ID yo'q (null), summa teng va sana +-TOLOV_XONPAY_SANA_OYNA -> eski mantiq: yo'lda;
    b) aks holda CRM'da summa teng (< 1 so'm), sana [date_paid, date_paid + TOLOV_XONPAY_OYNA_KUN] ichidagi, bizda
       topilgan (bir; None = tekshirilmaydi) va boshqa Billing qatori egallamagan kompozit to'lov bor -> TUSHGAN
       (CRM orqali, "Billing'da eski TOPILMAGAN qatori qolgan"); eng yaqin sana, bir CRM to'lovi bitta qatorga;
    c) shartnoma bo'yicha CRM ma'lumoti yo'q -> vaqt bo'yicha holat qoladi, izohda "CRM bilan tekshirilmadi";
    d) qolgani -> CRMDA_YOQ (yo'lda summasiga kirmaydi)."""
    egallangan: Set[str] = set()              # TUSHGAN Billing qatorlari egallagan CRM ID (to'liq va yadro)
    for x in xp:
        if x.holat == "TUSHGAN":
            for k in (x.ext, x.tushgan_id):
                if k:
                    egallangan.add(k.lower())
                    if composite_core(k):
                        egallangan.add("y:" + composite_core(k))

    def olingan(ext: str) -> bool:
        return ext.lower() in egallangan or bool(composite_core(ext)) and "y:" + composite_core(ext) in egallangan

    nomzod: List[Tuple[int, str, int, str, int]] = []   # (kun farqi, Billing sanasi, Billing i, shartnoma, CRM j)
    tekshir: List[int] = []
    idsiz_band: Set[Tuple[str, int]] = set()             # (a') Внешний ID'siz CRM to'lovi bitta Billing qatoriga
    for i, x in enumerate(xp):
        if not x.yolda:
            continue
        sh = next((k for k in crm if _shu_shartnoma(x.shartnoma, k)), None) if crm is not None else None
        if sh is None:
            x.izoh_qosh = C.TOLOV_XONPAY_CRM_TEKSHIRILMADI                          # (c)
            continue
        idlar = {k for k in (x.uuid, x.ext.lower()) if k}
        if any(t.ext and t.ext.lower() in idlar for t in crm[sh]):
            continue                                                                # (a)
        idsiz = [j for j, t in enumerate(crm[sh]) if not t.ext and (sh, j) not in idsiz_band
                 and abs(t.summa - x.summa) < 1 and (_kun_farq(t.sana, x.sana) or 0) <= C.TOLOV_XONPAY_SANA_OYNA
                 and _kun_farq(t.sana, x.sana) is not None]
        if idsiz:                                                                   # (a') ID'siz: summa + sana
            idsiz_band.add((sh, idsiz[0]))
            continue
        tekshir.append(i)
        d0 = _sana_d(x.sana)
        for j, t in enumerate(crm[sh]):
            if (not t.ext or _UUID_RE.match(t.ext) or parse_composite(t.ext) is None or abs(t.summa - x.summa) >= 1
                    or olingan(t.ext) or (bir is not None and not _komp_moslik(t.ext, bir)[0])):
                continue
            d1 = _sana_d(t.sana)
            dd = (d1 - d0).days if d0 is not None and d1 is not None else -1
            if 0 <= dd <= C.TOLOV_XONPAY_OYNA_KUN:
                nomzod.append((dd, x.sana, i, sh, j))
    band_x: Set[int] = set()
    band_t: Set[Tuple[str, int]] = set()
    for _dd, _sana, i, sh, j in sorted(nomzod):                                    # (b): eng yaqin sana
        if i in band_x or (sh, j) in band_t:
            continue
        band_x.add(i)
        band_t.add((sh, j))
        x, t = xp[i], crm[sh][j]
        x.holat, x.crm_orqali, x.ish_kun = "TUSHGAN", True, None
        x.tushgan_id, x.tushgan_sana, x.izoh_qosh = t.ext, t.sana, C.TOLOV_XONPAY_ESKI_QATOR
    for i in tekshir:
        if i not in band_x:
            xp[i].holat = "CRMDA_YOQ"                                               # (d)
    return xp


def koprik_tahlil(kn: KoprikNatija, okv: Optional[Sequence[Okv]] = (), tx: Optional[Sequence[Tx]] = (),
                  topilgan: Optional[Set[str]] = None, xonpay: Optional[Sequence[XonpayQator]] = (),
                  hozir: Optional[datetime] = None) -> Tuple[List[Farq], List[Bolim]]:
    """Panel natijasidan farq kodlari (CRM_FARQ, CRM_SPLIT, SHEET_YOQ, SHEET_FARQ) va bo'limlar: crm_panel, har
    sheet uchun alohida sheet, panel_solishtirish. CRM farqi to'lovlar ro'yxatidan (panel jamlari faqat ma'lumot).
    CRM to'lovlari avval Внешний ID bo'yicha (_crm_tasnif): XonPay yo'ldagi (CRM'da bor, bizda hali yo'q) va
    bizda yo'q bank kompoziti solishtiruvdan chiqariladi (CRM_FARQ emas): birinchisi XONPAY_* (Billing'da bo'lsa
    juftla beradi, bo'lmasa shu yerda), ikkinchisi BIZDA_YOQ (bank sync). xonpay: Billing qatorlari (None = o'qilmadi).
    Billing'da yo'q XonPay to'lovlari kn.xonpay_crm ga yoziladi ([xonpay] bo'limi uchun).
    SHEET_* faqat tanlangan sheetlarda (_sheet_tanlangan), sababi (nega sheetda yo'q) bizning OplatyKv/tx
    qatorlari (okv, tx; None = o'qilmadi) va eksport sozlamasi bo'yicha. Deterministik; hech narsa yozmaydi."""
    if kn.xato:
        sabab = C.TOLOV_KOPRIK_PREFIKS + kn.xato
        return [], [Bolim(k, "unknown", sabab) for k in ("crm_panel", "sheet", "panel_solishtirish")]
    farqlar: List[Farq] = []
    bolimlar: List[Bolim] = []
    bor: Set[Tuple[str, str]] = set()        # (shartnoma, "crm" | sheet id): warn/error farq chiqdi
    kop = len(kn.shartnomalar) + len(kn.tashlangan) > 1
    tanlangan = _sheet_tanlangan(kn)
    xp_id: Dict[str, XonpayQator] = {}
    for x in xonpay or ():
        for k in (x.uuid, x.ext.lower()):
            if k:
                xp_id.setdefault(k, x)
    kutish = [x for x in xonpay or () if x.yolda]
    bir = _birliklar(okv or [], tx or []) + [_birlik(None, t) for t in kn.komp_tx]
    kn.xonpay_crm = []
    kn.mos_emas = {}
    chiqarilgan: Dict[str, Tuple[Decimal, Decimal]] = {}   # shartnoma -> (XonPay yo'lda, bank sync'da yo'q)

    def pre(sh: str, ajrat: str = ": ") -> str:
        return sh + ajrat if kop else ""

    def jam(xs: Sequence[_KT]) -> Tuple[Decimal, Decimal, Decimal]:
        return (sum((x.bosh for x in xs), _NOL), sum((x.oylik for x in xs), _NOL), sum((x.summa for x in xs), _NOL))

    # crm_panel: panel yo'li (CRM show; topmasa payment-history zaxirasi). Farq to'lovlar ro'yxatidan.
    qism: List[str] = []
    qatorlar: List[str] = []
    holat: List[str] = []
    for s in kn.shartnomalar:
        c, o = s.crm, s.okv
        if not c.topildi:
            qism.append(pre(s.shartnoma) + ("CRM javob bermadi: " + c.xato if c.xato else "CRM'da topilmadi"))
            holat.append("unknown" if c.xato else "warn")
            continue
        cb, co, cj = _crm_yigindi(c)
        ts = _crm_tasnif(c.tolovlar, s.shartnoma, xp_id, [x for x in kutish if _shu_shartnoma(x.shartnoma, s.shartnoma)],
                         bir, kn.komp_qidirildi, hozir, xonpay is not None)
        yolda, yoq = ts.yolda, ts.sync_yoq
        yj, nj = jam(yolda)[2], jam(yoq)[2]
        chiqarilgan[s.shartnoma] = (yj, nj)
        q = ["narx %s" % _pul_n(c.narx), "reja bosh. %s, oylik %s" % (_pul_n(c.reja_bosh), _pul_n(c.reja_oylik)),
             "to'lovlar %d ta: bosh. %s, oylik %s, jami %s" % (len(c.tolovlar), pul(cb), pul(co), pul(cj))]
        if yolda:
            q.append("XonPay yo'lda %d ta, %s (bizda hali yo'q, solishtirilmaydi)" % (len(yolda), pul(yj)))
        if yoq:
            q.append("bizda yo'q (bank sync) %d ta, %s (solishtirilmaydi, BIZDA_YOQ)" % (len(yoq), pul(nj)))
        if c.narx is not None:
            q.append("qoldiq (narx - to'lovlar) %s" % pul(c.narx - cj))
        q.append("panel jami (grafik/tarix max): bosh. %s, oylik %s, jami %s" % (pul(c.bosh), pul(c.oylik),
                                                                                  pul(c.jami)))
        if c.zaxira:
            q.append("zaxira: payment-history (narx, reja, qoldiq yo'q)")
        qism.append(pre(s.shartnoma) + "; ".join(q))
        qatorlar.append(pre(s.shartnoma, " ") + "oxirgi to'lovlar: " + _kt_royxat(c.tolovlar))
        id_matn = _tasnif_matn(ts.son)
        if id_matn:
            qatorlar.append(pre(s.shartnoma, " ") + "CRM ID: " + id_matn)
        if yolda:
            qatorlar.append(pre(s.shartnoma, " ") + "XonPay yo'lda: " + _kt_royxat(yolda))
        if yoq:
            qatorlar.append(pre(s.shartnoma, " ") + "bizda yo'q (bank sync): " + _kt_royxat(yoq))
        st = "ok"
        # ID bo'yicha farqlar: Billing'da yo'q XonPay, bank sync'da yo'q kompozit, boshqa shartnomadagi tx
        for xq in ts.xp_crm:
            farqlar.append(_xonpay_farq(xq, kop))
            kn.xonpay_crm.append(xq)
        for x in yoq:
            farqlar.append(_komp_yoq_farq(x))
            bor.add((s.shartnoma, "crm"))
            st = _max_status(st, C.TOLOV_FARQ_KODLARI["BIZDA_YOQ"])
        for x, t in ts.boshqa:
            farqlar.append(_farq("BOSHQA_SHARTNOMA", sana=x.sana, summa=x.summa, dalil="tx=" + qisqa_id(
                t.external_id or t.id), izoh="CRM'da %s ostida, bizda %s" % (s.shartnoma, t.shartnoma or "bo'sh"),
                komponent="crm_panel"))
            st = _max_status(st, C.TOLOV_FARQ_KODLARI["BOSHQA_SHARTNOMA"])
        # solishtirish: XonPay yo'ldagi va bank sync'da yo'q kompozitsiz (ular yuqorida o'z kodi bilan)
        crm_q = ts.qolgan
        cb, co, cj = jam(crm_q)
        juftlar, faqat_c, faqat_o = _royxat_juftla(crm_q, o.tolovlar)
        okv_toliq = len(o.tolovlar) >= o.soni       # backend OplatyKv ro'yxatini 200 ta bilan cheklaydi
        if abs(cj - o.jami) >= 1 or (okv_toliq and (faqat_c or faqat_o)):
            qatorlar.append(pre(s.shartnoma, " ") + "mos emas: faqat CRM: %s; faqat OplatyKv: %s" % (
                _kt_royxat(faqat_c), _kt_royxat(faqat_o)))
            kn.mos_emas[s.shartnoma] = (list(faqat_c), list(faqat_o))
            chiq = "; ".join(x for x in ("XonPay yo'lda %s" % pul(yj) if yolda else "",
                                         "bank sync'da yo'q %s" % pul(nj) if yoq else "") if x)
            farqlar.append(_farq(
                "CRM_FARQ", sana=max((x.sana for x in faqat_c + faqat_o if x.sana), default=""), summa=cj - o.jami,
                dalil=s.shartnoma,
                izoh="CRM to'lovlar %s, OKV %s; faqat CRM %d, faqat OKV %d%s%s" % (
                    pul(cj), pul(o.jami), len(faqat_c), len(faqat_o),
                    "" if okv_toliq else "; OKV ro'yxati to'liq emas",
                    "; chiqarildi: " + chiq if chiq else "")))
            bor.add((s.shartnoma, "crm"))
            st = _max_status(st, C.TOLOV_FARQ_KODLARI["CRM_FARQ"])
        elif abs(cb - o.bosh) >= 1 or abs(co - o.oylik) >= 1:
            sp = _split_juft(juftlar)
            if sp:
                ortiq = len(sp) - C.TOLOV_KOPRIK_OXIRGI
                qatorlar.append(pre(s.shartnoma, " ") + "split farqi: " + ", ".join(
                    "%s %s CRM %s, OplatyKv bosh. %s, oylik %s" % (x.sana, pul(x.summa), x.tur.split(" (")[0],
                                                                  pul(y.bosh), pul(y.oylik))
                    for x, y in sp[:C.TOLOV_KOPRIK_OXIRGI]) + (" +%d" % ortiq if ortiq > 0 else ""))
            farqlar.append(_farq(
                "CRM_SPLIT", sana=max((x.sana for x, _y in sp if x.sana), default=""), summa=cb - o.bosh,
                dalil=s.shartnoma,
                izoh="CRM bosh. %s, oylik %s; OKV bosh. %s, oylik %s" % (pul(cb), pul(co), pul(o.bosh), pul(o.oylik))))
        holat.append(st)
    for t in kn.tashlangan:
        qism.append(pre(t) + C.TOLOV_SABAB_KOPRIK_FORMAT)
        holat.append("unknown")
    if kn.komp_xato:
        qatorlar.append("kompozit qidiruvi o'qilmadi (bank sync tekshirilmadi): " + kn.komp_xato)
    bolimlar.append(Bolim("crm_panel", _max_status(*holat) if holat else "unknown",
                          " | ".join(qism) or "natija yo'q", qatorlar))

    # sheet: har ulangan sheet alohida bo'lim (nomi bilan); tanlanmaganlari faqat ma'lumot
    if not kn.sheetlar:
        bolimlar.append(Bolim("sheet", "unknown", C.TOLOV_SABAB_SHEET_YOQ))
    for sid, nomi in kn.sheetlar:
        qism, holat = [], []
        juft_sh = [(s, next((x for x in s.sheetlar if x.id == sid), None)) for s in kn.shartnomalar]
        if sid not in tanlangan:
            for s, sh in juft_sh:
                if sh is None or not sh.mavjud:
                    qism.append(pre(s.shartnoma) + ("o'qilmadi: " + (sh.sabab or "sabab yo'q") if sh
                                                    else "natija yo'q"))
                else:
                    qism.append(pre(s.shartnoma) + "%d qator, jami %s" % (sh.qatorlar, pul(sh.jami)))
            bolimlar.append(Bolim("sheet", "ok", "%s: %s: %s" % (nomi, C.TOLOV_SHEET_MALUMOT,
                                                                 " | ".join(qism) or "natija yo'q")))
            continue
        e = kn.eksportlar.get(sid)
        sq = [_eksport_sozlama(e) if e is not None else "eksport sozlamasi o'qilmadi: " + (
            kn.eksport_xato or "ro'yxatda yo'q")]
        mavjud_emas = [sh for _s0, sh in juft_sh if sh is not None and not sh.mavjud]
        if juft_sh and len(mavjud_emas) == len(juft_sh):
            bolimlar.append(Bolim("sheet", "unknown", "%s: o'qilmadi: %s" % (nomi, mavjud_emas[0].sabab or
                                                                              "sabab yo'q"), sq))
            continue
        for s, sh in juft_sh:
            o = s.okv
            if sh is None or not sh.mavjud:
                qism.append(pre(s.shartnoma) + ("o'qilmadi: " + (sh.sabab or "sabab yo'q") if sh else "natija yo'q"))
                holat.append("unknown")
                continue
            dalil = "%s sheet=%s" % (s.shartnoma, nomi)
            if sh.qatorlar == 0:
                if o.soni > 0:
                    qism.append(pre(s.shartnoma) + "shartnoma qatori topilmadi (OplatyKv %d qator, jami %s)" % (
                        o.soni, pul(o.jami)))
                    sabab, tuz, sq_q = _sheet_sababi(s.shartnoma, nomi, sid, kn, okv, tx, topilgan)
                    sq += [pre(s.shartnoma, " ") + "sabab: " + x for x in sq_q]
                    f = _farq("SHEET_YOQ", sana=max((x.sana for x in o.tolovlar if x.sana), default=""),
                              summa=o.jami, dalil=dalil, tuzatish=tuz,
                              izoh="OplatyKv %d qator, sheetda shartnoma qatori yo'q" % o.soni)
                    f.sabab = sabab
                    farqlar.append(f)
                    bor.add((s.shartnoma, sid))
                    holat.append(C.TOLOV_FARQ_KODLARI["SHEET_YOQ"])
                else:
                    qism.append(pre(s.shartnoma) + "qator yo'q (OplatyKv'da ham yo'q)")
                    holat.append("ok")
                continue
            juftlar, faqat_o, faqat_s = _royxat_juftla(o.tolovlar, sh.tolovlar)
            sanalar = [x.sana for x, _y in juftlar if x.sana]
            q = ["bosh. %s, oylik %s, jami %s" % (pul(sh.bosh), pul(sh.oylik), pul(sh.jami)),
                 "%d qator" % sh.qatorlar]
            if sh.tolovlar:
                q.append("oxirgi qator #%d" % max(x.qator for x in sh.tolovlar))
            q.append("oxirgi to'lov ~%s" % max(sanalar) if sanalar else "oxirgi to'lov sanasi noma'lum")
            ustun = _ustun_farq(sh, o)
            if ustun:
                q.append("sheet - OplatyKv: " + _farq_matn(ustun))
                if faqat_o:
                    q.append("sheetda yo'q: " + _kt_royxat(faqat_o, 3))
                if faqat_s:
                    q.append("OplatyKv'da yo'q: " + _kt_royxat(faqat_s, 3))
                sp = _split_juft(juftlar)
                if sp:
                    q.append("split farqi: " + ", ".join("%s %s sheet bosh. %s, oylik %s" % (
                        x.sana or "-", pul(x.summa), pul(y.bosh), pul(y.oylik)) for x, y in sp[:3]))
                sabab, tuz, sq_q = _sheet_sababi(s.shartnoma, nomi, sid, kn, okv, tx, topilgan)
                sq += [pre(s.shartnoma, " ") + "sabab: " + x for x in sq_q]
                f = _farq("SHEET_FARQ", sana=max((x.sana for x in faqat_o if x.sana), default=""),
                          summa=sh.jami - o.jami, dalil=dalil, tuzatish=tuz, izoh="sheet - OKV: " + _farq_matn(ustun))
                f.sabab = sabab
                farqlar.append(f)
                bor.add((s.shartnoma, sid))
                holat.append(C.TOLOV_FARQ_KODLARI["SHEET_FARQ"])
            else:
                q.append("OplatyKv bilan mos")
                holat.append("ok")
            qism.append(pre(s.shartnoma) + "; ".join(q))
        bolimlar.append(Bolim("sheet", _max_status(*holat) if holat else "unknown",
                              "%s: %s" % (nomi, " | ".join(qism) or "natija yo'q"), sq))

    # panel_solishtirish: OplatyKv (aniq raqam) vs CRM to'lovlari vs tanlangan sheetlar
    qism, holat = [], []
    for s in kn.shartnomalar:
        o, c = s.okv, s.crm
        q = ["panel %s" % ("Mos" if s.mos else "Farqli"),
             "OplatyKv (aniq raqam) %d qator, jami %s (bosh. %s, oylik %s)" % (o.soni, pul(o.jami), pul(o.bosh),
                                                                               pul(o.oylik))]
        st = "warn" if (s.shartnoma, "crm") in bor else "ok"
        if c.topildi:
            cb, co, cj = _crm_yigindi(c)
            q.append("CRM to'lovlar - OplatyKv = %s (bosh. %s, oylik %s)" % (pul(cj - o.jami), pul(cb - o.bosh),
                                                                             pul(co - o.oylik)))
            yj, nj = chiqarilgan.get(s.shartnoma, (_NOL, _NOL))
            if yj:
                q.append("shundan XonPay yo'lda %s" % pul(yj))
            if nj:
                q.append("shundan bizda yo'q (bank sync) %s" % pul(nj))
        else:
            q.append("CRM javob bermadi" if c.xato else "CRM topilmadi")
            st = _max_status(st, "unknown")
        for sh in s.sheetlar:
            if sh.id not in tanlangan:
                continue
            if not sh.mavjud:
                q.append("%s o'qilmadi" % sh.nomi)
                st = _max_status(st, "unknown")
                continue
            d = (sh.jami - o.jami, sh.bosh - o.bosh, sh.oylik - o.oylik)
            q.append("%s - OplatyKv = %s (bosh. %s, oylik %s)" % ((sh.nomi,) + tuple(pul(x) for x in d)))
            if (s.shartnoma, sh.id) in bor:
                st = _max_status(st, "warn")
        qism.append(pre(s.shartnoma) + "; ".join(q))
        holat.append(st)
    for t in kn.tashlangan:
        qism.append(pre(t) + C.TOLOV_SABAB_KOPRIK_FORMAT)
        holat.append("unknown")
    bolimlar.append(Bolim("panel_solishtirish", _max_status(*holat) if holat else "unknown",
                          " | ".join(qism) or "natija yo'q"))
    return farqlar, bolimlar


def _koprik_crm_ok(kn: Optional[KoprikNatija]) -> bool:
    return kn is not None and not kn.xato and any(s.crm.topildi for s in kn.shartnomalar)


# ---------------------------------------------------------------------------
# Juftlash (sof)
# ---------------------------------------------------------------------------
@dataclass
class _Birlik:
    okv: Optional[Okv]
    tx: Optional[Tx]
    full: str
    core: str
    gid: str
    sana: str
    summa: Decimal
    kalit: str
    hamkor: bool


def _birlik(o: Optional[Okv], t: Optional[Tx]) -> _Birlik:
    full = (t.external_id if t and t.external_id else "") or (o.source_tx_id if o else "") \
        or (o.id if o else (t.id if t else ""))
    core = composite_core(full) or (composite_core(o.source_tx_id) if o else "")
    gid = (t.gid if t and t.gid.isdigit() else "") or _gid(full)
    bank = (t.bank if t else "").upper()
    return _Birlik(
        okv=o, tx=t, full=full, core=core, gid=gid, sana=o.sana if o else (t.sana if t else ""),
        summa=o.summa if o else (t.ishorali if t else _NOL), kalit=(o.id if o else "") or (t.id if t else ""),
        hamkor="HAMKOR" in bank or full.startswith("HB_"),
    )


def _birliklar(okv: Sequence[Okv], tx: Sequence[Tx]) -> List[_Birlik]:
    out: List[_Birlik] = []
    band: Set[str] = set()
    for o in okv:
        if o.tx is not None:
            band.add(o.tx.id)
        out.append(_birlik(o, o.tx))
    for t in tx:
        if t.id in band:
            continue
        band.add(t.id)
        out.append(_birlik(None, t))
    out.sort(key=lambda b: (b.sana, b.summa, b.kalit))
    return out


def _kun_farq(a: str, b: str) -> Optional[int]:
    try:
        return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days)
    except (TypeError, ValueError):
        return None


def _ishora_mos(c: CrmTolov, b: _Birlik) -> bool:
    return (c.amount < 0) == (b.summa < 0)


def _yaqin(a: Decimal, b: Decimal) -> bool:
    """L6 chegarasi: farq kattaroq summaning yarmidan oshmasin (tasodifiy juftlashga qarshi)."""
    kat = max(abs(a), abs(b))
    return kat > 0 and abs(a - b) <= kat / 2


def _guruh_xarita(kanon: Sequence[str]) -> Callable[[Any], int]:
    """Shartnoma satri -> kirish shartnomasining indeksi (skelet bo'yicha, /SH shakllari bilan); topilmasa -1.
    Bitta shartnoma bo'lsa hammasi 0 (guruhlash o'chiq, oldingi xatti-harakat)."""
    if len(kanon) <= 1:
        return lambda _x: 0
    kalitlar = [{skelet(v) for v in variantlar(k)} | {skelet(k)} for k in kanon]

    def g(x: Any) -> int:
        s = skelet(x)
        if not s:
            return -1
        for i, kk in enumerate(kalitlar):
            if s in kk:
                return i
        return -1

    return g


def _birlik_guruh(b: _Birlik, g: Callable[[Any], int]) -> int:
    for sh in ((b.okv.shartnoma if b.okv else ""), (b.tx.shartnoma if b.tx else ""),
               (b.tx.okv_shartnoma if b.tx else "")):
        if sh:
            i = g(sh)
            if i >= 0:
                return i
    return -1


def _moslash(crm: List[CrmTolov], bir: List[_Birlik], xonpay: Sequence[Dict[str, Any]],
             cg: Optional[Sequence[int]] = None, bg: Optional[Sequence[int]] = None,
             kutilgan: Optional[Set[int]] = None
             ) -> Tuple[Dict[int, Tuple[int, str]], Dict[int, int], Set[int]]:
    """CRM indeksi -> (birlik indeksi, moslik). L1..L6, har bosqichdan keyin juftlanganlar chiqariladi.

    cg/bg: shartnoma guruhi (kirish indeksi, -1 noma'lum). L1-L4 (ID) guruhdan tashqari ham juftlaydi
    (juftla BOSHQA_SHARTNOMA beradi), L5-L6 (faqat summa/sana) faqat bitta guruh ichida.
    kutilgan: XonPay yo'ldagi CRM qatorlari (Billing: pul bizda hali yo'q): L5-L6 ga kirmaydi.
    Qaytadi: (juftlar, noaniq nomzodlar soni, takror): takror = external_id i boshqa contract qatorida
    ham bor CRM qatori (CRM dublikati); u L5-L6 ga kirmaydi va BIZDA_YOQ (dublikat) bo'lib chiqadi.
    """
    cg = list(cg) if cg is not None else [0] * len(crm)
    bg = list(bg) if bg is not None else [0] * len(bir)
    kutilgan = kutilgan or set()
    juft: Dict[int, Tuple[int, str]] = {}
    band: Set[int] = set()
    noaniq: Dict[int, int] = {}

    def bosqich(kc: Callable[[CrmTolov], str], kb: Callable[[_Birlik], str], nom: str) -> None:
        idx: Dict[str, List[int]] = {}
        for bi, b in enumerate(bir):
            k = kb(b)
            if k and bi not in band:
                idx.setdefault(k, []).append(bi)
        for ci, c in enumerate(crm):
            if ci in juft:
                continue
            k = kc(c)
            for bi in idx.get(k, []) if k else []:
                if bi not in band and _ishora_mos(c, bir[bi]):
                    juft[ci] = (bi, nom)
                    band.add(bi)
                    break

    bosqich(lambda c: c.external_id, lambda b: b.full, "kuchli")                 # L1
    bosqich(lambda c: composite_core(c.external_id), lambda b: b.core, "yadro")  # L2
    bosqich(lambda c: _gid(c.external_id), lambda b: b.gid, "gid")                # L3
    # L4: CRM purpose UUID (yoki XonPay external_id) -> xonpay_transactions.matched_tx_id == birlik tx
    uuid_tx: Dict[str, str] = {}
    ext_tx: Dict[str, str] = {}
    for x in xonpay:
        tid = _s(x.get("matched_tx_id"))
        if not tid:
            continue
        if _s(x.get("xonpay_uuid")):
            uuid_tx[_s(x.get("xonpay_uuid")).upper()] = tid
        if _s(x.get("external_id")):
            ext_tx[_s(x.get("external_id"))] = tid
    tx_bi = {b.tx.id: bi for bi, b in enumerate(bir) if b.tx is not None}
    for ci, c in enumerate(crm):
        if ci in juft:
            continue
        tid = uuid_tx.get(c.xonpay_uuid) if c.xonpay_uuid else None
        tid = tid or ext_tx.get(c.external_id)
        bi = tx_bi.get(tid) if tid else None
        if bi is not None and bi not in band and _ishora_mos(c, bir[bi]):
            juft[ci] = (bi, "xonpay")
            band.add(bi)

    # CRM dublikati: bir external_id bir nechta contract qatorida. Asosiysi: juftlangani, bo'lmasa birinchisi
    ext_qator: Dict[str, List[int]] = {}
    for ci, c in enumerate(crm):
        if c.external_id and c.manba != "transaction_id":
            ext_qator.setdefault(c.external_id, []).append(ci)
    takror: Set[int] = set()
    for cis in ext_qator.values():
        if len(cis) < 2:
            continue
        asosiy = next((ci for ci in cis if ci in juft), cis[0])
        takror.update(ci for ci in cis if ci != asosiy and ci not in juft)

    def kuchsiz_mumkin(ci: int) -> bool:
        return ci not in juft and ci not in takror and ci not in kutilgan and crm[ci].manba != "transaction_id"

    # L5: summa teng, sana +-3 kun (Hamkor +-5), bitta guruh, ikki tomonda ham yagona nomzod
    def l5(ci: int, bi: int) -> bool:
        c, b = crm[ci], bir[bi]
        if cg[ci] != bg[bi] or not _ishora_mos(c, b) or abs(c.amount - b.summa) >= _TIYIN:
            return False
        dd = _kun_farq(c.sana, b.sana)
        return dd is not None and dd <= (5 if b.hamkor else 3)

    for ci in range(len(crm)):
        if not kuchsiz_mumkin(ci):
            continue
        nomzod = [bi for bi in range(len(bir)) if bi not in band and l5(ci, bi)]
        if len(nomzod) != 1:
            if len(nomzod) > 1:
                noaniq[ci] = len(nomzod)
            continue
        teskari = [cj for cj in range(len(crm)) if kuchsiz_mumkin(cj) and l5(cj, nomzod[0])]
        if teskari != [ci]:
            noaniq[ci] = len(teskari)
            continue
        juft[ci] = (nomzod[0], "kuchsiz")
        band.add(nomzod[0])
    # L6: sana bir xil, bitta guruh, ikki tomonda yagona, summa yaqin (faqat musbat) -> SUMMA_FARQ
    for ci, c in enumerate(crm):
        if not kuchsiz_mumkin(ci) or c.amount < 0:
            continue
        nomzod = [bi for bi, b in enumerate(bir) if bi not in band and b.sana == c.sana and b.summa >= 0
                  and bg[bi] == cg[ci]]
        if len(nomzod) != 1:
            continue
        teskari = [cj for cj, c2 in enumerate(crm) if kuchsiz_mumkin(cj) and c2.sana == c.sana and c2.amount >= 0
                   and cg[cj] == cg[ci]]
        if teskari != [ci] or not _yaqin(c.amount, bir[nomzod[0]].summa):
            continue
        juft[ci] = (nomzod[0], "kuchsiz")
        band.add(nomzod[0])
    return juft, noaniq, takror


def _farq(kod: str, *, sana: str = "", summa: Optional[Decimal] = None, dalil: str = "", izoh: str = "",
          komponent: str = "", ochiq: Any = None, tuzatish: str = "") -> Farq:
    """ochiq: to'lovchi erkin matni (xom). Blokka faqat _izoh_raqam, egasiga _izoh_pii (80 belgi).
    tuzatish: bo'sh bo'lsa FARQ_TUZATISH[kod] (SHEET_* da sheet nomi bilan aniq yo'l beriladi)."""
    return Farq(kod=kod, jiddiylik=C.TOLOV_FARQ_KODLARI[kod], sana=sana, summa=summa, dalil=dalil, izoh=izoh,
                tuzatish=tuzatish or FARQ_TUZATISH[kod], komponent=komponent or _KOD_KOMPONENT.get(kod, ""),
                ochiq=_izoh_pii(ochiq, _IZOH_MAX), ochiq_raqam=_izoh_raqam(ochiq))


def _xonpay_farq(x: XonpayQator, kop: bool = False) -> Farq:
    """XONPAY_KUTILMOQDA (info) yoki XONPAY_KECHIKDI (warn). izoh: o'tgan ish kunlari; sabab: egasi matni
    (TOLOV_XONPAY_*_TPL, izohdan uzun: 80 belgida kesilmasin)."""
    kechikdi = x.holat == "KECHIKDI"
    f = _farq("XONPAY_KECHIKDI" if kechikdi else "XONPAY_KUTILMOQDA", sana=x.sana, summa=x.summa,
              dalil="xonpay=" + _uuid_qisqa(x) + (" " + x.shartnoma if kop and x.shartnoma else ""),
              izoh=_xonpay_tafsil(x))
    f.sabab = (C.TOLOV_XONPAY_KECHIKDI_TPL.format(n=x.ish_kun) if kechikdi
               else C.TOLOV_XONPAY_KUTILMOQDA_TPL.format(sana=x.sana))
    return f


def _raqamla(farqlar: List[Farq], juftlar: Sequence[Juft]) -> None:
    """Farqlarni jiddiylik, kod tartibi, sana, summa bo'yicha saralab F1, F2 ... raqamlaydi (juftlardagi
    farq ro'yxati ham). Yangi farq qo'shilganda (panel ko'prigi) qayta chaqiriladi."""
    farqlar.sort(key=lambda f: (f.yashirin, _SEV_RANK.get(f.jiddiylik, 9), _KOD_TARTIB.get(f.kod, 99), f.sana,
                                f.summa if f.summa is not None else _NOL, f.dalil, f.izoh))
    for i, f in enumerate(farqlar, 1):
        f.raqam = i
    for j in juftlar:
        j.farqlar.sort(key=lambda f: f.raqam)
        j.kodlar = [f.kod for f in j.farqlar]


def _okv_harf(o: Optional[Okv]) -> str:
    return {"FIRST": "B", "MONTHLY": "O", "GENERAL": "U"}.get(o.turi, "-") if o else "-"


def _crm_harf(c: CrmTolov) -> str:
    return {"initial": "B", "monthly": "O", "mixed": "A"}.get(c.kind, "-")


def _dalil(o: Optional[Okv], t: Optional[Tx], c: Optional[CrmTolov] = None) -> str:
    q: List[str] = []
    if o is not None:
        q.append("okv=" + qisqa_id(o.source_tx_id or o.id))
    elif t is not None:
        q.append("tx=" + qisqa_id(t.external_id or t.id))
    if c is not None and c.external_id and (o is None and t is None):
        q.append("crm=" + qisqa_id(c.external_id))
    return " ".join(q) or "-"


def _drift(o: Okv, t: Tx) -> List[str]:
    """OKV <-> tx maydonlari: shartnoma, summa, ishora, Toshkent sanasi, kategoriya."""
    out: List[str] = []
    if t.shartnoma and o.shartnoma != t.shartnoma:
        out.append("shartnoma (OKV %s, tx %s)" % (o.shartnoma, t.shartnoma))
    if abs(abs(o.summa) - t.summa) >= _TIYIN:
        out.append("summa (OKV %s, tx %s)" % (pul(o.summa), pul(t.ishorali)))
    if o.summa != 0 and (o.summa < 0) != (t.yon == "OUT"):
        out.append("ishora (OKV %s, tx %s)" % (pul(o.summa), t.yon))
    if t.sana and o.sana and o.sana != t.sana:
        out.append("sana (OKV %s, tx %s)" % (o.sana, t.sana))
    if t.kat and t.kat != "CLIENT":
        out.append("kategoriya (tx %s)" % t.kat)
    return out


def juftla(crm: Optional[Sequence[CrmTolov]], okv: Sequence[Okv], tx: Sequence[Tx],
           ctx: Optional[Kontekst] = None) -> Tuple[List[Juft], List[Farq]]:
    """CRM <-> OKV <-> TX juftlari va kodlangan farqlar (dizayn 1.6). crm=None: CRM tekshirilmadi,
    CRM bilan bog'liq kodlar chiqmaydi. Natija deterministik (saralangan, raqamlangan)."""
    ctx = ctx or Kontekst()
    farqlar: List[Farq] = []
    bir = _birliklar(okv, tx)
    kanon = set(ctx.kanon)
    kanon_norm = {norm_contract(k) for k in ctx.kanon}
    crm_list = sorted(crm or [], key=lambda c: (c.sana, c.amount, c.external_id, c.contract, c.manba))
    # transaction_id qatori: contract qatorida (yoki oldingi transaction_id qatorida) shu external_id bo'lsa
    # tashlanadi. contract qatorlari o'zaro TASHLANMAYDI: bir shartnomadagi takror = CRM dublikati (_moslash)
    kor: Set[str] = {c.external_id for c in crm_list if c.external_id and c.manba != "transaction_id"}
    tmp: List[CrmTolov] = []
    for c in crm_list:
        if c.manba == "transaction_id" and c.external_id:
            if c.external_id in kor:
                continue
            kor.add(c.external_id)
        tmp.append(c)
    crm_list = tmp
    # ko'p shartnoma: har qator o'z kirish shartnomasi guruhida (L5-L6 guruhlar orasida juftlamaydi)
    guruh = _guruh_xarita(ctx.kanon)
    bg = [_birlik_guruh(b, guruh) for b in bir]
    cg = [guruh(c.contract) for c in crm_list]
    vz_guruh = {i for i, k in enumerate(ctx.kanon) if k in ctx.vznos}
    # XonPay yo'ldagi to'lovlar (Billing: CRM'da bor, pul bizda hali yo'q): BIZDA_YOQ emas, XONPAY_*.
    # CRM qatori bilan bog'lash: avval UUID (purpose) yoki external_id, keyin summa + sana (faqat-CRM qatorida)
    xp_hammasi = ctx.xonpay_holat if ctx.xonpay_holat is not None else xonpay_qatorlari(ctx.xonpay, ctx.hozir)
    xp_kutish = [x for x in xp_hammasi if x.yolda and guruh(x.shartnoma) >= 0]
    xp_g = [guruh(x.shartnoma) for x in xp_kutish]
    uuid_i = {x.uuid.upper(): i for i, x in enumerate(xp_kutish) if x.uuid}
    ext_i = {x.ext.lower(): i for i, x in enumerate(xp_kutish) if x.ext}
    billingda = {k for x in xp_hammasi for k in (x.uuid, x.ext.lower()) if k}
    xp_id: Dict[int, int] = {}                           # CRM indeksi -> xp_kutish indeksi
    for ci, c in enumerate(crm_list):
        if c.manba == "transaction_id":
            continue
        xi = uuid_i.get(c.xonpay_uuid.upper()) if c.xonpay_uuid else None
        if xi is None and c.external_id:
            xi = ext_i.get(c.external_id.lower())
        u = c.external_id.lower()
        if xi is None and _UUID_RE.match(u) and u not in billingda and (
                c.xonpay_uuid.lower() == u or _xonpay_usul(c.method)):
            # CRM Внешний ID = XonPay UUID, Billing'da hali yo'q (sync 07-23): holat CRM sanasidan
            billingda.add(u)
            xp_kutish.append(_xonpay_crmdan(u, c.contract, c.amount, c.sana, ctx.hozir))
            xp_g.append(cg[ci])
            xi = len(xp_kutish) - 1
        if xi is not None and xi not in xp_id.values():
            xp_id[ci] = xi
    if crm is not None:
        juft_c, noaniq, takror = _moslash(crm_list, bir, ctx.xonpay, cg, bg, set(xp_id))
    else:
        juft_c, noaniq, takror = {}, {}, set()
    bir_c = {bi: (ci, nom) for ci, (bi, nom) in juft_c.items()}

    juftlar: List[Juft] = []

    def qosh(j: Optional[Juft], f: Farq) -> None:
        farqlar.append(f)
        if j is not None:
            j.farqlar.append(f)

    maqsad = ctx.maqsad
    for bi, b in enumerate(bir):
        c, nom = (crm_list[bir_c[bi][0]], bir_c[bi][1]) if bi in bir_c else (None, "-")
        kalitlar = {x for x in (b.okv.id if b.okv else "", b.okv.source_tx_id if b.okv else "",
                                b.tx.id if b.tx else "", b.tx.external_id if b.tx else "") if x}
        juftlar.append(Juft(crm=c, okv=b.okv, tx=b.tx, moslik=nom, maqsad=bool(kalitlar & maqsad)))
    band_crm = set(juft_c)
    faqat_crm: List[Tuple[int, Juft]] = []
    for ci, c in enumerate(crm_list):
        if ci in band_crm or c.manba == "transaction_id":
            continue
        if ctx.bizning_oyna and c.sana and c.sana < ctx.bizning_oyna:
            continue  # bizda ko'rilmagan davr (qisman): solishtirilmaydi, jamilar baribir to'liq
        if ctx.bizda_qisman:
            continue  # Q2/Q3 o'qilmadi: "bizda yo'q" deb bo'lmaydi (BIZDA_YOQ chiqmaydi)
        j = Juft(crm=c, moslik="-", maqsad=bool(c.external_id and c.external_id in maqsad) or bool(
            c.xonpay_uuid and {c.xonpay_uuid, c.xonpay_uuid.lower()} & maqsad))
        juftlar.append(j)
        faqat_crm.append((ci, j))

    xato_okv: Set[str] = set()
    for bi, (j, b) in enumerate(zip(juftlar, bir)):
        o, t, c = j.okv, j.tx, j.crm
        dalil = _dalil(o, t)
        sana, summa = b.sana, b.summa
        # XATO (oplata ta'rifi) va kanonik emas. crm_kesh o'qilmasa XATO noma'lum (belgilanadi)
        xato_mumkin = o is not None and bool(o.source_tx_id) and not (t and t.xato_hidden)
        if xato_mumkin and ctx.topilgan is None:
            j.xato_nomalum = True
        if xato_mumkin and ctx.topilgan is not None and o.shartnoma not in ctx.topilgan:
            xato_okv.add(o.id)
            qosh(j, _farq("XATO", sana=sana, summa=summa, dalil=dalil, izoh="contract_no=%s" % o.shartnoma,
                          ochiq=o.purpose))
        if c is not None:
            dd = _kun_farq(c.sana, b.sana)
            if abs(c.amount - b.summa) >= _TIYIN:
                qosh(j, _farq("SUMMA_FARQ", sana=sana, summa=summa, dalil=dalil,
                              izoh="CRM %s, bizda %s" % (pul(c.amount), pul(b.summa))))
            if dd:
                qosh(j, _farq("SANA_SILJIGAN", sana=sana, summa=summa, dalil=dalil,
                              izoh="CRM %s, bizda %s (%d kun)" % (c.sana, b.sana, dd)))
            if j.moslik == "kuchsiz":
                qosh(j, _farq("KUCHSIZ_MOSLIK", sana=sana, summa=summa, dalil=dalil,
                              izoh="faqat summa va sana bo'yicha"))
            if o is not None and o.turi not in ("", "GENERAL") and not o.pgroup and o.id not in xato_okv:
                cb, co = crm_split(c)
                if abs(cb - (o.first or _NOL)) >= 1:
                    qosh(j, _farq("SPLIT_FARQ", sana=sana, summa=summa, dalil=dalil,
                                  izoh="CRM bosh. %s / oylik %s; OKV bosh. %s / oylik %s" % (
                                      pul(cb), pul(co), pul(o.first or 0), pul(o.monthly or 0))))
            ci = bir_c[bi][0]
            if c.manba == "transaction_id" and norm_contract(c.contract) not in kanon_norm:
                qosh(j, _farq("BOSHQA_SHARTNOMA", sana=sana, summa=summa, dalil=dalil,
                              izoh="CRM'da %s ostida" % (c.contract or "?")))
            elif cg[ci] >= 0 and bg[bi] >= 0 and cg[ci] != bg[bi]:
                # ko'p shartnoma: ID bo'yicha juft, lekin CRM boshqa kirish shartnomasi ostida yozgan
                bizda = (o.shartnoma if o else "") or (t.shartnoma if t else "") or "?"
                qosh(j, _farq("BOSHQA_SHARTNOMA", sana=sana, summa=summa, dalil=dalil,
                              izoh="CRM'da %s ostida, bizda %s" % (c.contract or "?", bizda)))
        # SPLIT_YOQ: XATO qatorida emas; crm_kesh o'qilmasa XATO bo'lishi mumkin qatorda ham emas
        if o is not None and not o.turi and not o.pgroup and o.id not in xato_okv and not j.xato_nomalum:
            qosh(j, _farq("SPLIT_YOQ", sana=sana, summa=summa, dalil=dalil, izoh="payment_category bo'sh"))
        # CRM'da yo'q (CRM tekshirilgan bo'lsa; CRM ro'yxati qisman bo'lsa undan eski davr solishtirilmaydi)
        if crm is not None and c is None and not (ctx.crm_oyna and sana and sana < ctx.crm_oyna):
            sh = o.shartnoma if o else (t.shartnoma if t else "")
            if o is not None and o.pgroup:
                qosh(j, _farq("PEREBROSKA", sana=sana, summa=summa, dalil=dalil, izoh="perebroska guruhi"))
            elif sh in ctx.vznos or bg[bi] in vz_guruh:
                qosh(j, _farq("VZNOS", sana=sana, summa=summa, dalil=dalil, izoh="vznos reestri"))
            elif o is not None and o.turi == "GENERAL":
                qosh(j, _farq("SCHETCHIK", sana=sana, summa=summa, dalil=dalil, izoh="GENERAL (umumiy)"))
            elif o is not None or (t is not None and t.kat == "CLIENT"):
                izoh = "CRM'da jufti yo'q"
                qosh(j, _farq("CRM_YOQ", sana=sana, summa=summa, dalil=dalil, izoh=izoh))
        # OKV <-> TX
        if o is not None and o.source_tx_id and t is None:
            qosh(j, _farq("TX_YOQ", sana=sana, summa=summa, dalil=dalil,
                          izoh="source_tx_id bor, tranzaksiya topilmadi"))
        if o is not None and t is not None:
            dr = _drift(o, t)
            if dr:
                qosh(j, _farq("DRIFT", sana=sana, summa=summa, dalil=dalil, izoh="; ".join(dr)))
            if t.holat and t.holat != "COMPLETED":
                qosh(j, _farq("TX_HOLAT", sana=sana, summa=summa, dalil=dalil, izoh="tx holati " + t.holat))
        if o is None and t is not None:
            if t.okv_id:
                if t.okv_shartnoma and t.okv_shartnoma != t.shartnoma and t.okv_shartnoma not in kanon:
                    qosh(j, _farq("DRIFT", sana=sana, summa=summa, dalil=dalil,
                                  izoh="OKV qatori boshqa shartnomada: %s" % t.okv_shartnoma))
            elif t.shartnoma and t.kat != "CLIENT" and not (t.shartnoma in ctx.vznos or bg[bi] in vz_guruh):
                qosh(j, _farq("KATEGORIYA", sana=sana, summa=summa, dalil=dalil,
                              izoh="tx kategoriya %s: OplatyKv'ga tushmaydi" % (t.kat or "yo'q")))
            elif t.kat == "CLIENT" and t.shartnoma:
                hisob = " *" + t.hisob4 if t.hisob4 else ""
                izoh = "bank %s%s; tx %s" % (_bank_qisqa(t.bank), hisob, t.holat or "-")
                if ctx.tx_min is not None and t.vaqt is not None and t.vaqt <= _kun_chegarasi(ctx.tx_min):
                    qosh(j, _farq("TXMINDATE", sana=sana, summa=summa, dalil=dalil,
                                  izoh="txMinDate %s dan oldin; %s" % (ctx.tx_min.isoformat(), izoh)))
                elif _yangi(t, ctx):
                    qosh(j, _farq("SYNC_KUTILMOQDA", sana=sana, summa=summa, dalil=dalil, izoh=izoh))
                else:
                    qosh(j, _farq("OKV_YOQ", sana=sana, summa=summa, dalil=dalil, izoh=izoh))
    # Kanonik emas: har noto'g'ri shakl uchun bitta farq (qatorlariga biriktiriladi)
    if ctx.topilgan is not None:
        guruh: Dict[str, List[Juft]] = {}
        kanon_found = [k for k in ctx.kanon if k in ctx.topilgan]
        for j in juftlar:
            sh = j.okv.shartnoma if j.okv else (j.tx.shartnoma if j.tx else "")
            if sh and sh not in ctx.topilgan and sh not in kanon:
                for k in kanon_found:
                    if skelet(sh) == skelet(k):
                        guruh.setdefault("%s ≈ %s" % (sh, k), []).append(j)
                        break
        for dalil, js in sorted(guruh.items()):
            f = _farq("KANONIK_EMAS", sana=max(_j_sana(j) for j in js), summa=sum((_j_summa(j) for j in js), _NOL),
                      dalil=dalil, izoh="%d qator; CRM'da kanonik shakl ostida" % len(js))
            farqlar.append(f)
            for j in js:
                j.farqlar.append(f)
    # Dublikat: sanasiz yadro bo'yicha 2+ OKV qatori
    dub: Dict[str, List[Juft]] = {}
    for j in juftlar:
        if j.okv is not None and j.okv.source_tx_id and _SANASIZ_RE.search(j.okv.source_tx_id):
            dub.setdefault(_SANASIZ_RE.sub("_@_", j.okv.source_tx_id, count=1), []).append(j)
    for kalit, js in sorted(dub.items()):
        if len(js) < 2:
            continue
        f = _farq("DUBLIKAT", sana=min(_j_sana(j) for j in js), summa=_j_summa(js[0]),
                  dalil=" ".join("okv=" + qisqa_id(j.okv.source_tx_id) for j in js if j.okv)[:160],
                  izoh="%d qator bitta to'lov (sana ko'chgan)" % len(js))
        farqlar.append(f)
        for j in js:
            j.farqlar.append(f)
    # CRM'da bor, bizda yo'q (XonPay yo'ldagisi alohida kod: XONPAY_KUTILMOQDA / XONPAY_KECHIKDI)
    kop = len(ctx.kanon) > 1
    id_band = set(xp_id.values())
    xp_band: Set[int] = {xi for ci, xi in xp_id.items() if ci in band_crm}   # CRM qatori bank bilan ID juft
    for ci, j in faqat_crm:
        c = j.crm
        if c is None:
            continue
        xi = xp_id.get(ci)
        if xi is None and ci not in takror and c.amount >= 0:
            nomzod: List[Tuple[int, int]] = []
            for k, x in enumerate(xp_kutish):
                if k in xp_band or k in id_band or xp_g[k] != cg[ci] or abs(c.amount - x.summa) >= 1:
                    continue
                dd = _kun_farq(c.sana, x.sana)
                if dd is not None and dd <= C.TOLOV_XONPAY_SANA_OYNA:
                    nomzod.append((dd, k))
            xi = min(nomzod)[1] if nomzod else None
        if xi is not None and xi not in xp_band:
            xp_band.add(xi)
            qosh(j, _xonpay_farq(xp_kutish[xi], kop))
            continue
        if c.amount < 0 and ci not in takror:
            qosh(j, _farq("QAYTARIM", sana=c.sana, summa=c.amount, dalil=_dalil(None, None, c),
                          izoh="CRM qaytarim, bizda manfiy jufti yo'q"))
        else:
            izoh = "bankdan: %s; usul: %s" % ("ha" if c.from_bank else "yo'q", _toza(_lotin(c.method), 40) or "-")
            if ci in takror:
                izoh = "CRM dublikat (external_id takror); " + izoh
            if c.problematic:
                izoh += "; CRM muammoli"
            if c.xonpay_uuid:
                izoh += "; XonPay"
            if ci in noaniq:
                izoh += "; nomzod %d (juftlanmadi)" % noaniq[ci]
            f = _farq("BIZDA_YOQ", sana=c.sana, summa=c.amount, dalil=_dalil(None, None, c), izoh=izoh)
            f.ochiq, f.ochiq_raqam = c.purpose or "", c.izoh_raqam or ""   # _crm_qisqa da maskalangan
            qosh(j, f)
    # CRM qatori bilan bog'lanmagan XonPay yo'ldagi to'lovlar (CRM tekshirilmagan yoki panel yo'li): alohida
    for k, x in enumerate(xp_kutish):
        if k not in xp_band:
            qosh(None, _xonpay_farq(x, kop))
    # Tarix izlari
    kalit_juft: Dict[str, Juft] = {}
    for j in juftlar:
        for x in (j.okv.id if j.okv else "", j.okv.source_tx_id if j.okv else "",
                  j.tx.id if j.tx else "", j.tx.external_id if j.tx else ""):
            if x:
                kalit_juft.setdefault(x, j)
    log_kod = {"DELETED": "BANK_OCHIRGAN", "MOVED": "BANK_KOCHIRGAN", "EDITED": "BANK_TAHRIRLAGAN"}
    for r in ctx.loglar:
        kod = log_kod.get(_s(r.get("tur")))
        if kod is None:
            continue
        ext = _s(r.get("external_id"))
        yon = _s(r.get("yon"))
        summa = _dec(r.get("amount")) * (-1 if yon == "OUT" else 1) if r.get("amount") is not None else None
        maydon = ", ".join(_s(x) for x in (r.get("fields_changed") or [])[:6])
        izoh = "aniqlangan %s" % (SF._vaqt(r.get("detected_at")) or "-")
        if maydon:
            izoh += "; maydonlar: " + maydon
        f = _farq(kod, sana=_sana_of(r.get("txn_date")), summa=summa, dalil="tx=" + qisqa_id(ext), izoh=izoh)
        f.hodisa = _sana_of(r.get("detected_at")) if r.get("detected_at") is not None else ""
        qosh(kalit_juft.get(ext), f)
    for r in ctx.tarix:
        izoh = "%s %s (kim: %s)" % (_s(r.get("action")), SF._vaqt(r.get("created_at")) or "-",
                                   _toza(_lotin(_s(r.get("kim"))), 40) or "-")
        if _s(r.get("action")) == "edited":
            izoh += "; shartnoma %s -> %s" % (_s(r.get("eski")) or "-", _s(r.get("yangi")) or "bo'sh")
        f = _farq("OKV_OCHIRILGAN", sana=_s(r.get("sana"))[:10], summa=_dec_n(r.get("summa")),
                  dalil="okv=" + qisqa_id(r.get("oplata_kv_id")), izoh=izoh)
        f.hodisa = _sana_of(r.get("created_at")) if r.get("created_at") is not None else ""
        qosh(None, f)
    for r in ctx.arizalar:
        j = kalit_juft.get(_s(r.get("tx_id"))) or kalit_juft.get(_s(r.get("oplata_kv_id")))
        qosh(j, _farq("ARIZA_KUTMOQDA", sana=_sana_of(r.get("snap_date")), summa=_dec_n(r.get("snap_amount")),
                      dalil="ariza=" + qisqa_id(r.get("id")),
                      izoh="taklif %s; yuborilgan %s; agent %s" % (
                          _s(r.get("proposed_contract_no")) or "-", SF._vaqt(r.get("submitted_at")) or "-",
                          _s(r.get("agent_state")) or "-")))
    for t in ctx.izoh_tx:
        izoh = "izohda raqam bor; tx kategoriya %s; tx shartnoma %s" % (t.kat or "-", t.shartnoma or "bo'sh")
        kod = "KATEGORIYA" if t.kat != "CLIENT" else "BOSHQA_SHARTNOMA"
        qosh(None, _farq(kod, sana=t.sana, summa=t.ishorali, dalil="tx=" + qisqa_id(t.external_id or t.id),
                         izoh=izoh, komponent="transactions", ochiq=t.izoh))

    _raqamla(farqlar, juftlar)
    juftlar.sort(key=lambda j: (_j_sana(j), _j_summa(j), _j_kalit(j)))
    return juftlar, farqlar


def _sana_of(v: Any) -> str:
    if isinstance(v, datetime):
        return config.to_local(v).date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return _s(v)[:10]


def _yangi(t: Tx, ctx: Kontekst) -> bool:
    """tx avto-sync oynasidan (txAutoSyncMinutes + 15 daqiqa) yangimi."""
    if t.vaqt is None:
        return False
    hozir = ctx.hozir or config.now_utc()
    return config.to_utc(t.vaqt) > hozir - timedelta(minutes=ctx.sync_daq + 15)


def _j_sana(j: Juft) -> str:
    if j.okv is not None:
        return j.okv.sana
    if j.tx is not None:
        return j.tx.sana
    return j.crm.sana if j.crm else ""


def _j_summa(j: Juft) -> Decimal:
    if j.okv is not None:
        return j.okv.summa
    if j.tx is not None:
        return j.tx.ishorali
    return j.crm.amount if j.crm else _NOL


def _j_kalit(j: Juft) -> str:
    if j.okv is not None:
        return j.okv.id
    if j.tx is not None:
        return j.tx.id
    return j.crm.external_id if j.crm else ""


def _bank_qisqa(code: str) -> str:
    return re.sub(r"(BANK)?(_V\d+)?$", "", (code or "").upper())[:10] or "?"


# ---------------------------------------------------------------------------
# Jamilar (sof)
# ---------------------------------------------------------------------------
def jamilar(crm: Optional[Sequence[CrmTolov]], okv: Sequence[Okv], tx: Sequence[Tx], *,
            crm_qisman: bool = False, qisman: bool = False) -> Jamilar:
    """Har manba jami, boshlang'ich, oylik, qaytarim (Decimal). crm=None: CRM tekshirilmadi."""
    cj: Optional[Jami] = None
    if crm is not None:
        cj = Jami(qisman=crm_qisman)
        for c in crm:
            cj.soni += 1
            cj.jami += c.amount
            b, m = crm_split(c)
            cj.bosh += b
            cj.oylik += m
            cj.boshqa += c.other
            if c.amount < 0:
                cj.qaytarim += c.amount
    oj = Jami(qisman=qisman)
    okv_bank = _NOL
    for o in okv:
        oj.soni += 1
        oj.jami += o.summa
        oj.bosh += o.first or _NOL
        oj.oylik += o.monthly or _NOL
        if o.summa < 0:
            oj.qaytarim += o.summa
        if o.source_tx_id:
            okv_bank += o.summa
    tj = Jami(qisman=qisman)
    tx_client = _NOL
    for t in tx:
        tj.soni += 1
        tj.jami += t.ishorali
        if t.yon == "OUT":
            tj.chiqim += t.summa
        else:
            tj.kirim += t.summa
        if t.kat == "CLIENT":
            tx_client += t.ishorali
    return Jamilar(crm=cj, okv=oj, tx=tj, okv_bank=okv_bank, tx_client=tx_client)


def _okv_jami_sql(rows: List[Dict[str, Any]]) -> Tuple[Jami, Dict[str, Any]]:
    j = Jami()
    qo: Dict[str, Any] = {"turisiz": _NOL, "turisiz_soni": 0, "umumiy": _NOL, "perebroska": _NOL,
                          "bankdan": _NOL, "bankdan_soni": 0, "exceldan": _NOL}
    for r in rows:
        j.soni += SF._int(r.get("soni"))
        j.jami += _dec(r.get("jami"))
        j.bosh += _dec(r.get("bosh"))
        j.oylik += _dec(r.get("oylik"))
        j.qaytarim += _dec(r.get("manfiy"))
        for k in ("turisiz", "umumiy", "perebroska", "bankdan", "exceldan"):
            qo[k] += _dec(r.get(k))
        qo["turisiz_soni"] += SF._int(r.get("turisiz_soni"))
        qo["bankdan_soni"] += SF._int(r.get("bankdan_soni"))
    return j, qo


def _tx_jami_sql(rows: List[Dict[str, Any]]) -> Tuple[Jami, Decimal, Dict[str, int]]:
    j = Jami()
    client = _NOL
    holat: Dict[str, int] = {}
    for r in rows:
        n, s = SF._int(r.get("soni")), abs(_dec(r.get("summa")))
        j.soni += n
        if _s(r.get("yon")) == "OUT":
            j.chiqim += s
            ish = -s
        else:
            j.kirim += s
            ish = s
        j.jami += ish
        if r.get("mijoz"):
            client += ish
        h = _s(r.get("holat")) or "?"
        holat[h] = holat.get(h, 0) + n
    return j, client, holat


# ---------------------------------------------------------------------------
# prefetch (yagona kirish nuqtasi)
# ---------------------------------------------------------------------------
def prefetch(matn: Any, *, crm: bool = True, koprik: bool = True, deadline_s: Optional[float] = None,
             koprik_deadline_s: Optional[float] = None) -> Natija:
    """Manbalarni faqat-o'qish rejimida yig'adi, juftlaydi, kodlaydi. Hech qachon exception chiqarmaydi.
    crm: eski to'g'ridan GET (yana AGENTS_TOLOV_CRM=1 kerak); koprik: panel ko'prigi (CRM panel yo'li, Sheet).
    deadline_s: DB va eski CRM (45 s); koprik_deadline_s: ko'prik so'rovlari (prefetch boshidan, 100 s)."""
    t0 = _mono()
    dl = t0 + float(deadline_s if deadline_s is not None else C.TOLOV_PREFETCH_DEADLINE_S)
    kdl = t0 + float(koprik_deadline_s if koprik_deadline_s is not None else C.TOLOV_KOPRIK_DEADLINE_S)
    n = Natija(vaqt=config.now_utc())
    try:
        _prefetch(n, matn, crm, dl, kdl if koprik else None)
    except Exception as exc:  # noqa: BLE001 - eng yomon holat: [kirish] + bitta UNKNOWN
        log.exception("tolov prefetch yiqildi")
        kir = [b for b in n.bolimlar if b.komponent == "kirish"]
        n.bolimlar = kir or [Bolim("kirish", "unknown", C.TOLOV_SABAB_KIRISH)]
        n.bolimlar.append(Bolim("solishtirish", "unknown", "tekshiruv yiqildi: " + exc.__class__.__name__))
        n.farqlar, n.juftlar = [], []
    n.ms = int((_mono() - t0) * 1000)
    return n


def _koprik_qosh(n: Natija, kdl: Optional[float], okv: Optional[Sequence[Okv]] = None,
                 tx: Optional[Sequence[Tx]] = None, topilgan: Optional[Set[str]] = None) -> List[Bolim]:
    """Panel ko'prigi: n.koprik, farqlari n.farqlar ga (qayta raqamlanadi); bo'limlarni qaytaradi.
    kdl=None: ko'prik o'chirilgan (bo'limlar UNKNOWN). Shartnoma yo'q bo'lsa hech narsa qilmaydi.
    n.xonpay (Billing) yo'ldagi to'lovlari CRM solishtiruvidan chiqariladi."""
    if not n.shartnomalar:
        return []
    if kdl is None:
        return [Bolim(k, "unknown", C.TOLOV_KOPRIK_PREFIKS + C.TOLOV_SABAB_OCHIRILGAN)
                for k in ("crm_panel", "sheet", "panel_solishtirish")]
    _koprik_yig(n, kdl, okv, tx)
    if n.koprik is None:
        return []
    try:
        farqlar, bolimlar = koprik_tahlil(n.koprik, okv, tx, topilgan, n.xonpay, hozir=n.vaqt)
    except Exception as exc:  # noqa: BLE001 - tahlil xatosi qolgan tekshiruvni to'xtatmaydi
        log.exception("tolov ko'prik tahlili yiqildi")
        sabab = C.TOLOV_KOPRIK_PREFIKS + "tahlil yiqildi: " + exc.__class__.__name__
        return [Bolim(k, "unknown", sabab) for k in ("crm_panel", "sheet", "panel_solishtirish")]
    # Billing'da yo'q XonPay (CRM Внешний ID dan) ham [xonpay] ga; juftla bergan kod takrorlanmaydi
    if n.xonpay is not None and n.koprik.xonpay_crm:
        n.xonpay = sorted(n.xonpay + n.koprik.xonpay_crm, key=lambda x: (x.sana, x.summa, x.ext), reverse=True)
    bor = {(f.kod, f.dalil) for f in n.farqlar}
    farqlar = [f for f in farqlar if f.kod not in ("XONPAY_KUTILMOQDA", "XONPAY_KECHIKDI", "BIZDA_YOQ")
               or (f.kod, f.dalil) not in bor]
    if farqlar:
        n.farqlar.extend(farqlar)
        _raqamla(n.farqlar, n.juftlar)
    return bolimlar


def _koprik_yig(n: Natija, kdl: Optional[float], okv: Optional[Sequence[Okv]] = None,
                tx: Optional[Sequence[Tx]] = None) -> None:
    """Panel ko'prigi so'rovlari (tarmoq) va bizda yo'q kompozitlar qidiruvi: n.koprik (bir marta). XonPay Billing'ini
    CRM bilan kelishtirish uchun juftladan OLDIN chaqiriladi. Hech qachon exception chiqarmaydi."""
    if not n.shartnomalar or kdl is None or n.koprik is not None:
        return
    n.koprik = _koprik_collect(n.shartnomalar, kdl)
    try:
        _komp_qidir(n.koprik, okv, tx, kdl)
    except Exception as exc:  # noqa: BLE001 - kompozit qidiruvi yiqilsa faqat bank sync tekshirilmaydi
        n.koprik.komp_xato = "ichki xato: " + exc.__class__.__name__
        log.warning("tolov kompozit qidiruvi: %s", exc.__class__.__name__)


def _shovqin_belgila(n: Natija) -> None:
    """Tarix shovqini (C.TOLOV_SHOVQIN_KODLAR) so'nggi TOLOV_SHOVQIN_KUN kundan eski (sana va aniqlangan kun) va
    muhim farqi yo'q to'lovga tegishli bo'lsa yashirin; ko'rinadiganlar F1.. ketma-ket qayta raqamlanadi."""
    chegara = (config.today_local() - timedelta(days=C.TOLOV_SHOVQIN_KUN)).isoformat()
    muhim = {id(f) for j in n.juftlar if any(g.kod in C.TOLOV_MUHIM_KODLAR for g in j.farqlar) for f in j.farqlar}
    for f in n.farqlar:
        if f.kod in C.TOLOV_SHOVQIN_KODLAR:
            f.yashirin = max(f.sana, f.hodisa) < chegara and id(f) not in muhim
    _raqamla(n.farqlar, n.juftlar)


def _komp_qidir(kn: KoprikNatija, okv: Optional[Sequence[Okv]], tx: Optional[Sequence[Tx]], dl: float) -> None:
    """Panel CRM to'lovlari ichida Внешний ID bank kompoziti bo'lib, bizning shartnoma qatorlarida (okv, tx) kuchli,
    yadro yoki gid bo'yicha topilmaganlarini butun transactions'dan qidiradi (bitta faqat-o'qish SELECT,
    <= TOLOV_KOMPOZIT_QIDIRUV_MAX ta). Natija kn.komp_tx, kn.komp_qidirildi; xato kn.komp_xato. tx o'qilmagan
    bo'lsa (None) qidirilmaydi: "bizda yo'q" deyilmaydi. Hech qachon exception chiqarmaydi."""
    if kn.xato or tx is None:
        return
    bir = _birliklar(okv or [], tx)
    kerak = _uniq(x.ext for s in kn.shartnomalar if s.crm.topildi for x in s.crm.tolovlar
                  if x.ext and not _UUID_RE.match(x.ext) and parse_composite(x.ext) is not None
                  and not _komp_moslik(x.ext, bir)[0])[:C.TOLOV_KOMPOZIT_QIDIRUV_MAX]
    if not kerak:
        return
    d = DbNatija()
    try:
        with SF._fx() as cur:
            rows = _Sorovchi(cur, d, dl)("komp", _SQL_KOMP_TX, {"k": kerak, "g": _uniq(_gid(e) for e in kerak)})
    except Exception as exc:  # noqa: BLE001 - ulanish xatosi: faqat bank sync tekshiruvi cheklanadi
        kn.komp_xato = _toza(SF._err(exc), 120) or C.TOLOV_SABAB_DB
        log.warning("tolov kompozit qidiruvi yiqildi: %s", kn.komp_xato)
        return
    if rows is None:
        kn.komp_xato = d.xatolar.get("komp", C.TOLOV_SABAB_DB)
        return
    kn.komp_tx = [_tx_of(r) for r in rows]
    kn.komp_qidirildi = set(kerak)


def _prefetch(n: Natija, matn: Any, crm: bool, dl: float, kdl: Optional[float] = None) -> None:
    k = parse_kirish(matn)
    if k is None:
        n.bolimlar.append(Bolim("kirish", "unknown", C.TOLOV_SABAB_KIRISH))
        return
    n.kirish = k
    ki = k                                    # bazada qidiruv kirishi (chek -> topilgan tx ID yoki summa+sana)
    if k.tur == "chek":
        n.chek = _chek_top(k, kdl)
        tx = n.chek.tx
        if tx is not None:
            ki = Kirish(tur="id", id=tx["external_id"] or tx["id"], xom=k.xom)
        elif k.summa is not None and k.sana is not None:
            ki = Kirish(tur="summa_sana", summa=k.summa, sana=k.sana, xom=k.xom)
        else:
            n.bolimlar.append(_kirish_bolim(k, DbNatija(), n))
            n.bolimlar.append(_chek_bolim(n.chek, k))
            n.bolimlar.append(Bolim("nomzodlar", "warn", "hech narsa topilmadi"))
            n.xulosa = _xulosa_chek_yoq(n, k)
            return
    crm_sabab = C.TOLOV_SABAB_OCHIRILGAN if not crm else _crm_holati()
    ses = _CrmSessiya(dl) if crm_sabab is None else None
    db_dl = dl - (_DB_ZAXIRA_S if ses is not None else 0.0)
    d = _db_collect(ki, db_dl)
    # ID bazada shartnomasiz: CRM transaction_id bo'yicha haqiqiy shartnoma
    if not d.shartnomalar and ki.tur == "id" and d.gid and ses is not None and not d.ulanish_xato:
        try:
            rows = ses.olish({"transaction_id": d.gid, "limit": 20})
            yadro = composite_core(ki.id)
            mos = [r for r in rows if _s(r.get("external_id")) == ki.id or (yadro and composite_core(
                r.get("external_id")) == yadro) or _gid(r.get("external_id")) == d.gid]
            topildi = _uniq(_s(r.get("contract")) for r in mos)
            if topildi:
                y = d.yolgiz
                d = _db_collect(ki, db_dl, shartnomalar=topildi[:C.TOLOV_SHARTNOMA_MAX], maqsad=d.maqsad)
                d.yolgiz = y
        except CrmXato as exc:
            crm_sabab = exc.sabab
            ses = None
    # Bitta aniq to'lov, lekin shartnomasi yo'q yoki CRM'da yo'q (XATO): bank ID si bo'yicha CRM (panel ko'prigi,
    # panel "XATO -> CRM" bilan bir xil match). Topilsa tekshiruv CRM shartnomasi bo'yicha qayta yig'iladi.
    if kdl is not None and d.yolgiz is not None and not d.ulanish_xato and _shartnomasiz(d):
        n.crm_id = _crm_id_top(d.yolgiz, kdl)
        topildi = _uniq(r["shartnoma"] for r in n.crm_id.aniq)[:C.TOLOV_SHARTNOMA_MAX]
        if topildi:
            y, eski = d.yolgiz, list(d.kanon or d.shartnomalar)
            d = _db_collect(ki, db_dl, shartnomalar=topildi, maqsad=d.maqsad)
            d.yolgiz = y
            n.crm_id.eski = eski
    n.yolgiz = d.yolgiz
    n.shartnomalar = list(d.kanon or d.shartnomalar)
    n.bolimlar.append(_kirish_bolim(ki, d, n))
    if n.chek is not None:
        n.bolimlar.append(_chek_bolim(n.chek, k))
    if n.crm_id is not None:
        n.bolimlar.append(_crm_id_bolim(n.crm_id, d.yolgiz))
    if d.ulanish_xato:
        for komp in ("crm_kesh", "oplata_kv", "transactions", "xonpay", "bank_izi", "kontekst"):
            n.bolimlar.append(Bolim(komp, "unknown", C.TOLOV_SABAB_DB + ": " + d.ulanish_xato))
        # baza yiqilsa ham panel ko'prigi (backend o'z bazasi bilan) ishlaydi
        n.bolimlar += _koprik_qosh(n, kdl)
        if n.farqlar:
            son = {s: sum(1 for f in n.farqlar if f.jiddiylik == s) for s in ("error", "warn", "info")}
            n.bolimlar.append(Bolim("farqlar", "error" if son["error"] else ("warn" if son["warn"] else "ok"),
                                    "%d ta (error %d, warn %d, info %d); faqat panel kodlari (baza javob bermadi)" % (
                                        len(n.farqlar), son["error"], son["warn"], son["info"])))
        return
    if not d.shartnomalar:
        n.bolimlar.append(Bolim("nomzodlar", "warn",
                                "%d nomzod; shartnoma tanlanmadi" % d.nomzod_soni if d.nomzod_soni
                                else "hech narsa topilmadi", list(d.nomzodlar)))
        try:
            n.xulosa = (_xulosa_shartnomasiz(n, d) if d.yolgiz is not None
                        else _xulosa_chek_yoq(n, k) if k.tur == "chek" and not d.nomzod_soni else None)
        except Exception:  # noqa: BLE001 - xulosa yiqilsa egasi texnik (batafsil) chiqishni oladi
            log.exception("tolov shartnomasiz xulosasi qurilmadi")
            n.xulosa = None
        return
    _tegishli_filtr(d)
    ctx = Kontekst(
        bizning_oyna=min((o.sana for o in d.okv if o.sana), default="") if d.okv_qisman else "",
        topilgan=d.topilgan, kanon=list(d.kanon), vznos={_s(r.get("contract_no")) for r in (d.vznos or [])
                                                        if _s(r.get("status")) != "cancelled"},
        xonpay=list(d.xonpay or []), loglar=list(d.loglar or []), tarix=_tarix_filtr(d),
        arizalar=list(d.arizalar or []), izoh_tx=list(d.izoh_tx), tx_min=d.tx_min, sync_daq=d.sync_daq,
        hozir=config.now_utc(), maqsad=set(d.maqsad), bizda_qisman=_bizda_qisman(d),
    )
    # CRM
    cn: Optional[CrmNatija] = None
    if ses is not None:
        cn = _crm_collect(d.kanon, d, ses)
        if cn.xato:
            crm_sabab = cn.xato
        elif ses.soni < C.TOLOV_CRM_MAX_SOROV:
            pre, _ = juftla(cn.rows, d.okv, d.tx, ctx)
            gids = _uniq(_gid_of(j) for j in sorted(pre, key=lambda j: _j_sana(j), reverse=True)
                         if j.crm is None and (j.okv is not None or j.tx is not None))
            if gids:
                _crm_txid(gids, cn, ses)
    crm_rows: Optional[List[CrmTolov]] = cn.rows if (cn is not None and not cn.xato) else None
    if cn is not None and not cn.toliq:
        ctx.crm_oyna = min((c.sana for c in cn.rows if c.sana and c.manba != "transaction_id"), default="")
    n.crm_ok = crm_rows is not None
    okv_r, tx_r = (None if d.okv_xato else d.okv), (None if d.tx_xato else d.tx)
    # panel ko'prigi (tarmoq, o'z muddati bilan) juftladan oldin: XonPay Billing'i CRM bilan kelishtiriladi
    _koprik_yig(n, kdl, okv_r, tx_r)
    if d.xonpay is not None:
        bir = None if tx_r is None else _birliklar(okv_r or [], tx_r) + [
            _birlik(None, t) for t in (n.koprik.komp_tx if n.koprik is not None else [])]
        n.xonpay = xonpay_kelishtir(xonpay_qatorlari(d.xonpay, ctx.hozir),
                                    _crm_royxatlari(n.koprik, crm_rows, d.kanon), bir)
        ctx.xonpay_holat = n.xonpay
    n.juftlar, n.farqlar = juftla(crm_rows, d.okv, d.tx, ctx)
    # panel tahlili: CRM (panel yo'li) va Google Sheet farqlari
    koprik_bolimlar = _koprik_qosh(n, kdl, okv_r, tx_r, d.topilgan)
    _shovqin_belgila(n)
    maqsad_crm = [c for c in (crm_rows or []) if c.manba != "transaction_id"]
    n.jamilar = jamilar(maqsad_crm if crm_rows is not None else None, d.okv, d.tx,
                        crm_qisman=bool(cn and not cn.toliq), qisman=d.okv_qisman or d.tx_qisman)
    okv_qo: Dict[str, Any] = {}
    tx_holat: Dict[str, int] = {}
    if d.okv_jami is not None:
        n.jamilar.okv, okv_qo = _okv_jami_sql(d.okv_jami)
        n.jamilar.okv_bank = okv_qo["bankdan"]
    if d.tx_jami is not None:
        n.jamilar.tx, n.jamilar.tx_client, tx_holat = _tx_jami_sql(d.tx_jami)
    n.qisman = d.okv_qisman or d.tx_qisman or bool(cn and not cn.toliq) or bool(ctx.bizda_qisman)
    n.bolimlar += _bolimlar(n, d, cn, crm_sabab, ses, okv_qo, tx_holat)
    n.bolimlar += koprik_bolimlar
    try:
        n.xulosa = _xulosa_qur(n, d, crm_sabab)
    except Exception:  # noqa: BLE001 - xulosa yiqilsa egasi texnik (batafsil) chiqishni oladi
        log.exception("tolov xulosasi qurilmadi")
        n.xulosa = None


def _shartnomasiz(d: DbNatija) -> bool:
    """To'lovning shartnomasi yo'q yoki bironta shartnomasi CRM keshida found emas (XATO). Kesh o'qilmagan bo'lsa
    (topilgan None) noma'lum: False."""
    if not d.shartnomalar:
        return True
    if d.topilgan is None:
        return False
    return not any(s in d.topilgan for s in (d.kanon or d.shartnomalar))


def _yolgiz_qisqa(y: Optional[Dict[str, Any]]) -> str:
    if not y:
        return "-"
    return "%s, %s, %s so'm" % (qisqa_id(y.get("kalit")), _s(y.get("sana")) or "-", pul(y.get("summa")))


def _chek_bolim(c: "ChekNatija", k: Kirish) -> Bolim:
    """[chek]: panel Chek order > Tekshirish bilan bir xil natija (order № = bank hujjat raqami)."""
    bosh = "chek №%s" % k.order
    if c.xato:
        return Bolim("chek", "unknown", "%s: %s" % (bosh, c.xato))
    shart = ", ".join("%s %s" % (nom, "ha" if c.shartlar[kalit] else "yo'q") for kalit, nom in (
        ("order", "order"), ("account", "hisob"), ("amount", "summa"), ("date", "sana"), ("contract", "shartnoma"))
        if c.shartlar.get(kalit) is not None)
    if c.tx is None:
        izoh = "; summa va sana bo'yicha qidirildi" if k.summa is not None and k.sana is not None else ""
        return Bolim("chek", "warn", "%s: tranzaksiya topilmadi (order № bank hujjat raqamiga mos emas yoki bank"
                                     " sync hali olmagan)%s" % (bosh, izoh))
    t = c.tx
    return Bolim("chek", "ok" if c.natija == "found" else "warn", "%s: %s — tx %s, %s, %s so'm, hujjat %s, shartnoma %s%s" % (
        bosh, "topildi" if c.natija == "found" else "topildi, lekin shartlar to'liq mos emas",
        qisqa_id(t["external_id"] or t["id"]), config.fmt_local(t["vaqt"]) if t["vaqt"] else "-", pul(t["summa"]),
        t["hujjat"] or "-", t["shartnoma"] or "yo'q", "; mos: " + shart if shart else ""))


def _crm_id_bolim(c: "CrmIdNatija", y: Optional[Dict[str, Any]]) -> Bolim:
    """[crm_id]: shartnomasiz to'lovning bank ID si CRM'da qaysi shartnomada."""
    bosh = "to'lov " + _yolgiz_qisqa(y)
    if c.xato:
        return Bolim("crm_id", "unknown", "%s: CRM'da ID bo'yicha tekshirilmadi: %s" % (bosh, c.xato))
    if c.aniq:
        r = c.aniq[0]
        yol = ("panel XATO → CRM tabi ham topadi" if c.via == "sana"
               else "CRM'da sana boshqa (%s): XATO → CRM tabi topmaydi" % (r["sana"] or "-"))
        bizda = "" if c.eski is None else "; bizda: " + (", ".join(c.eski) or "shartnomasiz") + " (XATO)"
        return Bolim("crm_id", "warn" if c.eski is not None else "ok", "%s: CRM'da %s shartnomasida (%s, %s so'm, %s)%s; %s" % (
            bosh, r["shartnoma"], r["mijoz"] or "-", pul(r["summa"]), r["sana"] or "-", bizda, yol))
    q = ["CRM shu kuni shu summa (ID'siz): %s | %s | %s | %s" % (r["shartnoma"], r["mijoz"] or "-", r["sana"] or "-",
                                                                 pul(r["summa"])) for r in c.summa_teng]
    return Bolim("crm_id", "warn", "%s: CRM'da bank ID bo'yicha topilmadi%s" % (
        bosh, "; shu kuni shu summali %d ta CRM to'lovi bor" % len(q) if q else ""), q)


def _bizda_qisman(d: DbNatija) -> str:
    """Q2 yoki Q3 qatorlari o'qilmagan bo'lsa sabab ('' = to'liq). Bunda BIZDA_YOQ hisoblanmaydi."""
    q = [nom for nom, xato in (("oplata_kv", d.okv_xato), ("transactions", d.tx_xato)) if xato]
    return "%s qatorlari o'qilmadi" % " va ".join(q) if q else ""


def _gid_of(j: Juft) -> str:
    if j.tx is not None and j.tx.gid.isdigit():
        return j.tx.gid
    return _gid(j.okv.source_tx_id if j.okv else "")


def _tarix_filtr(d: DbNatija) -> List[Dict[str, Any]]:
    """edited yozuvda yangi shartnoma ham bizning variant bo'lsa, bu o'chirish emas."""
    v = set(d.variantlar)
    return [r for r in (d.tarix or []) if not (_s(r.get("action")) == "edited" and _s(r.get("yangi")) in v)]


# ---------------------------------------------------------------------------
# Bo'lim qatorlari
# ---------------------------------------------------------------------------
def _max_status(*st: str) -> str:
    return max(st, key=lambda s: C.CHECK_SEVERITY.get(s, 0)) if st else "ok"


def _kirish_bolim(k: Kirish, d: DbNatija, n: Natija) -> Bolim:
    q: List[str] = []
    if k.tur == "shartnoma":
        q.append("shartnoma " + ", ".join(k.shartnomalar))
    elif k.tur == "id":
        q.append("ID " + qisqa_id(k.id))
    elif k.tur == "xonpay":
        # so'ralgan to'lovning holati birinchi qatorda (blokda [kirish] eng birinchi)
        xp = xonpay_qatorlari(d.xonpay_kirish, n.vaqt)
        if xp:
            q.append("XonPay UUID %s: %s" % (k.id, _xonpay_holat_matn(xp[0])))
        elif d.xonpay_tx:
            r = d.xonpay_tx[0]
            q.append("XonPay UUID %s: Billing'da (xonpay_transactions) yo'q; bank izohida bor: tx %s, %s" % (
                k.id, qisqa_id(r.get("external_id") or r.get("id")), SF._vaqt(r.get("txn_date")) or "-"))
        elif "kirish" in d.xatolar:
            q.append("XonPay UUID %s: Billing o'qilmadi" % k.id)
        else:
            q.append("XonPay UUID %s: %s" % (k.id, C.TOLOV_XONPAY_TOPILMADI))
    elif k.tur == "summa_sana":
        q.append("summa %s, sana %s (+-%d kun)%s" % (pul(k.summa), k.sana.isoformat() if k.sana else "-", k.kun,
                                                     ", bank " + k.bank if k.bank else ""))
    elif k.tur == "chek":
        q.append("chek №%s%s%s" % (k.order, ", summa " + pul(k.summa) if k.summa is not None else "",
                                   ", sana " + k.sana.isoformat() if k.sana else ""))
    else:
        q.append("mijoz " + (mijoz_ismi(k.mijoz) or "-"))
    if k.tur != "shartnoma" and d.shartnomalar:
        manba = "CRM'dan" if d.manba == "crm" else "bazadan"
        q.append("shartnoma %s (%s)" % (", ".join(d.kanon or d.shartnomalar), manba))
    elif k.tur == "shartnoma" and d.kanon and d.kanon != d.shartnomalar:
        q.append("CRM shakli " + ", ".join(d.kanon))
    if d.variantlar:
        q.append("variantlar %d" % len(d.variantlar))
    if k.tashlangan:
        q.append("%d ta shartnoma tashlandi (chegara %d)" % (k.tashlangan, C.TOLOV_SHARTNOMA_MAX))
    if d.skelet:
        q.append("skelet orqali: " + ", ".join(d.skelet))
    if d.chiqarilgan:
        q.append("boshqa CRM shartnomasi chiqarildi: " + ", ".join(d.chiqarilgan))
    q.append("so'rov %s (Toshkent)" % config.fmt_local(n.vaqt or config.now_utc()))
    xato = d.xatolar.get("kirish")
    if xato:
        q.append("xato: " + xato)
    status = "ok" if d.shartnomalar else "warn"
    if xato and not d.shartnomalar:
        status = "unknown"
    return Bolim("kirish", status, "; ".join(q))


def _shartnoma_farqlari(d: DbNatija, crm_rows: Optional[List[CrmTolov]]) -> List[Tuple[str, str, bool]]:
    """Ko'p shartnoma: har kirish shartnomasi uchun (kanon, 'CRM - OplatyKv ...; OplatyKv(bank) - bank ...',
    farq bormi). Qatorlar o'z shartnomasi guruhiga (_guruh_xarita) tushadi, jamilar SQL'dan (to'liq)."""
    g = _guruh_xarita(d.kanon)
    out: List[Tuple[str, str, bool]] = []
    for i, sh in enumerate(d.kanon):
        oj, qo = _okv_jami_sql([r for r in (d.okv_jami or []) if g(r.get("contract_no")) == i])
        _tj, client, _h = _tx_jami_sql([r for r in (d.tx_jami or []) if g(r.get("contract_number")) == i])
        qism: List[str] = []
        bor = False
        if crm_rows is not None:
            cj = jamilar([c for c in crm_rows if g(c.contract) == i], [], []).crm or Jami()
            fj, fb, fo = cj.jami - oj.jami, cj.bosh - oj.bosh, cj.oylik - oj.oylik
            qism.append("CRM - OplatyKv = %s (bosh. %s, oylik %s)" % (pul(fj), pul(fb), pul(fo)))
            bor = bool(fj or fb or fo)
        fb2 = qo["bankdan"] - client
        qism.append("OplatyKv(bank) - bank = %s" % pul(fb2))
        out.append((sh, ", ".join(qism), bor or bool(fb2)))
    return out


def _xonpay_bolim(xp: Sequence[XonpayQator], maqsad: Set[str], kop: bool = False) -> Bolim:
    """[xonpay]: Billing (xonpay_transactions) jami va holatlar; ostida sarlavha, so'ralgan to'lov (>>), yo'ldagilar
    (avval KECHIKDI, keyin KUTILMOQDA, eng yangisi birinchi), keyin eng yangi tushganlar. STATUS: KECHIKDI bo'lsa
    WARN. Qatorlar C.TOLOV_XONPAY_QATOR_MAX bilan cheklanadi, qolgani soni bilan."""
    if not xp:
        return Bolim("xonpay", "ok", C.TOLOV_XONPAY_YOQ)
    son = {h: sum(1 for x in xp if x.holat == h) for h in C.TOLOV_XONPAY_HOLATLAR + ("NOMALUM",)}
    holatlar = "tushgan %d, kutilmoqda %d, kechikdi %d" % (son["TUSHGAN"], son["KUTILMOQDA"], son["KECHIKDI"])
    if son["CRMDA_YOQ"]:
        holatlar += ", CRM'da yo'q %d" % son["CRMDA_YOQ"]
    eski = sum(1 for x in xp if x.crm_orqali)
    if eski:
        holatlar += " (tushganlardan %d tasi CRM orqali: Billing'da eski TOPILMAGAN qatori)" % eski
    if son["NOMALUM"]:
        holatlar += ", sanasiz %d" % son["NOMALUM"]
    q = ["%d to'lov; jami %s" % (len(xp), pul(sum((x.summa for x in xp), _NOL))), holatlar]
    yolda = [x for x in xp if x.yolda]
    if yolda:
        q.append("yo'lda %s (bizning hisobga hali tushmagan)" % pul(sum((x.summa for x in yolda), _NOL)))
    tek = [x.tekshirilgan for x in xp if x.tekshirilgan is not None]
    q.append("Billing oxirgi tekshiruvi %s" % config.fmt_local(max(tek, key=config.to_utc)) if tek
             else "Billing tekshiruvi yo'q")

    def belgi(x: XonpayQator) -> bool:
        return bool({k for k in (x.uuid, x.uuid.upper(), x.ext) if k} & maqsad)

    def qator(x: XonpayQator) -> str:
        izoh = _xonpay_tafsil(x)
        if x.yolda and x.tekshirilgan is not None:
            izoh += "; tekshirilgan %s" % config.fmt_local(x.tekshirilgan)
        if kop and x.shartnoma:
            izoh = "%s; %s" % (x.shartnoma, izoh)
        return (">> " if belgi(x) else "") + " | ".join((x.sana or "-", pul(x.summa), _uuid_qisqa(x), x.holat, izoh))

    birinchi = [x for x in xp if belgi(x)]
    kutish = sorted((x for x in xp if not belgi(x) and x.holat != "TUSHGAN"),
                    key=lambda x: {"KECHIKDI": 0, "KUTILMOQDA": 1}.get(x.holat, 2))
    tushgan = [x for x in xp if not belgi(x) and x.holat == "TUSHGAN"]
    joy = max(0, C.TOLOV_XONPAY_QATOR_MAX - len(birinchi))
    kutish_k = kutish[:joy]
    tushgan_k = tushgan[:min(C.TOLOV_XONPAY_TUSHGAN_MAX, max(0, joy - len(kutish_k)))]
    qatorlar = [C.TOLOV_XONPAY_SARLAVHA] + [qator(x) for x in birinchi + kutish_k + tushgan_k]
    if len(kutish) > len(kutish_k):
        qatorlar.append("+%d yo'lda (ko'rsatilmadi)" % (len(kutish) - len(kutish_k)))
    if len(tushgan) > len(tushgan_k):
        qatorlar.append("+%d tushgan (eskiroq)" % (len(tushgan) - len(tushgan_k)))
    return Bolim("xonpay", "warn" if son["KECHIKDI"] else "ok", "; ".join(q), qatorlar)


def _bolimlar(n: Natija, d: DbNatija, cn: Optional[CrmNatija], crm_sabab: Optional[str],
              ses: Optional[_CrmSessiya], okv_qo: Dict[str, Any], tx_holat: Dict[str, int]) -> List[Bolim]:
    out: List[Bolim] = []
    js = n.jamilar or jamilar(None, [], [])
    kod_st: Dict[str, str] = {}
    for f in n.farqlar:
        if f.komponent and f.jiddiylik in ("error", "warn"):
            kod_st[f.komponent] = _max_status(kod_st.get(f.komponent, "ok"), f.jiddiylik)

    def st(komp: str, asos: str) -> str:
        return _max_status(asos, kod_st.get(komp, "ok"))

    # crm_kesh
    if d.kesh is None:
        out.append(Bolim("crm_kesh", "unknown", d.xatolar.get("crm_kesh", C.TOLOV_SABAB_DB)))
    else:
        kesh = {_s(r.get("contract_number")): r for r in d.kesh}
        qism: List[str] = []
        asos = "ok"
        for sh in d.kanon:
            r = kesh.get(sh)
            if r is None:
                qism.append("%s: kesh yozuvi yo'q" % sh)
                asos = "warn"
                continue
            if not r.get("found"):
                asos = "warn"
            bo = [("found=ha" if r.get("found") else "found=yo'q")]
            for nom, kalit in (("holat", "status"), ("virtual", "virtual_status"), ("obyekt", "object_name"),
                               ("xonadon", "apartment_number"), ("order", "crm_order_id"), ("bo'lim", "branch_name"),
                               ("tur", "property_type")):
                if _s(r.get(kalit)):
                    bo.append("%s %s" % (nom, _lotin(_s(r.get(kalit)))[:40]))
            bo.append("tekshirilgan " + (SF._vaqt(r.get("last_verified_at")) or "-"))
            if _s(r.get("last_error")):
                bo.append("xato " + _s(r.get("last_error"))[:60])
            ism = mijoz_ismi(r.get("customer_name"))
            if ism:
                bo.append("mijoz " + ism)
            qism.append(("%s: " % sh if len(d.kanon) > 1 else "") + "; ".join(bo))
        out.append(Bolim("crm_kesh", asos, " | ".join(qism) or "kesh yozuvi yo'q"))
    # crm (eski yo'l; CRM'ning XonPay qismi doim [xonpay] da)
    if cn is not None and not cn.xato:
        cj = js.crm or Jami()
        q = ["jonli GET %s" % config.fmt_local(ses.vaqt, "%H:%M") if ses and ses.vaqt else "keshdan"]
        q.append("%d to'lov; jami %s; bosh. %s; oylik %s; boshqa %s; qaytarim %s" % (
            cj.soni, pul(cj.jami), pul(cj.bosh), pul(cj.oylik), pul(cj.boshqa), pul(cj.qaytarim)))
        asos = "ok"
        if cn.trashed:
            q.append("bekor shartnoma (trashed): " + ", ".join(cn.trashed))
        if not cn.toliq:
            q.append("500 chegarasi, ro'yxat to'liq bo'lmasligi mumkin")
            asos = "warn"
        extra = sum(1 for c in cn.rows if c.manba == "transaction_id")
        if extra:
            q.append("transaction_id qidiruvi %d qator" % extra)
        for iz in cn.izohlar:
            q.append(iz)
            asos = "warn"
        if ses is not None:
            q.append("so'rovlar %d%s" % (ses.soni, ", keshdan %d" % ses.kesh if ses.kesh else ""))
        out.append(Bolim("crm", st("crm", asos), "; ".join(q)))
    else:
        out.append(Bolim("crm", "unknown", crm_sabab or C.TOLOV_SABAB_OCHIRILGAN))
    # xonpay (Billing: xonpay_transactions)
    if n.xonpay is None:
        out.append(Bolim("xonpay", "unknown", d.xatolar.get("xonpay", C.TOLOV_SABAB_DB)))
    else:
        b = _xonpay_bolim(n.xonpay, d.maqsad, len(d.kanon) > 1)
        b.status = st("xonpay", b.status)
        out.append(b)
    # oplata_kv
    if d.okv_jami is None and "oplata_kv" in d.xatolar:
        out.append(Bolim("oplata_kv", "unknown", d.xatolar["oplata_kv"]))
    else:
        oj = js.okv
        xato_n = sum(1 for f in n.farqlar if f.kod == "XATO")
        q = ["%d qator; jami %s; bosh. %s; oylik %s" % (oj.soni, pul(oj.jami), pul(oj.bosh), pul(oj.oylik))]
        if okv_qo:
            if okv_qo["turisiz_soni"]:
                q.append("split yo'q %s (%d)" % (pul(okv_qo["turisiz"]), okv_qo["turisiz_soni"]))
            if okv_qo["umumiy"]:
                q.append("umumiy %s" % pul(okv_qo["umumiy"]))
            if okv_qo["perebroska"]:
                q.append("perebroska %s" % pul(okv_qo["perebroska"]))
            q.append("bankdan %s (%d)" % (pul(okv_qo["bankdan"]), okv_qo["bankdan_soni"]))
            if okv_qo["exceldan"]:
                q.append("Excel %s" % pul(okv_qo["exceldan"]))
        if oj.qaytarim:
            q.append("manfiy %s" % pul(oj.qaytarim))
        asos = "ok"
        # XATO faqat qatorlar va crm_kesh o'qilganda sanaladi; aks holda "0" emas, noma'lum
        if d.okv_xato:
            q.append("XATO ? (qatorlar o'qilmadi)")
            asos = "unknown"
        elif d.topilgan is None:
            q.append("XATO va KANONIK_EMAS tekshirilmadi (crm_kesh o'qilmadi)")
            asos = "unknown"
        else:
            q.append("XATO %d" % xato_n)
        if d.okv_qisman:
            q.append("qisman: %d qator ko'rildi, jamilar to'liq" % C.TOLOV_QATOR_MAX)
            asos = "warn"
        if "oplata_kv" in d.xatolar:
            q.append("xato: " + d.xatolar["oplata_kv"])
            asos = _max_status(asos, "unknown")
        out.append(Bolim("oplata_kv", st("oplata_kv", asos), "; ".join(q)))
    # transactions
    if d.tx_jami is None and "transactions" in d.xatolar:
        out.append(Bolim("transactions", "unknown", d.xatolar["transactions"]))
    else:
        tj = js.tx
        q = ["%d tx; kirim %s; chiqim %s; CLIENT sof %s" % (tj.soni, pul(tj.kirim), pul(tj.chiqim),
                                                           pul(js.tx_client))]
        if tx_holat:
            q.append(", ".join("%s %d" % (h, c) for h, c in sorted(tx_holat.items())))
        asos = "ok"
        if d.tx_qisman:
            q.append("qisman: %d qator ko'rildi, jamilar to'liq" % C.TOLOV_QATOR_MAX)
            asos = "warn"
        if "transactions" in d.xatolar:
            q.append("xato: " + d.xatolar["transactions"])
            asos = _max_status(asos, "unknown")
        if "izoh" in d.xatolar:  # Q8 (izohdagi raqam) alohida: tx ma'lumoti baribir o'qilgan
            q.append("izoh qidiruvi o'qilmadi: " + d.xatolar["izoh"])
            asos = _max_status(asos, "warn")
        out.append(Bolim("transactions", st("transactions", asos), "; ".join(q)))
    # bank_izi (transaction_change_logs + oplata_kv_history)
    if d.loglar is None and d.tarix is None:
        out.append(Bolim("bank_izi", "unknown", d.xatolar.get("bank_izi") or d.xatolar.get("okv_tarix", "-")))
    else:
        tur: Dict[str, int] = {}
        for r in d.loglar or []:
            tur[_s(r.get("tur"))] = tur.get(_s(r.get("tur")), 0) + 1
        okv_t = len(_tarix_filtr(d))
        if not tur and not okv_t:
            xabar = "%d kunda o'zgarish yo'q" % _TARIX_KUN
        else:
            xabar = "%d kunda: bank o'zgarishi %d (o'chirilgan %d, ko'chirilgan %d, tahrirlangan %d); " \
                    "OplatyKv tarixi %d" % (_TARIX_KUN, sum(tur.values()), tur.get("DELETED", 0), tur.get("MOVED", 0),
                                            tur.get("EDITED", 0), okv_t)
        asos = "ok"
        for b in ("bank_izi", "okv_tarix"):
            if b in d.xatolar:
                xabar += "; %s xato: %s" % (b, d.xatolar[b])
                asos = "unknown"
        out.append(Bolim("bank_izi", st("bank_izi", asos), xabar))
    # kontekst (XonPay soni [xonpay] da)
    if d.vznos is None and d.perebroska is None and d.arizalar is None:
        out.append(Bolim("kontekst", "unknown", d.xatolar.get("kontekst", C.TOLOV_SABAB_DB)))
    else:
        q = []
        if d.vznos is None:
            q.append("vznos o'qilmadi")
        else:
            q.append("vznos " + (", ".join("%s (%s)" % (_s(r.get("contract_no")), _s(r.get("status")))
                                           for r in d.vznos[:3]) or "yo'q"))
        if d.perebroska is None:
            q.append("perebroska o'qilmadi")
        else:
            pj = sum((_dec(r.get("amount")) for r in d.perebroska if _s(r.get("status")) != "cancelled"), _NOL)
            q.append("perebroska %s" % ("%d (jami %s)" % (len(d.perebroska), pul(pj)) if d.perebroska else "yo'q"))
        q.append("ariza o'qilmadi" if d.arizalar is None else
                 ("ariza %d kutmoqda" % len(d.arizalar) if d.arizalar else "ariza yo'q"))
        if "kontekst" in d.xatolar:
            q.append("xato: " + d.xatolar["kontekst"])
        out.append(Bolim("kontekst", "unknown" if "kontekst" in d.xatolar else "ok", "; ".join(q)))
    # solishtirish
    if d.okv_jami is None or d.tx_jami is None:
        out.append(Bolim("solishtirish", "unknown", "jamilar o'qilmadi"))
    else:
        q = []
        asos = "ok"
        # ko'p shartnoma: har shartnoma alohida (bir shartnomadagi ortiqcha ikkinchisidagi kamni yopmasin)
        if len(d.kanon) > 1:
            crm_rows = [c for c in cn.rows if c.manba != "transaction_id"] if (cn is not None and not cn.xato) \
                else None
            for sh, qism, bor in _shartnoma_farqlari(d, crm_rows):
                q.append("%s: %s" % (sh, qism))
                if bor:
                    asos = "warn"
        pre = "jami: " if len(d.kanon) > 1 else ""
        if js.crm is not None:
            fj, fb, fo = js.crm.jami - js.okv.jami, js.crm.bosh - js.okv.bosh, js.crm.oylik - js.okv.oylik
            q.append("%sCRM - OplatyKv = %s (bosh. %s, oylik %s)" % (pre, pul(fj), pul(fb), pul(fo)))
            # XonPay yo'ldagi CRM qatorlari (pul bizda hali yo'q) farq emas: statusga kirmaydi
            yolda = [j.crm for j in n.juftlar if j.crm is not None and j.okv is None and j.tx is None
                     and any(kod.startswith("XONPAY_") for kod in j.kodlar)]
            if yolda:
                yj = sum((c.amount for c in yolda), _NOL)
                q.append("shundan XonPay yo'lda %s" % pul(yj))
                fj -= yj
                fb -= sum((crm_split(c)[0] for c in yolda), _NOL)
                fo -= sum((crm_split(c)[1] for c in yolda), _NOL)
            if fj or fb or fo:
                asos = "warn"
            if js.crm.qisman:
                q.append("CRM jami to'liq emas")
        else:
            q.append("CRM tekshirilmadi")
        fb2 = js.okv_bank - js.tx_client
        q.append("%sOplatyKv(bank) - bank = %s" % (pre, pul(fb2)))
        if fb2:
            asos = "warn"
        out.append(Bolim("solishtirish", asos, "; ".join(q)))
    # farqlar
    ochiq = [f for f in n.farqlar if not f.yashirin]
    son = {s: sum(1 for f in ochiq if f.jiddiylik == s) for s in ("error", "warn", "info")}
    fst = "error" if son["error"] else ("warn" if son["warn"] else "ok")
    xabar = "%d ta (error %d, warn %d, info %d)" % (len(ochiq), son["error"], son["warn"], son["info"]) \
        if ochiq else "farq yo'q"
    yashirin = [f.kod for f in n.farqlar if f.yashirin]
    if yashirin:
        sanoq: Dict[str, int] = {}
        for kod in yashirin:
            sanoq[kod] = sanoq.get(kod, 0) + 1
        xabar += "; " + C.TOLOV_SHOVQIN_TPL.format(n=len(yashirin), royxat=", ".join(
            "%s×%d" % (k, v) for k, v in sanoq.items()), kun=C.TOLOV_SHOVQIN_KUN)
    if not n.crm_ok and _koprik_crm_ok(n.koprik):
        xabar += "; CRM to'lov kodlari yo'q, CRM jami crm_panel da (CRM_FARQ)"
    elif not n.crm_ok:
        xabar += "; CRM tekshirilmadi: CRM kodlari yo'q"
    bq = _bizda_qisman(d)
    if bq:
        xabar += "; qisman: %s, BIZDA_YOQ (CRM'da bor, bizda yo'q) tekshirilmadi" % bq
        fst = _max_status(fst, "warn")
    if d.topilgan is None:
        xabar += "; XATO va KANONIK_EMAS tekshirilmadi (crm_kesh o'qilmadi)"
        fst = _max_status(fst, "unknown")
    out.append(Bolim("farqlar", fst, xabar))
    out.append(Bolim("tolovlar", "warn" if n.qisman else "ok", ""))
    return out


# ---------------------------------------------------------------------------
# Egasi uchun xulosa (oddiy tilda): /tolov javobi va Checker bloki boshi
# ---------------------------------------------------------------------------
@dataclass
class ManbaQator:
    nomi: str
    soni: Optional[int] = None
    summa: Optional[Decimal] = None
    holat: str = ""                           # mos | +/- farq (OplatyKv'ga nisbatan) | o'qilmadi: <sabab>


@dataclass
class OddiyFarq:
    sana: str                                 # ISO
    summa: Optional[Decimal]
    turi: str                                 # XonPay <uuid> | bank | naqd | OplatyKv | <sheet nomi>
    sabab: str
    nima: str
    guruh: str = ""                           # xulosa/guruh javobi uchun toifa (egasiga ko'rsatilmaydi)


@dataclass
class Xulosa:
    shartnoma: str
    tavsif: str = ""                          # "<mijoz>, <obyekt> (<holat>)"
    xulosa: str = ""
    manbalar: List[ManbaQator] = field(default_factory=list)
    farqlar: List[OddiyFarq] = field(default_factory=list)
    eslatma: str = ""
    guruh: str = ""
    batafsil: str = ""                        # "Batafsil: /tolov <kirish> batafsil"
    reja: List[str] = field(default_factory=list)   # "Boshlang'ich: reja ..., to'langan ..., qarz ... — yopilmagan"
    bosh: Optional[Tuple[Decimal, Decimal, Decimal]] = None   # boshlang'ich (reja, to'langan, qarz)


def _holat_oddiy(status: Any) -> str:
    """CRM shartnoma holati oddiy tilda: Продано -> sotilgan, Бронь -> bron, Расторгнут -> bekor qilingan."""
    s = repair_mojibake(_s(status))
    p = s.lower()
    if re.search(r"прода|sotil|sold", p):
        return "sotilgan"
    if re.search(r"брон|bron", p):
        return "bron"
    if _BEKOR_RE.search(p):
        return "bekor qilingan"
    if re.search(r"свобод|bo'sh", p):
        return "bo'sh"
    return _lotin(s).lower()[:30]


def _ishorali(d: Decimal) -> str:
    return "mos" if abs(d) < 1 else ("+" if d > 0 else "") + pul(d)


def _sana_qisqa(iso: str) -> str:
    """ISO -> DD.MM (joriy yil) yoki DD.MM.YYYY."""
    d = _sana_d(iso)
    if d is None:
        return iso or "-"
    return d.strftime("%d.%m") if d.year == config.today_local().year else d.strftime("%d.%m.%Y")


def _kt_turi(t: _KT) -> str:
    """CRM to'lovi turi: XonPay <uuid 8>, bank (kompozit), naqd yoki Способ matni."""
    if t.ext and _UUID_RE.match(t.ext):
        return "XonPay " + t.ext[:8].lower()
    if t.ext and parse_composite(t.ext) is not None:
        return "bank"
    u = _lotin(t.usul).lower()
    if re.search(r"naqd|nalich|kassa|cash", u):
        return "naqd"
    if _xonpay_usul(u):
        return "XonPay"
    return u or "-"


def _farq_turi(f: Farq) -> str:
    if f.kod.startswith("XONPAY_"):
        return "XonPay " + f.dalil.split("=", 1)[-1].split()[0]
    if f.kod in ("SHEET_YOQ", "SHEET_FARQ"):
        return f.dalil.split("sheet=", 1)[-1] or "sheet"
    if f.kod in ("BIZDA_YOQ", "QAYTARIM"):
        if "bankdan: yo'q" in f.izoh:
            return "naqd"
        return "XonPay" if "XonPay" in f.izoh else "bank"
    return "bank" if _SANASIZ_RE.search(f.dalil + "_") or _KOMP_ICHIDA_SANA_RE.search(f.dalil) else "OplatyKv"


def _oddiy(kod: str, **q: Any) -> Tuple[str, str]:
    sabab, nima = C.TOLOV_ODDIY[kod]
    return sabab.format(**q), nima.format(**q)


def _sheet_sabab_oddiy(sabab: str) -> str:
    """'FILTR_KATEGORIYA — ... (2 qator); EKSPORT_ESKI — ...' -> kod ma'nolari oddiy tilda (kodlarsiz)."""
    if sabab.startswith(C.TOLOV_SABAB_ANIQLANMADI):
        return "sabab aniqlanmadi (eksport sozlamasi va qatorlar mos)"
    qism: List[str] = []
    for p in sabab.split("; "):
        kod = p.split(" — ", 1)[0].strip()
        son = re.search(r"\((\d+) qator\)\s*$", p)
        if kod in C.TOLOV_SHEET_SABABLAR:
            qism.append(C.TOLOV_SHEET_SABABLAR[kod] + (" (%s ta)" % son.group(1) if son else ""))
    return "; ".join(qism) or "sabab aniqlanmadi"


def _oddiy_farqlar(n: Natija) -> List[OddiyFarq]:
    """Ko'rinadigan MUHIM farqlar oddiy tilda, toifa tartibida (C.TOLOV_MUHIM_KODLAR), har toifada yangisi birinchi.
    CRM_FARQ har to'lovga yoyiladi (kn.mos_emas); XATO / boshqa shartnoma bilan izohlangan to'lov takrorlanmaydi."""
    fs = [f for f in n.farqlar if not f.yashirin and f.kod in C.TOLOV_MUHIM_KODLAR]
    out: List[OddiyFarq] = []

    def izohlangan(summa: Decimal, sana: str) -> bool:
        for g in fs:
            if g.kod in ("XATO", "BOSHQA_SHARTNOMA", "BIZDA_YOQ", "CRM_YOQ") and g.summa is not None \
                    and abs(abs(g.summa) - abs(summa)) < 1:
                dd = _kun_farq(g.sana, sana)
                if dd is not None and dd <= C.TOLOV_KOPRIK_SANA_OYNA:
                    return True
        return False

    tartib = {k: i for i, k in enumerate(C.TOLOV_MUHIM_KODLAR)}
    fs.sort(key=lambda f: f.sana, reverse=True)                  # har toifada yangisi birinchi (barqaror saralash)
    fs.sort(key=lambda f: (tartib[f.kod], not f.sabab.startswith("CRM: bizga tushgan")))
    for f in fs:
        turi = _farq_turi(f)
        n_ish = re.match(r"^(\d+) ish kuni", f.izoh)
        if f.kod == "XONPAY_KUTILMOQDA":
            qosh = "; ".join(x for x in (C.TOLOV_XONPAY_BILLINGSIZ, C.TOLOV_XONPAY_CRM_TEKSHIRILMADI) if x in f.izoh)
            izoh = "%s ish kuni o'tdi" % (n_ish.group(1) if n_ish else "?") + ("; " + qosh if qosh else "")
            sabab, nima = _oddiy(f.kod, izoh=izoh)
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "xonpay"))
        elif f.kod == "XONPAY_KECHIKDI":
            sabab, nima = _oddiy(f.kod, n=n_ish.group(1) if n_ish else "?")
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "xonpay_kech"))
        elif f.kod == "BIZDA_YOQ" and f.sabab.startswith("CRM: bizga tushgan"):
            m = re.search(r"\((\d{4}-\d{2}-\d{2}) kompozitda\)", f.sabab)
            sabab, nima = _oddiy("BANK_SYNC", sana=_sana_qisqa(m.group(1)) if m else "-")
            out.append(OddiyFarq(f.sana, f.summa, "bank", sabab, nima, "bank_sync"))
        elif f.kod == "BIZDA_YOQ":
            sabab, nima = _oddiy("BIZDA_YOQ_NAQD" if turi == "naqd" else "BIZDA_YOQ")
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "naqd" if turi == "naqd" else "crm_bor"))
        elif f.kod == "CRM_FARQ":
            faqat_c, faqat_o = (n.koprik.mos_emas.get(f.dalil, ([], [])) if n.koprik is not None else ([], []))
            if not faqat_c and not faqat_o:
                sabab, nima = _oddiy("CRM_FARQ", summa=pul(f.summa))
                out.append(OddiyFarq(f.sana, f.summa, "-", sabab, nima, "crm_bor"))
            for t in sorted(faqat_c, key=lambda t: t.sana, reverse=True):
                if not izohlangan(t.summa, t.sana):
                    sabab, nima = _oddiy("CRM_BOR")
                    out.append(OddiyFarq(t.sana, t.summa, _kt_turi(t), sabab, nima, "crm_bor"))
            for t in sorted(faqat_o, key=lambda t: t.sana, reverse=True):
                if not izohlangan(t.summa, t.sana):
                    sabab, nima = _oddiy("OKV_BOR")
                    out.append(OddiyFarq(t.sana, t.summa, "OplatyKv", sabab, nima, "okv_bor"))
        elif f.kod == "XATO":
            m = re.search(r"contract_no=(\S+)", f.izoh)
            sabab, nima = _oddiy(f.kod, raqam=m.group(1).rstrip(";") if m else "?")
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "xato"))
        elif f.kod == "BOSHQA_SHARTNOMA":
            m = re.search(r"tx shartnoma (\S+)", f.izoh)
            izoh = ("bank izohida shu raqam bor, lekin tx shartnomasi %s" % m.group(1)) if f.izoh.startswith(
                "izohda raqam bor") and m else _toza(_lotin(f.izoh), 80)
            sabab, nima = _oddiy(f.kod, izoh=izoh)
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "boshqa"))
        elif f.kod in ("SHEET_YOQ", "SHEET_FARQ"):
            sabab, nima = _oddiy(f.kod, summa=pul(f.summa), sabab=_sheet_sabab_oddiy(f.sabab), tuzatish=f.tuzatish)
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "sheet"))
        elif f.kod == "SUMMA_FARQ":
            sabab, nima = _oddiy(f.kod, izoh=_toza(_lotin(f.izoh), 80))
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, "okv"))
        else:
            sabab, nima = _oddiy(f.kod)
            grp = {"CRM_YOQ": "okv_bor", "QAYTARIM": "crm_bor", "SYNC_KUTILMOQDA": "sync"}.get(f.kod, "okv")
            out.append(OddiyFarq(f.sana, f.summa, turi, sabab, nima, grp))
    return out + _shubhali_xonpay(n)


def _shubhali_xonpay(n: Natija) -> List[OddiyFarq]:
    """Billing'da bor, CRM'da yo'q, bizga tushmagan (CRMDA_YOQ) XonPay yozuvlari, so'nggi TOLOV_XONPAY_SHUBHA_KUN
    kun: 'tekshirish kerak'. Status bekor/qaytarim ma'nosida bo'lsa info ('bekor qilingan'). Yangisi birinchi."""
    chegara = (config.today_local() - timedelta(days=C.TOLOV_XONPAY_SHUBHA_KUN)).isoformat()
    out: List[OddiyFarq] = []
    for x in sorted((x for x in n.xonpay or () if x.holat == "CRMDA_YOQ" and x.sana >= chegara),
                    key=lambda x: x.sana, reverse=True):
        uuid = _uuid_qisqa(x)
        if x.bekor:
            sabab, nima = C.TOLOV_ODDIY_XONPAY["BEKOR"]
            out.append(OddiyFarq(x.sana, x.summa, "XonPay (%s)" % uuid, sabab.format(status=x.crm_holat), nima,
                                 "xonpay_bekor"))
            continue
        holat = "".join(("; status: %s" % x.crm_holat if x.crm_holat else "", "; CRM belgisi: muammoli"
                         if x.muammoli else ""))
        sabab, nima = C.TOLOV_ODDIY_XONPAY["SHUBHA"]
        out.append(OddiyFarq(x.sana, x.summa, "XonPay (%s)" % uuid, sabab.format(holat=holat), nima.format(uuid=uuid),
                             "xonpay_shubha"))
    return out


def _reja(n: Natija) -> Tuple[List[str], Optional[Tuple[Decimal, Decimal, Decimal]]]:
    """Reja bo'yicha holat (ko'prik CRM: narx, initialPlan, monthlyPlan; to'langan = CRM to'lovlar ro'yxati turi
    bo'yicha): 'Boshlang'ich: reja, to'langan, qarz — yopilmagan', 'Oylik: ...', 'Jami: narx, ...'. OplatyKv taqsimoti
    farq qilsa qavsda. Reja yo'q bo'lsa qator yo'q. Qaytadi: (qatorlar, boshlang'ich (reja, to'langan, qarz) jami yoki
    None)."""
    kn = n.koprik
    if kn is None or kn.xato:
        return [], None
    kop = len(kn.shartnomalar) > 1
    qator: List[str] = []
    bosh: Optional[Tuple[Decimal, Decimal, Decimal]] = None

    def holat(qolgan: Decimal, soz: str, yopiq: str) -> str:
        if qolgan >= 1:
            return "%s %s" % (soz, pul(qolgan)) + (" — yopilmagan" if yopiq else "")
        if qolgan <= -1:
            return "ortiqcha %s" % pul(-qolgan) + (" — yopilgan" if yopiq else "")
        return yopiq or "qoldiq 0"

    for s in kn.shartnomalar:
        c, o = s.crm, s.okv
        if not c.topildi:
            continue
        cb, co, cj = _crm_yigindi(c)
        pre = s.shartnoma + ": " if kop else ""
        if c.reja_bosh is not None and c.reja_bosh > 0:
            t = C.TOLOV_REJA_BOSH_TPL.format(reja=pul(c.reja_bosh), tolangan=pul(cb),
                                             holat=holat(c.reja_bosh - cb, "qarz", "yopilgan"))
            if abs(o.bosh - cb) >= 1:
                t += " (OplatyKv bo'yicha bosh. %s)" % pul(o.bosh)
            qator.append(pre + t)
            b0 = bosh or (_NOL, _NOL, _NOL)
            bosh = (b0[0] + c.reja_bosh, b0[1] + cb, b0[2] + max(_NOL, c.reja_bosh - cb))
        if c.reja_oylik is not None and c.reja_oylik > 0:
            t = C.TOLOV_REJA_OYLIK_TPL.format(reja=pul(c.reja_oylik), tolangan=pul(co),
                                              holat=holat(c.reja_oylik - co, "qoldiq", ""))
            if abs(o.oylik - co) >= 1:
                t += " (OplatyKv bo'yicha oylik %s)" % pul(o.oylik)
            qator.append(pre + t)
        if c.narx is not None and c.narx > 0:
            qator.append(pre + C.TOLOV_REJA_JAMI_TPL.format(narx=pul(c.narx), tolangan=pul(cj),
                                                             holat=holat(c.narx - cj, "qoldiq", "")))
    return qator, bosh


def _manbalar(n: Natija, d: DbNatija, crm_sabab: Optional[str]) -> List[ManbaQator]:
    """5 manba: CRM, Bank, OplatyKv, solishtiriladigan sheetlar. Holat OplatyKv'ga nisbatan (bank: bankdan kelgan
    OplatyKv qatorlariga nisbatan)."""
    okv_j, okv_qo = _okv_jami_sql(d.okv_jami) if d.okv_jami is not None else (None, {})
    okv_jami = okv_j.jami if okv_j is not None else None
    rows: List[ManbaQator] = []

    def nisbat(summa: Optional[Decimal]) -> str:
        return _ishorali(summa - okv_jami) if summa is not None and okv_jami is not None else "OplatyKv o'qilmadi"

    kn = n.koprik
    crm_q = ManbaQator("CRM")
    if kn is not None and not kn.xato and kn.shartnomalar and all(s.crm.topildi for s in kn.shartnomalar):
        crm_q.soni = sum(len(s.crm.tolovlar) for s in kn.shartnomalar)
        crm_q.summa = sum((_crm_yigindi(s.crm)[2] for s in kn.shartnomalar), _NOL)
        crm_q.holat = nisbat(crm_q.summa)
    elif n.crm_ok and n.jamilar is not None and n.jamilar.crm is not None:
        crm_q.soni, crm_q.summa = n.jamilar.crm.soni, n.jamilar.crm.jami
        crm_q.holat = nisbat(crm_q.summa)
    else:
        yoq = next((s for s in (kn.shartnomalar if kn is not None and not kn.xato else []) if not s.crm.topildi), None)
        sabab = (C.TOLOV_KOPRIK_PREFIKS + kn.xato if kn is not None and kn.xato else
                 (yoq.crm.xato or "CRM'da topilmadi") if yoq is not None else crm_sabab or C.TOLOV_SABAB_OCHIRILGAN)
        crm_q.holat = "o'qilmadi: " + _toza(_lotin(sabab), 80)
    rows.append(crm_q)
    bank = ManbaQator("Bank")
    if d.tx_jami is not None and n.jamilar is not None:
        bank.soni = sum(SF._int(r.get("soni")) for r in d.tx_jami if r.get("mijoz"))
        bank.summa = n.jamilar.tx_client
        if okv_j is not None:
            bank.holat = _ishorali(bank.summa - okv_qo.get("bankdan", _NOL))
            tashqi = okv_j.jami - okv_qo.get("bankdan", _NOL)
            if abs(tashqi) >= 1:
                bank.holat += " (OplatyKv'da bankdan tashqari %s)" % pul(tashqi)
        else:
            bank.holat = "OplatyKv o'qilmadi"
    else:
        bank.holat = "o'qilmadi: " + (d.xatolar.get("transactions") or C.TOLOV_SABAB_DB)
    rows.append(bank)
    okv = ManbaQator("OplatyKv")
    if okv_j is not None:
        okv.soni, okv.summa = okv_j.soni, okv_j.jami
        muammo = sum(1 for f in n.farqlar if not f.yashirin and f.kod in ("XATO", "OKV_YOQ", "TX_YOQ", "DUBLIKAT"))
        okv.holat = "mos" if not muammo else "%d ta muammo (pastda)" % muammo
    else:
        okv.holat = "o'qilmadi: " + (d.xatolar.get("oplata_kv") or C.TOLOV_SABAB_DB)
    rows.append(okv)
    if kn is None or kn.xato:
        rows.append(ManbaQator("Sheetlar", holat="o'qilmadi: " + (
            C.TOLOV_KOPRIK_PREFIKS + kn.xato if kn is not None else C.TOLOV_SABAB_OCHIRILGAN)))
        return rows
    tanlangan = _sheet_tanlangan(kn)
    sheetlar = [(sid, nomi) for sid, nomi in kn.sheetlar if sid in tanlangan]
    if not sheetlar:
        rows.append(ManbaQator("Sheetlar", holat="o'qilmadi: " + C.TOLOV_SABAB_SHEET_YOQ))
    for sid, nomi in sheetlar:
        sh = [next((x for x in s.sheetlar if x.id == sid), None) for s in kn.shartnomalar]
        q = ManbaQator(nomi)
        yoq_sh = next((x for x in sh if x is None or not x.mavjud), None) if sh else None
        if not sh or any(x is None or not x.mavjud for x in sh):
            q.holat = "o'qilmadi: " + ((yoq_sh.sabab if yoq_sh is not None else "") or "natija yo'q")
        else:
            q.soni = sum(x.qatorlar for x in sh if x is not None)
            q.summa = sum((x.jami for x in sh if x is not None), _NOL)
            q.holat = nisbat(q.summa)
        rows.append(q)
    return rows


def _yig(fs: Sequence[OddiyFarq]) -> Decimal:
    return sum((abs(f.summa) for f in fs if f.summa is not None), _NOL)


_SHUBHA_GURUH = ("xonpay_shubha", "xonpay_bekor")


def _xulosa_jumla(manbalar: Sequence[ManbaQator], fs_hammasi: Sequence[OddiyFarq],
                  bosh: Optional[Tuple[Decimal, Decimal, Decimal]] = None) -> str:
    """Xulosa: hammasi mos yoki farqlar toifalari (summasi bilan) va o'qilmagan manbalar. Boshlang'ich yopilmagan
    bo'lsa (bosh qarz) aytiladi; hamma manba mos bo'lsa bu asosiy javob. Shubhali XonPay yozuvlari alohida jumla."""
    g: Dict[str, List[OddiyFarq]] = {}
    fs = [f for f in fs_hammasi if f.guruh not in _SHUBHA_GURUH]
    for f in fs:
        g.setdefault(f.guruh, []).append(f)
    shubha = [f for f in fs_hammasi if f.guruh == "xonpay_shubha"]
    oxiri = (" Billing'da %d ta tekshirilishi kerak XonPay yozuvi bor (Farqlar)." % len(shubha)) if shubha else ""
    qarz = bosh[2] if bosh is not None and bosh[2] >= 1 else None
    qism: List[str] = []
    xp = g.get("xonpay", []) + g.get("xonpay_kech", [])
    if xp:
        k, m = len(g.get("xonpay", [])), len(g.get("xonpay_kech", []))
        tafsil = (" (%d tasi kutilmoqda, %d tasi kechikdi)" % (k, m) if k and m else
                  ": 3 ish kunidan kechikdi" if m else ": odatdagi 1-3 ish kuni kutilmoqda")
        qism.append("CRM'da %d ta XonPay to'lovi (%s so'm) bizga hali tushmagan%s" % (len(xp), pul(_yig(xp)), tafsil))
    matn = {
        "bank_sync": "CRM'dagi {n} ta bank to'lovi ({s} so'm) bizning Tranzaksiyalarda yo'q (bank sync)",
        "crm_bor": "CRM'da {n} ta to'lov ({s} so'm) bizda yo'q",
        "naqd": "CRM'da {n} ta naqd to'lov ({s} so'm), bankda bo'lmaydi",
        "okv_bor": "bizda {n} ta to'lov ({s} so'm) CRM'da yo'q",
        "xato": "{n} ta to'lov ({s} so'm) bizda XATO: bank izohidagi shartnoma raqami noto'g'ri",
        "boshqa": "{n} ta to'lov boshqa shartnoma ostida",
        "sync": "{n} ta yangi bank to'lovi OplatyKv sync'ini kutmoqda",
        "okv": "{n} ta to'lov bo'yicha bank va OplatyKv orasida muammo",
    }
    for grp, tpl in matn.items():
        if g.get(grp):
            qism.append(tpl.format(n=len(g[grp]), s=pul(_yig(g[grp]))))
    for f in g.get("sheet", []):
        qism.append("%s da to'lovlar to'liq ko'rinmaydi: %s" % (f.turi, f.sabab.split(": ", 1)[-1]))
    oqilmadi = [m.nomi for m in manbalar if m.holat.startswith("o'qilmadi")]
    boshqa_mos = all(m.holat == "mos" or m.holat.startswith("mos ") for m in manbalar
                     if m.nomi != "CRM" and not m.holat.startswith("o'qilmadi"))
    if not qism:
        okv = next((m for m in manbalar if m.nomi == "OplatyKv"), None)
        if not oqilmadi and all(m.holat == "mos" or m.holat.startswith("mos ") for m in manbalar) and okv is not None:
            if qarz is not None:
                return C.TOLOV_XULOSA_BOSH_QARZ_TPL.format(tolangan=pul(okv.summa), qarz=pul(qarz)) + oxiri
            return C.TOLOV_XULOSA_MOS_TPL.format(n=okv.soni, summa=pul(okv.summa)) + "." + oxiri
        farqli = [m.nomi for m in manbalar if not (m.holat == "mos" or m.holat.startswith("mos "))
                  and not m.holat.startswith("o'qilmadi")]
        if farqli:
            qism.append("jami farqli: %s (to'lov darajasida sabab topilmadi, batafsil rejimda)" % ", ".join(farqli))
        else:
            qism.append("tekshirilgan manbalar mos")
    elif boshqa_mos and any(f.guruh in ("xonpay", "xonpay_kech", "bank_sync", "crm_bor", "naqd") for f in fs) \
            and all(f.guruh in ("xonpay", "xonpay_kech", "bank_sync", "crm_bor", "naqd") for f in fs):
        qism.append("bank, OplatyKv va sheetlar o'zaro mos")
    if qarz is not None:
        qism.append("boshlang'ich to'lov yopilmagan (qarz %s)" % pul(qarz))
    if oqilmadi:
        qism.append("o'qilmadi: " + ", ".join(oqilmadi))
    return "; ".join(qism) + "." + oxiri


def _guruh_javobi(n: Natija, manbalar: Sequence[ManbaQator], fs: Sequence[OddiyFarq],
                  bosh: Optional[Tuple[Decimal, Decimal, Decimal]] = None) -> str:
    """Guruhga nusxalash uchun 1-3 jumla: to'lov topildimi, qayerda, nega ko'rinmaydi, qachon ko'rinadi.
    Boshlang'ich yopilmagan bo'lsa reja, to'langan va qarz; pul hech bir manbada yo'q bo'lsa chek so'raladi."""
    k = n.kirish

    def ds(sana: str, summa: Optional[Decimal]) -> Tuple[str, str]:
        return _sana_qisqa(sana), pul(abs(summa)) if summa is not None else "-"

    if k is not None and k.tur == "xonpay" and n.xonpay:
        x = next((x for x in n.xonpay if x.uuid == k.id or x.ext.lower() == k.id), None)
        if x is not None:
            sana, summa = ds(x.sana, x.summa)
            if x.holat == "KUTILMOQDA":
                return C.TOLOV_XONPAY_GURUH_JAVOB.replace("(DD.MM, N so'm)", "(%s, %s so'm)" % (sana, summa))
            if x.holat == "KECHIKDI":
                return C.TOLOV_GURUH_XONPAY_KECHIKDI_TPL.format(sana=sana, summa=summa)
            if x.holat == "TUSHGAN":
                return C.TOLOV_GURUH_XONPAY_TUSHGAN_TPL.format(sana=sana, summa=summa,
                                                               tushgan=_sana_qisqa(x.tushgan_sana))
    g: Dict[str, List[OddiyFarq]] = {}
    for f in fs:
        g.setdefault(f.guruh, []).append(f)
    jumla: List[str] = []
    kut, kech = g.get("xonpay", []), g.get("xonpay_kech", [])
    if len(kut) == 1 and not kech:
        sana, summa = ds(kut[0].sana, kut[0].summa)
        jumla.append(C.TOLOV_XONPAY_GURUH_JAVOB.replace("(DD.MM, N so'm)", "(%s, %s so'm)" % (sana, summa)))
    elif len(kech) == 1 and not kut:
        sana, summa = ds(kech[0].sana, kech[0].summa)
        jumla.append(C.TOLOV_GURUH_XONPAY_KECHIKDI_TPL.format(sana=sana, summa=summa))
    elif kut or kech:
        royxat = ", ".join("%s %s so'm" % ds(f.sana, f.summa) for f in kut + kech)
        jumla.append("Shartnoma bo'yicha %d ta XonPay to'lovi (%s) bizning hisobga hali tushmagan: XonPay odatda 1-3 ish"
                     " kunida o'tkazadi, tushgach xonadonda avtomat ko'rinadi." % (len(kut) + len(kech), royxat))
        if kech:
            jumla.append("%s dagi to'lov odatdagi muddatdan kechikdi, XonPay bilan tekshirish kerak." % ", ".join(
                ds(f.sana, f.summa)[0] for f in kech))
    shablon = (
        ("bank_sync", "To'lov ({sana}, {summa} so'm) CRM'da bor, lekin bankdan bizning tizimga hali tushmagan; bank"
                      " ma'lumoti yangilangach xonadonda ko'rinadi."),
        ("xato", "To'lov ({sana}, {summa} so'm) bankdan kelgan, lekin izohdagi shartnoma raqami noto'g'ri yozilgan;"
                 " to'g'ri shartnomaga biriktirilgach xonadonda ko'rinadi."),
        ("sync", "To'lov bankdan yaqinda kelgan, tizim avtomat yangilanmoqda; bir necha daqiqada ko'rinadi."),
        ("naqd", "To'lov ({sana}, {summa} so'm) CRM'da naqd sifatida yozilgan, bankdan kelmagan."),
        ("crm_bor", "To'lov ({sana}, {summa} so'm) CRM'da bor, lekin bizning bankda topilmadi; tekshirish kerak."),
        ("okv_bor", "To'lov ({sana}, {summa} so'm) bizda bor, CRM'da hali yo'q; CRM operatori kiritishi kerak."),
        ("boshqa", "To'lov ({sana}, {summa} so'm) boshqa shartnoma ostida yozilgan; qaysi shartnomaga tegishliligi"
                   " aniqlanishi kerak."),
    )
    for grp, tpl in shablon:
        if g.get(grp) and len(jumla) < 3:
            sana, summa = ds(g[grp][0].sana, g[grp][0].summa)
            jumla.append(tpl.format(sana=sana, summa=summa))
    if g.get("sheet") and len(jumla) < 3:
        f = g["sheet"][0]
        keyin = " Keyingi eksportda ko'rinadi." if "eksportning oxirgi ishidan keyin" in f.sabab else ""
        jumla.append("To'lovlar bizda bor, lekin %s da hali to'liq ko'rinmaydi.%s" % (f.turi, keyin))
    if bosh is not None and bosh[2] >= 1:
        b = C.TOLOV_GURUH_BOSH_QARZ_TPL.format(reja=pul(bosh[0]), tolangan=pul(bosh[1]), qarz=pul(bosh[2]))
        if not any(g.get(x) for x in ("xonpay", "xonpay_kech", "bank_sync", "crm_bor", "naqd")):
            b += " " + C.TOLOV_GURUH_CHEK.format(qarz=pul(bosh[2]))
        jumla = [b] if not jumla else jumla[:2] + [b]
    if not jumla:
        okv = next((m for m in manbalar if m.nomi == "OplatyKv"), None)
        if okv is not None and okv.summa is not None:
            jumla.append(C.TOLOV_GURUH_MOS_TPL.format(n=okv.soni, summa=pul(okv.summa)))
    return " ".join(jumla[:3])


def _xulosa_qur(n: Natija, d: DbNatija, crm_sabab: Optional[str]) -> Xulosa:
    """Egasi uchun oddiy tildagi xulosa: sarlavha, bitta jumla, 5 manba jadvali, MUHIM farqlar (sabab + nima
    qilish), taqsimot eslatmasi (faqat jami mos bo'lsa), guruhga javob. Tarix shovqini kirmaydi."""
    x = Xulosa(shartnoma=", ".join(n.shartnomalar))
    kesh = {_s(r.get("contract_number")): r for r in (d.kesh or [])}
    r = kesh.get(n.shartnomalar[0]) if len(n.shartnomalar) == 1 else None
    if r is not None:
        holat = _holat_oddiy(r.get("status"))
        x.tavsif = ", ".join(v for v in (mijoz_ismi(r.get("customer_name")),
                                         _toza(_lotin(_s(r.get("object_name"))), 40)) if v)
        if holat:
            x.tavsif += " (%s)" % holat if x.tavsif else holat
    x.manbalar = _manbalar(n, d, crm_sabab)
    x.reja, x.bosh = _reja(n)
    x.farqlar = _oddiy_farqlar(n)
    x.xulosa = _xulosa_jumla(x.manbalar, x.farqlar, x.bosh)
    jami_mos = all(m.holat == "mos" or m.holat.startswith("mos ") for m in x.manbalar if m.nomi in ("CRM", "Bank"))
    if jami_mos and any(not f.yashirin and f.kod in C.TOLOV_TAQSIMOT_KODLAR for f in n.farqlar):
        x.eslatma = C.TOLOV_ESLATMA_TAQSIMOT
    x.guruh = _guruh_javobi(n, x.manbalar, x.farqlar, x.bosh)
    cf = _crm_id_farq(n)
    if cf is not None:
        # Bizda shartnomasiz (XATO), CRM'da topildi: shu to'lov asosiy xabar; umumiy farqlar ichidagi
        # aynan shu to'lov (sana va summa teng) takrorlanmaydi
        sh = n.crm_id.aniq[0]["shartnoma"]
        x.farqlar = [cf] + [f for f in x.farqlar if not (f.sana == cf.sana and f.summa is not None
                                                        and abs(abs(f.summa) - cf.summa) < 1)]
        x.xulosa = ("To'lov (%s, %s so'm) bizga tushgan, lekin bizda shartnomasiz (XATO) turibdi; CRM'da u %s"
                    " shartnomasiga yozilgan, shuning uchun xonadonda ko'rinmayapti. Tuzatish: 1-farq." % (
                        _sana_qisqa(cf.sana), pul(cf.summa), sh))
        x.guruh = C.TOLOV_GURUH_CRMDA_TPL.format(sana=_sana_qisqa(cf.sana), summa=pul(cf.summa), sh=sh)
    k = n.kirish
    x.batafsil = C.TOLOV_BATAFSIL_TPL.format(
        kirish=k.id if k is not None and k.tur in ("xonpay", "id") else ",".join(n.shartnomalar))
    return x


def _crm_id_farq(n: Natija) -> Optional[OddiyFarq]:
    """Bitta to'lov bizda shartnomasiz (XATO) edi, CRM bank ID si bo'yicha topdi: sabab va aniq tuzatish yo'li."""
    c, y = n.crm_id, n.yolgiz
    if c is None or y is None or not c.aniq or c.eski is None:
        return None
    sh = c.aniq[0]["shartnoma"]
    eski = [s for s in c.eski if s]
    sabab = ("To'lov bankdan tushgan, lekin %s, shu sababli bizda shartnomasiz (XATO) turibdi. CRM'da esa u %s"
             " shartnomasiga yozilgan (bank ID bir xil)" % (
                 "izohdagi raqam (%s) CRM'da yo'q" % ", ".join(eski) if eski else "izohida shartnoma raqami yo'q", sh))
    nima = C.TOLOV_TUZ_XATO_CRM if c.via == "sana" else C.TOLOV_TUZ_XATO_QOLDA.format(sh=sh)
    return OddiyFarq(sana=_s(y.get("sana")), summa=_dec(y.get("summa")), turi="bank", sabab=sabab, nima=nima,
                     guruh="xato_crm")


def _xulosa_shartnomasiz(n: Natija, d: DbNatija) -> Xulosa:
    """Bitta to'lov topildi, lekin hech bir shartnomaga biriktirilmagan va CRM'da ham ID bo'yicha yo'q: oddiy tilda."""
    y = d.yolgiz or {}
    c = n.crm_id
    summa = _dec(y.get("summa"))
    sana = _s(y.get("sana"))
    x = Xulosa(shartnoma="To'lov %s · %s so'm" % (_sana_qisqa(sana), pul(summa)))
    if y.get("tolovchi"):
        x.tavsif = "to'lovchi: " + _s(y.get("tolovchi"))
    if c is None:
        crm_holat = "tekshirilmadi (panel ko'prigi o'chiq)"
    elif c.xato:
        crm_holat = "o'qilmadi: " + _toza(c.xato, 120)
    else:
        crm_holat = "bank ID bo'yicha yo'q"
    okv_sh = _s(y.get("okv_sh"))
    x.manbalar = [
        ManbaQator("Bank", 1 if y.get("bizda") else 0, summa if y.get("bizda") else None,
                   "tushgan" if y.get("bizda") else "bizda yo'q (bank sync hali olmagan)"),
        ManbaQator("OplatyKv", 1 if y.get("okv_bor") else 0, summa if y.get("okv_bor") else None,
                   ("shartnoma %s, CRM'da yo'q (XATO)" % okv_sh if okv_sh else "shartnomasiz (XATO)")
                   if y.get("okv_bor") else "yo'q"),
        ManbaQator("CRM", 0 if c is not None and not c.xato else None, None, crm_holat),
    ]
    izoh_sh = _s(y.get("shartnoma")) or okv_sh
    sabab = "To'lov hech bir shartnomaga biriktirilmagan: " + (
        "izohdagi raqam %s CRM'da yo'q" % izoh_sh if izoh_sh else "izohida shartnoma raqami yo'q")
    if c is not None and not c.xato:
        sabab += ", CRM'da ham bu to'lov bank ID bo'yicha topilmadi"
    x.farqlar = [OddiyFarq(sana=sana, summa=summa, turi="bank", sabab=sabab, nima=C.TOLOV_TUZ_SHARTNOMASIZ,
                           guruh="shartnomasiz")]
    for r in (c.summa_teng if c is not None else [])[:3]:
        kim = r["mijoz"] or r["obyekt"] or "-"
        x.farqlar.append(OddiyFarq(
            sana=r["sana"], summa=r["summa"], turi="CRM",
            sabab="CRM'da shu kuni aynan shu summali to'lov bor: %s shartnomasi (%s), lekin bank ID bilan"
                  " bog'lanmagan (qo'lda kiritilgan bo'lishi mumkin)" % (r["shartnoma"], kim),
            nima="to'lovchi va %s mijozi bir odammi, tekshiring; ha bo'lsa to'lovni %s ga biriktiring" % (
                kim, r["shartnoma"]), guruh="nomzod"))
    x.xulosa = "To'lov bankdan bizga tushgan, lekin hech bir shartnomaga biriktirilmagan" + (
        "" if c is None or c.xato else "; CRM'da ham bank ID bo'yicha yo'q")
    if c is not None and c.summa_teng:
        x.xulosa += "; CRM'da shu kuni shu summali %d ta to'lov bor (ID'siz), pastda" % len(c.summa_teng)
    x.xulosa += "."
    x.guruh = C.TOLOV_GURUH_SHARTNOMASIZ_TPL.format(sana=_sana_qisqa(sana), summa=pul(summa))
    x.batafsil = C.TOLOV_BATAFSIL_TPL.format(kirish=_s(y.get("kalit")) or "-")
    return x


def _xulosa_chek_yoq(n: Natija, k: Kirish) -> Xulosa:
    """Chek bo'yicha tranzaksiya bazada topilmadi (order № ham, summa+sana ham)."""
    c = n.chek
    x = Xulosa(shartnoma="Chek №" + k.order)
    sana = k.sana.isoformat() if k.sana else ""
    if c is not None and c.xato:
        x.xulosa = "Chek tekshirilmadi: " + _toza(c.xato, 160) + "."
        x.manbalar = [ManbaQator("Bank", None, None, "o'qilmadi")]
        x.guruh = "Chekni tekshirishda texnik xato bo'ldi, birozdan keyin qayta tekshiramiz."
    else:
        x.xulosa = "Chekdagi to'lov bizning bank ko'chirmamizda topilmadi" + (
            " (order № ham, summa va sana ham mos kelmadi)." if k.summa is not None and k.sana else
            " (order № bank hujjat raqamiga mos kelmadi).")
        x.manbalar = [ManbaQator("Bank", 0, None, "topilmadi")]
        x.farqlar = [OddiyFarq(
            sana=sana, summa=k.summa, turi="chek",
            sabab="order № bank hujjat raqamiga mos kelmadi" + (
                " va shu summa/sanadagi tranzaksiya yo'q" if k.summa is not None and k.sana else ""),
            nima="bank sinxronini kuting yoki chekdagi order №, summa va sanani tekshiring (panel: Chek order >"
                 " Tekshirish); summa va sana bilan qayta: /tolov chek <order №> <summa> <sana>", guruh="chek")]
        x.guruh = ("Chekdagi to'lov hozircha bizning bank ko'chirmamizda ko'rinmayapti. Bank o'tkazmasi tushishi"
                   " bilan tekshirib, xabar beramiz.")
    x.batafsil = C.TOLOV_BATAFSIL_TPL.format(kirish="chek " + k.order)
    return x


def _manba_jadval(manbalar: Sequence[ManbaQator]) -> List[str]:
    """'Manba            To'lov        Summa  Holat' ustunlari (nomi 16, soni 7, summa >= 11, 2 bo'shliq)."""
    fmt = "%-16s%7s  %11s  %s"
    out = [fmt % C.TOLOV_MANBA_SARLAVHA]
    for m in manbalar:
        out.append((fmt % (_toza(_lotin(m.nomi), 15), "-" if m.soni is None else m.soni,
                           "-" if m.summa is None else pul(m.summa), _toza(m.holat, 160))).rstrip())
    return out


def _farq_satr(f: OddiyFarq) -> str:
    q = " · ".join((_sana_qisqa(f.sana), pul(f.summa) if f.summa is not None else "-", _toza(f.turi, 40)))
    return "%s — %s. Nima qilish: %s." % (q, _toza(f.sabab, 300).rstrip("."), _toza(f.nima, 200).rstrip("."))


def _xulosa_qatorlari(x: Xulosa, farq_max: int) -> Tuple[List[str], List[str], List[str], List[str], List[str]]:
    """(bosh qatorlar, jadval, reja qatorlari, farq qatorlari, oxirgi qatorlar) — oddiy matn (HTML'siz)."""
    bosh = [x.shartnoma + (" — " + x.tavsif if x.tavsif else ""), "Xulosa: " + _toza(x.xulosa, 900)]
    farq = ["%d. %s" % (i, _farq_satr(f)) for i, f in enumerate(x.farqlar[:farq_max], 1)]
    if len(x.farqlar) > farq_max:
        farq.append("... yana %d ta farq: batafsil rejimda" % (len(x.farqlar) - farq_max))
    oxir = ([x.eslatma] if x.eslatma else []) + ["Guruhga javob: " + _toza(x.guruh, 900)]
    return bosh, _manba_jadval(x.manbalar), [_toza(r, 300) for r in x.reja], farq, oxir


def format_xulosa(n: Natija) -> str:
    """/tolov egasiga (Telegram HTML, <= TELEGRAM_LIMIT): sarlavha, Xulosa, 5 manba jadvali, Farqlar (sabab + nima
    qilish), Guruhga javob, 'Batafsil: /tolov ... batafsil'. Xulosa bo'lmasa (nomzodlar, baza yiqilgan) batafsil."""
    x = n.xulosa
    if x is None:
        return format_batafsil(n)
    esc = lambda s: html.escape(s, quote=False)  # noqa: E731
    farq_max = C.TOLOV_EGA_FARQ_MAX
    while True:
        bosh, jadval, reja, farq, oxir = _xulosa_qatorlari(x, farq_max)
        qator = ["<b>%s</b>%s" % (esc(x.shartnoma), esc(" — " + x.tavsif) if x.tavsif else ""),
                 "<b>Xulosa:</b> " + esc(bosh[1][len("Xulosa: "):]),
                 "<pre>" + esc("\n".join(jadval)) + "</pre>"] + [esc(r) for r in reja]
        qator += ["<b>Farqlar:</b>"] + [esc(f) for f in farq] if farq else ["<b>Farqlar:</b> yo'q"]
        qator += [esc(o) for o in oxir[:-1]]
        qator += ["<b>Guruhga javob:</b> " + esc(oxir[-1][len("Guruhga javob: "):]), esc(x.batafsil)]
        matn = "\n".join(qator)
        if len(matn) <= C.TELEGRAM_LIMIT or farq_max == 0:
            return matn[:C.TELEGRAM_LIMIT]
        farq_max -= 1


def _xulosa_blok(n: Natija) -> List[str]:
    """Checker bloki boshi: xulosa oddiy matnda (HTML'siz), keyin 'TEXNIK:'. Xulosa yo'q bo'lsa []."""
    if n.xulosa is None:
        return []
    bosh, jadval, reja, farq, oxir = _xulosa_qatorlari(n.xulosa, C.TOLOV_BLOK_FARQ_MAX)
    qator = [C.TOLOV_XULOSA_BLOK_BOSH] + [_bir_qator(bosh[0], 300), bosh[1]] + jadval + reja
    qator += (["Farqlar:"] + farq) if farq else ["Farqlar: yo'q"]
    return qator + oxir + [C.TOLOV_XULOSA_BLOK_OXIR]


# ---------------------------------------------------------------------------
# Format (sof)
# ---------------------------------------------------------------------------
_QATOR_MAX: Dict[str, int] = {"chek": 400, "crm_id": 400}   # bitta to'lov haqida: qisqa (blok hajmi)


def _qator(b: Bolim, xabar: Optional[str] = None) -> str:
    return C.CHECKER_QATOR_TPL.format(komponent=b.komponent, status=str(b.status).upper(),
                                      xabar=_toza(b.xabar if xabar is None else xabar,
                                                  _QATOR_MAX.get(b.komponent, 900)))


def _farq_qator(f: Farq, izoh_n: int, egasi: bool = False) -> str:
    """Farq qatori. To'lovchi erkin matni (f.ochiq: F.I.O. bo'lishi mumkin) faqat egasi=True da (/tolov)."""
    q = ["F%d %s" % (f.raqam, f.kod), f.sana or "-", pul(f.summa) if f.summa is not None else "-",
         _toza(f.dalil, 160) or "-"]
    # erkin matn: agentga faqat undagi shartnoma raqamlari; egasiga maskalangan matn (F.I.O. qolishi mumkin)
    erkin = ("izoh: " + _izoh_pii(f.ochiq, _IZOH_MAX)) if egasi and f.ochiq else f.ochiq_raqam
    izoh = "; ".join(x for x in (f.izoh, erkin) if x)
    if izoh:
        q.append(_toza(_lotin(izoh), izoh_n))
    if f.sabab:
        q.append("sabab: " + _toza(_lotin(f.sabab), izoh_n * 3))
    q.append("tuzatish: " + f.tuzatish)
    return "  " + _bir_qator(" | ".join(q), 600)


def _juft_qator(j: Juft, korinadi: Set[int]) -> str:
    o, t, c = j.okv, j.tx, j.crm
    if c is not None:
        crm_col = "%s %s" % (c.sana[5:10] or "-", _crm_harf(c))
    else:
        crm_col = "-"
    if o is None:
        okv_col = "-"
    elif "XATO" in j.kodlar:
        okv_col = "XATO"
    elif j.xato_nomalum:
        okv_col = "?"  # crm_kesh o'qilmadi: XATO yoki yo'qligi noma'lum
    elif o.pgroup:
        okv_col = "PB"
    elif o.batch:
        okv_col = "EXCEL"
    elif not o.source_tx_id and o.tx is None:
        okv_col = "QO'LDA"
    else:
        okv_col = "ha"
    tx_col = "%s %s" % (t.holat or "-", _bank_qisqa(t.bank)) if t is not None else "-"
    kod = ",".join("F%d" % f.raqam if f.raqam in korinadi else f.kod for f in j.farqlar) or "-"
    q = [_j_sana(j) or "-", pul(_j_summa(j)), _okv_harf(o), crm_col, okv_col, tx_col, j.moslik, kod]
    return "  " + (">> " if j.maqsad else "") + _bir_qator(" | ".join(q), 300)


def _jadval(n: Natija, maks: int) -> Tuple[List[Juft], int, bool]:
    """(ko'rsatiladigan juftlar, jami, qolganlari hammasi mos)."""
    def farqi_bor(j: Juft) -> bool:                # yashirin tarix shovqini farq hisoblanmaydi
        return any(not f.yashirin for f in j.farqlar)

    farqli = [j for j in n.juftlar if farqi_bor(j) or j.maqsad]
    toza = [j for j in n.juftlar if not (farqi_bor(j) or j.maqsad)]
    farqli.sort(key=lambda j: _j_sana(j), reverse=True)
    farqli.sort(key=lambda j: not j.maqsad)
    toza.sort(key=lambda j: _j_sana(j), reverse=True)
    tanlangan = (farqli + toza)[:max(0, maks)]
    qolgan = [j for j in n.juftlar if j not in tanlangan]
    return tanlangan, len(n.juftlar), all(not farqi_bor(j) for j in qolgan)


def _render(n: Natija, limit: int, jadval_max: int, olcham: Callable[[str], int] = len,
            egasi: bool = False) -> List[str]:
    """Komponent qatorlari HECH QACHON kesilmaydi. Kesish tartibi: jadval -> farq izohi 80->40 -> farqlar.
    egasi=True: /tolov (faqat egasiga) — farq qatorida to'lovchi izohi ham (maskalangan)."""
    if not n.bolimlar:
        return [C.CHECKER_QATOR_TPL.format(komponent="kirish", status="UNKNOWN", xabar=C.TOLOV_SABAB_KIRISH)]
    tartib = {k: i for i, k in enumerate(C.TOLOV_KOMPONENTLAR)}
    bolimlar = sorted(n.bolimlar, key=lambda b: tartib.get(b.komponent, 99))
    ochiq_f = [f for f in n.farqlar if not f.yashirin]   # yashirin tarix shovqini: [farqlar] xabarida soni bilan
    korinadi_f = ochiq_f[:C.TOLOV_FARQ_MAX]
    ortiq = ochiq_f[C.TOLOV_FARQ_MAX:]
    korinadi: Set[int] = {f.raqam for f in korinadi_f}
    jamlangan = ""
    if ortiq:
        son: Dict[str, int] = {}
        for f in ortiq:
            son[f.kod] = son.get(f.kod, 0) + 1
        jamlangan = "  " + C.TOLOV_FARQ_JAMLANGAN_TPL.format(
            n=len(ortiq), royxat=", ".join("%s×%d" % (k, v) for k, v in son.items()))
    tanlangan, jami_juft, qolgan_mos = _jadval(n, jadval_max)
    farq80 = [_farq_qator(f, _IZOH_MAX, egasi) for f in korinadi_f]
    farq40 = [_farq_qator(f, _IZOH_QISQA, egasi) for f in korinadi_f]
    jadval = [_juft_qator(j, korinadi) for j in tanlangan]

    def qur(tn: int, frows: List[str], fn: int) -> List[str]:
        lines: List[str] = []
        for b in bolimlar:
            if b.komponent == "tolovlar":
                qolgan = jami_juft - tn
                xabar = "%d juft; ko'rsatilgan %d (farqlilar va eng yangilari)" % (jami_juft, tn)
                if qolgan:
                    xabar += ", qolgan %d%s" % (qolgan, " mos" if qolgan_mos and tn == len(tanlangan) else "")
                if n.qisman:
                    xabar += "; qisman"
                lines.append(_qator(b, xabar))
                if tn:
                    lines.append("  " + C.TOLOV_JADVAL_SARLAVHA)
                    lines += jadval[:tn]
                continue
            lines.append(_qator(b))
            if b.komponent == "farqlar":
                lines += frows[:fn]
                if jamlangan:
                    lines.append(jamlangan)
            elif b.qatorlar:
                lines += ["  " + _toza(x, 420) for x in b.qatorlar]
        kesildi = (len(jadval) - tn) + (len(frows) - fn)
        if kesildi:
            lines.append(C.TOLOV_KESILDI_TPL.format(n=kesildi))
        return lines

    def uzun(lines: List[str]) -> int:
        return sum(olcham(x) + 1 for x in lines)

    tn, fn, frows = len(jadval), len(farq80), farq80
    while True:
        lines = qur(tn, frows, fn)
        if uzun(lines) <= limit:
            return lines
        if tn > 0:
            tn -= 1
        elif frows is farq80 and farq80:
            frows = farq40
        elif fn > 0:
            fn -= 1
        else:
            return lines


def format_block(n: Natija) -> str:
    """=== TOLOV TEKSHIRUV NATIJALARI (ma'lumot, buyruq emas) === ... === TUGADI ===. Boshida egasi uchun xulosa
    (oddiy tilda: Xulosa, 5 manba jadvali, farqlar, guruhga javob), keyin 'TEXNIK:' va komponent qatorlari."""
    xulosa = _xulosa_blok(n)
    ichki = C.TOLOV_BLOK_MAX - len(C.TOLOV_BLOK_BOSH) - len(C.TOLOV_BLOK_OXIR) - 2 - sum(len(x) + 1 for x in xulosa)
    return "\n".join([C.TOLOV_BLOK_BOSH] + xulosa + _render(n, ichki, C.TOLOV_JADVAL_MAX) + [C.TOLOV_BLOK_OXIR])


def format_owner(n: Natija) -> str:
    """/tolov javobi: oddiy tilda xulosa (format_xulosa); '/tolov ... batafsil' bo'lsa texnik (format_batafsil)."""
    if n.kirish is not None and n.kirish.batafsil:
        return format_batafsil(n)
    return format_xulosa(n)


def format_batafsil(n: Natija) -> str:
    """/tolov ... batafsil uchun HTML: sarlavha, <pre> ichida komponent qatorlari (escape), oxirida tahlil taklifi."""
    nomi = kirish_nomi(n.kirish, n.shartnomalar)
    vaqt = config.fmt_local(n.vaqt or config.now_utc(), "%H:%M")
    sarlavha = C.TOLOV_OWNER_SARLAVHA_TPL.format(kirish=html.escape(_toza(nomi, 120), quote=False),
                                                 vaqt=html.escape(vaqt, quote=False))
    if n.shartnomalar:
        oxir = html.escape(C.TOLOV_OWNER_OXIR_TPL.format(shartnoma=_toza(", ".join(n.shartnomalar), 120)),
                           quote=False)
    else:
        oxir = html.escape(C.TOLOV_OWNER_NOMZOD, quote=False)
    zaxira = len(sarlavha) + len(oxir) + len("\n<pre></pre>\n") + 20
    lines = _render(n, C.TELEGRAM_LIMIT - zaxira, C.TOLOV_JADVAL_OWNER_MAX,
                    olcham=lambda s: len(html.escape(s, quote=False)), egasi=True)
    body = html.escape("\n".join(lines), quote=False)
    return "%s\n<pre>%s</pre>\n%s" % (sarlavha, body, oxir)


def qisqa(n: Natija) -> str:
    """Tarixga bitta qator: jamilar va farq kodlari. Ism, izoh va ID yo'q."""
    nomi = kirish_nomi(n.kirish, n.shartnomalar)
    if n.kirish is not None and n.kirish.tur == "mijoz" and not n.shartnomalar:
        nomi = "mijoz"
    if not n.shartnomalar:
        nomzod = next((b for b in n.bolimlar if b.komponent == "nomzodlar"), None)
        return C.TOLOV_QISQA_NOMZOD_TPL.format(kirish=_toza(nomi, 80), n=len(nomzod.qatorlar) if nomzod else 0)
    js = n.jamilar
    kodlar = _uniq(f.kod for f in n.farqlar if f.jiddiylik in ("error", "warn"))
    if js and js.crm is not None:
        crm = pul(js.crm.jami)
    elif _koprik_crm_ok(n.koprik):
        crm = pul(sum((_crm_yigindi(s.crm)[2] for s in n.koprik.shartnomalar if s.crm.topildi), _NOL)) + " (panel)"
    else:
        crm = "tekshirilmadi"
    return C.TOLOV_QISQA_TPL.format(
        kirish=_toza(nomi, 80),
        crm=crm,
        okv=pul(js.okv.jami) if js else "?", bank=pul(js.tx_client) if js else "?",
        farq=", ".join(kodlar[:8]) + (" ..." if len(kodlar) > 8 else "") if kodlar else "yo'q",
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Qo'lda: python3 -m agents.payment_check "<shartnoma | ID | summa sana | mijoz ...>" (blokni chop etadi).
    --crm-yoq: eski CRM GET chaqirilmaydi; --koprik-yoq: panel ko'prigi chaqirilmaydi."""
    import sys

    config.configure_logging()
    args = list(sys.argv[1:] if argv is None else argv)
    crm = "--crm-yoq" not in args
    koprik = "--koprik-yoq" not in args
    matn = " ".join(a for a in args if a not in ("--crm-yoq", "--koprik-yoq"))
    print(format_block(prefetch(matn, crm=crm, koprik=koprik)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
