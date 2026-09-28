# Platforma

## Vazifasi
Web ilova asosi: NestJS backend (global prefiks `/api`, port 3001), Next.js panel (port 3000), nginx, login va rollar (RBAC), audit, GitHub webhook orqali deploy, systemd servislar va cron'lar. Oqim: brauzer → nginx (`transactions.xonapps.uz`) → `/` frontend yoki `/api/` backend → PostgreSQL `xon_tranzactions`. Login, audit, deploy, servislar, schedulerlar va `.env` kalit nomlari "Biznes qoidalar" bo'limining `###` qismlarida.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/main.ts` | bootstrap | global prefiks `api`, `ValidationPipe` (whitelist, forbidNonWhitelisted), CORS (`CORS_ORIGIN`), `trust proxy` (`TRUST_PROXY_HOPS`), body 100mb, Swagger faqat non-production |
| `backend/src/app.module.ts` | modullar, `ScheduleModule.forRoot()` | — |
| `backend/src/auth/auth.controller.ts`, `auth.service.ts` | login, joriy foydalanuvchi | `AuthController::login`, `AuthService::login`, `me`, `resolvePermissions` |
| `backend/src/auth/jwt.strategy.ts` | JWT tekshiruvi | `JwtStrategy::validate` (SUPERADMIN = hamma ruxsat, `tgGuest`) |
| `backend/src/auth/permissions.ts` | ruxsatlar ro'yxati | `PERMISSIONS`, `ALL_PERMISSIONS`, `PERMISSION_TREE`, `SYSTEM_ROLES` |
| `backend/src/auth/guards/` | guard'lar | `JwtAuthGuard`, `PermissionsGuard`, `RolesGuard` (eski) |
| `backend/src/roles/roles.service.ts` | rollar | `onModuleInit` (SUPERADMIN sinxroni), `remove` |
| `backend/src/admin-users/` | panel foydalanuvchilari | CRUD |
| `backend/src/audit/` | audit | `AuditInterceptor::intercept`, `audit.routes.ts::describeRoute`, `AuditService::record` |
| `backend/src/deploy/` | webhook, deploy holati | `DeployController::deploy`, `DeployService::servicesToRestart`, `triggerAsync`, `status`, `tail` |
| `backend/src/common/crypto/crypto.service.ts` | shifrlash (`CRED_ENC_KEY`) | `encrypt`, `decrypt` |
| `backend/src/sync/settings.service.ts` | `settings` jadvali | `get`, `set` |
| `backend/prisma/schema.prisma`, `backend/prisma/seed.ts` | sxema, seed | `ALL_PERMS`, SUPERADMIN, banklar, kategoriyalar |
| `frontend/lib/api.ts` | API klient | token `localStorage['xt_token']`, `NEXT_PUBLIC_API_URL` |
| `frontend/lib/auth.ts`, `frontend/lib/permissions.ts` | auth store (zustand), `PERMS` | — |
| `frontend/components/sidebar.tsx`, `route-guard.tsx` | menyu va sahifa ruxsati | `NAV`, `ROUTE_PERMISSIONS`, `LANDING_ROUTES` |
| `frontend/app/[locale]/(panel)/admin/layout.tsx` | admin tablari | `TABS` |
| `frontend/middleware.ts`, `frontend/i18n/config.ts` | locale: uz, ru, en; default uz; prefiks majburiy | — |
| `scripts/deploy.sh` | server deploy | lock, git reset, build, restart, Telegram xabari |
| `scripts/systemd/*.service`, `scripts/nginx/xon-tranzactions.conf` | unit va proxy namunasi | deploy ularni qo'llamaydi |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/api/auth/login` | ochiq | email + parol → JWT, foydalanuvchi, ruxsatlar |
| GET | `/api/auth/me` | JWT | joriy foydalanuvchi va ruxsatlari |
| GET | `/api/audit/my-activity` | JWT | o'z amallari, faol kunlar |
| GET, POST, PATCH, DELETE | `/api/admin-users` | `users:view`, `users:manage` | foydalanuvchilar |
| GET, POST, PATCH, DELETE | `/api/roles`, `/api/roles/permissions` | `roles:view`, `roles:manage` | rollar va ruxsat daraxti |
| POST | `/api/_deploy` | HMAC `x-hub-signature-256` (`GH_DEPLOY_SECRET`) | GitHub push → deploy fonda |
| GET | `/api/_deploy/health`, `/api/_deploy/status` | ochiq | webhook sozlamasi; deploy log oxiridan holat |
| GET | `/api/_deploy/hamkor-diag` | ochiq | Hamkor tashqi probe (tashqi so'rov, agent chaqirmaydi) |
| GET | `/api/_deploy/log` | `system:deploy` | deploy log oxirgi 200 satr |

### Controller prefikslari (`/api/<prefiks>`)
Kirish: boshqasi yozilmagan bo'lsa JWT + `@RequirePermissions`.

| Prefiks | Modul fayli | Kirish |
|---|---|---|
| `auth`, `admin-users`, `roles`, `audit`, `_deploy` | platforma.md | yuqoridagi jadval |
| `transactions`, `categorization`, `counterparties`, `taminot`, `customers`, `contracts`, `payments` | tranzaksiyalar.md | JWT |
| `transactions/:txId/attachments` | xato.md | JWT |
| `sync`, `banks`, `bank-accounts`, `bank-credentials`, `bank-pwd`, `import`, `api-explorer` | sync.md | JWT |
| `oplata-kv`, `vznos` | oplata_kv.md | JWT |
| `correction`, `correction-bot` | xato.md | JWT |
| `agent` | xato.md | JWT; public qismi (`xato-list`, `crm-search`, `assign`, `submit`, `file`, `arizalar`, `tg/*`) maxfiy kalit `?key=` yoki Telegram login_url imzosi |
| `crm` | crm.md | JWT |
| `crm-sverka`, `sverka-telegram`; reconcile `transactions/reconcile/*` | sverka.md | JWT |
| `xonpay` | xonpay.md | JWT |
| `chek-order`, `chek-order/tg` | chek_order.md | JWT; `tg/auth` Telegram initData → mehmon token, `tg/webhook/:secret` |
| `chek` | chek.md | JWT |
| `google-export`, `shmitd` | eksport.md | JWT |
| `api-keys` | api.md | JWT |
| `v1`, `v1/universal` | api.md | `X-API-Key` + `X-API-Secret`, scope, IP ro'yxati |

## Frontend sahifalar
Hamma yo'l `/{locale}` bilan (uz, ru, en). `/` → `/dashboard`.

| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `/login` | `/auth/login` | hamma |
| `/dashboard` | `/transactions`, `/oplata-kv`, `/bank-accounts`, `/banks`, `/sync`, `/xonpay` | `dashboard:view` |
| `/transactions` | `/transactions`, `/categorization`, `/correction`, `/crm`, `/oplata-kv`, `/sync` | `transactions:view` |
| `/statement` (vipiska) | `/transactions`, `/bank-accounts`, `/banks` | `transactions:vipiska_view` |
| `/check` (bank sverka) | `/transactions` | `transactions:sverka_view` |
| `/check-crm` (CRM sverka) | `/crm-sverka` | `transactions:sverka_crm_view` |
| `/changes` (o'zgargan to'lovlar) | `/transactions`, `/sync` | `changed_txn:view` |
| `/oplatykv`, `/oplatykv/xato-crm` | `/oplata-kv`, `/crm` | `oplatakv:view` |
| `/oplatykv/crm`, `/oplatykv/billing` | `/crm`, `/xonpay` | `crm:view` (`/crm`, `/biling` eski yo'l, redirect) |
| `/vznos` | `/vznos` | route qoidasi yo'q, API `vznos:*` |
| `/chek-order` | `/chek-order`, `/transactions`, `/oplata-kv` | route qoidasi yo'q, menyu `chekorder:view` |
| `/setup/banks`, `/setup/accounts`, `/setup/credentials` | `/banks`, `/bank-accounts`, `/bank-credentials` | `banks:view`, `accounts:view`, `credentials:view` |
| `/admin/users`, `/admin/roles` | `/admin-users`, `/roles` | `users:view`, `roles:view` |
| `/admin/login` (bank paroli, panel logini emas) | `/bank-credentials` | tab `admin_login:view` |
| `/admin/sync-logs` | `/sync`, `/oplata-kv` | `sync:view` |
| `/admin/api-explorer` | `/api-explorer`, `/bank-credentials` | route `credentials:manage`, tab `api_explorer:view` |
| `/admin/import`, `/admin/export` | `/import`, `/counterparties`, `/oplata-kv`; `/google-export`, `/shmitd` | tab `import:view`, `export:view` |
| `/admin/counterparties`, `/admin/cleanup` | `/counterparties`; `/transactions` | tab `counterparties:view`, `cleanup:view` |
| `/admin/api-keys`, `/admin/agent` | `/api-keys`; `/agent`, `/correction-bot` | `api_keys:view`; tab `agent:view` |
| `/profile` | `/auth/me`, `/audit/my-activity` | har login qilgan |
| `/customers`, `/contracts` | eski billing | `customers:view`, `contracts:view` |
| `/chek` (panel tashqarisida) | `/chek` | tab: `chek:baza`, `chek:tarix`, `chek:sozlamalar` |
| `/xato-list` (ochiq) | `/agent/xato-list`, `/agent/tg/*` | maxfiy kalit yoki Telegram login_url |
| `/tg/chek` (Telegram Mini App) | `/chek-order/tg/*` | guruh a'zosi (mehmon token) |
| `/api` | `/api/v1/*` (kiritilgan kalit bilan, `_whoami` va sinov so'rovlari) | ochiq, login yo'q |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `admin_users` | `admin-users.service.ts`, `auth.service.ts::login` (`last_login_at`), seed | `jwt.strategy.ts::validate` | `email`, `full_name`, `role_id`, `is_active`, `last_login_at`. Sir: `password_hash` |
| `roles` | `roles.service.ts` (`onModuleInit`, CRUD), seed | auth | `name`, `permissions` (TEXT[]), `is_system` |
| `audit_logs` | `audit.service.ts::record` | profil, Facts `panel_activity` | `user_name`, `module`, `action`, `method`, `path`, `status_code`, `success`, `created_at`. Maxfiy: `ip`, `meta`, `user_email` |
| `settings` | ko'p servis (`sync/settings.service.ts::set`) | hamma | `key`, `value`, `updated_at`. Bot tokenlari ham shu yerda (ba'zisi shifrlangan, ba'zisi ochiq): to'liq SELECT qilma |

## Biznes qoidalar

### Login va rollar
- Login: email kichik harfga o'tadi, parol bcrypt bilan solishtiriladi. `is_active = false` → 401. Muvaffaqiyatda `last_login_at` yangilanadi. `auth.service.ts::login`.
- JWT muddati `JWT_EXPIRES_IN` (default 7d; deploy.sh ham 7d yozadi). `auth.module.ts`.
- Token frontend'da `localStorage['xt_token']`, har so'rovda `Authorization: Bearer`. `frontend/lib/api.ts`.
- Ruxsat faqat rol orqali: `admin_users.role_id` → `roles.permissions`. Rolsiz foydalanuvchida ruxsat yo'q. `auth.service.ts::resolvePermissions`.
- SUPERADMIN har doim `ALL_PERMISSIONS` oladi (`jwt.strategy.ts::validate`), backend start'da rol yangilanadi (`roles.service.ts::onModuleInit`). Boshqa tizim roli yo'q: qolgan rollar panelda qo'lda yaratiladi (`permissions.ts::SYSTEM_ROLES`).
- `PermissionsGuard`: `@RequirePermissions(...)` ro'yxatidan bittasi yetarli. `admin_users.role` enum (SUPERADMIN, ADMIN, VIEWER) eski, faqat `RolesGuard` uchun.
- Rol o'chirish: foydalanuvchi biriktirilgan bo'lsa rad (`roles.service.ts::remove`). Noma'lum ruxsat nomi rad.
- Ruxsatlar `backend/src/auth/permissions.ts::PERMISSIONS` da (96 ta). Yangi ruxsat 3 joyda: backend `permissions.ts`, `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS`. Ruxsat rolga tushgach frontend `/auth/me` bilan yangilaydi: qayta login shart emas, hard refresh yetadi.
- Telegram Mini App mehmoni (`tgGuest`): AdminUser emas, faqat `chekorder:view`, `chekorder:manage`, `chekorder:assistant`, `chekorder:tickets`.
- JWT'siz kirish yo'llari: `/api/v1/*` (API kalit, `api.md`), public `agent` endpointlari (maxfiy kalit yoki Telegram imzosi, `xato.md`), `chek-order/tg` (`chek_order.md`), `/api/_deploy` (HMAC va ochiq GET'lar).

### Audit
- `AuditInterceptor` global (`audit.module.ts`, `APP_INTERCEPTOR`). Faqat POST, PATCH, PUT, DELETE yoziladi, GET yozilmaydi. O'tkazib yuboriladi: `/_deploy`, `/audit`, `/auth/refresh`.
- Fire-and-forget: audit xatosi so'rovni buzmaydi. Modul va amal nomi `audit.routes.ts::describeRoute` (`MODULE_MAP`, `KNOWN`), ID'lar `:id` ga normallanadi.
- IP `x-forwarded-for` dan. `meta` da route parametrlari va xato matni (200 belgi).
- Login ikki joyda yoziladi: `AuthController::login` (ism bilan) va interceptor (`user_id` NULL). Muvaffaqiyatli login = 2 qator, muvaffaqiyatsiz = 1 qator (`success = false`).
- Tarix audit qo'shilgan commit 2f9ef87 dan boshlanadi. Retention yo'q.

### Deploy
- Push'ni egasi qiladi yoki egasi [Ha] bosgan REJA'dan keyin bot. Agent o'zi push qilmaydi.
- Oqim: push → GitHub webhook `POST /api/_deploy` (HMAC) → `DeployService::servicesToRestart` → `triggerAsync` fonda `nohup scripts/deploy.sh`.
- Qaysi servis quriladi (`servicesToRestart`): `.md`, `.txt`, `docs/`, `.github/`, `tz/` → restartsiz; `backend/` → backend; `frontend/` → frontend; boshqa root fayl (masalan `agents/*.py`, `scripts/`) → ikkalasi to'liq (5-8 daqiqa). Bo'sh yoki faqat hujjat commit frontend'ni qurmaydi.
- `deploy.sh` qadamlari: eski lock tozalash (`fuser`); `flock -w 60` lock `/var/run/xon-tranzactions-deploy.lock`; swap; `backend/.env` ga ayrim kalitlarni yozish (`ensure_env_var`); `git fetch` va `git reset --hard origin/main`; backend: `npm install`, `prisma generate`, `prisma db push --accept-data-loss --skip-generate`, `npm run seed`, `npm run build`; frontend: `.next-build` ga build, atomik almashtirish, frontend restart; Telegram xabari; eng oxirida backend restart (`sudo -n /bin/systemctl restart`).
- Log `/var/log/xon-tranzactions/deploy.log`. Holat `GET /api/_deploy/status`. Deploy'dan keyin brauzerda hard refresh (Next.js kesh).
- `deploy.sh` hali `agents/state/deploy_log.json` yozmaydi (kod ishi). Lock umumiy: bot `reja.py::_acquire_deploy_lock` bilan aynan `/var/run/xon-tranzactions-deploy.lock` ni flock qiladi.
- `xon-tranzactions-leader` ni deploy restart qilmaydi: `agents/*.py` o'zgarsa bot watcher'i `os._exit` qiladi, systemd ko'taradi.
- Bot REJA'ni qo'llashda tekshiruv: `.py` → `python3 -m py_compile`; `backend/**/*.ts` o'zgarsa vaqtinchalik nusxada `npx tsc --noEmit -p backend/tsconfig.json`; `frontend/**/*.ts(x)` → `npx tsc --noEmit -p frontend/tsconfig.json`; faqat `.md` → tekshiruv yo'q. Push'dan oldin lokal `npm run build` majburiy.

### Servislar
| xizmat | vazifasi | to'xtasa nima bloklanadi |
|---|---|---|
| `xon-tranzactions-backend` | NestJS API (port 3001; nginx `/api/`, `/docs/`). User root, `WorkingDirectory=/var/www/xon_tranzactions/backend`, `EnvironmentFile=backend/.env`, `node dist/main.js`, `Restart=on-failure`. Hamma `@Cron`, bank sync, OplatyKv avto-sync, backend ichidagi Telegram botlar (sverka, correction-bot, v1 leader long-polling), deploy webhook `/api/_deploy`. Unit: `scripts/systemd/xon-tranzactions-backend.service`. | Panel API, bank sync (Kapital, Ipak, Hamkor), `oplata_kv` avto-to'ldirish, sverka Telegram, backend botlari, CRM backfill, Google Sheets va SHMITD eksport, XonPay sync, deploy webhook (push kelsa deploy boshlanmaydi). deploy.sh uni eng oxirida restart qiladi. |
| `xon-tranzactions-frontend` | Next.js panel (`npm start`, port 3000; nginx `/`). User root, `WorkingDirectory=/var/www/xon_tranzactions/frontend`, `EnvironmentFile=frontend/.env.local`, `Restart=on-failure`. Deploy `.next-build` ga quradi, atomik almashtirib restart qiladi. | `transactions.xonapps.uz` paneli ochilmaydi. API, cron va botlar ishlayveradi. |
| `xon-tranzactions-leader` | YANGI: Python aiogram bot `agents/leader_bot.py`, `Restart=always`, o'z venv'i (web backend Node, venv yo'q). Leader, Support, Checker, Teacher agentlarini Claude Code CLI + setup token bilan ishga tushiradi. `Environment=TZ=Asia/Tashkent`. Env fayli `backend/.env` (`AGENTS_ENV_FILE`, unit'da beriladi; `EnvironmentFile` yo'q, bot faylni o'z parseri bilan o'qiydi, `os.environ` ga yozmaydi). Facts ham shu servis ichida yig'iladi. deploy.sh bu servisni bilmaydi va restart qilmaydi; `agents/*.py` o'zgarsa bot watcher'i `os._exit` qiladi, systemd ko'taradi. sudoers'da yo'q. | Faqat Telegram agentlar jamoasi (savol-javob, REJA, Teacher, Checker alertlari) va Facts yig'ish. Sayt, API, cron ta'sirlanmaydi. |
| Facts (yangi) | Facts: `xon-tranzactions-leader` ichida `support_facts.py::facts_scheduler` (har 5 daqiqa). Qo'lda yoki qo'shimcha cron: `python3 -m agents.support_facts`. `agents/state/support_facts.json` yozadi. Leader servisi to'xtasa Facts ham eskiradi. | Facts eskiradi (`updated_at` 15 daqiqadan eski), agentlar jonli ma'lumotsiz qoladi. |
| `postgresql` | PostgreSQL, baza `xon_tranzactions` (faqat localhost). Shu serverda xontaminot ERP ning alohida `xontaminot` bazasi ham bor. Backend unit'i `After`/`Wants=postgresql.service`. | Hammasi: backend ishga tushmaydi, sync va cron to'xtaydi, bot Facts o'qiy olmaydi. |
| `nginx` | Reverse proxy `transactions.xonapps.uz` (certbot SSL): `/api/` → 3001, `/docs/` → 3001, `/` → 3000; `client_max_body_size 200M`, `/api` timeout 1800s. Konfig: `scripts/nginx/xon-tranzactions.conf`. | Tashqaridan sayt, API va GitHub deploy webhook yetib bormaydi. Ichki cron va long-polling botlar ishlayveradi. |
| Bank forwarder (tashqi, systemd emas) | `scripts/xt-forwarder.php` boshqa hostda: bank IP whitelist'ini chetlab o'tish (Kapital, Ipak, `use_proxy = true`). Manba DB setting `bank.forwarderUrl`, `bank.forwarderSecret`; env `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET` zaxira. | Proxy orqali ulangan hisoblar sync bo'lmaydi (`sync_logs` PARTIAL), sverka soxta farq beradi. |
| XonSaroy CRM API (tashqi, faqat o'qish) | Shartnoma, to'lov tarixi, grafik manbai (`XONSAROY_*` env). CRM'ga hech qachon yozilmaydi. | Kategoriyalash (shartnoma topish), XATO tekshiruvi, `crm_status` va branch backfill, installment split, CRM sverka snapshot, XonPay sync. |

### Schedulerlar
Hamma backend cron'lari `xon-tranzactions-backend` jarayonida. "iz" = `schedulers` Facts kaliti oxirgi ishga tushishni qayerdan biladi.

| nomi | jadvali (Toshkent) | fayl | nima qiladi | iz |
|---|---|---|---|---|
| `SyncService.tick` (bank sync) | har daqiqa (`TXN_SYNC_CRON`, default `* * * * *`), har hisob `banks.sync_interval_minutes` (default 5, 0 = o'chiq) | `backend/src/sync/sync.service.ts` | Muddati o'tgan sid'larni tozalaydi; faol hisoblarni (Kapital, Ipak, Hamkor) bankdan sync qiladi. | MAX(`sync_logs.started_at`) |
| `SyncService.bulkScheduleTick` | har daqiqa, gate `bulkSync.timeOfDay` (default 18:00), kuniga 1 marta | `backend/src/sync/sync.service.ts` | Barcha hisoblar uchun backfill (`bulkSync.daysBack`). | setting `bulkSync.lastRunAt` |
| `OplataKvService.autoSyncTick` | har daqiqa; kunduz 08:00-22:00 har N daqiqa, tun 01:00-07:50 kuniga 1 marta | `backend/src/oplata-kv/oplata-kv.service.ts` | `transactions` → `oplata_kv` (`syncFromTransactions`). | MAX(`oplata_kv.created_at`) WHERE `created_by_name LIKE 'cron%'` (taxminiy) |
| `OplataKvService.schotchikAutoTick` | har daqiqa | `backend/src/oplata-kv/oplata-kv.service.ts` | `clampFutureUpdatedAt`; `schotchik.auto` yoqilgan bo'lsa schetchik qatorlarini oylikka o'tkazadi. | iz yo'q (journal) |
| `OplataKvService.crmStatusBackfillTick` | har daqiqa (running lock) | `backend/src/oplata-kv/oplata-kv.service.ts` | `crm_contracts.virtual_status` NULL larni CRM'dan 200 tadan to'ldiradi. | COUNT `virtual_status IS NULL AND found` |
| `CrmContractCacheService.crmMetaBackfillTick` | har daqiqa (running lock) | `backend/src/categorization/crm-contract-cache.service.ts` | `branch_name` va turi backfill, 200 shartnoma/tsikl. | COUNT `branch_name IS NULL` |
| `SverkaTelegramService.autoSverkaNotify` | har 30 daqiqa (`SVERKA_NOTIFY_CRON`), run lock | `backend/src/sverka-telegram/sverka-telegram.service.ts` | Chat bo'lsa `reconcileToday({syncMismatched:true})` va digest xabarini yaratadi yoki tahrirlaydi. | `settings.updated_at` WHERE key `sverka.telegram.notifiedToday` |
| `SverkaTelegramService.eveningReminder` | 20:00 | `backend/src/sverka-telegram/sverka-telegram.service.ts` | Tuzatilmagan farqlar ro'yxatini guruhga yuboradi. | setting `sverka.telegram.eveningReminder`: farq bo'lsa `{date, msgs}` yoziladi. Chat yo'q bo'lsa yozilmaydi. Farq yo'q bo'lsa `{"msgs":[]}` bo'ladi (`date` yo'q) |
| `SverkaTelegramService.deleteEveningReminder` | 23:00 | `backend/src/sverka-telegram/sverka-telegram.service.ts` | 20:00 eslatmasini o'chiradi. | setting `sverka.telegram.eveningReminder` qiymati `{"msgs":[]}` bo'ladi, `updated_at` yangilanadi |
| `SverkaTelegramService.pollLoop` | doimiy long-polling | `backend/src/sverka-telegram/sverka-telegram.service.ts` | Tugma va buyruqlarni qabul qiladi. | iz yo'q |
| `CorrectionBotRunnerService.loop` | doimiy long-polling | `backend/src/correction-bot/correction-bot-runner.service.ts` | Tuzatish boti suhbati. | iz yo'q |
| `AgentService.tick` (XATO digest) | har daqiqa, gate `agent.dailyTime` (default 09:00), kuniga 1 marta | `backend/src/agent/agent.service.ts` | XATO digest guruhga. | setting `agent.lastResult` |
| `AgentAiService.tick` (AI ariza) | har daqiqa, gate ish soati va interval (default 5 daq) | `backend/src/correction/agent-ai.service.ts` | Kutayotgan arizalarni Claude vision bilan tekshiradi (10 tagacha). | MAX(`xato_correction_requests.agent_at`) |
| `ChekService.notifyCron` | har daqiqa, gate soat 9-21, interval 5 daq | `backend/src/chek/chek.service.ts` | `chek_dog` yuborilmaganlarini guruhga yuboradi. | MAX(`chek_dog.tg_sent_at`) |
| `CounterpartiesCron.refreshHourly` | `0 8-22 * * *` | `backend/src/counterparties/counterparties.cron.ts` | Kontragentlarni DIDOX yoki Chamber'dan yangilaydi. | MAX(`counterparties.last_fetched_at`) |
| `CounterpartiesCron.xontaminotSyncTick` | har 5 daqiqa, ichki gate | `backend/src/counterparties/counterparties.cron.ts` | Ta'minot ERP'dan kontragent sync. | setting `counterparties.xontaminot.lastSyncAt` |
| `CrmSverkaService.autoRefresh` | `0 7,12,17 * * *` (`CRM_SVERKA_REFRESH_CRON`) | `backend/src/crm-sverka/crm-sverka.service.ts` | Snapshot 1 soatdan eski bo'lsa CRM to'lov tarixini qayta tortadi. | setting `crmSverka.lastRun` |
| `CrmSverkaService` boot seed | backend start | `backend/src/crm-sverka/crm-sverka.service.ts` | Snapshotni tiklaydi yoki tortadi, uzilgan run'ni `crashed` qiladi. | setting `crmSverka.lastRun` |
| `GoogleExportService.exportSheetsCronTick` | har daqiqa, har sheet o'z jadvali | `backend/src/google-export/google-export.service.ts` | `oplata_kv` → Google Sheets. | MAX(`export_cron_logs.started_at`) |
| `GoogleExportService.autsourcingCronTick` | har daqiqa, gate `autsourcing.cronTime`, kuniga 1 marta | `backend/src/google-export/google-export.service.ts` | Autsourcing Excel → Telegram. | iz yo'q (journal) |
| `ShmitdService.cronTick` | har daqiqa, gate `shmitd.cronTimes` | `backend/src/shmitd/shmitd.service.ts` | SHMITD HTML hisobot → Telegram. | MAX(`shmitd_logs.sent_at`) |
| `xonpay-auto-sync` (dinamik) | `xonpay.cron.intervalMinutes` (default 60), faqat 07-23 | `backend/src/xonpay/xonpay.service.ts` | CRM'dan XonPay to'lovlari va bank bilan moslash. | MAX(`xonpay_sync_logs.started_at`) |
| `LeaderAlertService.tick` (v1) | `*/15 * * * *` | `backend/src/leader/leader-alert.service.ts` | v1 leader alertlari. | `leader_alerts` jadvali |
| `LeaderOrchestratorService.teacherDaily` (v1) | 22:30 | `backend/src/leader/leader-orchestrator.service.ts` | v1 kunlik teacher. | `leader_runs` jadvali |
| `LeaderBotService.pollLoop` (v1) | doimiy long-polling | `backend/src/leader/leader-bot.service.ts` | v1 leader boti. | iz yo'q |
| Facts (yangi, `xon-tranzactions-leader` ichida) | har 5 daqiqa | `agents/support_facts.py::facts_scheduler` | `agents/state/support_facts.json`. | `updated_at` |
| Checker scheduler (yangi) | start 45 s, keyin har 4 soat | `agents/checker_worker.py` | Health tekshiruvi, alert throttle. | `kv_store['checker:last_full_run']` |
| Teacher kunlik (yangi) | 22:30 | `agents/teacher_daily.py` | Kunlik tahlil va hisobot. | `kv_store['teacher_daily_last_run']` |
| Va'da eslatmasi (yangi) | Leader "tekshiraman" desa 2 soatdan keyin | `agents/leader_bot.py` | Eslatma. | `agent_promises` |

### `.env` kalit nomlari
Faqat nomlar, qiymat yo'q.

- Asosiy (`backend/.env`): `DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `TRUST_PROXY_HOPS`, `SWAGGER_PATH`, `APP_URL`, `UPLOADS_DIR`
- Auth va shifrlash: `JWT_SECRET`, `JWT_EXPIRES_IN`, `CRED_ENC_KEY`, `ADMIN_ACTION_PASSWORD`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD`
- Bank: `KAPITALBANK_API_URL`, `KAPITALBANK_TIMEOUT_MS`, `HAMKORBANK_TIMEOUT_MS`, `HAMKORBANK_STATEMENT_TIMEOUT_MS`, `BANK_PROXY_URL`, `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET`
- Sync va cron: `TXN_SYNC_CRON`, `TXN_SYNC_DAYS_BACK`, `SVERKA_NOTIFY_CRON`, `CRM_SVERKA_REFRESH_CRON`
- CRM (XonSaroy): `XONSAROY_API_URL`, `XONSAROY_CLIENT_BASE`, `XONSAROY_API_KEY`, `XONSAROY_API_SECRET`, `XONSAROY_S3_BASE`, `XONAPP_MYSQL_HOST`, `XONAPP_MYSQL_PORT`, `XONAPP_MYSQL_USER`, `XONAPP_MYSQL_PASSWORD`, `XONAPP_MYSQL_DB`
- Ta'minot va kontragent: `TAMINOT_DATABASE_URL`, `XONTAMINOT_DATABASE_URL`, `DIDOX_BASE_URL`, `DIDOX_LOGIN_INN`, `DIDOX_LOGIN_PASSWORD`, `DIDOX_PARTNER_AUTH`, `CHAMBER_BASE_URL`
- Google: `GOOGLE_SA_JSON`, `GOOGLE_SA_KEYFILE`
- Telegram: `TG_BOT_TOKEN`, `DEPLOY_NOTIFY_CHAT`, `ATTACHMENTS_NOTIFY_CHAT`, `SVERKA_BOT_TOKEN` (boshqa bot tokenlari env'da emas, `settings` jadvalida)
- AI (backend modullari uchun, agentga BERILMAYDI): `ANTHROPIC_API_KEY`
- Chek order: `API_PUBLIC_URL`, `APP_PUBLIC_URL`
- Deploy (`DeployService` + `scripts/deploy.sh`): `GH_DEPLOY_SECRET`, `DEPLOY_REPO_DIR`, `DEPLOY_BRANCH`, `DEPLOY_BACKEND_SERVICE`, `DEPLOY_FRONTEND_SERVICE`, `DEPLOY_LOG`, `DEPLOY_LOCK`, `DEPLOY_SERVICES`, `DEPLOY_COMMIT`, `DEPLOY_PUSHER`, `DEPLOY_PUSHED_BRANCH`, `DEPLOY_FILES`, `DEPLOY_FROM_WEBHOOK`, `NODE_OPTIONS`, `NEXT_TELEMETRY_DISABLED`
- v1 leader (`backend/.env`, boshqa arxitektura): `LEADER_ENABLED`, `LEADER_BOT_TOKEN`, `LEADER_OWNER_TG_IDS`, `LEADER_MODEL`, `LEADER_MODEL_STRONG`, `LEADER_DAILY_TOKENS`, `LEADER_ALERTS`, `LEADER_TEACHER`, `LEADER_REPO_DIR`, `LEADER_AGENTS_DIR`, `LEADER_SECRET_LITERALS`
- Frontend (`frontend/.env.local` va build): `NEXT_PUBLIC_API_URL`, `NEXT_DIST_DIR`
- Yangi bot `xon-tranzactions-leader` (`backend/.env`, yo'l `AGENTS_ENV_FILE` bilan almashadi; `os.environ` fayldan ustun): `LEADER_BOT_TOKEN`, `LEADER_TG_ID`, `ANTHROPIC_SETUP_TOKEN`, `AGENTS_USE_CLI`, `CLAUDE_CMD`, `AGENTS_MODEL_STRONG`, `AGENTS_MODEL_FAST`, `AGENT_DAILY_CAP`, `AGENT_TIMEOUT_S`, `AGENT_TIMEOUT_S_<AGENT>`, `AGENT_OS_USER`, `AGENTS_ENV_FILE`, `DEPLOY_LOCK`, `DEPLOY_LOG`, ixtiyoriy `ANTHROPIC_BASE_URL`. `AGENTS_REPO` faqat testlar uchun.
- Yangi bot DB ulanishi (shablonda nomi yo'q): `AGENTS_DB_URL` (bot jadvallari, `agents` sxema), `AGENTS_FACTS_DB_URL` (Facts) ixtiyoriy. Bo'sh bo'lsa kod `DATABASE_URL` ga tushadi (`config.py::get_settings`, zanjir `AGENTS_FACTS_DB_URL` → `AGENTS_DB_URL` → `DATABASE_URL`), Facts'ni faqat READ ONLY tranzaksiya himoya qiladi. SELECT huquqli rol tavsiya (egasi qarori). `DATABASE_URL` agent env'iga o'tmaydi.
- Agent jarayoni env oq ro'yxati (shablon KOD 2.4): `PATH`, `HOME`, `LANG`, `LC_ALL`, `TZ`, `USER`, `CLAUDE_CODE_OAUTH_TOKEN` (= `ANTHROPIC_SETUP_TOKEN`), ixtiyoriy `ANTHROPIC_BASE_URL`. Boshqa hech narsa.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `backend/src/auth/permissions.ts::PERMISSIONS` o'zgarsa → `frontend/lib/permissions.ts::PERMS` va `backend/prisma/seed.ts::ALL_PERMS` ham (bittasi qolsa tugma ko'rinmaydi yoki rol ruxsatni olmaydi).
- Yangi panel sahifasi → `frontend/components/route-guard.tsx::ROUTE_PERMISSIONS` va `sidebar.tsx::NAV` yoki `admin/layout.tsx::TABS` (aks holda sahifa ruxsatsiz ochiladi yoki `/admin` qoidasiga tushadi).
- `backend/prisma/schema.prisma` o'zgarsa → keyingi backend deploy `db push --accept-data-loss` bilan bazani o'zgartiradi; olib tashlangan ustun ma'lumoti yo'qoladi.
- `DeployService::servicesToRestart` o'zgarsa → qaysi commit qaysi servisni qurishi o'zgaradi; `scripts/deploy.sh` `DEPLOY_SERVICES` ga tayanadi.
- `scripts/deploy.sh::ensure_env_var` har deploy'da `backend/.env` dagi `TG_BOT_TOKEN`, `DEPLOY_NOTIFY_CHAT`, `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET`, `UPLOADS_DIR`, `ATTACHMENTS_NOTIFY_CHAT`, `APP_URL`, `JWT_EXPIRES_IN` ni qayta yozadi: `.env` da qo'lda o'zgartirish keyingi deploy'da qaytadi.
- `audit.routes.ts::MODULE_MAP` o'zgarsa → `audit_logs.module` qiymatlari va Facts `panel_activity` guruhlari o'zgaradi.
- `main.ts` global prefiks `api` → nginx `/api/` → 3001 va frontend `NEXT_PUBLIC_API_URL` bir-biriga bog'liq.

## Xavfli joylar va tuzoqlar
- `prisma db push --accept-data-loss`: `public` da Prisma'da yo'q jadval yoki ustun ogohlantirishsiz o'chadi. Bot jadvallari faqat `agents` sxemada.
- `scripts/deploy.sh` ichida qattiq yozilgan sir qiymatlari bor (Telegram token zaxirasi, forwarder manzili va siri, chat ID'lar). Git'da turibdi, egasi qoidasiga zid. Qiymatni hech qayerga ko'chirma, javobda aytma. Tuzatish faqat REJA bilan, egasi qarori.
- `GET /api/_deploy/status`, `health`, `hamkor-diag` auth'siz. `hamkor-diag` tashqi so'rov qiladi: agent chaqirmaydi.
- Webhook branch'ni tekshirmaydi: istalgan branch'ga push `origin/main` deployini boshlaydi (`deploy.controller.ts::deploy`).
- Lock 60 s ichida olinmasa deploy jim tashlanadi, status eski commit'da qoladi. Qo'lda ishga tushirilgan `deploy.sh` backend va frontend ikkalasini quradi.
- Backend restart deploy'ning oxirgi qadami: jarayon o'zini to'xtatadi. Restart fazasi 5-8 daqiqa odatiy.
- `route-guard.tsx`: `/admin/*` da ro'yxatda yo'q sahifalar (`login`, `import`, `export`, `agent`, `counterparties`, `cleanup`) `users:view` talab qiladi, admin tabi esa o'z ruxsati bilan ko'rinadi. `/vznos` va `/chek-order` da route qoidasi yo'q (API ruxsati baribir tekshiriladi).
- `/admin/login` bank paroli sahifasi, panel logini emas.
- Swagger faqat `NODE_ENV` production bo'lmaganda; prod'da `/docs` ochilmaydi.
- `roles` jadvalida SUPERADMIN ruxsatini qisqartirish ta'sir qilmaydi: `validate` va `onModuleInit` qaytaradi.
- Backend va frontend `User=root` bilan ishlaydi. Agent `backend/.env` ni o'qimaydi.
- `CRED_ENC_KEY` bilan hamma `password_enc` va shifrlangan `settings` qiymatlari ochiladi: eng xavfli kalit.
- systemd unit'larda `TZ` yo'q: `SyncService.tick`, `oplata-kv.service.ts::dailySummary` va deploy log vaqti server soatiga bog'liq.
- Bitta tokenda faqat bitta `getUpdates`. v1 ham shu `backend/.env` dagi `LEADER_BOT_TOKEN` ni o'qiydi: v1 yoqilgan bo'lsa (`LEADER_ENABLED` != 0 va `LEADER_OWNER_TG_IDS` bor) backend restartidan keyin 409 bo'ladi (`config.py::v1_leader_conflict`). Ikkala leader bot ishlasa egasi ikki javob oladi; v1 ni `LEADER_ENABLED=0` bilan o'chirish egasi qarori.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi ruxsat | `backend/src/auth/permissions.ts` (`PERMISSIONS`, `PERMISSION_TREE`), `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS` |
| Sahifa ruxsati yoki menyu | `frontend/components/route-guard.tsx::ROUTE_PERMISSIONS`, `sidebar.tsx::NAV`, `admin/layout.tsx::TABS` |
| Audit amal nomi | `backend/src/audit/audit.routes.ts` (`MODULE_MAP`, `KNOWN`) |
| JWT muddati | `.env` `JWT_EXPIRES_IN` (deploy.sh 7d qilib qayta yozadi) |
| Qaysi fayl qaysi servisni quradi | `backend/src/deploy/deploy.service.ts::servicesToRestart` |
| Deploy qadamlari | `scripts/deploy.sh` |
| Yangi cron | tegishli servisda `@Cron`; Facts `schedulers` uchun iz manbasini shu fayldagi jadvalga qo'sh |
| nginx yoki systemd | `scripts/nginx/xon-tranzactions.conf`, `scripts/systemd/*.service` (serverda qo'lda qo'llanadi) |
