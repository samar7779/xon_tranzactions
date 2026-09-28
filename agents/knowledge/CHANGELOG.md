# CHANGELOG — Xon Tranzaksiyalar

Manba: `git log`, branch `main`. Tarix asosan oxirgi 40 commitdan (2026-09-12 .. 2026-09-28). Xatolar va qarorlar uchun eski commitlar ham olingan.
Havola: qisqa hash (7 belgi), `git show <hash> --stat` bilan ochiladi. Qator formati: `YYYY-MM-DD — nima o'zgardi — nega — asosiy fayl(lar)` (`hash`).
Sirlar yozilmagan: token, parol, kod, chat ID, IP yo'q. Kirill nom faqat backtick ichida, yonida lotin nomi.

Qachon qaysi bo'lim:
- Umumiy manzara → 0.
- "Bu modulda oxirgi marta nima o'zgargan?" → 1.
- "Nega shunday qilingan?", "buni taklif qilsam bo'ladimi?" → 2. Rad etilganini qayta taklif qilma.
- "Bu xato oldin bo'lganmi?" → 3.
- Kod o'zgartirishdan oldin → 4.

Yangi qator faqat Support REJAsi orqali qo'shiladi. Har modulda eng yangisi tepada.

## 0. Umumiy xronologiya

- 2026-05 — skelet (NestJS, Prisma, PostgreSQL), admin panel, Kapitalbank va Ipak Yo'li sync, GitHub webhook deploy (`020df8f`), kontragentlar (DIDOX), Excel import, sverka paneli, XonPay, OplatyKv jadvali (`249fc83`), perereboska (`47ecc68`).
- 2026-06 — bank tomonda o'zgargan to'lovlar va OplatyKv kaskadi (`a4bd1a2`), tashqi REST API (`a17433f`), sverka Telegram tugmalari (`affaa53`).
- 2026-07 — Shartnoma nazorati `/chek` (`778e931`), Kunlik xulosa (`2c24ebb`), XATO tuzatish arizasi (`682b5ae`), AI agent (`6b3d559`), memorial order PDF (`9b68f41`), CRM lookup parity (`5b9daf0`), sirlar `.env` ga (`4b7db6e`), tuzatish boti (`534479e`).
- 2026-08 — SHMITD (`b67bad7`), vznos reestri (`042b725`), bank parol moduli (`362b7ab`), Chek order (`40bbd8a`), API delta-feed (`c680f65`), sverka AI agenti (`9ecf92e`), CRM sverka (`7ea20b3`), sverka digest (`8c642eb`), split waterfall (`f5a257f`), XATO → CRM (`127bad9`), MOVED turi (`3c0684f`), audit log (`2f9ef87`).
- 2026-09 — Hamkorbank (`169ee08`), Chek payment (`ead790c`), ta'minot ERP moslash (`2d51c5b`), Minfin tuzatish (`f4993f8`), Hamkor vipiska importi (`78ccc6d`), Universal API (`5a1422f`), OplatyKv sana dublikati (`2043be4`), v1 Leader (`f562a66`), shablon asosidagi agentlar (`agents/`, commit hali yo'q).

## 1. Modullar bo'yicha tarix

### Agentlar
- 2026-09-28 — `agents/` promptlari va bilim fayllari shablon asosida tayyorlangan: Leader, Support, Checker, Teacher — egasi qarori: Claude Code CLI + setup token, API kalit yo'q — `agents/` (commit hali yo'q; bot kodi `agents/*.py` da yozilgan, `agents/bin/bash_guard.py`, `agents/claude_settings.json`, `agents/deploy/xon-tranzactions-leader.service`, `agents/tests/`)
- 2026-09-28 — v1 Leader: NestJS moduli, Messages API, faqat ko'rish va tahlil — boshqa sessiya ishi, bu tizim bilan bog'liq emas — `backend/src/leader/`, `backend/agents/` (`f562a66`)

