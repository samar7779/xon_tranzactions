# Universal API

## Vazifasi
Tashqi tizimlar uchun faqat o'qish REST API. So'rov `X-API-Key` + `X-API-Secret` sarlavhalari bilan. `ApiKeyAuthGuard` kalit va scope'ni tekshiradi, `ApiLoggerInterceptor` chaqiruvni `api_request_logs` ga yozadi. Asosiy: OplatyKv delta-feed va Universal API.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/developer-api/api-key.service.ts` | kalit, auth, log | `create`, `validateCredentials`, `writeLog`, `stats` |
| `backend/src/developer-api/api-scopes.ts` | 5 scope | `API_SCOPES`, `API_SCOPE_CATALOG` |
| `backend/src/developer-api/public-api.controller.ts` | `/api/v1/*` | `changesOplataKv`, `deletedTombstone`, `clampFuture`, `crmMetaForContracts` |
| `backend/src/developer-api/universal-api.controller.ts` | `/api/v1/universal/*` | `objects`, `accounts`, `statement`, `statementXlsx`, `filters` |
| `backend/src/oplata-kv/oplata-kv.service.ts` | manba | `byObject`, `byObjectDetail`, `filterRowsByBank`, `clampFutureUpdatedAt` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/api-keys`, `/:id`, `scopes`, `stats`, `logs` | `api_keys:view` | ro'yxat, log |
| POST, PATCH, DELETE | `/api/api-keys`, `/:id`, `/:id/revoke` | `api_keys:manage` | yaratish, tahrir, bekor, o'chirish |
| GET | `/api/v1/oplata-kv/changes` | `oplatakv:read` | yagona feed: upsert + tombstone |
| GET | `/api/v1/oplata-kv`, `oplata-kv/deleted`, `oplata-kv/:id` | `oplatakv:read` | eski delta (`updatedSince`), o'chirilganlar, bitta qator |
| GET | `/api/v1/transactions`, `accounts`, `counterparties` | `transactions:read`, `accounts:read`, `counterparties:read` | ro'yxat, tafsilot |
| GET | `/api/v1/_whoami`, `_meta/banks`, `_meta/categories`, `_meta/enums` | faol kalit | meta |
| GET | `/api/v1/universal/objects`, `objects/contracts`, `objects/payments`, `accounts`, `statement`, `statement.xlsx`, `filters` | `universal:read` | 3 qoida |

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `frontend/app/[locale]/(panel)/admin/api-keys/page.tsx` | `/api/api-keys*` | `api_keys:view`; `api_keys:manage` |
| `frontend/app/[locale]/api/page.tsx` | `/api/v1/*` (kiritilgan kalit) | ochiq, login yo'q |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `api_keys` | `ApiKeyService` | guard, admin, Facts `api_usage` | `name`, `scopes`, `is_active`, `expires_at`, `revoked_at`, `last_used_at`, `total_requests`, `allowed_ips`; `key_id`, `secret_hash`, `secret_preview` Facts'ga berilmaydi |
| `api_request_logs` | `ApiKeyService.writeLog` | admin, Facts `api_usage` | `api_key_id` (kalit o'chsa NULL), `method`, `path`, `status_code`, `duration_ms`, `error_message`, `created_at`; `ip`, `user_agent`, `query` Facts'ga berilmaydi |
| `oplata_kv`, `oplata_kv_history` | OplatyKv moduli | feed | `updated_at`, `id`; history `action = 'deleted'`, `created_at` |

## Biznes qoidalar
- Faqat o'qish: yozish scope'i yo'q (`api-scopes.ts`).
- Secret faqat yaratishda bir marta ko'rinadi, bazada SHA-256 (`create`). 401: faol emas, muddati o'tgan, noto'g'ri secret, IP ro'yxatda yo'q (`validateCredentials`). Scope yetmasa 403.
- `/changes`: keyset kursor (`oplata_kv.updated_at`/`id` + history `created_at`/`id`). Cursor'siz so'rov epoch'dan (`days`, `since` suradi). `limit` default 100, max 500. `payment_category` yoki `perereboska_group_id` bor bo'lsa `deleted:false`, aks holda tombstone `reason: 'inactive'`; hard delete `reason: 'deleted'`. Summa satr, so'm, tiyingacha.
- Eski `/oplata-kv`: faqat split qatorlar, `updated_at >= updatedSince`, OFFSET (delta'da ishonchsiz), perereboska yo'q; summa son, so'm.
- Har to'lovda `crm_contracts` dan `order_id`, `crm_branch` (sotuv bo'limi), `crm_property_type` (`parking` | `apartment`): `crmMetaForContracts`.
- Universal: sana `YYYY-MM-DD`, `date` bitta kun. objects'da `oplata_kv.date` kalendar sana, `statement` da kun +05:00. `objects/payments` 5000 qator (`truncated`), `statement` limit default 1000, max 5000. Summa so'm.
- `statement.xlsx` paneldagi Vipiska Excel'i bilan aynan bir xil (commit 54dbbfa): bankdan jonli, faqat `KAPITALBANK_V3`, 92 kungacha (`statement.service.ts::MAX_DAYS`).

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `oplata-kv.service.ts::byObject*` → panel obyekt hisoboti va Universal API birga.
- `transactions/statement.service.ts::build` → panel Vipiska va `statement.xlsx`.
- Endpoint yoki parametr → `docs/universal-api.md`, `frontend/app/[locale]/api/page.tsx` va egasining web nusxasi.
- `oplata_kv` qatorini o'chiruvchi yo'l → `oplata_kv_history` ga to'liq snapshot bilan `deleted`.

## Xavfli joylar va tuzoqlar
- 2026-08-12 (b06ca52): kelajak `updated_at` `updatedSince` kursorini sakratib, to'lovlar o'tkazib yuborildi. Sabab: schotchik cron raw SQL `NOW()` (DB soati). Fix 3 qatlam: app vaqti parametr; `clampFutureUpdatedAt` har daqiqa; API `clampFuture`.
- 2026-08-18 (3075556): "bo'sh tombstone" filtri import o'chirishlarini yashirdi, CRM'da to'lovlar eskirdi. Tombstone hech qachon filtrlanmaydi, skip qilinmaydi. Tiklash: `oplata-kv/deleted?deletedSince=`.
- Statik route (`oplata-kv/deleted`, `changes`) `oplata-kv/:id` dan oldin turishi shart.
- objects'da `banks=` faqat bank ID (`filterRowsByBank` `Transaction.bankId` bilan solishtiradi); `accounts`, `statement` da `bank=` kod yoki id. `__none__` = banksiz.
- Guard interceptordan oldin ishlaydi: 401 va 403 `api_request_logs` ga tushmaydi.
- `api_request_logs` retention yo'q: sana sharti majburiy. `ApiKeyService.stats` butun tarixni o'qiydi.
- `_debug/crm-raw` va `statement.xlsx` tashqi so'rov qiladi.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi scope | `api-scopes.ts`, endpointda `@RequireApiScopes` |
| Feed'ga maydon | `public-api.controller.ts::oplataKvShapeMoney`, `deletedTombstone` |
| Universal filtr | `universal-api.controller.ts`, `oplata-kv.service.ts::byObject*`, yo'riqnoma |
