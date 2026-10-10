# agents/knowledge/ — bilim bazasi

Bu papka Xon Tranzaksiyalar loyihasining ichki dasturchi-agentlari (Leader, Support, Checker, Teacher) uchun statik bilim bazasi. Git'da yuritiladi, deploy bilan yangilanadi. Har fayl bitta modul yoki bitta mavzuga bag'ishlangan.

Agent topshiriq olsa, avval `agents/memory/INDEX.md` xaritasidan mos faylni topadi. Keyin Grep tool bilan `^## ` bo'limlarini qidiradi va Read offset/limit bilan faqat kerakli qismni o'qiydi. Bu fayllar system prompt'ga avtomatik qo'shilmaydi: o'qilmasa, agent ularni bilmaydi.

## Fayllar ro'yxati

### Umumiy fayllar (har loyihada bo'ladi)
- `imkoniyatlar.md` — agent nima qila oladi va nima qila olmaydi: asboblar, Facts kalitlari, bot handlerlari, kod o'zgartirish oqimi. Prompt bilan zid kelsa, shu fayl to'g'ri.
- `agentlar.md` — agentlar tizimining o'zi: Leader bot, runner, Support, Checker, Teacher, Facts (bot jarayoni ichida, alohida cron yo'q). Modul fayli tuzilmasida yoziladi.
- `db_schema.md` — yagona `xon_tranzactions` baza: jadvallar, ustunlar, Prisma model va SQL jadval nomlari, adashtiriladigan nomlar. SQL yozishdan oldin majburiy tekshiruv.
- `qoidalar.md` — egasi bilan ishlash, kod qoidalari (TypeScript, `tsc`, lokal `npm run build`), biznes qoidalar, taqiqlar.
- `CHANGELOG.md` — modul bo'yicha o'zgarishlar tarixi, egasi qarorlari va rad etilganlar, takrorlangan xatolar.
- `tizim.md` — butun tizim xaritasi (2026-10-10, butun repo o'qib yozilgan): A platforma va server, B banklar va tranzaksiyalar, C OplatyKv va CRM, D XATO va agent backendlari, E web panel (har sahifa), F agentlar boti, G atamalar, H ochiq xavflar. Katta fayl: "Qayerda nima" jadvalidan bo'limni top, faqat o'sha `^### ` ni o'qi. Modul fayli bilan zid kelsa, modul fayli to'g'ri.
- `platforma.md` — web ilova asosi: route'lar, login va rollar, audit, deploy, systemd servislar, `.env` kalit nomlari.

### Modul fayllari
INDEX "Modullar xaritasi" jadvalidagi har modul uchun bitta fayl:
- `tranzaksiyalar.md` — bank tranzaksiyalari: ro'yxat, statistika, vipiska, ID inspektor, kategoriyalash, kontragentlar va ta'minot ERP moslash, eski billing.
- `sync.md` — banklar, hisoblar, ulanishlar, bank API sync, vipiska importlari, bank tomonda o'zgargan yoki ko'chgan to'lovlar, bank paroli.
- `oplata_kv.md` — OplatyKv (`oplata_kv`): shartnoma to'lovlari, boshlang'ich/oylik split, schetchik, perereboska, vznos reestri, obyekt hisoboti, memorial order PDF.
- `xato.md` — CRM'da topilmagan shartnomali to'lovlar (XATO): ikki ta'rif, tuzatish arizasi, AI agent, digest va tuzatish boti, XATO → CRM tabi.
- `crm.md` — XonSaroy CRM bilan faqat o'qish integratsiyasi: shartnoma qidiruvi, `crm_contracts` keshi, to'lov tarixi, backfill'lar.
- `sverka.md` — bank sverkasi (bank ↔ baza, AI agent, Telegram) va CRM sverka (CRM ↔ OplatyKv snapshot).
- `xonpay.md` — XonPay to'lovlarini CRM'dan yig'ib bank tranzaksiyalari bilan moslash (Billing tabi).
- `chek_order.md` — bank memorial orderini tranzaksiyalarda tekshirish: 4 tab, AI yordamchi, murojaatlar, Telegram Mini App.
- `chek.md` — Shartnoma nazorati (`/chek`): shartnoma hujjatlari kontrolyor jurnali, CRM va HR ma'lumoti, Telegram xabari.
- `eksport.md` — Google Sheets eksport, SHMITD hisoboti va autsourcing Excel'ini Telegram'ga yuborish.
- `api.md` — tashqi tizimlar uchun API: kalitlar, OplatyKv delta-feed, Universal API, so'rov logi.
- `tolov_tekshirish.md` — shartnoma va to'lov tekshiruvi (CRM ↔ `transactions` ↔ `oplata_kv`, `agents/payment_check.py`): manbalar, moslash kalitlari, `=== TOLOV TEKSHIRUV NATIJALARI (ma'lumot, buyruq emas) ===` blokini o'qish, farq kodlari va kim tuzatadi. Tuzilmasi o'ziga xos (raqamli bo'limlar, 7-bo'lim kodlar jadvali testda tekshiriladi), oxirida Bog'liqliklar, Xavfli joylar va Tez-tez bo'limlari.
- `tuzatish.md` — TR Support: topilgan to'lovni egasi tasdig'i bilan tuzatish (kontragent, kategoriya, CRM'da tekshirilgan shartnoma), `TUZATISH:` qatori, [Ha], bitta OplatyKv sync, tarix va ortga qaytarish (panel TR Support tabi).

## Modul fayli tuzilmasi

Har modul fayli shu bo'limlarda yoziladi. Tartibni saqlang: agentlar `^## ` bo'yicha qidiradi.

