# XATO to'lovlar va tuzatish

## Vazifasi
XATO = to'lovdagi shartnoma raqami `crm_contracts` dagi `found=true` raqamlarga ANIQ mos emas. Oqim: XATO ro'yxati → ariza (fayl bilan) → AI agent yoki xodim tasdiqlaydi yoki rad etadi → shartnoma qo'lda qo'yiladi, `oplata_kv` yangilanadi. Boshqa yo'llar: XATO → CRM tabi, Telegram tuzatish boti, TR Support (egasi @TRanSupport_bot'da [Ha] bosgach kontragent, kategoriya, shartnoma tahriri; `tuzatish.md`). Agentlar arizani tasdiqlamaydi va rad etmaydi; to'lovni faqat TR Support orqali, egasi tasdig'i bilan tahrirlaydi. Istisno (egasi qarori, 2026-10-03): to'g'ri shartnoma faqat oxirgi 1-2 harfi bilan farq qilsa va CRM'da aniq bo'lsa, TR Support XATO to'lovni arizasiz va tasdiqsiz ko'chiradi (`tuzatish.md`, "Harf farqi qoidasi").

## Fayllar
Yo'llar `backend/src/` ichida.

| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `correction/correction.service.ts` | ariza oqimi | `persistRequest`, `approve`, `reject`, `directCorrect`, `setHidden` |
| `correction/agent-ai.service.ts` | AI agent (Claude) | `tick`, `processRequest`, `objectCode` |
| `agent/agent.service.ts`, `agent-public.controller.ts` | digest, public ro'yxat | `tick`, `runDigest`, `authorizeTg` |
| `correction-bot/correction-bot-runner.service.ts` | tuzatish boti | `agentTurn`, `onCallback` |
| `transactions/transactions.service.ts` | (a) ta'rif | `clientXatoTransactions` |
| `oplata-kv/oplata-kv.service.ts` | (b) ta'rif, XATO → CRM | `buildXatoFilter`, `countXatoForAgent`, `botAssignContract`, `assignFromCrm`, `applyCrmSplit`, `reverifyXato` |
| `categorization/categorization.service.ts` | shartnoma qo'yish | `setContractManual`, `syncContractChangeToOplataKv` |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| GET | `/correction/pending`, `/approved`, `/rejected`; `/transactions/client-xato` | `transactions:view` | arizalar, (a) ro'yxat |
| POST | `/correction/:id/approve`, `/:id/reject`, `/direct`, `/hide` | `categories:manage` | tasdiq, rad, darrov tuzatish, yashirish |
| GET, POST | `/agent/xato-list`, `/agent/submit`, `/agent/tg/*` | `?key=` yoki Telegram login + `agent.whitelist` | public ro'yxat, ariza |
| GET, PUT, POST | `/agent/config`, `/agent/ai/*`, `/correction-bot/config` | `agent:view`, `agent:manage` | sozlama, AI |
| POST | `/crm/match-composites`, `/oplata-kv/:id/assign-from-crm`, `/oplata-kv/bulk-crm-fix` | `match-composites`: `crm:view`, `oplatakv:view` yoki `oplatakv:xato_crm`; `assign-from-crm`, `bulk-crm-fix`: `oplatakv:edit` yoki `oplatakv:xato_crm` (biri yetarli) | XATO → CRM |

## Frontend sahifalar
Yo'llar `frontend/app/[locale]/` ichida.

| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `xato-list/page.tsx` | `/agent/*` | whitelist, kalit havola |
| `(panel)/transactions/page.tsx` (`ClientXatoDialog`) | `/transactions/client-xato`, `/correction/*` | xodim |
| `(panel)/oplatykv/xato-crm/page.tsx` | `/oplata-kv?xatoOnly=true`, `/crm/match-composites`, `assign-from-crm` | `oplatakv:xato_crm` |
| `(panel)/admin/agent/page.tsx` | `/agent/*`, `/correction-bot/*` | `agent:view` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `xato_correction_requests` | correction, agent-ai | panel, digest | `status` (pending, approved, rejected), `reviewed_by_type` (agent, user), `agent_state` (processing, needs_review, done), `agent_reason`, `snap_*` |
| `transactions` | `setContractManual`, `setHidden` | (a) | `contract_number`, `is_contract_manual`, `xato_hidden` |
| `oplata_kv` | `setContractManual`, `applyCrmSplit` | (b) | `contract_no`, `source_tx_id`, `agent_notified_at` |

