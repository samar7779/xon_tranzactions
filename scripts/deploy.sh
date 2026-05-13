#!/bin/bash
# Xon Tranzaksiyalar — deploy skript (server tomonda chaqiriladi)
# Backend webhook (DeployService) fonda chaqiradi.
set -u

REPO="${DEPLOY_REPO_DIR:-/var/www/xon_tranzactions}"
BRANCH="${DEPLOY_BRANCH:-main}"
SERVICES="${DEPLOY_SERVICES:-}"
BE_SVC="${DEPLOY_BACKEND_SERVICE:-xon-tranzactions-backend}"
FE_SVC="${DEPLOY_FRONTEND_SERVICE:-xon-tranzactions-frontend}"
LOG="${DEPLOY_LOG:-/var/log/xon-tranzactions/deploy.log}"
LOCK="${DEPLOY_LOCK:-/var/run/xon-tranzactions-deploy.lock}"

# Telegram fallback
TG_BOT_TOKEN="${TG_BOT_TOKEN:-8128088490:AAErnIY_BG5rjdcp45S1OcHyVhiJm5WbUO8}"
DEPLOY_NOTIFY_CHAT="${DEPLOY_NOTIFY_CHAT:--5220625032}"
export TG_BOT_TOKEN DEPLOY_NOTIFY_CHAT

# Node memory limit — kichik serverda OOM'dan saqlanish uchun
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
export NEXT_TELEMETRY_DISABLED=1

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true
mkdir -p "$(dirname "$LOCK")" 2>/dev/null || true

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [deploy] %s\n' "$(ts)" "$*" >> "$LOG"; }

# Concurrency lock
exec 9>"$LOCK"
if ! flock -w 600 9; then
  log "✗ deploy lock ololmadik (10 min kutdik) — chiqamiz"
  exit 1
fi
log "🔒 deploy lock olindi"

# Telegram xabari yuborish — STDIN orqali (UTF-8 muammosini hal qiladi)
tg() {
  [ -z "${TG_BOT_TOKEN:-}" ] && return 0
  [ -z "${DEPLOY_NOTIFY_CHAT:-}" ] && return 0
  local text="$1"
  # JSON faylga yozib jo'natamiz — encoding muammolarsiz
  local tmp; tmp=$(mktemp)
  printf '{"chat_id":"%s","parse_mode":"HTML","disable_web_page_preview":true,"text":%s}\n' \
    "${DEPLOY_NOTIFY_CHAT}" \
    "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$(printf '%s' "$text" | sed 's/"/\\"/g')")" \
    > "$tmp"
  curl -sS -m 10 -X POST -H "Content-Type: application/json" -d @"$tmp" \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" >> "$LOG" 2>&1 || true
  rm -f "$tmp"
}

# Build muvaffaqiyatsiz bo'lsa — log fayli bilan
tg_with_log() {
  [ -z "${TG_BOT_TOKEN:-}" ] && return 0
  [ -z "${DEPLOY_NOTIFY_CHAT:-}" ] && return 0
  local caption="$1"
  tail -50 "$LOG" | tail -c 3500 > /tmp/build-err.txt
  curl -sS -m 15 \
    -d chat_id="${DEPLOY_NOTIFY_CHAT}" \
    -F document=@/tmp/build-err.txt \
    -F caption="$caption" \
    -F parse_mode=HTML \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendDocument" >> "$LOG" 2>&1 || true
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

cd "$REPO" || {
  log "✗ repo papkasi yo'q: $REPO"
  tg "❌ <b>xon.transactions</b> — Deploy xato: repo papkasi yo'q ($REPO)"
  exit 1
}

# 0a. Swap fayli — Next.js build OOM'dan saqlanish uchun
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

log "RAM: $(free -h 2>/dev/null | awk '/^Mem:/ {print $3"/"$2}')"
log "Disk: $(df -h "$REPO" 2>/dev/null | awk 'NR==2 {print $3"/"$2" ("$5" used)"}')"

# 0c. Backend .env'ga Telegram token'ni qo'shamiz (agar yo'q bo'lsa)
ensure_env_var() {
  local file="$1" key="$2" value="$3"
  [ -f "$file" ] || touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    return 0
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
  tg "❌ <b>xon.transactions</b> — git fetch ishlamadi"
  exit 1
fi
if ! run "git reset --hard origin/${BRANCH}" git reset --hard "origin/${BRANCH}"; then
  tg "❌ <b>xon.transactions</b> — git reset ishlamadi"
  exit 1
fi

# 2. Build — services'ga qarab
need_be=0; need_fe=0
case ",$SERVICES," in *",$BE_SVC,"*) need_be=1 ;; esac
case ",$SERVICES," in *",$FE_SVC,"*) need_fe=1 ;; esac

# 2a. Restart kerak bo'lmagan turlari (docs/config-only) uchun — sodda xabar
if [ "$need_be" = "0" ] && [ "$need_fe" = "0" ]; then
  end_ts=$(date +%s); elapsed=$((end_ts - start_ts))
  sha=$(git -C "$REPO" log -1 --pretty=%h 2>/dev/null || echo '?')
  msg=$(git -C "$REPO" log -1 --pretty=%s 2>/dev/null || echo '?')

  # Fayllar ro'yxati (oxirgi commit'dan)
  files_md=""
  if [ -n "${DEPLOY_FILES:-}" ]; then
    files_md=$(printf '%s' "$DEPLOY_FILES" | tr ',' '\n' | head -20 | sed 's/^/• /' | sed 's/$/\\n/' | tr -d '\n')
  fi

  body="✅ <b>xon.transactions</b> · Deploy OK · ${elapsed}s