### Tranzaksiyalar (kategoriyalash, kontragent, ta'minot, import)
- 2026-09-23 — import sahifasida hisob ro'yxati karta chegarasida kesilardi, tuzatilgan — ro'yxat to'liq ko'rinsin — `frontend/app/[locale]/(panel)/admin/import/page.tsx` (`e29603b`)
- 2026-09-23 — import sahifasiga kod qulfi, hisob raqami ro'yxatdan tanlanadi — noto'g'ri hisobga import bo'lmasin (tekshirilmagan) — `admin/import/page.tsx` (`254b3fa`)
- 2026-09-22 — ta'minot: sana buzuq o'qilardi, 500 xato va ±2 kun cheklovi ishlamasdi — tuzatilgan — `backend/src/taminot/taminot.service.ts` (`a2143f6`)
- 2026-09-19 — ta'minot: moslik topilmagan to'lovga sabab va yaqin nomzodlar — xodim qo'lda moslashi uchun — `taminot.service.ts`, `transactions/page.tsx` (`0677192`)
- 2026-09-18 — ta'minot qiymatlari ustun filtrlarida, Shartnoma filtrida va tafsilot oynasida — ko'rish va qidirish — `transactions.service.ts`, `transactions/page.tsx` (`9e7f73d`, `fbef39b`, `b808d8c`)
- 2026-09-18 — bank to'lovi ta'minot ERP to'loviga bog'langan (kontragent, modda, shartnoma) — Minfin tuzatishining keyingi bosqichi; faqat `erp_*` ustunlar, `contract_number` ga yozilmaydi — `backend/src/taminot/`, `schema.prisma` (`2d51c5b`)
- 2026-09-18 — Minfin (`Молия Вазирлиги`, Moliya Vazirligi) faqat byudjet to'loviga — izohdagi NDS so'zi 01.05.2026 dan 21 863 to'lovni noto'g'ri Minfin qilgan — `categorization.service.ts` (`f4993f8`)
- 2026-09-17 — Kontragent va Kategoriya filtriga "Bo'sh" bandi — bo'sh qatorlarni topish — `transactions.service.ts` (`0c3c0a1`)
- 2026-09-09 — import qatorida qo'lda qo'yilgan kategoriya Excel matnidan ustun — qo'lda ish yo'qolmasin — `transactions` (`0ff9db4`)

### Bank sync va banklar
- 2026-09-24 — Hamkor `txn_date` = hisobga tushgan sana (ddate, docDate) — egasi aniqlagan: pul hisobga tushgan kun kerak, Kapital va Ipak bilan bir xil; mavjud yozuvlar bir martalik tuzatilgan — `sync.service.ts`, `import.service.ts` (`7d89575`)
- 2026-09-24 — becfil-exclusion olib tashlangan — kunlik sync'ni sindirgan: settlement partiyasidagi eski sanali to'lovlar tashlab ketilardi — `sync.service.ts` (`d19dc52`)
- 2026-09-23 — Hamkor statement va backfill uchun alohida uzun timeout (25 daqiqa) — bankda timeout 20 daqiqa, biz 2 daqiqada uzardik — `hamkorbank.client.ts` (`18ffea8`)
- 2026-09-23 — becfil-exclusion qo'shilgan: import qilingan davrni sync olmaydi — dublikatdan himoya; keyin bekor qilingan (`d19dc52`) — `sync.service.ts`, `import.service.ts`, `schema.prisma` (`280d12a`)
- 2026-09-23 — Hamkor vipiska import moduli; import `external_id` byacc uslubidagi kompozit, avto-kategoriyalash — o'tgan davr API orqali kelmaydi — `import.service.ts`, `hamkor-dedup.util.ts` (`78ccc6d`, `ab77ead`)
- 2026-09-22 — Hamkor `txn_date` = `Время транзакции` (tranzaksiya vaqti) — settlement kunining shishishini yo'qotish uchun; ikki kundan keyin rad etilgan (`7d89575`) — `sync.service.ts` (`1403fcc`)
- 2026-09-22 — `[HB-DIAG]` vaqtinchalik log: so'rov manzili, requestId, javob kodi — bankka dalil berish uchun — `hamkorbank.client.ts` (`d00d104`)
- 2026-09-21 — Hamkor to'lov vaqti sanadan ajratiladi, xom javob tashxis uchun saqlanadi — vaqt ko'rinmasdi — `hamkorbank.client.ts`, `sync.service.ts` (`9e9428c`, `f34a2f3`)
- 2026-09-21 — "Ulanish" ro'yxati banklar bo'yicha yig'iladigan guruhlarga bo'lingan — ko'p hisobda chalkashlik — `setup/accounts/page.tsx` (`7f7d9c2`)
- 2026-09-17 — hisob nomini inline tahrirlash, o'chirilgan hisob tranzaksiyalarini relink — hisob qayta qo'shilsa bog'lanish uzilmasin — `sync.service.ts`, `setup/accounts/page.tsx` (`75f1dfb`)
- 2026-09-17 — Hamkor `external_id` prefiksi `HB_` (Ipak `IP_` kabi), parserlar umumiy — banklar ID'lari to'qnashmasin — `sync.service.ts`, `inspector.service.ts`, `reconcile.service.ts`, `crm.service.ts` (`ba54299`)
- 2026-09-17 — Hamkorbank prod'ga tayyor: sahifa 20, `code -5` = bo'sh kun, timeout 120 s, ulanish testi `get-account-list` — bank talablari — `hamkorbank.client.ts`, `bank-credentials.service.ts` (`5aacd0d`)
- 2026-09-15 — banklar sahifasida Endpoint (`apiBaseUrl`) tahriri — lab va prod almashtirish — `setup/banks/page.tsx` (`225f3a8`)
- 2026-09-15 — `/_deploy/hamkor-diag` vaqtinchalik tashxis — bank whitelist tekshiruvi — `deploy.controller.ts`, `deploy.service.ts` (`a76156c`)
- 2026-09-04 — Hamkorbank integratsiyasi (`HAMKORBANK_V1`), alohida REST klient — mavjud banklarga ta'sirsiz — `backend/src/integrations/hamkorbank/` (`169ee08`)

