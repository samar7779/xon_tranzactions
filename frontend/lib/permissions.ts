/**
 * Frontend permissions konstantalari — backend src/auth/permissions.ts bilan sinxron.
 */
export const PERMS = {
  DASHBOARD_VIEW: 'dashboard:view',
  TRANSACTIONS_VIEW: 'transactions:view',
  ACCOUNTS_VIEW: 'accounts:view',
  ACCOUNTS_MANAGE: 'accounts:manage',
  CREDENTIALS_VIEW: 'credentials:view',
  CREDENTIALS_MANAGE: 'credentials:manage',
  CREDENTIALS_TEST: 'credentials:test',
  BANKS_VIEW: 'banks:view',
  BANKS_MANAGE: 'banks:manage',
  SYNC_VIEW: 'sync:view',
  SYNC_RUN: 'sync:run',
  USERS_VIEW: 'users:view',
  USERS_MANAGE: 'users:manage',
  ROLES_VIEW: 'roles:view',
  ROLES_MANAGE: 'roles:manage',
  SYSTEM_DEPLOY: 'system:deploy',
  CUSTOMERS_VIEW: 'customers:view',
  CUSTOMERS_MANAGE: 'customers:manage',
  CONTRACTS_VIEW: 'contracts:view',
  CONTRACTS_MANAGE: 'contracts:manage',
  PAYMENTS_VIEW: 'payments:view',
  PAYMENTS_MANAGE: 'payments:manage',
  CRM_VIEW: 'crm:view',
  COUNTERPARTIES_VIEW: 'counterparties:view',
  COUNTERPARTIES_MANAGE: 'counterparties:manage',
  CATEGORIES_VIEW: 'categories:view',
  CATEGORIES_MANAGE: 'categories:manage',
  OPLATAKV_VIEW: 'oplatakv:view',
  OPLATAKV_MANAGE: 'oplatakv:manage',
} as const;

export type Permission = (typeof PERMS)[keyof typeof PERMS];
