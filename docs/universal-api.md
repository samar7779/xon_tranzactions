# Universal API — to'liq yo'riqnoma

**Xon Saroy Tranzaksiyalar tizimi · Developer API v1**
Manba: `https://transactions.xonapps.uz`
Hujjat yangilangan: 2026-09-24

---

## 1. Bu nima

Universal API — tashqi tizim (1C, ERP, BI, Excel, o'z dasturingiz) uchun **bitta kalit bilan uchta asosiy hisobot**:

| Qoida | Nima beradi | Endpoint |
|---|---|---|
| **1** | Obyektlar bo'yicha to'lovlar — sana/oraliq va barcha filtrlar bilan, shartnoma kesimigacha | `/universal/objects`, `/objects/contracts`, `/objects/payments` |
| **2** | Bank hisoblari va qoldiqlar | `/universal/accounts` |
| **3** | Vipiska — hisob bo'yicha tranzaksiyalar | `/universal/statement` |

Qo'shimcha: `/universal/filters` — filtr qurish uchun tayyor ro'yxatlar.

**Muhim:** API faqat **o'qiydi**. Hech qanday yozish, o'chirish yoki o'zgartirish amali yo'q.
Bank login/paroli, API credentials va shaxsiy hujjat ma'lumotlari **hech qachon qaytarilmaydi**.

---

## 2. Kalit olish

1. Panelga admin sifatida kiring → **Admin paneli → Developer API**.
2. **"+ Yangi API kalit"** tugmasi.
3. Oynada:
   - **Nom** — majburiy (masalan `1C Integration`).
   - **Tavsif** — ixtiyoriy, qayerda ishlatilishi.
   - **Ruxsatlar (scope)** — **"Universal — o'qish"** ni belgilang. Faqat shu bitta belgi yetarli: uchala qoida ham ochiladi.
   - **Muddat** — `Cheksiz`, `N kun keyin` yoki `Aniq sana`.
   - **IP whitelist** — ixtiyoriy. Bo'sh qoldirilsa, **har qanday IP'dan** kirish mumkin. Yozilsa, faqat o'sha IP'lar ruxsat etiladi (vergul bilan ajrating).
4. **"Yaratish"**.

> ⚠️ **Secret faqat bir marta ko'rsatiladi.** Oynani yopganingizdan keyin uni qayta ko'rib bo'lmaydi. Nusxalab, xavfsiz joyga saqlang. Yo'qolsa — yangi kalit yaratishdan boshqa yo'l yo'q.

Kalit ikki qismdan iborat:

| Qism | Ko'rinishi | Qayerda |
|---|---|---|
| **Key ID** | `xk_live_...` | ochiq, ro'yxatda ham ko'rinadi |
| **Secret** | `xs_live_...` | maxfiy, faqat yaratishda ko'rsatiladi |

Kalitni keyinchalik ro'yxatdagi **qalam** tugmasi orqali **tahrirlash** (nom, tavsif, scope, muddat, IP whitelist) yoki **bekor qilish** (deaktivatsiya) mumkin. Secret esa tahrirlanmaydi va qayta ko'rsatilmaydi.

---

## 3. Ulanish

Har bir so'rovga **ikkita sarlavha** qo'shiladi:

```
X-API-Key:    xk_live_...
X-API-Secret: xs_live_...
```

**Asosiy manzil:**

```
https://transactions.xonapps.uz/api/v1/universal
```

**Birinchi tekshiruv** — kalit ishlayaptimi:

```bash
curl -s "https://transactions.xonapps.uz/api/v1/_whoami" \
  -H "X-API-Key: xk_live_..." \
  -H "X-API-Secret: xs_live_..."
```

Javobda kalit nomi, scope'lari va sizning IP'ingiz qaytadi.

### Panel ichidagi sinov maydoni

Kod yozmasdan sinab ko'rish uchun: **Developer API → 📖 (kitob ikonkasi)** yoki to'g'ridan-to'g'ri `https://transactions.xonapps.uz/uz/api`.

U yerda:
- chap tomonda barcha endpoint'lar, **"UNIVERSAL (3 QOIDA)"** bo'limi bilan;
- o'rtada parametrlarni to'ldirib **"Ishga tushirish"**;
- o'ng tomonda javob va **cURL / Node.js / PHP / Python** uchun tayyor kod.

> ⚠️ Bu manzillar **HTTP so'rov**, terminal buyrug'i emas. `GET /universal/objects` ni to'g'ridan-to'g'ri serverning shell'iga yozmang — aks holda `Command 'GET' not found` chiqadi. Ularni brauzerga, Postman'ga yoki yuqoridagi `curl` ichiga qo'ying.

---

## 4. Umumiy qoidalar

### Sana

- Format: **`YYYY-MM-DD`** (masalan `2026-09-24`). Boshqa format `400` xatosi beradi.
- `date=2026-09-24` — **bitta kun**. Berilsa, `dateFrom`/`dateTo` e'tiborga olinmaydi.
- `dateFrom` va `dateTo` — oraliq, **ikkala chegara ham kiradi**.
- Sana berilmasa — **butun tarix** olinadi. Katta hajmda sekin ishlaydi, shuning uchun oraliq berish tavsiya etiladi.

**Vaqt mintaqasi bo'yicha nozik farq:**

| Endpoint | Qanday hisoblanadi |
|---|---|
| `objects`, `objects/contracts`, `objects/payments` | To'lov sanasi bazada **vaqtsiz kalendar sana** sifatida saqlanadi. Vaqt mintaqasi masalasi yo'q — `2026-09-24` aynan o'sha kun |
| `statement` | Tranzaksiya sanasi vaqt bilan saqlanadi. Kun chegarasi **Toshkent (+05:00)** bo'yicha: `00:00:00+05:00` dan `23:59:59.999+05:00` gacha |

Javobdagi sanalar UTC ko'rinishida (`...Z`) qaytadi — masalan `2026-09-24T03:50:05.000Z` Toshkent vaqti bilan `08:50:05`. Shuning uchun `statement` javobida alohida `time` maydoni ham bor.

### Ro'yxat parametrlar

Bir nechta qiymat **vergul** bilan ajratiladi, bo'shliqsiz:

```
crmStatuses=Сотилди,Бартер
banks=cmf1a2b3...,cmf9x8y7...
```

Bo'sh (to'ldirilmagan) qiymatni tanlash uchun maxsus so'z: **`__none__`**

