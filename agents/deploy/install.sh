#!/bin/bash
# Leader agentlar boti (@TRanSupport_bot) — serverga bir martalik o'rnatish.
# root sifatida: bash /var/www/xon_tranzactions/agents/deploy/install.sh
# Qayta ishga tushirish xavfsiz: har qadam holatni tekshiradi, bor narsani qayta qilmaydi.
# Sirlar bu skriptda YO'Q: tokenlar env faylda bo'lishi kerak (ORNATISH.md 5-qadam).
# Qo'lda qoladigan ish: push kaliti (ORNATISH.md 7-qadam) — oxirida tekshiriladi.
set -euo pipefail

REPO=/var/www/xon_tranzactions
VENV=/opt/xon-tranzactions-leader/venv
PY="$VENV/bin/python"
ENVF="${AGENTS_ENV_FILE:-$REPO/backend/.env}"
AGENT_USER=xonagent
SVC=xon-tranzactions-leader
export AGENTS_ENV_FILE="$ENVF"

step() { printf '\n=== %s ===\n' "$*"; }
ok()   { printf '  OK: %s\n' "$*"; }
warn() { printf '  DIQQAT: %s\n' "$*"; }
fail() { printf '  XATO: %s\n' "$*"; exit 1; }

# env faylda kalit bormi (qiymat ko'rsatilmaydi)
has_key() { grep -qE "^$1=.+" "$ENVF"; }
# kalit yo'q bo'lsa qo'shadi; bor bo'lsa tegmaydi (egasi qo'ygan qiymat ustun)
add_key() {
  local k="$1" v="$2"
  if has_key "$k"; then ok "$k bor (tegilmadi)"; return; fi
  [ -n "$(tail -c1 "$ENVF")" ] && echo >> "$ENVF"
  printf '%s=%s\n' "$k" "$v" >> "$ENVF"
  ok "$k qo'shildi"
}

[ "$(id -u)" = 0 ] || fail "root sifatida ishga tushiring"
cd "$REPO"
[ -f agents/leader_bot.py ] || fail "agents/ serverda yo'q: avval push va deploy"
[ -f "$ENVF" ] || fail "env fayl yo'q: $ENVF"

step "1. Python va venv ($VENV)"
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || fail "python3 3.10 yoki yangiroq kerak (hozir: $(python3 --version 2>&1))"
if [ ! -x "$PY" ]; then
  apt-get install -y python3-venv >/dev/null
  mkdir -p "$(dirname "$VENV")"
  python3 -m venv "$VENV"
fi
"$PY" -m pip install -q -U pip
"$PY" -m pip install -q -r agents/requirements.txt
"$PY" -c "import aiogram, psycopg2; print('  OK: aiogram', aiogram.__version__)"

