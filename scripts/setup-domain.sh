#!/bin/bash
# Xon Tranzaksiyalar — domen + SSL sertifikat sozlash
# transactions.xonapps.uz uchun nginx config + Let's Encrypt sertifikat.
#
# Foydalanish:
#   bash /var/www/xon_tranzactions/scripts/setup-domain.sh
#  Yoki boshqa domen uchun:
#   DOMAIN=mydomain.example.com bash setup-domain.sh
set -eu

DOMAIN="${DOMAIN:-transactions.xonapps.uz}"
EMAIL="${ADMIN_EMAIL:-admin@xonapps.uz}"
REPO_DIR="${REPO_DIR:-/var/www/xon_tranzactions}"

echo "━━━ Domen sozlash: $DOMAIN ━━━"

# 1. certbot o'rnatish
if ! command -v certbot >/dev/null 2>&1; then
  echo "→ certbot o'rnatilmoqda"
  apt-get update -y
  apt-get install -y certbot python3-certbot-nginx
fi

# 2. Nginx config'ni domen uchun moslash va o'rnatish
CONFIG_SRC="$REPO_DIR/scripts/nginx/xon-tranzactions.conf"
CONFIG_DST="/etc/nginx/sites-available/xon-tranzactions"

if [ ! -f "$CONFIG_SRC" ]; then
  echo "✗ Config topilmadi: $CONFIG_SRC"
  exit 1
fi

# server_name'ni almashtirib joylaymiz
sed "s/transactions\.xonapps\.uz/$DOMAIN/g" "$CONFIG_SRC" > "$CONFIG_DST"
ln -sf "$CONFIG_DST" /etc/nginx/sites-enabled/xon-tranzactions
nginx -t
systemctl reload nginx
echo "✓ Nginx config o'rnatildi ($CONFIG_DST)"

# 3. SSL sertifikat olish (DNS allaqachon to'g'rilangan deb hisoblaymiz)
echo "→ Let's Encrypt sertifikat olinmoqda ($DOMAIN)"
if certbot certificates 2>/dev/null | grep -q "Domains: $DOMAIN"; then
  echo "  ⚠ Sertifikat allaqachon mavjud — yangilanadi"
  certbot renew --nginx --non-interactive
else
  certbot --nginx -d "$DOMAIN" \
    --non-interactive --agree-tos --email "$EMAIL" \
    --redirect
fi

# 4. CORS_ORIGIN ni backend .env'da yangilash
ENV_FILE="$REPO_DIR/backend/.env"
if [ -f "$ENV_FILE" ]; then
  if grep -q '^CORS_ORIGIN=' "$ENV_FILE"; then
    sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=\"https://$DOMAIN\"|" "$ENV_FILE"
  else
    echo "CORS_ORIGIN=\"https://$DOMAIN\"" >> "$ENV_FILE"
  fi
  echo "✓ CORS_ORIGIN=https://$DOMAIN (backend/.env)"
fi

# 5. NEXT_PUBLIC_API_URL ni frontend .env.local'da yangilash
FE_ENV="$REPO_DIR/frontend/.env.local"
if [ -f "$FE_ENV" ]; then
  cat > "$FE_ENV" <<EOF
NEXT_PUBLIC_API_URL="https://$DOMAIN/api"
EOF
  echo "✓ NEXT_PUBLIC_API_URL=https://$DOMAIN/api (frontend/.env.local)"
fi

# 6. Frontend qaytadan build (chunki NEXT_PUBLIC_* compile-time'da bog'lanadi)
echo "→ Frontend qaytadan build (yangi API URL bilan)"
cd "$REPO_DIR/frontend"
npm run build

# 7. Service'larni restart
systemctl restart xon-tranzactions-backend
systemctl restart xon-tranzactions-frontend
systemctl reload nginx

echo
echo "━━━ TAYYOR ━━━"
echo "Domain:    https://$DOMAIN"
echo "Swagger:   https://$DOMAIN/docs"
echo "Webhook:   https://$DOMAIN/api/_deploy"
echo "Auto-renewal: certbot.timer (sertifikat avto-yangilanadi)"
echo
systemctl --no-pager --lines=3 status xon-tranzactions-backend xon-tranzactions-frontend || true
