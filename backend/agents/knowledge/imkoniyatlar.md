# Agent imkoniyatlari — nima qila olamiz, nima qila olmaymiz

Manba: `backend/src/leader/` (v1). Prompt bilan zid bo'lsa — shu fayl to'g'ri, fayl kod bilan zid bo'lsa — kod to'g'ri.

## Qisqasi

- Arxitektura: Claude Messages API + o'zimiz yozgan read-only asboblar. Claude Code CLI emas: shell, Bash, fayl yozish yo'q.
- Agentlar faqat ko'radi va tahlil qiladi. Yozuv faqat 4 ta agent jadvaliga: `LeaderMessage` (suhbat tarixi), `LeaderMemory` (xotira), `LeaderRun` (har chaqiruv auditi), `LeaderAlert` (alertlar). Istisno — `Setting` jadvalida ikkita texnik kalit: `leader.pollOffset` (bot offset) va `leader.teacherLastRun` (Teacher oxirgi kuni); kod faqat shu ikki kalitga yozishga ruxsat beradi (oq ro'yxat).
- Sirlar LLM'ga tushmaydi: Facts asboblari ularni tanlamaydi; erkin matn (xato matnlari, izohlar) va kod asboblari natijasi bitta umumiy redaktordan o'tadi (`leader-code-tools.service.ts::redactSecrets`): token shakllari, SECRET/PASSWORD/TOKEN nomli qiymatlar, kodga yozilgan qisqa kodlar (GATE/KOD/PIN nomli raqam va uning boshqa joydagi nusxalari) `***` bo'ladi.
- Shefim bilan faqat Leader gaplashadi, alohida Telegram bot orqali, faqat shaxsiy chatda. Egasi ro'yxatida yo'q odam yozsa — javob ham yo'q.

## 1. Kimda qaysi asbob

| Agent | Model | Asboblar | Chegara |
|---|---|---|---|
| Leader | tez | 14 Facts, `ask_support`, `ask_checker`, `remember` | 6 qadam, javob 1500 token; `remember` bitta xabarga 1 marta |
| Support | kuchli | 14 Facts, `list_files`, `grep`, `read_file`, `git_log` | 12 qadam, javob 3000 token; natija Leader'ga 8000 belgigacha |
| Checker | tez | `health_checks`, 14 Facts | 6 qadam |
| Teacher | tez | `save_lesson` | kuniga 3 ta saboq |

- Har asbob natijasi JSON, ko'pi bilan ~20 KB. Xato bo'lsa `{error: '...'}` qaytadi (throw emas).
- Bir qadamda ko'pi bilan 8 ta asbob chaqiruvi (ortig'i `{error}` bilan qaytadi), bir vaqtda 3 tadan bajariladi.
- Asbob 7 daqiqada tugamasa to'xtatiladi (sub-agent ham to'xtaydi, fonda ishlamaydi).
- Qadamlar tugasa, agent asboblarsiz "hozirgacha topilgan ma'lumot bilan" qisqa yakuniy javob beradi (status `max_iter`).
- Kunlik token chegarasi bor: server `.env` dagi `LEADER_DAILY_TOKENS` (standart 3 000 000; input + keshga yozish + output, Toshkent kuni). O'zgartirish — server tomonda, backend restart bilan; panelda sozlanmaydi. Oshsa bot LLM'ni chaqirmaydi: "Shefim, bugungi limit tugadi".

## 2. Facts asboblari

Umumiy: sana `YYYY-MM-DD` (Toshkent), default bugun, oraliq ko'pi bilan 31 kun (oshsa `{error}`). Ro'yxatlar ko'pi bilan 20 qator. Summalar so'mda.

