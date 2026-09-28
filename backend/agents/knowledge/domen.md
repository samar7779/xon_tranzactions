# Domen bilimi — Xon Tranzaksiyalar

Support uchun batafsil bilim. `## ` bo'limlar bo'yicha grep qil. Kod havolasi `fayl::funksiya` shaklida (yo'llar `backend/src/` ga nisbatan, boshqacha yozilmagan bo'lsa). Kod yoki commit bu faylga zid bo'lsa — kodga ishon. Kodda kirill literallar bor; bu yerda ular lotin transliteratsiyada, "(kirillda)" belgisi bilan.

## 1. Loyiha va manbalar

- Xon Saroy kompaniyasining ichki tizimi: bank hisoblari bo'yicha barcha kirim va chiqimni kuzatish, mijoz to'lovlarini shartnoma bo'yicha yuritish.
- Manbalar:
  - Bank API: Kapitalbank (SOAP, `KAPITALBANK_V3`), Ipak Yo'li (`IPAK_YOLI_V1`), Hamkorbank (REST, `HAMKORBANK_V1`). Ba'zi banklar faqat ruxsat etilgan IP'dan kiritadi — shuning uchun proxy (forwarder) bor.
  - XonSaroy CRM — shartnomalar, mijozlar, to'lov tarixi. FAQAT O'QISH (shefim qarori, 2026-09-08).
  - XonPay — to'lov tizimi (billing), alohida sync.
  - Excel importlar, Hamkor bank vipiskasi importi.
- Deploy: `main`ga push → webhook → `scripts/deploy.sh` (`prisma db push`, seed, build, restart). Migratsiya papkasi yo'q.

## 2. Vaqt va sana

- DB'dagi `DateTime` ustunlar UTC. Toshkent kuni: `gte new Date('YYYY-MM-DDT00:00:00+05:00')`, `lte new Date('YYYY-MM-DDT23:59:59.999+05:00')` (`transactions/transactions.service.ts`). Raw SQL'da `(txn_date + interval '5 hours')::date`.
- `@db.Date` ustunlar (vaqtsiz kalendar kuni): `OplataKv.date`, `XonpayTransaction.datePaid`, `Transaction.valueDate`, `ContractSchedule.dueDate`. Filtrda `new Date('YYYY-MM-DD')`.
- `Transaction.txnDate` = bank hujjat sanasi (pul hisobga tushgan kun) + bank vaqti, +05:00 bilan quriladi (`sync/sync.service.ts::upsertOne`, `buildTxnDateTime`). Hisobotlar `txnDate` ni ishlatadi.
- Server TZ'ga bog'liq joylar bor (`oplata-kv.service.ts::dailySummary`, `SyncService.tick`) — ehtiyot bo'l.
- DB soati va ilova soati farq qilishi mumkin. Raw SQL `NOW()` bilan timestamp yozish xavfli: bir marta `updatedAt` kelajak vaqtga ketib, API iste'molchisi to'lovlarni o'tkazib yuborgan (2026-08). Qoida: vaqtni ilovadan parametr qilib ber.

## 3. Pul birliklari

- `Transaction.amount` — so'm (bank tiyin beradi, kod 100 ga bo'ladi).
- `BankAccount.balance` — so'm.
- `OplataKv.paymentAmount`, `firstInstallment`, `monthlyAmount` — ishorali: `+` to'lov, `-` qaytarish yoki perereboska manbai.
- `XonpayTransaction.amount` — BigInt, butun so'm.
- Tashqi API pulni satr (Decimal) qilib beradi.
- "N ming" = ming. "mln" = million, "mlrd" = milliard.

## 4. Tranzaksiya (Transaction)

