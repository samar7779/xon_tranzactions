# To'lovni tuzatish — TR Support

## Vazifasi
To'lov topilgach (`/tolov`, chek, ID), uni to'g'rilash: tranzaksiyaning 3 ustunini agent orqali, egasi tasdig'i bilan tahrirlash.
- **Kontragent** = top kategoriya (panel "KONTRAGENT" ustuni): masalan `Клиент / Физ.Л / Юр.Л`, `Банк`, `Зарплата`, `Переброска`, `Молия Вазирлиги`, `Финансовый займ`.
- **Kategoriya** = subkategoriya (panel "KATEGORIYA" ustuni): masalan `Взносы за квартиры`, `Взносы за автостоянку`, `Возврат взносов за кв.`, `За счетчик`, `Переоформление (приход)`, `Взнос от имени клиента`.
- **Shartnoma** = CRM'da bor raqam. CRM'da topilmasa tahrir QILINMAYDI: egasiga "CRM'da topilmadi — boshqa shartnoma bering".
Aniq variantlar ro'yxati bazadan olinadi (`categories`), bot har safar ko'rsatadi. Kod yoki nom bilan tanlanadi.

## Oqim
1. Egasi so'raydi ("shu to'lovni to'g'irla", `/tuzat <to'lov ID>`). Leader: `intent: tx_edit`, `task_for_agent`:
   `TUZATISH: tx=<ID> kontragent=<..|qolsin> kategoriya=<..|qolsin|yo'q> shartnoma=<..|qolsin|tozalash> tasdiq=<ism> izoh=<matn>`.
2. Yetishmagan qiymat (`?` yoki yo'q): bot (`agents/tuzatish.py`, LLM'siz) to'lovning hozirgi holatini va BARCHA variantlarni ko'rsatib so'raydi: kontragent, kategoriya, shartnoma, kim tasdiqlaydi, izoh. `qolsin` — ustun o'z holicha qoladi (3 tadan 1-2 tasini o'zgartirish mumkin).
3. Hammasi ma'lum: bot backend tekshiruvi (`GET /api/agent-bridge/tx-edit/preview`, faqat o'qish). Xato bo'lsa tugmasiz aytadi.
4. To'g'ri bo'lsa: oldin → keyin ko'rinishi, CRM ma'lumoti (mijoz, obyekt), tasdiqlovchi, izoh va oxirida: "Tasdiqlash uchun \"tasdiqlayman\" deb yozing, bekor qilish uchun \"yo'q\"" (`C.TASDIQ_YOZING`). Inline tugma YO'Q. Tasdiq 10 daqiqa amal qiladi, bir marta ishlaydi.
5. "tasdiqlayman": `POST /api/agent-bridge/tx-edit/apply` → har to'lov panelning o'z yo'li bilan (`CategorizationService.setManual`, `setContract`: tarix `transaction_category_history`, OplatyKv propagation), keyin HAMMASIDAN keyin BITTA OplatyKv sync (`syncNowRespectingSettings`, panel "Sync" tugmasi bilan bir xil). Natija egasiga.

