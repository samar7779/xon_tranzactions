#!/bin/bash
# Xon Tranzaksiyalar — birinchi marta server'da sozlash skripti.
# Root sifatida ishlatiladi. Bir marta bajariladi.
#
# Talab qilinadiganlar:
#   - Ubuntu 22.04 yoki yangiroq
#   - Internet ulanish
#   - SSH key bilan kirgan root foydalanuvchi
#
# Foydalanish:
#   curl -fsSL https://raw.githubusercontent.com/samar7779/xon_tranzactions/main/scripts/setup-server.sh | bash
#  YOKI server'da repo clone qilingach:
#   sudo bash /var/www/xon_tranzactions/scripts/setup-server.sh
set -eu

REPO_URL="${REPO_URL:-https://github.com/samar7779/xon_tranzactions.git}"
REPO_DIR="${REPO_DIR:-/var/www/xon_tranzactions}"
BRANCH="${BRANCH:-main}"

echo "━━━ Xon Tranzaksiyalar — server setup ━━━"
echo "Repo:    $REPO_URL"
echo "Papka:   $REPO_DIR"
echo "Branch:  $BRANCH"
echo

# 1. Tizim paketlari
echo "→ 1/8 Tizim yangilash + paketlar"
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release sudo git build-essential nginx postgresql postgresql-contrib

# 2. Node.js 20 (NodeSource)
if ! command -v node >/dev/null 2>&1; then
  echo "→ 2/8 Node.js 20 o'rnatish"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "→ 2/8 Node $(node -v) allaqachon o'rnatilgan"
fi

# 3. PostgreSQL DB + foydalanuvchi
echo "→ 3/8 PostgreSQL: foydalanuvchi va DB yaratish"
DB_USER="${DB_USER:-xontranz}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -d '=+/')}"
DB_NAME="${DB_NAME:-xon_tranzactions}"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

# 4. Repo
echo "→ 4/8 Repository clone/pull"
mkdir -p "$(dirname "$REPO_DIR")"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --all
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# 5. .env fayllar
echo "→ 5/8 .env fayllar"
JWT_SECRET="$(openssl rand -hex 64)"
CRED_ENC_KEY="$(openssl rand -base64 32)"
GH_DEPLOY_SECRET="$(openssl rand -hex 32)"

if [ ! -f "$REPO_DIR/backend/.env" ]; then
  cat > "$REPO_DIR/backend/.env" <<ENV
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}?schema=public"
PORT=3001
NODE_ENV=production
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="12h"
CRED_ENC_KEY="${CRED_ENC_KEY}"
KAPITALBANK_API_URL="https://m.bank24.uz:2713/Mobile.svc"
KAPITALBANK_TIMEOUT_MS=15000
TXN_SYNC_CRON="*/5 * * * *"
TXN_SYNC_DAYS_BACK=1
CORS_ORIGIN="*"
SWAGGER_PATH="docs"
SEED_ADMIN_EMAIL="admin@xon.local"
SEED_ADMIN_PASSWORD="ChangeMe!2026"
SEED_ADMIN_NAME="Bosh Admin"
# Deploy webhook
GH_DEPLOY_SECRET="${GH_DEPLOY_SECRET}"
DEPLOY_REPO_DIR="${REPO_DIR}"
DEPLOY_BRANCH="${BRANCH}"
DEPLOY_BACKEND_SERVICE="xon-tranzactions-backend"
DEPLOY_FRONTEND_SERVICE="xon-tranzactions-frontend"
DEPLOY_LOG="/var/log/xon-tranzactions/deploy.log"
# Telegram (ixtiyoriy)
TG_BOT_TOKEN=""
DEPLOY_NOTIFY_CHAT=""
ENV
  echo "  ✓ backend/.env yaratildi"
else
  echo "  ⚠ backend/.env mavjud, qaytadan yaratilmadi"
fi

if [ ! -f "$REPO_DIR/frontend/.env.local" ]; then
  cat > "$REPO_DIR/frontend/.env.local" <<ENV
NEXT_PUBLIC_API_URL="http://localhost:3001/api"
ENV
  echo "  ✓ frontend/.env.local yaratildi"
fi

# 6. Backend o'rnatish
echo "→ 6/8 Backend npm ci + migrate + build + seed"
cd "$REPO_DIR/backend"
npm ci --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
npm run build
npm run seed || true

# 7. Frontend o'rnatish
echo "→ 7/8 Frontend npm ci + build"
cd "$REPO_DIR/frontend"
npm ci --no-audit --no-fund
npm run build

# 8. Systemd + sudoers + nginx
echo "→ 8/8 Systemd service'lar + sudoers + nginx"
cp "$REPO_DIR/scripts/systemd/xon-tranzactions-backend.service" /etc/systemd/system/
cp "$REPO_DIR/scripts/systemd/xon-tranzactions-frontend.service" /etc/systemd/system/

# www-data ga restart huquqi
cat > /etc/sudoers.d/xon-tranzactions <<SUDOERS
# Xon Tranzaksiyalar — webhook o'zini restart qilish uchun
root ALL=(root) NOPASSWD: /bin/systemctl restart xon-tranzactions-backend, /bin/systemctl restart xon-tranzactions-frontend
SUDOERS
chmod 440 /etc/sudoers.d/xon-tranzactions

chmod +x "$REPO_DIR/scripts/deploy.sh"
mkdir -p /var/log/xon-tranzactions
touch /var/log/xon-tranzactions/deploy.log

# nginx — agar config yo'q bo'lsa
if [ ! -f /etc/nginx/sites-available/xon-tranzactions ]; then
  cp "$REPO_DIR/scripts/nginx/xon-tranzactions.conf" /etc/nginx/sites-available/xon-tranzactions
  ln -sf /etc/nginx/sites-available/xon-tranzactions /etc/nginx/sites-enabled/xon-tranzactions
  nginx -t && systemctl reload nginx
fi

systemctl daemon-reload
systemctl enable --now xon-tranzactions-backend xon-tranzactions-frontend

echo
echo "━━━ TAYYOR ━━━"
echo "Backend: http://localhost:3001/api"
echo "Swagger: http://localhost:3001/docs"
echo "Frontend: http://localhost:3000"
echo
echo "GitHub webhook URL'i (Settings → Webhooks):"
echo "  Payload URL: https://<sizning-domain>/api/_deploy"
echo "  Content type: application/json"
echo "  Secret: ${GH_DEPLOY_SECRET}"
echo "  Events: Just the push event"
echo
echo "Birinchi admin: admin@xon.local / ChangeMe!2026"
echo "DB foydalanuvchi: ${DB_USER} / ${DB_PASS}"
echo
echo "Statuslar:"
systemctl --no-pager --lines=3 status xon-tranzactions-backend xon-tranzactions-frontend || true