- `direction`: IN (kirim), OUT (chiqim).
- `status`: PENDING, COMPLETED, FAILED, CANCELLED, REVERSED. Sync bank holatidan yozadi: bajarilgan → COMPLETED, bekor → CANCELLED, qolgani → PENDING. Import doim COMPLETED. FAILED va REVERSED amalda yozilmaydi.
- `type`: TRANSFER, PAYMENT, SALARY, TAX, FEE, REFUND, OTHER.
- `source`: SYNC, IMPORT, MANUAL, ALOQA_BANK, HAMKOR_IMPORT.
- `externalId` — kompozit ID, ichida hujjat sanasi bor (general_id, raqam, sana, hisoblar, summa, ishora). Yagona unique maydon. Bank to'lovni boshqa kunga ko'chirsa ID o'zgaradi.
- `transactions.service.ts::stats` va `daily` status bo'yicha filtrlamaydi — PENDING va CANCELLED ham kiradi. "Tasdiqlangan" = COMPLETED.
- O'z hisoblar orasidagi o'tkazmalar (kategoriya TRANSFER) IN ham, OUT ham bo'lib kiradi.
- Kategoriya kodlari (`prisma/seed.ts`): CLIENT (bolalari: CLIENT_VZNOS_KV, CLIENT_VZNOS_AVTO, CLIENT_VOZVRAT, CLIENT_SCHETCHIK, CLIENT_PEREOFORM, CLIENT_VZNOS_IMENI), BANK, SALARY, TRANSFER (perebroska), MINFIN_*, LOAN, COUNTERPARTY_RETURN, COUNTERPARTY.
- Bank kodlari: KAPITALBANK, IPAK_YULI, HAMKORBANK.

## 5. Tushum ta'riflari

- **Mijoz tushumi** (biznes "tushum"i) — OplatyKv: `paymentAmount > 0` va `txType` ichida "vznos" (kirillda). Dashboard "Kunlik xulosa" va obyekt hisobotlari shu manbadan.
- **Obyekt hisoboti** (`oplata-kv.service.ts::byObject`, `buildObjectReportWhere`) — yana "ot imeni" (kirillda) bo'lgan qatorlar chiqariladi. Shuning uchun obyektlar yig'indisi kunlik jamidan kichik chiqishi mumkin.
- **Qaytarishlar** — `paymentAmount < 0` va `txType` "vozvrat" (kirillda) bilan boshlanadi.
- **Bank kirimi** — `Transaction` IN, COMPLETED. Ichida mijoz to'lovlari, o'z hisoblar orasidagi o'tkazmalar, qarz va boshqalar.
- "Tushum" so'zi aniq bo'lmasa — ikkalasini nomlab berish kerak.

## 6. OplatyKv — mijoz to'lovlari

- Loyihaning eng muhim jadvali (`OplataKv`, panelda rus harflarida nomlangan). Har qator — bitta to'lov: sana, shartnoma (`contractNo`), mijoz, obyekt, summa, to'lov turi (`txType`), kategoriya.
- Manba: bank tranzaksiyalaridan sync (`syncFromTransactions`, dedupe kaliti `sourceTxId` = `tx.externalId || tx.id`), Excel import, qo'lda qo'shish.
- `sourceTxId` — manba tranzaksiyaning kompozit ID'si. Excel-import qatorlarda u bo'sh, kompozit `id` ning o'zida. Shuning uchun kodda `sourceTxId || id` ishlatiladi.
- Sana ko'chishi dublikati (2026-09-24 tuzatilgan, commit `2043be4`): bank to'lov sanasini o'zgartirsa `externalId` o'zgarardi, `sourceTxId` eskisida qolib, to'lov ikkinchi marta qo'shilardi. Endi bog'lanish uch joyda yangi ID'ga ko'chiriladi (`sync.service.ts` sana siljishi, `reconcile.service.ts::fixTxDate`, `fixAllTxDate` → `relinkOplataKv`). 46 ta yetim qator tozalangan. Yetimni aniqlash: `oplata_kv.source_tx_id` ni `transactions.external_id` bilan LEFT JOIN. Qolgan xavf: Hamkor import qatorlari (`HB_IMP_...`) va `upsertOne` ichidagi bo'sh `externalId` sharti (tekshirilmagan).
- `crm_status` ustuni — CRM `virtual_status` (sotildi, barter, ipoteka...). CRM bu yorliqlarni buzuq kodlashda (mojibake) qaytaradi, kod tuzatadi. `NULL` = hali tekshirilmagan, `''` = tekshirildi, status yo'q.
- "Sotuv bo'limi" ustuni — `crm_contracts.branchName`. Faqat CRM `/index` (shartnoma filtri bilan) beradi. HECH QACHON `''` yozilmasin: backfill faqat `NULL` ni to'ldiradi, `''` abadiy qulflanadi.
- Tarix: `OplataKvHistory` (o'chirilganda butun qator snapshoti).
- Tashqi API delta-feed: `/api/v1/oplata-kv/changes` (kursor bilan, upsert va tombstone). Qoida: feed'dan o'chirishni hech qachon filtrlash mumkin emas (bir marta iste'molchida eski to'lovlar qolib ketgan).

## 7. Boshlang'ich va oylik split

- To'lov `firstInstallment` (boshlang'ich badal) va `monthlyAmount` (oylik) ga bo'linadi. `paymentCategory`: FIRST, MONTHLY, GENERAL (schetchik, split yo'q).
- Qoida (2026-08 tuzatilgan): CRM grafigi bo'yicha **waterfall** — grafik qadamlari sana tartibida (boshlang'ich va oylik aralash), har to'lov qaysi qadamni to'ldirsa shu turga; qadamni kesib o'tsa bo'linadi. Kod: `oplata-kv/installment-split.ts` (`buildSchedule`, `allocatePayment`, `categoryOf`), test `installment-split.spec.ts`. Avto split va qo'lda tugma ikkalasi shu funksiyani chaqiradi.
- XATO (CRM'da topilmagan) shartnomada split yo'q.
- "XATO → CRM" modulida CRM o'zi boshlang'ich/oylik desa, aynan o'sha qo'yiladi (`assignFromCrm`, `applyCrmSplit`), waterfall emas.
- Schetchik → oylik: "Za schetchik" (kirillda) turidagi qatorlarni oylikka o'tkazish (faqat OplatyKv o'zgaradi, cron bilan ham).
- Split mantiqi real hisobotlarga ta'sir qiladi. Sabab so'ralsa — faqat sabab, o'zgartirish emas.