## Qoidalar (backend `tr-support.service.ts` tekshiradi)
- **XATO to'lovlar ro'yxatidagi to'lov tahrirlanmaydi** (egasi qoidasi, 2026-09-30). Ro'yxat = xato-list sahifasi bilan AYNAN bir xil: `OplataKvService.findXatoRowForTx` (`buildXatoFilter`: `source_tx_id` bor, shartnoma CRM'da found emas, `xato_hidden` emas) va sana `settings.agent.dateFrom` dan. Bunda bot savol bermaydi, "XATO to'lovlar ro'yxatidan ariza biriktiring: to'lov kartasidagi \"Shartnoma biriktirish\" (to'g'ri shartnoma va chek)" deydi. Kutilayotgan ariza (`xato_correction_requests.status=pending`) bo'lsa: "ariza allaqachon yuborilgan (kim, qachon, taklif) — tasdiqlanishini kuting". Bot orqali tuzatish faqat ro'yxatda yo'q to'lovga (masalan izohida shartnoma raqami umuman yo'q, OplatyKv'ga tushmagan). Istisnolar: harf farqi qoidasi va XATO ulash (pastda).
- Kontragent o'zgarsa kategoriya ham tanlanadi (yangi kontragentning bolalari bo'lsa). Bolasiz kontragentda kategoriya bo'sh.
- Kategoriya faqat tanlangan (yoki hozirgi) kontragent ichidan.
- Shartnoma faqat `Клиент / Физ.Л / Юр.Л` yoki `Переброска` kontragentida (panel qoidasi). CRM'da `found=true` bo'lishi SHART; O/0 varianti bilan topilsa CRM'dagi kanonik shakl yoziladi.
- `COUNTERPARTY`, `COUNTERPARTY_RETURN` qo'lda tanlanmaydi. Aloqa Bank importi tahrirlanmaydi.
- Hech narsa o'zgarmasa tahrir yo'q. Bir tasdiqda ko'pi bilan 20 ta to'lov.
- Tahrirda avval kategoriya, keyin shartnoma (shartnoma OplatyKv'ga faqat CLIENT to'lovda o'tadi).

## XATO deb belgilash
- `shartnoma=XATO`: shartnomasiz yoki noto'g'ri raqamli to'lovni XATO ro'yxatiga tushirish (keyin ariza olinadi). Shartnomaga AYNAN "XATO" yoziladi (egasi qarori: raqam qo'shilsa ham "XATO"), CRM tekshirilmaydi; panelning qo'lda shartnoma yo'li (`setContractManual`, `is_contract_manual=true`). Kontragent `CLIENT` bo'lishi shart (OplatyKv sync faqat CLIENT'ni oladi). Boshqa har qanday shartnoma CRM'da tekshiriladi. Sync'dan keyin OplatyKv qatori (`contract_no` = XATO) XATO ro'yxatida chiqadi.

## To'lovni topish va OplatyKv
- `tx=`: ichki id, to'liq bank ID (`external_id`) yoki CRM'dagi bank hujjat raqami (`bank_general_id`): `6617414180` yoki sana bilan `6617414180_30.09.2026` (bot `/` ni `_` ga almashtiradi). Backend `findTxRef`: aniq id/external_id, keyin general_id (+ Toshkent kuni); bir nechta chiqsa "sanasini qo'shing". Preview to'liq ID ni ko'rsatadi, tasdiq payload'i to'liq ID bilan (apply aynan ko'rsatilgan to'lovga).
- Kategoriya nomi kod, kirill nom yoki lotincha transliteratsiya bilan (`Za schetchik` = `За счетчик`).
- Sub-kategoriya o'zgarsa `setManual` OplatyKv qatorini o'zi yangilaydi (`syncCategoryChangeToOplataKv`: Tip, split reset); natijada `oplataKv: true` -> "OplatyKv qatori ham yangilandi". Keyin bitta umumiy sync.

## Harf farqi qoidasi (arizasiz, tasdiqsiz)
- Egasi qarori (2026-10-03): XATO ro'yxatidagi to'lovda to'g'ri shartnoma faqat oxirgi 1-2 harfi bilan farq qilsa va CRM'da aniq bo'lsa — ariza ham, egasi tasdig'i ham kerak emas. 30.09 dagi "XATO to'lov tahrirlanmaydi" taqiqiga istisno.
- Backend (`tr-support.service.ts::harfFarqi`, `harfFarqiMos`): noto'g'ri raqam = OplatyKv XATO qatori, to'lov shartnomasi yoki izohdagi raqam (`extractContractCandidates`; shartnoma "XATO" qo'yilgan bo'lsa ham). Shart: to'g'ri raqamning oxirgi 2 belgisidan oldingi qismi (raqam + obyekt kodi + yil) noto'g'rida AYNAN shunday; qolgan dum ikkalasida ham faqat harf va farq ko'pi bilan 2 harf — almashgan, ortiqcha yoki tushib qolgan (Levenshtein <= 2; masalan 217AFS24YIL -> 217AFS24YL, 656AFS25UZ -> 656AFS25ZU); to'g'ri raqam CRM'da `found` (kanonik shakl); `crm_contracts` keshida boshqa mos shartnoma yo'q ("aniq"); kutilayotgan ariza yo'q; kontragent/kategoriya o'zgarmaydi. Yozish XATO ariza tasdig'i kabi `setContractManual` (izohdan qayta yozilmaydi), tarix `tr_support_edits`, keyin bitta sync. Apply qoidani qayta tekshiradi.
- Bot (`tuzatish.py`): aniq shartnoma berilgan har qator avval `tx-edit/preview`; javobda `valid` + `harf` bo'lsa — savolsiz va tasdiqsiz darrov apply (`approvedBy` = egasi aytgan ism yoki `C.HARF_TASDIQ`, izoh `C.HARF_IZOH: A -> B`). Qoidaga tushmagan XATO to'lov — sababi bilan rad; qolganlari odatdagi oqim (tasdiq bilan). Ortga qaytarish panelda (TR Support).

## XATO to'lovni tasdiq bilan ulash (egasi qarori, 2026-10-05)
- Harf qoidasiga tushmagan XATO to'lov ariza o'rniga mas'ul tasdig'i bilan shartnomaga ulanadi, agar shartnoma "aniq" bo'lsa: CRM'da `found` (kanonik shakl) va obyekt kodi XATO raqam/izohdagi bilan bir xil (`objectCodeOf`; pul boshqa obyektga o'tmaydi — AI tekshiruvchi qoidasi). XATO raqamda ham, izohda ham obyekt kodi yo'q bo'lsa solishtirilmaydi (`ulash.obyekt=null`, preview'da aytiladi). Kutilayotgan ariza bo'lsa — rad. Faqat shartnoma o'zgaradi.
- Backend `tr-support.service.ts::xatoUlash` -> preview `ulash: {from, to, obyekt}`, `valid=true`, `plan.contractManual` (ariza tasdig'i bilan bir xil `setContractManual`); harf qoidasi CRM'da "aniq emas" (bir nechta mos) desa ham egasi aniq aytgan shartnoma shu yo'l bilan (tasdiq bilan) ulanadi.
- Bot (`tuzatish.py`): `ulash` qatori odatdagi oqim — kontragent/kategoriya `qolsin`, tasdiqlovchi va izoh so'raladi, preview'da "XATO ro'yxatidan ulanadi: ariza o'rniga tasdiq bilan (obyekt X bir xil)", "tasdiqlayman" dan keyin apply. Log: `tr_support_edits` (tx_external_id = ex_id, approved_by, comment, oldin/keyin) + audit. Ortga qaytarish ishlaydi.

## XATO to'lovda faqat kontragent/kategoriya (2026-10-05)
- Shartnoma o'zgarmasa (`qolsin` yoki `XATO`) va ariza kutilmasa: preview `xatoQoladi=true`, kontragent/kategoriya mas'ul tasdig'i bilan o'zgaradi, to'lov XATO ro'yxatida qoladi. Kontragent CLIENT bo'lib qolishi shart (aks holda rad: "panel orqali"). Shartnoma "XATO" ga yozilsa ham ro'yxatda qoladi.
- Aralash ro'yxat: bot rad etilgan qatorlarni alohida aytadi ("Qolgan N ta ... davom etaman" / "tasdiq so'rovi quyida"), qolganlariga bitta tasdiq so'rovi. Avval bittasi rad bo'lsa butun ro'yxat to'xtardi (05.10 da 3 ta ulash yo'qolgan).
- Natija: apply har to'lovga `crm` (mijoz, obyekt — preview'dagi CRM) va shartnoma o'zgarganda `okv` (`syncContractChangeToOplataKv`: OplatyKv qatoridagi shartnoma, mijoz, obyekt) qaytaradi; bot "CRM: ..." va "OplatyKv qatori yangilandi: shartnoma ..., mijoz ..., obyekt ..." deb yozadi.

## Yopishgan "от" (izoh parseri, 2026-10-05)
- `contract-parser.ts::extractContractCandidates`: asosiy raqamdan keyin darrov yopishgan "ОТ/от/OT" kesilgan nomzod (`stripGluedOt`, ortidan sana yopishsa ham): `2118MSO252POT` -> `2118MSO252P`. Kategoriyalash nomzodlarni tartib bilan CRM'da sinaydi: to'liq raqam topilmasa kesilgani; ikkalasi ham yo'q — asosiy (XATO, avvalgidek). Bot nusxasi `payment_check._ot_kes` (`_izoh_mos`).
- Eski XATO to'lovlar: Admin > Sync loglar > "Qayta tekshirish" (`POST /oplata-kv/reverify-contracts`: XATO qatorlarni izohdan qayta kategoriyalaydi).

## AI Perebroska bot orqali (2026-10-05)
- `PEREBROSKA: fayl=<leader_bot_...> [tasdiq=] [izoh=]` -> `agents/perebroska.py`. Fayl: `fayl=` yoki shu xabardagi fayl (faqat PDF/rasm; Word — rad).
- `POST /api/agent-bridge/perebroska/tahlil` (`TrPerebroskaService.tahlil`, 5/daq): `TrArizaService.readFile` (bot fayli) -> `OplataKvService.analyzePerereboskaAriza` (panel AI Perebroska bilan bir xil: Claude vision, summa roli tekshiruvi, ism, takror). Natija fayl hex'i bo'yicha 30 daqiqa keshlanadi (`pb_tahlil_<hex>`): tasdiqlovchi keyin aytilsa AI qayta chaqirilmaydi.
- Yaratib bo'lmaydigan holat (`perebroska.toskiqlar`: manba/maqsad topilmadi, obyekt boshqa, summa yo'q yoki jami teng emas, qoldiq yetmaydi) — sabab, tasdiq yo'q. Tasdiqlovchi ismi majburiy.
- "tasdiqlayman" -> `POST /api/agent-bridge/perebroska/yarat` (3/daq): `createPerereboska` (panel "Yaratish" bilan bir xil; actor va izoh `TR Support · tasdiq: <ism>`, agentUsed=true, agentData=tahlil). Natija: OplatyKv qatorlari (manba minus, maqsad plus, mijoz, obyekt). Orqaga qaytarish panelda: OplatyKv > + > AI Perebroska > Tarix. Audit: "Agent: переброска yaratildi (TR Support)".

## Ma'lumot: hisob raqam va XATO ro'yxati fayli (faqat o'qish, 2026-10-05)
- `HISOB: <raqam>` yoki `/hisob <raqam>` -> `GET /api/agent-bridge/hisob?raqam=` (`TrMalumotService.hisob`, 10/daq): `bank_accounts` (bizning hisob: bank, MFO, egasi, sync), `transactions` (`from_account`/`to_account` = raqam: nom/MFO/INN chastotasi, ikki tomon jamisi, shartnomalar, oxirgi 5 to'lov; oxirgi 3000 qator, jamilar to'liq; ustunlar indekssiz — kam so'raladi), `counterparties` (INN yoki `bank_accounts` JSON'da shu raqam: DIDOX to'liq nom, direktor, manzil, telefon, QQS). MFO -> bank: `mfo-banks.ts`, keyin bizning filiallar, keyin kontragent bank ro'yxati. Valyuta raqamning 6-8 xonasidan.
- `XATO_FAYL: [filtr]` yoki `/xato [filtr]` -> `GET /api/agent-bridge/xato-royxat?filtr=` (`TrMalumotService.xatoFayl`, 5/daq): `getXatoListForAgent` (xato-list sahifasi bilan bir xil filtr, sana `agent.dateFrom`, 2000 qatorgacha) + ariza holati (`pendingInfoByOplataKvId`, `rejectedOplataKvIds`) -> .xlsx (base64), bot `send_document`. Filtr: hisob, obyekt, shartnoma, mijoz, maqsad, tip (katta-kichik harf farqsiz).
- Bot moduli `agents/malumot.py`; Leader intentlari `hisob`, `xato_fayl`.

## Matn bilan tasdiq (tugmasiz)
- Egasi qarori (2026-10-01): TR Support oqimlarida (tahrir, ariza, eksport) tasdiq ham, variant tanlash ham inline tugmasiz, faqat matn. Eski xabarlardagi tugma callback'lari (`tz_ok:`, `ar_ok:`, `ek_ok:`, `ek_t:`) hali ishlaydi, yangi xabarda tugma chiqmaydi.
- Egasining qisqa javobi: "tasdiqlayman", "ha", "bajaring" = ha; "yo'q", "bekor" = yo'q (`C.TASDIQ_HA_RE` / `TASDIQ_YOQ_RE`, 40 belgigacha). Tasdiq xabariga reply bo'lsa o'sha so'rov; reply bo'lmasa faqat bitta kutilayotgan so'rov bo'lsa. Bir nechta bo'lsa bot "qaysi biri — reply qilib yozing" deydi. Uzun matn hech qachon tasdiq emas (Leader'ga ketadi).

## XATO to'lovga ariza (ARIZA)
- Egasi ariza/bank xati/chek rasmini beradi. Leader: `intent: xato_ariza`, `ARIZA: summa= sana= hisob= shartnoma= tolovchi= fayl= tasdiq=` (yoki `tx=`). Bot (`agents/ariza.py`):
  1. XATO ro'yxatidan to'lov: `GET /api/agent-bridge/xato-ariza/find` (xato-list bilan bir xil filtr `findXatoRows`, summa ±1, sana ±3 kun, qabul qiluvchi hisob). 0 ta: "XATO ro'yxatida yo'q — avval XATO deb belgilang"; bir nechta: ID lari bilan so'raydi; kutilayotgan ariza bo'lsa: "kuting".
  2. Shartnoma CRM'da (kanonik), topilmasa "boshqa shartnoma bering". To'lovchi ismi CRM mijozi bilan (familiya/ism 4 harf), obyekt kodi izohdagi shartnoma bilan solishtiriladi (farqli bo'lsa AI arizani xodimga yuborishi mumkin, ogohlantirish).
  3. "tasdiqlayman" → `POST xato-ariza/submit`: XATO sahifasidagi "Shartnoma biriktirish" bilan AYNAN bir xil `CorrectionService.createRequestWithFile` (ariza fayli = bot saqlagan rasm, `static/tg_uploads/leader_bot_<hex>.<ext>`, nomi qat'iy tekshiriladi). Yuboruvchi: `TR Support · <tasdiq>`.
  4. AI tekshiruvchi (`agent.aiName`, masalan Shomurad AI) darrov ko'radi; bot `xato-ariza/status` ni 4 daqiqagacha kutib natijani yozadi: tasdiqlandi / rad / xodim ko'rishi kerak. AI o'chiq bo'lsa: xodim tasdiqlaydi.

## Tarix va ortga qaytarish
- Har tahrir `tr_support_edits` jadvalida: qachon, to'lov (ID, sana, summa), oldin/keyin (kontragent, kategoriya, shartnoma), kim tasdiqladi (`approved_by`), izoh, holat (`applied` | `failed` qisman | `rolled_back`), sync natijasi. Bir tasdiq = bitta `batch_id`.
- Panel: Tranzaksiyalar > Klient · XATO shartnoma > **TR Support** tabi ("Barcha XATO" dan keyin). Kirish kodi serverda tekshiriladi (`POST /tr-support/unlock`; env `TR_SUPPORT_CODE`, default 7779).
- **Ortga qaytarish** (`POST /tr-support/edits/:id/rollback`, `categories:manage`): to'lov oldingi holatiga (`restoreSnapshot`, CRM tekshiruvisiz, chunki eski raqam XATO bo'lishi mumkin), keyin bitta OplatyKv sync. To'lov tahrirdan keyin yana o'zgargan bo'lsa (holat "keyin" bilan teng emas) qaytarilmaydi, 409.
- Tarixda "kim": `TR Support · tasdiq: <ism>` (tahrir), `TR Support · ortga: <panel foydalanuvchisi>` (qaytarish). Umumiy audit: `audit_logs` ("Agent: to'lov tahrirlandi (TR Support)").

## Fayllar
| Yo'l | Rol |
|---|---|
| `agents/tuzatish.py` | parse, variantlar so'rovi, preview, matnli tasdiq (`matn_qaror`), apply |
| `agents/leader_bot.py` | `/tuzat`, Leader javobidagi `TUZATISH:` qatori, `_matn_tasdiq` (raqam tanlash + tasdiq matni) |
| `backend/src/tr-support/` | `TrSupportService` (options, preview, apply, list, rollback), panel controller |
| `backend/src/agent-bridge/` | `tx-edit/options`, `tx-edit/preview` (GET), `tx-edit/apply` (POST, 3/daq) |
| `backend/src/categorization/categorization.service.ts` | `setManual`, `setContract` (actorLabel), `restoreSnapshot` |
| `frontend/components/tr-support-tab.tsx` | panel tabi: kod, ro'yxat, ortga qaytarish |

## Xavfli joylar
- Tahrir faqat egasi "tasdiqlayman" deb yozgach. Leader yoki sub-agent o'zi "tahrirlandi" demaydi.
- Ortga qaytarish shartnomasiz holatga qaytarsa, OplatyKv qatori panelning "Shartnomani tozalash" kabi XATO ro'yxatiga o'tadi.
- Sync 1-bosqichi sinxron (bir necha soniya), obyekt/mijoz va split fonda.
