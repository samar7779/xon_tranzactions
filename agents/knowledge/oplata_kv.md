# OplatyKv (kvartira to'lovlari)

## Vazifasi
UI `ОплатыКв` (OplatyKv) = Prisma `OplataKv` = SQL `oplata_kv`, loyihaning eng muhim jadvali. Har qator bitta shartnoma to'lovi. Qator CLIENT tranzaksiyadan (`syncFromTransactions`), Excel importdan yoki qo'lda keladi, keyin obyekt, mijoz va boshlang'ich/oylik split to'ldiriladi. Dashboard, eksport va `/api/v1` shu jadvalni o'qiydi.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/oplata-kv/oplata-kv.service.ts` | asosiy | `autoSyncTick`, `syncFromTransactions`, `splitInstallments`, `buildObjectReportWhere`, `dailySummary`, `schotchikToMonthly`, `createPerereboska`, `clampFutureUpdatedAt` |
| `backend/src/oplata-kv/installment-split.ts` | split qoidasi | `buildSchedule`, `allocatePayment` |
| `backend/src/oplata-kv/perereboska-amounts.ts` | ariza summalari | `decideTransferAmount` |
| `backend/src/oplata-kv/memorial-order/memorial-order.service.ts` | memorial order PDF | `generatePdf`, `fillFromBank` |
| `backend/src/vznos/vznos.service.ts` | vznos reestri | `create`, `cancel`, `recategorizePayments` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/oplata-kv`, `/oplata-kv/by-object`, `/oplata-kv/daily-summary` | `OPLATAKV_VIEW` | ro'yxat, hisobot |
| POST | `/oplata-kv/sync-now` | `OPLATAKV_SYNC` | tranzaksiyadan sync |
| POST | `/oplata-kv/split-installments`, `/oplata-kv/:id/split` | `OPLATAKV_SPLIT` | split |
| POST | `/oplata-kv/perereboska`, `/oplata-kv/perereboska/analyze` | `OPLATAKV_CREATE` | perereboska |
| DELETE | `/oplata-kv/perereboska/:groupId` | `OPLATAKV_DELETE` | orqaga qaytarish |
| GET | `/oplata-kv/memorial-order` | `OPLATAKV_VIEW` | PDF |
| * | `/vznos/...` | `VZNOS_VIEW`, `VZNOS_MANAGE` | reestr |

## Frontend sahifalar
Sahifalar `frontend/app/[locale]/(panel)/`, `.tsx` komponentlar `frontend/components/` ichida.
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `oplatykv/page.tsx`, `oplatykv/layout.tsx` | `/oplata-kv/...` | `OPLATAKV_VIEW` |
| `vznos/page.tsx` (sub-tab: `transactions-tabs.tsx`) | `/vznos/...` | `VZNOS_VIEW` |
| `daily-summary-widget.tsx` (dashboard) | `/oplata-kv/daily-summary` | `DASHBOARD_OBJECTS` (widget); API `OPLATAKV_VIEW` |
| `ai-perereboska-module.tsx` | `/oplata-kv/perereboska/...` | `OPLATAKV_CREATE` |
| `plan-viewer-dialog.tsx` | `/oplata-kv/contract-plan` | `OPLATAKV_VIEW` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `oplata_kv` | sync, import, panel, vznos | hamma | `contract_no`, `date`, `payment_amount`, `first_installment`, `monthly_amount`, `payment_category`, `tx_type`, `object`, `source_tx_id`, `was_manually_edited` |
| `oplata_kv_history` | OplatyKv, sync, tozalash | tiklash, API | `action`, `changes` |
| `perereboska_group` | perereboska | tarix | `status`, `destinations` |
| `vznos_contract` | vznos | vznos | `contract_no`, `status` |

## Biznes qoidalar
- Summa so'm, ishorali: `+` to'lov, `-` qaytarish yoki perereboska manbai. `date` vaqtsiz; kun ichidagi vaqt faqat `created_at` da.
- `syncFromTransactions`: CLIENT kategoriya, `contract_number` bor, IN va OUT (OUT manfiy). Kalit `source_tx_id` = `external_id` yoki `id`, unique. `tx_type` = tranzaksiya subkategoriyasi nomi. XATO shartnoma ham qo'shiladi.
- `autoSyncTick`: kunduz `oplatykv.dayStart`..`dayEnd` (default 08:00-22:00) har `oplatykv.txAutoSyncMinutes` daqiqa, limit 1000 (0 yoki bo'sh = o'chiq); tun `oplatykv.nightStart`..`nightEnd` (default 01:00-07:50) kuniga 1 marta to'liq. `created_by_name`: `cron · day`, `cron · night-batch`. Avto-XATO o'chirish ataylab yo'q.
- Split faqat `installment-split.ts` waterfall: CRM grafigi sana tartibida, boshlang'ich va oylik aralash; auto va qo'lda bitta funksiya. XATO shartnomada split yo'q. CRM aniq split bersa `assignFromCrm`, `applyCrmSplit` qiymati.
- Schetchik: `tx_type = 'За счетчик'` (schetchik) qatorlar oylikka (`schotchikToMonthly`, `schotchik.*`), panelda parol bilan. `categorization.backfillSchotchik` boshqa narsa.
- Perereboska: manba va maqsad bir obyektda (CRM obyekt nomi), maqsadlar jami = manba summasi, qoldiq yetarli (lock ostida), hujjat majburiy. Qaytarishda qatorlar o'chadi, guruh `cancelled` qoladi.
- Obyekt hisoboti va kunlik xulosa: `payment_amount > 0` va `tx_type` ichida `взнос` (vznos); obyekt hisoboti `от имени` (ot imeni) qatorini chiqaradi. `dailySummary` bugunni kechaning shu soatigacha (`created_at`) solishtiradi.
- Vznos qo'shilsa: qatorlar `tx_type` = `Взнос от имени клиента` (vznos ot imeni klienta), manba tranzaksiya `xato_hidden = true`.
- `crm_status` = `crm_contracts.virtual_status`, sotuv bo'limi = `branch_name`: NULL = tekshirilmagan, '' = yo'q (crm.md).

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `installment-split.ts` → auto va qo'lda split, `installment-split.spec.ts`.
- `updated_at` → `/api/v1` delta kursori (api.md). Raw SQL'da `NOW()` yozma, app vaqti parametr; `clampFutureUpdatedAt` har daqiqa tuzatadi.
- `tx_type` matni → obyekt hisoboti, kunlik xulosa, Facts `client_income`.
- `oplatykv.*` sozlama kalitlari (`txAutoSyncMinutes`, `txMinDate`, `dayStart`, `dayEnd`, `nightStart`, `nightEnd`) → Facts `oplatykv_sync.sozlamalar` va Checker `[oplatykv_sync]` (`checker_worker.py::_check_oplatykv_sync`, tekshiruv oynasi `dayStart` + 120 daq .. `dayEnd`). Kalit nomi o'zgarsa `support_facts.py` va `checker_worker.py` ham tuzatiladi.
- `source_tx_id` → sana ko'chishi va `relinkOplataKv` (sync.md).

## Xavfli joylar va tuzoqlar
- Sana ko'chishi dublikati 2026-09-24 da tuzatildi, 46 yetim qator o'chirilgan. Yetim = `source_tx_id` IS NOT NULL va unga mos `transactions.external_id` ham, `transactions.id` ham yo'q (`findOrphanTxRows`).
- `findOrphanTxRows`, `getRowsForExport` og'ir: agent chaqirmaydi. Yetim soni va summasi Facts `oplatykv_sync.yetim` da (oxirgi 30 kun).
- `dailySummary` server soatiga bog'liq.
- Memorial order faqat o'qiydi; bankdan faqat Kapital va Ipak hisoblari.
- `syncFromTransactions` mavjud qatorda `tx_type` ni tranzaksiya subkategoriyasi nomiga, `contract_no` ni `transactions.contract_number` ga tenglaydi. Shu sabab `recategorizePayments` qo'ygan `Взнос от имени клиента` (vznos ot imeni klienta) va `cancel` qo'ygan yangi `contract_no` keyingi sync'da qaytib ketadi (tranzaksiya subkategoriyasi boshqa bo'lsa; `recategorizePayments` subkategoriyaga tegmaydi). Bu `oplatykv.txMinDate` dan keyingi qatorlarga tegishli: kunduzgi rejimda oxirgi 1000 CLIENT tx, tungi batch'da hammasi (tasdiqlangan).
- Planirovka rasmi: XonSaroy admin API kutilyapti. `contract_schedules` dormant.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Split qoidasi | `installment-split.ts::allocatePayment` |
| Obyekt hisoboti filtri | `oplata-kv.service.ts::buildObjectReportWhere` |
| Avto-sync | `autoSyncTick`, `sync/settings.service.ts` |
| Perereboska qoidasi | `oplata-kv.service.ts::createPerereboska` |
