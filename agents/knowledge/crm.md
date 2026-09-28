# CRM (XonSaroy)

## Vazifasi
XonSaroy CRM bilan faqat o'qish integratsiyasi. Egasi qoidasi: CRM'ga hech qachon yozilmaydi. Oqim: izohdan shartnoma raqami ajratiladi → `crm_contracts` keshi yoki CRM `/show` → `found=true` bo'lsa mijoz, obyekt, status keshlanadi. Keshni XATO ta'rifi, OplatyKv ustunlari (`crm_status`, sotuv bo'limi, turi), split, XATO → CRM va CRM sverka ishlatadi.

## Fayllar
Yo'llar `backend/src/` ichida.

| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `crm/crm.service.ts`, `crm.controller.ts` | CRM HTTP (Basic auth), MySQL | `show`, `searchContracts`, `search`, `getContractMeta`, `getPaymentHistory`, `getPaymentHistoryAll`, `findByComposite`, `matchComposites`, `contractMedia` |
| `categorization/crm-contract-cache.service.ts` | kesh va backfill | `lookup`, `fetchFromCrmAndCache`, `refreshVirtualStatus`, `crmMetaBackfillTick`, `applyIndexBranches` |
| `categorization/contract-parser.ts` | raqam ajratish | `extractContractCandidates`, `contractVariants` |
| `oplata-kv/oplata-kv.service.ts` | status backfill | `crmStatusBackfillTick`, `reverifyXato` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/crm/search`, `/crm/show` | `crm:view` | `/index` qidiruv, `/show` tafsilot |
| GET | `/crm/payment-history` | `crm:view` | `/payment-history/excel` proksi |
| GET, POST | `/crm/find-by-composite`, `/crm/match-composites` | `crm:view`, `oplatakv:view` yoki `oplatakv:xato_crm` (biri yetarli) | kompozit ID → CRM to'lov |
| GET, POST | `/oplata-kv/crm-status/*`, `/oplata-kv/crm-meta/backfill` | `oplatakv:view` | status va branch servis |
| POST | `/oplata-kv/reverify-contracts` | `oplatakv:sync` | XATO'ni qayta kategoriyalash |

## Frontend sahifalar
Yo'llar `frontend/app/[locale]/(panel)/` ichida.

| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `oplatykv/crm/page.tsx` | `/crm/search`, `/crm/show` | `crm:view` |
| `crm/page.tsx` | yo'q, `/oplatykv/crm` ga redirect | |
| `admin/sync-logs/page.tsx` | `reverify-contracts`, `reverify-status` | `sync:view` (tab, `SYNC_VIEW`); API: `reverify-contracts` `oplatakv:sync`, `reverify-status` `oplatakv:view` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `crm_contracts` | `crm-contract-cache.service.ts` (lookup, backfill, `refreshVirtualStatus`), `crm.service.ts::search` (panel qidiruvi ham keshga yozadi), `oplata-kv.service.ts` (`fixClientNamesFromCrm`), `categorization.service.ts` (`deleteMany`). `crmStatusBackfillTick` o'zi yozmaydi, `refreshVirtualStatus` ni chaqiradi | XATO, `oplata_kv` ro'yxati, split | `contract_number` (PK), `found`, `customer_name`, `status`, `virtual_status`, `object_name`, `apartment_number`, `crm_order_id`, `branch_name`, `property_type` (parking, apartment), `raw_snapshot`, `last_verified_at`, `last_error` |

## Biznes qoidalar
- Kesh muddati `crm-contract-cache.service.ts::STALE_AFTER_MS`: `found=true` 24 soat (keyin fonda yangilanadi), `found=false` 4 soat (`NOT_FOUND_RETRY_AFTER_MS`, keyin qayta so'raladi).
- `fetchFromCrmAndCache`: 8 variantgacha `/show`, topilmasa `searchContracts` fallback (4 variant), aks holda `found=false`, `last_error='Topilmadi'`.
- Sentinel (`virtual_status`, `branch_name`): NULL = tekshirilmagan, '' = tekshirildi, yo'q. CRM javob bermasa '' yozilmaydi (`refreshVirtualStatus`, `applyIndexBranches`). Istisno: `/index` fallback (`searchContracts`) orqali yaratilgan qatorda `virtual_status = ''` tekshirilmasdan yoziladi va backfill uni qayta olmaydi (`resetEmptyVirtualStatus` ham tegmaydi, `raw_snapshot` yo'q). '' ni "CRM'da status yo'q" deb aniq aytma.
- Mojibake: CRM `virtual_status` yorlig'ini UTF-8 baytlarini CP1251 qilib beradi (`Сотилди`, ya'ni sotildi, buzilib keladi). `repairMojibake` tuzatadi, natijada U+FFFD bo'lsa asl matn qoladi.
- Sotuv bo'limi manbai faqat shartnoma filtrli `/index` (`getContractMeta`, `created_by.branch`). `/show` va bulk `/index` page-walk branch bermaydi. Turi (`property_type`) faqat `/show` `type.key` dan.
- Backfill: `crmStatusBackfillTick` (200 tadan) va `crmMetaBackfillTick` har daqiqa, running lock, konvergent. `''` → NULL reset bir martalik (marker `__BRANCH_RESET_DONE_V1__`).
- Parity: `show` va `/index` fallback `searchContracts` bilan bir xil minimal param (`is_trashed`, `trashed_status`, `with_trashed`). Ortiqcha param (`status: 'all'`, `cancelled`) CRM'da 0 natija bergan.
- `/payment-history`: server-side filtrlar (`transaction_id`, `contract`, `object_id`, `date_from`/`date_to`). `external_id` = bizning kompozit ID, ichidagi summa tiyin; `amount`, `initial_amount`, `monthly_amount` so'm.
- `getPaymentHistory` (faqat aktiv) va `getPaymentHistoryAll` (CRM sverka, bekor ham) alohida. `getPaymentHistory` ni XonPay sync, `getCrmIndex`/`bulkMatch` (`bulk-crm-fix`, XATO → CRM) va `findByComposite` ning oxirgi zaxira skaneri ishlatadi.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `crm.service.ts::show` → kesh, kategoriyalash, `splitSingleRow`, chek-order, `public-api.controller.ts`.
- `searchContracts` → tuzatish boti, `xato-list`, kesh fallback, correction ariza snapshoti.
- `getPaymentHistory` → `xonpay/xonpay.service.ts` (XonPay sync), `crm.service.ts::getCrmIndex`/`bulkMatch` (`bulk-crm-fix`, XATO → CRM), `findByComposite` zaxira skaneri va `/crm/payment-history` proksi: o'zgartirsang, ularning hammasi ta'sirlanadi.

## Xavfli joylar va tuzoqlar
- CRM'ga yozadigan yangi funksiya egasi ruxsatisiz qilinmaydi.
- CRM javob bermasa `fetchFromCrmAndCache` "topilmadi" dan farqlamaydi: `found=false` yoziladi (eskirgan `found=true` ni fon yangilash ham). Keyingi lookup'gacha (kamida 4 soat) XATO; chora `reverify-contracts`.
- `branch_name = ''` = tekshirildi, bo'lim yo'q (`applyIndexBranches` yozadi). Drenaj (`drainNullBranches`) va bulk page-walk faqat NULL ni to'ldiradi, shuning uchun CRM javob bermaganda '' yozish eski shartnomani qulflab qo'yadi. Recency backfill (`backfillBranchRecency`, so'nggi to'lovlar shartnomalari) '' ni ham qayta tekshiradi.
- `crm_contracts` da ikki marker qatori (`__BRANCH_RESET_DONE_V1__`, `__PT_SWEEP_DONE_V1__`, `found=false`): sanashda chiqarib tashla.
- `raw_snapshot` va `phone` da telefon, pasport seriyasi bor; MySQL (`fetchClientExtras`) pasport, manzil beradi. Facts va javobga berilmaydi.
- `search` (panel CRM tabi) qo'shimcha `cancelled: 1` yuboradi, parity faqat `show` va `searchContracts` orasida.
- Shaxmatka va planirovka kechiktirilgan: client API plan va inventar bermaydi (404), admin API 401.
- Env faqat nomi: `XONSAROY_API_URL`, `XONSAROY_CLIENT_BASE`, `XONSAROY_API_KEY`, `XONSAROY_API_SECRET`, `XONSAROY_S3_BASE`, `XONAPP_MYSQL_*`.
- CRM to'xtasa: kategoriyalash, XATO tekshiruvi, backfill, split, CRM sverka, XonPay sync to'xtaydi.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| CRM'da bor, avto topmayapti | `crm.service.ts::show` param, `fetchFromCrmAndCache`, `categorization.service.ts::runRules` |
| `crm_status` bo'sh yoki buzuq | `refreshVirtualStatus`, `extractVirtualStatus` |
| Sotuv bo'limi bo'sh | `applyIndexBranches`, `crm.service.ts::getContractMeta` |
