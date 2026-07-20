/**
 * Tizim ichidagi barcha ruxsatlar (permissions).
 * Har bir endpoint o'ziga kerakli permission'ni `@RequirePermissions(...)`
 * dekoratori orqali talab qiladi.
 *
 * Ierarxik tuzilish: modul → sahifa → action.
 * UI'da PERMISSION_TREE orqali collapsible ko'rinishda ko'rsatiladi.
 */
export const PERMISSIONS = {
  // ─── ASOSIY ───
  // Dashboard (Bosh sahifa) — har bo'lim/karta alohida gate
  DASHBOARD_VIEW: 'dashboard:view',                         // Sahifani ochish
  DASHBOARD_KPI_BALANCE: 'dashboard:kpi_balance',           // Yuqori karta: Jami qoldiq
  DASHBOARD_KPI_ACCOUNTS: 'dashboard:kpi_accounts',         // Yuqori karta: Hisoblar soni
  DASHBOARD_KPI_BANKS: 'dashboard:kpi_banks',               // Yuqori karta: Banklar soni
  DASHBOARD_KPI_INFLOW: 'dashboard:kpi_inflow',             // Yuqori karta: Kirim (30 kun)
  DASHBOARD_KPI_OUTFLOW: 'dashboard:kpi_outflow',           // Yuqori karta: Chiqim (30 kun)
  DASHBOARD_KPI_TXN: 'dashboard:kpi_txn',                   // Yuqori karta: Tranzaksiya (30 kun)
  DASHBOARD_OBJECTS: 'dashboard:objects',                   // Obyektlar bo'yicha to'lovlar
  DASHBOARD_DAILY: 'dashboard:daily',                       // Kunma-kun kirim/chiqim grafik
  DASHBOARD_DAILY_BAR: 'dashboard:daily_bar',               // Kunma-kun ustunli grafik
  DASHBOARD_CLIENT: 'dashboard:client',                     // Klient to'lovlari grafik
  DASHBOARD_XONPAY: 'dashboard:xonpay',                     // Kutilayotgan to'lovlar (XonPay)
  DASHBOARD_TOP_ACCOUNTS: 'dashboard:top_accounts',         // Eng katta hisoblar
  DASHBOARD_SYNC_STATUS: 'dashboard:sync_status',           // Sync holati
  DASHBOARD_BANKS_BREAKDOWN: 'dashboard:banks_breakdown',   // Banklar bo'yicha taqsimot
  DASHBOARD_NET_FLOW: 'dashboard:net_flow',                 // Sof pul oqimi (30 kun)

  // Tranzaksiyalar — Tranzaksiyalar tab
  TRANSACTIONS_VIEW: 'transactions:view',
  TRANSACTIONS_MANUAL_EDIT: 'transactions:manual_edit',         // Qo'lda tahrirlash tugmasi
  TRANSACTIONS_MANUAL_CONTRACT: 'transactions:manual_contract', // Qo'lda shartnoma
  TRANSACTIONS_APPLICATION: 'transactions:application',         // Ariza
  TRANSACTIONS_AUTO_CATEGORIZE: 'transactions:auto_categorize', // Avto-kategoriyalash
  TRANSACTIONS_EXPORT: 'transactions:export',                   // Excel / CSV / PDF eksport tugmasi

  // Tranzaksiyalar — Vipiska tab
  TRANSACTIONS_VIPISKA_VIEW: 'transactions:vipiska_view',

  // Tranzaksiyalar — Sverka tab
  TRANSACTIONS_SVERKA_VIEW: 'transactions:sverka_view',
  TRANSACTIONS_SVERKA_FIX: 'transactions:sverka_fix',           // Sana tuzatish, fix-missing

  // Tranzaksiyalar — O'zgargan to'lovlar tab (bank tomonida o'chirilgan/o'zgartirilganlar)
  CHANGED_TXN_VIEW: 'changed_txn:view',                         // Sahifani ochish + ro'yxat
  CHANGED_TXN_CHECK: 'changed_txn:check',                       // Qo'lda re-verify ishga tushirish

  // ОплатыКв
  OPLATAKV_VIEW: 'oplatakv:view',
  OPLATAKV_CREATE: 'oplatakv:create',                           // Yangi qator qo'shish
  OPLATAKV_EDIT: 'oplatakv:edit',                               // Qator tahrirlash
  OPLATAKV_DELETE: 'oplatakv:delete',                           // O'chirish
  OPLATAKV_IMPORT: 'oplatakv:import',                           // Excel import
  OPLATAKV_SPLIT: 'oplatakv:split',                             // Split / Re-split (1-vznos vs oylik)
  OPLATAKV_SYNC: 'oplatakv:sync',                               // Hozir sync — tranzaksiyalardan majburiy import
  OPLATAKV_MANAGE: 'oplatakv:manage',                           // Legacy (deprecated) — orqaga moslik

  // Plan bo'yicha to'lov (CRM to'lov jadvali — dashboard widget)
  SCHEDULE_VIEW: 'schedule:view',                               // "Plan bo'yicha to'lov" widgetini ko'rish
  SCHEDULE_SYNC: 'schedule:sync',                               // To'lov jadvalini CRM'dan sync qilish

  // ─── SOZLASH ───
  // Bank hisoblari
  ACCOUNTS_VIEW: 'accounts:view',
  ACCOUNTS_MANAGE: 'accounts:manage',

  // Bank ulanishlari
  CREDENTIALS_VIEW: 'credentials:view',
  CREDENTIALS_MANAGE: 'credentials:manage',
  CREDENTIALS_TEST: 'credentials:test',

  // Banklar
  BANKS_VIEW: 'banks:view',
  BANKS_MANAGE: 'banks:manage',

  // ─── TIZIM (Admin paneli) ───
  // Foydalanuvchilar
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',

  // Rollar
  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',

  // Login muammolari (auth-issues)
  ADMIN_LOGIN_VIEW: 'admin_login:view',

  // Kontragentlar (DIDOX)
  COUNTERPARTIES_VIEW: 'counterparties:view',
  COUNTERPARTIES_MANAGE: 'counterparties:manage',

  // Sync (sahifa ichidagi tablar uchun granular)
  SYNC_VIEW: 'sync:view',                 // Umumiy ko'rish (legacy — ikkala tab'ni beradi)
  SYNC_HISTORY_VIEW: 'sync:history_view', // Tarix tab
  SYNC_SETTINGS_VIEW: 'sync:settings_view', // Sozlamalar tab — ko'rish
  SYNC_SETTINGS_EDIT: 'sync:settings_edit', // Sozlamalarni saqlash
  SYNC_RUN: 'sync:run',                   // Manual sync ishga tushirish

  // API Explorer
  API_EXPLORER_VIEW: 'api_explorer:view',

  // Tozalash
  CLEANUP_VIEW: 'cleanup:view',
  CLEANUP_RUN: 'cleanup:run',

  // Import (admin import)
  IMPORT_VIEW: 'import:view',
  IMPORT_RUN: 'import:run',

  // Export (ОплатыКв → Google Sheets + fayl yuklab olish)
  EXPORT_VIEW: 'export:view',        // Export bo'limini ko'rish (tab ko'rinishi)
  EXPORT_RUN: 'export:run',          // Eksportni ishga tushirish (Bajarish tugmasi)
  EXPORT_MANAGE: 'export:manage',    // Config (sheet ID, mapping, filtr) tahrirlash
  EXPORT_DOWNLOAD: 'export:download',// Ma'lumotni fayl (JSON/SQL/Excel...) sifatida yuklab olish
  EXPORT_AUTSOURCING: 'export:autsourcing', // Autsoursing sub-tab — shartnomalar Excel'ini Telegram guruhga

  // Tizim — deploy
  SYSTEM_DEPLOY: 'system:deploy',

  // Developer API (tashqi tizim integratsiyasi uchun API kalitlar)
  API_KEYS_VIEW: 'api_keys:view',                                // Kalitlar ro'yxati + loglar
  API_KEYS_MANAGE: 'api_keys:manage',                            // Yaratish, tahrirlash, o'chirish

  // ─── CHEK (alohida sahifa, 3 ta tab) ───
  CHEK_BAZA: 'chek:baza',           // Baza tab — ma'lumot qo'shish
  CHEK_TARIX: 'chek:tarix',         // Tarix tab — ko'rish + tahrirlash
  CHEK_SOZLAMALAR: 'chek:sozlamalar', // Sozlamalar tab

  // ─── QO'SHIMCHA ───
  // CRM
  CRM_VIEW: 'crm:view',

  // Kategoriyalar
  CATEGORIES_VIEW: 'categories:view',
  CATEGORIES_MANAGE: 'categories:manage',

  // Billing (Mijozlar, Shartnomalar, To'lovlar)
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  CONTRACTS_VIEW: 'contracts:view',
  CONTRACTS_MANAGE: 'contracts:manage',
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_MANAGE: 'payments:manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/**
 * UI uchun ierarxik tuzilish — modul → pages → items.
 * Rollar sahifasi shu daraxtga asoslanib collapsible UI ko'rsatadi.
 */
export interface PermItem { value: Permission; label: string; }
export interface PermPage { name: string; description?: string; items: PermItem[]; }
export interface PermModule { module: string; icon?: string; pages: PermPage[]; }

export const PERMISSION_TREE: PermModule[] = [
  {
    module: 'Asosiy',
    icon: 'home',
    pages: [
      {
        name: 'Bosh sahifa',
        description: 'Dashboard — har bo\'lim/karta alohida (ruxsat bo\'lmasa ko\'rinmaydi)',
        items: [
          { value: PERMISSIONS.DASHBOARD_VIEW, label: 'Bosh sahifani ochish' },
          { value: PERMISSIONS.DASHBOARD_KPI_BALANCE, label: 'Karta: Jami qoldiq' },
          { value: PERMISSIONS.DASHBOARD_KPI_ACCOUNTS, label: 'Karta: Hisoblar soni' },
          { value: PERMISSIONS.DASHBOARD_KPI_BANKS, label: 'Karta: Banklar soni' },
          { value: PERMISSIONS.DASHBOARD_KPI_INFLOW, label: 'Karta: Kirim (30 kun)' },
          { value: PERMISSIONS.DASHBOARD_KPI_OUTFLOW, label: 'Karta: Chiqim (30 kun)' },
          { value: PERMISSIONS.DASHBOARD_KPI_TXN, label: 'Karta: Tranzaksiya (30 kun)' },
          { value: PERMISSIONS.DASHBOARD_OBJECTS, label: 'Obyektlar bo\'yicha to\'lovlar' },
          { value: PERMISSIONS.DASHBOARD_DAILY, label: 'Kunma-kun kirim/chiqim (grafik)' },
          { value: PERMISSIONS.DASHBOARD_DAILY_BAR, label: 'Kunma-kun ustunli grafik' },
          { value: PERMISSIONS.DASHBOARD_CLIENT, label: 'Klient to\'lovlari' },
          { value: PERMISSIONS.DASHBOARD_XONPAY, label: 'Kutilayotgan to\'lovlar (XonPay debitor)' },
          { value: PERMISSIONS.DASHBOARD_TOP_ACCOUNTS, label: 'Eng katta hisoblar' },
          { value: PERMISSIONS.DASHBOARD_SYNC_STATUS, label: 'Sync holati' },
          { value: PERMISSIONS.DASHBOARD_BANKS_BREAKDOWN, label: 'Banklar bo\'yicha taqsimot' },
          { value: PERMISSIONS.DASHBOARD_NET_FLOW, label: 'Sof pul oqimi (30 kun)' },
        ],
      },
      {
        name: 'Tranzaksiyalar',
        description: 'Tranzaksiyalar bo\'limi (3 ta tab)',
        items: [
          { value: PERMISSIONS.TRANSACTIONS_VIEW, label: 'Tranzaksiyalar ro\'yxatini ko\'rish' },
          { value: PERMISSIONS.TRANSACTIONS_MANUAL_EDIT, label: 'Qo\'lda tahrirlash tugmasi' },
          { value: PERMISSIONS.TRANSACTIONS_MANUAL_CONTRACT, label: 'Qo\'lda shartnoma tugmasi' },
          { value: PERMISSIONS.TRANSACTIONS_APPLICATION, label: 'Ariza tugmasi' },
          { value: PERMISSIONS.TRANSACTIONS_AUTO_CATEGORIZE, label: 'Avto-kategoriyalash' },
          { value: PERMISSIONS.TRANSACTIONS_EXPORT, label: 'Eksport tugmasi (Excel / CSV / PDF)' },
          { value: PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW, label: 'Vipiska sahifasi' },
          { value: PERMISSIONS.TRANSACTIONS_SVERKA_VIEW, label: 'Sverka sahifasi' },
          { value: PERMISSIONS.TRANSACTIONS_SVERKA_FIX, label: 'Sverka\'da sana/yozuv tuzatish' },
          { value: PERMISSIONS.CHANGED_TXN_VIEW, label: 'O\'zgargan to\'lovlar tab — ko\'rish' },
          { value: PERMISSIONS.CHANGED_TXN_CHECK, label: 'O\'zgargan to\'lovlar — qo\'lda tekshirish (sana oralig\'i)' },
        ],
      },
      {
        name: 'ОплатыКв',
        description: 'Kvartira to\'lovlari',
        items: [
          { value: PERMISSIONS.OPLATAKV_VIEW, label: 'Jadvalni ko\'rish' },
          { value: PERMISSIONS.OPLATAKV_CREATE, label: 'Yangi qator qo\'shish' },
          { value: PERMISSIONS.OPLATAKV_EDIT, label: 'Qatorni tahrirlash' },
          { value: PERMISSIONS.OPLATAKV_DELETE, label: 'O\'chirish' },
          { value: PERMISSIONS.OPLATAKV_IMPORT, label: 'Excel\'dan import' },
          { value: PERMISSIONS.OPLATAKV_SPLIT, label: 'Split / Re-split (1-vznos vs oylik)' },
          { value: PERMISSIONS.OPLATAKV_SYNC, label: 'Hozir sync (tranzaksiyalardan)' },
          { value: PERMISSIONS.SCHEDULE_VIEW, label: 'Plan bo\'yicha to\'lov (dashboard widget)' },
          { value: PERMISSIONS.SCHEDULE_SYNC, label: 'To\'lov jadvalini CRM\'dan sync qilish' },
        ],
      },
    ],
  },
  {
    module: 'Sozlash',
    icon: 'settings',
    pages: [
      {
        name: 'Banklar',
        items: [
          { value: PERMISSIONS.BANKS_VIEW, label: 'Banklarni ko\'rish' },
          { value: PERMISSIONS.BANKS_MANAGE, label: 'Banklarni boshqarish' },
        ],
      },
      {
        name: 'Hisoblar',
        items: [
          { value: PERMISSIONS.ACCOUNTS_VIEW, label: 'Hisoblarni ko\'rish' },
          { value: PERMISSIONS.ACCOUNTS_MANAGE, label: 'Hisob qo\'shish/o\'chirish' },
        ],
      },
      {
        name: 'Bank ulanishlari',
        items: [
          { value: PERMISSIONS.CREDENTIALS_VIEW, label: 'Ulanishlarni ko\'rish' },
          { value: PERMISSIONS.CREDENTIALS_MANAGE, label: 'Ulanish qo\'shish/o\'chirish' },
          { value: PERMISSIONS.CREDENTIALS_TEST, label: 'Bankka ulanishni tekshirish' },
        ],
      },
    ],
  },
  {
    module: 'Tizim (Admin paneli)',
    icon: 'shield',
    pages: [
      {
        name: 'Adminlar',
        items: [
          { value: PERMISSIONS.USERS_VIEW, label: 'Foydalanuvchilarni ko\'rish' },
          { value: PERMISSIONS.USERS_MANAGE, label: 'Foydalanuvchilarni boshqarish' },
        ],
      },
      {
        name: 'Rollar',
        items: [
          { value: PERMISSIONS.ROLES_VIEW, label: 'Rollarni ko\'rish' },
          { value: PERMISSIONS.ROLES_MANAGE, label: 'Rollarni yaratish/o\'zgartirish' },
        ],
      },
      {
        name: 'Login muammolari',
        items: [
          { value: PERMISSIONS.ADMIN_LOGIN_VIEW, label: 'Bank parol xato sahifani ko\'rish' },
        ],
      },
      {
        name: 'Kontragentlar (DIDOX)',
        items: [
          { value: PERMISSIONS.COUNTERPARTIES_VIEW, label: 'Kontragent ro\'yxatini ko\'rish' },
          { value: PERMISSIONS.COUNTERPARTIES_MANAGE, label: 'Kontragent qo\'shish/yangilash' },
        ],
      },
      {
        name: 'Sync tarixi',
        description: 'Sync sahifasi (2 ta tab: Tarix + Sozlamalar)',
        items: [
          { value: PERMISSIONS.SYNC_VIEW, label: 'Umumiy ko\'rish (ikkala tab)' },
          { value: PERMISSIONS.SYNC_HISTORY_VIEW, label: 'Tarix tab' },
          { value: PERMISSIONS.SYNC_SETTINGS_VIEW, label: 'Sozlamalar tab — ko\'rish' },
          { value: PERMISSIONS.SYNC_SETTINGS_EDIT, label: 'Sozlamalarni saqlash' },
          { value: PERMISSIONS.SYNC_RUN, label: 'Manual sync ishga tushirish' },
        ],
      },
      {
        name: 'API Explorer',
        items: [
          { value: PERMISSIONS.API_EXPLORER_VIEW, label: 'API Explorer sahifasi' },
        ],
      },
      {
        name: 'Tozalash',
        items: [
          { value: PERMISSIONS.CLEANUP_VIEW, label: 'Tozalash sahifasini ko\'rish' },
          { value: PERMISSIONS.CLEANUP_RUN, label: 'Tozalash ishlatish' },
        ],
      },
      {
        name: 'Import',
        items: [
          { value: PERMISSIONS.IMPORT_VIEW, label: 'Import sahifasini ko\'rish' },
          { value: PERMISSIONS.IMPORT_RUN, label: 'Import ishlatish' },
        ],
      },
      {
        name: 'Export (Google Sheets)',
        description: 'ОплатыКв ma\'lumotini Google Sheets\'ga eksport',
        items: [
          { value: PERMISSIONS.EXPORT_VIEW, label: 'Export bo\'limini ko\'rish' },
          { value: PERMISSIONS.EXPORT_RUN, label: 'Eksportni ishga tushirish (Bajarish)' },
          { value: PERMISSIONS.EXPORT_MANAGE, label: 'Sozlamalarni (sheet ID, mapping) tahrirlash' },
          { value: PERMISSIONS.EXPORT_DOWNLOAD, label: 'Ma\'lumotni fayl (JSON/SQL/Excel...) yuklab olish' },
          { value: PERMISSIONS.EXPORT_AUTSOURCING, label: 'Autsoursing — shartnomalar Excel\'ini Telegram guruhga' },
        ],
      },
      {
        name: 'Tizim',
        items: [
          { value: PERMISSIONS.SYSTEM_DEPLOY, label: 'Deploy log ko\'rish' },
        ],
      },
      {
        name: 'Developer API',
        description: 'Tashqi tizim integratsiyasi uchun API kalitlar',
        items: [
          { value: PERMISSIONS.API_KEYS_VIEW, label: 'API kalitlar va loglarni ko\'rish' },
          { value: PERMISSIONS.API_KEYS_MANAGE, label: 'API kalit yaratish / tahrirlash / o\'chirish' },
        ],
      },
    ],
  },
  {
    module: 'Chek',
    icon: 'check',
    pages: [
      {
        name: 'Chek — Shartnoma nazorati',
        description: 'Alohida sahifa (/chek) — 3 ta tab: Baza, Tarix, Sozlamalar',
        items: [
          { value: PERMISSIONS.CHEK_BAZA, label: 'Baza tab — ma\'lumot qo\'shish (CRM lookup + forma)' },
          { value: PERMISSIONS.CHEK_TARIX, label: 'Tarix tab — ro\'yxatni ko\'rish va tahrirlash' },
          { value: PERMISSIONS.CHEK_SOZLAMALAR, label: 'Sozlamalar tab' },
        ],
      },
    ],
  },
  {
    module: 'Qo\'shimcha',
    icon: 'plus',
    pages: [
      {
        name: 'CRM (XonSaroy)',
        items: [
          { value: PERMISSIONS.CRM_VIEW, label: 'CRM\'dan shartnoma qidirish' },
        ],
      },
      {
        name: 'Kategoriyalar',
        items: [
          { value: PERMISSIONS.CATEGORIES_VIEW, label: 'Kategoriyalarni ko\'rish' },
          { value: PERMISSIONS.CATEGORIES_MANAGE, label: 'Tranzaksiya kategoriyasini o\'zgartirish' },
        ],
      },
      {
        name: 'Mijozlar (Billing)',
        items: [
          { value: PERMISSIONS.CUSTOMERS_VIEW, label: 'Mijozlarni ko\'rish' },
          { value: PERMISSIONS.CUSTOMERS_MANAGE, label: 'Mijoz qo\'shish/o\'zgartirish' },
        ],
      },
      {
        name: 'Shartnomalar (Billing)',
        items: [
          { value: PERMISSIONS.CONTRACTS_VIEW, label: 'Shartnomalarni ko\'rish' },
          { value: PERMISSIONS.CONTRACTS_MANAGE, label: 'Shartnoma qo\'shish/o\'zgartirish' },
        ],
      },
      {
        name: 'To\'lovlar (Billing)',
        items: [
          { value: PERMISSIONS.PAYMENTS_VIEW, label: 'To\'lovlarni ko\'rish' },
          { value: PERMISSIONS.PAYMENTS_MANAGE, label: 'To\'lovni qo\'lda bosqichga biriktirish' },
        ],
      },
    ],
  },
];

/** Eski PERMISSION_GROUPS — backward compat (boshqa joyda hali ham ishlatiladi). */
export const PERMISSION_GROUPS: { group: string; items: { value: Permission; label: string }[] }[] =
  PERMISSION_TREE.flatMap((m) =>
    m.pages.map((p) => ({ group: p.name, items: p.items })),
  );

/**
 * Tizim default rollari (seed paytida yaratiladi)
 */
export const SYSTEM_ROLES = [
  {
    name: 'SUPERADMIN',
    label: 'Bosh administrator',
    description: 'Barcha ruxsatlarga ega — rollarni boshqarishi mumkin',
    permissions: ALL_PERMISSIONS,
  },
  // Eslatma: ADMIN / ACCOUNTANT / VIEWER default rollari olib tashlandi.
  // Faqat SUPERADMIN bootstrap roli tizim tomonidan yaratiladi; qolgan
  // barcha rollar admin tomonidan qo'lda (CUSTOM) yaratiladi.
];
