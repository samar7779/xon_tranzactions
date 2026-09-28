# DB sxema — `xon_tranzactions`

Manba: `backend/prisma/schema.prisma`. Zid bo'lsa, `schema.prisma` to'g'ri.

## 1. Umumiy qoidalar

- Yagona baza `xon_tranzactions` (PostgreSQL, faqat localhost). Biznes jadvallari `public` sxemada, Prisma boshqaradi. Bot jadvallari alohida `agents` sxemada.
- Nomlar: Prisma model va maydon camelCase, SQL'da `@@map` va `@map` snake_case. Raw SQL'da faqat SQL nomi: `OplataKv.contractNo` → `oplata_kv.contract_no`.
- PK: `id` TEXT (cuid). Istisno: `crm_contracts.contract_number`, `xonpay_transactions.external_id`, `settings.key`.
- `oplata_kv.id` ko'pincha cuid emas. Tranzaksiyadan kelgan qatorda kompozit `external_id` (`IP_...`, `HB_...`) yoki `external_id` bo'lmasa UUID (`oplata-kv.service.ts::syncFromTransactions`). Excel importida fayldagi ID ustuni. Qo'lda va perereboska qatorida cuid.
- FK kam: ko'p bog'lanish matn tengligi bilan (JOIN naqshlari).
- Enum ustun qiymati katta harf (`'COMPLETED'`, `'IN'`). Matn holat kichik harf (`'pending'`, `'success'`, `'ok'`).
- Vaqt: `DateTime` tz'siz, qiymati UTC. Toshkent = UTC+5, yozgi vaqt yo'q. Toshkent kuni: `(txn_date + interval '5 hours')::date`.
- `NOW()`, `CURRENT_DATE` ishlatma: DB soati farq qiladi, vaqtni ilovadan parametr qilib ber (`oplata-kv.service.ts::clampFutureUpdatedAt`).
- `@db.Date` (vaqtsiz Toshkent sanasi, literal `'YYYY-MM-DD'`): `oplata_kv.date`, `transactions.value_date`, `xonpay_transactions.date_paid`, `sync_exclusion_ranges.date_from`/`date_to`, `perereboska_group.date`, `chek_dog.data`, `chek_order.order_date`, `xonpay_transactions.matched_date`, `vznos_contract.contract_date`, `counterparties.registration_date`, `contract_schedules.due_date`.
- Migratsiya yo'q. Backend o'zgargan har deploy `npx prisma db push --accept-data-loss` qiladi (`scripts/deploy.sh`): `public` dagi schema.prisma'da yo'q jadval yoki ustun ogohlantirishsiz o'chadi.
- `schema.prisma` REJA'si: egasi [Ha] bossa bot `main` ga o'zi push qiladi, webhook deploy bazani darhol o'zgartiradi. Bot bu faylni sezgir deb biladi (risk `yuqori`). Ustun o'chirish yoki nomini o'zgartirish ma'lumotni yo'qotadi: REJA'da buni ochiq yoz.
- Retention yo'q, so'rovda sana sharti majburiy: `sync_logs`, `audit_logs`, `api_request_logs`, `transaction_change_logs`, `oplata_kv_history`, `export_cron_logs`.

### Summa birliklari
| Ustun | Tur | Birlik |
|---|---|---|
| `transactions.amount`, `bank_accounts.balance` | Decimal(18,2) | so'm, musbat; yo'nalish `direction` da. Bank tiyin beradi, kod 100 ga bo'ladi |
| `oplata_kv.payment_amount`, `first_installment`, `monthly_amount` | Decimal(15,2) | so'm, ishorali: + to'lov, − qaytarish yoki perereboska manbai |
| `xonpay_transactions.amount`, `matched_amount` | BIGINT | butun so'm |
| `transactions.external_id` ichidagi summa | matn | tiyin (bank xom qiymati) |

