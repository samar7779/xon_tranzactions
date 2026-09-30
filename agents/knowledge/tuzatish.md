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
4. To'g'ri bo'lsa: oldin → keyin ko'rinishi, CRM ma'lumoti (mijoz, obyekt), tasdiqlovchi, izoh va [Ha, tahrirla] [Yo'q]. Tasdiq 10 daqiqa amal qiladi, bir marta bosiladi.
5. [Ha]: `POST /api/agent-bridge/tx-edit/apply` → har to'lov panelning o'z yo'li bilan (`CategorizationService.setManual`, `setContract`: tarix `transaction_category_history`, OplatyKv propagation), keyin HAMMASIDAN keyin BITTA OplatyKv sync (`syncNowRespectingSettings`, panel "Sync" tugmasi bilan bir xil). Natija egasiga.

## Qoidalar (backend `tr-support.service.ts` tekshiradi)
- **XATO to'lovlar ro'yxatidagi to'lov tahrirlanmaydi** (egasi qoidasi, 2026-09-30). Ro'yxat = xato-list sahifasi bilan AYNAN bir xil: `OplataKvService.findXatoRowForTx` (`buildXatoFilter`: `source_tx_id` bor, shartnoma CRM'da found emas, `xato_hidden` emas) va sana `settings.agent.dateFrom` dan. Bunda bot savol bermaydi, "XATO to'lovlar ro'yxatidan ariza biriktiring: to'lov kartasidagi \"Shartnoma biriktirish\" (to'g'ri shartnoma va chek)" deydi. Kutilayotgan ariza (`xato_correction_requests.status=pending`) bo'lsa: "ariza allaqachon yuborilgan (kim, qachon, taklif) — tasdiqlanishini kuting". Bot orqali tuzatish faqat ro'yxatda yo'q to'lovga (masalan izohida shartnoma raqami umuman yo'q, OplatyKv'ga tushmagan).
- Kontragent o'zgarsa kategoriya ham tanlanadi (yangi kontragentning bolalari bo'lsa). Bolasiz kontragentda kategoriya bo'sh.
- Kategoriya faqat tanlangan (yoki hozirgi) kontragent ichidan.
- Shartnoma faqat `Клиент / Физ.Л / Юр.Л` yoki `Переброска` kontragentida (panel qoidasi). CRM'da `found=true` bo'lishi SHART; O/0 varianti bilan topilsa CRM'dagi kanonik shakl yoziladi.
- `COUNTERPARTY`, `COUNTERPARTY_RETURN` qo'lda tanlanmaydi. Aloqa Bank importi tahrirlanmaydi.
- Hech narsa o'zgarmasa tahrir yo'q. Bir tasdiqda ko'pi bilan 20 ta to'lov.
- Tahrirda avval kategoriya, keyin shartnoma (shartnoma OplatyKv'ga faqat CLIENT to'lovda o'tadi).

## Tarix va ortga qaytarish
- Har tahrir `tr_support_edits` jadvalida: qachon, to'lov (ID, sana, summa), oldin/keyin (kontragent, kategoriya, shartnoma), kim tasdiqladi (`approved_by`), izoh, holat (`applied` | `failed` qisman | `rolled_back`), sync natijasi. Bir tasdiq = bitta `batch_id`.
- Panel: Tranzaksiyalar > Klient · XATO shartnoma > **TR Support** tabi ("Barcha XATO" dan keyin). Kirish kodi serverda tekshiriladi (`POST /tr-support/unlock`; env `TR_SUPPORT_CODE`, default 7779).
- **Ortga qaytarish** (`POST /tr-support/edits/:id/rollback`, `categories:manage`): to'lov oldingi holatiga (`restoreSnapshot`, CRM tekshiruvisiz, chunki eski raqam XATO bo'lishi mumkin), keyin bitta OplatyKv sync. To'lov tahrirdan keyin yana o'zgargan bo'lsa (holat "keyin" bilan teng emas) qaytarilmaydi, 409.
- Tarixda "kim": `TR Support · tasdiq: <ism>` (tahrir), `TR Support · ortga: <panel foydalanuvchisi>` (qaytarish). Umumiy audit: `audit_logs` ("Agent: to'lov tahrirlandi (TR Support)").

## Fayllar
| Yo'l | Rol |
|---|---|
| `agents/tuzatish.py` | parse, variantlar so'rovi, preview, [Ha]/[Yo'q], apply |
| `agents/leader_bot.py` | `/tuzat`, Leader javobidagi `TUZATISH:` qatori, `tz_ok:` / `tz_no:` tugmalar |
| `backend/src/tr-support/` | `TrSupportService` (options, preview, apply, list, rollback), panel controller |
| `backend/src/agent-bridge/` | `tx-edit/options`, `tx-edit/preview` (GET), `tx-edit/apply` (POST, 3/daq) |
| `backend/src/categorization/categorization.service.ts` | `setManual`, `setContract` (actorLabel), `restoreSnapshot` |
| `frontend/components/tr-support-tab.tsx` | panel tabi: kod, ro'yxat, ortga qaytarish |

## Xavfli joylar
- Tahrir faqat egasi [Ha] bosgach. Leader yoki sub-agent o'zi "tahrirlandi" demaydi.
- Ortga qaytarish shartnomasiz holatga qaytarsa, OplatyKv qatori panelning "Shartnomani tozalash" kabi XATO ro'yxatiga o'tadi.
- Sync 1-bosqichi sinxron (bir necha soniya), obyekt/mijoz va split fonda.