```
branches=__none__          # sotuv bo'limi ko'rsatilmagan shartnomalar
banks=__none__             # bankka bog'lanmagan to'lovlar (import / qo'lda)
```

### Mantiqiy parametrlar

`1`, `true` yoki `yes` — yoqilgan. Boshqa har qanday qiymat yoki yo'qligi — o'chirilgan.

### Javob konverti

Har bir muvaffaqiyatli javob `ok: true` bilan boshlanadi:

```json
{
  "ok": true,
  "filter": { "...": "qaysi filtr qo'llanilgani" },
  "total":  { "...": "jamlar" },
  "items":  [ "...qatorlar" ]
}
```

`filter` maydoni — server qanday tushunganini ko'rsatadi. Nosozlikni topishda birinchi shu yerga qarang.

### Xatolar

| Kod | Ma'nosi | Sabab va yechim |
|---|---|---|
| `400` | Noto'g'ri so'rov | Sana formati buzuq, yoki `statement` da `account`/`bank` berilmagan |
| `401` | Autentifikatsiya | Kalit yoki secret yo'q/noto'g'ri, kalit bekor qilingan, muddati o'tgan, IP ruxsat etilmagan |
| `403` | Scope yetishmaydi | Kalitda `universal:read` yo'q. Xato matnida kalitdagi mavjud scope'lar yoziladi |
| `404` | Topilmadi | Manzil noto'g'ri yozilgan |

`401` xatolarining aniq matnlari: *"API kaliti yoki secret yetishmayapti"*, *"Noto'g'ri kalit formati"*, *"API kalit topilmadi yoki noto'g'ri"*, *"API kalit faol emas (bekor qilingan)"*, *"API kalit muddati o'tgan"*, *"Noto'g'ri secret"*, *"IP ruxsat etilmagan: 1.2.3.4"*.

### So'rovlar tarixi

Har bir so'rov tizimda yoziladi: qaysi kalit, qaysi manzil, qachon, qaysi IP. Buni **Developer API** sahifasida ko'rishingiz mumkin (so'rovlar soni, oxirgi ishlatilgan vaqt).

---

## 5. 1-QOIDA — Obyektlar bo'yicha to'lovlar

Bosh sahifadagi **"Obyektlar bo'yicha to'lovlar"** jadvali bilan **aynan bir xil** ma'lumot. Manba — ОплатыКв (kvartira to'lovlari).