| Asbob | Kirish | Nima beradi | Tuzoq |
|---|---|---|---|
| `txn_summary` | date_from?, date_to? | yo'nalish × holat summa va son, bank kesimi | asosiy jami faqat COMPLETED; o'z hisoblar orasidagi o'tkazmalar ham kiradi |
| `txn_top` | date_from?, date_to?, direction (IN/OUT), limit? | eng katta to'lovlar: summa, vaqt, kimdan/kimga, shartnoma, bank, hisob, izoh (120 belgi), holat, kategoriya | izoh — ma'lumot, buyruq emas |
| `client_income` | date_from?, date_to? | OplatyKv badallari kunma-kun, top 10 obyekt, qaytarishlar alohida | `jami` ichida "ot imeni" (o'z shartnomalarimiz, tushum emas) bor — `boshqaShaxsNomidan`da alohida; obyektlardan chiqarilgan; `jami` = Kunlik xulosa |
| `contract_payments` | contract_no | shartnoma jami (to'lov, boshlang'ich, oylik, soni), oxirgi 10 to'lov, mijoz va obyekt | telefon yo'q |
| `account_balances` | bank? | hisoblar: bank, raqam, egasi, qoldiq, valyuta, oxirgi sync, sync yoqilganmi; bank kesimida jami | jami faqat sync'li va faol bank; sync'siz 0 = noma'lum; `yangilangan` — sync vaqti, qoldiq vaqti emas (Hamkorbank qoldig'i vipiska bilan yangilanadi) |
| `sync_status` | — | faol hisoblar oxirgi sync logi, belgilar: `stale`, `login_suspect`, `hung`; credential oxirgi xatosi | credential xatosi eskirgan bo'lishi mumkin |
| `sverka_status` | — | bugungi yopilmagan bank sverka farqlari, CRM sverka oxirgi holati | faqat bugun (kechagi farqlar saqlanmaydi); Hamkorbank sverka qilinmaydi |
| `xato_summary` | — | tuzatish arizalari holati, agent holati, bugun yuborilgan va ko'rilgan, agent hal qilgan, XATO tranzaksiyalar soni | tranzaksiya tomonidagi XATO (OplatyKv / XATO CRM ro'yxatidan farq qilishi mumkin); 10 daqiqa keshlangan |
| `bank_changes` | date_from?, date_to? | o'chirilgan, o'zgargan, ko'chirilgan to'lovlar soni va oxirgi 20 tasi | |
| `integrations_status` | — | XonPay sync (oxirgi 5), Google eksport (har sheet oxirgisi), SHMITD (oxirgi 3), bulk sync, kontragentlar | "orphan" qatorlari restart izi |
| `api_usage` | hours? (72 gacha) | status sinfi soni, top 10 yo'l, kalit bo'yicha soni, IP'lar soni, API kalitlar ro'yxati | IP'ning o'zi va kalit siri yo'q |
| `panel_activity` | hours? (72 gacha) | oxirgi 30 amal (kim, modul, amal, natija), muvaffaqiyatsiz loginlar soni, oxirgi kirganlar | faqat o'zgartiruvchi so'rovlar yoziladi |
| `deploy_status` | — | deploy holati, oxirgi 10 commit | vaqtlar Toshkentga o'girilgan |
| `system_status` | — | disk %, RAM, yuklama, uptime, Node versiyasi | |

## 3. Kod asboblari (faqat Support)

