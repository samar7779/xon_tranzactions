# Chek order

## Vazifasi
`/chek-order`: bank memorial orderi yoki naqd kvitansiya surati/PDF'i yuklanadi, yoki order raqami, yoki shartnoma kiritiladi. Claude vision maydonlarni ajratadi, `transactions` da ko'p signalli skoring bilan to'lov qidiriladi, natija `chek_order` ga yoziladi (found, mismatch, not_found). Yonida AI yordamchi, murojaatlar, Chek payment va Telegram Mini App. `/chek` (Shartnoma nazorati, `chek.md`) bilan adashtirma.

## Fayllar
| Yo'l | Rol | Eng muhim funksiyalar |
|---|---|---|
| `backend/src/chek-order/chek-order.service.ts` | tekshiruv, tarix, yordamchi, murojaat, Chek payment | `analyzeFile`, `checkManual`, `matchOrder`, `resultOf`, `groupResults`, `paymentCheck`, `crmPaymentPart`, `assistantChat`, `applyCorrection`, `locateLink`, `clearAll` |
| `backend/src/chek-order/chek-tg.service.ts` | Telegram kirish | `auth`, `verifyInitData`, `loginWidget`, `handleWebhook`, `postGroupButton` |
| `backend/src/auth/jwt.strategy.ts` | mehmon ruxsatlari | `validate` (`tgGuest`) |

## API endpointlar
| Metod | Yo'l | Ruxsat | Nima qiladi |
|---|---|---|---|
| POST | `/chek-order/analyze` (25 MB), `/manual` | `chekorder:manage` | tekshiruv + yozuv |
| GET | `/chek-order` | `chekorder:history` | tarix |
| GET | `/contract-info`, `/crm-suggest`, `/contract-payments`, `/payment-check`, `/payment-check/export`, `/:id/file` | `chekorder:view` | o'qish |
| POST | `/assistant/chat` | `chekorder:assistant` | AI yordamchi |
| GET, POST, PATCH, DELETE | `/tickets`, `/tickets/:id/resolve/*`, `/tickets/:id/locate/*` | `chekorder:tickets` | murojaat, tuzatish |
| DELETE | `/chek-order`, `/:id` | `chekorder:manage` | tarix va fayl |
| POST | `/tg/auth`, `/tg/login`, `/tg/redeem`, `/tg/webhook/:secret` | ochiq | Telegram kirish |
| GET, POST | `/tg/config`, `/tg/post-button` | `chekorder:telegram` | sozlama |

## Frontend sahifalar
| Sahifa | Qaysi API'larni chaqiradi | Kim ko'radi |
|---|---|---|
| `frontend/app/[locale]/(panel)/chek-order/page.tsx` (Tekshirish, Chek payment, Tarix, Murojaatlar) | yuqoridagilar | `chekorder:view`, tab o'z ruxsati bilan |
| `frontend/components/chek-check.tsx`, `chek-payment.tsx`, `chek-assistant.tsx`, `chek-tickets.tsx` | analyze, payment-check, assistant, tickets | shu ruxsatlar |
| `frontend/app/[locale]/tg/chek/page.tsx` (panelsiz) | `tg/auth`, `tg/login`, `tg/redeem` | guruh a'zosi |
| `frontend/app/[locale]/(panel)/admin/roles/page.tsx::TelegramConfigModal` | `tg/config`, `tg/post-button` | `chekorder:telegram` |

## DB jadvallar
| Jadval | Kim yozadi | Kim o'qiydi | Muhim ustunlar |
|---|---|---|---|
| `chek_order` | `persist`, `clearAll`, `remove` | Tarix | `batch_id`, `source` (photo, pdf, manual), `order_no`, `amount` (Decimal so'm), `result`, `matched_tx_ext_id`, `cond_order`, `cond_account`, `cond_amount`, `cond_contract`, `cond_date`, `file_path` |
| `chek_ticket` | `createTicket`, `updateTicket`, `applyCorrection`, `locateLink` | Murojaatlar | `ticket_no`, `status` (new, in_progress, resolved, rejected), `matched_tx_ext_id`, `transcript` |
| `oplata_kv` | faqat `applyCorrection` | contract-info, Chek payment | `first_installment`, `monthly_amount`, `payment_amount` |
| `settings` | `setConfig` | | `chekorder.tg.enabled`, `chekorder.tg.botToken` (shifrlangan), `chekorder.tg.groupId`, `chekorder.tg.webhookSecret` |

## Biznes qoidalar
- `matchOrder`: nomzod = `doc_number` = order №, yoki shartnoma `description` da, yoki summa + sana ±4 kun. Ball: order 50, hisob 40, summa 25, shartnoma 25, sana 10; 50 dan kam = not_found.
- Order № ko'pincha `doc_number` dan farq qiladi (kvitansiya raqami bank hujjati emas).
- `resultOf`: summa yoki shartnoma zid = mismatch; order va hisob ikkalasi zid = mismatch; aks holda found.
- `acctSimilar`: OCR uchun edit distance 2 gacha, `to_account` va `from_account`. `sameDay`: Toshkent kuni.
- Telegram: `getChatMember` (creator, administrator, member, restricted), mehmon JWT 12 soat, `sub = tg:<id>`.
- `groupResults`: mem. order + kvitansiya bitta to'lov bo'lsa bitta natija.
- `paymentCheck`: 200 shartnoma; OplatyKv default, CRM va Sheet tanlansa. CRM `show` topmasa `paymentsByContract` zaxira.
- AI kaliti `agent.aiKey` yoki `ANTHROPIC_API_KEY`, model `agent.aiModel`.

## Bog'liqliklar — "X ni o'zgartirsang, Y ta'sirlanadi"
- `oplata-kv.service.ts::manualSplit`, `splitSingleRow` → `applyCorrection` (invariant: boshlang'ich + oylik = summa).
- `google-export.service.ts::readContractsPayments`, `normalizeSpreadsheetId` → Chek payment.
- `crm.service.ts::show`, `paymentsByContract` → contract-info, Chek payment.
- i18n `chekOrder` kaliti uz, ru, en uchalasiga, aks holda MISSING_MESSAGE.

## Xavfli joylar va tuzoqlar
- Tekshiruv va Chek payment `transactions`, `oplata_kv` ni o'zgartirmaydi. Lekin `resolve/apply` (`applyCorrection`) `oplata_kv` split'ini yozadi. Memorial order PDF boshqa modul (`oplata_kv.md`).
- Telegram mehmoni `view`, `manage`, `assistant`, `tickets` oladi: API orqali `DELETE /chek-order` va `resolve/apply` ga yetadi.
- `redeemStore` hech qayerda to'ldirilmaydi: `/tg/redeem` doim 401. `/start` hozir `web_app` tugma yuboradi.
- Webhook avtomat o'rnatilmaydi (DataSyncBot webhook'i egallanmasin); `ensureWebhook` chaqirilmaydi. Guruhda `web_app` tugma mumkin emas: `?startapp` havola.
- Sheet: `spreadsheetId` URL bo'lishi mumkin, `UNFORMATTED_VALUE` shart (vergul x100), merge katak.
- `clearAll` fayllar bilan qaytmas.

## Tez-tez qilinadigan o'zgarishlar — qayerda
| Vazifa | Qaysi fayl va funksiya |
|---|---|
| Skoring | `chek-order.service.ts::matchOrder`, `resultOf` |
| OCR maydonlari | `chek-order.service.ts::claudeExtractOrders` |
| Chek payment | `paymentCheck`, `crmPaymentPart` |
| Telegram | `chek-tg.service.ts`, `jwt.strategy.ts::validate` |
