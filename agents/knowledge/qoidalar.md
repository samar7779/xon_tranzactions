# Qoidalar

Ustuvorlik: egasining oxirgi aniq qarori > shu fayl > kod izohi > eski xotira.

Manba: egasining qarorlari va 2026-05 dan beri u bilan ishlash tarixi (lokal Claude Code xotirasi), shablon qoidalari. Band yonidagi sana yoki commit qaror qachon qilinganini ko'rsatadi. Sirlar yozilmagan.

Bo'limlar: 1 — egasi bilan ishlash, 2 — kod yozish, 3 — biznes qoidalar, 4 — infratuzilma, 5 — taqiqlar.

## 1. Egasi bilan ishlash tartibi

### 1.1 Egasining qat'iy qoidalari

1. CRM (XonSaroy) faqat o'qiladi, hech qachon yozilmaydi (2026-09-08: "crmdan faqat ma'lumot olamiz").
2. Sirlar git'ga chiqmaydi, faqat server `.env` da turadi (2026-07-30). Egasi "tokenni kodga qo'y" desa ham ogohlantir va rad et.
3. Push faqat egasining ruxsati bilan (2026-09-28). Support REJA'da egasi [Ha] bossa, bot `main` ga o'zi push qiladi: [Ha] egasining push ruxsati. Lokal Claude Code sessiyasi push'ni egasi aytgandagina qiladi. Agent push ham, deploy ham qilmaydi. Deploy'ni push'dan keyin GitHub webhook boshlaydi.
4. Javob toza lotin o'zbekcha, kirill aralashmaydi.
5. Sabab so'ralganda faqat tushuntiriladi. So'ralmagan tuzatish qilinmaydi.
6. Boshqa banklarni buzmaslik: bitta bank tuzatishi boshqalarga ta'sir qilmasin.
7. Lokal Claude Code sessiyasida push'dan oldin lokal `npm run build`. Bot REJA'da build qilmaydi, `tsc`/`py_compile` qiladi (2.2).

### 1.2 Egasi kim

- Loyiha egasi yagona qaror qabul qiluvchi. Telegram ID `1954122311`. Murojaat: "shefim".
- Egasi bilan faqat Leader gaplashadi (@TRanSupport_bot). Sub-agent natijasi Leader sintezi orqali boradi.
- Egasi kodni VS Code va lokal Claude Code bilan ham yozadi. Shu repoda parallel sessiyalar bo'ladi.
- Serverga egasi o'zi kiradi. Agentda server, SSH va DB yo'q.

### 1.3 Til va ohang

- Toza lotin o'zbekcha. Lotin so'z ichida kirill harf bo'lmasin. Egasi 2026-07-30 aytgan: aralash yozuv chalkash va noprofessional. `sh`, `ch`, `o'`, `g'` tovushlarida ayniqsa ehtiyot bo'l.
- Jumla 12 so'zdan oshmasin. Odamdek, qisqa, kitobiy emas. Emoji yo'q.
- Kod, jadval va UI nomlari aynan qoladi. Kirill UI nomi faqat backtick ichida, yonida lotin nomi: `ОплатыКв` (OplatyKv).
- "Hurmatli foydalanuvchi", "Sizning topshirig'ingiz qabul qilindi" kabi iboralar yo'q.

### 1.4 Yo'q bo'lsa — yo'q

- Topilmasa: "Yo'q, topilmadi." Tamom.
- Taxmin ro'yxati taqiq: "Ehtimoliy sabablar", "Balki", "Buni ham tekshiraymi?".
- Facts'da kalit yo'q bo'lsa: "<kalit> facts'da yo'q".
- Sinxronlanmagan manbaning 0 qiymati "noma'lum", "bo'sh" emas. Hamkor uchun sverka yo'q: "farq yo'q" dema.

### 1.5 "Yozib qo'ydim" taqiqi

- Diagnostika savoliga "yozib qo'ydim", "xotiraga qo'shildi" javob emas. Egasi buni aldash deb biladi.
- 7 so'z (yozildi, yozdim, saqlandi, yangilandi, qo'shildi, kiritildi, yozib qo'ydim) faqat haqiqiy yozuvda. O'rniga "-gan" shakli.
- Va'da so'zi yo'q ("tekshiraman", "keyin yuboraman"). Agent keyin ishlamaydi.

### 1.6 Savol turi: tushuntirish yoki tuzatish

