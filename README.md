# Xon Tranzaksiyalar

Xon Saroy uchun banklar tranzaksiyalari monitoring tizimi. Admin panel orqali bank API'lariga login/parol kiritiladi, tizim avtomatik ravishda har 5 daqiqada banklardan tranzaksiyalarni olib turadi.

**Stack:**
- **Backend** — NestJS 10 · Prisma 5 · PostgreSQL · TypeScript
- **Frontend** — Next.js 14 (App Router) · Tailwind CSS · shadcn/ui · next-intl
- **Auth** — JWT (admin) · AES-256-GCM (bank credentiallari shifrlash)
- **Bank API** — KapitalBank OpenAPI v3 (yo'riqnoma `tz/KapitalAPI V3.pdf`)

## Tuzilish

```
xon_tranzactions/
├── backend/                # NestJS API + Prisma
│   ├── src/
│   │   ├── auth/                       # JWT login + guard
│   │   ├── admin-users/                # Adminlar CRUD
│   │   ├── banks/                      # Banklar (KapitalBank, …)
│   │   ├── bank-credentials/           # Bank login/parol (shifrlangan)
│   │   ├── bank-accounts/              # Kuzatiladigan hisoblar
│   │   ├── transactions/               # Tranzaksiyalar API
│   │   ├── integrations/kapitalbank/   # KapitalBank V3 klient
│   │   ├── sync/                       # Cron sync + manual sync
│   │   └── common/{prisma,crypto}/     # Umumiy
│   └── prisma/{schema.prisma,seed.ts}
├── frontend/               # Next.js admin panel (uz/ru/en)
│   ├── app/[locale]/
│   │   ├── login/                      # Login sahifa
│   │   └── (panel)/                    # Admin panel (auth bilan)
│   │       ├── dashboard/              # Bosh sahifa (statistika)
│   │       ├── transactions/           # Tranzaksiyalar ro'yxati
│   │       ├── accounts/               # Bank hisoblari CRUD
│   │       ├── credentials/            # Bank ulanishlari CRUD
│   │       ├── banks/                  # Banklar ro'yxati
│   │       ├── sync-logs/              # Sync tarixi
│   │       └── admin-users/            # Adminlar (SUPERADMIN)
│   ├── components/{ui,...}             # shadcn/ui komponentlar
│   ├── i18n/messages/{uz,ru,en}.json
│   └── lib/{api,auth,utils}.ts
└── tz/KapitalAPI V3.pdf    # Bank API yo'riqnomasi
```

## Boshlang'ich sozlash

### 1. Talablar
- **Node.js 20+**
- **PostgreSQL 14+**
- **npm** yoki **pnpm**

### 2. Backend

```bash
cd backend

# 1. dependency'lar
npm install

# 2. env
cp .env.example .env
# .env'da DATABASE_URL, JWT_SECRET va CRED_ENC_KEY ni almashtiring
# - JWT_SECRET:  openssl rand -hex 64
# - CRED_ENC_KEY: openssl rand -base64 32   (32 byte!)

# 3. DB tayyorlash
createdb xon_tranzactions   # yoki o'zingiz xohlagancha
npx prisma migrate dev --name init

# 4. Birinchi admin + Kapitalbank yozuvini yaratish
npm run seed
# → admin@xon.local / ChangeMe!2026 (default — .env'da o'zgartiring)

# 5. Ishga tushirish
npm run start:dev
# → http://localhost:3001/api
# → Swagger: http://localhost:3001/docs
```

### 3. Frontend

```bash
cd frontend

# 1. dependency'lar
npm install

# 2. env
cp .env.example .env.local
# NEXT_PUBLIC_API_URL backend manzili (default: http://localhost:3001/api)

# 3. dev rejimi
npm run dev
# → http://localhost:3000  (uz/ru/en avtomatik)
```

## Ishlash sxemasi

1. Admin `/<locale>/login` orqali kiradi (default: `admin@xon.local`).
2. **Banklar** sahifasida tizim oldindan KapitalBank yozuvini yaratib qo'yadi.
3. **Bank ulanishlari** ga API login/parolni qo'shadi. Parol AES-256-GCM bilan shifrlanadi.
4. **Tekshirish** tugmasi — `APILogin` chaqirib, ulanish ishlayotganini tasdiqlaydi va bank tomonidagi `Client.id` ni avto-saqlaydi.
5. **Hisoblar** sahifasiga kuzatiladigan hisob raqamlarini qo'shadi (har bir hisob → bitta credential bilan bog'liq).
6. **Cron** har 5 daqiqada (`TXN_SYNC_CRON`) faol hisoblar bo'yicha `GetDoc1C` chaqirib, yangi tranzaksiyalarni DB ga upsert qiladi.
7. **Bosh sahifa**'da statistika va so'nggi tranzaksiyalar, **Tranzaksiyalar** sahifasida to'liq filter + qidiruv.
8. **Sync tarixi** sahifasida har bir sync uchun fetched/saved/errors.

## Production deploy

### Birinchi marta server'da sozlash

Server: `/var/www/xon_tranzactions/` (yangi Ubuntu 22.04+).

```bash
# Server'da (root sifatida) — bir marta
curl -fsSL https://raw.githubusercontent.com/samar7779/xon_tranzactions/main/scripts/setup-server.sh | bash
```

Skript bajaradi:
- Node.js 20 + PostgreSQL o'rnatish
- DB va foydalanuvchi avto-yaratish
- Repo clone qilish
- `.env` fayllarni avto-generatsiya (JWT_SECRET, CRED_ENC_KEY, GH_DEPLOY_SECRET)
- Backend + frontend build + migrate + seed
- Systemd service'lar: `xon-tranzactions-backend`, `xon-tranzactions-frontend`
- Nginx reverse proxy + sudoers (webhook o'zini restart qilish uchun)

Skript oxirida `GH_DEPLOY_SECRET` chiqaradi — uni GitHub Webhook sozlamalariga qo'ying.

### Avto-deploy (GitHub webhook — xonapp pattern)

Har push paytida server o'zini avtomatik yangilaydi.

1. GitHub repo → **Settings → Webhooks → Add webhook**:
   - **Payload URL:** `https://<sizning-domain>/api/_deploy`
   - **Content type:** `application/json`
   - **Secret:** server `.env` dagi `GH_DEPLOY_SECRET`
   - **Events:** Just the push event

2. Test: `curl https://<domain>/api/_deploy/health` → `{"ok": true, ...}`

3. Har push'dan keyin:
   - Backend `/_deploy` endpoint HMAC-SHA256 ni tekshiradi
   - Fonda `scripts/deploy.sh` ishga tushadi (smart restart — faqat o'zgargan tomon)
   - `git fetch + reset → npm ci → prisma migrate → build → systemctl restart`
   - Telegram'ga natija yuboriladi (agar `TG_BOT_TOKEN` sozlangan bo'lsa)

Manual log: `GET /api/_deploy/log` (admin token) yoki `tail -f /var/log/xon-tranzactions/deploy.log`.

### KapitalBank IP whitelist

Production server statik IP'sini KapitalBank oq ro'yxatiga qo'shing (bank filialiga so'rov).

## Litsenziya

Xususiy · Xon Saroy
