# Tranzaksiyalar

## Vazifasi
Bank hisobidagi har kirim va chiqim `transactions` da bitta qator. Qator sync yoki importdan keladi (sync.md). Keyin `runRules` kategoriya va shartnoma raqamini qo'yadi, CLIENT qatorlardan OplatyKv to'ladi (oplata_kv.md). Kontragent va ta'minot ERP ma'lumoti ham shu qatorga yoziladi.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/transactions/transactions.service.ts` | ro'yxat, statistika, tozalash | `buildWhere`, `list`, `stats`, `daily`, `clientXatoTransactions`, `deleteRowById` |
| `backend/src/transactions/inspector.service.ts` | ID inspektor | `lookupFromBank` |
| `backend/src/transactions/statement.service.ts` | vipiska Excel | `build` |
| `backend/src/categorization/categorization.service.ts` | qoidalar, qo'lda tahrir | `runRules`, `setContract`, `setContractManual`, `fixMinfinCategory` |
| `backend/src/categorization/contract-parser.ts` | izohdan shartnoma | `extractContractCandidates`, `OBJECT_CODES` |
| `backend/src/counterparties/` | kontragentlar | `counterparties.service.ts::fetchEnrichment`, `syncFromXontaminot` |
| `backend/src/taminot/taminot.service.ts` | ta'minot ERP moslash | `matchTransactions` |
| `backend/src/attachments/attachments.service.ts` | ilova, Telegram xabari | `upload` |
| `backend/src/payments/payments.service.ts` | eski billing | `autoMatch` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/transactions`, `/transactions/stats`, `/transactions/daily` | `TRANSACTIONS_VIEW` | ro'yxat, statistika |
| GET | `/transactions/statement` | `TRANSACTIONS_VIPISKA_VIEW` | vipiska |
| POST | `/transactions/inspect-id` | `TRANSACTIONS_VIEW` | ID ni bankdan so'raydi |
| POST | `/transactions/delete-row-by-id` | `CLEANUP_RUN` | bitta qatorni o'chiradi |
| POST | `/transactions/cleanup-by-account` | SUPERADMIN | hisob qatorlari |
| POST | `/categorization/transactions/:id/set-contract` | `CATEGORIES_MANAGE` | qo'lda |
| POST | `/categorization/fix-minfin`, `/taminot/match` | `CATEGORIES_MANAGE` | ommaviy, dryRun default |
| * | `/counterparties/...` | `COUNTERPARTIES_VIEW`, `_MANAGE` | reestr |