### OplatyKv
- 2026-09-24 — sana ko'chganda `source_tx_id` yangi ID ga ko'chiriladi — bank sanani o'zgartirsa to'lov ikki marta qo'shilardi; 46 yetim qator tozalangan — `sync.service.ts`, `reconcile.service.ts::fixTxDate`, `relinkOplataKv` (`2043be4`)
- 2026-09-24 — memorial order reyestrida ko'p qator bo'sh qolardi, tuzatilgan — so'rov chegarasi tugab ketardi — `memorial-order.service.ts` (`e3b4463`)
- 2026-09-17 — dashboard "Obyektlar bo'yicha to'lovlar" filtriga Bank guruhi, Bank filtrida faqat faol banklar — bank kesimida ko'rish — `oplata-kv.service.ts`, `dashboard/page.tsx` (`f47f2f6`, `f3d2605`)
- 2026-09-09 — memorial order: bitta order ko'p qatorga takrorlanardi, sana va takrorsizlik qo'shilgan — bir xil summali oylik to'lovlar — `memorial-order.service.ts` (`3a62ee5`)
- 2026-08-22 — split "waterfall clamp" qo'shilgan va o'sha kuni qaytarilgan — egasi faqat sababni so'ragan edi — `installment-split.ts` (`868d78f`, `16f4677`)
- 2026-08-20 — split CRM grafik waterfall bo'yicha, avto va qo'lda bir xil — oylik to'lov boshlang'ichga tushib qolardi — `installment-split.ts` (`f5a257f`)

### XATO
- 2026-08-22 — "XATO → CRM" moduli: CRM'dan topib bir bosishda biriktirish; CRM aytgan ustun qo'yiladi — qo'l ishini kamaytirish — `oplata-kv` (`127bad9`, `9450843`)
- 2026-07-29 — XATO to'lovlarni to'liq qayta kategoriyalash (reverify) — CRM'da bor shartnoma XATO'da qotgan edi — `oplata-kv.service.ts::reverifyXato` (`d2cac98`)
- 2026-07-28 — qo'lda qo'yilgan XATO ro'yxatda ko'rinadi — "qaytar" tugmasiz — `oplata-kv.service.ts::buildXatoFilter` (`dfd8d99`)
- 2026-07-24 — AI agent arizani Claude vision bilan tekshiradi — qo'lda tekshiruvni kamaytirish — `backend/src/correction/agent-ai.service.ts` (`6b3d559`)
- 2026-07-23 — XATO tuzatish arizasi, 2 bosqichli oqim — tasdiqsiz o'zgarish bo'lmasin — `backend/src/correction/` (`682b5ae`)