### 5.1. `GET /universal/objects`

Obyekt kesimidagi jamlar.

**Parametrlar**

| Parametr | Qiymat | Izoh |
|---|---|---|
| `date` | `2026-09-24` | bitta kun |
| `dateFrom` | `2026-09-01` | oraliq boshi |
| `dateTo` | `2026-09-24` | oraliq oxiri |
| `mode` | `normal` (standart) / `refund` | `normal` — oddiy to'lovlar; `refund` — qaytarilganlar (Возврат) |
| `includeSchotchik` | `1` | "За счётчик" to'lovlarini ham qo'shadi |
| `banks` | bank **id**, vergul bilan | `__none__` — bankka bog'lanmaganlar |
| `propertyTypes` | `apartment`, `parking` | Тип (жилой / парковка) |
| `crmStatuses` | CRM status nomlari | `__none__` — statussizlar |
| `branches` | sotuv bo'limi nomlari | `__none__` — bo'limi ko'rsatilmaganlar |
| `withContracts` | `1` | har obyekt ichida shartnomalar kesimini ham qaytaradi |

> `banks` uchun **bank id** kerak (kod emas). Id'larni `/universal/filters` dan oling.

**Javob**

```json
{
  "ok": true,
  "filter": { "dateFrom": "2026-09-01", "dateTo": "2026-09-24", "mode": "normal",
              "includeSchotchik": false, "banks": null },
  "total": { "paymentAmount": 85166256182.53, "firstInstallment": 33829824739,
             "monthlyAmount": 50178721943.53, "count": 1842 },
  "items": [
    { "object": "ОИЛА", "paymentAmount": 26661302587.56,
      "firstInstallment": 9981174541, "monthlyAmount": 16680128046.56, "count": 412 }
  ]
}
```

| Maydon | Ma'nosi |
|---|---|
| `object` | obyekt nomi. `—` — obyekt biriktirilmagan to'lovlar |
| `paymentAmount` | Сумма оплаты — umumiy summa |
| `firstInstallment` | 1 взнос — boshlang'ich to'lov ulushi |
| `monthlyAmount` | ежемесячный — oylik to'lov ulushi |
| `count` | to'lovlar soni |

`withContracts=1` bo'lsa, har bir `items[]` ichida qo'shimcha:

```json
"contracts": [
  { "contractNo": "310ORZ22GX", "client": "Мустафаева Мафтуна",
    "paymentAmount": 326418000, "firstInstallment": 65300000,
    "monthlyAmount": 261118000, "count": 133 }
]
```

**Misol**

```
GET /api/v1/universal/objects?dateFrom=2026-09-01&dateTo=2026-09-24&withContracts=1
GET /api/v1/universal/objects?date=2026-09-24&mode=refund
GET /api/v1/universal/objects?dateFrom=2026-01-01&dateTo=2026-09-24&propertyTypes=parking
```

### 5.2. `GET /universal/objects/contracts`

**"Bu to'lovlar qaysi shartnomalardan tushgan?"** — shu savolga javob.

Filtrlar `5.1` bilan bir xil, ustiga:

| Parametr | Izoh |
|---|---|
| `object` | faqat shu obyekt (nomi aynan, `/filters` dagidek). `—` — obyektsizlar. Bo'sh qoldirilsa yoki `__ALL__` — hammasi |

**Javob**

```json
{
  "ok": true,
  "total": { "paymentAmount": 85166256182.53, "count": 1842 },
  "items": [
    { "object": "ОИЛА", "contractNo": "310ORZ22GX", "client": "Мустафаева Мафтуна",
      "paymentAmount": 326418000, "firstInstallment": 65300000,
      "monthlyAmount": 261118000, "count": 133 }
  ]
}
```

Qatorlar obyekt nomi bo'yicha, keyin summa kamayishi bo'yicha tartiblangan.

### 5.3. `GET /universal/objects/payments`

Har bir to'lov **alohida qator** bo'lib qaytadi (drill-down).

Filtrlar `5.2` bilan bir xil.

**Javob**

```json
{
  "ok": true,
  "count": 412,
  "truncated": false,
  "total": { "paymentAmount": 26661302587.56, "firstInstallment": 9981174541,
             "monthlyAmount": 16680128046.56 },
  "items": [
    { "id": "cmf...", "contractNo": "310ORZ22GX", "client": "Мустафаева Мафтуна",
      "object": "ОИЛА", "date": "2026-09-24T00:00:00.000Z",
      "paymentAmount": 2200000, "firstInstallment": null, "monthlyAmount": 2200000,
      "paymentCategory": "MONTHLY", "txType": "Взносы за квартиры",
      "purpose": "...", "paymentMethod": "Банк" }
  ]
}
```