## Frontend sahifalar
Yo'llar `frontend/app/[locale]/(panel)/` ichida.
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `transactions/page.tsx` | `/transactions`, `/categorization/...`, `/taminot/...` | `TRANSACTIONS_VIEW` |
| `statement/page.tsx` | `/transactions/statement` | `TRANSACTIONS_VIPISKA_VIEW` |
| `dashboard/page.tsx` | `/transactions/stats`, `/transactions/daily` | `DASHBOARD_VIEW` |
| `admin/cleanup/page.tsx` | `/transactions/find-by-payment-id` | `CLEANUP_VIEW` |
| `admin/counterparties/page.tsx` | `/counterparties/...` | `COUNTERPARTIES_VIEW` |
Komponentlar (`frontend/components/`): `transactions-tabs.tsx`, `id-inspector-dialog.tsx`, `purpose-modal.tsx`, `time-diagnostics-dialog.tsx`.

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `transactions` | sync, import, categorization, taminot, vznos | hamma | `external_id`, `txn_date`, `status`, `direction`, `amount`, `source`, `category_id`, `contract_number`, `is_contract_manual`, `xato_hidden`, `categorized_by`, `erp_*` |
| `counterparties` | counterparties | ro'yxat | `inn`, `is_manual`, `last_fetch_error` |
| `transaction_attachments` | attachments | ariza | `tx_id`, `storage_path` |
| `customers`, `contracts`, `payments` | eski billing (`autoMatch`, panel) | deyarli ishlatilmaydi: faqat `payments.service.ts::autoMatch` (har yangi IN sync tranzaksiyasi, `from_inn` bo'yicha) va `/customers`, `/contracts` sahifalari | `customers.inn`, `transactions.customer_id`, `match_status` |

## Biznes qoidalar
- `amount` so'm, Decimal(18,2), ishorasiz; yo'nalish `direction` (IN, OUT). `txn_date` UTC, Toshkent kuni +05:00 (`buildWhere`).
- `stats`, `daily` statusni filtrlamaydi: PENDING, CANCELLED ham kiradi.
- `runRules` tartibi: shartnoma topilsa CLIENT (CRM statusi reinvestitsiya yoki fiktiv bo'lsa emas, `isExcludedClientStatus`); MINFIN faqat `BUDGET_NAME_PARTS` yoki `BUDGET_PURPOSE_CODES` (08101, 08102, 08108, 08201, 09510, 00602); 00667 yoki izohda CORPORATE/TARIF (`KEYWORDS_BANK`) → BANK; SALARY; LOAN; o'z hisoblar orasida → TRANSFER.
- Shartnoma: raqam + `OBJECT_CODES` + dum; O va 0 bir xil. Saqlanadigani CRM kanonik raqami.
- Ta'minot: CLIENT emas; summa butun so'mda teng; sana farqi 2 kungacha (`MAX_DAY`); shartnoma tokeni (4+ belgi) yoki yetkazib beruvchi nomi. Natija faqat `erp_*`. ERP bazasi faqat o'qiladi.
- Kontragent: DIDOX asosiy, Chamber zaxira. Nostandart INN → `is_manual`. Cron `'0 8-22 * * *'` va `'*/5 * * * *'`, Asia/Tashkent.
- Vipiska faqat `KAPITALBANK_V3`, 92 kungacha. ID inspektor Kapital va Hamkor, ±2 kun.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `categorization.service.ts::runRules` → `oplata-kv.service.ts::syncFromTransactions` va XATO ikkala ta'rifi.
- `setContract`, `setContractManual` → `syncContractChangeToOplataKv` `oplata_kv` qatorini qayta yozadi, splitni tozalaydi.
- `deleteRowById`, `deleteByAccountNo` → bog'liq `oplata_kv` qatori ham o'chadi (`archiveAndDeleteOplataKv`).
- `OBJECT_CODES` da obyekt yo'q bo'lsa to'lov CLIENT bo'lmaydi.

## Xavfli joylar va tuzoqlar
- Minfin tarixi: 2026-09-18 gacha izohdagi `НДС` (NDS) so'zi yetarli edi, 21 863 qator noto'g'ri `Молия Вазирлиги` (Moliya vazirligi) bo'lgan. Commit f4993f8 tuzatdi. `fixMinfinCategory` `categorized_by = 'manual'` ga va 2026-05-01 dan oldingiga (standart) tegmaydi. Eskirgan.
- Ta'minot shartnomasini `contract_number` ga yozma: CRM topmaydi, qator XATO bo'ladi.
- XATO ro'yxatlari mos emas: `clientXatoTransactions` `is_contract_manual = false` filtrli, `buildXatoFilter` emas (xato.md).
- `q` qidiruvi (`description`, `from_name`, `external_id`) `contains`, indekssiz: faqat sana filtri bilan.
- `daily` take'siz, sanasiz `stats` butun jadvalni o'qiydi.
- `cleanup-by-account` ni ommaviy qaytarib bo'lmaydi. Snapshot `transaction_change_logs` (DELETED) va `oplata_kv_history` ga arxivlanadi. Tiklash faqat qatorma-qator: `/changes` sahifasi, `/transactions/changes/restore-one` (`CHANGED_TXN_RESTORE`). `payments` qatorlari arxivsiz o'chadi. Hisob `balance` va `last_synced_at` ham NULL bo'ladi. Taklif qilma.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi obyekt kodi | `contract-parser.ts::OBJECT_CODES` |
| Kategoriya qoidasi | `categorization.service.ts::runRules` |
| Ro'yxat filtri | `transactions.service.ts::buildWhere` |
| Ta'minot mezoni | `taminot.service.ts::matchTransactions` |