## 8. Ot imeni klienta, perereboska

- **Vznos ot imeni klienta** (`backend/src/vznos/`, `VznosContract`) — kompaniyaning o'z shartnomalari reestri. Bu tushum emas. Qo'shilganda mos OplatyKv qatorlari shu turga o'tadi va obyekt hisobotidan chiqadi, manba tranzaksiya `xatoHidden=true` bo'ladi.
- **Perereboska** — bir shartnomadan boshqasiga pul o'tkazish (`PerereboskaGroup`). Qoidalar: bir obyekt ichida, bir manbadan ko'p maqsadga, maqsadlar jami = manba summasi, qoldiq yetarli, hujjat majburiy. Orqaga qaytarishda OplatyKv qatorlari o'chadi, guruh `cancelled` bo'lib tarixda qoladi.
- **AI perereboska** — arizani Claude o'qib taklif beradi, xodim tasdiqlaydi. Tuzoq: arizada 3 xil summa bo'ladi (o'tkazma, qaytarilgan, qayta to'lov); tanlash `perereboska-amounts.ts::decideTransferAmount` da.

## 9. XATO to'lovlar va tuzatish arizalari

- XATO = to'lovda shartnoma raqami bor, lekin CRM'da tasdiqlanmagan (`CrmContract found=true` ro'yxatida yo'q). Moslik ANIQ: kategoriyalash CRM kanonik raqamini saqlashi shart, aks holda topilgan to'lov ham XATO'da qoladi.
- Ikki ta'rif:
  - (a) tranzaksiya tomoni: `transactions.service.ts::clientXatoTransactions` — CLIENT kategoriya, `isContractManual=false`, manba IMPORT/ALOQA_BANK emas, `xatoHidden` emas;
  - (b) OplatyKv tomoni: `oplata-kv.service.ts::buildXatoFilter`, `countXatoForAgent` — faqat `xatoHidden` chiqariladi, qo'lda shartnoma berilgan XATO ham ko'rinadi.
  Bu ikki ro'yxat farq qilishi mumkin — qaysi biri ekanini ayt.
- Shartnoma ajratish: `categorization/contract-parser.ts` (suffikslar, bo'shliq, O va 0, I va 1 almashuvi). Bir raqamda bir necha CRM shartnoma bo'lsa — to'lov izohidagi ism bo'yicha tanlanadi.
- Tuzatish oqimi 2 bosqichli (`backend/src/correction/`): ariza (`XatoCorrectionRequest`, status pending) → tasdiqlash (fayl + shartnoma + kategoriya) yoki rad. Hech narsa avtomat tasdiqlanmaydi, istisno — AI agent.
- AI agent (`correction/agent-ai.service.ts`): arizani Claude vision bilan o'qiydi. Obyekt qoidasi: shartnoma raqamidagi raqamlardan keyingi 3 harf = obyekt, boshqa obyektga o'tkazib bo'lmaydi. Qaror: tasdiq, rad yoki odamga. `reviewedByType='agent'` — agent hal qilgan. `agentState`: processing, needs_review, done.
- Tuzatish bot (`backend/src/correction-bot/`) — Telegram orqali XATO to'lovni suhbat bilan tuzatish.
- XATO sonini hisoblash og'ir (katta `notIn` ro'yxati) — keshlanadi.

