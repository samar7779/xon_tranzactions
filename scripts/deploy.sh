#!/bin/bash
# Xon Tranzaksiyalar — deploy skript (server tomonda chaqiriladi)
# Backend webhook (DeployService) fonda chaqiradi.
#
# Talab qilinadigan env (DeployService o'rnatadi):
#   DEPLOY_REPO_DIR, DEPLOY_BRANCH, DEPLOY_SERVICES (comma-separated),
#   DEPLOY_BACKEND_SERVICE, DEPLOY_FRONTEND_SERVICE,
#   DEPLOY_LOG, TG_BOT_TOKEN (optional), DEPLOY_NOTIFY_CHAT (optional),
#   DEPLOY_PUSHER, DEPLOY_PUSHED_BRANCH, DEPLOY_COMMIT
set -u

REPO="${DEPLOY_REPO_DIR:-/var/www/xon_tranzactions}"
BRANCH="${DEPLOY_BRANCH:-main}"
SERVICES="${DEPLOY_SERVICES:-}"
BE_SVC="${DEPLOY_BACKEND_SERVICE:-xon-tranzactions-backend}"
FE_SVC="${DEPLOY_FRONTEND_SERVICE:-xon-tranzactions-frontend}"
LOG="${DEPLOY_LOG:-/var/log/xon-tranzactions/deploy.log}"
LOCK="${DEPLOY_LOCK:-/var/run/xon-tranzactions-deploy.lock}"

# Telegram fallback — agar env'da bo'lmasa, shu yerdan ishlatamiz.
# Bu deploy notifikatsiyalari uchun, oddiy bot.
TG_BOT_TOKEN="${TG_BOT_TOKEN:-8128088490:AAErnIY_BG5rjdcp45S1OcHyVhiJm5WbUO8}"
DEPLOY_NOTIFY_CHAT="${DEPLOY_NOTIFY_CHAT:--5220625032}"
export TG_BOT_TOKEN DEPLOY_NOTIFY_CHAT

# Node memory limit — kichik serverda OOM'dan saqlanish uchun
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
# Next.js telemetry o'chirish — build vaqtini va ozini tezroq qiladi
export NEXT_TELEMETRY_DISABLED=1

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
mkdir -p "$(dirname "$LOCK")" 2>/dev/null || true

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [deploy] %s\n' "$(ts)" "$*" >> "$LOG"; }

# Concurrency lock: keyingi deploy oldingisini kutsin (parallel deploylar
# `.next/` papkasini buzadi). flock -w 600 ⇒ 10 min kutadi, keyin chiqib ketadi.
exec 9>"$LOCK"
if ! flock -w 600 9; then
  log "✗ deploy lock ololmadik (10 min kutdik) — chiqamiz"
  exit 1
fi
log "🔒 deploy lock olindi"

tg() {
  [ -z "${TG_BOT_TOKEN:-}" ] && return 0
  [ -z "${DEPLOY_NOTIFY_CHAT:-}" ] && return 0
  curl -sS -m 10 \
    -d chat_id="${DEPLOY_NOTIFY_CHAT}" \
    -d parse_mode=HTML \
    -d disable_web_page_preview=true \
    --data-urlencode text="$1" \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" >> "$LOG" 2>&1 || true
}

esc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

start_ts=$(date +%s)
log "━━━ DEPLOY START · branch=${DEPLOY_PUSHED_BRANCH:-?} · pusher=${DEPLOY_PUSHER:-?} · services=${SERVICES:-(none)} ━━━"

run() {
  local title="$1"; shift
  log "→ $title"
  if ! "$@" >> "$LOG" 2>&1; then
    log "✗ FAIL: $title"
    return 1
  fi
  log "✓ $title"
}

cd "$REPO" || { log "✗ repo papkasi yo'q: $REPO"; tg "❌ <b>Deploy xato</b>: repo papkasi yo'q ($REPO)"; exit 1; }

# 0a. Swap fayli — Next.js build OOM'dan saqlanish uchun (kichik VM uchun)
SWAP_FILE="/swapfile_xon"
if ! swapon --show 2>/dev/null | grep -q "$SWAP_FILE"; then
  if [ ! -f "$SWAP_FILE" ]; then
    log "→ swap fayli yaratish (2GB)"
    if sudo -n fallocate -l 2G "$SWAP_FILE" 2>>"$LOG"; then
      sudo -n chmod 600 "$SWAP_FILE" 2>>"$LOG"
      sudo -n mkswap "$SWAP_FILE" >> "$LOG" 2>&1
      sudo -n swapon "$SWAP_FILE" >> "$LOG" 2>&1 && log "✓ swap yoqildi (2GB)" || log "✗ swap yoqilmadi"
    else
      log "✗ swap yaratilmadi — sudo ruxsati yo'q"
    fi
  else
    sudo -n swapon "$SWAP_FILE" >> "$LOG" 2>&1 && log "✓ mavjud swap yoqildi" || log "ℹ swap allaqachon yoqilgan"
  fi
fi

# 0b. RAM/disk holatini lojikiga yozamiz
log "RAM: $(free -h 2>/dev/null | awk '/^Mem:/ {print $3"/"$2}')"
log "Disk: $(df -h "$REPO" 2>/dev/null | awk 'NR==2 {print $3"/"$2" ("$5" used)"}')"

# 0c. Backend .env'ga Telegram token'ni qo'shamiz (agar yo'q bo'lsa)
ensure_env_var() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    return 0  # allaqachon bor
  fi
  printf '%s=%s\n' "$key" "$value" >> "$file"
  log "→ $file ga $key qo'shildi"
}
if [ -d "$REPO/backend" ]; then
  ensure_env_var "$REPO/backend/.env" "TG_BOT_TOKEN" "$TG_BOT_TOKEN"
  ensure_env_var "$REPO/backend/.env" "DEPLOY_NOTIFY_CHAT" "$DEPLOY_NOTIFY_CHAT"
