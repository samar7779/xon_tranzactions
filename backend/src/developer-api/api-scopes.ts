/**
 * Developer API scope'lari — bitta API kalitga qaysi resurslarni
 * o'qish ruxsati berilganini belgilaydi. Hech qanday yozish (write)
 * scope'i yo'q — hozircha faqat read-only API.
 */
export const API_SCOPES = {
  TRANSACTIONS_READ: 'transactions:read',
  OPLATA_KV_READ: 'oplatakv:read',
  ACCOUNTS_READ: 'accounts:read',
  COUNTERPARTIES_READ: 'counterparties:read',
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

export const ALL_API_SCOPES: ApiScope[] = Object.values(API_SCOPES);

export interface ApiScopeMeta {
  value: ApiScope;
  label: string;
  description: string;
}

export const API_SCOPE_CATALOG: ApiScopeMeta[] = [
  {
    value: API_SCOPES.TRANSACTIONS_READ,
    label: 'Tranzaksiyalar — o\'qish',
    description: 'Bank tranzaksiyalari ro\'yxati va tafsilotini olish. ' +
      'Filter, pagination, statistika. Bank credentials va parollar berilmaydi.',
  },
  {
    value: API_SCOPES.OPLATA_KV_READ,
    label: 'ОплатыКв — o\'qish',
    description: 'Kvartira to\'lovlari jadvalini olish (shartnoma, sana, summa, mijoz, obyekt).',
  },
  {
    value: API_SCOPES.ACCOUNTS_READ,
    label: 'Hisob raqamlar — o\'qish',
    description: 'Bank hisob raqamlari ro\'yxati: hisob raqami, bank, egasi, qoldiq. ' +
      'Login, parol va API credentials BERILMAYDI.',
  },
  {
    value: API_SCOPES.COUNTERPARTIES_READ,
    label: 'Kontragentlar — o\'qish',
    description: 'Kontragentlar (DIDOX) ro\'yxati: INN, nomi, reyting, manba.',
  },
];