step "2. Claude Code CLI"
CLAUDE_BIN="$(command -v claude || true)"
[ -n "$CLAUDE_BIN" ] || fail "claude topilmadi: npm i -g @anthropic-ai/claude-code"
case "$(readlink -f "$CLAUDE_BIN")" in
  /root/*) fail "claude /root ichida ($CLAUDE_BIN): $AGENT_USER uni ishga tushira olmaydi. Tizim bo'yicha o'rnating: npm i -g @anthropic-ai/claude-code" ;;
esac
ok "claude: $CLAUDE_BIN ($("$CLAUDE_BIN" --version 2>/dev/null | head -1))"

step "3. Agent foydalanuvchisi $AGENT_USER"
if ! id "$AGENT_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/home/$AGENT_USER" --shell /usr/sbin/nologin "$AGENT_USER"
  ok "yaratildi"
else
  ok "bor"
fi
if ! sudo -u "$AGENT_USER" -H git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO"; then
  sudo -u "$AGENT_USER" -H git config --global --add safe.directory "$REPO"
fi
ok "git safe.directory"

# Sirlarni agentdan yopish. Faqat servislar root ostida bo'lsa (aks holda ularning .env o'qishi buziladi).
BE_USER="$(systemctl show -p User --value xon-tranzactions-backend 2>/dev/null || true)"
FE_USER="$(systemctl show -p User --value xon-tranzactions-frontend 2>/dev/null || true)"
if [ -z "$BE_USER$FE_USER" ] || { [ "${BE_USER:-root}" = root ] && [ "${FE_USER:-root}" = root ]; }; then
  chmod 700 /root
  find "$REPO" -name '.env*' -type f -not -path '*/node_modules/*' -exec chmod 600 {} +
  ok ".env fayllar 600, /root 700"
else
  warn "backend/frontend root emas (backend=$BE_USER frontend=$FE_USER): .env huquqlari o'zgartirilmadi. ORNATISH.md 4-qadamni qo'lda qiling"
fi

# Tekshiruv: agent sirni o'qiy OLMASLIGI, repo va CLI'ni ishlata OLISHI shart
if sudo -u "$AGENT_USER" cat "$ENVF" >/dev/null 2>&1; then fail "$AGENT_USER env faylni o'qiy olyapti"; fi
if sudo -u "$AGENT_USER" ls /root >/dev/null 2>&1; then fail "$AGENT_USER /root ni o'qiy olyapti"; fi
sudo -u "$AGENT_USER" cat agents/leader.md >/dev/null || fail "$AGENT_USER agents/leader.md ni o'qiy olmayapti"
sudo -u "$AGENT_USER" -H git -C "$REPO" log -1 --oneline >/dev/null || fail "$AGENT_USER git log ishlata olmayapti"
sudo -u "$AGENT_USER" -H "$CLAUDE_BIN" --version >/dev/null || fail "$AGENT_USER claude'ni ishga tushira olmayapti"
ok "agent: sir yopiq, repo va CLI ochiq"

step "4. Env kalitlari ($ENVF)"
for k in LEADER_BOT_TOKEN LEADER_TG_ID ANTHROPIC_SETUP_TOKEN DATABASE_URL; do
  has_key "$k" || fail "$k yo'q (ORNATISH.md 5-qadam)"
done
grep -qE '^LEADER_TG_ID=1954122311$' "$ENVF" || fail "LEADER_TG_ID 1954122311 emas"
add_key AGENTS_USE_CLI 1
add_key AGENT_OS_USER "$AGENT_USER"
add_key CLAUDE_CMD "$CLAUDE_BIN"
# v1 leader (NestJS) shu bot tokeni bilan poll qilmasin (409 Conflict)
add_key LEADER_ENABLED 0
if has_key LEADER_OWNER_TG_IDS && ! grep -qE '^LEADER_ENABLED=0$' "$ENVF"; then
  warn "v1 leader yoqiq bo'lishi mumkin (LEADER_OWNER_TG_IDS bor). Bitta tokenda ikki bot ishlamaydi"
fi

step "5. Papkalar"
mkdir -p agents/state agents/memory/daily static/tg_uploads
[ -f static/tg_uploads/.gitignore ] || printf '*\n' > static/tg_uploads/.gitignore
chmod 755 agents/state agents/memory agents/memory/daily static static/tg_uploads
ok "agents/state, agents/memory/daily, static/tg_uploads"

step "6. Bot jadvallari (agents sxemasi)"
"$PY" -m agents.db_migrations
N="$(sudo -u postgres psql -d xon_tranzactions -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='agents'")"
[ "$N" -ge 8 ] || fail "agents sxemasida $N ta jadval (8 kerak)"
ok "agents sxemasida $N ta jadval"

step "7. Unit testlar"
"$PY" -m unittest discover -s agents/tests -t . 2>&1 | tail -4
"$PY" -m unittest discover -s agents/tests -t . >/dev/null 2>&1 || fail "testlar yiqildi (yuqoridagi natija)"

step "8. CLI tekshiruvi (flaglar va agent env)"
"$PY" -m agents.runner --probe

step "9. Facts: birinchi yig'ish"
"$PY" -m agents.support_facts
head -c 120 agents/state/support_facts.json; echo
head -c 20 agents/state/support_facts.json | grep -q '"updated_at"' || fail "Facts JSON birinchi kaliti updated_at emas"
ok "Facts yozildi"

step "10. systemd servis $SVC"
install -m 644 agents/deploy/$SVC.service /etc/systemd/system/$SVC.service
systemctl daemon-reload
systemctl enable "$SVC" >/dev/null 2>&1
systemctl restart "$SVC"
sleep 8
systemctl is-active --quiet "$SVC" || { journalctl -u "$SVC" -n 40 --no-pager; fail "servis ishga tushmadi"; }
journalctl -u "$SVC" -n 15 --no-pager
ok "servis ishlayapti"

step "11. Push huquqi (REJA [Ha] dan keyin bot push qiladi)"
if git push --dry-run origin main >/dev/null 2>&1; then
  ok "root push qila oladi"
else
  warn "root push qila olmayapti: ORNATISH.md 7-qadam (deploy kaliti, write access). Bot ishlaydi, faqat REJA push bosqichida to'xtaydi"
fi
git config user.name >/dev/null || warn "git user.name yo'q: git config user.name \"Xon Leader Bot\""
git config user.email >/dev/null || warn "git user.email yo'q: git config user.email \"<email>\""

printf '\nTAYYOR. Telegram: @TRanSupport_bot ga /start, keyin /status yozing.\n'