### CRM
- 2026-09-12 — `show()` `/index` fallback endi id bo'yicha to'liq detail oladi — to'lov 0 chiqardi — `crm.service.ts` (`c94cead`)
- 2026-08-24 — sotuv bo'limi (`branch_name`): recency, drenaj, `''` sentinel, bir martalik reset — `''` yozilgan qatorlar abadiy bo'sh qolardi — `crm-contract-cache.service.ts` (`dbb95a0`, `dcc02c7`)
- 2026-08-10 — `crm_status` mojibake tuzatilgan — CRM yorliqlari buzuq kodlashda kelardi — `crm-contract-cache.service.ts::repairMojibake` (`947a25f`)
- 2026-07-29 — avto lookup qo'lda qidiruv bilan parity, CRM kanonik raqami saqlanadi, dublikat shartnoma ism bo'yicha — shartnoma CRM'da bor, lekin XATO'da qolardi — `crm.service.ts`, `categorization` (`5b9daf0`, `ae70d25`, `58d8e19`)

### Sverka
- 2026-09-11 — CRM sverka: qaytarim (`Возврат`, vozvrat) alohida bo'lim; boot'da server o'zi fonda tortadi (5000/8) — bekor va qayta rasmiylashtirilgan shartnomalar; tezlik — `backend/src/crm-sverka/` (`a03fe58`, `7be2df0`)
- 2026-09-10 — CRM sverka snapshot DB'ga saqlanadi, boot'da tiklanadi, cron avto-yangilaydi; 4 sub-tab va bekor shartnomalar — restartda yo'qolardi — `crm-sverka.service.ts` (`13602ea`, `2af47d6`)
- 2026-08-20 — bank sverka yagona digest xabarga o'tgan; soxta farq (sync kechikishi, vaqt zonasi) tuzatilgan; ayb faqat yuqori ishonchda — guruh xabarlarga to'lib ketardi — `sverka-telegram.service.ts`, `digest.ts`, `reconcile.service.ts::fmtDate` (`8c642eb`)
- 2026-08-18 — CRM sverka tabi (`/check-crm`) — CRM to'lovlari va OplatyKv solishtiruvi — `backend/src/crm-sverka/` (`7ea20b3`)
- 2026-08-17 — sverka AI agenti: farq tashxisi, ayb tasnifi, tasdiqli tuzatish — `sverka-agent.service.ts` (`9ecf92e`)
- 2026-08-14 — "Notif. reset" eski xabarlarni ham o'chiradi — orphan va dublikat xabarlar — `sverka-telegram.service.ts::resetNotifiedToday` (`40343ad`)

### Chek order va Chek payment
- 2026-09-12 — Chek payment: backend limiti 50 → 200 qaytarilgan — batched refaktorda tushib qolgan edi — `chek-order.service.ts` (`294a90c`)
- 2026-09-12 — Chek payment: CRM to'lovi 0 chiqardi, grafik va tarixdan eng katta manba olinadi; CRM debug tashxisi — `chek-order.service.ts`, `chek-payment.tsx` (`dce5a32`, `251afeb`)
- 2026-09-12 — Chek payment: 200 shartnoma, batched o'qish; Sheet ×100, merge katak, butun sheet o'qish — `chek-order.service.ts`, `google-export.service.ts` (`c920479`, `2dca63d`, `b928480`, `13ca67b`)
- 2026-09-12 — 'Chek payment' sub-tab: shartnoma to'lovlarini OplatyKv, CRM va Sheet'dan faqat o'qib solishtiradi — egasi talabi: read-only — `backend/src/chek-order/` (`ead790c`)
- 2026-08-12 — Chek order: memorial orderni tranzaksiyada tekshirish — `backend/src/chek-order/` (`40bbd8a`)

### Universal API va eksport
- 2026-09-24 — Universal API'ga Excel vipiska, paneldagi bilan aynan bir xil — tashqi tizimlar uchun — `universal-api.controller.ts`, `docs/universal-api.md` (`54dbbfa`)
- 2026-09-24 — `docs/universal-api.md` to'liq yo'riqnoma va web versiya izohlari — `docs/universal-api.md` (`2d25beb`, `2a53592`)
- 2026-09-24 — Universal parametrlari izohi kalit nomi bo'lib chiqardi, tuzatilgan — i18n kalit yetishmagan — `frontend/i18n/messages/*.json` (`e7fb9e4`)
- 2026-09-24 — Universal API: obyekt to'lovlari, bank hisoblari, vipiska bitta `universal:read` scope'da — 1C, ERP, BI uchun — `backend/src/developer-api/` (`5a1422f`)
- 2026-08-19 — eksport filtri saqlanmasdi, tuzatilgan — global ValidationPipe nested `filter` ni qirqardi — `google-export` (`a7a9bb5`)
- 2026-08-18 — delta-feed'dagi o'chirish filtri olib tashlangan — o'chirishlar CRM'ga yetmayotgan edi — `public-api.controller.ts`, `import.service.ts` (`3075556`)
- 2026-08-17 — `/api/v1/oplata-kv/changes`: keyset kursor, upsert va tombstone — yagona ishonchli feed — `developer-api` (`c680f65`)
- 2026-08-12 — `oplata_kv.updated_at` kelajak qiymat bermaydi — delta-sync kursori to'lovlarni tashlab ketardi — `oplata-kv.service.ts::clampFutureUpdatedAt` (`b06ca52`)