- Avval turini aniqla: DIAGNOSTIKA (ma'lumot) yoki KOD TUZATISH ("tuzat", "qo'sh", "o'zgartir").
- "Nega bunday bo'ldi?", "nimaga asoslanib?" — TUSHUNTIRISH so'rovi. Faqat sababni ayt. Tuzatishni egasi aytganda qil.
- Kerak bo'lsa bir gap qo'sh: "tuzatish shunday bo'lardi". REJA yozma.
- Sabab: 2026-08-22 egasi split nega noto'g'ri ekanini so'ragan. Algoritm o'zgartirilib push qilingan, keyin qaytarilgan (`16f4677`). Egasi: "sababini aytgin degan edim".
- Pul va hisob-kitob mantiqida (split, OplatyKv, perereboska) bu ayniqsa muhim: o'zgarish real hisobotlarga ta'sir qiladi.

### 1.7 Halol holat

- "Bajarildi", "tuzatildi" faqat `[SISTEMA: ...]` tasdig'i bilan.
- "Bo'ldimi?" savoliga 3 qator: 1. Sabab topildi — ha / yo'q. 2. Commit — ha / kutmoqda. 3. Serverga yetdi — ha / noma'lum.
- Serverga yetdi = deploy o'tgan va servis commitdan keyin ishga tushgan. Frontend `frontend/` fayli yoki hujjat bo'lmagan root fayl (`agents/*.py`, `scripts/`) o'zgarsa qayta quriladi. `.md`, `.txt`, `docs/`, `.github/`, `tz/` qayta qurmaydi (2.8).

### 1.8 Test logi

- Support: `py_compile` natijasi, `git show` hash, Facts qiymati. Yoki "test qilinmadi — sabab: ...".
- REJA kodi uchun: "reja kodi sinalmagan, bot qo'llashda tsc qiladi" (`.ts`) yoki "reja kodi sinalmagan, bot qo'llashda py_compile qiladi" (`.py`).
- Checker: "tekshirilmadi — sabab: ...".

### 1.9 Buyruqni to'liq bajarish

- Ikki qismli buyruq ("X qilma, Y qil"): ikkalasi ham bajariladi.
- Egasining maqsadini qisqartirmay uzat. Qisman rejani to'liq deb ko'rsatma.
- Vazifa 2 marta uddalanmasa: "Bu katta o'zgarish, dasturchi kerak."

### 1.10 Push emas pull

- Yangi avtomat xabar (kunlik hisobot, eslatma) o'zingcha taklif qilma. Egasi so'rasa javob ber.
- Mavjud avtomat xabarlarni egasi o'zi so'ragan: sverka digest (har 30 daqiqa), 20:00 eslatma, XATO digest (09:00), SHMITD hisoboti, deploy xabari.
- Yangi sahifa yoki widget ham o'zingcha taklif qilinmaydi. "Plan bo'yicha to'lov" widgeti mavjud narsani takrorlagani uchun olib tashlangan (2026-07-21).

### 1.11 Alert qoidasi

- Har alertda nom + identifikator + raqam: servis, bank va hisob, daqiqa, summa.
- Throttle 1 soat. Bir tickda faqat eng jiddiy muammo tahlil qilinadi.
- Oxirida kim tuzatadi. Savol va taklif yo'q.

### 1.12 Qaror bir marta

- Egasi qaror qilsa, u `learned.md` (`Tur: qaror`) yoki `CHANGELOG.md` 2-bo'limda turadi. Qayta so'rama, qayta taklif qilma.

### 1.13 Dizaynni taxmin qilmaslik

- Egasi premium, ixcham dizayn talab qiladi. "Oddiy" ko'rinish rad etilgan.
- Tezlik: kiritish debounce 120-250 ms. 700 ms "juda sekin" deb baholangan.
- Ixcham joyda tugma faqat ikon + tooltip (`h-9 w-9 p-0`).
- Ma'lumot ko'rinishi funksional bo'lsin: texnik vizualizatsiya, dekorativ 3D emas.
- Emoji yo'q. Ikon `lucide-react` yoki inline SVG.
- Dizayn aniq bo'lmasa, bitta savol ber. O'zingcha tanlama.

### 1.14 Server buyruqlarini berish

- Server ishi (restart, nginx, DB so'rovi, `.env`) agent doirasida emas. Javob: "Bu mening doiramda emas. Buyruq: <bitta aniq buyruq>".
- Bitta buyruq ber. Ko'p qatorli `sudo` paste'da qatorlar yutilib qoladi. Kerak bo'lsa bitta `bash <<'EOF' ... EOF` blok.
- Yangi sir kerak bo'lsa: "`.env`ga `<KALIT>=<qiymat>` qo'shing va servisni restart qiling." Qiymatni agent yozmaydi.

### 1.15 Bilim oshirish

- Yangi fakt yoki tuzoq: javob oxirida `Teacher uchun: <tur> — <matn>` qatori.
- Kod o'zgarsa, REJA ichida `CHANGELOG.md` qatori va eskirgan modul fayli ham tuzatiladi.
- Rad etilgan yechim `CHANGELOG.md` 2-bo'limga, takrorlangan xato 3-bo'limga.

## 2. Kod yozish qoidalari

### 2.1 Stack va UI

- Backend: NestJS 10, Prisma 5, PostgreSQL, TypeScript 5. Modul `backend/src/<modul>/` (service, controller, module). Cron `@nestjs/schedule`, hammasi `xon-tranzactions-backend` jarayonida.
- Bank klientlari alohida: `backend/src/integrations/kapitalbank/`, `backend/src/integrations/hamkorbank/`.
- Frontend: Next.js 14 app router (`frontend/app/[locale]/(panel)/...`), next-intl, Tailwind, zustand, react-query, `lucide-react`.
- Yangi UI matni uchala tilda: `frontend/i18n/messages/uz.json`, `ru.json`, `en.json`. Kalit yetishmasa sahifada kalit nomi chiqadi (`e7fb9e4`).
- Agent bot kodi: Python, aiogram 3, `agents/*.py`. Web backend Node, bot o'z venv'ida.

### 2.2 Compile tekshiruvi

- Lokal Claude Code sessiyasida push'dan oldin `npm run build`: backend (~25 s) va frontend (~2 daqiqa, shoshilinchda `npx tsc --noEmit`). "Kichik" o'zgarishda ham.
- `schema.prisma` o'zgarsa avval `npx prisma generate`.
- Faqat hujjat yoki TS bo'lmagan fayl bo'lsa build shart emas.
- Sabab: TS xatosi deploy build'ini yiqitadi, xabar kech keladi. 2026-05-21 da bir kunda ~10 marta bo'lgan.
- Bot REJA qo'llashda vaqtinchalik nusxada o'zi tekshiradi (`reja.py::_run_checks`): `.py` → `py_compile`; backend `.ts` → `tsc --noEmit -p backend/tsconfig.json`; frontend `.ts(x)` → `tsc --noEmit -p frontend/tsconfig.json`.
- Sof funksiyaning testi bor joyda (`installment-split.spec.ts`, `digest.spec.ts`) testni ham moslashtir.

### 2.3 Sirlar

- Sir faqat server `.env` da: backend ham, agent boti ham `backend/.env` (bot yo'li `AGENTS_ENV_FILE`). Repo ildizi `.env` emas. Bot faylni o'z parseri bilan o'qiydi, jarayon env'iga yozmaydi. Agent env'iga faqat oq ro'yxat o'tadi. Kodda `process.env.X` yoki `config.getOrThrow('X')`. Qattiq yozilgan fallback (`|| 'qiymat'`) yo'q (`4b7db6e`).
- `settings` jadvalidagi sir kalitlari (bot tokenlari, `agent.aiKey`, `export.credentials`, `bank.forwarderSecret`, `shmitd.saJson`) o'qilmaydi va iqtibos qilinmaydi.
- Google service-account fayllari gitignore'da. Ularni yaratma, commit qilma.
- `scripts/deploy.sh` da hali ochiq fallback qiymatlar bor (Telegram token, chat ID, forwarder manzili va siri). Iqtibos qilma, REJA'ga ko'chirma. Tozalash egasi qarori.
- Bank login va parolini faqat egasi kiritadi: panel orqali yoki serverda.

### 2.4 SQL, vaqt va sana

- DateTime ustunlar tz'siz, qiymati UTC. Toshkent = UTC+5. Kodda `new Date('YYYY-MM-DDT00:00:00+05:00')`, raw SQL'da `(ustun + interval '5 hours')::date`.
- `@db.Date` ustunlar vaqtsiz Toshkent sanasi: `oplata_kv.date`, `xonpay_transactions.date_paid`, `transactions.value_date`.
- Raw SQL'da `NOW()` bilan vaqt yozilmaydi: vaqt ilovadan parametr (`new Date()`). DB soati ilova soatidan farq qiladi (`b06ca52`).
- Server TZ'ga tayanma (`getDate()`, `setHours`). Sana matni `Intl` + `Asia/Tashkent` bilan (`reconcile.service.ts::fmtDate`, `8c642eb`).
- Prisma model va SQL jadval nomi farq qiladi: `OplataKv` = `oplata_kv`, `CrmContract` = `crm_contracts`. Raw SQL'da snake_case. Tekshiruv: `db_schema.md`.
- Sentinel: `crm_contracts.virtual_status` va `branch_name` da NULL = tekshirilmagan, `''` = tekshirildi, yo'q. CRM javob bermasa NULL qoldir, `''` yozma.
- Migratsiya papkasi yo'q. Har backend deploy `npx prisma db push --accept-data-loss` qiladi. Ustun o'chirish, nomini yoki turini o'zgartirish ma'lumotni o'chiradi: REJA'da `danger_flags` ga yoz.
- Katta jadvalda sana oralig'i (31 kungacha) va `take` majburiy. Retention yo'q: `sync_logs`, `audit_logs`, `api_request_logs`, `transaction_change_logs`, `oplata_kv_history`, `export_cron_logs`.
- API yoki SQL chegarasiga tegsa oraliqni bo'l. Jim kesilgan natija chala (`e3b4463`, `e29603b`).

### 2.5 Ko'p jarayon va cron holati

- Backend bitta Node jarayoni, cron'lar har daqiqa. Uzoq ish uchun "running" lock: keyingi tick ustma-ust tushmasin.
- Bir martalik amal DB marker bilan (`crm-contract-cache.service.ts`, `BRANCH_RESET_MARKER`). Restartda takrorlanmasin.
- Restart uzilgan run'ni belgilaydi: CRM sverka `crashed`, XonPay `Server restart — orphan running entry`. Sync log `RUNNING` bo'lib qolib ketishi mumkin.
- Agent bot holati Python dict'da emas, `agents.kv_store` da.

### 2.6 NestJS tuzoqlari

- `backend/src/main.ts`: `json()` body parser qo'shilsa `verify` bilan `req.rawBody` saqlansin. Aks holda GitHub webhook imzosi yiqiladi, deploy to'xtaydi (`1cafbc3`).
- Global `ValidationPipe` (whitelist) DTO ichidagi nested obyektni qirqadi. Method `@UsePipes` yordam bermaydi. Nested kerak bo'lsa `@Body() body: any` va qo'lda tekshiruv (`a7a9bb5`).
- Route tartibi: aniq yo'l (`oplata-kv/deleted`, `oplata-kv/changes`) `:id` dan OLDIN turadi.
- Yangi ruxsat 3 joyda: `backend/src/auth/permissions.ts` (`PERMISSIONS`, `PERMISSION_TREE`), `frontend/lib/permissions.ts` (`PERMS`), `backend/prisma/seed.ts::ALL_PERMS`. Bittasi qolsa tugma hech kimga ko'rinmaydi (2026-07, `export:*`).
- Yangi o'zgartiruvchi endpoint audit'ga avtomat tushadi (POST, PATCH, PUT, DELETE). O'qiladigan nom: `backend/src/audit/audit.routes.ts`.

### 2.7 Git tartibi

- Branch `main`. Commit sarlavhasi: `tur(modul): o'zbekcha qisqa tavsif`. Turlar: `feat`, `fix`, `perf`, `style`, `docs`, `chore`, `diag`, `security`.
- Har fayl aniq `git add -- <fayl>`. `git add -A` yo'q: repoda boshqa sessiyaning commit qilinmagan fayllari bor.
- Lokal Claude Code sessiyasi: commit mumkin, push faqat egasi aytganda (egasi, 2026-09-28). Push oldidan `git fetch` va `git rebase origin/main` (parallel sessiya).
- Bot: har REJA bitta commit `feat(support): ...`. Egasi [Ha] bossa bot `main` ga o'zi push qiladi ([Ha] = push ruxsati). Serverda HEAD origin/main dan farq qilsa REJA `branch` bilan to'xtaydi: bot tasdiqsiz commitni push qilmaydi (`reja.py::_preconditions`).
- Vaqtinchalik diagnostika (`diag(...)`) masala hal bo'lgach olib tashlanadi. Hozir turibdi: `/_deploy/hamkor-diag` (`a76156c`), `[HB-DIAG]` log (`d00d104`).

### 2.8 Deploy va restart

- push `main` → GitHub webhook `/api/_deploy` (HMAC, `GH_DEPLOY_SECRET`) → `scripts/deploy.sh` fonda → Telegram xabari. Holat: `/api/_deploy/status`.
- Nima quriladi (`backend/src/deploy/deploy.service.ts::servicesToRestart`): `.md`, `.txt`, `docs/`, `.github/`, `tz/` → restartsiz; faqat `frontend/` → frontend; faqat `backend/` → backend; boshqa root fayl (`agents/*.py`, `scripts/`) → ikkalasi.
- Bo'sh yoki faqat hujjat commit frontend'ni qayta qurmaydi. Frontend uchun `frontend/` dagi real fayl o'zgarishi kerak (2026-07-23).
- Backend deploy: `npm install`, `prisma generate`, `prisma db push --accept-data-loss`, `npm run seed`, `npm run build`, restart. Restart fazasi 5-8 daqiqa turishi odatiy.
- Frontend `.next-build` ga quriladi va atomik almashtiriladi: build paytida sayt ishlab turadi. Deploy'dan keyin brauzerda hard refresh (Ctrl+Shift+R).
- Lock `/var/run/xon-tranzactions-deploy.lock`, `flock -w 60`. Eski deploy qotsa yangisi 60 s kutib chiqib ketadi. Unda egasi serverda `deploy.sh` ni qo'lda ishga tushiradi (FE va BE ikkalasi quriladi).
- `xon-tranzactions-leader` ni deploy restart qilmaydi (`agentlar.md`). `agents/*.py` o'zgarsa bot 15 s ichida o'zi chiqadi, systemd qayta ko'taradi (`leader_bot.py::_source_watcher`). Bot o'zi restart va deploy qilmaydi.

### 2.9 Yangi agent va Facts bo'limi

- Facts bo'limi faqat egasi "qo'sh" yoki "tuzat" desa. `support_facts.py::_collect_<kalit>`: READ ONLY, `statement_timeout 15s`, birinchi maydon statik `izoh`, maxfiy maydon yo'q. Manba jadvali: `agentlar.md` "Facts manbalari".
- Facts'da moliyadan faqat JAMI summalar va o'z hisoblarimiz qoldig'i. Mijoz ismi, telefon, to'lov izohi, kontragent rekvizitlari yo'q.
- Yangi agent faqat egasi qarori bilan: prompt, `contract.py` (`DELEGATE_AGENTS`, `DISALLOWED_TOOLS`), `runner.py` asboblari va `imkoniyatlar.md` bitta REJA'da.

## 3. Biznes qoidalar

### 3.1 Tranzaksiyalar va kategoriyalash

- `direction`: IN kirim, OUT chiqim. "Tasdiqlangan" = `status = 'COMPLETED'`. Panel statistikasi PENDING'ni ham qo'shadi.
- TRANSFER kategoriyasi — o'z hisoblar orasidagi o'tkazma. U IN va OUT ikkalasida bor: tashqi kirimni alohida ayt.
- Minfin (`Молия Вазирлиги`, Moliya Vazirligi) faqat byudjet kontragenti (`BUDGET_NAME_PARTS`) yoki byudjet maqsad kodi (`BUDGET_PURPOSE_CODES`) bilan. Soliq so'zi (NDS) faqat subkategoriyani tanlaydi (`categorization.service.ts`, `f4993f8`).
- Qayta kategoriyalash doirasi (egasi, 2026-09-18): faqat 01.05.2026 dan, `categorized_by = 'manual'` qatorlarga tegilmaydi, avval dryRun.
- Qo'lda qo'yilgan kategoriya import matnidan ustun (`0ff9db4`).
- Ta'minot ERP ma'lumoti faqat `erp_*` ustunlariga yoziladi. `contract_number` va `category_id` ga yozilmaydi: CRM tekshiruvi buziladi, to'lov XATO bo'lib chiqadi.

### 3.2 Bank sync

- Bir bank tuzatishi boshqa bankka ta'sir qilmasin. Hamkor alohida REST klient, sync'ga `sync.service.ts::fetchDoc1C` (apiKind bo'yicha) orqali ulangan. Kapitalbank va Ipak Yo'li yo'li o'zgarmaydi. Reconcile, statement, memorial order Hamkor'ni `apiKind` sharti bilan chetlaydi.
- `transactions.external_id` kompozit, ichida hujjat sanasi (`ddate`). Bank sanani ko'chirsa ID o'zgaradi. Shunda `oplata_kv.source_tx_id` ham yangi ID ga ko'chiriladi (`sync.service.ts` sana siljishi, `reconcile.service.ts::fixTxDate`, `relinkOplataKv`; `2043be4`).
- O'chirishdan oldin bankdan ±3 kun tekshiriladi. Boshqa kunda topilsa MOVED, bog'lanish saqlanadi. Bankka ulanib bo'lmasa yoki nomzod 40 dan ko'p bo'lsa o'chirilmaydi (`sync.service.ts::detectChanges`, `3c0684f`).
- Hamkor `txn_date` = pul hisobga tushgan sana (ddate, docDate), karta surilgan vaqt emas (egasi aniqlagan, `7d89575`). Karta to'lovlari settlement partiyasi bilan bir kunga to'planadi: shishgan kun xato emas.
- Hamkor o'tgan davri faqat vipiska importi bilan (`kind = 'hamkor-vipiska'`, `source = HAMKOR_IMPORT`). API backfill bank tomonida buzuq. Import yozuvi real to'lov.
- Login xatosi sync logni PARTIAL qiladi, `last_synced_at` baribir yangilanadi. Sog'likni signal bilan ayt.
- Qoldiq faqat oddiy sync'da yangilanadi, backfill'da emas.
- Bank paroli moduli (`backend/src/bank-pwd/`) kod darvozasi bilan himoyalangan. Parol ham, kod ham hech qayerga yozilmaydi.

### 3.3 OplatyKv (`ОплатыКв`, jadval `oplata_kv`)

- Loyihaning eng muhim jadvali. Har qator bitta mijoz to'lovi.
- Mijoz tushumi: `payment_amount > 0` va `tx_type` ichida `взнос` (vznos) (`oplata-kv.service.ts::dailySummary`).
- Obyekt hisoboti `от имени` (ot imeni) qatorlarini chiqaradi. Vznos ot imeni klienta — kompaniyaning o'z shartnomalari, tushum emas (`backend/src/vznos/`).
- Qaytarish: `payment_amount < 0` va `tx_type` `возврат` (vozvrat) bilan boshlanadi.
- Bank kirimi mijoz tushumi emas. "Tushum" aniq bo'lmasa ikkalasini nomlab ber.
- Dedupe kaliti `source_tx_id` = `tx.externalId || tx.id` (`syncFromTransactions`). Excel-import qatorida `source_tx_id` bo'sh, kod `sourceTxId || id` ishlatadi.
- Split: CRM grafik bo'yicha waterfall, sana tartibida, boshlang'ich va oylik aralash (`installment-split.ts::allocatePayment`, `f5a257f`). Avto split va qo'lda tugma bitta funksiyani chaqiradi. XATO shartnomada split yo'q.
- "XATO → CRM" modulida CRM aytgan ustun qo'yiladi, waterfall emas (`9450843`).
- Schetchik (`За счетчик`, za schetchik) qatorlari GENERAL, split yo'q. Oylikka o'tkazish alohida amal.
- Perereboska: bir obyekt ichida, bir manbadan ko'p maqsadga, maqsadlar jami = manba summasi, qoldiq yetarli, hujjat majburiy. Qaytarishda OplatyKv qatorlari o'chadi, guruh `cancelled` bo'lib tarixda qoladi.
- AI perereboska maslahatchi: pulni o'zi o'tkazmaydi, xodim tasdiqlaydi. Arizadagi 3 xil summadan o'tkazmani `perereboska-amounts.ts::decideTransferAmount` tanlaydi.
- Kunlik xulosa: bugun tanlansa, kecha ham shu vaqtgacha (`created_at`) solishtiriladi (`ff15275`).

### 3.4 XATO

- XATO = to'lovda shartnoma raqami bor, lekin `crm_contracts` da `found = true` emas.
- Moslik aniq. Kategoriyalash CRM kanonik raqamini saqlaydi, xom nomzodni emas (`ae70d25`).
- Ikki ta'rif bor va ular farq qiladi. Tranzaksiya tomoni: `transactions.service.ts::clientXatoTransactions` (`is_contract_manual = false`). OplatyKv tomoni: `oplata-kv.service.ts::buildXatoFilter` (faqat `xato_hidden` chiqariladi). Qaysi ekanini ayt.
- Tuzatish 2 bosqichli: ariza (pending) → tasdiq (fayl, shartnoma, kategoriya) yoki rad. Avtomat tasdiq faqat AI agent.
- AI agent obyekt qoidasi: shartnoma raqamidagi raqamlardan keyingi 3 harf = obyekt. To'lov boshqa obyektga o'tkazilmaydi.
- CRM'da haqiqatan yo'q shartnoma XATO'da qolishi normal.

### 3.5 CRM (XonSaroy)

- Faqat o'qish: `/order/show`, `/order/index`, `/payment-history`, shartnoma hujjati. Yaratish, band qilish, status o'zgartirish CRM'ning o'z ishi.
- CRM'ga yozishni talab qiladigan g'oya chiqsa, avval egasidan so'ra. O'z login bilan CRM admin API'ga kirish tavsiya etilmaydi: u yozish huquqiga ega.
- Lookup parametri `crm.service.ts::searchContracts` minimal to'plamiga teng bo'lsin. Ortiqcha filtr CRM'da 0 natija beradi (`5b9daf0`).
- CRM `virtual_status` yorliqlarini buzuq kodlashda (mojibake) qaytaradi. `repairMojibake` tuzatadi (`947a25f`). Boshqa matn maydonlarida ham bo'lishi mumkin.
- Sotuv bo'limi (`branch_name`) faqat shartnoma filtrli `/index` dan keladi. `/show` uni bermaydi.
- Bir raqamda bir necha CRM shartnoma bo'lsa, to'lov izohidagi ism bo'yicha tanlanadi (`pickContractByName`).

### 3.6 Sverka

- Bank sverka faqat Kapitalbank va Ipak Yo'li uchun. Hamkor uchun sverka, statement va memorial order yo'q.
- Reconcile javobidagi `ok: true` amal bajarilganini bildiradi, moslikni emas. Haqiqiy holat `status === 'mismatch'`.
- Ayb (bank yoki biz) faqat `confidence === 'high'` bo'lsa aytiladi.
- Telegram: yagona digest xabar, joyida tahrirlanadi. "Notif. reset" eski xabarlarni ham o'chiradi (`40343ad`).
- Reconcile jonli bank API'ga chiqadi va yozishi mumkin. Agent uni chaqirmaydi.
- CRM sverka snapshot 07:00, 12:00, 17:00 da yangilanadi. Farq ro'yxati faqat panelda. CRM sverka Telegram'ga ulanmagan.

### 3.7 Chek order, memorial order, Chek payment

- Memorial order raqami = `transactions.doc_number`.
- Bank hujjatini moslashda sana yaqinligi (±3 kun) asosiy mezon. Har hujjat faqat bitta qatorga. Topilmasa bo'sh qoldiriladi (`3a62ee5`).
- Chek payment faqat o'qiydi, hech narsa o'zgartirmaydi (egasi talabi, 2026-09-12).
- Google Sheet o'qishda: URL'dan ID ajratish (`normalizeSpreadsheetId`), `valueRenderOption: 'UNFORMATTED_VALUE'` (vergulli o'nlik ×100 bo'lib ketardi), merge katakning anchor qiymatini tarqatish.
- CRM `/show` shartnomani topmasa, `/payment-history` ga fallback.

### 3.8 Tashqi API va eksport

- Delta-feed `/api/v1/oplata-kv/changes`: o'chirish yozuvi (tombstone) hech qachon filtrlanmaydi (`3075556`). Pul satr (Decimal).
- Universal API (`universal:read`): obyekt endpointlarida `banks=` faqat bank ID oladi. `accounts` va `statement` da kod ham, ID ham bo'ladi.
- `docs/universal-api.md` va uning web nusxasi bir xil bo'lsin: birini o'zgartirsang, ikkinchisini ham.
- Guard'dan o'tgan har tashqi API chaqiruvi `api_request_logs` ga yoziladi. 401 va 403 (guard rad etgan) yozilmaydi.

## 4. Infratuzilma faktlari

- Serverda repo `/var/www/xon_tranzactions`. Panel `transactions.xonapps.uz`.
- Servislar: `xon-tranzactions-backend` (NestJS, port 3001), `xon-tranzactions-frontend` (Next.js, port 3000), `xon-tranzactions-leader` (agent boti, 2026-09-28 dan ishlayapti), `postgresql`, `nginx`. Batafsil: `agentlar.md`, `platforma.md`.
- nginx: `/api/` va `/docs/` → 3001, `/` → 3000. Body 200M, `/api` timeout 1800 s. `static/tg_uploads/` berilmasin.
- Deploy log `/var/log/xon-tranzactions/deploy.log`, lock `/var/run/xon-tranzactions-deploy.lock`.
- `deploy.sh` servislarni `sudo -n systemctl restart` bilan qayta ishga tushiradi. Agent boti root ostida ishlaydi. Agent CLI imtiyozsiz `xonagent` foydalanuvchisida, sudo'siz.
- Facts, Checker va Teacher bot jarayoni ichida ishlaydi. Alohida cron yo'q.
- Push kaliti serverda root'da, faqat shu repo'ga. Bot REJA push'ini shu kalit bilan qiladi. Agent foydalanuvchisi kalitni o'qiy olmaydi.
- Baza `xon_tranzactions`, faqat localhost. Shu serverda ta'minot ERP'ning alohida `xontaminot` bazasi ham bor.
- Bank IP whitelist uchun tashqi forwarder (`scripts/xt-forwarder.php`). Manzil va sir DB setting'da, panel orqali o'zgaradi.
- Bot jadvallari va `kv_store` kalitlari: `agentlar.md` "DB jadvallar". Backend cron'lari: `agentlar.md` "Schedulerlar izi".
- Xavfsizlik: agent alohida imtiyozsiz foydalanuvchi, Bash hook, env oq ro'yxati. `ANTHROPIC_API_KEY` agentga berilmaydi.
- Lokal Claude sessiyasi serverga ulana olmaydi. Server buyrug'ini egasi bajarib natijani beradi.

## 5. Taqiqlar

### 5.1 Hech qachon

- CRM'ga yozuvchi REJA yoki kod.
- Sir (token, parol, PIN, darvoza kodi, API kalit, ulanish satri, server IP, SSH login, guruh chat ID) javobga, kodga, REJA'ga, xotiraga.
- `.env*` ni o'qish yoki o'zgartirish. `.git/`, `.claude/`, `agents/state/`, `static/tg_uploads/` ga REJA.
- `git add -A`. Egasi ruxsatisiz push: bot uchun [Ha]'siz, lokal sessiya uchun egasi aytmasdan. Serverda push qilinmay qolgan bot commiti.
- Raw SQL'da `NOW()` bilan vaqt yozish.
- `crm_contracts` ga NULL o'rniga `''` yozish.
- Sync feed'idan o'chirishni filtrlash.
- Bir bank uchun tuzatishni boshqa banklarning umumiy yo'liga qo'shish.
- Sabab so'ralganda kodni o'zgartirish.
- Himoya guard'larini yumshatish: dublikat (`@@unique`), ±3 kun tekshiruv, ruxsat, kod darvozasi.
- Qo'lda qo'yilgan (`categorized_by = 'manual'`) kategoriyaga avtomat tegish. 01.05.2026 dan oldingi tranzaksiyani qayta kategoriyalash.
- Yetim OplatyKv qatorini o'chirishni yoki foydalanuvchini bloklashni o'zingcha taklif qilish.
- Backend HTTP endpointini (reconcile, sync, ulanish testi) agent yoki Facts'dan chaqirish.
- Mijoz ismi, telefoni, PINFL, karta va to'liq hisob raqamini javobga yoki xotiraga chiqarish.
- `scripts/deploy.sh` dagi fallback qiymatlarni iqtibos qilish.

### 5.2 Eskirgan yozuvlar

| Eski da'vo | Hozirgi haqiqat |
|---|---|
| Izohda soliq so'zi (`НДС`, NDS) bo'lsa to'lov Minfin (`if (isMolia \|\| taxSubKey)`) | Minfin faqat byudjet kontragenti (`BUDGET_NAME_PARTS`) yoki byudjet maqsad kodi (`BUDGET_PURPOSE_CODES`) bilan. Soliq so'zi faqat subkategoriya (`f4993f8`, 2026-09-18) |
| Hamkor `txn_date` = `Время транзакции` (tranzaksiya vaqti, karta kuni) (`1403fcc`) | `txn_date` = hisobga tushgan sana, ddate yoki docDate (`7d89575`, 2026-09-24) |
| Hamkor dublikat himoyasi = becfil-exclusion, `sync_exclusion_ranges` (`280d12a`) | Olib tashlangan (`d19dc52`): kunlik sync'ni sindirgan. Himoya `@@unique([accountId, hbDedupKey])`. Jadval faqat ma'lumot, `isDateExcluded` ishlatilmaydi |
| Bank to'lovni topmasa DELETED, OplatyKv qatori ham o'chadi | Avval ±3 kun tekshiruv, boshqa kunda topilsa MOVED (`3c0684f`, 2026-08-25) |
| Sana ko'chsa OplatyKv'da to'lov ikki marta paydo bo'ladi | `source_tx_id` yangi ID ga ko'chiriladi (`2043be4`, 2026-09-24). 46 yetim qator tozalangan |
| Split: butun boshlang'ich reja bitta summa, to'lov avval hammasi boshlang'ichga | CRM grafik waterfall, sana tartibida (`f5a257f`, 2026-08-20) |
| Qo'lda shartnoma berilgan XATO ro'yxatdan chiqib ketadi, "qaytar" tugmasi kerak | OplatyKv XATO ro'yxati faqat `xato_hidden` ni chiqaradi, qo'lda XATO ko'rinadi (`dfd8d99`). Tranzaksiya ro'yxati hali `is_contract_manual = false` filtrli |
| CRM `/payment-history/excel` (CRM sverka) `limit=5000` da javob bermaydi | Ishlaydi: `crm-sverka.service.ts` `DEFAULT_PAGE_LIMIT = 5000`, `DEFAULT_CONCURRENCY = 8`, 266k to'lov yozuvi 2-3 daqiqada (`7be2df0`, 2026-09-11) |
| "Plan bo'yicha to'lov" widgeti va `contract_schedules` sync | Olib tashlangan (`2c24ebb`, 2026-07-21). Jadval dormant qolgan |
| Reconcile sana matni server soati bo'yicha (`getDate()`) | `Intl` + `Asia/Tashkent` (`8c642eb`, 2026-08-20) |
| Shablon deploy lock repo ildizidagi `.deploy.lock` | `/var/run/xon-tranzactions-deploy.lock` |
| Agentlar Messages API va `ANTHROPIC_API_KEY` bilan ishlaydi (v1, `backend/src/leader/`) | Bu tizim: Claude Code CLI + setup token, API kalit yo'q (egasi, 2026-09-28) |
| Push va deploy'ni faqat egasi o'zi qiladi, bot ham, lokal sessiya ham push qilmaydi | Egasi qarori (2026-09-28): push faqat uning ruxsati bilan. Bot REJA'ni [Ha] dan keyin `main` ga o'zi push qiladi ([Ha] = push ruxsati). Lokal Claude Code sessiyasi push'ni egasi aytgandagina qiladi. Deploy'ni push'dan keyin webhook boshlaydi |
| Sirlar kodda qattiq yozilgan (JWT, CRM kaliti, sverka bot tokeni, admin amal paroli) | `.env` ga ko'chirilgan (`4b7db6e`, 2026-07-30). `deploy.sh` fallback'lari hali qolgan |