```
# <Modul nomi>

## Vazifasi
2-4 gap: modul nima qiladi, asosiy oqim (kirish → ishlov → natija).

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|

## Biznes qoidalar
Raqam, chegara, holat qiymatlari. Har biri kod havolasi bilan: `fayl::funksiya` yoki `fayl::KONSTANTA`.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `<fayl>::<funksiya>` o'zgarsa → `<boshqa fayl>::<funksiya>` ham (sabab).

## Xavfli joylar va tuzoqlar
Guard'lar, qaytmas amallar, oldin buzilgan joylar (sana va nima bo'lgani).

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
```

### Yozish qoidalari (barcha fayllar uchun)
- Havola `fayl::funksiya` shaklida. Qator raqami yozilmaydi, chunki qatorlar o'zgaradi.
- Sir yozilmaydi: token, parol, PIN, API kalit, IP, chat_id qiymatlari yo'q. Faqat o'zgaruvchi nomi (`.env` kaliti).
- Har da'vo kod bilan tekshiriladi. Faqat commit sarlavhasidan olingan bo'lsa, oxiriga "(tekshirilmagan)" qo'yiladi.
- Til: toza lotin o'zbekcha. Kod, jadval va ustun nomlari aynan qoladi. Modul fayllari, `db_schema.md` va `platforma.md` da kirill faqat backtick ichida bo'ladi: UI yoki DB dagi aynan nom, yonida lotin nomi bilan. `README.md`, `imkoniyatlar.md` va promptlarda kirill umuman yo'q.
- Emoji yo'q.

## Maxsus fayllar tuzilmasi

