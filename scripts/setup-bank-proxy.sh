#!/bin/bash
# Bank API proxy setup — ahost server'iga (37.153.159.11) qo'yiladi.
#
# Bu skript Tinyproxy o'rnatadi va sozlaydi:
#  - Faqat Xon server IP (185.228.88.247) kira oladi
#  - Basic auth bilan himoyalangan
#  - HTTPS CONNECT qo'llab-quvvatlanadi (bank API uchun zarur)
#
# Foydalanish (ahost root sifatida):
#   curl -fsSL https://raw.githubusercontent.com/samar7779/xon_tranzactions/main/scripts/setup-bank-proxy.sh | bash
#   YOKI:
#   wget https://raw.githubusercontent.com/samar7779/xon_tranzactions/main/scripts/setup-bank-proxy.sh
#   sudo bash setup-bank-proxy.sh

set -e

# ─── Sozlamalar ───
PROXY_PORT="${PROXY_PORT:-3128}"
ALLOWED_IP="${ALLOWED_IP:-185.228.88.247}"   # Xon Tranzaksiyalar server IP
PROXY_USER="${PROXY_USER:-xonproxy}"
PROXY_PASS="${PROXY_PASS:-$(openssl rand -hex 16)}"
CONFIG="/etc/tinyproxy/tinyproxy.conf"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Xon Tranzaksiyalar — Bank Proxy Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Port:        $PROXY_PORT"
echo "Allowed IP:  $ALLOWED_IP"
echo "Proxy user:  $PROXY_USER"
echo ""

# 1. Tinyproxy o'rnatish
if ! command -v tinyproxy &> /dev/null; then
  echo "→ Tinyproxy o'rnatilmoqda..."
  if [ -f /etc/debian_version ]; then
    apt-get update -qq
    apt-get install -y tinyproxy
  elif [ -f /etc/redhat-release ]; then
    yum install -y epel-release
    yum install -y tinyproxy
  else
    echo "✗ Nomalum OS — Tinyproxy'ni qo'lda o'rnating"
    exit 1
  fi
else
  echo "✓ Tinyproxy allaqachon o'rnatilgan"
fi

# 2. Konfiguratsiya
echo "→ Konfiguratsiya yozilmoqda: $CONFIG"
cat > "$CONFIG" << EOF
# Xon Tranzaksiyalar bank API proxy
User nobody
Group nogroup

Port $PROXY_PORT
Timeout 600
DefaultErrorFile "/usr/share/tinyproxy/default.html"
StatFile "/usr/share/tinyproxy/stats.html"
LogFile "/var/log/tinyproxy/tinyproxy.log"
LogLevel Connect

PidFile "/var/run/tinyproxy/tinyproxy.pid"

MaxClients 50
MinSpareServers 5
MaxSpareServers 10
StartServers 5
MaxRequestsPerChild 0

# Faqat ushbu IP'lar kira oladi
Allow 127.0.0.1
Allow $ALLOWED_IP

# Basic auth — login:parol
BasicAuth $PROXY_USER $PROXY_PASS

ViaProxyName "xonproxy"
ConnectPort 443
ConnectPort 2713
ConnectPort 2777
ConnectPort 8443
EOF

# Group sozlash (RHEL: nogroup yo'q)
if ! getent group nogroup > /dev/null 2>&1; then
  sed -i 's/^Group nogroup/Group nobody/' "$CONFIG"
fi

# 3. Restart
echo "→ Tinyproxy qayta ishga tushirilmoqda..."
systemctl enable tinyproxy
systemctl restart tinyproxy

# 4. Firewall (ufw mavjud bo'lsa)
if command -v ufw &> /dev/null && ufw status | grep -q "Status: active"; then
  echo "→ UFW firewall sozlanmoqda..."
  ufw allow from "$ALLOWED_IP" to any port "$PROXY_PORT" comment 'xonproxy'
fi

# 5. Tekshirish
sleep 2
if systemctl is-active --quiet tinyproxy; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ✅ MUVAFFAQIYATLI O'RNATILDI"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "Proxy URL (Xon server .env'iga qo'shing):"
  echo ""
  echo "  BANK_PROXY_URL=http://$PROXY_USER:$PROXY_PASS@37.153.159.11:$PROXY_PORT"
  echo ""
  echo "Bu URL'ni saqlab qoying — keyin kerak bo'ladi!"
  echo ""
  echo "Sinash:"
  echo "  curl -x http://$PROXY_USER:$PROXY_PASS@127.0.0.1:$PROXY_PORT https://api.ipify.org"
  echo "  (37.153.159.11 ko'rsatishi kerak)"
  echo ""
else
  echo "✗ Tinyproxy ishga tushmadi"
  echo "Loglar: journalctl -u tinyproxy -n 50"
  exit 1
fi
