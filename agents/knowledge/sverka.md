# Sverka (bank va CRM)

## Vazifasi
Ikki alohida solishtiruv. (1) Bank sverka (`/check`): hisob va Toshkent kuni bo'yicha bank API oboroti va saldosi ↔ `transactions` (`txn_date`). AI agent farqni tushuntiradi, xodim tasdiqlab tuzatadi, Telegram digest. (2) CRM sverka (`/check-crm`): CRM to'lov tarixi ↔ `oplata_kv`, shartnoma kesimida; natija xotirada. Bank va CRM'ga yozilmaydi; tuzatish faqat `transactions`, `oplata_kv` ga.

## Fayllar
Yo'llar `backend/src/` ichida.

| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `transactions/reconcile.service.ts` | 1: bank ↔ baza | `reconcile`, `reconcileToday`, `diagnoseDay`, `fixTxDate`, `fixAllTxDate`, `fixAllTxAmount`, `relinkOplataKv` |
| `transactions/sverka-agent.service.ts` (+ `.spec.ts`) | 1: AI tahlil | `analyze`, `applyRecommended` |
| `sverka-telegram/sverka-telegram.service.ts`, `digest.ts` | 1: Telegram | `autoSverkaNotify`, `notifyNewMismatches`, `pollLoop`, `eveningReminder`, `resetNotifiedToday`, `renderDigest` |
| `crm-sverka/crm-sverka.service.ts` | 2: CRM ↔ OplatyKv | `start`, `fetchAllCrmPayments`, `buildRows`, `contractDetail`, `autoRefresh` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/transactions/reconcile`, `/reconcile/diagnose`, `/reconcile/agent/analyze` | `transactions:sverka_view` | 1: sverka, kun tafsiloti, AI |
| GET | `/transactions/reconcile/today` | `transactions:sverka_view` | 1: hamma hisob; Telegram notify, `syncMismatched=true` da sync |
| POST | `/transactions/reconcile/fix-*`, `/reconcile/agent/apply` | `transactions:sverka_fix` | 1: DB yozuvi |
| * | `/sverka-telegram/*` | `sverka_view`, `sverka_fix` | 1: chat, token, tarix, reset |
| GET | `/crm-sverka/status`, `/result`, `/contract`, `/export` | `transactions:sverka_crm_view` | 2: natija |
| POST | `/crm-sverka/run` | `transactions:sverka_crm_run` | 2: CRM'dan tortish |

## Frontend sahifalar
Yo'llar `frontend/app/[locale]/(panel)/` ichida.

| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `check/page.tsx`, `_drilldown.tsx` | `reconcile`, `reconcile/today`, `diagnose`, `fix-*` | `sverka_view` |
| `check/_sverka-agent.tsx`, `_agent-batch.tsx` | `reconcile/agent/*` | `sverka_view` |
| `check/_telegram-dialog.tsx` | `/sverka-telegram/*` | `sverka_fix` |
| `check-crm/page.tsx`, `_crm-drilldown.tsx` | `/crm-sverka/*` | `sverka_crm_view` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `transactions` | `fix*` | `reconcile` | `txn_date`, `amount`, `external_id`, `direction` |
| `oplata_kv` | `relinkOplataKv` | CRM sverka | `source_tx_id`, `date`, `payment_amount` |
| `transaction_change_logs` | `fixTxDate`, `fixAllTxAmount` | O'zgargan to'lovlar | `change_type` EDITED |
| `settings` | sverka-telegram, crm-sverka | Facts | `sverka.telegram.notifiedToday`, `.history`, `.chats`, `crmSverka.lastRun`, `crmSverka.snapshot` |

## Biznes qoidalar
### 1) Bank sverka
- Faqat `KAPITALBANK_V3`, `IPAK_YOLI_V1` (apiKind gate), Hamkor yo'q. `reconcileToday`: `sync_enabled` hisoblar, 15 parallel, 5 daq kesh.
- DB tomoni `txn_date` oynasi, `status` filtri yo'q. Bank qiymati tiyinda, 100 ga bo'linadi (so'm). `EPSILON = 1` so'm, `MAX_DAYS = 92`.
- `status='mismatch'`: kirim, chiqim yoki formula (opening + kirim − chiqim ↔ closing) farqi. `ok: true` = amal bajarildi, moslik emas.
- `fmtDate` Asia/Tashkent; lokal `getDate()` taqiq (butun kun soxta farq bergan).
- Sync-lag: `syncMismatched=true` va `analyze(withSync=true)` avval bankdan sync qiladi.
- `fixTxDate`, `fixAllTxDate` `external_id` dagi sanani almashtiradi, `relinkOplataKv` `source_tx_id` ni ko'chiradi (aks holda OplatyKv dublikati).
- `fixAllTxAmount`: `oplata_kv` ga bog'langan tx summasi o'zgarmaydi.
- AI: nishonlar server diagnozidan; AI faqat `culprit` (bank, us, mixed, none, unknown), `confidence`, tavsiya beradi. Apply lock `account:date`.
- Telegram: `autoSverkaNotify` (`SVERKA_NOTIFY_CRON`, default 30 daq), chat bo'lmasa ishlamaydi; bitta digest joyida tahrirlanadi; tsiklda 15 AI gacha; ayb faqat `confidence='high'` da. 20:00 eslatma, 23:00 o'chiriladi. Rol: approver (tugmali), watcher; `pollLoop` tugma va `/clear` ni oladi.

### 2) CRM sverka
- `getPaymentHistoryAll` (bekor shartnoma ham), sahifa 5000, 8 parallel; biz tomon `oplata_kv` hamma qatori.
- `diff = ourTotal − crmTotal` (so'm). Holat: `ok` (|diff| < 0.01), `mismatch`, `crm-only`, `our-only`; `splitMismatch` = jami mos, boshlang'ich farqi ≥ 1. Hammasi 0 bo'lgan shartnoma chiqariladi. Manfiy CRM yozuvi qaytarim belgisi, summa o'zgarmaydi. Drill-down ±3 kun.
- `crmSverka.snapshot` (gzip+base64) faqat to'liq pull'da saqlanadi. `crmSverka.lastRun`: running, done, error, crashed.
- Cron `0 7,12,17 * * *` Asia/Tashkent (`CRM_SVERKA_REFRESH_CRON`), snapshot 1 soatdan eski bo'lsa. Boot: snapshot tiklanadi, yo'q bo'lsa 8 s dan keyin tortadi; qolgan `running` → `crashed`.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `reconcile` → `reconcileToday`, sverka-agent, Telegram cron.
- `relinkOplataKv` va `sync.service.ts` sana siljishi birga: biri qolsa OplatyKv dublikati.
- `crm.service.ts::getPaymentHistoryAll` → CRM sverka; `getPaymentHistory` ga tegma (XonPay).

## Xavfli joylar va tuzoqlar
- Agent `ReconcileService`, `/reconcile/today`, `/crm-sverka/run` ni chaqirmaydi: bank API, Telegram, DB yozuvi.
- `crmSverka.snapshot` qiymatini SELECT qilma (228k+ yozuv). Farqli shartnomalar ro'yxati DB'da yo'q.
- `sverka.telegram.botToken` ochiq matn, `sverka.telegram.password`, chat ID: qiymatini o'qima, yozma.
- `resetNotifiedToday` avval Telegram xabarlarini o'chiradi.
- CRM sverka Telegram'ga ulanmagan. Hamkor uchun sverka yo'q: "farq yo'q" dema.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Soxta farq | `reconcile`, `fmtDate`, `reconcileToday` (2-pass) |
| Digest matni, tugma | `renderDigest`, `handleCallback` |
| CRM sverka sekin, crashed | `fetchAllCrmPayments`, `onModuleInit` |