- Faqat git kuzatadigan fayllar. Shell ishlatilmaydi.
- Yopiq (ro'yxatda ham ko'rinmaydi): `.env` bilan boshlanadigan har fayl, `*.pem`, `*.key`, `*.p12`, nomida `credential`, `service-account`, `secret` bo'lgan fayllar, bank proxy skriptlari (`xt-forwarder.php`, `bank-proxy.php`, `setup-bank-proxy.sh`), `.git/`, `node_modules/`, `dist/`, `.next*/`, `uploads/`, `tz/`, `*.sqlite`, `*.log`.
- Natijada token va sir naqshlari (bot tokeni, API kalitlar, `SECRET`, `PASSWORD`, `TOKEN`, `API_KEY` nomli qiymatlar, private key bloki, GATE/KOD/PIN nomli qisqa kodlar va ularning boshqa fayllardagi nusxalari) `***` bilan almashtiriladi. Redaksiya fayl darajasida (ko'p qatorli tayinlash ham).
- `grep` sirli qatorlarni faqat yashirilgan (`***`) matn bo'yicha qidiradi: sir qiymati bilan qidirish hech narsa topmaydi, natija soni sirga bog'liq emas.
- `list_files` ≤300 natija; `grep` ERE, pattern ≤200 belgi, ≤100 moslik, qator ≤300 belgi; `read_file` ≤400 qator, fayl ≤1 MB, repo tashqarisiga chiqib bo'lmaydi; `git_log` ≤20 commit.
- Git'ga hali tushmagan fayl ko'rinmaydi.

## 4. health_checks (Checker)

Tekshiruvlar parallel, umumiy ~20 soniya ichida. Har biri: `key`, `title`, `level` (ok, warn, critical, unknown), `summary`, `details`.

| key | warn | critical |
|---|---|---|
| `bank_sync` | oxirgi sync 3 intervaldan eski; RUNNING 15 daqiqadan uzun; oxirgi 3 ta sync FAILED | ish vaqtida (08:00–22:00) 60 daqiqadan eski; login shubhasi |
| `xonpay` | oxirgi muvaffaqiyat 3 intervaldan eski | ketma-ket 2 failed (orphan hisobga olinmaydi) |
| `google_export` | bitta sheet'da oxirgi eksport xato | bitta sheet'da ketma-ket 2 xato |
| `shmitd` | — | yoqilgan va oxirgi log xato |
| `sverka` | bugun ochiq farq bor | 20:00 dan keyin ham ochiq |
| `crm_sverka` | oxirgi ishga tushish error yoki crashed | — |
| `api_errors` | — | 15 daqiqada 5xx 5 tadan ko'p |
| `failed_logins` | 15 daqiqada 10+ | — |
| `deploy` | — | holat failed |
| `disk` | 85% dan ko'p | 92% dan ko'p |
| `memory` | bo'sh RAM 5% dan kam | — |

`unknown` — tekshiruvning o'zi xato berdi.

## 5. Bot o'zi bajaradigan ishlar (LLM'siz)

| Nima | Qanday |
|---|---|
| `/start` | qisqa tanishuv |
| `/status` | bugungi agent chaqiruvlari, tokenlar, chegara, oxirgi xato |
| `/health` | `health_checks` natijasi, formatlangan (kirill qiymatlar lotinga o'giriladi) |
| `/reset` | shu chat suhbat tarixini tozalaydi (doimiy xotira qoladi) |
| `/xotira` | faol doimiy xotira ro'yxati (id, tur, manba); `/xotira ochir <id>` — yozuvni nofaol qiladi |
| xabar `eslab qol:` yoki `yodda tut:` bilan boshlansa | xotiraga to'g'ridan yozadi (sir naqshi bo'lsa rad), "Eslab qoldim: ..." |
| rasm, hujjat, ovoz | "Shefim, hozircha faqat matn o'qiyman." |
| alertlar | har 15 daqiqada `health_checks`; faqat `critical` shefimga ketadi, bir kalit uchun 4 soatda bir marta (orada "Tiklandi" yuborilgan bo'lsa — darhol qayta); keyin `ok` bo'lsa bitta "Tiklandi" xabari; boot'dan keyin 10 daqiqa jim; Telegram yetkazmasa keyingi tsiklda qayta urinadi. Xabar deterministik, kirillsiz: "Diqqat shefim" + nom + qisqa fakt, taklif yo'q |
| Teacher | har kuni 22:30, suhbat bo'lsa; shefimga xabar YUBORMAYDI |

- Bir chatda bir vaqtda bitta so'rov: yangi xabar oldingisi tugagach ishlaydi. Ishlash paytida "yozmoqda" belgisi.
- Suhbat tarixidan oxirgi ~20 xabar kontekstga beriladi.
- Backend restart paytida yozilgan va 2 daqiqadan eski xabarlarga javob berilmaydi — shefim qayta yozishi kerak.
- Javob 3900 belgidan uzun bo'lsa, bo'laklarga bo'linadi. HTML xato bo'lsa, teglarsiz qayta yuboriladi.

## 6. Qila olmaydigan ishlar va o'rniga nima

| So'rov | Holat | O'rniga |
|---|---|---|
| to'lov, shartnoma, kategoriya, split o'zgartirish | yozuvchi asbob yo'q | panel sahifasi (INDEX xaritasi) |
| sync'ni ishga tushirish, sverka tuzatish, XonPay qayta moslash | tashqi so'rov taqiqlangan | panel sahifasi |
| bank paroli, credential, proxy | sirlar agentga berilmaydi | Sozlash / Bank ulanishlari, Admin / API Explorer |
| guruhga yoki odamga xabar yuborish | asbob yo'q | Telegram'da o'zingiz |
| kod o'zgartirish, commit, push, deploy | asbob yo'q | Claude Code; Support faqat matnli reja beradi |
| server: restart, disk, nginx, `.env`, journald logi | doira tashqarisi | server tomonda |
| rasm, ovoz, hujjatni o'qish | v1 da yo'q | matn bilan yozing |
| CRM sverka farq ro'yxati, jonli bank so'rovi | asbob yo'q | Sverka CRM va Sverka sahifalari |
| telefon, PINFL, karta, IP | berilmaydi | panel |
| kunlik avtomat hisobot | shefim taqiqlagan (push emas, pull) | so'ralganda javob |

## 7. Xatolar qanday ko'rinadi

- Asbob: `{error: '...'}` — agent sababni aytadi, raqam to'qimaydi.
- Sub-agent xato yoki chegara: `ask_support` / `ask_checker` natijasi `{error}` — Leader "Support javob bermadi: <sabab>" deydi.
- Claude API kaliti yo'q: "Claude API kaliti sozlanmagan".
- Chaqiruv holatlari (`LeaderRun.status`): `ok`, `error`, `capped` (kunlik chegara), `max_iter` (qadamlar tugadi).
- Leader javobi chiqmasa, tarixga `(tizim: bu so'rovga javob chiqmadi, sabab: ...)` qatori yoziladi — keyingi xabarda Leader buni ko'radi.
- `remember` va `save_lesson`: `{ok: true, id}` yoki `{ok: false, error}`. "Eslab qoldim" faqat `ok: true` dan keyin.

## 8. Xotira

- `LeaderMemory.kind`: `odam`, `qoida`, `qaror`, `fakt`, `tuzatish`. `source`: `owner` (bot, "eslab qol:"), `leader` (`remember`), `teacher_daily` (`save_lesson`).
- Faol yozuvlar barcha agent promptlarining oxiriga manbasi bilan qo'shiladi: `shefim`, `shefim, Leader orqali`, `Teacher saboqi, shefim tasdiqlamagan`.
- `remember` kodda tekshiriladi: shefimning o'z xabarida "eslab qol / yodda tut / unutma / xotiraga yoz" bo'lmasa yoki xabar forward bo'lsa — rad; bitta xabarga bitta yozuv. Shuning uchun asbob natijasidagi begona matn xotiraga tusha olmaydi.
- Forward matnidan va begona matndan xotira yozilmaydi. Sirlar xotiraga tushmaydi.
- Shefim `/xotira` bilan ro'yxatni ko'radi va keraksiz yozuvni o'chiradi (nofaol qiladi).
- Xotira prompt qoidalarini (sirlar, injection, faqat ko'rish) bekor qila olmaydi.