## 10. CRM (XonSaroy)

- Faqat o'qish so'rovlari: `/order/show`, `/order/index`, `/payment-history`. Yozish hech qachon yo'q.
- `CrmContract` — CRM kesh jadvali (`found`, mijoz, obyekt, status, branch).
- CRM lookup parametri buzilsa (ortiqcha filtr) — CRM 0 natija beradi; qo'lda qidiruv bilan parity saqlanadi (`crm.service.ts::searchContracts`).
- CRM matn maydonlarida buzuq kodlash (mojibake) bo'lishi mumkin.

## 11. Bank sync

- Cron har daqiqa tekshiradi, har bank o'z intervali bilan (`Bank.syncIntervalMinutes`, 0 = avto-sync o'chiq). Oxirgi ~10 kun qayta so'raladi.
- Asosiy kod: `sync/sync.service.ts` (`syncAccount`, `upsertOne`, `detectChanges`).
- **Login tuzog'i:** kunlik fetch xatosi (login yoki parol xatosi ham) log'ni PARTIAL qiladi, `errorMessage` bo'sh qoladi, `lastSyncedAt` baribir yangilanadi. Signal: oxirgi log PARTIAL, `fetched=0`, `errors` 10+. FAILED faqat tashqi exception'da.
- RUNNING log restartdan keyin qolib ketishi mumkin (boot tozalash yo'q). 15 daqiqadan eski RUNNING — uzilgan.
- `BankCredential.lastError`, `lastVerifiedAt` ni faqat qo'lda ulanish testi va parol moduli yozadi — eskirgan bo'lishi mumkin. Parol muddati maydoni yo'q.
- Qoldiq (`BankAccount.balance`) faqat oddiy sync'da yangilanadi, backfill'da emas. Hamkorbankda qoldiq statement orqali keladi.
- Banklar parolni majburan o'zgartiradi. Parolni avtomat topish moduli bor (`backend/src/bank-pwd/`), u kodli darvoza bilan himoyalangan.
- Proxy (forwarder) manzili va siri DB sozlamasida, panelda API Explorer orqali o'zgaradi.

## 12. Hamkorbank

- Alohida REST klient: `integrations/hamkorbank/hamkorbank.client.ts`. Sahifa hajmi kichik (20), "ma'lumot yo'q" kodi xato emas (bo'sh kun).
- Faqat sync va ID inspektor ishlaydi. Sverka, vipiska (statement), memorial order — Hamkor uchun yo'q.
- `txnDate` = hisobga tushgan sana (hujjat sanasi), karta surilgan vaqt emas (2026-09-24 qaror, commit `7d89575`).
- Karta to'lovlari bankda **settlement partiyasi** bo'lib ma'lum kunga tushadi — o'sha kun "shishgan" ko'rinadi, butun davr yig'indisi to'g'ri.
- O'tgan davrni bank API orqali olish amalda buzuq (juda sekin, bank bazasi xatosi). O'tgan davr uchun yagona yo'l — vipiska importi (`kind='hamkor-vipiska'`, `source=HAMKOR_IMPORT`). Dublikat himoyasi: `Transaction.hbDedupKey` + `@@unique([accountId, hbDedupKey])`.
- Import qilingan Hamkor yozuvlari real to'lov sifatida ishlanadi.

## 13. Bank tomonda o'zgargan to'lovlar

- `TransactionChangeLog.changeType`: DELETED, EDITED, MOVED.
- Tuzoq (2026-08-24 tuzatilgan): bank to'lovni boshqa kunga ko'chirsa, ilgari u noto'g'ri "o'chirilgan" deb belgilanib, bog'langan OplatyKv qatori ham o'chirilardi. Endi `detectChanges` o'chirish nomzodlarini bankdan ±3 kun tekshiradi: topilsa MOVED (sana yangilanadi, bog'lanish saqlanadi), topilmasa DELETED. Bankka ulanib bo'lmasa yoki nomzod 40 dan ko'p bo'lsa — o'chirilmaydi.
- Noto'g'ri o'chirilganlarni tiklash: "O'zgargan to'lovlar" sahifasida "Tiklash" (avval tekshirish).

## 14. Bank sverka

- Hisob va kun bo'yicha bank ↔ baza solishtirish (`transactions/reconcile.service.ts`). DB tomoni `txnDate` bo'yicha. Faqat Kapitalbank va Ipak Yo'li.
- Telegram xabari: `sverka-telegram/sverka-telegram.service.ts`, har 30 daqiqada (`autoSverkaNotify`), yagona digest xabar. Holat Setting'da (`sverka.telegram.notifiedToday`): hisob, bank, farq summasi, ayb (bank yoki biz), yopilgan belgisi. 20:00 da eslatma, 23:00 da u o'chiriladi.
- AI sverka agenti (`sverka-agent.service.ts`): farq sababini tushuntiradi, aybni tasniflaydi, tuzatish taklif qiladi (bankdan qo'shish, sana, summa). Tuzatish nishonlari server diagnostikasidan quriladi, AI to'qimaydi. Ayb faqat yuqori ishonchda ko'rsatiladi.
- Soxta farq sabablari: sync kechikishi (tahlil avval sync qiladi), vaqt zonasi (bir marta butun kun soxta farq bergan, tuzatilgan).
- Reconcile javobidagi `ok:true` — amal bajarildi degani, moslik emas. Haqiqiy holat `status==='mismatch'`.
- Reconcile jonli bank API'ga chiqadi va yozishi mumkin — agentlar uni chaqirmaydi.

## 15. Sverka CRM

- Shartnoma bo'yicha CRM to'lov tarixi ↔ OplatyKv (`backend/src/crm-sverka/`). Natija xotiradagi snapshotda, DB'da faqat holat (`crmSverka.lastRun`: status, vaqt, sonlar, xato).
- Snapshot 07:00, 12:00, 17:00 da (Toshkent) yangilanadi, 1 soatdan eski bo'lsa. Bekor qilingan shartnomalar ham kiradi, manfiy CRM yozuvlari "qaytarim" deb belgilanadi.
- Qator holatlari: mos, farqli, faqat CRM'da, faqat bizda. `diff = ourTotal - crmTotal`.
- Farq ro'yxati faqat panelda (Sverka CRM sahifasi).

## 16. Integratsiyalar

- **XonPay** (`backend/src/xonpay/`): sync log (`XonpaySyncLog`: running, success, failed, cancelled). "Server restart — orphan" failed qatorlari restart izi. Moslanmagan to'lovlar `isMatched=false`.
- **Google Sheets eksport** (`backend/src/google-export/`): OplatyKv → Sheets, har sheet o'z jadvali, log `ExportCronLog` (ok, error). Rejimlar: tozalab qayta yozish yoki upsert.
- **SHMITD** (`backend/src/shmitd/`): Google Sheet'dan hisobot → HTML → Telegram guruh, log `ShmitdLog` (sent, empty, error).
- **Kontragentlar** (`backend/src/counterparties/`): tashqi manbadan yangilanadi, `lastFetchError`.
- **Universal API** (`developer-api/universal-api.controller.ts`): tashqi tizimlar uchun obyekt to'lovlari, hisoblar, vipiska; `universal:read` scope. Tuzoq: obyekt endpointlarida `banks=` faqat bank ID oladi, hisob va vipiskada ID ham, kod ham. Har API chaqiruv `ApiRequestLog` ga yoziladi.

## 17. Kategoriyalash tuzog'i (Minfin / NDS)

- 2026-09-18 aniqlangan: 01.05.2026 dan beri ko'p tranzaksiya noto'g'ri "Moliya Vazirligi / NDS" kategoriyasida. Sabab: `categorization.service.ts` da soliq sharti `||` bilan — izohda "NDS" so'zi bo'lsa yetarli. Bank izohlarida "NDS bilan" deyarli har joyda bor.
- Haqiqiy byudjet to'lovi maqsad kodi va kontragent bilan aniqlanadi.
- Tuzatish rejasi shefim tasdiqlagan doirada: faqat 01.05.2026 dan, qo'lda qo'yilganlarga tegilmaydi, dryRun bilan.

## 18. Hisobotlar

- **Kunlik xulosa** (dashboard): `oplata-kv.service.ts::dailySummary` — kun, kecha, oy boshidan, 14 kunlik trend, top obyektlar. Bugun tanlansa, kecha bilan **shu soatgacha** solishtiriladi (`createdAt` bo'yicha), aks holda chalg'ituvchi foiz chiqadi.
- "Plan bo'yicha to'lov" widgeti olib tashlangan; `ContractSchedule` jadvali ishlatilmaydi.
- Billing jadvallari (`Customer`, `Contract`, `ContractStage`, `Payment`) deyarli ishlatilmaydi.

## 19. Audit va deploy

- `AuditLog` — faqat POST, PATCH, PUT, DELETE so'rovlar yoziladi (GET yo'q). Login alohida yoziladi. Tarix audit qo'shilgan kundan boshlanadi.
- Deploy holati: `deploy/deploy.service.ts::status` (deploy log oxiri va joriy commit). Deploy faqat o'zgargan qismni quradi: faqat hujjat o'zgargan commit frontend'ni qayta qurmaydi. Restart fazasi 5-8 daqiqa turishi odatiy.
- Yangi ruxsat kaliti: backend `auth/permissions.ts`, frontend `lib/permissions.ts` va `prisma/seed.ts` dagi ro'yxat — uchalasi.

## 20. Enum qiymatlari

| Enum yoki maydon | Qiymatlar |
|---|---|
| `TxnStatus` | PENDING, COMPLETED, FAILED, CANCELLED, REVERSED |
| `TxnDirection` | IN, OUT |
| `TxnSource` | SYNC, IMPORT, MANUAL, ALOQA_BANK, HAMKOR_IMPORT |
| `MatchStatus` | UNMATCHED, AUTO, MANUAL, PARTIAL, IGNORED |
| `SyncStatus` | RUNNING, SUCCESS, FAILED, PARTIAL |
| `TxChangeType` | DELETED, EDITED, MOVED |
| `OplataKvCategory` | MONTHLY, FIRST, GENERAL |
| `BankApiKind` | KAPITALBANK_V3, IPAK_YOLI_V1, HAMKORBANK_V1, GENERIC |
| `XatoCorrectionRequest.status` | pending, approved, rejected |
| `XatoCorrectionRequest.agentState` | processing, needs_review, done |
| `XonpaySyncLog.status` | running, success, failed, cancelled |
| `ShmitdLog.status` | sent, empty, error |
| `ExportCronLog.status` | ok, error |
| `PerereboskaGroup.status`, `VznosContract.status` | active, cancelled |

## 21. Og'ir va xavfli metodlar

- Og'ir (katta jadval, keshsiz): `TransactionsService.daily` (take'siz), `xatoContracts`, sanasiz `stats`; `OplataKvService.unsplitContracts`, `findOrphanTxRows`; `ApiKeyService.stats` (butun tarix). Sana oralig'i ko'pi bilan 31 kun.
- Tashqi so'rov yoki yon ta'siri bor (agent chaqirmaydi): `ReconcileService.*`, `SyncService.*`, CRM sverka start va ping, bank ulanish testi va parol ochish, `AgentAiService.status`, XonPay qayta moslash, deploy diagnostikasi, `/transactions/reconcile/today`.
- Jadvallarda tozalash (retention) yo'q: `SyncLog`, `ApiRequestLog`, `AuditLog`, `ExportCronLog`, `TransactionChangeLog`, `OplataKvHistory` doimiy o'sadi.

## 22. Maxfiy — hech qachon aytilmaydi

- Sirlar: bank credential (parol, login, sessiya), admin parol xeshi, API kalit siri, sir saqlovchi Setting kalitlari (bot tokenlari, AI kaliti, eksport credential, forwarder siri), `.env` qiymatlari, kodda qattiq yozilgan darvoza kodlari.
- Shaxsiy: mijoz telefoni, PINFL, email, manzil, karta; kontragent direktori ma'lumoti; IP manzillar.
- Og'ir xom JSON: `Transaction.metadata`, `rawExtra`, `TransactionChangeLog.oldData/newData`, `ShmitdLog.htmlContent`, CRM snapshot.
- Fayllar va ularning yo'llari (arizalarda pasport bo'lishi mumkin).
