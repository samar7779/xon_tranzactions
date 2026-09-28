# Bank sync va ulanishlar

## Vazifasi
Panelda bank (`banks`), ulanish (`bank_credentials`) va hisob (`bank_accounts`) sozlanadi. `SyncService.tick` har daqiqa faol hisoblarni bank API'dan o'qib `transactions` ga yozadi va bank tomondagi o'zgarishni (`detectChanges`) topadi. O'tgan davr va API'siz manbalar import bilan keladi.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/sync/sync.service.ts` | sync, backfill, o'zgarishlar | `tick`, `bulkScheduleTick`, `syncAccount`, `upsertOne`, `makeCompositeId`, `detectChanges`, `recoverFalselyDeleted` |
| `backend/src/integrations/kapitalbank/kapitalbank.client.ts` | Kapital va Ipak | `getDoc1C`, `apiLogin` |
| `backend/src/integrations/hamkorbank/hamkorbank.client.ts` | Hamkor REST | `getStatementDay`, `getAccountList` |
| `backend/src/integrations/hamkorbank/hamkor-dedup.util.ts` | Hamkor dublikat kaliti | `hamkorDedupKey` |
| `backend/src/import/import.service.ts` | importlar | `importExcel`, `commitHamkorVipiska`, `deleteBatch` |
| `backend/src/bank-credentials/bank-credentials.service.ts` | ulanish testi | `testConnection` |
| `backend/src/bank-pwd/bank-pwd.service.ts` | parol nomzodlari | `tryCandidates` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/sync/account/:id`, `/sync/run-all`, `/sync/backfill` | `SYNC_RUN` | qo'lda sync |
| GET | `/sync/logs`, `/sync/settings` | `SYNC_VIEW` | log, sozlama |
| POST | `/import/transactions`, `/import/hamkor-vipiska/commit` | `SYNC_RUN` | import |
| POST | `/bank-credentials/:id/test` | `CREDENTIALS_TEST` | ulanish testi |
| POST | `/bank-pwd/try` | `CREDENTIALS_MANAGE` + kod | parol sinash |
| GET, PATCH | `/api-explorer/forwarder` | `CREDENTIALS_MANAGE` | proxy sozlamasi |
| POST | `/transactions/changes/recover` | `CHANGED_TXN_CHECK` | noto'g'ri o'chganni tiklash |

## Frontend sahifalar
Yo'llar `frontend/app/[locale]/(panel)/` ichida.
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `setup/banks`, `setup/credentials`, `setup/accounts` | `/banks`, `/bank-credentials`, `/bank-pwd`, `/sync` | `BANKS_VIEW`, `CREDENTIALS_VIEW`, `ACCOUNTS_VIEW` |
| `changes/page.tsx` | `/transactions/changes/...` | `CHANGED_TXN_VIEW` |
| `admin/sync-logs`, `admin/import`, `admin/login` | `/sync/logs`, `/import/...`, `/bank-credentials/auth-issues` | `SYNC_VIEW`, `IMPORT_VIEW`, `ADMIN_LOGIN_VIEW` |
| `admin/api-explorer` | `/api-explorer/...` | `API_EXPLORER_VIEW` (tab); API chaqiruvlari `CREDENTIALS_MANAGE` |
Komponentlar: `sync-progress-dialog.tsx`, `vipiska-debug-dialog.tsx`.

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `banks` | panel, seed | sync | `code`, `api_kind`, `sync_interval_minutes` |
| `bank_credentials` | panel, bank-pwd | sync | `password_enc`, `use_proxy`, `last_error` |
| `bank_accounts` | panel, sync | hamma | `sync_enabled`, `balance`, `last_synced_at` |
| `sync_logs` | sync | panel, Facts | `status`, `fetched`, `errors`, `error_message` |
| `transaction_change_logs` | sync, tozalash | `/changes` | `change_type`, `old_data` |
| `import_batches` | import | panel | `kind`, `rows_added` |

## Biznes qoidalar
- `api_kind`: `KAPITALBANK_V3`, `IPAK_YOLI_V1`, `HAMKORBANK_V1` sync qilinadi, `GENERIC` yo'q (`tick`).
- `sync_interval_minutes` default 5, 0 = avto-sync o'chiq. Sync oxirgi `TXN_SYNC_DAYS_BACK` (default 10) kunni oladi, `sync.minDate` dan oldingini emas. `bulkScheduleTick`: `bulkSync.*`, kuniga 1 marta; backfill qoldiqqa tegmaydi.
- Parol `CRED_ENC_KEY` bilan AES-256-GCM (`password_enc`).
- Summa bankdan tiyin, 100 ga bo'linib so'm. Bank state 3 → COMPLETED, 6 → CANCELLED, qolgani PENDING.
- `external_id` = `[IP_|HB_]general_id_num_ddate_accCt_accDt_summa_ishora` (`makeCompositeId`), ichida sana bor.
- Login xatosi ham `PARTIAL`, `error_message` bo'sh, `last_synced_at` baribir yangilanadi. `FAILED` faqat exception. RUNNING 15 daqiqadan eski = uzilgan (`leader-health.service.ts::checkBankSync`).
- `detectChanges`: yo'qolgan qator bankdan ±3 kun tekshiriladi. Topilsa MOVED (sana yangilanadi, OplatyKv bog'lanishi qoladi), yo'q bo'lsa DELETED. Bankka ulanmasa yoki nomzod 40 dan ko'p bo'lsa hech narsa o'chmaydi.
- Hamkor: `@@unique([accountId, hbDedupKey])`; `pageSize` 20 dan oshsa `-802`; `-5` = operatsiyasiz kun. `txn_date` = hisobga tushgan sana (ddate), karta vaqti emas (commit 7d89575). O'tgan davr faqat vipiska importi (`HAMKOR_IMPORT`).
- Forwarder: setting `bank.forwarderUrl`, `bank.forwarderSecret`; zaxira `BANK_FORWARDER_*`. Bank whitelist'i har login uchun alohida IP.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `makeCompositeId` → `oplata_kv.source_tx_id` va `oplata_kv.id`: format o'zgarsa to'lov qayta qo'shiladi.
- `upsertOne` sana ko'chishi → `source_tx_id` yangi ID ga ko'chadi; `reconcile.service.ts::relinkOplataKv` ham.
- `fetchDoc1C(apiKind)` → faqat Hamkor yangi klientga ketadi. Kapital va Ipak yo'liga tegma.
- DELETED → `cascadeOplataKvDelete` OplatyKv qatorini o'chiradi.

## Xavfli joylar va tuzoqlar
- 2026-08-25 gacha (commit 3c0684f, tiklash c83d315) ko'chgan to'lov DELETED bo'lib OplatyKv qatori o'chardi. Tiklash: `recoverFalselyDeleted`.
- 2026-09-24 gacha sana ko'chsa `source_tx_id` eskida qolib to'lov 2 marta qo'shilardi (commit 2043be4).
- `sync_exclusion_ranges` faqat ma'lumot: tekshiruv kunlik sync'ni buzgan, olib tashlangan (commit d19dc52).
- Hamkor settlement kuni shishishi xato emas.
- Hamkor endpoint `capi-lab` (bo'sh dev baza) da qolmasin.
- `upsertOne` OR ichidagi `{ externalId: item.b2_id || undefined }` bo'sh shartga aylanib begona qatorga mos kelishi mumkin (tekshirilmagan).
- `SyncService.*`, `testConnection`, bank-pwd tashqi so'rov va yozuv qiladi: agent chaqirmaydi.
- Boshqa loyihaning `bank-proxy.php` siga tegma.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi bank turi | `sync.service.ts::fetchDoc1C`, `tick` |
| Hamkor maydonlari | `hamkorbank.client.ts` |
| O'chgan va ko'chgan qoida | `sync.service.ts::detectChanges` |