fi

# 1. Kodni tortib olish
if ! run "git fetch" git fetch --all --prune; then
  tg "❌ <b>Deploy xato</b>: git fetch ishlamadi"
  exit 1
fi
if ! run "git reset --hard origin/${BRANCH}" git reset --hard "origin/${BRANCH}"; then
  tg "❌ <b>Deploy xato</b>: git reset ishlamadi"
  exit 1
fi

# 2. Build — services'ga qarab
need_be=0; need_fe=0
case ",$SERVICES," in
  *",$BE_SVC,"*) need_be=1 ;;
esac
case ",$SERVICES," in
  *",$FE_SVC,"*) need_fe=1 ;;
esac
# Agar hech narsa kerak emas — faqat git pull va exit
if [ "$need_be" = "0" ] && [ "$need_fe" = "0" ]; then
  log "ℹ docs/config only — restart kerakmas"
  end_ts=$(date +%s); elapsed=$((end_ts - start_ts))
  tg "✅ <b>Deploy OK</b> · ${elapsed}s · 💤 restart kerakmas (docs only)
🌿 <code>$(esc "${DEPLOY_PUSHED_BRANCH:-?}")</code>
👤 $(esc "${DEPLOY_PUSHER:-?}")"
  exit 0
fi

# 3. Backend build
if [ "$need_be" = "1" ]; then
  if [ -d "$REPO/backend" ]; then
    pushd "$REPO/backend" > /dev/null
    if ! run "backend npm ci" npm install --silent --no-audit --no-fund --include=dev; then
      tg "❌ <b>Deploy xato</b>: backend npm ci"
      exit 1
    fi
    run "backend prisma generate" npx prisma generate || true
    # Migration fayllar bo'lsa — migrate deploy, aks holda db push
    if [ -d "prisma/migrations" ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
      if ! run "backend prisma migrate deploy" npx prisma migrate deploy; then
        tg "❌ <b>Deploy xato</b>: prisma migrate deploy"
        exit 1
      fi
    else
      if ! run "backend prisma db push" npx prisma db push --accept-data-loss --skip-generate; then
        tg "❌ <b>Deploy xato</b>: prisma db push"
        exit 1
      fi
    fi
    if ! run "backend build" npm run build; then
      tg "❌ <b>Deploy xato</b>: backend build"
      exit 1
    fi
    popd > /dev/null
  fi
fi

# 4. Frontend build
if [ "$need_fe" = "1" ]; then
  if [ -d "$REPO/frontend" ]; then
    pushd "$REPO/frontend" > /dev/null
    tg "🔨 <b>Frontend build boshlandi</b>"
    if ! run "frontend npm ci" npm install --silent --no-audit --no-fund --include=dev; then
      tg "❌ <b>Deploy xato</b>: frontend npm ci"
      exit 1
    fi
    # Clean .next to avoid stale chunks from prior partial/concurrent builds
    if [ -d ".next" ]; then
      run "frontend clean .next" rm -rf .next
      tg "🧹 .next tozalandi"
    fi
    if ! run "frontend build" npm run build; then
      # Build log'idan oxirgi 30 satrni telegram'ga yuboramiz — aniq xato sabab
      tail -30 "$LOG" | tail -c 3500 > /tmp/build-err.txt
      curl -sS -m 15 \
        -d chat_id="${DEPLOY_NOTIFY_CHAT}" \
        -F document=@/tmp/build-err.txt \
        -F caption="❌ Frontend build muvaffaqiyatsiz — log oxiri" \
        "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument" >> "$LOG" 2>&1 || true
      tg "❌ <b>Frontend build muvaffaqiyatsiz</b> — log fayli yuborildi"
      exit 1
    fi
    tg "✅ Frontend build tugadi"
    popd > /dev/null
  fi
fi

# 5. Restart — frontend birinchi, backend oxirgi (chunki backend o'zini ham o'ldiradi)
if [ "$need_fe" = "1" ]; then
  run "restart $FE_SVC" sudo -n /bin/systemctl restart "$FE_SVC" || true
fi

end_ts=$(date +%s); elapsed=$((end_ts - start_ts))
sha=$(git -C "$REPO" log -1 --pretty=%h 2>/dev/null || echo '?')
msg=$(git -C "$REPO" log -1 --pretty=%s 2>/dev/null || echo '?')
restart_line=""
[ "$need_be" = "1" ] && restart_line+="🔁 backend "
[ "$need_fe" = "1" ] && restart_line+="🔁 frontend "

tg "✅ <b>Deploy OK</b> · ${elapsed}s
🌿 <code>$(esc "${DEPLOY_PUSHED_BRANCH:-?}")</code>
👤 $(esc "${DEPLOY_PUSHER:-?}")
📝 <code>$(esc "$sha")</code> — $(esc "$msg")
${restart_line}"

log "━━━ DEPLOY OK · ${elapsed}s ━━━"

# 6. Backend o'zini oxirida restart — webhook handler bizning jarayonimiz ichida edi,
# shu sababli sudo restart bizni ham o'ldiradi, lekin script bu vaqtga tugagan bo'ladi.
if [ "$need_be" = "1" ]; then
  log "→ restart $BE_SVC (oxirgi qadam — o'z-o'zini o'ldiradi)"
  sudo -n /bin/systemctl restart "$BE_SVC" >> "$LOG" 2>&1 || log "✗ FAIL: restart $BE_SVC"
fi
