/**
 * Frontend permissions konstantalari — backend src/auth/permissions.ts bilan sinxron.
 */
export const PERMS = {
  // Asosiy
  DASHBOARD_VIEW: 'dashboard:view',
  TRANSACTIONS_VIEW: 'transactions:view',
  TRANSACTIONS_MANUAL_EDIT: 'transactions:manual_edit',
  TRANSACTIONS_MANUAL_CONTRACT: 'transactions:manual_contract',
  TRANSACTIONS_APPLICATION: 'transactions:application',
  TRANSACTIONS_AUTO_CATEGORIZE: 'transactions:auto_categorize',
  TRANSACTIONS_EXPORT: 'transactions:export',
  TRANSACTIONS_VIPISKA_VIEW: 'transactions:vipiska_view',
  TRANSACTIONS_SVERKA_VIEW: 'transactions:sverka_view',
  TRANSACTIONS_SVERKA_FIX: 'transactions:sverka_fix',
  CHANGED_TXN_VIEW: 'changed_txn:view',
  CHANGED_TXN_CHECK: 'changed_txn:check',

  OPLATAKV_VIEW: 'oplatakv:view',
  OPLATAKV_CREATE: 'oplatakv:create',
  OPLATAKV_EDIT: 'oplatakv:edit',
  OPLATAKV_DELETE: 'oplatakv:delete',
  OPLATAKV_IMPORT: 'oplatakv:import',
  OPLATAKV_SPLIT: 'oplatakv:split',                // Split / Re-split
  OPLATAKV_SYNC: 'oplatakv:sync',                  // Hozir sync (tranzaksiyalardan)
  OPLATAKV_MANAGE: 'oplatakv:manage',              // legacy

  // Sozlash
  ACCOUNTS_VIEW: 'accounts:view',
  ACCOUNTS_MANAGE: 'accounts:manage',
  CREDENTIALS_VIEW: 'credentials:view',
  CREDENTIALS_MANAGE: 'credentials:manage',
  CREDENTIALS_TEST: 'credentials:test',
  BANKS_VIEW: 'banks:view',
  BANKS_MANAGE: 'banks:manage',

  // Tizim
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',
  ADMIN_LOGIN_VIEW: 'admin_login:view',
  COUNTERPARTIES_VIEW: 'counterparties:view',
  COUNTERPARTIES_MANAGE: 'counterparties:manage',
  SYNC_VIEW: 'sync:view',                  // Umumiy (legacy)
  SYNC_HISTORY_VIEW: 'sync:history_view',  // Tarix tab
  SYNC_SETTINGS_VIEW: 'sync:settings_view',// Sozlamalar tab — ko'rish
  SYNC_SETTINGS_EDIT: 'sync:settings_edit',// Sozlamalar saqlash
  SYNC_RUN: 'sync:run',
  API_EXPLORER_VIEW: 'api_explorer:view',
  CLEANUP_VIEW: 'cleanup:view',
  CLEANUP_RUN: 'cleanup:run',
  IMPORT_VIEW: 'import:view',
  IMPORT_RUN: 'import:run',
  SYSTEM_DEPLOY: 'system:deploy',

  // Developer API
  API_KEYS_VIEW: 'api_keys:view',
  API_KEYS_MANAGE: 'api_keys:manage',

  // Chek (alohida sahifa, 3 ta tab)
  CHEK_BAZA: 'chek:baza',
  CHEK_TARIX: 'chek:tarix',
  CHEK_SOZLAMALAR: 'chek:sozlamalar',

  // Qo'shimcha
  CRM_VIEW: 'crm:view',
  CATEGORIES_VIEW: 'categories:view',
  CATEGORIES_MANAGE: 'categories:manage',
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  CONTRACTS_VIEW: 'contracts:view',
  CONTRACTS_MANAGE: 'contracts:manage',
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_MANAGE: 'payments:manage',
} as const;

export type Permission = (typeof PERMS)[keyof typeof PERMS];
