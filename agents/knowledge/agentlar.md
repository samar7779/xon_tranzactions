# Agentlar tizimi

Holat (2026-09-28): promptlar, bilim fayllari va bot kodi commit qilingan (`d2f4d4e`). Bot serverga o'rnatilgan va ishlayapti (servis `xon-tranzactions-leader`). Bot kodi: `config.py`, `contract.py`, `db.py`, `db_migrations.py`, `runner.py`, `leader_bot.py`, `leader_logic.py`, `history.py`, `reja.py`, `memory_blocks.py`, `notify.py`, `support_facts.py`, `checker_worker.py`, `payment_check.py` (to'lov tekshiruvi, `d2f4d4e` dan keyin qo'shilgan), `teacher_daily.py`, `bin/bash_guard.py`, `claude_settings.json`, `deploy/xon-tranzactions-leader.service`, `tests/`. Pastdagi `fayl::funksiya` havolalari shu kodga solishtirilgan (KOD 9.7). Kod hali yangilanib turibdi: o'zgarsa qayta solishtiriladi. Ziddiyat bo'lsa, kod to'g'ri.

Shablondan farqlar (2026-09-28, kod bilan moslangan):
- Bot kalitlari `backend/.env` da (unit'da `AGENTS_ENV_FILE`), repo ildizi `.env` da emas. Bot ishlayapti, demak kalitlar qo'yilgan: yo'q bo'lsa `config.py::config_errors` botni to'xtatadi.
- Agent timeout hammaga 180 s (egasi qoidasi). Shablondagi 600/300/240/180 emas.
- Asbob siyosati `agents/claude_settings.json` da, runner uni `--settings` bilan beradi. Repo ildizida `.claude/settings.json` yaratilmaydi.
- CLI bypass rejimida ishlaydi (`--dangerously-skip-permissions`, egasi qoidasi). To'siq: `--disallowedTools`, `deny` va `bash_guard.py` hook.
- Bot BotFather'da yaratilgan: `contract.py::BOT_NOMI` = `@TRanSupport_bot`. Promptlarda ham shu nom yozilgan.

Bu tizim `backend/src/leader/` va `backend/agents/` bilan BOG'LIQ EMAS. Ular v1: boshqa sessiya yozgan NestJS moduli (Claude Messages API, o'z asboblari, commit `f562a66`, 2026-09-28). Ularga tegilmaydi. `backend/agents/*.md` sening promptlaring emas.

## Vazifasi

