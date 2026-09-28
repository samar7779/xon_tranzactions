# Eksport

## Vazifasi
Admin > Export sahifasi. (1) Google Sheets: `oplata_kv` yoki `transactions` qatorlarini jadvalga yozadi (qo'lda yoki cron), log `export_cron_logs`. (2) Autsourcing: tanlangan shartnomalar Excel'i Telegram guruhga. (3) SHMITD: Shmidt bolg'asi sinovlari Sheet'idan sana bo'yicha HTML hisobot guruhga, log `shmitd_logs`. Yana 10 formatda yuklab olish.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/google-export/google-export.service.ts` | Sheets, autsourcing, fayl | `run`, `upsertRows`, `exportSheetsCronTick`, `autsourcingCronTick`, `sendAutsourcing` |
| `backend/src/google-export/google-export.plan.ts` | upsert rejasi | `planUpsertRows` |
| `backend/src/google-export/google-export.controller.ts` | `/api/google-export/*` | `saveConfig` |
| `backend/src/shmitd/shmitd.service.ts` | SHMITD | `sendNow`, `buildReport`, `cronTick` |
| `backend/src/oplata-kv/oplata-kv.service.ts`, `backend/src/transactions/transactions.service.ts` | manba qatorlar | `getRowsForExport`, `countForExport` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/google-export/config`, `distinct-filters`, `upsert-keys`, `cron/logs` | `export:view` | config, filtrlar, yozilgan ID, log |
| PUT, POST, DELETE | `/api/google-export/config`, `credentials` | `export:manage` | `export.sheets` saqlash; service account JSON shifrlab saqlash, o'chirish |
| POST | `/api/google-export/test`, `preview-count` | `export:view` | ruxsat tekshiruvi; qator soni (yozmaydi) |
| POST | `/api/google-export/run` | `export:run` | bitta sheet, `runAndLog('manual')` |
| GET | `/api/google-export/download` | `export:download` | fayl |
| GET, PUT, POST | `/api/google-export/autsourcing/config`, `autsourcing/send` | `export:autsourcing` | sozlama, yuborish |
| GET, PUT, POST | `/api/shmitd/config`, `history`, `history/:id/html`, `send` | `export:view`, `export:manage`, `export:run` | sozlama, tarix, HTML, yuborish |

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `frontend/app/[locale]/(panel)/admin/export/page.tsx` | yuqoridagi hammasi | `export:view`; Autsourcing va SHMITD tablari `export:autsourcing` bilan |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `export_cron_logs` | `GoogleExportService.logExportRun` | `cron/logs`, Facts `google_export` | `sheet_id`, `sheet_name`, `source` (oplatakv, transaction), `write_mode` (replace, upsert), `mode` (cron, manual), `status` (ok, error), `rows_fetched`, `rows_written`, `duration_ms`, `error`, `triggered_by`, `started_at` |
| `shmitd_logs` | `ShmitdService.sendNow` | `history`, Facts `telegram_notify` | `target_date` (dd.MM.yyyy), `sent_at`, `status` (sent, empty, error), `total_count`, `yellow_count`, `red_count`, `error`; `html_content`, `group_id` Facts'ga berilmaydi |
| `settings` | service | service | `export.sheets`, `export.credentials`, `export.writtenIds.*`, `export.upsertKeys.*`, `autsourcing.*`, `shmitd.*` |

## Biznes qoidalar
- Manba: `source = 'transaction'` bo'lsa `transactions` (filtr faqat hisob raqami), aks holda `oplata_kv` (objects, categories MONTHLY/FIRST/GENERAL, txTypes, amountSign pos/neg). Oraliq `dateFrom` → bugun (Toshkent). `validateTarget`.
- Hujayraga summa so'm, ishora bilan (qaytarish manfiy); CRM'da tasdiqlanmagan shartnoma o'rniga `XATO`. `cellValue`.
- replace: mapping ustunlari `startRow` dan pastga tozalanib qayta yoziladi. upsert: `keyField` bo'yicha yangilaydi, yangisini birinchi to'lov blokidan keyin qo'shadi, faqat o'zi yozgan (`export.upsertKeys.*`) va DB'dan yo'qolgan qatorni tozalaydi. `upsertRows`, `planUpsertRows`.
- Cron: `cron.enabled`, `days` (0 = yakshanba, bo'sh = har kun), `hourFrom`/`hourTo`, `everyMinutes` (default 60).
- Credential tartibi: `GOOGLE_SA_JSON` → `GOOGLE_SA_KEYFILE` → setting `export.credentials`. Jadval service account `client_email` bilan share qilinishi shart.
- Autsourcing: `autsourcing.contracts`, `autsourcing.columns`, `autsourcing.dateFrom`; cron `autsourcing.cronEnabled` + `autsourcing.cronTime`, kuniga 1 marta. `autsourcing.botToken`, `autsourcing.groupId`.
- SHMITD: sana `shmitd.dateOffset` (default -1 = kecha); G ustuni shu sanaga teng qatorlar; sariq = K>L va J<L, qizil = J>L (`buildReport`). Cron `shmitd.enabled` + `shmitd.cronTimes`. SA: avval `shmitd.saJson`, keyin `GOOGLE_SA_JSON`. empty = o'lchov yo'q, xato emas.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `oplata-kv.service.ts::getRowsForExport` → Sheets eksport va `downloadData`.
- `export.sheets` tuzilmasi → `chek-order.service.ts` (`readContractsPayments` sheet'ni o'qiydi).
- `planUpsertRows` → `google-export.plan.spec.ts`.
- `export.writtenIds.*` (OplatyKv manbasida) = `oplata_kv.id`, `/api/v1/oplata-kv/changes` kaliti.

## Xavfli joylar va tuzoqlar
- 2026-08: filtr saqlanmasdi. Global `ValidationPipe` (whitelist+transform) nested `filter` ni qirqardi; method-level `@UsePipes` yordam bermaydi. Yechim: `saveConfig(@Body() body: any)`. DTO'ga qaytarma.
- 2026-08: upsert yangi qatorni bron zonasiga yozardi. Yechim `planUpsertRows`. `lastRowColumn` faqat log'da.
- upsert jadvalni tozalamaydi: filtr "ishlamaydi" ko'rinadi. Toza natija = replace.
- `getRowsForExport` og'ir, `take` default 100 000, sana o'sish tartibida: katta oraliqda eng yangilari tushib qoladi.
- `started_at` = run tugagan payt. `cronLastRun` restartda bo'shaydi.
- SHMITD token yoki guruh yo'q bo'lsa log yozilmaydi. Autsourcing log jadvali yo'q.
- Retention yo'q. Sir qiymatlari o'qilmaydi.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi ustun maydoni | `google-export.service.ts::FIELD_KEYS`, `TX_FIELD_KEYS`, `cellValue` |
| Yangi filtr | `validateTarget`, `oplata-kv.service.ts::getRowsForExport`, `countForExport` |
| Autsourcing ustuni | `OPLATA_COLS`, `buildAutsourcingXlsx` |
| SHMITD rang qoidasi | `shmitd.service.ts::buildReport` |
