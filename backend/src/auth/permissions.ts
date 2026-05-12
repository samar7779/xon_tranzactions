/**
 * Tizim ichidagi barcha ruxsatlar (permissions).
 * Har bir endpoint o'ziga kerakli permission'ni `@RequirePermissions(...)`
 * dekoratori orqali talab qiladi.
 */
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard:view',

  // Tranzaksiyalar
  TRANSACTIONS_VIEW: 'transactions:view',

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

  // Sync
  SYNC_VIEW: 'sync:view',
  SYNC_RUN: 'sync:run',

  // Foydalanuvchilar
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',

  // Rollar
  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',

  // Tizim
  SYSTEM_DEPLOY: 'system:deploy',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/**
 * UI'da guruh bo'yicha ko'rsatish uchun
 */
export const PERMISSION_GROUPS: { group: string; items: { value: Permission; label: string }[] }[] = [
  {
    group: 'Dashboard',
    items: [{ value: PERMISSIONS.DASHBOARD_VIEW, label: 'Bosh sahifani ko\'rish' }],
  },
  {
    group: 'Tranzaksiyalar',
    items: [{ value: PERMISSIONS.TRANSACTIONS_VIEW, label: 'Ro\'yxat va statistikani ko\'rish' }],
  },
  {
    group: 'Hisoblar',
    items: [
      { value: PERMISSIONS.ACCOUNTS_VIEW, label: 'Hisoblarni ko\'rish' },
      { value: PERMISSIONS.ACCOUNTS_MANAGE, label: 'Hisoblarni qo\'shish/o\'chirish' },
    ],
  },
  {
    group: 'Bank ulanishlari',
    items: [
      { value: PERMISSIONS.CREDENTIALS_VIEW, label: 'Ulanishlarni ko\'rish' },
      { value: PERMISSIONS.CREDENTIALS_MANAGE, label: 'Ulanish qo\'shish/o\'chirish' },
      { value: PERMISSIONS.CREDENTIALS_TEST, label: 'Bankka ulanishni tekshirish' },
    ],
  },
  {
    group: 'Banklar',
    items: [
      { value: PERMISSIONS.BANKS_VIEW, label: 'Banklarni ko\'rish' },
      { value: PERMISSIONS.BANKS_MANAGE, label: 'Banklarni boshqarish' },
    ],
  },
  {
    group: 'Sync',
    items: [
      { value: PERMISSIONS.SYNC_VIEW, label: 'Sync log ko\'rish' },
      { value: PERMISSIONS.SYNC_RUN, label: 'Manual sync ishga tushirish' },
    ],
  },
  {
    group: 'Foydalanuvchilar',
    items: [
      { value: PERMISSIONS.USERS_VIEW, label: 'Foydalanuvchilarni ko\'rish' },
      { value: PERMISSIONS.USERS_MANAGE, label: 'Foydalanuvchilarni boshqarish' },
    ],
  },
  {
    group: 'Rollar',
    items: [
      { value: PERMISSIONS.ROLES_VIEW, label: 'Rollarni ko\'rish' },
      { value: PERMISSIONS.ROLES_MANAGE, label: 'Rollarni yaratish/o\'zgartirish' },
    ],
  },
  {
    group: 'Tizim',
    items: [{ value: PERMISSIONS.SYSTEM_DEPLOY, label: 'Deploy log ko\'rish' }],
  },
];

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
    description: 'Bank ulanishlari va hisoblarni boshqaradi, foydalanuvchilarga tegmaydi',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.TRANSACTIONS_VIEW,
      PERMISSIONS.ACCOUNTS_VIEW, PERMISSIONS.ACCOUNTS_MANAGE,
      PERMISSIONS.CREDENTIALS_VIEW, PERMISSIONS.CREDENTIALS_MANAGE, PERMISSIONS.CREDENTIALS_TEST,
      PERMISSIONS.BANKS_VIEW, PERMISSIONS.BANKS_MANAGE,
      PERMISSIONS.SYNC_VIEW, PERMISSIONS.SYNC_RUN,
    ],
  },
  {
    name: 'VIEWER',
    label: 'Kuzatuvchi',
    description: 'Faqat o\'qish — tranzaksiyalar va statistikani ko\'radi',
    permissions: [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.TRANSACTIONS_VIEW,
      PERMISSIONS.ACCOUNTS_VIEW,
      PERMISSIONS.CREDENTIALS_VIEW,
      PERMISSIONS.BANKS_VIEW,
      PERMISSIONS.SYNC_VIEW,
    ],
  },
];