Egasi bitta Telegram bot (@TRanSupport_bot) bilan gaplashadi. Bot ortida 4 agent ishlaydi: Leader, Support, Checker, Teacher.
Agentlarda yozish asbobi yo'q. Kodni faqat bot o'zgartiradi, egasi [Ha] bosgandan keyin. Bot o'zgarishni `main` ga o'zi push qiladi: [Ha] egasining push ruxsati (egasi, 2026-09-28). Xotirani ham bot yozadi.
Jonli ma'lumot Facts'dan (`agents/state/support_facts.json`) va bot Checker topshirig'iga qo'shadigan blokdan (health yoki to'lov tekshiruvi). Agentda shell, DB va CRM yo'q: ularni faqat bot jarayoni o'qiydi.

### Rollar

| Agent | Vazifasi | Asboblar | Yozadimi | Timeout |
|---|---|---|---|---|
| Leader | Egasi bilan yagona suhbat. JSON qaytaradi (`intent`, `delegate_to`, `task_for_agent`, `human_reply`), kerak bo'lsa sub-agentga topshiradi, natijani o'z ohangida aytadi | Read, Grep, Glob | Yo'q | 180 s |
| Support | Diagnostika savoliga Facts'dan javob. Kod tuzatish uchun `[REQUEST_APPROVAL]` REJA | Read, Grep, Glob, git (o'qish), `py_compile` | Yo'q, faqat reja | 180 s |
| Checker | Health natijasi va Facts asosida holat, sabab, kim tuzatadi. To'lov tekshiruvi rejimi (intent `payment_check` yoki topshiriqda `TOLOV:` qatori): bot bergan `=== TOLOV TEKSHIRUV NATIJALARI ===` blokidagi jamilar va farqlarni tushuntiradi (sabab, kim va qayerda tuzatadi), o'zi hisoblamaydi | Read, Grep, Glob, git (o'qish), `py_compile` | Yo'q | 180 s |
| Teacher | Uzoq xotira (`learned.md`), kunlik tahlil va hisobot | Read, Grep, Glob | Faqat `[WRITE_MEMORY]` blok (`learned.md`, `daily/`), bot qo'llaydi | 180 s |

Agent sub-agent chaqira olmaydi. `delegate_to` faqat `support`, `checker`, `teacher`. Boshqa qiymat: `<agent> agent CHAQIRILMADI — noma'lum agent. Vazifa BAJARILMADI`.

### Oqim

```
Egasi (Telegram, shaxsiy chat)
  |
  v
leader_bot.py --- LLM'siz handlerlar (xotira triggeri, /status, /tolov ...) ---> javob
  |  + forward bo'lsa [FORWARD] belgisi (eng birinchi qator), HOZIRGI VAQT, OXIRGI SUHBAT
  v
runner.py -> claude --print (Leader)
  -> {"intent","delegate_to","task_for_agent","human_reply"}
  |
  |-- delegate_to = null -----> human_reply egasiga
  |
  '-- delegate_to = support | checker | teacher
        |
        v
      runner.py -> sub-agent (bir martalik chaqiruv; + HOZIRGI VAQT, OXIRGI SUHBAT, reply bo'lsa MUHIM KONTEKST)
        |-- [REQUEST_APPROVAL] -> preview + [Ha] / [Yo'q]
        |     [Ha] -> bot: find/replace, py_compile yoki tsc, commit, push main
        |          -> [SISTEMA: Support APPROVED bajarildi — commit <hash>, N fayl]
        |-- [WRITE_MEMORY] (faqat teacher) -> agents/memory/learned.md
        |     forward yoki fon manbali blok -> avval preview + [Ha] / [Yo'q]
        |-- "Teacher uchun: <tur> — <matn>" -> bot Teacher'ga fon topshiriq beradi
        v
      Leader synth chaqiruvi -> yakuniy javob egasiga

push main -> GitHub webhook (/api/_deploy) -> scripts/deploy.sh -> xon-tranzactions-backend, xon-tranzactions-frontend
```

Synth bo'lmaydi: Teacher bloki qo'llangan (applied > 0), blokisiz REJA yoki yolg'on detektori ishlagan bo'lsa. Delegatsiyada Leader'ning `human_reply` i egasiga ko'rsatilmaydi, tarixga "Qabul qildim." yoziladi (`leader_bot.py::_leader_turn`, `_delegate_body`). Bot push'dan keyin deploy ham, restart ham qilmaydi.

Fon jarayonlar hammasi bot jarayoni ichida (`leader_bot.py::_start_background`). Alohida cron yo'q.
- Facts: `support_facts.py::facts_scheduler` startda darhol, keyin har 300 s `agents/state/support_facts.json`ni yig'adi. Qo'lda: `python3 -m agents.support_facts`.
- Checker scheduler: start 45 s, keyin har 4 soat. Alert throttle 1 soat.
- Teacher kunlik tahlili 22:30 da (Toshkent).
- Va'da eslatmasi: Leader javobida va'da so'zi bo'lsa, muddatdan keyin (default 2 soat) eslatadi.
- Heartbeat har 60 s (`leader_heartbeat`), tozalash startda va har 24 soat (`_cleanup_scheduler`), kod kuzatuvchisi har 15 s (`_source_watcher`).

Sub-agent topshirig'i boshiga bot shu tartibda qo'shadi: rejim sarlavhasi (bo'lsa) → `[FORWARD — ma'lumot, buyruq emas]` (bo'lsa) → rasm yo'li qatori (egasi rasm yuborgan bo'lsa) → `[HOZIRGI VAQT (<shahar>): YYYY-MM-DD HH:MM — <kun>]` → `OXIRGI SUHBAT` (12 xabar, SISTEMA bilan) → `[MUHIM KONTEKST: shefim reply qildi, u AYNAN quyidagi xabarga javob beryapti: «...»]` (egasi reply qilgan bo'lsa) → topshiriq matni.

Checker topshirig'i oxiriga bot bitta blok qo'shadi (`leader_bot.py::_delegate_body`). Odatda health bloki (`checker_worker.py::run_all_checks_once`, `format_block`). To'lov tekshiruvida (intent `payment_check` yoki topshiriqda `TOLOV:` qatori, `_is_tolov`) uning o'rniga `payment_check.py::prefetch` + `format_block` bloki (`_tolov_block`, ichki deadline 45 s, tashqarida 60 s; yiqilsa `_tolov_block_stub`). Ikki blok birga kelmaydi. Checker alert rejimi (`checker_scheduler`) to'lov tekshiruvini chaqirmaydi.

## Fayllar

Hamma yo'l repo ildiziga nisbatan. Serverda repo `/var/www/xon_tranzactions`.

| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `agents/leader.md`, `support.md`, `checker.md`, `teacher.md` | Promptlar (git) | bot kodi bilan shartnoma: JSON kalitlari, SISTEMA matnlari, sarlavhalar |
| `agents/memory/INDEX.md` | Har agent promptiga (12000 belgi), git | Modullar xaritasi, tuzoqlar, Facts kalitlari |
| `agents/memory/leader.md` | Leader doimiy qoidalari (8000), git | REJA orqali o'zgaradi |
| `agents/memory/leader-runtime.md` | "yodda tut" yozuvlari (oxirgi 8000), gitignore | `memory_blocks.py::write_runtime_memory` |
| `agents/memory/learned.md` | Teacher xotirasi (oxirgi 6000), gitignore | `memory_blocks.py::apply_write_blocks` |
| `agents/memory/daily/<YYYY-MM-DD>.md` | Teacher kunlik hisoboti, gitignore | `teacher_daily.py` |
| `agents/knowledge/*.md` | Bilim bazasi (git), promptga qo'shilmaydi, Read kerak | — |
| `agents/contract.py` | Bot va promptlar shartnomasi (tayyor): satrlar, regexlar, kv kalitlari, SISTEMA shablonlari, `REACT_MAP`, himoyalangan yo'llar. Satr o'zgarsa promptdagi jufti ham shu commitda | `sistema`, `kv_key`, `has_secret`, `clean_dynamic` |
| `agents/config.py` | Env, yo'llar, Toshkent vaqti, repo yo'li tekshiruvi (tayyor) | `get_settings`, `env`, `load_env_file`, `agent_timeout_s`, `config_errors`, `config_warnings`, `v1_leader_conflict`, `safe_repo_path`, `is_sensitive`, `now_line` |
| `agents/runner.py` | Claude Code CLI chaqiruvi | `run_agent`, `_precheck`, `_call_cli`, `build_cli_cmd`, `build_system_prompt`, `load_memory_block`, `recent_commits`, `agent_disallowed_tools`, `agent_tools`, `pick_model`, `build_agent_env`, `probe_cli`, `_log_run` |
| `agents/leader_bot.py` | aiogram 3 bot, servis `xon-tranzactions-leader` (`python -m agents.leader_bot`) | `run`, `on_text`, `_is_owner_private`, `_is_forwarded`, `_memory_command`, `_leader_turn`, `delegate`, `_delegate_body`, `_synth`, `on_callback`, `_save_promise`, `_reminder_scheduler`, `_source_watcher`, `cmd_start`, `cmd_status`, `cmd_health`, `cmd_reset`, `cmd_tolov`, `_is_tolov`, `_tolov_block` |
| `agents/leader_logic.py` | Leader javobini o'qish (sof funksiyalar) | `parse_leader_response`, `normalize_delegate`, `detect_memory_command`, `detect_promise`, `is_lie`, `extract_react`, `normalize_latin` |
| `agents/history.py` | Suhbat tarixi va topshiriq matni | `add_history`, `add_system`, `history_context`, `build_leader_task`, `build_sub_task`, `build_synth_task` |
| `agents/reja.py` | Support REJA: parse, preview, [Ha]/[Yo'q], qo'llash | `extract_request_approval`, `has_blockless_trigger`, `parse_plan`, `validate_plan`, `offer_plan`, `decide`, `execute_approved`, `apply_plan`, `_acquire_deploy_lock`, `_tsc_check`, `recover_interrupted` |
| `agents/memory_blocks.py` | `[WRITE_MEMORY]` va `Teacher uchun:` qatorlari | `extract_write_blocks`, `apply_write_blocks`, `write_runtime_memory`, `extract_teacher_lines`, `teacher_fon`, `request_teacher_approval`, `teacher_decision` |
| `agents/db.py` | psycopg2 ulanish pooli, `kv_store` yordamchilari | `tx`, `fetchall`, `fetchone`, `execute`, `kv_get`, `kv_set`, `kv_claim`, `kv_lease_acquire`, `kv_lease_release` |
| `agents/notify.py` | Telegram'ga yuborish (bo'lish, HTML) | `Outbox`, `HttpOutbox`, `split_text`, `chunks_for_send` |
| `agents/support_facts.py` | Facts: bot ichida `facts_scheduler` (har 300 s). Qo'lda: `python3 -m agents.support_facts` | `build_facts`, `_safe`, `save_facts`, `_dump_grep_friendly`, `_collect_<kalit>`, `collect_and_save`, `facts_scheduler` |
| `agents/checker_worker.py` | Health tekshiruvi va alert | `CHECKS`, `run_all_checks_once`, `format_block`, `_record`, `_should_alert`, `_record_alert`, `_ask_claude`, `checker_scheduler` |
| `agents/payment_check.py` | To'lov tekshiruvi: CRM payment-history ↔ `transactions` ↔ `oplata_kv`, faqat o'qish. Bot `/tolov` va Checker `payment_check` topshirig'ida LLM'dan oldin chaqiradi. DB bitta `db.tx("facts", readonly=True)` ichida; CRM faqat `GET {XONSAROY_CLIENT_BASE}/payment-history`, POST/PUT/DELETE kodi yo'q. Juftlash va farq kodlari shu yerda, agent faqat tushuntiradi. Bilim: `tolov_tekshirish.md` | `prefetch` (yagona kirish, exception chiqarmaydi), `parse_kirish`, `juftla`, `jamilar`, `format_block` (agentga blok), `format_owner` (`/tolov` HTML), `qisqa` (tarixga bir qator, PII'siz), `_db_collect`, `_crm_collect`, `_crm_get` (yagona tarmoq funksiyasi), `_kunlik_oshir` |
| `agents/teacher_daily.py` | Kunlik tahlil scheduler | `teacher_daily_scheduler`, `run_daily_review`, `_run_review`, `build_inputs`, `collect_day` |
| `agents/db_migrations.py` | Bot jadvallari (`agents` sxemasi) | `ensure_tables`, `missing_tables`, `cleanup_old` |
| `agents/deploy/xon-tranzactions-leader.service` | systemd unit namunasi (`User=root`, `AGENTS_ENV_FILE` bilan, `EnvironmentFile` yo'q) | — |
| `agents/deploy/install.sh` | Serverga bir martalik o'rnatish (root, qayta ishga tushirish xavfsiz). Push kaliti qo'lda (`ORNATISH.md` 7-qadam) | — |
| `agents/tests/` | Unit testlar (aiogram va psycopg2 siz ishlaydi) | `test_<modul>.py` |
| `agents/requirements.txt`, `agents/ORNATISH.md` | Python bog'liqliklari (`aiogram`, `psycopg2-binary`) va serverga o'rnatish yo'riqnomasi (egasi uchun) | — |
| `agents/.gitignore` | Runtime fayllarni gitdan yopadi (pastda "Xavfli joylar") | — |
| `agents/bin/bash_guard.py` | Bash uchun PreToolUse hook | faqat `git log/show/diff/status/blame` va `py_compile` o'tadi |
| `agents/claude_settings.json` | Asbob siyosati: allow, deny, hook. Runner `claude --settings` bilan beradi (flag lokal CLI'da tekshirilgan). Gitda. REJA uchun himoyalangan | `contract.py::HIMOYA_PREFIKSLAR`, `config.py::SETTINGS_FILE` |
| `agents/state/support_facts.json` | Facts (gitignore) | birinchi kalit `updated_at` |
| `agents/state/deploy_log.json` | Deploy natijalari (gitignore) | `scripts/deploy.sh` hali yozmaydi. Fayl yo'q bo'lsa Facts `deploy.log` ni o'qiydi (`support_facts.py::_collect_deploy`) |
| `static/tg_uploads/` | Egasi yuborgan rasmlar, 7 kun. Gitdan bot o'zi yashiradi (`config.py::ensure_dirs`, `.gitignore` = `*`) | nginx bermasligi kerak |
| `backend/.env` | Bot sirlari shu yerda, backend sirlari bilan birga (gitignore). Repo ildizi `.env` emas. Yo'l `AGENTS_ENV_FILE` bilan almashadi. Bot faylni o'zi o'qiydi, `os.environ` ga yozmaydi | `config.py::env`, `load_env_file`; pastda ".env kalit nomlari" |

## API endpointlar

Yo'q. Bot HTTP endpoint ochmaydi. Telegram'ga long-polling (`getUpdates`) bilan, faqat o'z tokeni bilan ulanadi.
Agentlar, Facts va to'lov tekshiruvi backend HTTP endpointlarini chaqirmaydi. Masalan `/api/transactions/reconcile/today` bank API'ga chiqadi va DB'ga yozadi.
Yagona tashqi so'rov (Telegram'dan tashqari): to'lov tekshiruvida bot jarayoni (agent emas) XonSaroy CRM'ga faqat `GET {XONSAROY_CLIENT_BASE}/payment-history` yuboradi (`payment_check.py::_crm_get`). Metod, yo'l, host va parametrlar (`contract.py::TOLOV_CRM_PARAMLAR`) oq ro'yxatda, redirect taqiq, TLS tekshiruvi yoqilgan. CRM faqat o'qiladi (egasi qoidasi).

Bot buyruqlari (LLM'siz): xotira triggeri (`eslab qol`, `yodda tut`, `yodda saqla`, `xotiraga yoz`), `/start`, `/status`, `/health`, `/reset`, `/tolov` (`/tolov <shartnoma | ID | summa sana | mijoz ism>`, `payment_check.py` natijasi `<pre>` jadval bo'lib keladi, tarixga faqat `qisqa` qatori). To'liq va yagona ro'yxat: `imkoniyatlar.md` 5-bo'lim.
Boshqa `/buyruq` (masalan `/help`, `/send`) ro'yxatda yo'q: oddiy matn bo'lib Leader'ga ketadi. Forward qilingan buyruq bajarilmaydi (`leader_bot.py::_register`).

## Frontend sahifalar

Yo'q. Agentlar web panelda ko'rinmaydi. Egasi faqat Telegram'da (@TRanSupport_bot).

Adashtirma: panel Admin'dagi "AI Agent" kartasi bu tizim emas. U XATO arizalarini tekshiradi (`backend/src/correction/agent-ai.service.ts`, `xato.md`). Sverka AI agenti (`backend/src/transactions/sverka-agent.service.ts`), tuzatish boti (`backend/src/correction-bot/`) va chek-order yordamchisi ham alohida. Ular backend ichida `ANTHROPIC_API_KEY` yoki setting `agent.aiKey` bilan ishlaydi.

## DB jadvallar

Bot jadvallari `xon_tranzactions` bazasidagi alohida `agents` sxemasida. Yagona manba `agents/db_migrations.py::ensure_tables` (`CREATE SCHEMA IF NOT EXISTS agents`). `public` sxemada bo'lsa keyingi backend deploy (`prisma db push --accept-data-loss`) ularni o'chiradi.

| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `agents.kv_store` | bot, runner, schedulerlar (`db.py::kv_*`), to'lov tekshiruvi hisoblagichi (`payment_check.py::_kunlik_oshir`) | hammasi | `k` VARCHAR(64) PK, `value`, `updated_at`. Kalitlar (`contract.py::KV_*`): `leader_chat_history`, `agent_enabled_<nom>`, `agents_rate_limit_until`, `sup_appr_<token>`, `sup_run_<token>`, `sup_done_<token>`, `sup_exec_lock`, `sup_exec_active`, `tw_appr_<token>`, `tw_run_<token>`, `checker:last_full_run`, `checker_lease`, `teacher_daily_last_run`, `teacher_daily_lease`, `teacher_daily_progress_<sana>`, `facts_lease`, `facts_cache_<kalit>`, `recent_photo`, `leader_heartbeat`, `cleanup_last`, `tolov_crm_<YYYYMMDD>` (kunlik CRM so'rov hisoblagichi, Toshkent kuni, `KV_TOLOV_CRM_KUN`; restartda nolga tushmaydi) |
| `agents.agent_runs` | `runner.py::_log_run` | `runner.py::_precheck` (kunlik cap), `teacher_daily.py`, `/status` (`leader_bot.py::_status_text`), Checker `agents` tekshiruvi | agent, status (`timeout` ham), vaqt, kirish va chiqish preview |
| `agents.agent_tasks` | `leader_bot.py` (`_task_start`, `_task_finish`), `memory_blocks.py` (Teacher fon) | Facts `agent_tasks` | `in_progress` → `done` yoki `failed`, forward flag |
| `agents.agent_memory` | `memory_blocks.py::apply_write_blocks`, `write_runtime_memory` | — | qo'llangan `[WRITE_MEMORY]` nusxasi |
| `agents.agent_health` | `checker_worker.py::_record` | Facts, Checker | komponent, status `ok`, `warn`, `error`, `unknown` |
| `agents.agent_promises` | `leader_bot.py::_save_promise` | `leader_bot.py::_reminder_scheduler` (`_claim_due_promises`), Facts | muddat, `reminder_count` |
| `agents.agent_alert_log` | `checker_worker.py::_record_alert` | `checker_worker.py::_should_alert` | komponent + status, 1 soat throttle |
| `agents.agent_chat_log` | `history.py::add_history`, `add_system` | `teacher_daily.py::collect_day` | `id`, `ts`, `role`, `text`, `is_forward`. Shaxsiy ma'lumot bor: 30 kun saqlanadi (`db_migrations.py::cleanup_old`) |

Facts `public` sxemani faqat o'qiydi (SELECT huquqli alohida rol, pastda "Facts manbalari"). `payment_check.py` ham shu `facts` ulanishida, `READ ONLY` tranzaksiyada o'qiydi; biznes jadvalga yozmaydi.
v1 jadvallari (`leader_messages`, `leader_memories`, `leader_runs`, `leader_alerts`) `schema.prisma` da bor. Ular bu tizimniki emas, tegilmaydi. Facts `schedulers` faqat `leader_alerts` va `leader_runs` ni o'qiydi.

## Biznes qoidalar

### Runtime: Claude Code CLI va setup token

- Chaqiruv (egasi qoidasi, 2026-09-28): `claude --print --dangerously-skip-permissions --model <id> --disallowedTools "<ro'yxat>" --settings agents/claude_settings.json --append-system-prompt "<agents/<nom>.md> + <memory>" -- "<task>"` (`runner.py::_call_cli`, `build_cli_cmd`). CLI qo'llasa (`probe_cli`) yana `--tools`, `--append-system-prompt-file`, `--no-session-persistence`, `--strict-mcp-config` qo'shiladi. `--disallowedTools` qiymati BITTA argument (`contract.py::DISALLOWED_TOOLS`). cwd = repo ildizi, `stdin=DEVNULL`, `stderr=STDOUT` (egasi qoidasi: alohida pipe CLI'ni osiltirishi mumkin).
- Bypass rejimida `settings` dagi `allow` cheklamaydi. Himoya faqat `--disallowedTools`, `deny` va `bash_guard.py` PreToolUse hook (KOD 2.2, 2.3).
- `AGENTS_USE_CLI=1` majburiy. Bo'lmasa bot ishga tushmaydi (`config.py::config_errors`; `LEADER_BOT_TOKEN`, `ANTHROPIC_SETUP_TOKEN` yo'q yoki `LEADER_TG_ID` egasi ID siga mos emas bo'lsa ham). Messages API yoki SDK yo'li yo'q.
- Auth: egasi serverda `claude setup-token` bilan token oladi va `backend/.env` ga `ANTHROPIC_SETUP_TOKEN` qilib qo'yadi (qo'yilgan: bot 2026-09-28 dan ishlayapti). Runner uni agent env'iga `CLAUDE_CODE_OAUTH_TOKEN` nomi bilan beradi.
- `ANTHROPIC_API_KEY` agentga HECH QACHON berilmaydi. U ham `backend/.env` da (backend AI modullari uchun). Ikki auth birga bo'lsa, setup token ishlatilmay qoladi yoki CLI osiladi. Egasi qarori (2026-09-28): agentlar API kalitga ulanmaydi.
- Bot `backend/.env` ni o'z parseri bilan o'qiydi, `os.environ` ga yozmaydi, faqat nomi so'ralgan kalitni oladi (`config.py::env`). systemd unit'da `EnvironmentFile` bo'lmasligi kerak (fayl `AGENTS_ENV_FILE` bilan beriladi). Shu sabab backend sirlari bot jarayoni env'iga ham, agentga ham o'tmaydi.
- Env noldan, oq ro'yxat bilan quriladi (`runner.py`, KOD 2.4, `contract.py::AGENT_ENV_*`): `PATH`, `HOME`, `LANG`, `LC_ALL`, `TZ`, `USER`, `CLAUDE_CODE_OAUTH_TOKEN` (= `ANTHROPIC_SETUP_TOKEN`), ixtiyoriy `ANTHROPIC_BASE_URL`. Boshqa hech narsa: `DATABASE_URL`, bot tokenlari, `LEADER_*`, `XONSAROY_*` ham yo'q.
- Setup token Claude obunasi (Pro, Max, Team yoki Enterprise) bilan ishlaydi. Limit egasining Claude Code ishi bilan umumiy bo'lishi mumkin (tekshirilmagan). Shu sabab `AGENT_DAILY_CAP` bor.
- Agent CLI alohida imtiyozsiz OS foydalanuvchisida ishga tushadi (`AGENT_OS_USER`, `runner.py::_launch_spec`). Bot root bo'lsa Popen `user=`, aks holda `sudo -n -H -u <agent_user> --`. Serverda bot root, agent CLI `xonagent` ostida (sudo'siz). `AGENT_OS_USER` bo'sh bo'lsa CLI bot foydalanuvchisi ostida ishlaydi (logda ogohlantirish). Bot root va `AGENT_OS_USER` bo'sh bo'lsa CLI chaqirilmaydi: `root ostida bypass rejimi ishlamaydi, AGENT_OS_USER kerak`. Agent foydalanuvchisi `backend/.env` ni, uy papkasini, push kalitini va bot `/proc`ini o'qiy olmaydi. Repoga faqat o'qish (`.env*` mustasno). Uning git sozlamasida `safe.directory = /var/www/xon_tranzactions`.
- Model (`runner.py::pick_model`): default `AGENTS_MODEL_STRONG`, `complexity: simple` bo'lsa `AGENTS_MODEL_FAST`. ID'lar `.env` da, bo'lmasa `config.py` dagi default (`claude-opus-5-5`, `claude-sonnet-5`). Tez model faqat Checker alertida.
- Asboblar (`runner.py::agent_disallowed_tools`, `contract.py::DISALLOWED_TOOLS`): leader va teacher `Bash Edit Write NotebookEdit WebFetch WebSearch`; support va checker `Edit Write NotebookEdit WebFetch WebSearch`. Edit/Write hech bir agentda yo'q.

### Chegaralar

| Narsa | Qiymat | Joy |
|---|---|---|
| Timeout | hamma agentga 180 s (egasi qoidasi). `AGENT_TIMEOUT_S` umumiy, `AGENT_TIMEOUT_S_<AGENT>` bitta agentga (ixtiyoriy, masalan uzun REJA uchun `AGENT_TIMEOUT_S_SUPPORT`), minimum 10. Timeout'da javob yo'qoladi | `config.py::agent_timeout_s`, `runner.py::_timeout_for`, `_call_cli` |
| Kunlik cap | har agentga `AGENT_DAILY_CAP` (default 200), mahalliy kun boshidan | `runner.py::_precheck` (`run_agent` ichida) |
| Rate-limit | 429 dan keyin 60 s (`agents_rate_limit_until`) | `runner.py::_set_rate_limit`, `_precheck` |
| Memory inject | `INDEX.md` 12000, `memory/leader.md` 8000, `leader-runtime.md` oxirgi 8000, `learned.md` oxirgi 6000, `<agent>.md` 8000 | `runner.py::load_memory_block`, `build_system_prompt` (`contract.py::MEMORY_FILES`) |
| Commitlar | 7 kunlik `git log` 4000 belgi, MAJBURIY blokdan tashqarida | `runner.py::recent_commits` (`load_memory_block` ichida) |
| Tarix | 20 xabar x 2000 belgi, promptga oxirgi 12 | `history.py::history_context` |
| REJA tugmasi | TTL 600 s, payload 60000 belgigacha, preview 5 edit, 280 belgi | `reja.py` (`contract.py::APPROVAL_TTL_S`, `PAYLOAD_MAX`, `PREVIEW_EDITS`, `PREVIEW_SNIPPET`) |
| Va'da | default 2 soat, "ertaga" 12 soat, eslatma 25 daqiqada, 3 martadan keyin jim | `leader_logic.py::detect_promise`, `leader_bot.py::_save_promise`, `_reminder_scheduler` |
| Checker | start 45 s, keyin 4 soat, alert throttle 1 soat | `checker_worker.py` |
| Teacher | 22:30, lease 20 daqiqa, 30000+ belgi bo'lsa 4 mini + yakuniy | `teacher_daily.py` |
| Rasm | `static/tg_uploads/`, 7 kun | `leader_bot.py` |
| Facts | har 300 s, 15 daqiqadan eski = eski | `support_facts.py::facts_scheduler` (`contract.py::FACTS_INTERVAL_S`, `FACTS_ESKI_S`) |
| To'lov tekshiruvi | prefetch 45 s (tashqarida 60 s), DB statement 15 s, CRM so'rov 20 s; bir chaqiruvda 3 shartnomagacha va 7 CRM so'rovigacha (parallellik 1), CRM kesh 10 daqiqa (faqat xotirada), kunlik 300 so'rov (`AGENTS_TOLOV_CRM_KUNLIK`); blok 9000 belgi, jadval 40 qator (`/tolov` da 15), farqlar 25 | `contract.py::TOLOV_*`, `payment_check.py::_CrmSessiya`, `leader_bot.py::_tolov_prefetch` |

### REJA qo'llash (TypeScript loyihasi)

- `.py` fayl: vaqtinchalik nusxada `py_compile` (bot interpreteri, `sys.executable`).
- `backend/**/*.ts` o'zgarsa: vaqtinchalik nusxada `tsc --noEmit --pretty false -p backend/tsconfig.json` (`node_modules/.bin/tsc`, bo'lmasa `npx --no-install tsc`; `reja.py::_tsc_check`, `contract.py::TSC_LOYIHALAR`).
- `frontend/**/*.ts(x)` o'zgarsa: shunday, `-p frontend/tsconfig.json`.
- Faqat `.md` bo'lsa tekshiruv yo'q.
- Xato sababi SISTEMA'da: `Support APPROVED BAJARILMADI — <sabab: find topilmadi | find N marta | fayl o'zgargan | py_compile | tsc | commit | push | muddat o'tgan | restart | branch | band (boshqa reja ishlayapti)>`. Shu ro'yxat `leader.md` 7, `support.md` 13, `imkoniyatlar.md` 8 da bir xil.
- Support REJA kodini sinamaydi. Test logida: "reja kodi sinalmagan, bot qo'llashda tsc qiladi" (`.ts`) yoki "reja kodi sinalmagan, bot qo'llashda py_compile qiladi" (`.py`).
- Commit: har fayl alohida `git add -- <fayl>` (hech qachon `-A`), `feat(support): <summary, 60 belgi>`, `git push origin main`.
- Push qarori (egasi, 2026-09-28): [Ha] egasining push ruxsati. Bot `main` ga o'zi push qiladi, serverdagi push kaliti bilan (faqat shu repo). Agent foydalanuvchisi kalitni o'qiy olmaydi. Deploy'ni push'dan keyin webhook boshlaydi.
- Shartlar (`reja.py::_preconditions`): branch `main`, index toza, fayllar `git status --porcelain` da toza (aks holda `branch`); xesh preview'dagidek (aks holda `fayl o'zgargan`); lokal HEAD = origin/main (`git ls-remote`). HEAD origin'dan farq qilsa `branch`: bot tasdiqsiz commitni push qilmaydi.
- Deploy lock: `/var/run/xon-tranzactions-deploy.lock` (shablondagi `.deploy.lock` emas). Deploy log `/var/log/xon-tranzactions/deploy.log`. Ikkalasi env `DEPLOY_LOCK`, `DEPLOY_LOG` bilan almashadi (`config.py`), nomlari `scripts/deploy.sh` bilan bir xil.

### Facts: umumiy kalitlar

- `updated_at` — birinchi kalit.
- `system.services` — 5 systemd servis: `xon-tranzactions-backend`, `xon-tranzactions-frontend`, `xon-tranzactions-leader`, `postgresql`, `nginx`.
- `schedulers` — pastdagi "Schedulerlar izi" jadvalidan.
- `deploy` — `agents/state/deploy_log.json`. `deploy.sh` uni hali yozmaydi. Fayl yo'q bo'lsa Facts `deploy.log` oxiridan o'qiydi (`support_facts.py::_collect_deploy`, `manba` maydoni qaysi ekanini aytadi). `error` faqat ikkalasi ham o'qilmasa. "deploy_log.json bor" deb va'da qilinmaydi.
- `agent_tasks` — `tasks` (oxirgi 60), `promises` (oxirgi 40).
- Loyiha kalitlari (16 ta) va ularning manbasi: pastda "Facts manbalari".

### .env kalit nomlari

Faqat nomlar, qiymat yo'q.

Bot (`xon-tranzactions-leader`). Fayl `backend/.env`: egasi 2026-09-28 kalitlarni shu faylga yozdi, repo ildizi `.env` emas. Yo'l `AGENTS_ENV_FILE` bilan almashadi. `os.environ` dagi qiymat fayldan ustun (`config.py::env`).
- `LEADER_BOT_TOKEN` — yangi bot tokeni. v1 leader ham shu faylda shu nomni o'qiydi (pastga qarang).
- `LEADER_TG_ID` — egasi Telegram ID. `contract.py::EGASI_TG_ID` ga mos kelmasa bot ishga tushmaydi.
- `ANTHROPIC_SETUP_TOKEN` — `claude setup-token` natijasi.
- `AGENTS_USE_CLI` — `1` bo'lishi shart.
- `CLAUDE_CMD` — Claude Code CLI yo'li (default `claude`).
- `AGENTS_MODEL_STRONG`, `AGENTS_MODEL_FAST` — model ID'lari (bo'lmasa `config.py` default).
- `AGENT_DAILY_CAP` — kunlik chegara (default 200).
- `AGENT_TIMEOUT_S` — hamma agent timeout'i (default 180). `AGENT_TIMEOUT_S_<AGENT>` — bitta agentga, ixtiyoriy.
- `AGENT_OS_USER` — agent CLI ishlaydigan imtiyozsiz OS foydalanuvchisi.
- `ANTHROPIC_BASE_URL` — ixtiyoriy, agent env'iga o'tadi.
- `DEPLOY_LOCK`, `DEPLOY_LOG` — default `/var/run/xon-tranzactions-deploy.lock`, `/var/log/xon-tranzactions/deploy.log`. Nomi `scripts/deploy.sh` va `DeployService` bilan bir xil va bitta faylda: bot va deploy bir xil lock'ni ko'radi.
- `AGENTS_ENV_FILE` — env fayli yo'li (default `backend/.env`). systemd unit'da beriladi.
- `AGENTS_REPO` — repo ildizini almashtiradi, faqat testlar uchun.
- DB (shablonda nomi yo'q): `AGENTS_DB_URL` (bot jadvallari, `agents` sxemasi) va `AGENTS_FACTS_DB_URL` (Facts, faqat SELECT huquqli rol), ikkalasi ixtiyoriy. Kodda zanjir: `AGENTS_FACTS_DB_URL` → `AGENTS_DB_URL` → `DATABASE_URL` (`config.py::get_settings`). Ular berilmasa Facts ham, bot jadvallari ham backend'ning to'liq huquqli `DATABASE_URL` i bilan ishlaydi, Facts'ni faqat `READ ONLY` tranzaksiya himoya qiladi. SELECT huquqli rol tavsiya qilinadi (egasi qarori). `DATABASE_URL` agent env'iga hech qachon o'tmaydi.
- `ANTHROPIC_API_KEY` shu faylda bor, lekin bot uni agentga bermaydi.
- To'lov tekshiruvi (`payment_check.py`, nomlar `contract.py::TOLOV_CRM_ENV_*`). Qiymatlar faqat bot jarayonida, har CRM so'rovida `config.env` bilan o'qiladi: global'da saqlanmaydi, agent env'iga, logga, blokka tushmaydi.
  - `XONSAROY_API_KEY`, `XONSAROY_API_SECRET` — XonSaroy CRM client kaliti. Backend ham shu nom bilan shu faylda o'qiydi (`backend/src/crm/crm.service.ts`). `AGENTS_ENV_FILE` boshqa faylga ko'rsatsa, egasi ikkalasini o'sha faylga qo'shadi. Yo'q bo'lsa blokda `[crm] UNKNOWN: kalit yo'q`, qolgan tekshiruv ishlaydi.
  - `XONSAROY_CLIENT_BASE` — ixtiyoriy, default `contract.py::TOLOV_CRM_BASE_DEFAULT` (backend default'i bilan bir xil). Faqat `https`, host shu qiymatga qadaladi. Yaroqsiz bo'lsa `[crm] UNKNOWN: manzil yaroqsiz`.
  - `AGENTS_TOLOV_CRM` — `0` bo'lsa CRM chaqirilmaydi (`[crm] UNKNOWN: o'chirilgan`). Default yoqilgan.
  - `AGENTS_TOLOV_CRM_KUNLIK` — kunlik CRM so'rov cheklovi (default 300). Hisoblagich `kv_store['tolov_crm_<YYYYMMDD>']`. Tugasa `[crm] UNKNOWN: kunlik cheklov tugadi`.

v1 leader (`backend/.env`, boshqa arxitektura, bu tizimga tegishli emas): `LEADER_ENABLED`, `LEADER_BOT_TOKEN`, `LEADER_OWNER_TG_IDS`, `LEADER_MODEL`, `LEADER_MODEL_STRONG`, `LEADER_DAILY_TOKENS`, `LEADER_ALERTS`, `LEADER_TEACHER`, `LEADER_REPO_DIR`, `LEADER_AGENTS_DIR`, `LEADER_SECRET_LITERALS`.
Nom ham, fayl ham bir xil (`LEADER_BOT_TOKEN`, `backend/.env`). v1 `LEADER_ENABLED` != '0' va `LEADER_OWNER_TG_IDS` bor bo'lsa ishlaydi (`leader-config.service.ts`). Unda backend keyingi restartida yangi bot tokeni bilan poll qiladi: Telegram 409 Conflict, egasi ikki botdan javob oladi. Yangi bot esa startda buni aniqlasa ishga tushmaydi (`config.py::v1_leader_conflict`, `leader_bot.py::run`: logda `sozlama xatosi: backend/.env dagi v1 leader shu tokenni ishlatadi`). Yechim `LEADER_ENABLED=0` (egasi qarori).

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"

- `leader.md` 7, `support.md` 13, `teacher.md` halollik ro'yxati, `imkoniyatlar.md` 8 dagi SISTEMA matnlari o'zgarsa → `contract.py` `SIS_*` va `BAJ_*` shablonlari ham (harfma-harf). Tarixga `history.py::add_system` yozadi.
- `leader.md` 4 JSON kalitlari o'zgarsa → `leader_logic.py::parse_leader_response` ham.
- `leader.md` 8 va'da so'zlari o'zgarsa → `contract.py::VADA_TRIGGERS` va `leader_logic.py::detect_promise` ham.
- Xotira trigger so'zlari (`leader.md` 18, `teacher.md`, INDEX, `knowledge/README.md`) o'zgarsa → `contract.py::XOTIRA_TRIGGERS` va `leader_logic.py::detect_memory_command` ham.
- `support.md` 4 "Bot filtri" 7 so'zi o'zgarsa → `contract.py::BLOKSIZ_SOZLAR` (`reja.py::has_blockless_trigger`, KOD 3.2) ham.
- `support.md` 7 `[REQUEST_APPROVAL]` kalitlari yoki markerlari o'zgarsa → `contract.py::REQUEST_APPROVAL_RE`, `PLAN_KEYS`, `MARKER_RE` va `reja.py::extract_request_approval`, `parse_plan` ham.
- `teacher.md` rejim sarlavhalari o'zgarsa → `contract.py::TEACHER_*_TPL` ham (`teacher_daily.py`, fon topshirig'i `memory_blocks.py::teacher_fon`).
- `Teacher uchun:` qatori shakli (`support.md` 14, `checker.md`, INDEX 5) o'zgarsa → `contract.py::TEACHER_UCHUN_RE` ham (`memory_blocks.py::extract_teacher_lines`, uni `leader_bot.py`, `checker_worker.py`, `teacher_daily.py` chaqiradi).
- `checker.md` `=== CHECKER_WORKER OLDINDAN OLINGAN NATIJALAR ===` sarlavhasi o'zgarsa → `contract.py::CHECKER_BLOK_BOSH` ham (`checker_worker.py::format_block`, `leader_bot.py::_delegate_body`).
- To'lov tekshiruvi satrlari (`contract.py` 18-bo'lim: `INTENT_TOLOV`, `TOLOV_TOPSHIRIQ_RE`, `TOLOV_BLOK_BOSH`, `TOLOV_KOMPONENTLAR`, `TOLOV_STUB_*`, `MSG_TOLOV_FOYDALANISH`, `TOLOV_QISQA_*`) o'zgarsa → `checker.md` "To'lov tekshiruvi rejimi", `leader.md` 4, 5, 9, 13, 19-21, `imkoniyatlar.md` 4.2 va 5, `tolov_tekshirish.md` ham (harfma-harf). `TOLOV_FARQ_KODLARI` yoki `TOLOV_FARQ_TUZATISH` o'zgarsa → `tolov_tekshirish.md` 7-bo'lim jadvali ham (`tests/test_payment_check.py` sinxronligini tekshiradi).
- `backend/src/crm/crm.service.ts` (`paymentsByContract`, kompozit ID), `crm-sverka.service.ts` (juftlash, split), `contract-parser.ts` (shartnoma raqami) qoidasi o'zgarsa → `payment_check.py` dagi Python nusxasi (`norm_contract`, `variantlar`, `parse_composite`, `composite_core`, `crm_kind`, `juftla`) ham. Kod bilan bog'lanmaydi, qo'lda moslanadi.
- `leader.md` 16 `[REACT:<belgi>]` nomlari (`thumbsup`, `ok_hand`, `fire`, `clap`, `thinking`, `eyes`, `pray`, `handshake`, `writing_hand`) o'zgarsa → `agents/contract.py::REACT_MAP` dagi nom → emoji jadvali ham; `leader_logic.py::extract_react` shu jadvalni ishlatadi (shablondan farqi: belgi emoji emas, nom).
- `runner.py::agent_disallowed_tools` (`contract.py::DISALLOWED_TOOLS`), `agents/claude_settings.json` yoki `agents/bin/bash_guard.py` o'zgarsa → `imkoniyatlar.md` 1-3 va INDEX "Asboblar chegarasi" ham.
- `support_facts.py::build_facts` kaliti o'zgarsa → Facts kalitlari ro'yxati 4 joyda (INDEX "Qayerga qarash", `leader.md` 9, `support.md` 4, `checker.md` "Facts kalitlari"), `imkoniyatlar.md` 4.1 va shu fayldagi "Facts manbalari" ham.
- INDEX "Modullar xaritasi" o'zgarsa → `leader.md` 19 ham (bir xil qiymat).
- `scripts/deploy.sh` lock yoki log yo'li o'zgarsa → `config.py` `DEPLOY_LOCK`, `DEPLOY_LOG` default'lari (`reja.py::_acquire_deploy_lock`, `support_facts.py::_collect_deploy`) ham.
- `backend/src/deploy/deploy.service.ts::servicesToRestart` o'zgarsa → `agents/*.py` commiti qanday deploy qilinishi o'zgaradi.
- `backend/prisma/schema.prisma` va deploy'dagi `db push` → `db_migrations.py::ensure_tables` `agents` sxemasida qolishi shart.
- `backend/src/leader/leader-facts.service.ts::clean` naqshlari (token, parol, URL login, email, 14 raqam, telefon, chat ID) → `support_facts.py::_clean` shu naqshlarning Python nusxasi. Ular kod bilan bog'lanmaydi, qo'lda moslanadi.

## Xavfli joylar va tuzoqlar

- `prisma db push --accept-data-loss` har backend deploy'da: `public` sxemadagi, `schema.prisma` da yo'q jadval ogohlantirishsiz o'chadi. Bot jadvallari faqat `agents` sxemasida.
- `scripts/deploy.sh` `flock -w 60` bilan kutadi. Lock 60 s dan ko'p band bo'lsa deploy "tashlab ketildi" deb chiqadi va webhook deploy'i yo'qoladi. Bot REJA ijrosi shu lock'ni `reja.py::_acquire_deploy_lock` bilan oladi (900 s gacha kutadi, `contract.py::DEPLOY_LOCK_WAIT_S`), push'dan keyin darhol bo'shatadi (`execute_approved`). Lock faqat yozish bosqichida (`_write_apply`: yozish, commit, push), `tsc` paytida olinmaydi. deploy.sh 60 s kutadi.
- `deploy.sh` `agents/state/deploy_log.json` yozmaydi (KOD ishi). Unga qadar Facts `deploy.log` oxiridan o'qiydi (`support_facts.py::_collect_deploy`). `error` faqat ikkalasi ham o'qilmasa.
- `agents/*.py` commiti deploy uchun "root fayl": `servicesToRestart` frontend va backend'ni to'liq qayta quradi (5-8 daqiqa). `.md` commiti restartsiz o'tadi.
- `xon-tranzactions-leader` ni `deploy.sh` restart qilmaydi. `agents/*.py` o'zgarsa `leader_bot.py::_source_watcher` `os._exit(0)` qiladi, systemd ko'taradi. REJA ijrosi paytida (`sup_exec_active`) chiqish kechiktiriladi, egasi suhbati tugashini ko'pi bilan 900 s kutadi. Qo'lda `git reset --hard` bo'lsa servisni qo'lda restart qil.
- `agents/.gitignore` runtime fayllarni yopadi: `/state/`, `/memory/leader-runtime.md`, `/memory/learned.md`, `/memory/daily/`, `__pycache__/`, `*.pyc`, `venv/`, `.venv/`. `static/tg_uploads/` ni bot `config.py::ensure_dirs` da o'z `.gitignore` i (`*`) bilan yopadi: bot bir marta ishga tushmaguncha u ochiq. `.gitignore` o'zgarsa yoki `git add -A` qilinsa Facts va xotira commit bo'lishi mumkin.
- Asbob siyosati `agents/claude_settings.json` da, runner uni `claude --settings` bilan beradi. Repo ildizida `.claude/settings.json` yaratma: `.claude/` root `.gitignore` da, commit qilinsa ham egasining lokal Claude Code sessiyasi agent hook'ini yuklaydi. Yangi fayl REJA uchun himoyalangan (`contract.py::HIMOYA_PREFIKSLAR`).
- `backend/.env` da `ANTHROPIC_API_KEY` bor va bot ham shu faylni o'qiydi. Runner env'ni bot jarayonidan meros olsa yoki fayl `EnvironmentFile` bilan yuklansa, setup token ishlamay qoladi va sir agentga o'tadi. Env faqat oq ro'yxat bilan.
- Bitta tokenda faqat bitta `getUpdates`. Backend ichida sverka boti, correction-bot va v1 leader long-polling qiladi. v1 leader ham `backend/.env` dagi `LEADER_BOT_TOKEN` ni o'qiydi: endi u yangi bot tokeni. v1 yoqilgan bo'lsa backend restartidan keyin 409 Conflict va egasi ikki botdan javob oladi. v1 yangi bot ishlab turganda yoqilsa 409 va ikki javob bo'ladi. Keyingi bot restartida esa yangi bot umuman ishga tushmaydi. v1 ni `LEADER_ENABLED=0` bilan o'chirish egasi qarori.
- `settings` jadvalida sirlar bor (bot tokenlari, AI kaliti, eksport credential, forwarder siri). Facts uni to'liq SELECT qilmaydi, faqat nomi aytilgan kalitlar.
- DB soati ilova soatidan farq qiladi. Facts SQL'da `NOW()` va `CURRENT_DATE` yo'q, oyna chegarasi Python'dan parametr.
- Agent foydalanuvchisi repoga yoza olmaydi: agent o'zi `py_compile` qilsa `__pycache__` ga yoza olmay xato oladi. `ORNATISH.md` bo'yicha bu kutilgan holat: REJA qo'llanganda bot o'zi `py_compile` va `tsc` qiladi. Boshqa yechim (`__pycache__` ga huquq yoki `PYTHONPYCACHEPREFIX`, oq ro'yxat o'zgaradi) egasi qarori.
- `tsc` tekshiruvi `backend/node_modules` va `frontend/node_modules` ga tayanadi. Ularni deploy o'rnatadi (`npm install --include=dev`).
- `scripts/deploy.sh` ichida hali ochiq fallback sir qiymatlari bor. Ularni iqtibos qilma, REJA'ga ko'chirma.
- To'lov tekshiruvida bot jarayoni XonSaroy client kalitini ishlatadi (kodda faqat GET, kalitning o'z huquqi tekshirilmagan). `payment_check.py` ga POST, PUT, DELETE, yangi CRM yo'li yoki oq ro'yxatdan tashqari parametr qo'shilmaydi: `tests/test_payment_check.py` faqat GET (`data=None`), yo'l, host va parametr oq ro'yxatini tekshiradi, manba kodida POST, PUT, PATCH, DELETE metodi yo'qligini ham. CRM `contract` filtri LIKE natija beradi (kod aniq filtrlaydi), 500 qator chegarasida jami "to'liq" deyilmaydi. Batafsil: `tolov_tekshirish.md` "Xavfli joylar".

## Tez-tez qilinadigan o'zgarishlar — qayerda

| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Yangi Facts kaliti (faqat egasi "qo'sh" desa) | `agents/support_facts.py::_collect_<kalit>` + `build_facts`; INDEX "Qayerga qarash", `leader.md` 9, `support.md` 4, `checker.md`, `imkoniyatlar.md` 4.1, shu fayl "Facts manbalari" |
| Yangi SISTEMA yozuvi | `contract.py` `SIS_*` shablonlari, `history.py::add_system`; `leader.md` 7, `support.md` 13, `teacher.md`, `imkoniyatlar.md` 8 |
| Agent asbobi | `runner.py::agent_disallowed_tools`, `agent_tools`, `contract.py::DISALLOWED_TOOLS`, `agents/claude_settings.json`, `agents/bin/bash_guard.py`; `imkoniyatlar.md` 1-3 |
| Timeout, cap, model | `config.py` (`agent_timeout_s`, default), `runner.py`; `backend/.env` (`AGENT_TIMEOUT_S`, `AGENT_TIMEOUT_S_<AGENT>`, `AGENT_DAILY_CAP`, `AGENTS_MODEL_STRONG`, `AGENTS_MODEL_FAST`); `imkoniyatlar.md` 1 |
| Himoyalangan yo'l | `config.py::safe_repo_path`, `config.py::is_sensitive`, `contract.py::HIMOYA_PREFIKSLAR`; `leader.md` 6, `support.md` 7, `imkoniyatlar.md` 6 |
| Va'da so'zi | `leader.md` 8 + `contract.py::VADA_TRIGGERS`, `leader_logic.py::detect_promise` |
| Teacher vaqti yoki rejimi | `contract.py::TEACHER_DAILY_TIME`, `teacher_daily.py::teacher_daily_scheduler`; `teacher.md` |
| Checker tekshiruvi | `checker_worker.py::CHECKS`; `checker.md` "Tez-tez uchraydigan sabablar" |
| To'lov tekshiruvi: farq kodi, CRM parametri, chegara | `payment_check.py::juftla`, `_crm_collect`; `contract.py::TOLOV_FARQ_KODLARI`, `TOLOV_FARQ_TUZATISH`, `TOLOV_CRM_PARAMLAR`, `TOLOV_*` chegaralar; `tolov_tekshirish.md` 7-bo'lim, `checker.md` "To'lov tekshiruvi rejimi"; `tests/test_payment_check.py`. CRM'ga yozuvchi so'rov (POST, PUT, DELETE) qo'shilmaydi |
| Leader doimiy qoidasi | `agents/memory/leader.md` (REJA orqali) |
| Yangi modul bilim fayli | `knowledge/README.md` "Yangi modul qo'shilsa" (6 ta edit bitta REJA'da) |

## Facts manbalari

`agents/support_facts.py` (`_collect_<kalit>`) yozadigan dasturchi uchun. "manba" ustunidagi SQL literallari AYNAN shunday bo'lishi kerak (kirill literal backtick ichida, yonida lotin nomi). "izoh" ustuni har kalitning birinchi maydoni `izoh` ga statik satr bo'lib tushadi.

### Umumiy qoidalar (hamma kalit uchun)
- Drayver: psycopg2 (`requirements.txt`: `psycopg2-binary`, `db.py` orqali). Har bo'lim alohida `_safe(nom, fn)`; ichida `READ ONLY` tranzaksiya va `SET LOCAL statement_timeout = '15s'`.
- DB ulanishi SELECT huquqli rol bilan bo'lishi kerak (`AGENTS_FACTS_DB_URL`; bot jadvallari uchun alohida ulanish). Berilmasa kod `DATABASE_URL` ga tushadi: yuqoridagi ".env kalit nomlari" ga qarang.
- DateTime ustunlar tz'siz, qiymati UTC (Prisma). Toshkent = UTC+5, yozgi vaqt yo'q. Oyna chegaralari Python'da hisoblanib parametr bo'ladi. `NOW()` va `CURRENT_DATE` ishlatilmaydi (DB soati app soatidan farq qiladi).
- `@db.Date` ustunlar (`oplata_kv.date`, `xonpay_transactions.date_paid`, `sync_exclusion_ranges.date_from/date_to`) Toshkent sanasi literal: parametr `YYYY-MM-DD`.
- Toshkent kuni bo'yicha guruhlash: `(ustun + interval '5 hours')::date`.
- Chiqish: vaqt `YYYY-MM-DD HH:MM` (Toshkent), Decimal → son 2 xona, BigInt → butun son.
- Erkin matn (xato, izoh, sabab) `backend/src/leader/leader-facts.service.ts::clean` naqshlari bilan tozalanadi (token, parol, URL login, email, 14 raqam, +998 telefon, `-100...` chat ID) va kesiladi. Python'ga ko'chirib yoziladi, TS kodga bog'lanmaydi.
- `triggered_by`, `detected_by`, `imported_by`: `manual:<email>` → `manual`, boshqa email → maskalanadi.
- Har loyiha kalitining BIRINCHI maydoni `izoh`: pastdagi "izoh" ustunidagi matn, `support_facts.py` ichida statik satr. DB'dan olingan matn `izoh` ga hech qachon qo'shilmaydi.
- Og'ir bo'limlar (`xato`, `oplatykv_sync`) 15 daqiqa keshlanadi: oldingi qiymat + `hisoblangan` vaqti `kv_store` da.
- `settings` jadvali hech qachon to'liq SELECT qilinmaydi: faqat pastda nomi aytilgan kalitlar. Token kalitlarining `value` si o'qilmaydi, faqat `(value IS NOT NULL AND value <> '')`.
- Backend HTTP endpointlari chaqirilmaydi (`/api/transactions/reconcile/today`, sync, `testConnection` tashqi so'rov va DB yozuvi qiladi).
- Retention yo'q jadvallarda (`sync_logs`, `audit_logs`, `api_request_logs`, `transaction_change_logs`) har so'rovda sana sharti majburiy.

### Kalitlar

| kalit | manba (jadval, ustun, filtr) | yangilanish | izoh (Facts `izoh` maydoni matni) |
|---|---|---|---|
| `client_income` | `oplata_kv`. Asosiy filtr (`backend/src/oplata-kv/oplata-kv.service.ts::dailySummary` bilan bir xil): `payment_amount > 0 AND tx_type ILIKE '%взнос%'` (vznos). SUM(`payment_amount`), SUM(`first_installment`), SUM(`monthly_amount`), COUNT(*). Bo'limlar: `bugun`; `kecha_toliq`; `kecha_shu_vaqtgacha` (kecha AND `created_at` <= kecha + hozirgi Toshkent HH:MM:SS, UTC'ga o'girilgan); `oy_boshidan`; `otgan_oy_shu_kungacha`; `kunlik` 14 kun (GROUP BY `date`); `top_obyektlar` 10 (GROUP BY `object`, qo'shimcha `NOT tx_type ILIKE '%от имени%'` (ot imeni)); `ot_imeni` (asosiy filtr AND `tx_type ILIKE '%от имени%'` (ot imeni), jami ichida bor); `qaytarishlar` (`payment_amount < 0 AND tx_type ILIKE 'возврат%'` (vozvrat), ABS(SUM), COUNT; bugun va oy boshidan). TAQIQ: `client`, `purpose`, `contract_no`. Kod: `leader-facts.service.ts::clientIncome`. | 5 daq | OplatyKv vznos to'lovlari, so'm, Toshkent kuni. Bugunni kechaning shu vaqtgacha qismi bilan solishtir, to'liq kun bilan emas. Jami ichida 'ot imeni klienta' ham bor: u tushum emas, alohida ayt. Bu bank kirimi emas (u bank_flow). Panel kunlik xulosasi server soatiga bog'liq, bu yerdagisi aniq Toshkent. |
| `bank_flow` | `transactions t` + `banks.code` + `categories.code`. Oyna: `t.txn_date >= (D 00:00+05 → UTC) AND t.txn_date < (D+1 00:00+05 → UTC)`. Bo'limlar: `bugun`, `kecha`, `kunlik` 7 kun (GROUP BY `(t.txn_date + interval '5 hours')::date`). Asosiy: `status='COMPLETED' AND currency='UZS'`, GROUP BY `direction` → SUM(`amount`), COUNT. `bank_kesimi`: shu filtr, GROUP BY `bank_id`, `direction`. `transfer`: `category_id = (SELECT id FROM categories WHERE code='TRANSFER')`, IN va OUT alohida; `tashqi_kirim` = kirim − transfer kirim. `holat_kesimi`: GROUP BY `direction`, `status`, `currency`. `boshqa_valyuta`: `currency <> 'UZS'` alohida. TAQIQ: `from_name`, `to_name`, `from_inn`, `to_inn`, `from_account`, `to_account`, `description`, `metadata`, `raw_extra`. Kod: `leader-facts.service.ts::txnSummary`. | 5 daq | Jami faqat COMPLETED va UZS, so'm, Toshkent kuni. TRANSFER (o'z hisoblar orasidagi o'tkazma) jamida bor, tashqi kirimni alohida ayt. PENDING jamiga kirmaydi, panel dashboard esa qo'shadi: farq shundan. Hamkor karta to'lovlari settlement kuniga to'planadi, shishgan kun xato emas. |
| `balances` | `bank_accounts a JOIN banks b ON b.id = a.bank_id`: `b.code`, `b.name`, `b.api_kind`, `b.is_active`, `a.account_no`, `a.owner_name`, `a.currency`, `a.balance`, `a.sync_enabled`, `a.last_synced_at`. `jamiga_kirgan` = `a.sync_enabled AND b.is_active AND a.balance IS NOT NULL`. `bank_kesimi`: GROUP BY `b.code`, `a.currency` (faqat jamiga kirgan). `umumiy`: GROUP BY `currency`. Har hisob bitta qator, qoldiq bo'yicha kamayish. `b.api_kind = 'HAMKORBANK_V1'` qatoriga `qoldiq_ishonchsiz = true`. Kod: `leader-facts.service.ts::accountBalances`. | 5 daq | Qoldiq so'm, valyuta alohida. Jamiga faqat sync yoqilgan va bank faol hisob kiradi, qolgani noma'lum, 0 emas. Vaqt = oxirgi sync (Toshkent), qoldiq vaqti emas. Backfill qoldiqni yangilamaydi. Hamkor qoldig'i ishonchsiz (faqat vipiska saldosi kelganda yangilanadi). |
| `bank_sync` | `bank_accounts a JOIN banks b ON b.id = a.bank_id JOIN bank_credentials c ON c.id = a.credential_id`. Faol = `a.sync_enabled AND b.is_active AND c.is_active AND b.api_kind IN ('KAPITALBANK_V3','IPAK_YOLI_V1','HAMKORBANK_V1')` (`sync.service.ts::tick` sharti). Har hisob: `b.code`, `b.sync_interval_minutes`, `a.account_no`, `a.owner_name`, `a.last_synced_at` + oxirgi 3 `sync_logs` (`account_id` bo'yicha, `started_at` oxirgi 24 soat, ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY started_at DESC)): `status`, `fetched`, `saved`, `errors`, `error_message` (200, tozalangan), `started_at`, `finished_at`, `source` da 'backfill' bo'lsa belgi. Signallar (`leader-health.service.ts::checkBankSync`): `stale` = app_now − `last_synced_at` > 3 × interval (interval > 0); `login_suspect` = oxirgi yakunlangan log `PARTIAL` AND `fetched = 0` AND `errors >= 10`; `hung` = `RUNNING` va `started_at` 15 daqiqadan eski; `failed` = oxirgi 3 tasi `FAILED`. `banklar`: har bank bitta qator (code, api_kind, is_active, interval, hisoblar, sog', muammoli). `bugun`: Toshkent kuni oynasida `sync_logs` → COUNT, SUM(fetched, saved, errors), GROUP BY status. `ulanishlar`: `bank_credentials` faqat `label`, `is_active`, `auth_mode`, `use_proxy`, `last_verified_at`, `last_error` (200). `settings` (faqat): `bulkSync.enabled`, `bulkSync.timeOfDay`, `bulkSync.intervalDays`, `bulkSync.lastRunAt`, `sync.minDate`. `importlar`: `import_batches` ORDER BY `imported_at` DESC LIMIT 10: `kind` ('transactions', 'aloqa-bank', 'oplata-kv', 'hamkor-vipiska'), `file_name` (80), `imported_by` (maska), `imported_at`, `rows_total`, `rows_added`, `rows_skipped`, `rows_errors`, `notes` (100); `importlar_30_kun`: GROUP BY `kind` → COUNT, SUM(`rows_added`), SUM(`rows_errors`). TAQIQ: `password_enc`, `login_name`, `login_prefix`, `client_id_ext`, sid ustunlari, `banks.api_base_url`. | 5 daq | Har hisob bitta qator, signal: stale, login_suspect, hung, failed; vaqt Toshkent. last_synced_at login xatosida ham yangilanadi: sog'likni signal bilan ayt. interval 0 = avto-sync o'chiq, muammo emas. Parol muddati ma'lumoti yo'q. Importlar: tur, vaqt, qator va xato soni; fayl mazmuni yo'q. Sync, ulanish testi, importni o'chirish panel ishi. |
| `hamkorbank` | `banks WHERE code = 'HAMKORBANK'` (`api_kind` `HAMKORBANK_V1`): `is_active`, `sync_interval_minutes`. Hisoblar: `bank_accounts` (`account_no`, `owner_name`, `sync_enabled`, `last_synced_at`) + har hisob oxirgi `sync_logs` (status, fetched, saved, errors, error_message 200, started_at, backfill belgisi). `transactions WHERE bank_id = <Hamkor id> AND status = 'COMPLETED'`, oxirgi 7 Toshkent kuni: GROUP BY `source` ('SYNC', 'HAMKOR_IMPORT'), `direction` → COUNT, SUM(`amount`). Vipiska importlari: `import_batches WHERE kind = 'hamkor-vipiska'` ORDER BY `imported_at` DESC LIMIT 5 (`file_name` 80, `imported_at`, `rows_total`, `rows_added`, `rows_skipped`, `rows_errors`). `sync_exclusion_ranges` JOIN Hamkor hisoblari: `account_no`, `date_from`, `date_to`, `source`, `created_at` (faqat ma'lumot, `upsertOne` tekshiruvi olib tashlangan, commit d19dc52). `bank_credentials`: `label`, `is_active`, `last_verified_at`, `last_error` (200). TAQIQ: `api_base_url`, login/parol maydonlari, `hb_dedup_key`, `metadata`, `raw_extra`. | 5 daq | Hamkor uchun faqat sync va ID inspektor ishlaydi. Sverka, vipiska sahifasi va memorial order Hamkor uchun yo'q: 'farq yo'q' dema. O'tgan davr faqat vipiska importi bilan keladi (API backfill bank tomonida buzuq). Import yozuvi real to'lov. txn_date = hisobga tushgan sana, karta surilgan kun emas. Summa so'm, vaqt Toshkent. |
| `sverka` | `settings WHERE key = 'sverka.telegram.notifiedToday'`: `value` JSON `{date, digest, accounts{<id>: {accountNo, ownerName, bankName, totalFarq, culprit, confidence, dismissed, actionKind}}}` va `updated_at`. `date` == bugungi Toshkent sanasi bo'lsa: har hisob bitta qator (bankName, accountNo, ownerName, totalFarq, culprit 200 tozalangan, confidence, dismissed); ochiq va yopilgan soni. `digest.msgs` (chatId, messageId) CHIQARILMAYDI. `settings 'sverka.telegram.history'` (JSON massiv) oxirgi 10: timestamp, action, source, actorName (faqat raqam bo'lsa '(chat)'); `details` dan chat, chatId, chat_id, chats, name, botUsername, token kalitlari olib tashlanadi; action `chat_*` bo'lsa details yo'q. `sverka_chatlari_soni` = `jsonb_array_length(value::jsonb)` FROM settings WHERE key = 'sverka.telegram.chats' (faqat son). Kod: `leader-facts.service.ts::sverkaStatus`, `sverka-telegram.service.ts::autoSverkaNotify`. | 5 daq | Avtomat sverka (har 30 daqiqa) saqlagan bugungi farqlar, so'm, vaqt Toshkent. Faqat Kapitalbank va Ipak Yo'li. Saqlangan sana bugun emas yoki chatlar soni 0 bo'lsa: noma'lum, 'farq yo'q' emas. Aybni faqat ishonch high bo'lsa ayt. Jonli sverka panel ishi. |
| `crm_sverka` | `settings WHERE key = 'crmSverka.lastRun'`: `value` JSON `{status (running, done, error, crashed), startedAt, finishedAt, crmCount, ourCount, warning, error, actor}`; matnlar 200, tozalangan. `snapshot_yangilangan` = `SELECT updated_at FROM settings WHERE key = 'crmSverka.snapshot'` (`value` SELECT QILINMAYDI: gzip+base64, 228k+ yozuv). `crm_kesh`: `crm_contracts` → COUNT(*) FILTER (WHERE found), COUNT(*) FILTER (WHERE NOT found), MAX(`last_verified_at`), COUNT(*) FILTER (WHERE `branch_name` IS NULL). TAQIQ: `phone`, `raw_snapshot`, `customer_name`. Cron: `crm-sverka.service.ts` `'0 7,12,17 * * *'` Asia/Tashkent. | 5 daq | Oxirgi run holati va sonlar, vaqt Toshkent. Farqli shartnomalar ro'yxati DB'da yo'q, faqat panelda (Sverka CRM sahifasi): to'qima. crashed odatda server restart. Avtomat run 07:00, 12:00, 17:00. CRM faqat o'qiladi. Mijoz ismi va telefon yo'q. |
| `xato` | (a) tranzaksiya tomoni: `transactions t JOIN categories c ON c.id = t.category_id AND c.code = 'CLIENT' WHERE t.is_contract_manual = false AND t.source NOT IN ('IMPORT','ALOQA_BANK') AND t.contract_number IS NOT NULL AND NOT EXISTS (SELECT 1 FROM crm_contracts cc WHERE cc.contract_number = t.contract_number AND cc.found)` → `faol` COUNT, SUM(`amount`) FILTER (WHERE `t.xato_hidden` IS NOT TRUE); `yashirilgan` COUNT FILTER (WHERE `t.xato_hidden`); `top_shartnomalar` 10 (faol, GROUP BY `contract_number`). (b) OplatyKv tomoni: `oplata_kv o WHERE o.source_tx_id IS NOT NULL AND NOT EXISTS (crm_contracts cc: cc.contract_number = o.contract_no AND cc.found) AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.xato_hidden AND (t.id = o.source_tx_id OR t.external_id = o.source_tx_id))` → COUNT, SUM(`payment_amount`). `oplata_kv.contract_no` NOT NULL (`schema.prisma`): alohida NULL sharti kerak emas, kod (`support_facts.py::_XATO_OKV_WHERE`) ham qo'shmaydi, `buildXatoFilter` bilan paritetga ta'sir qilmaydi; `guruhga_yuborilmagan`: + `o.agent_notified_at IS NULL` (settings `agent.dateFrom` bo'lsa `o.date >=` shu sana). `arizalar`: `xato_correction_requests` GROUP BY `status`, `agent_state`; `bugun_yuborilgan` (`submitted_at` Toshkent kuni); `bugun_korildi` (`reviewed_at` bugun, GROUP BY `status`, `reviewed_by_type`); `agent_hal_qilgan` (`status = 'approved' AND reviewed_by_type = 'agent'`, jami va bugun); `eng_eski_kutayotgan` = MIN(`submitted_at`) WHERE `status = 'pending'`; `namunalar` 5 (pending, `submitted_at` DESC): `submitted_at`, `submitted_by_name`, `source`, `proposed_contract_no`, `snap_contract_no`, `snap_amount`, `snap_object`, `agent_state`, `agent_reason` (150). `ai_agent`: settings `agent.aiEnabled`, `agent.aiModel`, `agent.aiIntervalMin`, `agent.aiFromHour`, `agent.aiToHour`, `agent.aiName`; `ai_kalit_bor` = `(value IS NOT NULL AND value <> '')` WHERE key = 'agent.aiKey'. TAQIQ: `submitted_by_chat_id`, `snap_client`, `snap_purpose`, `attachment_*`. Kod: `transactions.service.ts::clientXatoTransactions`, `oplata-kv.service.ts::buildXatoFilter`, `leader-facts.service.ts::xatoSummary`. | 15 daq kesh | Ikki ta'rif bor: tranzaksiya tomoni va OplatyKv tomoni, qaysi ekanini ayt. Qiymat 15 daqiqa keshlangan, hisoblangan vaqtini (Toshkent) ayt. Summa so'm. Arizalar va AI agent holati shu yerda. Tasdiqlash va tuzatish panel ishi. Mijoz ismi yo'q. |
| `oplatykv_sync` | `tushmagan`: `transactions t JOIN categories c ON c.id = t.category_id AND c.code = 'CLIENT' WHERE t.contract_number IS NOT NULL AND t.txn_date` oxirgi 3 Toshkent kuni oynasida `AND t.txn_date >` (settings `oplatykv.txMinDate` kuni 23:59:59+05, bo'lsa) `AND NOT EXISTS (SELECT 1 FROM oplata_kv o WHERE o.source_tx_id = COALESCE(t.external_id, t.id))` → COUNT, SUM(`amount`), MIN(`txn_date`). `oxirgi_cron_qator`: MAX(`created_at`) FROM `oplata_kv` WHERE `created_by_name LIKE 'cron%'`. `yetim` (`o.date` oxirgi 30 kun): `oplata_kv o WHERE o.source_tx_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.external_id = o.source_tx_id OR t.id = o.source_tx_id)` → COUNT. `kelajak_updated_at`: COUNT(*) FROM `oplata_kv` WHERE `updated_at > <app_now_utc parametr>`. settings: `oplatykv.txAutoSyncMinutes`, `oplatykv.txMinDate`, `oplatykv.dayStart`, `oplatykv.dayEnd`, `oplatykv.nightStart`, `oplatykv.nightEnd`. Kod: `oplata-kv.service.ts::autoSyncTick`, `syncFromTransactions`, `findOrphanTxRows`, `clampFutureUpdatedAt`. | 15 daq kesh | CLIENT bank to'lovidan OplatyKv qatori yaratilmaganlar (3 kun), yetim qatorlar (30 kun), kelajak updated_at. Summa so'm, vaqt Toshkent. XATO shartnoma ham sync bo'ladi, sabab emas. Avto-sync logi DB'da yo'q, oxirgi cron qatori taxminiy belgi. Yetim qatorni o'chirishni taklif qilma. |
| `bank_changes` | `transaction_change_logs`, `detected_at` oxirgi 7 Toshkent kuni: GROUP BY `change_type` → COUNT, SUM(`amount`); bugun alohida. Oxirgi 15 (`detected_at` DESC): `change_type`, `detected_at`, `txn_date`, `amount`, `direction`, `contract_number`, `account_no_snap`, `bank_name_snap`, `fields_changed` (10 tagacha), `detected_by` (`manual:<email>` → `manual`), `note` (150). TAQIQ: `old_data`, `new_data`. Kod: `leader-facts.service.ts::bankChanges`. | 5 daq | DELETED, EDITED, MOVED, aniqlangan vaqt (Toshkent), summa so'm. MOVED o'chirish emas: sana o'zgargan, OplatyKv bog'lanishi saqlanadi. Tiklash panelda (O'zgargan to'lovlar sahifasi). |
| `xonpay` | settings: `xonpay.cron.enabled` (faqat 'false' = o'chiq), `xonpay.cron.intervalMinutes` (default 60). `xonpay_sync_logs` ORDER BY `started_at` DESC LIMIT 5: `trigger`, `status`, `fetched`, `inserted`, `updated`, `matched`, `errors`, `error_message` (200), `started_at`, `finished_at`, `duration_ms`; `orfan` = `status = 'failed' AND error_message ILIKE 'Server restart%'`. `oxirgi_muvaffaqiyatli` = MAX(COALESCE(`finished_at`, `started_at`)) WHERE `status = 'success'`. `moslanmagan_7kun`: `xonpay_transactions WHERE is_matched = false AND date_paid BETWEEN (bugun−6) AND bugun` → COUNT, SUM(`amount`). `bugun`: `date_paid = bugun` → COUNT, SUM(`amount`), COUNT FILTER (WHERE `is_matched`). TAQIQ: `full_name`, `purpose`, `crm_uuid`. Kod: `leader-health.service.ts::checkXonpay`. | 5 daq | Sync logi (Toshkent) va 7 kunlik moslanmagan to'lovlar (so'm). orfan = server restartida uzilgan sync, nosozlik emas. Bugungi va kechagi moslanmagan hali bankka tushmagan bo'lishi mumkin. Avto-sync faqat 07-23 soatlarida. Mijoz ismi yo'q. |
| `google_export` | `export_cron_logs`, `started_at` oxirgi 30 kun: har `sheet_id` uchun oxirgi 2 ta (ROW_NUMBER() OVER (PARTITION BY sheet_id ORDER BY started_at DESC)): `sheet_name`, `source`, `write_mode`, `mode`, `status`, `rows_fetched`, `rows_written`, `duration_ms`, `error` (200), `triggered_by` (maska), `started_at`. `ketma_ket_2_xato` = ikkalasi `error`. TAQIQ: settings `export.credentials`, `export.sheets`, `export.writtenIds.*`, `export.upsertKeys.*`. Kod: `leader-health.service.ts::checkGoogleExport`. | 5 daq | Har sheet bitta qator: oxirgi 2 ishga tushish (Toshkent), ok yoki error, qatorlar soni. Ketma-ket 2 xato jiddiy. 30 kunda log yo'q = cron ishlamagan, 'yaxshi' dema. Qayta eksport panel ishi (Admin, Export). |
| `api_usage` | `api_request_logs WHERE created_at >= app_now − 24 soat` (sana shartisiz so'rov taqiq): COUNT GROUP BY `status_code / 100`; top 10 `path`; GROUP BY `api_key_id` → `api_keys.name`; AVG, MAX(`duration_ms`); COUNT(DISTINCT `ip`) faqat son; oxirgi 5 ta `status_code >= 500`: `created_at`, `method`, `path` (120), `status_code`, `error_message` (150). `api_keys` ORDER BY `created_at` DESC LIMIT 20: `name`, `scopes`, `is_active`, `expires_at` (`muddati_otgan`), `revoked_at`, `last_used_at`, `total_requests`. TAQIQ: `key_id`, `secret_hash`, `secret_preview`, `last_used_ip`, `allowed_ips`, `api_request_logs.ip`, `user_agent`, `query`. Kod: `leader-facts.service.ts::apiUsage`. | 5 daq | Oxirgi 24 soat (Toshkent): status sinflari, top yo'llar, kalit nomi bo'yicha, 5xx namunalar, kalitlar muddati. IP faqat soni. Kalit siri va key_id yo'q, so'rama. |
| `telegram_notify` | Token bor-yo'q faqat ifoda bilan: `SELECT key, (value IS NOT NULL AND value <> '') AS bor FROM settings WHERE key IN ('agent.botToken','sverka.telegram.botToken','corrbot.botToken','chekorder.tg.botToken','shmitd.botToken','autsourcing.botToken')`. Qatorlar: (1) `xato_notifikator`: `agent.enabled`, `agent.dailyTime` (default 09:00), `agent.dateFrom`, `agent.lastResult` ('ISO · matn' → vaqt Toshkent + matn 250 tozalangan); (2) `sverka_bot`: `sverka.telegram.chats` JSON'dan faqat role bo'yicha son (approver, watcher), `notifiedToday.date` va `updated_at`, `kechki_eslatma` = `sverka.telegram.eveningReminder` da `value::jsonb->>'date'` bugungi Toshkent sanasi (parametr) VA `jsonb_array_length(value::jsonb->'msgs') > 0` (faqat son, `chatId`/`messageId` chiqarilmaydi) + `updated_at`. "Bo'sh emas" sharti yaramaydi: 23:00 dan keyin qiymat `{"msgs":[]}`; (3) `tuzatish_boti`: `corrbot.enabled`; (4) `chek_order_bot`: `chekorder.tg.enabled`; (5) `chek_dog`: COUNT(*) FILTER (WHERE `tg_send = false`), MAX(`tg_sent_at`) FROM `chek_dog` (`chek.tg.config` o'qilmaydi, ichida token); (6) `autsourcing`: `autsourcing.cronEnabled`, `autsourcing.cronTime`; (7) `shmitd`: `shmitd.enabled`, `shmitd.cronTimes`, `shmitd.dateOffset` + `shmitd_logs` ORDER BY `sent_at` DESC LIMIT 5: `target_date`, `sent_at`, `status`, `total_count`, `yellow_count`, `red_count`, `error` (200), `triggered_by` (maska). TAQIQ: `*.botToken` qiymati, `*.groupId`, `*.webhookSecret`, `sverka.telegram.password`, `sverka.telegram.sentLog`, `bankpwd.*`, `chek.hr.config`, `shmitd.saJson`, `shmitd.spreadsheetId`, `shmitd_logs.html_content`, `shmitd_logs.group_id`. | 5 daq | Har bildirishnoma bitta qator: yoqilgan, token bor-yo'q, oxirgi natija (Toshkent). Token va guruh ID yo'q, so'rama. Sverka chati 0 = avtomat sverka ishlamaydi. SHMITD empty = o'lchov yo'q, xato emas. Xabar yuborish panel yoki bot ishi. |
| `counterparties` | `counterparties WHERE is_active`: COUNT(*), COUNT(*) FILTER (WHERE `last_fetch_error` IS NOT NULL), MAX(`last_fetched_at`); xato namunalari 5: `name` (80), `last_fetch_error` (150), `last_fetched_at`. settings: `counterparties.autoRefreshEnabled`, `counterparties.xontaminot.autoSync`, `counterparties.xontaminot.intervalMin`, `counterparties.xontaminot.startHour`, `counterparties.xontaminot.endHour`, `counterparties.xontaminot.lastSyncAt`, `counterparties.xontaminot.lastSyncStats` (300). TAQIQ: `director_pinfl`, `director`, `phone`, `email`, `address`, `founders`, `bank_accounts`, `raw_didox_brief`. Kod: `counterparties.cron.ts`. | 5 daq | Faol soni, yangilanish xatolari, oxirgi yangilanish (Toshkent), ta'minot sync natijasi. Direktor, telefon, email, PINFL, ta'sischilar yo'q. DIDOX avto-yangilash 08:00-22:00. |
| `panel_activity` | `audit_logs WHERE created_at >= app_now − 24 soat`: COUNT; GROUP BY `user_name` top 10; GROUP BY `module` top 10; `muvaffaqiyatsiz_kirish` = `module = 'auth' AND success = false AND path LIKE '%/login'` (24 soat va oxirgi 15 daqiqa alohida); oxirgi 20: `created_at`, `user_name`, `module`, `action` (120), `method`, `status_code`, `success`. `admin_users a LEFT JOIN roles r ON r.id = a.role_id`: `a.full_name`, COALESCE(`r.name`, `a.role::text`) (`a.role` `AdminRole` enum, `r.name` VARCHAR: `::text` siz PostgreSQL xato beradi), `a.is_active`, `a.last_login_at` ORDER BY `last_login_at` DESC NULLS LAST LIMIT 10; COUNT GROUP BY `is_active`. TAQIQ: `ip`, `meta`, `user_email`, `path` (chiqishda), `email`, `password_hash`. Kod: `leader-facts.service.ts::panelActivity`. | 5 daq | Oxirgi 24 soat (Toshkent), faqat POST, PATCH, PUT, DELETE: ko'rish yozilmaydi. Xodim ismi bor, IP va email yo'q. Muvaffaqiyatsiz kirishlar soni bor. Foydalanuvchini bloklashni taklif qilma. |

### Schedulerlar izi (`schedulers` kaliti uchun)

Backend cron'lari hammasi `xon-tranzactions-backend` jarayonida. "iz" = oxirgi ishga tushish qayerdan bilinadi.

| nomi | jadvali (Toshkent) | iz |
|---|---|---|
| `SyncService.tick` (bank sync) | har daqiqa (`TXN_SYNC_CRON`, default `* * * * *`), har hisob `banks.sync_interval_minutes` (default 5, 0 = o'chiq) | MAX(`sync_logs.started_at`) |
| `SyncService.bulkScheduleTick` | har daqiqa, gate `bulkSync.timeOfDay` (default 18:00), kuniga 1 marta | setting `bulkSync.lastRunAt` |
| `OplataKvService.autoSyncTick` | har daqiqa; kunduz 08:00-22:00 har N daqiqa, tun 01:00-07:50 kuniga 1 marta | MAX(`oplata_kv.created_at`) WHERE `created_by_name LIKE 'cron%'` (taxminiy) |
| `OplataKvService.schotchikAutoTick` | har daqiqa | iz yo'q (journal) |
| `OplataKvService.crmStatusBackfillTick` | har daqiqa (running lock) | COUNT `virtual_status IS NULL AND found` |
| `CrmContractCacheService.crmMetaBackfillTick` | har daqiqa (running lock) | COUNT `branch_name IS NULL` |
| `SverkaTelegramService.autoSverkaNotify` | har 30 daqiqa (`SVERKA_NOTIFY_CRON`), run lock | `settings.updated_at` WHERE key `sverka.telegram.notifiedToday` |
| `SverkaTelegramService.eveningReminder` | 20:00 | setting `sverka.telegram.eveningReminder`: yuborilgan bo'lsa `{date, msgs}` (`date` = bugun, `msgs` bo'sh emas). Chat bo'lmasa setting o'zgarmaydi. Farq bo'lmasa `{"msgs":[]}` qoladi (sanasiz) |
| `SverkaTelegramService.deleteEveningReminder` | 23:00 | shu setting `{"msgs":[]}` bo'ladi (bo'sh satr emas) va `updated_at` yangilanadi. Setting hali yo'q bo'lsa yozilmaydi |
| `SverkaTelegramService.pollLoop` | doimiy long-polling | iz yo'q |
| `CorrectionBotRunnerService.loop` | doimiy long-polling | iz yo'q |
| `AgentService.tick` (XATO digest) | har daqiqa, gate `agent.dailyTime` (default 09:00), kuniga 1 marta | setting `agent.lastResult` |
| `AgentAiService.tick` (AI ariza) | har daqiqa, gate ish soati va interval (default 5 daq) | MAX(`xato_correction_requests.agent_at`) |
| `ChekService.notifyCron` | har daqiqa, gate soat 9-21, interval 5 daq | MAX(`chek_dog.tg_sent_at`) |
| `CounterpartiesCron.refreshHourly` | `0 8-22 * * *` | MAX(`counterparties.last_fetched_at`) |
| `CounterpartiesCron.xontaminotSyncTick` | har 5 daqiqa, ichki gate | setting `counterparties.xontaminot.lastSyncAt` |
| `CrmSverkaService.autoRefresh` | `0 7,12,17 * * *` (`CRM_SVERKA_REFRESH_CRON`) | setting `crmSverka.lastRun` |
| `CrmSverkaService` boot seed | backend start | setting `crmSverka.lastRun` |
| `GoogleExportService.exportSheetsCronTick` | har daqiqa, har sheet o'z jadvali | MAX(`export_cron_logs.started_at`) |
| `GoogleExportService.autsourcingCronTick` | har daqiqa, gate `autsourcing.cronTime`, kuniga 1 marta | iz yo'q (journal) |
| `ShmitdService.cronTick` | har daqiqa, gate `shmitd.cronTimes` | MAX(`shmitd_logs.sent_at`) |
| `xonpay-auto-sync` (dinamik) | `xonpay.cron.intervalMinutes` (default 60), faqat 07-23 | MAX(`xonpay_sync_logs.started_at`) |
| `LeaderAlertService.tick` (v1) | `*/15 * * * *` | `leader_alerts` jadvali |
| `LeaderOrchestratorService.teacherDaily` (v1) | 22:30 | `leader_runs` jadvali |
| `LeaderBotService.pollLoop` (v1) | doimiy long-polling | iz yo'q |
| Facts (yangi, bot ichida `support_facts.py::facts_scheduler`). Facts'da nomi "Facts cron", lekin alohida cron yo'q | har 300 s (bot start'ida darhol) | `updated_at` |
| Leader bot heartbeat (yangi, bot ichida `leader_bot.py::_heartbeat`) | har 60 s | `kv_store['leader_heartbeat']` |
| Checker scheduler (yangi, bot ichida) | start 45 s, keyin har 4 soat | `kv_store['checker:last_full_run']` |
| Teacher kunlik (yangi, bot ichida) | 22:30 | `kv_store['teacher_daily_last_run']` |
| Va'da eslatmasi (yangi, bot ichida) | tick 60 s; muddat o'tgach har 25 daqiqada, ko'pi bilan 3 marta | `agent_promises` |
