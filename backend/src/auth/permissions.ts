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
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',

  // Tranzaksiyalar — Tranzaksiyalar tab
  TRANSACTIONS_VIEW: 'transactions:view',
  TRANSACTIONS_MANUAL_EDIT: 'transactions:manual_edit',         // Qo'lda tahrirlash tugmasi
  TRANSACTIONS_MANUAL_CONTRACT: 'transactions:manual_contract', // Qo'lda shartnoma
  TRANSACTIONS_APPLICATION: 'transactions:application',         // Ariza
  TRANSACTIONS_AUTO_CATEGORIZE: 'transactions:auto_categorize', // Avto-kategoriyalash

  // Tranzaksiyalar — Vipiska tab
  TRANSACTIONS_VIPISKA_VIEW: 'transactions:vipiska_view',

  // Tranzaksiyalar — Sverka tab
  TRANSACTIONS_SVERKA_VIEW: 'transactions:sverka_view',
  TRANSACTIONS_SVERKA_FIX: 'transactions:sverka_fix',           // Sana tuzatish, fix-missing

  // ОплатыКв
  OPLATAKV_VIEW: 'oplatakv:view',
  OPLATAKV_CREATE: 'oplatakv:create',                           // Yangi qator qo'shish
  OPLATAKV_EDIT: 'oplatakv:edit',                               // Qator tahrirlash
  OPLATAKV_DELETE: 'oplatakv:delete',                           // O'chirish
  OPLATAKV_IMPORT: 'oplatakv:import',                           // Excel import
  OPLATAKV_MANAGE: 'oplatakv:manage',                           // Legacy (deprecated) — orqaga moslik

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

  // Sync
  SYNC_VIEW: 'sync:view',
  SYNC_RUN: 'sync:run',

  // API Explorer
  API_EXPLORER_VIEW: 'api_explorer:view',

  // Tozalash
  CLEANUP_VIEW: 'cleanup:view',
  CLEANUP_RUN: 'cleanup:run',

  // Import (admin import)
  IMPORT_VIEW: 'import:view',
  IMPORT_RUN: 'import:run',

  // Tizim — deploy
  SYSTEM_DEPLOY: 'system:deploy',

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
        items: [{ value: PERMISSIONS.DASHBOARD_VIEW, label: 'Bosh sahifani ko\'rish' }],
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
          { value: PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW, label: 'Vipiska sahifasi' },
          { value: PERMISSIONS.TRANSACTIONS_SVERKA_VIEW, label: 'Sverka sahifasi' },
          { value: PERMISSIONS.TRANSACTIONS_SVERKA_FIX, label: 'Sverka\'da sana/yozuv tuzatish' },
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
        items: [
          { value: PERMISSIONS.SYNC_VIEW, label: 'Sync log ko\'rish' },
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
        name: 'Tizim',
        items: [
          { value: PERMISSIONS.SYSTEM_DEPLOY, label: 'Deploy log ko\'rish' },
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
  {
    name: 'ADMIN',
    label: 'Administrator',
    description: 'Mijozlar, shartnomalar, bank ulanishlari — hammasini boshqaradi',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.TRANSACTIONS_VIEW,
      PERMISSIONS.TRANSACTIONS_MANUAL_EDIT,
      PERMISSIONS.TRANSACTIONS_MANUAL_CONTRACT,
      PERMISSIONS.TRANSACTIONS_APPLICATION,
      PERMISSIONS.TRANSACTIONS_AUTO_CATEGORIZE,
      PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW,
      PERMISSIONS.TRANSACTIONS_SVERKA_VIEW,
      PERMISSIONS.TRANSACTIONS_SVERKA_FIX,
      PERMISSIONS.ACCOUNTS_VIEW, PERMISSIONS.ACCOUNTS_MANAGE,
      PERMISSIONS.CREDENTIALS_VIEW, PERMISSIONS.CREDENTIALS_MANAGE, PERMISSIONS.CREDENTIALS_TEST,
      PERMISSIONS.BANKS_VIEW, PERMISSIONS.BANKS_MANAGE,
      PERMISSIONS.SYNC_VIEW, PERMISSIONS.SYNC_RUN,
      PERMISSIONS.ADMIN_LOGIN_VIEW,
      PERMISSIONS.API_EXPLORER_VIEW,
      PERMISSIONS.CLEANUP_VIEW, PERMISSIONS.CLEANUP_RUN,
      PERMISSIONS.IMPORT_VIEW, PERMISSIONS.IMPORT_RUN,
      PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_MANAGE,
      PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.CONTRACTS_MANAGE,
      PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE,
      PERMISSIONS.CRM_VIEW,
      PERMISSIONS.COUNTERPARTIES_VIEW, PERMISSIONS.COUNTERPARTIES_MANAGE,
      PERMISSIONS.CATEGORIES_VIEW, PERMISSIONS.CATEGORIES_MANAGE,
      PERMISSIONS.OPLATAKV_VIEW,
      PERMISSIONS.OPLATAKV_CREATE,
      PERMISSIONS.OPLATAKV_EDIT,
      PERMISSIONS.OPLATAKV_DELETE,
      PERMISSIONS.OPLATAKV_IMPORT,
      PERMISSIONS.OPLATAKV_MANAGE, // legacy
    ],
  },
  {
    name: 'ACCOUNTANT',
    label: 'Hisobchi',
    description: 'Mijozlar, shartnomalar va to\'lovlarni boshqaradi, banklarga tegmaydi',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.TRANSACTIONS_VIEW,
      PERMISSIONS.TRANSACTIONS_MANUAL_EDIT,
      PERMISSIONS.TRANSACTIONS_MANUAL_CONTRACT,
      PERMISSIONS.TRANSACTIONS_APPLICATION,
      PERMISSIONS.TRANSACTIONS_AUTO_CATEGORIZE,
      PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW,
      PERMISSIONS.TRANSACTIONS_SVERKA_VIEW,
      PERMISSIONS.ACCOUNTS_VIEW,
      PERMISSIONS.SYNC_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW, PERMISSIONS.CUSTOMERS_MANAGE,
      PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.CONTRACTS_MANAGE,
      PERMISSIONS.PAYMENTS_VIEW, PERMISSIONS.PAYMENTS_MANAGE,
      PERMISSIONS.CRM_VIEW,
      PERMISSIONS.COUNTERPARTIES_VIEW, PERMISSIONS.COUNTERPARTIES_MANAGE,
      PERMISSIONS.CATEGORIES_VIEW, PERMISSIONS.CATEGORIES_MANAGE,
      PERMISSIONS.OPLATAKV_VIEW,
      PERMISSIONS.OPLATAKV_CREATE,
      PERMISSIONS.OPLATAKV_EDIT,
      PERMISSIONS.OPLATAKV_IMPORT,
      PERMISSIONS.OPLATAKV_MANAGE, // legacy
    ],
  },
  {
    name: 'VIEWER',
    label: 'Kuzatuvchi',
    description: 'Faqat o\'qish — mijozlar, shartnomalar, tranzaksiyalarni ko\'radi',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.TRANSACTIONS_VIEW,
      PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW,
      PERMISSIONS.TRANSACTIONS_SVERKA_VIEW,
      PERMISSIONS.ACCOUNTS_VIEW,
      PERMISSIONS.CREDENTIALS_VIEW,
      PERMISSIONS.BANKS_VIEW,
      PERMISSIONS.SYNC_VIEW,
      PERMISSIONS.CUSTOMERS_VIEW,
      PERMISSIONS.CONTRACTS_VIEW,
      PERMISSIONS.PAYMENTS_VIEW,
      PERMISSIONS.CRM_VIEW,
      PERMISSIONS.COUNTERPARTIES_VIEW,
      PERMISSIONS.CATEGORIES_VIEW,
      PERMISSIONS.OPLATAKV_VIEW,
    ],
  },
];