### JOIN naqshlari
- `transactions t JOIN categories c ON c.id = t.category_id` (filtr `c.code = 'CLIENT'`); subkategoriya `t.subcategory_id`.
- `transactions.account_id` → `bank_accounts.id`; `bank_accounts.bank_id` → `banks.id`; `bank_accounts.credential_id` → `bank_credentials.id`.
- `oplata_kv.source_tx_id = COALESCE(t.external_id, t.id)` (FK yo'q).
- `crm_contracts.contract_number = t.contract_number` yoki `= o.contract_no` (aniq tenglik, `found` ni tekshir).
- `sync_logs.account_id = bank_accounts.id` (FK yo'q).
- `xato_correction_requests.tx_id = transactions.id`, `oplata_kv_id = oplata_kv.id` (FK yo'q).
- `admin_users.role_id` → `roles.id`; `xonpay_transactions.matched_tx_id` → `transactions.id`.

## 2. Jadvallar (modul bo'yicha)

### Tranzaksiyalar
| Jadval | Muhim ustunlar | Kim yozadi | Kim o'qiydi |
|---|---|---|---|
| `transactions` | `external_id` (unique), `txn_date`, `amount`, `direction`, `status`, `source`, `bank_id`, `account_id`, `category_id`, `subcategory_id`, `contract_number`, `is_contract_manual`, `xato_hidden`, `doc_number`, `hb_dedup_key`, `erp_*` | sync, import, categorization, correction, reconcile, vznos, taminot | hamma |
| `categories` | `code` (unique), `name`, `parent_id` | faqat `prisma/seed.ts` | kategoriyalash, hisobot |
| `transaction_category_history` | `tx_id`, `action` (sync, auto, manual, cron, force, contract, counterparty, attachment, import, xato-hide), `old_*`, `new_*` | categorization, correction, import, attachments | panel tarixi |
| `transaction_attachments` | `tx_id`, `storage_path`, `contract_number` | `attachments.service.ts` | XATO tuzatish |
| `counterparties`, `counterparty_history` | `inn` (unique), `name`, `is_active`, `last_fetched_at`, `last_fetch_error` | `counterparties.service.ts` | tranzaksiyalar |

### Bank sync
| Jadval | Muhim ustunlar | Kim yozadi | Kim o'qiydi |
|---|---|---|---|
| `banks` | `code` (faol va integratsiyali: KAPITALBANK, IPAK_YULI, HAMKORBANK; yana 25 ta nofaol bank, `is_active = false`, `api_kind` KAPITALBANK_V3), `api_kind`, `is_active`, `sync_interval_minutes` (0 = avto-sync o'chiq) | `banks.service.ts` (`onModuleInit` har start'da `DEFAULT_BANKS` ni qo'shadi), `prisma/seed.ts` | sync |
| `bank_credentials` | `label`, `auth_mode`, `use_proxy`, `is_active`, `last_verified_at`, `last_error`. Sir: `password_enc`, `login_name`, `sid` | bank-credentials, bank-pwd, sync | sync |
| `bank_accounts` | `account_no`, `branch` (MFO), `owner_name`, `currency`, `balance`, `sync_enabled`, `last_synced_at` | bank-accounts, sync, transactions | hamma |
| `sync_logs` | `account_id`, `source` (matn), `status` (RUNNING, SUCCESS, FAILED, PARTIAL), `fetched`, `saved`, `errors`, `error_message`, `started_at` | `sync.service.ts` | Facts `bank_sync` |
| `transaction_change_logs` | `change_type` (DELETED, EDITED, MOVED), `external_id`, `detected_at`, `detected_by`, `old_data`, `new_data` | sync, reconcile, transactions | `/changes` sahifasi |
| `sync_exclusion_ranges` | `account_id`, `date_from`, `date_to`, `source` (import, manual) | `import.service.ts` | faqat ma'lumot (d19dc52 dan beri) |
| `import_batches` | `kind` (transactions, aloqa-bank, oplata-kv, hamkor-vipiska), `imported_at`, `rows_*` | import, oplata-kv | import tarixi |

### OplatyKv
| Jadval | Muhim ustunlar | Kim yozadi | Kim o'qiydi |
|---|---|---|---|
| `oplata_kv` (UI `ОплатыКв`, OplatyKv) | `contract_no`, `date`, `payment_amount`, `first_installment`, `monthly_amount`, `payment_category` (FIRST, MONTHLY, GENERAL), `tx_type`, `object`, `client`, `source_tx_id` (unique), `import_batch_id`, `perereboska_group_id`, `was_manually_edited`, `agent_notified_at`, `created_by_name`, `updated_at` | oplata-kv (avto-sync), sync, reconcile, categorization, import, vznos | hisobot, API, eksport |
| `oplata_kv_history` | `oplata_kv_id` (FK yo'q), `action` (created, edited, updated, deleted, imported), `changes` | oplata-kv, sync, import, categorization, transactions (tozalash) | `/api/v1/oplata-kv/changes` |
| `perereboska_group` | `from_contract_no`, `amount`, `destinations` (JSON), `status` (active, cancelled) | `oplata-kv.service.ts` | perereboska tarixi |
| `vznos_contract` | `contract_no`, `status`, `in_crm` | `vznos.service.ts` | `vznos.service.ts` (`/vznos` tabi) |
| `oplata_kv_object_mappings` | `crm_name` (unique) → `oplata_name` | `oplata-kv.service.ts` | avto-sync obyekt nomi |

Mijoz tushumi filtri: `payment_amount > 0 AND tx_type ILIKE '%взнос%'` (vznos), `oplata-kv.service.ts::dailySummary`.

Obyekt hisoboti `vznos_contract` ni o'qimaydi. U `tx_type ILIKE '%от имени%'` (ot imeni) qatorlarini chiqarib tashlaydi (`oplata-kv.service.ts::buildObjectReportWhere`).

### XATO, CRM, XonPay
| Jadval | Muhim ustunlar | Kim yozadi | Kim o'qiydi |
|---|---|---|---|
| `xato_correction_requests` | `tx_id`, `oplata_kv_id`, `status` (pending, approved, rejected), `reviewed_by_type` (agent, user), `agent_state` (processing, needs_review, done), `submitted_at`, `snap_*` | `correction.service.ts`, `agent-ai.service.ts` | Facts `xato` |
| `agent_chat_messages` | `role` (user, assistant), `content`, `has_image`, `created_at` | `agent-ai.service.ts` | Admin > Agent sahifasi chat tarixi |
| `crm_contracts` | PK `contract_number`, `found`, `status`, `virtual_status`, `object_name`, `branch_name`, `crm_order_id`, `last_verified_at`. Shaxsiy: `customer_name`, `phone`, `raw_snapshot` | crm, crm-contract-cache, categorization, oplata-kv | XATO, OplatyKv, chek-order, `/api/v1`, Facts `xato`, `crm_sverka` (CRM sverka moduli o'qimaydi) |
| `xonpay_transactions` | PK `external_id`, `xonpay_uuid`, `contract`, `amount`, `date_paid`, `is_matched`, `matched_tx_id`, `updated_at_local` | `xonpay.service.ts` | Billing tabi |
| `xonpay_sync_logs` | `trigger`, `status` (running, success, failed, cancelled), `started_at`, `error_message` | `xonpay.service.ts` | Facts `xonpay` |

Sverka jadvali yo'q: holat `settings` da (`sverka.telegram.notifiedToday`, `crmSverka.lastRun`). `crmSverka.snapshot` gzip+base64: SELECT qilma.

### Chek, eksport, API, platforma
| Jadval | Muhim ustunlar | Kim yozadi | Kim o'qiydi |
|---|---|---|---|
| `chek_order`, `chek_ticket` | `order_no` (= `transactions.doc_number`), `result` (found, mismatch, not_found); ticket `status` (new, in_progress, resolved, rejected) | `chek-order.service.ts` | `/chek-order` |
| `chek_dog` | `contract_number`, `data`, `kontrolyor` (otkaz, prinyat), `tg_send`, `tg_sent_at` | `chek.service.ts` | `/chek`, `notifyCron` |
| `export_cron_logs` | `sheet_id`, `status` (ok, error), `mode` (cron, manual), `started_at` | `google-export.service.ts` | Facts `google_export` |
| `shmitd_logs` | `target_date`, `target_at`, `sent_at`, `status` (sent, empty, error) | `shmitd.service.ts` | SHMITD tarixi |
| `api_keys`, `api_request_logs` | `name`, `scopes`, `is_active`, `expires_at`; log `api_key_id`, `path`, `status_code`, `created_at`. Sir: `key_id`, `secret_hash` | `api-key.service.ts` | Facts `api_usage` |
| `admin_users`, `roles` | `email`, `full_name`, `role_id`, `is_active`, `last_login_at`; `roles.permissions` (TEXT[]). Sir: `password_hash` | admin-users, roles, auth, seed | auth |
| `audit_logs` | `user_name`, `module`, `action`, `method`, `status_code`, `success`, `created_at`. Maxfiy: `ip`, `meta`, `user_email` | `audit.service.ts` | profil, Facts `panel_activity` |
| `settings` | PK `key`, `value` (TEXT), `updated_at`, `updated_by` | ko'p servis (`sync/settings.service.ts`) | hamma |

Deyarli ishlatilmaydi: eski billing (`customers`, `contracts`, `contract_stages`, `payments`); `contract_schedules` (yozuvchi yo'q).

### Agentlar
- v1 leader (boshqa sessiya, tegilmaydi): `leader_messages`, `leader_memories`, `leader_runs`, `leader_alerts`. Yangi bot ulardan faqat `leader_alerts`, `leader_runs` ni o'qiydi (Facts `schedulers`).
- Yangi bot, `agents` sxema (`db_migrations.py::ensure_tables`): `kv_store`, `agent_runs`, `agent_tasks`, `agent_memory`, `agent_health`, `agent_promises`, `agent_alert_log`, `agent_chat_log`. `public` da bo'lsa keyingi deploy o'chiradi. Retention bor: `db_migrations.py::cleanup_old` (`contract.py::RETENTION_DAYS`: `agent_chat_log` 30, `agent_runs` 90, `agent_memory` 180 kun).
- `agent_chat_messages` (`public`, backend jadvali): XATO AI agentining admin bilan suhbat tarixi. Yangi botning `agents.agent_chat_log` jadvali emas.

## 3. Tez-tez adashtiriladigan ustunlar

| Mavjud emas yoki noto'g'ri | To'g'risi |
|---|---|
| jadval `oplatykv`, `OplataKv` | `oplata_kv` |
| `oplata_kv.contract_number` | `contract_no` (tranzaksiyada `contract_number`) |
| `oplata_kv.amount` | `payment_amount` |
| `oplata_kv.created_at` = to'lov kuni | `date`. `created_at` = qator yaratilgan vaqt |
| `oplata_kv.source` | yo'q. Manba: `source_tx_id` (bank), `import_batch_id` (Excel), ikkalasi NULL (qo'lda). Avto-sync: `created_by_name LIKE 'cron%'` |
| `oplata_kv.crm_status`, `branch` | `crm_contracts.virtual_status`, `branch_name` (JOIN `contract_no`). NULL = tekshirilmagan, '' = yo'q |
| `transactions.date`, `created_at` = to'lov kuni | `txn_date` (bank hujjat sanasi + vaqt). `created_at`, `synced_at` = bazaga yozilgan |
| `transactions.category`, `bank_code`, `account_no` | `category_id` → `categories.code`; `bank_id` → `banks.code`; `account_id` → `bank_accounts.account_no` |
| `transactions.is_xato` | yo'q: XATO hisoblanadi (2 ta'rif, `xato.md`). `xato_hidden` faqat yashirish |
| `crm_contracts.id`, `contract_no`, `is_found` | PK `contract_number`, `found` |
| `xonpay_transactions.updated_at`, `date` | `updated_at_local`, `date_paid` |
| `sync_logs.status = 'ERROR'` | `FAILED` yoki `PARTIAL` (login xatosi PARTIAL) |
| `sync_logs.bank_id` | `account_id`; `source` = hisob va egasi matni |
| `settings.name`, `val` | `key`, `value` (JSON matn bo'lishi mumkin) |
| `admin_users.role` = ruxsat | `role` eski enum. Ruxsat: `role_id` → `roles.permissions` |
| `shmitd_logs.target_date` sana | matn `dd.MM.yyyy`; sana filtri `target_at` |

### `external_id` formati
- Kapital: `{general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{summa_tiyin}_{+|-}`. Ipak: `IP_` prefiks. Hamkor sync: `HB_`. Hamkor vipiska: `HB_IMP_{num}_...`. Excel import: fayldagi ID. Aloqa Bank importi: `ALB_` + fayldagi ID (`source = 'ALOQA_BANK'`). Kod: `sync.service.ts::makeCompositeId`.
- Ichida `ddate` bor: bank sanani ko'chirsa ID o'zgaradi. `oplata_kv.source_tx_id` ham yangi ID'ga ko'chishi shart (`reconcile.service.ts::relinkOplataKv`), aks holda to'lov 2 marta qo'shiladi.
- `oplata_kv.id` = qator yaratilgan paytdagi `transactions.external_id` (`external_id` bo'lmasa tasodifiy UUID). Sana ko'chganda faqat `source_tx_id` va `date` yangilanadi (`sync.service.ts::upsertOne`, `reconcile.service.ts::relinkOplataKv`), `id` eskicha qoladi. Tranzaksiyaga faqat `source_tx_id` orqali bog'la, `id` orqali emas.
- `hb_dedup_key` faqat Hamkor: `xp:<uuid>` yoki `cx:<kompozit>`. Unique (`account_id`, `hb_dedup_key`). Boshqa banklarda NULL.

### `source` qiymatlari
- `transactions.source`: SYNC, IMPORT, MANUAL, ALOQA_BANK (faqat o'qish), HAMKOR_IMPORT.
- `sync_exclusion_ranges.source`: import, manual. `export_cron_logs.source`: oplatakv, transaction. `xato_correction_requests.source`: telegram, web, app.
