# Xon Tranzaksiyalar

Umumiy to'lovlar va tranzaksiyalar monitoring tizimi.

**Stack:** NestJS 10 · Prisma 5 · PostgreSQL · TypeScript

## Tuzilish

```
src/
├── main.ts                      # Entry point (Swagger, ValidationPipe)
├── app.module.ts                # Root module
├── common/
│   └── prisma/                  # PrismaService (DB ulanish)
├── transactions/                # Tranzaksiyalar API
│   ├── transactions.controller.ts
│   ├── transactions.service.ts
│   └── dto/
└── server-core/                 # Bank/UPC integratsiya (Cron sync)
prisma/
└── schema.prisma                # DB sxema (Transaction, Bank, Category, SyncLog)
```

## Boshlang'ich sozlash

### 1. Dependency'lar
```bash
npm install
```

### 2. Environment
```bash
cp .env.example .env
# .env'da DATABASE_URL ni o'z PostgreSQL ga moslang
```

### 3. PostgreSQL DB
```bash
# Lokalda postgres ishga tushgan bo'lsa:
createdb xon_tranzactions

# Prisma migration
npm run prisma:generate
npm run prisma:migrate
```

### 4. Ishga tushirish
```bash
# Dev rejim (watch + reload)
npm run start:dev

# Production
npm run build
npm run start:prod
```

API: `http://localhost:3001/api`
Swagger: `http://localhost:3001/docs`

## Endpoints (boshlang'ich)

| Method | Path | Mazmun |
|---|---|---|
| GET | `/api/transactions` | Tranzaksiyalar ro'yxati (filter + page) |
| GET | `/api/transactions/stats` | Statistika (IN/OUT, jami summa) |
| GET | `/api/transactions/:id` | Bitta tranzaksiya tafsilot |

## Server Core sync

`server-core` modul har 5 daqiqada bankdan tranzaksiyalarni avto-oladi:
- Cron: `.env` da `TXN_SYNC_CRON`
- URL: `.env` da `TXN_CORE_URL`
- Token: `.env` da `TXN_CORE_TOKEN`

`sync_logs` jadvalida har sync yozuv qoladi (status, fetched, saved).

## Deploy (productionga)

Server: `/var/www/xon_tranzactions/`

```bash
# Server'da
cd /var/www/xon_tranzactions
git pull
npm ci
npm run prisma:deploy
npm run build
systemctl restart xon-tranzactions   # systemd service
```

## Litsenziya

Xususiy · Xon Saroy
