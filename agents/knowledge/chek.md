# Shartnoma nazorati

## Vazifasi
Alohida `/chek` sahifasi, UI nomi "Shartnoma nazorati" ("XonSaroy CRM asosidagi nazorat jurnali"). Kontrolyor shartnoma hujjatini (original yoki nusxa) tekshirib qabul yoki rad qiladi. Xodim shartnoma raqamini kiritadi → CRM'dan menejer, sotuv ofisi, obyekt, holat → Xon HR API'dan menejer Telegram username'i → `chek_dog` yozuvi → cron guruhga xabar yuboradi. `/chek-order` (memorial order, `chek_order.md`) bilan adashtirma. Memory'da alohida fayl yo'q: hamma da'vo koddan.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/chek/chek.service.ts` | CRUD, Excel, Telegram, HR | `crmLookup`, `create`, `list`, `update`, `exportXlsx`, `notifyCron`, `buildTgMessage`, `sendOne`, `resolveManager`, `fetchHrPersons` |
| `backend/src/chek/chek.controller.ts` | REST `/api/chek` | — |
| `backend/src/chek/dto/chek.dto.ts` | validatsiya | `VID_DOGOVORA`, `KONTROLYOR` |
| `backend/src/crm/crm.service.ts` | CRM o'qish | `getContractMeta`, `searchContracts` (`/order/index`, bekor qilinganlar ham) |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/chek/crm-lookup`, `/crm-search`, `/hr-resolve`, `/hr-search` | `chek:baza` | CRM va HR o'qish |
| POST | `/chek` | `chek:baza` | yangi yozuv |
| GET | `/chek`, `/filter-values`, `/export`, `/:id` | `chek:tarix` | ro'yxat (50/sahifa), Excel |
| PATCH, DELETE | `/chek/:id` | `chek:tarix` | tahrir, o'chirish |
| POST | `/chek/:id/send-tg` | `chek:tarix` | qo'lda qayta yuborish |
| GET, PATCH | `/tg-config`, `/hr-config` | `chek:sozlamalar` | sozlama |
| POST | `/tg-test`, `/hr-test` | `chek:sozlamalar` | ulanish testi |

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `frontend/app/[locale]/chek/page.tsx` (panel va sidebar'dan tashqari) | tablar | tab ruxsati bo'yicha |
| `frontend/app/[locale]/chek/baza-tab.tsx` | crm-search, crm-lookup, hr-resolve, hr-search, POST `/chek` | `chek:baza` |
| `frontend/app/[locale]/chek/tarix-tab.tsx` | `/chek`, filter-values, export, PATCH, DELETE, send-tg | `chek:tarix` |
| `frontend/app/[locale]/chek/sozlamalar-tab.tsx` | tg-config, hr-config, tg-test, hr-test | `chek:sozlamalar` |
| `frontend/app/[locale]/chek/i18n.ts` | 4 til: uz, uzc (kirill), ru, en | — |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `chek_dog` | `create`, `update`, `remove`, `notifyCron`, `sendOne` | Tarix, Excel, Facts `telegram_notify` | `contract_number`, `manager`, `manager_phone`, `manager_tg_username`, `branch_name`, `object_name`, `crm_status`, `data` (`@db.Date`), `vid_dogovora`, `kontrolyor`, `prichina_otkaza`, `shtrafy` (BigInt so'm), `dobavil_name`, `tg_send`, `tg_sent_at` |
| `settings` | `setTgConfig`, `setHrConfig` | shu servis | `chek.tg.config`, `chek.hr.config` (ikkalasi JSON, ichida sir) |

## Biznes qoidalar
- `vid_dogovora`: original, ekzemplyar, original_fixed, ekzemplyar_fixed (`chek.dto.ts::VID_DOGOVORA`). `kontrolyor`: otkaz, prinyat.
- `notifyCron` har daqiqa. Gate: `enabled`, token va guruh bor, Toshkent soati oynada (`inWindow`, default 9-21), `intervalMin` o'tgan (default 5). `tg_send = false` eng eski 50 tasini yuboradi, muvaffaqiyatda `tg_send = true`, `tg_sent_at`.
- `update`: `kontrolyor` o'zgarsa (Tarix "To'g'rlandi" = otkaz → prinyat) `tg_send = false`, xabar qayta ketadi.
- Xabar rus tilida, HTML (`buildTgMessage`): shartnoma, menejer va username, ofis, turi, qaror, rad sababi, vaqt (Toshkent). Obyekt, `crm_status`, jarima xabarga kirmaydi.
- `resolveManager`: CRM ismi kirilldan lotinga, HR bilan kamida 2 so'z mos. HR ro'yxati 10 daqiqa keshlanadi.
- Excel `exportXlsx`: `lang` bo'yicha 4 til, fayl `chek_<sana>.xlsx`.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `crm.service.ts::getContractMeta` o'zgarsa → Baza avtomat to'ldirish. CRM faqat o'qiladi.
- Yangi ruxsat → `backend/src/auth/permissions.ts`, `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS`.
- `chek.tg.config` tuzilmasi → `getTgConfig`, `sozlamalar-tab.tsx`, Facts `telegram_notify` (config o'qilmaydi).

## Xavfli joylar va tuzoqlar
- `chek.tg.config` ichida bot tokeni ochiq matn, `chek.hr.config` ichida HR kalit va secret. `GET /chek/tg-config`, `/hr-config` ularni to'liq qaytaradi. `settings` ni to'liq SELECT qilma, qiymat yozma.
- Sozlamalar tabidagi parol faqat frontend to'sig'i (kodda qattiq yozilgan, qiymati yozilmaydi). Haqiqiy himoya `chek:sozlamalar`.
- `seed.ts::ALL_PERMS` da `chek:*` yo'q. SUPERADMIN baribir oladi (`jwt.strategy.ts::validate` `ALL_PERMISSIONS` beradi), boshqa rolga qo'lda beriladi.
- `messageStyle` (card, status, quote) saqlanadi, lekin `notifyCron` va `sendOne` uslubsiz chaqiradi: doim card.
- Doim xato beradigan 50 ta eski yozuv yangilarini to'sadi (`take: 50`, eng eskisi).
- `lastNotifyAt` xotirada: restartdan keyin darrov yuboradi.
- `schema.prisma` izohi "tg_send hozircha ishlatilmaydi" eskirgan. `backend/prisma/sql/chek_dog.sql` ham eskirgan, manba `schema.prisma`.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Xabar matni | `chek.service.ts::buildTgMessage`, `TG_VID` |
| Yuborish jadvali | `chek.service.ts::notifyCron`, `DEFAULT_TG` |
| Yangi maydon | `schema.prisma` `ChekDog`, `chek.dto.ts`, `baza-tab.tsx`, `tarix-tab.tsx`, `EXPORT_LABELS` |
| Tarjima | `frontend/app/[locale]/chek/i18n.ts` |