### Platforma
- 2026-08-26 — haqiqiy audit log: global interceptor har o'zgartiruvchi so'rovni yozadi — profil "Xavfsizlik" mock edi — `backend/src/audit/` (`2f9ef87`)
- 2026-07-30 — qattiq yozilgan sirlar `.env` ga ko'chirilgan, fallback'lar olib tashlangan — sirlar git'da edi — backend (`4b7db6e`)
- 2026-05-21 — webhook uchun `rawBody` json parser'da saqlanadi — deploy webhook imzosi yiqilardi — `backend/src/main.ts` (`1cafbc3`)
- 2026-05-12 — GitHub webhook avto-deploy, systemd — `backend/src/deploy/`, `scripts/deploy.sh` (`020df8f`)

## 2. Qarorlar va bekor qilinganlar

Format: `sana — nima taklif qilingan yoki qilingan — egasining qarori va sababi — fayl yoki commit`.

- 2026-09-28 — agentlarni `ANTHROPIC_API_KEY` (Messages API) bilan ulash — RAD: egasi agentlarni API kalitga ulamaslikni aytgan. Agentlar faqat Claude Code CLI + setup token, tokenni egasi o'zi oladi — `agents/`
- 2026-09-24 — Hamkor tranzaksiya sanasi = karta vaqti (`Время транзакции`, tranzaksiya vaqti) — RAD: egasi aniqlagan, kerak sana pul hisobga tushgan kun — `1403fcc` → `7d89575`
- 2026-09-24 — becfil-exclusion: import davrini sync olmaydi — BEKOR: kunlik sync'ni sindirgan. Dublikatni `@@unique([accountId, hbDedupKey])` to'xtatadi — `280d12a` → `d19dc52`
- 2026-09-24 — Hamkor uchun statement va sverka — KUTILMOQDA: egasi bank o'z bazasidagi xatoni tuzatishini kutishni tanlagan. Statement hozir faqat Kapitalbank — `transactions/statement`
- 2026-09-18 — Minfin qayta kategoriyalash doirasi — egasi: faqat 01.05.2026 dan, qo'lda qo'yilganlarga tegilmaydi, avval dryRun — `categorization.service.ts`
- 2026-09-18 — ta'minot shartnomasini `contract_number` ga yozish — RAD: CRM topolmay XATO chiqaradi, raqam yashirinadi. Alohida `erp_*` ustunlar — `2d51c5b`
- 2026-09-12 — Chek payment — egasi: faqat o'qiydi, hech narsa o'zgartirmaydi — `ead790c`
- 2026-09-08 — CRM'ga yozish — RAD, doimiy: CRM faqat o'qiladi. Yozish kerak bo'lgan g'oya avval egasiga — `crm.service.ts`
- 2026-09-08 — Shaxmatka (xonadonlar ko'rinishi) — KEYINGA QOLDIRILGAN: egasi "keyin qilamiz". CRM client kaliti inventar bermaydi, admin API ruxsat bermaydi. Probe kodi olib tashlangan — `bfc2c07`. Qaytganda: faqat o'qiydigan integratsiya akkaunti yoki Excel import. O'z login bilan kirish tavsiya etilmaydi.
- 2026-08-22 — split "waterfall clamp" — QAYTARILGAN: egasi sababni so'ragan edi, tuzatishni emas — `868d78f` → `16f4677`
- 2026-08-18 — delta-feed'da bo'sh tombstone filtri — RAD: o'chirishlar iste'molchiga yetmay qolgan. Feed'dan o'chirish hech qachon filtrlanmaydi — `3075556`
- 2026-08-18 — AI perereboska — egasi qarorlari: cron yo'q, agent faqat ariza yuklanganda chaqiriladi. Orqaga qaytarishda pul qatorlari o'chadi, guruh `cancelled` bo'lib tarixda qoladi — `oplata-kv.service.ts`
- 2026-08-10 — vznos ot imeni klienta — egasi: obyekt tushum hisobotlaridan chiqariladi, tushum emas — `backend/src/vznos/`
- 2026-07-30 — sirlar kodda — egasi: faqat server `.env`, u aytsa ham kodga qo'yilmaydi — `4b7db6e`
- 2026-07-28 — "XATO ro'yxatiga qaytar" tugmasi — KERAK EMAS: OplatyKv XATO ro'yxati qo'lda XATO'ni ham ko'rsatadi — `dfd8d99`
- 2026-07-21 — "Plan bo'yicha to'lov" widgeti (CRM grafik) — OLIB TASHLANGAN: egasi "mavjud narsani takrorlaydi". O'rniga Kunlik xulosa. `contract_schedules` jadvali dormant — `2c24ebb`
- 2026-07-20 — obyekt bo'yicha ruxsat (row-level) — KECHIKTIRILGAN: egasi "hozircha kerak emas". Kod yozilmagan.
- 2026-07-13 — Planirovka rasmi — KUTILMOQDA: CRM client API plan rasmini bermaydi, admin API kerak — `frontend/components/plan-viewer-dialog.tsx`
- 2026-06 (sana taxminiy) — kvartira to'lovini dekorativ 3D bino bilan ko'rsatish — RAD: egasi "juda oddiy" degan. 2D arxitektura planirovkasi ma'qul — frontend
- 2026-05-12 — push — egasi: push faqat uning ruxsati bilan. Commit mumkin, push "ha" dan keyin.

## 3. Takrorlangan xatolar

1. **Bank sanani ko'chiradi, `external_id` o'zgaradi.** ID ichida hujjat sanasi bor. Uch xil ko'rinishda chiqqan:
   - 2026-08-25: ko'chgan to'lov DELETED deb belgilanib, kaskad (`a4bd1a2`) OplatyKv qatorini o'chirgan. Tuzatish: ±3 kun tekshiruv va MOVED (`3c0684f`), tiklash (`c83d315`, `c62ae15`, `6070a7d`).
   - 2026-09-24: `source_tx_id` eski ID'da qolib, to'lov OplatyKv'ga ikki marta tushgan (`2043be4`).
   - 2026-09-21..24: Hamkor sanasi 4 marta o'zgartirilgan (`9e9428c`, `f34a2f3`, `1403fcc`, `7d89575`).
   - Qoida: `external_id` ga tegadigan har joy `source_tx_id` ni ham ko'chirsin. O'chirishdan oldin bankdan tekshir.
2. **TS xato bilan push.** 2026-05-21 bir kunda ~10 marta deploy yiqilgan. Qoida: lokal `npm run build`, bot REJA'da `tsc`.
3. **Frontend qayta qurilmadi.** Bo'sh yoki faqat hujjat commit frontend'ni qurmaydi. Qayta ishga tushirish commitlari: `b0486fb` (2026-07-23), `e54b6c0`, `000946d` (2026-08-12), `7f69de2`, `97f25e7`, `f958417` (2026-08-19). Qoida: `frontend/` dagi real fayl o'zgarishi.
4. **Webhook imzosi yiqildi.** Body parser `rawBody` ni yo'qotgan: 2026-05-12 (`4f5536e`) va 2026-05-21 (`f256fca` → `1cafbc3`). Server 200 qaytargani uchun GitHub yashil ko'rsatgan. Belgi: `/_deploy/status` dagi commit push'dan ortda. Qoida: `json()` faqat `verify` bilan.
5. **Yangi ruxsat hech kimga ko'rinmadi.** 2026-07: `export:*` `seed.ts::ALL_PERMS` ga tushmagan. Qoida: 3 joy.
6. **DB soati va server TZ.** `NOW()` kelajak `updated_at` bergan (`b06ca52`, 2026-08-12). Reconcile UTC sanasi butun kun soxta farq bergan (`8c642eb`, 2026-08-20). Kunlik xulosa to'liq kechani tugamagan bugun bilan solishtirgan (`ff15275`). Qoida: vaqt ilovadan, `Asia/Tashkent`.
7. **`''` bilan "qulflangan" ustun.** `branch_name` ga `''` yozilgach backfill uni qayta to'ldirmagan (`dbb95a0`, `dcc02c7`, 2026-08-24). `virtual_status` da ham shu sentinel. Qoida: bilinmasa NULL.
8. **CRM so'rovi 0 yoki bo'sh qaytardi.** Ortiqcha parametr (`5b9daf0`), kanonik raqam saqlanmagan (`ae70d25`), `/index` fallback'da detail yo'q (`c94cead`), Chek payment'da CRM to'lovi 0 (`dce5a32`). Qoida: yangi CRM so'rovni `searchContracts` bilan solishtir. `/show` yetmasa `/payment-history`.
9. **ValidationPipe nested obyektni qirqdi.** 2026-07-13 (`24cea35`) va 2026-08-19 (`a7a9bb5`), eksport sozlamasi. Qoida: nested uchun `@Body() body: any`.
10. **Chegara jim kesildi.** Memorial order so'rov chegarasi (`e3b4463`), import hisob ro'yxati (`e29603b`), refaktorda limit tushib qolgan (`294a90c`). Qoida: chegaraga tegsa bo'lib ol, "jami" dema.
11. **Bitta bank hujjati ko'p qatorga bog'landi.** Bir xil summali oylik to'lovlar (`3a62ee5`, 2026-09-09). Qoida: sana yaqinligi + har hujjat bir marta. OplatyKv ↔ bank moslovchi boshqa joylarda ham tekshir.
12. **Kategoriya sharti `||` bilan juda keng.** Izohdagi NDS so'zi 21 863 to'lovni Minfin qilgan (`f4993f8`). Qoida: kalit so'z faqat subkategoriya, asosiy kategoriya kontragent yoki kod bilan.
13. **AI summa rolini chalkashtirdi.** Perereboska arizasida qaytarilgan summa o'tkazma deb olingan (`4edcd8b`, 2026-08-20). Promptdagi qoida yetmagan. Qoida: pul uchun AI natijasini kod tekshiradi.
14. **Sverka Telegram xabarlari ko'payib ketdi.** Reset orphan qoldirgan (`40343ad`), har hisob alohida xabar edi (`8c642eb`). Qoida: bitta digest, joyida tahrir.
15. **Google Sheet noto'g'ri o'qildi.** URL o'rniga ID kerak, vergulli o'nlik ×100, merge katak (`2dca63d`, `b928480`, `13ca67b`, 2026-09-12). Qoida: `normalizeSpreadsheetId`, `UNFORMATTED_VALUE`, merge anchor.
16. **Sabab so'ralganda kod o'zgartirildi.** Split (`16f4677`, 2026-08-22). Qoida: faqat sabab.
17. **Aralash yozuv.** Javoblarda lotin so'z ichida kirill harf. Egasi 2026-07-30 eslatgan. Qoida: toza lotin, bot `leader_logic.py::normalize_latin` ga tayanma.

## 4. Agent uchun amaliy qoidalar (tarixdan)

- Bank ID yoki sanaga tegadigan REJA'da uch joyni tekshir: `sync.service.ts` (`upsertOne`, `detectChanges`), `reconcile.service.ts` (`fixTxDate`, `relinkOplataKv`), `oplata-kv.service.ts::syncFromTransactions`.
- Hamkor tuzatishi `apiKind` sharti ichida bo'lsin. Kapitalbank va Ipak Yo'li yo'liga tegma.
- CRM'ga yangi so'rov: faqat o'qish, parametrlarni `searchContracts` bilan solishtir.
- Vaqt ilovadan parametr, sana `Asia/Tashkent` bilan. `NOW()` yo'q.
- Ro'yxat yoki so'rov chegarasiga tegsa sahifalab ol.
- Yangi ruxsat: 3 joy. Yangi UI matni: 3 til.
- Frontend o'zgarishi `frontend/` faylida bo'lsin, aks holda qayta qurilmaydi.
- Pul mantiqiga (split, perereboska, kategoriya) o'zgarish: egasi aniq so'rasa, dryRun bilan, `risk: yuqori`.
- Sabab so'ralsa: faqat sabab.
- Qo'lda yaratilgan jadval `public` sxemada va `schema.prisma` da yo'q bo'lsa, keyingi backend deploy (`db push --accept-data-loss`) uni o'chirishi mumkin. Masalan 2026-09-24 dagi `oplata_kv_dub_zaxira` zaxirasi (holati tekshirilmagan).
- Vaqtinchalik tashxis kodi masala hal bo'lgach olib tashlanadi. Hozir turibdi: `/_deploy/hamkor-diag` (`a76156c`), `[HB-DIAG]` (`d00d104`).