| Maydon | Ma'nosi |
|---|---|
| `count` | filtrga mos **umumiy** soni |
| `truncated` | `true` bo'lsa — qatorlar cheklangan (bir so'rovda **5000** tagacha) |
| `paymentCategory` | `FIRST` (1 взнос), `MONTHLY` (oylik), `GENERAL` yoki `null` |
| `date` | to'lov sanasi (vaqtsiz) |

> `truncated: true` bo'lsa, sana oralig'ini kichraytiring yoki obyekt bo'yicha bo'lib oling.

### 5.4. Filtrlar qanday ishlaydi

**`mode=normal`** (standart): summasi **musbat** va turi "взнос" bo'lgan to'lovlar. "Взнос от имени клиента" (boshqa odam nomidan to'langan) **kirmaydi**.

**`mode=refund`**: summasi **manfiy** va turi "возврат" bilan boshlanadigan to'lovlar. Summalar manfiy bo'lib qaytadi.

**`includeSchotchik=1`**: yuqoridagiga qo'shimcha "За счётчик" to'lovlari ham qo'shiladi.

**`banks`**: ОплатыКв jadvalida bank ustuni yo'q — bank to'lov bog'langan **tranzaksiya** orqali aniqlanadi. Excel'dan import qilingan yoki qo'lda kiritilgan to'lovlarning banki yo'q, ular `__none__` ostiga tushadi.

**`crmStatuses`, `propertyTypes`, `branches`**: bular ОплатыКв'dan emas, **CRM shartnomasidan** olinadi (shartnoma raqami orqali). CRM'da topilmagan shartnomalar bu filtrlarga tushmaydi.

---

## 6. 2-QOIDA — Bank hisoblari va qoldiqlar

### `GET /universal/accounts`

**Parametrlar**

| Parametr | Qiymat | Izoh |
|---|---|---|
| `bank` | bank **kodi yoki id**, vergul bilan | `HAMKORBANK`, `KAPITALBANK`, `IPAK_YULI` |
| `allBanks` | `1` | nofaol banklarni ham qo'shadi |
| `syncOnly` | `1` | faqat avtomatik yangilanadigan hisoblar |
| `q` | matn | hisob raqami yoki egasi bo'yicha qidiruv |

> Standart holda **faqat faol banklar** qaytadi. Bu 2-qoidaning asosiy talabi edi.

**Javob**

```json
{
  "ok": true,
  "total": { "accounts": 155, "balance": 3099776493.49, "syncEnabled": 70 },
  "banks": [
    { "code": "HAMKORBANK", "name": "Hamkorbank", "count": 14, "balance": 1204512197 }
  ],
  "items": [
    { "id": "cmf...", "accountNo": "20208000305409155002", "branch": "00083",
      "ownerName": "VATAN RESIDENCE MCHJ", "currency": "UZS",
      "balance": 746012197, "syncEnabled": true,
      "lastSyncedAt": "2026-09-24T05:00:00.000Z",
      "bank": { "id": "cmf...", "code": "HAMKORBANK", "name": "Hamkorbank", "isActive": true } }
  ]
}
```

| Maydon | Ma'nosi |
|---|---|
| `total.balance` | tanlangan hisoblarning **umumiy qoldig'i** |
| `total.syncEnabled` | nechtasida avtomatik yangilanish yoqilgan |
| `banks[]` | bank kesimi: hisoblar soni va qoldiq yig'indisi |
| `lastSyncedAt` | qoldiq oxirgi marta bankdan qachon olingani |

**Misol**

```
GET /api/v1/universal/accounts
GET /api/v1/universal/accounts?bank=HAMKORBANK
GET /api/v1/universal/accounts?syncOnly=1
GET /api/v1/universal/accounts?q=VATAN
```

> Login, parol, API kalit va boshqa bank credentials **hech qachon** qaytarilmaydi.

---

## 7. 3-QOIDA — Vipiska

### `GET /universal/statement`

**Majburiy:** `account` **yoki** `bank` (ikkalasidan biri). Bo'lmasa `400` xatosi.

| Parametr | Qiymat | Izoh |
|---|---|---|
| `account` | hisob raqami yoki id | `20208000305409155002` |
| `bank` | bank kodi yoki id | o'sha bankning **barcha** hisoblari |
| `date` | `YYYY-MM-DD` | bitta kun |
| `dateFrom` / `dateTo` | `YYYY-MM-DD` | oraliq |
| `direction` | `IN` / `OUT` | kirim yoki chiqim |
| `q` | matn | izoh, yuboruvchi/qabul qiluvchi nomi, shartnoma bo'yicha qidiruv |
| `contractNo` | shartnoma raqami | aniq shartnoma bo'yicha |
| `minAmount` / `maxAmount` | son | summa oralig'i |
| `limit` | son | standart `1000`, eng ko'pi `5000` |
| `offset` | son | sahifalash uchun nechtasini o'tkazib yuborish |

**Javob**

```json
{
  "ok": true,
  "filter": { "account": "20208000305409155002", "bank": null,
              "dateFrom": "2026-09-01", "dateTo": "2026-09-24", "direction": null },
  "total": { "count": 361, "kirim": 2603045726, "chiqim": 2730082400,
             "sof": -127036674, "kirimSoni": 353, "chiqimSoni": 8 },
  "page": { "limit": 1000, "offset": 0, "returned": 361 },
  "items": [
    {
      "id": "cmuf07f0x0c9812ot7b8t5erf",
      "externalId": "HB_12916021974_673978874_24.09.2026 08:5...",
      "date": "2026-09-24T03:50:05.000Z",
      "time": "08:50:05",
      "valueDate": "2026-09-24T12:00:00.000Z",
      "direction": "IN",
      "amount": 7000000,
      "currency": "UZS",
      "status": "COMPLETED",
      "docNumber": "634336554",
      "purposeCode": "00111",
      "description": "00111ПК 5614*4261 ... шартнома ракам № 807VTN24D1 ...",
      "from": { "name": "XONSAROY PAYMENTS", "account": "29896...", "inn": "309334946", "mfo": "00083" },
      "to":   { "name": "VATAN RESIDENCE", "account": "20208...", "inn": "308622786", "mfo": "00083" },
      "contractNo": "807VTN24D1",
      "bank": { "code": "HAMKORBANK", "name": "Hamkorbank" },
      "account": { "accountNo": "20208000305409155002", "ownerName": "VATAN RESIDENCE MCHJ" },
      "category": { "code": "CLIENT", "name": "Клиент / Физ.Л / Юр.Л" },
      "subcategory": { "code": "VZNOS_KV", "name": "Взносы за квартиры" },
      "taminot": null
    }
  ]
}
```

| Maydon | Ma'nosi |
|---|---|
| `total.kirim` / `chiqim` | davr bo'yicha kirim va chiqim yig'indisi |
| `total.sof` | sof oqim (kirim − chiqim), manfiy bo'lishi mumkin |
| `page.returned` | shu javobda nechta qator qaytgani |
| `time` | bank hujjatidagi vaqt (`HH:mm:ss`). Ba'zi eski yozuvlarda `null` |
| `valueDate` | mablag' sanasi (bank `vdate`) |
| `status` | `COMPLETED`, `PENDING`, `CANCELLED` |
| `contractNo` | topilgan mijoz shartnomasi (bo'lmasa `null`) |
| `taminot` | ta'minot ERP'dan moslangan ma'lumot: yetkazib beruvchi, xarajat moddasi, shartnoma, obyekt. Bog'lanmagan bo'lsa `null` |

**Sahifalash**

```
GET /universal/statement?account=...&dateFrom=...&dateTo=...&limit=1000&offset=0
GET /universal/statement?account=...&dateFrom=...&dateTo=...&limit=1000&offset=1000
```

`total.count` — umumiy soni. `offset` ni `limit` qadar oshirib boring, `returned` nolga tushguncha.

---

## 8. Filtr qiymatlari

### `GET /universal/filters`

Filtr qurish uchun tayyor ro'yxatlar. Parametr kerak emas.

```json
{
  "ok": true,
  "banks": [ { "id": "cmf...", "code": "HAMKORBANK", "name": "Hamkorbank" },
             { "id": "__none__", "code": "__none__", "name": "Bank yo'q (import / qo'lda)" } ],
  "objects": ["АФСОНА", "Бахор", "ВАТАН", "..."],
  "branches": ["MegaTower", "Орзулар", "..."],
  "crmStatuses": ["Сотилди", "Бартер", "Реинвестиция", "..."],
  "propertyTypes": [ { "value": "apartment", "label": "Жилой" },
                     { "value": "parking",   "label": "Парковка" } ],
  "modes": [ { "value": "normal", "label": "Oddiy (взнос to'lovlari)" },
             { "value": "refund", "label": "Возврат (qaytarilganlar)" } ]
}
```

> `banks[].id` — aynan shu id'lar `objects`, `objects/contracts` va `objects/payments` dagi `banks=` parametriga beriladi.
> `objects[]`, `branches[]`, `crmStatuses[]` esa mos parametrlarga **nomi bilan** beriladi (id emas).

---

## 9. Kod misollari

Misollardagi `xk_live_...` va `xs_live_...` o'rniga o'z kalitlaringizni qo'ying.

> Kalitni kod ichiga yozib qo'ymang — muhit o'zgaruvchisida (`XON_KEY`, `XON_SECRET`) saqlang va git'ga tushirmang.

### cURL

```bash
curl -s "https://transactions.xonapps.uz/api/v1/universal/objects?dateFrom=2026-09-01&dateTo=2026-09-24&withContracts=1" \
  -H "X-API-Key: xk_live_..." \
  -H "X-API-Secret: xs_live_..."
```

### Node.js

```js
const BASE = 'https://transactions.xonapps.uz/api/v1/universal';
const headers = {
  'X-API-Key': process.env.XON_KEY,
  'X-API-Secret': process.env.XON_SECRET,
};

async function objects(dateFrom, dateTo) {
  const url = `${BASE}/objects?dateFrom=${dateFrom}&dateTo=${dateTo}&withContracts=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const data = await objects('2026-09-01', '2026-09-24');
for (const o of data.items) {
  console.log(o.object, o.paymentAmount, o.contracts?.length ?? 0, 'shartnoma');
}
```

### Python

```python
import requests

BASE = "https://transactions.xonapps.uz/api/v1/universal"
H = {"X-API-Key": "xk_live_...", "X-API-Secret": "xs_live_..."}

r = requests.get(f"{BASE}/accounts", headers=H, params={"bank": "HAMKORBANK"}, timeout=60)
r.raise_for_status()
d = r.json()

print("Jami qoldiq:", d["total"]["balance"])
for a in d["items"]:
    print(a["accountNo"], a["ownerName"], a["balance"])
```

### PHP

```php
$ch = curl_init("https://transactions.xonapps.uz/api/v1/universal/statement"
    . "?account=20208000305409155002&dateFrom=2026-09-01&dateTo=2026-09-24");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'X-API-Key: xk_live_...',
        'X-API-Secret: xs_live_...',
    ],
]);
$data = json_decode(curl_exec($ch), true);
curl_close($ch);

