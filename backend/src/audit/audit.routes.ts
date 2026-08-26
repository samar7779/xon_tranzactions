// Marshrutdan (method + path) inson-o'qiydigan MODUL + AMAL nomini chiqaradi.
// Global audit interceptor shu yordamida har so'rovni tushunarli yozadi.

const MODULE_MAP: Record<string, string> = {
  auth: 'auth',
  users: 'users',
  roles: 'roles',
  permissions: 'roles',
  transactions: 'transactions',
  'oplata-kv': 'oplatykv',
  crm: 'crm',
  'crm-sverka': 'crm',
  sync: 'sync',
  'bank-accounts': 'banks',
  'bank-credentials': 'banks',
  chek: 'chek',
  import: 'import',
  settings: 'settings',
  'google-export': 'export',
  shmitd: 'export',
  correction: 'correction',
};

// Eng muhim marshrutlar uchun aniq o'zbekcha nomlar (kalit = "METHOD normalized/path").
const KNOWN: Record<string, string> = {
  'POST auth/login': 'Tizimga kirish',
  'POST auth/logout': 'Tizimdan chiqish',
  'POST auth/telegram': 'Telegram orqali kirish',
  'PATCH users/:id': 'Foydalanuvchi yangilandi',
  'POST users': 'Foydalanuvchi yaratildi',
  'DELETE users/:id': "Foydalanuvchi o'chirildi",
  'POST roles': 'Yangi rol yaratildi',
  'PATCH roles/:id': 'Rol yangilandi',
  'DELETE roles/:id': "Rol o'chirildi",
  'POST sync/run': 'Sync ishga tushirildi',
  'POST sync/run-all': 'Barcha hisoblar sync qilindi',
  'POST transactions/changes/check': "O'zgargan to'lovlar tekshirildi",
  'POST transactions/changes/recover': "Noto'g'ri o'chirilganlar tiklandi",
  'PATCH transactions/:id': 'Tranzaksiya tahrirlandi',
  'DELETE transactions/:id': "Tranzaksiya o'chirildi",
  'POST oplata-kv/crm-meta/backfill': "Sotuv bo'limi to'ldirildi",
  'POST oplata-kv/bulk-crm-fix': 'XATO→CRM ommaviy tuzatish',
  'POST oplata-kv/:id/assign-from-crm': 'CRM shartnoma biriktirildi',
  'POST oplata-kv/:id/split': "To'lov bo'lindi (split)",
  'POST bank-credentials': 'Bank ulanishi qo‘shildi',
  'PATCH bank-credentials/:id': 'Bank ulanishi yangilandi',
  'POST import': 'Fayl import qilindi',
};

export function describeRoute(method: string, rawUrl: string): { module: string; action: string } {
  const clean = (rawUrl || '').replace(/^\/api/, '').replace(/^\//, '');
  const segs = clean.split('/').filter(Boolean);
  const base = segs[0] || 'other';
  const module = MODULE_MAP[base] || base;

  // ID'larni :id ga normalizatsiya (cuid, uzun hex, raqam)
  const norm = clean
    .replace(/\/c[a-z0-9]{20,}/gi, '/:id')
    .replace(/\/[0-9a-f]{16,}/gi, '/:id')
    .replace(/\/\d+/g, '/:id');
  const known = KNOWN[`${method} ${norm}`];
  if (known) return { module, action: known };

  // Fallback — umumiy o'zbekcha nom
  const verb = method === 'DELETE' ? "o'chirildi" : method === 'POST' ? 'bajarildi' : 'yangilandi';
  const sub = segs.slice(1).filter((s) => s !== ':id' && !/^c[a-z0-9]{20,}$/i.test(s) && !/^\d+$/.test(s));
  const label = [base, ...sub].join(' · ');
  return { module, action: `${label} ${verb}`.trim() };
}
