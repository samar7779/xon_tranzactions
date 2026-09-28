# XonPay (Billing)

## Vazifasi
XonSaroy CRM to'lov tarixidan (faqat o'qish) `payment_method` "Xon Pay" bo'lgan to'lovlarni `xonpay_transactions` ga yig'adi. Har to'lov `purpose` idagi `XONPAY:(UUID)` bo'yicha bank tranzaksiyasiga bog'lanadi. Natija OplatyKv sahifasining Billing tabida: kunlik jami, moslangan, moslanmagan. Summalar butun so'm.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/xonpay/xonpay.service.ts` | sync, moslash, statistika, dinamik cron | `cronAutoSync`, `runSyncInBackground`, `tryMatchOne`, `runMatchInBackground`, `dailyStats`, `truncateAll`, `fixDateShift`, `intervalToCron` |
| `backend/src/xonpay/xonpay.controller.ts` | REST `/api/xonpay` | — |
| `backend/src/crm/crm.service.ts` | CRM o'qish | `getPaymentHistory`, `applyXonpayMatches` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/xonpay/sync` (`?noSkip=true`), `/sync/cancel`, `/sync/history/:logId/cancel` | `crm:view` | fon sync, to'xtatish |
| GET | `/xonpay`, `/stats/daily`, `/sync/status`, `/sync/history`, `/cron/info`, `/match/status` | `crm:view` | ro'yxat, holat |
| POST | `/cron/toggle?enabled=`, `/cron/interval?minutes=` | `crm:view` | `settings` ga yozadi |
| POST | `/match-all?onlyUnmatched=`, `/:externalId/recheck` | `crm:view` | qayta moslash |
| POST | `/admin/truncate`, `/admin/cleanup-orphans?dryRun=`, `/admin/fix-date-shift` | `xonpay:manage` | destruktiv |

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `frontend/app/[locale]/(panel)/oplatykv/billing/page.tsx` | hammasi (`admin/cleanup-orphans`, `admin/fix-date-shift` dan tashqari: ular faqat API orqali), `admin/truncate` ham | `crm:view` |
| `frontend/app/[locale]/(panel)/biling/page.tsx` | yo'q: `/oplatykv/billing` ga redirect | — |
| `frontend/app/[locale]/(panel)/dashboard/page.tsx` (XonPay vidjeti) | `/xonpay/stats/daily` | `dashboard:xonpay` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `xonpay_transactions` | sync, `tryMatchOne`, truncate, cleanup | Billing, dashboard, `applyXonpayMatches` | PK `external_id`, `xonpay_uuid`, `contract`, `amount` (BigInt so'm), `date_paid` (`@db.Date`), `full_name`, `purpose`, `crm_uuid`, `is_matched`, `matched_tx_id`, `matched_amount`, `updated_at_local` |
| `xonpay_sync_logs` | `runSyncInBackground`, `onModuleInit` | Billing tarixi, Facts `xonpay` | `trigger`, `status`, `fetched`, `inserted`, `updated`, `matched`, `errors`, `error_message`, `duration_ms` |
| `settings` | `setCronEnabled`, `setCronInterval` | `onModuleInit` | `xonpay.cron.enabled`, `xonpay.cron.intervalMinutes` |

## Biznes qoidalar
- Cron nomi `xonpay-auto-sync`, `SchedulerRegistry` orqali, `@Cron` emas. `intervalToCron`: faqat 07-23 soatlari, Asia/Tashkent. Interval 1..1440, default 60.
- `xonpay.cron.enabled` faqat `'false'` bo'lsa o'chiq (`onModuleInit`).
- `cronAutoSync`: sync ishlayotgan bo'lsa skip; `limit: 5000`, `trigger: 'cron'`.
- `runSyncInBackground`: CRM `/payment-history/excel` 5000 tadan sahifalanadi; sahifa to'liq bo'lmasa tugaydi, 200 sahifa chegarasi (CRM `last_page` ishonchsiz). 100% moslangan o'tgan kunlar skip (`skipDates`); `noSkip=true` hammasini qayta ko'radi.
- `date_paid` UTC 12:00 bilan yoziladi (`parseDateOnly`), sana siljimasin deb.
- `trigger`: manual yoki cron.
- `tryMatchOne`: UUID `transactions.description` ichida, eng yangi `txn_date`. Summa solishtirilmaydi. Bank filtri yo'q: izohida UUID bor Hamkor to'lovi ham bog'lanadi.
- `status`: running, success, failed, cancelled. 'Server restart%' xatoli failed = orfan (`onModuleInit`), nosozlik emas.
- Bugungi va kechagi moslanmagan to'lov hali bankka tushmagan bo'lishi mumkin.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `xonpay_transactions` tozalansa → `crm.service.ts::applyXonpayMatches` (XATO → CRM tabi, `oplata-kv.service.ts::bulkCrmFix`) XonPay shartnomasini topmaydi.
- `crm.service.ts::getPaymentHistory` o'zgarsa → sync va cleanup. Sverka CRM alohida `getPaymentHistoryAll` ishlatadi.
- `XONPAY_UUID_RE` o'zgarsa → `applyXonpayMatches` dagi regex ham.
- `xonpay.cron.*` kalit nomlari → `leader-health.service.ts::checkXonpay` (v1) va Facts `xonpay`.

## Xavfli joylar va tuzoqlar
- `fixDateShift`: hamma `date_paid` ga +1 kun, guard yo'q. Bir martalik edi (commit 8894e74, 2026-05-18). Qayta chaqirilsa sanalar buziladi.
- `truncateAll`: `TRUNCATE ... CASCADE`, qaytmas; bank tranzaksiyalariga tegmaydi.
- cleanup `dryRun=false`: CRM fetch uzilsa (`!r.ok` → break) ko'p qator orfan chiqadi. Avval dryRun.
- `runSyncInBackground`: CRM sahifasi o'qilmasa (`!r.ok` → break) istisno otilmaydi. `status` `success` bo'lib qoladi, `errors` > 0 va `error_message` to'la bo'ladi. 1-sahifada CRM javob bermasa ham log `success` (`fetched` = 0), `checkXonpay` (v1) uni sog' sync deb oladi. Qator upsert xatosi ham faqat `errors++`, `error_message` bo'sh qoladi. `success` to'liq sync degani emas: `errors`, `fetched` va `error_message` ni ham ayting.
- Frontend `lib/permissions.ts` da `XONPAY_MANAGE` yo'q: tozalash tugmasi `crm:view` ga ham ko'rinadi, backend 403 beradi.
- `dashboard:xonpay` bor, `crm:view` yo'q rolda vidjet 403 oladi.
- Tranzaksiya o'chirilsa `matched_tx_id` NULL (SetNull), `is_matched = true` qoladi.
- `checkXonpay` (v1): ketma-ket 2 haqiqiy failed = critical, oxirgi success 3 x intervaldan eski = warn. Soat oynasini bilmaydi: ertalab 07:00 dan keyin soxta warn berishi mumkin.
- Moslash har qatorda `transactions.description` bo'yicha qidiradi: katta `match-all` og'ir.
- Cron va sync holati xotirada: restartda yo'qoladi.
- `full_name`, `purpose`, `crm_uuid` Facts'ga berilmaydi.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Cron jadvali | `xonpay.service.ts::intervalToCron`, `getCronInfo` |
| Moslash qoidasi | `xonpay.service.ts::tryMatchOne` |
| Yangi CRM maydoni | `schema.prisma` `XonpayTransaction` + `runSyncInBackground` |
| Kunlik statistika | `xonpay.service.ts::dailyStats` |