echo "Kirim: {$data['total']['kirim']}, Chiqim: {$data['total']['chiqim']}\n";
```

### Sahifalab to'liq yuklab olish (Python)

```python
items, offset = [], 0
while True:
    r = requests.get(f"{BASE}/statement", headers=H, timeout=120, params={
        "account": "20208000305409155002",
        "dateFrom": "2026-01-01", "dateTo": "2026-09-24",
        "limit": 5000, "offset": offset,
    })
    d = r.json()
    items += d["items"]
    if d["page"]["returned"] < 5000:
        break
    offset += 5000
print(len(items), "qator")
```

---

## 10. Amaliy stsenariylar

**Kunlik tushum hisoboti**

```
GET /universal/objects?date=2026-09-24
```

**Oylik hisobot, obyekt va shartnoma kesimida**

```
GET /universal/objects?dateFrom=2026-09-01&dateTo=2026-09-30&withContracts=1
```

**Faqat parkovka to'lovlari**

```
GET /universal/objects?dateFrom=2026-09-01&dateTo=2026-09-30&propertyTypes=parking
```

**Qaytarilgan to'lovlar (Возврат) ro'yxati**

```
GET /universal/objects/payments?dateFrom=2026-09-01&dateTo=2026-09-30&mode=refund
```

**Bitta obyektning barcha to'lovlari**

```
GET /universal/objects/payments?object=ОИЛА&dateFrom=2026-01-01&dateTo=2026-09-24
```

**Bir bank bo'yicha kelgan to'lovlar**

```
GET /universal/filters                      → bank id ni oling
GET /universal/objects?dateFrom=...&banks=<bank_id>
```

**Barcha hisoblar qoldig'i (kunlik saldo)**

```
GET /universal/accounts
```

**Shartnoma bo'yicha bank tranzaksiyalari**

```
GET /universal/statement?bank=HAMKORBANK&dateFrom=2026-01-01&dateTo=2026-09-24&contractNo=807VTN24D1
```

**Faqat chiqimlar, 100 mln dan katta**

```
GET /universal/statement?account=...&dateFrom=...&direction=OUT&minAmount=100000000
```

---

## 11. Cheklovlar va nozikliklar

1. **Faqat o'qish.** Yozish endpoint'lari yo'q va rejada ham yo'q.
2. **Hech qachon qaytarilmaydi:** bank login/paroli, API credentials, foydalanuvchi parollari, shaxsiy hujjat ma'lumotlari.
3. **`objects/payments` bir so'rovda 5000 qator.** Ko'proq bo'lsa `truncated: true` bo'ladi — oraliqni kichraytiring.
4. **`statement` bir so'rovda 5000 qator** (`limit` maksimumi). Qolganini `offset` bilan oling.
5. **Sana berilmasa butun tarix olinadi** — katta hajmda sekin. Har doim oraliq bering.
6. **`banks` parametri obyekt endpoint'larida bank ID kutadi**, `accounts`/`statement` da esa **kod ham, id ham** bo'ladi. Id'ni `/filters` dan oling.
7. **CRM filtrlari** (`crmStatuses`, `propertyTypes`, `branches`) CRM'da tasdiqlangan shartnomalarga tegishli. CRM'da topilmagan shartnoma bu filtrlarga tushmaydi.
8. **Obyekt `—`** — obyekt biriktirilmagan to'lovlar. Filtrda ham xuddi shu belgi ishlatiladi.
9. **Vaqt mintaqasi** — `statement` da kun chegarasi Toshkent (+05:00) bo'yicha hisoblanadi; obyekt endpoint'larida to'lov sanasi vaqtsiz kalendar sana, mintaqa ta'sir qilmaydi. Javobdagi sanalar har doim UTC ko'rinishida (`Z` bilan) qaytadi.
10. **Ba'zi eski tranzaksiyalarda `time` bo'sh** — bank o'sha yozuvda vaqt yubormagan.
11. **IP whitelist** yoqilgan bo'lsa, serveringiz IP'si o'zgarganda `401` chiqadi — kalit sozlamasidan yangilang.

---

## 12. Tez-tez uchraydigan xatolar

| Muammo | Sabab | Yechim |
|---|---|---|
| `401 API kaliti yoki secret yetishmayapti` | Sarlavhalar yuborilmagan | `X-API-Key` va `X-API-Secret` ni qo'shing |
| `401 Noto'g'ri kalit formati` | Key `xk_` bilan, secret `xs_` bilan boshlanmagan | Qiymatlarni almashtirib yubormaganingizni tekshiring |
| `401 IP ruxsat etilmagan` | Kalitda IP whitelist bor | Kalit sozlamasiga serveringiz IP'sini qo'shing yoki ro'yxatni bo'shating |
| `403 Bu endpoint uchun scope kerak` | Kalitda `universal:read` yo'q | Yangi kalit yarating yoki mavjudini tahrirlab scope qo'shing |
| `400 Sana formati YYYY-MM-DD bo'lishi kerak` | `24.09.2026` kabi format | `2026-09-24` ko'rinishiga o'tkazing |
| `400 account yoki bank berilishi kerak` | `statement` da ikkalasi ham yo'q | Bittasini bering |
| Javob bo'sh (`items: []`) | Filtr juda tor yoki sana oralig'ida to'lov yo'q | `filter` maydonini tekshiring — server sizning parametrni qanday tushunganini ko'rsatadi |
| Summalar panel bilan mos kelmayapti | Filtrlar boshqacha | `mode`, `includeSchotchik` va sana oralig'ini panel bilan solishtiring |

---

## 13. Yordam

- **Sinov maydoni:** `https://transactions.xonapps.uz/uz/api` — barcha endpoint'lar, parametr izohlari va tayyor kod (cURL / Node.js / PHP / Python).
- **Kalitlarni boshqarish:** Admin paneli → Developer API.
- **Kalit yo'qolsa:** eskisini bekor qiling va yangisini yarating.
