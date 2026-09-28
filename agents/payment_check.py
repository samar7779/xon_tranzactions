"""To'lov tekshiruvi: CRM payment-history <-> transactions <-> oplata_kv (faqat o'qish).

- Kirish: /tolov argumenti yoki Leader topshirig'idagi "TOLOV: ..." qatori (zaxira: erkin matndagi
  shartnoma raqami). Egasi matni SQL'ga faqat parametr bo'lib tushadi.
- DB: bitta db.tx("facts", readonly=True, 15 s) ichida (support_facts._fx), har so'rov SAVEPOINT'da
  (support_facts._rows). TAQIQ ustunlar (telefon, raw_snapshot, metadata, raw_extra, INN, hisob
  raqamlari, note) o'qilmaydi. Oynalar Python'da hisoblanadi, NOW() yo'q.
- CRM: faqat GET {XONSAROY_CLIENT_BASE}/payment-history (_crm_get yagona tarmoq funksiyasi). Yo'l,
  parametrlar va host qat'iy, redirect taqiq, TLS tekshiruvi yoqilgan. Kalit har so'rovda config.env
  dan olinadi, global'da saqlanmaydi, logga va blokka tushmaydi. Parallellik 1, bir prefetch'da
  <= 7 so'rov, har so'rov umumiy muddati cheklangan (javob bo'laklab o'qiladi), kesh 10 daqiqa
  (xotirada), kunlik cheklov (agents.kv_store hisoblagichi), AGENTS_TOLOV_CRM=0 o'chiradi (ikkalasi
  env fayli o'zgarsa restartsiz). CRM'ga yozadigan kod yo'q (egasi qoidasi: CRM faqat o'qiladi).
- Juftlash va farq kodlari Python'da: LLM faqat tushuntiradi. prefetch() hech qachon exception
  chiqarmaydi: xato o'z bo'limiga UNKNOWN bo'lib yoziladi; manba qisman o'qilsa "yo'q" kodlari
  chiqmaydi. 2-3 shartnomada summa/sana juftlash va solishtirish har shartnoma ichida.
- Natija: format_block (agentga), format_owner (/tolov, HTML), qisqa (tarixga bir qator, PII'siz).
  To'lovchi erkin matni (purpose, bank izohi) agentga berilmaydi: faqat undagi shartnoma raqami.

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
    tur: str                                  # shartnoma | id | summa_sana | mijoz
    shartnomalar: List[str] = field(default_factory=list)
    id: str = ""
    summa: Optional[Decimal] = None
    sana: Optional[date] = None
    kun: int = 3
    bank: str = ""
    mijoz: str = ""
    xom: str = ""
    tashlangan: int = 0                       # 3 tadan ortiq shartnoma tashlandi


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
_TOLOV_KALIT_RE = re.compile(r"(?i)\b(shartnoma|id|summa|sana|kun|bank|mijoz)\s*=\s*")
_KUN_RE = re.compile(r"(?i)^kun=(\d{1,2})$")
_BANK_TOKEN_RE = re.compile(r"(?i)^bank=([A-Za-z0-9_]{2,32})$")


def _shartnoma_ok(s: str) -> Optional[str]:
    t = s.strip().translate(_CYR_SHAKL).upper().replace("№", "")
    if len(t) > 64 or not _SHARTNOMA_TOKEN_RE.match(t):
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


def _tolov_qatori(qator: str, matn: str) -> Optional[Kirish]:
    """TOLOV: shartnoma=... | id=... | summa=... sana=... [kun=..] [bank=..] | mijoz=..."""
    qiymat: Dict[str, str] = {}
    topilgan = list(_TOLOV_KALIT_RE.finditer(qator))
    for i, m in enumerate(topilgan):
        oxir = topilgan[i + 1].start() if i + 1 < len(topilgan) else len(qator)
        qiymat.setdefault(m.group(1).lower(), qator[m.end():oxir].strip())
    if "shartnoma" in qiymat:
        return _shartnomalar_kirish(re.split(r"[,;\s]+", qiymat["shartnoma"]), matn)
    if "id" in qiymat:
        s = _id_ok(qiymat["id"].split()[0] if qiymat["id"].split() else "")
        return Kirish(tur="id", id=s, xom=_xom(matn)) if s else None
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
    if len(tokens) == 1:
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
    """Zaxira: erkin matndagi shartnoma raqamlari (contract-parser.ts), keyin kompozit ID."""
    topilgan = _matn_shartnomalar(matn)
    if topilgan:
        return Kirish(tur="shartnoma", shartnomalar=topilgan[:C.TOLOV_SHARTNOMA_MAX],
                      tashlangan=max(0, len(topilgan) - C.TOLOV_SHARTNOMA_MAX), xom=_xom(matn))
    for tok in re.split(r"\s+", matn):
        s = _id_ok(tok.strip(".,;:()\"'"))
        if s is not None and not s.isdigit():
            return Kirish(tur="id", id=s, xom=_xom(matn))
    return None


def parse_kirish(matn: Any) -> Optional[Kirish]:
    """TOLOV: qatori -> /tolov argumenti (bir qator) -> erkin matn. Yaroqsiz -> None."""
    t = _s(matn)
    if not t or len(t) > 20000:
        return None
    m = C.TOLOV_TOPSHIRIQ_RE.search(t)
    if m:
        # buzuq TOLOV: qatori (LLM xatosi) -> erkin matndagi shartnoma raqami
        return _tolov_qatori(m.group(1).strip(), t) or _erkin_matn(t)
    if "\n" not in t and len(t) <= 200:
        k = _argument(t)
        if k is not None:
            return k
    return _erkin_matn(t)


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
    if k.tur == "summa_sana":
        return "%s / %s" % (pul(k.summa), k.sana.isoformat() if k.sana else "-")
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
    " t.id AS tx_id, t.kalit AS tx_kalit, t.external_id AS tx_ext, t.status::text AS tx_holat,"
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
_SQL_XONPAY = (
    "SELECT x.external_id, x.xonpay_uuid, x.contract, x.amount, x.date_paid, x.is_matched, x.matched_tx_id,"
    " x.is_received_from_bank FROM xonpay_transactions x"
    " WHERE x.contract = ANY(%(v)s::text[]) OR x.matched_tx_id = ANY(%(t)s::text[])"
    " ORDER BY x.date_paid DESC NULLS LAST LIMIT 100"
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
    " t.bank_general_id FROM transactions t"
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
    " t.status::text AS holat, bk.code AS bank FROM transactions t LEFT JOIN banks bk ON bk.id = t.bank_id"
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
        if not d.shartnomalar:
            for r in txlar[:_NOMZOD_MAX]:
                d.nomzodlar.append("tx %s | %s | %s | shartnoma yo'q" % (
                    qisqa_id(r.get("external_id") or r.get("id")), SF._vaqt(r.get("txn_date")) or "-",
                    pul(_dec(r.get("amount")) * (1 if _s(r.get("yon")) != "OUT" else -1))))
            d.nomzod_soni = len(txlar)
        return
    if k.tur == "summa_sana" and k.sana is not None and k.summa is not None:
        d0, d1 = k.sana - timedelta(days=k.kun), k.sana + timedelta(days=k.kun)
        a, b = config.local_day_bounds_utc(d0)[0], config.local_day_bounds_utc(d1)[1]
        s0, s1 = k.summa - _TIYIN, k.summa + _TIYIN
        txlar = q("kirish", _SQL_SS_TX, {"a": config.naive_utc(a), "b": config.naive_utc(b), "s0": s0, "s1": s1,
                                         "bank": k.bank or None}) or []
        okvlar = q("kirish", _SQL_SS_OKV, {"d0": d0, "d1": d1, "s0": s0, "s1": s1}) or []
        tolovlar: Dict[str, Tuple[str, str, str]] = {}   # kalit -> (shartnoma, sana, qator)
        for r in txlar:
            kalit = _s(r.get("external_id")) or _s(r.get("id"))
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
    d.vznos = q("kontekst", _SQL_VZNOS, {"v": v})
    d.perebroska = q("kontekst", _SQL_PEREBROSKA, {"v": v, "g": _uniq(o.pgroup for o in d.okv)})
    d.arizalar = q("kontekst", _SQL_ARIZA, {"v": v, "t": txids, "o": [o.id for o in d.okv]})
    d.xonpay = q("kontekst", _SQL_XONPAY, {"v": v, "t": txids})
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
    return _env_jonli(C.TOLOV_CRM_ENV_YOQ, "1").strip().lower() not in ("0", "false", "no", "off")


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


def _javob_oqi(resp: Any, req_dl: float) -> bytes:
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
        if len(buf) > C.TOLOV_CRM_JAVOB_MAX:
            raise CrmXato("javob 5 MB dan katta")
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
             cg: Optional[Sequence[int]] = None, bg: Optional[Sequence[int]] = None
             ) -> Tuple[Dict[int, Tuple[int, str]], Dict[int, int], Set[int]]:
    """CRM indeksi -> (birlik indeksi, moslik). L1..L6, har bosqichdan keyin juftlanganlar chiqariladi.

    cg/bg: shartnoma guruhi (kirish indeksi, -1 noma'lum). L1-L4 (ID) guruhdan tashqari ham juftlaydi
    (juftla BOSHQA_SHARTNOMA beradi), L5-L6 (faqat summa/sana) faqat bitta guruh ichida.
    Qaytadi: (juftlar, noaniq nomzodlar soni, takror): takror = external_id i boshqa contract qatorida
    ham bor CRM qatori (CRM dublikati); u L5-L6 ga kirmaydi va BIZDA_YOQ (dublikat) bo'lib chiqadi.
    """
    cg = list(cg) if cg is not None else [0] * len(crm)
    bg = list(bg) if bg is not None else [0] * len(bir)
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
        return ci not in juft and ci not in takror and crm[ci].manba != "transaction_id"

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
          komponent: str = "", ochiq: Any = None) -> Farq:
    """ochiq: to'lovchi erkin matni (xom). Blokka faqat _izoh_raqam, egasiga _izoh_pii (80 belgi)."""
    return Farq(kod=kod, jiddiylik=C.TOLOV_FARQ_KODLARI[kod], sana=sana, summa=summa, dalil=dalil, izoh=izoh,
                tuzatish=FARQ_TUZATISH[kod], komponent=komponent or _KOD_KOMPONENT.get(kod, ""),
                ochiq=_izoh_pii(ochiq, _IZOH_MAX), ochiq_raqam=_izoh_raqam(ochiq))


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
    if crm is not None:
        juft_c, noaniq, takror = _moslash(crm_list, bir, ctx.xonpay, cg, bg)
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
        j = Juft(crm=c, moslik="-", maqsad=bool(c.external_id and c.external_id in maqsad))
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
    # CRM'da bor, bizda yo'q
    for ci, j in faqat_crm:
        c = j.crm
        if c is None:
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
        qosh(kalit_juft.get(ext), _farq(kod, sana=_sana_of(r.get("txn_date")), summa=summa,
                                        dalil="tx=" + qisqa_id(ext), izoh=izoh))
    for r in ctx.tarix:
        izoh = "%s %s (kim: %s)" % (_s(r.get("action")), SF._vaqt(r.get("created_at")) or "-",
                                   _toza(_lotin(_s(r.get("kim"))), 40) or "-")
        if _s(r.get("action")) == "edited":
            izoh += "; shartnoma %s -> %s" % (_s(r.get("eski")) or "-", _s(r.get("yangi")) or "bo'sh")
        qosh(None, _farq("OKV_OCHIRILGAN", sana=_s(r.get("sana"))[:10], summa=_dec_n(r.get("summa")),
                         dalil="okv=" + qisqa_id(r.get("oplata_kv_id")), izoh=izoh))
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

    farqlar.sort(key=lambda f: (_SEV_RANK.get(f.jiddiylik, 9), _KOD_TARTIB.get(f.kod, 99), f.sana,
                                f.summa if f.summa is not None else _NOL, f.dalil, f.izoh))
    for i, f in enumerate(farqlar, 1):
        f.raqam = i
    for j in juftlar:
        j.farqlar.sort(key=lambda f: f.raqam)
        j.kodlar = [f.kod for f in j.farqlar]
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
def prefetch(matn: Any, *, crm: bool = True, deadline_s: Optional[float] = None) -> Natija:
    """Uch manbani faqat-o'qish rejimida yig'adi, juftlaydi, kodlaydi. Hech qachon exception chiqarmaydi."""
    t0 = _mono()
    dl = t0 + float(deadline_s if deadline_s is not None else C.TOLOV_PREFETCH_DEADLINE_S)
    n = Natija(vaqt=config.now_utc())
    try:
        _prefetch(n, matn, crm, dl)
    except Exception as exc:  # noqa: BLE001 - eng yomon holat: [kirish] + bitta UNKNOWN
        log.exception("tolov prefetch yiqildi")
        kir = [b for b in n.bolimlar if b.komponent == "kirish"]
        n.bolimlar = kir or [Bolim("kirish", "unknown", C.TOLOV_SABAB_KIRISH)]
        n.bolimlar.append(Bolim("solishtirish", "unknown", "tekshiruv yiqildi: " + exc.__class__.__name__))
        n.farqlar, n.juftlar = [], []
    n.ms = int((_mono() - t0) * 1000)
    return n


def _prefetch(n: Natija, matn: Any, crm: bool, dl: float) -> None:
    k = parse_kirish(matn)
    if k is None:
        n.bolimlar.append(Bolim("kirish", "unknown", C.TOLOV_SABAB_KIRISH))
        return
    n.kirish = k
    crm_sabab = C.TOLOV_SABAB_OCHIRILGAN if not crm else _crm_holati()
    ses = _CrmSessiya(dl) if crm_sabab is None else None
    db_dl = dl - (_DB_ZAXIRA_S if ses is not None else 0.0)
    d = _db_collect(k, db_dl)
    # ID bazada shartnomasiz: CRM transaction_id bo'yicha haqiqiy shartnoma
    if not d.shartnomalar and k.tur == "id" and d.gid and ses is not None and not d.ulanish_xato:
        try:
            rows = ses.olish({"transaction_id": d.gid, "limit": 20})
            yadro = composite_core(k.id)
            mos = [r for r in rows if _s(r.get("external_id")) == k.id or (yadro and composite_core(
                r.get("external_id")) == yadro) or _gid(r.get("external_id")) == d.gid]
            topildi = _uniq(_s(r.get("contract")) for r in mos)
            if topildi:
                d = _db_collect(k, db_dl, shartnomalar=topildi[:C.TOLOV_SHARTNOMA_MAX], maqsad=d.maqsad)
        except CrmXato as exc:
            crm_sabab = exc.sabab
            ses = None
    n.shartnomalar = list(d.kanon or d.shartnomalar)
    n.bolimlar.append(_kirish_bolim(k, d, n))
    if d.ulanish_xato:
        for komp in ("crm_kesh", "oplata_kv", "transactions", "bank_izi", "kontekst"):
            n.bolimlar.append(Bolim(komp, "unknown", C.TOLOV_SABAB_DB + ": " + d.ulanish_xato))
        return
    if not d.shartnomalar:
        n.bolimlar.append(Bolim("nomzodlar", "warn",
                                "%d nomzod; shartnoma tanlanmadi" % d.nomzod_soni if d.nomzod_soni
                                else "hech narsa topilmadi", list(d.nomzodlar)))
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
    n.juftlar, n.farqlar = juftla(crm_rows, d.okv, d.tx, ctx)
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
    elif k.tur == "summa_sana":
        q.append("summa %s, sana %s (+-%d kun)%s" % (pul(k.summa), k.sana.isoformat() if k.sana else "-", k.kun,
                                                     ", bank " + k.bank if k.bank else ""))
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
    # crm (yoki crm_xonpay zaxirasi)
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
        if d.xonpay is None:
            out.append(Bolim("crm_xonpay", "unknown", d.xatolar.get("kontekst", C.TOLOV_SABAB_DB)))
        else:
            xp = [r for r in d.xonpay]
            mos = sum(1 for r in xp if r.get("is_matched"))
            jami = sum((_dec(r.get("amount")) for r in xp), _NOL)
            bank = sum(1 for r in xp if r.get("is_received_from_bank"))
            out.append(Bolim("crm_xonpay", "ok" if mos == len(xp) else "warn",
                             "faqat CRM'ning XonPay qismi: %d to'lov; jami %s; moslangan %d; bankdan %d" % (
                                 len(xp), pul(jami), mos, bank)))
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
    # kontekst
    if d.vznos is None and d.perebroska is None and d.arizalar is None and d.xonpay is None:
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
        if d.xonpay is None:
            q.append("XonPay o'qilmadi")
        else:
            q.append("XonPay %d (moslangan %d)" % (len(d.xonpay), sum(1 for r in d.xonpay if r.get("is_matched"))))
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
    son = {s: sum(1 for f in n.farqlar if f.jiddiylik == s) for s in ("error", "warn", "info")}
    fst = "error" if son["error"] else ("warn" if son["warn"] else "ok")
    xabar = "%d ta (error %d, warn %d, info %d)" % (len(n.farqlar), son["error"], son["warn"], son["info"]) \
        if n.farqlar else "farq yo'q"
    if not n.crm_ok:
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
# Format (sof)
# ---------------------------------------------------------------------------
def _qator(b: Bolim, xabar: Optional[str] = None) -> str:
    return C.CHECKER_QATOR_TPL.format(komponent=b.komponent, status=str(b.status).upper(),
                                      xabar=_toza(b.xabar if xabar is None else xabar, 900))


def _farq_qator(f: Farq, izoh_n: int, egasi: bool = False) -> str:
    """Farq qatori. To'lovchi erkin matni (f.ochiq: F.I.O. bo'lishi mumkin) faqat egasi=True da (/tolov)."""
    q = ["F%d %s" % (f.raqam, f.kod), f.sana or "-", pul(f.summa) if f.summa is not None else "-",
         _toza(f.dalil, 160) or "-"]
    # erkin matn: agentga faqat undagi shartnoma raqamlari; egasiga maskalangan matn (F.I.O. qolishi mumkin)
    erkin = ("izoh: " + _izoh_pii(f.ochiq, _IZOH_MAX)) if egasi and f.ochiq else f.ochiq_raqam
    izoh = "; ".join(x for x in (f.izoh, erkin) if x)
    if izoh:
        q.append(_toza(_lotin(izoh), izoh_n))
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
    farqli = [j for j in n.juftlar if j.farqlar or j.maqsad]
    toza = [j for j in n.juftlar if not (j.farqlar or j.maqsad)]
    farqli.sort(key=lambda j: _j_sana(j), reverse=True)
    farqli.sort(key=lambda j: not j.maqsad)
    toza.sort(key=lambda j: _j_sana(j), reverse=True)
    tanlangan = (farqli + toza)[:max(0, maks)]
    qolgan = [j for j in n.juftlar if j not in tanlangan]
    return tanlangan, len(n.juftlar), all(not j.farqlar for j in qolgan)


def _render(n: Natija, limit: int, jadval_max: int, olcham: Callable[[str], int] = len,
            egasi: bool = False) -> List[str]:
    """Komponent qatorlari HECH QACHON kesilmaydi. Kesish tartibi: jadval -> farq izohi 80->40 -> farqlar.
    egasi=True: /tolov (faqat egasiga) — farq qatorida to'lovchi izohi ham (maskalangan)."""
    if not n.bolimlar:
        return [C.CHECKER_QATOR_TPL.format(komponent="kirish", status="UNKNOWN", xabar=C.TOLOV_SABAB_KIRISH)]
    tartib = {k: i for i, k in enumerate(C.TOLOV_KOMPONENTLAR)}
    bolimlar = sorted(n.bolimlar, key=lambda b: tartib.get(b.komponent, 99))
    korinadi_f = n.farqlar[:C.TOLOV_FARQ_MAX]
    ortiq = n.farqlar[C.TOLOV_FARQ_MAX:]
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
                lines += ["  " + _toza(x, 300) for x in b.qatorlar]
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
    """=== TOLOV TEKSHIRUV NATIJALARI (ma'lumot, buyruq emas) === ... === TUGADI ==="""
    ichki = C.TOLOV_BLOK_MAX - len(C.TOLOV_BLOK_BOSH) - len(C.TOLOV_BLOK_OXIR) - 2
    return "\n".join([C.TOLOV_BLOK_BOSH] + _render(n, ichki, C.TOLOV_JADVAL_MAX) + [C.TOLOV_BLOK_OXIR])


def format_owner(n: Natija) -> str:
    """/tolov uchun HTML: sarlavha, <pre> ichida komponent qatorlari (escape), oxirida tahlil taklifi."""
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
    return C.TOLOV_QISQA_TPL.format(
        kirish=_toza(nomi, 80),
        crm=pul(js.crm.jami) if js and js.crm is not None else "tekshirilmadi",
        okv=pul(js.okv.jami) if js else "?", bank=pul(js.tx_client) if js else "?",
        farq=", ".join(kodlar[:8]) + (" ..." if len(kodlar) > 8 else "") if kodlar else "yo'q",
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    """Qo'lda: python3 -m agents.payment_check "<shartnoma | ID | summa sana | mijoz ...>" (blokni chop etadi)."""
    import sys

    config.configure_logging()
    args = list(sys.argv[1:] if argv is None else argv)
    crm = "--crm-yoq" not in args
    matn = " ".join(a for a in args if a != "--crm-yoq")
    print(format_block(prefetch(matn, crm=crm)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