🌿 <code>$(esc "${DEPLOY_PUSHED_BRANCH:-?}")</code>
👤 $(esc "${DEPLOY_PUSHER:-?}")

📝 <code>$(esc "$sha")</code> — $(esc "$msg")"

  if [ -n "$files_md" ]; then
    body="${body}
📁 O'zgartirilgan fayllar:
$(printf '%s' "$DEPLOY_FILES" | tr ',' '\n' | head -20 | sed 's/^/• /')"
  fi

  body="${body}
💤 Qayta ishga tushirish kerakmas (docs/config)"

  tg "$body"
  log "━━━ DEPLOY OK · ${elapsed}s (no-restart) ━━━"
  exit 0
fi

# 3. Backend build (ovozsiz — telegram'ga oxirida bitta xabar)
if [ "$need_be" = "1" ]; then
  if [ -d "$REPO/backend" ]; then
    pushd "$REPO/backend" > /dev/null
    if ! run "backend npm ci" npm install --silent --no-audit --no-fund --include=dev; then
      tg_with_log "❌ <b>xon.transactions</b> · backend npm install xatosi"
      tg "❌ <b>xon.transactions</b> · backend npm install muvaffaqiyatsiz"
      exit 1
    fi
    run "backend prisma generate" npx prisma generate || true
    if [ -d "prisma/migrations" ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
      if ! run "backend prisma migrate deploy" npx prisma migrate deploy; then
        tg_with_log "❌ <b>xon.transactions</b> · prisma migrate xatosi"
        tg "❌ <b>xon.transactions</b> · prisma migrate muvaffaqiyatsiz"
        exit 1
      fi
    else
      if ! run "backend prisma db push" npx prisma db push --accept-data-loss --skip-generate; then
        tg_with_log "❌ <b>xon.transactions</b> · prisma db push xatosi"
        tg "❌ <b>xon.transactions</b> · prisma db push muvaffaqiyatsiz"
        exit 1
      fi
    fi
    if ! run "backend build" npm run build; then
      tg_with_log "❌ <b>xon.transactions</b> · backend build xatosi"
      tg "❌ <b>xon.transactions</b> · backend build muvaffaqiyatsiz"
      exit 1
    fi
    popd > /dev/null
  fi
fi

# 4. Frontend build (ovozsiz)
if [ "$need_fe" = "1" ]; then
  if [ -d "$REPO/frontend" ]; then
    pushd "$REPO/frontend" > /dev/null
    if ! run "frontend npm ci" npm install --silent --no-audit --no-fund --include=dev; then
      tg_with_log "❌ <b>xon.transactions</b> · frontend npm install xatosi"
      tg "❌ <b>xon.transactions</b> · frontend npm install muvaffaqiyatsiz"
      exit 1
    fi
    # Stale chunk'lardan saqlanish
    if [ -d ".next" ]; then
      run "frontend clean .next" rm -rf .next
    fi
    if ! run "frontend build" npm run build; then
      tg_with_log "❌ <b>xon.transactions</b> · frontend build xatosi"
      tg "❌ <b>xon.transactions</b> · frontend build muvaffaqiyatsiz"
      exit 1
    fi
    popd > /dev/null
  fi
fi

# 5. Restart
if [ "$need_fe" = "1" ]; then
  run "restart $FE_SVC" sudo -n /bin/systemctl restart "$FE_SVC" || true
fi

# 6. Bitta yakuniy xabar — sizning format bo'yicha
end_ts=$(date +%s); elapsed=$((end_ts - start_ts))
sha=$(git -C "$REPO" log -1 --pretty=%h 2>/dev/null || echo '?')
msg=$(git -C "$REPO" log -1 --pretty=%s 2>/dev/null || echo '?')

# Qaysi xizmat qayta ishga tushdi
restart_line=""
[ "$need_be" = "1" ] && [ "$need_fe" = "1" ] && restart_line="🌐 web + ⚙️ api"
[ "$need_be" = "1" ] && [ "$need_fe" = "0" ] && restart_line="⚙️ api"
[ "$need_be" = "0" ] && [ "$need_fe" = "1" ] && restart_line="🌐 web"

# Fayllar ro'yxati
files_block=""
if [ -n "${DEPLOY_FILES:-}" ]; then
  files_block="
📁 O'zgartirilgan fayllar:
$(printf '%s' "$DEPLOY_FILES" | tr ',' '\n' | head -15 | sed 's/^/• /')"
  total=$(printf '%s' "$DEPLOY_FILES" | tr ',' '\n' | wc -l)
  if [ "$total" -gt 15 ]; then
    files_block="${files_block}
… va yana $((total - 15)) ta"
  fi
fi

tg "✅ <b>xon.transactions</b> · Deploy OK · ${elapsed}s
🌿 <code>$(esc "${DEPLOY_PUSHED_BRANCH:-?}")</code>
👤 $(esc "${DEPLOY_PUSHER:-?}")

📝 <code>$(esc "$sha")</code> — $(esc "$msg")${files_block}
🔄 Qayta ishga tushirildi: ${restart_line}"

log "━━━ DEPLOY OK · ${elapsed}s ━━━"

# 7. Backend oxirida restart — bizni o'ldiradi
if [ "$need_be" = "1" ]; then
  log "→ restart $BE_SVC (oxirgi qadam — o'z-o'zini o'ldiradi)"
  sudo -n /bin/systemctl restart "$BE_SVC" >> "$LOG" 2>&1 || log "✗ FAIL: restart $BE_SVC"
fi