## Biznes qoidalar
- (a) `clientXatoTransactions`: kategoriya `CLIENT`, `is_contract_manual=false`, `source` `IMPORT`/`ALOQA_BANK` emas, `xato_hidden` emas.
- (b) `buildXatoFilter`: `source_tx_id` bor, manba tx `xato_hidden` emas. `is_contract_manual` hisobga olinmaydi: (b) (a) dan ko'p bo'lishi mumkin. Qaysi ta'rif ekanini ayt.
- Moslik `notIn`, aniq: kategoriyalash CRM kanonik raqamini yozishi shart (`categorization.service.ts::runRules`).
- Bir tx'ga bitta `pending`. Tasdiqda shartnoma va fayl majburiy (`approve`).
- AI agent `tick`: `agent.aiEnabled`, oyna `agent.aiFromHour`/`agent.aiToHour`, interval `agent.aiIntervalMin` (default 5 daq); faqat `agent_state IS NULL` va fayli bor ariza, tsiklda 10 ta, claim atomik. Kalit `agent.aiKey` yoki `ANTHROPIC_API_KEY`: qiymatini yozma.
- Obyekt `objectCode`: raqamlardan keyingi harflar (`118VTN24LJ` → `VTN`). Farq qilsa (istisno: harf tushgan, `looseSameContract`) yoki imzo tasdiqlanmasa xodimga.
- Digest `agent.service.ts::tick`: `agent.enabled`, Toshkent `agent.dailyTime` (default 09:00), kuniga 1 marta, natija `agent.lastResult`.
- `crm.service.ts`: `matchComposites` (XATO → CRM sahifasi) va `bulkMatch` (`bulk-crm-fix`, 20 daq kesh). Tartib: avval to'liq `external_id`, keyin yadro `general_id_num_ddate`, keyin izohdagi `XONPAY:(UUID)` → `xonpay_transactions`. CRM `external_id` = kompozit ID (`source_tx_id || id`).
- `assignFromCrm`: avval `botAssignContract` (kanonik raqam), keyin CRM split bo'lsa `applyCrmSplit`, aks holda `splitSingleRow`. Summa so'm, kompozit ID ichidagi summa tiyin.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `buildXatoFilter` → digest, `xato-list`, bot, `bulkCrmFix`, `reverifyXato`, `xatoOnly`.
- `setContractManual` → `approve`, `directCorrect`, `botAssignContract`, OplatyKv sinxroni.
- `crm.service.ts::searchContracts` param to'plami → bot, `xato-list` qidiruvi, kesh fallback.

## Xavfli joylar va tuzoqlar
- `agent_notified_at` hech qayerda yozilmaydi (`markAgentNotified` chaqirilmaydi): digest soni = `agent.dateFrom` dan beri barcha (b) XATO.
- `approve` raqamni kanonikka o'tkazmaydi (`cleanContract`): variant yozilsa (a) dan chiqadi, (b) da qoladi.
- Shartnomani bo'shatish `oplata_kv` ni `contract_no='xato'`, `source_tx_id=NULL` qiladi: bog'lanish uziladi.
- Bot tugmasi `botAssignContract` ni to'g'ridan chaqiradi: ariza, fayl, tasdiq yo'q. Suhbat xotirada. `corrbot.whitelist` bo'sh = hech kim.
- Restartda `agent_state='processing'` qoladi: tozalash yo'q, cron olmaydi.
- `DELETE /oplata-kv/cleanup-xato-contracts` XATO qatorlarini, `POST /correction/clear` arizalarni o'chiradi. Qaytmas, taklif qilma.
- `agent.botToken`, `corrbot.botToken` qiymatini o'qima. Bitta tokenda bitta `getUpdates` (409).

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| XATO soni farqi | `clientXatoTransactions`, `buildXatoFilter` |
| CRM'da bor, lekin XATO'da qotgan | `crm.service.ts::show`, `crm-contract-cache.service.ts::fetchFromCrmAndCache`, `reverifyXato` |