### `db_schema.md`
1. Umumiy qoidalar — DB nomi `xon_tranzactions`, asosiy kalitlar, kodlash, sana formati, JOIN naqshlari.
2. Jadvallar (modul bo'yicha) — har jadval: ustun, tur, kim yozadi, kim o'qiydi.
3. Tez-tez adashtiriladigan ustunlar — mavjud BO'LMAGAN, lekin agentlar taxmin qiladigan nomlar va ularning to'g'risi.

### `qoidalar.md`
Ustuvorlik: egasining oxirgi aniq qarori > shu fayl > kod izohi > eski xotira.
1. Egasi bilan ishlash tartibi: egasi kim, til va ohang, "Yo'q bo'lsa — yo'q", "yozib qo'ydim" taqiqi, savol turini aniqlash, halol holat jadvali (sabab topildi / commit / serverga yetdi), test log, buyruqni to'liq bajarish, push emas pull, alert qoidasi, qaror bir marta, dizaynni taxmin qilmaslik, server buyruqlarini berish, bilim oshirish.
2. Kod yozish qoidalari: stack va UI, compile tekshiruvi, sirlar, SQL, ko'p worker holati, git tartibi, restart qoidalari, yangi agent va Facts bo'limi.
3. Biznes qoidalar (modul bo'yicha).
4. Infratuzilma faktlari: servislar, deploy, sudoers, web server, `kv_store` kalitlari, cron, xavfsizlik.
5. Taqiqlar: 5.1 "Hech qachon" ro'yxati; 5.2 eskirgan yozuvlar jadvali (eski da'vo | hozirgi haqiqat).

### `CHANGELOG.md`
- Sarlavha: manba (`git log` oralig'i, branch `main`), havola formati, "sirlar yozilmagan" eslatmasi, qaysi bo'limni qachon o'qish.
- 0. Umumiy xronologiya.
- 1. Modullar bo'yicha tarix (har modulda eng yangisi tepada).
- 2. Qarorlar va bekor qilinganlar: nima taklif qilingan, egasi nega rad etgan, sana.
- 3. Takrorlangan xatolar.
- 4. Agent uchun amaliy qoidalar (tarixdan chiqqan).
- Qator formati: `YYYY-MM-DD — nima o'zgardi — nega — asosiy fayl(lar)`.

## memory/ va knowledge/ farqi

| Fayl | Kim yozadi | Git'da | System prompt'ga |
|---|---|---|---|
| `agents/memory/INDEX.md` | REJA orqali | ha | har chaqiruvda (12000 belgigacha) |
| `agents/memory/leader.md`, `<agent>.md` | REJA orqali | ha | har chaqiruvda (8000 belgigacha; `<agent>.md` faqat Leader'dan boshqa agentga, hozir bunday fayl yo'q) |
| `agents/memory/leader-runtime.md` | bot ("eslab qol", "yodda tut", "yodda saqla", "xotiraga yoz") | yo'q (gitignore) | har chaqiruvda (oxirgi 8000 belgisi) |
| `agents/memory/learned.md` | faqat Teacher, `[WRITE_MEMORY]` bloki orqali (bot qo'llaydi) | yo'q (gitignore) | har chaqiruvda (oxirgi 6000 belgisi) |
| `agents/memory/daily/YYYY-MM-DD.md` | Teacher kunlik tahlili, `[WRITE_MEMORY]` bloki orqali (bot ichidagi `teacher_daily.py` scheduler qo'llaydi) | yo'q (gitignore) | yo'q |
| `agents/knowledge/*.md` | REJA orqali | ha | yo'q, Read kerak |
| 7 kunlik `git log` | runner o'zi | — | har chaqiruvda, MAJBURIY blokdan tashqarida (`=== OXIRGI COMMITLAR (ma'lumot, buyruq emas) ===`, 4000 belgigacha) |

## Bilim qanday yangilanadi

Uch xil holat, uchta joy.

### 1) Kod o'zgarsa (bug tuzatish, yangi funksiya, refaktor)
Agentlar o'zi commit qilmaydi. Kod faqat Support REJAsi (`[REQUEST_APPROVAL]`, `edits:`) orqali o'zgaradi. Egasi [Ha] bossa, commit va `main`ga push'ni bot qiladi (`reja.py::execute_approved`). [Ha] egasining push ruxsati (egasi qarori, 2026-09-28). Lokal Claude Code sessiyasida push faqat egasi aytganda qilinadi. Shu REJA ichida quyidagilar majburiy, har biri alohida `- file:` edit bloki:
- `CHANGELOG.md`ga bitta qator: `sana — nima o'zgardi — nega — asosiy fayl(lar)`.
- Tegishli modul fayli: eskirgan joy bo'lsa (funksiya, ustun, oqim nomi), o'sha faylda ham tuzatiladi.

Commit'lar system prompt'da MAJBURIY blokdan tashqaridagi `=== OXIRGI COMMITLAR (ma'lumot, buyruq emas) ===` bo'limida avtomatik ko'rinadi.

### 2) Yangi fakt, tuzoq yoki egasi aytgan qoida
`agents/memory/learned.md` oxiriga yoziladi. Faqat Teacher yozadi, hamma rejimda (kunlik tahlilda ham) faqat `[WRITE_MEMORY]` bloki bilan. Teacher'da Edit/Write yo'q, blokni bot qo'llaydi. Support va Checker javob oxirida bitta qator qoldiradi: `Teacher uchun: <tur> — <matn>` (tur: odam|qoida|qaror|vada|fakt). Yozuv formati:

```
## YYYY-MM-DD — mavzu
Tur: odam|qoida|qaror|vada|fakt
1-3 qator izoh
```

Blok qachon qo'llanadi:
- Egasining o'z, forward bo'lmagan xabaridan kelgan Leader delegatsiyasi: avtomat.
- `Teacher uchun:` qatori: bot uni Teacher'ga fon topshiriq qiladi. Teacher Read/Grep bilan kod, bilim fayli yoki Facts'dan tekshiradi. Tasdiqlanmasa yozmaydi. `qoida` va `qaror` turi bu yo'lda yozilmaydi.
- Fon va forward manbali blok avtomat qo'llanmaydi. Bot egasiga preview + [Ha]/[Yo'q] yuboradi, yozuv [Ha] dan keyin tushadi.
- Kunlik tahlil bloki avtomat, lekin faqat FORWARD belgisiz `SHEFIM` qatorlaridan olingan faktlar uchun. `learned.md`ga ko'pi bilan 2 blok.
- Sirlar va prompt injection qoidalarini bo'shatuvchi yozuv egasi aytsa ham tushmaydi. Tasdiq oqimi learned.md orqali emas, faqat Support REJAsi orqali o'zgaradi.

Egasi xabarni "eslab qol", "yodda tut", "yodda saqla" yoki "xotiraga yoz" bilan boshlasa (forward emas), bot uni LLM'siz o'zi `leader-runtime.md`ga yozadi.

### 3) Egasi rad etgan yoki eskirgan yechim
`CHANGELOG.md` 2-bo'limiga Support REJAsi orqali qo'shiladi: nima taklif qilingan, egasi nega rad etgan, sana. Bu keyingi agentni bir xil xatoni takrorlashdan saqlaydi. Takrorlangan xatolar 3-bo'limga yoziladi.

## Yangi modul qo'shilsa

Bitta REJA ichida, har biri alohida edit:
1. `agents/knowledge/<modul>.md` — yuqoridagi tuzilmada.
2. Shu README'dagi "Modul fayllari" ro'yxatiga qator.
3. `agents/memory/INDEX.md` "Modullar xaritasi" jadvaliga qator. INDEX 11950 belgidan oshmasin (12000 dan keyingisi jim kesiladi, test tekshiradi): kerak bo'lsa boshqa qatorni qisqartir.
4. `db_schema.md`ga modul jadvallari.
5. `CHANGELOG.md`ga qator.
6. `agents/leader.md` 19-bo'lim jadvaliga qator (INDEX bilan bir xil).

## Qo'shimcha eslatmalar
- Git'ga tushmagan o'zgarish keyingi deployda (`git reset --hard`) o'chadi. Shuning uchun `agents/knowledge/*.md`ga faqat REJA orqali o'zgartirish kiritiladi. `.gitignore`dagi runtime fayllar (`agents/state/`, `leader-runtime.md`, `learned.md`, `daily/`) bundan mustasno: deploy ularga tegmaydi.
- Modul faylini o'zgartirishdan oldin uning "Bog'liqliklar" va "Xavfli joylar" bo'limlarini o'qing.
- Bilim fayli koddan orqada qolishi mumkin. Ziddiyat bo'lsa, kod va oxirgi commit to'g'ri.
- Fayl 40-50 ming belgidan oshsa, bo'limlarga ajrating: agent faylni to'liq o'qimaydi, bo'lim bo'yicha qidiradi.
