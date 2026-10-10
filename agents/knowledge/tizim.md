# Tizim xaritasi — Xon Tranzaksiyalar (to'liq ma'lumotnoma)

Yangilangan: 2026-10-10. Butun repo kodi (backend, frontend, agents, scripts) o'qib yozilgan. Sirlar (parol, token, API kalit, kirish kodi, IP, Telegram ID, hisob raqami, odam ismi) ataylab YOZILMAGAN — faqat env va sozlama NOMLARI.

## Qanday foydalanish

- Fayl katta (~4000 qator). Butunini o'qima: Grep bilan `^## ` yoki `^### ` sarlavhani top, keyin Read offset/limit bilan faqat o'sha bo'limni o'qi.
- Bu fayl — umumiy xarita: har qism nima qiladi, qayerda turadi, nima bilan bog'langan. Modulning chuqur tafsiloti alohida bilim faylida bo'lishi mumkin (`oplata_kv.md`, `xato.md`, `tuzatish.md`, `tolov_tekshirish.md` ...).
- Zid kelsa ishonch tartibi: kod > modul bilim fayli > shu fayl. Ziddiyat topilsa javob oxirida `Teacher uchun: fakt — ...` qatori bilan belgila.
- Bo'limlar: A Platforma va server · B Banklar, sync, tranzaksiyalar · C OplatyKv, CRM, eksportlar · D XATO, arizalar, chek, agent backendlari · E Web panel · F Agentlar boti · G Atamalar · H Ma'lum xavflar (ochiq).

## Loyiha bir qarashda

- **Nima:** bank hisoblaridan tushumlarni avtomat yig'adigan, ularni kvartira shartnomalari to'lovlari (OplatyKv, panelda "ОплатыКв") bilan bog'laydigan, bank va CRM bilan solishtiradigan (sverka) ichki moliya paneli. Egasi bilan Telegram bot (@TRanSupport_bot) orqali agentlar jamoasi ishlaydi.
- **Texnologiya:** backend NestJS + Prisma + PostgreSQL (yagona baza `xon_tranzactions`, bot jadvallari `agents` sxemasida); frontend Next.js (App Router, `[locale]`, next-intl, react-query, Tailwind); bot Python aiogram + Claude Code CLI (`claude --print`, API kalitsiz).
- **Server:** repo `/var/www/xon_tranzactions`, systemd servislar (backend, frontend, leader bot), nginx, domen `transactions.xonapps.uz`. Deploy: `main` ga push → GitHub webhook → `POST /api/_deploy` → `scripts/deploy.sh` (A.10–A.11).
- **Asosiy ma'lumot oqimi:**
  1. Bank API (Kapitalbank v3, Ipak Yo'li, Hamkorbank; IP whitelist uchun PHP forwarder) → `SyncService` har N daqiqada → `transactions` (kompozit `external_id`, dedup) — B.4, B.5.
  2. Yangi tranzaksiya → `CategorizationService` (qoidalar, izohdan shartnoma raqami, CRM keshida tekshiruv) → kontragent/kategoriya va `contract_number` — B.10.
  3. `CLIENT` kategoriyali, shartnomali tranzaksiya → `oplata_kv` (kunduz har N daqiqa, kechasi to'liq) → obyekt/mijoz to'ldirish, boshlang'ich/oylik split → Google Sheets eksport, Universal API (`/api/v1`), dashboard hisobotlari — C.1, C.5, A.15.
  4. XonSaroy CRM (FAQAT o'qish) → `crm_contracts` kesh, `payment-history` → XATO aniqlash, CRM sverka, XonPay Billing — C.2–C.4.
  5. Shartnomasi CRM'da topilmagan to'lov = XATO → ariza (fayl bilan) → AI tekshiruvchi yoki xodim → `setContractManual` → OplatyKv yangilanadi — D.1–D.4.
  6. Bank sverka: bank qoldiq/vipiska ↔ baza, farqlar Telegram'ga, AI sverka agenti — B.7, B.8.
  7. Bot: egasi xabari → Leader (Claude CLI) → mashina qatorlari (`TUZATISH:`, `ARIZA:`, `EKSPORT:`, `HISOB:`, `XATO_FAYL:`, `PEREBROSKA:`, `TARIX:`) yoki sub-agent (Support, Checker, Teacher) → backend `agent-bridge` (loopback + kalit) — D.6, F.

## Qayerda nima (tezkor jadval)

| Savol | Bo'lim |
|---|---|
| Backend qanday ishga tushadi, global guard/interceptor | A.1, A.2 |
| Login, JWT, rollar, ruxsat kalitlari | A.3–A.7, E.5, E.6 |
| Audit (kim nima qildi) | A.8 |
| Deploy, systemd, nginx, backup | A.10–A.14 |
| Tashqi API (kalitlar, Universal API, delta-feed) | A.15, C.1 (delta) |
| Barcha jadvallar (Prisma modellar) | A.21 + `db_schema.md` |
| Env nomlari | A.19, B.15, C.10, D.12 |
| Setting (`settings` jadvali) kalitlari | A.20, C.10, D.11 |
| Bank ulanish, hisob, sync, backfill (eski tarix) | B.1–B.5 |
| Tranzaksiya ro'yxati, vipiska, inspektor, o'zgargan to'lovlar | B.6 |
| Bank sverka va Telegram xabarlari | B.7, B.8 |
| Import (Excel, Aloqa, Hamkor vipiska) | B.9 |
| Kategoriya va shartnoma aniqlash (parser, CRM kesh) | B.10, B.11 |
| Kontragentlar (DIDOX), ta'minot ERP | B.12, B.13 |
| OplatyKv sync, split, schotchik, perebroska, memorial order | C.1 |
| CRM klienti, CRM sverka, XonPay Billing | C.2–C.4 |
| Google Sheets eksport, SHMITD, vznos | C.5–C.7 |
| XATO ariza, AI tekshiruvchi, digest, tuzatish boti | D.1–D.4 |
| TR Support (bot orqali tahrir, ariza, hisob, perebroska, tarix) | D.5, F.14–F.20 |
| agent-bridge endpointlari | D.6, F.21 |
| Chek order, Shartnoma nazorati (/chek) | D.7, D.8 |
| Panel sahifalari va tugmalari | E (har sahifa alohida `###`) |
| Bot arxitekturasi, buyruqlar, Facts, Checker, Support REJA | F |
| Atamalar | G |
| Ochiq xavflar va kamchiliklar | H |

## A. Platforma va server

Bu bo'lim tizimning "asosi"ni tasvirlaydi: backend qanday ishga tushadi, login va ruxsatlar (RBAC), audit, umumiy yordamchilar, GitHub webhook orqali deploy, server skriptlari (systemd, nginx, setup), bank IP whitelist proksi, Telegram backup, tashqi API kalitlari (Developer/Universal API), API Explorer, bank parolini avtomat topish, `mobile/` qobig'i, `.env` kalit nomlari va Prisma sxemasining to'liq xaritasi.

Umumiy oqim:

```
brauzer / mobil qobiq
   → nginx (transactions.xonapps.uz, certbot SSL)
       ├─ /api/  → 127.0.0.1:3001 (NestJS, global prefiks /api)
       ├─ /docs/ → 127.0.0.1:3001 (Swagger, faqat non-production)
       └─ /      → 127.0.0.1:3000 (Next.js panel)
   → PostgreSQL `xon_tranzactions` (faqat localhost)
GitHub push → POST /api/_deploy (HMAC) → scripts/deploy.sh (fonda)
```

Repo tuzilishi (yuqori daraja):

| Papka/fayl | Nima | Git'da |
|---|---|---|
| `backend/` | NestJS 10 + Prisma 5 + PostgreSQL API (`src/`, `prisma/schema.prisma`, `prisma/seed.ts`, `prisma/sql/chek_dog.sql`) | ha |
| `frontend/` | Next.js 14 (App Router) panel, next-intl (uz, ru, en), Tailwind, shadcn/ui | ha |
| `agents/` | Python Telegram agentlar jamoasi (alohida `xon-tranzactions-leader` servisi, unit `agents/deploy/xon-tranzactions-leader.service`) | ha |
| `scripts/` | `deploy.sh`, `setup-*.sh`, `systemd/`, `nginx/`, PHP forwarderlar, `maintenance/`, `crm-diag.mjs` | ha |
| `docs/` | `universal-api.md` (tashqi API yo'riqnomasi), `tolov-tekshirish-prompt.md` | ha |
| `static/tg_uploads/` | agentlar boti Telegram'dan olgan fayllar papkasi (`agents/config.py::UPLOADS_DIR`), ichida `.gitignore` (`*`) | papka bo'sh |
| `mobile/` | Capacitor 6 Android qobig'i (pastda) | YO'Q (untracked) |
| `proxy/` | xt-forwarder'ning env bilan sozlanadigan varianti + nginx namunasi (pastda) | YO'Q (untracked) |
| `tz/` | texnik topshiriqlar, bank API hujjatlari, Postman to'plami, rasmlar | qisman; deploy'da e'tiborsiz |
| `README.md` | eski boshlang'ich yo'riqnoma (stack, lokal ishga tushirish, setup-server, webhook) | ha |

---

### A.1. Backend bootstrap — `backend/src/main.ts`

- `NestFactory.create(AppModule, { rawBody: true, bodyParser: true })`, logger darajalari: log, error, warn, debug, verbose.
- Body limit: `express.json({ limit: '100mb', verify })` va `urlencoded({ limit: '100mb' })` — katta Excel import uchun. `verify` har JSON so'rovda xom buferni `req.rawBody` ga yozadi (GitHub webhook HMAC tekshiruvi shunga tayanadi).
- `app.set('trust proxy', Number(TRUST_PROXY_HOPS || 1))` — nginx orqasida `req.ip` haqiqiy mijoz IP bo'lishi uchun ("FIX (A1)" izohi).
- Global `ValidationPipe`: `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, `enableImplicitConversion: true`. Diqqat: faqat class DTO'lar validatsiya qilinadi; ko'p controller `@Body() body: {...}` (inline tip) ishlatadi — bunday body'lar umuman tekshirilmaydi.
- CORS: `CORS_ORIGIN` (default `http://localhost:3000`). Qiymat `*` bo'lsa `origin: true` va `credentials: false` (xavfsizlik FIX A1); aks holda vergul bilan ajratilgan aniq domenlar va `credentials: true`.
- Global prefiks: `app.setGlobalPrefix('api', { exclude: ['/'] })`.
- Swagger (`SWAGGER_PATH`, default `docs`, Bearer auth, `persistAuthorization`) FAQAT `NODE_ENV !== 'production'` bo'lsa. Prod'da `/docs` 404 (nginx proksilasa ham).
- Port: `PORT` (default 3001).

### A.2. `app.module.ts` — modullar va global qatlamlar

- `ConfigModule.forRoot({ isGlobal: true })` (env `.env` dan), `ScheduleModule.forRoot()` (barcha `@Cron` lar backend jarayonida).
- `ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])` + `{ provide: APP_GUARD, useClass: ThrottlerGuard }` — har IP uchun daqiqasiga 300 so'rov, BARCHA route'larga (shu jumladan webhook va `/api/v1`). Izoh: ilgari ThrottlerModule sozlangan-u guard ulanmagan edi ("throttling o'lik edi"). Xotira ichidagi hisoblagich, restartda nollanadi. `agent-bridge` controller'i qattiqroq `@Throttle` limitlarini qo'yadi (2..30/daq).
- Global interceptor: `AuditInterceptor` (`AuditModule` ichida `APP_INTERCEPTOR`). Global guard faqat Throttler: JWT GLOBAL EMAS — har controller o'zi `@UseGuards(JwtAuthGuard, PermissionsGuard)` qo'yadi. Guard qo'yilmagan controller/metod ochiq bo'lib qoladi.
- Global modullar (`@Global`): `PrismaModule`, `CryptoModule`, `AuthModule` (JwtModule eksport).
- Ro'yxatdan o'tgan modullar (tartib bilan): Prisma, Crypto, Kapitalbank (integratsiya), Hamkorbank (integratsiya), Auth, AdminUsers, Roles, Banks, BankCredentials, BankAccounts, Transactions, Customers, Contracts, Payments (eski billing), Sync, Deploy, Backup, ApiExplorer, Crm, CrmSverka, Counterparties, SverkaTelegram, Categorization, Vznos, ChekOrder, Import, Attachments, Xonpay, OplataKv, GoogleExport, Agent, CorrectionBot, Shmitd, Taminot, KategoriyaAgent, BankPwd, DeveloperApi, Chek, Correction, Audit, Leader (v1), AgentTeam, AgentBridge, TrSupport.

Controller prefikslari (`/api/<prefiks>`) va kirish turi:

| Prefiks | Fayl | Kirish |
|---|---|---|
| `auth` | `auth/auth.controller.ts` | `login` ochiq, `me` JWT |
| `admin-users`, `roles`, `audit` | tegishli modul | JWT (+ ruxsat; `audit` faqat JWT) |
| `_deploy` | `deploy/deploy.controller.ts` | POST HMAC; `health`, `status`, `hamkor-diag` OCHIQ; `log` JWT + `system:deploy` |
| `backup` | `backup/backup.controller.ts` | JWT + `system:deploy` (class-level) |
| `api-keys` | `developer-api/api-key-admin.controller.ts` | JWT + `api_keys:*` |
| `v1`, `v1/universal` | `developer-api/public-api.controller.ts`, `universal-api.controller.ts` | `ApiKeyAuthGuard` (X-API-Key + X-API-Secret), JWT yo'q |
| `api-explorer` | `api-explorer/api-explorer.controller.ts` | JWT + `credentials:manage` (class-level) |
| `bank-pwd` | `bank-pwd/bank-pwd.controller.ts` | JWT + `credentials:manage` (+ raqamli kirish kodi) |
| `agent` (public qismi) | `agent/agent-public.controller.ts` | JWT yo'q; maxfiy kalit yoki Telegram login_url imzosi |
| `agent-bridge` | `agent-bridge/agent-bridge.controller.ts` | `AgentBridgeGuard`: `x-agent-bridge-key` == env `AGENT_BRIDGE_KEY` + proksi header yo'qligi + loopback; Swagger'dan yashirin |
| `chek-order/tg` | `chek-order/chek-tg.controller.ts` | Telegram initData/login → mehmon JWT; webhook `:secret` |
| `agent-team`, `tr-support`, `kategoriya-agent` va boshqa biznes prefikslar | tegishli modullar | JWT + ruxsat (boshqa bo'limlarda) |

Biznes prefikslari: `transactions`, `transactions/:txId/attachments`, `categorization`, `counterparties`, `taminot`, `customers`, `contracts`, `payments`, `sync`, `banks`, `bank-accounts`, `bank-credentials`, `import`, `oplata-kv`, `vznos`, `correction`, `correction-bot`, `agent`, `crm`, `crm-sverka`, `sverka-telegram`, `xonpay`, `chek-order`, `chek`, `google-export`, `shmitd`. `leader` (v1) modulida controller yo'q — faqat long-polling bot va cron.

---

### A.3. Auth — `backend/src/auth/`

Fayllar: `auth.controller.ts`, `auth.service.ts`, `auth.module.ts` (`@Global`), `jwt.strategy.ts`, `permissions.ts`, `dto/login.dto.ts`, `guards/{jwt-auth,permissions,roles}.guard.ts`, `decorators/{current-user,permissions,roles}.decorator.ts`.

Endpointlar:

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/api/auth/login` | ochiq | `LoginDto` (`email` IsEmail, `password` min 4) → `{ ok, token, user: { id, email, fullName, role, roleId, roleLabel, permissions } }`. Muvaffaqiyatda audit'ga "Tizimga kirish" yoziladi |
| GET | `/api/auth/me` | JWT | joriy foydalanuvchi + `permissions` + `lastLoginAt` |

Login oqimi (`AuthService.login`):
1. `adminUser.findUnique({ email: lower(email) })` + `roleRef`.
2. Yo'q yoki `isActive = false` → 401 "Email yoki parol noto'g'ri" (bir xil matn — foydalanuvchi borligini oshkor qilmaydi).
3. `bcrypt.compare(password, passwordHash)`; xato → 401.
4. `lastLoginAt = now`.
5. JWT payload: `{ sub: user.id, email, role }` (`role` — eski `AdminRole` enum). Imzo `JWT_SECRET` (`getOrThrow` — yo'q bo'lsa backend ishga tushmaydi), muddat `JWT_EXPIRES_IN` (default `7d`; deploy.sh ham `.env` ga `7d` yozadi; `setup-server.sh` eski `12h` yozardi).
6. `permissions` = `roleRef.permissions` (rolsiz → bo'sh ro'yxat; hech qanday hardcode yo'q).

`JwtStrategy.validate` (HAR so'rovda DB'dan o'qiydi):
- `payload.tgGuest` bo'lsa → AdminUser emas: `{ id: sub, isTelegramGuest: true, fullName: name, permissions: ['chekorder:view','chekorder:manage','chekorder:assistant','chekorder:tickets'] }`. Bunday tokenni `chek-order/chek-tg.service.ts` imzolaydi (`sub = 'tg:<telegramId>'`, muddat 12h, guruh a'zoligi Telegram `getChatMember` bilan tekshirilgach).
- Aks holda foydalanuvchi qayta o'qiladi; yo'q yoki faol emas → 401. Demak `isActive = false` qilish token muddatini kutmasdan darhol kirishni yopadi; rol ruxsatlari o'zgarishi ham darhol amal qiladi (qayta login shart emas).
- Rol nomi `SUPERADMIN` bo'lsa → HAR DOIM `ALL_PERMISSIONS` (DB'dagi ro'yxatdan qat'i nazar).
- `req.user` = `{ id, email, role, roleId, fullName, permissions }`.

Guard va dekoratorlar:
- `JwtAuthGuard` = `AuthGuard('jwt')`, Bearer header'dan.
- `PermissionsGuard` + `@RequirePermissions(...perms)` — OR mantiq: ro'yxatdan kamida bittasi bo'lsa o'tadi; dekorator yo'q bo'lsa o'tkazadi; `req.user` yo'q → 403 "Tizimga kirilmagan"; yetmasa 403 "Bu amal uchun ruxsat yo'q: ...".
- `RolesGuard` + `@Roles('SUPERADMIN')` — ESKI: `req.user.role` (legacy `admin_users.role` enum) ni tekshiradi, RBAC rolni emas. Faqat 2 joyda: `GET /api/transactions/count-by-account/:accountNo` va `POST /api/transactions/cleanup-by-account`. Gotcha: admin yaratish/tahrirlash API'si `role` enum'ni hech qachon yozmaydi (default `ADMIN`), seed ham yozmaydi — shuning uchun bu ikki endpoint faqat DB'da enum qo'lda `SUPERADMIN` qilingan foydalanuvchiga ishlaydi (kimda borligi aniq emas).
- `@CurrentUser(field?)` — `req.user` yoki uning maydoni.

Yo'q narsalar (muhim): refresh token endpoint yo'q (`/auth/refresh` faqat audit SKIP ro'yxatida tilga olingan), logout/token qora ro'yxati yo'q, panel uchun Telegram login yo'q (`audit.routes.ts` dagi `POST auth/telegram`, `auth/logout` nomlari ishlatilmaydi). Parol o'zgarganda eski token muddati tugaguncha amal qiladi.

Frontend tomoni: token `localStorage['xt_token']`, har so'rovda `Authorization: Bearer` (`frontend/lib/api.ts`, default timeout 15 s, `NEXT_PUBLIC_API_URL` default `http://localhost:3001/api`). Auth store `frontend/lib/auth.ts`, ruxsat konstantalari `frontend/lib/permissions.ts`, sahifa himoyasi `components/route-guard.tsx` (`ROUTE_PERMISSIONS`), menyu `components/sidebar.tsx`.

---

### A.4. Ruxsatlar — `backend/src/auth/permissions.ts`

- `PERMISSIONS` — 97 kalit (format `modul:amal`), `ALL_PERMISSIONS = Object.values(PERMISSIONS)`.
- `PERMISSION_TREE` — UI uchun ierarxiya modul → sahifa → item (Rollar sahifasi collapsible). Daraxtda yo'q yagona kalit: `oplatakv:manage` (legacy).
- `PERMISSION_GROUPS` — eski tekis ko'rinish (backward compat), `SYSTEM_ROLES` — faqat `SUPERADMIN` (`label` "Bosh administrator", `ALL_PERMISSIONS`). ADMIN/ACCOUNTANT/VIEWER default rollari olib tashlangan.

To'liq ro'yxat ("BE" ustuni = backend'da qaysi controller modullari tekshiradi; "faqat UI" = backend hech qayerda `@RequirePermissions` bilan talab qilmaydi, faqat frontend tugma/karta/sahifani yashiradi):

| Kalit | Nima ochadi | BE |
|---|---|---|
| `dashboard:view` | Bosh sahifani ochish | faqat UI |
| `dashboard:kpi_balance`, `kpi_accounts`, `kpi_banks`, `kpi_inflow`, `kpi_outflow`, `kpi_txn` | yuqori KPI kartalar (jami qoldiq, hisoblar soni, banklar soni, 30 kun kirim/chiqim/tranzaksiya) | faqat UI |
| `dashboard:objects`, `daily`, `daily_bar`, `client`, `xonpay`, `top_accounts`, `sync_status`, `banks_breakdown`, `net_flow` | dashboard vidjetlari (obyektlar, kunlik grafiklar, klient to'lovlari, XonPay debitor, eng katta hisoblar, sync holati, banklar taqsimoti, sof oqim) | faqat UI |
| `dashboard:recon` | Tranzaksiya sverka paneli (bank qoldiq + explorer) | transactions |
| `transactions:view` | tranzaksiyalar ro'yxati | transactions, attachments, correction, tr-support |
| `transactions:manual_edit`, `manual_contract`, `application`, `auto_categorize` | qo'lda tahrir, qo'lda shartnoma, Ariza, Avto-kategoriyalash tugmalari | faqat UI (backend `categories:manage` va boshqalarni tekshiradi) |
| `transactions:export` | Excel/CSV/PDF eksport | transactions |
| `transactions:vipiska_view` | Vipiska sahifasi | transactions |
| `transactions:sverka_view`, `sverka_fix` | bank sverka ko'rish / sana va yozuv tuzatish | transactions, sverka-telegram |
| `transactions:sverka_crm_view`, `sverka_crm_run` | CRM sverka ko'rish / CRM'dan jonli yangilash | crm-sverka |
| `changed_txn:view`, `check`, `restore` | O'zgargan to'lovlar: ko'rish / qo'lda re-verify / o'chirilganni tiklash | transactions |
| `vznos:view`, `vznos:manage` | "Взнос от имени клиента" reestri | vznos |
| `chekorder:view`, `history`, `manage`, `assistant`, `tickets`, `telegram` | Chek order: sahifa, tarix, yuklash/o'chirish, AI yordamchi, murojaatlar, Telegram Mini App sozlamasi | chek-order |
| `oplatakv:view` | OplatyKv jadvali | oplata-kv, crm |
| `oplatakv:create`, `edit`, `delete`, `split`, `sync`, `bulk_split`, `xato_crm` | qator qo'shish/tahrir/o'chirish, split, "Hozir sync", ommaviy `Оплата` turi, XATO→CRM moduli | oplata-kv (`xato_crm` crm'da ham) |
| `oplatakv:import` | Excel import tugmasi | faqat UI |
| `oplatakv:manage` | legacy (oplata-kv controller'ida hali 17 ta `@RequirePermissions` shuni talab qiladi), daraxtda ko'rinmaydi | oplata-kv |
| `accounts:view`, `manage` | bank hisoblari | bank-accounts |
| `credentials:view`, `manage`, `test` | bank ulanishlari ko'rish / qo'shish-o'chirish / tekshirish | bank-credentials (`manage` yana api-explorer, bank-pwd) |
| `credentials:reveal` | bank parolini ochiq ko'rish | bank-credentials |
| `banks:view`, `manage` | banklar | banks |
| `users:view`, `manage` | panel foydalanuvchilari | admin-users |
| `roles:view`, `manage` | rollar | roles |
| `admin_login:view` | `/admin/login` (bank parol xatolari sahifasi, panel logini emas) | faqat UI |
| `counterparties:view`, `manage` | kontragentlar (DIDOX) | counterparties |
| `sync:view` | Sync tarixi (legacy, ikkala tab) | sync |
| `sync:history_view`, `settings_view`, `settings_edit` | Sync sahifasi tablari | faqat UI |
| `sync:run` | manual sync | sync, import |
| `api_explorer:view` | API Explorer tabi | faqat UI (backend `credentials:manage`) |
| `cleanup:view`, `cleanup:run` | Tozalash | transactions |
| `import:view`, `import:run` | Import tabi | faqat UI (backend import `sync:run` talab qiladi) |
| `export:view`, `run`, `manage`, `download`, `autsourcing` | Google Sheets eksport, SHMITD, fayl yuklab olish, Autsourcing | google-export (`view/run/manage` shmitd'da ham) |
| `system:deploy` | deploy log + Backup boshqaruvi | deploy, backup |
| `api_keys:view`, `manage` | Developer API kalitlari | developer-api |
| `agent:view`, `manage` | AI Agent bo'limi | agent, agent-team, correction-bot |
| `chek:baza`, `chek:tarix`, `chek:sozlamalar` | alohida `/chek` sahifa tablari | chek |
| `crm:view` | CRM qidiruv | crm, xonpay |
| `xonpay:manage` | XonPay destruktiv amallar | xonpay |
| `categories:view`, `manage` | kategoriyalar ko'rish / tranzaksiya kategoriyasini o'zgartirish (eng ko'p ishlatiladigan yozish ruxsati) | categorization, attachments, correction, kategoriya-agent, taminot, tr-support |
| `customers:*`, `contracts:*`, `payments:*` (`view`, `manage`) | eski billing | customers, contracts, payments |

Jami 28 ta kalit "faqat UI": ular backend'da tekshirilmaydi, ya'ni API'ni to'g'ridan-to'g'ri chaqirgan foydalanuvchi uchun cheklov emas.

Yangi ruxsat qo'shish 3 joyda: `backend/src/auth/permissions.ts` (`PERMISSIONS` + `PERMISSION_TREE`), `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS`. Hozirgi holat: frontend faylida `credentials:reveal` va `xonpay:manage` yo'q (95 ta); seed `ALL_PERMS` da faqat 62 ta (35 tasi yo'q — pastga qarang).

### A.5. Rollar — `backend/src/roles/`

`RolesService`:
- `onModuleInit` (har backend start): har `SYSTEM_ROLES` uchun — yo'q bo'lsa yaratadi (`isSystem: true`); SUPERADMIN uchun ruxsatlarni AYNAN `ALL_PERMISSIONS` ga tenglaydi (kodda yo'q eski kalitlar ham olib tashlanadi); boshqa tizim rollari uchun union. So'ng `isSystem = true` lekin `SYSTEM_ROLES` da yo'q "yetim" rollarni o'chiradi — foydalanuvchi biriktirilgan bo'lsa saqlab, ogohlantiradi. Xato bo'lsa faqat warn (app to'xtamaydi).
- `permissionsCatalog()` → `{ all, groups, tree }`.
- `create`: ruxsatlar `ALL_PERMISSIONS` ga qarshi tekshiriladi (noma'lum → 400), nom KATTA harfga o'tkaziladi, `isSystem: false`. Gotcha: mavjudlik `dto.name` (o'zgartirilmagan) bo'yicha tekshiriladi, saqlash esa uppercase — kichik harfli takror nom 409 o'rniga unique xatosi (500) beradi.
- `update`: label, description, permissions (tizim roli ham tahrirlanadi, lekin SUPERADMIN ruxsatini qisqartirish foyda bermaydi — `validate` va `onModuleInit` qaytaradi).
- `remove`: rolga foydalanuvchi bog'langan bo'lsa 400; `isSystem` cheklovi yo'q (SUPERADMIN'ni foydalanuvchisiz bo'lsa o'chirish mumkin, keyingi startda qayta yaratiladi).

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET | `/api/roles/permissions` | `roles:view` |
| GET | `/api/roles`, `/api/roles/:id` | `roles:view` (ro'yxatda `_count.users`, bittasida foydalanuvchilar) |
| POST, PATCH `/:id`, DELETE `/:id` | `/api/roles` | `roles:manage` |

### A.6. Panel foydalanuvchilari — `backend/src/admin-users/`

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/admin-users` | `users:view` | ro'yxat (`passwordHash` olib tashlanadi), `roleRef { id, name, label }` |
| POST | `/api/admin-users` | `users:manage` | `CreateAdminDto`: `email`, `password` (min 8), `fullName?`, `roleId?`, `role?` (legacy enum — QABUL qilinadi, lekin saqlanmaydi). Email lowercase, bcrypt 10 raund, takror email 409, noto'g'ri rol 404 |
| PATCH | `/api/admin-users/:id` | `users:manage` | `fullName`, `isActive`, `password` (qayta hash), `roleId` (`null`/'' → rolni olib tashlash) |
| DELETE | `/api/admin-users/:id` | `users:manage` | butunlay o'chirish |

Himoya yo'q: o'zini o'chirish/faolsizlantirish yoki oxirgi SUPERADMIN foydalanuvchini o'chirish taqiqlanmagan.

### A.7. Seed — `backend/prisma/seed.ts` (`npm run seed`, ts-node)

Har backend deploy'da (`deploy.sh`) chaqiriladi, idempotent; xatosi deploy'ni to'xtatmaydi.
1. SUPERADMIN roli: yo'q bo'lsa `ALL_PERMS` bilan yaratadi (`isSystem: true`); bor bo'lsa faqat yetishmaganlarni qo'shadi.
2. Birinchi admin: `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` (default qiymatlar kodda/.env da). Mavjud bo'lsa va rolsiz bo'lsa SUPERADMIN rolini biriktiradi. Yangi yaratilganda parolni konsolga chiqaradi (deploy log'iga tushishi mumkin).
3. Banklar: `KAPITALBANK` (URL `KAPITALBANK_API_URL` yoki kod default), `IPAK_YULI` — ikkalasi `apiKind: KAPITALBANK_V3`; faqat yo'q bo'lsa yaratadi yoki bo'sh `apiBaseUrl` ni to'ldiradi. (Boshqa banklarni, jumladan Hamkor va nofaol banklarni `banks.service.ts::onModuleInit` qo'shadi — boshqa bo'lim.)
4. `seedCategories()` — 2 darajali daraxt: `CLIENT` (bolalari `CLIENT_VZNOS_KV`, `CLIENT_VZNOS_AVTO`, `CLIENT_VOZVRAT`, `CLIENT_SCHETCHIK`, `CLIENT_PEREOFORM`, `CLIENT_VZNOS_IMENI`), `BANK` (`BANK_USLUGI`), `SALARY`, `TRANSFER`, `MINFIN` (`MINFIN_NDS`, `MINFIN_NDFL`, `MINFIN_NDFL_DIV`, `MINFIN_WATER`, `MINFIN_ESP`, `MINFIN_WATER_RES`, `MINFIN_LAND`, `MINFIN_PROPERTY`, `MINFIN_PENALTY`, `MINFIN_PROFIT`, `MINFIN_PENSION`), `LOAN` (`LOAN_VYDACHA`), `COUNTERPARTY_RETURN`, `COUNTERPARTY`. Rang/ikonka/sortOrder/`isSystem` to'ldiriladi, mavjud nomlar o'zgartirilmaydi.
5. Backfill'lar (`main()` dan keyin zanjir): `counterparties.is_manual` (INN 9 yoki 14 raqam bo'lmasa manual), `counterparty_history.actor_name` → email, Ipak Yo'li `transactions.external_id` ga `IP_` prefiks, `transactions.direction` qayta hisob (`to_account` = o'z hisob → IN, `from_account` → OUT).

ALL_PERMS gotcha: seed ro'yxati 62 ta, kodda 97 ta. Yo'qlar: `transactions:manual_edit/manual_contract/application/auto_categorize/export/vipiska_view/sverka_view/sverka_fix/sverka_crm_view/sverka_crm_run`, `changed_txn:*`, `oplatakv:create/edit/delete/import/split/sync/xato_crm/bulk_split`, `admin_login:view`, `sync:history_view/settings_view/settings_edit`, `api_explorer:view`, `cleanup:*`, `import:*`, `api_keys:*`, `chek:*`. Amalda zarar yo'q, chunki SUPERADMIN'ni `RolesService.onModuleInit` va `JwtStrategy` baribir `ALL_PERMISSIONS` ga tenglaydi; lekin seed'ga tayanib boshqa rol yaratish noto'g'ri bo'ladi. Qoida: yangi ruxsat qo'shilsa `ALL_PERMS` ga ham qo'shish.

---

### A.8. Audit — `backend/src/audit/`

- `AuditInterceptor` (global `APP_INTERCEPTOR`): faqat `POST`, `PATCH`, `PUT`, `DELETE`. SKIP: yo'l `/_deploy`, `/audit`, `/auth/refresh` bilan boshlansa (`/api` prefiksli va prefikssiz). Natija `tap` (muvaffaqiyat, `res.statusCode`) yoki `catchError` (`err.status` yoki 500, xato matni 200 belgi) da yoziladi; hammasi try/catch — audit hech qachon so'rovni buzmaydi.
- Guard'lar interceptordan OLDIN ishlaydi: 401/403 (JWT yoki ruxsat rad etgan) so'rovlar audit'ga TUSHMAYDI. Throttler 429 ham tushmaydi.
- IP: `x-forwarded-for` ning BIRINCHI elementi, bo'lmasa `req.ip`. Diqqat: nginx `$proxy_add_x_forwarded_for` bilan mijoz yuborgan header'ga qo'shadi, shuning uchun birinchi element soxtalashtirilishi mumkin (`req.ip` esa trust proxy bilan to'g'ri).
- `meta` = `{ params, error }` (route parametrlari va xato matni); body YOZILMAYDI (parol/token audit'ga tushmaydi).
- `AuditService.record` — fire-and-forget `auditLog.create`; uzunliklar kesiladi (email/ism 190, action 190, module 64, path 400, ip 64).
- `recentForUser(userId, limit)` — max 200; `statsForUser` — jami soni, faol kunlar (oxirgi 3000 amal bo'yicha, Toshkent +5 kun), oxirgi amal vaqti.
- Login ikki marta yoziladi: `AuthController.login` o'zi (ism bilan, "Tizimga kirish") + interceptor (`user_id` NULL, chunki login'da `req.user` yo'q). Muvaffaqiyatli login = 2 qator, muvaffaqiyatsiz = 1 qator (`success = false`). Telegram mehmoni `user_id = 'tg:<id>'`, email NULL.

`audit.routes.ts::describeRoute(method, url)`:
- `/api` olib tashlanadi; birinchi segment `MODULE_MAP` orqali modulga aylanadi (`oplata-kv`→`oplatykv`, `crm-sverka`→`crm`, `bank-accounts`/`bank-credentials`→`banks`, `google-export`/`shmitd`→`export`, `permissions`→`roles`; topilmasa segmentning o'zi).
- ID normallash: `agent-bridge/exports/<id>`, `/c[a-z0-9]{20,}` (cuid), 16+ hex, raqamlar → `:id`.
- `KNOWN` — 30 ta aniq o'zbekcha nom (masalan `POST sync/run` "Sync ishga tushirildi", `POST oplata-kv/:id/split`, `POST agent-bridge/tx-edit/apply`, `POST tr-support/unlock` "TR Support: kod bilan kirish"). Qolganlari: `"<base> · <sub> bajarildi|yangilandi|o'chirildi"`.
- Gotcha: `MODULE_MAP` va `KNOWN` da `users` kaliti bor, lekin haqiqiy yo'l `admin-users` — shu sababli foydalanuvchi amallari modul `admin-users` va umumiy nom bilan yoziladi.

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/audit/my-activity?limit=` | JWT | o'z amallari (default 30) + `stats` (profil > Xavfsizlik) |

Jadval `audit_logs`, retention yo'q (so'rovda sana sharti majburiy). Tarix audit qo'shilgan commitdan boshlanadi.

---

### A.9. Umumiy yordamchilar — `backend/src/common/` va `sync/settings.service.ts`

- `common/prisma/prisma.service.ts` — `PrismaClient` kengaytmasi, `onModuleInit` da `$connect` ("Prisma connected"), `onModuleDestroy` da `$disconnect`. `PrismaModule` global.
- `common/crypto/crypto.service.ts` — AES-256-GCM. Kalit `CRED_ENC_KEY` (base64, AYNAN 32 bayt; yo'q yoki noto'g'ri uzunlik → konstruktor xato tashlaydi, backend ishga tushmaydi). Format: `base64(iv[12] | ciphertext | authTag[16])`. `encrypt(plain)`, `decrypt(payload)` (juda qisqa payload → xato). Ishlatuvchilar: `bank_credentials.password_enc`, `bankpwd.*` sozlamalari, ba'zi bot tokenlari settings'da. Bu eng xavfli kalit: u bilan barcha shifrlangan qiymatlar ochiladi.
- `common/tashkent.ts` — `TOSHKENT_OFFSET_MS` (5 soat, yozgi vaqt yo'q), `tashkentKun(d)` → `YYYY-MM-DD` Toshkent kuni, `tashkentKunOraligi(kun)` → `{from: T00:00:00+05:00, to: T23:59:59.999+05:00}`. Sabab (izohdan): bank vaqti `+05:00` bilan to'g'ri lahza saqlanadi, lekin `toISOString().slice(0,10)` UTC kunini beradi — 00:00–05:00 oralig'idagi to'lov bir kun oldin ko'rinardi (vipiska, sverka, eksport, AI ma'lumoti). Kun doim shu funksiya orqali olinadi.
- `sync/settings.service.ts::SettingsService` — `settings` jadvali uchun `get(key)`, `set(key, value, updatedBy)` (upsert) va tipli yordamchilar. U boshqaradigan kalitlar: `sync.minDate`, `oplatykv.txMinDate`, `oplatykv.txAutoSyncMinutes`, `oplatykv.dayStart/dayEnd/nightStart/nightEnd`, `oplatykv.autoXatoCleanup`, `bulkSync.enabled/daysBack/intervalDays/timeOfDay/lastRunAt`, `schotchik.auto/dateFrom/dayStart/dayEnd/intervalMin`. `settings.key` `VarChar(64)` — 64 belgidan uzun kalit yozilmaydi.

---

### A.10. Deploy moduli — `backend/src/deploy/`

`DeployService` konfiguratsiyasi (env, defaultlar kodda): `DEPLOY_REPO_DIR` (default `/var/www/xon_tranzactions`), `DEPLOY_BRANCH` (`main`), `GH_DEPLOY_SECRET`, `TG_BOT_TOKEN`, `DEPLOY_NOTIFY_CHAT`, `DEPLOY_BACKEND_SERVICE` (`xon-tranzactions-backend`), `DEPLOY_FRONTEND_SERVICE` (`xon-tranzactions-frontend`), `DEPLOY_LOG` (`/var/log/xon-tranzactions/deploy.log`).

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/api/_deploy` | HMAC `x-hub-signature-256` | GitHub webhook. Har doim HTTP 200; imzo xato → `{ ok:false, error:'invalid signature' }`; `ping` → pong; `push` dan boshqa event → ignored; push → `servicesToRestart` → `triggerAsync` → `{ ok, queued, branch, files, services }` |
| GET | `/api/_deploy/health` | OCHIQ | `{ branch, repo (yo'l), secretConfigured, telegramConfigured }` |
| GET | `/api/_deploy/status` | OCHIQ | deploy log oxirgi 500 qatoridan holat (pastda) |
| GET | `/api/_deploy/hamkor-diag` | OCHIQ | "vaqtinchalik": server chiqish IP'sini ip-echo servisidan oladi va Hamkorbank prod/lab `get-bank-day` ga auth'siz probe (403 = IP whitelist qilinmagan; 400/-801 = whitelist bor). Tashqi so'rov qiladi |
| GET | `/api/_deploy/log` | JWT + `system:deploy` | log oxirgi 200 satr |

Asosiy metodlar:
- `verifySignature(raw, sig)` — `sha256=` + HMAC-SHA256(`GH_DEPLOY_SECRET`, rawBody), `timingSafeEqual`. Secret bo'sh bo'lsa har doim false.
- `changedFilesFromPayload` — barcha commit'larning `added/modified/removed` birlashmasi.
- `servicesToRestart(files)`: `.md`, `.txt`, `docs/`, `.github/`, `tz/` → e'tiborsiz; `frontend/` → frontend; `backend/` → backend; boshqa har qanday yo'l (root fayl, `scripts/`, `agents/`, `mobile/`...) → IKKALASI. Bo'sh ro'yxat (faqat hujjat) → restartsiz.
- `triggerAsync` — `/bin/sh -c 'nohup scripts/deploy.sh >> LOG 2>&1 &'`, `detached`, env: `DEPLOY_FROM_WEBHOOK=1`, `DEPLOY_SERVICES`, `DEPLOY_FILES`, `DEPLOY_PUSHER`, `DEPLOY_PUSHED_BRANCH`, `DEPLOY_COMMIT` va yuqoridagilar.
- `status()` — oxirgi `DEPLOY START`, `DEPLOY OK` / `✗ FAIL:` qatorlarini topadi. `state`: START END'dan yangi va 600 s dan yosh → `running`; aks holda oxirgi natija (`success`/`failed`) yoki `idle`. Fail bo'lsa `error TS\d+|Cannot find|Module not found` qatorini qaytaradi. Running'da `[deploy] → faza` / `✓ faza` qatorlaridan `currentPhase`, `completedPhases`, `elapsedSeconds`, taxminiy `estimatedRemainingSeconds` va `progressPercent` (2..95) — `PHASE_DURATIONS` jadvali bo'yicha (masalan frontend build ~180 s). `currentCommit` — `.git/HEAD` → ref fayl, 8 belgi.

Gotchalar: webhook branch'ni tekshirmaydi — istalgan branch'ga push `origin/main` deployini boshlaydi. `status`/`health`/`hamkor-diag` auth'siz (commit, faza, xato qatori, repo yo'li ochiq). Frontend `components/topbar.tsx` va `deploy-modal.tsx` `/_deploy/status` ni har 3 s so'raydi: `currentCommit` ochilgan paytdagidan farq qilsa "yangi versiya" belgisi (hard refresh kerak).

### A.11. `scripts/deploy.sh` — bosqichma-bosqich

`set -u`; standart qiymatlar env'dan (`DEPLOY_REPO_DIR`, `DEPLOY_BRANCH`, `DEPLOY_SERVICES`, `DEPLOY_BACKEND_SERVICE`, `DEPLOY_FRONTEND_SERVICE`, `DEPLOY_LOG`, `DEPLOY_LOCK` — default `/var/run/xon-tranzactions-deploy.lock`).

0. Tayyorgarlik: `DEPLOY_COMMIT`/`PUSHED_BRANCH`/`PUSHER` bo'sh bo'lsa git'dan yoki "qo'lda". Webhook'siz qo'lda ishga tushirilsa va `DEPLOY_SERVICES` bo'sh bo'lsa — IKKALA servis quriladi. Telegram token/chat zaxira qiymatlari, forwarder URL/secret skript ichida qattiq yozilgan (sir git'da — pastdagi "Xavfli joylar"ga qarang). `NODE_OPTIONS=--max-old-space-size=2048`, `NEXT_TELEMETRY_DISABLED=1`.
1. Log aylantirish: log 20 MB dan oshsa oxirgi 5000 qator qoladi (2026-10-09, disk 85% bo'lgani uchun).
2. Eskirgan lock: lock fayl bor, lekin `fuser` hech qaysi jarayonni ko'rsatmasa — o'chiradi.
3. `exec 9>LOCK; flock -w 60 9` — 60 s ichida olinmasa "Tashlab ketildi" va exit 1 (deploy JIM tashlanadi, status eski commit'da qoladi). `trap` INT/TERM'da lock'ni o'chiradi. Agentlar boti (`agents/reja.py`) ham aynan shu lock faylni ishlatadi.
4. Telegram: "🟡 Deploy boshlandi · <commit8>". `tg()` JSON'ni python3 bilan escape qiladi, `curl -4` (IPv6 timeout muammosi), 2 retry.
5. Swap: `/swapfile_xon` (2 GB) yo'q bo'lsa `sudo -n fallocate/mkswap/swapon`; RAM va disk holati log'ga.
6. `ensure_env_var` — `backend/.env` ga HAR deployda qayta yozadi (qo'lda o'zgartirish keyingi deployda qaytadi): `TG_BOT_TOKEN`, `DEPLOY_NOTIFY_CHAT`, `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET`, `UPLOADS_DIR`, `ATTACHMENTS_NOTIFY_CHAT`, `APP_URL`, `JWT_EXPIRES_IN=7d`. `uploads/attachments` papkasini yaratadi va `www-data` ga chown qiladi (servislar esa root'da ishlaydi).
7. `git fetch --all --prune`, `git reset --hard origin/<BRANCH>` (xato → Telegram "git fetch/reset ishlamadi", exit).
8. Restart kerak emas (`need_be=0`, `need_fe=0`): "✅ Deploy OK · Ns" + branch, pusher, commit, fayllar (20 tagacha), "💤 Qayta ishga tushirish kerakmas (docs/config)" va exit 0.
9. Backend (`need_be`): `npm install --include=dev --prefer-offline` (log nomi "backend npm ci"); `npx prisma generate` (xatosi e'tiborsiz); `prisma/migrations` bo'sh/yo'q bo'lgani uchun (repo'da migratsiya YO'Q) har doim `npx prisma db push --accept-data-loss --skip-generate`; `npm run seed` (xato — "jiddiy emas"); `npm run build` (`tsc -p tsconfig.json`). Har xato → `tg_fail` va exit.
10. Frontend (`need_fe`): `npm install`; `.next-build`, `.next-old` tozalash; `.next/cache` ≤ 1 GB bo'lsa `.next-build/cache` ga ko'chiriladi (incremental), katta bo'lsa ko'chirilmaydi; `NEXT_DIST_DIR=.next-build npm run build` (`next.config.mjs::distDir`, TS xatolari build'ni yiqitadi, ESLint e'tiborsiz) — eski `.next` tegilmaydi, sayt build davomida ishlab turadi; so'ng `mv .next .next-old; mv .next-build .next`; darhol `sudo -n systemctl restart xon-tranzactions-frontend`; `.next-old` o'chiriladi.
11. Yakuniy Telegram: "✅ Deploy OK · Ns", branch, pusher, `sha — commit xabari`, o'zgargan fayllar (15 tagacha + "… va yana N ta"), "🔄 Qayta ishga tushirildi: 🌐 web + ⚙️ api | ⚙️ api | 🌐 web". Log'ga `DEPLOY OK`.
12. ENG OXIRIDA backend restart (`sudo -n systemctl restart xon-tranzactions-backend`). Deploy jarayoni backend tomonidan ishga tushirilgani uchun u backend servisining cgroup'ida — restart uni ham to'xtatadi ("o'z-o'zini o'ldiradi"), shuning uchun bu oxirgi qadam.

`tg_fail(caption)`: log'dan `error|fail|ENOENT|TS\d+:|Cannot find|Module not found|SyntaxError|...` qatorlarini (oxirgi 30, 2500 belgi) HTML-escape qilib `<pre>` ichida yuboradi, keyin oxirgi 300 qatorni fayl (`sendDocument`) sifatida.

Muhim nuqtalar: "Deploy OK" xabari backend restartidan OLDIN yuboriladi — yangi backend ishga tushmay qolsa ham Telegram OK deydi (tekshirish: `/_deploy/status`, `journalctl`). Restart fazasi bilan birga to'liq deploy odatda 5–8 daqiqa. `deploy.sh` o'zi `git reset` bilan yangilanadi (ishlab turgan skript fayli o'zgarishi — kamdan-kam g'alati xatti-harakat ehtimoli, aniq emas). `xon-tranzactions-leader` (Python bot) servisini deploy bilmaydi va restart qilmaydi.

### A.12. Server skriptlari: systemd, nginx, setup, maintenance

systemd (`scripts/systemd/`, serverga qo'lda nusxalanadi; deploy ularni qo'llamaydi):

| Unit | Asosiy sozlama |
|---|---|
| `xon-tranzactions-backend.service` | `After/Wants=postgresql.service`, `User=root`, `WorkingDirectory=/var/www/xon_tranzactions/backend`, `EnvironmentFile=backend/.env`, `ExecStart=/usr/bin/node dist/main.js`, `Restart=on-failure`, `RestartSec=5`, `LimitNOFILE=65536`, journal |
| `xon-tranzactions-frontend.service` | `After=...backend.service`, `User=root`, `WorkingDirectory=.../frontend`, `EnvironmentFile=frontend/.env.local`, `ExecStart=/usr/bin/npm start`, `Restart=on-failure` |
| `xon-tranzactions-leader.service` | `agents/deploy/` da (bu papkada emas): Python venv `-m agents.leader_bot`, `Restart=always`, `User=root` |

Unit'larda `TZ` berilmagan — cron va log vaqtlari server soat mintaqasiga bog'liq (kod ko'p joyda +5 ni qo'lda qo'shadi).

nginx (`scripts/nginx/xon-tranzactions.conf` → `/etc/nginx/sites-available/xon-tranzactions`): `server_name transactions.xonapps.uz`, port 80 (SSL'ni certbot qo'shadi); `client_max_body_size 200M`, `client_body_timeout 1800s`; `/api/` → `127.0.0.1:3001/api/` (`proxy_read/send_timeout 1800s`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Proto`); `/docs` → 301 `/docs/` → 3001; `/` → 3000 (WebSocket upgrade header'lari, timeout 60 s).

Setup skriptlari (bir martalik, root):
- `setup-server.sh` (Ubuntu 22.04+): 1) apt paketlar (git, build-essential, nginx, postgresql); 2) Node.js 20 (NodeSource); 3) Postgres rol va baza (`DB_USER`, `DB_PASS` tasodifiy, `DB_NAME`); 4) repo clone/reset; 5) `backend/.env` (yo'q bo'lsa) — `JWT_SECRET` (openssl hex 64), `CRED_ENC_KEY` (base64 32), `GH_DEPLOY_SECRET` tasodifiy generatsiya, `CORS_ORIGIN="*"`, `JWT_EXPIRES_IN="12h"`, `TXN_SYNC_CRON="*/5 * * * *"` va boshqalar; `frontend/.env.local` (`NEXT_PUBLIC_API_URL`); 6) backend install, prisma generate, migrate/db push, build, seed; 7) frontend build; 8) systemd unit'lar, sudoers (`/etc/sudoers.d/xon-tranzactions`: `systemctl restart` ikki servis uchun NOPASSWD), log papka, nginx; oxirida webhook sozlash ko'rsatmasi va generatsiya qilingan sirlarni konsolga chiqaradi.
- `setup-domain.sh` (`DOMAIN` default `transactions.xonapps.uz`): certbot o'rnatish, nginx konfigini domen bilan nusxalash, Let's Encrypt (`--redirect`), `backend/.env::CORS_ORIGIN="https://<domen>"`, `frontend/.env.local::NEXT_PUBLIC_API_URL="https://<domen>/api"`, frontend qayta build (NEXT_PUBLIC_* compile-time), servislar restart.
- `setup-bank-proxy.sh` — boshqa VPS'ga Tinyproxy (port 3128, faqat Xon server IP'si va localhost, BasicAuth, `ConnectPort 443/2713/2777/8443`, ufw qoidasi); natijada `BANK_PROXY_URL` qiymatini chiqaradi.

Boshqa skriptlar:
- `scripts/maintenance/2026-09-28-oplatakv-dub-14.sql` — bir martalik qo'lda SQL: sana ko'chgan 14 ta OplatyKv dublikatidan yetim qatorni o'chirish. Namunali xavfsizlik: hammasi bitta tranzaksiyada, guard xatosida ROLLBACK; vaqtinchalik ob'ektlar `pg_temp` da, zaxira faqat `zaxira` sxemasida (public'da jadval yaratilmaydi — `db push` o'chiradi yoki deploy'ni yiqitadi), zaxira ustunlari enum'dan text'ga uziladi; `oplata_kv_history` ga `deleted` tombstone (`created_at` keyset kursorga mos) COMMIT oldidan yoziladi; 2026-09-24 dagi tarixga yozilmagan 46 o'chirish uchun ham tombstone.
- `scripts/crm-diag.mjs` — CRM API parametrlarini FAQAT O'QIB diagnostika (faol va o'chirilgan shartnoma bilan, faqat HTTP holati va natija sonini chiqaradi). `backend/.env` dan `XONSAROY_*` ni o'qiydi.

### A.13. Bank IP whitelist proksi (forwarder)

Muammo: Kapitalbank va Ipak Yo'li (bank24.uz protokoli) API'si faqat oq ro'yxatdagi IP'larni qabul qiladi. Yechim — bank whitelist qilgan boshqa hostdagi PHP "forwarder" orqali so'rov yuborish.

- Protokol (`wrapped_json`): `POST <forwarder>` + header `X-Proxy-Secret` + JSON `{ url, method, headers, body, timeout }` → forwarder bankka cURL bilan uzatadi va bank javobini aynan qaytaradi (HTTP status bankniki), qo'shimcha `X-Target-Host`, `X-Target-Time` header'lari. Xatolar: 405 method_not_allowed, 403 ip_not_allowed / host_not_allowed, 401 unauthorized, 400 bad_request, 502 curl_error. Timeout max 60 s, `SSL_VERIFYPEER=false` (bank sertifikatlari uchun), redirect'siz.
- Fayllar: `scripts/xt-forwarder.php` (cPanel hosting uchun, secret va IP ro'yxati FAYL ICHIDA qattiq), `scripts/bank-proxy.php` (eski, xuddi shu g'oya), `proxy/xt-forwarder.php` (untracked; secret va ruxsat IP/CIDR ro'yxati env'dan — `XT_FORWARDER_SECRET`, `XT_FORWARDER_ALLOWED_CLIENT_IPS`; nginx + php-fpm, port 8091, `proxy/nginx.conf.example`; `proxy/README.md` buni XonSaroy Laravel ilovasi uchun ham tasvirlaydi). Host oq ro'yxati: Kapitalbank (2 host), Ipak Yo'li, Hayot bank (2 host) — kod ichida.
- Backend tomoni: `integrations/kapitalbank/kapitalbank.client.ts` va `integrations/hamkorbank/hamkorbank.client.ts`. Credential'da `use_proxy = true` bo'lsa va forwarder sozlangan bo'lsa — forwarder orqali; aks holda to'g'ridan-to'g'ri yoki `BANK_PROXY_URL` (Tinyproxy, `HttpsProxyAgent`) orqali. Effektiv sozlama: DB `settings` (`bank.forwarderUrl`, `bank.forwarderSecret`) > env (`BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET`), 30 s kesh (`invalidateForwarderCache`). `getEffectiveForwarder()` → `{ url, secret, source: 'db'|'env'|'none' }`.
- Forwarder ishlamasa: proksi orqali ulangan hisoblar sync bo'lmaydi (`sync_logs` PARTIAL/FAILED), sverka soxta farq ko'rsatadi.

---

### A.14. Telegram backup — `backend/src/backup/`

To'liq loyiha zaxirasi Telegram arxiv kanaliga. UI: `/admin/sync-logs` sahifasidagi yig'ma "Backup" kartasi.

Tarkib (shifrsiz ZIP, foydalanuvchi tanlovi):
1. `db.dump` — `pg_dump -Fc --no-owner --no-privileges` (ulanish `DATABASE_URL` dan parse qilinadi, parol `PGPASSWORD` env orqali; timeout 20 daq; < 100 bayt → xato).
2. `code.zip` — `git archive --format=zip HEAD` (faqat git'dagi fayllar: `.env`, `node_modules`, `dist` avtomat chiqmaydi); xato bo'lsa matnli o'rinbosar.
3. `uploads.zip` — `UPLOADS_DIR` (bo'sh/yo'q bo'lsa qo'shilmaydi).
4. `MANIFEST.txt` (sana, commit, hajmlar, `oplata_kv` va `transactions` qator soni), `RESTORE.txt` (bo'laklarni birlashtirish, `pg_restore`, kod va fayllarni tiklash yo'riqnomasi).
Hammasi `xon-backup-YYYY-MM-DD_HH-MM.zip` (store rejimi) ichida; `BACKUP_MAX_PART_MB` (default 45, min 5) dan katta bo'lsa `.001/.002…` bo'laklarga bo'linadi (Telegram bot limiti 50 MB); har bo'lak `sendDocument` (10 daq timeout), birinchisida caption. Ish papkasi `BACKUP_TMP_DIR` (default OS temp) — tugagach O'CHIRILADI.

Cron: `BackupService.tick` — `@Cron(EVERY_MINUTE)`; `backup.enabled = '1'`, token va chat bor, Toshkent `HH:MM` `backup.times` ro'yxatida bo'lsa (default `21:00`, vergul bilan bir nechta) va `backup.lastRunSlot` (`YYYY-MM-DD_HH:MM`) shu slot bo'lmasa ishga tushadi. Bir vaqtda bitta (`status.running`). Xatoda kanalga "❌ Backup XATO" xabari.

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/backup/config` | `system:deploy` | `{ enabled, times, chatId, tokenSet, tokenHint (oxirgi 4 belgi), status }` — token hech qachon to'liq qaytmaydi |
| POST | `/api/backup/config` | `system:deploy` | `enabled`, `times` (HH:MM tekshiruvi), `botToken` (bo'sh kelsa O'ZGARMAYDI), `chatId` |
| GET | `/api/backup/status` | `system:deploy` | xotiradagi holat: `running`, `phase`, `lastRunAt`, `lastOkAt`, `lastError`, `lastSizeBytes`, `lastParts`, `lastDurationMs`, `lastTrigger` |
| POST | `/api/backup/run` | `system:deploy` | fonda darhol ishga tushiradi |

Setting kalitlari: `backup.enabled`, `backup.times`, `backup.botToken` (OCHIQ matnda saqlanadi), `backup.chatId`, `backup.lastRunSlot`, `backup.lastOkAt`. Env zaxira: `ARCHIVE_BOT_TOKEN`, `ARCHIVE_CHAT_ID`; infra: `BACKUP_PROJECT_DIR`, `UPLOADS_DIR`, `BACKUP_MAX_PART_MB`, `BACKUP_PG_DUMP`, `BACKUP_TMP_DIR`.

Gotchalar: holat xotirada — backend restart (masalan deploy) paytida ishlayotgan backup uziladi va holat yo'qoladi. MANIFEST "sirlar qo'shilmagan" deydi, lekin `db.dump` ichida `settings` (ochiq bot tokenlari, jumladan backup tokenining o'zi), `admin_users.password_hash`, `api_keys.secret_hash`, shifrlangan bank parollari bor — arxiv kanaliga kirish huquqi qattiq cheklanishi shart (`CRED_ENC_KEY` arxivda yo'q, shuning uchun bank parollari ochilmaydi).

---

### A.15. Developer API va Universal API — `backend/src/developer-api/`

Tashqi tizimlar uchun FAQAT O'QISH REST API. To'liq foydalanuvchi yo'riqnomasi: `docs/universal-api.md`; sinov maydoni `frontend/app/[locale]/api/page.tsx` (`/uz/api`, login'siz, kiritilgan kalit bilan).

Kalit formati (`api-key.service.ts`): `keyId = 'xk_live_' + 32 hex` (ochiq, `X-API-Key`), `secret = 'xs_live_' + 48 hex` (`X-API-Secret`, faqat yaratishda BIR MARTA qaytadi), bazada `secret_hash = SHA-256(secret)` va `secret_preview` (oxirgi 4).

Scope'lar (`api-scopes.ts`, yozish scope'i yo'q): `transactions:read`, `oplatakv:read`, `accounts:read`, `counterparties:read`, `universal:read`. `API_SCOPE_CATALOG` — UI uchun nom va izoh.

`ApiKeyAuthGuard`: header'lar → `validateCredentials(keyId, secret, ip)`: bo'sh → 401; prefiks `xk_`/`xs_` emas → 401; topilmadi / `isActive=false` / `expiresAt` o'tgan → 401; hash `timingSafeEqual` bilan; `allowedIps` bo'sh emas va IP ro'yxatda yo'q → 401 "IP ruxsat etilmagan" (IP aniqlanmasa tekshiruv o'tkazib yuboriladi). So'ng `@RequireApiScopes` — kamida bittasi bo'lmasa 403 (matnda kalitdagi scope'lar). `req.apiKey`, `req.apiKeyIp` o'rnatiladi. IP `x-forwarded-for` birinchi elementidan — soxtalashtirish mumkin (secret baribir shart).

`ApiLoggerInterceptor` — har `/api/v1/*` javobini `api_request_logs` ga yozadi (`method`, `path`, `query` — `secret`, `api_secret`, `password` olib tashlanadi, `status_code`, `duration_ms`, `ip`, `user_agent`, `response_size`, `error_message`) va `touchLastUsed` (`last_used_at`, `last_used_ip`, `total_requests++`). Guard interceptordan oldin ishlagani uchun 401/403 log'ga TUSHMAYDI.

Admin endpointlari (`api-key-admin.controller.ts`, JWT):

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/api-keys/scopes` | `api_keys:view` | scope katalogi |
| GET | `/api/api-keys` | `api_keys:view` | ro'yxat (hash'siz) |
| GET | `/api/api-keys/stats?apiKeyId=` | `api_keys:view` | jami, 24 soat, 7 kun, status bo'yicha, top 10 path va IP (butun tarixni o'qiydi) |
| GET | `/api/api-keys/logs?apiKeyId=&statusCode=&method=&page=&perPage=` | `api_keys:view` | log (perPage 10..200) |
| GET | `/api/api-keys/:id` | `api_keys:view` | bitta kalit |
| POST | `/api/api-keys` | `api_keys:manage` | `{ name, description?, scopes, expiresAt?, allowedIps? }` → secret bir marta |
| PATCH | `/api/api-keys/:id` | `api_keys:manage` | nom, izoh, scope, muddat, IP, `isActive` |
| POST | `/api/api-keys/:id/revoke` | `api_keys:manage` | `isActive=false`, `revokedAt`, `revokedReason` |
| DELETE | `/api/api-keys/:id` | `api_keys:manage` | o'chirish; loglar qoladi (`api_key_id` → NULL, `onDelete: SetNull`) |

Public endpointlar (`public-api.controller.ts`, prefiks `/api/v1`):

| Yo'l | Scope | Nima qiladi |
|---|---|---|
| `_whoami` | faol kalit | kalit ma'lumoti, mijoz IP va UA, server vaqti |
| `_debug/crm-raw?contract=` | `oplatakv:read` | DEBUG: CRM xom javobi (shaxsiy maydonlar — pasport, telefon, manzil... — tozalanadi); tashqi so'rov |
| `transactions`, `transactions/:id` | `transactions:read` | tranzaksiyalar ro'yxati/tafsiloti |
| `oplata-kv` | `oplatakv:read` | eski delta: faqat split qatorlar (`payment_category` bor), `updatedSince`, `type`, sana, `q`, OFFSET pagination (perPage ≤ 200) |
| `oplata-kv/deleted` | `oplatakv:read` | `oplata_kv_history.action='deleted'` tombstone'lari, `deletedSince`, `compositeId` |
| `oplata-kv/changes` | `oplatakv:read` | ENG ISHONCHLI yagona feed: upsert + tombstone, keyset `cursor`, `limit` (100, max 500), `days`/`since` faqat cursor'siz; summalar satr (tiyingacha) |
| `oplata-kv/:id` | `oplatakv:read` | bitta qator (statik yo'llar undan OLDIN e'lon qilinishi shart) |
| `accounts`, `accounts/:idOrAccountNo` | `accounts:read` | bank hisoblari (credential'siz) |
| `counterparties`, `counterparties/:innOrId` | `counterparties:read` | kontragentlar |
| `_meta/all`, `_meta/accounts` | `accounts:read` | meta + hisoblar ("FIX (A4)": ilgari scope'siz edi) |
| `_meta/banks`, `_meta/categories`, `_meta/enums` | faol kalit (scope'siz) | ma'lumotnomalar |

Universal API (`universal-api.controller.ts`, prefiks `/api/v1/universal`, hammasi `universal:read`): `objects`, `objects/contracts`, `objects/payments` (1-qoida — obyektlar bo'yicha to'lovlar, manba `OplataKvService.byObject*`, 5000 qator `truncated`), `accounts` (2-qoida — hisoblar va qoldiqlar), `statement`, `statement.xlsx` (3-qoida — vipiska, `StatementService`; xlsx bankdan jonli, panel Vipiska Excel'i bilan bir xil), `filters` (filtr qiymatlari). Sana `YYYY-MM-DD` (aks holda 400), `date` = bitta kun; mantiqiy parametr `1|true|yes`; ro'yxat vergul bilan, bo'sh qiymat `__none__`; `objects*` da `banks=` faqat bank ID, `accounts`/`statement` da kod yoki ID; `statement` da kun chegarasi +05:00. Batafsil: `docs/universal-api.md` va `agents/knowledge/api.md`.

Tarixiy xatolar (kodda/hujjatda): kelajak `updated_at` `updatedSince` kursorini sakratgan (schotchik cron'idagi raw `NOW()`), 3 qatlamli tuzatish (`clampFutureUpdatedAt` va API `clampFuture`); "bo'sh tombstone" filtri import o'chirishlarini yashirgan — tombstone hech qachon filtrlanmaydi.

### A.16. API Explorer — `backend/src/api-explorer/`

Bank API'larining XOM javobini ko'rish uchun admin vositasi (UI `/admin/api-explorer`, tab `api_explorer:view`, backend class-level `credentials:manage`).

| Metod | Yo'l | Nima qiladi |
|---|---|---|
| GET | `/api/api-explorer/forwarder` | effektiv forwarder `{ url, secret, source }` — secret OCHIQ qaytadi |
| PATCH | `/api/api-explorer/forwarder` | `{ url?, secret? }` → `settings.bank.forwarderUrl/forwarderSecret` (bo'sh → NULL, env'ga qaytish), URL `http(s)://` tekshiruvi, kesh tozalanadi |
| POST | `/api/api-explorer/kapitalbank/login` | `APILogin` (`baseUrl`, `login`, `password`, `smsCode?`, `useProxy?`) → sid, mijozlar va hisoblar xulosasi |
| POST | `/api/api-explorer/kapitalbank/transactions` | `GetDoc1C` har kun alohida (sana `dd.MM.yyyy` yoki ISO, max 31 kun, `branch` 5 xonali padStart), kunlik kredit/debet va saldo jamlanmasi |
| POST | `/api/api-explorer/kapitalbank/account` | `GetAcc1C` — hisob saldo va oborot (xom) |

Gotcha: `baseUrl` ixtiyoriy URL qabul qiladi (ruxsatli foydalanuvchi serverdan istalgan manzilga so'rov yubora oladi). Body audit'ga yozilmaydi (bank paroli audit'ga tushmaydi).

### A.17. Bank parolini avtomat topish — `backend/src/bank-pwd/`

Banklar parolni vaqti-vaqti bilan majburan almashtiradi. Har bank uchun oldindan "taxminiy parollar" ro'yxati saqlanadi; ulanish xato bersa ular ketma-ket `KapitalbankClient.apiLogin` bilan sinaladi, ishlagani saqlanadi va Telegram guruhga xabar ketadi.

- Kirish: JWT + `credentials:manage` + body'dagi qattiq kodlangan raqamli kirish kodi (`GATE`, qiymat kodda; xato → 403 "Kod noto'g'ri"). `fix-one` kodsiz.
- Setting kalitlari: `bankpwd.candidates` (`{ bankId: [parollar] }` JSON, `CryptoService` bilan SHIFRLANGAN), `bankpwd.botToken` (shifrlangan), `bankpwd.groupId`.
- `tryOneCredential`: login = `loginPrefix + loginName`; muvaffaqiyat (`sid` yoki `clients` bor) → `password_enc` yangilanadi, `last_error = null`, `last_verified_at`, sid bo'lsa `sid` va `sid_expires_at` (+30 daq); `notify` — "🔐 Bank paroli avtomat yangilandi" (korxona yorlig'i, bank).

| Metod | Yo'l | Nima qiladi |
|---|---|---|
| POST | `/api/bank-pwd/config` | `{ password }` → `apiBaseUrl` bor banklar ro'yxati + har birining taxminiy parollari, `hasToken`, `tokenHint`, `groupId` |
| POST | `/api/bank-pwd/save` | taxminiy parollar (bo'sh/takror tozalanadi), bot token (bo'sh → o'zgarmaydi), guruh |
| POST | `/api/bank-pwd/try` | `credentialId` berilsa shuni, aks holda `last_error` bor BARCHA credential'larni sinaydi → `{ fixed, total, results }` |
| POST | `/api/bank-pwd/fix-one` | bitta credential (Tekshirish xato berganda, kodsiz) |

Cheklov: faqat bank24 protokoli (`apiLogin`) ishlatiladi — Hamkorbank (`HAMKORBANK_V1`) credential'lari uchun mos emas (aniq tekshirilmagan). Taxminiy parollar konfigni ochgan foydalanuvchiga OCHIQ ko'rinadi.

---

### A.18. `mobile/`, `static/`, `README.md`

- `mobile/` (git'da YO'Q): Capacitor 6 qobig'i (`appId uz.xonapps.transactions`, `appName` "Xon Tranzaksiyalar"). `server.url = https://transactions.xonapps.uz` — native ilova jonli saytni WebView'da yuklaydi (alohida server yoki API yo'q; `androidScheme https`, cleartext o'chiq). `www/index.html` — faqat "Yuklanmoqda…" splash. Plaginlar: SplashScreen (1.4 s), StatusBar, App. `android/` Gradle loyihasi; iOS skriptlari bor, `ios/` papka yo'q. Skriptlar: `cap sync`, `cap open android|ios`. Sayt deploy bo'lsa ilova avtomat yangi versiyani ko'radi.
- `static/tg_uploads/` — Python agentlar boti Telegram'dan yuklagan fayllar (`agents/config.py::UPLOADS_DIR`), `agents/contract.py` da himoyalangan yo'l; backend bu papkani ishlatmaydi (backend fayllari `UPLOADS_DIR`, default `/var/www/xon_tranzactions/uploads`).
- `README.md` — eski: stack, lokal ishga tushirish (`.env.example`, `prisma migrate dev`, `npm run seed`), `setup-server.sh`, webhook sozlash, "KapitalBank IP whitelist" eslatmasi. Default admin login ma'lumotlari ham yozilgan (qiymatlar kodda/.env da). Ba'zi ma'lumotlar eskirgan (masalan sync "har 5 daqiqa" — hozir har daqiqa tick, hisob bo'yicha interval; migratsiyalar yo'q — `db push`).
- Root'dagi untracked fayllar (`extract_pdf.mjs`, `oplata-kv-changes-guide.html`, `logo_bank/`) — yordamchi/lokal, tizim ishiga ta'sirsiz.

---

### A.19. `.env` kalit NOMLARI (faqat nomlar)

Backend (`backend/.env`, `ConfigService.get` yoki `process.env`):

| Maqsad | Kalitlar |
|---|---|
| Asosiy | `DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `TRUST_PROXY_HOPS`, `SWAGGER_PATH`, `APP_URL`, `UPLOADS_DIR` |
| Auth va shifrlash | `JWT_SECRET`, `JWT_EXPIRES_IN`, `CRED_ENC_KEY`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` |
| Admin amal kodlari | `ADMIN_ACTION_PASSWORD` (correction, counterparties, sverka-telegram tozalash), `TR_SUPPORT_CODE` (TR Support; bo'sh bo'lsa kod ichidagi default) |
| Bank | `KAPITALBANK_API_URL`, `KAPITALBANK_TIMEOUT_MS`, `HAMKORBANK_TIMEOUT_MS`, `HAMKORBANK_STATEMENT_TIMEOUT_MS`, `BANK_PROXY_URL`, `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET` |
| Sync va cron | `TXN_SYNC_CRON`, `TXN_SYNC_DAYS_BACK`, `SVERKA_NOTIFY_CRON`, `CRM_SVERKA_REFRESH_CRON`, `TAMINOT_MATCH_CRON`, `TAMINOT_MATCH_CRON_ENABLED` |
| CRM (XonSaroy, faqat o'qish) | `XONSAROY_API_URL`, `XONSAROY_CLIENT_BASE`, `XONSAROY_API_KEY`, `XONSAROY_API_SECRET`, `XONSAROY_S3_BASE`, `XONAPP_MYSQL_HOST`, `XONAPP_MYSQL_PORT`, `XONAPP_MYSQL_USER`, `XONAPP_MYSQL_PASSWORD`, `XONAPP_MYSQL_DB` |
| Ta'minot va kontragent | `TAMINOT_DATABASE_URL`, `XONTAMINOT_DATABASE_URL`, `DIDOX_BASE_URL`, `DIDOX_LOGIN_INN`, `DIDOX_LOGIN_PASSWORD`, `DIDOX_PARTNER_AUTH`, `CHAMBER_BASE_URL` |
| Google eksport | `GOOGLE_SA_JSON`, `GOOGLE_SA_KEYFILE`, `EXPORT_ALERT_ENABLED`, `EXPORT_ALERT_BOT_TOKEN`, `EXPORT_ALERT_CHAT_ID` |
| Telegram | `TG_BOT_TOKEN`, `DEPLOY_NOTIFY_CHAT`, `ATTACHMENTS_NOTIFY_CHAT`, `SVERKA_BOT_TOKEN` (boshqa bot tokenlari `settings` jadvalida) |
| Backup | `ARCHIVE_BOT_TOKEN`, `ARCHIVE_CHAT_ID`, `BACKUP_PROJECT_DIR`, `BACKUP_MAX_PART_MB`, `BACKUP_PG_DUMP`, `BACKUP_TMP_DIR` |
| AI (backend modullari) | `ANTHROPIC_API_KEY`; kategoriya agenti: `KATEGORIYA_AI_MODEL`, `KATEGORIYA_AI_LIMIT`, `KATEGORIYA_AI_KUNLIK_CAP`, `KATEGORIYA_AI_PAUZA_MS`, `KATEGORIYA_AI_TIMEOUT_MS`, `KATEGORIYA_BILIM_YOL`; setup token/CLI: `ANTHROPIC_SETUP_TOKEN`, `CLAUDE_CMD`, `ANTHROPIC_BASE_URL` |
| Chek order | `API_PUBLIC_URL`, `APP_PUBLIC_URL` |
| Agentlar ko'prigi va jamoasi | `AGENT_BRIDGE_KEY`, `AGENTS_DIR`, `AGENTS_ENV_FILE`, `AGENTS_UPLOADS_DIR`, `LEADER_TG_ID`, `AGENTS_USE_CLI`, `AGENTS_MODEL_STRONG`, `AGENTS_MODEL_FAST`, `AGENT_DAILY_CAP`, `AGENT_TIMEOUT_S`, `AGENT_OS_USER` |
| v1 leader (backend ichida) | `LEADER_ENABLED` (`'0'` → o'chiq), `LEADER_BOT_TOKEN`, `LEADER_OWNER_TG_IDS`, `LEADER_MODEL`, `LEADER_MODEL_STRONG`, `LEADER_DAILY_TOKENS`, `LEADER_ALERTS`, `LEADER_TEACHER`, `LEADER_REPO_DIR`, `LEADER_AGENTS_DIR`, `LEADER_SECRET_LITERALS` |
| Deploy (`DeployService` + `deploy.sh`) | `GH_DEPLOY_SECRET`, `DEPLOY_REPO_DIR`, `DEPLOY_BRANCH`, `DEPLOY_BACKEND_SERVICE`, `DEPLOY_FRONTEND_SERVICE`, `DEPLOY_LOG`, `DEPLOY_LOCK`, `DEPLOY_SERVICES`, `DEPLOY_FILES`, `DEPLOY_COMMIT`, `DEPLOY_PUSHER`, `DEPLOY_PUSHED_BRANCH`, `DEPLOY_FROM_WEBHOOK`, `NODE_OPTIONS`, `NEXT_TELEMETRY_DISABLED` |

Frontend: `NEXT_PUBLIC_API_URL` (`frontend/.env.local`, compile-time — o'zgarsa qayta build), `NEXT_DIST_DIR` (faqat deploy build'i). Forwarder (`proxy/`): `XT_FORWARDER_SECRET`, `XT_FORWARDER_ALLOWED_CLIENT_IPS`. Setup skriptlari: `REPO_URL`, `REPO_DIR`, `BRANCH`, `DB_USER`, `DB_PASS`, `DB_NAME`, `DOMAIN`, `ADMIN_EMAIL`, `PROXY_PORT`, `ALLOWED_IP`, `PROXY_USER`, `PROXY_PASS`. Python agentlar env'i — agentlar bo'limida. `backend/.env.example` faqat eski kichik to'plamni sanaydi (to'liq ro'yxat emas).

### A.20. Platforma `settings` kalitlari

| Kalit | Kim | Izoh |
|---|---|---|
| `bank.forwarderUrl`, `bank.forwarderSecret` | api-explorer (yozadi), kapitalbank/hamkorbank client (o'qiydi) | forwarder sozlamasi, env'dan ustun; secret ochiq matn |
| `backup.enabled`, `backup.times`, `backup.botToken`, `backup.chatId`, `backup.lastRunSlot`, `backup.lastOkAt` | backup | token ochiq matn |
| `bankpwd.candidates`, `bankpwd.botToken`, `bankpwd.groupId` | bank-pwd | birinchi ikkitasi shifrlangan |
| `sync.minDate`, `oplatykv.*`, `bulkSync.*`, `schotchik.*` | `SettingsService` (sync/oplata-kv) | boshqa bo'limlarda batafsil |

`settings` jadvalini to'liq SELECT qilma: tokenlar (ba'zisi ochiq) shu yerda.

---

### A.21. Prisma sxemasi — `backend/prisma/schema.prisma` (46 model, 14 enum)

Umumiy qoidalar: yagona baza, `public` sxema; model/maydon camelCase, SQL `@@map`/`@map` snake_case; PK asosan cuid; FK kam (ko'p bog'lanish matn tengligi). Migratsiya fayllari YO'Q: har backend deploy `prisma db push --accept-data-loss` — `public` dagi shu faylda yo'q jadval/ustun ogohlantirishsiz o'chadi. Fayl boshidagi ogohlantirish: qo'lda yaratilgan zaxira/yordamchi jadvallar `public` ga emas, alohida sxemaga (`zaxira`, agentlar — `agents`); boshqa rolga tegishli begona jadval deploy'ni yiqitadi (2026-09-24: `oplata_kv_dub_zaxira` → "permission denied", backend ishga tushmay qoldi). `prisma/sql/chek_dog.sql` — `chek_dog` uchun qo'lda SQL (db push tavsiya etiladi).

| Domen | Model → jadval | Vazifasi |
|---|---|---|
| Platforma | `Role` → `roles` | RBAC rol: `name` (unique), `label`, `permissions TEXT[]`, `is_system` |
| | `AdminUser` → `admin_users` | panel foydalanuvchisi: `email` unique, `password_hash`, `full_name`, legacy `role` (`AdminRole`), `role_id` → roles, `is_active`, `last_login_at` |
| | `AuditLog` → `audit_logs` | global audit (modul, amal, method, path, ip, status, davomiylik, meta) |
| | `Setting` → `settings` | key (`VarChar(64)` PK) / value TEXT / `updated_by` |
| | `ApiKey` → `api_keys` | Developer API kaliti: `key_id`, `secret_hash`, `secret_preview`, `scopes[]`, `expires_at`, `allowed_ips[]`, foydalanish statistikasi, revoke |
| | `ApiRequestLog` → `api_request_logs` | har `/api/v1` so'rovi (FK `api_key_id`, SetNull) |
| Bank va sync | `Bank` → `banks` | bank manbasi: `code`, `api_kind` (`BankApiKind`), `api_base_url`, `sync_interval_minutes` |
| | `BankCredential` → `bank_credentials` | bankka ulanish: login, shifrlangan parol, `auth_mode` (`BankAuthMode`), `use_proxy`, sid, `last_error` |
| | `BankAccount` → `bank_accounts` | kompaniya hisob raqami (credential'ga bog'liq), qoldiq, `sync_enabled` |
| | `SyncLog` → `sync_logs` | bank sync tarixi (`SyncStatus`) |
| | `SyncExclusionRange` → `sync_exclusion_ranges` | Hamkor: qo'lda import qilingan, qayta sync qilinmaydigan sana oralig'i |
| | `TransactionChangeLog` → `transaction_change_logs` | bank tomonida o'chirilgan/o'zgargan/ko'chgan tranzaksiyalar (`TxChangeType`) |
| | `ImportBatch` → `import_batches` | har Excel import sessiyasi |
| Tranzaksiyalar | `Transaction` → `transactions` | asosiy to'lov yozuvi (`TxnType`, `TxnStatus`, `TxnDirection`, `TxnSource`, `MatchStatus`) |
| | `TransactionAttachment` → `transaction_attachments` | tranzaksiyaga biriktirilgan ariza/hujjat/rasm |
| | `Category` → `categories` | 2 darajali kategoriya daraxti (seed) |
| | `TransactionCategoryHistory` → `transaction_category_history` | kategoriya o'zgarishi audit logi |
| | `Counterparty` → `counterparties` | kontragentlar registri (INN unique, DIDOX'dan boyitiladi) |
| | `CounterpartyHistory` → `counterparty_history` | kontragent o'zgarishlari tarixi |
| XATO va tuzatish | `XatoCorrectionRequest` → `xato_correction_requests` | XATO to'lovni tuzatish arizasi (pending → approved, AI agent holati) |
| | `TrSupportEdit` → `tr_support_edits` | TR Support boti orqali egasi tasdig'i bilan qilingan tahrirlar: `batch_id`, `before`/`after` JSON, `changed[]`, `status` (applied, failed, rolled_back), ortga qaytarish maydonlari |
| | `AgentChatMessage` → `agent_chat_messages` | XATO AI agentining admin bilan chat tarixi |
| CRM va XonPay | `CrmContract` → `crm_contracts` | XonSaroy CRM shartnoma keshi (PK `contract_number`) |
| | `XonpayTransaction` → `xonpay_transactions` | CRM'dan XonPay to'lovlari va bank bilan moslash (PK `external_id`) |
| | `XonpaySyncLog` → `xonpay_sync_logs` | XonPay sync tarixi |
| | `ContractSchedule` → `contract_schedules` | CRM to'lov grafigi (initial/monthly); "Plan bo'yicha to'lov" olib tashlangan — jadval dormant |
| OplatyKv | `OplataKv` → `oplata_kv` | kvartira to'lovlari (`payment_category`: `OplataKvCategory`) — eng muhim jadval |
| | `OplataKvHistory` → `oplata_kv_history` | qator tarixi (created, edited, deleted...) va API tombstone manbasi |
| | `PerereboskaGroup` → `perereboska_group` | har perebroska (pul o'tkazma) uchun audit yozuvi (active/cancelled) |
| | `VznosContract` → `vznos_contract` | "Взнос от имени клиента": o'z shartnomalarimiz reestri |
| | `OplataKvObjectMapping` → `oplata_kv_object_mappings` | CRM obyekt nomi → OplatyKv obyekt nomi |
| Chek | `ChekOrder` → `chek_order` | memorial order tekshiruvi (order № = `transactions.doc_number`) |
| | `ChekTicket` → `chek_ticket` | chek order murojaati: `ticket_no` autoincrement, AI xulosa, transcript, status (new, in_progress, resolved, rejected), mas'ul |
| | `ChekDog` → `chek_dog` | `/chek` sahifasi shartnoma nazorati jurnali |
| Eksport | `ShmitdLog` → `shmitd_logs` | SHMITD hisobotini Telegram'ga yuborish tarixi |
| | `ExportCronLog` → `export_cron_logs` | Google Sheets eksport ishga tushishlari (cron/manual) |
| Eski billing (deyarli ishlatilmaydi) | `Customer` → `customers`, `Contract` → `contracts` (`ContractStatus`), `ContractStage` → `contract_stages` (`StageStatus`), `Payment` → `payments` (`PaymentSource`) | mijoz–shartnoma–bosqich–tranzaksiya taqsimoti |
| Agentlar (backend) | `LeaderMessage` → `leader_messages`, `LeaderMemory` → `leader_memories`, `LeaderRun` → `leader_runs`, `LeaderAlert` → `leader_alerts` | v1 leader agentlari: suhbat, xotira, run statistikasi (token, tool call), health alertlari; biznes jadvallarga yozmaydi |
| | `KategoriyaAgentRun` → `kategoriya_agent_runs` | kategoriya agenti ishga tushishi: status, trigger (manual/cron), `dry_run`, bosqich, `stages` JSON, AI so'rov/qo'yilgan/chaqiriq soni (kunlik cap shu bo'yicha) |
| | `KategoriyaAgentQaror` → `kategoriya_agent_qarorlar` | har AI/qoida qarori: bosqich (qoidalar, schotchik, minfin, taminot, ai), summa, kontragent, kategoriya, modda, obyekt, shartnoma, `ishonch` 0..100, `qoyildi`, sabab (run o'chsa Cascade) |

Python agentlar boti jadvallari Prisma'da emas — alohida `agents` sxemasida (`agents/db_migrations.py`).

Enumlar (qiymatlar katta harf):

| Enum | Qiymatlar | Qayerda |
|---|---|---|
| `AdminRole` | SUPERADMIN, ADMIN, VIEWER | `admin_users.role` (legacy, default ADMIN) |
| `TxnType` | TRANSFER, PAYMENT, SALARY, TAX, FEE, REFUND, OTHER | `transactions.type` |
| `TxnStatus` | PENDING, COMPLETED, FAILED, CANCELLED, REVERSED | `transactions.status` |
| `TxnDirection` | IN, OUT | `transactions.direction`, `transaction_change_logs.direction` |
| `TxnSource` | SYNC, IMPORT, MANUAL, ALOQA_BANK, HAMKOR_IMPORT | `transactions.source` |
| `MatchStatus` | UNMATCHED, AUTO, MANUAL, PARTIAL, IGNORED | `transactions.match_status` (billing) |
| `BankApiKind` | KAPITALBANK_V3, IPAK_YOLI_V1, HAMKORBANK_V1, GENERIC | `banks.api_kind` (Ipak amalda KAPITALBANK_V3) |
| `BankAuthMode` | IP_WHITELIST, SMS_SID | `bank_credentials.auth_mode` |
| `SyncStatus` | RUNNING, SUCCESS, FAILED, PARTIAL | `sync_logs.status` |
| `TxChangeType` | DELETED, EDITED, MOVED | `transaction_change_logs.change_type` |
| `ContractStatus` | DRAFT, ACTIVE, COMPLETED, CANCELLED, SUSPENDED | `contracts.status` |
| `StageStatus` | PENDING, PARTIAL, PAID, OVERDUE | `contract_stages.status` |
| `PaymentSource` | AUTO, MANUAL | `payments.source` |
| `OplataKvCategory` | MONTHLY, FIRST, GENERAL | `oplata_kv.payment_category` |

`agents/knowledge/db_schema.md` da hali yo'q jadvallar: `tr_support_edits`, `kategoriya_agent_runs`, `kategoriya_agent_qarorlar` (yuqorida qo'shildi).

---

### A.22. Xavfli joylar, tuzoqlar, kuzatilgan muammolar

- Sirlar git'da: `scripts/deploy.sh` (Telegram token zaxirasi, chat ID'lar, forwarder URL va secret), `scripts/xt-forwarder.php`, `scripts/bank-proxy.php`, setup skriptlaridagi IP'lar va default parollar. Qiymatlarni hech qayerga ko'chirmang; tuzatish (env'ga o'tkazish, rotatsiya) faqat egasi qarori bilan.
- `prisma db push --accept-data-loss`: `public` da Prisma'da yo'q jadval yoki ustun ogohlantirishsiz o'chadi; begona egalikdagi jadval deploy'ni yiqitadi.
- Webhook branch'ni tekshirmaydi; `status`/`health`/`hamkor-diag` ochiq; lock 60 s olinmasa deploy jim tashlanadi; "Deploy OK" backend restartidan oldin yuboriladi.
- `ensure_env_var` har deployda 8 ta `.env` kalitini qayta yozadi — `.env` dagi qo'lda o'zgarish qaytadi.
- JWT global emas: yangi controller'ga guard qo'yish unutilsa endpoint ochiq qoladi. 28 ruxsat faqat UI'da, backend tekshirmaydi.
- `RolesGuard` legacy enum'ga qaraydi — `cleanup-by-account` va `count-by-account` faqat enum'i qo'lda SUPERADMIN qilingan foydalanuvchiga ishlaydi.
- IP manbai: audit, API kalit IP ro'yxati va PHP forwarder `X-Forwarded-For` birinchi elementiga ishonadi (soxtalashtirish mumkin; Throttler esa `req.ip` dan to'g'ri). API kalit uchun secret baribir shart.
- Throttler 300/daq IP bo'yicha: bitta ofis NAT orqasidagi barcha xodimlar bitta kvotani bo'lishadi; har ochiq panel tabi `/_deploy/status` ni 3 s da (20/daq) so'raydi — ko'p tab bilan 429 ehtimoli.
- Backup: shifrsiz ZIP, ichida settings tokenlari va hash'lar; holat xotirada, restartda uziladi.
- `api-explorer` istalgan `baseUrl` ga so'rov yubora oladi va forwarder secret'ini ochiq qaytaradi; `bank-pwd` taxminiy parollarni ochiq ko'rsatadi.
- `CRED_ENC_KEY` o'zgarsa yoki yo'qolsa barcha shifrlangan bank parollari va `bankpwd.*` ochilmaydi (backend kalitsiz umuman ishga tushmaydi).
- Swagger prod'da o'chiq; nginx `/docs/` proksisi prod'da 404 beradi.
- Refresh/logout yo'q: parol o'zgargach eski token muddati tugaguncha ishlaydi (faqat `isActive=false` darhol yopadi).
- systemd unit'larda `TZ` yo'q; kun hisobida doim `tashkentKun()` / +5 ishlatiladi.

### A.23. Bog'liqliklar — "X o'zgarsa, Y ta'sirlanadi"

| O'zgarish | Ta'sir |
|---|---|
| `auth/permissions.ts::PERMISSIONS` | `frontend/lib/permissions.ts`, `prisma/seed.ts::ALL_PERMS`, `PERMISSION_TREE` (Rollar UI), `route-guard.tsx`, `sidebar.tsx`, `admin/layout.tsx::TABS` |
| `audit.routes.ts::MODULE_MAP`/`KNOWN` | `audit_logs.module`/`action` qiymatlari, profil tarixi, agentlar Facts `panel_activity` |
| `DeployService::servicesToRestart` | qaysi push qaysi servisni quradi; `deploy.sh` `DEPLOY_SERVICES` ga tayanadi |
| `deploy.sh` log formati (`DEPLOY START`, `DEPLOY OK`, `✗ FAIL:`, `[deploy] →/✓`) | `DeployService.status()` regex'lari, topbar deploy belgisi, agentlar Facts |
| `main.ts` prefiks `api` | nginx `/api/` → 3001, frontend `NEXT_PUBLIC_API_URL` |
| `schema.prisma` | keyingi backend deploy bazani darhol o'zgartiradi (ma'lumot yo'qolishi mumkin) |
| `developer-api` endpoint/parametr | `docs/universal-api.md`, `frontend/app/[locale]/api/page.tsx`, tashqi iste'molchilar |
| forwarder URL/secret (settings yoki env) | Kapital/Ipak/Hamkor sync, bank-pwd, api-explorer, sverka |
| `CRED_ENC_KEY` | bank-credentials, bank-pwd, shifrlangan settings |
| `JWT_SECRET` | barcha panel tokenlari va Telegram mehmon tokenlari bekor bo'ladi |

## B. Banklar, sync va tranzaksiyalar

Bu bo'lim bank ulanishidan boshlab tranzaksiya kategoriyasigacha bo'lgan butun "pul kirish yo'li"ni yoritadi: bank, ulanish va hisob sozlamasi, bank API klientlari, sync (har daqiqalik cron, backfill, o'zgarishlarni aniqlash), `transactions` jadvali ustidagi ro'yxat/statistika/eksport, bank sverka, importlar, kategoriyalash qoidalari, CRM shartnoma keshi, kategoriya agenti, kontragentlar, ta'minot ERP moslash va eski billing.

Barcha HTTP yo'llar global `/api` prefiksi bilan (`main.ts::setGlobalPrefix('api')`). Ruxsat tekshiruvi `PermissionsGuard` — `@RequirePermissions(A, B)` **YOKI** mantiqida (`required.some(...)`): ikkitadan biri yetarli.

### B.0 Umumiy oqim (pipeline)

```
Bank API (Kapital v3 / Ipak / Hamkor REST)
   │  SyncService.tick (har daqiqa, bank intervaliga qarab)
   ▼
syncAccount → fetchDoc1C (kunma-kun, oxirgi TXN_SYNC_DAYS_BACK kun)
   │   ├─ upsertOne  → transactions (yangi qator yoki date-shift update)
   │   │      ├─ payments.autoMatch (eski billing, faqat IN + INN)
   │   │      └─ categorization.categorizeOne (fire-and-forget) → runRules
   │   ├─ detectChanges → EDITED / MOVED / DELETED (+ OplataKv kaskad)
   │   └─ qoldiq (saldo_out yoki GetAcc1C) → bank_accounts.balance
   ▼
transactions ──(CLIENT + contractNumber)──► OplataKvService.syncFromTransactions → oplata_kv
   │
   ├─ reconcile (bank sverka) → fix-missing / fix-date / fix-amount (+ relinkOplataKv)
   ├─ taminot.matchTransactions → erp_* ustunlar (faqat o'qish ERP'dan)
   └─ kategoriya-agent (qoidalar → schotchik → minfin → ta'minot → AI)
Import (Excel / Aloqa Bank / Hamkor vipiska) → transactions (source != SYNC)
```

Asosiy invariantlar:
- `transactions.amount` — so'm, `Decimal(18,2)`, **ishorasiz**; yo'nalish `direction` (`IN`/`OUT`). Bank API summani **tiyinda** beradi, sync 100 ga bo'ladi.
- `transactions.txn_date` — UTC lahza sifatida saqlanadi, lekin bank sanasi+vaqti `+05:00` (Toshkent) bilan quriladi. Kunni olishda doim `common/tashkent.ts::tashkentKun()` yoki `+5 soat` qo'shib `toISOString().slice(0,10)`; filtrlar `YYYY-MM-DDT00:00:00+05:00` … `T23:59:59.999+05:00`. Oddiy `toISOString().slice(0,10)` Toshkent 00:00–05:00 oralig'idagi to'lovlarni bir kun oldin ko'rsatadi (memory: "Toshkent kun gotcha").
- `transactions.external_id` (`@unique`) — bank kompozit ID; `oplata_kv.source_tx_id` va sync yaratgan `oplata_kv.id` aynan shu qiymat. Formati o'zgarsa yoki sana segmenti almashsa OplataKv bog'lanishi uziladi (dublikat xavfi).

---

### B.1 Banklar — `backend/src/banks`

**Vazifa:** bank ma'lumotnomasi (`banks` jadvali): kod, nom, API bazaviy URL, `apiKind`, faollik, sync intervali.

**Fayllar:** `banks.controller.ts`, `banks.service.ts`, `dto/bank.dto.ts`.

**Boot seed (`BanksService.onModuleInit`):** `DEFAULT_BANKS` ro'yxati (~30 ta O'zbekiston banki) har startda tekshiriladi:
- yo'q bo'lsa yaratiladi;
- bor bo'lsa va `isActive`/`apiKind`/`apiBaseUrl` seed'dan farq qilsa — **faqat shu bankka credential yo'q bo'lsa** yangilanadi (foydalanuvchi ulagan bankni buzmaslik uchun; Hamkorbankni eski `KAPITALBANK_V3` dan `HAMKORBANK_V1` ga o'tkazish uchun kerak bo'lgan).
- Faol: `KAPITALBANK` (`KAPITALBANK_V3`, URL `KAPITALBANK_API_URL` env yoki `https://m.bank24.uz:2713/Mobile.svc`), `IPAK_YULI` (`IPAK_YOLI_V1`, `https://mb.ipakyulibank.uz:2713/Mobile.svc`), `HAMKORBANK` (`HAMKORBANK_V1`, `https://capi.hamkorbank.uz`). Qolganlari `isActive=false`, `apiKind=KAPITALBANK_V3` placeholder.

**Endpointlar:**

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/banks` | `banks:view` | ro'yxat + `_count` (credentials, accounts, transactions) |
| GET | `/api/banks/:id` | `banks:view` | bitta bank + credential qisqacha |
| POST | `/api/banks` | `banks:manage` | yangi bank (kod unikal) |
| PATCH | `/api/banks/:id` | `banks:manage` | nom, URL, apiKind, isActive, `syncIntervalMinutes` (0–1440, 0 = avto-sync o'chiq) |
| DELETE | `/api/banks/:id` | `banks:manage` | o'chirish (credential va hisoblar `onDelete: Cascade`) |

**DB:** `banks` (`code` unique, `api_kind` enum `BankApiKind` = `KAPITALBANK_V3 | IPAK_YOLI_V1 | HAMKORBANK_V1 | GENERIC`, `sync_interval_minutes` default 5).

**Tuzoq:** `dto/bank.dto.ts::BankApiKindEnum` faqat `KAPITALBANK_V3` va `GENERIC` ni biladi — API orqali `IPAK_YOLI_V1`/`HAMKORBANK_V1` qo'yib bo'lmaydi (validation rad etadi). Bu turlar faqat seed orqali keladi.

### B.2 Bank ulanishlari — `backend/src/bank-credentials`

**Vazifa:** bank login/parol (shifrlangan), proxy rejimi, ulanish testi, auth muammolari ro'yxati.

**Model `bank_credentials`:** `label`, `login_prefix` (masalan Kapital uchun prefiks yoki bo'sh), `login_name`, `password_enc` (AES-256-GCM, kalit env `CRED_ENC_KEY`, `common/crypto/crypto.service.ts`), `client_id_ext`, `branch` (MFO), `auth_mode` (`IP_WHITELIST` | `SMS_SID`), `is_active`, `use_proxy`, `sid`, `sid_expires_at`, `last_verified_at`, `last_error`. `@@unique([bankId, loginName])`. To'liq login = `loginPrefix + loginName`.

**Service metodlari:**
- `list/get` — `passwordEnc` olib tashlanadi (`mask`).
- `create/update` — parol `crypto.encrypt` bilan; `authMode` default `IP_WHITELIST`.
- `testConnection(id)`:
  - `HAMKORBANK_V1` → `HamkorbankClient.getAccountList` (lab bazasida `get-bank-day` `-899` beradi, shuning uchun hisob ro'yxati bilan tekshiriladi); `lastVerifiedAt`, `lastError` yangilanadi; hisoblar avtomat qo'shilmaydi.
  - `KAPITALBANK_V3` → `apiLogin`; `sid` saqlanadi (`sidExpiresAt = +30 daqiqa`), birinchi client `id` → `clientIdExt`, `branch` bo'sh bo'lsa to'ldiriladi; javobda client va hisoblar ro'yxati.
  - **`IPAK_YOLI_V1` qo'llab-quvvatlanmaydi** (BadRequest) — Ipak ulanishini bu tugma bilan tekshirib bo'lmaydi.
- `listAuthIssues()` — har `sync_enabled` hisobning **oxirgi** `sync_logs` qatori (`DISTINCT ON`) `FAILED` bo'lsa va `error_message` keng regex'ga (EN/UZ/RU: "login fail", "401/403", "пароль истёк", "noto'g'ri parol"…) mos kelsa — credential bo'yicha guruhlab qaytaradi.
- `loadDecrypted(id)` — ichki foydalanish (parol ochiq).
- `revealPassword(id)` — ochiq parol, logga warn yoziladi.

**Endpointlar:**

| Metod | Yo'l | Ruxsat | Izoh |
|---|---|---|---|
| GET | `/api/bank-credentials?bankId=` | `credentials:view` | ro'yxat |
| GET | `/api/bank-credentials/auth-issues` | `credentials:view` | login/parol muammolari |
| GET | `/api/bank-credentials/:id` | `credentials:view` | bitta + hisoblari |
| POST/PATCH/DELETE | `/api/bank-credentials[/:id]` | `credentials:manage` | CRUD |
| POST | `/api/bank-credentials/:id/test` | `credentials:test` | tashqi bankka so'rov |
| GET | `/api/bank-credentials/:id/reveal-password` | `credentials:reveal` (default faqat SUPERADMIN) | parolni ochiq qaytaradi |

**Tuzoq:** sync'da kunlik `getDoc1C` xatosi (login xatosi ham) kun ichida ushlanadi → log `PARTIAL`, `error_message` bo'sh. `FAILED` faqat tsikl tashqarisidagi exception'da. Shuning uchun `auth-issues` login xatosini ko'pincha **ko'rmaydi** (u faqat `FAILED` + matnni qidiradi). Parol avtomat tiklash — alohida `bank-pwd` moduli (`/api/bank-pwd/*`, `credentials:manage`), bu bo'limdan tashqarida.

### B.3 Bank hisoblari — `backend/src/bank-accounts`

**Model `bank_accounts`:** `bank_id`, `credential_id` (`onDelete: Cascade`), `branch` (MFO), `account_no`, `previous_account_no`/`previous_branch` (bank rekviziti o'zgarganda eskisi; Kapitalbank MFO o'zgarishi 2026-10-05 holati), `owner_name`, `currency` (UZS), `balance` (Decimal, sync yozadi), `sync_enabled`, `last_synced_at`. `@@unique([branch, accountNo])`.

**Endpointlar:**

| Metod | Yo'l | Ruxsat | Izoh |
|---|---|---|---|
| GET | `/api/bank-accounts?credentialId=` | `accounts:view` | ro'yxat + tx soni |
| GET | `/api/bank-accounts/export` | `accounts:view` | Excel (hisob, bank, MFO, nom, sync holati) |
| GET | `/api/bank-accounts/:id` | `accounts:view` | bitta |
| POST | `/api/bank-accounts` | `accounts:manage` | yangi hisob (`branch+accountNo` dublikat → 409) |
| PATCH | `/api/bank-accounts/:id` | `accounts:manage` | faqat `ownerName`, `currency`, `syncEnabled` |
| DELETE | `/api/bank-accounts/:id` | `accounts:manage` | o'chirish (tranzaksiyalar `account_id = NULL` — "yetim") |
| POST | `/api/bank-accounts/bulk` | `accounts:manage` | ko'p hisob: raqam faqat raqamlar, **20 belgi** shart, MFO 5 belgiga `padStart('0')`, mavjudi skip |

Hisob o'chirilib qayta qo'shilsa — `syncAccount` boshida yetim tranzaksiyalar `bankId + from/to_account` bo'yicha qayta bog'lanadi (B.5).

### B.4 Bank integratsiyalari — `backend/src/integrations`

#### B.4.1 KapitalbankClient (`kapitalbank/kapitalbank.client.ts`, `types.ts`)
Kapitalbank OpenAPI v3 (Mobile.svc, JSON POST) va **Ipak Yo'li** uchun umumiy (Ipak — xuddi shu framework, `IPAK_YOLI_V1`).

- **Auth:** IP whitelist rejimida har so'rovda `Authorization: Basic base64(login:password)`. `apiLogin` (`POST {base}/APILogin`, body `{}`) — SMS rejimida `login:password:smsCode`; javob `{ login, sid, clients[] }`. Sync `sid` ishlatmaydi (har so'rovda Basic) — `#60101 Session expired` xatosining oldini olish uchun.
- **Javob konverti:** `{ error: {code, message} | null, id, result }`; `ensureNoError` `error.code !== 0` bo'lsa `"<Bank> #code: message"` exception.
- **Metodlar:**
  - `getDoc1C({branch, account, date})` — `POST /GetDoc1C`, `date` **faqat `dd.MM.yyyy`**. Natija `KbDoc1CResult { content[], total_debit, total_credit, saldo_in, saldo_out, oper_day }`, barcha summalar **tiyin**.
  - `getAcc1C({branch, account})` — `POST /GetAcc1C`, hisob qoldig'i (`s_out`, tiyin).
  - `getDocuments({client_id, date})` — `POST /GetDocuments`, tashkilotning hamma hisoblari (chaqiruvchi `acc_dt/acc_ct` bo'yicha filtrlaydi); sverka diagnostikasida fallback.
  - `getDocDetails` — `GET {base without /Mobile.svc}/is_paynet/api/getDocDetails?sid&branch&account&bank_day&doc_id&doc_type` (0 kelgan, 1 yuborilgan, 2 ichki). Inspector'da hozir o'chirilgan (`docDetails = null`).
- **`KbDoc1CItem` maydonlari:** `general_id`, `b2_id`, `num`, `ddate` (dd.MM.yyyy), `vdate`, `time`/`stime`/`input_date`/`input_time`, `acc_dt/acc_ct`, `mfo_*`, `name_*`, `inn_*`, `purpose`, `purp_code`, `amount` (tiyin), `dtype`, `state` (1 kiritilgan, 2 tasdiqlangan, 3 provodka, 6 o'chirilgan, 16 kechiktirilgan), `dir` (1 chiqim, 2 kirim), `err`, `err_msg`, `anor`, `uniq`, `client_id`, `branch`; Hamkor uchun qo'shimcha `txnDate1C`, `_raw`.
- **Timeout:** `KAPITALBANK_TIMEOUT_MS` (default 15000).
- **Forwarder / proxy (IP whitelist'ni chetlab o'tish):** `useProxy=true` bo'lsa:
  1. Forwarder sozlangan bo'lsa (Setting `bank.forwarderUrl` + `bank.forwarderSecret`, bo'lmasa env `BANK_FORWARDER_URL`/`BANK_FORWARDER_SECRET`; DB qiymati ustun, 30 s kesh) — so'rov PHP forwarder'ga `POST {url, method, headers, body, timeout}` va header `X-Proxy-Secret` bilan ketadi; forwarder bank javobini o'zgarishsiz qaytaradi.
  2. Aks holda `BANK_PROXY_URL` (HTTPS proxy agent) orqali.
  - `getEffectiveForwarder()` manbani (`db`/`env`/`none`) qaytaradi; sozlash `PATCH /api/api-explorer/forwarder` (`credentials:manage`). Bank whitelist har login uchun alohida IP bo'lishi mumkin.
- `bankNameFromUrl` — xabarlarda "KapitalBank"/"Ipak Yo'li" nomini URL'dan aniqlaydi.

#### B.4.2 HamkorbankClient (`hamkorbank/hamkorbank.client.ts`)
Hamkorbank PaySystems REST — Kapital SOAP'dan **butunlay boshqa** API; javobi `KbDoc1CItem` shakliga normallashtiriladi, shunda sync/inspector o'zgarishsiz ishlaydi.

- **URL:** `{base}/api/v1/ps/<path>`; prod `capi.hamkorbank.uz` (lab `capi-lab…` bo'sh dev baza — prod'da qolmasin).
- **Auth:** `Basic base64(login:password)` + har so'rovda header `requestId` (uuid) va `lang: RU`. Forwarder/proxy Kapital bilan bir xil kalitlar.
- **Konvert:** `{ code, msg, responseBody[] }`; `code=0` ok; **`-5` = "данные не найдены" = operatsiyasiz kun, xato emas** (bo'sh massiv); boshqa kod → `Hamkorbank #code`. Har so'rov `[HB-DIAG]` log yozadi (vaqtinchalik diagnostika).
- **Metodlar:** `getBankDay` (`get-bank-day`), `getAccountList` (`get-account-list?param=` → `{account, balance}`), `getStatementDay({account, date})` — `get-doc-details-byacc?bankDay&docType=0&acc&pageNumber&pageSize=20`, sahifalab (`MAX_PAGES=200`; **`pageSize > 20` → `-802`**), so'ng `get-account-list` dan saldo (`saldo_out`, best-effort).
- **Timeout:** `HAMKORBANK_TIMEOUT_MS` (default 120 s — prod'da bir kun ~41 s olgan), statement uchun `HAMKORBANK_STATEMENT_TIMEOUT_MS` (default 25 daqiqa — bank arxiv so'rovi ~20 daqiqagacha).
- **`normalizeItem`:** `id → general_id` va `b2_id` (alohida b2 yo'q), `docNum → num`, `docDate → ddate` (**vaqt bilan**: `dd.mm.yyyy HH:mm:ss`, qisqartirilmaydi — externalId shunga bog'liq), `vDate`, `accountCr/Dt`, `mfoCr/Dt`, `nameCr/Dt`, `innCr/Dt`, `nazpla → purpose`, `summa → amount` (tiyin), `state = 3` (hardcode; haqiqiy status mapping TODO), `dir` (`accountCr === bizning hisob` → 2 kirim, aks holda 1). `dtype` **qo'yilmaydi** (Hamkor `docType` yo'nalish kodi, Kapital doc-type emas). `time` — `docDate` ichidan yoki qiymat shakli bo'yicha (`HH:mm[:ss]`) qidiriladi, `00:00` qabul qilinmaydi. `txnDate1C` — purpose ichidagi `Время транзакции dd.mm.yyyy HH:mm:ss` (karta to'lovi haqiqiy vaqti). `_raw` — xom javob.

#### B.4.3 Kompozit ID va dedup kalitlari
- **`SyncService.makeCompositeId(item, ourAccount, bankCode)`:**
  `[prefix]{general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount_tiyin}_{sign}`
  - prefix: `IPAK_YULI` → `IP_`, `HAMKORBANK` → `HB_`, Kapital → prefikssiz.
  - `sign` = `+` agar `acc_dt === bizning hisob` (chiqim), aks holda `-`.
  - Bo'sh qismlar: `no_general_id`, `no_num`, `no_date`, `no_acc_ct`, `no_acc_dt`, `no_amount`.
  - Misol (Kapital): `123456789_15_10.10.2026_20208000XXXXXXXXXXXX_20210000XXXXXXXXXXXX_150000000_-`.
  - Hamkor'da `ddate` vaqt bilan: `HB_{id}_{docNum}_10.10.2026 09:00:05_..._..._{tiyin}_{sign}` (ID ichida bo'shliq va `:` bor).
- **Hamkor dedup (`hamkor-dedup.util.ts`):** `hbDedupKey`:
  - izohda `xonpay:<uuid>` bo'lsa → `xp:<uuid>` (karta to'lovlari ~94%, sanaga bog'liq emas);
  - aks holda → `cx:{num}_{ddate}_{accCt}_{accDt}_{tiyin}_{sign}` (= byacc externalId'ning `general_id`siz qismi; vipiskada `general_id` yo'q).
  - `hamkorDedupKeyFromExisting(row)`: saqlangan `hbDedupKey` → izohdagi xonpay → `HB_*` externalId'dan birinchi segmentni (`general_id` yoki `IMP`) tashlab kompozit.
  - DB kafolati: `@@unique([accountId, hbDedupKey])` (boshqa banklarda `NULL`, to'qnashmaydi); P2002 jim skip.

---

### B.5 Sync — `backend/src/sync`

**Fayllar:** `sync.service.ts` (~2000 qator), `sync.controller.ts`, `settings.service.ts`, `sync.module.ts` (import: `PaymentsModule`, `CategorizationModule`), `sync.backfill-band.spec.ts`.

#### B.5.1 Cron'lar

| Cron | Ifoda | Nima qiladi |
|---|---|---|
| `SyncService.tick` | `TXN_SYNC_CRON` env yoki `* * * * *` (server TZ) | muddati o'tgan `sid` larni tozalaydi; `isActive` credential'lar (bank `isActive` va `apiKind ∈ {KAPITALBANK_V3, IPAK_YOLI_V1, HAMKORBANK_V1}`) va ularning `sync_enabled` hisoblari bo'yicha; har hisob `now - lastSyncedAt >= bank.syncIntervalMinutes` bo'lsa `syncAccount` (ketma-ket). `syncIntervalMinutes = 0` → avto o'chiq (faqat `force`). `GENERIC` hech qachon sync qilinmaydi |
| `SyncService.bulkScheduleTick` | `* * * * *` | `bulkSync.*` sozlamasi: `enabled`, Toshkent vaqti `timeOfDay` dan keyin, bugun hali ishlamagan va `intervalDays` o'tgan bo'lsa — `resolveBackfillTargets({scope:'all'})` + `runBackfill` (fonda). `daysBack` default `max(2, intervalDays+1)`. `lastRunAt` avval yoziladi |

Overlap: NestJS cron oldingi tick tugashini kutmaydi; bir hisobga parallel kirishni `syncingAccounts` (xotiradagi Set) to'sadi — band hisob jim `{skipped:true}` qaytaradi.

#### B.5.2 `syncAccount(credentialId, accountId, opts?: {dates})`
1. Band bo'lsa skip. Credential/hisob topiladi; `apiKind` uch turdan biri bo'lmasa xato.
2. **Yetimlarni qayta bog'lash:** `accountId IS NULL AND bankId = acc.bankId AND (fromAccount = accNo OR toAccount = accNo)` → `accountId = acc.id` (faqat UPDATE).
3. **Sana ro'yxati:** backfill bo'lsa berilgan sanalar (ISO `YYYY-MM-DD` ham `dd.MM.yyyy` ga o'giriladi — avval panel ISO yuborganda Kapital 400 qaytarardi va backfill jim hech narsa olmasdi); aks holda oxirgi `TXN_SYNC_DAYS_BACK` (default **10**) kun (`subDays(new Date(), i)`, bugundan boshlab).
4. `sync.minDate` dan oldingi **va o'sha kunning o'zi** (`d <= minDate`) tashlanadi; hammasi tashlansa skip.
5. `sync_logs` ga `RUNNING` qator: `source = "{accountNo} · {ownerName}[ · backfill {first}–{last}]"`.
6. Har kun: `fetchDoc1C(apiKind, …)` (Hamkor → `HamkorbankClient.getStatementDay`, qolgani → `KapitalbankClient.getDoc1C`); xato bo'lsa `errors++` va keyingi kun. Kun **faqat kamida 1 yozuv kelganda** "olindi" deb belgilanadi (bo'sh javob o'chirishga ruxsat bermaydi). Har item → `upsertOne`.
7. **Change detection** (`detectChanges`) — faqat backfill **emas** va kamida bitta kun olingan bo'lsa.
8. **Qoldiq:** faqat oddiy sync'da: `i=0` (bugun) kunining `saldo_out/100`; bo'lmasa `getAcc1C` → `s_out/100` (Hamkor'da GetAcc1C chaqirilmaydi). Backfill qoldiq va `lastSyncedAt` ga tegmaydi.
9. Log: `errors > 0` → `PARTIAL`, aks holda `SUCCESS`; tsikl tashqarisidagi exception → `FAILED` + `errorMessage` (500 belgi) va qayta throw. `finally` da qulf bo'shatiladi.

`leader/leader-health.service.ts::checkBankSync` 15 daqiqadan eski `RUNNING` ni uzilgan deb hisoblaydi.

#### B.5.3 `upsertOne(item, accountId, accountNo, bankId, bankCode)` — yozish va dedup
- `general_id` ham `b2_id` ham bo'lmasa — `false`.
- `externalId = makeCompositeId(...)`; Hamkor uchun `hbDedupKey`.
- **txnDate:** `buildTxnDateTime(ddate, time → stime → input_time)` → `dd.MM.yyyy` + vaqt, `+05:00`; vaqt yo'q bo'lsa 00:00 Toshkent. Hamkor `ddate` ichidagi vaqt ham o'qiladi. `txnDate1C` (karta haqiqiy vaqti) txnDate uchun **ishlatilmaydi** (pul hisobga tushgan sana = vipiska "Дата" ustuni; commit 7d89575 dan keyin), faqat belgi sifatida.
- `valueDate` — `@db.Date`, UTC peshin `T12:00:00Z` (TZ siljishi kunni o'zgartirmasin); `inputAt` — `input_date + input_time` Toshkent.
- **Mavjudini qidirish** (faqat shu `accountId` doirasida, `OR`): `externalId = composite`, `externalId = b2_id`, `externalId = general_id`, `bankB2Id = b2_id`, va **date-shift**: `externalId contains "_{general_id}_"` + `txnDate ±15 kun`.
- **Topilsa:**
  - sana yoki externalId farq qilsa → **DATE-SHIFT UPDATE**: yangi `externalId`, `txnDate`, `valueDate`, `bankB2Id`, `hbDedupKey`, bo'sh vaqtlar to'ldiriladi. externalId o'zgargan bo'lsa **OplataKv bog'lanishi ko'chiriladi**: `oplata_kv WHERE source_tx_id IN (eski externalId, tx.id)` → `source_tx_id = yangi externalId, date = txnDate` (commit 2043be4 gacha bu yo'q edi va to'lov OplatyKv'ga 2 marta tushardi; `@unique` konflikt bo'lsa warn, sync to'xtamaydi). Faqat sana ko'chgan va `txnDate1C` bor bo'lsa — faqat `oplata_kv.date`. Sana o'zgarishi (`txnDate1C` yo'q bo'lsa) `transaction_change_logs` ga `EDITED` (`fieldsChanged=['txnDate']`, `detectedBy='sync'`) yoziladi.
  - aks holda vaqt bo'sh bo'lsa → faqat `operationTime/settlementTime/txnDate` to'ldiriladi.
  - Har holda yangi qator yaratilmaydi (`false`).
- **Yangi qator:** yo'nalish `acc_ct === accountNo` → IN, `acc_dt === accountNo` → OUT, fallback `dir === 2`. Status: **faqat `state=3` → `COMPLETED`**, `6` → `CANCELLED`, qolgani `PENDING`. `type = guessType(purp_code, dtype)`: dtype `99`/`98` → `TAX`, `97` → `PAYMENT`, purp `00634` → `SALARY`, dtype `21/01/35` → `TRANSFER`, aks holda `OTHER`. Barcha bank maydonlari ustunlarga (`fromMfo…toInn`, `description`, `reference=uniq`, `purposeCode`, `docNumber`, `docType`, `bankGeneralId`, `bankB2Id`, `bankClientId`, `bankBranch`, `isAnor`, `bankErrCode/Msg`), `metadata` = to'liq item, `rawExtra` = `KNOWN_FIELDS` da yo'q maydonlar. P2002 (externalId yoki `accountId+hbDedupKey`) → jim `false`.
- Keyin: `direction=IN` va `inn_dt` bo'lsa `payments.autoMatch` (eski billing); har doim `categorization.categorizeOne(id, {actor:'sync'})` fire-and-forget.
- **Hamkor becfil-exclusion o'chirilgan:** `isDateExcluded` mavjud, lekin chaqirilmaydi — u kunlik sync'ni sindirgan (settlement partiyasidagi to'lovlarni noto'g'ri skip qilgan; commit d19dc52). `sync_exclusion_ranges` hozir faqat ma'lumot; dublikatni unique constraint to'xtatadi.

#### B.5.4 `detectChanges` — DELETED / EDITED / MOVED
Faqat `source='SYNC'` qatorlar, shu hisob, olingan kunlar oralig'i (`setHours` — **server lokal** kun chegaralari) va tx kuni haqiqatan yozuv kelgan kunlardan biri bo'lsa.
- Bank itemlari indeksi: `general_id + "_" + num` (commit B#13: avval faqat general_id — bir general_id'da bir necha sub-qator kollizyasi) va `b2_id`.
- DB tx kaliti externalId'dan (prefiks `IP_`/`HB_` olib tashlab, 1- va 2-segment).
- **EDITED:** `amount` farqi; status faqat **→ CANCELLED** bo'lganda log qilinadi (PENDING↔COMPLETED — ayniqsa Ipak'da kun ichida o'zgarib turadi — jim yangilanadi); `direction`; `description` (bank `naznach`/`details` bo'lsa). Log `EDITED` + tx yangilanadi; summa/yo'nalish o'zgarsa `cascadeOplataKvEdit` — `oplata_kv.payment_amount` imzoli (IN `+`, OUT `−`) yangilanadi + `oplata_kv_history` (`edited`).
- **O'chirish nomzodlari** darhol o'chirilmaydi (2026-08-25 gacha bank boshqa kunga ko'chirgan to'lov DELETED bo'lib OplataKv qatori o'chardi — commit 3c0684f, tiklash c83d315):
  - `bankCtx` yo'q → hech narsa o'chmaydi; **nomzod > 40** → bank nuqsoni deb hech narsa o'chmaydi;
  - har nomzod sanasi **±3 kun** (`VERIFY_DAYS`) oynasidagi hali olinmagan kunlar bankdan 5 parallel olinadi;
  - boshqa kunda topilsa → **MOVED** (`applyMovedChange`): log `MOVED`, `txnDate = item.ddate` (vaqtsiz, server lokal yarim tun), bog'langan `oplata_kv.date` yangilanadi, externalId o'zgarmaydi (keyingi sync'da `upsertOne` date-shift yangi ID'ga ko'chiradi);
  - topilmasa va ±3 kunning **hammasi** bankdan muvaffaqiyatli olingan bo'lsa → **DELETED** (`applyDeletedChange`): log `DELETED` (`oldData` = to'liq tx snapshot), `cascadeOplataKvDelete` (`source_tx_id IN (externalId, tx.id)` qatorlari `oplata_kv_history` ga `deleted` + to'liq snapshot, note ichida `txId=<id>`, keyin o'chiriladi), tx o'chiriladi; aks holda keyingi sync'ga qoldiriladi.
- Boot (`onModuleInit`): faqat `status` o'zgargan va yangi status CANCELLED bo'lmagan eski `EDITED` loglar (shovqin) o'chiriladi.

#### B.5.5 Qo'lda tekshirish va tiklash
- `manualCheckChanges({accountId?, dateFrom, dateTo, actor})` — sana oralig'ini bankdan olib `detectChanges` (`dateFrom` `sync.minDate` dan oldin bo'lmasin).
- `restoreOneDeleted({logId, force, actor})` — bitta `DELETED` log: tx bazada bormi (`id` yoki `externalId`); yo'q bo'lsa `verifyExternalInBank` (genNum kaliti, offsetlar `0,−1,1,−2,2,−3,3`) → `found`/`shifted`/`not_found`/`no_data`. Bank tasdiqlamasa va `force=false` → `not_in_bank` (tasdiq so'raladi — "arvoh pul" xavfi). Aks holda `restoreDeletedLog`.
- `restoreDeletedLog(lg)` — `sanitizeTxSnapshot` (relation maydonlar va `updatedAt` olib tashlanadi, null Json → `Prisma.DbNull`) bilan `transaction.upsert`; tx tiklanmasa va bazada ham yo'q bo'lsa OplataKv'ga **tegilmaydi** (yetim to'lov bo'lmasin). OplataKv qatorlari `oplata_kv_history (action='deleted')` dan `note contains txId=<id>` yoki `oplataKvId = externalId` bo'yicha, eng oxirgisi, `updatedAt` siz (delta-feed `updatedSince` ko'rsin) qayta yaratiladi + `created` tarix yozuvi. Muvaffaqiyatda log `note` ga `[TIKLANDI <sana> · actor]`.
- `recoverFalselyDeleted({dryRun=true, limit≤400})` — `[TIKLANDI` belgisiz `DELETED` loglarni bankdan tekshirib, bankda bor bo'lganlarini ommaviy tiklaydi (4 parallel).
- `debugFetchRaw({accountId, dates, searchNums?})` — bankdan xom javob (DB'ga yozmaydi), har item uchun composite ID. Diqqat: credential'ni `findFirst({bankId, isActive})` bilan oladi — hisobning o'z credential'i emas.
- `TransactionsService.restoreChangeLog` (B.6) `restoreOneDeleted` ustiga OplataKv'ni shartlar bo'yicha qayta qo'shishni qo'shadi (SyncModule ↔ OplataKvModule aylanma bog'liqlik sababli u yerda).

#### B.5.6 Backfill
- `resolveBackfillTargets({scope:'all'|'bank'|'account', bankId?, accountId?, dateFrom, dateTo})` — `account`: syncEnabled tekshirilmaydi; `bank`/`all`: faqat `sync_enabled`. Sanalar `dd.MM.yyyy`, `sync.minDate` bilan kesiladi (`clampedCount` qaytadi).
- `runBackfill(accounts, dates)` — har hisob ketma-ket `syncAccount(..., {dates})`. Hisob band bo'lsa (`skipped`) **15 s kutib 8 marta** qayta urinadi (`backfillBandKutishMs`, `backfillBandUrinish`); baribir band → `FAILED` log "Hisob boshqa sync bilan band edi — shu hisob uchun qayta yuklang" (2026-10-09 tuzatish; avval jim o'tib ketardi, jarayon "tugamadi" ko'rinardi). Spec: `sync.backfill-band.spec.ts`.
- Backfill: change detection yo'q, qoldiq va `lastSyncedAt` o'zgarmaydi.
- Hamkor'da byacc backfill bank tomonidan buzuq (`-899`/502, juda sekin) — o'tgan davr uchun vipiska importi (B.9).
- TR Support (`tr-support/tr-tarix.service.ts`) ham aynan shu `resolveBackfillTargets + runBackfill` ni ishlatadi.

#### B.5.7 Sync endpointlari (`sync.controller.ts`)

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/sync/settings` | `sync:view` | `syncMinDate`, `oplatykvTxMinDate`, `oplatykvAutoSyncMinutes`, kun/tun oynalari, `oplatykvAutoXatoCleanup` |
| PATCH | `/api/sync/settings` | `sync:run` | yuqoridagilarni saqlaydi (`updatedBy` = email) |
| GET/PATCH | `/api/sync/bulk-schedule` | `sync:view` / `sync:run` | `bulkSync.*` |
| POST | `/api/sync/account/:id` | `sync:run` | bitta hisob, sinxron; bank xatosi 500 emas `{ok:false,error}` |
| POST | `/api/sync/debug-fetch-raw` | `sync:run` | xom bank javobi (ISO sana ham qabul) |
| POST | `/api/sync/run-all` | `sync:run` | `tick(true)` fonda (intervalga qaramaydi) |
| POST | `/api/sync/backfill` | `sync:run` | `{scope, bankId?, accountId?, dateFrom, dateTo}` — fonda; `warning` agar minDate kesgan bo'lsa |
| GET | `/api/sync/backfill/status?since=` | `sync:view` | `source contains 'backfill'` loglar (500 ta) |
| GET | `/api/sync/logs?limit=` | `sync:view` | oxirgi loglar (≤200) |

`sync:settings_edit`, `sync:history_view`, `import:run`, `import:view` ruxsat kodlari mavjud, lekin backend endpointlarida tekshirilmaydi (faqat UI darajasida).

#### B.5.8 `SettingsService` kalitlari (`settings` jadvali, `key VarChar(64)`)

| Kalit | Tur / default | Kim ishlatadi |
|---|---|---|
| `sync.minDate` | ISO sana / yo'q | sync (shu kun va undan oldingi olinmaydi), manualCheckChanges, backfillSchotchik default |
| `oplatykv.txMinDate` | ISO sana | OplataKv auto-import (sanadan **keyingi** CLIENT tx) |
| `oplatykv.txAutoSyncMinutes` | son, 0/null = o'chiq | OplataKv auto-sync intervali |
| `oplatykv.dayStart` / `dayEnd` | `08:00` / `22:00` | OplataKv kunduzgi oyna |
| `oplatykv.nightStart` / `nightEnd` | `01:00` / `07:50` | OplataKv tungi oyna |
| `oplatykv.autoXatoCleanup` | `'1'` | OplataKv: CRM'da topilmaganlarni avto tozalash |
| `schotchik.auto`, `schotchik.dateFrom`, `schotchik.dayStart` (`08:00`), `schotchik.dayEnd` (`22:00`), `schotchik.intervalMin` (30) | — | "Счётчик → oylik" avto rejimi (OplataKv moduli) |
| `bulkSync.enabled`, `bulkSync.intervalDays` (1..365, default 1), `bulkSync.timeOfDay` (`18:00`), `bulkSync.daysBack`, `bulkSync.lastRunAt` | — | `bulkScheduleTick` |
| `bank.forwarderUrl`, `bank.forwarderSecret` | — | Kapital/Hamkor klient forwarder (api-explorer'dan sozlanadi) |

#### B.5.9 `sync_logs` modeli
`source` (255), `account_id`, `status` (`RUNNING|SUCCESS|FAILED|PARTIAL`), `fetched`, `saved`, `errors`, `error_message`, `duration_ms`, `started_at`, `finished_at`. Indekslar `started_at`, `(source,status)`, `account_id`.

---

### B.6 Tranzaksiyalar moduli — `backend/src/transactions`

**Fayllar:** `transactions.controller.ts`, `transactions.service.ts` (~2100), `reconcile.service.ts` (B.7), `sverka-agent.service.ts` (+spec), `inspector.service.ts`, `statement.service.ts`, `dto/list-transactions.dto.ts`. Modul import: `SyncModule`, `SverkaTelegramModule`, `OplataKvModule`; eksport `TransactionsService`, `StatementService` (Universal API ham vipiskani shundan beradi).

#### B.6.1 `transactions` modeli — muhim ustunlar
`external_id` (unique), `type` (`TRANSFER|PAYMENT|SALARY|TAX|FEE|REFUND|OTHER`), `status` (`PENDING|COMPLETED|FAILED|CANCELLED|REVERSED`, default PENDING), `direction`, `amount`, `currency`, `from_*`/`to_*` (mfo, account, name, inn), `description`, `reference`, `purpose_code`, `doc_number`, `doc_type`, `bank_general_id`, `bank_b2_id`, `hb_dedup_key`, `bank_client_id`, `bank_branch`, `value_date` (Date), `operation_time`, `settlement_time`, `input_at`, `is_anor`, `bank_err_*`, `metadata`, `raw_extra`, `source` (`SYNC|IMPORT|MANUAL|ALOQA_BANK|HAMKOR_IMPORT`), `import_*_text`, `imported_by/at`, `import_batch_id`, `bank_id`, `account_id`, `category_id`, `subcategory_id`, `contract_number` (128), `is_contract_manual`, `xato_hidden`, `categorized_at/by/by_id`, `customer_id`, `match_status`, `matched_at`, `manual_counterparty_id`, `erp_payment_id/supplier/article/contract/object/matched_at`, `txn_date`, `synced_at`. Indekslar: `txn_date`, `(txn_date desc, id desc)`, `status`, `(type,direction)`, `bank_id`, `account_id`, `contract_number`, `source`, `erp_payment_id`… `description`/`from_name` bo'yicha indeks **yo'q**.

#### B.6.2 Ro'yxat va filtrlar (`buildWhere`, `list`, `distinctValues`)
- Oddiy filtrlar: `type`, `status`, `direction`, `bankId`, `accountId`, `batchId` (→ `importBatchId`), `sources` (vergul), `dateFrom/dateTo` (Toshkent kun chegaralari).
- `q` — `description/fromName/toName/reference/contractNumber` (`contains`, insensitive), `fromAccount/toAccount/externalId/bankGeneralId/bankB2Id/docNumber` (`contains`), `id` (teng). Indekssiz — sana filtrisiz sekin.
- Google Sheets uslubidagi ustun filtrlari (vergul bilan): `bankIds`, `accountIds`, `categoryIds` (ustun "Kontragent"), `subcategoryIds` (ustun "Kategoriya"), `directions`, `hisobNomi` (`fromName` yoki `toName` aniq teng), `amountMin/Max`.
  - Maxsus qiymatlar: `__EMPTY__` — jadvalda "—" ko'rinadigan qatorlar (kategoriya yo'q + qo'lda kontragent yo'q + `erp_*` yo'q + import matni yo'q); `erp:<nom>` — ta'minot ERP nomi (`erpSupplier`/`erpArticle`).
  - `contractSources`: `manual` = `isContractManual AND attachments.none`, `ariza` = `attachments.some`.
  - `contractStatuses`: shartnoma raqamlari + `__NONE__` (contractNumber va erpContract ikkalasi NULL), `__XATO__` (raqam bor, `crm_contracts.found=true` ro'yxatida yo'q — `applyContractStatusFilters` AND bilan qo'shadi, commit B#3), `__BEKOR__` (CRM status `cancel`/`отмен`/`бекор`), `erp:<raqam>` → `erpContract`.
- `list`: `page ≤ 4000`, `perPage ≤ 200`, tartib `txnDate desc, id desc`; enrichment: `counterpartyDisplay` (ustuvorlik: qo'lda kontragent → IMPORT `importCounterpartyText` (agar kategoriya qo'lda o'zgarmagan bo'lsa) → CLIENT kategoriya nomi → TRANSFER o'z hisob egasi → COUNTERPARTY `counterparties.name` (INN) → kategoriya nomi), `contractStatus` (`manual`/`verified`/`unverified`), `contractCustomer`, `contractCrmStatus`, `hasAttachment`.
- `distinctValues(column)` — ustun filtrlari uchun qiymatlar, o'z filtri chiqarib (`bank`, `accountIds`, `kontragent`, `kategoriya`, `direction`, `contractStatus|contractNumber` (faqat verified individual + `⚠ Xato (N ta)` + `⊘ Bekor qilingan` + `— Shartnoma yo'q` + ERP shartnomalar), `hisobNomi`).

#### B.6.3 Statistika va tahlil
- `stats` — `buildWhere` + `categoryCode`; `groupBy(direction,status)`, `count`, `groupBy(bankId,direction)`. **Status filtrlanmaydi** (PENDING/CANCELLED ham summaga kiradi). Sanasiz chaqiruv butun jadvalni o'qiydi.
- `daily(from,to,bankId,accountId,categoryCode)` — default oxirgi 30 kun, Toshkent kun bucket'lari, bo'sh kunlar 0; `categoryCode` bo'lsa subkategoriya bo'linishi. `take` yo'q.
- `breakdown({dim: category|counterparty|account|contract, direction default OUT, limit 5..50})`.
- `sverkaCounterparty({name|inn, from, to})` — 1C uslubidagi akt sverka (OUT → `toName/toInn`, IN → `fromName/fromInn`), boshlang'ich saldo, yuguruvchi saldo, 1000 qator. `sverkaContract({contract})` — `oplata_kv` bo'yicha shartnoma statementi. Ikkalasida `from` = `new Date('YYYY-MM-DD')` (UTC) va `to` = `'…T23:59:59.999'` (server lokal) — Toshkent chegarasi emas.
- `xatoContracts` — CRM tasdiqlamagan shartnoma raqamlari (soni, summa).
- `clientXatoTransactions(page, perPage, q, hidden)` — `CLIENT` + `isContractManual=false` + `source NOT IN (IMPORT, ALOQA_BANK)` + raqam bor + found ro'yxatida yo'q; `xatoHidden` filtri (`active`/`hidden`/`all`). XATO'ning boshqa ta'rifi OplataKv'dagi `buildXatoFilter` bilan bir xil emas (xato.md).

#### B.6.4 Eksport, tozalash, diagnostika
- `exportXlsx` — `buildWhere` + `matchStatus`, ≤ 50 000 qator; "Shartnoma" ustunida tasdiqlanmagan raqam o'rniga `XATO` (manual bo'lsa raqam).
- `getRowsForExport` / `countForExport` — Google Sheets eksporti uchun (hisob raqamlari bo'yicha); sana chegaralari UTC/server-lokal (Toshkent emas).
- `deleteByAccountNo(accountNo)` (SUPERADMIN) — barcha tx snapshot'i `transaction_change_logs` (`DELETED`) ga, bog'langan `oplata_kv` → history (`deleted`) + o'chirish, `payments` **arxivsiz** o'chadi, tx o'chadi, hisob `balance` va `last_synced_at` NULL. Ommaviy qaytarib bo'lmaydi (faqat qatorma-qator `restore-one`).
- `deleteRowById(id, table)` — bitta tx (arxiv + OplataKv kaskad + payment) yoki bitta `oplata_kv` qatori (history'ga arxiv). `confirm === id` shart.
- `findByPaymentId(paymentId, table)` — `id`/`externalId`/`contains`/`bankGeneralId` (yoki OplataKv `id`/`sourceTxId`).
- `timeDiagnostics(date)` — bank vaqt beryaptimi (`operation_time` taqsimoti, xom `metadata` namunalari, oxirgi sync loglari).
- `fixTxnTimeFromBank({dateFrom, dateTo, dryRun=true})` — eski qatorlarda `txn_date` vaqtini `operation_time` (yo'q bo'lsa `settlement_time`) bilan qayta quradi, Toshkent kuni o'zgarmaydi (SQL `AT TIME ZONE 'Asia/Tashkent'`), 5000 lik paketlar.
- `restoreChangeLog(logId, {force, actor, actorId})` — `sync.restoreOneDeleted`; OplataKv tarixdan tiklanmagan bo'lsa `OplataKvService.addOneFromTransaction` (CLIENT + shartnoma bo'lsa qayta qo'shadi, split hisoblanadi); `splitStaleWarning` — shu shartnoma bo'yicha keyingi to'lovlar bo'lsa "1 взнос/oylik taqsimoti eskirgan bo'lishi mumkin" ogohlantirishi (avtomat qayta hisoblanmaydi — qo'lda kategoriyalar yo'qolmasin); `not_in_bank` → `needsConfirm`.

#### B.6.5 Inspector (`inspector.service.ts`)
- `parseId(rawId)` — `[IP_|HB_]` + 7 qism; `sign '+'` → bizning hisob `accDt`, aks holda `accCt`.
- `lookupFromBank(rawId)` — hisob `accountNo` bo'yicha (credential kerak); **faqat `KAPITALBANK_V3` va `HAMKORBANK_V1`** (Ipak yo'q); asl kun atrofidagi 5 kun parallel; moslik: `general_id` → `num+ddate` → `amount+ikkala hisob` → `amount+bitta hisob`; verdict `found` / `shifted` / `cancelled` / `partial` / `no_data`; eng yaqin 5 ta summa bo'yicha.
- `parseIdsFromExcel` (A ustun), `exportResultsToXlsx`.
- Ehtimoliy nuqson: `fmtDdate` `getUTCDate` ni `T00:00+05:00` lahzasiga qo'llaydi → tekshiriladigan oyna 1 kunga chapga siljigan (D−3…D+1).

#### B.6.6 Vipiska (`statement.service.ts`)
`build(accountId, dateFrom, dateTo)` — bankdan to'g'ridan-to'g'ri `GetDoc1C` kunma-kun (DB emas), **faqat `KAPITALBANK_V3`**, ≤ 92 kun; opening = birinchi muvaffaqiyatli kun `saldo_in`, closing = oxirgi `saldo_out`; Excel. Hamma kun xato → 400. Ehtimoliy nuqson: `fmtDate` lokal `getDate()` ishlatadi (reconcile'da aynan shu xato tuzatilgan) — server UTC bo'lsa har kun bir kun oldingi sana so'raladi (aniq emas, server TZ repo'da belgilanmagan).

#### B.6.7 Endpointlar (`/api/transactions`)

| Metod | Yo'l | Ruxsat | Izoh |
|---|---|---|---|
| POST | `/inspect-id` | `transactions:view` | ID inspektor (bankka so'rov) |
| POST | `/parse-ids-excel`, `/export-inspect-results` | `transactions:view` | bulk inspektor |
| GET | `/`, `/distinct`, `/stats`, `/breakdown`, `/sverka/counterparty`, `/sverka/contract` | `transactions:view` yoki `dashboard:recon` | ro'yxat va tahlil |
| GET | `/xato-contracts`, `/client-xato`, `/client-xato/export` | `transactions:view` | XATO |
| GET | `/daily` | `transactions:view` | diagramma |
| POST | `/reconcile`, `/reconcile/diagnose`, `/reconcile/agent/analyze` | `transactions:sverka_view` | B.7 |
| GET | `/reconcile/today?date&syncMismatched` | `transactions:sverka_view` yoki `dashboard:recon` | + `sverkaTg.notifyNewMismatches` |
| POST | `/reconcile/fix-missing`, `/fix-all-missing`, `/fix-tx-date`, `/fix-all-tx-date`, `/agent/apply` | `transactions:sverka_fix` | DB yozuvi + Telegram xabar |
| GET | `/export` | `transactions:export` | Excel |
| GET | `/statement` | `transactions:vipiska_view` | bank vipiskasi |
| GET | `/changes/list` | `changed_txn:view` | `transaction_change_logs` (filtr `DELETED/EDITED/MOVED`, `detectedAt`, `q`) + KPI |
| POST | `/changes/check` | `changed_txn:check` | `manualCheckChanges` |
| POST | `/changes/recover` | `changed_txn:check` | `recoverFalselyDeleted` (dryRun default) |
| POST | `/changes/restore-one` | `changed_txn:restore` | `restoreChangeLog` |
| GET | `/find-by-payment-id` | `cleanup:view` | `:id` dan oldin e'lon qilingan (shart) |
| GET | `/:id` | `transactions:view` | `id` yoki `externalId` |
| GET | `/count-by-account/:accountNo` | SUPERADMIN (RolesGuard) | cleanup oldidan |
| GET | `/time-diagnostics` | `transactions:view` | **`/:id` dan keyin e'lon qilingan** — Express marshrut tartibida `:id` uni ushlab qolishi ehtimol (frontend `time-diagnostics-dialog.tsx` shu yo'lni chaqiradi); tekshirish kerak |
| POST | `/fix-txn-time` | `transactions:sverka_fix` | dryRun default |
| POST | `/cleanup-by-account` | SUPERADMIN | `confirm === accountNo` |
| POST | `/delete-row-by-id` | `cleanup:run` | `confirm === id` |

---

### B.7 Bank sverka — `transactions/reconcile.service.ts` (+ `sverka-agent.service.ts`)

**Vazifa:** hisob + Toshkent kuni bo'yicha bank oboroti/saldosi ↔ `transactions` (`txn_date`). Faqat `KAPITALBANK_V3` va `IPAK_YOLI_V1` (Hamkor uchun sverka yo'q — "farq yo'q" deb talqin qilmaslik kerak). Konstantalar: `MAX_DAYS = 92`, `EPSILON = 1` so'm.

- `reconcile(accountId, dateFrom, dateTo, {withSync})`:
  - `withSync` — avval `syncAccount(..., {dates})` (backfill rejimi). **Ehtimoliy xato:** sanalar `new Date('…T00:00:00+05:00').toISOString().slice(0,10)` bilan yasaladi → bu oldingi kunni beradi, ya'ni "sync qilib qayta sverka" maqsad kunni emas, bir kun oldingisini sync qiladi (kodni o'qishdan; runtime tekshirilmagan).
  - Bankdan kunma-kun `getDoc1C`: opening faqat **1-kun** `saldo_in` (commit B#10; 1-kun xato bo'lsa `formulaReliable=false` va status ok bo'lmaydi), closing oxirgi muvaffaqiyatli `saldo_out`, `total_debit/credit` yig'indisi; hamma kun xato → 400.
  - DB: shu hisob, `txnDate` oynasi, **status filtri yo'q**; `groupBy(direction)`.
  - `status='mismatch'` agar kirim, chiqim yoki formula (`opening + dbIn − dbOut` ↔ `closing`) farqi ≥ 1 so'm. Javobdagi `ok: true` — amal bajarildi degani, moslik emas.
  - Ko'p kunlik `dailyBreakdown` — ehtimoliy off-by-one: bank kalitlari `day.toISOString()` (bir kun oldin), DB kalitlari Toshkent kuni.
  - `fmtDate` — `Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Tashkent'})` (avval lokal `getDate()` server UTC'da butun kunni noto'g'ri so'rab soxta farq bergan).
- `reconcileToday(date?, {syncMismatched})` — `sync_enabled` + bank faol + KB/Ipak hisoblar; worker pool **15 parallel**, hisobga 12 s timeout; `syncMismatched=true` bo'lsa 2-pass: faqat `mismatch` hisoblar `withSync` bilan qayta (3 parallel, 30 s). Natija 5 daqiqa xotira keshida (`syncMismatched` keshni chetlaydi). Tartib: error → farq kattaligi → ok.
- `diagnoseDay(accountId, date)` — bank itemlari ↔ DB: kalitlar `b2:`, `gen:`, composite, legacy (`b2_id`/`general_id` ning o'zi externalId sifatida); boshqa sanada saqlanganlar (`offDateItems`); fallback summa+yo'nalish+±3 kun (faqat bitta nomzod bo'lsa); Kapital'da `GetDoc1C` bo'sh bo'lsa `apiLogin` + `GetDocuments` fallback; qo'shni kunlar ±2 va DB yozuvi `ddate` ±2 qo'shimcha so'rovlari (faqat Kapital). Natija: `bankOnly` (`existsOnDate`, `existingTxId`), `dbOnly` (`foundOnBankDate`), `amountMismatch` (ID mos, summa farqi > 0.01). **Ehtimoliy off-by-one:** qo'shni kunlar yorlig'i `isoDate = d.toISOString().slice(0,10)` (haqiqiy kundan 1 kun oldin) — `foundOnBankDate` va undan yasalgan AI `fixDates` taklifi noto'g'ri sanani ko'rsatishi mumkin.
- Tuzatishlar (hammasi `invalidateTodayCache`):
  - `fixMissing` / `fixAllMissing` — bankdan shu kunni qayta olib `sync.upsertOne` (to'liq oqim: autoMatch + kategoriya).
  - `fixTxDate` / `fixAllTxDate` — `txnDate = newDate T12:00:00Z` (asl vaqt yo'qoladi), externalId'dagi `dd.MM.yyyy` segmenti `replaceCompositeDate` bilan almashtiriladi (konflikt bo'lsa faqat sana), **`relinkOplataKv`** (`source_tx_id` + `date` ko'chadi — sync date-shift bilan bir juft, biri qolsa OplataKv dublikati), `EDITED` log.
  - `fixAllTxAmount` (faqat agent orqali; alohida endpoint yo'q) — `oplata_kv` ga bog'langan tx summasi **o'zgartirilmaydi**; `EDITED` log.
- **Sverka AI agenti** (`sverka-agent.service.ts`): `analyze(accountId, date, locale, withSync=true)` — reconcile + diagnose → server o'zi `addMissing`/`fixDates`/`fixAmounts`/`unresolved` ro'yxatini quradi, Claude (Messages API, tool `sverka_diagnosis`) faqat `culprit` (`bank|us|mixed|none|unknown`), `confidence`, tavsiya beradi; status ok bo'lsa AI chaqirilmaydi; 5 daqiqa kesh. Kalit: Setting `agent.aiKey` (shifrlangan) yoki env `ANTHROPIC_API_KEY`; model `agent.aiModel`. `applyRecommended` — `account:date` lock, diagnose'dan qayta quriladi, mavjud primitivlar bilan bajariladi. Batafsil: `agents/knowledge/sverka.md`.

### B.8 Sverka Telegram — `backend/src/sverka-telegram`

**Fayllar:** `sverka-telegram.service.ts`, `digest.ts` (+spec, sof render), `sverka-telegram.controller.ts`. `ReconcileService` `ModuleRef` orqali olinadi (aylanma bog'liqlik).

| Cron | Ifoda | Nima qiladi |
|---|---|---|
| `autoSverkaNotify` | `SVERKA_NOTIFY_CRON` yoki `*/30 * * * *` (server TZ, 24/7) | chat bo'lmasa hech narsa; `reconcileToday(…, {syncMismatched:true})` → `notifyNewMismatches(synced:true)` |
| `eveningReminder` | `0 20 * * *` Asia/Tashkent | tuzatilmagan farqlar ro'yxati (≤40), xabar id'lari saqlanadi |
| `deleteEveningReminder` | `0 23 * * *` Asia/Tashkent | 20:00 xabarini o'chiradi |

- Long-polling (`pollLoop`, `getUpdates`, webhook o'chiriladi) — inline tugmalar (`fix:`, `apply:`, yopish, yangilash) va `/clear` buyrug'i.
- `notifyNewMismatches(items, date, {synced})` — kunlik store (`sverka.telegram.notifiedToday`): hal bo'lganlar o'chadi; yangi yoki `diffKey` (formula farqi) o'zgarganlari tahlil qilinadi (bir tsiklda ≤ 15 AI); sync bilan hal bo'lsa digestga kirmaydi; **bitta digest xabar joyida tahrirlanadi** (spam fix). Ayb faqat `confidence='high'` da ko'rsatiladi (`digest.ts::faultLabel`).
- `markResolvedFromWeb(accountId, date)` — web'dan tuzatilgach digest qatori yangilanadi/o'chadi; `notifySverkaAction` — amal xabari; `resetNotifiedToday` — avval Telegram xabarlarini o'chiradi, keyin store'ni tozalaydi.
- Chat rollari: approver (tugmali), watcher.
- **Setting kalitlari:** `sverka.telegram.botToken` (ochiq matn; bo'lmasa env `SVERKA_BOT_TOKEN`), `sverka.telegram.chats`, `sverka.telegram.history`, `sverka.telegram.password` (bo'lmasa env `ADMIN_ACTION_PASSWORD`), `sverka.telegram.notifiedToday`, `sverka.telegram.sentLog`, `sverka.telegram.eveningReminder`. Qiymatlarini o'qish/yozish taqiqlanadi.
- **Endpointlar** (`/api/sverka-telegram`): `POST verify-password` (`sverka_view`); `GET/POST chats`, `DELETE chats/:chatId`, `GET/POST bot-token`, `POST test`, `POST reset-notified` (`sverka_fix`); `GET history` (`sverka_view`). Diqqat: `GET bot-token` javobida `masked` bilan birga **to'liq `token`** ham qaytadi.

---

### B.9 Import — `backend/src/import`

**Endpointlar** (`/api/import`, hammasi `sync:run`; fayl ≤ 30 MB):

| Metod | Yo'l | Nima qiladi |
|---|---|---|
| POST | `/transactions` | standart Excel import (`source=IMPORT`) |
| POST | `/aloqa-bank` | Aloqa Bank Excel (`source=ALOQA_BANK`, read-only) |
| POST | `/hamkor-vipiska/preview` → `/commit` (`previewId`) → `/cancel` | Hamkor rasmiy vipiskasi |
| GET/POST/DELETE | `/hamkor-vipiska/exclusions[/:id]` | `sync_exclusion_ranges` (hozir faqat ma'lumot) |
| GET | `/batches?kind=` | batch tarixi (kind bo'sh yoki `transactions` bo'lsa avval `backfillLegacyBatch`) |
| DELETE | `/batches/:id` | batch + tranzaksiyalari |
| GET | `/batches/:id/export` | batchni qayta import formatida Excel |

- **`importExcel`** — ustunlar (1-qator sarlavha): A `Р/С`, B bank nomi, C `ДАТА` (dd.MM.yyyy yoki Date), D hisob nomi, E kontragent, F kategoriya, G shartnoma, H debet (OUT), I kredit (IN), J izoh, K ID. Validatsiya: K va A majburiy, sana to'g'ri, debet/kredit aniq bittasi > 0. Summa so'mda (`"1 234,56"` → 1234.56). Dedup — `externalId = K` bazada bo'lsa skip; `createMany(skipDuplicates)` 500 lik, xato bo'lsa bittalab. Kategoriya F nomi bo'yicha (case-insensitive) moslanadi, aks holda `importCategoryText`; **`runRules` chaqirilmaydi**, shartnoma G'dan CRM tekshiruvisiz yoziladi; `status=COMPLETED`, `type=OTHER`. Har qatorga `transaction_category_history (action='import')`. Sana `new Date(y,m,d)` — server lokal yarim tun (Toshkent emas).
- **`importExcelAloqaBank`** — xuddi shu 11 ustun; externalId'ga `ALB_` prefiks; `source=ALOQA_BANK` → `categorization.controller::assertEditable` bunday qatorlarni tahrirlashni bloklaydi; `clientXatoTransactions` ularni chiqarib tashlaydi.
- **Hamkor vipiska** (HTML-jadval `.xls`, windows-1251):
  - `decodeCp1251` (TextDecoder, bo'lmasa qo'lda jadval), `<tr>/<td>` parse; yozuv = `dd.mm.yyyy HH:mm:ss` bilan boshlanadigan 8 katakli bo'lak: `[Дата, kontragent+hisob+INN, №док, …, debet, kredit, izoh]`; header'dan birinchi 20 xonali raqam = bizning hisob, egasi, davr (`с … по …`), `начало/конец периода` qoldiqlari.
  - Preview (bazaga tegmaydi, 30 daqiqa xotira keshi): `hbDedupKey` (sync bilan bir xil formula), `externalId = "HB_IMP_" + {num}_{Дата}_{accCt}_{accDt}_{tiyin}_{sign}`; fayl ichidagi va bazadagi (`HB_*` qatorlar `hamkorDedupKeyFromExisting`) dublikatlar sanaladi; **integrity** `opening + Σkredit − Σdebet ≈ closing` (< 0.5); `txnDate` = "Дата" ustuni (+5); hisob bazada bo'lmasa yoziladigan qator 0.
  - Commit: race himoyasi (kalitlar qayta o'qiladi), `source=HAMKOR_IMPORT`, `importBankNameText='Hamkorbank'`, batch `hamkor-vipiska`; integrity buzilgan bo'lsa ham foydalanuvchi tasdiqlagan bo'lsa yoziladi (warn log); davr uchun `sync_exclusion_ranges (source='import')` yaratiladi; qo'shilganlar **fonda ketma-ket `categorizeOne(actor:'auto')`**.
- **`deleteBatch`** — `kind` → source (`aloqa-bank` → `ALOQA_BANK`, `hamkor-vipiska` → `HAMKOR_IMPORT`, aks holda `IMPORT`); 500 lik bo'laklar: bog'liq `oplata_kv` history (`snapshot`) + o'chirish, `transaction_category_history`, `payments`, tx o'chiriladi — **tx snapshot'i change log'ga arxivlanmaydi**. `kind='oplata-kv'` batch — `oplata_kv` qatorlari (history bilan).
- `backfillLegacyBatch` — batch'siz `IMPORT` qatorlarni bitta `legacy-import` batch'ga bog'laydi (idempotent).
- **Model `import_batches`:** `kind` (`transactions|aloqa-bank|hamkor-vipiska|oplata-kv`), `file_name`, `file_size`, `imported_by/at`, `rows_total/added/skipped/errors`, `notes`. `importExcel` erta qaytganda (hammasi dublikat) batch statistikasi yangilanmay qoladi.

---

### B.10 Kategoriyalash — `backend/src/categorization`

**Fayllar:** `categorization.service.ts` (~2500), `contract-parser.ts` (+spec), `crm-contract-cache.service.ts` (+recheck spec), `categorization.controller.ts`, `categorization.module.ts`.

#### B.10.1 `runRules(tx, opts)` — qoidalar tartibi (birinchi mos kelgan to'xtatadi)
0. **Mavjud kategoriya** va `force=false` → kategoriya o'zgarmaydi; faqat `contractNumber` bo'lsa CRM lookup (`payerHint = izoh`) va CRM kanonik shaklda topsa (`I↔1`, `O↔0`, `/SH`, dublikat ism) raqam kanonikka almashtiriladi. Natija `categoryCode='EXISTING'`.
1. **Shartnoma ajratish:** `contractNumber` bo'sh (yoki `forceRefresh`) bo'lsa `extractContractCandidates(description)`; default `candidates[0]`, CRM'da `found` bo'lgan birinchi nomzodning **CRM kanonik** raqami saqlanadi.
2. **CLIENT:** raqam bor va CRM lookup natija qaytarsa (topilmagan `found=false` ham natija) → `CLIENT`; CRM statusi `реинвестиц`/`фиктив` bo'lsa (`isExcludedClientStatus`) CLIENT emas, keyingi qoidalarga. Subkategoriya (`pickClientSubcategory`): izohda `HISOBLAG|ХИСОБЛАГ|ХИСЛОБЛАГ|СЧЕТЧИК` → `CLIENT_SCHETCHIK`; `ПЕРЕОФОРМЛЕНИЕ` → `CLIENT_PEREOFORM`; `OUT` → `CLIENT_VOZVRAT`; CRM obyekti `ПАРКОВКА/АВТОСТОЯН/PARKING` → `CLIENT_VZNOS_AVTO`; aks holda `CLIENT_VZNOS_KV`. CRM topmasa ham CLIENT (XATO holati — tasdiqlanmagan raqam).
3. **MINFIN** — faqat byudjet belgisi: `fromName+toName` da `BUDGET_NAME_PARTS` (`МОЛИЯ ВАЗИРЛИГИ`, `ЯГОНА ГАЗНА`, `КАЗНАЧЕЙСТВО`, `ТУМАНИ ДСИ`, `ТУМАН ДСИ`, `TUMANI DSI`, `МУНИС`) yoki `purposeCode ∈ {08101, 08102, 08108, 08201, 09510, 00602}`. Soliq kalit so'zi (`TAX_KEYWORDS`: `НДС/QQS`, `НДФЛ`, `ЕСП`, yer, mol-mulk, suv, jarima, foyda, pensiya…) faqat **subkategoriyani** tanlaydi. 2026-09-18 gacha izohdagi `НДС` yetarli edi → 21 863 oddiy to'lov soliq bo'lgan (commit f4993f8; tozalash `fixMinfinCategory`).
4. **BANK:** `purposeCode = 00667` yoki izohda `CORPORATE/ТАРИФ/TARIF` → `BANK` + `BANK_USLUGI`; `ВОЗМЕЩЕНИЕ КЛИЕНТУ ПО ПОКУПКАМ` → `BANK` (ekvayring, subkategoriyasiz).
5. **SALARY:** `KEYWORDS_SALARY` (`ПЕРЕЧИСЛЯЕТСЯ ЗАРПЛАТА`, `ЗАРАБОТНАЯ ПЛАТА`, `ОТПУСКНЫЕ`, `ТРУДОВОЙ ОТПУСК`, `АЛИМЕНТ`, `БОЛЬНИЧНОГО`, `ВЫПЛАТА ПРЕМИИ`, `МАТЕРИАЛЬНАЯ ПОМОЩ`, `ДОХОД ОТ ДЕЯТЕЛЬНОСТИ`, `ВОЗНАГРАЖДЕНИЕ ПО ДОГОВОРУ ГПХ`…) yoki regex `(АВАНС|ПРЕМИЯ|ЗАРПЛАТА) + oy nomi` (yolg'iz `АВАНС` yetarli emas — yetkazib beruvchi avansi bilan aralashadi).
6. **LOAN:** `(ЗАЙМ)`/`(ЗАЕМ)` → `LOAN` + `LOAN_VYDACHA`.
7. **TRANSFER:** boshqa tomon hisobi o'z hisoblarimizdan biri (`accountNo` + `previousAccountNo`, 5 daqiqa kesh) yoki izohda `ИККИЛАМЧИ ХИСОБВАРА`/`АСОСИЙ ХИСОБВАРА`/`ПЕРЕБРОСКА`.
8. Hech biri → kategoriyasiz (`'qoida topilmadi'`). `COUNTERPARTY`/`COUNTERPARTY_RETURN` qoidalarda **yo'q** — ularni faqat qo'lda tahrir yoki kategoriya agenti qo'yadi.
- Izoh normallashtirish: `toUpperCase` + `Ё→Е`. `dryRun` — yozmaydi. Yozishda `categorizedBy = actor` (`auto|manual|cron|sync`), `transaction_category_history` (o'zgarish bo'lsagina).
- `getRefs` — 26 ta kategoriya kodi (CLIENT, BANK, SALARY, TRANSFER, MINFIN, LOAN, COUNTERPARTY_RETURN, COUNTERPARTY va subkodlar) seed'da bo'lishi shart, aks holda xato; xotira keshi (`resetCache`).

#### B.10.2 `contract-parser.ts`
- `OBJECT_CODES = AFS, YLZ, MSO, FZO, VDY, ZUR, SLQ, OCN, VTN, PRL, ORZ, SRH, BHR, RMZ, VHA` — yangi obyekt shu yerga qo'shiladi, aks holda to'lov CLIENT bo'lmaydi.
- `CONTRACT_RE = (\d{1,6})\s*(<kod>)\s*([A-Z0-9]{2,6})` (case-insensitive); kod ichidagi `O` → `[O0О]` (lotin O, raqam 0, kirill O). Fayl boshidagi "1–4 raqam" izohi eskirgan — haqiqiy regex 1–6 raqam, dum 2–6.
- Tozalash tartibi: `stripFillers` (to'ldiruvchi so'zlar `сонли/сонлик/сон/ракамли/рақамли/ракам/sonli/sonlik/son/raqamli/raqam`, Unicode chegaralar bilan) → kirill→lotin **ko'rinish bo'yicha** (`С→C`, `Н→H`, `Р→P`…) → `№`, `N°` olib tashlanadi → UPPER. `isJunkTail` — dum `COH/COHLI/SON/SONLI/RAQAM/PAKAM…` bo'lsa nomzod qaytmaydi. Tarix: 2026-10-10 "сонли" yopishib `…AFSCOH` kabi mavjud bo'lmagan shartnomalar yaratilgan (289 dan 218 tasi); eskilarini `reparseJunkContracts` tozalaydi.
- `extractContractCandidates` tartibi: (1) asosiy; (2) yopishgan `OT/от` kesilgani (`stripGluedOt`: kesilgan qism to'liq format bo'lishi shart, `OT` dan keyin faqat raqam/bo'sh — sana yopishgan holat, egasi qoidasi 2026-10-05); (3) +1 belgi (bo'shliq bilan yoki tutash); (4) +2 belgi; (5) suffiks `/XX` yoki `-XX` (1–3 belgi) — slash bilan va tutash.
- `contractVariants(normalized)` — `O↔0` va `I↔1` (bosh raqamlar blokidagi `1` dan tashqari) barcha kombinatsiyalari, o'zgarish soni bo'yicha tartiblangan; > 10 chalkash belgi → faqat "hammasi bir xil" variantlar.
- `objectCodeOf(contract)` — kanonik obyekt kodi.

#### B.10.3 CRM shartnoma keshi (`crm-contract-cache.service.ts`, jadval `crm_contracts`)
- `crm_contracts`: `contract_number` (PK), `customer_name`, `status`, `virtual_status` (NULL = tekshirilmagan, `''` = yo'q), `object_name`, `apartment_number`, `phone`, `crm_order_id`, `branch_name` (NULL/`''`/qiymat), `property_type` (`parking|apartment`), `raw_snapshot`, `found`, `last_verified_at`, `last_error`. `__…__` bilan boshlanuvchi kalitlar — bir martalik vazifa markerlari (shartnoma emas).
- `lookup(contractNumber, {forceRefresh, payerHint})`: kalit normallashtiriladi; `forceRefresh` → 16 variant keshdan o'chiriladi; in-flight dedup; `doLookup`: variantlar bo'yicha qidirish, `found desc` ustuvor (commit B#9); yangi (`found` 24 soat, `found=false` 4 soat) bo'lsa keshdan; eskirgan `found=false` → sinxron qayta so'rov; eskirgan `found=true` → keshdan qaytaradi va fonda yangilaydi. `payerHint` berilgan va kesh mijozi izohdagi ismga mos kelmasa (`crm.matchesPayer`) — dublikat raqamli shartnomalar orasidan to'g'risi qayta olinadi.
- **Natija har doim obyekt** (topilmasa `found=false` qatori yoziladi va qaytariladi) — chaqiruvchi `found` ni tekshirishi kerak.
- `fetchFromCrmAndCache`: 8 variant bo'yicha `crm.show` (mijoz F.I.O., status (`deleted_at`/`is_trashed` → `cancelled`), obyekt (bir necha joydan), xonadon, telefon, order id, `virtual_status` (mojibake tuzatish), `property_type` faqat CRM `type.key` dan); topilmasa 4 variant bo'yicha `crm.searchContracts` (`/index`) fallback (qo'lda topiladigan shartnomani avto ham topsin — "CRM lookup parity"); hech biri → `found=false, lastError='Topilmadi'`.
- Bir martalik tuzatishlar: `recheckNotFoundOnce` (o'chirilgan shartnomalar fix'idan keyin barcha `found=false` ni eskirgan qilish), `recheckDeletedFallbackOnce` (boot'dan 20 s keyin: `status ∈ {"o'chirilgan (crm)", deleted}` qatorlarni `searchContracts` bilan qat'iy tekshirib, aniq mos bo'lmasa `found=false`).
- Cron `crmMetaBackfillTick` — `EVERY_MINUTE`: sotuv bo'limi (`branch_name`: recency → drenaj → bulk `/index`; `''` faqat ishonchli manba "bo'lim yo'q" desa) va turi (`property_type` `/show` sweep) backfill; boshqa: `refreshVirtualStatus`, `backfillOrderIds`, reverify (found=false larni qayta tekshirish). CRM'ga faqat o'qish.

#### B.10.4 Qo'lda tahrirlar va OplataKv'ga tarqalishi
- `setManual(txId, {categoryId, subcategoryId}, actorId, actorLabel?)` — `categorizedBy='manual'`; tarix; **subkategoriya o'zgarsa** `syncCategoryChangeToOplataKv`: yangi kategoriya CLIENT bo'lsa bog'langan `oplata_kv` qatorining `tx_type` = subkategoriya nomi, `first_installment/monthly_amount/payment_category = NULL`, **shu shartnomaning boshqa qatorlarida ham split reset** (split cron qayta hisoblaydi), history `edited`.
- `setContract(txId, contract)` — raqam tozalanadi (`№`, `N°`, bo'shliq, UPPER), CRM'da `forceRefresh` bilan tekshiriladi, **topilmasa 400**; `isContractManual=false`; tarix; `syncContractChangeToOplataKv`.
- `setContractManual(txId, contract)` — CRM tekshirmaydi (≤ 128 belgi), `isContractManual = !!contract`, tarix `action='contract'`, OplataKv tarqalishi, fonda `crmCache.lookup` (CRM'da yo'q bo'lsa baribir XATO hisoblanadi — "qo'lda kiritilgan bo'lsa ham").
- `syncContractChangeToOplataKv`:
  - yangi raqam `null` → bog'langan qator `contract_no='xato'`, `source_tx_id=NULL` (bog'lanish uziladi), split va obyekt NULL;
  - tx CLIENT emas (kod, nom `клиент/физ.л/юр.л`, yoki IMPORT `importCounterpartyText`) → skip;
  - qator topish: `source_tx_id IN (externalId, txId)`; topilmasa Excel-import qatorlari uchun fallback (a) eski raqam + Toshkent kuni + imzoli summa + `source_tx_id NULL` (aniq bitta), (b) faqat kun + summa (aniq bitta va CRM'da tasdiqlangan **emas** bo'lsa — commit B#7); topilgan qatorga `source_tx_id` yoziladi;
  - CRM mijoz/obyekt (kesh → DB → `forceRefresh`), obyekt nomi `oplata_kv_object_mappings` (`crmName → oplataName`) orqali;
  - qator to'liq qayta yoziladi: `contract_no`, `date` (Toshkent kuni, UTC yarim tun), `payment_amount` (imzoli), `purpose`, `tx_type` (subkategoriya yoki `Взносы за квартиры` / `Возврат взносов за кв.`), `client`, `object`, split NULL, `was_manually_edited=true`; history.
- `restoreSnapshot(txId, snap, actorLabel)` — TR Support "ortga qaytarish": kategoriya/subkategoriya/raqam/`isContractManual` aynan snapshot holatiga (CRM tekshiruvisiz) + ikkala tarqalish.
- `setCounterparty(txId, counterpartyId)` — `manualCounterpartyId` (INN avto-lookup ustidan), tarix `action='counterparty'`.
- Chaqiruvchilar: `correction.service` (XATO ariza tasdiqlanganda `setContractManual` + `setManual`), `tr-support.service` (`setManual`/`setContract`/`setContractManual`/`restoreSnapshot`), `oplata-kv.service` (`categorizeOne(force, forceRefresh)`, `setContractManual`), kategoriya agenti (`setManual`).
- Endpoint darajasida `ALOQA_BANK` qatorlari tahrirlanmaydi (`assertEditable`).

#### B.10.5 Ommaviy asboblar
- `runAll({onlyUncategorized=true, limit})` — fonda, lock; sharti `categoryId NULL OR contractNumber NULL` (deyarli butun tarix, 350 ming+), 500 lik cursor; `force` faqat `all=true`. Holat xotirada (`/run-all/status`), 5 daqiqadan keyin tozalanadi.
- `diagnoseCategorize({accountNos, dateFrom, dateTo, limit≤2000})` — faqat kategoriyasizlar; **haqiqatan yozadi**; har qatorga sabab ("shartnoma ajratildi, CRM'da topilmadi" yoki "obyekt kodi ro'yxatda yo'q bo'lishi mumkin").
- `recheckXatoContracts({dateFrom, dateTo})` — tx'lardagi noyob XATO raqamlar uchun `found=false` kesh o'chirilib qayta `lookup` (3 parallel, bekor qilish mumkin); kategoriya/raqamga tegmaydi; `getRecheckFixedList`.
- `refreshContractCache(contract)` — bitta raqam keshini o'chirib jonli lookup.
- `cleanupContractNumberSymbols` — `contract_number` dagi `№`/bo'shliqlarni tozalash (≤5000).
- `fixMinfinCategory({dateFrom='2026-05-01', dryRun=true, limit, clearUnmatched})` — faqat hozir MINFIN, sanadan keyingi, `categorizedBy != 'manual'`; `runRules(force, dryRun)`; natija **CLIENT bo'lsa yozilmaydi** (OplataKv'ga pul tushmasin), qoida topilmasa `clearUnmatched` bilan kategoriyasiz qilinadi.
- `reparseJunkContracts({dryRun=true, limit≤2000})` — raqami `JUNK_TAIL_LIST` bilan tugaydiganlar; izohdan qayta nomzodlar, keshda `found=true` bo'lgan birinchisi; bo'lmasa jonli lookup; tx `contract_number` va bog'liq `oplata_kv.contract_no` (topilmasa `'XATO'`) bir tranzaksiyada. **Ehtimoliy xato:** jonli bosqichda `if (live)` — `lookup` doim obyekt qaytargani uchun CRM'da topilmagan nomzod ham "tuzatildi" deb yozilishi mumkin (`live.found` tekshirilmaydi).
- `backfillSchotchik({dryRun=true, dateFrom (default `sync.minDate` yoki 2024-01-01), dateTo})` — izohida schotchik kalit so'zi bor **har qanday** tx (hozirgi kategoriyadan qat'i nazar) `CLIENT` + `CLIENT_SCHETCHIK` ga o'tkaziladi; bog'langan `oplata_kv.tx_type='За счетчик'`, split NULL va shu shartnomalarning boshqa qatorlarida split reset. Diqqat: kategoriya tekshirilmagani uchun nazariy jihatdan mijozga aloqasi yo'q to'lov ham CLIENT bo'lib qolishi mumkin.

#### B.10.6 Endpointlar (`/api/categorization`)

| Metod | Yo'l | Ruxsat |
|---|---|---|
| GET | `/categories` (2 darajali daraxt) | `categories:view` |
| POST | `/transactions/:id/categorize?force=` | `categories:manage` |
| POST | `/transactions/:id/set`, `/set-contract`, `/set-contract-manual`, `/set-counterparty` | `categories:manage` |
| GET | `/transactions/:id/history` | `categories:view` |
| POST | `/run-all?all&limit` / GET `/run-all/status` | `categories:manage` / `categories:view` |
| POST | `/diagnose`, `/fix-minfin`, `/reparse-junk-contracts`, `/backfill-schotchik` | `categories:manage` |
| POST | `/recheck-xato`, `/recheck-xato/cancel`, `/refresh-contract-cache`, `/cleanup-contract-symbols` | `categories:manage` |
| GET | `/recheck-xato/status`, `/recheck-xato/fixed` | `categories:view` |

Tarix jadvali `transaction_category_history`: `action` (`auto|manual|cron|sync|import|contract|counterparty`), `actor_*`, eski/yangi kategoriya id va nomlari, `contract_number`, `reason`.

### B.11 Kategoriya agenti — `backend/src/kategoriya-agent`

**Vazifa:** ilgari 4 ta alohida tugmani bitta oqimga yig'adi va qoidalarga tushmagan **chiqim** qoldig'ini AI'ga beradi. Faqat qo'lda ishga tushadi (cron yo'q; `trigger='cron'` maydoni ishlatilmaydi).

- Oqim (`oqim`), bosqichlar `qoidalar → schotchik → minfin → taminot → ai` (`BOSQICHLAR`):
  1. `qoidalar` — sana oralig'idagi kategoriyasizlarga `diagnoseCategorize` sahifama-sahifa (2000, ≤50 sahifa; ilgarilash to'xtasa chiqadi). `dryRun` da qoidalar umuman qo'llanmaydi (diagnose yozib yuboradi).
  2. `schotchik` — `backfillSchotchik` (kategoriyalash, "oylikka o'tkazish" emas).
  3. `minfin` — `fixMinfinCategory`.
  4. `taminot` — `TaminotService.matchTransactions` (faqat SELECT).
  5. `ai` — `direction='OUT'` va (a) kategoriyasiz, keyin (b) `COUNTERPARTY/COUNTERPARTY_RETURN` + `erp_article NULL`; CLIENT olinmaydi. Paket 25 ta (`KategoriyaAiService.PAKET`), ishonch ≥ 70 (`MIN_ISHONCH`) va kod mavjud bo'lsa `setManual(…, 'Kategoriya agenti')` + `erp_article`/`erp_object`; har qaror `kategoriya_agent_qarorlar` ga. Kunlik chegara `KATEGORIYA_AI_KUNLIK_CAP` (default 30 chaqiriq — Python agentlar bilan bir obuna), bir yurish ≤ `KATEGORIYA_AI_LIMIT` (5000), paketlar orasida `KATEGORIYA_AI_PAUZA_MS` (1500); rate-limit belgisi chiqsa darhol to'xtaydi, 3 ketma-ket xato → to'xtaydi.
- AI chaqiruvi: `claude --print` CLI (`CLAUDE_CMD`, token `ANTHROPIC_SETUP_TOKEN` → `CLAUDE_CODE_OAUTH_TOKEN`), model `KATEGORIYA_AI_MODEL` (default `sonnet`), timeout `KATEGORIYA_AI_TIMEOUT_MS`. Bilim fayli `agents/knowledge/kategoriya.md` (`KATEGORIYA_BILIM_YOL` bilan almashtiriladi).
- Yakunda `xulosa` matni (nima qilindi, qancha chiqim kategoriyasiz/moddasiz qoldi). Boot'da `running` qolgan yurishlar `error` qilinadi.
- **Endpointlar** (`/api/kategoriya-agent`): `GET holat`, `GET runs`, `GET runs/:id` (`categories:view`); `POST run` `{dateFrom (default 2026-05-01), dateTo, dryRun, rematch, aiYoq}`, `POST stop` (`categories:manage`).
- **DB:** `kategoriya_agent_runs` (`status`, `trigger`, `dry_run`, `stages` JSON, `ai_soralgan/qoyilgan/chaqiriq`…), `kategoriya_agent_qarorlar`.
- Diqqat: AI `CLIENT` kodini qaytarsa kod uni bloklamaydi (faqat bilim faylida taqiq).

### B.12 Kontragentlar — `backend/src/counterparties`

**Vazifa:** INN bo'yicha kontragent reestri (`counterparties`), boyitish DIDOX (asosiy) + Chamber (zaxira), xontaminot ERP'dan mirror sync.

- `fetchEnrichment(inn)`: DIDOX sozlangan bo'lsa (`DIDOX_BASE_URL`, `DIDOX_LOGIN_INN`, `DIDOX_LOGIN_PASSWORD`, `DIDOX_PARTNER_AUTH`; token 5 soat kesh) `GET /v1/ihamkor/companies/{inn}` + oxirgi hujjatdan bank rekviziti; Chamber har doim (`CHAMBER_BASE_URL`, `/Soliq/GetCompanyCriteries/{inn}`, auth'siz); ikkalasi ham yo'q → 404.
- `mapToRecord` — nom, direktor, telefon, manzil, VAT, OKED, reyting, bank hisoblari (eski+yangi birlashadi), founders, `rawDidoxBrief`.
- Standart INN = 9 yoki 14 raqam (`isStandardInn`); nostandart → `isManual=true`, avto-yangilanmaydi. Yaratishda kiritilgan `name` refresh'da o'zgarmaydi.
- **Cron'lar** (`counterparties.cron.ts`, Asia/Tashkent): `0 8-22 * * *` — `counterparties.autoRefreshEnabled` yoqilgan bo'lsa `refreshAll` (fonda); `*/5 * * * *` — `shouldRunXontaminotCron` (sozlamadagi interval/soat oralig'i) bo'lsa `syncFromXontaminot`.
- Auto-refresh o'chiq bo'lsa bitta qatorni `refresh` qilish ham bloklanadi.
- **Xontaminot mirror** (`xontaminot.service.ts`, env `XONTAMINOT_DATABASE_URL`, `pg` pool, faqat SELECT `public.taminotchilar` `status='active'` va INN bo'sh emas): yaratish/yangilash `addedBy='__xontaminot__'`; manbada yo'qolganlari o'chiriladi, lekin `manual_counterparty` sifatida tx'ga bog'langan bo'lsa saqlanadi.
- **Setting kalitlari:** `counterparties.autoRefreshEnabled`, `counterparties.activityLog` (≤1000), `counterparties.xontaminot.autoSync`, `.intervalMin` (60), `.startHour` (8), `.endHour` (22), `.lastSyncAt`, `.lastSyncStats`.
- **Endpointlar** (`/api/counterparties`, `counterparties:view` / `counterparties:manage`): `GET /`, `GET export`, `GET _settings`, `GET _activity-log`, `POST _settings/auto-refresh`, `POST _truncate` (parol env `ADMIN_ACTION_PASSWORD` bilan, butun reestr va tarixni o'chiradi), `GET/POST _xontaminot/settings`, `GET _xontaminot/test`, `GET _xontaminot/status`, `POST _xontaminot/sync`, `GET :inn`, `GET :inn/history`, `POST /`, `POST :inn/refresh`, `PATCH :inn`, `DELETE :inn`, `POST import` (Excel), `POST refresh-all`, `GET refresh-all/status`. `_…` marshrutlari `:inn` dan oldin e'lon qilingan (shart).
- **DB:** `counterparties` (`inn` unique, `is_manual`, `last_fetch_error`, `bank_accounts` JSON…), `counterparty_history`. Tranzaksiya ro'yxatida COUNTERPARTY kategoriyali qator nomi `counterparties.name` (INN) dan.

### B.13 Ta'minot ERP moslash — `backend/src/taminot`

**Vazifa:** bank tranzaksiyasini xontaminot ERP `public.tulovlar` qatoriga bog'lab, yetkazib beruvchi, xarajat moddasi, shartnoma va obyektni `transactions.erp_*` ustunlariga yozish. **ERP bazasiga faqat SELECT** (env `TAMINOT_DATABASE_URL`, `pg` pool `max:3`; kontragentlar modulidagi `XONTAMINOT_DATABASE_URL` dan alohida o'zgaruvchi). `contract_number`/`category_id` ga yozilmaydi (aks holda CRM tekshiruvi buzilib qator XATO bo'ladi).

- `matchTransactions({dateFrom='2026-05-01', dateTo, dryRun=true, rematch=false, limit≤100000})`:
  - Bizning tx: sana oralig'i, `rematch=false` bo'lsa `erp_payment_id NULL`, **CLIENT chetlab o'tiladi**; yo'nalish bo'yicha filtr **yo'q** (OUT filtri qo'yib ko'rilganda mosliklar 0 ga tushgan, sababi aniqlanmagan — 2026-10-05).
  - ERP to'lovlari `tulov_sanasi >= dateFrom − 3 kun`; summa `round(coalesce(executed_amount, summa))`; yetkazib beruvchi/kategoriya/obyekt nomi `to_jsonb` orqali (`nomi|name|title`), `legacy_meta->>'dogNo'`, `legacy_meta->>'rawPayee'`. Sana `to_char` bilan matn (pg Date obyekti buzuq satr bergan, ±2 kun cheklovi jim ishlamay qolgan).
  - Normallashtirish: `coarse` (OOO/MCHJ… olib tashlash + kirill→lotin + SH→S, CH→C, X→H, Q→K…), `normTok`, `dogToken` (`ОТ` dan oldingi qism, transliteratsiyadan keyin `\bOT\b` — kirillda `\b` ishlamagani tuzatilgan; ≥ 4 belgi), `sanaOt` (shartnoma sanasi), `descTokens` (izohdagi `№…`).
  - **Majburiyatlar:** shartnoma tokeni + shartnoma sanasi kesimida ERP jami (730 kunlik tarix); "band" summa — allaqachon bog'langan tx'lar; **summa shifti** `band + summa ≤ jami + max(1%, 10 000)`.
  - Bosqichlar: (1) summa aniq teng + sana farqi ≤ 2 kun (`MAX_DAY`) + (shartnoma tokeni yoki yetkazib beruvchi nomi ikki tomonlama `includes`, ikkalasi ≥ 8 belgi — bank nomni kesib saqlaydi); turli yetkazib beruvchiga teng nomzodlar → noaniq; (2) summa teng emas, lekin shartnoma tokeni + sana ≤ 2 kun va barcha nomzodlar bir xil modda/obyekt/yetkazib beruvchi → summa darvozasi; (3) bitta majburiyat bir necha bo'lakda: token + shartnoma sanasi (izohda bo'lsa aniq mos; bo'lmasa token bitta sanaga tegishli bo'lishi shart), yetkazib beruvchi nomi mos, to'lov shartnomadan −5…+730 kun ichida → summa darvozasi (`shiftShart`).
  - Yozuv: `erp_payment_id`, `erp_supplier`, `erp_article`, `erp_contract`, `erp_object`, `erp_matched_at`. `rematch` da mos kelmay qolgan eski bog'lanish tozalanadi. Natijada `reasons`, `nearMiss`, `nomFarqi`, `shiftOshdi`, `samples`.
- **Cron** `taminot-match`: `TAMINOT_MATCH_CRON` yoki `0 0 8,14,20 * * *` (Asia/Tashkent), oxirgi 45 kun, `rematch=false`; o'chirish `TAMINOT_MATCH_CRON_ENABLED=0`; URL sozlanmagan bo'lsa jim o'tadi.
- **Endpointlar** (`/api/taminot`): `GET ping`, `GET cron` (`categories:view`); `POST cron/run`, `POST match` (`categories:manage`, dryRun default).

### B.14 Eski billing — `backend/src/payments`, `customers`, `contracts`

Deyarli ishlatilmaydi; asosiy mijoz to'lovlari hisobi OplataKv modulida.
- `customers` (INN unique), `contracts` + `contract_stages` (`PENDING|PARTIAL|PAID|OVERDUE`), `payments` (`transaction_id`, `contract_id`, `stage_id`, `amount`, `source AUTO|MANUAL`).
- `PaymentsService.autoMatch(txId)` — sync har yangi `IN` + `inn_dt` qatorida chaqiradi: `fromInn` bo'yicha customer, uning ochiq bosqichlariga FIFO (`dueDate`) taqsimlash; `transactions.match_status` (`UNMATCHED|AUTO|MANUAL|PARTIAL|IGNORED`), `customer_id`; `recalcStage/recalcContract`.
- `linkManual`, `unlink`, `ignore`.
- **Endpointlar:** `GET /api/payments` (`payments:view`), `POST /api/payments/auto-match/:transactionId`, `POST /api/payments/link`, `DELETE /api/payments/link/:transactionId`, `POST /api/payments/ignore/:transactionId` (`payments:manage`); `/api/customers` va `/api/contracts` CRUD (`customers:view|manage`, `contracts:view|manage`).
- Tx o'chirilganda `payments` qatorlari arxivsiz o'chadi.

---

### B.15 Env o'zgaruvchilar (faqat nomlari)

| Nom | Modul | Ma'nosi |
|---|---|---|
| `CRED_ENC_KEY` | crypto | bank parol shifrlash kaliti |
| `TXN_SYNC_CRON`, `TXN_SYNC_DAYS_BACK` | sync | tick jadvali, kunlik sync oynasi (10) |
| `KAPITALBANK_API_URL`, `KAPITALBANK_TIMEOUT_MS` | integrations | Kapital URL seed, timeout |
| `HAMKORBANK_TIMEOUT_MS`, `HAMKORBANK_STATEMENT_TIMEOUT_MS` | integrations | Hamkor timeoutlari |
| `BANK_FORWARDER_URL`, `BANK_FORWARDER_SECRET`, `BANK_PROXY_URL` | integrations | forwarder (DB setting ustun) va HTTPS proxy |
| `SVERKA_NOTIFY_CRON`, `SVERKA_BOT_TOKEN`, `ADMIN_ACTION_PASSWORD` | sverka-telegram, counterparties | cron, bot token zaxirasi, admin amal paroli |
| `ANTHROPIC_API_KEY` | sverka-agent | AI kalit zaxirasi (asosiy Setting `agent.aiKey`) |
| `ANTHROPIC_SETUP_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CMD`, `KATEGORIYA_AI_*`, `KATEGORIYA_BILIM_YOL` | kategoriya-agent | CLI orqali AI |
| `TAMINOT_DATABASE_URL`, `TAMINOT_MATCH_CRON`, `TAMINOT_MATCH_CRON_ENABLED` | taminot | ERP o'qish ulanishi va cron |
| `XONTAMINOT_DATABASE_URL` | counterparties | xontaminot mirror |
| `DIDOX_BASE_URL`, `DIDOX_LOGIN_INN`, `DIDOX_LOGIN_PASSWORD`, `DIDOX_PARTNER_AUTH`, `CHAMBER_BASE_URL` | counterparties | boyitish manbalari |

### B.16 Muhim tuzoqlar va tarixiy xatolar (yig'ma)

- **Toshkent kuni:** saqlash UTC; hisob-kitobda `tashkentKun()` yoki `+05:00` chegaralar. Kodda hali ham server-lokal yoki UTC chegaralar ishlatiladigan joylar: `detectChanges` (`setHours`), `applyMovedChange` (vaqtsiz yarim tun), `statement.service::fmtDate`, `inspector::fmtDdate`, `reconcile` (`withSync` sanalari, `dailyBreakdown`, `diagnoseDay` qo'shni kun yorliqlari), `sverkaCounterparty/sverkaContract`, `getRowsForExport`, `importExcel::parseDate`. Server TZ repo'da belgilanmagan (aniq emas); reconcile izohi server UTC ekanini ko'rsatadi.
- **Ko'chgan to'lov soxta o'chirilishi** (2026-08-25 gacha, commit 3c0684f / c83d315): endi ±3 kun tekshiruv + MOVED + `recoverFalselyDeleted`/`restore-one`. Hamkor externalId'da vaqt bo'lgani uchun `verifyExternalInBank` sanani o'qiy olmaydi (`no_data`) — Hamkor DELETED loglarini tiklash `force` talab qiladi.
- **Sana ko'chganda OplataKv dublikati** (2026-09-24 gacha, commit 2043be4): `upsertOne` date-shift va `reconcile::relinkOplataKv` ikkalasi ham `source_tx_id` ni ko'chiradi; bittasini o'zgartirsangiz ikkinchisini ham.
- **`upsertOne` OR sharti:** `{ externalId: item.b2_id || undefined }` va `{ bankB2Id: item.b2_id || undefined }` — `b2_id` bo'sh bo'lsa Prisma ularni bo'sh shart (`{}`) deb, hisobdagi **ixtiyoriy** qatorga mos kelishi mumkin va u qator "date-shift" sifatida boshqa to'lov ID/sanasi bilan ustidan yozilishi mumkin (tekshirilmagan; Kapital odatda `b2_id` beradi).
- **Status:** faqat `state=3` COMPLETED (commit B#11); `stats`/`daily`/reconcile status bo'yicha filtrlamaydi.
- **Hamkor:** `pageSize ≤ 20` (`-802`), `-5` bo'sh kun, `state` hardcode 3, settlement kuni to'lovlar "shishishi" xato emas, `capi-lab` endpoint prod'da qolmasin, becfil-exclusion kunlik sync'ni sindirgani uchun o'chirilgan.
- **Sverka faqat Kapital/Ipak;** vipiska faqat Kapital; inspector Kapital+Hamkor; credential testi Kapital+Hamkor (Ipak yo'q).
- **Login xatolari** `PARTIAL` + bo'sh `error_message` — `auth-issues` va monitoring ularni sezmasligi mumkin.
- **Uzoq Hamkor so'rovlari** (25 daqiqagacha) `tick` ichida ketma-ket ishlaydi; keyingi tick'lar parallel boshlanadi (band hisob skip) — overlap to'plami mumkin.
- **NDS/Minfin** (2026-09-18, 21 863 qator) — MINFIN faqat byudjet nomi/kodi bilan; `fixMinfinCategory` qo'lda tuzatilganlarga va 2026-05-01 dan oldingilarga tegmaydi.
- **"сонли" yutilishi** (2026-10-10) — `stripFillers` + `isJunkTail`; eskilar `reparseJunkContracts`.
- **CRM kesh:** `lookup` doim obyekt qaytaradi — `found` ni tekshiring; `found=false` 4 soat, `found=true` 24 soat yashaydi; soxta "o'chirilgan (crm)" qatorlar boot'da bir marta qayta tekshiriladi.
- **Ta'minot raqamini `contract_number` ga yozmang** — faqat `erp_contract`.
- **Marshrut tartibi:** `GET /transactions/time-diagnostics` `GET /transactions/:id` dan keyin e'lon qilingan (ehtimoliy soya). Statik yo'llar `:id`/`:inn` dan oldin bo'lishi kerak.
- **Qaytarib bo'lmaydigan amallar:** `cleanup-by-account` (faqat qatorma-qator tiklash), `deleteBatch` (tx snapshot arxivlanmaydi), `counterparties/_truncate`, `payments` o'chirilishi.
- Agentlar (`agents/`) `SyncService.*`, `testConnection`, `bank-pwd`, `ReconcileService`, `/reconcile/today` ni chaqirmasligi kerak: ular tashqi bank so'rovi, Telegram va DB yozuvi qiladi.

### B.17 "X ni o'zgartirsang, Y ta'sirlanadi"

| O'zgarish | Ta'sir |
|---|---|
| `makeCompositeId` formati yoki prefiks | `external_id`, `oplata_kv.id/source_tx_id`, `detectChanges` kaliti, `parseId`, `replaceCompositeDate`, `hamkorDedupKeyFromExisting` — to'lovlar qayta qo'shiladi |
| Hamkor `normalizeItem` (`ddate`) | barcha Hamkor ID'lari va `hbDedupKey` — OplataKv bog'lanishi uziladi |
| `upsertOne` date-shift | `reconcile::relinkOplataKv` bilan juft; OplataKv dublikati |
| `detectChanges` (`VERIFY_DAYS`, `MAX_CANDIDATES`) | DELETED → `cascadeOplataKvDelete` OplataKv qatorini o'chiradi |
| `runRules` | `OplataKvService.syncFromTransactions` (CLIENT + raqam), XATO ro'yxatlari, kategoriya agenti |
| `OBJECT_CODES` / `CONTRACT_RE` | qaysi to'lov CLIENT bo'lishi, CRM lookup soni, XATO |
| `setContract*` / `setManual` | `syncContractChangeToOplataKv` / `syncCategoryChangeToOplataKv` — OplataKv qatori qayta yoziladi, split reset |
| `crm-contract-cache` TTL/variantlar | XATO statusi, CRM yuklamasi, OplataKv mijoz/obyekt |
| `reconcile` | `reconcileToday`, sverka agenti, Telegram cron, dashboard |
| `fetchDoc1C(apiKind)` | faqat Hamkor yangi klientga; Kapital/Ipak eski klient — ularga tegmang |
| `sync.minDate` | sync, backfill, manualCheckChanges, backfillSchotchik |

### B.18 Tez topish — qayerda nima

| Vazifa | Fayl va funksiya |
|---|---|
| Yangi bank turi | `sync.service.ts::fetchDoc1C`, `tick` (apiKind ro'yxati), `banks.service.ts::DEFAULT_BANKS`, `bank.dto.ts` enum, `inspector.service.ts::fetchDoc1C` |
| Hamkor maydonlari | `hamkorbank.client.ts::normalizeItem` |
| O'chgan/ko'chgan qoida | `sync.service.ts::detectChanges`, `applyMovedChange`, `applyDeletedChange` |
| Noto'g'ri o'chganni tiklash | `sync.service.ts::restoreOneDeleted`, `recoverFalselyDeleted`, `transactions.service.ts::restoreChangeLog` |
| Soxta sverka farqi | `reconcile.service.ts::reconcile`, `fmtDate`, `reconcileToday` |
| Kategoriya qoidasi | `categorization.service.ts::runRules` va kalit so'z konstantalari |
| Yangi obyekt kodi | `contract-parser.ts::OBJECT_CODES` |
| Ro'yxat filtri | `transactions.service.ts::buildWhere`, `applyContractStatusFilters` |
| Ta'minot mezoni | `taminot.service.ts::matchTransactions` |
| Hamkor vipiska formati | `import.service.ts::parseHamkorVipiska`, `previewHamkorVipiska` |
| Telegram digest matni | `sverka-telegram/digest.ts::renderDigest`, `sverka-telegram.service.ts::handleCallback` |

## C. OplatyKv, CRM va eksportlar

Bu bo'lim loyihaning "kvartira to'lovlari" yadrosini qamraydi: `oplata_kv` jadvali (UI nomi "ОплатыКв"), XonSaroy CRM bilan faqat o'qish integratsiyasi, CRM sverka, XonPay (Billing), Google Sheets eksporti, SHMITD, Vznos reestri va tranzaksiya fayllari (ariza). Barcha yo'llar `backend/src/` ga nisbatan. HTTP yo'llarga global prefiks `/api` qo'shiladi (`main.ts::setGlobalPrefix('api')`).

Ruxsat qoidasi (hamma bo'limga tegishli): `PermissionsGuard` `@RequirePermissions(A, B, ...)` dagi ruxsatlardan **kamida bittasi** bo'lsa o'tkazadi (OR mantiq, AND emas). `oplatakv:manage` (`OPLATAKV_MANAGE`) "legacy (deprecated)" deb belgilangan va rol daraxtida (UI tanlovida) ko'rinmaydi: uni amalda faqat SUPERADMIN (`ALL_PERMISSIONS`) yoki eski rollar oladi. `oplatakv:import` (`OPLATAKV_IMPORT`) e'lon qilingan, lekin hech bir endpoint uni talab qilmaydi.

### C.0 Umumiy xarita

| Modul | Papka | Asosiy jadval(lar) | Tashqi tizim | Cron |
|---|---|---|---|---|
| OplatyKv | `oplata-kv/` | `oplata_kv`, `oplata_kv_history`, `perereboska_group`, `oplata_kv_object_mappings`, `import_batches` | CRM (o'qish), Claude API (vision), Telegram, bank API (memorial, o'qish) | `autoSyncTick`, `schotchikAutoTick` (+clamp), `crmStatusBackfillTick` — hammasi har daqiqa |
| CRM klient | `crm/` | `crm_contracts` (kesh, aslida `categorization/crm-contract-cache.service.ts` yozadi) | XonSaroy CRM REST + XonSaroy MySQL (ixtiyoriy) | `crmMetaBackfillTick` (kesh servisida, har daqiqa) |
| CRM sverka | `crm-sverka/` | `settings` (`crmSverka.*`) | CRM `/payment-history/excel` | `crmSverkaAutoRefresh` (env bilan, default 07,12,17 Toshkent) |
| XonPay | `xonpay/` | `xonpay_transactions`, `xonpay_sync_logs` | CRM `/payment-history/excel` | `xonpay-auto-sync` (dinamik, SchedulerRegistry) |
| Google eksport | `google-export/` | `export_cron_logs`, `settings` (`export.*`, `autsourcing.*`) | Google Sheets API, Telegram | `exportSheetsCronTick`, `autsourcingCronTick` (har daqiqa) |
| SHMITD | `shmitd/` | `shmitd_logs`, `settings` (`shmitd.*`) | Google Sheets (readonly), Telegram | `cronTick` (har daqiqa) |
| Vznos | `vznos/` | `vznos_contract`, `oplata_kv`, `transactions.xato_hidden` | CRM (o'qish) | yo'q |
| Attachments | `attachments/` | `transaction_attachments`, `transaction_category_history` | Telegram | yo'q |
| Customers/Contracts | `customers/`, `contracts/` | `customers`, `contracts`, `contract_stages`, `payments` | yo'q | yo'q (OplatyKv bilan bog'liq emas) |

Asosiy oqim: bank tranzaksiyasi (`transactions`, CLIENT kategoriya, `contract_number` bor) → `syncFromTransactions` → `oplata_kv` qatori → fon ishi (obyekt/mijoz to'ldirish, mijoz ismini CRM egasiga tuzatish, split) → dashboard, obyekt hisoboti, kunlik xulosa, `/api/v1` delta-feed, Google Sheets eksport, CRM sverka.

---

### C.1 OplatyKv moduli (`oplata-kv/`)

#### C.1.1 Fayllar

| Fayl | Rol |
|---|---|
| `oplata-kv.module.ts` | `CrmModule`, `CategorizationModule`, `SyncModule`, `HttpModule` (timeout 30 s) import qiladi; `OplataKvService` eksport qilinadi (universal API, google-export, agent, correction-bot, tr-support, chek-order ishlatadi) |
| `oplata-kv.controller.ts` | `/api/oplata-kv/*` (830 qator, ~60 endpoint) |
| `oplata-kv.service.ts` | hamma biznes mantiq (~6500 qator) |
| `installment-split.ts` (+ `.spec.ts`) | sof split funksiyalari: `buildSchedule`, `allocatePayment`, `categoryOf`, `allocateRefundNoSchedule` |
| `perereboska-amounts.ts` | AI perereboska summasini dasturiy tekshirish: `parseAmountWords`, `classifyRoleFromQuote`, `extractAmountsFromText`, `translitName`, `namesMatch`, `decideTransferAmount` |
| `memorial-order/memorial-order.service.ts` | Memorial order PDF/XLSX (`generatePdf`, `generateXlsx`, `buildBlocks`, `fillFromBank`) |
| `memorial-order/mfo-banks.ts` | MFO kodi → bank nomi (faqat 2 ta Kapitalbank MFO; topilmasa bo'sh) |
| `memorial-order/ru-words.ts` | `amountToWordsRu` (summani rus tilida so'z bilan) |
| `dto/oplata-kv.dto.ts` | `CreateOplataKvDto`, `UpdateOplataKvDto`, `ListOplataKvDto` |
| `oplata-kv.sync-xato.spec.ts` | sync'da yozilmagan to'lovlar (2026-10-07 hodisasi) testi |
| `oplata-kv.xato-manual.spec.ts` | qo'lda/ariza shartnoma XATO qoidasi testi |

Frontend: `frontend/app/[locale]/(panel)/oplatykv/page.tsx`, `layout.tsx`, `oplatykv/crm/page.tsx` (CRM qidiruv tabi), `oplatykv/billing/page.tsx` (XonPay), `oplatykv/xato-crm/page.tsx` (XATO → CRM). Komponentlar: `ai-perereboska-module.tsx`, `plan-viewer-dialog.tsx`, `daily-summary-widget.tsx`.

#### C.1.2 Ma'lumot modeli

`OplataKv` (`oplata_kv`) asosiy ustunlari:

| Prisma maydon | SQL | Tur | Izoh |
|---|---|---|---|
| `id` | `id` | string | tx-manbada = `transactions.external_id` (bo'lsa), aks holda UUID; qo'lda/import'da cuid yoki Excel'dagi ID |
| `contractNo` | `contract_no` | VarChar(50) | "Дог №" |
| `date` | `date` | `@db.Date` | vaqtsiz; Toshkent kalendari kuni (`toTashkentDateOnly`) |
| `paymentAmount` | `payment_amount` | Decimal(15,2) | so'm, ishorali: `+` to'lov, `-` qaytarish yoki perereboska manbai |
| `firstInstallment` / `monthlyAmount` | `first_installment` / `monthly_amount` | Decimal | boshlang'ich ("1 взнос") va oylik ("ежемесячный") ulushi |
| `paymentCategory` | `payment_category` | enum `MONTHLY`, `FIRST`, `GENERAL` | "Оплата" ustuni; `GENERAL` = "Общий" (schetchik) |
| `txType` | `tx_type` | VarChar(60) | tranzaksiya subkategoriyasi nomi ("Взносы за квартиры", "Возврат взносов за кв.", "За счетчик", "Переброска", "Взнос от имени клиента") |
| `purpose`, `note`, `object`, `client`, `paymentMethod` | | | izoh, obyekt (mapping qo'llangan), mijoz, to'lov usuli |
| `sourceTxId` | `source_tx_id` | VarChar(255), **unique** | dedup kaliti: `transactions.external_id` yoki `transactions.id` |
| `importBatchId` | `import_batch_id` | | Excel import partiyasi |
| `perereboskaGroupId`, `perereboskaFile*` | | | perereboska guruhi; fayl faqat manba qatorda |
| `wasManuallyEdited` | | bool | `manualSplit` qo'yadi |
| `agentNotifiedAt` | | | XATO notifikator uchun; hozirgi kodda hech kim yozmaydi (`markAgentNotified` chaqirilmaydi) |
| `createdAt` / `updatedAt` | | | `updatedAt` = Prisma `@updatedAt` (app soati); `@@index([updatedAt, id])` delta-feed uchun |

Manba turi (`sources` filtri): `transaction` = `sourceTxId` bor; `excel` = `sourceTxId` yo'q va `importBatchId` bor; `manual` = ikkalasi ham yo'q (qo'lda qator va perereboska qatorlari shu yerga tushadi).

Boshqa modellar: `OplataKvHistory` (`oplata_kv_history`: `action` = `created` | `edited` | `deleted` | `imported`, amalda `bulkSetCategory` `updated` ham yozadi; `changes` JSON; FK yo'q, qator o'chsa ham tarix qoladi), `PerereboskaGroup` (`perereboska_group`), `OplataKvObjectMapping` (`crm_name` unique → `oplata_name`), `ImportBatch` (`kind='oplata-kv'`), `ContractSchedule` (`contract_schedules`, dormant).

#### C.1.3 Cron jobs (hammasi `@Cron(EVERY_MINUTE)`, servis ichida)

| Metod | Nima qiladi |
|---|---|
| `autoSyncTick` | Toshkent vaqti = UTC+5 (qo'lda hisoblanadi). **Kunduz** (`oplatykv.dayStart`..`oplatykv.dayEnd`, default 08:00-22:00, oxiri kirmaydi): har `oplatykv.txAutoSyncMinutes` daqiqada `syncFromTransactions({minDate: oplatykv.txMinDate, limit: 1000})`, actor `cron · day`. Interval 0 yoki bo'sh bo'lsa kunduzgi rejim o'chiq. **Tun** (`oplatykv.nightStart`..`oplatykv.nightEnd`, default 01:00-07:50): kuniga 1 marta limitsiz to'liq sync, actor `cron · night-batch`. Tungi batch intervalga qaramaydi, ya'ni interval 0 bo'lsa ham tunda ishlaydi. Avto-XATO o'chirish ataylab olib tashlangan (egasi: "to'lovlar o'chmasin"); `oplatykv.autoXatoCleanup` sozlamasi saqlanadi, lekin tick uni o'qimaydi |
| `schotchikAutoTick` | Avval har safar `clampFutureUpdatedAt()` (kelajakdagi `updated_at` ni app soatiga tushiradi). Keyin `schotchik.auto='1'` va `schotchik.dayStart`..`schotchik.dayEnd` (default 08:00-22:00) oynasida har `schotchik.intervalMin` (default 30, 1..1440) daqiqada `schotchikToMonthly({dateFrom: schotchik.dateFrom, dryRun:false})`, actor `cron · schotchik` |
| `crmStatusBackfillTick` | Running lock bilan; `crm_contracts` dan `found=true, virtual_status IS NULL` 200 tasini olib, 8 tadan parallel `crmCache.refreshVirtualStatus()` chaqiradi. Konvergent: tekshirilgach qiymat yoki '' bo'ladi va qayta olinmaydi |

Vaqt holati xotirada: `lastAutoSyncAt`, `lastNightBatchDay` (oy kuni raqami), `lastSchotchikAt`. Restart tun oynasi ichida bo'lsa tungi batch shu kecha yana ishlaydi. Oyna yarim tundan o'tmaydi (`isInRange`: start <= now < end; start > end bo'lsa hech qachon true emas).

#### C.1.4 `syncFromTransactions` (tranzaksiya → OplatyKv)

Chaqiruvchilar: `autoSyncTick`, `POST sync-now` (`syncNowRespectingSettings`: `oplatykv.txMinDate` bilan, limitsiz), `POST sync-from-transactions` (qo'lda `minDate`).

1. Tanlov: `transactions` da `category.code='CLIENT'`, `contract_number IS NOT NULL`, ikkala yo'nalish (IN = to'lov, OUT = qaytarish). Controller tavsifidagi "CLIENT/IN" eskirgan. `minDate` berilsa `txn_date > minDate 18:59:59.999 UTC` (= Toshkent kuni oxiri; o'sha kunning o'zi kirmaydi). Tartib `txn_date desc`, `take: limit` (kunduz 1000 → eng yangi 1000 ta).
2. XATO shartnomali tranzaksiyalar ham qo'shiladi (keyin tuzatilsa update bo'ladi).
3. Bir martalik so'rovlar: `crm_contracts` (`customerName`, `objectName`) va `oplata_kv_object_mappings` (kalit `trim().toLowerCase()`).
4. Har tx uchun: summa `|amount|`, OUT bo'lsa manfiy; `id = externalId || randomUUID()`; dedup kaliti `sourceTxId = externalId || tx.id`; `txType = subcategory.name` yoki default ("Взносы за квартиры" / "Возврат взносов за кв."); `client` = CRM egasi yoki tx tarafi (IN: `fromName`, OUT: `toName`), 255 belgigacha kesiladi; `object` = mapping qo'llangan CRM obyekt nomi; `date = toTashkentDateOnly(txnDate)`.
5. Mavjud qator (sourceTxId bo'yicha): summa, shartnoma, sana yoki `txType` o'zgargan bo'lsa update + history `edited` (note "Tranzaksiyadan yangilandi"). `client` faqat CRM egasi bo'lsa yangilanadi (agregator nomiga tushirmaslik). Split ustunlari update'ga kirmaydi.
6. Yangi qator: avval `syncQatorSababi` (shartnoma >50, `txType` >60, `sourceTxId` >255 belgi) bo'lsa yozilmaydi va `yozilmadi` ro'yxatiga sabab bilan tushadi.
7. `createMany` 500 lik bo'laklarda `skipDuplicates`. Agar `count < chunk.length` bo'lsa, jim tashlangan (ID band) qatorlar aniqlanib `yozilmadi` ga "shu ID bilan boshqa qator bor" deb yoziladi. Bo'lak umuman yiqilsa qatorma-qator `create`, har xato `syncXatoSababi` (P2000 = juda uzun, P2002 = unique) bilan.
8. History `created` faqat haqiqatan yozilganlar uchun (`createMany`). Update'lar 10 tadan parallel.
9. `syncXatolariniSaqla`: `settings['oplatykv.syncXatolar']` ga JSON `{vaqt, actor, soni, namunalar[≤20]}`; xato bo'lmasa kalit `null` ga tozalanadi. Bot (Checker `oplatykv_sync`) shu kalitni o'qiydi.
10. Sinxron `cleanupSplitsForXatoContracts()`, keyin fon ishi (C.1.5). Javob: `version: 'v8-bg-poll'`, `total/added/updated/skipped/skippedBreakdown/errorSamples/yozilmadi/xatoQuickClean/duration/syncDuration/minDate`.
11. Yangi tx bo'lmasa ham XATO tozalash + fon ishi (fill 20000, split 20000; mijoz ismini tuzatish bu tarmoqda yo'q).

Muhim: mavjud qatorda `contractNo` va `txType` har sync'da tranzaksiyadagi qiymatga qaytariladi. Shu sabab Vznos qo'ygan `Взнос от имени клиента` yoki Vznos `cancel` qo'ygan yangi shartnoma keyingi sync'da qaytib ketishi mumkin (agar tranzaksiya subkategoriyasi/shartnomasi boshqa bo'lsa). Kunduz faqat oxirgi 1000 tx, tunda hammasi.

`addOneFromTransaction(txRef)` (`POST add-from-tx`): bitta tx'ni `id` yoki `externalId` bo'yicha topadi, `minDate` ga qaramaydi, idempotent (`sourceTxId` bo'yicha bor bo'lsa `exists`). Shartlar: CLIENT va shartnoma bor. CRM keshdan mijoz/obyekt (bu yerda object mapping qo'llanmaydi), qatorni yaratadi va shu shartnoma bo'yicha `splitInstallments` (best-effort). Statuslar: `added`, `exists`, `not_found`, `no_contract`, `not_client`.

#### C.1.5 Fon ishi va `bg-status`

Statik flaglar: `fillingInProgress` (bir vaqtda bitta fon ishi), `bgStartedAt`, `bgPhase` (`fill` → `split` → `done` | `error`), `bgResult`. Sync'dan keyin `setImmediate` ichida: `fillMissingObjects({limit: 3000})` → `fixClientNamesFromCrm({maxLive: 400})` → `splitInstallments({limit: 3000})`. Limitlar ataylab kichik (DB pool, 502 dan saqlanish). Frontend modal `GET bg-status` ni poll qiladi. Holat xotirada, restartda yo'qoladi.

- `fillMissingObjects` (`POST fill-objects`): `sourceTxId` bor va `object` yoki `client` NULL qatorlar (limit default 5000, max 20000). Avval keshdan bir so'rov, kesh to'liq bo'lmasa jonli `crmService.show` (25 parallel). Obyekt nomiga mapping qo'llanadi. `updateMany`, history yozilmaydi.
- `fixClientNamesFromCrm` (`POST fix-client-names`): barcha tx-manba qatorlarni `id` kursori bilan 2000 tadan aylanadi; `client` ≠ CRM egasi bo'lsa CRM ismiga almashtiradi (to'lov agregatori nomi o'rniga). Keshda ism yo'q, lekin `found=true` shartnomalar uchun jonli `/show` (20 parallel, `maxLive` default 1500) va natija `crm_contracts.customer_name` ga upsert. History yozilmaydi.

#### C.1.6 Obyekt nomi mapping

- `OplataKvObjectMapping`: CRM nomi → OplatyKv nomi (masalan uzun CRM nomi → qisqa ruscha nom). Mapping bo'lmasa xom CRM nomi yoziladi.
- Qo'llanadigan joylar: `syncFromTransactions`, `fillMissingObjects`, `crmLookupForForm` (perereboska, forma), `obyektNomi()` (bot biriktirish, `reverifyXato`). Izoh: ilgari faqat sync'da qo'llanardi, bir obyekt hisobotda ikki nom bilan chiqardi; `obyektNomi` shuni tuzatgan. `addOneFromTransaction` hali mappingsiz.
- Endpointlar: `GET object-mappings` (view), `POST object-mappings` `{crmName, oplataName}` va `DELETE object-mappings/:id` (manage). Dublikat `crmName` → 400. Mapping o'zgarsa eski qatorlar avtomatik qayta yozilmaydi.

#### C.1.7 XATO ta'rifi va XATO bilan ishlash

XATO = tranzaksiyadan kelgan to'lov, shartnomasi CRM'da tasdiqlanmagan. Kodda **ikki** xil, biroz farqli ta'rif bor:

| | `buildXatoFilter()` (SQL filtr) | `computeContractXato()` (qator belgisi) |
|---|---|---|
| Ishlatadi | `list?xatoOnly`, eksport `xatoOnly`, `bulkCrmFix('xato')`, `reverifyXato`, `getXatoListForAgent`, `findXatoRows`, `findXatoRowForTx`, `countXatoForAgent` | `list` dagi `crmXato` va `contractSource`, Excel eksport ("XATO" yozuvi), `getRowsForExport` (Sheets), `findByContract` (Akt sverka XATO'ni chiqarib tashlaydi) |
| Shart | `sourceTxId IS NOT NULL` va `contractNo NOT IN (crm_contracts found=true hammasi)` va manba tx `xatoHidden=true` emas | `sourceTxId` bor va shartnoma `found=true` emas; qo'lda/ariza (`transactions.is_contract_manual=true`) qatorlar faqat keshda **aniq** `found=false` bo'lsa XATO |
| `xatoHidden` | hisobga oladi | hisobga olmaydi |
| Kesh yo'q qo'lda shartnoma | XATO | XATO emas; fonda `backfillManualCrmLookups` (max 20, ketma-ket, bir vaqtda bitta) keshni to'ldiradi |

`contractSource`: tx `isContractManual=true` va attachment bor → `ariza`; attachment yo'q → `manual`; aks holda `null`. Qoida (egasi tasdiqlagan, commit 49a3656): CRM'da yo'q shartnoma qo'lda/ariza bo'lsa ham XATO.

`buildXatoFilter` har chaqiruvda butun `found=true` ro'yxatini va `xatoHidden` tx'larni yuklaydi (katta `NOT IN`): og'ir.

Bog'liq funksiyalar:
- `cleanupSplitsForXatoContracts(contractNo?)` (`POST cleanup-xato-splits`, sync va split ichida ham): raw SQL, XATO qatorlarda `first_installment`, `monthly_amount`, `payment_category` ni NULL qiladi. `payment_amount >= 0` sharti bor, ya'ni qaytarimlar tozalanmaydi. Raw SQL `updated_at` ni yangilamaydi va history yozmaydi.
- `debugXatoSplits` (`GET debug-xato-splits`, manage): diagnostika, lekin ichida `cleanupSplitsForXatoContracts()` ni **bajaradi** (GET bo'lsa ham yozadi).
- `cleanupXatoContracts` (`DELETE cleanup-xato-contracts`, manage): CRM'da tasdiqlanmagan **barcha** tx-manba qatorlarni o'chiradi (qo'lda/ariza shartnomalarni ham, `xatoHidden` ni ham ajratmaydi). History `deleted` snapshot bilan yoziladi. Juda xavfli, avtomatik chaqirilmaydi.
- `cleanupTxSource({dateFrom, dateTo})` (`DELETE cleanup-tx-source`): tx-manba qatorlarni 500 tadan o'chiradi (sana bo'yicha ixtiyoriy), history `deleted`. Qayta sync uchun mo'ljallangan.
- `findOrphanTxRows(limit)` (`GET orphans`): `source_tx_id` bor, lekin na `transactions.external_id`, na `transactions.id` mos — faqat sanaydi (namuna ≤500), o'chirmaydi. Og'ir SQL (NOT EXISTS + OR).
- Agent/bot uchun: `getXatoListForAgent({dateFrom, limit≤2000})` qatorlar + `count` (count faqat `agentNotifiedAt IS NULL`, amalda hammasi), har qatorga `account` (IN: `toName`, OUT: `fromName`) qo'shiladi, chunki XATO'da `object` bo'sh. `findXatoRows` (TR Support ariza: kalitlar, summa ±1 ishorasiz, sana oynasi, max 50), `findXatoRowForTx`. `getXatoForAgent`, `markAgentNotified`, `getXatoRows`, `getXatoContractNumbers` kodda bor, lekin tashqi chaqiruvchi topilmadi.

`reverifyXato()` (`POST reverify-contracts`, `oplatakv:sync`; holat `GET reverify-status`): XATO qatorlarni fonda (4 parallel) **to'liq qayta kategoriyalaydi**: `categorization.categorizeOne(txId, {force:true, forceRefresh:true, actor:'sync'})` (izohdan qayta ajratish, yangi CRM lookup, ism bo'yicha dublikat tanlash), keyin `crmCache.lookup`; topilsa `oplata_kv` qatoriga kanonik `contractNo`, mapping qilingan obyekt va mijoz yoziladi. Holat xotirada (`ReverifyStatus`: total/done/fixed/notFound/errors, namunalar ≤200 sababi bilan). Allaqachon ishlayotgan bo'lsa `alreadyRunning`.

#### C.1.8 XATO → CRM moduli va bot biriktirish

- `botAssignContract(oplataKvId, contractNo, actorName)`: `crmCache.lookup` → kanonik raqam (topilmasa kiritilgani). Qatorning `sourceTxId` bo'yicha tx topilsa `categorization.setContractManual(txId, finalNo, '')` (tx'ni yangilaydi va `syncContractChangeToOplataKv` orqali `oplata_kv` qatorini sinxronlaydi: shartnoma, obyekt, mijoz; split tozalanadi). Tx yo'q bo'lsa `oplata_kv` to'g'ridan yangilanadi. Chaqiruvchilar: `correction-bot-runner.service.ts`, `assignFromCrm`, `bulkCrmFix`.
- Diqqat (categorization tomoni): tx'dagi shartnoma **tozalansa** bog'langan `oplata_kv` qatori `contractNo='xato'` va `sourceTxId=NULL` bo'ladi. Natijada qator "manual" manbaga o'tib XATO filtridan chiqadi.
- `assignFromCrm(id, contractNo?, actor, split?)` (`POST :id/assign-from-crm`, `oplatakv:edit` yoki `oplatakv:xato_crm`): avval shartnoma (berilsa), keyin split. CRM qiymati (`initialAmount`/`monthlyAmount`) berilsa `applyCrmSplit` (aynan CRM nisbati), aks holda `splitSingleRow` (waterfall).
- `applyCrmSplit`: `first = round(total × ci/(ci+cm))`, `monthly = total − first`, kategoriya `categoryOf`; history `edited`, actor `crm-split`.
- `bulkCrmFix(mode)` (`POST bulk-crm-fix`, edit yoki xato_crm): `xato` yoki `unsplit` filtri bo'yicha 8000 tagacha qator (eng yangi), `crmService.bulkMatch` (global CRM indeks + XonPay UUID); topilganlarga (xato rejimida) `botAssignContract` + `applyCrmSplit`. Javob `{total, matched, fixed}`.
- `buildUnsplitFilter` ("Split yo'q"): shartnoma `found=true` va `paymentCategory IS NULL` (Excel qatorlar ham kiradi).
- `unsplitContracts()` (`GET unsplit-contracts`): `found=true` shartnomalar, `sourceTxId` bor va uchala split ustuni NULL, schetchik (`CLIENT_SCHETCHIK`) manbalari chiqariladi (agar ≤30000 bo'lsa). Shartnoma bo'yicha soni va summasi.
- `orderIdCoverage()` (`GET order-id-coverage`): split qilingan qatorlarning necha foizida `crm_contracts.crm_order_id` bor; shartnoma darajasidagi statistika. `POST backfill-order-ids` (`oplatakv:sync`) `crmCache.backfillOrderIds` ni fonda ishga tushiradi.

#### C.1.9 Split (boshlang'ich / oylik)

Qoida fayli `installment-split.ts` (auto va qo'lda tugma bir xil funksiyani ishlatadi):
- `buildSchedule(detail)`: CRM `/order/show` dagi `initial.schedules[]` va `monthly.schedules[]` → `date_payment` bo'yicha o'sish tartibidagi qadamlar (`{amount, kind}`), bir xil sanada `initial` oldin. Summa ≤0 yoki sanasiz qadam tashlanadi.
- `allocatePayment(schedule, alreadyPaid, amount)`: waterfall. To'lov `[alreadyPaid, alreadyPaid+amount]` oralig'i grafik qadamlari bilan kesishmasi bo'yicha bo'linadi; grafikdan oshgan qism oylikka; manfiy summa grafikdan "yuqoridan" yechiladi. Eski xato mantiq (butun boshlang'ich bitta yaxlit summa deb olinardi) shu bilan almashtirilgan.
- `categoryOf(first, monthly)`: faqat biri bo'lsa o'sha; ikkalasi 0 bo'lsa `MONTHLY`; ikkalasi bo'lsa absolyut kattasi, teng bo'lsa `FIRST`.
- `allocateRefundNoSchedule(qolganOylik, qolganBoshlangich, amount<0)`: grafiksiz qaytarim (bekor qilingan, CRM'dan o'chgan shartnoma). Egasi qoidasi (10.10.2026): avval oylik nolga tushiriladi, qolgani boshlang'ichdan, ikkalasidan oshsa ortig'i oylikka. Izohga ko'ra 1,95 mlrd so'm shunday "bo'linmagan" qaytarim yotgan edi (commit 0604e1a).

`splitInstallments({limit=5000 (max 20000), contractNo?, force?})` (`POST split-installments`, `oplatakv:split`; fon ishi ham chaqiradi):
1. `cleanupSplitsForXatoContracts(contractNo)`.
2. Faqat `sourceTxId` bor va `paymentAmount` bor qatorlar. `force` bo'lmasa faqat uchala ustun NULL qatorlar (qo'lda qo'yilganlarga tegmaydi). `contractNo + force` bo'lsa avval shu shartnomaning tx-manba qatorlari reset qilinadi.
3. Bitta shartnoma: kesh `found=true` bo'lmasa darhol qaytadi. Ko'p shartnoma: raw SQL `EXISTS (crm_contracts found=true) OR payment_amount < 0`, `ORDER BY date ASC LIMIT`.
4. Schetchik: manba tx subkategoriyasi `CLIENT_SCHETCHIK` bo'lsa split qilinmaydi, `paymentCategory='GENERAL'`, ustunlar NULL, running summaga qo'shilmaydi.
5. Shartnoma bo'yicha guruh, 10 parallel, har biri uchun **jonli** `crmService.show` (keshlanmaydi, og'ir).
6. CRM detail yo'q: faqat qaytarimlar `allocateRefundNoSchedule` bilan (shartnomaning hozirgi yozilgan jami oylik/boshlang'ichi asosida); hech qachon split yozilmagan shartnoma bo'lsa (odatda noto'g'ri raqam, masalan "сонли" so'zi yutilgan) tegilmaydi va `notFound`.
7. CRM detail bor: `existingSums` = shu shartnomada partiyaning birinchi sanasidan **oldingi** qatorlar yig'indisi; qatorlar sana+id bo'yicha barqaror tartiblanadi; har biri `allocatePayment`; shartnoma bo'yicha hamma update bitta `$transaction` da (atomik). Batch split history yozmaydi.
8. Natija `{total, contracts, filled, notFound, errors, duration, xatoCleaned}`.

`splitSingleRow(id)` (`POST :id/split`): faqat shu qator. Schetchik → `GENERAL`. CRM detail yo'q → xato "XATO, split mumkin emas". Running summa: shu shartnomada `date < row.date` **yoki** bir xil sanada `id < row.id` (FIX B#6). History `edited` (note'da running qiymatlar). Perereboska, chek-order va `assignFromCrm` ham shu funksiyani ishlatadi.

`manualSplit(id, first, monthly)` (chek-order servisidan chaqiriladi, controller'da yo'q): invariant `first + monthly = paymentAmount` (±0.01), musbat to'lovda manfiy ulush va manfiy to'lovda musbat ulush taqiqlanadi; ikkalasi 0 bo'lsa `GENERAL`; `wasManuallyEdited=true`; history.

`bulkSetCategory(ids, FIRST|MONTHLY)` (`POST bulk-category`, `oplatakv:bulk_split`): 5000 tagacha qator; butun summa tanlangan ustunga, ikkinchisi NULL; summasi 0 yoki allaqachon shunday qatorlar skip; atomik `$transaction`; history `createMany` (action `updated`).

Ma'lum nozikliklar:
- Batch split'da running summa `date < firstDate`: partiya ichidan tashqaridagi **bir xil sanadagi** oldingi split qatorlar hisobga olinmaydi (`splitSingleRow` dagi B#6 fix bu yerda yo'q).
- Sync mavjud qatorning summasi yoki shartnomasini o'zgartirsa split ustunlari qayta hisoblanmaydi (non-force split ularga tegmaydi). Natijada `first + monthly ≠ paymentAmount` bo'lib qolishi mumkin; tuzatish `force` yoki `:id/split`.
- Qo'lda, Excel va perereboska qatorlari (`sourceTxId` yo'q) avto-split'ga tushmaydi.

#### C.1.10 Schetchik → oylik

`schotchikToMonthly({dateFrom, dryRun})` (`POST schotchik-to-monthly`, `oplatakv:split`; endpointda `dryRun` default `true`): `tx_type = 'За счетчик'` (aniq tenglik) va `date >= dateFrom` (default 2024-01-01) qatorlar. Dry-run: jami, yangilanishi kerak bo'lganlar soni va 6 namuna. Apply: raw SQL `monthly_amount = payment_amount, first_installment = NULL, payment_category = 'MONTHLY', updated_at = appNow`. History yozilmaydi.

Konfiguratsiya: `GET/POST schotchik-config` (`settings.getSchotchikAutoConfig/setSchotchikAutoConfig`; kalitlar `schotchik.auto` ('1'), `schotchik.dateFrom` (YYYY-MM-DD), `schotchik.dayStart`, `schotchik.dayEnd`, `schotchik.intervalMin`). Panelda bu amal parol bilan himoyalangan (frontend tomonda).

O'zaro ta'sir: split `CLIENT_SCHETCHIK` qatorlarga `GENERAL` qo'yadi, schotchik avto-rejimi esa `'За счетчик'` tipli qatorlarni `MONTHLY` qiladi. Avto-rejim yoqilgan bo'lsa qo'lda re-split qilingan schetchik qatori keyingi tsiklda yana `MONTHLY` ga o'tadi. `categorization.backfillSchotchik` boshqa narsa (tranzaksiya tomoni).

#### C.1.11 Ro'yxat, filtrlar, distinct, eksport

`list(q)` (`GET /oplata-kv`, `oplatakv:view` yoki `oplatakv:xato_crm`): `page`, `perPage` (≤200), `sortBy` (default `date`), `sortDir`. `buildWhere`:
- `q`: shartnoma, mijoz, obyekt, maqsad, izoh, to'lov usuli, tip, id bo'yicha `contains`; raqam bo'lsa uchala summa ustunida aniq tenglik.
- `dateFrom`/`dateTo`, `contractNo`, `paymentCategory`, `client`, `object` (contains).
- Ko'p tanlov CSV: `contractNos`, `paymentCategories`, `clients`, `objects`, `paymentMethods`, `txTypes`; `__null__` = bo'sh qiymat.
- `sources` (`manual`, `excel`, `transaction`), summa oraliqlari (`paymentAmountMin/Max`, `firstInstallmentMin/Max`, `monthlyAmountMin/Max`).
- Async filtrlar: `xatoOnly`, `unsplitOnly`, `crmStatuses` (`virtual_status`, case-insensitive; `__none__` = status yo'q yoki ''), `crmPropertyTypes` (`parking` yoki `apartment`; `crm_contracts.property_type='parking'` ro'yxati bo'yicha IN yoki NOT IN), `crmBranches` (`branch_name` IN; `__none__` = bo'lim yo'q). Ular kichik `IN`/`NOT IN` ro'yxatlar quradi ("tezlashtirilgan" branch filtri faqat tanlangan bo'limlarni oladi).
- Javob: qatorlar + `crmXato`, `contractSource`, `crmStatus`, `crmBranch`, `crmPropertyType`; `sums` (uchala summa yig'indisi). Kesh '' qiymatlari ko'rsatilmaydi.
- Bank filtri ro'yxatda yo'q, faqat obyekt hisobotida (`banks`).

`distinctValues(column, q, search)` (`GET distinct`): ustun filtri popoveri uchun, o'z ustunining filtri chiqarib tashlanadi (self-exclusion). Maxsus ustunlar: `source` (qat'iy 3 variant), `crmStatus`, `crmPropertyType` ("Жилой"/"Парковка"), `crmBranch`, `bank` (faol banklar + `__none__`), `paymentCategory` (enum yorliqlari). `contractNo` ustunida birinchi variant `XATO` (frontend uni `xatoOnly=true` ga aylantiradi). Limit 300.

Eksport: `GET export` (xlsx, view yoki xato_crm) va `GET export-json` (view). `fetchAllForExport` ro'yxat bilan bir xil filtr, **paginatsiyasiz**. Excel'da XATO qatorda shartnoma o'rniga qizil "XATO", oxirida "ИТОГО:" qatori.

#### C.1.12 Obyekt hisoboti va kunlik xulosa

`buildObjectReportWhere(opts)` (umumiy; `byObject`, `byObjectContracts`, Universal API):
- `mode='normal'` (default): `payment_amount > 0` va `tx_type` ichida `взнос` (yoki `includeSchotchik` bo'lsa `счетчик`/`счётчик` ham); `tx_type` ichida `от имени` bo'lgan qatorlar chiqariladi (Vznos tushum emas).
- `mode='refund'`: `payment_amount < 0` va `tx_type` `возврат` bilan boshlanadi.
- Qo'shimcha: `crmStatuses`, `propertyTypes`, `branches` (yuqoridagi builder'lar). `banks` (CSV bank **id**, `__none__`) SQL'da emas, JS'da `filterRowsByBank`: `source_tx_id → transactions.external_id`, keyin `transactions.id` → `bank_id`, 5000 tadan bo'laklab (Postgres 32767 parametr chegarasi).
- `dateTo` → `T23:59:59.999` (server lokal vaqti).

| Metod | Endpoint | Nima qaytaradi |
|---|---|---|
| `byObject` | `GET by-object` | obyekt bo'yicha `groupBy` (summa, boshlang'ich, oylik, soni) + JAMI; obyekt nomi bo'yicha alifbo (ru) |
| `byObjectDetail` | `GET by-object-detail` | bitta obyekt (`__ALL__` = hammasi, `—` = obyektsiz) qatorlari, 5000 qator chegarasi (`truncated`), jami `aggregate` bilan to'g'ri |
| `byObjectDetailXlsx` | `GET by-object-detail/export` | drill-down Excel |
| `byObjectContracts` | (faqat Universal API) | obyekt+shartnoma kesimi, mijoz nomi alohida so'rovda to'ldiriladi |

`dailySummary(date?)` (`GET daily-summary`): faqat `oplata_kv` dan, `payment_amount > 0` va `tx_type` `взнос` (bu yerda `от имени` chiqarilmaydi, obyekt hisobotidan farqli). Kun, kecha, oy boshidan (MTD), o'tgan oyning shu davri, 14 kunlik trend, top-6 obyekt. Vaqt-adolatli taqqoslash: tanlangan kun bugun bo'lsa kecha faqat hozirgi soat:daqiqagacha `created_at` bo'yicha olinadi (`date` vaqtsiz bo'lgani uchun). Server lokal soatiga (`getHours`, `setHours`) bog'liq.

#### C.1.13 Shartnoma ko'rinishlari (Akt sverka, CRM, planirovka)

- `findByContract(contractNo)` (`GET by-contract`): Akt sverka uchun shartnomaning barcha qatorlari (sana kamayish), XATO qatorlar (`computeContractXato`) chiqariladi (`excludedXato` soni), summalar. Diqqat: `meta` uchun "eng yangi" deb `items[items.length-1]` olinadi, ro'yxat kamayish tartibida bo'lgani uchun bu aslida eng **eski** qator; `firstDate`/`lastDate` ham teskari.
- `crmSverka(contractNo)` (`GET crm-sverka`): bitta shartnoma: bizdagi qatorlar va jami ↔ CRM `/show` `payment_histories` (tur `type.key` da `init`/`boshlang`/`перво` bo'lsa boshlang'ich, aks holda oylik). Status `ok` (|farq| < 0.01), `oplata-more`, `crm-more`. Shuningdek kontrakt narxi, reja/to'langan, xonadon (`info`) va mijoz (telefon bilan) ma'lumoti.
- `crmLookupForForm(contractNo)` (`GET crm-lookup`): forma avto-to'ldirish. Kesh → `crmService.getContractMeta` (`/index`, shartnoma **egasi**) → jonli `/show`; obyekt nomiga mapping. `found`, `customerName`, `objectName`, `objectNameOriginal`.
- `contractSuggest(q)` (`GET contract-suggest`): kamida 2 belgi, `oplata_kv` dagi mavjud shartnomalar, 15 ta.
- `contractPlan` (`GET contract-plan`) → `crmService.contractMedia`; `GET contract-plan/download?url&name` → `streamPlanImage` (proxy). Bu ikki statik route `:id` dan **oldin** turishi shart.

#### C.1.14 Perereboska (shartnomadan shartnomaga pul o'tkazma)

Ta'rif: bir shartnomadan (odatda bekor qilingan) boshqa shartnoma(lar)ga to'lovni o'tkazish. Natija: manba qator (manfiy summa) + N ta maqsad qator (musbat), hammasi bitta `perereboskaGroupId`, `txType = paymentMethod = 'Переброска'`, `paymentCategory = NULL`, `sourceTxId = NULL`.

`contractBalance(contractNo)` (`GET contract-balance`): shartnomaning **barcha** `oplata_kv` qatorlari yig'indisi (XATO, perereboska qatorlari ham), mijoz/obyekt `crmLookupForForm` dan, bo'lmasa eng so'nggi qatordan. `foundInCrm = CRM found YOKI shu raqamda kamida bitta to'lov bor` (bekor qilingan shartnomalar shu yo'l bilan qabul qilinadi; noto'g'ri raqamli to'lovi bor shartnoma ham "topilgan" bo'lib qoladi).

`createPerereboska` (`POST perereboska`, multipart: `file` majburiy, `fromContractNo`, `amount`, `date`, `destinations` (JSON satr `[{contractNo, amount}]`), `note`, ixtiyoriy `agentUsed`, `agentState`, `agentReason`, `agentData`; ruxsat `oplatakv:create`). Qoidalar:
1. Manba bo'sh emas, summa > 0, kamida 1 maqsad, sana bor, fayl ≤25 MB.
2. Maqsad manbaning o'zi bo'lmasin, har maqsad summasi > 0.
3. Maqsadlar jami = manba summasi (±0.01).
4. Manba `foundInCrm` va obyekti aniqlangan bo'lishi shart.
5. Manba qoldig'i (`totalPaid`, faqat **OplatyKv** bo'yicha) ≥ summa. Yetmasa xabarga CRM'dagi to'langan summa qo'shiladi ("hali bizga yetib kelmagan"), lekin CRM raqami qarorga ta'sir qilmaydi (aks holda manba minusga ketadi).
6. Har maqsad `foundInCrm` va obyekti manba obyektiga **aynan teng** (mapping qilingan nom, satr tengligi).
7. Fayl `UPLOADS_DIR/perereboska/<groupId>/<safeName>` ga yoziladi; keyin bitta Prisma tranzaksiyasida `pg_advisory_xact_lock(hashtext(fromCn))` (FIX B#2: parallel ikki perereboska double-spend qilmasin; `$executeRaw` ishlatiladi, `$queryRaw` void'ni o'qiy olmay P2010 bergan edi), qulf ostida qoldiq qayta tekshiriladi, qatorlar va `PerereboskaGroup` (`status='active'`, `destinations` JSON, agent maydonlari) yaratiladi, history faqat manba qatorga.
8. Xatoda: `HttpException` o'z xabari bilan, boshqasi `500` Prisma kodi bilan; yarim yozilgan papka o'chiriladi.
9. Keyin `splitSingleRow` avval manba, keyin maqsadlar uchun (CRM'da yo'q shartnomada jim muvaffaqiyatsiz bo'ladi).
10. Telegram xabar (fayl bilan).

`deletePerereboskaGroup(groupId, actor, reason)` (`DELETE perereboska/:groupId?reason=`, `oplatakv:delete`): pul qatorlari `deleteMany` bilan o'chiriladi (balans tiklanadi), fayl diskdan o'chiriladi, guruh `cancelled` (sabab, kim, qachon; `filePath=null`) bo'lib tarixda qoladi, Telegram (fayl buferi bilan). Allaqachon bekor bo'lsa 400. **Diqqat:** bu yo'l `oplata_kv_history` ga `deleted` yozmaydi, shuning uchun `/api/v1/oplata-kv/changes` feed bu qatorlar uchun tombstone bermaydi (feed perereboska qatorlarini `perereboskaGroupId` bo'yicha aktiv deb chiqargan bo'ladi).

`GET perereboska/:groupId/file`: manba qatordagi fayl yo'li orqali stream. `GET perereboska/history` (`status`, `dateFrom`/`dateTo` `+05:00` bilan, `q` faqat manba shartnoma, manba mijoz va obyekt bo'yicha, `perPage` 20, max 100) → `PerereboskaGroup`.

AI perereboska `analyzePerereboskaAriza(file)` (`POST perereboska/analyze`, `oplatakv:create`; DB'ga **yozmaydi**):
- Kalit: `settings['agent.aiKey']` (shifrlangan, `CryptoService.decrypt`), bo'lmasa env `ANTHROPIC_API_KEY`. Model: `perereboska.aiModel` → `agent.aiModel` → koddagi default model nomi.
- Fayl PDF (`document` blok) yoki rasm (`image` blok), base64; boshqa tur 400.
- Claude Messages API (`/v1/messages`, `anthropic-version: 2023-06-01`, `max_tokens 1200`, `tool_choice` = `extract_perereboska`). Tool sxemasi: `isTransferApplication`, `fromContractNo`, `destinations[]`, `totalAmount`, `amountsFound[]` (`amount`, `amountWords`, `role` = `transfer` | `refunded` | `repay` | `contract_total` | `other`, `quote`), `transferQuote`, `applicantName`, `applicantNameReadable`, `applicantNamePrinted`, `applicantMatchesHolder`, `nameNote`, `confidence`, `notes`. System prompt summa rollarini ajratish va qo'lyozma ismni to'qimaslik haqida qat'iy ko'rsatmalar beradi (2026-08 dagi ikki real xatodan keyin).
- Dasturiy tekshiruv (`decideTransferAmount`, AI'ga ko'r-ko'rona ishonmaslik): (0) o'tkazmani so'ragan jumladagi summa eng ishonchli; jumladagi kalit so'z bo'yicha rol (`classifyRoleFromQuote`, eng yaqin kalit so'z); (1) raqam ↔ so'z bilan yozilgan summa mosligi (`parseAmountWords`, o'zbek lotin/kirill va rus); (2) zaxira: yagona `transfer` rolli summa; (3) qaytarilgan/qayta to'lov summasi o'tkazma qilib olinganmi; (4) manba qoldig'iga teng summa bor-yo'qligi. Tuzatilsa `amountCorrected`, bitta maqsad bo'lsa uning summasi ham tuzatiladi.
- Qoldiq ikki manbadan: OplatyKv (`contractBalance.totalPaid`) va CRM (`/show` `payment_histories` yig'indisi, `crmTolovlar`; CRM javob bermasa `null`, "0" emas). Farq > 1 so'm bo'lsa `crmdaBorBizdaYoq` (sana|yaxlit summa juftligi bo'yicha) va `farqSababi` (hammasi XonPay → kechikish; `client_parking` → avtoturargoh to'lovi; status `paid` emas). Yetarlilik **faqat OplatyKv** bo'yicha.
- Topilmagan manba uchun `oxshashShartnoma` (oxirgi belgisiz prefiks, `oplata_kv` va `crm_contracts` dan ≤5 ta).
- Ism: qo'lyozma o'qilmasa bosma ism; maqsad shartnoma egasi bilan `namesMatch` (kirill↔lotin translit, X/H yumshatish, kamida 2 umumiy bo'lak). `nameCheck` yoqilgan bo'lsagina ogohlantirish; manba va maqsad egalari har xilligi ham tekshiriladi.
- Takror: shu manbadan shu summada (±1) oldingi `Переброска` manfiy qatorlar (oxirgi 30) → ogohlantirish (bloklamaydi).
- Natija: `extracted{...}`, `balanceEnough`, `xulosa` (bitta oddiy jumla), `duplicates`, `agentState` (`verified` agar ogohlantirish yo'q, aks holda `needs_review`), `agentReason`, `warnings`. Xodim tasdiqlagach frontend `POST perereboska` ni agent maydonlari bilan chaqiradi.

Sozlamalar (`GET perereboska-settings` view; `POST perereboska-settings` legacy manage):

| Kalit | Default | Backend'da ta'siri |
|---|---|---|
| `perereboska.aiEnabled` | yoqiq ('0' bo'lmasa) | backend `analyze` da tekshirilmaydi (frontend gate) |
| `perereboska.aiModel` | `agent.aiModel` yoki kod default | model tanlovi |
| `perereboska.strict` | o'chiq ('1' bo'lsa yoqiq) | backend `createPerereboska` da tekshirilmaydi (frontend gate, aniq emas) |
| `perereboska.tgNotify` | yoqiq | Telegram xabari |
| `perereboska.nameCheck` | o'chiq | ism ogohlantirishlari |
| `perereboska.showReverse` | yoqiq | faqat UI |

`getPerereboskaSettings` javobida `hasKey` (kalit bor-yo'q) va `tgChat` (Telegram chat ID qiymati) qaytadi: chat ID `oplatakv:view` egasiga ochiladi.

Telegram (`notifyPerereboskaTelegram`): env `TG_BOT_TOKEN` va `ATTACHMENTS_NOTIFY_CHAT` (kodda hardcoded default chat bor); rasm `sendPhoto`, boshqa `sendDocument`, faylsiz `sendMessage`; HTML caption.

ZIP eksportlar (view): `GET export/arizas-zip` (barcha `transaction_attachments`, 10 000 tagacha, papka = shartnoma raqami yoki `no-contract`; ruxsat faqat `oplatakv:view`, hamma tranzaksiyalar arizalari chiqadi) va `GET export/perereboski-zip` (`PerereboskaGroup` aktiv + `oplata_kv.perereboska_file_path`, groupId bo'yicha dedup, ichida `_manifest.txt` diagnostika). `archiver` paketi `require` bilan yuklanadi, yo'q bo'lsa 500.

#### C.1.15 Memorial order PDF/XLSX (`memorial-order/`)

`GET memorial-order?contractNo=&bank=1` (PDF) va `GET memorial-order/xlsx` (Excel reestr), ikkalasi `oplatakv:view`.
- `buildBlocks`: shartnomaning **barcha** `oplata_kv` qatorlari (sana o'sish). `sourceTxId` orqali `transactions` ga bog'lanadi; bog'lanmaganlar uchun shu `contract_number` li bog'lanmagan tx'lar ichidan summa (farq ≤ max(1, 0.01%)) va eng yaqin sana bo'yicha juftlanadi (har tx bir marta). Blok: sana, `docNumber` (order №), ID (`bankGeneralId`/`externalId`), to'lovchi/oluvchi nomi, hisob, INN, MFO, summa, izoh, `hasTx`.
- `fromBank=1` → `fillFromBank` (faqat o'qish, DB'ga yozmaydi): to'lovchi hisobi ham MFO ham yo'q bloklar uchun. Hisoblar: `sync_enabled` va bank `apiKind` ∈ (`KAPITALBANK_V3`, `IPAK_YOLI_V1`) (Hamkor chiqarilgan); avval shartnoma oluvchi hisobiga mos (yoki `previousAccountNo` ga mos) hisoblar, topilmasa hammasi. Sanalar ikki bosqichda: aniq sanalar, keyin topilmaganlar uchun ±1 kun. `MAX_CALLS = 250`. `KapitalbankClient.getDoc1C` (shifrlangan parol `CryptoService` bilan ochiladi, `useProxy` hurmat qilinadi); bo'sh kelsa eski rekvizit (`previousBranch`/`previousAccountNo`) bilan qayta so'raladi (Kapitalbank 2026-10-05 MFO almashuvi). Moslash: summa (bank tiyinda, /100), izohda normallashtirilgan shartnoma raqami **majburiy**, sana farqi ≤ 3 kun, har bank hujjati faqat bitta qatorga (2026-09 fix: ilgari bir order hamma bir xil summali qatorga tushardi). Topilmasa blok "нет данных" qoladi.
- PDF `pdfkit`, Roboto shriftlari `backend/assets/fonts` dan (dev va prod yo'llari tekshiriladi). Boshida reestr jadvali, keyin har to'lov uchun order bloki.

#### C.1.16 Excel import

Ustunlar (rus sarlavhalar): A "Дог №" (majburiy), B "Дата" (dd.MM.yyyy, ISO, Excel serial), C "Сумма оплаты", D "1 взнос", E "ежемесячный", F "Назначение платежа", G "Тип", H "Примечание", I "Оплата" (`ежемесяч` → MONTHLY, `1 взнос`/`первый` → FIRST, `общий` → GENERAL), J "Объект", K "Клиент", L "Способ оплаты", M "ID" (majburiy, dublikat skip).

| Endpoint | Ruxsat | Nima qiladi |
|---|---|---|
| `POST import/preview` (file) | legacy manage | o'qiydi, DB'dagi va fayl ichidagi dublikat ID'larni topadi, natijani **xotira** keshida 30 daqiqa saqlaydi, `previewId` qaytaradi |
| `POST import/commit` `{previewId}` | legacy manage | `ImportBatch` yaratadi, 1000 tadan `createMany(skipDuplicates)`, batch darajasidagi history (`oplataKvId = 'BATCH-<id>'`, `imported`), batch statistikasi. Commit qatorlarida `createdById/Name` yo'q |
| `POST import/cancel` | legacy manage | keshdan o'chiradi |
| `POST import` (file) | legacy manage | eski bir bosqichli import |
| `DELETE import-batch/:id` | legacy manage | batch qatorlarini 500 tadan o'chiradi (har biriga `deleted` snapshot history), batch'ni o'chiradi |

Preview keshi xotirada: restart yoki boshqa instance'da yo'qoladi.

#### C.1.17 CRUD va tarix

- `POST /oplata-kv` (`oplatakv:create`): qo'lda qator, history `created`.
- `PATCH /:id` (`oplatakv:edit`): faqat o'zgargan maydonlar diff bilan, history `edited`.
- `DELETE /:id` (legacy `oplatakv:manage`, `oplatakv:delete` emas): avval history `deleted` (to'liq `snapshot`), keyin o'chirish. Bu tombstone `/api/v1/.../changes` da chiqadi.
- `GET /:id`, `GET /:id/history?limit` (≤500).

#### C.1.18 Delta API va `updated_at`

`/api/v1/oplata-kv/changes` (`developer-api/public-api.controller.ts`) `oplata_kv.updated_at, id` keyset kursori va `oplata_kv_history(action='deleted')` tombstone'lari bilan ishlaydi; `paymentCategory` yoki `perereboskaGroupId` bor qator aktiv (`deleted:false`), aks holda `reason:'inactive'` tombstone (batafsil api.md).

Tarixiy hodisa (2026-08-12, commit b06ca52): schotchik raw SQL `NOW()` (DB soati, skew) kelajakdagi `updated_at` yozgan, `updatedSince` kursori sakrab to'lovlar o'tkazib yuborilgan. Uch qatlamli fix: (1) raw SQL'da app vaqti parametr sifatida; (2) `clampFutureUpdatedAt` har daqiqa (`schotchikAutoTick` boshida, schotchik o'chiq bo'lsa ham); (3) API'da `clampFuture`. Qoida: raw SQL'da `NOW()` yozma.

`updated_at` ni yangilamaydigan yozuvlar: `cleanupSplitsForXatoContracts` (split tozalanadi, lekin feed buni ko'rmaydi) va `deletePerereboskaGroup` (history'siz hard delete). Prisma `update`/`updateMany` `@updatedAt` ni o'zi qo'yadi.

#### C.1.19 Diagnostika endpointlari

`GET last-sync-info` (oxirgi tx-manba `updatedAt`/`createdAt`, soni), `GET debug-sync-diff?dateFrom&dateTo` (legacy manage: CLIENT tx soni, shartnomali/shartnomasiz, yo'nalish bo'yicha, tx-manba `oplata_kv` soni, 5 namuna; Toshkent kun chegaralari), `GET crm-status/stats`, `GET crm-status/diag?contracts=A,B`, `POST crm-status/reset-empty` (`virtual_status=''` → NULL), `POST crm-status/repair-mojibake` (CRM'ga urilmasdan yorliqlarni tuzatish), `POST crm-meta/backfill` (`runMetaBackfill(1000)` + `probeBranchSource(5)`). Oxirgi uchta POST yozuvchi bo'lsa ham faqat `oplatakv:view` talab qiladi.

#### C.1.20 Endpointlar jamlanmasi (`/api/oplata-kv`)

Ruxsat qisqartmalari: V = `oplatakv:view`, C = `create`, E = `edit`, D = `delete`, S = `split`, BS = `bulk_split`, SY = `sync`, X = `xato_crm`, M = legacy `manage`. "V|X" = biri yetarli.

| Metod va yo'l | Ruxsat | Servis metodi |
|---|---|---|
| GET `/` | V\|X | `list` |
| GET `export`, `export-json` | V\|X, V | `exportXlsx`, `exportJson` |
| GET `distinct` | V | `distinctValues` |
| GET `crm-status/stats`, `crm-status/diag`; POST `crm-status/reset-empty`, `crm-status/repair-mojibake`, `crm-meta/backfill` | V | kesh servisi |
| GET `memorial-order`, `memorial-order/xlsx` | V | `MemorialOrderService` |
| GET `by-object`, `by-object-detail`, `by-object-detail/export`, `daily-summary` | V | hisobotlar |
| POST `schotchik-to-monthly`; GET/POST `schotchik-config` | S; V/S | schetchik |
| POST `bulk-category` | BS | `bulkSetCategory` |
| POST `add-from-tx` | S | `addOneFromTransaction` |
| GET `by-contract`, `contract-plan`, `contract-plan/download`, `crm-sverka`, `crm-lookup`, `contract-balance`, `contract-suggest` | V | shartnoma ko'rinishlari |
| POST `perereboska`, `perereboska/analyze` | C | perereboska |
| DELETE `perereboska/:groupId` | D | `deletePerereboskaGroup` |
| GET `perereboska/history`, `perereboska-settings`, `perereboska/:groupId/file`, `export/arizas-zip`, `export/perereboski-zip` | V | |
| POST `perereboska-settings` | M | |
| POST `sync-from-transactions` | M | `syncFromTransactions` |
| POST `sync-now` | SY | `syncNowRespectingSettings` |
| GET `orphans`, `last-sync-info`, `bg-status`, `reverify-status`, `order-id-coverage`, `unsplit-contracts`, `object-mappings` | V | |
| POST `object-mappings`, `fill-objects`, `fix-client-names`, `cleanup-xato-splits`; DELETE `object-mappings/:id`, `cleanup-xato-contracts`, `cleanup-tx-source`; GET `debug-xato-splits`, `debug-sync-diff` | M | |
| POST `backfill-order-ids`, `reverify-contracts` | SY | |
| POST `split-installments`, `:id/split` | S | split |
| POST `:id/assign-from-crm`, `bulk-crm-fix` | E\|X | XATO → CRM |
| GET `:id`, `:id/history` | V | |
| POST `/` | C | `create` |
| PATCH `:id` | E | `update` |
| DELETE `:id` | M | `remove` |
| POST `import/preview`, `import/commit`, `import/cancel`, `import`; DELETE `import-batch/:id` | M | import |

Controller'dan tashqari chaqiriladigan metodlar: `getXatoListForAgent`, `countXatoForAgent` (agent, correction, tr-support), `findXatoRows`, `findXatoRowForTx` (tr-support), `botAssignContract` (correction-bot), `splitSingleRow`, `manualSplit` (chek-order), `byObject*` (Universal API), `getRowsForExport`, `countForExport`, `distinctExportFilters` (google-export).

---

### C.2 CRM klienti (`crm/`) va `crm_contracts` keshi

#### C.2.1 Vazifa va qat'iy qoida

XonSaroy CRM bilan **faqat o'qish** integratsiyasi (egasi qoidasi: CRM'ga hech qachon yozilmaydi; yozuvchi funksiya qo'shish egasi ruxsatisiz mumkin emas). Kodda faqat o'qish so'rovlari bor; POST faqat transport sifatida (form-urlencoded) ishlatiladi.

Env (faqat nomlar): `XONSAROY_API_URL` (`/client/order` bazasi), `XONSAROY_CLIENT_BASE` (`/client` bazasi), `XONSAROY_API_KEY` + `XONSAROY_API_SECRET` (Basic auth), `XONSAROY_S3_BASE` (planirovka rasmlari), `XONAPP_MYSQL_HOST`, `XONAPP_MYSQL_PORT`, `XONAPP_MYSQL_USER`, `XONAPP_MYSQL_PASSWORD`, `XONAPP_MYSQL_DB` (XonSaroy MySQL; user va parol bo'lsagina yoqiladi, pool 5 ulanish).

#### C.2.2 Transport

- `callUrl` (POST form): 3 urinish, 5xx va tarmoq xatosida backoff (300 ms × urinish), 4xx da qayta urinmaydi; timeout `/order/*` uchun 20 s, `/client/*` uchun default 60 s. Natija `{ok, data}` yoki `{ok:false, status, error}`.
- `callClientGet` (GET, retrysiz) `/payment-history` index uchun.

#### C.2.3 Ishlatiladigan CRM endpointlari

| CRM endpoint | Metod(lar) | Izoh |
|---|---|---|
| `/order/show` (`contract` yoki `id`, `trashed_status=1`, `with_trashed=1`) | `show`, `showByIdWithDeleted`, `getContractSchedules` | to'liq detail: grafik (`initial/monthly.schedules`), `payment_histories`, `client`, `info`, `status`, `virtual_status`, `type.key` |
| `/order/index` (`contract`, `per-page`, trashed paramlar) | `indexWithDeleted`, `getContractMeta`, `searchContracts`, `search` (+`cancelled=1`), `contractMedia`, `listContractBranchesPage`, `listContractsPage` (trashed paramsiz), `diagContractBranch` | `created_by` (menejer, `branch.name` = sotuv bo'limi), `plan_images`, `plan_drawings`, `client_full_name`, `number` |
| `/client/payment-history/excel` (POST, `page`, `limit` ≤5000, filtrlar `contract`, `transaction_id`, `date_from`/`date_to`; `getPaymentHistoryAll` da `trashed_status=1, with_trashed=1`) | `getPaymentHistory`, `getPaymentHistoryAll`, `paymentsByContract`, `deletedContractFromPayments`, `findByComposite`, `matchComposites`, `lookupForAgent`, `getCrmIndex` | `external_id` = bizning kompozit bank ID (ichidagi summa tiyinda), `amount`, `initial_amount`, `monthly_amount`, `other_amount` (so'm), `payment_method`, `type`, `category`, `status`, `full_name`, `object_name`, `order_id` |
| `/client/payment-history` (GET index) | `findByComposite` (birinchi urinish), `paymentsByContract` (zaxira) | 10.10.2026 izohiga ko'ra yangi CRM xostida 404; `findByComposite` baribir avval shuni sinaydi, keyin excel'ga o'tadi |

Muhim nozikliklar (kod izohlaridan):
- `is_trashed=1` yangi CRM'da **faqat** o'chirilganlarni qaytaradi; shuning uchun `show` unga qo'shilmaydi. O'chirilgan ("Удалено") shartnomani integratsiya API umuman bermaydi; ularning to'lovlari esa `/payment-history/excel` da bor. `indexWithDeleted`: oddiy `/index` bo'sh bo'lsa `deletedContractFromPayments` to'lovlar tarixidan `_fromPayments` elementini tiklaydi (qabul sharti: `order_id` bor, obyekt bor, mijoz nomi bank/to'lov tizimi emas — `BANKISH` regex; soxta "o'chirilgan" qatorlar 10.10.2026 da tuzatilgan). Bunday element grafiksiz, shuning uchun `show` uni to'liq detail sifatida **qaytarmaydi** (split noto'g'ri hisoblanmasin), u faqat shartnomani aniqlash (XATO emas) uchun.
- Parity: `show` fallback'i va `searchContracts` bir xil minimal param to'plamini ishlatadi; ilgari `status:'all'`, `cancelled:1` CRM'da 0 natija bergan. `search` (panel CRM tabi) baribir `cancelled:1` yuboradi.
- `show({contract, payerHint})`: bir raqamda bir necha shartnoma bo'lsa (`pickContractByName`) izohdagi ism bo'yicha (translit, ≥4 harfli bo'laklar, kamida 2 bo'lak va yagona eng yuqori ball) tanlaydi, keyin `id` bo'yicha to'liq `/show`. `/show` topilmasa `/index` fallback (aniq yoki normallashtirilgan raqam: probel, `-`, `_`, `.`, `/` farqi), topilsa `id` bo'yicha to'liq detail qayta olinadi (index elementi chala). 422 "selected contract is invalid" → jim `{ok:true, detail:null}`.
- MySQL `fetchClientExtras` (`contracts` jadvali): tug'ilgan sana, pasport, manzil, telefonlar, qavat, xonadon → `detail.client` ga qo'shiladi. Bu shaxsiy ma'lumot: `show`, `crmSverka` javoblarida chiqadi, Facts/botga berilmasin.

#### C.2.4 Metodlar

| Metod | Nima qiladi |
|---|---|
| `search(contract, perPage)` | panel qidiruvi; mijoz ismini kesh → MySQL → CRM item → `/show` (max 10) dan to'ldiradi va `crm_contracts` ga upsert qiladi |
| `searchContracts(contract, perPage=8)` | slim ro'yxat (id, raqam, mijoz, obyekt, xonadon, status, `isTrashed`, menejer, telefon, `branchName`); tuzatish boti, chek, kesh fallback, correction ishlatadi |
| `getContractMeta(contract)` | `/index` dan menejer, sotuv bo'limi, obyekt, status, mijoz, xonadon (sotuv bo'limining yagona ishonchli manbai) |
| `paymentsByContract(contract)` | bitta shartnoma to'lovlari (excel, bo'sh bo'lsa GET), aniq normallashtirilgan moslik |
| `findByComposite(id)` | kompozit ID (`[IP_|HB_]general_id_num_ddate_accCt_accDt_amount_sign`) bo'yicha CRM to'lovi: GET index `transaction_id`, sana; excel `transaction_id`, sana; oxirgi zaxira to'liq skaner (120 sahifagacha). Match belgilari `external_id` (yadro `general_id_num_ddate`), `general_id`, `num`, `sana+summa` (summa 3 variantda: so'm, ×100, /100); `strong` tepada |
| `matchComposites(items)` | 8000 tagacha; sana bo'yicha guruh, har sana uchun 6 sahifagacha excel; to'liq `external_id` yoki yadro; keyin XonPay UUID (`applyXonpayMatches`) |
| `lookupForAgent(id, date, amount)` | bot uchun: sana bo'yicha (≤6 sahifa), keyin `transaction_id`; aniq topilmasa shu kun shu summali ≤5 nomzod |
| `getCrmIndex()` / `bulkMatch()` | butun to'lov tarixining global xotira indeksi (TTL 20 daqiqa, ≤120 sahifa, 8 parallel); `bulk-crm-fix` uchun |
| `applyXonpayMatches` | izohdagi `XONPAY:(UUID)` → lokal `xonpay_transactions` (shartnoma, tur bo'yicha boshlang'ich/oylik) |
| `contractMedia(contractNo)` | `/index` `plan_images` + `plan_drawings` dan rasm URL'lari (presigned afzal), `contract_path_temp`; bo'sh bo'lsa debug dump |
| `streamPlanImage(url, name, res)` | faqat ishonchli S3 hostidan yuklab beradi (boshqa host 400) |
| `getContractSchedules(contract)` | grafik qatorlari (dormant `contract_schedules` uchun) |
| `listContractBranchesPage`, `diagContractBranch` | sotuv bo'limi backfill/diagnostika |

#### C.2.5 HTTP endpointlar (`/api/crm`)

| Metod va yo'l | Ruxsat | Nima qiladi |
|---|---|---|
| GET `search?contract&perPage` | `crm:view` | `search` |
| GET `show?contract|id` | `crm:view` | `show` (MySQL extras bilan) |
| GET `payment-history?page&limit` | `crm:view` | excel proxy (xom, shaxsiy ma'lumot bor) |
| GET `find-by-composite?id` | `crm:view` \| `oplatakv:view` \| `oplatakv:xato_crm` | `findByComposite` |
| POST `match-composites` `{items}` yoki `{ids}` | o'sha uchtasidan biri | `matchComposites` |

#### C.2.6 Kesh (`categorization/crm-contract-cache.service.ts`, qisqacha)

- `lookup(contractNumber, {forceRefresh, payerHint})`: kalit `№`, `N°`, probellarsiz, katta harf; `forceRefresh` variantlar keshini o'chiradi; bir kalitga parallel so'rovlar `inflight` map bilan birlashtiriladi.
- `doLookup`: `contractVariants` (≤16) bo'yicha keshdan, `found` ustuvor (FIX B#9). Eskirish: `found=true` 24 soat (`STALE_AFTER_MS`, keyin fonda yangilanadi, eski qiymat qaytadi), `found=false` 4 soat (`NOT_FOUND_RETRY_AFTER_MS`, keyin sinxron qayta so'raladi). `found=true` va `virtual_status` NULL bo'lsa fonda `refreshVirtualStatus`.
- `fetchFromCrmAndCache`: 8 variantgacha `/show`, topilmasa `searchContracts` fallback, aks holda `found=false, last_error='Topilmadi'`. CRM javob bermasa ham `found=false` yoziladi ("topilmadi" dan farqlanmaydi).
- `payerHint` bilan keshdagi mijoz izohdagi ismga mos kelmasa yangidan aniq shartnoma qidiriladi.
- Bir martalik marker qatorlari (`found=false`, nomi `__` bilan boshlanadi, sanashda chiqarib tashlash kerak): `__BRANCH_RESET_DONE_V1__`, `__PT_SWEEP_DONE_V1__`, `__NOTFOUND_RECHECK_DELETED_V1__` (o'chirilgan shartnomalar fix'idan keyin hamma "Topilmadi" qatorlarini qayta tekshirishga belgilaydi), `__DELETED_FALLBACK_RECHECK_V3__` (soxta "o'chirilgan (crm)" qatorlarni qat'iy qoida bilan qayta tekshiradi).
- `crmMetaBackfillTick` (har daqiqa, lock): `runMetaBackfill(200)` — sotuv bo'limi (recency: so'nggi to'lovlar shartnomalari `getContractMeta` bilan; bulk `/index` page-walk; bo'sh '' yozilmaydi, faqat haqiqiy qiymat) va turi (`property_type`, `/show` `type.key`). Sentinel: NULL = tekshirilmagan, '' = tekshirildi, yo'q.
- `virtual_status` mojibake (UTF-8 baytlari CP1251 ko'rinishida keladi) `repairMojibake` bilan tuzatiladi.

Bog'liqlik: CRM to'xtasa kategoriyalash, XATO tekshiruvi, backfill, split, CRM sverka, XonPay sync, perereboska tekshiruvi to'xtaydi yoki eskirgan keshda ishlaydi.

---

### C.3 CRM sverka (`crm-sverka/`)

#### C.3.1 Vazifa

CRM to'lov tarixi (bekor qilingan shartnomalar bilan, `getPaymentHistoryAll`) ↔ `oplata_kv` ning **hamma** qatorlari, shartnoma kesimida solishtiriladi. Natija xotirada (`Snapshot`), CRM qismi DB'ga siqilgan holda saqlanadi. CRM'ga va `oplata_kv` ga yozmaydi. Frontend: `check-crm/page.tsx`, `_crm-drilldown.tsx`.

#### C.3.2 Endpointlar (`/api/crm-sverka`)

| Metod va yo'l | Ruxsat | Nima qiladi |
|---|---|---|
| POST `run?limit&timeoutMs&concurrency` | `transactions:sverka_crm_run` | fonda jonli tortish (`start`) |
| GET `ping?limit&timeoutMs` | `transactions:sverka_crm_view` | CRM javob beryaptimi (vaqt, shakl, jami) |
| GET `status` | view | progress (`phase`: idle, db, crm, compute, done, error; sahifalar, yozuvlar, `lastPageMs`) va snapshot meta |
| GET `result` | view | KPI + sahifalangan ro'yxat + facet |
| GET `facets` | view | to'lov usuli, status, obyekt, tur qiymatlari |
| GET `contract?contractNo&tolDays=3` | view | bitta shartnoma to'lovma-to'lov juftlash |
| GET `export` | view | filtrlangan natija Excel |

Filtrlar (`filtersFrom`): `q`, `methods` (CRM to'lov usuli), `ourMethods`, `crmStatuses`, `crmTypes`, `objects`, `rowStatuses`, `dateFrom`/`dateTo`, `minDiff`, `sort` (`diff`, `crm`, `our`, `contract`, `diffInitial`, `diffMonthly`), `page`, `perPage`.

#### C.3.3 Tortish (`start` → `runInBackground`)

- Bitta global run (`running` flag). Parametrlar: `limit` default 5000 (100..5000), sahifa timeouti 180 s (10..300 s), parallel 8 (1..12).
- Tartib: avval bizning baza (`fetchOurPayments`: `oplata_kv` hammasi, ixcham), snapshot darhol `partial=true` bilan ochiladi; keyin CRM sahifalari parallel paketlarda, kelgani sayin snapshot'ga qo'shiladi (foydalanuvchi natijani tortish tugashidan oldin ko'radi).
- To'xtash: bo'sh sahifa yoki so'ralgandan kam yozuv = tabiiy tugash (`complete=true`); 1-sahifa xatosi → run `error` (istisno); boshqa sahifa xatosi, sahifa imzosi takrorlanishi (CRM `page` ni e'tiborsiz qoldirsa), `MAX_RECORDS=600 000` yoki `MAX_PAGES=1000` → qisman.
- String intern (bir xil matnlar xotirada bitta nusxa).
- Snapshot DB'ga **faqat** to'liq va xatosiz bo'lsa saqlanadi (`persistSnapshot`: `settings['crmSverka.snapshot']` = gzip+base64 JSON `{v:1, builtAt, durationMs, pages, partial, crm[]}`; `our` saqlanmaydi). Qisman natija oxirgi yaxshi snapshotni buzmaydi.
- Run holati `settings['crmSverka.lastRun']` (JSON: `status` = running | done | error | crashed, `startedAt`, `actor`, `limit`, `timeoutMs`, `finishedAt`, `crmCount`, `ourCount`, `warning`/`error`).

#### C.3.4 Boot va cron

- `onModuleInit`: snapshot DB'dan tiklanadi (partial bo'lsa tiklanmaydi; `our` tomoni bazadan yangidan o'qiladi); qolib ketgan `running` → `crashed`; snapshot umuman yo'q bo'lsa 8 s dan keyin `start('avto (boot)')`.
- `@Cron(process.env.CRM_SVERKA_REFRESH_CRON || '0 7,12,17 * * *', timeZone 'Asia/Tashkent')` `autoRefresh`: run yo'q va snapshot 1 soatdan eski bo'lsa `start('avto (cron)')`.
- Diqqat: `our` (OplatyKv) tomoni faqat run yoki boot paytida o'qiladi; oradagi OplatyKv o'zgarishlari keyingi run'gacha natijada ko'rinmaydi.

#### C.3.5 Solishtirish qoidalari (`buildRows`)

- CRM to'lovi turi `crmKindOf`: `type.key` da `init`/`boshlang`/`перво` → boshlang'ich, aks holda oylik; key bo'lmasa yorliq matni bo'yicha (OplatyKv `crmSverka` bilan bir xil qoida).
- Shartnoma raqami ikkala tomonda `trim().toUpperCase()`; summalar tiyinga yaxlitlab (`cents`) solishtiriladi.
- `diff = ourTotal − crmTotal`; `diffInitial`, `diffMonthly` (bizda `first_installment`/`monthly_amount` ustunlari).
- `status`: CRM ro'yxati bo'sh → `our-only`; bizniki bo'sh → `crm-only`; |diff| < 0.01 → `ok`; aks holda `mismatch`.
- `unsplit`: bizda jami ≠ boshlang'ich + oylik (GENERAL, schetchik, bo'linmagan) — split xatosi emas, alohida belgi.
- `splitMismatch`: `ok`, `unsplit` emas va boshlang'ich yoki oylik farqi ≥ 1.
- `crmReversed` / `crmReversalSum`: CRM'dagi manfiy yozuvlar (qaytarim, storno) yig'indisi.
- Hammasi 0 bo'lgan shartnoma (jami ham, taqsimot ham) chiqariladi; net 0 bo'lsa-yu ichida harakat bo'lsa qoladi.
- Filtrlar ikkala tomonga ham qo'llanadi (obyekt, sana), usul/status/tur faqat CRM tomoniga, `ourMethods` faqat bizga.
- `contractDetail`: (1) aniq sana+summa, (2) summa bir xil, sana ±`tolDays` (`date-shift`), (3) sana bir xil, summa boshqa (`amount-diff`, eng yaqin), (4) qolganlar; manfiy CRM yozuvlari "faqat CRM'da" dan ajratiladi.

Xavf: `crmSverka.snapshot` qiymati juda katta (228k+ yozuv): uni SELECT qilma, Facts'ga berma.

---

### C.4 XonPay / Billing (`xonpay/`)

#### C.4.1 Vazifa

CRM to'lov tarixidan `payment_method` "Xon Pay" (regex `/xon\s*pay/i`) bo'lgan to'lovlarni `xonpay_transactions` ga yig'adi va har birini bank tranzaksiyasiga bog'laydi. UI: `oplatykv/billing/page.tsx` (Billing tabi), dashboard XonPay vidjeti (`/xonpay/stats/daily`, `dashboard:xonpay`). Summalar butun so'm (BigInt).

#### C.4.2 Model

`XonpayTransaction`: PK `external_id` (CRM), `xonpay_uuid` (izohdagi `XONPAY:(UUID)`), `crm_id`, `crm_uuid`, `order_id`, `contract`, `amount`, `date_paid` (`@db.Date`, UTC 12:00 bilan yoziladi — sana siljimasin), `type`, `category`, `status`, `purpose`, `full_name`, `object_name`, `is_problematic`, `is_received_from_bank` (XonPay'ning "pul bankdan keldi" belgisi), `crm_created_at`, `crm_updated_at`; moslash: `matched_tx_id` (FK `transactions`, `onDelete: SetNull`), `matched_external_id`, `matched_amount`, `matched_date`, `is_matched`, `matched_at`, `last_checked_at`, `match_method` (`uuid` yoki `zaxira`); dublikat: `is_duplicate`, `duplicate_of`. `XonpaySyncLog`: `trigger` (manual, cron), aktor, `status` (running, success, failed, cancelled), `pages`, `fetched`, `xonpay`, `inserted`, `updated`, `matched`, `errors`, `error_message`, `duration_ms`.

#### C.4.3 Cron

- Nomi `xonpay-auto-sync`, `@Cron` emas, `SchedulerRegistry` + `CronJob` (TZ Asia/Tashkent) orqali dinamik. `intervalToCron(m)`: m<60 → `0 */m 7-23 * * *`; 60 → `0 0 7-23 * * *`; aks holda `0 0 7-23/(m/60) * * *`. Faqat 07:00-23:00.
- `onModuleInit`: qolib ketgan `running` loglar → `failed` (`'Server restart — orphan running entry'`); `xonpay.cron.enabled` faqat `'false'` bo'lsa o'chiq; `xonpay.cron.intervalMinutes` (1..1440, default 60); job qayta ro'yxatga olinadi.
- `cronAutoSync`: o'chiq yoki sync ishlayotgan bo'lsa skip (sabab xotirada); `runSyncInBackground({limit: 5000, trigger: 'cron'})`.

#### C.4.4 Sync (`runSyncInBackground`)

- Log `running` bilan yaratiladi. `skipDates`: bugundan oldingi, 100% moslangan kunlar (`noSkip=true` hammasini qayta ko'radi; "bugun" UTC bo'yicha hisoblanadi).
- Sahifalar `crm.getPaymentHistory(page, 5000)` (faqat aktiv shartnomalar; `getPaymentHistoryAll` emas). Sahifa xatosi → `errors++`, `error_message` to'ladi va to'xtaydi, **istisno otilmaydi**: log `success` bo'lib qoladi (1-sahifada CRM javob bermasa ham `fetched=0` bilan `success`). Bo'sh yoki to'liq bo'lmagan sahifada tugaydi; 200 sahifa xavfsizlik chegarasi (CRM `last_page` ishonchsiz).
- Har XonPay qatori: `findUnique` → `update` yoki `create`; UUID bor bo'lsa darhol `tryMatchOne`. Qator xatosi faqat `errors++` (xabarsiz).
- Bekor qilish: `POST sync/cancel` (joriy) yoki `POST sync/history/:logId/cancel` (log bo'yicha, orfanni ham).

#### C.4.5 Moslash

- `tryMatchOne(externalId, uuid)`: UUID `transactions.description` ichida (case-insensitive `contains`), eng yangi `txn_date`. Summa solishtirilmaydi, bank filtri yo'q. Topilsa `matched_*`, `is_matched=true`. `match_method` bu yerda yozilmaydi.
- `runMatchInBackground` (`POST match-all?onlyUnmatched`): hamma (yoki faqat moslanmagan) qatorlar ketma-ket, keyin `markDuplicates`. Har qator `description LIKE` qidiruv: katta hajmda og'ir.
- `markDuplicates` (`POST admin/mark-duplicates`): CRM bitta XonPay to'lovini ikki marta yozadi (initsiatsiya: `external_id` = UUID, izoh bo'sh; bankdan kelgani: kompozit ID, izohli). Juftlik sharti: `crm_created_at`, summa va shartnoma aynan teng, initsiatsiya ID'si UUID ko'rinishida, juftiniki emas, juft moslangan. Hech narsa o'chirilmaydi, `is_duplicate=true`, `duplicate_of`.
- Zaxira moslash (izohi bo'sh to'lovlar): `GET admin/zaxira-match/nomzodlar` (dry-run ro'yxat) va `POST admin/zaxira-match`. Juftlash `contract_number` + aniq summa + `txn_date` ∈ `date_paid ± 20 kun`; himoyalar: `is_received_from_bank=true`, 3 kundan eski, tx boshqa XonPay'ga bog'lanmagan, moslik ikki tomonlama yagona. Natija `match_method='zaxira'`. Avtomatik chaqirilmaydi (faqat foydalanuvchi tasdig'i bilan).

#### C.4.6 Endpointlar (`/api/xonpay`)

| Metod va yo'l | Ruxsat | Nima qiladi |
|---|---|---|
| POST `sync?limit&noSkip`, `sync/cancel`, `sync/history/:logId/cancel` | `crm:view` | sync boshqaruvi |
| GET `sync/status`, `sync/history?limit&q&status&dateFrom&dateTo`, `cron/info`, `cron/ping`, `match/status`, `admin/cleanup-orphans/status`, `admin/zaxira-match/nomzodlar`, `stats/daily?dateFrom&dateTo` | `crm:view` | holat, tarix, statistika |
| POST `cron/toggle?enabled`, GET `cron/toggle?enabled` (GET ham yozadi), POST `cron/interval?minutes` | `crm:view` | `settings` ga yozadi va job'ni qayta ro'yxatga oladi |
| GET `/` (`page`, `perPage`, `dateFrom`, `dateTo`, `matched`, `received`, `duplicate` default `hide`, `olderThan`, `q`, `contract`) | `crm:view` | ro'yxat |
| GET `export.xlsx` (shu filtrlar) | `crm:view` | Excel, 100 000 qatorgacha |
| POST `match-all?onlyUnmatched`, `:externalId/recheck`, `admin/mark-duplicates`, `admin/zaxira-match` | `crm:view` | moslash (oxirgi ikkisi yozadi, lekin faqat `crm:view`) |
| POST `admin/truncate`, `admin/cleanup-orphans?dryRun`, `admin/fix-date-shift` | `xonpay:manage` | destruktiv |

`dailyStats`: `date_paid` bo'yicha jami, moslangan, qolgan; dublikatlar alohida (jamiga ham, qolganga ham kirmaydi).

Destruktiv amallar: `truncateAll` (`TRUNCATE xonpay_transactions CASCADE`, qaytmas; bank tx'lariga tegmaydi); `cleanup-orphans` (CRM'dagi XonPay `external_id` larini 200 sahifagacha yig'ib, DB'da bo'lib CRM'da yo'qlarini o'chiradi; `dryRun` default true; CRM sahifasi o'qilmasa `break`, shunda ko'p qator soxta orfan bo'ladi — avval dryRun); `fixDateShift` (hamma `date_paid` + 1 kun, guard yo'q, bir martalik edi, qayta chaqirilsa sanalar buziladi).

Bog'liqliklar: `xonpay_transactions` → `crm.service.ts::applyXonpayMatches` (XATO → CRM, `bulkCrmFix`); `XONPAY_UUID_RE` ikki joyda (xonpay.service va crm.service) bir xil bo'lishi kerak; `xonpay.cron.*` kalit nomlari leader-health, Facts va Checker'da ishlatiladi. Cron va sync holati xotirada.

---

### C.5 Google eksport (`google-export/`)

#### C.5.1 Vazifa va fayllar

Admin > Export sahifasi (`frontend/app/[locale]/(panel)/admin/export/page.tsx`): (1) Google Sheets'ga `oplata_kv` yoki `transactions` qatorlarini yozish (qo'lda yoki cron); (2) Autsourcing: tanlangan shartnomalar Excel'ini Telegram guruhga; (3) 10 formatda fayl yuklab olish. SHMITD alohida modul (C.6).

| Fayl | Rol |
|---|---|
| `google-export.service.ts` | `run`, `upsertRows`, `runAndLog`, `exportSheetsCronTick`, `autsourcingCronTick`, `sendAutsourcing`, `downloadData`, `readContractsPayments`/`readContractPayment`/`listSheetSources` (chek-order uchun, faqat o'qish) |
| `google-export.plan.ts` (+ spec) | `planUpsertRows` (sof) |
| `google-export.retry.ts` (+ spec) | `isTransientGoogleError`, `withRetry`, `formatExportFailureAlert` |
| `data-formats.ts` | `FORMATS`: `json`, `csv`, `xlsx`, `sql-mysql`, `sql-postgres`, `txt`, `xml`, `html`, `md`, `yaml`; `serialize` |
| `google-export.controller.ts` | `/api/google-export/*` |

#### C.5.2 Konfiguratsiya (`settings['export.sheets']`, JSON massiv `SheetTarget`)

`id`, `name`, `source` (`oplatakv` default yoki `transaction`), `spreadsheetId` (to'liq link ham qabul qilinadi, ID ajratiladi), `tabName`, `startRow`, `dateFrom` (→ bugun Toshkent), `filter` (`objects`, `categories` MONTHLY/FIRST/GENERAL, `txTypes`, `amountSign` pos/neg; tranzaksiya manbasi uchun `accounts`), `writeMode` (`replace` default yoki `upsert`), `keyField`, `lastRowColumn`, `cron` (`enabled`, `everyMinutes` default 60, `hourFrom`, `hourTo`, `days` 0=yakshanba), `columns[] {col: 'A'..'ZZZ', field}`.

Maydonlar: OplatyKv `FIELD_KEYS` = id, contractNo, date, paymentAmount, firstInstallment, monthlyAmount, paymentCategory, object, client, txType, paymentMethod, purpose, note; tranzaksiya `TX_FIELD_KEYS` = externalId, id, accountNo, bankName, txnDate, amount, direction, fromName/Account/Inn, toName/Account/Inn, description, contractNumber, category, subcategory, docNumber, reference.

`cellValue`: sana `dd.MM.yyyy`; summalar **ishora bilan** (ilgari `Math.abs` bo'lib qaytarim tushumga qo'shilib ketardi); kategoriya ruscha yorliq; XATO shartnoma o'rniga "XATO". Yozishda `valueInputOption: 'USER_ENTERED'`.

Tarixiy bug (2026-08): global `ValidationPipe` (whitelist+transform) nested `filter` ni qirqardi va filtr saqlanmasdi; yechim `saveConfig(@Body() body: any)`. DTO'ga qaytarmang. `saveConfig` log'ida kelgan va saqlangan obyekt filtri soni solishtiriladi.

#### C.5.3 Credential tartibi

`resolveCreds`: (1) env `GOOGLE_SA_JSON`; (2) env `GOOGLE_SA_KEYFILE` (fayl yo'li); (3) `settings['export.credentials']` (UI'dan paste qilingan, AES-256-GCM shifrlangan). `private_key` dagi `\n` literal haqiqiy qatorga aylantiriladi. Jadval service account `client_email` bilan share qilinishi shart. `POST credentials` faqat `client_email` va `private_key` bor JSON'ni qabul qiladi, javobda `clientEmail`, `projectId`.

#### C.5.4 `run(target)` bosqichlari

`auth` → `validate` (ID, tab, kamida bitta mapping) → `fetch` (`oplataKv.getRowsForExport` yoki `transactions.getRowsForExport`) → `write` → (`clear`). Xatoda `{ok:false, step, error}`.

- `getRowsForExport` (OplatyKv): sana, obyekt (`in`, DB'dagi **aynan** qiymat, trim qilinmaydi), kategoriya, tip, `amountSign`; tartib sana o'sish, `take` default 100 000 (max 200 000). Katta oraliqda eng yangi qatorlar tushib qoladi. Har qatorga `crmXato` (`computeContractXato`).
- **replace**: xavfsiz tartib — avval yozish (`ensureGrid` grid'ni kengaytiradi, "exceeds grid limits" oldi olinadi), keyin faqat yozilganidan pastdagi qoldiq tozalanadi (ilgari avval tozalab keyin yozilardi, Google 503 bersa sheet bo'sh qolardi). Grid, yozish va tozalash `withRetry` bilan (2 s, 5 s, 15 s; 408/429/5xx va tarmoq xatolari; 4xx qayta urinilmaydi). Kalitlar `export.upsertKeys.<id>` ga va `row.id` lar `export.writtenIds.<id>` ga saqlanadi (keyingi upsert va API jamoasi uchun).
- **upsert**: jadvalni tozalamaydi. `A{startRow}:maxCol` bir marta o'qiladi; `planUpsertRows(existing, payIdxs, keyIdx, 200)`: birinchi uzluksiz to'lov bloki oxiri (`anchorLen`; 200 dan katta to'lovsiz bo'shliq = blok tugadi; pastdagi bron/formula va "stray" qatorlar e'tiborsiz) va faqat shu blokdagi kalitlar. Mos kalit → shu qator yangilanadi; yangi → blokdan keyin qo'shiladi; avval export o'zi yozgan (`prevKeys`) va endi DB'da yo'q kalit → mapping ustunlari tozalanadi; qo'lda qo'shilgan qatorlarga tegilmaydi. Ketma-ket hujayralar bitta diapazonga guruhlanadi. `keyField` default birinchi ustun maydoni. `lastRowColumn` hozir faqat log'da (koddagi default 'H', izohda 'F'). upsert'da retry yo'q. Tarixiy bug (2026-08): yangi qator bron zonasiga yozilardi, `planUpsertRows` bilan tuzatilgan.
- upsert jadvalni tozalamagani uchun filtr o'zgarsa eski qatorlar qolib "filtr ishlamaydi" ko'rinadi; toza natija = replace.

#### C.5.5 `runAndLog`, cron, ogohlantirish

- `runAndLog(target, mode, triggeredBy)` → `run` → `export_cron_logs` ga yozuv (`sheet_id`, `sheet_name`, `source`, `write_mode`, `mode` cron|manual, `status` ok|error, `rows_fetched`, `rows_written`, `duration_ms`, `error`, `triggered_by`; `started_at` amalda run tugagan payt). Faqat cron yiqilsa `notifyExportFailure`.
- `notifyExportFailure`: env `EXPORT_ALERT_ENABLED` ('0' = o'chiq), token `EXPORT_ALERT_BOT_TOKEN` → `LEADER_BOT_TOKEN`, chat `EXPORT_ALERT_CHAT_ID` → `LEADER_TG_ID`; sheet uchun soatiga bir marta (xotirada throttle); matn `formatExportFailureAlert` (bosqich, xato, sheet holati izohi).
- `exportSheetsCronTick` (har daqiqa): `cron.enabled` sheetlar; Toshkent soati va hafta kuni; `hourFrom`/`hourTo` ikkalasi ham **kiradi** (soat > hourTo bo'lsa skip); `everyMinutes` intervali xotiradagi `cronLastRun[sheetId]` bo'yicha (restartdan keyin oynada birinchi tick'da hamma cron sheet ishga tushadi). Sheetlar ketma-ket, servis darajasida qulf yo'q.
- `POST run` (`export:run`): **body'dagi** `target` ishlatiladi (frontend joriy, saqlanmagan bo'lishi mumkin bo'lgan sozlamani yuboradi), `triggeredBy = manual:<aktor>`. Cron va agent-bridge esa saqlangan konfiguratsiyani ishlatadi; agent-bridge'da alohida "bir vaqtda bitta" (409) qulf bor.

#### C.5.6 Endpointlar (`/api/google-export`)

| Metod va yo'l | Ruxsat | Nima qiladi |
|---|---|---|
| GET `config`, `distinct-filters`, `upsert-keys?sheetId`, `cron/logs?page&pageSize&sheetId&dateFrom&dateTo&status` | `export:view` | config (credential holati bilan), obyekt/tip dropdownlari, oxirgi yozilgan ID'lar (`writtenIds`, bo'lmasa `upsertKeys`), log |
| PUT `config` `{sheets}` | `export:manage` | `saveConfig` |
| POST `credentials` `{json}`, DELETE `credentials` | `export:manage` | SA JSON'ni shifrlab saqlash/o'chirish |
| POST `test` | `export:view` | credential va har jadvalga ruxsat |
| POST `preview-count` `{target}` | `export:view` | `countForExport` (filtrlangan va faqat sana bo'yicha soni), yozmaydi |
| POST `run` `{target}` | `export:run` | `runAndLog('manual')` |
| GET `download?dataset=oplatykv|transactions&format=` | `export:download` | `downloadData` (OplatyKv dataset = `getRowsForExport({})`, ya'ni 100 000 qator chegarasi) |
| GET/PUT `autsourcing/config`, POST `autsourcing/send` | `export:autsourcing` | autsourcing |

#### C.5.7 Autsourcing

Kalitlar: `autsourcing.botToken` (shifrlangan; javobda faqat oxirgi 4 belgi `tokenHint`), `autsourcing.groupId`, `autsourcing.columns` (JSON, `OPLATA_COLS` kalitlari), `autsourcing.contracts` (JSON), `autsourcing.dateFrom`, `autsourcing.cronEnabled` ('1'), `autsourcing.cronTime` (HH:MM). `sendAutsourcing(contracts, columns, dateFrom)`: shartnomalar bo'yicha `oplata_kv` (dateFrom → bugun), tanlangan ustunlardan Excel, Telegram guruhga hujjat. `autsourcingCronTick` har daqiqa, aniq HH:MM da kuniga bir marta (xotiradagi oy kuni bo'yicha). Log jadvali yo'q.

Bog'liqliklar: `export.sheets` tuzilmasini `chek-order.service.ts` (`readContractsPayments`) ham o'qiydi; `export.writtenIds.*` qiymatlari `oplata_kv.id` (= `/api/v1/oplata-kv/changes` kaliti); Facts `google_export` `export_cron_logs` ni o'qiydi; bot `agents/eksport.py` `agent-bridge` orqali `runAndLog` ni chaqiradi. Retention yo'q.

---

### C.6 SHMITD (`shmitd/`)

Vazifa: Google Sheet'dagi Shmidt bolg'asi sinov natijalarini sana bo'yicha filtrlab HTML hisobot yasaydi va Telegram guruhga hujjat sifatida yuboradi (Python skriptdan ko'chirilgan).

| Kalit | Ma'nosi |
|---|---|
| `shmitd.botToken` | shifrlangan; javobda faqat `tokenHint` |
| `shmitd.groupId` | Telegram guruh |
| `shmitd.spreadsheetId`, `shmitd.sheetName` (default `SHMITD`) | manba |
| `shmitd.saJson` | alohida SA (shifrlangan); bo'lmasa env `GOOGLE_SA_JSON` (`GOOGLE_SA_KEYFILE` va `export.credentials` bu yerda ishlatilmaydi); scope readonly |
| `shmitd.dateOffset` | default -1 (kecha); bo'sh satr saqlangan bo'lsa 0 (bugun) bo'lib qoladi |
| `shmitd.cronTimes` | "HH:MM" ro'yxati (vergul bilan) |
| `shmitd.enabled` | '1' |

`buildReport`: 1-qator sarlavha; A ustuni bo'sh qatorlar tashlanadi; G (indeks 6) = maqsad sana (`dd.MM.yyyy`, Toshkent + offset); rang: K > L va J < L → sariq; J > L → qizil.

`sendNow(triggeredBy)`: token yoki guruh yo'q → xato qaytadi, **log yozilmaydi**. Qator yo'q → guruhga matn ("На данную дату результаты измерений отсутствуют...") va log `empty` (bu xato emas, o'lchov bo'lmagan; Telegram xatosi bu holda yutiladi). Bor → HTML (`SHMITD_<sana>.html`) `sendDocument`, log `sent` (`html_content` ≤900 000 belgi, `total/yellow/red_count`, `group_id`). Istisno → log `error`.

`cronTick` (har daqiqa): `enabled='1'` va Toshkent HH:MM `cronTimes` da bo'lsa, xotiradagi kalit bilan daqiqada bir marta.

Endpointlar (`/api/shmitd`): GET `config` (`export:view`), PUT `config` (`export:manage`), POST `send` (`export:run`), GET `history?page&perPage&from&to&date` (`export:view`; `targetAt` bo'yicha, eski yozuvlar bir marta backfill), GET `history/:id/html` (`export:view`). `ShmitdLog` ning `html_content` va `group_id` Facts'ga berilmaydi.

---

### C.7 Vznos — "Взнос от имени клиента" (`vznos/`)

Vazifa: kompaniyaning **o'z** shartnomalari reestri (o'zimiz to'laydiganlar, odatda CRM'da yo'q). Shu shartnomalar bo'yicha tushgan to'lovlar obyekt tushumiga kirmaydi. UI: `vznos/page.tsx` (Tranzaksiyalar sub-tabi, `transactions-tabs.tsx`).

Model `VznosContract` (`vznos_contract`): `contract_no`, `project_name`, `contract_date`, `contract_value`, `full_name`, `apartment_area`, `apartment_no`, `floor`, `block`, `terrace_area`, `virtual_status`, `comment`, `in_crm`, `status` (active, cancelled), bekor maydonlari, `transfer_to_contract_no`.

| Metod va yo'l (`/api/vznos`) | Ruxsat | Nima qiladi |
|---|---|---|
| GET `/` (`q`, `project`, `status`, `page`, `perPage` ≤100) | `vznos:view` | ro'yxat; har qatorga `paid` (`oplata_kv.payment_amount` yig'indisi shartnoma bo'yicha) va `remaining` |
| GET `stats?project` | view | faqat aktivlar: soni, qiymat, to'langan, qoldiq, foiz |
| GET `objects` | view | `oplata_kv` dagi obyekt nomlari (500) |
| GET `crm-lookup?contractNo` | view | kesh + jonli `/show` dan prefill (xonadon `info`, mijoz, narx, sana, `virtual_status`) |
| POST `/` | `vznos:manage` | `create`: aktiv dublikat taqiq; keshdan to'ldirish; keyin `recategorizePayments` |
| PATCH `:id` | manage | maydonlarni yangilaydi (to'lovlarga tegmaydi) |
| DELETE `:id` | manage | reestr yozuvini o'chiradi; `txType` va `xatoHidden` **qaytarilmaydi** |
| POST `:id/cancel` `{transferToContractNo, reason}` | manage | maqsad reestrda aktiv bo'lishi shart; shu shartnomaning **barcha** `oplata_kv` qatorlari `contractNo = maqsad`, `txType = Взнос от имени клиента`; status `cancelled` |

`recategorizePayments(contractNo)`: `oplata_kv.tx_type = 'Взнос от имени клиента'` (`VZNOS_TX_TYPE`) va manba tranzaksiyalarda `xato_hidden = true` (XATO ro'yxatidan yashirish). History yozilmaydi.

Xavf: `syncFromTransactions` mavjud qatorda `txType` va `contractNo` ni tranzaksiya qiymatiga qaytaradi, shuning uchun Vznos o'zgarishlari (tranzaksiya subkategoriyasi/shartnomasi boshqa bo'lsa) keyingi sync'da yo'qolishi mumkin (C.1.4). Obyekt hisoboti `от имени` qatorlarini chiqarib tashlaydi; kunlik xulosa jamilari esa ularni chiqarib tashlamaydi (faqat top-obyektlar ro'yxati `byObject` orqali chiqaradi).

---

### C.8 Attachments — tranzaksiya fayllari (`attachments/`)

Vazifa: tranzaksiyaga ariza, hujjat, rasm biriktirish. Arizali qo'lda shartnoma OplatyKv'da `contractSource='ariza'` bo'lib ko'rinadi (C.1.7), ya'ni attachment o'chirilsa manba `manual` ga o'tadi.

- Saqlash: `UPLOADS_DIR/attachments/<txId>/<attId>__<safeName>`; DB `transaction_attachments` (`type` default `ariza`, `filename`, `mime_type`, `file_size`, `storage_path`, `contract_number`, `notes`, `uploaded_by` = email). Max 25 MB, bo'sh fayl taqiq; nom xavfsiz belgilarga tozalanadi.
- Har yuklash/o'chirishda `transaction_category_history` ga `action='attachment'` yozuvi.
- Telegram: `uploaded`, `approved`, `deleted` (fayl bilan; rasm `sendPhoto`, boshqa `sendDocument`); env `TG_BOT_TOKEN`, chat `ATTACHMENTS_NOTIFY_CHAT` → `DEPLOY_NOTIFY_CHAT` → koddagi eski hardcoded default; havola `APP_URL/uz/transactions?id=...`. Boot'da chat ID qiymati log'ga yoziladi. `upload(..., {notify:false})` (correction moduli: ariza yuborilganda emas, tasdiqlanganda `notifyApproved` xabar beradi).

| Metod va yo'l (`/api/transactions/:txId/attachments`) | Ruxsat | Nima qiladi |
|---|---|---|
| GET `/` | `transactions:view` | ro'yxat |
| POST `/` (file, `type`, `contractNumber`, `notes`) | `categories:manage` | yuklash |
| GET `:attId/download` | `transactions:view` | stream |
| DELETE `:attId` | `categories:manage` | diskdan va DB'dan o'chirish |

`source='ALOQA_BANK'` (Excel import) tranzaksiyalarda yuklash/o'chirish bloklangan (`assertEditable`, read-only). Barcha arizalarni ZIP qilish OplatyKv'dagi `GET oplata-kv/export/arizas-zip` da.

---

### C.9 Customers / Contracts (`customers/`, `contracts/`)

Umumiy (legacy) mijoz va shartnoma moduli: `Customer` (INN, PINFL, bank hisobi), `Contract` (avto raqam, `customer_id`, `total_amount`, bosqichlar `ContractStage`, `Payment`), `recalcStage`/`recalcContract`, mijoz statistikasi (shartnomalar jami, to'langan, qarz). Endpointlar: `/api/customers` (`customers:view`/`customers:manage`), `/api/contracts` (`contracts:view`/`contracts:manage`), oddiy CRUD. OplatyKv, CRM keshi yoki XonSaroy CRM bilan **bog'lanmagan** (bu shartnomalar kvartira shartnomalari emas).

---

### C.10 Setting kalitlari va env jamlanmasi (faqat nomlar)

| Kalit | Kim yozadi | Kim o'qiydi |
|---|---|---|
| `oplatykv.txMinDate`, `oplatykv.txAutoSyncMinutes`, `oplatykv.dayStart`, `oplatykv.dayEnd`, `oplatykv.nightStart`, `oplatykv.nightEnd`, `oplatykv.autoXatoCleanup` | `PATCH /api/sync/settings` (`sync:run`; o'qish `GET /api/sync/settings`, `sync:view`) | `autoSyncTick`, `sync-now`; Facts `oplatykv_sync`, Checker `_check_oplatykv_sync` (kalit nomi o'zgarsa `support_facts.py`, `checker_worker.py` ham) |
| `oplatykv.syncXatolar` | `syncFromTransactions` | bot Checker |
| `schotchik.auto`, `schotchik.dateFrom`, `schotchik.dayStart`, `schotchik.dayEnd`, `schotchik.intervalMin` | `POST oplata-kv/schotchik-config` | `schotchikAutoTick` |
| `perereboska.aiEnabled`, `.aiModel`, `.strict`, `.tgNotify`, `.nameCheck`, `.showReverse` | `POST oplata-kv/perereboska-settings` | perereboska |
| `agent.aiKey` (shifrlangan), `agent.aiModel` | agent moduli | perereboska AI |
| `crmSverka.lastRun`, `crmSverka.snapshot` | crm-sverka | crm-sverka, Facts |
| `xonpay.cron.enabled`, `xonpay.cron.intervalMinutes` | xonpay | xonpay `onModuleInit`, leader-health, Facts |
| `export.sheets`, `export.credentials`, `export.upsertKeys.<sheetId>`, `export.writtenIds.<sheetId>` | google-export | google-export, chek-order, agent-bridge |
| `autsourcing.botToken`, `.groupId`, `.columns`, `.contracts`, `.dateFrom`, `.cronEnabled`, `.cronTime` | google-export | google-export |
| `shmitd.botToken`, `.groupId`, `.spreadsheetId`, `.sheetName`, `.saJson`, `.dateOffset`, `.cronTimes`, `.enabled` | shmitd | shmitd |

Env: `UPLOADS_DIR`, `APP_URL`, `TG_BOT_TOKEN`, `ATTACHMENTS_NOTIFY_CHAT`, `DEPLOY_NOTIFY_CHAT`, `ANTHROPIC_API_KEY`, `XONSAROY_API_URL`, `XONSAROY_CLIENT_BASE`, `XONSAROY_API_KEY`, `XONSAROY_API_SECRET`, `XONSAROY_S3_BASE`, `XONAPP_MYSQL_*`, `CRM_SVERKA_REFRESH_CRON`, `GOOGLE_SA_JSON`, `GOOGLE_SA_KEYFILE`, `EXPORT_ALERT_ENABLED`, `EXPORT_ALERT_BOT_TOKEN`, `EXPORT_ALERT_CHAT_ID`, `LEADER_BOT_TOKEN`, `LEADER_TG_ID`. Sir qiymatlari faqat server `.env` da; git'ga, hujjatga, javobga chiqarilmaydi.

---

### C.11 Xavfli joylar, tuzoqlar va ochiq savollar

1. **Tombstone bo'shliqlari:** `deletePerereboskaGroup` history'siz hard delete qiladi, `cleanupSplitsForXatoContracts` raw SQL `updated_at` ni yangilamaydi. Ikkalasi ham `/api/v1/oplata-kv/changes` iste'molchisida eskirgan ma'lumot qoldirishi mumkin (2026-08-18 dagi "o'chirish hech qachon tushib qolmasin" qoidasiga zid).
2. **Ruxsat nomuvofiqliklari:** yozuvchi `POST crm-status/reset-empty`, `repair-mojibake`, `crm-meta/backfill` faqat `oplatakv:view`; `GET debug-xato-splits` yozadi; XonPay `admin/zaxira-match`, `admin/mark-duplicates`, `cron/toggle` (GET ham) faqat `crm:view`; qator o'chirish (`DELETE oplata-kv/:id`) va import legacy `oplatakv:manage` talab qiladi (`oplatakv:delete`, `oplatakv:import` ishlatilmaydi); `GET perereboska-settings` Telegram chat ID'ni qaytaradi; `export/arizas-zip` barcha arizalarni `oplatakv:view` bilan beradi.
3. **`cleanupXatoContracts`**: CRM'da tasdiqlanmagan hamma tx-manba qatorlarni (qo'lda/ariza shartnomalarni ham) o'chiradi. Avtomatik emas, lekin bir tugma bilan katta yo'qotish.
4. **Ikki XATO ta'rifi** (`buildXatoFilter` ↔ `computeContractXato`) qo'lda shartnoma (kesh yo'q) va `xatoHidden` bo'yicha farq qiladi: ro'yxat soni va qator belgisi bir-biriga to'liq mos kelmasligi mumkin.
5. **Sync va split invarianti:** sync summa/shartnomani yangilaganda split ustunlari qayta hisoblanmaydi; batch split bir xil sanadagi oldingi qatorlarni running summaga qo'shmaydi.
6. **Sync qaytaruvchi ta'siri:** Vznos `txType`/`contractNo` o'zgarishlari va tx tarafidagi farqlar keyingi sync'da qaytadi (kunduz oxirgi 1000 tx, tunda hammasi).
7. **Xotiradagi holatlar** (restartda yo'qoladi): auto-sync vaqtlari, bg-status, reverify holati, import preview keshi, CRM global indeksi, XonPay sync/cron holati, eksport `cronLastRun` va ogohlantirish throttle, SHMITD/autsourcing oxirgi run kaliti. Ko'p instansiyada bu flaglar bo'linmaydi (aniq emas: deploy bitta instansiya deb taxmin qilinadi).
8. **Og'ir so'rovlar:** `buildXatoFilter` (butun `found=true` ro'yxati), `findOrphanTxRows`, `getRowsForExport`, `splitInstallments` (har shartnoma uchun jonli `/show`), XonPay `match-all` (`description LIKE`), CRM sverka to'liq tortish. Agent/bot bularni chaqirmasligi kerak.
9. **XonPay sync `success`** to'liq sync degani emas: `errors`, `fetched`, `error_message` ni ham tekshiring.
10. **Server soatiga bog'liqlik:** `dailySummary`, obyekt hisobotidagi `T23:59:59.999` lokal vaqt bilan parse qilinadi; `toTashkentDateOnly` va cron oynalari esa qo'lda UTC+5.
11. **CRM o'chirilgan shartnomalar** faqat to'lovlar tarixidan tiklanadi (grafiksiz): ular uchun musbat to'lov split qilinmaydi, faqat qaytarim grafiksiz taqsimlanadi. Bu qoidalar 10.10.2026 da qo'shilgan, yangi.
12. **Planirovka:** `contractMedia` `/index` `plan_images` orqali ishlaydi; amalda CRM har shartnoma uchun bu maydonni berishi aniq emas (avvalgi kuzatuvlarga ko'ra admin API kutilgan edi).
13. **`agentNotifiedAt`** hech qayerda yozilmaydi, shuning uchun "kutilayotgan XATO" soni amalda barcha XATO qatorlar soniga teng (Facts ham shu ustunni o'qiydi).
14. **`findByContract` meta** (Akt sverka sarlavhasi) eng eski qatordan olinadi va `firstDate`/`lastDate` teskari.

## D. XATO to'lovlar, arizalar, chek va agent backendlari

Bu bo'lim backend'ning "XATO to'lovni tuzatish", "ariza", "chek/order tekshiruvi" va "agentlar uchun backend" qismlarini to'liq tasvirlaydi. Manba: `backend/src/` kodi (2026-10-10 holati), `agents/knowledge/xato.md`, `tuzatish.md`, `chek_order.md`, `chek.md`, `agentlar.md`. Ziddiyat bo'lsa kod to'g'ri.

Asosiy atamalar:
- **XATO to'lov** = `oplata_kv` qatori, `source_tx_id` bor, `contract_no` `crm_contracts` dagi `found=true` raqamlarga ANIQ mos emas, manba tranzaksiya `xato_hidden` emas (`OplataKvService.buildXatoFilter`). `is_contract_manual` hisobga olinmaydi.
- **Ariza** = `xato_correction_requests` yozuvi: kimdir XATO to'lovga to'g'ri shartnoma taklif qiladi (odatda fayl bilan), keyin xodim yoki AI tekshiruvchi tasdiqlaydi yoki rad etadi.
- **AI tekshiruvchi** = `correction/agent-ai.service.ts` (Claude vision). Ko'rinadigan nomi sozlamadan: `agent.aiName` (default `AI Agent`).
- **TR Support** = Python bot (`agents/`) egasining buyrug'i bilan to'lovni tahrirlaydigan backend qatlami (`tr-support/`), bot unga `agent-bridge/` orqali ulanadi.

### D.0 Modullar xaritasi

| Modul (`backend/src/`) | Vazifa | Holat | Cron / fon | Tashqi |
|---|---|---|---|---|
| `correction/` | Ariza oqimi (yaratish, tasdiq, rad, yashirish) + AI tekshiruvchi | faol | `AgentAiService.tick` har daqiqa (interval bilan) | Claude Messages API, Telegram (guruh xabari) |
| `agent/` | Kunlik XATO digest, public XATO ro'yxati (Telegram login_url yoki maxfiy kalit), AI boshqaruvi API | faol | `AgentService.tick` har daqiqa (kuniga 1 marta yuboradi) | Telegram |
| `correction-bot/` | Alohida Telegram tuzatish boti (Claude bilan suhbat + inline tugma) | sozlamaga bog'liq (`corrbot.enabled`) | long-polling tsikli (`onModuleInit`) | Telegram, Claude |
| `tr-support/` | TR Support: to'lov tahriri, harf farqi, XATO ulash, ariza, ma'lumot, perebroska, eski tarix + panel tabi | faol | yo'q (backfill fonda) | CRM faqat o'qish (`CrmContractCacheService.lookup`, `forceRefresh`), Claude (perebroska tahlili, OplataKv servisi orqali), bank API (backfill, SyncService orqali) |
| `agent-bridge/` | Python bot uchun ichki loopback HTTP ko'prik | `AGENT_BRIDGE_KEY` bo'lsa ochiq | yo'q | Google Sheets (faqat `exports/:id/run`) |
| `chek-order/` | Memorial order / kvitansiya tekshiruvi, Chek payment, AI yordamchi, murojaatlar, Telegram Mini App | faol | yo'q | Claude vision, Telegram, Google Sheets (o'qish), CRM (o'qish) |
| `chek/` | "Shartnoma nazorati" (`/chek`): kontrolyor jurnali + Telegram guruh xabari | faol | `ChekService.notifyCron` har daqiqa | Telegram, Xon HR API, CRM (o'qish) |
| `agent-team/` | Admin > Agent > "Agent Support" tabi: Python bot `agents` sxemasini kuzatish | faol (faqat o'qish + bitta toggle) | yo'q | fayl tizimi (`agents/state`, `agents/memory`, bot env fayli) |
| `leader/` | Eski v1 NestJS Leader boti (Claude Messages API) | `app.module.ts` da ulangan, lekin env bilan o'chiriladi | `leaderAlerts` har 15 daq, Teacher 22:30 | Telegram, Claude |

Umumiy oqim (XATO):
```
bank sync -> transactions -> OplatyKv sync -> oplata_kv (contract_no CRM'da yo'q = XATO)
  |-> kunlik digest (agent.tick) -> guruhga "N ta" + "Ro'yxat" tugma -> /uz/xato-list (public)
  |-> xato-list / panel / TR Support bot -> ariza (CorrectionService.persistRequest)
  |       -> AI tekshiruvchi (AgentAiService.processRequest) -> approve | reject | needs_review
  |       -> xodim panelda approve/reject
  |-> approve -> CategorizationService.setContractManual -> transactions + oplata_kv sinxron
  |-> TR Support (bot) -> harf farqi (tasdiqsiz) | XATO ulash (tasdiq bilan) | xatoQoladi
  |-> correction-bot (inline tugma) -> OplataKvService.botAssignContract (ariza'siz!)
  |-> panel "XATO -> CRM" (oplata-kv moduli, bu bo'limda emas)
```

---

### D.1 `correction/` — ariza oqimi (CorrectionService)

**Fayllar:** `correction.controller.ts` (REST `/api/correction`), `correction.service.ts` (oqim), `agent-ai.service.ts` (AI, D.2 da), `correction.module.ts` (importlar: `CategorizationModule`, `AttachmentsModule`, `CrmModule`, `OplataKvModule`; eksport: `CorrectionService`, `AgentAiService`).

**Prinsip (fayl sarlavhasidagi izoh):** 2 bosqichli: yuborish (`pending`) -> tasdiqlovchi to'g'rilaydi (shartnoma + kategoriya + ariza fayli) -> `approved`. Kodning o'zi hech narsani avtomat tasdiqlamaydi; avtomat tasdiqni faqat AI tekshiruvchi (D.2) `approve()` ni chaqirib qiladi.

**DB:** `xato_correction_requests` (Prisma `XatoCorrectionRequest`): `tx_id` (Transaction.id, FK yo'q), `oplata_kv_id`, `proposed_contract_no`, `note`, `status` (`pending`|`approved`|`rejected`), `source` (`telegram`|`web`|`app`), `submitted_by_name/_chat_id/_id`, `submitted_at`, `reviewed_by_id/_name/_type` (`agent`|`user`), `reviewed_at`, `reject_reason`, `agent_state` (`processing`|`needs_review`|`done`), `agent_reason`, `agent_at`, `applied_contract_no`, `category_id/_name`, `sub_category_id/_name`, `attachment_id/_name`, `snap_*` (amount, date, client, object, contract_no, tx_type, purpose, external_id). Indekslar: status, txId, submittedAt, oplataKvId. Shuningdek yoziladi: `transactions.xato_hidden`, `transaction_category_history` (`action='xato-hide'`), `transaction_attachments` (AttachmentsService orqali).

**Endpointlar** (hammasi `JwtAuthGuard + PermissionsGuard`):

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/correction/stats` | `transactions:view` | `{pending, approved}` soni |
| GET | `/api/correction/pending?q&page&perPage` | `transactions:view` | `listPending` (perPage <= 200, `submittedAt desc`) |
| GET | `/api/correction/approved?q&from&to&actor&flow&actorType&page&perPage` | `transactions:view` | `listApproved` (`reviewedAt` oralig'i, `flow=in/out` = `snapAmount` ishorasi, `actorType=agent/user`) |
| GET | `/api/correction/rejected?...` | `transactions:view` | `listApproved({status:'rejected'})` |
| POST | `/api/correction` | `categories:manage` | `createRequest` (`source='app'`, FAYLSIZ: AI bu arizani hech qachon olmaydi) |
| POST | `/api/correction/:id/approve` (multipart `file`) | `categories:manage` | `approve` — shartnoma + (ixtiyoriy) kategoriya + fayl |
| POST | `/api/correction/:id/reject` | `categories:manage` | `reject(reason)` |
| POST | `/api/correction/clear` | `categories:manage` | `clearRequests` — env `ADMIN_ACTION_PASSWORD` paroli bilan arizalarni DB'dan o'chiradi |
| POST | `/api/correction/hide` | `categories:manage` | `setHidden(txId, hidden)` — XATO ro'yxatidan yashirish/qaytarish |
| POST | `/api/correction/direct` (multipart `file` majburiy) | `categories:manage` | `directCorrect` — ariza yaratadi va darhol tasdiqlaydi (guruhga xabarsiz) |

Audit: `MODULE_MAP` da `correction` moduli bor; aniq nom yo'q, umumiy fallback ("correction · approve bajarildi" kabi).

**Asosiy metodlar:**
- `createRequest(input)` -> `persistRequest(input, undefined)`. `createRequestWithFile(input, file)` — fayl majburiy (400 "Ariza fayli majburiy").
- `persistRequest`:
  1. `resolveTx`: `oplataKvId` berilsa — `oplata_kv` qatori (`sourceTxId` bo'lishi shart, aks holda 400 "tranzaksiyadan kelmagan"), manba tx `externalId` yoki `id` bo'yicha; snapshot OplatyKv qatoridan. Faqat `txId` berilsa — snapshot tranzaksiyadan (summa `direction=OUT` da manfiy, `snapObject=null`).
  2. **Dublikat:** shu `txId` ga `pending` ariza bor bo'lsa yangisi yaratilmaydi, `{id: eski, alreadyPending: true}` qaytadi. Yangi yuborilgan fayl bu holda biriktirilmaydi (jim tashlanadi).
  3. `cleanContract`: `№`, `N°`, bo'shliqlar olib tashlanadi, UPPERCASE, 128 belgi. CRM kanonik shakliga o'tkazilmaydi.
  4. Taklif shartnoma bo'lsa: jonli `crm.searchContracts(contract, 3)` — aniq mos (yoki birinchi) natijadan `snapObject`, `snapClient` olinadi (CRM xatosi jim).
  5. Fayl bo'lsa `attachments.upload(txId, file, {type:'ariza', contractNumber, uploadedBy, notify:false})` — yuborishda Telegram xabari YO'Q.
- `approve(id, file, opts)`: faqat `pending`; shartnoma = `opts.contractNo || proposedContractNo` (cleanContract, majburiy); fayl majburiy, agar arizada oldindan fayl bo'lmasa. Qadamlar: (1) yangi fayl bo'lsa `attachments.upload` (default notify — `uploaded` Telegram xabari ketadi); (2) `categorization.setContractManual(txId, contract, actorId)` (XATO holatini yopadi, `is_contract_manual=true`, OplatyKv propagation); (3) `categoryId` berilsa `categorization.setManual`; (4) status `approved`, `reviewedByType` (`agent` bo'lsa `reviewedById=null`, ism `opts.actorName`); (5) `attachments.notifyApproved` (fayl bilan, fire-and-forget); (6) `opts.notify !== false` bo'lsa `notifyGroupDecision`.
- `directCorrect(txId, file, opts)`: `createRequest` + `approve(notify:false)`. Gotcha: shu tx'da allaqachon `pending` ariza bo'lsa `createRequest` uning id sini qaytaradi va `approve` O'SHA (boshqa odam yuborgan) arizani tasdiqlaydi.
- `reject(id, reason, actorId, actorType?, actorName?)`: faqat `pending`; `rejectReason` 2000 belgi; guruhga xabar.
- `notifyGroupDecision(req)` (private): faqat `approved`/`rejected`. Token `agent.botToken` (shifrlangan, `CryptoService.decrypt`), guruh `agent.groupId` — sozlanmagan bo'lsa jim. Yuboruvchi `@username` `getChat(submittedByChatId)` bilan aniqlanadi (raqamli chat_id bo'lsa). HTML matn: "Ariza tasdiqlandi" / "Ariza bekor qilindi", shartnoma, sana (UTC+5), summa, maqsad, kim yubordi, kim tasdiqladi/bekor qildi, rad sababi.
- Badge yordamchilari (boshqa modullar ishlatadi): `pendingTxIds`, `pendingOplataKvIds`, `pendingInfoByOplataKvId` (eng yangi pending: by, at, contractNo, attachmentId/Name), `rejectedOplataKvIds`, `submitterStats` (groupBy `submittedByName, status`), `listArizalar` (audit ro'yxati, perPage <= 100, holatlar soni bilan), `getArizaFile(attachmentId)` (fayl faqat biror arizaga bog'langan bo'lsa beriladi).
- `setHidden(txId, hidden, actorId)`: `transactions.xato_hidden` + tarix `action='xato-hide'`.
- `clearRequests({status, password})`: `ADMIN_ACTION_PASSWORD` bo'sh yoki mos emas -> 403. `deleteMany` (status yoki hammasi). Qaytmas; fayllar (`transaction_attachments`) qoladi.

**Muhim qoidalar va tuzoqlar:**
- Bir tx'ga bir vaqtda bitta `pending` ariza (kod darajasida, DB unique emas).
- `approve` raqamni CRM kanonik shakliga o'tkazmaydi: variant yozilsa to'lov (b) ta'rifda XATO bo'lib qolishi mumkin (`xato.md`). TR Support ariza yo'li (D.5.2) esa kanonik shaklni oldindan qo'yadi.
- AI tasdiqlaganda `setContractManual(txId, contract, 'agent')` chaqiriladi: tarixda `actor_id='agent'`, `actor_name=null` (FK yo'q, xato bermaydi).
- Yangi fayl bilan tasdiqlansa Telegram'ga 3 ta xabar ketishi mumkin: AttachmentsService `uploaded` va `approved` (env `TG_BOT_TOKEN`, `ATTACHMENTS_NOTIFY_CHAT`) + guruh qarori (`agent.botToken` / `agent.groupId`).

---

### D.2 `correction/agent-ai.service.ts` — AI tekshiruvchi (AgentAiService)

**Vazifa:** fayli bor `pending` arizani Claude vision bilan o'qib qaror qiladi: `approve` / `reject` / `human` (xodimga). Foydalanuvchi o'rgatgan qoidalar fayl sarlavhasida: obyekt qoidasi, ariza faylidagi shartnoma taklifga mosligi, kategoriya doim CLIENT, subkategoriya maqsadga qarab.

**Sozlamalar (`settings` jadvali):**

| Kalit | Ma'no | Default / chegara |
|---|---|---|
| `agent.aiKey` | Anthropic kaliti (shifrlangan). Bo'lmasa env `ANTHROPIC_API_KEY` | — |
| `agent.aiModel` | model ID | `claude-sonnet-4-6` (panel tanlovi: sonnet-4-6, opus-4-8, haiku-4-5) |
| `agent.aiEnabled` | `'1'` = yoqilgan | o'chiq |
| `agent.aiIntervalMin` | tsikl oralig'i, daqiqa | 5 (1..1440) |
| `agent.aiName` | ko'rinadigan nom (tasdiqlovchi ismi sifatida yoziladi) | `AI Agent` (60 belgi) |
| `agent.aiFromHour`, `agent.aiToHour` | Toshkent ish oynasi | 0..24; teng bo'lsa doim; `from > to` tungi oraliq |

Bu kalitlarni `AgentService.saveConfig` (PUT `/api/agent/config`) yozadi. `agent.aiKey` + `agent.aiModel` ni chek-order, correction-bot, v1 leader ham o'qiydi (umumiy AI kaliti).

**Cron `tick()`** (`@Cron(EVERY_MINUTE)`): xotiradagi `running` qulfi (ustma-ust ishlamaydi); `isEnabled` -> ish oynasi -> `lastRunMs` dan beri `intervalMin` o'tganmi -> `count(status=pending, agentState=null, attachmentId not null)`; 0 bo'lsa Claude chaqirilmaydi (tejamkor); kalit bo'lsa `processPending(10)` (eng eski birinchi). `lastRunMs` xotirada — restartdan keyin darhol ishlaydi.

**`processRequest(requestId)` qadamlari:**
1. Tekshiruv: ariza bor, `pending`, `agentState` bo'sh, kalit bor.
2. **Atomik claim:** `updateMany(where: id + pending + agentState=null) -> agentState='processing', agentAt=now`; `count=0` bo'lsa "Boshqa jarayon ishlamoqda" (cron va submit-trigger to'qnashmaydi).
3. Fayl o'qish (`transaction_attachments.storagePath`): PDF -> `document` blok; rasm (jpg/png/webp/gif) -> `image` blok; `.docx` -> `mammoth`: matn (promptga 6000 belgigacha) + ichki rasmlar (png/jpeg/gif/webp, ko'pi bilan 4 ta, imzo/muhr uchun). Eski `.doc` va boshqa turlar o'qilmaydi -> Claude'ga "ariza fayli yo'q" -> `human`.
4. CLIENT kategoriya (`category.code='CLIENT'`) va bolalari nomlari -> subkategoriya ro'yxati.
5. Obyekt kodlari: `objectCode(contract)` = UPPERCASE, faqat A-Z0-9, regex `^\d+([A-Z]{2,4})` (masalan `118VTN24LJ` -> `VTN`). Maqsaddagi shartnoma `firstContractInText` (`\b\d{2,}[A-Z]{2,4}\d{1,3}[A-Z]{0,4}\b`, case-insensitive).
6. `callClaude`: `POST https://api.anthropic.com/v1/messages` (to'g'ridan `fetch`, `anthropic-version: 2023-06-01`, `max_tokens 1024`), majburiy tool `submit_decision` (`arizaContract`, `arizaValid`, `hasSignature`, `subCategory`, `decision` enum, `reason`). Tizim prompti qoidalari: obyekt (raqamlardan keyingi harflar), harf tushib qolishi istisnosi, ariza fayli taklifga mosligi, kategoriya doim `Клиент / Физ.Л / Юр.Л`, subkategoriya maqsad bo'yicha, ishonch bo'lmasa `human`, IMZO majburiy (terilgan "imzo" so'zi imzo emas). Noma'lum `decision` -> `human`.
7. **Deterministik obyekt guard:** taklif obyekti != maqsad obyekti VA `looseSameContract(maqsad, taklif)` false bo'lsa -> `human` ("Boshqa obyektga o'tkazib bo'lmaydi").
8. **Deterministik imzo guard** (2026-08-13 commit: "IMZO majburiy + Word o'qish"): `approve` bo'lsa-yu `hasSignature !== true` -> `human`. `reject` o'zgartirilmaydi.
9. Qo'llash: `approve` -> `correction.approve(id, undefined, {contractNo: proposed, categoryId: CLIENT, subCategoryId: nom bo'yicha aniq moslik, actorId:'agent', actorType:'agent', actorName: aiName})` + `agentState='done'`; `reject` -> `correction.reject(... 'agent')` + `done`; `human` -> `agentState='needs_review'` (ariza `pending` qoladi). Istisno bo'lsa `needs_review` + `agentReason="Agent xatosi: ..."`.

**`looseSameContract(a, b)`:** normallashtirilgan ikki raqam teng yoki qisqasi uzunining ichida tartib bilan bor (faqat harf TUSHIB qolgan, almashgan emas), uzunlik farqi <= 2. Misol: `1699TN25PP` va `1699VTN25PP` bir xil. Harf almashuvi (boshqa obyekt) qabul qilinmaydi.

**Ism tekshiruvi:** backend AI'da to'lovchi ismi CRM mijozi bilan solishtirilMAYDI. Bu tekshiruv faqat Python botda (`agents/ariza.py::ism_mos`, familiya va ismning birinchi 4 harfi) va faqat ogohlantirish.

**Boshqa metodlar:** `processPending(limit)` (max 50), `status()` (dashboard: enabled, hasKey, running, model, interval, name, oyna, sonlar: pending/processing/needsReview/agentApproved/agentRejected), `activity({q,page,perPage})` (`agentAt not null`), `recent(limit)`, `chatHistory`, `clearChatHistory`.

**Admin chat (`chat`)**: Admin > Agent sahifasidagi suhbat. Tarix `agent_chat_messages` (oxirgi 30 xabar konvoga), rasm qo'shish mumkin, tool loop ko'pi bilan 6 aylanish, `max_tokens 1400`. Toollar: `lookup` (ariza -> OplatyKv -> tranzaksiya qidiruvi), `xato_query` (XATO soni/summa/15 misol), `read_ariza_file` (fayl blokini tool_result ichida qaytaradi), `list_review_arizas` (`needs_review`, 20 ta), `recheck_ariza` (`agentState` ni null qilib qayta `processRequest`, 5 tagacha), `act_on_ariza` (admin buyrug'i bilan approve/reject; subkategoriya `inferSubCategoryId` kalit so'zlari: `автостоян`, `возврат`, `счётчик`, `переоформл`, default `квартир`), `object_variants` (`oplata_kv.object` distinct, 60 ta).

**Gotchalar:**
- `processRequest` o'zi `isEnabled`, ish oynasi va intervalni tekshirMAYDI. Submit yo'llari (`agent/_submitWithFile`, `TrArizaService.submit`) faqat `isEnabled` ni tekshirib darhol chaqiradi -> yangi ariza ish oynasidan tashqarida ham darhol ko'riladi. `POST /api/agent/ai/run` esa `aiEnabled` o'chiq bo'lsa ham ishlaydi.
- `agentState='processing'` restart/crash'da qotib qoladi: tozalovchi kod yo'q, cron va `recheck_ariza` (faqat `needs_review`/null) uni olmaydi. Qo'lda DB tuzatish kerak.
- Chat va correction-bot `getXatoListForAgent({limit:2000})` ni `dateFrom` siz chaqiradi: ular barcha davrdagi XATO'ni ko'radi, xato-list sahifasi esa `agent.dateFrom` dan.
- `act_on_ariza` uchun "avval admindan so'ra" faqat prompt qoidasi, kodda tasdiq to'sig'i yo'q.
- Kod izohida "3 harf = obyekt" deyilgan, regex esa 2-4 harfni oladi.

---

### D.3 `agent/` — kunlik digest va public XATO ro'yxati (AgentService)

**Fayllar:** `agent.controller.ts` (JWT, `/api/agent/*`), `agent-public.controller.ts` (JWT'siz, `/api/agent/*`), `agent.service.ts`, `agent.module.ts` (importlar: OplataKv, Sync (SettingsService), Categorization, Crm, Correction).

**Sozlamalar:** `agent.enabled` ('1'), `agent.botToken` (shifrlangan; digest va guruh qaror xabari boti), `agent.groupId`, `agent.dateFrom` (XATO ro'yxati boshlanish sanasi — TR Support ham shu kalitni ishlatadi: `XATO_DATEFROM_KEY`), `agent.dailyTime` (`H:MM`/`HH:MM`, default `09:00`), `agent.lastResult` (oxirgi digest natijasi matni), `agent.lastDigestMsgId` (eski digestni o'chirish uchun), `agent.listToken` (public havola kaliti, birinchi kerak bo'lganda `randomBytes(24).hex` bilan yaratiladi, ochiq matnda saqlanadi), `agent.whitelist` (JSON `[{id, name}]`, id faqat raqam, ism 60 belgi) + D.2 dagi `agent.ai*`.

**Himoyalangan endpointlar** (`JwtAuthGuard + PermissionsGuard`):

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/api/agent/config` | `agent:view` | sozlama + holat: `hasToken`, `tokenHint` (oxirgi 4 belgi), `botUsername` (`getMe`), groupId, dateFrom, dailyTime, lastResult, `pendingCount`, whitelist, AI sozlamalari (`hasAiKey`, `aiKeyHint`) |
| PUT | `/api/agent/config` | `agent:manage` | `saveConfig` (token/AI kaliti bo'sh bo'lmasa shifrlab yoziladi; `whitelist` ham qabul qilinadi, controller tipida ko'rsatilmagan bo'lsa ham) |
| POST | `/api/agent/run` | `agent:manage` | digest'ni hozir yuborish (`runDigest`) |
| POST | `/api/agent/ai/run` | `agent:manage` | `processPending(limit, default 20)` |
| GET | `/api/agent/ai/status`, `/ai/recent`, `/ai/activity` | `agent:view` | AI dashboard, lenta, paginatsiya |
| POST | `/api/agent/ai/chat` | `agent:manage` | admin chat (D.2) |
| GET | `/api/agent/ai/chat/history` | `agent:view` | chat tarixi |
| POST | `/api/agent/ai/chat/clear` | `agent:manage` | `agent_chat_messages` ni tozalash |

**Public endpointlar** (`AgentPublicController`, JWT yo'q; faqat global throttler 300/daq):

| Metod | Yo'l | Auth | Nima qiladi |
|---|---|---|---|
| GET | `/api/agent/xato-list?key=` | `agent.listToken` | `_list()` |
| GET | `/api/agent/crm-search?key=&q=` | kalit | `crm.searchContracts(q, 8)` (q >= 2 belgi) |
| POST | `/api/agent/assign` `{key, oplataKvId, contractNo, name}` | kalit | `_submit` -> FAYLSIZ ariza (`source='web'`, ism so'rovdan) |
| POST | `/api/agent/submit` (multipart `file`, `key`, `oplataKvId`, `contractNo`) | kalit | `_submitWithFile` (`source='web'`) + AI trigger |
| POST | `/api/agent/arizalar` `{key, status, q, submitter, actorType, page}` | kalit | `correction.listArizalar` |
| POST | `/api/agent/file` `{key, attachmentId}` | kalit | ariza faylini stream (inline) |
| POST | `/api/agent/tg/list` `{auth}` | Telegram login + whitelist | `_list()` + `me` |
| POST | `/api/agent/tg/search` `{auth, q}` | TG | CRM qidiruv |
| POST | `/api/agent/tg/assign` `{auth, oplataKvId, contractNo}` | TG | FAYLSIZ ariza (`source='telegram'`, ism whitelist'dan, chatId = TG user id) |
| POST | `/api/agent/tg/submit` (multipart, `auth` JSON matn) | TG | fayl bilan ariza + AI trigger |
| POST | `/api/agent/tg/file` `{auth, attachmentId}` | TG | fayl stream |
| POST | `/api/agent/tg/arizalar` `{auth, ...}` | TG | arizalar ro'yxati (audit sub-tab) |

**Auth tafsiloti:**
- Kalit: `assertKey` — `key === agent.listToken` (oddiy taqqoslash). Kalit kod tomonidan hech qachon almashtirilmaydi (rotatsiya yo'q).
- Telegram `validateTgAuth`: Login Widget algoritmi — `secret = SHA256(agent bot tokeni)`, `hash` dan boshqa bo'sh bo'lmagan maydonlar saralanib `k=v` qatorlar, `HMAC-SHA256` hex; `timingSafeEqual` (2026-07-31 "security(A4)" commit); `auth_date` 86400 s dan eski bo'lmasin. Keyin `authorizeTg`: TG `id` `agent.whitelist` da bo'lishi shart, ism whitelist'dan olinadi.

**`_list()`:** `getXatoListForAgent({dateFrom: agent.dateFrom, limit: 2000})` (bitta `buildXatoFilter`), har qatorga `pending` (+ `pendingInfo`: kim, qachon, taklif, fayl), `rejected` (pending bo'lmasa va rad etilgan ariza bo'lsa), `arizaStats` (`submitterStats`), `account` (qabul qiluvchi hisob). Frontend: `frontend/app/[locale]/xato-list/page.tsx`.

**Digest cron `tick()`** (`EVERY_MINUTE`): `agent.enabled='1'` -> Toshkent `HH:MM` == `dailyTime` -> `lastRunDay` (xotirada, oy kuni) -> `runDigest()`:
1. Token yoki guruh yo'q -> xato natija.
2. `count = countXatoForAgent(agent.dateFrom)`; 0 bo'lsa xabar yuborilmaydi, `lastResult` yoziladi.
3. Matn: `📊 <b>N ta</b> CRM'da tasdiqlanmagan to'lov`. Avval `login_url` tugma (`APP_URL/uz/xato-list`; BotFather `/setdomain` kerak), qabul qilinmasa fallback `url` tugma `...?key=<listToken>`.
4. Yangi xabar ketgach eski digest (`agent.lastDigestMsgId`) `deleteMessage` bilan o'chiriladi (chat to'lmasin).
- Server o'sha daqiqada ishlamasa shu kunlik digest o'tkazib yuboriladi (catch-up yo'q). Restart xuddi o'sha daqiqada bo'lsa ikki marta ketishi mumkin.

**Gotchalar:**
- `countXatoForAgent` va `getXatoListForAgent` hisobida `agentNotifiedAt: null` sharti bor, lekin `markAgentNotified` hech qayerda chaqirilmaydi: amalda son = `agent.dateFrom` dan beri barcha XATO.
- `submitFile` (kalit yo'li) `actorName` bermaydi: `submittedByName` default `'Telegram'` bo'ladi, garchi `source='web'`.
- `assign`/`tg/assign` faylsiz ariza yaratadi -> AI uni hech qachon ko'rmaydi (AI faqat `attachmentId not null`), xodim tasdiqlashda fayl talab qilinadi.
- Kalit havolasi (`?key=`) sizib chiqsa, egasi XATO ro'yxatini ko'radi, ariza yuboradi va ariza fayllarini o'qiy oladi; kodda bekor qilish mexanizmi yo'q (faqat DB'da `agent.listToken` ni o'zgartirish).

---

### D.4 `correction-bot/` — Telegram tuzatish boti

**Fayllar:** `correction-bot.service.ts` (sozlama), `correction-bot-runner.service.ts` (long-polling xizmati), `correction-bot.controller.ts`, `correction-bot.module.ts` (importlar: Sync, OplataKv, Crm). Yaratilgan 2026-07-30 (1- va 2-bosqich bir kunda), keyin o'zgarmagan.

**Sozlamalar:** `corrbot.botToken` (shifrlangan, alohida bot), `corrbot.groupId` ("tuzatildi" xabari), `corrbot.enabled` ('1'), `corrbot.whitelist` (JSON `[{id, name}]`; bo'sh = hech kim). AI: `agent.aiKey`/env `ANTHROPIC_API_KEY`, model `agent.aiModel` (default `claude-sonnet-4-6`).

**Endpointlar:** `GET /api/correction-bot/config` (`agent:view`; token qaytmaydi: `hasToken`, `tokenHint`, `botUsername`, groupId, whitelist), `PUT /api/correction-bot/config` (`agent:manage`). Frontend: Admin > Agent sahifasidagi "Tuzatish bot" bo'limi.

**Runner oqimi:**
- `onModuleInit` cheksiz `loop()`: o'chiq yoki token yo'q -> 15 s uxlaydi; birinchi marta (`pollOffset=0`) `deleteWebhook`; `getUpdates` (`timeout 25`, `allowed_updates: message, callback_query`); offset faqat xotirada.
- `onMessage` (faqat matnli xabar): `isAllowed(chat.id)` — whitelist'da bo'lmasa "Ruxsat yo'q" + o'z chat ID sini ko'rsatadi. `/start` holatni tozalaydi. Aks holda `agentTurn`: Claude Messages API, tarix xotirada (24 xabar), tool loop 6 aylanish, `max_tokens 1200`. Toollar: `list_xato` (15 ta), `payment_info` (id yoki shartnoma/klient `includes` bo'yicha birinchi mos; `currentOplataKvId` ni eslab qoladi), `crm_search` (`crm.searchContracts(q, 8)` -> `pendingMatches`).
- `pendingMatches` bo'lsa javobga inline tugmalar (`asg:<index>`, ko'pi bilan 8).
- `onCallback`: whitelist; `botAssignContract(currentOplataKvId, contract, ism)` -> tugmalar olib tashlanadi, foydalanuvchiga "Biriktirildi", `corrbot.groupId` ga "XATO to'lov to'g'rilandi" xabari; holat tozalanadi.

**`OplataKvService.botAssignContract` (bu bot, panel "XATO -> CRM" va `assignFromCrm` uchun umumiy):** `crmCache.lookup(contractNo)`; topilsa kanonik raqam, topilmasa kiritilgan raqam baribir yoziladi; manba tx bo'lsa `setContractManual(txId, finalNo, '')`, bo'lmasa OplatyKv qatori to'g'ridan yangilanadi.

**Gotchalar:**
- Ariza, fayl, tasdiq, obyekt tekshiruvi YO'Q: whitelist foydalanuvchisi tugma bilan istalgan XATO to'lovni istalgan shartnomaga ulaydi (CRM'da topilmagan raqam ham yoziladi).
- Suhbat holati xotirada: restartda yo'qoladi; `pendingMatches` tanlov bo'lmaguncha keyingi har javobga eski tugmalar qayta ilinadi.
- Bitta tokenda faqat bitta `getUpdates` (409): `corrbot.botToken` boshqa bot (agent digest, sverka, v1 leader, Python bot) bilan bir xil bo'lmasligi kerak.

---

### D.5 `tr-support/` — TR Support backend

**Modul:** `TrSupportModule` (importlar: Categorization, OplataKv, Correction, Sync). Providerlar: `TrSupportService`, `TrArizaService`, `TrMalumotService`, `TrPerebroskaService`, `TrTarixService` (hammasi eksport qilinadi, `agent-bridge` ishlatadi). Birinchi commit 2026-09-30, oxirgi 2026-10-09.

#### D.5.1 `TrSupportService` (tahrir, harf farqi, XATO ulash, tarix, ortga qaytarish)

**Uch ustun:** Kontragent = top kategoriya (`category.parentId=null`), Kategoriya = subkategoriya, Shartnoma = CRM'da tasdiqlangan raqam. Yozish panel yo'llari bilan: `CategorizationService.setManual`, `setContract`, `setContractManual`, `restoreSnapshot` (tarix `transaction_category_history` va OplatyKv propagation bir xil), oxirida BITTA OplatyKv sync.

**Konstantalar:** `HIDDEN_KONTRAGENTS = ['COUNTERPARTY_RETURN','COUNTERPARTY']` (qo'lda tanlanmaydi), `CONTRACT_TOPS = ['CLIENT','TRANSFER']` (shartnoma faqat shu kontragentlarda), `TR_SUPPORT_MAX_ITEMS = 20`, `XATO_SHARTNOMA = 'XATO'`, `XATO_DATEFROM_KEY = 'agent.dateFrom'`. Kirish kodi: env `TR_SUPPORT_CODE` (bo'lmasa kodda qattiq yozilgan default; qiymati bu yerda yozilmaydi).

**Qiymat tahlili:** `QOLSIN` to'plami (`''`, `qolsin`, `o'zgarmasin`, `=`, `keep`, `same` ...) = ustun o'zgarmaydi; `YOQ` (`yo'q`, `-`, `none`, `tozalash`, `clear` ...) = bo'shatish; `XATO_RE` (`^xato(?:[:=\s](.*))?$`, katta-kichik farqsiz) = XATO rejimi. Nom qidiruvi `findIn`: kod -> normallashgan nom -> kirill-lotin transliteratsiya (`Za schetchik` = `За счетчик`).

**`findTxRef(ref)`:** (1) `transactions.id` yoki `external_id` aniq; (2) `GID_REF_RE = ^(\d{8,20})(?:[_/](dd).(mm).(yyyy))?$` bo'lsa `bank_general_id` bo'yicha, sana berilsa Toshkent kuni oynasi (UTC kun boshidan -6 soat ... +30 soat, zaxira bilan), `take 5`; bittadan ko'p bo'lsa `kop>1` -> preview "sanasini qo'shing". Bot `/` ni `_` ga almashtiradi.

**`xatoStatus(tx)`:** `OplataKvService.findXatoRowForTx([externalId, id], agent.dateFrom)` (xato-list sahifasi bilan AYNAN bir xil filtr); qator bo'lsa shu `oplata_kv` yoki tx'ga `pending` ariza bormi; egasiga tayyor `xabar` matni (ariza kutilmoqda / "to'g'ri shartnomani yozing yoki ariza biriktiring").

**`preview(ref, choice)`** (FAQAT O'QISH; CRM faqat o'qiladi) natijasi `TrPreview`: `valid`, `xato`, `harf`, `ulash`, `xatoQoladi`, `errors[]`, `tx`, `changes[]`, `crm`, `plan`. Qaror daraxti:
1. To'lov topilmadi yoki noaniq -> xato.
2. To'lov XATO ro'yxatida (`xato.inList`):
   - `pending` ariza bor -> rad (`xabar`): "ariza tasdiqlanishini kuting".
   - Aks holda avval **harf farqi** (`harfFarqi`); `ok` bo'lsa `harf={from,to}`.
   - Bo'lmasa **XATO ulash** (`xatoUlash`); `ok` bo'lsa `ulash={from,to,obyekt}`.
   - Ikkalasi ham tegishli emas va shartnoma o'zgarmaydi (`qolsin` yoki `XATO`) -> `xatoQoladi=true` (faqat kontragent/kategoriya o'zgaradi, to'lov XATO ro'yxatida qoladi).
   - Qolgan holat -> rad: `xabar` + qoida sababi (ulash yoki harf sababi).
3. `source='ALOQA_BANK'` -> "Aloqa Bank import qatorini tahrirlab bo'lmaydi".
4. Kontragent: topilmasa variantlar ro'yxati bilan xato; o'zgarsa va yangisining bolalari bo'lsa kategoriya ham tanlanishi shart (bolasiz bo'lsa sub = null).
5. Kategoriya: faqat tanlangan (yoki hozirgi) kontragent ichidan; `YOQ` = null.
6. Shartnoma: `fix` (harf/ulash) bo'lsa `fix.to` (kanonik); `XATO` rejimi — kontragent `CLIENT` bo'lishi shart, shartnomaga aynan `XATO` yoziladi (egasi qarori 2026-09-30: `XATO:<raqam>` yozilsa ham faqat `XATO`); oddiy raqam — `^[A-Z0-9/]{3,64}$`, kontragent `CLIENT`/`TRANSFER` bo'lishi shart, `crmCache.lookup(raqam, {forceRefresh:true})` `found` bo'lishi shart, O/0 kabi variantda CRM kanonik shakli yoziladi.
7. `xatoQoladi` bo'lsa kontragent `CLIENT` bo'lib qolishi shart (boshqasiga panel orqali). `fix` bo'lsa kontragent/kategoriya o'zgarmasligi shart.
8. O'zgarish yo'q -> "Hech narsa o'zgarmaydi".
9. `plan = {txId, catChange, categoryId, subcategoryId, contract?, contractXato?, contractManual?}`.

**Harf farqi qoidasi** (egasi, 2026-10-03; 2026-09-30 dagi "XATO to'lov tahrirlanmaydi" taqiqiga istisno):
- `harfFarqiMos(wrong, right)` (eksport qilingan sof funksiya): `right` uzunligi >= 6; `base = right` ning oxirgi 2 belgisidan oldingi qismi; `wrong` aynan `base` bilan boshlanadi va `base` `^\d{1,6}[A-Z]{2,4}` ga mos (raqam + obyekt kodi + yil saqlanadi, demak obyekt bir xil); dumlar: `wrong` dumi 1-4 harf, `right` dumi aniq 2 harf; Levenshtein (`tahrirMasofa`) <= 2. Misollar: `217AFS24YIL -> 217AFS24YL`, `656AFS25UZ -> 656AFS25ZU`.
- `harfFarqi(tx, xatoContract, shartnoma)`: noto'g'ri nomzodlar `xatoRaqamlar` = OplatyKv XATO qatori raqami + tx shartnomasi + `extractContractCandidates(description)` (`XATO` dan tashqari); hech biri mos kelmasa `null`; CRM `found` bo'lishi shart (kanonik `to`); **"aniq"**: `crm_contracts` keshida (`found=true`, prefiks bo'yicha, 50 ta) `from` ga shu qoida bilan mos boshqa shartnoma bo'lsa -> `ok:false` "aniq emas — ariza orqali".
- Backend `apply` baribir `approvedBy` (>= 2 belgi) talab qiladi. "Tasdiqsiz" bot darajasida: bot preview'da `valid && harf` ko'rsa egasidan so'ramay darhol `apply` chaqiradi (`approvedBy` = egasi aytgan ism yoki bot konstantasi).

**XATO ulash** (egasi, 2026-10-05): `xatoUlash(tx, xatoContract, shartnoma)` — raqam formati, CRM `found` (kanonik), obyekt kodi (`objectCodeOf`, `categorization/contract-parser`) XATO raqamlari/izohdagi kodlardan biriga teng bo'lishi shart (pul boshqa obyektga o'tmaydi — AI tekshiruvchi qoidasi bilan bir xil). XATO raqamlarda kod umuman bo'lmasa solishtirilmaydi (`obyekt=null`). Harf qoidasi "aniq emas" desa ham egasi aniq aytgan shartnoma shu yo'l bilan (tasdiq bilan) ulanadi.

**`apply(items, {approvedBy, comment, requestedBy})`:** 1..20 element; `label = "TR Support · tasdiq: <approvedBy>"`; `batchId = trs_<ts36>_<hex>`. Har element uchun preview QAYTA (qoidalar qayta tekshiriladi), yaroqsiz -> `skipped`. Avval kategoriya (`setManual(txId, {...}, null, label)`, natijada `oplataKvUpdated`), keyin shartnoma: `contractXato` yoki `contractManual` -> `setContractManual` (izohdan qayta yozilmaydi, ariza tasdig'i bilan bir xil), aks holda `setContract` (CRM verified). `tr_support_edits` ga yozuv (`before`/`after` holat, `changed`, `approved_by`, `comment`, `requested_by`, `status` `applied`|`failed`, `error`). Natijada `oplataKv` (bool), `okv` (shartnoma o'zgarganda OplatyKv qatori: contractNo, client, object), `crm` (mijoz, obyekt). Hammasidan keyin bitta `oplataKv.syncNowRespectingSettings({id:null, name:label})` (panel "Sync" bilan bir xil), natija `sync_result` ga.

**`rollback(id, actorName, note)`:** `rolled_back` bo'lsa 409; joriy holat `after` bilan teng bo'lmasa (kategoriya, sub, shartnoma) 409 "yana o'zgargan"; `restoreSnapshot(txId, before, "TR Support · ortga: <panel foydalanuvchisi>")` (CRM tekshiruvisiz, chunki eski raqam XATO bo'lishi mumkin); sync; `status='rolled_back'`, `rolled_back_at/_by`, `rollback_note`.

**`list({page, perPage<=100, q})`:** `tr_support_edits` (`txExternalId`, `txId`, `approvedBy`, `comment` bo'yicha qidiruv).

**Panel controller** (`/api/tr-support`, `JwtAuthGuard + PermissionsGuard`; frontend `frontend/components/tr-support-tab.tsx`, Tranzaksiyalar > Klient · XATO shartnoma > "TR Support" tabi):

| Metod | Yo'l | Ruxsat | Throttle | Nima qiladi |
|---|---|---|---|---|
| POST | `/api/tr-support/unlock` `{code}` | `transactions:view` | 10/daq | `checkCode` (SHA-256 + `timingSafeEqual`), audit "TR Support: kod bilan kirish" |
| GET | `/api/tr-support/edits?page&perPage&q` (header `x-tr-support-code`) | `transactions:view` | global | `list` |
| POST | `/api/tr-support/edits/:id/rollback` `{code, note}` | `categories:manage` | 10/daq | `rollback`, audit "TR Support: tahrir ortga qaytarildi" |

DB: `tr_support_edits` (`TrSupportEdit`): `batch_id`, `tx_id`, `tx_external_id`, `tx_date`, `amount`, `direction`, `before`/`after` (JSON `TrState`), `changed`, `approved_by`, `comment`, `requested_by`, `status` (`applied`|`failed`|`rolled_back`), `error`, `sync_result`, `rolled_back_at/_by`, `rollback_note`, `created_at`.

#### D.5.2 `TrArizaService` — XATO to'lovga ariza (bot orqali)

- `find({tx | summa+sana, hisob?, shartnoma?})`: `OplataKvService.findXatoRows` (xato-list filtri + `agent.dateFrom`; summa ±1 ishora farqsiz; sana ±3 kun, UTC kun asosida; `take 20`). Har nomzodga tx `to/from_account`, `direction`, pending ariza. `hisob` (>= 6 raqam) berilsa `to/from_account` ichida qidiriladi: mos bo'lsa faqat moslar qoladi, bo'lmasa hammasi qoladi va `hisobMos=false` (bot ogohlantiradi). `shartnoma` berilsa `crmCheck` (CRM `found`, kanonik shakl, mijoz, obyekt). `aiName` ham qaytadi.
- `readFile(name, nomi)`: fayl nomi qat'iy `^leader_bot_[0-9a-f]{16}\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$`; katalog env `AGENTS_UPLOADS_DIR` (default repo ostidagi `static/tg_uploads`); `realpath` bilan katalogdan chiqib ketmaslik tekshiriladi; hajm 0 < size <= 20 MB. Bot fayllari 7 kun saqlanadi.
- `submit({oplataKvId, contractNo, fayl, yubordi})`: OplatyKv qatori bor; XATO ro'yxatida bo'lishi SHART (409); CRM `found` SHART (kanonik raqam taklif sifatida yoziladi); `correction.createRequestWithFile({source:'telegram', submittedByName: yubordi, submittedByChatId:null})` — XATO sahifasidagi "Shartnoma biriktirish" bilan AYNAN bir xil yo'l; `aiEnabled` bo'lsa `processRequest` fonda (natija kutilmaydi).
- `status(id)`: ariza holati, `agentState`, `agentReason` (500), kim/qanday tasdiqladi, rad sababi, shartnoma. Bot 4 daqiqagacha so'rab turadi.
- Gotcha: `.doc` fayl qabul qilinadi, lekin AI uni o'qiy olmaydi -> doim xodimga (`needs_review`).

#### D.5.3 `TrMalumotService` — faqat o'qish ma'lumotlari (egasi qarori, 2026-10-05)

- `hisob(raqam)`: `bank_accounts` (bizning hisob: bank, MFO=`branch`, egasi, valyuta, sync, oxirgi sync); `transactions` da `from_account`/`to_account` = raqam: jamilar (ikki tomon, to'liq), oxirgi 3000 qator asosida nom/MFO/INN chastotasi (8 ta), shartnomalar (10 ta), oxirgi 5 to'lov; `counterparties` (INN yoki `bank_accounts` JSON matnida raqam, 3 ta: to'liq nom, direktor, telefon, manzil, QQS, OKED); MFO -> bank nomi (`mfo-banks.ts::mfoToBankName`, bizning filiallar, kontragent ro'yxati); valyuta raqamning 6-8 xonasidan (ISO 4217). `from_account`/`to_account` indekssiz (kam so'raladi), `kesilgan` flag.
- `xatoFayl(filtr)`: `getXatoListForAgent({dateFrom: agent.dateFrom, limit:2000})` + ariza holati (`pendingInfoByOplataKvId`, `rejectedOplataKvIds`) -> ExcelJS `.xlsx` (15 ustun, autoFilter), base64 qaytadi; filtr hisob/obyekt/shartnoma/mijoz/maqsad/tip bo'yicha (`includes`, katta-kichik farqsiz).
- Gotcha: `hisob` javobi kontragent shaxsiy ma'lumotlarini (direktor, telefon, manzil) botga (egasiga) uzatadi.

#### D.5.4 `TrPerebroskaService` — AI Perebroska bot orqali (egasi qarori, 2026-10-05)

- `tahlil(fayl)`: `readFile(..., 'perebroska_tr_support')` -> `OplataKvService.analyzePerereboskaAriza` (panel OplatyKv > "+" > AI Perebroska bilan bir xil; DB'ga yozmaydi) -> `extracted`, `agentState`, `agentReason`, `warnings`, `balanceEnough`, `duplicates`.
- `yarat(b)`: `OplataKvService.createPerereboska` (panel "Yaratish" bilan bir xil; qoidalarni o'zi majburlaydi: bir obyekt, summalar teng, qoldiq yetarli, hujjat), `actor = {id:null, name:"TR Support · tasdiq: <ism>"}`, `agentUsed:true`; natija `groupId` + yaratilgan OplatyKv qatorlari. Egasi qarori 2026-10-07: tasdiq so'ralmaydi (to'siq bo'lmasa bot darhol yaratadi; "bir fayl — bir yaratish" claim botda).

#### D.5.5 `TrTarixService` — eski tarixni yuklash (egasi qarori, 2026-10-09)

- `boshla({dan, gacha, bank?, hisob?})`: sanalar `YYYY-MM-DD`, `dan <= gacha`, kelajak yo'q, oraliq <= `TARIX_MAX_KUN=62`. "Bir vaqtda bitta": so'nggi `TARIX_YETIM_MIN=20` daqiqada `sync_logs` da `source` ichida `backfill` va `status='RUNNING'` bo'lsa 409 (eskiroq yetim log bloklamaydi). Qamrov: `hisob` (bizning `bank_accounts`, sync holatidan qat'i nazar) > `bank` (`bankTop`: kod yoki nom, bir nechtaga mos bo'lsa "aniq emas") > hammasi (sync yoqilgan). `SyncService.resolveBackfillTargets` (sync chegarasi `syncMinDate` panel kabi kesadi), keyin fonda `yakunla`: `SyncService.runBackfill(accounts, dates)` (faqat qo'shadi: backfill rejimida o'chirish/o'zgartirish aniqlash va qoldiq yangilash o'chiq, `sync.service.ts` dagi `!isBackfill` sharti), yangi to'lov saqlangan bo'lsa bitta OplatyKv sync (`TR Support · eski tarix`).
- `holat(since)`: `since` dan keyingi backfill loglari jamlanadi (boshlangan, tugagan, olindi, yangi, xato, 10 ta xato tafsiloti, oxirgi tugash), `ish` (xotiradagi jarayon: tugadi, OplatyKv natijasi; restartdan keyin `null`). Xotirada oxirgi 10 ish saqlanadi.

---

### D.6 `agent-bridge/` — Python bot uchun ichki ko'prik

**Fayllar:** `agent-bridge.controller.ts`, `agent-bridge.guard.ts`, `agent-bridge.service.ts`, `agent-bridge.validation.ts` (sof funksiyalar), `agent-bridge.types.ts`, `*.spec.ts` (guard, controller, service, validation, audit-routes). Modul importlari: `ChekOrderModule`, `GoogleExportModule`, `CrmModule`, `TrSupportModule` (servislarni o'zi providers'ga qo'shish taqiq — ikkinchi nusxa bo'lardi). Birinchi commit 2026-09-28.

**Guard (`AgentBridgeGuard`)** — JWT/rol yo'q, uch shart (tartib bilan, hammasi shart):
1. env `AGENT_BRIDGE_KEY` bo'sh emas va >= 32 belgi (`MIN_KEY_LEN`), aks holda HAMMA so'rov 403 (ko'prik yopiq; startda log "ko'prik YOPIQ").
2. Proxy headerlaridan birortasi ham bo'lmasligi (bo'sh qiymat ham): `x-forwarded-for`, `x-real-ip`, `forwarded`, `x-forwarded-proto`, `x-forwarded-host` (nginx `/api/` ularni qo'yadi -> tashqaridan kelgan so'rov rad).
3. `req.socket.remoteAddress` loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). `req.ip` ishlatilmaydi (`main.ts` `trust proxy` = env `TRUST_PROXY_HOPS` tufayli soxtalashtirilishi mumkin).
4. Header `x-agent-bridge-key` string (massiv rad), `safeKeyEqual` (ikkala tomon SHA-256 -> `timingSafeEqual`, uzunlik sizmaydi).
- Har rad etish sababi uchun bir xil `403 Forbidden`; sabab, yo'l va socket manzili faqat server logida (kalit qiymati hech qachon logga yozilmaydi).
- Ruxsatda `req.user = {id:null, email:'agent-bridge', fullName:'agent-bridge', role:'AGENT_BRIDGE', permissions:[]}` — global AuditInterceptor POST'larni shu aktor bilan yozadi (`AuditLog.userId` null).
- `@ApiExcludeController()` (Swagger'da ko'rinmaydi). Class darajasida `@Throttle 30/daq`, global `ThrottlerGuard` (300/daq) ham saqlanadi.

**Endpointlar** (prefiks `/api/agent-bridge`):

| Metod | Yo'l | Throttle | Validatsiya | Chaqiradi | Yozadimi |
|---|---|---|---|---|---|
| GET | `/payment-check?contracts=A,B,C[&sheetIds=x,y]` | 20/daq | `parseContracts`: string, <= 200 belgi, 1-3 token (dedupe'dan oldin sanaladi), har biri `^[A-Za-z0-9]{3,20}$`, UPPERCASE; `parseSheetIds`: bo'sh = null, 1-10 id `^[A-Za-z0-9_-]{1,80}$` | `googleExport.listSheetSources` (faqat `hasPayColumns`; bo'sh = hammasi; noma'lum id -> 400) -> `ChekOrderService.paymentCheck(contracts, {oplata:true, crm:true, sheetIds})` + `resAllMatch` | yo'q |
| GET | `/exports` | 30/daq (class) | — | `googleExport.getConfig/getRawConfig/listSheetSources` + har sheet uchun oxirgi `export_cron_logs` | yo'q |
| POST | `/exports/:id/run` | 3/daq | `assertExportId` `^[A-Za-z0-9_-]{1,80}$`; body YO'Q (target faqat saqlangan konfiguratsiyadan) | `googleExport.runAndLog(target, 'manual', 'manual:agent-bridge')` (panel "Bajarish" bilan bir xil), xotiradagi `running` qulfi (409 "hozir ishlayapti") | Google Sheets + `export_cron_logs`; audit "Agent: Google eksport ishga tushirildi" |
| GET | `/crm-lookup?id=<kompozit>[&date=&amount=]` | 20/daq | `COMPOSITE_ID_RE` `^[A-Za-z0-9][A-Za-z0-9_.+\-]{7,199}$` va `_` bo'lishi shart; date `YYYY-MM-DD`; amount `^\d{1,13}(\.\d{1,2})?$` > 0 | `CrmService.lookupForAgent` (avval shu kungi CRM payment-history, `matchComposites` bilan bir xil match: to'liq external_id yoki kompozit yadro, `via='sana'`; topilmasa `transaction_id = general_id` filtri, `via='transaction_id'`; aniq yo'q bo'lsa shu kun shu summa nomzodlari `sameAmount` <= 5) | yo'q (CRM faqat GET) |
| GET | `/chek-find?order=&amount=&date=&account=&contract=` | 20/daq | order majburiy `^\d{1,30}$`; account `^\d{6,30}$`; contract `^[A-Za-z0-9]{3,20}$` | `ChekOrderService.findForAgent` = `matchOrder(o, true)` (panel Tekshirish bilan bir xil ball tizimi) | yo'q (natija saqlanmaydi) |
| GET | `/tx-edit/options?tx=` | 30/daq (class) | `TX_REF_RE` `^[A-Za-z0-9][A-Za-z0-9_.+\-]{5,199}$` | `TrSupportService.options` (tx ko'rinishi, kontragent/kategoriya daraxti, XATO holati) | yo'q |
| GET | `/tx-edit/preview?tx=&kontragent=&kategoriya=&shartnoma=` | 20/daq | qiymatlar 80 belgigacha, boshqaruv belgisiz; bo'sh = qolsin | `TrSupportService.preview` | yo'q |
| POST | `/tx-edit/apply` `{items[1..20]:{tx,kontragent,kategoriya,shartnoma}, approvedBy(2-120), comment(<=1000)}` | 3/daq | `parseTxApply` | `TrSupportService.apply(..., requestedBy:'Telegram egasi (TR Support bot)')` | ha: `transactions`, tarix, `oplata_kv`, `tr_support_edits`, sync; audit "Agent: to'lov tahrirlandi (TR Support)" |
| GET | `/xato-ariza/find?tx=` yoki `summa=&sana=` `[&hisob=&shartnoma=]` | 20/daq | tx yoki (summa+sana) shart; hisob `^\d{6,30}$`; shartnoma `^[A-Za-z0-9№/ \-]{3,40}$` | `TrArizaService.find` | yo'q |
| POST | `/xato-ariza/submit` `{oplataKvId, contractNo, fayl, yubordi}` | 3/daq | oplataKvId `TX_REF_RE` (cuid yoki bank kompozit ID); fayl `leader_bot_<16hex>.<ext>`; yubordi 2-120 | `TrArizaService.submit` | ha: ariza + fayl; audit "Agent: XATO to'lovga ariza yuborildi (TR Support)" |
| GET | `/xato-ariza/status?id=` | 30/daq (class) | `^[a-z0-9]{20,40}$` (cuid) | `TrArizaService.status` | yo'q |
| GET | `/hisob?raqam=` | 10/daq | 16-25 raqam (bo'shliqlar olib tashlanadi) | `TrMalumotService.hisob` | yo'q |
| GET | `/xato-royxat[?filtr=]` | 5/daq | 60 belgigacha | `TrMalumotService.xatoFayl` (.xlsx base64) | yo'q |
| POST | `/perebroska/tahlil` `{fayl}` | 5/daq | fayl nomi regex | `TrPerebroskaService.tahlil` (Claude chaqiriladi) | yo'q; audit "Agent: переброска arizasi tahlil qilindi (TR Support)" |
| POST | `/perebroska/yarat` `{fayl, fromContractNo, amount, date, destinations[1..20], agentState?, agentReason?, agentData?(<=50 KB JSON), tasdiq, izoh?}` | 3/daq | shartnoma `^[A-Z0-9/]{3,64}$` (bo'shliq va `№` olinadi); summa 0 < n <= 1e13; `agentState` faqat `verified`/`needs_review` | `TrPerebroskaService.yarat` | ha: `oplata_kv` perebroska qatorlari; audit "Agent: переброска yaratildi (TR Support)" |
| POST | `/tarix/yukla` `{dan, gacha, bank?, hisob?}` | 2/daq | sanalar; bank 2-60 belgi; hisob 16-25 raqam | `TrTarixService.boshla` | ha: backfill (fonda, faqat qo'shadi); audit "Agent: eski tarix yuklash boshlandi (TR Support)" |
| GET | `/tarix/holat?since=` | 30/daq | ISO vaqt, <= 40 belgi | `TrTarixService.holat` | yo'q |

**Javob shakli:** servis har natijani "pick" funksiyalari bilan qisqartiradi (`cut` = 300 belgi xato matni, izohlar 300 belgi, `strOrNull`), ichki obyektlar to'g'ridan chiqmaydi. Xato xabarlarida kirish qiymati takrorlanmaydi (validation qoidasi).

**Python bot tomoni** (`agents/contract.py` konstantalari): `payment_check.py` -> `payment-check`, `exports` (faqat GET), `crm-lookup`, `chek-find`; `tuzatish.py` -> `tx-edit/*`; `ariza.py` -> `xato-ariza/*`; `perebroska.py` -> `perebroska/*`; `tarix.py` -> `tarix/*`; `malumot.py` -> `hisob`, `xato-royxat`; `eksport.py` -> `exports`, `exports/:id/run`. Bot manzili env `AGENT_BRIDGE_URL` (faqat `http`, `127.0.0.1`/`localhost`, yo'lsiz) yoki `http://127.0.0.1:<PORT>`; kalit faqat headerda. Bot o'zi egasi tasdig'ini oladi (matnli "tasdiqlayman", 2026-10-01 dan inline tugmasiz); backend tasdiqni tekshirmaydi — `approvedBy`/`tasdiq` matni faqat yoziladi.

**Gotchalar:**
- Ko'prikni ochish uchun kalit va loopback yetarli: serverdagi istalgan lokal jarayon kalitni bilsa yozuvchi endpointlarni chaqira oladi. Kalit `backend/.env` da.
- `payment-check` panelda 200 shartnomagacha, ko'prikda 3 tagacha; ko'prikda OplatyKv va CRM doim yoqilgan.
- `chek-find` order raqamisiz ishlamaydi (`matchOrder` order bo'sh bo'lsa darhol `not_found`), shuning uchun validatsiya uni majburiy qiladi.
- `exports/:id/run` qulfi faqat ko'prik ichida: panel yoki cron bir vaqtda shu eksportni ishga tushirsa himoya yo'q (panel xulqi bilan bir xil).

---

### D.7 `chek-order/` — memorial order va kvitansiya tekshiruvi

**Fayllar:** `chek-order.controller.ts`, `chek-order.service.ts` (~1860 qator), `chek-tg.controller.ts`, `chek-tg.service.ts`, `dto/chek-order.dto.ts`, `chek-order.module.ts` (importlar: Sync, Crm, OplataKv, GoogleExport; `ChekOrderService` eksport — agent-bridge ishlatadi). Frontend: `frontend/app/[locale]/(panel)/chek-order/page.tsx` (4 tab: Tekshirish, Chek payment, Tarix, Murojaatlar), `components/chek-check.tsx`, `chek-payment.tsx`, `chek-assistant.tsx`, `chek-tickets.tsx`, Mini App `frontend/app/[locale]/tg/chek/page.tsx`. Birinchi commit 2026-08-12. `/chek` (D.8) bilan adashtirma.

**Ruxsatlar:** `chekorder:view` (sahifa, natijalar), `chekorder:history` (Tarix), `chekorder:manage` (yuklash/tekshirish/o'chirish), `chekorder:assistant` (AI yordamchi), `chekorder:tickets` (murojaatlar), `chekorder:telegram` (Mini App sozlamasi). Telegram mehmon JWT (`jwt.strategy.ts`, `payload.tgGuest`): `id = tg:<id>`, ruxsatlar `view, manage, assistant, tickets`.

**AI:** kalit `agent.aiKey` / env `ANTHROPIC_API_KEY`, model `agent.aiModel` (default `claude-sonnet-4-6`). Hamma chaqiruv `fetch` bilan Messages API, majburiy tool (`tool_choice`).

**Endpointlar** (`/api/chek-order`, `JwtAuthGuard + PermissionsGuard`):

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/analyze` (multipart `file`) | manage | `analyzeFile`: PDF/rasm, <= 25 MB (servisda), Claude `extract_chek_orders` -> har order `matchOrder` -> `persist`; fayl `UPLOADS_DIR/chek-order/<batchId>/order<ext>`; javob `groupResults` |
| POST | `/manual` `{orderNos}` | manage | `checkManual`: raqamlar (faqat raqam qoldiriladi, dedupe), `source='manual'` |
| GET | `/?page&perPage&q&result&dateFrom&dateTo` | history | `list` (+ found/mismatch/not_found statistikasi; sana Toshkent +05:00) |
| GET | `/contract-info?contract=` | view | `contractInfo`: `crm_contracts` keshi + OplatyKv summasi + jonli `crm.show` (narx, xonadon, xona, maydon, qavat, blok, sana, holat) -> qoldiq |
| GET | `/crm-suggest?q=` | view | `crm.searchContracts(q, 10)` |
| GET | `/contract-payments?contract=` | view | `transactions` (`contract_number` yoki `description` ichida), 60 ta |
| GET | `/payment-sheets` | view | `googleExport.listSheetSources()` |
| GET | `/payment-check?contract|contracts&oplata&crm&sheetIds` | view | `paymentCheck` (FAQAT O'QISH) |
| GET | `/payment-check/export?...&filter=all|match|diff` | view | `.xlsx` (`Мос`/`Фарқли`) |
| POST | `/payment-check/import-contracts` (multipart) | view | Excel'ning 1-2 ustunidan shartnoma raqamlari (<= 200, sarlavha regex tashlanadi) |
| POST | `/assistant/chat` | assistant | AI yordamchi |
| GET | `/assignees` | tickets | faol `admin_users` (<= 200) |
| POST / GET | `/tickets` | tickets | murojaat yaratish / ro'yxat (`mine=1` — menga biriktirilgan) |
| GET / PATCH / DELETE | `/tickets/:id` | tickets | bitta / yangilash (status, mas'ul, ustuvorlik, yechim) / o'chirish |
| GET | `/tickets/:id/payment` | tickets | bog'langan OplatyKv to'lovi + taqsimot |
| POST | `/tickets/:id/resolve/chat` | tickets | tuzatuvchi agent (`resolve_turn`) |
| POST | `/tickets/:id/resolve/apply` | tickets | `applyCorrection` — OplatyKv split'ini YOZADI, murojaat `resolved` |
| POST | `/tickets/:id/locate/chat` | tickets | topuvchi agent (`locate_turn`) + `locateSearch` |
| POST | `/tickets/:id/locate/link` `{key, contractNo?}` | tickets | topilgan to'lovni murojaatga bog'lash |
| GET | `/batch/:batchId`, `/:id/file`, `/:id` | view | batch natijalari, yuklangan fayl, bitta yozuv |
| DELETE | `/` | manage | `clearAll` — butun tarix + fayllar (qaytmas) |
| DELETE | `/:id` | manage | bitta yozuv (fayl faqat batch'dagi oxirgi yozuv o'chsa) |

**`matchOrder(o, hasSource)` (eng muhim qoida):**
- `orderNo` faqat raqamlar; bo'sh bo'lsa darhol `not_found`.
- Nomzodlar (Map, id bo'yicha): (1) `transactions.doc_number = orderNo` (20 ta); (2) shartnoma (`№`/bo'shliqsiz, >= 5 belgi) `description` ichida (40 ta, eng yangi); (3) `amount` aniq teng va `txn_date` ±4 kun (40 ta). Order № ko'pincha bank `doc_number` dan farq qiladi (kvitansiya raqami), shuning uchun faqat unga tayanilmaydi.
- Shartlar: `order` (`doc_number` == orderNo), `account` (`acctSimilar(recipientAccount, to_account yoki from_account)`: faqat raqamlar, >= 6, teng yoki uzunlik farqi <= 2 va Levenshtein <= 2 — OCR'ga chidamli; mos tomon `matchAccount` da), `date` (`sameDay`: Toshkent +5 taqvim kuni), `amount` (farq < 0.01), `contract` (normallashgan `description` ichida).
- Ball: order 50, hisob 40, summa 25, shartnoma 25, sana 10. Eng yuqori ball < 50 -> `not_found` (faqat summa+sana 35 yoki faqat shartnoma 25 yetarli emas).
- `resultOf`: summa yoki shartnoma aniq `false` -> `mismatch`; order VA hisob ikkalasi `false` -> `mismatch`; aks holda `found`.
- `groupResults`: bir to'lovga tegishli orderlar (bir xil `matchedTx.id`, yoki summa|shartnoma|sana imzosi) bitta natijaga; shartlar OR bilan birlashadi, eng to'liq `extracted` tanlanadi.
- Gotcha: ±4 kun oynasi server mahalliy `setHours` bilan quriladi (Toshkent emas, server soat mintaqasiga bog'liq).

**OCR (`claudeExtractOrders`):** tizim prompti 2 hujjat turini tushuntiradi (`МЕМОРИАЛЬНЫЙ ОРДЕР` va naqd pul kvitansiyasi `КВИТАНЦИЯ О ВЗНОСЕ НАЛИЧНЫХ ДЕНЕГ`), bitta rasmdagi bir nechta hujjat, maydonlar `orderNo`, `date`, `amount`, `payerName`, `payerAccount`, `recipientName`, `recipientAccount`, `contractNo` (eng muhim), `purpose`; `max_tokens 2000`. Hisob raqamlardan bo'shliq olinadi, `orderNo` siz natija tashlanadi.

**Chek payment (`paymentCheck`)** — FAQAT O'QISH, <= 200 shartnoma:
- OplatyKv (default yoqilgan): bitta `groupBy` + to'lovlar (10000 qator, shartnoma boshiga 200).
- Sheet: har sheet bir marta `googleExport.readContractsPayments(sid, contracts)`.
- CRM (faqat `crm=1`): `crmBatch` parallel 4 ta (izohda 6 deyilgan); `crmPaymentPart`: `crm.show({contract})`; detail bo'lmasa zaxira `crm.paymentsByContract` (`viaPaymentHistory`, narx/qoldiq yo'q); bor bo'lsa narx, reja, to'langan = `max(total.paid, grafik amount_paid yig'indisi, payment_histories)` (chala javobdan himoya), hammasi 0 bo'lsa ledger'dan qayta; `initial_amount`/`monthly_amount` alohida bo'lsa aynan shular.
- `resAllMatch(res, srcKeys)` (public, agent-bridge qayta ishlatadi): har metrika (initial, monthly, total) bo'yicha mavjud manbalar farqi < 1 so'm.

**AI yordamchi (`assistantChat`, tool `assistant_turn`):** kontekst: ekrandagi natijalar; `assistantContractContext` (haqiqiy shartnoma avval tranzaksiyadan — `contract_number` yoki izohdan regex, keyin OCR; `contractInfo` + `crm.getContractSchedules` + OplatyKv yig'indisi; 90 s kesh `asstCrmCache`); `assistantUserContractLookup` (foydalanuvchi chatda yozgan 2 tagacha shartnoma: CRM, 15 tranzaksiya, 15 OplatyKv qatori; frontend uchun `tables`). Til `locale` (uz/ru/en). Prompt qoidalari: avval order tanlash (bir marta), shartnomani so'ramaslik (CRM'da bor bo'lsa), da'voni ko'r-ko'rona qabul qilmaslik, boshlang'ich<->oylik mantig'i (CRM "to'langan" tekshirilayotgan to'lovni allaqachon o'z ichiga oladi; ko'chirish faqat "ORTIQCHA" bo'lsa), keyin `proposeTicket`. Javob: `reply`, `quickReplies` (8), `proposal`, `tables`.

**Murojaatlar:** `chek_ticket` (`ticket_no` autoincrement, `status` `new`|`in_progress`|`resolved`|`rejected`, `priority`, `assigned_to_id/_name`, `matched_tx_ext_id`, `order_nos`, `transcript`, `resolution`, `resolved_by_name/_at`). `resolveChat` (tool `resolve_turn`, `mode manual|auto`): server invariantni qayta tekshiradi — `manual` da boshlang'ich + oylik = JAMI (0.01 aniqlik), aks holda `proposal=null`. `applyCorrection`: to'lov murojaatga bog'langan bo'lishi shart (`sourceTxId` == `matchedTxExtId`); `auto` -> `OplataKvService.splitSingleRow`, `manual` -> `manualSplit`; murojaat `resolved` + yechim matni; kesh tozalanadi. `locateChat` (tool `locate_turn`) `search {contract, amount, date}` berganda `locateSearch`: `oplata_kv` (shartnoma `contains`, summa ±1, sana ±3 kun, 10 ta). `locateLink`: `matchedTxExtId = key`.

**Telegram Mini App (`ChekTgService`, `/api/chek-order/tg`):**

| Metod | Yo'l | Auth | Nima qiladi |
|---|---|---|---|
| POST | `/tg/auth` `{initData}` | ochiq | WebApp initData: `secret = HMAC_SHA256("WebAppData", botToken)`, `timingSafeEqual`, `auth_date` <= 24 soat; `getChatMember(groupId, userId)` status `creator/administrator/member/restricted`; guest JWT 12 soat |
| GET | `/tg/public-config` | ochiq | `enabled`, `botUsername` |
| POST | `/tg/login` `{authData}` | ochiq | Login Widget (`secret = SHA256(botToken)`) + guruh a'zoligi -> guest JWT |
| POST | `/tg/webhook/:secret` | secret | `/start` -> a'zolik -> shaxsiy chatga `web_app` tugma (`/uz/tg/chek`) |
| POST | `/tg/redeem` `{token}` | ochiq | bir martalik token -> JWT (lekin `redeemStore` hech qayerda to'ldirilmaydi -> doim 401) |
| GET / POST | `/tg/config` | `chekorder:telegram` | sozlama (token qaytmaydi, `hasToken`) / saqlash |
| POST | `/tg/post-button` | `chekorder:telegram` | guruhga URL tugma: `t.me/<bot>/<appShort>` yoki `t.me/<bot>?startapp=chek` (guruhda `web_app` tugma mumkin emas: BUTTON_TYPE_INVALID) |

Sozlamalar: `chekorder.tg.enabled` ('1'/'true'), `chekorder.tg.botToken` (shifrlangan), `chekorder.tg.groupId`, `chekorder.tg.botUsername`, `chekorder.tg.appShort`, `chekorder.tg.webhookSecret` (faqat `ensureWebhook` yaratadi). `ensureWebhook` hech qayerda chaqirilmaydi (mavjud boshqa botning webhook'i egallanmasin). Env: `APP_PUBLIC_URL`, `API_PUBLIC_URL`.

**DB:** `chek_order` (`batch_id`, `source` photo|pdf|manual, fayl metama'lumoti va `file_path`, `order_no`, `order_date`, `amount`, to'lovchi/oluvchi nomi va hisobi, `contract_no`, `purpose`, `extracted` JSON, `result`, `matched_tx_id`, `matched_tx_ext_id`, `cond_*`, `matched_tx` JSON, `created_by_*`), `chek_ticket`; yozish faqat `applyCorrection` orqali `oplata_kv`.

**Gotchalar:**
- Telegram mehmoni `chekorder:manage` oladi: API orqali `DELETE /api/chek-order` (butun tarix) va `resolve/apply` (OplatyKv split yozish) ga yetadi.
- `claudeExtractOrders` prompti ichida misol sifatida haqiqiy ko'rinadigan shaxs F.I.Sh. qattiq yozilgan (shaxsiy ma'lumot kodda; nomi bu yerda yozilmaydi).
- `asstCrmCache` faqat TTL bilan tekshiriladi, eskilari o'chirilmaydi (faqat apply/link'da to'liq tozalanadi).

---

### D.8 `chek/` — Shartnoma nazorati (`/chek`)

**Vazifa:** kontrolyor shartnoma hujjatini (original/nusxa) tekshirib qabul yoki rad etadi; yozuv `chek_dog` ga, cron guruhga ruscha HTML xabar yuboradi. UI nomi "Shartnoma nazorati". Birinchi commit 2026-07-01 (loyihadagi eng eski modullardan).

**Fayllar:** `chek.controller.ts`, `chek.service.ts`, `dto/chek.dto.ts` (`VID_DOGOVORA`: `original`, `ekzemplyar`, `original_fixed`, `ekzemplyar_fixed`; `KONTROLYOR`: `otkaz`, `prinyat`), `chek.module.ts`. Frontend `frontend/app/[locale]/chek/` (panel va sidebar'dan tashqari; `baza-tab.tsx`, `tarix-tab.tsx`, `sozlamalar-tab.tsx`, `i18n.ts` 4 til: uz, uzc, ru, en).

**Endpointlar** (`/api/chek`, JWT + ruxsat):

| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/crm-lookup?contract=` | `chek:baza` | `crm.getContractMeta` (menejer, telefon, sotuv ofisi, obyekt, holat) |
| GET | `/crm-search?contract=` | `chek:baza` | `crm.searchContracts(contract, 8)` |
| POST | `/` | `chek:baza` | `create` (`data` ISO sana majburiy, `shtrafy` BigInt, `dobavil_*` aktor) |
| GET | `/hr-resolve?name=`, `/hr-search?q=` | `chek:baza` | Xon HR'dan menejer Telegram username |
| GET | `/?q&manager&branch&object&kontrolyor&dateFrom&dateTo&page&perPage` | `chek:tarix` | ro'yxat (default 50, max 200) |
| GET | `/filter-values` | `chek:tarix` | distinct menejer/ofis/obyekt (500 tadan) |
| GET | `/export?...&lang=` | `chek:tarix` | `.xlsx` (`chek_<sana>.xlsx`, 4 til yorliqlari, default ru) |
| GET / PATCH / DELETE | `/:id` | `chek:tarix` | bitta / tahrir / o'chirish |
| POST | `/:id/send-tg` | `chek:tarix` | qo'lda yuborish (holatga qaramaydi) |
| GET / PATCH | `/tg-config` | `chek:sozlamalar` | Telegram sozlamasi (GET token bilan TO'LIQ qaytaradi) |
| POST | `/tg-test` | `chek:sozlamalar` | test xabar |
| GET / PATCH | `/hr-config` | `chek:sozlamalar` | HR API (URL, kalit, secret — GET to'liq qaytaradi) |
| POST | `/hr-test` | `chek:sozlamalar` | HR ulanish testi (persons soni) |

**Sozlamalar:** `chek.tg.config` (JSON: `botToken`, `groupId`, `intervalMin` default 5, `fromHour` 9, `toHour` 21, `enabled`, `messageStyle` card|status|quote) va `chek.hr.config` (JSON: `url`, `apiKey`, `apiSecret`). Ikkalasi ichida sir OCHIQ matnda (shifrlanmagan).

**Cron `notifyCron`** (`EVERY_MINUTE`): `enabled` + token + guruh; Toshkent soati oynada (`inWindow`, teng = 24 soat, tungi oraliq qo'llab-quvvatlanadi); `lastNotifyAt` (xotirada) dan beri `intervalMin` o'tgan; `tg_send=false` eng eski 50 ta yozuv; muvaffaqiyatda `tg_send=true`, `tg_sent_at`.

**Qoidalar:** `update` da `kontrolyor` o'zgarsa (Tarix "To'g'rlandi": otkaz -> prinyat) `tg_send=false` (xabar qayta ketadi); `tgSend` ni DTO orqali qo'lda ham qo'yish mumkin. Xabar (`buildTgMessage`): shartnoma, menejer + username, ofis, turi (`TG_VID`), qaror, rad sababi (faqat otkaz), vaqt (Asia/Tashkent); obyekt, CRM holati, jarima xabarga kirmaydi. `resolveManager`: CRM ismi kirilldan lotinga (`CYR_LAT`), HR `full_name` bilan token moslik >= 2 (prefiks moslik >= 3 harf); HR `/persons?per_page=1000&page=N` (20 sahifagacha, headerlar `X-API-Key`, `X-API-Secret`), kesh 10 daqiqa.

**Gotchalar:** `messageStyle` saqlanadi, lekin `notifyCron` va `sendOne` uslubsiz chaqiradi (doim `card`); doim xato beradigan 50 ta eski yozuv yangilarini to'sadi; `lastNotifyAt` xotirada (restartdan keyin darhol yuboradi); `setTgConfig` da `toHour: 0` kiritilsa `|| 24` tufayli 24 ga aylanadi; Sozlamalar tabidagi parol faqat frontend to'sig'i (haqiqiy himoya `chek:sozlamalar`); `seed.ts::ALL_PERMS` da `chek:*` yo'q (SUPERADMIN baribir oladi).

---

### D.9 `agent-team/` — Admin > Agent > "Agent Support" (Python bot kuzatuvi)

**Vazifa:** Python bot (`agents/*.py`, servis `xon-tranzactions-leader`, @TRanSupport_bot) yozadigan PostgreSQL `agents` sxemasini panelda ko'rsatish. Birinchi commit 2026-09-28. Frontend: `frontend/app/[locale]/(panel)/admin/agent/page.tsx` + `frontend/components/agent-team/*` (overview-hero, agent-cards, activity-view, chat-view, plans-view, memory-view, health-view, settings-view, agent-support-panel).

**Qoidalar (fayl sarlavhasi):** har SELECT bitta `READ ONLY` tranzaksiyada (`SET TRANSACTION READ ONLY`, `SET LOCAL statement_timeout = '8s'`); jadval/ustun nomlari SQL'da qattiq, qiymatlar faqat parametr (`Prisma.sql`); SQL'da `now()` yo'q (DB soati skew) — vaqt chegaralari JS'dan `::timestamptz`; bot o'rnatilmagan bo'lsa xato emas: `installed=false` + sabab (`no_schema`, `no_tables`, `no_permission`, `db_error`), HTTP 200; sirlar (token, parol, lease owner, reja hash'lari, kv dagi chat tarixi) javobga tushmaydi. O'rnatish holati 15 s keshlanadi; kutilgan 8 jadval: `kv_store`, `agent_runs`, `agent_tasks`, `agent_memory`, `agent_health`, `agent_promises`, `agent_alert_log`, `agent_chat_log`.

**Endpointlar** (`/api/agent-team`, JWT; hammasi `agent:view`, bittasi `agent:manage`):

| Metod | Yo'l | Nima qaytaradi |
|---|---|---|
| GET | `/overview` | bot holati (heartbeat yoshi: 60 s, warn 180 s, error 600 s), bugungi statistika, kutilayotganlar, salomatlik |
| GET | `/agents` | har agent (leader, support, checker, teacher): yoqilganmi, model, bugun/7 kun, oxirgi xato |
| PUT | `/agents/:name/enabled` `{enabled: boolean}` (`agent:manage`) | YAGONA YOZUV: `agents.kv_store` `agent_enabled_<nom>` = `'1'`/`'0'` (`INSERT ... ON CONFLICT`); nom faqat oq ro'yxatdan; sxema yo'q -> 409 |
| GET | `/runs?agent&status&source&from&to&q&page&perPage`, `/runs/:id` | `agent_runs` (statuslar: ok, empty, error, timeout, disabled, capped, rate_limited, no_prompt, bad_name; manbalar: dm, deleg, synth, fon, checker, teacher_daily, manual) |
| GET | `/chat?role&q&from&to&forward&before&limit` | `agent_chat_log` (egasi bilan suhbat, kursor bilan) |
| GET | `/tasks`, `/promises` | `agent_tasks`, `agent_promises` |
| GET | `/plans` | Support REJA: kutilayotganlar (TTL 600 s), ijro holati, tarix. Tasdiq ([Ha]/[Yo'q]) bu API'da YO'Q, faqat Telegram'da |
| GET | `/memory/log`, `/memory/files`, `/memory/file?name=` | `agent_memory` logi; `agents/memory/` oq ro'yxat fayllari (`INDEX.md`, `leader.md`, `learned.md`, `leader-runtime.md`, `support.md`, `checker.md`, `teacher.md`, `daily/YYYY-MM-DD.md`), <= 256 KB |
| GET | `/health` | Checker tekshiruvlari (komponentlar: services, db, disk, facts, leader_bot, deploy, bank_sync, sverka, xonpay, google_export, oplatykv_sync, agents), alertlar, Facts holati, kv kalitlar holati |
| GET | `/facts/section?key=` | `agents/state/support_facts.json` bo'limi (<= 8 MB fayl) |
| GET | `/settings` | bot env holati (faqat mavjudlik/bool), timeoutlar, default modellar, konstantalar, `v1LeaderActive` |

**Env o'qish:** bot env fayli = env `AGENTS_ENV_FILE` (nisbiy bo'lsa repo ildiziga nisbatan) yoki `<repo>/backend/.env`; fayl `mtime+size` keshi bilan har so'rovda stat qilinadi (<= 256 KB). Fayl o'qilsa FAQAT fayl manba (bot ham shunday ko'radi), o'qilmasa zaxira `process.env`. Javobga faqat `setupToken: bool`, `botToken: bool`, egasi ID mosligi, `useCli`, model nomlari, cap, timeout, `v1LeaderActive` (v1 leader `LEADER_ENABLED != '0'` va `LEADER_OWNER_TG_IDS` bor — 409 xavfi) tushadi. `agents/` katalogi env `AGENTS_DIR` yoki `<cwd>/../agents`.

**Gotchalar:** egasi Telegram ID si `agent-team.service.ts` va types izohida qattiq yozilgan (bot `contract.py` bilan moslik uchun; qiymat bu yerda yozilmaydi); `/chat` va `/memory/file` egasining shaxsiy suhbatini `agent:view` egasi bo'lgan har kimga ko'rsatadi; `agents` sxemasi `prisma db push` dan himoyalangan, chunki u `public` emas.

---

### D.10 `leader/` — eski v1 Leader moduli

**Nima:** 2026-09-28 da (commit "feat(leader): alohida Telegram Leader agentlar jamoasi (v1 — faqat ko'rish va tahlil)") boshqa sessiya yozgan NestJS ichidagi Telegram bot: Claude Messages API (`agent.aiKey` yoki `ANTHROPIC_API_KEY`), o'z asboblari, `leader_*` jadvallari. Shu kuni keyin Python Claude Code CLI asosidagi yangi tizim (`agents/`) yaratildi; `agentlar.md`: "Bu tizim `backend/src/leader/` bilan BOG'LIQ EMAS... Ularga tegilmaydi". O'shandan beri leader kodi o'zgarmagan.

**Fayllar:** `leader.module.ts` (10 provider, modul importi yo'q, boshqa servislar `ModuleRef` orqali), `leader-config.service.ts`, `leader-bot.service.ts` (long-polling), `leader-orchestrator.service.ts` (Leader + Support/Checker sub-agentlar, Teacher), `leader-claude.service.ts` (Messages API, kunlik token hisobi `leader_runs`), `leader-memory.service.ts`, `leader-facts.service.ts` (faqat o'qish asboblari), `leader-code-tools.service.ts` (+ spec), `leader-health.service.ts`, `leader-alert.service.ts`, `leader-telegram.api.ts`, `leader.types.ts`.

**Faollik sharti** (`LeaderConfigService.enabled()`): `LEADER_ENABLED !== '0'` VA `LEADER_BOT_TOKEN` bor VA `LEADER_OWNER_TG_IDS` da kamida bitta raqamli ID. `LeaderModule` `app.module.ts` da doim import qilingan, ya'ni o'chirish faqat env orqali. Egasi qarori: `LEADER_ENABLED=0`. Serverda haqiqatda o'chiqmi — koddan aniq emas; Admin > Agent Support > Sozlamalar (`v1LeaderActive`) ko'rsatadi.

**Ishlash (yoqilgan bo'lsa):**
- Bot: faqat egasi (`from.id` ro'yxatda, `chat.type=private`, `chat.id=from.id`), boshqalar jim e'tiborsiz; offset `settings` `leader.pollOffset` (6 kundan eski offset 0 dan); bootda 120 s dan eski xabarlar tashlanadi; 409/xato -> 5 s, 401 -> 60 s; har chatda navbat (5 tagacha), "typing" har 4 s.
- Orkestrator asboblari: `ask_support`, `ask_checker` (har biri 2 marta), `remember` (faqat egasi xabarida "eslab qol/yodda tut/unutma" bo'lsa — injection himoyasi), `save_lesson` (Teacher). Facts asboblari: `txn_summary`, `txn_top`, `client_income`, `contract_payments`, `account_balances`, `sync_status`, `sverka_status`, `xato_summary`, `bank_changes`, `integrations_status`, `api_usage`, `panel_activity`, `deploy_status`, `system_status`. Kod asboblari: `list_files`, `grep`, `read_file`, `git_log` (sirlar yashiriladi, qo'shimcha env `LEADER_SECRET_LITERALS`). `health_checks`.
- Cronlar: `leaderAlerts` `*/15 * * * *` (Asia/Tashkent) — deterministik tekshiruv, faqat CRITICAL egasiga, 4 soat qayta yubormaslik, "Tiklandi" xabari, bootdan keyin 10 daqiqa jim; Teacher `30 22 * * *` (egasiga xabar yubormaydi, `LEADER_TEACHER=0` o'chiradi).
- Yozish faqat `leader_messages`, `leader_memories`, `leader_runs`, `leader_alerts` va `settings` ning oq ro'yxat kalitlari (`leader.pollOffset`, `leader.teacherLastRun`). Biznes jadvallarga yozmaydi.
- Env: `LEADER_ENABLED`, `LEADER_BOT_TOKEN`, `LEADER_OWNER_TG_IDS`, `LEADER_MODEL` (default `claude-sonnet-5`), `LEADER_MODEL_STRONG` (default `claude-opus-5-5`), `LEADER_DAILY_TOKENS` (default 3 000 000), `LEADER_ALERTS`, `LEADER_TEACHER`, `LEADER_REPO_DIR`, `LEADER_AGENTS_DIR`, `LEADER_SECRET_LITERALS`.

**Xavf:** yangi Python bot ham `backend/.env` dagi `LEADER_BOT_TOKEN` nomini o'qiydi. v1 yoqilsa backend restartidan keyin ikkalasi bitta tokenda `getUpdates` qiladi: Telegram 409, egasi ikki botdan javob oladi; Python bot esa startda buni aniqlasa ishga tushmaydi (`config.py::v1_leader_conflict`). Yechim: `LEADER_ENABLED=0`. Facts `schedulers` faqat `leader_alerts` va `leader_runs` ni o'qiydi.

---

### D.11 Setting kalitlari jamlanmasi (faqat nomlar)

| Kalit | Kim yozadi | Kim o'qiydi | Izoh |
|---|---|---|---|
| `agent.enabled`, `agent.dailyTime`, `agent.dateFrom` | AgentService.saveConfig | AgentService, TrSupportService/TrAriza/TrMalumot (`agent.dateFrom`) | digest + XATO ro'yxati sanasi |
| `agent.botToken` (shifr), `agent.groupId` | saveConfig | AgentService (digest, TG auth HMAC), CorrectionService (guruh qarori) | |
| `agent.whitelist` | saveConfig | AgentService.authorizeTg | `[{id,name}]` |
| `agent.listToken` | AgentService (avto) | assertKey | ochiq matn, rotatsiyasiz |
| `agent.lastResult`, `agent.lastDigestMsgId` | AgentService | AgentService | texnik |
| `agent.aiKey` (shifr), `agent.aiModel` | saveConfig | AgentAi, correction-bot, chek-order, v1 leader | umumiy AI kaliti |
| `agent.aiEnabled`, `agent.aiIntervalMin`, `agent.aiName`, `agent.aiFromHour`, `agent.aiToHour` | saveConfig | AgentAiService, TrArizaService (`aiName`) | |
| `corrbot.botToken` (shifr), `corrbot.groupId`, `corrbot.enabled`, `corrbot.whitelist` | CorrectionBotService | runner | |
| `chekorder.tg.enabled`, `.botToken` (shifr), `.groupId`, `.botUsername`, `.appShort`, `.webhookSecret` | ChekTgService | ChekTgService | |
| `chek.tg.config`, `chek.hr.config` | ChekService | ChekService | JSON, ichida sir ochiq |
| `leader.pollOffset`, `leader.teacherLastRun` | v1 leader | v1 leader | |

`agents.kv_store` `agent_enabled_<nom>` — `settings` emas, Python bot sxemasi (D.9).

### D.12 Env nomlari (qiymatsiz)

`ANTHROPIC_API_KEY`, `APP_URL`, `APP_PUBLIC_URL`, `API_PUBLIC_URL`, `UPLOADS_DIR`, `AGENTS_UPLOADS_DIR`, `AGENTS_DIR`, `AGENTS_ENV_FILE`, `TR_SUPPORT_CODE`, `ADMIN_ACTION_PASSWORD`, `AGENT_BRIDGE_KEY` (+ bot tomonda `AGENT_BRIDGE_URL`, `PORT`), `TRUST_PROXY_HOPS`, `TG_BOT_TOKEN`, `ATTACHMENTS_NOTIFY_CHAT` (ariza fayli xabarlari), `LEADER_*` (D.10).

### D.13 Kesishgan qoidalar va tuzoqlar (umumiy)

- **XATO ta'riflari:** (a) `transactions.service.ts::clientXatoTransactions` (CLIENT, `is_contract_manual=false`, IMPORT/ALOQA_BANK emas, yashirilmagan) va (b) `OplataKvService.buildXatoFilter` (bu bo'limdagi hamma modul (b) ni ishlatadi). (b) da `is_contract_manual` hisobga olinmaydi, shuning uchun (b) soni (a) dan ko'p bo'lishi mumkin.
- **Obyekt qoidasi** ikki joyda turlicha kodlangan: AI `objectCode` (`^\d+([A-Z]{2,4})`) + `looseSameContract`; TR Support `objectCodeOf` (`categorization/contract-parser.ts`) + `harfFarqiMos` (prefiks tengligi). Biri o'zgarsa ikkinchisini ham tekshir.
- **Shartnoma yozish yo'llari:** `setContractManual` (ariza tasdig'i, AI, harf/ulash, XATO rejimi, correction-bot) — CRM tekshiruvisiz, `is_contract_manual=true`; `setContract` (TR Support oddiy tahriri) — CRM verified majburiy. `buildXatoFilter` faqat `contract_no` CRM `found` ro'yxatida bo'lsa XATO'dan chiqaradi.
- **Egasi qarorlari xronologiyasi:** 2026-07-23 ariza oqimi va AI agent; 2026-07-30 correction-bot; 2026-08-12 chek-order; 2026-08-13 IMZO majburiy + Word o'qish; 2026-09-28 agent-bridge, agent-team, v1 leader; 2026-09-30 XATO ro'yxatidagi to'lov bot orqali tahrirlanmaydi, `shartnoma=XATO` faqat "XATO" yoziladi; 2026-10-01 TR Support tasdig'i matnli (tugmasiz); 2026-10-03 harf farqi qoidasi (arizasiz, tasdiqsiz); 2026-10-05 XATO ulash (tasdiq bilan, obyekt bir xil), `xatoQoladi`, hisob/XATO fayl ma'lumoti, AI Perebroska bot orqali; 2026-10-07 perebroska tasdiqsiz; 2026-10-09 eski tarix bot orqali.
- **Telegram tokenlari:** backend ichida kamida 5 ta bot konfiguratsiyasi bor (`agent.botToken`, `corrbot.botToken`, `chekorder.tg.botToken`, `chek.tg.config.botToken`, env `TG_BOT_TOKEN`) + v1 leader va Python bot (`LEADER_BOT_TOKEN`). Long-polling qiluvchilar (correction-bot, v1 leader, sverka boti, Python bot) bir-biri bilan bir xil token ishlatsa 409.
- **Qaytmas amallar (taklif qilma):** `POST /api/correction/clear`, `DELETE /api/chek-order` (fayllar bilan), `DELETE /api/chek/:id`, `DELETE /api/oplata-kv/cleanup-xato-contracts` (boshqa modul).
- **Sirlarga ehtiyot:** `settings` ni to'liq SELECT qilma; `chek.tg.config` va `chek.hr.config` GET endpointlari sirni to'liq qaytaradi; `agent.listToken` ochiq matnda.

### D.14 Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"

- `OplataKvService.buildXatoFilter` -> digest soni, public xato-list, AI chat `xato_query`, correction-bot `list_xato`, TR Support `xatoStatus`/`find`/`submit`/`xatoFayl`, panel `xatoOnly`, `bulkCrmFix`.
- `CorrectionService.persistRequest` / `createRequestWithFile` -> public xato-list submit, TR Support ariza (bot), panel "Shartnoma biriktirish". `approve` -> panel, AI tekshiruvchi, `directCorrect`.
- `CategorizationService.setContractManual` -> `approve`, `botAssignContract`, TR Support (harf, ulash, XATO). `setManual`/`setContract`/`restoreSnapshot` -> TR Support apply/rollback (tarixdagi "kim" `actorLabel` parametri bilan).
- `ChekOrderService.matchOrder` / `resultOf` -> panel Tekshirish va bot `chek-find` (bir xil natija). `paymentCheck` / `resAllMatch` -> panel Chek payment, Excel eksport, bot `payment-check`.
- `CrmService.lookupForAgent` / `matchComposites` -> bot `crm-lookup` va panel "XATO -> CRM" (bir xil match).
- `OplataKvService.analyzePerereboskaAriza` / `createPerereboska` -> panel AI Perebroska va bot `perebroska/*`.
- `SyncService.resolveBackfillTargets` / `runBackfill` -> panel "Eski tarixni yuklash" va bot `tarix/*`.
- `agents/contract.py` dagi yo'l konstantalari va javob kalitlari <-> `agent-bridge.types.ts` (qo'lda moslanadi; bridge javobi o'zgarsa Python parserlari ham).
- `audit/audit.routes.ts::KNOWN` -> yangi bridge POST endpointi qo'shilsa o'qiladigan audit nomi shu yerga.
- Yangi ruxsat -> `backend/src/auth/permissions.ts`, `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS`; Telegram mehmon ruxsatlari `auth/jwt.strategy.ts::validate`.

### D.15 Tez-tez qilinadigan o'zgarishlar — qayerda

| Vazifa | Fayl va funksiya |
|---|---|
| AI tekshiruvchi qoidasi / prompti | `correction/agent-ai.service.ts::callClaude`, guardlar `processRequest` (5-5.5 qadam), `objectCode`, `looseSameContract` |
| AI ish oynasi / interval | `agent-ai.service.ts::tick`, `getWorkHours`, `getIntervalMin`; sozlama `agent/agent.service.ts::saveConfig` |
| Ariza dublikati / snapshot | `correction/correction.service.ts::persistRequest`, `resolveTx` |
| Guruhga qaror xabari matni | `correction.service.ts::notifyGroupDecision` |
| Digest matni / vaqti | `agent/agent.service.ts::formatDigest`, `tick`, `runDigest` |
| Public ro'yxat ustunlari | `agent.service.ts::_list` (+ `OplataKvService.getXatoListForAgent`) |
| Harf farqi qoidasi | `tr-support/tr-support.service.ts::harfFarqiMos`, `harfFarqi` (+ `tr-support.service.spec.ts`) |
| XATO ulash / obyekt tekshiruvi | `tr-support.service.ts::xatoUlash`, `categorization/contract-parser.ts::objectCodeOf` |
| To'lov havolasi (general_id) | `tr-support.service.ts::findTxRef`, `GID_REF_RE` |
| Bot endpointi qo'shish | `agent-bridge.controller.ts` (+ `@Throttle`), `agent-bridge.validation.ts`, `agent-bridge.service.ts` (pick), `agent-bridge.types.ts`, `audit/audit.routes.ts`, spec fayllar, `agents/contract.py` |
| Chek skoring | `chek-order/chek-order.service.ts::matchOrder`, `resultOf`, `groupResults` |
| Chek OCR maydonlari | `chek-order.service.ts::claudeExtractOrders` |
| Mini App kirish | `chek-order/chek-tg.service.ts::auth`, `loginWidget`, `postGroupButton`; `auth/jwt.strategy.ts` |
| Shartnoma nazorati xabari | `chek/chek.service.ts::buildTgMessage`, `TG_VID`, `notifyCron` |
| Agent Support yangi ko'rinish | `agent-team/agent-team.service.ts` (faqat `ro()` ichida SELECT), `agent-team.types.ts`, `frontend/components/agent-team/*` |

## E. Web panel (frontend)

Panel — `frontend/` papkasidagi Next.js 14 (App Router) ilovasi. Brauzer → nginx (`transactions.xonapps.uz`) → `/` frontend (port 3000), `/api/` backend (NestJS, port 3001). Frontend hech qanday server-side API route'ga ega emas (`app/api/route.ts` yo'q): hamma ma'lumot brauzerdan to'g'ridan-to'g'ri backend'ga `fetch` bilan olinadi. Panel sahifalari deyarli hammasi `'use client'` komponentlar.

### E.1 Texnologiyalar va konfiguratsiya

| Narsa | Qiymat / joy | Izoh |
|---|---|---|
| Framework | `next` 14.1.0, `react` 18.2 | App Router, `app/[locale]/...` |
| Server holati | `@tanstack/react-query` v5 | `components/providers.tsx`: `staleTime 30s`, `refetchOnWindowFocus: false`, `retry: 1` |
| Klient holati | `zustand` v4 | `lib/auth.ts` (persist), `lib/preferences.ts`, `lib/ui.ts` |
| i18n | `next-intl` v3.5 | `i18n/config.ts`, `i18n/request.ts`, `middleware.ts` |
| Stil | `tailwindcss` 3.4 + `tailwindcss-animate`, `darkMode: 'class'` | `tailwind.config.ts`, `app/globals.css` (HSL CSS o'zgaruvchilar) |
| UI primitivlar | shadcn uslubi: Radix (`dialog`, `dropdown-menu`, `popover`, `select`, `label`, `slot`, `toast`) + `class-variance-authority` + `tailwind-merge` | `components/ui/{badge,button,card,dialog,dropdown-menu,input,label,select,table}.tsx` |
| Ikonlar | `lucide-react` | hamma joyda |
| Toast | `sonner` (`<Toaster position="top-right" richColors />`) | `app/[locale]/layout.tsx`; ~55 fayl `toast.*` ishlatadi (~555 chaqiriq). Radix toast paketi o'rnatilgan, lekin ishlatilmaydi |
| Animatsiya | `framer-motion` | `/api` sahifasi, `date-range-calendar`, `plan-viewer-dialog`, `purpose-modal` |
| 3D | `three`, `@react-three/fiber`, `@react-three/drei` | Faqat ishlatilmayotgan `components/api-*-3d*/api-hero-r3f/silk/crystal` fayllarida — amalda "o'lik" bog'liqlik |
| Markdown | `react-markdown` + `remark-gfm` | `admin/agent`, `agent-team/memory-view`, `ai-perereboska-module` |
| Boshqa | `cmdk` (`api-command-palette`), `date-fns` (`date-range-calendar`), `html-to-image` (dashboard'da widgetni PNG qilib yuklash, dynamic import) | `react-hook-form`, `zod`, `@hookform/resolvers` o'rnatilgan, lekin hech qayerda import qilinmaydi |

- `next.config.mjs`: `createNextIntlPlugin('./i18n/request.ts')`; `distDir: process.env.NEXT_DIST_DIR || '.next'` (deploy temp papkaga build qilib atomik almashtiradi, server `next start` doim `.next` ni o'qiydi); `eslint.ignoreDuringBuilds: true`; `typescript.ignoreBuildErrors: false` (TS xatosi build'ni to'xtatadi — shuning uchun push'dan oldin lokalda `npm run build` majburiy); `productionBrowserSourceMaps: false`; `reactStrictMode: true`.
- `tsconfig.json`: alias `@/*` → `frontend/*`; `include` da `.next-verify/types/**` ham bor (lokal tekshiruv build papkasi).
- Skriptlar: `dev`/`start` port 3000, `build`, `lint`. `scripts/i18n-merge.mjs` — `{ns: {key: {uz,ru,en}}}` ko'rinishidagi fragment JSON'ni uchala `messages/*.json` ga birlashtiradi (`node scripts/i18n-merge.mjs <fragment.json>`).
- Env: faqat `NEXT_PUBLIC_API_URL` (namuna `frontend/.env.example`, default `http://localhost:3001/api`) va build uchun `NEXT_DIST_DIR`. `NEXT_PUBLIC_*` build vaqtida bundle'ga yoziladi — o'zgarsa qayta build kerak.
- Ilova metadata (`app/layout.tsx`): sarlavha shabloni `%s · Xon Tranzaksiyalar`, `themeColor #4f46e5`. Ikonlar: `app/icon.svg`, `app/apple-icon.svg`, `/api` uchun alohida `app/[locale]/api/icon.svg`.

### E.2 Yo'llar daraxti (umumiy ko'rinish)

```
app/
  layout.tsx                       root (metadata, children'ni qaytaradi)
  [locale]/layout.tsx              <html>, theme bootstrap script, ThemeProvider, NextIntlClientProvider, ReactQueryProvider, Toaster
  [locale]/page.tsx                → redirect /{locale}/dashboard
  [locale]/login                   panel login
  [locale]/showcase                animatsion "showcase" sahna (ShowcaseStage)
  [locale]/chek                    Chek sahifasi (panel tashqarisida, lekin AuthGuard bilan)
  [locale]/tg/chek                 Telegram Mini App (chek order)
  [locale]/xato-list               Telegram WebApp XATO ro'yxati (ochiq, maxfiy kalit / Telegram imzo)
  [locale]/api                     ochiq Developer API hujjati / sinov sahifasi (login yo'q)
  [locale]/(panel)/layout.tsx      AuthGuard + PrefsInit + Sidebar + RouteGuard + ScrollToTop + DeployModal + AntiStressHost
  [locale]/(panel)/...             dashboard, transactions, statement, check, check-crm, changes, vznos,
                                   oplatykv(+crm,billing,xato-crm), chek-order, setup/*, admin/*, profile,
                                   customers(+[id]), contracts(+[id]); eski: crm → /oplatykv/crm, biling → /oplatykv/billing
```

- `(panel)/layout.tsx` da `export const dynamic = 'force-dynamic'` — panel statik render qilinmaydi.
- Server-side `redirect()` bilan ishlaydigan indeks sahifalar: `/{locale}` → `/dashboard`, `/admin` → `/admin/users`, `/setup` → `/setup/banks`, `/crm` → `/oplatykv/crm`, `/biling` → `/oplatykv/billing`.

### E.3 Lokalizatsiya (i18n)

- Tillar: `uz` (default), `ru`, `en` — `i18n/config.ts`. `middleware.ts` `next-intl/middleware` bilan `localePrefix: 'always'`: har yo'l `/{locale}/...` bo'ladi; matcher `api`, `_next`, `_vercel` va nuqtali (fayl) yo'llarni chetlab o'tadi.
- Matnlar: `frontend/i18n/messages/{uz,ru,en}.json`, har biri ~3741 qator, bir xil kalit tuzilmasi. Namespace'lar: `app, nav, topbar, profile, notifications, deploy, admin, adminLogin, cleanup, customers, contracts, payments, auth, dashboard, transactions (eng katta, ~343 kalit), setup, accounts, credentials, syncLogs, counterparties, crm, statement, check, checkCrm, common, quickActions, onboarding, charts, pomodoro, idInspector, vipiskaDebug, billing, oplatykv (~231), drilldown, changes, api, apiExplorer, banks, adminUsers, roles, purposeModal, chekOrder, sverkaAgent, adminAgentTeam`.
- `i18n/request.ts` noma'lum locale'da `notFound()`; `[locale]/layout.tsx` ham tekshiradi va `generateStaticParams` uchala tilni beradi.
- Haqiqat: ko'p yangi modullar (ОплатыКв ichki modallari, TR Support, AI Переброска, sevimlilar, sidebar "Sevimlilar" yorlig'i va h.k.) matnni to'g'ridan-to'g'ri o'zbekcha (ba'zan ruscha) yozadi — `t()` orqali emas. Til almashtirish bu joylarga ta'sir qilmaydi.
- `/chek` sahifasining o'z mini-i18n'i bor: `app/[locale]/chek/i18n.ts` (til tanlovi localStorage'da).
- `components/language-switcher.tsx`: bayroqli dropdown (inline SVG bayroqlar — Windows emoji bayroqni ko'rsatmagani uchun); yo'lning birinchi segmentini almashtirib `router.push` qiladi. Topbar'da `compact` holatda, login sahifasida ham bor.

### E.4 API klient — `frontend/lib/api.ts`

- `API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'`. Yo'llar shu prefiksga qo'shiladi (masalan `api.get('/oplata-kv')` → `.../api/oplata-kv`).
- `apiFetch(path, init)`: `Content-Type: application/json`; `auth` (default `true`) bo'lsa `localStorage['xt_token']` dan `Authorization: Bearer <JWT>`. Default timeout **15 s** (`AbortController`); timeout'da `isTimeout=true` va matn "Server javob bermayapti — keyinroq urinib ko'ring". Xato javobda `ApiError` (`status`, `data`, `message` = `data.message || data.error.message || statusText`). Javob JSON bo'lmasa matn sifatida qaytadi.
- `api.get/post/put/patch/delete(path, body?, {timeout?, auth?})` — uzoq amallar (sync, backfill, AI) chaqiruvchi tomonda katta `timeout` beradi.
- `api.postForm(path, FormData)` — multipart yuklash (Content-Type'ni brauzer qo'yadi).
- `apiDownload(path, fallbackName)` (GET) va `apiDownloadPost(path, body, name)` — blob yuklab olish, `Content-Disposition` dan fayl nomi; Excel/PDF eksportlar uchun.
- `apiObjectUrl(path)` — JWT bilan faylni olib `blob:` URL qaytaradi (rasm/plan ko'rish, WebGL teksturasi uchun CORS'ni chetlab o'tadi).
- 401 da avtomatik logout yo'q: xato chaqiruvchiga qaytadi. Ba'zi sahifalar (`admin/counterparties` import, `admin/sync-logs` ZIP eksport, `oplatykv/billing`, `xato-list`) `NEXT_PUBLIC_API_URL` bilan o'z `fetch` ini yozadi.

### E.5 Autentifikatsiya va sessiya — `lib/auth.ts`, `components/auth-guard.tsx`

- `useAuth` (zustand + `persist`, kalit `xt_auth`): `token`, `user` (`AdminUser`: `id, email, fullName, role, roleId, roleLabel, permissions[]`), `hasHydrated`.
  - `login(email, password)` → `POST /auth/login` (`auth:false`) → `{token, user}`; token `localStorage['xt_token']` ga ham yoziladi (ya'ni token ikki joyda: `xt_auth` ichida va `xt_token`).
  - `hydrate()` → `GET /auth/me`, `user` yangilanadi (ruxsatlar yangilanishi shu yerda). Har qanday xatoda (shu jumladan timeout yoki backend restart) token va user tozalanadi → foydalanuvchi login'ga tushadi.
  - `logout()` faqat lokal tozalash (backend chaqirilmaydi); AuthGuard keyin `/login` ga yo'naltiradi.
  - `hasPermission(perm)` va `useHasPermission(perm)` — faqat `user.permissions.includes(perm)`; rol nomi hardcode qilinmagan. SUPERADMIN'ga backend hamma ruxsatni beradi.
- `AuthGuard` (`(panel)/layout.tsx` va `/chek` da): zustand rehydrate tugashini kutadi; token yo'q bo'lsa `/{locale}/login?next=<joriy yo'l>` ga `replace`. Token bo'lsa `hydrate()` chaqiradi va tugaguncha `SplashLoader` (to'liq ekran `ShowcaseStage` animatsiyasi + progress chiziq) ko'rsatadi. Effekt bog'liqliklarida `pathname` bor — **har sahifa almashganda `/auth/me` qayta chaqiriladi**.
- Gotcha: deploy paytida backend restart (5-8 daqiqa) vaqtida sahifa almashtirilsa `/auth/me` xato beradi va sessiya o'chadi (qayta login kerak bo'ladi).
- Rol o'zgarsa: qayta login shart emas — keyingi navigatsiya yoki hard refresh `/auth/me` orqali yangi ruxsatlarni oladi.

### E.6 Ruxsatlar — `lib/permissions.ts`

- `PERMS` obyekti backend `backend/src/auth/permissions.ts` bilan sinxron bo'lishi kerak (yangi ruxsat 3 joyda: backend `permissions.ts`, `frontend/lib/permissions.ts`, `backend/prisma/seed.ts::ALL_PERMS`).
- Holat (tekshirildi): backend'da 97 ta, frontend `PERMS` da 95 ta qiymat. Faqat backend'da: `credentials:reveal`, `xonpay:manage` — frontend ularni hech qayerda tekshirmaydi.
- Guruhlar (frontend nomlari): Dashboard widgetlari (`dashboard:view`, `dashboard:kpi_balance|kpi_accounts|kpi_banks|kpi_inflow|kpi_outflow|kpi_txn`, `dashboard:objects|daily|daily_bar|client|xonpay|top_accounts|sync_status|banks_breakdown|net_flow|recon`); Tranzaksiyalar (`transactions:view|manual_edit|manual_contract|application|auto_categorize|export|vipiska_view|sverka_view|sverka_fix|sverka_crm_view|sverka_crm_run`); O'zgargan (`changed_txn:view|check|restore`); Взнос (`vznos:view|manage`); Chek order (`chekorder:view|history|manage|assistant|tickets|telegram`); ОплатыКв (`oplatakv:view|create|edit|delete|import|split|sync|bulk_split|xato_crm|manage(legacy)`); Sozlash (`accounts:*`, `credentials:view|manage|test`, `banks:*`); Tizim (`users:*`, `roles:*`, `admin_login:view`, `counterparties:*`, `sync:view|history_view|settings_view|settings_edit|run`, `api_explorer:view`, `cleanup:view|run`, `import:view|run`, `export:view|run|manage|download|autsourcing`, `system:deploy`); `api_keys:view|manage`; `agent:view|manage`; Chek sahifasi (`chek:baza|tarix|sozlamalar`); qo'shimcha (`crm:view`, `categories:*`, `customers:*`, `contracts:*`, `payments:*`).
- Uch qatlamli tekshiruv: (1) `sidebar.tsx::NAV` menyuda ko'rsatish, (2) `route-guard.tsx::ROUTE_PERMISSIONS` URL qo'lda yozilsa ham sahifani yopish, (3) har sahifa ichida tugma/tab darajasida `useHasPermission`. Backend baribir har endpoint'da `PermissionsGuard` bilan tekshiradi — frontend tekshiruvi faqat UX.

### E.7 Panel karkasi: layout, sidebar, route-guard, topbar

**`(panel)/layout.tsx`** tartibi: `AuthGuard` → `PrefsInit` (accent + sevimlilarni yuklaydi) → `div.h-screen.flex` ichida `Sidebar` + `<main id="panel-scroll">` (yagona scroll konteyner) ichida `RouteGuard` → sahifa; yonida `ScrollToTop` (`#panel-scroll` 400px dan pastga tushsa paydo bo'ladi), `DeployModal` (global deploy bildirishnomasi), `AntiStressHost`.

**Sidebar — `components/sidebar.tsx::NAV`** (har bandda ro'yxatdagi ruxsatlardan bittasi yetarli):

| Guruh (`nav.*`) | Band | `href` | Ruxsat (any-of) |
|---|---|---|---|
| Asosiy (`groupMain`) | Bosh sahifa | `/dashboard` | `dashboard:view` |
| | Tranzaksiyalar | `/transactions` | `transactions:view` |
| | ОплатыКв | `/oplatykv` | `crm:view`, `oplatakv:view` |
| | Chek order | `/chek-order` | `chekorder:view` |
| Sozlash (`groupSetup`) | Banklar | `/setup` | `banks:view`, `accounts:view`, `credentials:view` |
| Tizim (`groupSystem`) | Admin paneli | `/admin` | `ADMIN_PERMS` = `users:view, roles:view, admin_login:view, counterparties:view, sync:view, api_explorer:view, cleanup:view, import:view, api_keys:view` |

- Sidebar tepasida "Sevimlilar" bloki (`usePrefs.favorites`, yulduz ikonka, hover'da X bilan olib tashlash). Sevimli href locale'siz saqlanadi.
- Dizayn: desktop'da 288px "3D" kartochka (`sb3d-*` CSS klasslari `globals.css` da, sichqoncha bilan tilt va "sheen", pastda aylanuvchi logo tanga); `lg` dan kichik ekranda chapdan chiqadigan drawer (`useUI.mobileNavOpen`, yo'l o'zgarganda yopiladi, ochiqligida body scroll bloklanadi).
- Vipiska, Sverka, Sverka CRM, O'zgargan, Взнос menyuda alohida yo'q — ular `transactions-tabs.tsx` orqali Tranzaksiyalar bo'limi tablari sifatida ochiladi. `/profile`, `/customers`, `/contracts` sidebar'da yo'q (profil topbar'dagi user menyusidan).

**RouteGuard — `components/route-guard.tsx`**
- `ROUTE_PERMISSIONS` (uzun prefiks birinchi, `find()` birinchi mosini oladi): `/setup/banks`→`banks:view`, `/setup/accounts`→`accounts:view`, `/setup/credentials`→`credentials:view`, `/setup`→`banks:view`, `/admin/users`→`users:view`, `/admin/roles`→`roles:view`, `/admin/sync-logs`→`sync:view`, `/admin/api-keys`→`api_keys:view`, `/admin/api-explorer`→`credentials:manage`, `/admin`→`users:view`, `/dashboard`→`dashboard:view`, `/transactions`→`transactions:view`, `/statement`→`transactions:vipiska_view`, `/check-crm`→`transactions:sverka_crm_view`, `/check`→`transactions:sverka_view`, `/changes`→`changed_txn:view`, `/customers`→`customers:view`, `/contracts`→`contracts:view`, `/oplatykv/crm` va `/oplatykv/billing`→`crm:view`, `/oplatykv`→`oplatakv:view`.
- Qoidasi yo'q (faqat API ruxsati himoya qiladi): `/vznos`, `/chek-order`, `/profile`. `/oplatykv/xato-crm` ning o'z qoidasi yo'q — `/oplatykv` prefiksiga tushib `oplatakv:view` talab qiladi (tab esa `oplatakv:xato_crm` bilan ko'rinadi).
- Ruxsat bo'lmasa: `LANDING_ROUTES` (`/dashboard`, `/transactions`, `/oplatykv`, `/setup/banks|accounts|credentials`, `/admin/users|roles|sync-logs`) dan foydalanuvchi kira oladigan birinchisiga jim `router.replace`. Hech biri bo'lmasa "Ruxsat yo'q" ekrani: markazda tasodifiy `/404-1.mp4` yoki `/404-2.mp4` video, pastki chap burchakda kartochka (`common.accessDenied`, `accessDeniedDesc`, `backToHome`).
- Gotcha'lar:
  - `/admin/*` dagi `login`, `import`, `export`, `agent`, `counterparties`, `cleanup` uchun alohida qoida yo'q → `/admin` qoidasiga tushadi va `users:view` talab qiladi. Ya'ni faqat `export:view` yoki `agent:view` bor foydalanuvchi bu tabni ko'ra olmaydi (layout tabni ko'rsatadi, lekin guard yo'naltirib yuboradi).
  - Sidebar "Admin paneli" `ADMIN_PERMS` dan bittasi bo'lsa ko'rinadi, lekin `/admin` server tomonda `/admin/users` ga yo'naltiradi → `users:view` bo'lmasa foydalanuvchi landing'ga qaytadi. `export:view`, `agent:view` `ADMIN_PERMS` da umuman yo'q.
  - `/setup` → `/setup/banks` (server redirect); `banks:view` bo'lmay faqat `accounts:view`/`credentials:view` bo'lsa sidebar orqali kirib bo'lmaydi (landing'ga qaytaradi), faqat to'g'ridan-to'g'ri URL bilan. `setup/layout.tsx` tablari ruxsat bo'yicha filtrlanmaydi.
  - `/admin/api-explorer` route qoidasi `credentials:manage`, tab esa `api_explorer:view` bilan ko'rinadi — ikkalasi kerak.

**Admin tab bar — `(panel)/admin/layout.tsx::TABS`** (faqat ruxsatli tablar ko'rinadi, `sticky top-[80px]`): `users` (`users:view`), `roles` (`roles:view`), `login` (`admin_login:view`, bank paroli sahifasi — panel logini emas), `counterparties` (`counterparties:view`), `sync-logs` (`sync:view`), `api-explorer` (`api_explorer:view`), `cleanup` (`cleanup:view`), `import` (`import:view`), `export` (`export:view`), `api-keys` (`api_keys:view`), `agent` (`agent:view`). Matn `admin.tabs.*`.

**Setup tab bar — `(panel)/setup/layout.tsx`**: `banks`, `credentials`, `accounts` (matn `nav.*`), ruxsat filtrisiz.

**Tranzaksiyalar tab bar — `components/transactions-tabs.tsx::TransactionsTabs`** (alohida route'lar, har biri `useHasPermission` bilan): `/transactions` (`transactions:view`), `/statement` Vipiska (`transactions:vipiska_view`), `/check` Sverka (`transactions:sverka_view`), `/check-crm` Sverka CRM (`transactions:sverka_crm_view`), `/changes` O'zgargan to'lovlar (`changed_txn:view`), `/vznos` "Взнос от имени клиента" (`vznos:view`). `transactions`, `statement`, `check`, `check-crm`, `changes`, `vznos` sahifalari shu komponentni chizadi.

**ОплатыКв tab bar — `(panel)/oplatykv/layout.tsx::TABS`**: "ОплатыКв" `/oplatykv` (`oplatakv:view`, exact), "CRM" `/oplatykv/crm` (`crm:view`), "Billing" `/oplatykv/billing` (`crm:view`), "XATO → CRM" `/oplatykv/xato-crm` (`oplatakv:xato_crm`). Ko'rinadigan tab 1 tadan ko'p bo'lsagina tab bar chiziladi. Topbar sarlavhasi doim "ОплатыКв".

**Topbar — `components/topbar.tsx`** (har sahifa `title`, `subtitle`, `actions` beradi):
- Fon: binafsha gradient + `ConstellationBg` (canvas'da sichqonchaga ergashuvchi nuqtalar tarmog'i).
- Chapda: mobil hamburger; 3D aylanuvchi tanga — bosilsa Anti-stress ekrani ochiladi (`useUI.setAntiStressOpen(true)` + `requestFullscreen`).
- O'ngda: `actions` slot; Sevimlilarga qo'shish yulduzchasi (joriy locale'siz yo'l + sarlavha `usePrefs.toggleFavorite` ga); Bildirishnoma qo'ng'irog'i; til tanlash; foydalanuvchi menyusi (avatar `useAvatar`, ism, `roleLabel`; "Profilim" → `/profile`; "Chiqish" → `logout`).
- Qo'ng'iroq: `sync:view` bo'lsa `GET /sync/logs?limit=20` har **30 s** (oxirgi 5 ta `FAILED` ko'rsatiladi, bosilsa `/admin/sync-logs`); hamma uchun `GET /_deploy/status` har **3 s** — deploy `running` (foiz, soniya, faza, mini progress), yangi versiya (`success` va sahifa ochilgandagi commit'dan farqli), `failed`. Deploy elementi bosilsa `window` ga `open-deploy-modal` CustomEvent yuboriladi → `DeployModal` ochiladi.

### E.8 Tema, accent va dizayn konventsiyalari

- **Qora rejim**: `localStorage['theme']` (`'light'|'dark'`). `[locale]/layout.tsx` `<head>` dagi inline skript birinchi render'dan oldin `html.dark` klassini qo'yadi (FOUC yo'q); `<html suppressHydrationWarning>`. `components/theme-provider.tsx::ThemeProvider` mount'da qayta o'qiydi, har o'zgarishda DOM'ga qo'llaydi va saqlaydi, `storage` event bilan boshqa tablarni sinxronlaydi; `useTheme()` hook (`theme`, `setTheme`, `toggleTheme`). Almashtirgich: `/profile` (shaxsiylashtirish) va `/chek` sahifa sarlavhasi. `/api` sahifasining o'z lokal `useTheme` i bor.
- **Rang tokenlari**: `globals.css` `:root` va `html.dark` da HSL o'zgaruvchilar (`--primary`, `--primary-soft`, `--primary-strong`, `--background`, `--muted`, `--success`, `--warning`, `--info`, `--destructive`, `--radius: 1rem` va h.k.), Tailwind ranglari ularga bog'langan.
- **Accent (shaxsiylashtirish)**: `lib/preferences.ts::usePrefs` — 8 ta accent (`indigo` default, `violet`, `emerald`, `rose`, `amber`, `sky`, `fuchsia`, `teal`). `html[data-accent="X"]` atributi `--primary`, `--primary-strong`, `--primary-soft`, `--ring` ni almashtiradi (dark rejim uchun alohida qiymatlar). `indigo` tanlansa atribut olib tashlanadi. Saqlash: `localStorage['xt_prefs_<userId>']` = `{accent, favorites}` — per-user, per-brauzer, serverga yozilmaydi. Gotcha: ko'p komponentlar `indigo-600` kabi Tailwind ranglarini to'g'ridan-to'g'ri yozgan (tab chiziqlari va h.k.), shuning uchun accent faqat `primary` tokenidan foydalanadigan joylarni o'zgartiradi.
- **Avatar**: `lib/use-avatar.ts` — rasm `localStorage['avatar_<userId>']` da data URL sifatida; `avatar-changed` CustomEvent va `storage` event bilan hamma joyda yangilanadi. Serverga yuklanmaydi.
- **Formatlash** (`lib/utils.ts`): `cn()` (clsx + twMerge); `formatMoney(v, 'UZS')` → `2 702 948 489,61 UZS` (bo'sh joy mingliklar, vergul kasr, butun bo'lsa kasr yo'q, manfiy uchun `−`); `formatDate` → `DD.MM.YYYY`; `formatDateTime` → `DD.MM.YYYY HH:mm` (brauzer vaqt zonasi bo'yicha).
- **Umumiy UI komponentlari**: `EmptyState` (ikonka + sarlavha + tavsif + action), `Skeleton`/`SkeletonRow` (yuklanish), `Sparkline` (kichik SVG trend), `WidgetErrorBoundary` (bitta widget yiqilsa sahifa ishlashda davom etadi, "widget yuklashda xato" yozuvi), `BankLogo` + `bankAbbr()` (bank kodi → `/banks/kapital.webp`, `/banks/ipak.svg`, `/banks/hamkor.svg`; logo yo'q banklar uchun gradient + qisqartma), `ScrollToTop`, `DateRangeCalendar` (date-fns + framer-motion sana oralig'i tanlagich; transactions va oplatykv'da).
- **Dizayn uslubi** (egasi afzalliklari): premium illyustratsiyalar (`public/3d/*.webp`, `tz/*amico.svg` uslubi), ikonkali ixcham toolbar tugmalari (`title` tooltip bilan), "instant" inputlar (debounce bilan darhol filtr), xato/ogohlantirishda to'liq ekran "shake" effektlari, binafsha brend gradienti, rounded-2xl kartochkalar, `tabular-nums` summalar.
- **Global UI holati** `lib/ui.ts::useUI`: `mobileNavOpen`, `antiStressOpen`.
- **Anti-stress** (`components/anti-stress.tsx`): portal orqali to'liq ekran canvas (6 ta tema: Binafsha, Okean, Shafaq, O'rmon, Atirgul, Tun; matn yozish, sozlamalar paneli), `Esc` bilan yopiladi va fullscreen'dan chiqadi. Topbar tangasi yoki profildan ochiladi.
- **Kichik a11y**: `lib/use-reduced-motion.ts::usePrefersReducedMotion` — `/api` sahifasi animatsiyalarini o'chirish uchun.

### E.9 Brauzer xotirasi kalitlari (umumiy ro'yxat)

| Kalit | Joy | Nima |
|---|---|---|
| `xt_token` | localStorage | JWT (api.ts har so'rovda o'qiydi) |
| `xt_auth` | localStorage | zustand persist: `{token, user}` |
| `xt_prefs_<userId>` | localStorage | accent + sevimlilar |
| `avatar_<userId>` | localStorage | profil rasmi (data URL) |
| `theme` | localStorage | `light`/`dark` |
| `tx-filters-v1`, `tx-filter-mode-v1`, `tx-column-filters-v1`, `tx-sources-v1`, `tx-contract-sources-v1` | localStorage | Tranzaksiyalar sahifasi filtrlari |
| `oplatykv-q-v1`, `oplatykv-dateFrom-v1`, `oplatykv-dateTo-v1`, `oplatykv-filter-mode-v1`, `oplatykv-column-filters-v1`, `oplatykv-col-type-v1`, `oplatykv-col-manba-v1`, `oplatykv-col-crmstatus-v1`, `oplatykv-col-branch-v1` | localStorage | ОплатыКв filtrlari va ustun tanlovlari |
| `crm.recentContracts` (oplatykv/crm, `LS_RECENT`) | localStorage | CRM tabidagi so'nggi 8 ta qidiruv |
| `pomodoro-*` (`style`, `stats`, `muted`, `focus-min`, `break-min`) | localStorage | profil'dagi Pomodoro taymer |
| `xt-api-snippet-lang` | localStorage | `/api` sahifasida kod namunasi tili |
| `xt_dev_api_auth` | sessionStorage | `/api` sahifasida kiritilgan API kalit/sir (tab yopilguncha) |
| `trsupport.code` | sessionStorage | TR Support tabining kirish kodi (tab yopilguncha) |
| `chek.sozlamalar.unlocked` | sessionStorage | `/chek` Sozlamalar tabi PIN bilan ochilganini eslab qoladi |
| `chek.lang` | localStorage | `/chek` sahifa tili (`uz`, `uzc`, `ru`, `en`) |
| `notifications` | localStorage | profil'dagi bildirishnoma toggle (faqat UI) |

### E.10 Kirish kodi (UI gate) haqida muhim eslatma

Bir nechta joyda sahifa ichidagi qo'shimcha amallar "kirish kodi (env)" so'rovi bilan yopilgan: `transactions/page.tsx` (Qo'shimcha amallar menyusi va Schotchik backfill gate), `components/ai-perereboska-module.tsx` (sozlama qulfi), `admin/import/page.tsx` (`IMPORT_KOD`), `setup/credentials/page.tsx` (bank parolini avtomat topish), `chek/sozlamalar-tab.tsx` (`CHEK_PASS`), `components/tr-support-tab.tsx` (kod server tomonda tekshiriladi va sessionStorage'da saqlanadi), `check/_telegram-dialog.tsx` (server tomonda tekshiriladi). Frontend'dagi ko'p joylarda kod **client-side satr solishtirish** bilan tekshiriladi va qiymat JS bundle'da ochiq turadi — bu faqat UX to'sig'i; haqiqiy himoya backend ruxsatlari va server tomonidagi kod tekshiruvi (bor joyda). Qiymatni hujjat yoki javobga yozma.

---

### `/dashboard` — Bosh sahifa

Fayl: `dashboard/page.tsx` (~2000 qator). Route `dashboard:view`. Har bo'limning o'z ruxsati bor: ruxsat bo'lmasa bo'lim yashiriladi va so'rovi umuman ketmaydi (`enabled: has(...)`). Sahifada localStorage ishlatilmaydi.

| # | Bo'lim | Ruxsat | Endpoint'lar va xulq |
|---|---|---|---|
| 1 | KPI qatori (6 `DataTile`: balans, hisoblar, banklar, kirim, chiqim, tranzaksiyalar) | `dashboard:kpi_balance`, `kpi_accounts`, `kpi_banks`, `kpi_inflow`, `kpi_outflow`, `kpi_txn` | `GET /bank-accounts` (kalit `['accounts']`), `GET /transactions/stats?from=<bugun-30>` |
| 2 | Obyektlar bo'yicha to'lovlar (ОплатыКв), default ochiq | `dashboard:objects` | `GET /oplata-kv/by-object?dateFrom&dateTo&mode&includeSchotchik&crmStatuses&propertyTypes&branches&banks`; filtr qiymatlari `GET /oplata-kv/distinct?column=<crmStatus, crmPropertyType, crmBranch, bank>`. Ustunlar obyekt / to'lov / "1 взнос" / "ежемесячный" (oxirgi ikkisi sarlavha bosilsa `•••` bilan niqoblanadi). Qator bosilsa tepaga pin (saqlanmaydi). Oraliq: bugun/7/30/ixtiyoriy. `ObjToolbarFilter` popover: "За счётчик" (`includeSchotchik=1`), "Возврат" (`mode=refund`, faqat manfiy), Bank (logolar), Тип (жил/пар), CRM status, Сотув бўлими, "Hammasini tozalash". Summa (ko'z ikonka) → `ObjectDetailDialog`: `GET /oplata-kv/by-object-detail?object=...` (`__ALL__` = hammasi), Excel `apiDownload /oplata-kv/by-object-detail/export?...` → `obyekt-<nom>.xlsx`, `truncated` ogohlantirishi |
| 3 | `ReconcileWidget` ("To'lov tahlili", `WidgetErrorBoundary` ichida), default yopiq | `dashboard:recon` | Faqat ochilganda so'raydi; umumiy oraliq bugun/7/30/hammasi. **Tahlil**: OUT/IN × kategoriya/kontragent/hisob/shartnoma, top 15 — `GET /transactions/breakdown?direction&dim&limit=15&from&to`. **Kontragent (Akt sverka, 1C uslubi)**: top 20 OUT kontragent → tanlansa `GET /transactions/sverka/counterparty?name&from&to` (boshlang'ich / kirim / chiqim / yakuniy saldo + yuruvchi qoldiqli jadval). **Shartnoma statement**: `GET /transactions/sverka/contract?contract&from&to`. "Batafsil" → `window.location` bilan `/transactions` |
| 4 | `DailySummaryWidget` ("Kunlik xulosa"), default yopiq | `dashboard:objects` | `GET /oplata-kv/daily-summary?date=`; rejim bugun/kecha/ixtiyoriy sana; 4 KPI (jami, 1 взнос, ежемесячный, soni) oldingi kunga nisbatan % Δ (oldingisi 0 bo'lsa "yangi"); oy boshidan beri vs o'tgan oyning shu davri; 14 kunlik ustunli trend; top obyektlar. **Vaqt-adolatli solishtirish**: "bugun" rejimida kecha ham hozirgi soatgacha kesiladi (backend `createdAt` bo'yicha cheklaydi), UI "kecha · shu vaqtgacha" yozuvini ko'rsatadi |
| 5 | Kunma-kun kirim/chiqim (`DualAreaChart`), default yopiq | `dashboard:daily` | `GET /transactions/daily?from&to&bankId&accountId`; bank (faollar ping nuqta bilan) va hisob (qidiruvli, 100 tagacha) tanlovi; jami kirim/chiqim/sof; dam olish kunlari belgilanadi |
| 6 | Ustunli grafik (`DailyBarChart`) | `dashboard:daily_bar` | 5-bo'lim so'rovini qayta ishlatadi |
| 7 | Klient to'lovlari (Клиент / Физ.Л / Юр.Л) | `dashboard:client` | `GET /transactions/daily?...&categoryCode=CLIENT`; subkategoriya chiplari (`subcategories`, `bySub`) |
| 8 | XonPay debitor | `dashboard:xonpay` | `GET /xonpay/stats/daily?dateFrom&dateTo`; default oraliq **kecha** (bugungi XonPay hali to'liq sync bo'lmagan); XonPay'da bor, bankka kelmagan summa, soni, % |
| 9 | Asosiy grid | `dashboard:top_accounts` (balans bo'yicha top 8), `dashboard:sync_status` (`GET /sync/logs?limit=20` har 30 s, oxirgi 10 ta bo'yicha muvaffaqiyat, `/admin/sync-logs` havolasi), `dashboard:banks_breakdown`, "Diqqat" (top 3 sync xatosi), `dashboard:net_flow` (30 kunlik sof oqim) | — |

- Har grafik kartasida PNG yuklab olish: `html-to-image` dynamic import, `.no-export` klassli elementlar chiqariladi, yopiq karta 150 ms ga ochilib suratga olinadi.
- `components/charts.tsx` — sof SVG grafiklar (`DualAreaChart`, `AreaChart`, `DonutChart`, `BarChart`, `DailyBarChart`; stroke-padding tuzatishi izohi).
- `QuickActions` (`quick-actions.tsx`: `GET /bank-accounts` + har hisob uchun `POST /sync/account/:id`) va `OnboardingCard` hech qayerda import qilinmaydi.

### `/transactions` — Tranzaksiyalar

Fayl: `app/[locale]/(panel)/transactions/page.tsx` (~8670 qator, loyihadagi eng katta fayl; birinchi qatordagi `// rebuild trigger` izohi faqat frontend redeploy'ni majburlash uchun). Route `transactions:view`. Yuqorida `TransactionsTabs` (E.7) — Vipiska/Sverka/... alohida route'lar, URL query emas.

**Sahifa tuzilishi (yuqoridan pastga):**
1. `?batchId=` bo'lsa "Import filtri" banneri ("Filtrni olib tashlash"); import sahifasidagi "ko'rish" tugmasidan keladi.
2. KPI qatori — 4 `StatCard` (Kirim, Chiqim, Sof, Soni). Dumaloq tugma `kpiMode` ni almashtiradi: `all` (oxirgi 30 kun yoki tanlangan sana oralig'i) ↔ `CLIENT` (joriy oy, `categoryCode=CLIENT`). Sparkline'lar **soxta tasodifiy ma'lumot** (izoh: backend kunlik breakdown bermaguncha placeholder).
3. KPI qatorining o'ng pastida AI (`Sparkles`) dropdown: `TodayStatsInline` (bugungi statistika, `GET /transactions/stats?from=<bugun>&to=<bugun>[&categoryCode=CLIENT]`) va kirish kodi bilan qulflangan "Qo'shimcha amallar".
4. Filtr paneli: qidiruv, Klient·XATO tugmasi, Sozlamalar dropdown, Eksport dropdown, qisqich (Paperclip) filtr dropdown, sana oralig'i, "Tozalash (N)".
5. Jadval, 6. Sahifalash (10/25/50/100, default 25; birinchi/oldingi/keyingi/oxirgi, "x–y / jami").

**Jadval ustunlari (9 ta):**
1. Bank · Hisob — bank logosi, nomi, hisob egasi va raqami; import qatorlarida `IMP` belgisi (`HB imp` = HAMKOR_IMPORT, Aloqa qatorlarida qulf ikonka). Ustun filtri 2 tabli: `bank` va `accountIds`.
2. Sana / Vaqt — `formatDate(txnDate)` + `operationTime` (yo'q bo'lsa `settlementTime`) HH:MM; tooltip'da operatsiya/settlement/kiritish vaqtlari.
3. Hisob nomi — IN uchun fromName/fromInn, OUT uchun toName/toAccount (filtr `hisobNomi`).
4. Yo'nalish — Kirim/Chiqim (filtr `directions`).
5. Kontragent — ustuvorlik: `erpSupplier` > `counterpartyDisplay` > import kontragent matni > `category.name` (filtr `categoryIds`).
6. Kategoriya — `erpArticle` (teal, Ta'minot) > subkategoriya/kategoriya chipi > `importCategoryText` (filtr `subcategoryIds`).
7. Shartnoma — `contractNumber` yo'q bo'lsa `erpContract` (teal); `manual` sariq yoki ilova bo'lsa binafsha "ARIZA"; `unverified` → "XATO" belgisi + AI qidiruv tayoqchasi (`ContractLookupDialog`), raqamning o'zi yashiriladi; tasdiqlangan → indigo, CRM statusi bekor bo'lsa "BEKOR" (filtr `contractStatuses`).
8. Summa — ± va rang; `AmountFilterTh` (aniq → `amountMin=amountMax`, yoki oraliq).
9. Amallar (hover'da): `PurposeInfoButton` (PurposeModal) va `CopyIdButton` (`externalId || id`).
- Qatorni bosish → `TransactionDetailDialog`. Saralash va qator tanlash (bulk) yo'q.

**Filtrlar:**
- Qidiruv `q` 350 ms debounce, sahifa 1 ga (izoh: backend 12 ustun bo'yicha ILIKE + count qiladi — qimmat).
- Sana — `DateRangeCalendar` (presetlar, kalendar, qo'lda). `onChange` har bosishda ishlaydi (birinchi sana tanlanishi bilan so'rov ketadi), "Apply" faqat yopadi; `max` berilmagan — kelajak sanani tanlash mumkin.
- Paperclip: "Shartnoma manbasi" (`manual`, `ariza` → `contractSources`) va "Manba" (`SYNC`, `IMPORT`, `ALOQA_BANK`, `HAMKOR_IMPORT` → `sources`).
- Ustun filtr rejimi (Google Sheets uslubi, Sozlamalar'da yoqiladi): sarlavhada filtr ikonka → `ColumnFilterPopover` (portal) → `GET /transactions/distinct?column&search&<faol filtrlar>` (300 ms; 30 s kesh). Moslash uchun normallash O→0, I→1, S→5, B→8. Maxsus qiymatlar: `__EMPTY__` = "Bo'sh (to'ldirilmagan)", `erp:` prefiksi "ta'minot" belgisi, "(xato)" qo'shimchasi XATO belgisi. Faqat tashqi mousedown yopadi (scroll emas).
- Xarita: `bank→bankIds`, `accountIds→accountIds`, `kontragent→categoryIds`, `kategoriya→subcategoryIds`, `direction→directions`, `contractStatus→contractStatuses`, `hisobNomi→hisobNomi`.
- "Tozalash" hamma narsani (q ham) tozalaydi, `batchFilter` dan tashqari. `direction`, `bankId`, `matchStatus` uchun alohida UI yo'q (faqat localStorage'dan tiklanadi); `FilterChip` ishlatilmaydi.
- URL parametrlari: `?searchId=` (detail dialogni `GET /transactions/:id` bilan avtomatik ochadi va parametrni o'chiradi; Billing'dan keladi), `?q=` (qidiruvga qo'yadi va o'chiradi; Chek order "Tranzaksiyada ko'rish" dan), `?batchId=` (import partiyasi filtri, tozalanguncha URL'da qoladi).

**Eksport** (`transactions:export`): Excel (hammasi) `apiDownload GET /transactions/export?...` → `tranzaksiyalar-YYYY-MM-DD.xlsx` (toast id `tx-export`); CSV (faqat joriy sahifa, klientda, UTF-8 BOM, formula-injection himoyasi: `= + - @` bilan boshlangan katakka `'` qo'shiladi); Chop etish/PDF `window.print()`. `exportJson()` ulanmagan.

**Ruxsatlar:** `canManageCategories` = `categories:manage`; `canManualEdit` = `transactions:manual_edit`; `canManualContract` = `transactions:manual_contract`; `canApplication` = `transactions:application`; `canAutoCategorize` = `transactions:auto_categorize`; `canExport` = `transactions:export`; `payments:manage` aniqlangan, lekin ishlatilmaydi.
- Detail dialog harakat paneli `categories:manage` **va** kamida bitta granular ruxsatni talab qiladi — faqat granular ruxsati bor foydalanuvchi panelni ko'rmaydi.
- "Qo'shimcha amallar" menyusidagi hamma band ("Eski tarixni yuklash" dan tashqari) `categories:manage` talab qiladi; backfill faqat kirish kodi bilan.

**Qo'shimcha amallar (kirish kodi (env) bilan ochiladi; dropdown yopilsa qayta qulflanadi; qiymat klient kodida hardcode):**
- **Kategoriya agenti ("5 bosqich")** → `components/kategoriya-agent-dialog.tsx`: dateFrom (default qat'iy 2026-05-01), dateTo, "Sinov (yozmaydi)" (dryRun, default yoqiq), "Bog'langanlarni qayta ko'rish" (rematch), "Agentsiz" (aiYoq). Bosqichlar: Qoidalar → Schotchik → Молия Вазирлиги → Ta'minot → Agent (AI). KPI, bosqich natijalari, AI qaror kartalari (ishonch %, sabab), oxirgi 10 ishga tushirish; "Davom ettirish" xato bilan tugaganini to'xtagan joyidan davom ettiradi. Ogohlantirishlar: `agents/knowledge/kategoriya.md` yo'q, AI setup token yo'q (5-bosqich ishlamaydi), claude CLI yo'q; kunlik AI kvota (`aiKunlik.ishlatilgan/chegara`, Telegram agentlari bilan umumiy obuna). Endpoint'lar: `GET /kategoriya-agent/holat` (ishlayotganda 3 s, aks holda 20 s), `GET /kategoriya-agent/runs?limit=10` (5 s), `GET /kategoriya-agent/runs/:id?limit=300` (4 s), `POST /kategoriya-agent/run {dateFrom,dateTo,dryRun,rematch,aiYoq}`, `POST /kategoriya-agent/stop`.
- **Eski tarixni yuklash** (`BackfillDialog`): scope `all`/`bank`/`account`, bank (faqat faol), hisob (qidiruvli, birinchi 100), dateFrom/dateTo (default bugun, max bugun) → `POST /sync/backfill {scope, bankId?, accountId?, dateFrom, dateTo}`. Javobda ogohlantirish, clamp (`syncMinDate`, `clampedDays`: so'ralgan va haqiqiy oraliq) yoki `clampedAll` (xato). Progress: `GET /sync/backfill/status?since=startedAt` har 2 s (hamma hisob tugasa to'xtaydi), hisob bo'yicha log (fetched/saved/errors, RUNNING/FAILED). **Stall detection**: alohida 4 s interval; `doneCount` 30 s o'zgarmasa va `doneCount > 0` bo'lsa "to'xtab qoldi" (izoh: deploy yoki crash server jarayonini o'ldiradi) → "Qaytadan boshlash" (yuklangan hisoblar takrorlanmaydi). Gotcha: 0 da qotib qolgan ish hech qachon "stalled" bo'lmaydi. Tugmalar: "Fonda davom ettirish", "Qaytadan boshlash", "Yopish".
- **Kategoriyalash** → `POST /categorization/run-all`, `RecategorizeProgressDialog`: `GET /categorization/run-all/status` har 2 s (done/total, matched, errors, so'nggi xatolar); ishlayotganda `onOpenChange` bilan yopilmaydi, lekin "fonda davom ettirish" yopadi. Qat'iy 30 s `setTimeout` ham `transactions` ni yangilaydi.
- **Schotchik backfill** (`SchotchikBackfillDialog`, o'z `SchotchikPasswordGate` i — xato kodda "shake", yopilgandan 300 ms keyin qayta qulf), 2 ichki tab:
  - "Qayta tasniflash": avtomatik dry-run `POST /categorization/backfill-schotchik {dryRun:true}` (useQuery sifatida), statistika, joriy kategoriya bo'yicha guruhlar, namunalar; "Tasdiqlayman, yangila (N ta)" → `{dryRun:false}`. Maqsad: "Взносы за квартиры" ga noto'g'ri tushgan счётчик to'lovlarini "За счетчик" ga o'tkazish. Keyin "orqa sanaga sync" yoki splitInstallments cron'ini kutish maslahati.
  - "Счётчик → Ежемесячный" (`SchotchikMonthlyPanel`): `GET`/`POST /oplata-kv/schotchik-config` (enabled, dateFrom, dayStart, dayEnd, intervalMin — avto rejim), `POST /oplata-kv/schotchik-to-monthly {dateFrom, dryRun}`. Faqat ОплатыКв o'zgaradi, tranzaksiyalar emas.
- **ОплатыКв'ga qo'shish** (`AddFromTxDialog`): to'lov/tranzaksiya ID → `POST /oplata-kv/add-from-tx {txRef}` → `added`/`exists`/xato; idempotent, sana chegarasini hisobga olmaydi. Gotcha: `['oplatakv']` ni invalidate qiladi (to'g'risi `['oplata-kv']`) — ta'sirsiz.
- **Diagnostik kategoriyalash** (`CategorizeDiagnoseDialog`): hisob raqamlari (`GET /bank-accounts`), sana → `POST /categorization/diagnose {accountNos?, dateFrom?, dateTo?, limit:2000}`; har qator uchun sabab, "Faqat kategoriyasizlar" filtri.
- **Молия Вазирлиги tozalash** (`FixMinfinDialog`): dateFrom (default 2026-05-01), "Qoidasizlarni bo'shatish" → `POST /categorization/fix-minfin {dateFrom, dryRun, clearUnmatched}` (900 s); avval dry-run, keyin "Tasdiqlab yozish". Maqsad: izohdagi "НДС" sabab soliqqa noto'g'ri tushganlar; qo'lda tahrirlangan va mijoz (Клиент/Физ.Л/Юр.Л) to'lovlari o'tkazib yuboriladi.
- **Soxta shartnoma raqamlari** (`components/reparse-contracts-dialog.tsx`): `POST /categorization/reparse-junk-contracts {dryRun, limit:500}` (900 s); eski → yangi raqam, nomzodlar, ta'sirlangan ОплатыКв qatorlari soni. Izoh: parser avval "сонли" so'zini shartnoma raqamiga yopishtirardi; tuzatilgan, bu dialog eski qatorlarni tozalaydi, hal bo'lmaganlari XATO bo'ladi (jim noto'g'ri raqam o'rniga odam ko'rib chiqadi).
- **Ta'minotdan to'ldirish** (`TaminotMatchDialog`): `GET /taminot/ping` (ulanish, retry yo'q) → `POST /taminot/match {dateFrom, dryRun, rematch}` (900 s). Natijalar: matched, ambiguous, notFound, cleared, `shiftRad` (summa shartnomadan oshgan), `byArticle`, `reasons`, `nearMiss`, `nomFarqi`, namunalar. Ping muvaffaqiyatsiz bo'lsa "Tahlil" o'chiq. ERP'ga faqat o'qish; kalit: aniq summa + sana ±2 kun + (shartnoma raqami yoki ta'minotchi nomi); mijoz to'lovlariga tegilmaydi.

**Sozlamalar dropdown** (ruxsat tekshiruvisiz):
- ID orqali qidirish → `GET /transactions/:id` → detail dialog.
- **Bank ID inspektori** (`components/id-inspector-dialog.tsx`, `idInspectorTrigger` timestamp bilan ochiladi; `/statement` da ham bor): yakka rejim `POST /transactions/inspect-id {id}` (30 s) — verdikt found/shifted/cancelled/no_data/partial, ajratilgan maydonlar, bankdagi maqsad/jo'natuvchi/qabul qiluvchi. Ommaviy rejim: Excel (A ustunida ID) → `POST(form) /transactions/parse-ids-excel`, keyin har ID **ketma-ket** tekshiriladi (60 s, oralarida 250 ms — "bankni urmaslik uchun"), status chiplari, 15 tadan sahifa, natija `apiDownloadPost /transactions/export-inspect-results` → `id_tekshiruv.xlsx`.
- **Vipiska tekshiruvi** (`components/vipiska-debug-dialog.tsx`): hisob (`GET /bank-accounts`), sana, ixtiyoriy hujjat raqamlari → `POST /sync/debug-fetch-raw {accountId, dates:[date], searchNums?}` (60 s) — bankdan xom olingan qatorlar, kompozit ID nusxalash bilan.
- **Split kerak shartnomalar** (`XatoContractsModal`): `GET /oplata-kv/unsplit-contracts` (klient qidiruv, 60 tadan sahifa — UI qotmasligi uchun); qator ochilsa `GET /oplata-kv/by-contract?contractNo=`; "Split" yoki "Split all" → `POST /oplata-kv/split-installments {contractNo?}` (timeout 30 daqiqa), ishlayotganda yopilmaydi.
- **Vaqt diagnostikasi** (`components/time-diagnostics-dialog.tsx`, portal z-120): sana default — Toshkent bugungi kuni (UTC+5) → `GET /transactions/time-diagnostics?date=` (60 s, retry yo'q, faqat qo'lda yangilash) — verdikt, operatsiya/settlement vaqt taqsimoti, 8 ta xom namuna, o'sha kunning sync loglari ("nega hamma qatorda bir xil vaqt?" savoliga javob).
- Ustun filtr rejimi almashtirgichi.

**Tranzaksiya detail va tahrir dialoglari:**
- `TransactionDetailDialog`: jonli `GET /transactions/:id` (`initialData` = qator, 30 s); sarlavha (yo'nalish, sana/vaqt, ANOR 24/7, IMPORT belgisi, summa, kontragent); Kontragent/Kategoriya/Shartnoma qatorlari `canManage` bo'lsa X (tozalash) tugmasi bilan; Aloqa Bank qatorida faqat-o'qish banneri va harakat paneli yashirin (lekin X tugmalar `isAloqaBank` ni tekshirmaydi). Harakat paneli: Avto-kategoriyalash (faqat kategoriyasizda), Qo'lda tahrirlash, Qo'lda shartnoma, Ariza (ilovalar soni bilan). Yig'iladigan bo'limlar: Jo'natuvchi, Qabul qiluvchi, Maqsad, Vaqt, Tizim, Tarix (`GET /categorization/transactions/:id/history`, lazy), Kompozit ID, xom JSON. Avto-kategoriyalash qoida topmasa Maqsad bo'limi ochilib 2.5 s sariq yoritiladi. Endpoint'lar: `POST /categorization/transactions/:id/set {categoryId, subcategoryId}`, `/set-contract {contractNumber}` (CRM tekshiruvli), `/set-contract-manual {contractNumber}`, `/set-counterparty {counterpartyId}`, `/categorize[?force=true]` (UI faqat `force=false` yuboradi). Shartnoma saqlangach `POST /oplata-kv/:id/split` (fire-and-forget) va `showOplataKvSyncToast` (updated / multiple-matches / error; `not-client`, `no-row` jim).
- **`CombinedEditDialog`** ("Qo'lda tahrirlash", `transactions:manual_edit`) — 3 qadam: (1) yuqori kategoriya to'ri (`COUNTERPARTY_RETURN`, `COUNTERPARTY` yashirin) + maxsus kontragent qidiruvi `GET /counterparties?q=&perPage=15` (kamida 2 belgi, 300 ms) — bosilganda **darhol saqlanadi**, joriy qo'lda kontragentni olib tashlash; (2) subkategoriya chiplari → "Kategoriyani saqlash" (o'zgarish bo'lsa); (3) shartnoma — faqat yuqori kategoriya `CLIENT` yoki `TRANSFER` va qo'lda kontragent yo'q bo'lsa: `GET /crm/search?contract=&perPage=15` (kamida 3 belgi) → `set-contract`; "Shartnomani tozalash". Kategoriyalar daraxti `GET /categorization/categories` (5 daq kesh).
- `ManualContractDialog` (`transactions:manual_contract`): kategoriya → subkategoriya → shartnoma raqami **CRM tekshiruvisiz** → `set` va/yoki `set-contract-manual`; "Shartnomani o'chirish".
- `AttachmentsDialog` ("Ariza", `transactions:application`): `GET /transactions/:id/attachments` (bitta ilova, `items[0]`); bor bo'lsa yuklab olish (`.../attachments/:attId/download`) yoki o'chirish (`window.confirm` → `DELETE /transactions/:id/attachments/:attId`); yo'q bo'lsa wizard: kategoriya → subkategoriya → shartnoma (katta harf, CRM'siz) → fayl (majburiy, ≤25 MB, pdf/doc/docx/jpg/jpeg/png/webp). Tartib: `set` → `set-contract-manual` → `POST(form) /transactions/:id/attachments` (file, contractNumber, `type=ariza`, 120 s). Toast Telegram bildirishnoma natijasini (haqiqiy natija) aytadi.
- `ContractLookupDialog` (XATO'dagi AI tayoqcha, faqat ma'lumot): maqsad matnidan RU/UZ regex bilan F.I.Sh. ajratadi; shartnoma raqamining prefikslari bilan (to'liq → 8 → 6 → 5 → 4 belgi) `GET /crm/search?contract=&perPage=20`; CRM "contains" qidiradi, shuning uchun klient "startsWith" filtrlaydi; aniq/ism/shartnoma mosliklari yoritiladi.
- `PurposeModal` (`components/purpose-modal.tsx`, framer-motion, z-300; ОплатыКв'da ham): faqat ESC yoki X bilan yopiladi; meta chiplar, nusxalanadigan maqsad matni, external ID. Izoh: boshqa dialog ichida Radix body'ga `pointer-events:none` qo'ygani uchun overlay'ga `pointer-events-auto` qaytariladi.
- O'lik kod: `CategoryEditDialog` (ochuvchisi faqat `null` qo'yadi), `ContractEditDialog` ("ESKI"), `autoMatchMut`/`unlinkMut`/`ignoreMut` (`/payments/auto-match/:id`, `DELETE /payments/link/:id`, `/payments/ignore/:id`), `exportJson`, `FilterChip`.

**Klient · XATO drawer** (`ClientXatoDialog`, filtr panelidagi qizil `FileWarning` tugma; belgi = `GET /correction/stats` dagi `pending`, har 30 s). O'ngdan chiqadi (z-210); 5 ichki tab (lokal state, har ochilishda `pending` ga qaytadi). Drawer va approve/reject/direct-fix uchun **frontend ruxsat tekshiruvi yo'q** — `/transactions` ni ko'radigan har kim ochadi (backend `correction` ruxsatlari himoya qiladi).
1. **Kutilmoqda** (`GET /correction/pending`): qidiruv (debounce'siz), agent holati filtri (Hammasi/Ishlanmoqda/Ko'rib chiqish); ustunlar Sana, Klient, Obyekt, Shartnoma, Summa, Kim yubordi (telegram/app/bank ikonka), Izoh, Agent. "Rad etish" → `window.prompt` sabab → `POST /correction/:id/reject {reason}`; "To'g'rilash" → `ApprovalModal` (`approve`); qator → "Ariza tafsiloti".
2. **Tasdiqlangan** (`GET /correction/approved`): qidiruv, oqim (in/out), aktor turi (agent/user), sana, aktor nomi; ilovani ko'rish (`apiObjectUrl`, yangi tabda, 60 s dan keyin revoke) yoki yuklab olish.
3. **Rad etilgan** (`GET /correction/rejected`): qidiruv, aktor turi, sabab.
4. **Barcha XATO** (raw): `GET /transactions/client-xato?page&perPage=50&q&hidden=active|hidden|all` (300 ms), Excel `/transactions/client-xato/export`, yashirish/ko'rsatish `POST /correction/hide {txId, hidden}`, "To'g'rilash" → `ApprovalModal` (`direct`).
5. **TR Support** → `components/tr-support-tab.tsx` (pastda).
- `ApprovalModal` (z-300/310): ixtiyoriy kategoriya/subkategoriya, majburiy shartnoma raqami, fayl (mavjud bo'lmasa majburiy, ≤25 MB, pdf/doc/docx/jpg/jpeg/png — `.webp` bu yerda yo'q). Approve `POST(form) /correction/:id/approve`, direct `POST(form) /correction/direct` (`txId` bilan), 60 s; approve rejimida rad etish textarea'si ham bor.
- "Tozalash": parol popover → `POST /correction/clear {status, password}` (status joriy tabga qarab pending/approved/rejected/all); parol serverda tekshiriladi, 403 → "Parol noto'g'ri".
- XATO oqimining umumiy mantiqi (ariza → pending → approve) `xato-list` va Telegram bot bilan bir xil `correction` moduliga tayanadi.

**TR Support tab — `components/tr-support-tab.tsx`**: Telegram "TR Support" bot agenti orqali (egasi tasdig'i bilan) qilingan to'lov tahrirlari jurnali.
- Gate: kirish kodi (env) → `POST /tr-support/unlock {code}` (**server tekshiradi**); muvaffaqiyatda kod `sessionStorage['trsupport.code']` ga (ochiq matn). Ro'yxat so'rovi `x-tr-support-code` header bilan; 403 → avtomatik qayta qulf; "Qulflash" tugmasi.
- Ro'yxat: `GET /tr-support/edits?page&perPage=30&q` (300 ms, `retry:false`), "Agent tahrirlari: N". Ustunlar: Qachon, To'lov sanasi, Summa, Shartnoma (oldin → keyin; XATO qizil), O'zgarish (Kontragent=`categoryName`, Kategoriya=`subcategoryName`, Shartnoma=`contractNumber` chiplari, tooltip oldin → keyin), Tasdiqladi, Holat (`applied`="Bajarildi", `failed`="Qisman", `rolled_back`="Qaytarilgan").
- Detail modal (z-320): 3 maydon uchun oldin/keyin jadvali, to'lov ID (nusxa), Tasdiqladi, Izoh, Manba (`requestedBy`, default "Telegram (TR Support bot)"), ОплатыКв sync natijasi, xato matni, qaytarish ma'lumoti, "Tasdiq guruhi" (`batchId`).
- **Ortga qaytarish**: `categories:manage` va holat `rolled_back` emas → tasdiq oynasi (z-330: har maydon keyin (chizilgan) → oldin, ixtiyoriy izoh) → `POST /tr-support/edits/:id/rollback {code, note?}` (180 s; to'lovning oldingi holatini tiklaydi va ОплатыКв sync'ni bir marta ishga tushiradi) → toast ("Ortga qaytarildi va OplatyKv sync bajarildi" yoki "…lekin sync xato") → `['tr-support-edits']`, `['transactions']`, `['oplata-kv']` yangilanadi.

**UX va texnik tafsilotlar:**
- localStorage: `tx-filters-v1` (q, direction, matchStatus, bankId, dateFrom, dateTo), `tx-column-filters-v1`, `tx-filter-mode-v1`, `tx-contract-sources-v1`, `tx-sources-v1`; tiklangan ustun filtri bo'lsa filtr rejimi avtomatik yoqiladi.
- Asosiy react-query kaliti: `['transactions', page, perPage, qDebounced, direction, dateFrom, dateTo, bankId, columnFiltersKey, contractSourcesKey, batchFilter, sourcesKey, amountKey]`; boshqalar `['tx-stats', …]`, `['tx-detail', id]`, `['tx-distinct', …]`, `['categories-tree']`, `['correction-*']`, `['client-xato', …]`, `['backfill-status', startedAt]`, `['categorize-status']`, `['tr-support-edits', page, q]`, `['time-diagnostics', date]`.
- Optimistik yangilanish yo'q: har mutatsiyadan keyin invalidate/refetch (detail dialog `refetchQueries(['transactions'], active)` + jonli so'rov).
- Z-index qatlami: ustun popover 100, TimeDiag 120, XATO drawer 200/210, tozalash popover 214/215, Approval drawer va PurposeModal 300/310, Ariza va TR Support detail 320/330.
- Gotcha'lar:
  - `tx-stats` kaliti debounce qilinmagan `q` ni oladi — har harfda statistika qayta so'raladi.
  - Excel eksport `matchStatus` ni yuboradi (UI'da yo'q, faqat eski localStorage'dan), lekin `contractSources`, `sources`, `batchId` ni yubormaydi — eksport jadvaldan farq qilishi mumkin.
  - KPI CLIENT rejimi va 30 kunlik oyna sanani `toISOString()` (UTC) bilan hisoblaydi, `TodayStatsInline` va TimeDiag esa +5 soat (Toshkent) siljitadi — yarim tun atrofida farq qilishi mumkin (qarang: Toshkent kun gotcha).
  - Kategoriya agenti, FixMinfin, Taminot dialoglarida default `dateFrom` qat'iy `2026-05-01`.
  - XATO drawer'dagi pending/approved/rejected qidiruvlari debounce'siz (har harfga so'rov).
  - Ilova yuklash toast'i backend qaytargan Telegram manzil identifikatorini ko'rsatadi.

### `/statement` — Vipiska

Route `transactions:vipiska_view`; sahifa ichida qo'shimcha ruxsat yo'q. 3 qadam: (1) bank (faqat faol, nofaollar o'chiq), (2) hisob (raqam/egasi/filial bo'yicha qidiruv), (3) sana presetlari (bugun / shu hafta / shu oy / o'tgan oy) yoki ixtiyoriy. `GET /banks`, `GET /bank-accounts`; yuklab olish `apiDownload /transactions/statement?accountId&dateFrom&dateTo` → `vipiska.xlsx`. `IdInspectorDialog` ikonka (`POST /transactions/inspect-id`, `POST(form) /transactions/parse-ids-excel`).

### `/check` — Bank sverka

Fayllar: `check/page.tsx`, `_drilldown.tsx`, `_sverka-agent.tsx`, `_agent-batch.tsx`, `_telegram-dialog.tsx`. Route `transactions:sverka_view`. Har bank hisobining kunlik aylanmasi va boshlang'ich/yakuniy qoldig'ini baza bilan jonli solishtirish. Sahifa ichida ruxsat tekshiruvi yo'q; `transactions:sverka_fix` frontend'da hech qayerda ishlatilmaydi (tuzatishlarni faqat backend tekshiradi).
- Ma'lumot: `GET /transactions/reconcile/today` — `refetchInterval` **20 daqiqa** (`AUTO_REFETCH_MS`), oyna fokusi va qayta ulanishda ham, `staleTime 60 s`, `retry: false`.
- "Hammasini yangilash" → `GET /transactions/reconcile/today?syncMismatched=true` (120 s; ikki o'tish, faqat mos kelmaganlar sync qilinadi, natija keshga to'g'ridan-to'g'ri yoziladi). Qator yangilash → `POST /transactions/reconcile {accountId, dateFrom, dateTo: bugun (UTC+5), withSync:true}` (60 s).
- KPI: jami / ok (%) / farq / xato; qidiruv; xato qatorlar alohida yig'iladigan bo'limda; qatorda bank logosi, hisob, egasi, kirim/chiqim farq chiplari, "qisman (failedDays)" ogohlantirishi. Sarlavhada Telegram (`SverkaTelegramDialog`) va farq bo'lsa "AI batch · N" (`SverkaAgentBatch`).
- **Drilldown** (`_drilldown.tsx`, o'ng panel, Esc): davr tanlash → `POST /transactions/reconcile` (withSync); kirim/chiqim/boshlang'ich/yakuniy (formula) jadvali; ko'p kunlik oraliqda `DailyBreakdown`; bir kunlik farqda `SverkaAgentPanel` va qo'lda Diagnose `POST /transactions/reconcile/diagnose {accountId, date}` (bankOnly / dbOnly / amountMismatch, GetDocuments fallback belgisi). Tuzatishlar: "Hammasini qo'shish" va yakka qo'shish `POST /transactions/reconcile/fix-all-missing {accountId, date, items[b2Id/generalId]}`; sanani ommaviy tuzatish `POST /transactions/reconcile/fix-all-tx-date {items[{txId,newDate}]}` (tasdiq modali); yakka `POST /transactions/reconcile/fix-tx-date` (`confirm`). Izohlar: refetch natija modali yopilgandan keyingina (aks holda panel unmount bo'lib modal yo'qoladi); boshqa sanada allaqachon bor elementda "Qo'shish" yashiriladi (dublikat bo'lmasin); `foundOnBankDate` ±1 kun siljishni bildiradi.
- **AI sverka agenti** (`_sverka-agent.tsx`): `POST /transactions/reconcile/agent/analyze {accountId, date, locale}` (120 s; reconcile + diagnose + Claude) → aybdor belgisi (bank / biz / aralash / yo'q / noma'lum), xulosa, topilmalar, tavsiya, ehtiyot eslatmasi; taklif guruhlari addMissing / fixDates / fixAmounts (summa tuzatishlari faqat agent "recommend" desa oldindan belgilanadi) + hal bo'lmaganlar soni. Qo'llash `POST /transactions/reconcile/agent/apply {accountId, date, which}` — server yangi diagnose'dan maqsadlarni qayta quradi (poyga xavfsiz), keyin qayta tahlil va `reconcile-today` invalidate.
- **Agent batch** (`_agent-batch.tsx`, drawer): hamma farqli hisoblarni 4 ta parallel pool bilan tahlil qiladi; progress (tahlil qilingan / tuzatsa bo'ladigan / jami farq); kartadagi "Qo'llash" yoki "Hammasini tuzatish" (ketma-ket; ishlayotganda Esc bloklanadi).
- **Sverka Telegram** (`_telegram-dialog.tsx`): kirish paroli **backend tekshiradi** (`POST /sverka-telegram/verify-password`), yopilgandan 300 ms keyin holat tiklanadi. Tablar: Chatlar (`GET /sverka-telegram/chats`, qo'shish `POST /sverka-telegram/chats {chatId, role: approver|watcher, name}`, `DELETE /sverka-telegram/chats/:chatId`, "Test yuborish" `POST /sverka-telegram/test` diagnostika bilan, "Notif. reset" `POST /sverka-telegram/reset-notified` + `GET /transactions/reconcile/today` — bildirishnomalarni qayta yoqish); Tarix (`GET /sverka-telegram/history?page&perPage=15&q&actorName`, `ACTION_META`); Bot sozlamalari (`GET`/`POST /sverka-telegram/bot-token`). Gotcha: GET javobida niqoblangan va **to'liq** token keladi, ko'z tugmasi to'liq tokenni brauzerda ochadi.

### `/check-crm` — Sverka CRM

Fayllar: `check-crm/page.tsx`, `_crm-drilldown.tsx`. Route `transactions:sverka_crm_view`. CRM to'lov tarixi ↔ ОплатыКв shartnoma kesimida (persist snapshot).
- `GET /crm-sverka/status` (`running` paytida har 2 s); `GET /crm-sverka/result?<filtrlar>` (120 s; snapshot bor bo'lsagina; `running` paytida har 3 s — natijalar oqim bilan keladi; kalitda `snapshot.builtAt`).
- "Ishga tushirish" `POST /crm-sverka/run` — `transactions:sverka_crm_run` (bo'lmasa tugma o'chiq + "noRunPerm" toast). **Bir martalik avto-start**: snapshot yo'q, ishlamayapti, oxirgi faza xato emas (izoh: cheksiz qayta urinish xatoni yashirmasin) va `canRun`. `running` false bo'lganda natija invalidate va toast.
- Xato kartasi: lastError, vaqt, sahifa limiti, Retry + Diagnose (`GET /crm-sverka/ping?limit=1`, 60 s: HTTP status/ms/soni/namuna). Jonli progress: faza crm / db / compute, sahifalar, CRM'dan olingan, bizdagi qatorlar, oxirgi sahifa ms. `meta.stale` (snapshot > 6 soat) → "Ma'lumot eskirgan" banneri; `partialError` ogohlantirishi. Excel `apiDownload /crm-sverka/export?<filtrlar>`.
- UI: 6 KPI (shartnomalar / mos / farqli / faqat CRM / faqat bizda / split farqi; bosilsa bitta status filtri); summa kartalari (CRM, biz, **sof farq = biz − CRM**, "joyida emas" absolyut summa — netDiff ≠ diffSum); boshlang'ich vs oylik kartalari; `CategoryTabs` ichki tablar Hammasi / Mos / Farqli / Faqat CRM / Faqat bizda (`rowStatuses`); qidiruv 350 ms; filtr paneli (sana, minDiff, saralash diff/crm/our/contract/diffInitial/diffMonthly, facet chiplari methods/ourMethods/crmTypes/crmStatuses/objects); 50 qatordan sahifa.
- Belgilar: **Возврат / qaytarim** — `crmReversed` bo'lsa to'q sariq "↩ Qaytarilgan" va `crmReversalSum` (CRM'da manfiy yozuvlar: shartnoma bekor yoki qayta rasmiylashtirilgan). Bekor (trashed) shartnoma uchun frontend'da alohida belgi topilmadi (backend ularni ham olishi aytiladi) — aniq emas.
- Drilldown (portal, Esc, body scroll qulfi): `GET /crm-sverka/contract?contractNo=...&<ro'yxat filtrlari, sahifa/sort/q siz>` (60 s; jami ro'yxat bilan mos bo'lishi uchun filtrlar saqlanadi). Bo'limlar: QAYTARIM, Faqat CRM'da, Faqat bizda, Summa farqi, Sana siljigan, Mos (yig'ilgan).

### `/changes` — O'zgargan to'lovlar

Route `changed_txn:view`. Qayta sync paytida aniqlangan DELETED / EDITED / **MOVED** bank tranzaksiyalari jurnali.
- `GET /transactions/changes/list?dateFrom&dateTo&accountId&changeType&q&page&perPage` (deleted/edited/moved jamilari bilan), hisoblar `GET /bank-accounts`. KPI: jami, o'chirilgan, tahrirlangan, ko'chirilgan, sahifadagi summa. Filtrlar: qidiruv, hisob, tur, sana; 25/50/100/200. Jadval: tur belgisi (MOVED — `ArrowRightLeft`), aniqlangan vaqt, tranzaksiya sanasi, bank/hisob snapshot'i, kompozit ID, shartnoma, summa, o'zgargan maydonlar (4 + N), `detectedBy` (`manual:` yoritiladi); `note` da `[TIKLANDI` bo'lsa "TIKLANGAN" belgisi. Detail: maydon oldin → keyin yoki o'chirilganda JSON snapshot.
- `changed_txn:check`: "Qo'lda tekshirish" (`GET /sync/settings` — syncMinDate'dan oldin bloklanadi; default oxirgi 10 kun) → `POST /transactions/changes/check {accountId?, dateFrom, dateTo}` (600 s; checked/deleted/edited/moved/skippedAccounts). "Tiklash" (`RecoverDialog`, noto'g'ri o'chirilganlar): avval `POST /transactions/changes/recover {dryRun:true, limit:150}` (scanned / stillInBank / notInBank / unverified), keyin `{dryRun:false}` tx + ОплатыКв'ni tiklaydi.
- `changed_txn:restore`: "Amal" ustuni, DELETED va tiklanmagan qatorda "Qaytarish" → `POST /transactions/changes/restore-one {logId, force}` (300 s): tx snapshot'dan, ОплатыКв tarixdan (yoki CLIENT + shartnoma bo'lsa qayta yaratadi). Bankda ±3 kun ichida topilmasa yoki bank API ishlamasa `needsConfirm` → "Baribir tiklash" (izoh: "fantom pul" xavfi, keyingi sync yana o'chirishi mumkin). Dialog qator bo'yicha key'langan (oldingi `force` holati o'tmasin). Invalidate: transactions-changes, transactions, oplata-kv.

### `/vznos` — "Взнос от имени клиента"

Route qoidasi yo'q (faqat `TransactionsTabs` dagi `vznos:view` tab va API ruxsati). Kompaniyaning o'z shartnomalari reestri (o'zi to'laydigan, tushum emas).
- `GET /vznos/stats?project=` (soni / qiymat / to'langan / qoldiq / %), `GET /vznos/objects` (loyiha dropdown), `GET /vznos?q&project&status(all|active|cancelled)&page` (20 tadan; CRM, virtualStatus, "Bekor → maqsad" belgilari).
- `vznos:manage` (bekor qilinmagan qatorlarda): qo'shish/tahrir formasi — "CRM" tugmasi `GET /vznos/crm-lookup?contractNo=` maydonlarni to'ldiradi, topilmasa sariq **qo'lda rejim**; `POST /vznos` / `PATCH /vznos/:id` (yaratishda mos to'lovlar avtomatik bog'lanadi, `recategorized` soni toast'da); bekor qilish/o'tkazish `POST /vznos/:id/cancel {transferToContractNo, reason}` (to'langan to'lovlarni ro'yxatdagi boshqa shartnomaga o'tkazadi); `DELETE /vznos/:id` (`confirm`).

### `/chek-order` — Chek order

Fayl: `chek-order/page.tsx` + `components/chek-payment.tsx`, `chek-tickets.tsx`, `chek-assistant.tsx` (`chek-check.tsx` — Telegram Mini App uchun nusxa). Route qoidasi yo'q, menyu `chekorder:view`. Memorial order/chekni tranzaksiyada tekshirish (order № = `Transaction.docNumber`).
- Ruxsatlar: `chekorder:manage` (Tekshirish tabining kiritish va natijalari, "Yangi tekshiruv", tarixni o'chirish, CRM `ContractInfoPanel`; **manage bo'lmasa Tekshirish tabi bo'sh**), `chekorder:view` (To'lov tekshirish), `chekorder:history` (Tarix), `chekorder:tickets` (Murojaatlar va badge), `chekorder:assistant` (suzuvchi yordamchi), `chekorder:telegram` (admin/roles'da Mini App sozlamasi).
- **Tekshirish**: 3 kiritish usuli — rasm/PDF (≤25 MB, drag&drop, skan animatsiyasi, lightbox) `POST(form) /chek-order/analyze` (120 s); qo'lda order raqamlari `POST /chek-order/manual {orderNos}`; shartnoma bo'yicha `GET /chek-order/crm-suggest?q=` (300 ms, ≥2 belgi, katta harf) → `GET /chek-order/contract-payments?contract=` (to'lov tanlansa sintetik "found" natija). `ResultCard`: found / mismatch / not_found va oddiy tildagi xulosa, ajratilgan maydonlar vs shartlar (order / hisob / summa / shartnoma / sana), mos tx bloki — "Tranzaksiya" modali (`GET /transactions/:id`, faqat o'qish) va "ОплатыКв" modali (`GET /oplata-kv?contractNos=...&perPage=50`). `ContractInfoPanel`: `GET /chek-order/contract-info?contract=` (mijoz, obyekt, kvartira, crm_status, qiymat / to'langan / qoldiq).
- **To'lov tekshirish** (`chek-payment.tsx`, faqat o'qish): manbalar ОплатыКв / CRM / Google Sheets (`GET /chek-order/payment-sheets`; to'lov ustunlari yo'q sheetlar o'chiq); shartnoma chip kiritish (200 tagacha, dublikatsiz, crm-suggest); Excel'dan import `POST(form) /chek-order/payment-check/import-contracts`; ishga tushirish `GET /chek-order/payment-check?contracts&oplata&crm&sheetIds` (180 s); filtr hammasi / mos / farq; eksport `apiDownload /chek-order/payment-check/export?...&filter`. (CRM payment-history fallback va Sheet URL→ID gotcha backend'da.)
- **Tarix**: `GET /chek-order?result&q&page` (statistika chiplari), `DELETE /chek-order/:id` va hammasini `DELETE /chek-order` (`confirm`, manage).
- **Murojaatlar** (`chek-tickets.tsx`): `GET /chek-order/tickets?status&q&page` (new / in_progress / resolved / rejected), badge `GET /chek-order/tickets?perPage=1`, `DELETE /chek-order/tickets/:id` (tab ichida qo'shimcha ruxsatsiz). Detail drawer: status `PATCH /chek-order/tickets/:id {status}`, bog'langan to'lov `GET /chek-order/tickets/:id/payment`; `ResolvePanel` (AI boshlang'ich/oylik split'ni tuzatadi: `POST .../resolve/chat {messages, locale}`, `POST .../resolve/apply {oplataKvId, mode, firstInstallment, monthlyAmount}` → "Bajarildi"); `LocatePanel` (not_found uchun: `POST .../locate/chat`, `POST .../locate/link {key, contractNo}`, status + resolution PATCH).
- **AI yordamchi** (`chek-assistant.tsx`): suzuvchi orb, faqat Tekshirish natijalari bo'lsa; `POST /chek-order/assistant/chat {messages, context, locale}` (quick replies, taklif, jadvallar); murojaat yaratish `POST /chek-order/tickets {...proposal, transcript, matchedTxExtId}`. Suhbat yopib-ochishda saqlanadi, order to'plami o'zgarsa (context key) qayta boshlanadi.

### `/setup/*` — Banklar, ulanishlar, hisoblar

- **`/setup/banks`** (`banks:view`): `GET /banks`; KPI banklar / faol / ulanishlar / hisoblar; faol bank kartalari (apiKind, endpoint, sync oralig'i): endpoint'ni joyida tahrir (lab ↔ prod) `PATCH /banks/:id {apiBaseUrl}`, sync oralig'i 1–1440 daqiqa yoki 0 = o'chiq `PATCH /banks/:id {syncIntervalMinutes}`. Gotcha: klientda `banks:manage` tekshirilmaydi. Nofaol banklar "kelajakdagi banklar" `<details>` ichida.
- **`/setup/credentials`** (`credentials:view`): `GET /bank-credentials`, `GET /banks`; KPI jami / faol / tasdiqlangan / xatoli. Karta: Test `POST /bank-credentials/:id/test` (xato bo'lsa va `credentials:manage` bo'lsa `AutoFixModal` → `POST /bank-pwd/fix-one {credentialId}`, urinishlar birma-bir), Tahrir, O'chirish (`DELETE /bank-credentials/:id`), parolni ko'rish (manage) `GET /bank-credentials/:id/reveal-password`. `CredDialog`: bank (faqat faol), authMode `IP_WHITELIST | SMS_SID`, label, loginPrefix + loginName, parol (tahrirda bo'sh = o'zgarmaydi), filial 5 xonaga to'ldiriladi, proxy toggle (`POST`/`PATCH /bank-credentials`). "Parol avtomat" drawer (manage): kirish kodi (env) bilan `POST /bank-pwd/config {password}` (bank bo'yicha taxminiy parollar va Telegram sozlamalari ochiladi), saqlash `POST /bank-pwd/save {password, candidates, groupId, botToken?}`, "Xato ulanishlarni tuzatish" `POST /bank-pwd/try {password}`. Gotcha: proxy chiqish manzillari UI'da qattiq yozilgan; tugma sarlavhasi va izohlarda kod qiymati ochiq turadi.
- **`/setup/accounts`** (`accounts:view`, ~1850 qator): `GET /bank-accounts` (kalit `['bank-accounts']`; dashboard `['accounts']` ishlatadi — keshlar alohida), `GET /banks`, `GET /bank-credentials`. Statistika (jami balans, faol sync, banklar), filtrlar (qidiruv, bank, sync ON/OFF), grid/jadval. Excel `apiDownload /bank-accounts/export` → `hisoblar.xlsx` (ruxsatsiz). `accounts:manage`: "Hammasini sync" `POST /sync/run-all`; ommaviy import (qatorlarni joylashtirish, oxirgi 20 xonali raqam hisob raqami sifatida) `POST /bank-accounts/bulk {credentialId, branch, currency, accounts[]}`; yaratish (`CredentialPicker`, bank bo'yicha guruh) `POST /bank-accounts`; har hisob: sync `POST /sync/account/:id`, sync toggle `PATCH /bank-accounts/:id {syncEnabled}`, nomini joyida o'zgartirish `PATCH {ownerName}`, o'chirish, backfill. Hisob backfill: `POST /sync/backfill {scope:'account', accountId, dateFrom, dateTo}` (60 s) → `GET /sync/backfill/status?since=startedAt` har 2 s (RUNNING qolmaguncha; dialog yopilsa to'xtaydi). Ommaviy backfill: `GET /sync/settings` (min sana), `POST /sync/backfill {scope:'all'}` (status har 3 s; 60 kundan ortiq bo'lsa ogohlantirish); avto jadval `GET`/`PATCH /sync/bulk-schedule {enabled, intervalDays, timeOfDay, daysBack}` (daysBack default max(2, interval+1)).

### `/profile` — Profilim

Route qoidasi yo'q (har login qilgan). `GET /auth/me` (30 s, keshdagi user'ga fallback), `GET /audit/my-activity?limit=40` (amallar + `totalActions`/`activeDays`/`lastActionAt`).
- Hero: avatar, ism/email, rol (SUPERADMIN'ga toj), ruxsat/modul/faol kun sonlari, "power level" (ruxsatlar soniga qarab), katta Pomodoro tugmasi. "Edit" tugmasi bezak (handler yo'q).
- Tablar: Profil / Xavfsizlik / Sozlamalar + "Anti-stress" tugmasi (overlay + fullscreen urinishi).
- **Profil**: avatar yuklash (≤2 MB, FileReader dataURL) faqat `localStorage['avatar_<userId>']` ga (backend'ga emas). `LoginHistorySection` — **qattiq yozilgan soxta sessiyalar** (qurilma/IP/joy soxta; faqat `lastLoginAt` haqiqiy).
- **Xavfsizlik**: holat tekshiruvlari va `my-activity` dan **audit amallar jadvali** (amal, modul rangi, IP, vaqt, muvaffaqiyat) — global `AuditInterceptor` har o'zgartiruvchi so'rovni yozadi.
- **Sozlamalar**: `PersonalizationCard` (8 accent — `ACCENTS`, `data-accent`; sevimlilar ro'yxati va olib tashlash; "Standartga qaytarish"; `localStorage['xt_prefs_<userId>']`), tema light/dark (`ThemeProvider`), bildirishnomalar toggle (`localStorage['notifications']`, faqat UI), til ma'lumoti kartasi.
- **Pomodoro** (`components/pomodoro-timer.tsx`): 4 uslub (orb / liquid / ring / display), AudioContext birinchi Start'da (autoplay siyosati), localStorage `pomodoro-stats`, `pomodoro-style`, `pomodoro-muted`, `pomodoro-focus-min` (25), `pomodoro-break-min` (5).

### `/customers`, `/contracts` — eski billing

Sidebar'da yo'q, faqat URL orqali. Route `customers:view` / `contracts:view`.
- `/customers`: `GET /customers[?q=]` (debounce'siz), kartalar (shartnomalar jami / to'langan / qarz / progress, soni). `customers:manage`: yaratish `POST /customers {name, inn, shortName, contactPerson, phone, email, address}`, o'chirish `DELETE /customers/:id`; tahrir (qalam) tugmasi **ishlamaydi** (faqat `preventDefault`). Detail `/customers/[id]`: `GET /customers/:id`.
- `/contracts`: `GET /contracts[?customerId=]`, `GET /customers`; qatorda sarlavha, status, raqam, mijoz, imzo sanasi, jami/to'langan/qarz, progress. `contracts:manage` → `CreateContractDialog` (30/70, 30/30/40 presetlari yoki ixtiyoriy bosqichlar; bosqichlar yig'indisi = jami) `POST /contracts {customerId, title, description, projectAddress, totalAmount, signDate, stages[]}`. Detail `/contracts/[id]`: `GET /contracts/:id` (bosqichlar PENDING / PARTIAL / PAID / OVERDUE, to'lovlar AUTO/qo'lda belgisi).

### `/oplatykv` — ОплатыКв (asosiy tab)

Fayl: `app/[locale]/(panel)/oplatykv/page.tsx` (~4950 qator). Kvartira to'lovlari reestri (loyihaning eng muhim jadvali). Route ruxsati `oplatakv:view`. Tab bar va eski yo'llar E.7 da.

**KPI kartalar** (`SumCard`/`CountCard`): Сумма оплаты, 1 взнос, ежемесячный, Всего записей — filtrlangan ro'yxat javobidagi `sums` va `total` dan.

**Filtr paneli** (chapdan o'ngga):
1. Sync chipi — oxirgi yangilanish vaqti va `txSourceCount` (`GET /oplata-kv/last-sync-info`, har 60 s).
2. Sync tugmasi (`oplatakv:sync`) — pastda "Sync modal".
3. Qidiruv — typewriter animatsiyali placeholder (shartnoma/mijoz/obyekt/ID/summa), 350 ms debounce, sahifa 1 ga qaytadi; `?q=` (`history.replaceState`) va localStorage'da saqlanadi.
4. Ustunlar menyusi (`Columns3`): ixtiyoriy ustunlar `crm_status` (default yoqiq), `Манба` (yoqiq), `Тип (жилой/парковка)` (o'chiq), `Сотув бўлими` (o'chiq). Shu menyuda "Sotuv bo'limini to'ldirish" → `POST /oplata-kv/crm-meta/backfill` (120 s); natija: branchFilled/typeFilled/qolgan + ixtiyoriy "CRM jonli test" (shartnoma → crmBranch yoki "CRM topmadi", "created_by YO'Q", "branch YO'Q").
5. Akt Sverka (`FileCheck2`) → `AktSverkaDialog`.
6. Sana oralig'i (`DateRangeCalendar` dropdown'da, faol bo'lsa nuqta belgisi, localStorage).
7. Ustun-filtr rejimi (`Filter`, faol filtrlar soni); o'chirilsa barcha ustun va summa filtrlari tozalanadi.
8. Yuklab olish (`oplatakv:import`): Excel `/oplata-kv/export`, JSON `/oplata-kv/export-json`, Print (`window.print()`), "CRM'dan qidir (ID)" → `CrmLookupDialog`.
9. "+" (`oplatakv:create`) → `AddChoiceDialog`.

**Jadval ustunlari**: belgilash checkbox (`oplatakv:bulk_split` bo'lsa); Дог № (XATO bo'lsa raqam qizil + `XATO` belgisi; aks holda `contractSource='ariza'` binafsha yoki `'manual'` sariq belgi); Дата; Сумма оплаты / 1 взнос / ежемесячный (o'ngga tekislangan, musbat yashil, manfiy qizil, har birida `AmountFilterTh`); Оплата (`MONTHLY`='ежемесячный', `FIRST`='1 взнос', `GENERAL`='Общий'); Объект; Тип; crm_status (kalit so'z bo'yicha rang: Бартер, Ипотека, Наличные, Продан, Бронь); Тип (жил/пар) — `rowPropType()`: matnda ПАРКОВК/ПАРКИНГ/АВТОСТОЯН bo'lsa parking, aks holda CRM turi, bo'lmasa "—" ("Жилой" taxmin qilinmaydi); Сотув бўлими (`crmBranch`); Манба (`getSource()`: `wasManuallyEdited`→manual, `sourceTxId`→transaction, `importBatchId`→excel, aks holda manual); ID (`PurposeInfoButton` → `purpose-modal`, ID nusxalash).
- Qatorni bosish → `OplataKvDetailDialog`. Ommaviy amaldan keyin o'zgargan qatorlar 3 s "flash" bo'ladi.
- Saralash UI'da yo'q: doim `sortBy=date&sortDir=desc`. Sahifalash: 25/50/100/200 (default 50), filtr o'zgarsa sahifa 1. Ro'yxat `placeholderData: prev` (eski sahifa ko'rinib turadi). Virtualizatsiya yo'q.

**Ustun filtrlari** (`ColumnTh` → `ColumnFilterPopover`, portal):
- Qiymatlar `GET /oplata-kv/distinct?column=…&search=…&<boshqa faol filtrlar>` (300 ms debounce); tanlanganlar tepada.
- "Hammasini belgilash" — faqat hozir ko'rinib turgan (qidiruvdan o'tgan) qiymatlarga ta'sir qiladi, qisman tanlovda indeterminate holat. Pastda "tozalash (n)" va "Tayyor"; Esc/tashqi bosish yopadi.
- Parametrlar: `contractNo→contractNos`, `paymentCategory→paymentCategories`, `client→clients`, `object→objects`, `paymentMethod→paymentMethods`, `txType→txTypes`, `source→sources`, `crmStatus→crmStatuses`, `crmPropertyType→crmPropertyTypes`, `crmBranch→crmBranches` (vergul bilan). `client`, `paymentMethod` parametrlari bor, lekin jadvalda ustuni yo'q.
- XATO filtri: `contractNo` filtrida `XATO` qiymati tanlansa `xatoOnly=true` ga aylanadi. URL `?xatoOnly=1&object=…` (agentning Telegram tugmasidan) filtr rejimini yoqib, XATO va obyektni oldindan qo'yadi.
- Summa filtrlari (`AmountFilterPopover`): aniq yoki oraliq; `paymentAmountMin/Max`, `firstInstallmentMin/Max`, `monthlyAmountMin/Max`; boshidagi "-" (qaytarim) saqlanadi.
- Eksport filtrga bog'liq (`qsForExport`: q + sana + ustun + xato + summa, sahifalashsiz), fayl `oplaty-kv-YYYY-MM-DD.*`.

**Ommaviy o'zgartirish** (`oplatakv:bulk_split`): tanlangan qatorlar soni va summalari ko'rsatilgan panel → modalda `FIRST` yoki `MONTHLY` → `POST /oplata-kv/bulk-category {ids, category}` (120 s), natija updated/skipped; `['oplata-kv']` va `['oplata-kv-last-sync']` yangilanadi.

**"+" — `AddChoiceDialog` (3 karta):**
1. **To'lov** → `OplataKvFormDialog` (yaratish). Maydonlar: Дог №*, Дата* (bugun), Сумма оплаты*, 1 взнос, ежемесячный, Оплата turi (—/MONTHLY/FIRST/GENERAL), Клиент, Объект (`GET /oplata-kv/object-mappings` dagi `oplataName`, 5 daq kesh), Способ оплаты (Перечисление/Наличные), Тип, Назначение платежа, Примечание.
   - CRM avto-qidiruv (faqat yaratishda): `contractNo` 600 ms → `GET /oplata-kv/crm-lookup?contractNo=`, bo'sh bo'lsa Клиент/Объект ni to'ldiradi; holat belgisi (loading/found/not-found/error), obyekt mapping izohi.
   - Qoida: 1 взнос + ежемесячный = Сумма оплаты (0.01 tolerans), mos kelmasa saqlash o'chiq. `POST /oplata-kv` (yaratish) / `PATCH /oplata-kv/:id` (tahrir).
   - Tahrirda: bank tranzaksiyasidan (`sourceTxId`) yoki Excel'dan (`importBatchId`) kelgan qatorda qulf banneri — Дог №, Дата, Сумма, Клиент, Тип, Назначение o'zgartirilmaydi (izoh "5 maydon" deydi, amalda 6 ta).
2. **AI Переброска** → `AiPerereboskaModule` (pastda).
3. **Переброска** ("new" belgisi) → `PerereboskaDialog` (tashqi bosish va yuborish paytida yopilmaydi):
   - Manba: ДОГ № `ContractAutocomplete` (`GET /oplata-kv/contract-suggest?q=`, 250 ms, kamida 2 belgi, ↑/↓/Enter/Esc), Дата; `GET /oplata-kv/contract-balance?contractNo=` (600 ms) → CRM'da bormi, mijoz, obyekt, `totalPaid`.
   - Summa "−" bilan; `totalPaid` dan oshsa xato; aks holda "yechiladi / joriy qoldiq / yangi qoldiq".
   - Maqsadlar: qator qo'shish/o'chirish, har birida autocomplete + balans tekshiruvi + summa. Xatolar: o'ziga o'tkazish taqiqlangan, takror maqsad, topilmadi, **obyekt mos emas** (maqsad obyekti manba obyekti bilan bir xil bo'lishi shart). Maqsadlar yig'indisi = summa.
   - Hujjat fayli **majburiy** (`image/*`, `application/pdf`), izoh ixtiyoriy. Pastda birinchi buzilgan shart yoziladi.
   - `api.postForm('/oplata-kv/perereboska')` (60 s): `fromContractNo`, `amount`, `date`, `note`, `destinations` (JSON `[{contractNo, amount}]`), `file`.

**Sync modal**: tugma → `POST /oplata-kv/sync-now {}` (120 s; tranzaksiyalardan ОплатыКв'ga majburiy import, sozlangan minimal sanani hisobga oladi) → `SyncProgressDialog` ochiladi. Javobda `objectsBackground` bo'lsa `GET /oplata-kv/bg-status` har 5 s (`running` paytida), xatoda 10 s; `running=false` bo'lganda ro'yxat yangilanadi. `components/sync-progress-dialog.tsx` (admin sync-logs bilan umumiy): 3 qadam — sync (added/updated/skipped, `xatoQuickClean`), fill (`bgStatus.result.fill`: filled/total, notFound), split (`bgStatus.result.split`: contracts, filled/total, notFound, `xatoCleaned`); mm:ss taymer; tugaganda yashil, xatoda qizil; pending paytida yopilmaydi. **Stall detection va timeout yo'q** — backend `running` desa polling cheksiz davom etadi; vaqtga asoslangan `activeStep` hisobi o'lik kod.

**Boshqa dialoglar:**
- `OplataKvDetailDialog`: `GET /oplata-kv/:id` (jonli, `['oplata-kv-detail', id]`); hero (shartnoma yoki XATO, nusxalash, ariza/manual belgisi, kategoriya, sana), summalar, Клиент/Объект/Способ/Назначение/Тип/crm_status/Примечание, yaratilgan/yangilangan meta. Pastki tugmalar: Tarix (`HistoryDialog`), Re-split (`sourceTxId` va `oplatakv:split`; 3 s ichida 2 marta bosish → `POST /oplata-kv/:id/split`), O'chirish (`oplatakv:delete`), Tahrir (`oplatakv:edit`).
- `DeleteConfirmDialog`: `perereboskaGroupId` bo'lsa `DELETE /oplata-kv/perereboska/:groupId` — **butun guruh** o'chadi (ogohlantirish bilan); aks holda `DELETE /oplata-kv/:id`.
- `HistoryDialog`: `GET /oplata-kv/:id/history?limit=200` — created/edited/deleted/imported, kim, `fieldsChanged`, JSON diff, izoh.
- `AktSverkaDialog` (shartnoma bo'yicha akt sverka): autocomplete `GET /oplata-kv/distinct?column=contractNo` (250 ms, 50 ta); ma'lumot `GET /oplata-kv/by-contract?contractNo=` — 3 summa kartasi, soni, "XATO chiqarilgan" belgisi, obyekt, xronologik jadval + ИТОГО. Yil bo'yicha guruhlash (`YearGroupView`). CRM Sverka rejimi → `GET /oplata-kv/crm-sverka?contractNo=` (`CrmSverkaView`: ОплатыКв ↔ CRM jami, mos/farq, boshlang'ich/oylik solishtirish; yonma-yon jadvallarda har **kun** yashil (mos) yoki qizil (farq); CRM qatorlari BSH/OYL). Pastki tugmalar: Split (`oplatakv:split`, 3 s ichida 2 marta → `POST /oplata-kv/split-installments {contractNo, force:true}`, 120 s; CRM'da yo'q shartnomada xato toast), "Мем. ордер" (PDF `/oplata-kv/memorial-order?contractNo=&bank=1` yoki Excel `/oplata-kv/memorial-order/xlsx?...`), Planirovka (`PlanViewerDialog`), Print (`[data-print-area="akt-sverka"]` print CSS), Excel (`/oplata-kv/export?contractNos=`).
- `PlanViewerDialog` (`components/plan-viewer-dialog.tsx`, `dynamic(..., {ssr:false})`): `GET /oplata-kv/contract-plan?contractNo=` (40 s, 5 daq kesh) → planlar, shartnoma hujjati, kvartira raqami, obyekt; zoom (tugma, g'ildirak kursor markazida, sudrab surish), aylantirish, yuklab olish `/oplata-kv/contract-plan/download?url=&name=`, print yangi oynada, debug matnni nusxalash. Klaviatura: ←/→, `+`/`-`, `0`.
- `CrmLookupDialog`: `GET /crm/find-by-composite?id=<kompozit>` (180 s) — ajratilgan `generalId`/sana/summa, `via`, `scanned`, nomzodlar ("aniq" yoki "tasodifiy"), `matchedBy` (`general_id`, `external_id`, `transaction_id`), nomzod tafsiloti (shartnoma, boshlang'ich/oylik/boshqa split, usul, tur, status, `external_id`, maqsad) va diagnostika.
- Schotchik→oylik bu sahifada yo'q (u `transactions/page.tsx` dagi amallarda).

**Ruxsatlar (tugma darajasi)**: Sync `oplatakv:sync`; "+" (uchala tur) `oplatakv:create`; Tahrir `oplatakv:edit`; O'chirish `oplatakv:delete`; Yuklab olish menyusi `oplatakv:import`; Re-split va Akt Sverka Split `oplatakv:split`; checkbox + ommaviy panel `oplatakv:bulk_split`. Legacy `oplatakv:manage` ga fallback ataylab yo'q. Ruxsat tekshiruvisiz: Akt Sverka (Split'dan tashqari), filtrlar, ustunlar menyusi va crm-meta backfill, Tarix, purpose tugmasi, AI modul (faqat sozlamalar kirish kodi bilan).

**Gotcha'lar:**
- To'g'ri react-query kaliti `['oplata-kv']` (eski `['oplatakv']` jadvalni yangilamasdi). **`ai-perereboska-module.tsx` hali ham `['oplatakv']` ni invalidate qiladi** — AI Переброска yaratilgandan yoki qaytarilgandan keyin asosiy jadval avtomatik yangilanmaydi (qo'lda yangilash kerak).
- XATO — shartnoma raqami emas, alohida bayroq (avval raqam o'rniga yozilardi va ustun filtri buzilgandek ko'rinardi).
- distinct so'rovi ustunning o'z faol filtrini ham yuboradi; backend uni chiqarib tashlashi aniq emas. Eksport debounce qilinmagan `q` dan foydalanadi.

### `/oplatykv` ichidagi AI Переброска moduli — `components/ai-perereboska-module.tsx`

O'ng tomondan chiqadigan portal drawer (z-100, `max-w-6xl`), Esc bilan yopiladi; yopilganda tab "Ishlash" ga qaytadi va Sozlamalar qayta qulflanadi. Ariza (PDF/rasm) ni AI o'qib, shartnomadan shartnomaga pul o'tkazmani tayyorlaydi.
- **Ishlash**: fayl yuklash → avtomatik `POST /oplata-kv/perereboska/analyze` (multipart `file`, 90 s). Natija: `agentState` (verified yoki needs_review + `agentReason`), Xulosa (o'xshash shartnomalar tugmalari manbani almashtirib qayta tekshiradi), ogohlantirishlar va markdown izohlar, ariza beruvchi ismi va manbasi (bosma/qo'lyozma) hamda egasi bilan mosligi, topilgan summalar (`transfer/refunded/repay/contract_total/other`; bitta maqsad bo'lsa bosilganda summa qo'yiladi), `amountCorrected` izohi. Takror ogohlantirish (bir xil manba+summa bilan mavjud переброска). Balans jadvali (joriy / o'tkazma / yangi; ОплатыКв va CRM farq qilsa CRM balansi ham).
  - Bloklovchi holatlar: shartnoma CRM'da yoki tarixda topilmadi; ism mos emas (faqat `nameCheck` yoqiq bo'lsa: 3+ harfli tokenlar, kamida 2 tasi umumiy; maqsadlar ham bir egaga tegishli bo'lishi kerak); qoldiq yetmaydi (maqsadlar yig'indisi ОплатыКв balansidan katta; sababi CRM balansi va `missingPayments` (sana/summa/usul/kategoriya) bilan tushuntiriladi). Bloklamaydigan: "Qoldiq ikki joyda har xil" (farq > 1).
  - Tahrirlanadigan forma: Manba shartnoma (katta harf, blur'da `GET /oplata-kv/contract-balance`), Sana, Maqsadli shartnomalar, Izoh. Yuboriladigan summa = maqsadlar yig'indisi.
  - "Tasdiqlash va yaratish" → `POST /oplata-kv/perereboska` (multipart, 60 s) qo'lda dialog maydonlari + `agentUsed=true`, `agentState`, `agentReason`, `agentData` (JSON). Fayl preview (rasm yoki iframe'da PDF, "Yangi tabda").
- **Tarix**: `GET /oplata-kv/perereboska/history?status=all|active|cancelled&dateFrom&dateTo&q&page` (20 tadan; q debounce'siz). Karta: manba → maqsadlar, AI belgisi, bekor belgisi, kim yaratgan, bekor sababi. "Hujjat" → `apiDownload /oplata-kv/perereboska/:id/file`; "Orqaga qaytarish" (`showReverse` sozlamasi false bo'lmasa) → `window.prompt` sabab → `DELETE /oplata-kv/perereboska/:id?reason=`.
- **Sozlamalar**: `SettingsGate` kirish kodi (env) so'raydi (client-side solishtirish). `GET`/`POST /oplata-kv/perereboska-settings`: `aiEnabled`, `nameCheck`, `strict`, `tgNotify` (backend qaytargan guruh identifikatori ko'rsatiladi), `showReverse`; `aiModel` tanlovi (Sonnet "tez, arzon" / Opus "aniqroq"). `hasKey=false` bo'lsa Admin → Agent → AI kalit'ga yo'naltiruvchi ogohlantirish. `aiEnabled` frontend'da tekshirilmaydi.

### `/oplatykv/crm` — CRM shartnoma ko'rish

Fayl: `oplatykv/crm/page.tsx`. Route `crm:view`; sahifa ichida qo'shimcha ruxsat tekshiruvi yo'q. XonSaroy CRM'dan bitta shartnomani o'qish (CRM'ga faqat o'qish).
- Autocomplete: `GET /crm/search?contract=<q>&perPage=10` (fokusda, kamida 3 belgi, 250 ms, 30 s kesh; ↑/↓/Enter/Esc). Bekor qilingan (trashed, `deleted_at`) shartnoma qizil chizilgan belgi bilan. Bo'sh "topilmadi" holati ataylab ko'rsatilmaydi — `/crm/show` suggest topmagan aniq shartnomani topishi mumkin.
- Tafsilot: `GET /crm/show?contract=` — sarlavha (obyekt, mijoz, shartnoma raqami, `virtual_status` va status belgisi); 3 KPI (shartnoma summasi — to'langan yoki muddati o'tgan; boshlang'ich to'lov qoldig'i; bo'lib to'lash oylari bilan, foiz chiziqlari); yig'iladigan kvartira ma'lumoti (xonalar, maydon, bino, blok, qavat, sana) va mijoz ma'lumotlari (CRM'dan to'g'ridan-to'g'ri keladigan shaxsiy maydonlar); to'lovlar tarixi boshlang'ich/oylik akkordeonlarda; grafiklar (paid / partially / waiting / overdue / sold).
- So'nggi qidiruvlar `localStorage['crm.recentContracts']` (8 tagacha, tozalanadi). API tili locale'dan (`uz`/`ru`).

### `/oplatykv/billing` — XonPay ↔ bank tranzaksiyalari

Fayl: `oplatykv/billing/page.tsx`. Route `crm:view` (Billing'ning o'z ruxsati yo'q). Sahifa ichida tugmalar uchun frontend ruxsat tekshiruvi yo'q (backend `xonpay:*` qanday tekshirishi aniq emas).
- KPI: jami XonPay, kapitalga mos kelgan (%), yetishmayotgan (chiqarilgan dublikatlar soni bilan) — `GET /xonpay/stats/daily?dateFrom&dateTo` (default oraliq 2024 yildagi qat'iy sanadan bugungacha).
- Sarlavha ikonka tugmalari: Sync/to'xtatish (`POST /xonpay/sync`, `POST /xonpay/sync/cancel`); "Qolganlarni tekshirish" `POST /xonpay/match-all?onlyUnmatched=true` (progress modal); Zaxira match (`GET /xonpay/admin/zaxira-match/nomzodlar` → tasdiqlash `POST /xonpay/admin/zaxira-match`; maqsadi bo'sh to'lovlarni shartnoma+summa+sana bo'yicha juftlaydi, faqat ikki tomonlama yagona mosliklar); Cleanup (`CleanupOrphansDialog`, ikki bosqichli tasdiq → `POST /xonpay/admin/truncate` — nomi "orphan" bo'lsa ham truncate endpoint'i); Cron popover (`GET /xonpay/cron/info` 60 s, `POST /xonpay/cron/interval?minutes=` 15/30/60/120/180/360, `POST /xonpay/cron/toggle?enabled=`).
- Sync tarixi: `GET /xonpay/sync/history?limit=50&q&status&dateFrom&dateTo` (30 s; trigger cron/qo'lda, kim, status, sonlar, davomiylik), ishlayotganini bekor qilish `POST /xonpay/sync/history/:id/cancel`.
- Kunlik statistika (kun bosilsa sana oralig'i shu kunga o'rnatiladi).
- Ro'yxat: `GET /xonpay?page&perPage&dateFrom&dateTo&matched&received&duplicate&olderThan&q` — filtrlar: matched, bankdan kelganmi, dublikat (default yashirin — CRM har to'lovni 2 marta yozadi: boshlanish + bank tushumi), `olderThan` 0/3/7/30 kun (oxirgi 1-2 kun "yetishmayotgan" bo'lishi normal), q (350 ms). Qatorda Tx havolasi `/{locale}/transactions?searchId=<externalId>` va Qayta tekshirish `POST /xonpay/:externalId/recheck`. Excel: xom `fetch(${NEXT_PUBLIC_API_URL}/xonpay/export.xlsx?…)` + `xt_token`.
- Dialoglar: `XonpayDetailDialog` (CRM ma'lumoti, XonPay UUID, `external_id`, maqsad, mos bank tranzaksiyasi); lokal `SyncProgressDialog` (sahifa X/Y, fetched/inserted/updated/matched/errors, oxirgi xato, to'xtatish; ishlayotganda avtomatik ochiladi). Status polling: `GET /xonpay/sync/status`, `GET /xonpay/match/status` — ishlayotganda 3 s, bo'sh paytda 30 s.

### `/oplatykv/xato-crm` — XATO → CRM

Fayl: `oplatykv/xato-crm/page.tsx`. Tab `oplatakv:xato_crm`, route `oplatakv:view` (`/oplatykv` prefiksi). XATO to'lovlarni CRM'dan kompozit ID bo'yicha topib, bir bosishda shartnoma + split biriktirish.
- Ichki tablar: "Shartnoma yo'q" (`xatoOnly=true`) va "Split yo'q" (`unsplitOnly=true`).
- Ro'yxat: `GET /oplata-kv?<filtr>&page&perPage=20&sortBy=date&sortDir=desc&q` (q: ix_id/shartnoma/mijoz/maqsad, 400 ms).
- Moslash: `POST /crm/match-composites {items:[{id: sourceTxId||id, purpose, date}]}` (180 s) — **faqat joriy sahifa** (Excel qatorlarida `sourceTxId` yo'q, kompozit `id` dan olinadi).
- Qator kartasi: to'lov | CRM mosligi (shartnoma, XonPay belgisi, bosh/oylik/boshqa summalar) | tugma "Qo'shish" (xato rejimi) yoki "To'g'irlash" (split rejimi) → "Tasdiqlash" → `POST /oplata-kv/:id/assign-from-crm {contractNo (faqat xato rejimida), initialAmount, monthlyAmount}` (120 s); toast natijaviy kategoriyani aytadi; `['oplata-kv-xatocrm']`, `['oplata-kv']` yangilanadi.
- "Barchasini to'g'irlash": `window.confirm` → `POST /oplata-kv/bulk-crm-fix {mode}` (900 s, butunlay server tomonda, hamma sahifa). Status filtri (Hammasi/Topildi/Topilmadi) faqat klient tomonda, joriy sahifa uchun. Yuklab olish `/oplata-kv/export?<filtr>` → `xato-crm-<mode>.xlsx`.

### `/admin/*` — Admin paneli

Tab bar va route qoidalari E.7 da. Asosiy tuzoq: `login`, `counterparties`, `cleanup`, `import`, `export`, `agent` tablariga kirish uchun tab ruxsatidan tashqari `users:view` ham kerak (route-guard `/admin` prefiksi), `api-explorer` uchun esa `credentials:manage`. `system:deploy` frontend'da hech qayerda ishlatilmaydi.

#### `/admin/users` — Adminlar (panel foydalanuvchilari)
- KPI: jami, faol, bloklangan, oxirgi 7 kunda kirganlar. Qidiruv (email/ism), rol filtri, karta/jadval ko'rinishi almashtirgichi (saqlanmaydi). `ProAdminCard`/`AdminTable`: tahrirlash, faollashtirish/bloklash, o'chirish (`confirm()`).
- `UserDialog`: email (tahrirda o'zgarmaydi), parol, to'liq ism, rol, "faol" (faqat tahrirda). "Avto parol" — 12 belgi (katta/kichik harf, raqam, belgi; chalkash I/O/l/o/0/1 chiqarilgan; Fisher–Yates aralashtirish; `Math.random()` — kriptografik emas), ko'rsatish va nusxalash.
- Endpoint'lar: `GET /admin-users`, `GET /roles`, `POST /admin-users {email, password, fullName, roleId}`, `PATCH /admin-users/:id {fullName, roleId, isActive, password?}` (faollik toggle ham shu), `DELETE /admin-users/:id`. Tugmalar `users:manage`. Avatar `localStorage['avatar_<userId>']` dan (faqat shu brauzerda yuklangan bo'lsa ko'rinadi).

#### `/admin/roles` — Rollar va ruxsat daraxti
- `ProRoleCard`: rol gradienti, qamrov foizi (`permissions.length / all.length`), modullar bo'yicha guruh, foydalanuvchilar soni (`_count.users`). Tahrir `roles:manage`, o'chirish faqat `!isSystem` rollarda; "Yangi rol" `roles:manage`.
- `RoleDialog`: tizim nomi faqat yaratishda (`toUpperCase()`), ko'rinish nomi va tavsif yig'iladigan blokda; qidiruv (modul/sahifa/action label yoki value); "Hammasi"/"Tozalash" faqat ko'rinib turgan ruxsatlarga. Uch darajali daraxt **Modul → Sahifa → Action** (qisman/to'liq belgi, `n/m`, modul progress chizig'i; har ochilishda hamma modul yopiq). Daraxt `tree` dan, bo'lmasa eski `groups` formatidan. Tashqi bosish va saqlash modalni yopmaydi (faqat X/ESC). Saqlagach `useAuth.getState().hydrate()` — joriy foydalanuvchi ruxsatlari darhol yangilanadi.
- `chekorder:telegram` yonidagi ⚙ → `TelegramConfigModal` (Chek order uchun Telegram Mini App kirishi: yoqish, bot token (niqobli, bo'sh = eskisi qoladi), bot username, Mini App short name, guruh; "Guruhga tugma yuborish"; shaxsiy kirish havolasini nusxalash).
- Endpoint'lar: `GET /roles`, `GET /roles/permissions` (`all`, `groups`, `tree`), `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id`, `GET`/`POST /chek-order/tg/config` (javobda `webhook.ok/error`), `POST /chek-order/tg/post-button`.

#### `/admin/login` — bank login muammolari (panel logini emas)
- Paroli o'zgargan yoki auth xato berayotgan bank credential'lari. Muammo yo'q bo'lsa "Hammasi joyida"; bo'lsa sariq banner va har credential uchun `IssueCard` (bank logosi, label, "Auth xato", login, auth rejimi, ishlamayotgan hisoblar — 5 tagacha + "yana N ta", oxirgi xato vaqti).
- `GET /bank-credentials/auth-issues` (har 30 s). `UpdatePasswordDialog` (kamida 4 belgi, tasdiq mos) → `PATCH /bank-credentials/:credentialId {password}` → avtomatik `POST /bank-credentials/:credentialId/test` (test yiqilsa ham parol saqlangan, alohida xabar). Sahifa ichida qo'shimcha ruxsat tekshiruvi yo'q.

#### `/admin/counterparties` — Kontragentlar (INN bazasi)
- Didox va Ta'minot DB (xontaminot) orqali boyitiladi; Didox sozlanmagan bo'lsa ogohlantirish. KPI: jami, boyitilgan %, o'rtacha reyting, oxirgi yangilanish, keyingi cron (klientda Toshkent soati bo'yicha taxmin: 08:00–22:00 har soat).
- Qidiruv, reyting/status filtri, saralash, sahifalash, sahifaga o'tish, Excel eksport (gate'siz). Qator menyusi: batafsil (o'zgarishlar tarixi), yangilash, tahrir, o'chirish (`counterparties:manage`).
- ⚙ Settings dialog (`counterparties:manage`): "Sozlamalar" (yangi kontragent, avto-yangilash, "hammasini yangilash", Ta'minot DB testi, sync va jadval, truncate) va "Tarix" (faoliyat logi, 300 ms qidiruv, aktor filtri). `TruncatePasswordDialog` — parol serverga yuboriladi.
- Endpoint'lar: `GET /counterparties?page&perPage&q&ratingTier&status&sortBy&sortDir`, `POST /counterparties`, `POST /counterparties/:inn/refresh`, `POST /counterparties/refresh-all` (30 s dan keyin ro'yxat qayta), `PATCH`/`DELETE /counterparties/:inn`, `POST /counterparties/import` (xom `fetch` + FormData, token `useAuth.getState().token`, URL fallback `''`), `GET /counterparties/export?…`, `GET /counterparties/:inn/history?limit=50`, `GET /counterparties/_settings`, `POST /counterparties/_settings/auto-refresh`, `GET /counterparties/_activity-log?…`, `GET|POST /counterparties/_xontaminot/settings`, `GET /counterparties/_xontaminot/status` (dialog ochiq bo'lsa 3 s), `GET /counterparties/_xontaminot/test`, `POST /counterparties/_xontaminot/sync`, `POST /counterparties/_truncate {password}`.

#### `/admin/sync-logs` — Sync tarixi va sozlamalar
- Ichki tablar: "Tarix" (`sync:view` yoki `sync:history_view`) va "Sozlamalar" (`sync:view` yoki `sync:settings_view`). Route va tab `sync:view` talab qilgani uchun granular ruxsatlar amalda ta'sirsiz; `sync:settings_edit`, `sync:run` sahifada umuman tekshirilmaydi.
- **Tarix**: `GET /sync/logs?limit=200` (har 10 s, "Live" belgisi). KPI: muvaffaqiyat %, xatolar, olingan/saqlangan, o'rtacha vaqt (oxirgi 20 davomiylik sparkline). Status filtrlari: Hammasi, SUCCESS, FAILED, PARTIAL, RUNNING, BACKFILL (`source` da "backfill"). Qidiruv va sahifalash (20) klientda; izoh "hisob/egasi/xato" deydi, kod faqat `source` va `errorMessage` ni qidiradi.
- **Sozlamalar** (`SyncSettingsPanel`, yig'iladigan kartalar):
  1. Sync minimal sana: `GET /sync/settings`, `PATCH /sync/settings {syncMinDate}` — sync bu sanadan oldingisini hech qachon olmaydi (qo'lda import qilingan tarix himoyasi).
  2. ОплатыКв auto-import: `OrderIdSection` (`GET /oplata-kv/order-id-coverage`, `POST /oplata-kv/backfill-order-ids`, keyin 9 s va 20 s da qayta yuklash); `ReverifySection` (XATO shartnomalarni CRM bilan qayta tekshirish: `GET /oplata-kv/reverify-status` ishlayotganda 2.5 s, `POST /oplata-kv/reverify-contracts`); "Sozlamalar va vositalar": `oplatykvTxMinDate` (`PATCH /sync/settings`), "Hammasini sync qilish" `POST /oplata-kv/sync-from-transactions {minDate}` (2 daq) + `SyncProgressDialog` + `GET /oplata-kv/bg-status` (5 s, xatoda 10 s), DEBUG `GET /oplata-kv/debug-xato-splits` (console'ga), auto-sync cron daqiqasi (0 = o'chiq) va kunduzgi/tungi oynalar, tx-manba qatorlarini sana bo'yicha tozalash `DELETE /oplata-kv/cleanup-tx-source?dateFrom&dateTo` (`confirm()`), obyekt mapping CRUD (CRM nomi → ОплатыКв nomi; faqat keyingi sync'larga ta'sir) `GET|POST /oplata-kv/object-mappings`, `DELETE /oplata-kv/object-mappings/:id`. Kodda yana: `DELETE /oplata-kv/cleanup-xato-contracts`, `POST /oplata-kv/split-installments {limit:5000}` (10 daq), `POST /oplata-kv/cleanup-xato-splits`.
  3. **Telegram BACKUP** (to'liq loyiha: baza + kod + fayllar ZIP → Telegram): `GET /backup/config` (`status.running` bo'lsa 3 s), `POST /backup/config {enabled, times (vergul bilan), chatId, botToken?}` (token niqobli, bo'sh = o'zgarmaydi), `POST /backup/run` ("Hozir backup olish"). Holat: bosqich, oxirgi muvaffaqiyat, hajm (bo'laklar soni), oxirgi xato. i18n izohi: ZIP shifrlanmagan (mijoz ma'lumotlari bor) — kanal maxfiy bo'lishi shart. (Backup Export sahifasida emas, shu yerda.)
  4. ZIP eksport: `GET /oplata-kv/export/arizas-zip`, `GET /oplata-kv/export/perereboski-zip` (xom `fetch`, token `localStorage['xt_token']`).

#### `/admin/api-explorer` — bank API debug
- KapitalBank Mobile API'ni qo'lda sinash: Login → Tranzaksiyalar (GetDoc1C) → Hisob qoldig'i (GetAcc1C). Bank presetlari `GET /banks` (nofaollar kulrang). "Proxy orqali" toggle (`useProxy`); forwarder URL va sirini web'dan tahrirlash `GET|PATCH /api-explorer/forwarder` (manba db/env/none). Login, parol, SMS kod, MFO (5 xonagacha 0 bilan to'ldiriladi), hisob, sana oralig'i (max 31 kun, dd.MM.yyyy).
- `POST /api-explorer/kapitalbank/login`, `/kapitalbank/transactions`, `/kapitalbank/account`; natijada hisoblar valyuta/tur bo'yicha, tranzaksiya detali, xom JSON. `AddBankAccountDialog`: bankdan kelgan hisob(lar)ni credential tanlab qo'shish `POST /bank-accounts`, `POST /bank-accounts/bulk` (`GET /bank-accounts`, `GET /bank-credentials`).
- Gotcha: forwarder siri backend'dan ochiq matnda kelib formaga to'ldiriladi; UI matnida server/proxy manzillari va bank base URL kodda qattiq yozilgan.

#### `/admin/cleanup` — Tozalash
- A) Hisob bo'yicha to'liq tozalash: hisob raqami ≥ 20 belgi va tasdiq maydoni aynan shu raqam; `GET /transactions/count-by-account/:accountNo` (hisob kartasi, tranzaksiya va bog'langan Payment soni, birinchi/oxirgi sana) → `POST /transactions/cleanup-by-account {accountNo, confirm}`. Tranzaksiyalar va Payment'lar o'chadi, hisob qoladi, keyingi sync qoldiqni tiklaydi. **Gate: `me.role === 'SUPERADMIN'`** — permission emas, qattiq rol tekshiruvi (loyihadagi "hardcode rol yo'q" qoidasidan istisno).
- B) To'lov ID (external_id) bo'yicha: jadval `transaction` yoki `oplatakv`; `GET /transactions/find-by-payment-id?paymentId&table` (hamma uchun), `POST /transactions/delete-row-by-id {id, table, confirm:id}` (`cleanup:run`).

#### `/admin/import` — Import
- Sahifa `ImportQulfi` bilan: kirish kodi (env) so'raladi — amalda `IMPORT_KOD` konstantasi klient kodida; holat faqat xotirada (refresh'da qayta so'raydi). `import:run` sahifada tekshirilmaydi.

| Tur | Endpoint'lar | Izoh |
|---|---|---|
| Tranzaksiyalar | `POST /import/transactions` (FormData, 5 daq) | A–K ustunlar, K = ID (dublikat skip) |
| Aloqa Bank | `POST /import/aloqa-bank` | — |
| Hamkorbank vipiska | `POST /import/hamkor-vipiska/preview` (10 daq), `/commit {previewId}`, `/cancel` | 2 bosqich; hisob bazada bo'lmasa ogohlantirish |
| Kontragentlar | `POST /counterparties/import` | — |
| ОплатыКв | `POST /oplata-kv/import/preview` (30 daq), `/commit`, `/cancel` | A–M ustunlar, M = ID |

- "Becfil olmaydigan davrlar" (Hamkor istisnolari): `GET|POST /import/hamkor-vipiska/exclusions`, `DELETE /import/hamkor-vipiska/exclusions/:id` — bu oraliqlarni avtomatik sync olmaydi (qo'lda import bilan dublikat bo'lmasligi uchun).
- Import tarixi: `GET /import/batches`; batch eksport `apiDownload /import/batches/:id/export` (`_backup.xlsx`); batch'ni qatorlari bilan o'chirish `DELETE /import/batches/:id` (5 daq, tasdiq dialogi). "Ko'rish" → `/transactions?batchId=`.

#### `/admin/export` — Eksport
- Ruxsatlar: `export:manage` (sozlama, credential, saqlash), `export:run` ("Bajarish"), `export:download` (yuklab olish), `export:autsourcing` (Autsoursing va SHMITD tablari). Ichki tablar: Google Sheets | Autsoursing | SHMITD; yuqorida ⏱ Cron va ⬇ Yuklab olish.
- **Google Sheets**: Service Account kartasi (holat, client email nusxalash, manba env yoki DB'da shifrlangan; `POST /google-export/test` 60 s; `POST /google-export/credentials {json}`, `DELETE /google-export/credentials`). `SheetCard` (default yopiq): nom, Spreadsheet ID yoki havola (URL → ID), list nomi, boshlanish qatori, "sanadan bugungacha"; manba ОплатыКв (summa ishorasi, Объект/Тип multi-select `GET /google-export/distinct-filters` 5 daq kesh, Оплата kategoriyasi) yoki Tranzaksiya (hisoblar ro'yxati); ustun mapping (harf → maydon); rejim `replace` yoki `upsert` (kalit maydon — `ix_id` tavsiya; "anker" ustun per-record bo'lishi kerak, status ustuni yaramaydi). "Bajarish" `POST /google-export/run {target}` (5 daq; saqlanmagan joriy forma bilan), "Nechta qator?" `POST /google-export/preview-count`, "ix_id larni yuklab olish" `GET /google-export/upsert-keys?sheetId` (.txt). Saqlash `GET|PUT /google-export/config {sheets}` (lokal state bir marta initsializatsiya — `initedRef`, refetch saqlanmagan tanlovni o'chirmaydi). Cron modal: sheet bo'yicha har N daqiqa, soat oralig'i, hafta kunlari (sheet config ichida); log `GET /google-export/cron/logs?page&sheetId&dateFrom&dateTo&status`. Yuklab olish: `apiDownload /google-export/download?dataset=oplatykv|transactions&format=json|csv|xlsx|sql-mysql|sql-postgres|txt|xml|html|md|yaml`.
- **Autsoursing** (Telegram guruhga Excel): `GET|PUT /google-export/autsourcing/config` (bot token yashirin, guruh, ustunlar, shartnomalar ro'yxati, dateFrom, kunlik cron Toshkent vaqti), `POST /google-export/autsourcing/send` (2 daq; topilmagan shartnomalar soni).
- **SHMITD** (Google Sheet "Shmidt bolg'a" → HTML → Telegram guruh): `GET|PUT /shmitd/config` (yoqish, bot token, guruh, Spreadsheet ID, varaq, qaysi sana +1…−3 kun, bir nechta jo'natish vaqti, ixtiyoriy alohida service-account JSON), "Hozir jo'natish" `POST /shmitd/send` (gate'siz; `sent` jami/sariq/qizil, `empty` yoki xato), tarix `GET /shmitd/history?page&perPage=15&from&to`, HTML yuklab olish `apiDownload /shmitd/history/:id/html`.

#### `/admin/api-keys` — Developer API kalitlari
- "Public hujjatlar" (`/{locale}/api`, yangi tabda), "Yangilash", "Yangi API kalit" (`api_keys:manage`). KPI: jami, faol, bekor, so'rovlar (24 soat va jami). Jadval: nom/tavsif, keyId, scope'lar (3 ta + "+N"), holat (FAOL/BEKOR, muddati o'tgan), oxirgi ishlatilgan vaqt va IP, so'rovlar soni.
- Yaratish: nom, tavsif, scope'lar (kamida 1, `GET /api-keys/scopes`), muddat (cheksiz / N kun / aniq sana), IP oq ro'yxati (bo'sh = hamma IP). `SecretRevealDialog`: sir **faqat bir marta** ko'rsatiladi, "Ikkalasini nusxalash" `X-API-Key`/`X-API-Secret` ko'rinishida, `/_whoami` curl misoli. Tahrir: nom, tavsif, faollik, scope'lar, muddat, IP'lar. Detail: statistika (jami/24 soat/7 kun), top yo'llar va IP'lar, so'nggi 100 so'rov.
- Endpoint'lar: `GET /api-keys`, `GET /api-keys/scopes`, `GET /api-keys/stats[?apiKeyId=]`, `GET /api-keys/logs?apiKeyId=&perPage=100`, `POST /api-keys`, `PATCH /api-keys/:id`, `DELETE /api-keys/:id` (`confirm()`). Universal API uchun alohida UI yo'q — bu `universal:read` scope.

#### `/admin/agent` — AI Agent va Agent Support
- Ikki ichki tab: "AI Agent" (default) va "Agent Support" (`?tab=support&view=…`). AI Agent paneli birinchi ochilgandan keyin unmount qilinmaydi (saqlanmagan forma yo'qolmasin); qaytganda URL'dan `tab`/`view` olib tashlanadi. Support tab yonida bot tirikligi nuqtasi va kutilayotgan rejalar badge'i (`agentTeamApi.overview()`, 30 s).
- **AI Agent** (arizalarni Claude vision bilan avtomat tekshirish): kartalar faqat `agent:manage` bilan ko'rinadi — `agent:view` egasi bo'sh sahifa ko'radi, lekin `GET /agent/config` (30 s) va `GET /agent/ai/status` (12 s) baribir so'raladi. Holat (yoqilgan, ishlamoqda, interval, ish soatlari), StatTile'lar (kutilmoqda, ishlanmoqda, ko'rib chiqish, agent tasdiqladi/rad etdi). Sozlamalar: AI kalit (niqobli, alohida tahrir rejimi), agent nomi, model (`claude-sonnet-4-6` default va boshqa variantlar ro'yxati), tekshirish oralig'i, ish vaqti (0–24 = doim) → `PUT /agent/config`; qo'lda ishga tushirish `POST /agent/ai/run {limit:20}` (tasdiqlandi/rad/xodimga/xato). Faoliyat modali `GET /agent/ai/activity?q&page&perPage=20` (ochiq bo'lsa 15 s, 300 ms qidiruv), CSV `perPage=1000` → `agent-faoliyat.csv`. Suhbat drawer: `GET /agent/ai/chat/history`, `POST /agent/ai/chat {message, image?}` (60 s; rasm ≤5 MB base64), `POST /agent/ai/chat/clear` (`confirm()`); markdown `react-markdown`; faqat X/ESC bilan yopiladi.
- **Tuzatish bot** kartasi: `GET|PUT /correction-bot/config` (enabled, botToken — bo'sh = o'zgarmaydi, guruh, oq ro'yxat: chat identifikatori + ism "kim bajardi" uchun). Oq ro'yxatda bo'lmagan bot'dan foydalana olmaydi.
- **Telegram digest** (XATO to'lovlar): `PUT /agent/config` (botToken, guruh, dateFrom, dailyTime, enabled, oq ro'yxat), "Hozir jo'natish" `POST /agent/run` (2 daq). Har kuni belgilangan vaqtda guruhga XATO soni va ОплатыКв XATO filtrini ochuvchi tugma (`/oplatykv?xatoOnly=1&object=…`).
- **Agent Support** (`components/agent-team/agent-support-panel.tsx`, faqat shu sahifada): Python Telegram agentlar jamoasi (`leader`, `support`, `checker`, `teacher`) monitoringi. Ma'lumot manbai — bot yozadigan PostgreSQL `agents` sxemasi, backend faqat o'qiydi; yagona yozuv `agents.kv_store` dagi `agent_enabled_<nom>`. Bot o'rnatilmagan bo'lsa `installed=false` (`NotInstalled`). Sir qiymatlar hech qachon qaytmaydi (faqat bor/yo'q). Boshqaruv `agent:manage` (`canManageTeam`); Support REJA tasdig'i (Ha/Yo'q) faqat Telegram'da (`TelegramOnlyNotice`).
  - Tuzilma: `OverviewHero` → `TeamDiagram` + `AgentCards` → `ViewNav` (`?view=`) → faol ko'rinish `ViewBoundary` ichida (faqat faol ko'rinish mount bo'ladi — polling ham faqat shunda).
  - `overview-hero.tsx`: LIVE / RATE-LIMIT / REJA IJROSI; heartbeat yoshi server vaqtiga nisbatan (≤180 s live, ≤600 s stale, ko'prog'i offline); KPI'lar (bugungi chaqiriqlar, muvaffaqiyat, xato, timeout, bloklangan, o'rtacha davomiylik); "Kutilmoqda" chiplari (rejalar, xotira tasdig'i, va'dalar, vazifalar, Facts, health).
  - `team-diagram.tsx`: Egasi → Telegram → Leader → Support/Checker/Teacher topologiyasi (SVG+HTML, oqim animatsiyasi), TodayMatrix, InfraRail, TeamTrend. `agent-cards.tsx`: 2×2 kartalar, yoqish/o'chirish (`PUT /agent-team/agents/:name/enabled`, optimistik emas), model, kunlik chegara, 7 kunlik statistika.
  - `activity-view.tsx` (`agent_runs`, filtrlar, drawer, CSV `agent-support-runs.csv` formula-injection himoyali), `chat-view.tsx` (`agent_chat_log`, Toshkent kun ajratkichlari, `useInfiniteQuery` + `before` kursori, faqat oddiy matn), `tasks-view.tsx` (Leader topshiriqlari + va'dalar, faqat o'qish), `plans-view.tsx` (Support kod tuzatish rejalari, lease, countdown, find/replace diff), `memory-view.tsx` (xotira fayllari markdown ko'ruvchi — HTML va rasm render qilinmaydi, Teacher tasdiq kutayotganlari), `health-view.tsx` (Checker komponentlari, Facts yangiligi va bo'limlari, `kv_store` holat kalitlari), `settings-view.tsx` (faqat o'qish: env kalitlari bor/yo'q, modellar, chegaralar, timeoutlar; o'zgartirish server env fayli + restart orqali), `ui.tsx` (Pill, StatusDot, AgentAvatar, tone funksiyalari, Toshkent vaqt formatlovchilari, `NotInstalled`, `ErrorBlock`).
  - `lib/agent-team-api.ts` (kesh kalitlari `['agent-team', …]`, `AGENT_TEAM_REFRESH`): `GET /agent-team/overview` (10 s), `/agents` (15 s), `PUT /agent-team/agents/:name/enabled` (409 o'rnatilmagan, 400 noto'g'ri nom), `/runs?…` va `/runs/:id` (15 s), `/chat?…` (10 s), `/tasks?…` (10 s), `/promises?…` (20 s), `/plans` (5 s), `/memory/log?…` (20 s), `/memory/files`, `/memory/file?name=` (oq ro'yxat, 30 s), `/health`, `/facts/section?key=` (30 s), `/settings` (60 s). GET'lar `agent:view`, yagona yozuv `agent:manage`. `lib/agent-team-types.ts::AGENT_TEAM_VIEWS` = activity (default), chat, tasks, plans, memory, health, settings.

#### Deploy modal — `components/deploy-modal.tsx`
- `(panel)/layout.tsx` da mount; faqat `window` dagi `open-deploy-modal` hodisasi bilan ochiladi (topbar qo'ng'irog'idan). `GET /_deploy/status` har 3 s (kalit `['deploy-status']` topbar bilan umumiy). Ruxsat talab qilmaydi.
- Holatlar (ustuvorlik failed > newVersion > running): running — foiz, o'tgan va taxminiy qolgan vaqt, joriy va bajarilgan bosqichlar (`deploy.phases` dan prefiks moslash: git, backend npm ci/prisma/build, frontend build, restart); newVersion — `currentCommit` sahifa ochilgandagidan farq qilsa, qisqa commit, "Hozir yangilash" (`location.reload()`) va "Keyinroq"; failed — `error` va "Yopish". Yopilganlar faqat xotirada (startedAt/commit bo'yicha). O'lik kod: `dismissNotification`.

---

### Panel tashqarisidagi sahifalar

#### `/login` — `app/[locale]/login/page.tsx`
- Ochiq. Store hydrate bo'lib token bor bo'lsa darhol `nextDest()` ga yo'naltiradi. Yagona endpoint `POST /auth/login` (`useAuth.login`).
- `?next=` `window.location.search` dan o'qiladi (izoh: `useSearchParams` Suspense talab qilib build'ni buzardi). Faqat nisbiy yo'l (`/` bilan boshlanib, `//` emas) qabul qilinadi — open redirect himoyasi; fallback `/{locale}/dashboard`.
- UI "messenger" uslubida: desktop'da fon `ShowcaseStage variant="minimal"`, mobil'da `MobileLoginShowcase` + `MobileScanOverlay`; o'ng yuqorida `LanguageSwitcher` va ikonka "KIRISH" tugmasi; pastda `LoginTicker` (`components/login-ticker.tsx` — 8 ta soxta bank/kompaniya qatori marquee, backend'siz).
- Oqim: KIRISH → `scanning=true` (3D dashboard 180° aylanib "ACCESS GRANTED ✓" skan orqa tomoni) → 1400 ms dan keyin o'ng panel (telefonda to'liq ekran, HUD bezaklar, Toshkent vaqti soati) → bot salomlashadi va login so'raydi → parol (niqoblangan, ko'z tugmasi) → `checking` → `login()`. Muvaffaqiyat: vibratsiya, yashil flash, toast, 700 ms dan keyin yo'naltirish. Xato: toast, 1.3 s qizil flash, bot pufagi `ХАТО — <xabar>`, 1.4 s dan keyin chat login qadamidan qayta boshlanadi. Qadamlar: `login | password | checking | done`. ESC/X panelni yopadi.
- `lib/login-sounds.ts::vibrate` — `navigator.vibrate` o'rami (iOS Safari va desktop'da ishlamaydi; avvalgi Web Audio tovushlari olib tashlangan). Gotcha: Android Chrome kechiktirilgan (`setTimeout`) vibratsiyani bloklaydi — butun pattern bosish paytida bitta chaqiriqda yuboriladi.

#### `/showcase` — `showcase/page.tsx` + `components/showcase-stage.tsx`
- Faqat bezak (marketing hero), ochiq, backend chaqiruvi yo'q. `ShowcaseStage` `variant: 'full' | 'minimal'`, `scanning`. CSS-3D dashboard (statik tilt; sichqoncha parallaksi so'rov bo'yicha o'chirilgan), soxta balans har 2 s tasodifiy o'zgaradi, chiziqli grafik, bank kartalari, Storyset SVG sahnalari. three.js emas, faqat CSS/SVG. Login, showcase va `AuthGuard` SplashLoader'da ishlatiladi.

#### `/chek` — "Shartnoma nazorati" jurnali (`chek/page.tsx`, `baza-tab.tsx`, `tarix-tab.tsx`, `sozlamalar-tab.tsx`, `i18n.ts`)
- `(panel)` guruhidan tashqarida, lekin `<AuthGuard>` bilan (JWT). Sidebar va panel karkasi yo'q, o'z sarlavhasi bor ("Pro" belgisi, tema almashtirgich `useTheme`, til, foydalanuvchi menyusi → Chiqish `/login` ga). Tablar ruxsat bo'yicha: `chek:baza`, `chek:tarix`, `chek:sozlamalar`; birinchi ruxsatli tab tanlanadi, hech biri bo'lmasa "Ruxsat yo'q". Backend `chek.controller` ham shu ruxsatlarni tekshiradi.
- O'z i18n'i (`chek/i18n.ts`): 4 til `uz | uzc` (o'zbek kirill) `| ru | en`, **default `ru`**, `localStorage['chek.lang']`; `makeT` tanlangan til → ru → kalitning o'zi. Kanonik kalitlar `VID_DOGOVORA_KEYS` (`original`, `ekzemplyar`, `original_fixed`, `ekzemplyar_fixed`), `KONTROLYOR_KEYS` (`otkaz`, `prinyat`) — backend bilan mos.
- **Baza** (yangi yozuv): shartnoma qidiruvi `GET /chek/crm-search?contract=` (250 ms, kamida 3 belgi, 20 s; trashed chizilgan); zaxira "Yuklash"/Enter `GET /chek/crm-lookup?contract=` (25 s). Tanlansa manager, filial, obyekt, mijoz, crmStatus to'ladi; manager bo'yicha `GET /chek/hr-resolve?name=` (Xon HR API orqali Telegram username); topilmasa "Topilmadi — qo'lda tanlang" → `HrPicker` (`GET /chek/hr-search?q=`, 250 ms). Forma: Shartnoma turi (majburiy), Jarima (ixtiyoriy, UZS), Kontrolyor (majburiy: `prinyat`/`otkaz`), Rad etish sababi. Saqlash `POST /chek {contractNumber, manager, managerPhone, managerTgUsername, branchName, objectName, crmStatus, data, vidDogovora, kontrolyor, prichinaOtkaza, shtrafy}`.
- **Tarix**: `GET /chek?q&manager&branch&object&kontrolyor&dateFrom&dateTo&page&perPage=50` (300 ms), filtr qiymatlari `GET /chek/filter-values`, Excel `GET /chek/export?…&lang=` (`chek.xlsx`). Ustunlar: shartnoma, manager, ofis, obyekt, kontrolyor, TG "Yuborilgan/Yuborilmagan", amallar. Amallar: "To'g'rlandi" (faqat `otkaz`) → `PATCH /chek/:id {kontrolyor:'prinyat'}`; Tahrirlash → `PATCH /chek/:id`; Telegram qayta yuborish `POST /chek/:id/send-tg`; O'chirish (`confirm`) `DELETE /chek/:id`. `canEdit` doim `true` uzatiladi.
- **Sozlamalar**: kirish kodi (env) PIN gate — qiymat `sozlamalar-tab.tsx` da konstanta sifatida bundle'da (kosmetik himoya; haqiqiysi `chek:sozlamalar`), ochilgani `sessionStorage['chek.sozlamalar.unlocked']`. Telegram kartasi (yoqish, bot token (niqobli input), guruh, interval daqiqa, soat oralig'i): `GET`/`PATCH /chek/tg-config`, `POST /chek/tg-test` (backend Toshkent soat oynasida intervalda yuboradi; UI tahrirlamaydigan `messageStyle` GET payload qayta yuborilgani uchun saqlanadi). Xon HR kartasi (URL, kalit, sir): `GET`/`PATCH /chek/hr-config`, `POST /chek/hr-test`. Gotcha: tg-config va hr-config GET javoblari bot tokeni va HR sirini brauzerga niqoblamasdan qaytaradi.

#### `/tg/chek` — Telegram Mini App (chek order tekshirish) — `tg/chek/page.tsx`
- Maqsad: AdminUser hisobi yo'q Telegram guruh a'zolari web'dagi "Tekshirish" UI'si (`<ChekCheck guest/>`) va AI yordamchidan foydalanadi.
- Mehmon tokenini olish: (1) shaxsiy havola `?k=<bir martalik token>` → `POST /chek-order/tg/redeem {token}` (backend: xotirada ~10 daqiqa); (2) Mini App `initData`: `window.Telegram.WebApp` bo'lmasa `telegram-web-app.js` skripti qo'shiladi, `initData` bo'lsa `wa.ready()`, `wa.expand()` → `POST /chek-order/tg/auth {initData}` (backend HMAC imzo va `getChatMember` bilan guruh a'zoligini tekshiradi); (3) aks holda gate: `GET /chek-order/tg/public-config` → `{botUsername}`, "Telegram orqali kirish" tugmasi `t.me/<bot>?start=chek` ga.
- Muvaffaqiyatda `setToken(r.token)` mehmon JWT'ni **admin JWT bilan bir xil** `localStorage['xt_token']` ga yozadi (backend: `tgGuest:true`, 12 soat, faqat `chekorder:view|manage|assistant|tickets`). Fazalar: `checking` → `gate` / `denied` (`not_member`, `disabled`, `other`; "qayta urinish" sahifani yangilaydi) / `ready`.
- Ichidagi endpoint'lar (`components/chek-check.tsx`, `chek-assistant.tsx`): `GET /chek-order/crm-suggest?q=`, `GET /chek-order/contract-payments?contract=`, `POST /chek-order/analyze` (multipart, 120 s), `POST /chek-order/manual {orderNos}`, `GET /chek-order/contract-info?contract=`, `POST /chek-order/assistant/chat {messages, context, locale}`, `POST /chek-order/tickets`. Mehmon rejimida chuqur Tranzaksiya va ОплатыКв modallari yashirin.
- Gotcha: mehmon tokeni `xt_token` ni ustidan yozadi; o'sha brauzerda admin sessiyasi bo'lsa keyingi panel tashrifida `xt_auth` dagi token `hydrate()` orqali qayta tiklanadi.

#### `/xato-list` — Telegram'dan ochiladigan XATO to'lovlar ro'yxati — `xato-list/page.tsx`
- Agent botining Telegram tugmasidan ochiladi. XATO (shartnomasi noto'g'ri yoki topilmagan) ОплатыКв qatorlari ro'yxati va to'g'ri CRM shartnomasini ariza fayli bilan so'rash.
- `lib/api` va JWT ishlatilmaydi, next-intl ham yo'q: xom `fetch` (`NEXT_PUBLIC_API_URL`), hamma matn o'zbekcha hardcode.
- Kirish (mount'da `window.location.search` dan bir marta aniqlanadi):
  1. Telegram `login_url` (inline tugma `login_url` → `/uz/xato-list`): Telegram `id, first_name, last_name, username, photo_url, auth_date, hash` qo'shadi; `id` va `hash` bo'lsa shu 7 kalit `tgAuth` sifatida har so'rov tanasida yuboriladi (backend: Login-Widget HMAC + chat_id **oq ro'yxati**; xatolar "Telegram tekshiruvi muvaffaqiyatsiz", "Sizda ruxsat yo'q").
  2. Zaxira maxfiy kalit `?key=<listToken>` (domen bog'lanmagan bo'lsa; backend `agent.listToken` sozlamasi bilan solishtiradi; "Kalit noto'g'ri yoki eskirgan"). Havolaning o'zi kirish ma'lumoti.
  3. Ikkalasi ham yo'q → "Kirish ma'lumoti yo'q — noto'g'ri havola". Telegram WebApp SDK bu yerda ishlatilmaydi.

| Amal | TG rejim | Kalit rejimi |
|---|---|---|
| Ro'yxat | `POST /agent/tg/list {auth}` | `GET /agent/xato-list?key=` |
| CRM shartnoma qidiruvi | `POST /agent/tg/search {auth,q}` | `GET /agent/crm-search?key=&q=` |
| Ariza yuborish (multipart) | `POST /agent/tg/submit` (`oplataKvId`, `contractNo`, `file`, `auth` JSON) | `POST /agent/submit` (`key` bilan) |
| Arizalar (audit) | `POST /agent/tg/arizalar {auth,status,q,submitter,page}` | `POST /agent/arizalar {key,…}` |
| Ilovani ochish | `POST /agent/tg/file {auth,attachmentId}` → blob | `POST /agent/file {key,attachmentId}` |

- Backend'dagi `POST /agent/assign`, `/agent/tg/assign` (faylsiz biriktirish) bu frontend'da ishlatilmaydi.
- Ro'yxat javobi `{ok, count, rows[], me?, arizaStats[]}` (backend: ko'pi bilan 2000 qator, sana oralig'i `agent.dateFrom` sozlamasidan). Qator: `id, date, contractNo, amount, client, object, account, txType, purpose, pending, rejected, pendingInfo{by,at,contractNo,attachmentId,attachmentName}`.
- UI: binafsha hero (Telegram rasmi, "XATO to'lovlar", "Jonli" belgisi, "Salom, …"), 4 ta bosiladigan karta-filtr (Yuklangan, Kirim ≥ 0, Chiqim < 0, Jarayonda), asosiy tablar "XATO to'lovlar" / "Arizalar". XATO tabida: chap `AccountRail` (xl+: hisob bo'yicha XATO soni, summa, pending, "hot" ranglar), sticky qidiruv, `AccountMultiSelect`, karta to'ri (30 tadan, klient sahifalash, skeleton). Hisob kaliti `normAccount(object || account)` — qo'shtirnoq, 5+ raqamli ketma-ketlik va MCHJ/ООО kabi tashkiliy shakl so'zlarini olib tashlaydi (XATO qatorlarida CRM `object` odatda bo'sh, shuning uchun qabul qiluvchi hisob nomi ishlatiladi).
- Jonli yangilanish: har **45 s** qayta yuklaydi, lekin modal ochiq bo'lsa yoki tab yashirin bo'lsa (`document.visibilityState`) o'tkazib yuboradi.
- Qator holatlari: oddiy (kulrang "Shartnoma biriktirish →"), `pending` (sariq, "Tasdiq kutilmoqda"), `rejected` (qizil, "Rad etilgan — qayta yuboring"; backend faqat pending bo'lmasa va oxirgi ariza rad etilgan bo'lsa qo'yadi), tasdiqlangan (to'lov tuzatilgach XATO filtridan chiqib, keyingi yangilanishda ro'yxatdan yo'qoladi).
- **"Shartnoma biriktirish" oqimi**: (1) karta bosiladi → modal (shartnoma chipi, txType, sana, summa, mijoz, obyekt, maqsad, ID nusxa); (2) `pending` bo'lsa sariq blok (kim, qachon, taklif qilingan shartnoma, "ko'rish ↗") — qayta yuborib bo'lmaydi; (3) aks holda (rad etilganda "Oldingi ariza rad etilgan…" banneri bilan): "To'g'ri CRM shartnomasi" ga yoziladi → 2+ belgi, 350 ms → CRM qidiruvi (xato bo'lsa endi ko'rsatiladi — avval jim yutilardi); 0 natijada "oxirgi 1-2 harf adashgan bo'lishi mumkin" maslahati; natija bosilsa `chosen`; qayta yozish tanlovni bekor qiladi; (4) ariza fayli **majburiy** (`.pdf,.doc,.docx,.jpg,.jpeg,.png`, ≤25 MB klientda tekshiriladi); (5) "Ariza yuborish" (`chosen` + fayl) → FormData `POST /agent/tg/submit` yoki `/agent/submit`; (6) `ok` bo'lsa qator optimistik `pending:true`, modal yopiladi; xato modal ichida. Backend: `createRequestWithFile` bilan correction so'rovi (`source` `telegram` yoki `web`), mavjud bo'lsa `alreadyPending` (frontend e'tiborsiz qoldiradi), AI agent yoqiq bo'lsa darhol ishlaydi; inson tasdig'i panelda (`/transactions` Klient·XATO drawer, `/correction/:id/approve|reject`).
- **Arizalar tabi**: server sahifalash (30), status chiplari (Hammasi/Kutilmoqda/Tasdiqlangan/Rad etilgan) sonlar bilan, yuboruvchi `<select>` (`arizaStats`), qidiruv 350 ms; `ArizaCard` (shartnoma `appliedContractNo || proposedContractNo`, status, mijoz, summa, sana, obyekt, kim yubordi/tasdiqladi/rad etdi, kategoriya, rad sababi, ilova) va `ArizaDetailModal`.
- Gotcha'lar: ariza ro'yxati xatolari yutiladi (`.catch(()=>{})`); Arizalar tabida `viewFile` xatosi faqat biriktirish modalida chiziladigan `assignError` ga yoziladi — ko'rinmaydi; ochilgan fayllar 60 s dan keyin revoke.

#### `/api` — Developer API hujjati va sinov (`api/layout.tsx`, `api/page.tsx`)
- Sahifa ochiq (login yo'q); so'rovlar `X-API-Key` + `X-API-Secret` header bilan `fetch(window.location.origin + '/api/v1/...')` (bir xil origin, nginx backend'ga). Middleware matcher `api` bilan boshlanganlarni chetlab o'tgani uchun sahifa faqat `/{locale}/api` ko'rinishida.
- Kirish (`LandingView`): bosqichma-bosqich `key → secret → ready → submitting` (3+ belgidan keyin 120 ms da avto o'tish, Enter/blur) → `GET /api/v1/_whoami`; 401/403/5xx/tarmoq xatolari alohida matnlarga. Muvaffaqiyatda `sessionStorage['xt_dev_api_auth']` = `{keyId, secret, whoami}` — **sir ochiq matnda**. Vizual: `ApiHeroInfra` (`next/dynamic`, `ssr:false`; framer-motion + SVG izometrik laptop → auth → serverlar, holatga qarab rang), shake/pop/flash effektlari, `usePrefersReducedMotion`.
- Sarlavha: logo + `v1`, kalit nomi, scope'lar soni, whoami'dagi mijoz IP'si, o'z tema almashtirgichi (`localStorage['theme']`), til (query saqlanadi), chiqish (sessionStorage tozalanadi).
- 3 ustun: chap — guruhlar `start, meta, universal, transactions, oplatakv, accounts, counterparties`, qidiruv (`/` fokus), `whoami.key.scopes` da yo'q scope'li endpoint qulf bilan o'chiq, faol endpoint `?ep=<path>`; o'rta — sarlavha, tavsif, metod + yo'l, scope belgisi, "scopeMissing", **Try it** formasi (katalog misollari bilan), Execute → status, ms, JSON/matn; o'ng — kod namunalari (`lib/api-snippet-gen.ts`: cURL, Node.js fetch, PHP cURL, Python requests; til `localStorage['xt-api-snippet-lang']`). **Namunalarga haqiqiy kalit va sir qo'yiladi** — nusxalash kredensialni ulashadi.
- Buyruq palitrasi (`components/api-command-palette.tsx`, `cmdk`): ⌘/Ctrl+K, Enter tanlash, ⌘/Ctrl+Enter tanlash va bajarish. Gotcha: joriy bo'lmagan endpoint'ni palitradan bajarish xom `ep.path` ni yuboradi (`{id}` almashtirilmaydi, query tushib qoladi). `components/api-ui.tsx`: `IconBtn`, `PrimaryBtn`, `MethodBadge`, `Kbd`.
- Katalog (hammasi GET, `/api/v1` prefiksi): `_whoami` (scope'siz), `_debug/crm-raw?contract` (`oplatakv:read`), `_meta/all|banks|accounts|categories|enums` (scope'siz), `universal/objects`, `universal/objects/contracts`, `universal/objects/payments`, `universal/accounts`, `universal/statement`, `universal/filters` (`universal:read`), `transactions`, `transactions/{id}` (`transactions:read`), `oplata-kv/changes`, `oplata-kv`, `oplata-kv/deleted`, `oplata-kv/{id}` (`oplatakv:read`; `updatedSince` delta-sync), `accounts`, `accounts/{idOrAccountNo}` (`accounts:read`), `counterparties`, `counterparties/{inn}` (`counterparties:read`). Batafsil API qoidalari API bo'limida.

---

### E.11 Komponentlar katalogi — `frontend/components`

| Komponent | Vazifasi | Qayerda ishlatiladi |
|---|---|---|
| `auth-guard.tsx` | token/hydrate, login'ga yo'naltirish, SplashLoader | `(panel)/layout`, `/chek` |
| `route-guard.tsx` | sahifa darajasidagi ruxsat (`ROUTE_PERMISSIONS`, `LANDING_ROUTES`), 404 video ekran | `(panel)/layout` |
| `sidebar.tsx` | `NAV` menyu, sevimlilar, 3D karta, mobil drawer | `(panel)/layout` |
| `topbar.tsx` | sahifa sarlavhasi, sevimli yulduzcha, qo'ng'iroq (sync xatolari + deploy), til, user menyu, anti-stress tangasi | deyarli har panel sahifasi |
| `transactions-tabs.tsx` | Tranzaksiyalar bo'limi tablari | transactions, statement, check, check-crm, changes, vznos |
| `deploy-modal.tsx` | deploy holati / yangi versiya / xato modali | `(panel)/layout` |
| `anti-stress.tsx` | to'liq ekran dam olish canvas'i (`AntiStressHost`) | `(panel)/layout` |
| `prefs-init.tsx` | login bo'lgan user uchun `usePrefs.init(userId)` | `(panel)/layout` |
| `providers.tsx` | `ReactQueryProvider` | `[locale]/layout` |
| `theme-provider.tsx` | dark/light (`useTheme`) | `[locale]/layout`, profile, chek |
| `language-switcher.tsx` | uz/ru/en tanlash (SVG bayroqlar) | topbar, login |
| `scroll-to-top.tsx` | `#panel-scroll` uchun "yuqoriga" tugmasi | `(panel)/layout` |
| `ui/*` | shadcn uslubidagi `badge, button, card, dialog, dropdown-menu, input, label, select, table` | hamma joyda |
| `empty-state.tsx`, `skeleton.tsx`, `sparkline.tsx`, `widget-error-boundary.tsx` | umumiy UI | ko'p sahifalar (sparkline: sync-logs, transactions; error boundary: dashboard) |
| `bank-logo.tsx` | bank logosi / gradient + `bankAbbr()` | dashboard, transactions, statement, check, setup/*, admin/login, api-explorer |
| `date-range-calendar.tsx` | sana oralig'i tanlagich (date-fns + framer-motion) | transactions, oplatykv |
| `purpose-modal.tsx` | to'lov maqsadi modali (faqat ESC/X bilan yopiladi) | transactions, oplatykv |
| `id-inspector-dialog.tsx` | bank ID inspektori (yakka + Excel ommaviy) | transactions, statement |
| `vipiska-debug-dialog.tsx` | bankdan xom vipiskani olib ko'rish | transactions |
| `time-diagnostics-dialog.tsx` | operatsiya vaqtlari diagnostikasi | transactions |
| `kategoriya-agent-dialog.tsx` | 5 bosqichli kategoriya agenti | transactions |
| `reparse-contracts-dialog.tsx` | soxta shartnoma raqamlarini qayta parse qilish | transactions |
| `tr-support-tab.tsx` | TR Support bot tahrirlari jurnali + ortga qaytarish | transactions (Klient·XATO drawer) |
| `sync-progress-dialog.tsx` | ОплатыКв sync progress (3 qadam) | oplatykv, admin/sync-logs (billing'da lokal nusxa) |
| `ai-perereboska-module.tsx` | AI Переброска drawer (Ishlash/Tarix/Sozlamalar) | oplatykv |
| `plan-viewer-dialog.tsx` | kvartira planirovkasi ko'ruvchi (lazy, ssr:false) | oplatykv (Akt Sverka) |
| `daily-summary-widget.tsx` | "Kunlik xulosa" | dashboard |
| `reconcile-widget.tsx` | Tahlil / Kontragent akt sverka / Shartnoma statement | dashboard |
| `charts.tsx` | SVG grafiklar | dashboard |
| `chek-check.tsx` | chek order tekshirish UI'sining mehmon nusxasi | tg/chek |
| `chek-payment.tsx`, `chek-tickets.tsx` | To'lov tekshirish, Murojaatlar | chek-order |
| `chek-assistant.tsx` | chek order AI yordamchi | chek-order, tg/chek |
| `agent-team/*` (`agent-support-panel`, `overview-hero`, `team-diagram`, `agent-cards`, `activity-view`, `chat-view`, `tasks-view`, `plans-view`, `memory-view`, `health-view`, `settings-view`, `ui`) | Agent Support paneli | admin/agent |
| `pomodoro-timer.tsx` | Pomodoro | profile |
| `showcase-stage.tsx` | dekorativ 3D-CSS sahna | login, showcase, AuthGuard splash |
| `login-ticker.tsx` | login sahifasi marquee'si | login |
| `api-ui.tsx`, `api-command-palette.tsx`, `api-hero-infra.tsx` | Developer API sahifasi | `/api` |
| **Ishlatilmaydi (o'lik kod)**: `api-3d-hero.tsx`, `api-hero-3d.tsx`, `api-hero-r3f.tsx`, `api-hero-crystal.tsx`, `api-hero-silk.tsx`, `api-login-3d-orb.tsx`, `api-code-showcase.tsx`, `brand-logo.tsx`, `onboarding-card.tsx`, `page-hero.tsx`, `quick-actions.tsx` | three.js / R3F faqat shularda | hech qayerda import qilinmaydi (`xon-saroy-logo.tsx` ham deyarli; logo rasm sifatida `public/xon-saroy-logo.png`) |

`frontend/lib`: `api.ts` (E.4), `auth.ts` (E.5), `permissions.ts` (E.6), `preferences.ts` (accent + sevimlilar, `stripLocale`), `ui.ts` (global UI holati), `utils.ts` (`cn`, formatlash), `use-avatar.ts`, `use-reduced-motion.ts`, `login-sounds.ts` (vibratsiya), `api-snippet-gen.ts` (`/api` kod namunalari), `agent-team-api.ts` + `agent-team-types.ts` (Agent Support).

`frontend/public`: `banks/` (bank logolari), `3d/*.webp` (premium illyustratsiyalar), `404-1.mp4`, `404-2.mp4` (ruxsat yo'q ekrani), `xon-saroy-violet.png`, `xon-saroy-logo.png`, `sheets.png`, `xonpay.jpg` (ОплатыКв tab ikonkalari), `showcase-*.svg`, `chek-hero.svg`.

### E.12 Umumiy polling jadvali

| Nima | Interval | Joy |
|---|---|---|
| `GET /_deploy/status` | 3 s (hamma panel sahifalarida, ikki joyda bir xil kalit) | topbar, deploy-modal |
| `GET /sync/logs?limit=20` | 30 s (`sync:view` bo'lsa) | topbar; dashboard sync status |
| `GET /sync/logs?limit=200` | 10 s | admin/sync-logs |
| `GET /correction/stats` | 30 s | transactions (XATO badge) |
| `GET /transactions/reconcile/today` | 20 daqiqa + fokusda | check |
| `GET /crm-sverka/status` / `result` | 2 s / 3 s (faqat ishlayotganda) | check-crm |
| `GET /oplata-kv/last-sync-info` | 60 s | oplatykv |
| `GET /oplata-kv/bg-status` | 5 s (xatoda 10 s), cheklovsiz | oplatykv, sync-logs |
| `GET /sync/backfill/status` | 2 s (+ 4 s stall tekshiruvi) | transactions backfill; setup/accounts (2 s / 3 s) |
| `GET /categorization/run-all/status` | 2 s | transactions |
| `GET /kategoriya-agent/holat` | 3 s ishlayotganda, 20 s bo'sh | transactions |
| `GET /xonpay/sync/status`, `/match/status` | 3 s ishlayotganda, 30 s bo'sh | oplatykv/billing |
| `GET /bank-credentials/auth-issues` | 30 s | admin/login |
| `GET /agent/config`, `/agent/ai/status` | 30 s, 12 s | admin/agent |
| `agent-team/*` | 5–60 s (faqat faol ko'rinish) | admin/agent Support |
| `POST /agent/tg/list` yoki `GET /agent/xato-list` | 45 s (modal ochiq yoki tab yashirin bo'lsa o'tkaziladi) | xato-list |

### E.13 Xavfli joylar va tuzoqlar (frontend)

- **Klient tomonidagi kirish kodlari**: `transactions` (Qo'shimcha amallar, Schotchik gate), `admin/import` (`IMPORT_KOD`), `ai-perereboska-module` (Sozlamalar), `chek/sozlamalar-tab` (`CHEK_PASS`), `setup/credentials` (izoh va sarlavhalarda) — kod qiymati JS bundle'da ochiq. Server tomonda tekshiriladiganlari: TR Support (`/tr-support/unlock`), sverka Telegram (`/sverka-telegram/verify-password`), XATO tozalash (`/correction/clear`), kontragent truncate, bank parol avtomat (`/bank-pwd/*`). Kodni hujjatga yozma, "kirish kodi (env)" de.
- **Brauzerga ochiq keladigan sirlar**: `GET /sverka-telegram/bot-token` (to'liq token), `GET /chek/tg-config` va `/chek/hr-config` (bot tokeni va HR siri), `GET /api-explorer/forwarder` (forwarder siri), `GET /bank-credentials/:id/reveal-password` (manage). `/api` sahifasi API sirini sessionStorage'da ochiq saqlaydi va kod namunalariga qo'yadi; TR Support kodi sessionStorage'da.
- **Route-guard bo'shliqlari**: `/vznos`, `/chek-order`, `/profile` da qoida yo'q; `/admin/*` dagi ko'p tablar `users:view` ni talab qiladi; sidebar `ADMIN_PERMS` da `export:view`, `agent:view` yo'q; `setup` tablari filtrlanmaydi. Ko'p tugmalar (Billing'dagi truncate/cron, setup/banks tahriri, sync sozlamalari, import, Klient·XATO tasdiqlash) frontend'da ruxsat tekshiruvisiz — faqat backend himoya qiladi.
- **Qattiq rol tekshiruvi**: `admin/cleanup` `me.role === 'SUPERADMIN'` (permission emas).
- **Sessiya**: `hydrate()` har sahifa almashganda `/auth/me` chaqiradi va istalgan xatoda (timeout, deploy restart) sessiyani o'chiradi. `tg/chek` mehmon tokeni `xt_token` ni ustidan yozadi.
- **React-query kalit nomuvofiqligi**: `ai-perereboska-module.tsx` va `transactions/page.tsx::AddFromTxDialog` `['oplatakv']` ni invalidate qiladi, ОплатыКв jadvali esa `['oplata-kv']` — yangilanmaydi. `['accounts']` (dashboard) va `['bank-accounts']` (setup) ham alohida keshlar.
- **Vaqt zonasi**: `formatDate`/`formatDateTime` brauzer zonasida; ba'zi KPI'lar `toISOString()` (UTC) bilan sana hisoblaydi, ba'zilari +5 soat siljitadi — yarim tun atrofida kun farq qilishi mumkin (backend'dagi `tashkentKun()` qoidasi bilan bir xil muammo oilasi).
- **Soxta/o'lik ma'lumot**: transactions KPI sparkline'lari tasodifiy; profil "Login tarixi" qattiq yozilgan soxta sessiyalar; customers'da tahrir tugmasi ishlamaydi; three.js bog'liqliklari faqat ishlatilmaydigan komponentlarda.
- **Stall detection** faqat transactions backfill'da bor (va 0 da qotganini sezmaydi); ОплатыКв `bg-status` polling'ida timeout yo'q.
- **Hardcode sanalar**: Kategoriya agenti, FixMinfin, Taminot dialoglarida default `2026-05-01`; Billing default oralig'i 2024 yildagi qat'iy sanadan.
- **i18n to'liq emas**: yangi modullar matni komponent ichida o'zbekcha/ruscha; `xato-list` va `/chek` o'z tizimiga ega.

### E.14 Tez-tez qilinadigan o'zgarishlar — qayerda (frontend)

| Vazifa | Fayl(lar) |
|---|---|
| Yangi panel sahifasi | `app/[locale]/(panel)/<yo'l>/page.tsx` + `components/route-guard.tsx::ROUTE_PERMISSIONS` (+ kerak bo'lsa `LANDING_ROUTES`) + menyu: `sidebar.tsx::NAV` yoki `admin/layout.tsx::TABS` yoki `transactions-tabs.tsx` yoki `oplatykv/layout.tsx::TABS` |
| Yangi ruxsat | `frontend/lib/permissions.ts::PERMS` + backend `permissions.ts` + `seed.ts::ALL_PERMS` |
| Yangi matn (3 til) | `i18n/messages/{uz,ru,en}.json` yoki fragment + `node scripts/i18n-merge.mjs` |
| API manzili | `NEXT_PUBLIC_API_URL` (build vaqtida) — `lib/api.ts` |
| Yangi accent rang | `lib/preferences.ts::ACCENTS` + `app/globals.css` dagi `html[data-accent=...]` (light va dark) |
| Bank logosi | `public/banks/*` + `components/bank-logo.tsx::BANK_LOGOS` / `BANK_LOGO_BG` / `BANK_GRADIENTS` |
| Dashboard widget | `dashboard/page.tsx` (+ `dashboard:*` ruxsat, `WidgetErrorBoundary` bilan o'rash tavsiya) |
| Deploy bosqich nomlari | `i18n/messages/*.json::deploy.phases` (`deploy-modal.tsx` prefiks bo'yicha moslaydi) |
| Push'dan oldin | `frontend` da `npm run build` (TS xatosi build'ni to'xtatadi, ESLint e'tiborsiz) |

## F. Agentlar jamoasi va TR Support boti

Manba: `agents/` papkasi (kod holati 2026-10-09, oxirgi commit `ae32d41`). Ziddiyat bo'lsa kod to'g'ri; `agents/knowledge/agentlar.md` va `imkoniyatlar.md` 2026-09-28..30 holatini yozadi va keyingi TR Support modullarini (`tuzatish`, `ariza`, `eksport`, `malumot`, `perebroska`, `tarix`) to'liq qamramaydi.
Sirlar bu bo'limda yo'q: faqat env NOMLARI. Egasi Telegram ID si kodda (`contract.py::EGASI_TG_ID`) qattiq yozilgan, qiymati bu yerga ko'chirilmagan.

### F.0 Umumiy manzara

- Egasi bitta Telegram bot (`contract.py::BOT_NOMI`, @TRanSupport_bot) bilan, faqat shaxsiy chatda gaplashadi. Boshqa odam, guruh, kanal: bot to'liq jim.
- Bot ortida 4 ta LLM agent: Leader (yagona ovoz), Support (kod REJAsi), Checker (diagnostika, to'lov tekshiruvi tahlili), Teacher (uzoq xotira). Hammasi `claude --print` CLI subprocess orqali (setup token), Anthropic SDK yoki API kalit yo'li YO'Q.
- Agentlarda Edit/Write yo'q. Kodni, xotirani va biznes amallarni faqat bot jarayoni (Python, aiogram 3) bajaradi: kod faqat egasi [Ha] bosgach (Support REJA), biznes amal faqat backend panel ko'prigi (`/api/agent-bridge/...`, loopback) orqali.
- "TR Support" = botning LLM'siz deterministik modullari: to'lovni tuzatish, XATO arizasi, eksport, hisob ma'lumoti, XATO fayli, AI Perebroska, eski tarixni yuklash. Leader faqat egasi matnini mashina qatoriga (`TUZATISH:`, `ARIZA:` ...) aylantiradi, qolganini bot qiladi.
- Bu tizim `backend/src/leader/` va `backend/agents/` (v1 Leader, NestJS, Messages API) bilan BOG'LIQ EMAS. Panel Admin dagi "AI Agent" (XATO arizalari), sverka agenti, correction-bot ham alohida (backend ichida). Web panelda "Agent Support" sub-tab bor (`backend/src/agent-team/`): `agents` sxemasini o'qiydi, yagona yozuvi `kv_store` `agent_enabled_<nom>`; REJA tasdig'i faqat Telegram'da.

Oqim (qisqa):

```
Egasi (DM) -> leader_bot.on_text  [owner-only, navbat qulfi, albom yig'ish]
   -> LLM'siz handlerlar: xotira triggeri, ovoz/rasm/fayl, matnli tasdiq ("tasdiqlayman"/"yo'q"/"1")
   -> /buyruqlar: /start /status /health /reset /tolov /tuzat /eksport /hisob /xato /tarix
   -> aks holda Leader (runner -> claude --print) -> JSON {intent, delegate_to, task_for_agent, human_reply}
        |- mashina qatori (TARIX/PEREBROSKA/HISOB/XATO_FAYL/EKSPORT/ARIZA/TUZATISH) -> TR Support moduli
        |- delegate_to support|checker|teacher -> sub-agent -> (REJA preview | WRITE_MEMORY | Teacher uchun) -> Leader synth
        '- aks holda human_reply egasiga
Fon (bot jarayoni ichida): Facts 5 daq, Checker 4 soat, Teacher 22:30, va'da eslatmasi, heartbeat, tozalash, manba kuzatuvchi
```

Fayllar xaritasi:

| Fayl | Rol |
|---|---|
| `leader_bot.py` | aiogram bot, handlerlar, delegatsiya, synth, tugmalar, fon vazifalar, start |
| `runner.py` | CLI chaqiruvi, env oq ro'yxati, timeout, `agent_runs` |
| `leader_logic.py` | Leader JSON parse, delegat, xotira/va'da/yolg'on detektori, REACT, lotinlashtirish (sof) |
| `contract.py` | bot va promptlar shartnomasi: satrlar, regexlar, kv kalitlari, chegaralar |
| `config.py` | yo'llar, env o'qish, Settings, Toshkent vaqti, repo yo'li tekshiruvi |
| `db.py`, `db_migrations.py` | psycopg2 pool, `kv_store` yordamchilari, `agents` sxemasi DDL, tozalash |
| `history.py` | suhbat tarixi (kv + `agent_chat_log`), topshiriq quruvchilar, neytrallash |
| `memory_blocks.py` | `[WRITE_MEMORY]`, `Teacher uchun:`, xotira yozuvi, Teacher fon va tasdiq |
| `notify.py` | Outbox protokoli, bo'lish, HTML fallback, HttpOutbox, PrintOutbox |
| `reja.py` | Support REJA: parse, tekshiruv, preview, [Ha]/[Yo'q], qo'llash, commit, push, tiklash |
| `checker_worker.py` | 12 health tekshiruvi, `agent_health`, alert throttle, alert tahlili |
| `support_facts.py` | Facts JSON (`agents/state/support_facts.json`) yig'ish |
| `teacher_daily.py` | Teacher kunlik tahlili scheduler |
| `payment_check.py` | `/tolov` va Checker `payment_check` bloki (faqat o'qish) |
| `tuzatish.py` | TR Support tahrir + umumiy ko'prik funksiyasi `_koprik` va `_say` |
| `ariza.py`, `eksport.py`, `malumot.py`, `perebroska.py`, `tarix.py` | TR Support modullari |
| `bin/bash_guard.py` | Bash PreToolUse hook |
| `claude_settings.json` | CLI asbob siyosati (`--settings`) |
| `deploy/` | systemd unit va `install.sh` |
| `leader.md`, `support.md`, `checker.md`, `teacher.md` | promptlar |
| `memory/`, `knowledge/` | xotira va bilim bazasi |
| `tests/` | unit testlar (stdlib, DB/tarmoq/aiogram'siz) |
| `ORNATISH.md`, `requirements.txt` | server o'rnatish yo'riqnomasi, `aiogram>=3.4,<4`, `psycopg2-binary>=2.9,<3` |

### F.1 config.py — yo'llar, env, vaqt, yo'l himoyasi

Maqsad: yagona sozlama manbai (faqat stdlib).

- Yo'llar (`REPO` = `agents/` ning ota papkasi, testda `AGENTS_REPO` bilan almashadi): `STATE_DIR = agents/state`, `MEMORY_DIR`, `DAILY_DIR = agents/memory/daily`, `KNOWLEDGE_DIR`, `UPLOADS_DIR = static/tg_uploads`, `FACTS_PATH = agents/state/support_facts.json`, `DEPLOY_LOG_JSON = agents/state/deploy_log.json`, `SUP_ORIG_DIR = agents/state/sup_orig`, `CLI_TMP_DIR = agents/state/cli`, `TSC_TMP_DIR = agents/state/tsc`, `SETTINGS_FILE = agents/claude_settings.json`.
- `ensure_dirs`: runtime papkalarni yaratadi va `static/tg_uploads/.gitignore` (`*`) yozadi. Bot bir marta ishga tushmaguncha bu papka gitdan yopilmagan.
- Env: `env(name)` avval `os.environ`, keyin `AGENTS_ENV_FILE` (default `backend/.env`). Fayl o'z parseri (`parse_env_text`) bilan o'qiladi va `os.environ` ga YOZILMAYDI: backend sirlari bot va bola jarayonlar env'iga o'tmaydi. Shu sabab systemd unit'da `EnvironmentFile` bo'lmasligi shart.
- `Settings` (frozen dataclass, `__repr__` sirlarni `***(uzunlik)` bilan maskalaydi): `bot_token` (`LEADER_BOT_TOKEN`), `owner_id` (`LEADER_TG_ID`, bo'sh bo'lsa kontraktdagi qiymat), `setup_token` (`ANTHROPIC_SETUP_TOKEN`), `use_cli` (`AGENTS_USE_CLI == "1"`), `claude_cmd` (`CLAUDE_CMD`, default `claude`), `model_strong`/`model_fast` (`AGENTS_MODEL_STRONG`/`AGENTS_MODEL_FAST`, default `claude-opus-5-5` / `claude-sonnet-5`), `daily_cap` (`AGENT_DAILY_CAP`, 200), `timeout_s` (`AGENT_TIMEOUT_S`, 180, min 10), `agent_os_user` (`AGENT_OS_USER`), DB zanjiri `AGENTS_FACTS_DB_URL` -> `AGENTS_DB_URL` -> `DATABASE_URL` (`clean_db_url` Prisma `?schema=` kabi parametrlarni olib tashlaydi), `ANTHROPIC_BASE_URL`, `DEPLOY_LOCK` (default `/var/run/xon-tranzactions-deploy.lock`), `DEPLOY_LOG` (default `/var/log/xon-tranzactions/deploy.log`).
- `agent_timeout_s(agent)`: `AGENT_TIMEOUT_S_<AGENT>` -> `AGENT_TIMEOUT_S` -> 180.
- `config_errors` (botni to'xtatadi, `SystemExit(2)`): token yo'q; `LEADER_TG_ID` kontraktdagi egasi ID siga teng emas; `AGENTS_USE_CLI` 1 emas; setup token yo'q.
- `config_warnings`: `AGENT_OS_USER` bo'sh; root + bo'sh `AGENT_OS_USER`; v1 to'qnashuv; DB URL yo'q; `ANTHROPIC_API_KEY` bot jarayoni env'ida (agentga baribir berilmaydi).
- `v1_leader_conflict`: `backend/.env` da `LEADER_ENABLED != 0`, `LEADER_OWNER_TG_IDS` bor va `LEADER_BOT_TOKEN` shu bot tokeniga teng bo'lsa True: bot pollingni boshlamaydi (aks holda Telegram 409, xabarlar ikki botga bo'linadi). Yechim (egasi qarori): `LEADER_ENABLED=0`.
- Vaqt: Toshkent = UTC+5, yozgi vaqtsiz (`TZ_LOCAL`, tzdata kerak emas). `now_utc`, `now_local`, `today_local`, `local_day_bounds_utc(d)`, `local_window_utc(d, h1, h2)` (Teacher oynalari), `fmt_local`, `iso_utc`, `parse_iso` (tz'siz = UTC), `now_line()` -> `[HOZIRGI VAQT (Toshkent): YYYY-MM-DD HH:MM — <kun>]`, `seconds_until_local`.
- `safe_repo_path(p)` (REJA va yozishdan oldin): bo'sh, NUL, `\`, absolyut, `~`, `-` bilan boshlanish, disk harfi, `..`, `.env` bilan boshlanuvchi istalgan komponent (sabab `env`), himoya komponentlari (`.git`, `.claude`, `venv`, `.venv`, `node_modules`, `__pycache__`) va prefikslari (`agents/state`, `static/tg_uploads`, `agents/claude_settings.json`, `agents/memory/learned.md`, `agents/memory/leader-runtime.md`, `agents/memory/daily`) rad; realpath repo tashqarisiga chiqsa rad. `SafePath(ok, reason, rel, abs)`.
- `is_sensitive(rel)`: `contract.py::SEZGIR_PREFIKSLAR` prefiksi (rad emas, REJA xavfi majburan `yuqori`).

### F.2 contract.py — bot va promptlar shartnomasi

Maqsad: promptlar (`*.md`) va kod bir xil satrlarni ishlatsin. Qoida: bu yerdagi satr o'zgarsa promptdagi jufti ham SHU commitda o'zgaradi (testlar `PromptShartnomaTest` tekshiradi). Guruhlar:

1. Loyiha qiymatlari: `LOYIHA`, `EGASI_MUROJAAT = "shefim"`, `EGASI_TG_ID`, `BOT_NOMI`, `BOT_SERVIS = xon-tranzactions-leader`, `REPO_YOLI = /var/www/xon_tranzactions`, `BRANCH = main`, `SHAHAR`, `DB_SCHEMA = agents`.
2. Agentlar: `AGENTS` (4), `DELEGATE_AGENTS` (support, checker, teacher), `LEADER_JSON_KEYS` (intent, delegate_to, task_for_agent, human_reply), `INTENTS` (13 ta: `diagnose fix check remember just_answer payment_check tx_edit xato_ariza eksport hisob xato_fayl perebroska tarix`), `DELEG_HUMAN_REPLY = "Qabul qildim."`.
3. Runner: `DISALLOWED_TOOLS` (leader, teacher: `Bash Edit Write NotebookEdit WebFetch WebSearch`; support, checker: `Edit Write NotebookEdit WebFetch WebSearch`), env oq ro'yxati, `MEMORY_FILES` va chegaralari, `GIT_LOG_ARGS`, `ARGV_MAX_BYTES = 120000`, `RATE_LIMIT_RE`, `RUN_*` statuslari (`ok empty error timeout disabled capped rate_limited no_prompt bad_name`).
4. SISTEMA shablonlari (`SIS_*`) va kanonik sabablar: `RAD_*` (preview rad), `BAJ_*` (ijro rad), `CHQ_*` (chaqirilmadi), `XATO_*`, `TW_RAD_*`. `sistema(tpl, **f)` dinamik qismni `clean_dynamic` bilan tozalaydi, kanonik sababga tegmaydi.
5. Topshiriq prefikslari: `FORWARD_QATOR`, `RASM_QATOR_TPL` / `PDF_QATOR_TPL` / `WORD_QATOR_TPL` (`fayl_qatori` kengaytma bo'yicha tanlaydi; Word "o'qib bo'lmaydi" deyiladi), `HOZIRGI_VAQT_TPL`, `MUHIM_KONTEKST_TPL` (1000 belgi), `OXIRGI_SUHBAT_*`, tarix prefikslari `SHEFIM: `, `SHEFIM (FORWARD): `, `MEN (LEADER): `, soxtalikni buzish regexlari, synth matnlari.
6. Checker: `CHECKER_BLOK_BOSH/OXIR`, `CHECKER_QATOR_TPL`, start 45 s, interval 4 soat, throttle 1 soat, `CHECKER_JIM_ENV = AGENTS_CHECKER_JIM`, default jim `("sverka",)`.
7. Teacher: rejim sarlavhalari (`KUNLIK`, `MINI`, `YAKUNIY`, `FON`), oynalar, 22:30, lease 20 daq, 30000 belgi chegarasi, learned.md ga kuniga 2 blok, `TEACHER_UCHUN_RE` (o'zgarmas), `WRITE_MEMORY_RE` va yo'l/rejim regexlari.
8. Xotira triggeri: `XOTIRA_TRIGGERS` (`eslab qol`, `yodda tut`, `yodda saqla`, `xotiraga yoz`) faqat xabar boshida, keyingi harf bo'lmasa (`yodda tutgin` trigger emas).
9. Va'da: `VADA_TRIGGERS` (17 so'z, substring), default 2 soat, `ertaga` 12 soat, `N daqiqa/soat`, eslatma 25 daq oralig'ida, 3 marta.
10. Yolg'on detektori: `YOLGON_SOZLAR` (7 so'z), `YOLGON_ALMASHTIRISH_TPL`.
11. Support REJA: `REQUEST_APPROVAL_RE`, `PLAN_KEYS`, marker regexlari, `RISK_VALUES`, `PAYLOAD_MAX = 60000`, `PREVIEW_EDITS = 5`, `PREVIEW_SNIPPET = 280`, `APPROVAL_TTL_S = 600`, commit prefiksi `feat(support): ` (60 belgi), `BLOKSIZ_SOZLAR`, `HIMOYA_*`, `SEZGIR_PREFIKSLAR` (hamma `agents/*.py`, `agents/bin`, `agents/deploy`, `requirements.txt`, `.gitignore`, `scripts/deploy.sh`, `scripts/systemd`, `scripts/nginx`, `backend/src/auth`, `backend/src/agent-bridge`, `backend/src/tr-support`, `backend/prisma/schema.prisma`), `SEZGIR_RE` (yangi `agents/*.py`, ildiz `*.py`, `<papka>/__init__.py`: stdlib modulini soyalash xavfi), `TSC_LOYIHALAR`, timeoutlar (tsc 300, py_compile 60, git 120).
12. Tugmalar va kv: `CB_*` prefikslari va `KV_*` kalitlari (F.7 jadvali), `SUP_EXEC_LEASE_S = 900`, `DEPLOY_LOCK_WAIT_S = 900`.
13. Telegram: `TELEGRAM_LIMIT = 4000`, `ACK_MATN`, `ACK_REAKSIYA` (ko'z belgisi), `REACT_MAP` (9 nom -> standart reaksiya), `UPLOAD_PREFIX = leader_bot_`, rasm 7 kun, kutish 300 s, bir turnda 3 ta; egasiga LLM'siz `MSG_*` matnlari (kirill va emoji yo'q, test tekshiradi).
14. Facts: 5 umumiy + 16 loyiha kaliti, 15 daqiqalik kesh kalitlari (`xato`, `oplatykv_sync`), servislar ro'yxati, interval 300 s, eski chegarasi 900 s, statement timeout 15 s.
15. Saqlash muddati `RETENTION_DAYS`: chat_log 30, runs 90, health 30, alert_log 30, tasks 90, memory 180 kun.
16. `SIR_NAQSHLARI`: Anthropic kaliti, Telegram bot tokeni, forwarder siri shakli, `password/secret/token/api_key = ...`, URL ichidagi login:parol, PEM, GitHub va AWS kalit shakllari. `has_secret` shu bilan.
17. Kirill -> lotin jadvali (`KIRILL_LOTIN`, `<code>`/`<pre>` ichiga qo'llanmaydi), apostrof variantlari.
18. To'lov tekshiruvi (`TOLOV_*`): komponentlar tartibi, chegaralar, farq kodlari va tuzatish maslahatlari, panel ko'prigi yo'llari va env nomlari, XonPay qoidalari, oddiy til shablonlari, `/tolov` matnlari (F.13).
19. TR Support: `TUZATISH_RE`, `ARIZA_RE`, `EKSPORT_RE`, `HISOB_RE`, `XATO_FAYL_RE`, `TARIX_RE`, `PEREBROSKA_RE`, ko'prik yo'llari, timeoutlar, harf qoidasi matnlari, `TASDIQ_HA_RE` / `TASDIQ_YOQ_RE` (40 belgigacha), `TASDIQ_YOZING`, `TANLOV_RE`, `MSG_TASDIQ_QAYSI`, foydalanish matnlari.

Yordamchilar: `norm_apostrophe`, `clean_dynamic` (yangi qatorlar bo'shliqqa, `[` `]` -> `(` `)`), `short`, `sistema`, `sistema_line`, `has_secret`, `kv_key` (64 belgi tekshiruvi).

### F.3 leader_bot.py — Telegram qobig'i

Ishga tushirish: `python -m agents.leader_bot` (systemd `xon-tranzactions-leader`, `Restart=always`). aiogram 3 long polling, `allowed_updates = message, callback_query`, `handle_as_tasks=True` (albom kutishi pollingni to'xtatmaydi).

Start ketma-ketligi (`run`): logging -> `config_errors` (bo'lsa exit 2) -> `v1_leader_conflict` (bo'lsa exit 2) -> `runner.require_cli_mode` -> ogohlantirishlar logga -> `ensure_dirs` -> `db_migrations.ensure_tables` (DB yiqilsa bot cheklangan holda ishlaydi) -> yopilmay qolgan `agent_tasks` (`in_progress`) `failed`/`restart` qilinadi -> `Bot(token)` -> `AiogramOutbox(bot, owner_id)` -> `reja.recover_interrupted()` -> `runner.probe_cli()` -> ixtiyoriy modullarni oldindan yuklash -> `delete_webhook(drop_pending_updates=False)` -> fon vazifalar -> egasiga restart/CLI yo'q/yuklanmagan modul xabarlari -> polling.

Ixtiyoriy modullar `_mod(name)` bilan kerak paytda import qilinadi: biri buzilsa bot yiqilmaydi, `"Shefim, <modul> moduli yuklanmadi..."` deydi. Import xatosi jarayon oxirigacha keshlanadi (qayta urinish yo'q, restart kerak).

Egasi tekshiruvi (har handlerda): `_is_owner_private` = chat turi `private` VA `from_user.id == owner_id`. Callback'da ham: `from_user.id` egasi, xabar bor, chat `private`; aks holda jim `answer()`. Begona xabar faqat debug logga.

`on_text` (umumiy xabar handleri):
- Albom (`media_group_id`): birinchi qism `_album_collect` da 1.5 s jimlik (ko'pi bilan 6 s) kutadi, qolgan qismlar ro'yxatga qo'shiladi; yig'ilgan albom 600 s eslab qolinadi, kechikkan qism e'tiborsiz. Izohli qism `_primary`.
- Forward belgisi (`forward_origin`, `forward_from`, `forward_from_chat`, `forward_sender_name`, `forward_date`, `is_automatic_forward`) hamma handlerdan oldin aniqlanadi.
- Navbat: egasi xabarlari `asyncio.Lock` bilan ketma-ket. Qulf band bo'lsa darhol ko'z reaksiyasi qo'yiladi. Oxirida Leader tanlagan reaksiya qo'yiladi yoki ack reaksiyasi olib tashlanadi.

`_handle_owner_message` tartibi:
1. Xotira triggeri (forward emas): `memory_blocks.write_runtime_memory` -> `leader-runtime.md`, LLM'siz. Sirga o'xshash mazmun yozilmaydi.
2. Matn `_mask_secrets` (`SIR_NAQSHLARI`) bilan maskalanadi.
3. Ovoz (`voice`, `video_note`, `audio`): `MSG_OVOZ_YOQ`, STT yo'q.
4. Fayllar `_collect_images`: rasm (photo yoki `image/*` hujjat: jpg, png, webp, gif) va hujjat (pdf, doc, docx) `static/tg_uploads/leader_bot_<16 hex>.<ext>` ga 0644 bilan yuklanadi (agent foydalanuvchisi o'qiy olsin). 20 MB chegarasi, bir turnda 3 ta, ortig'i haqida xabar.
5. Matnli tasdiq `_matn_tasdiq` (forward emas, faylsiz, matn bor): avval eksport ro'yxatidan raqam (`TANLOV_RE`, masalan `1`), keyin `tuzatish.matn_qaror` ("tasdiqlayman"/"ha"/"yo'q"...). Kutilayotgan so'rovlar `tuzatish`, `ariza`, `eksport` modullaridan `kutilayotgan()` bilan yig'iladi; reply qilingan tasdiq xabari (`payload.mid`) tanlaydi, reply bo'lmasa faqat bitta kutilayotgan bo'lsa. Bir nechta bo'lsa `MSG_TASDIQ_QAYSI`. Support REJA va Teacher yozuvi bu yo'lga KIRMAYDI (ular faqat tugma).
6. Izohsiz fayl: `kv_store['recent_photo']` ga 5 daqiqaga saqlanadi (`paths`, `uids` = Telegram `file_unique_id`, `fwd`), javob `MSG_RASM_QABUL` (PDF uchun ham "Rasmni oldim"). Reply qilingan rasm ham shu ro'yxatga, qayta yuklanmasdan (uid bo'yicha).
7. Boshqa tur (sticker, video, animatsiya, joylashuv, kontakt, so'rovnoma...): `_MSG_TUR_YOQ`; xizmat xabarlari jim.
8. Kutayotgan fayllar (`_recent_photo_take`) + reply qilingan fayl + egasining fayli birlashadi (oxirgi 3 tasi). Ack: ko'z reaksiyasi + `"Ko'rib chiqyapman, shefim..."` (reply), oxirida o'chiriladi. Keyin `_leader_turn`.

`_leader_turn`:
- Topshiriq `history.build_leader_task` (tarixga qo'shishdan OLDIN, aks holda takrorlanadi), reply qilingan xabar matni MUHIM KONTEKST bo'ladi.
- `runner.run_agent_async("leader", ..., complexity strong, source dm)`. Xato bo'lsa SISTEMA + `MSG_LEADER_XATO_TPL`.
- `parse_leader_response`; JSON buzuq va xom matn JSON'ga o'xshasa egasiga xom matn chiqmaydi ("javob formati buzuq").
- `_clean_reply`: Leader'ning `[WRITE_MEMORY]` bloki hech qachon qo'llanmaydi (SISTEMA RAD), `Teacher uchun:` qatori olinadi, `[REACT:nom]` ajratiladi.
- Mashina qatori kancalari (`task_for_agent` + `human_reply` birga qidiriladi, birinchi topilgani ishlaydi, delegatsiyadan USTUN): `TARIX:` -> `tarix.handle`; `PEREBROSKA:` -> `perebroska.handle(rasmlar=...)`; `HISOB:` yoki `XATO_FAYL:` -> `malumot.handle`; `EKSPORT:` -> `eksport.handle`; `ARIZA:` -> `ariza.handle(rasmlar=...)`; `TUZATISH:` -> `tuzatish.handle`. Leader `human_reply` i bu holatda ko'rsatilmaydi.
- Delegat oq ro'yxati: `delegate_to` support/checker/teacher emas bo'lsa SISTEMA `CHAQIRILMADI — noma'lum agent`.
- Delegatsiyada `human_reply` ko'rsatilmaydi, tarixga `Qabul qildim.` yoziladi, `delegate()` chaqiriladi.
- Delegatsiyasiz: `normalize_latin(human_reply)` -> tarix -> `_save_promise` -> egasiga reply.

`delegate` / `_delegate_body`:
- `agent_tasks` ga `in_progress` qatori (source `dm`), oxirida `done`/`failed`.
- Topshiriq `history.neutralize` qilinadi. Checker uchun: to'lov tekshiruvi bo'lsa (`intent == payment_check` yoki topshiriqda `TOLOV:` qatori, `_is_tolov`) `payment_check.prefetch` + `format_block` bloki (`asyncio.wait_for` 120 s, yiqilsa stub); aks holda `checker_worker.run_all_checks_once` + `format_block`. Ikki blok birga kelmaydi.
- Sub-agent `build_sub_task` bilan (source `deleg`).
- Support javobidan avval `[REQUEST_APPROVAL]` ajratiladi va `reja.offer_plan` (preview synth'dan OLDIN).
- `[WRITE_MEMORY]` faqat Teacher'dan: egasi xabari forward yoki forward xabarga reply bo'lsa `request_teacher_approval` (preview + [Ha]/[Yo'q]), aks holda darhol `apply_write_blocks`. Boshqa agent bloki RAD.
- Teacher bo'lmagan agentning `Teacher uchun:` qatorlari fon Teacher'ga (`_teacher_fon_seq`, bir vaqtda bitta, `_fon_lock`).
- Keyin: blokisiz REJA so'zlari bo'lsa (`has_blockless_trigger`) xom matn `REQUEST_APPROVAL blok yo'q` bilan, synth'siz; yolg'on so'zi va 0 blok qo'llangan bo'lsa `YOLGON_ALMASHTIRISH_TPL`; Teacher bloki qo'llangan bo'lsa "Ha shefim, yozib qo'ydim: ..."; aks holda SISTEMA `agent muvaffaqiyatli javob berdi` va `_synth`.
- `_synth`: Leader yana chaqiriladi (`build_synth_task`, source `synth`), faqat `human_reply` olinadi, va'da tekshiriladi, reaksiya synth'dagisi bilan almashadi.

Buyruqlar (hammasi LLM'siz, forward qilingan buyruq `on_text` ga oddiy matn bo'lib ketadi; ro'yxatga `~F.forward_origin` filtri bilan olingan):

| Buyruq | Nima qiladi |
|---|---|
| `/start` | salom matni |
| `/status` | bugungi `agent_runs` (agent x status), Facts yoshi (`updated_at`, 15 daqiqadan eski = eski), kutilayotgan tasdiqlar (faqat reja va xotira), ochiq va'dalar, oxirgi 3 xato/timeout, CLI bor-yo'q, yuklanmagan modullar |
| `/health` | `run_all_checks_once(record=False)`: 12 komponent qatori `<pre>` ichida, `agent_health` ga yozilmaydi |
| `/reset` | kv suhbat tarixi tozalanadi (`agent_chat_log` qoladi), `reja`, `memory_blocks`, `tuzatish`, `ariza`, `eksport` kutilayotgan tasdiqlari va `recent_photo` o'chiriladi. Ishlayotgan REJA ijrosi, va'dalar, `agent_tasks` ga tegmaydi |
| `/tolov <arg>` | `payment_check.tolov_savol`: faqat identifikator bo'lsa LLM'siz `format_owner` javobi (tarixga faqat `qisqa` qatori); identifikator + savol bo'lsa Checker'ga `payment_check` delegatsiyasi (owner qulfi ostida, Leader synth); identifikatorsiz matn Leader'ga oddiy xabar; bo'sh/yaroqsiz bo'lsa `MSG_TOLOV_FOYDALANISH` |
| `/tuzat <ID> [kalit=qiymat ...]` | `TUZATISH: tx=<ID> ...` qatoriga aylanib `tuzatish.handle` |
| `/eksport [nom]` | `EKSPORT: <nom>` -> `eksport.handle` |
| `/hisob <raqam>` | `HISOB: <raqam>` -> `malumot.handle` |
| `/xato [filtr]` | `XATO_FAYL: <filtr>` -> `malumot.handle` |
| `/tarix <dan> [gacha] [bank\|hisob]` yoki `/tarix holat` | `TARIX: ...` -> `tarix.handle` |

Boshqa har qanday `/buyruq` (`/help`, `/send` ...) Leader'ga oddiy matn. Guruhga yozish, odamga xabar yuborish, `/gid` yo'q. Diqqat: `/tuzat`, `/eksport`, `/hisob`, `/xato`, `/tarix` va savolsiz `/tolov` owner qulfini olmaydi (Leader turni bilan parallel ishlashi mumkin).

Tugmalar (`on_callback`): `sup_ok:`/`sup_no:` -> `reja.decide`; `tw_ok:`/`tw_no:` -> `memory_blocks.teacher_decision`; `tz_ok:`/`tz_no:`, `ar_ok:`/`ar_no:`, `ek_ok:`/`ek_no:`, `ek_t:<token>:<i>` -> tegishli modul. Token `^[0-9a-f]{6,32}$` bo'lmasa `MSG_MUDDAT_OTGAN`. 2026-10-01 dan TR Support xabarlarida tugma CHIQMAYDI, bu callback'lar faqat eski xabarlar uchun qolgan.

`AiogramOutbox`: faqat egasi chatiga; `TelegramRetryAfter` da ko'pi bilan 30 s kutib bir marta qayta; HTML parse xatosida o'sha bo'lak teglarsiz qayta; `send_document` (caption 1024, HTML fallback), `edit_keyboard`, `set_reaction` (xato jim), `delete`. Xato matnidagi bot tokeni `_safe_err` bilan maskalanadi.

Fon vazifalar (`_start_background`, har biri `_supervise` ichida: yiqilsa 30 s dan keyin qayta):

| Vazifa | Jadval | Iz |
|---|---|---|
| `_source_watcher` | har 15 s `agents/*.py` mtime | o'zgarsa `os._exit(0)`, systemd ko'taradi. REJA ijrosi (`sup_exec_active` lease) tugashini cheksiz kutadi, egasi suhbatini (owner qulfi) ko'pi bilan 900 s. `agents/bin`, `*.md` kuzatilmaydi |
| `_heartbeat` | 60 s | `kv_store['leader_heartbeat']` |
| `_reminder_scheduler` | tick 60 s | `agent_promises`: muddat o'tgan, oxirgi eslatmadan 25 daq o'tgan ochiq va'da; `reminder_count + 1`, 3 ga yetsa `closed` (jim). Matn `VADA_ESLATMA_TPL` |
| `_cleanup_scheduler` | startda va 24 soat | `db_migrations.cleanup_old`, `tg_uploads` 7 kundan eski `leader_bot_*`, `agents/state/cli/sp_*` 24 soatdan eski, `kv['cleanup_last']` |
| `support_facts.facts_scheduler` | darhol, keyin 300 s | Facts fayli |
| `checker_worker.checker_scheduler` | 45 s, keyin 4 soat | `kv['checker:last_full_run']` |
| `teacher_daily.teacher_daily_scheduler` | tick 60 s, 22:30 | `kv['teacher_daily_last_run']` |

`_save_promise`: Leader egasiga ketgan javobi (oddiy va synth) `detect_promise` dan o'tsa `agent_promises` ga (`due_at`, matn 500, trigger). TR Support modullari matni tekshirilmaydi.

### F.4 leader_logic.py — Leader javobi (sof funksiyalar)

- `parse_leader_response(raw)`: 1) ```` ```json {...} ``` ````, 2) birinchi `{` .. oxirgi `}`, `json.loads(strict=False)`; bo'lmasa `_lenient_fields` (qochirilmagan qo'shtirnoqli buzuq JSON'dan satr maydonlarini ajratadi); bo'lmasa `human_reply = xom matn`, `parse_error = True`. Natijada 4 kalit doim bor; `task_for_agent` `null`/`none`/`""` bo'lsa None.
- `looks_like_json`: `{` yoki ```` ``` ```` bilan boshlansa yoki `"human_reply"`/`"delegate_to"` bo'lsa True (bunday xom matn egasiga chiqmaydi).
- `normalize_delegate`: None/null/none/"" -> None, aks holda kichik harf.
- `detect_memory_command`: `XOTIRA_RE` (faqat bosh, mazmun bo'sh bo'lsa None).
- `detect_promise`: apostrof normallashtiriladi, iqtibos («...», "...") ichi olib tashlanadi; matnda `va'da` so'zi bo'lsa None (2026-10-01 tuzatish: eslatmaga javob yangi va'da yaratib zanjir hosil qilardi); trigger substring; muddat `N daqiqa/daq/minut/soat`, `ertaga` 12 soat, default 2 soat; 60 s .. 7 kun oralig'iga qisiladi.
- `is_lie(text, applied)`: `applied == 0` va bloklar (`REQUEST_APPROVAL`, `WRITE_MEMORY`), `Teacher uchun:` qatorlari, kod bo'laklari va bitta backtick ichi olib tashlangan matnda 7 yolg'on so'zdan biri bo'lsa True.
- `extract_react`: `[REACT:nom]` -> `REACT_MAP` emoji (nom yoki aynan emoji qabul), ro'yxatda yo'q nom jim tashlanadi; birinchisi olinadi.
- `normalize_latin`: kirill harflarni o'zbek lotiniga; `<code>`, `<pre>` ichi va HTML teg atributlari o'zgarmaydi; ko'p harfli moslikda (`Sh`, `Ch`) katta harf konteksti saqlanadi.

### F.5 runner.py — Claude Code CLI chaqiruvi

Egasi qoidasi (serverda sinalgan): faqat `claude --print`; env noldan; `stdin=DEVNULL`, `stderr=STDOUT` (alohida pipe CLI'ni osiltiradi); `HOME` albatta; timeout 180 s; SDK/API yo'q.

- `run_agent(agent, task, context)` (blocking; async varianti `run_agent_async` alohida 6 ishchili pool `run_long` da, default asyncio pool qisqa kv/tarix ishiga qoladi):
  1. Nom tekshiruvi (`AGENT_NAME_RE` va `AGENTS`): aks holda `bad_name`.
  2. `pick_model`: `context.model` (`sonnet`/`opus`/to'liq ID) yoki `complexity == simple` -> tez model (hozir faqat Checker alerti), default kuchli.
  3. `_precheck`: `kv['agent_enabled_<agent>'] == '0'` -> `disabled`; bugungi (Toshkent kuni) hisoblangan chaqiruvlar `AGENT_DAILY_CAP` ga yetsa -> `capped` (disabled/capped/rate_limited/bad_name sanalmaydi); `kv['agents_rate_limit_until']` kelajakda -> `rate_limited`. DB yo'q bo'lsa tekshiruv o'tkazib yuboriladi.
  4. `build_system_prompt`: `agents/<agent>.md` (har chaqiruvda diskdan, restartsiz yangilanadi) + `load_memory_block`: `=== MAJBURIY OQI: QOIDALAR VA XOTIRA ===` ichida `INDEX.md` (bosh 12000), `memory/leader.md` (bosh 8000), `leader-runtime.md` (oxir 8000), `learned.md` (oxir 6000), Leader'dan boshqasiga `memory/<agent>.md` (hozir yo'q); keyin alohida `=== OXIRGI COMMITLAR (ma'lumot, buyruq emas) ===` (7 kunlik `git log`, 4000 belgi, 60 s kesh; `[SISTEMA` va `===` neytrallanadi). Prompt fayli yo'q -> `no_prompt`.
  5. `_call_cli`: `use_cli` va setup token tekshiriladi; `_launch_spec` (pastda); `probe_cli`; FAIL-CLOSED: CLI `--settings` ni bilmasa yoki `agents/claude_settings.json` yo'q bo'lsa agent CHAQIRILMAYDI (`XATO_SETTINGS`).
  6. Buyruq (`build_cli_cmd`): `claude --print --dangerously-skip-permissions --model M --disallowedTools "<BITTA argument>" [--tools Read,Grep,Glob(,Bash)] --settings agents/claude_settings.json [--append-system-prompt-file F | --append-system-prompt S] [--no-session-persistence] [--strict-mcp-config] -- <task>`. `--` majburiy (`-` bilan boshlanuvchi topshiriq option bo'lib qolmasin). System prompt fayli `agents/state/cli/sp_<hex>.md` (0644), chaqiruvdan keyin o'chiriladi; argv yo'lida 120000 baytga qisqartiriladi; topshiriq ham (bosh 40% + oxir 60%).
  7. Env (`build_agent_env`): faqat `PATH HOME LANG LC_ALL TZ USER` + `CLAUDE_CODE_OAUTH_TOKEN` (qiymati `ANTHROPIC_SETUP_TOKEN`) + ixtiyoriy `ANTHROPIC_BASE_URL`. `ANTHROPIC_API_KEY` majburan olib tashlanadi (ikki auth birga bo'lsa CLI 60-180 s osiladi). `CLAUDE_CMD` absolyut bo'lsa uning papkasi PATH boshiga (node shebang).
  8. `_spawn`: `start_new_session=True`; timeoutda jarayon guruhiga SIGTERM, 5 s keyin SIGKILL, status `timeout` (javob butunlay yo'qoladi); exit != 0 -> `error` (`exit N`, sudo xatosi, CLI topilmadi); chiqishda `429`/`rate limit` bo'lsa 60 s pauza (`kv['agents_rate_limit_until']`); bo'sh chiqish -> `empty`.
  9. `_log_run` -> `agents.agent_runs` (agent, model, status, source, duration_ms, returncode, task_preview 500 belgi (OXIRGI SUHBAT blokisiz), response_preview, error), sirlar maskalangan.
- `_launch_spec` (OS foydalanuvchisi): `AGENT_OS_USER` bo'sh va bot root -> CLI chaqirilmaydi (`root ostida bypass rejimi ishlamaydi, AGENT_OS_USER kerak`); bot root va foydalanuvchi bor -> Popen `user/group/extra_groups=[]` (sudo'siz); foydalanuvchi uid 0 -> rad; bot root emas -> `sudo -n -H -u <user> --` (sudoers `env_keep` kerak). Serverda bot root, agent CLI `xonagent` ostida.
- `probe_cli`: API'ga bormay flaglarni tekshiradi (`--version`, keyin `--print --settings <yo'q fayl> -- x` "unknown option" bermasa flag bor); natija keshlanadi, CLI topilmasa 60 s dan keyin qayta.
- `sistema_for(res)`: status -> SISTEMA matni (`muvaffaqiyatli`, `bo'sh javob`, `CHAQIRILMADI — <sabab>`, `XATOGA UCHRADI: <xato>`).
- Qo'lda: `python3 -m agents.runner --probe`; `python3 -m agents.runner support "<topshiriq>"`.

### F.6 history.py — tarix va topshiriq shakllari

- Holat Python'da emas: `kv_store['leader_chat_history']` (JSON, oxirgi 20 ta, har biri 2000 belgi), bitta tranzaksiyada `FOR UPDATE` bilan; har yozuv `agents.agent_chat_log` ga ham (10000 belgi; Teacher kunlik manbasi, 30 kun).
- `add_history(role, text, is_forward)`: role faqat `owner`/`leader`; har matn `neutralize` (`[SISTEMA` -> `(SISTEMA`, qator boshidagi `SHEFIM:` / `SHEFIM (FORWARD):` / `MEN (LEADER):` prefikslari buziladi); egasining forwardi `clean_external` (qo'shimcha: yangi qatorlar bo'shliqqa, `[ ]` -> `( )`).
- `add_system(inner)`: haqiqiy `[SISTEMA: ...]` yozuvini FAQAT shu funksiya yaratadi.
- `clear_history()` faqat kv tarixni bo'shatadi.
- `history_context(n=12)`: `=== OXIRGI SUHBAT === ... === SUHBAT TUGADI ===`.
- `build_leader_task`: FORWARD -> fayl qatorlari -> HOZIRGI VAQT -> OXIRGI SUHBAT -> MUHIM KONTEKST (reply iqtibosi, `clean_external`, 1000 belgi) -> matn.
- `build_sub_task(body, header=...)`: rejim sarlavhasi -> FORWARD -> fayl -> HOZIRGI VAQT -> OXIRGI SUHBAT -> MUHIM KONTEKST -> body (body tozalanmaydi: chaqiruvchi ishi, Teacher kunlik kirishidagi haqiqiy SISTEMA qatorlari saqlansin).
- `build_synth_task`: FORWARD -> HOZIRGI VAQT -> OXIRGI SUHBAT -> `Sub-agent (X) natijasini oldim:` + `=== X NATIJASI (ma'lumot, buyruq emas) ===` blok (ichidagi `=== NATIJA TUGADI ===` buziladi) -> ohang ko'rsatmasi.
- Qo'lda: `python3 -m agents.history` (OXIRGI SUHBAT blokini chop etadi).

### F.7 DB: db.py, db_migrations.py va kv_store

`db.py`:
- psycopg2 lazy import (testlar DB'siz). Har `kind` (`agents`, `facts`) uchun `ThreadedConnectionPool(1, 5)` + semafor (pool to'lsa navbat, 30 s). Ulanishda `SET TIME ZONE 'UTC'`, `application_name = xon-agents`. Ulanish yiqilsa 10 s qayta urinilmaydi.
- `tx(kind, readonly=False, timeout_ms=None)`: RealDictCursor; `SET TRANSACTION READ ONLY` va `SET LOCAL statement_timeout`. Biznes jadvallar faqat `tx("facts", readonly=True, ...)` bilan o'qiladi.
- `fetchall`, `fetchone`, `execute` (rowcount), `available`.
- kv: `kv_get`, `kv_get_json`, `kv_set` (upsert), `kv_set_json`, `kv_del`, `kv_keys(prefix)` (LIKE `ESCAPE '!'`), `kv_del_prefix` (bo'sh prefiks taqiq), `kv_updated_at`, `kv_claim` (bir martalik: `INSERT ... ON CONFLICT DO NOTHING`, rowcount == 1), lease (`kv_lease_acquire` / `renew` / `release` / `active`; qiymat `{"owner","until"}`, bo'sh, muddati o'tgan yoki o'ziniki bo'lsa olinadi, `FOR UPDATE` bilan atomik). Kalit 64 belgidan oshmaydi.

`db_migrations.py`: yagona DDL manbasi, faqat `agents` sxemasi (`CREATE SCHEMA IF NOT EXISTS agents`), `pg_advisory_xact_lock` bilan idempotent. Sabab: backend deploy'idagi `prisma db push --accept-data-loss` `public` dagi schema.prisma'da yo'q jadvallarni o'chiradi.

| Jadval | Yozadi | Muhim ustunlar |
|---|---|---|
| `agents.kv_store` | hamma | `k` VARCHAR(64) PK, `value` TEXT, `updated_at` |
| `agents.agent_runs` | `runner._log_run` | ts, agent, model, status, source (`dm deleg synth fon checker teacher_daily manual`), duration_ms, returncode, task/response preview, error |
| `agents.agent_tasks` | `leader_bot._task_start/_finish`, `memory_blocks` (fon) | agent, intent, source (`dm`/`fon`), is_forward, task 2000, status `in_progress/done/failed`, result_preview, run_id |
| `agents.agent_memory` | `memory_blocks._record` | path, mode, source (`trigger deleg fon forward daily`), agent, content (maskalangan), result |
| `agents.agent_health` | `checker_worker._record` | component, status `ok/warn/error/unknown`, message, details JSON 4000 |
| `agents.agent_promises` | `leader_bot._save_promise` | due_at, text, trigger, status `open/closed`, reminder_count, last_reminded_at |
| `agents.agent_alert_log` | `checker_worker._record_alert` | component, status, message (throttle manbasi) |
| `agents.agent_chat_log` | `history._append` | ts, role `owner/leader/system`, text, is_forward |

`cleanup_old`: `RETENTION_DAYS` bo'yicha o'chiradi va faqat 1 kundan eski `sup_appr_*`, `tw_appr_*` kv kalitlarini. Qo'lda: `python3 -m agents.db_migrations [--cleanup]`.

kv_store kalitlari (to'liq):

| Kalit | Kim | Ma'nosi |
|---|---|---|
| `leader_chat_history` | history | oxirgi 20 xabar JSON |
| `agent_enabled_<agent>` | qo'lda, web Agent Support | `0` = agent o'chiq |
| `agents_rate_limit_until` | runner | 429 dan keyin pauza oxiri |
| `sup_appr_<token>` / `sup_run_<token>` / `sup_done_<token>` | reja | REJA payload (10 daq) / bir martalik claim / tugadi belgisi (restart tiklashi shu juftlikka qaraydi) |
| `sup_exec_lock`, `sup_exec_active` | reja | ijro lease'lari (900 s, 60 s da yangilanadi); `sup_exec_active` source watcher restartini to'xtatadi |
| `tw_appr_<token>` / `tw_run_<token>` | memory_blocks | Teacher yozuvi tasdig'i (token 12 hex) |
| `tz_appr_<token>` / `tz_run_<token>` | tuzatish | tahrir tasdig'i (16 hex) |
| `ar_appr_<token>` / `ar_run_<token>` | ariza | ariza tasdig'i |
| `ek_appr_<token>` / `ek_run_<token>` / `ek_roy_<token>` | eksport | eksport tasdig'i / claim / raqamlangan ro'yxat (20 tagacha ID) |
| `pb_yaratildi_<hex>` | perebroska | bir fayl - bir perebroska (fayl nomidagi 16 hex) |
| `tarix_oxirgi` | tarix | oxirgi bot yuklashi `{boshi, xabar, ts}` |
| `recent_photo` | leader_bot | izohsiz fayllar `{paths, uids, fwd, ts}` 5 daq |
| `leader_heartbeat` | leader_bot | 60 s heartbeat |
| `cleanup_last` | leader_bot | oxirgi tozalash |
| `checker:last_full_run`, `checker_lease` | checker_worker | oxirgi to'liq tick, lease 1800 s |
| `teacher_daily_last_run`, `teacher_daily_lease`, `teacher_daily_progress_<sana>` | teacher_daily | oxirgi kun (faqat oldinga siljiydi), lease 20 daq, bosqich nazorati |
| `facts_lease`, `facts_cache_<kalit>` | support_facts | yig'ish lease 240 s, 15 daqiqalik kesh (`xato`, `oplatykv_sync`) |
| `tolov_crm_<YYYYMMDD>` | payment_check | eski CRM GET kunlik hisoblagichi (Toshkent kuni) |

### F.8 Xotira: memory/, memory_blocks.py, Teacher

`agents/memory/` tuzilmasi:

| Fayl | Git | Yozuvchi | Promptga |
|---|---|---|---|
| `INDEX.md` | ha | faqat REJA | har chaqiruvda, bosh 12000 belgi (hozir 11946 belgi; test chegarasi 11950) |
| `leader.md` | ha | faqat REJA | bosh 8000 (hozir "Hozircha yo'q") |
| `leader-runtime.md` | yo'q (gitignore) | bot, xotira triggeri | oxirgi 8000 |
| `learned.md` | yo'q | faqat Teacher `[WRITE_MEMORY]` (bot qo'llaydi) | oxirgi 6000 |
| `daily/<YYYY-MM-DD>.md` | yo'q | Teacher kunlik tahlili | yo'q |

INDEX.md mazmuni: "Sen kimsan", asboblar chegarasi, ish tartibi (0-10), modullar xaritasi (`leader.md` 19-bo'lim bilan bir xil bo'lishi shart), eng muhim tuzoqlar (umumiy va loyihaga xos), "Qayerga qarash" (Facts kalitlari).

`memory_blocks.py`:
- `extract_write_blocks` (`path:`, `mode:`, `content:` dan keyingi hamma qator), `extract_teacher_lines` (`Teacher uchun: <tur> — <matn>`, tur `odam|qoida|qaror|vada|fakt`).
- Yo'l oq ro'yxati `check_memory_path`: `agents/memory/learned.md` faqat `append`; `agents/memory/daily/<BUGUN>.md` `append|write` (faqat tahlil kuni). Boshqasi `yo'l ruxsatsiz`. realpath `agents/memory` ichida bo'lishi shart (symlink orqali qochish yo'q).
- `apply_write_blocks(blocks, source, agent="teacher", max_learned)`: agent teacher emas -> RAD; sir (`has_secret`) -> RAD; kunlik rejimda learned.md ga 2 dan ortiq -> `kunlik 2 blok chegarasi`; yozish `fcntl.flock` (`agents/state/memory.lock`) + thread qulfi ostida; har natija `agent_memory` ga.
- `write_runtime_memory`: `## <sana> <vaqt> — shefim aytdi` sarlavhasi bilan append, sir bo'lsa yozilmaydi.
- `teacher_fon(manba, tur, matn)`: `qoida`/`qaror` turi va sir rad; `[TEACHER FON TOPSHIRIQ — manba: X]` sarlavhali Teacher chaqiruvi (source `fon`), blok bo'lsa HECH QACHON avtomat emas: `request_teacher_approval`.
- `request_teacher_approval`: tekshiruvdan o'tgan bloklar `tw_appr_<token>` ga, preview (blok 1500, jami 3000 belgi); preview qisqartirsa avval to'liq `.md` hujjat yuboriladi, hujjat ketmasa tasdiq so'ralmaydi. SISTEMA `teacher yozuvi tasdiq kutmoqda — hali YOZILMAGAN`.
- `teacher_decision`: TTL 600 s, `tw_run_` claim, [Yo'q] -> RAD, [Ha] -> `apply_write_blocks`.

Teacher kunlik (`teacher_daily.py`):
- Scheduler har 60 s: avval kecha bajarilmay qolgan bo'lsa darhol (faqat bitta kun orqaga), keyin bugun 22:30 dan keyin. Lease 20 daq (har urinishga yangi egasi), ko'pi bilan 3 urinish, bosqich nazorati `teacher_daily_progress_<sana>` (bloklar qo'llangach qayta qo'llanmaydi, hisobot bir marta), `teacher_daily_last_run` faqat hisobot yuborilgach.
- Kirish `collect_day`: shu Toshkent kunidagi `agent_chat_log` (`HH:MM SHEFIM: ...`, `MEN (LEADER)`, `[SISTEMA: ...]`) va `agent_runs` (`RUN <agent> <status> IN: ... OUT: ...`); birinchi qator bot sanagan statistika.
- 30000+ belgi: 4 ta MINI (00-06, 06-12, 12-18, 18-24; blok yo'q) + YAKUNIY; aks holda bitta KUNLIK (20000 dan uzun bo'lsa bosh 10000 + oxir 10000).
- Natija bloklari avtomat qo'llanadi (`source daily`, learned.md ga 2 tagacha), egasiga "Kunlik tahlil — <sana>" hisoboti. Kun bo'sh bo'lsa qisqa hisobot.
- Qo'lda: `python3 -m agents.teacher_daily [--date YYYY-MM-DD] [--dry-run] [--inputs-only]`.

### F.9 notify.py — yuborish

- `Outbox` protokoli: `send_text(text, html, keyboard, reply_to)`, `send_document`, `edit_keyboard`, `set_reaction`, `delete`. Xatolar yutiladi (None), jarayon yiqilmaydi; matnni o'zgartirmaydi (lotinlashtirish chaqiruvchi ishi).
- `split_text`: 4000 belgidan qator chegarasida bo'ladi; juda uzun qator bo'shliqda, teg yoki entity o'rtasida emas. `_balance_html`: bo'lak oxirida ochiq teglar yopiladi, keyingi bo'lakda qayta ochiladi. Keyboard oxirgi bo'lakka, reply birinchi bo'lakka.
- `plain_fallback`: "can't parse entities" bo'lsa teglar olib, entity'lar ochiladi. `safe_filename` (64 belgi).
- `HttpOutbox` (standalone skriptlar: `python3 -m agents.checker_worker --alert` va h.k.): urllib, `chat_id` kontraktdagi egasi ID siga teng bo'lmasa HECH NARSA yubormaydi; URL (token bilan) logga chiqmaydi.
- `PrintOutbox`: stdout va testlar. Qo'lda: `python3 -m agents.notify [--dry-run] [matn]`.

### F.10 Support REJA — reja.py

Maqsad: Support yozgan `[REQUEST_APPROVAL]` rejasini xavfsiz qo'llash. Agent QAYTA chaqirilmaydi, barcha git buyruqlari ro'yxat argumentlari bilan (`shell=False`).

Blok shakli: `files:` (ro'yxat), `summary:`, `risk: past|orta|yuqori`, `danger_flags:`, `edits:` (`- file:`, `find: <<<MARKER` ... `MARKER`, `replace: <<<MARKER` ... `MARKER`), `test:`. Eski `diff:`, `teacher_rules_read:` e'tiborsiz. `find` bo'sh = YANGI fayl; `replace` bo'sh = `find` o'chiriladi.

Bosqichlar:
1. `extract_request_approval` -> `parse_plan` (holat mashinasi; marker ichida kalit qidirilmaydi; `files`, `edits`, `summary` bo'lmasa `buzuq blok`) -> `validate_plan` (har yo'l `safe_repo_path` + symlinksiz `_lexical_ok`; `.env` -> `Support .env so'radi — rad etildi`; boshqa rad -> `himoyalangan fayl`; edit fayli `files` da bo'lmasa `files ro'yxatida yo'q`; edit'siz fayl `files` dan chiqariladi; sezgir fayl -> risk `yuqori` + `XAVF: himoya yoki deploy fayli o'zgaradi: <yo'l>`).
2. `offer_plan`: token `uuid4().hex[:16]`, `build_payload` (har fayl sha256 xeshi, `created_ts` ilova vaqti), 60000 belgidan katta -> `hajm 60000+`; `sup_appr_<token>` ga yoziladi; preview HTML (3800 belgigacha moslashadi); 5 dan ortiq edit yoki 280 belgidan uzun find/replace bo'lsa avval to'liq `reja_<token>.diff` hujjat; keyin preview + [Ha]/[Yo'q] (`sup_ok:` / `sup_no:`). Yuborilmasa token o'chiriladi va `preview yuborilmadi`. Muvaffaqiyatda SISTEMA `Support ruxsat so'rayapti — N fayl, xavf: <risk>`.
3. `decide`: payload yo'q yoki muddati o'tgan (600 s) -> bir martalik claim, [Ha] bo'lsa `BAJARILMADI — muddat o'tgan`; `sup_run_` claim (ikki marta bosish himoyasi); [Yo'q] -> `sup_done_` darhol, SISTEMA `RAD ETILDI`; [Ha] -> fon `execute_approved` (`sup_done_` bu yerda yozilmaydi: restart tiklashi uchun).
4. `execute_approved`: jarayon ichidagi `asyncio.Lock` band bo'lsa `band (boshqa reja ishlayapti)`; `sup_exec_lock` va `sup_exec_active` lease'lari (60 s da yangilanadi). Ikki bosqich:
   - `_prepare_apply` (deploy qulfisiz, uzoq): `_preconditions` (branch `main`, index toza, maqsad fayllar `git status --porcelain` da toza, yo'l, sha256 preview'dagidek, fayl `.gitignore` da emas, lokal HEAD == `git ls-remote origin refs/heads/main`); asl nusxa `agents/state/sup_orig/<token>/state.json` (base64, mode, uid, gid); barcha edit xotirada (`find` aynan 1 marta, ustma-ust ham sanaladi; CRLF fayl bo'lsa find/replace ham CRLF'ga); o'zgarishsiz fayl -> `commit`; tekshiruvlar vaqtinchalik nusxada: har `.py` `sys.executable -m py_compile`, `backend/**/*.ts` -> `tsc --noEmit --pretty false -p backend/tsconfig.json`, `frontend/**/*.ts(x)` -> `frontend/tsconfig.json` (`node_modules/.bin/tsc`, bo'lmasa `npx --no-install tsc`, `node_modules` symlink bilan, `NODE_OPTIONS=--max-old-space-size=2048`).
   - Deploy flock (`DEPLOY_LOCK`, `LOCK_EX|LOCK_NB` har 2 s, 900 s gacha; kutilsa egasiga "Deploy ishlayapti..." xabari) -> `_write_apply`: shartlar qayta (HEAD tayyorlashdagi bilan teng bo'lmasa `branch`: "tekshiruv paytida HEAD o'zgardi"), har fayl `_atomic_write` (tmp + fsync + `os.replace`, mode/owner saqlanadi), har fayl alohida `git add -- <fayl>` (hech qachon `-A`), `git diff --cached --name-only` == files, `git commit -m "feat(support): <summary 60>"`, `git push origin main`. Push xato bersa-yu origin'da commit bo'lsa ok + izoh. Qulf push'dan keyin DARHOL bo'shatiladi (deploy.sh atigi 60 s kutadi).
   - Qaytarish: commitgacha har xatoda fayllar asliga, yangi fayl va papkalar o'chiriladi; commit/push xatosida `git reset --soft HEAD~1` + unstage + asl mazmun. Commit lokalda QOLMAYDI. Qaytarish to'liq bo'lmasa `QAYTARISH TO'LIQ EMAS` va asl nusxa `<token>.qoldiq` papkasida qoladi.
5. `_report`: SISTEMA `Support APPROVED bajarildi — commit <hash>, N fayl` yoki `Support APPROVED BAJARILMADI — <sabab>` (sabablar: `find topilmadi`, `find N marta`, `fayl o'zgargan`, `py_compile`, `tsc`, `commit`, `push`, `muddat o'tgan`, `restart`, `branch`, `band (boshqa reja ishlayapti)`); egasiga tekshiruvlar ro'yxati bilan. Bot push'dan keyin deploy ham, restart ham qilmaydi.
6. `recover_interrupted` (startda): `sup_run_` bor, `sup_done_` yo'q tokenlar: `pushed` -> APPROVED; `committed` va origin'da bor -> APPROVED; aks holda `reset --soft` va faqat biz yozgan (sha256 == new_sha256) fayllar asliga, SISTEMA `BAJARILMADI — restart`, lease'lar bo'shatiladi.
7. `purge_pending` (`/reset`): `sup_appr_*` o'chiriladi. Qo'lda: `python3 -m agents.reja --check <fayl>` (DB va Telegram'siz parse + preview + diff).

Egasi qarori (2026-09-28): [Ha] = egasining push ruxsati; bot `main` ga o'zi push qiladi, serverdagi push kaliti bilan (agent foydalanuvchisi kalitni o'qiy olmaydi). Lokal Claude Code sessiyasida push faqat egasi aytganda.

### F.11 Checker — checker_worker.py

Maqsad: 12 health tekshiruvi (LLM'siz) + alert rejimida bitta LLM tahlili. Xavfli avtomat (restart, IP blok) YO'Q.

| Komponent | Tekshiradi | Status qoidasi |
|---|---|---|
| `services` | `systemctl show` 5 servis (`xon-tranzactions-backend`, `-frontend`, `-leader`, `postgresql`, `nginx`) | unit yo'q yoki inactive = error, activating = warn, systemctl yo'q = unknown |
| `db` | `SELECT 1` agents va (farqli bo'lsa) facts ulanishi | xato = error, 2000 ms dan sekin = warn |
| `disk` | `/` band foizi | 85% warn, 95% error; warn/error bo'lsa (2026-10-09) eng katta papkalar (`du -sxm`, 100 MB+, journald, `/var/log`, PostgreSQL, `frontend/.next/cache`, `.next`, node_modules, panel uploads, tg_uploads, npm keshi, `/tmp`, apt, docker, swap) va DB hajmi + 6 katta jadval, soatlik kesh |
| `facts` | `updated_at` yoshi, `error` bo'limlar | 15 daq warn, 30 daq error, xato bo'lim bo'lsa kamida warn |
| `leader_bot` | `kv['leader_heartbeat']` | yo'q = warn, 3 daq warn, 10 daq error |
| `deploy` | `deploy_log.json`, bo'lmasa Facts `deploy` | oxirgi FAIL = error, OK = ok, aniqlanmasa unknown |
| `bank_sync` | Facts signallari | `hung`, `failed`, `login_suspect` = error, `stale` = warn |
| `sverka` | Facts bugungi `totalFarq` (dismissed emas, 1 so'mdan katta) | ochiq farq = warn; sana bugun emas = unknown |
| `xonpay` | Facts `oxirgi_muvaffaqiyatli` | 07-23 da `max(3 x interval, 180)` daqiqadan eski = warn; cron o'chiq = ok |
| `google_export` | Facts `ketma_ket_2_xato` | bor = error |
| `oplatykv_sync` | Facts `tushmagan`, `sync_xatolar`, `kelajak_updated_at` | pastda |
| `agents` | bugungi `agent_runs` | timeout+error 3 warn, 10 error; rate_limited/capped bo'lsa warn |

`oplatykv_sync` tafsiloti: tushmagan CLIENT to'lov faqat backend avto-sync jadvali bo'yicha baholanadi: tekshiruv oynasi `[dayStart + 120 daq, dayEnd)`, kechikish `max(eng_eski, bugungi dayStart)` dan (kunduzgi sync o'chiq bo'lsa tungi batch'dan), chegara `max(120, 2 x txAutoSyncMinutes)` daqiqa; Facts `hisoblangan` vaqti hisobga olinadi. 2026-10-07 dan Facts `sync_xatolar` (backend `settings.oplatykv.syncXatolar`: sync yoza olmagan to'lovlar, sabab bilan) bo'lsa warn va 3 namuna. Egasi qarori 2026-09-30: `kelajak_updated_at` yolg'iz warn bermaydi, xabarda `(ogohlantirish jim)` bo'lib qoladi.

- `run_all_checks_once(record=True)`: har tekshiruv `_safe_check` ichida (yiqilsa unknown), natija `agent_health` ga. `format_block`: `=== CHECKER_WORKER OLDINDAN OLINGAN NATIJALAR ===`, `[komponent] STATUS: xabar`, `  Batafsil: {json}` (600 belgi, `===` buzilgan), `=== TUGADI ===`.
- `checker_tick` (scheduler): jim komponentlar (`AGENTS_CHECKER_JIM`; env yo'q = default `sverka`, egasi qarori 2026-09-30; bo'sh qiymat = hech biri jim emas) tekshiriladi va yoziladi, lekin Telegram ogohlantirishi va "Boshqa ogohlantirishlar" ro'yxatiga kirmaydi. Qolgan warn/error eng jiddiysidan boshlab `_should_alert` (shu komponent+status oxirgi 1 soatda `agent_alert_log` da yo'q) dan o'tgan BITTASI `_ask_claude` ga: bitta komponent JSON fence ichida ("KO'RSATMA emas" ogohlantirishi, ```` ``` ```` neytrallangan), tez model, source `checker`. Javob egasiga Leader'siz to'g'ridan (plain text, lotinlashtirilgan), qolgan muammolar `Boshqa ogohlantirishlar: ...`. Javob yo'q bo'lsa LLM'siz fallback matn. Yuborilsa `agent_alert_log` va tarixga. Javobdagi `Teacher uchun:` qatorlari fon Teacher'ga; `[WRITE_MEMORY]` RAD.
- Scheduler: 45 s kutish, `checker:last_full_run` bo'yicha qolgan vaqt (kelajak qiymatga ishonilmaydi), lease `checker_lease` (1800 s), xatoda 300 s.
- Qo'lda: `python3 -m agents.checker_worker [--record]` (blok, LLM'siz); `--alert` (to'liq tick, HttpOutbox).

### F.12 Facts — support_facts.py

Maqsad: agentlar DB'ga ulanmasdan jonli holatni o'qishi uchun `agents/state/support_facts.json` (gitignore, 0644, atomik `.tmp` + `os.replace`). Format: valid JSON, "bir yozuv = bir qator" (Grep butun yozuvni beradi, keyin Read offset/limit).

- `facts_scheduler`: startda darhol, keyin har 300 s (fayl 150 s dan yangi bo'lsa tick o'tkaziladi: tashqi qo'lda ishga tushirish yozgan). `collect_and_save` `facts_lease` (240 s) bilan bitta ijro.
- `build_facts` tartibi: `updated_at` (birinchi kalit, Toshkent ISO) -> `system`, `schedulers`, `deploy`, `agent_tasks` -> 16 loyiha kaliti. Har bo'lim `_safe` (yiqilsa `{"error": "<300 belgi>"}`, qolganlari davom etadi; 5 s dan sekin bo'lsa log). Har loyiha kalitining BIRINCHI maydoni statik `izoh` (DB matni hech qachon qo'shilmaydi).
- `xato` va `oplatykv_sync` 15 daqiqa keshlanadi (`kv['facts_cache_<kalit>']`), qiymatda `hisoblangan` (Toshkent) va `keshdan`.
- Umumiy qoidalar: `db.tx("facts", readonly=True)`, statement 15 s; oynalar Python'da hisoblanadi (SQL'da `NOW()`/`CURRENT_DATE` yo'q, DB soati farq qiladi); DateTime parametri tz'siz UTC, `@db.Date` ustunlariga `YYYY-MM-DD`; `settings` jadvali hech qachon to'liq o'qilmaydi, token kalitlarining faqat bor-yo'qligi; erkin matn `_clean` (backend `leader-facts.service.ts::clean` naqshlarining Python nusxasi: token, parol, URL login, email, 14 raqam, telefon, chat ID) + `SIR_NAQSHLARI`; `manual:<email>` -> `manual`; retention'siz jadvallarda sana sharti majburiy.

| Kalit | Mazmuni (qisqa) |
|---|---|
| `system` | 5 servis holati va restartlar, disk, RAM, load, uptime, `db_ms`, health |
| `schedulers` | backend cron'larining oxirgi izi (log jadvali yoki settings) va bot fon vazifalari |
| `deploy` | `head` commit, `manba` (`deploy_log.json` hali yozilmaydi, shuning uchun odatda `deploy.log` oxiridagi `[deploy]` qatorlari), oxirgi 10 deploy natijasi |
| `agent_tasks` | oxirgi 60 vazifa, 40 va'da |
| `client_income` | OplatyKv vznos to'lovlari: bugun, kecha to'liq va shu vaqtgacha, oy boshidan, o'tgan oy shu kungacha, 14 kunlik, top 10 obyekt, "ot imeni" alohida, qaytarishlar |
| `bank_flow` | COMPLETED + UZS kirim/chiqim, transfer va tashqi kirim, bank va holat kesimi, 7 kunlik |
| `balances` | har hisob qoldig'i, jamiga kirganlar, bank/valyuta kesimi, Hamkor qatorida `qoldiq_ishonchsiz` |
| `bank_sync` | har faol hisob, oxirgi 3 sync log, signallar (`stale`, `login_suspect`, `hung`, `failed`), banklar, bugun, ulanishlar, bulkSync sozlamalari, importlar |
| `hamkorbank` | Hamkor hisoblari, 7 kunlik SYNC/HAMKOR_IMPORT, vipiska importlari, istisno oraliqlari |
| `sverka` | bugungi avtomat sverka farqlari (faqat Kapital, Ipak Yo'li), tarix, chatlar soni |
| `crm_sverka` | oxirgi run, snapshot vaqti, `crm_contracts` kesh sonlari |
| `xato` | tranzaksiya va OplatyKv tomonidagi XATO, arizalar, AI agent sozlamalari (15 daq kesh) |
| `oplatykv_sync` | 3 kunlik tushmagan, oxirgi cron qatori, 30 kunlik yetim, kelajak `updated_at`, `sync_xatolar`, sozlamalar (15 daq kesh) |
| `bank_changes` | 7 kunlik DELETED/EDITED/MOVED, oxirgi 15 |
| `xonpay` | cron, oxirgi 5 sync log (`orfan` belgisi), oxirgi muvaffaqiyatli, 7 kunlik moslanmagan, bugun |
| `google_export` | har sheet oxirgi 2 ishga tushish, `ketma_ket_2_xato` |
| `api_usage` | 24 soat status sinflari, top yo'llar, kalit nomlari, 5xx namunalar, kalitlar muddati |
| `telegram_notify` | 7 bildirishnoma (XATO notifikator, sverka, tuzatish boti, chek order, chek_dog, autsourcing, SHMITD): yoqilgan, token bor-yo'q, oxirgi natija |
| `counterparties` | faol soni, yangilanish xatolari, DIDOX va ta'minot sync |
| `panel_activity` | 24 soat audit (faqat yozuvchi so'rovlar), muvaffaqiyatsiz kirishlar, xodimlar |

Har kalit manbasi (jadval, ustun, TAQIQ ustunlar, izoh matni) `agents/knowledge/agentlar.md` "Facts manbalari" bo'limida batafsil. Qo'lda: `python3 -m agents.support_facts [--stdout]`.

### F.13 To'lov tekshiruvi — payment_check.py va /tolov

Maqsad: shartnoma yoki bitta to'lovni bank (`transactions`), OplatyKv (`oplata_kv`), XonSaroy CRM va Google Sheetlar bo'yicha solishtirish. FAQAT o'qish. Juftlash va farq kodlari Python'da, LLM faqat tushuntiradi. `prefetch()` hech qachon exception chiqarmaydi: xato o'z bo'limiga UNKNOWN bo'lib yoziladi, manba qisman o'qilsa "yo'q" kodlari chiqmaydi. Bilim: `agents/knowledge/tolov_tekshirish.md`.

Kirish turlari (`parse_kirish`, `_argument`):

| Tur | Shakl | Izoh |
|---|---|---|
| `shartnoma` | `<sh>` yoki `A,B,C` | 3 tagacha (`TOLOV_SHARTNOMA_MAX`), ortig'i `tashlangan` |
| `id` | bank kompozit ID, `general_id` yoki tx cuid | bitta token |
| `xonpay` | XonPay UUID | kichik harfga |
| `summa_sana` | `<summa> <sana> [kun=N] [bank]` | `kun` 10 gacha, default 3 |
| `mijoz` | `mijoz <familiya ism>` | |
| `chek` | `chek <order №> [summa] [sana]`, `TOLOV: order= summa= sana= hisob=` | order № = `transactions.doc_number`; panel Chek order "Tekshirish" bilan bir xil |

- `TOLOV:` qatori buzuq bo'lsa erkin matnga tushadi. Erkin matn zaxirasi: contract-parser nusxasi bo'yicha shartnoma raqamlari (kirill shakl harflari, `/SH`, yopishgan "ot" kesilgan nomzod `_ot_kes`), keyin UUID, keyin ID, oxirida order/summa/sana (telefonlar avval olib tashlanadi; summa va sana AYNAN bittadan bo'lsagina).
- Oxiridagi `batafsil` so'zi texnik chiqishni yoqadi.
- `tolov_savol(arg)`: faqat identifikator -> LLM'siz; qo'shimcha so'z yoki ko'p qator -> savol (Checker delegatsiyasi `tolov_topshiriq`: `TOLOV: <qator>` + `Egasining savoli: <matn>`).

Manbalar:
- DB: bitta `db.tx("facts", readonly=True, 15 s)` (har so'rov SAVEPOINT'da): `transactions`, `oplata_kv`, `crm_contracts` (XATO ta'rifi), o'zgarish izlari, vznos, perebroska, arizalar, `xonpay_transactions` (Billing). TAQIQ ustunlar (telefon, raw_snapshot, metadata, raw_extra, INN, hisob raqamlari, note) o'qilmaydi.
- Panel ko'prigi (asosiy CRM va Sheet manbasi, `_koprik_get` yagona tarmoq funksiyasi, faqat GET): `/api/agent-bridge/payment-check` (panel Chek payment hisobi: OplatyKv, CRM panel yo'li `/order/show` yoki payment-history zaxirasi, ulangan sheetlar), `/api/agent-bridge/exports` ("nega sheetda yo'q" sababi uchun eksport sozlamasi va oxirgi ish), `/api/agent-bridge/crm-lookup` (shartnomasiz yoki XATO to'lovning bank ID si CRM'da), `/api/agent-bridge/chek-find` (chek -> tranzaksiya). Faqat `http://127.0.0.1` yoki `http://localhost` (`AGENT_BRIDGE_URL`, bo'lmasa `PORT`, default 3001), proxy yo'q, redirect taqiq (va javob URL'i host bilan solishtiriladi), 90 s, javob 5 MB; kalit `AGENT_BRIDGE_KEY` faqat `x-agent-bridge-key` header'ida, xato matnidan `_sirsiz` bilan olib tashlanadi.
- Eski yo'l: `GET {XONSAROY_CLIENT_BASE}/payment-history` (`_crm_get`) default O'CHIQ (prod'da 404), `AGENTS_TOLOV_CRM=1` yoqadi: faqat https, host qadalgan, parametr oq ro'yxati (`contract transaction_id limit is_trashed trashed_status with_trashed`), TLS tekshiruvi, bir prefetch'da 7 so'rov, parallellik 1, 10 daqiqalik xotira keshi, kunlik 300 (`AGENTS_TOLOV_CRM_KUNLIK`, hisoblagich `kv['tolov_crm_<sana>']`). Modulda POST/PUT/PATCH/DELETE kodi yo'q (test tekshiradi): CRM faqat o'qiladi (egasi qoidasi).
- Deadline'lar: DB va eski CRM 45 s, ko'prik prefetch boshidan 100 s gacha, `leader_bot` tashqarida 120 s.

Juftlash (`juftla`, `_moslash`): L1-L4 ID bo'yicha (`kuchli` to'liq kompozit, `yadro` = `general_id_num_ddate`, `gid` = bank general_id, `xonpay` UUID; guruhlar orasida ham, `BOSHQA_SHARTNOMA` beradi), L5 summa teng va sana +-3 kun (Hamkor +-5), bitta shartnoma guruhi ichida, ikki tomonda yagona nomzod (`kuchsiz`), L6 sana bir xil, summa yaqin (`SUMMA_FARQ`). CRM dublikati (bitta external_id ikki contract qatorida) `BIZDA_YOQ` bo'ladi. XonPay yo'ldagi to'lovlar L5-L6 ga kirmaydi.

Farq kodlari (33 ta, `TOLOV_FARQ_KODLARI`): error - `XATO`, `CRM_YOQ`, `BIZDA_YOQ`, `OKV_YOQ`, `TX_YOQ`, `SUMMA_FARQ`, `DUBLIKAT`, `CRM_FARQ`; warn - `KANONIK_EMAS`, `BOSHQA_SHARTNOMA`, `SPLIT_FARQ`, `SPLIT_YOQ`, `DRIFT`, `TX_HOLAT`, `KATEGORIYA`, `BANK_OCHIRGAN`, `BANK_KOCHIRGAN`, `BANK_TAHRIRLAGAN`, `OKV_OCHIRILGAN`, `SHEET_YOQ`, `SHEET_FARQ`, `XONPAY_KECHIKDI`; info - `XONPAY_KUTILMOQDA`, `ARIZA_KUTMOQDA`, `SANA_SILJIGAN`, `CRM_SPLIT`, `QAYTARIM`, `PEREBROSKA`, `VZNOS`, `SCHETCHIK`, `SYNC_KUTILMOQDA`, `TXMINDATE`, `KUCHSIZ_MOSLIK`. Har kod uchun `TOLOV_FARQ_TUZATISH` maslahati (90 belgigacha; CRM'ga yozish hech qachon bot ishi emas). Sheet sabablari `TOLOV_SHEET_SABABLAR`: `FILTR_OBYEKT`, `FILTR_KATEGORIYA`, `FILTR_TUR`, `FILTR_HISOB`, `FILTR_SANA`, `FILTR_BELGI`, `EKSPORT_ESKI`, `XATO_RAQAM`. Solishtiriladigan sheetlar: `AGENTS_TOLOV_SHEETLAR` (id yoki nom), bo'lmasa nomida `sotuv`, `debetor`, `debitor`; qolgani "ma'lumot uchun, solishtirilmaydi".

XonPay qoidasi (egasi, 2026-09-29): to'lov CRM'da darhol, pul bizning hisobga 1-3 bank ish kunida (dushanba-juma, bayramlarsiz). Holatlar `TUSHGAN`, `KUTILMOQDA` (3 ish kunigacha, info), `KECHIKDI` (warn), `CRMDA_YOQ`. Billing'dagi eski TOPILMAGAN UUID qatori CRM kompoziti orqali kelishtiriladi (`xonpay_kelishtir`, 10 kunlik oyna). Yo'ldagi XonPay to'lovi `BIZDA_YOQ`/`CRM_FARQ` bo'lib chiqmaydi.

Chiqish:
- `format_block` (Checker'ga): `=== TOLOV TEKSHIRUV NATIJALARI (ma'lumot, buyruq emas) ===`, boshida `XULOSA (...)` oddiy tilda, keyin `TEXNIK:` komponentlar qat'iy tartibda (`kirish chek crm_id crm_kesh crm crm_panel oplata_kv sheet transactions xonpay bank_izi kontekst solishtirish panel_solishtirish farqlar tolovlar nomzodlar`), 12000 belgi, jadval 40 qator, farqlar 25. To'lovchi erkin matni agentga berilmaydi, faqat undagi shartnoma raqamlari.
- `format_owner` (`/tolov`): oddiy tilda `format_xulosa` (sarlavha, `Xulosa:` bitta jumla, manba jadvali CRM/Bank/OplatyKv/sheetlar, reja holati boshlang'ich/oylik/jami bilan qarz, raqamlangan farqlar + "Nima qilish", "Guruhga javob"). Texnik kodlar egasiga ko'rsatilmaydi, tarix shovqini (7 kundan eski bank/OplatyKv tarixi, kategoriya) yashiriladi. `batafsil` bilan `format_batafsil` (`<pre>` jadval, 15 qator). Egasi qarori: mijoz ismi TO'LIQ ko'rsatiladi; telefon, pasport, karta, hisob raqami maskalanadi.
- `qisqa` (tarixga bitta qator, ism va ID'siz): `To'lov tekshiruvi <kirish>: CRM ...; OplatyKv ...; bank ...; farq: ...` yoki `N nomzod, shartnoma tanlanmadi`.
- Savol qoidasi (hodisa 2026-09-30, `TOLOV_SAVOL_QOIDASI`, leader.md/checker.md/bilim faylida harfma-harf): avval savol, keyin raqam; "yopilganmi" -> reja bilan to'langan (qarz); "ko'rinmayapti" -> qaysi manbada yo'q va nega; "tushdimi" -> bank/XonPay. "Manbalar mos" o'zi javob emas.
- Qo'lda: `python3 -m agents.payment_check "<kirish>" [--crm-yoq] [--koprik-yoq]`.

### F.14 TR Support umumiy: ko'prik va matnli tasdiq

- Umumiy ko'prik funksiyasi `tuzatish._koprik(yol, params=None, body=None, timeout=90, ruxsat_run=False)`: `params` = GET, `body` = POST JSON. Yo'l `_YOLLAR` oq ro'yxatida bo'lishi shart (aks holda `ValueError`); eksport `run` (Sheets'ga yozadi) faqat `ruxsat_run=True` va `EKSPORT_RUN_RE` bilan. Manzil va kalit `payment_check` bilan bir xil (`_koprik_base`, `AGENT_BRIDGE_KEY` header'da), urllib opener proxy'siz va redirectsiz. Javob `{"ok": true, ...}` bo'lishi shart; `ok:false` bo'lsa `error` (+ `step`) `KoprikXato` bo'lib egasiga aytiladi; HTTP xato kodiga izoh (`400` format, `403` kalit/ko'prik yopiq, `404` agent-bridge yo'q, `429` chegara).
- `_YOLLAR` = `tx-edit/options`, `tx-edit/preview`, `tx-edit/apply`, `xato-ariza/find`, `xato-ariza/submit`, `xato-ariza/status`, `exports`, `hisob`, `xato-royxat`, `perebroska/tahlil`, `perebroska/yarat`, `tarix/yukla`, `tarix/holat` (hammasi `/api/agent-bridge/` ostida). `payment_check` ning o'z oq ro'yxati alohida (`_KOPRIK_ROYXAT`: `payment-check`, `exports`, `crm-lookup`, `chek-find`, faqat GET).
- `tuzatish._say`: egasiga yuboradi va tarixga `leader` roli bilan yozadi (HTML preview tarixga teglarsiz). `ariza`, `eksport`, `malumot`, `perebroska`, `tarix` shu `TZ._say`, `TZ._koprik`, `TZ._qiymat`, `TZ._pul`, `TZ._e`, `TZ._eskirgan` dan foydalanadi.
- Mashina qatori parse uslubi (hamma modulda bir xil): `KALIT=qiymat` juftlari, qiymat keyingi ma'lum kalitgacha; `?`, `??`, `nomalum`, `noma'lum` yoki bo'sh = noma'lum (so'raladi); 200 belgigacha.
- Matnli tasdiq (egasi qarori 2026-10-01): TR Support oqimlarida (tahrir, ariza, eksport) tasdiq ham, variant tanlash ham INLINE TUGMASIZ. Preview oxirida `TASDIQ_YOZING` ("tasdiqlayman" / "yo'q", 10 daqiqa). `matn_qaror`: 40 belgidan uzun matn hech qachon tasdiq emas. Har tasdiq bir martalik (`*_run_<token>` claim), muddat `created_ts` dan 600 s.

### F.15 tuzatish.py — to'lovni tahrirlash

Maqsad: tranzaksiyaning 3 ustunini (Kontragent = top kategoriya, Kategoriya = subkategoriya, Shartnoma = CRM'da `found` bo'lishi SHART) egasi tasdig'i bilan tahrirlash; keyin bitta OplatyKv sync. Backend tomoni `backend/src/tr-support/` (panel yo'llari `setManual`/`setContract`, tarix `tr_support_edits`, ortga qaytarish panel TR Support tabida kirish kodi bilan).

Mashina qatori (Leader intent `tx_edit` yoki `/tuzat`): `TUZATISH: tx=<ID> kontragent=<variant|qolsin> kategoriya=<variant|qolsin|yo'q> shartnoma=<raqam|qolsin|tozalash|XATO> tasdiq=<ism> izoh=<matn>`; bir nechta to'lov = bir nechta qator (ko'pi bilan 20). `tx` uchun CRM bank hujjat raqami `<general_id>/<dd.mm.yyyy>` ham bo'ladi: bot `/` ni `_` ga almashtiradi (2026-10-05), backend `findTxRef` topadi. `qolsin` (yoki `o'zgarmasin`) ko'prikka bo'sh satr bo'lib boradi (o'zgarmaydi).

Oqim (`_handle`):
1. `tx` formati (`_TX_RE`) yaroqsiz bo'lsa "avval to'lovni toping (/tolov ...)". Bitta qatordagi `tasdiq`/`izoh` qolganlariga ham.
2. Aniq shartnoma (raqam + harf, `qolsin`/`tozalash`/`XATO` emas) berilgan har qator avval `GET tx-edit/preview`:
   - `valid` + `harf` -> harf farqi qoidasi (egasi qarori 2026-10-03): `_harf_bajar` savolsiz va TASDIQSIZ darrov `POST tx-edit/apply` (approvedBy = egasi aytgan ism yoki `Egasi · harf qoidasi`, izohga `Shartnoma oxirgi harf farqi ...: A -> B`). Backend qoidani qayta tekshiradi (oxirgi 1-2 harf, Levenshtein <= 2, CRM'da yagona, kutilayotgan ariza yo'q).
   - `valid` + `ulash` -> XATO to'lovni ariza o'rniga tasdiq bilan ulash (egasi qarori 2026-10-05; shart: CRM'da aniq, obyekt kodi bir xil): kontragent/kategoriya `qolsin`, tasdiqlovchi va izoh so'raladi.
   - `xato.inList` va yaroqsiz -> "Bot orqali tahrirlanmaydi (XATO to'lovlar ro'yxatida)" (egasi qarori 2026-09-30: XATO ro'yxatidagi to'lov ariza orqali).
3. Aralash ro'yxat (2026-10-05): rad etilganlar alohida aytiladi, qolganlari davom etadi ("Qolgan N ta to'lov bo'yicha davom etaman"); avval bittasi rad bo'lsa butun ro'yxat to'xtardi.
4. Yetishmagan qiymat (birinchi to'liqmas to'lov uchun): `GET tx-edit/options` -> `savol_matni`: to'lovning hozirgi holati, BARCHA kontragent va kategoriya variantlari, ma'lumlar, raqamlangan savollar. Kutilayotgan ariza bo'lsa savol emas, "kuting". XATO ro'yxatidagi to'lov uchun oldidan `TUZATISH_XATO_SAVOL` (ulash yoki faqat kontragent/kategoriya). Aloqa Bank importi tahrirlanmaydi.
5. Tasdiqlovchi ismi bittadan ko'p bo'lsa so'raladi.
6. Har qator preview; `xatoQoladi` (XATO'da qoladi, faqat kontragent/kategoriya, CLIENT bo'lib qolishi shart) va `ulash` belgilari preview'da.
7. `tz_appr_<token>` payload: `tasdiq`, `izoh` (1000), `items` (to'liq ID `_aniq_id` = preview'dagi `externalId`/`id`, qisqa raqam emas), `mid`. Preview HTML (oldin -> keyin, CRM mijoz va obyekt, "Keyin OplatyKv sync bir marta ishlaydi").
8. "tasdiqlayman" -> `decide` -> fon `_bajar`: `POST tx-edit/apply` (`items`, `approvedBy`, `comment`; timeout 240 s, CRM tekshiruvi + sinxron sync 1-bosqichi) -> `natija_matni`: har to'lov `bajarildi / qisman (xato) / bajarilmadi`, o'zgarishlar, sabablar, CRM (mijoz, obyekt), OplatyKv qatori yangilangani (`okv` yoki `oplataKv`), sync natijasi, panel tarixi yo'li.

`shartnoma=XATO`: to'lovni XATO ro'yxatiga tushirish (keyin ariza); shartnomaga aynan "XATO" yoziladi, CRM tekshirilmaydi, kontragent CLIENT (2026-09-30 qarori).

### F.16 ariza.py — XATO to'lovga ariza

Maqsad: XATO sahifasidagi "Shartnoma biriktirish" bilan AYNAN bir xil ariza (to'g'ri shartnoma + ariza fayli), keyin backend AI tekshiruvchisi natijasini kutish.

- Qator (intent `xato_ariza`): `ARIZA: tx=<ID> | summa=<raqam> sana=YYYY-MM-DD [hisob=<qabul qiluvchi>] shartnoma=<to'g'ri> [tolovchi=<ism>] [fayl=leader_bot_...] [tasdiq=<ism>]`. Summa bo'shliqsiz raqamga (`7.100.000` -> `7100000`), sana `dd.mm.yyyy` -> ISO, hisob faqat raqam, shartnoma `№` va bo'shliqsiz katta harf.
- Fayl: `fayl=` yoki shu xabardagi birinchi fayl; faqat `static/tg_uploads/leader_bot_<16 hex>.(jpg|jpeg|png|webp|gif|pdf|doc|docx)` va mavjud bo'lsa (2026-09-30: rasm, PDF yoki Word). Fayl yo'q, shartnoma yo'q yoki (tx ham, summa+sana ham yo'q) bo'lsa so'raydi.
- `GET xato-ariza/find` (xato-list bilan bir xil filtr, summa, sana +-3 kun, hisob): 0 ta -> "avval XATO deb belgilang" (`shartnoma=XATO`); bir nechta -> ID lari bilan ro'yxat (10); kutilayotgan ariza -> "kuting"; CRM'da topilmasa "boshqa shartnoma bering".
- Preview: to'lov, to'liq ID, hozirgi shartnoma, izoh (PII maskalangan, 160), yangi shartnoma, CRM mijoz/obyekt, arizadagi to'lovchi bilan CRM mijozi mosligi (`ism_mos`: familiya va ismning birinchi 4 harfi, 2 ta mos = mos), hisob mos kelmasa ogohlantirish, obyekt kodi farq qilsa "AI xodimga yuborishi mumkin". Payload `ar_appr_<token>`.
- "tasdiqlayman" -> `POST xato-ariza/submit` (`oplataKvId`, `contractNo`, `fayl`, `yubordi` = `TR Support · <tasdiq>` yoki `TR Support bot (egasi)`; timeout 120). `alreadyPending` bo'lsa yangi ariza yo'q. AI o'chiq bo'lsa "xodim tasdiqlaydi". Aks holda `GET xato-ariza/status` har 15 s, 240 s gacha: tasdiqlandi / rad / xodim ko'rishi kerak; tugamasa "Arizalar tabida ko'rinadi".

### F.17 eksport.py — Google Sheets eksportini qayta ishga tushirish

- Qator: `EKSPORT: <nom>` (bo'sh, `?`, `hammasi`, `ro'yxat` = ro'yxat), `/eksport [nom]` (2026-10-01).
- `GET exports` -> ID'si yaroqli elementlar. Nom bitta eksportga mos kelsa (aniq ID/nom yoki hamma so'zlar nomda) darhol tasdiq so'rovi; aks holda raqamlangan ro'yxat (20 tagacha: oxirgi ish vaqti/holati/qatorlar, cron jadvali) va `ek_roy_<token>` (ID lar, `mid`). Egasi raqam yozadi (`matn_tanlov`: reply qilingan ro'yxat yoki eng yangisi), eski xabarlarda `ek_t:` tugmasi.
- Tasdiq preview: sheet / tab, manba (Tranzaksiyalar yoki OplatyKv), rejim (`replace` yoki `upsert`), oxirgi ish, jadval. `ek_appr_<token>`.
- "tasdiqlayman" -> `POST exports/<id>/run` (`ruxsat_run=True`, timeout 600) = panel "Bajarish" (runAndLog). Natija: yozilgan/olingan qatorlar, soniya; HTTP 409 = "hozir ishlayapti".

### F.18 malumot.py — /hisob va /xato fayli (faqat o'qish, tasdiqsiz)

Egasi qarori 2026-10-05.
- `HISOB: <raqam>[, ...]` / `/hisob <raqam>`: 16-25 xonali raqamlar (bo'shliq va `-` olinadi, 3 tagacha). Har biri `GET hisob?raqam=` (90 s) -> `hisob_matni`: balans kodi va valyuta, bizning hisobmi (bank, MFO, egasi, sync), to'lovlardagi egasi nomi, MFO va bank, INN/PINFL, boshqa yozilishlar, korxona (DIDOX: to'liq nom, INN, direktor, manzil, telefon, QQS, OKED, ro'yxatdan o'tgan, bank), shu hisobdan va shu hisobga to'lovlar (soni, summa, sanalar), shartnomalar, oxirgi to'lovlar to'liq ID bilan. Topilmasa "bizning hisoblarda ham, to'lovlarda ham, kontragentlarda ham yo'q". Diqqat: bu javob egasiga direktor, manzil, telefon kabi shaxsiy ma'lumotni ham ko'rsatadi (faqat egasining shaxsiy chatiga).
- `XATO_FAYL: [filtr]` / `/xato [filtr]`: `GET xato-royxat?filtr=` (120 s) -> soni, jami, kutilayotgan va rad etilgan arizalar, filtr, `dateFrom`, 2000 qator chegarasi ogohlantirishi; `base64` xlsx (`validate=True`), fayl nomi `[A-Za-z0-9_.-]{1,80}.xlsx` bo'lmasa `xato-tolovlar.xlsx`; `send_document` (caption 1000). Qator yo'q bo'lsa fayl yuborilmaydi. Tarixga "Fayl yuborildi".

### F.19 perebroska.py — AI Perebroska (tasdiqsiz)

Egasi qarorlari: 2026-10-05 bot orqali AI Perebroska (panel OplatyKv > + > AI Perebroska bilan aynan bir xil); 2026-10-07 TASDIQ SO'RALMAYDI, to'siq bo'lmasa darhol yaratadi.
- Qator (intent `perebroska`): `PEREBROSKA: fayl=<leader_bot_...> [tasdiq=<ism>] [izoh=<matn>]`; fayl berilmasa shu xabardagi fayl. Faqat PDF yoki rasm o'qiladi (Word rad).
- Himoya "bir fayl - bir perebroska": `pb_yaratildi_<fayl hex>` oldin bor bo'lsa "allaqachon yaratilgan (guruh ID) / bajarilmoqda".
- `MSG_PEREBROSKA_TAHLIL` xabari, `POST perebroska/tahlil` (`{"fayl"}`, 180 s) -> panel agenti (manba va maqsad shartnomalar, summa, arizachi, ogohlantirishlar, takrorlar).
- `toskiqlar`: manba aniqlanmadi/topilmadi; maqsad yo'q/topilmadi; obyekt mos emas; maqsad summasi yo'q; jami summa aniqlanmadi yoki maqsadlar yig'indisiga teng emas (0.01); manba qoldig'i yetmaydi; TAKROR (shu manbadan shu summada perebroska bor). To'siq bo'lsa `rad_html` (agent o'qigani + sabab), hech narsa yaratilmaydi.
- Aks holda `kv_claim(pb_yaratildi_<hex>)` (parallel yoki qayta yuborish himoyasi) -> `POST perebroska/yarat` (fayl, fromContractNo, amount = maqsadlar yig'indisi, date (ariza sanasi, yaroqsiz bo'lsa bugun), destinations, agentState/Reason/Data, `tasdiq` = egasi aytgan ism yoki `egasi`, izoh; 120 s). Xato bo'lsa claim o'chiriladi (qayta urinish mumkin). Muvaffaqiyatda claim qiymati `{groupId, at}` va `natija_html` kartasi (manba, obyekt, summa, sana, maqsadlar, arizachi, agent xulosasi, ogohlantirishlar, OplatyKv qatorlari, "Kim: TR Support (...)", guruh ID, orqaga qaytarish yo'li: OplatyKv > + > AI Perebroska > Tarix).

### F.20 tarix.py — eski tarixni bankdan yuklash (tasdiqsiz)

Egasi qarori 2026-10-09: panel Tranzaksiyalar > "Eski tarixni yuklash" (backend `SyncService` backfill) bilan AYNAN bir xil. Backfill faqat QO'SHADI (o'chirish/o'zgartirish aniqlash va qoldiq yangilash o'chiq), shuning uchun tasdiq so'ralmaydi.
- Qator: `TARIX: dan=YYYY-MM-DD [gacha=] [bank=] [hisob=]` yoki kalitsiz `TARIX: 01.10.2026 05.10.2026 Kapitalbank` (16-25 xonali raqam = hisob, aks holda bank nomi; `hammasi`/`barcha` = barcha hisoblar); `gacha` yo'q = `dan`. `TARIX: holat` (`holat`, `status`, `qayerda`, `natija`) yoki `/tarix holat`.
- `POST tarix/yukla` (60 s; hisob bo'lsa bank yuborilmaydi) -> `kv['tarix_oxirgi'] = {boshi, xabar: false, ts}` -> "boshlandi: qamrov, sanalar (kun), N hisob" (+ backend ogohlantirishi). Backend himoyasi (2026-10-09 ko'rib chiqish): 62 kungacha, kelajak yo'q, bir vaqtda bitta (so'nggi 20 daqiqadagi RUNNING log), band hisob qayta uriladi, bank nomi noaniq bo'lsa xato, tugagach yangi to'lov bo'lsa bitta OplatyKv sync.
- Fon `_kuzat`: har 20 s `GET tarix/holat?since=<startedAt>`; hamma hisob tugasa (va ish tugagan bo'lsa) natija (hisoblar, olindi, yangi, OplatyKv qo'shildi/yangilandi/yozilmadi, xatolar hisob va sabab bilan 5 tagacha); 300 s siljimasa "TO'XTAB QOLDI" (server restarti bo'lishi mumkin, qayta yuborish takror qo'shmaydi); 3600 s dan keyin "fonda davom etyapti". Ko'prik xatosi ham "siljimadi" hisoblanadi.
- `/tarix holat`: oxirgi 24 soatdagi bot yuklashi (`kv['tarix_oxirgi']`), restartdan keyin ham.

### F.21 Ko'prik yo'llari (bot qaysi modulidan chaqiradi)

Backend tomoni (agent-bridge guard, validatsiya, rate-limit, audit) boshqa bo'limda. Bot tomonida:

| Yo'l (`/api/agent-bridge/...`) | Metod | Modul | Tasdiq |
|---|---|---|---|
| `payment-check?contracts=` | GET | `payment_check._koprik_get` | o'qish |
| `exports` | GET | `payment_check`, `eksport` (`TZ._koprik`) | o'qish |
| `crm-lookup` | GET | `payment_check` | o'qish |
| `chek-find` | GET | `payment_check` | o'qish |
| `tx-edit/options`, `tx-edit/preview` | GET | `tuzatish` | o'qish |
| `tx-edit/apply` | POST | `tuzatish._bajar` | "tasdiqlayman"; harf qoidasida TASDIQSIZ |
| `xato-ariza/find`, `xato-ariza/status` | GET | `ariza` | o'qish |
| `xato-ariza/submit` | POST | `ariza._yubor` | "tasdiqlayman" |
| `exports/<id>/run` | POST | `eksport._run` (`ruxsat_run=True`) | "tasdiqlayman" |
| `hisob`, `xato-royxat` | GET | `malumot` | o'qish |
| `perebroska/tahlil` | POST | `perebroska` | tahlil (yozmaydi) |
| `perebroska/yarat` | POST | `perebroska` | TASDIQSIZ (to'siqsiz bo'lsa) |
| `tarix/yukla` | POST | `tarix` | TASDIQSIZ (faqat qo'shadi) |
| `tarix/holat` | GET | `tarix` | o'qish |

### F.22 Asbob siyosati: claude_settings.json va bin/bash_guard.py

- CLI bypass rejimida (`--dangerously-skip-permissions`, egasi qoidasi) `allow` ro'yxati CHEKLAMAYDI. Haqiqiy to'siqlar: `--disallowedTools`, `--tools` oq ro'yxati, settings `deny`, PreToolUse hook va alohida imtiyozsiz OS foydalanuvchisi.
- `claude_settings.json`: `allow` = `Read(**)`, git o'qish va `python3 -m py_compile`; `deny` = `.env*`, `/proc`, `/etc`, `~`, `/root`, `*.pem`, `*.key`, `*credentials*.json`, `*service-account*.json`, `abc_sheets.json`, `uploads/` o'qish, `.env*` va `.git/` tahriri, `rm -rf`, `sudo`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`; hook `{"matcher": "Bash", "command": "python3 agents/bin/bash_guard.py"}`. Fayl REJA uchun himoyalangan; repo ildizida `.claude/settings.json` YARATILMAYDI (egasining lokal Claude Code sessiyasi uni yuklab qo'yardi).
- `bash_guard.py` (faqat stdlib, fail-closed: har kutilmagan xato ham exit 2; CLI exit 2 dan boshqasini bloklamaydigan deb oladi): faqat `git log|show|diff|status|blame ...` va `python3 -m py_compile <repo ichidagi .py>`. Rad: metabelgilar `; | & $ backtick > < ( ) { } * ? [ ]`, yangi qator va boshqaruv belgilari (qo'shtirnoq ichida ham), surrogat kodlash, `-c`, `-C`, `-O` (yopishgan qiymat bilan ham), uzun flaglar va ularning qisqartmalari (`--output`, `--no-index`, `--ext-diff`, `--textconv`, `--git-dir`, `--work-tree`, `--exec-path`, `--open-files-in-pager`, `--contents`, `--ignore-revs-file`, `--orderfile`), `blame -S`, `.env` bor argument, `/` yoki `~` bilan boshlanadigan yoki `..` bor yo'l (`=` dan keyingi qism ham, qisqa flagga yopishgan yo'l ham). Rad matni `bash_guard: ruxsat yo'q — <sabab>`. Qo'lda: `python3 agents/bin/bash_guard.py --check "git log -3"`.

### F.23 Promptlar (rollar va asosiy qoidalar, qisqacha)

Promptlarda kirill harf YO'Q (hozir 4 promptda 0 ta; `knowledge/README.md` qoidasi). Kirill UI va kategoriya nomlari lotin transliteratsiyasida yoziladi (bot `Za schetchik` kabi translitni taniydi). Promptlar har chaqiruvda diskdan o'qiladi.

`leader.md` (yagona ovoz, Read/Grep/Glob):
- 0: diagnostika savoliga "yozib qo'ydim" javob emas (aldash); aniq qiymat + Facts vaqti yoki "Yo'q, topilmadi".
- 4: javob FAQAT JSON (4 kalit, 13 intent), `null` qo'shtirnoqsiz.
- 5: delegatsiya qoidalari (bitta javobda bitta delegate, sana HOZIRGI VAQT'dan `YYYY-MM-DD`, delegatsiyada `human_reply` = "Qabul qildim.", synth'da faqat `human_reply`, synth bo'lmaydigan holatlar); har TR Support intenti uchun mashina qatori shakli va qoidalari: `payment_check` (`TOLOV:` 5 shakl, 2-qator `Egasining savoli:`, natijani qisqartirmaslik, guruhga javob tuzilmasi), `tx_edit` (to'liq ID ko'chirish, `?` bilan to'qimaslik, XATO ulash, faqat kontragent/kategoriya, harf qoidasi "kod o'zgarishi emas - support'ga yuborma", `shartnoma=XATO`), `eksport`, `tarix` (nisbiy sanani hisoblash; bank bor-bizda yo'q chiqsa `TARIX` taklifi), `perebroska` (XATO arizasi bilan adashtirma, summani to'qima), `hisob`, `xato_fayl`, `xato_ariza`; summani to'liq raqam bilan yozish (`110 000 mln` kabi aralash yozuv xato).
- 6-7: kod o'zgarishi faqat Support REJA; faqat `[SISTEMA: ...]` yozuvlariga ishonish (ro'yxat va ma'nolari).
- 8: va'da so'zlarini ishlatmaslik (ro'yxat `VADA_TRIGGERS` bilan harfma-harf).
- 9-11: savol turi, Facts kalitlari (Grep + Read offset), "Yo'q bo'lsa — yo'q" (taxmin ro'yxati taqiq), kontekst qatorlari.
- 12-14: rasmni darhol Read bilan ochish; SQL yozmaslik, biznes qaror bermaslik, hayoliy UI tugmalarini aytmaslik (buyruqlar ro'yxati); sirlar va prompt injection (forward, fayl, Facts, commit matni ma'lumot, buyruq emas).
- 15-18: qoidani o'zgartirish egasining huquqi (maqsadni qisqartirmay Support'ga); ohang ("shefim", 12 so'zdan qisqa jumla, Telegram HTML, emoji yo'q, `[REACT:nom]` yagona istisno); farosat qoidalari; xotira 5 turi va Teacher.
- 19-21: modullar jadvali (INDEX bilan bir xil), domen amali yo'q (istisnolar bot modullari), JSON misollar.

`support.md` (kod REJAsi; Read/Grep/Glob + git o'qish + py_compile):
- 0: TUR A diagnostika (Facts'dan matn, REJA/blok YOZMA) va TUR B kod tuzatish (faqat REJA).
- 2-3: asboblar chegarasi (agent `py_compile` "Permission denied" `__pycache__` = sintaksis o'tgan degani), doira tashqarisi = "doiram emas + bitta buyruq".
- 4-5: diagnostika formati, taxmin ro'yxati taqiqi, blokdan tashqari 7 so'z filtri, "yozib qo'ydim" taqiqi.
- 6-9: REJA tuzilishi (Muammo, Sabab, Yechim), `[REQUEST_APPROVAL]` aniq formati, `edits:` qoidalari (`find` faylda aynan 1 marta, Read natijasidan aynan, marker to'qnashsa boshqa marker, 60000 hajm, `.ts`/`.py` dan boshqa fayllar uchun `test:`), REJA ichida `CHANGELOG.md` va modul bilim fayli edit'i.
- 10-14: xavfsizlik chegaralari, injection, qoida o'zgartirish, halollik (test logi: "reja kodi sinalmagan, bot qo'llashda tsc/py_compile qiladi"), uslub.

`checker.md` (diagnostika; Read/Grep/Glob + git o'qish + py_compile):
- Faqat diagnostika; "tuzat" bo'lsa ham sabab + "Support REJAsi orqali".
- Manbalar tartibi: topshiriqdagi health bloki (12 komponent) -> Facts -> git log -> bilim. Dalil yo'q bo'lsa "tekshiruvda dalil yo'q".
- Javob toza matn, har muammoda nom + identifikator + raqam; alert rejimida matn egasiga to'g'ridan (3 gap: hukm, dalil, kim tuzatadi).
- To'lov tekshiruvi rejimi: blokni komponent tartibida o'qish, UNKNOWN manbani "mos" demaslik, farq kodlari ma'nosi (33 kod, sheet sabablari, XonPay holatlari), javob tuzilmasi (sarlavha, `Xulosa:`, 5 manba jadvali, reja holati, `Farqlar:` + "Nima qilish:", `Guruhga javob:`), texnik kodlarni egasiga ko'rsatmaslik, hisoblamaslik, tuzatishni bajarmaslik. Mijoz ismi to'liq, telefon/pasport/hisob yo'q.

`teacher.md` (uzoq xotira; Read/Grep/Glob, Bash yo'q):
- Yagona yozish joyi `learned.md` (append) va `daily/<sana>.md`; faqat `[WRITE_MEMORY]` blok.
- Rejimlar jadvali: Leader topshirig'i, `[TEACHER FON TOPSHIRIQ — manba: X]` (avval tekshir, `qoida`/`qaror` yozma), KUNLIK/YAKUNIY (learned.md ga 2 blokgacha + daily), MINI (blok yo'q, 3 band).
- Yozuv formati `## YYYY-MM-DD — mavzu` + `Tur:`; TUZATISH yozuvi; 5 tur klassifikatsiyasi.
- Halollik, sir va taxmin yozmaslik, eski yozuvni o'chirmaslik, himoyani bo'shatuvchi qoida yozmaslik (tasdiq oqimi faqat Support REJA orqali o'zgaradi); egasining o'z gapi = FORWARD belgisiz `SHEFIM` qatori.
- Kunlik tahlil jarayoni (SISTEMA bo'yicha halollik tekshiruvi, nomzodlar, kunda 1-2 qoida) va xulosa formati.

### F.24 knowledge/ tuzilmasi

- Statik bilim bazasi (git, deploy bilan yangilanadi), promptga avtomat QO'SHILMAYDI: agent INDEX xaritasidan faylni topib, `Grep "^## "` + Read offset/limit bilan o'qiydi. Faqat REJA orqali o'zgaradi.
- Umumiy fayllar: `README.md` (tuzilma va yozish qoidalari, "Yangi modul qo'shilsa" 6 edit), `imkoniyatlar.md` (agent nima qila oladi; prompt bilan zid kelsa shu fayl to'g'ri), `agentlar.md` (agentlar tizimi, Facts manbalari, schedulerlar izi), `db_schema.md`, `qoidalar.md`, `CHANGELOG.md`, `platforma.md`.
- Modul fayllari: `tranzaksiyalar.md`, `sync.md`, `oplata_kv.md`, `xato.md`, `crm.md`, `sverka.md`, `xonpay.md`, `chek_order.md`, `chek.md`, `eksport.md`, `api.md`, `tolov_tekshirish.md` (o'ziga xos raqamli tuzilma, 7-bo'lim kodlar jadvali testda tekshiriladi), `tuzatish.md` (TR Support).
- `kategoriya.md` bu bot uchun EMAS: backend kategoriya agenti (`backend/src/kategoriya-agent/`) uni `agents/knowledge/kategoriya.md` yo'lidan o'qiydi (2026-10-07); README va INDEX xaritasida yo'q.
- Modul fayli bo'limlari: Vazifasi, Fayllar, API endpointlar, Frontend sahifalar, DB jadvallar, Biznes qoidalar, Bog'liqliklar, Xavfli joylar, Tez-tez o'zgarishlar. Kirill faqat backtick ichida (yonida lotin nomi); README, imkoniyatlar va promptlarda kirill umuman yo'q; emoji yo'q; sir yo'q.

### F.25 deploy/ va ORNATISH.md (o'rnatish)

- `deploy/xon-tranzactions-leader.service`: `User=root`, `WorkingDirectory=/var/www/xon_tranzactions`, `Environment=HOME=/root`, `TZ=Asia/Tashkent`, `LANG=C.UTF-8`, `PYTHONUNBUFFERED=1`, `AGENTS_ENV_FILE=/var/www/xon_tranzactions/backend/.env`, `ExecStart=/opt/xon-tranzactions-leader/venv/bin/python -m agents.leader_bot`, `Restart=always`, `RestartSec=10`, `UMask=0022` (bot yozgan fayllar agentga o'qiladigan), `NoNewPrivileges=yes`, `EnvironmentFile` ATAYLAB yo'q (test tekshiradi). `deploy.sh` bu servisni restart qilmaydi.
- `deploy/install.sh` (root, qayta ishga tushirish xavfsiz, sirsiz): venv `/opt/xon-tranzactions-leader/venv` + `requirements.txt`; `xonagent` tizim foydalanuvchisi (nologin); backend/frontend root ostida bo'lsa `/root` 700 va repo `.env*` 600; agent sirni o'qiy olmasligi va repo/CLI'ni ishlata olishi tekshiruvi; v1 to'qnashuv tekshiruvi; papkalar 755; systemd o'rnatish, enable, restart; oxirida push kaliti tekshiruvi (qo'lda qadam).
- `ORNATISH.md` (egasi uchun, 19 bo'lim): kod, Python va venv, Claude Code CLI (`claude setup-token`), `xonagent` (`safe.directory`, uchta "Permission denied" va uchta "ishlaydi" sinovi), env nomlari, v1 to'qnashuvi (A/B variant), push kaliti (yozish huquqli deploy key, `git remote set-url --push`, repo darajasida git identity; bo'lmasa `BAJARILMADI — commit/push`), DB jadvallari, papkalar va `.gitignore`, nginx (`location ^~ /static/tg_uploads/ { return 404; }`), Facts birinchi ishga tushirish, testlar, systemd, asbob siyosati sinovi, REJA oqimi sinovi, kundalik ishlatish (journalctl, qo'lda modullar, `agent_enabled_<nom>` bilan agentni o'chirish), nosozliklar jadvali, bot root bo'lmasa (sudoers `env_keep`), xavfsizlik eslatmalari.

### F.26 Testlar (agents/tests)

Ishga tushirish: `python3 -m unittest discover -s agents/tests -t .` (repo ildizidan). DB, tarmoq, Telegram va aiogram'siz; git kerak bo'lsa vaqtinchalik repo quriladi; Windows'da POSIX modullari (`fcntl`, `pwd` ...) yo'qligi sabab SkipTest; token ko'rinishidagi literal manbada yo'q (secret scanner push'ni to'xtatmasin).

| Fayl | test | Qamraydi |
|---|---|---|
| `test_payment_check.py` | 192 | parse, normallashtirish, juftlash, jamilar, format, eski CRM klienti (faqat GET, oq ro'yxat, redirect, kesh, kunlik), sirlar, prefetch, statik/sinxronlik (kontrakt satrlari promptlar va bilim fayli bilan harfma-harf, kirillsizlik, INDEX chegarasi), panel ko'prigi, XonPay, egasi xulosasi |
| `test_contract.py` | 51 | regexlar, SISTEMA, ro'yxatlar, sarlavhalar, sezgir yo'llar, egasiga matnlar (kirill va emoji yo'q), promptlar bilan shartnoma |
| `test_reja.py` | 41 | extract, parse, validate, payload/preview (escape, kirill), apply (tmp git repo: commit, qaytarish) |
| `test_leader_reply.py` | 41 | soxta bot bilan oqim: reply_to, reply rasmi, sub-agentga MUHIM KONTEKST, outbox bo'laklari, `recent_photo` uid |
| `test_config.py` | 34 | env parse, DB URL, manba, Settings, `safe_repo_path`, vaqt, ops fayllari (systemd unit, requirements, `.gitignore`, `claude_settings.json`) |
| `test_runner.py` | 24 | env oq ro'yxati, CLI buyrug'i, asbob va model, SISTEMA, memory bloki, soxta CLI bilan end-to-end, root bypass |
| `test_leader_logic.py` | 23 | JSON parse, delegat, xotira, va'da, yolg'on, REACT, lotinlashtirish |
| `test_tuzatish.py` | 19 | parse, oqim, qisqa raqam, aralash ro'yxat, XATO ulash, harf qoidasi, Leader oqimi |
| `test_history.py`, `test_memory_blocks.py` | 17 + 17 | neytrallash, render, topshiriq quruvchilar; bloklar, yo'l, qo'llash |
| `test_bash_guard.py` | 12 | buyruq tekshiruvi, hook main, fail-closed |
| `test_ariza.py`, `test_perebroska.py`, `test_malumot.py`, `test_tarix.py`, `test_eksport.py` | 11, 8, 7, 6, 5 | parse, oqim, Leader orqali oqim, matnli tasdiq |
| `test_checker_oplatykv.py`, `test_checker_jim.py`, `test_checker_disk.py` | 5, 4, 2 | kelajak jim, `sync_xatolar`, jim komponentlar, disk diagnostikasi |

Qamralmagan yoki zaif: `teacher_daily.py`, `support_facts.py` collector'larining aksariyati (faqat `_okv_sync_xatolar`), `checker_worker` ning boshqa tekshiruvlari, `notify.HttpOutbox`.

### F.27 Egasi qarorlari xronologiyasi (kod izohlari va hujjatlardan)

| Sana | Qaror |
|---|---|
| 2026-09-28 | Agentlar faqat Claude Code CLI + setup token, API kalitga ulanmaydi; timeout hammaga 180 s; bypass rejimi; bot kalitlari `backend/.env` da; bot jadvallari `agents` sxemasida; [Ha] = push ruxsati, bot `main` ga o'zi push qiladi; v1 Leader `LEADER_ENABLED=0`; to'lov tekshiruvi: CRM faqat GET o'qiladi, mijoz ismi to'liq |
| 2026-09-29 | XonPay: pul 1-3 bank ish kunida tushadi; CRM va sheetlar panel ko'prigi orqali; `/tolov` javobi oddiy tilda |
| 2026-09-30 | sverka ogohlantirishi jim (`AGENTS_CHECKER_JIM` default); kelajak `updated_at` jim; XATO ro'yxatidagi to'lov bot orqali tahrirlanmaydi (ariza); `shartnoma=XATO` aynan "XATO"; ariza fayli rasm, PDF yoki Word; savol qoidasi (avval savol, keyin raqam) |
| 2026-10-01 | TR Support tasdig'i va variant tanlash tugmasiz, faqat matn; `/eksport`; va'da eslatmasi o'zini ko'paytirmasin |
| 2026-10-03 | harf farqi qoidasi: oxirgi 1-2 harf farqida arizasiz va tasdiqsiz ko'chirish (ortiqcha/tushgan harf ham) |
| 2026-10-05 | XATO to'lovni tasdiq bilan ulash (obyekt bir xil); XATO'da faqat kontragent/kategoriya; aralash ro'yxat; CRM bank hujjat raqami bilan topish; `/hisob`, `/xato` (faqat o'qish); yopishgan "ot" kesish; AI Perebroska bot orqali |
| 2026-10-07 | AI Perebroska tasdiqsiz; OplatyKv sync yoza olmagan to'lovlar Checker'da |
| 2026-10-09 | `/tarix` (backfill) bot orqali, tasdiqsiz; disk ogohlantirishi sababni ko'rsatadi |

### F.28 Xavfsizlik qoidalari (jamlanma)

- Egasi tekshiruvi: har message va callback handlerida shaxsiy chat + egasi ID; `LEADER_TG_ID` kontraktdagi qiymatga teng bo'lmasa bot ishga tushmaydi; `AiogramOutbox` va `HttpOutbox` faqat egasi chatiga yozadi.
- Sirlar: env fayli jarayon env'iga yozilmaydi; agent env'i oq ro'yxat; `ANTHROPIC_API_KEY`, `DATABASE_URL`, bot tokenlari, `XONSAROY_*`, `AGENT_BRIDGE_KEY` agentga o'tmaydi; ko'prik kaliti faqat header'da va xato matnidan o'chiriladi; `Settings.__repr__`, `_safe_err`, `_mask`, `SIR_NAQSHLARI` log/DB/tarixda maskalaydi; egasi matni LLM topshirig'idan oldin maskalanadi; sirli xotira yozuvi rad.
- Agent jarayoni `xonagent` ostida: `backend/.env`, `/root`, push kaliti va bot `/proc` ini o'qiy olmaydi, repo'ga yoza olmaydi.
- Yozish yo'llari: kod faqat REJA + [Ha]; xotira faqat bot (`learned.md` faqat Teacher bloki, fon/forward bloki faqat [Ha]); biznes amal faqat oq ro'yxatdagi loopback ko'prik yo'llari (POST'lar: tx-edit/apply, xato-ariza/submit, exports/run, perebroska/tahlil va yarat, tarix/yukla).
- Prompt injection: forward, reply iqtibosi, fayl, Facts, commit matni ma'lumot; `[SISTEMA` faqat `add_system`; tashqi matn `clean_external`; blok chegaralari (`===`) buziladi.
- Yo'l himoyasi: `safe_repo_path` (REJA parse va yozishdan oldin), `_lexical_ok` (symlink), xesh tekshiruvi, HEAD == origin, alohida `git add`, deploy flock.
- Fayllar: `tg_uploads` 7 kun, nginx'da 404 qatori tavsiya etilgan; ariza/perebroska fayl nomi qat'iy regex va papka tekshiruvi.

### F.29 Tuzoqlar va xavfli joylar

1. Bash heredoc va ko'p qatorli buyruq agentda umuman ishlamaydi: `bash_guard` yangi qator, `<`, `>`, `$`, `|`, `&`, `;`, glob va qavslarni (qo'shtirnoq ichida ham) rad etadi. `cat <<EOF`, `cd ... &&`, `| head`, `git log -- '*.ts'` hammasi rad. Fayl o'zgarishi faqat REJA `edits:` (find/replace) bilan; bot o'zi ham hech qachon shell ishlatmaydi (`shell=False`, argument ro'yxati).
2. Agent `python3 -m py_compile` qilsa `__pycache__` ga yoza olmay exit 1 va "Permission denied" oladi: bu sintaksis xatosi EMAS. Haqiqiy tekshiruvni bot REJA qo'llashda vaqtinchalik nusxada qiladi.
3. `[ ]` -> `( )` aylanishi: `contract.clean_dynamic`, `history.clean_external`, `checker_worker._clean_msg` va `payment_check._toza` (SF._clean + `_bir_qator`, `===` -> `==`) dinamik matndagi kvadrat qavslarni oddiy qavsga aylantiradi. Blokka tushadigan konstantalar (masalan sheet sabab matnlari) `[ ]` siz bo'lishi shart (test tekshiradi), aks holda `[crm]` kabi matn `(crm)` bo'lib qoladi; komponent sarlavhalari `_toza` dan tashqarida quriladi. SISTEMA dinamik maydonlari ham shunday tozalanadi.
4. Kirill: promptlarda kirill yo'q va bo'lmasligi kerak (README qoidasi). Bot egasiga ketadigan matndagi kirillni `<code>`/`<pre>` dan tashqarida lotinga o'giradi: kirill kategoriya nomi `human_reply` da transliteratsiya bo'lib ketadi. `MSG_*`, `SIS_*`, `TOLOV_*` satrlarida kirill bo'lsa test yiqiladi.
5. Owner-only tekshiruvi har yangi handlerga qo'lda qo'shilishi kerak (`_is_owner_private` va forward bo'lsa `on_text`); yangi buyruq `_register` da `~F.forward_origin` bilan ro'yxatga olinadi.
6. Mashina qatorlari delegatsiyadan va bir-biridan ustun, tartib: TARIX > PEREBROSKA > HISOB/XATO_FAYL > EKSPORT > ARIZA > TUZATISH. Leader javobida ikkitasi bo'lsa faqat birinchisi ishlaydi.
7. Forward manbali amallar: imkoniyatlar.md "forward'dan chiqqan amal har doim tasdiq bilan" deydi, lekin kod mashina qatori yo'lida `is_fwd` ni tekshirmaydi. PEREBROSKA (tasdiqsiz yaratish), TARIX (tasdiqsiz backfill) va harf qoidasidagi TUZATISH (tasdiqsiz ko'chirish) uchun himoya faqat Leader promptiga tayanadi.
8. Qisqa matnli tasdiq: 10 daqiqa ichida bitta TR Support so'rovi kutayotgan bo'lsa, egasining boshqa maqsaddagi qisqa "ok", "ha", "yubor", "davom et" javobi ham uni tasdiqlaydi. Bir nechta kutilsa reply talab qilinadi.
9. Fon TR Support vazifalari (`tuzatish._bajar`, `ariza._yubor` 240 s, `eksport._run` 600 s, `tarix._kuzat` 3600 s) `_source_watcher` kechiktirish shartiga kirmaydi: `agents/*.py` commiti (deploy) botni o'ldirsa natija xabari yo'qoladi (backend ishni davom ettiradi; tarix uchun `/tarix holat` qoladi). Restart REJA ijrosini kutadi, egasi suhbatini ko'pi bilan 900 s.
10. Modul bog'liqligi: `ariza`, `eksport`, `malumot`, `perebroska`, `tarix` hammasi `tuzatish` ni import qiladi; `payment_check` `checker_worker` va `support_facts` ni import qiladi. Bittasi buzilsa bir nechta funksiya o'chadi; `_mod` xatoni restartgacha keshlaydi.
11. `cleanup_old` faqat `sup_appr_*` va `tw_appr_*` ni tozalaydi: `tz_/ar_/ek_` appr va run, `ek_roy_`, `sup_run_`/`sup_done_`, `pb_yaratildi_`, `tolov_crm_<sana>` kalitlari `kv_store` da to'planib boradi.
12. INDEX.md 12000 belgidan keyin jim kesiladi; hozir 11946 belgi, test chegarasi 11950: yangi qator qo'shish uchun boshqasini qisqartirish shart.
13. Timeout (180 s) bo'lsa javob butunlay yo'qoladi. Hodisa (2026-10-03): egasi harf qoidasini "yangi qoida" deb yozganda Leader uni Support'ga yuborgan va timeout bo'lgan; endi leader.md bu `tx_edit` ekanini aytadi. Uzun REJA uchun `AGENT_TIMEOUT_S_SUPPORT`.
14. Bitta tokenda bitta `getUpdates`: v1 Leader yoqilsa 409 va ikki javob; bot startda to'qnashuvni ko'rsa ishga tushmaydi.
15. Bot jadvallari `public` da bo'lsa keyingi backend deploy (`prisma db push --accept-data-loss`) ularni o'chiradi.
16. `agents/*.py` commiti deploy uchun "ildiz fayl": frontend va backend to'liq qayta quriladi (5-8 daqiqa); `.md` commiti restartsiz. `deploy.sh` leader servisini restart qilmaydi, bot o'zi `os._exit(0)` qiladi; qo'lda `git reset --hard` bo'lsa servisni qo'lda restart qilish kerak.
17. `deploy.sh` deploy qulfini atigi 60 s kutadi: bot qulfni faqat yozish, commit va push paytida ushlaydi (tsc paytida emas) va push'dan keyin darhol bo'shatadi.
18. REJA uchun lokal HEAD origin/main ga teng bo'lishi shart (aks holda `branch`): bot tasdiqsiz commitlarni push qilib yubormasin. Serverda qo'lda commit qolsa REJA'lar ishlamaydi.
19. `deploy_log.json` ni `deploy.sh` hali yozmaydi: Facts va Checker `deploy.log` oxiridan o'qiydi; ikkalasi yo'q bo'lsa natija noma'lum (unknown), "o'tdi" deyilmaydi.
20. Facts SQL'da `NOW()` yo'q (DB soati ilova soatidan farq qiladi); vaqt parametri Python'dan. `oplata_kv.date` va `@db.Date` ustunlariga sana literal.
21. Izohsiz PDF ham "Rasmni oldim" deydi va `recent_photo` ga tushadi; Word faylni agent o'qiy olmaydi (faqat ariza fayli sifatida biriktiriladi). Albomning kechikkan qismi e'tiborsiz.
22. `/status` faqat reja va Teacher tasdiqlarini sanaydi, TR Support kutilayotgan tasdiqlari ko'rinmaydi.
23. `memory/leader-runtime.md` va `learned.md` gitda yo'q: deploy ularga tegmaydi, lekin ular serverda eskirgan yozuv saqlashi mumkin. Egasi eslatmasi: serverdagi `learned.md` da "CRM raqami /tuzat uchun yetmaydi" degan eskirgan (2026-10-05 dan beri noto'g'ri) yozuv bor.
24. `/hisob` javobi kontragent direktori, manzili va telefonini ham ko'rsatadi: bu Facts maxfiylik qoidasidan farqli, faqat egasining shaxsiy chatida.
25. `knowledge/agentlar.md` va `imkoniyatlar.md` 5-bo'limi (bot buyruqlari) hali faqat `/start /status /health /reset /tolov` ni sanaydi va "domen intenti bitta" deydi: eskirgan, kod va `leader.md` 4-5, 13-bo'limlari to'g'ri.

### F.30 Bog'liqliklar: "X o'zgarsa Y ham"

- `contract.py` dagi har satr (SISTEMA, sabablar, va'da, xotira triggeri, REACT nomlari, JSON kalitlari, blokisiz so'zlar, REJA markerlari, Teacher sarlavhalari, Checker/TOLOV blok sarlavhalari, TR Support qatorlari) o'zgarsa -> `leader.md`, `support.md`, `checker.md`, `teacher.md`, `imkoniyatlar.md`, `tolov_tekshirish.md`/`tuzatish.md` dagi jufti shu commitda (testlar harfma-harf tekshiradi).
- Yangi TR Support intenti -> `contract.py` (`INTENT_*`, `*_RE`, ko'prik yo'li), `tuzatish._YOLLAR`, `leader_bot._leader_turn` kancasi (tartib), kerak bo'lsa `/buyruq` va `_register`, `_matn_tasdiq` va `/reset` (`kutilayotgan`, `purge_pending`), `SEZGIR_PREFIKSLAR`, `leader.md` 4-5, 13-bo'limlari, bilim fayli, test; backend `agent-bridge` controller/guard/validation.
- `support_facts.build_facts` kaliti o'zgarsa -> INDEX "Qayerga qarash", `leader.md` 9, `support.md` 4, `checker.md` "Facts kalitlari", `imkoniyatlar.md` 4.1, `agentlar.md` "Facts manbalari"; Checker shu kalitlarni o'qiydi (`_facts_section`).
- `checker_worker.CHECKS` o'zgarsa -> `checker.md` (12 komponent nomi va tartibi).
- `payment_check` juftlash/normallashtirish -> backend `crm.service.ts`, `crm-sverka.service.ts`, `contract-parser.ts` bilan qo'lda moslanadi (kod bog'lanmaydi).
- `backend/src/leader/leader-facts.service.ts::clean` naqshlari -> `support_facts._clean` (Python nusxasi).
- `scripts/deploy.sh` lock/log yo'li -> `config.py` `DEPLOY_LOCK_DEFAULT`, `DEPLOY_LOG_DEFAULT`.
- `backend/prisma/schema.prisma` va `db push` -> bot jadvallari `agents` sxemasida qolishi shart.
- `runner.agent_disallowed_tools`, `claude_settings.json`, `bash_guard.py` o'zgarsa -> `imkoniyatlar.md` 1-3, INDEX "Asboblar chegarasi", promptlardagi asbob bo'limlari.
- INDEX "Modullar xaritasi" o'zgarsa -> `leader.md` 19-bo'lim (bir xil).

## G. Atamalar lug'ati

| Atama | Ma'nosi |
|---|---|
| OplatyKv (panelda "ОплатыКв") | `oplata_kv` jadvali: kvartira shartnomalari bo'yicha to'lovlar reestri. Bank tranzaksiyasidan (`source_tx_id`) yoki qo'lda/Excel'dan. Loyihaning eng muhim jadvali. |
| CLIENT | Top kategoriya "Клиент / Физ.Л / Юр.Л" kodi. Faqat shu kontragentdagi shartnomali to'lov OplatyKv'ga tushadi. |
| Kontragent / Kategoriya | Kontragent = top kategoriya (`category.parentId=null`), Kategoriya = subkategoriya (masalan "Взносы за квартиры", "За счетчик"). |
| XATO | Shartnoma raqami CRM'da (`crm_contracts.found=true`) aniq topilmagan to'lov. Ikki ta'rif bor: tranzaksiya tomoni va OplatyKv tomoni (`buildXatoFilter`) — C.1, D.0. Literal `XATO` ham shartnoma sifatida yoziladi ("XATO deb belgilash"). |
| Ariza | XATO to'lovni to'g'ri shartnomaga ulash so'rovi (fayl bilan): `xato_correction_requests`, holat pending → approved/rejected. |
| AI tekshiruvchi | Arizani Claude vision bilan tekshiradigan backend agenti (nomi sozlamadan `agent.aiName`): obyekt qoidasi, ism, imzo. |
| Split (FIRST/MONTHLY) | OplatyKv to'lovini boshlang'ich va oylik qismlarga ajratish (CRM grafigi bo'yicha waterfall). |
| Schotchik | "За счетчик" to'lovlari; avto-rejimda OplatyKv'da oylikka o'tkaziladi. |
| Perebroska (Переброска) | Bir shartnomadan boshqasiga pul o'tkazish: manba minus, maqsad plus qatorlar, `PerereboskaGroup`. AI Perebroska — arizani agent o'qiydi. |
| Vznos ("Взнос от имени клиента") | O'z shartnomalarimiz reestri (tushum emas). |
| Sverka | Solishtirish: bank sverka (bank ↔ `transactions`) va CRM sverka (CRM payment-history ↔ OplatyKv). |
| Backfill (eski tarixni yuklash) | Tanlangan sanalar vipiskasini bankdan qayta olish; faqat qo'shadi, o'chirish/o'zgartirish aniqlash va qoldiq o'chiq. |
| Change detection | Oddiy sync'da bank javobini DB bilan solishtirish: DELETED, EDITED, MOVED (sana ko'chgan, ±3 kun tekshiruv). |
| Kompozit ID (`external_id`) | `[prefiks]general_id_num_dd.mm.yyyy_accCt_accDt_tiyin_sign` (sign `-` kirim, `+` chiqim; Ipak `IP_`, Hamkor `HB_`). |
| `bank_general_id` | Bank hujjat raqami (CRM'da `<raqam>/<sana>` ko'rinishida chiqadi). |
| Toshkent kuni | `txn_date` UTC saqlanadi; kunni olishda Toshkent (UTC+5) kuniga o'tkazish shart (`tashkentKun`). |
| TR Support | Bot orqali to'lovni tuzatish va boshqa amallar (tahrir, ariza, hisob, XATO fayli, perebroska, tarix); panelda Klient · XATO > TR Support tabi (kirish kodi bilan), tarix va ortga qaytarish. |
| Harf farqi qoidasi | XATO to'lovda to'g'ri shartnoma faqat oxirgi 1-2 harfi bilan farq qilsa (CRM'da aniq) — arizasiz va tasdiqsiz ko'chiriladi. |
| XATO ulash | XATO to'lovni CRM'da aniq, obyekti bir xil shartnomaga mas'ul tasdig'i bilan ulash (ariza o'rniga). |
| agent-bridge | Backend'dagi ichki ko'prik: faqat loopback, `x-agent-bridge-key` header, proxy header'siz; bot faqat shu orqali yozadi. |
| Facts | `agents/state/support_facts.json`: bot har 5 daqiqada bazadan yig'adigan jonli holat (bo'limlar F.12). |
| Checker | Health tekshiruvlari (12 komponent) va to'lov tekshiruvi agenti. |
| Support REJA | Kod o'zgartirish rejasi (`[REQUEST_APPROVAL]`), egasi [Ha] bossa bot qo'llab `main` ga push qiladi. |
| Teacher | Xotira agenti: `learned.md` va kunlik xotira; fon yozuvlari egasi tasdig'i bilan. |
| Sync xatolari (`yozilmadi`) | OplatyKv sync yoza olmagan to'lovlar sabab bilan (`settings oplatykv.syncXatolar`), Checker ko'rsatadi. |

## H. Ma'lum xavflar va kamchiliklar (2026-10-10 ko'rib chiqish, OCHIQ)

Kodni o'qib topilgan, ishlatib tekshirilmagan. Hech biri hali tuzatilmagan — tuzatish egasi qarori bilan. Sir qiymatlari yozilmagan.

### Xavfsizlik
- **Sirlar git'da:** `scripts/deploy.sh`, `scripts/xt-forwarder.php`, `scripts/bank-proxy.php` ichida qiymatlar bor (A.13). Ularni server `.env` ga ko'chirish va almashtirish kerak.
- **Brauzerga to'liq sir qaytaradigan endpointlar:** `GET /sverka-telegram/bot-token` (maskadan tashqari to'liq), `GET /chek/tg-config`, `/chek/hr-config`, api-explorer forwarder secret (B.8, D.8, A.16, E.13).
- **Kirish kodlari frontend JS'da:** bir nechta "kod bilan ochiladigan" bo'limlar kodni brauzerda tekshiradi (E.10) — kodni JS faylidan o'qish mumkin. TR Support kodi esa serverda tekshiriladi.
- **`agent.listToken`** (public XATO ro'yxati havolasi kaliti) ochiq matnda, almashtirilmaydi; u bilan ariza yuborish va fayllarni o'qish mumkin (D.3).
- **chek-order Telegram mehmoni** `chekorder:manage` oladi: tarixni o'chirish (`DELETE /api/chek-order`) va OplatyKv split yozish mumkin (D.7).
- **agent-team `/chat`** egasining shaxsiy suhbatini `agent:view` bor har kimga ko'rsatadi (D.9).
- **Backup** shifrsiz ZIP sifatida Telegram'ga ketadi, ichida bazadagi tokenlar va parol hash'lari bor (A.14).
- **IP ishonchi:** audit, API kalit IP ro'yxati va forwarder `X-Forwarded-For` ning birinchi qiymatiga ishonadi (soxtalashtirish mumkin) (A.8, A.15).
- **`/_deploy/status`, `/_deploy/health`, `/_deploy/hamkor-diag`** login'siz ochiq; webhook branch'ni tekshirmaydi (A.10).
- **Bot:** forward qilingan xabardan chiqqan `PEREBROSKA`/`TARIX`/harf-qoidasi amallari kodda tasdiqsiz bajariladi — "forward amali tasdiq bilan" qoidasi faqat promptda (F.3, F.29).

### Ruxsatlar
- 28 ta ruxsat kaliti backend'da umuman tekshirilmaydi (faqat UI): masalan `import:run`, `sync:settings_edit`, `transactions:manual_edit`, `dashboard:*` (A.4).
- Seed `ALL_PERMS` da 97 kalitdan 62 tasi bor — yangi ruxsat SUPERADMIN'ga tushmasligi mumkin (A.7).
- `RolesGuard` eski enum'ni tekshiradi; `cleanup-by-account`, `count-by-account` amalda ishlamasligi mumkin. JWT global emas: guard'i unutilgan controller ochiq (A.3, A.4).
- OplatyKv'da bir nechta yozuvchi endpoint faqat ko'rish ruxsatini talab qiladi (`crm-status/reset-empty`, `repair-mojibake`, `crm-meta/backfill`, XonPay `zaxira-match`, `mark-duplicates`, `cron/toggle`), `GET debug-xato-splits` ma'lumot o'zgartiradi, `arizas-zip` `oplatakv:view` bilan barcha fayllarni beradi (C.11).
- Frontend route-guard bo'shliqlari: `/vznos`, `/chek-order`, `/profile` qoidasiz; ko'p tugmalar faqat backend himoyasida (E.13).

### Ma'lumot to'g'riligi
- **Toshkent kuni siljishi:** `reconcile(withSync)` va `diagnoseDay`, `dailyBreakdown`, `statement.service::fmtDate` bir kun oldingi sanani olishi mumkin (B.7, B.16).
- `upsertOne` OR shartida `b2_id` bo'sh bo'lsa bo'sh shart hosil bo'lib boshqa qatorga mos kelishi mumkin (B.5).
- `reparseJunkContracts` CRM'da yo'q nomzodni ham "tuzatildi" deb yozishi mumkin; `backfillSchotchik` izohida "счетчик" bor har to'lovni CLIENT qiladi (B.10).
- XATO ikki ta'rifi (`buildXatoFilter` va `computeContractXato`) qo'lda shartnoma va `xatoHidden` bo'yicha farq qiladi; `cleanupXatoContracts` bitta tugma bilan qo'lda qatorlarni ham o'chiradi; sync summa yoki shartnomani o'zgartirsa split qayta hisoblanmaydi; `agentNotifiedAt` yozilmaydi (C.11).
- Universal API delta-feed: `deletePerereboskaGroup` va `cleanupSplitsForXatoContracts` o'chirish/o'zgarishni (`updated_at`) bildirmaydi (C.11).
- `directCorrect` tranzaksiyada kutilayotgan BOSHQA arizani tasdiqlab yuborishi mumkin; correction-bot shartnomani arizasiz, obyekt tekshiruvisiz, CRM'da yo'q raqam bilan ham yozadi (D.1, D.4).
- AI tekshiruvchi: yangi ariza ish soati/interval tekshiruvisiz darhol ko'riladi; restartda `agentState='processing'` da qotgan arizalar tozalanmaydi; `.doc` faylni o'qiy olmaydi (D.2).

### Barqarorlik va UX
- `agents/*.py` deploy'da bot qayta ishga tushsa fon vazifalari (apply, ariza kutish, eksport, tarix kuzatuvi) uziladi, natija xabari kelmaydi (F.29). Tarix uchun `/tarix holat` bor.
- "ok", "ha" kabi qisqa javob yagona kutilayotgan TR Support so'rovini tasdiqlaydi (10 daqiqa ichida) (F.14).
- `kv_store` da `sup_appr_*`, `tw_appr_*` dan boshqa tasdiq/run kalitlari tozalanmaydi (F.7).
- Frontend `AuthGuard` har sahifa almashganda `/auth/me` so'raydi va xatoda sessiyani o'chiradi — deploy restartida foydalanuvchi chiqib ketadi; AI Perebroska va AddFromTx eski react-query kalitini yangilaydi, jadval yangilanmaydi; tranzaksiya KPI sparkline'lari va profil "Login tarixi" soxta ma'lumot (E.13).
- "Deploy OK" Telegram xabari backend restartidan oldin ketadi; deploy status sahifasi ko'pincha "running" da qotib qoladi (A.10, A.11).
- Bazada `sync_logs`, `audit_logs` va tarix jadvallari tozalanmaydi (retention yo'q) — disk o'sadi (A.21).
- `agents/memory/INDEX.md` hajm chegarasiga juda yaqin (12000 belgidan keyingisi jim kesiladi); `knowledge/agentlar.md` va `imkoniyatlar.md` buyruqlar va intentlar bo'yicha eskirgan (F.24).
