import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Tizimdagi BARCHA ruxsatlar ro'yxati (src/auth/permissions.ts bilan sinxron).
// Yangi permission qo'shilsa — shu yerga ham qo'shing.
const ALL_PERMS = [
  'dashboard:view',
  'transactions:view',
  'accounts:view', 'accounts:manage',
  'credentials:view', 'credentials:manage', 'credentials:test',
  'banks:view', 'banks:manage',
  'sync:view', 'sync:run',
  'users:view', 'users:manage',
  'roles:view', 'roles:manage',
  'system:deploy',
  'customers:view', 'customers:manage',
  'contracts:view', 'contracts:manage',
  'payments:view', 'payments:manage',
  'crm:view',
  'counterparties:view', 'counterparties:manage',
  'categories:view', 'categories:manage',
];

async function main() {
  // 1. Bootstrap roli — birinchi admin tizimga kira olishi uchun shart.
  //    Boshqa rollar admin panel orqali qo'lda yaratiladi.
  //    Bu rolning ruxsatlari ham UI orqali tahrirlanishi mumkin.
  const superExisting = await prisma.role.findUnique({ where: { name: 'SUPERADMIN' } });
  if (!superExisting) {
    await prisma.role.create({
      data: {
        name: 'SUPERADMIN',
        label: 'Bosh administrator',
        description: 'Barcha ruxsatlarga ega — birinchi admin uchun bootstrap roli',
        permissions: ALL_PERMS,
        isSystem: true,
      },
    });
    console.log('✓ Bootstrap roli (SUPERADMIN) yaratildi');
  } else {
    // Mavjud SUPERADMIN'ga yangi tizim permissionlarini qo'shamiz (eski ruxsatlar saqlanadi).
    const have = new Set(superExisting.permissions || []);
    const missing = ALL_PERMS.filter((p) => !have.has(p));
    if (missing.length > 0) {
      await prisma.role.update({
        where: { id: superExisting.id },
        data: { permissions: [...(superExisting.permissions || []), ...missing] },
      });
      console.log(`✓ SUPERADMIN ga yangi ruxsatlar qo'shildi: ${missing.join(', ')}`);
    } else {
      console.log('✓ SUPERADMIN ruxsatlari to\'liq');
    }
  }

  // 2. Birinchi admin (SUPERADMIN role bilan)
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@xon.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026';
  const fullName = process.env.SEED_ADMIN_NAME || 'Bosh Admin';
  const superRole = await prisma.role.findUnique({ where: { name: 'SUPERADMIN' } });

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    if (!existing.roleId && superRole) {
      await prisma.adminUser.update({
        where: { id: existing.id },
        data: { roleId: superRole.id },
      });
      console.log(`✓ Mavjud admin ${email} ga SUPERADMIN roli berildi`);
    } else {
      console.log(`⚠ Admin allaqachon mavjud: ${email}`);
    }
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.adminUser.create({
      data: {
        email, passwordHash, fullName,
        roleId: superRole?.id,
      },
    });
    console.log(`✓ Birinchi admin yaratildi: ${user.email} (parol: ${password})`);
    console.log("  → Iltimos, birinchi kirishdan keyin parolni o'zgartiring.");
  }

  // 3. Banklar — bank24.uz protokoli oilasi (KapitalBank, Ipak Yo'li)
  const DEFAULT_BANKS = [
    {
      code: 'KAPITALBANK',
      name: 'Kapitalbank',
      apiBaseUrl: process.env.KAPITALBANK_API_URL || 'https://m.bank24.uz:2713/Mobile.svc',
      apiKind: 'KAPITALBANK_V3' as const,
    },
    {
      code: 'IPAK_YULI',
      name: "Ipak Yo'li banki",
      apiBaseUrl: 'https://mb.ipakyulibank.uz:2713/Mobile.svc',
      apiKind: 'KAPITALBANK_V3' as const,
    },
  ];

  for (const b of DEFAULT_BANKS) {
    const existing = await prisma.bank.findUnique({ where: { code: b.code } });
    if (!existing) {
      await prisma.bank.create({ data: b });
      console.log(`✓ ${b.name} qo'shildi`);
    } else if (!existing.apiBaseUrl) {
      await prisma.bank.update({ where: { id: existing.id }, data: { apiBaseUrl: b.apiBaseUrl } });
      console.log(`✓ ${b.name} apiBaseUrl yangilandi`);
    } else {
      console.log(`⚠ ${b.name} mavjud`);
    }
  }

  // 4. Kategoriyalar — 2 darajali daraxt (legacy Google Sheets F/G ustunlar logikasi)
  await seedCategories();
}

interface CategoryNode {
  code: string;
  name: string;
  color: string;
  icon: string;
  children?: { code: string; name: string }[];
}

const CATEGORY_TREE: CategoryNode[] = [
  {
    code: 'CLIENT', name: 'Клиент / Физ.Л / Юр.Л', color: '#6366f1', icon: 'Users',
    children: [
      { code: 'CLIENT_VZNOS_KV',     name: 'Взносы за квартиры' },
      { code: 'CLIENT_VZNOS_AVTO',   name: 'Взносы за автостоянку' },
      { code: 'CLIENT_VOZVRAT',      name: 'Возврат взносов за кв.' },
      { code: 'CLIENT_SCHETCHIK',    name: 'За счетчик' },
      { code: 'CLIENT_PEREOFORM',    name: 'Переоформление (приход)' },
    ],
  },
  {
    code: 'BANK', name: 'Банк', color: '#0ea5e9', icon: 'Building2',
    children: [
      { code: 'BANK_USLUGI', name: 'Услуги банка' },
    ],
  },
  {
    code: 'SALARY', name: 'Зарплата', color: '#10b981', icon: 'Wallet',
  },
  {
    code: 'TRANSFER', name: 'Переброска', color: '#8b5cf6', icon: 'Repeat',
  },
  {
    code: 'MINFIN', name: 'Молия Вазирлиги', color: '#f59e0b', icon: 'Landmark',
    children: [
      { code: 'MINFIN_NDS',         name: 'НДС' },
      { code: 'MINFIN_NDFL',        name: 'НДФЛ' },
      { code: 'MINFIN_NDFL_DIV',    name: 'НДФЛ с дивиденда' },
      { code: 'MINFIN_WATER',       name: 'Водоснабжение' },
      { code: 'MINFIN_ESP',         name: 'ЕСП' },
      { code: 'MINFIN_WATER_RES',   name: 'За пользование водными ресурсами' },
      { code: 'MINFIN_LAND',        name: 'Налог на землю' },
      { code: 'MINFIN_PROPERTY',    name: 'Налог на имущество' },
      { code: 'MINFIN_PENALTY',     name: 'Штрафы и пеня' },
      { code: 'MINFIN_PROFIT',      name: 'Налог на прибыль' },
      { code: 'MINFIN_PENSION',     name: 'Пенсия бадали (101)' },
    ],
  },
  {
    code: 'LOAN', name: 'Финансовый займ', color: '#14b8a6', icon: 'HandCoins',
    children: [
      { code: 'LOAN_VYDACHA', name: 'фин.займ выдача' },
    ],
  },
  {
    code: 'COUNTERPARTY_RETURN', name: 'Возврат от контрагентов', color: '#f43f5e', icon: 'Undo2',
  },
  {
    code: 'COUNTERPARTY', name: 'Контрагент', color: '#64748b', icon: 'Briefcase',
  },
];

async function seedCategories() {
  let createdTop = 0, createdSub = 0, updated = 0;

  for (let i = 0; i < CATEGORY_TREE.length; i++) {
    const top = CATEGORY_TREE[i];
    const existingTop = await prisma.category.findUnique({ where: { code: top.code } });
    let topId: string;

    if (!existingTop) {
      const created = await prisma.category.create({
        data: {
          code: top.code, name: top.name, color: top.color, icon: top.icon,
          isSystem: true, sortOrder: i * 10,
        },
      });
      topId = created.id;
      createdTop++;
    } else {
      topId = existingTop.id;
      // Yangilik: agar isSystem/color/icon yo'q bo'lsa — to'ldiramiz (eskini buzmaymiz)
      if (!existingTop.isSystem || !existingTop.color) {
        await prisma.category.update({
          where: { id: topId },
          data: { color: top.color, icon: top.icon, isSystem: true, sortOrder: i * 10 },
        });
        updated++;
      }
    }

    if (!top.children) continue;
    for (let j = 0; j < top.children.length; j++) {
      const sub = top.children[j];
      const existingSub = await prisma.category.findUnique({ where: { code: sub.code } });
      if (!existingSub) {
        await prisma.category.create({
          data: {
            code: sub.code, name: sub.name, parentId: topId,
            color: top.color, icon: top.icon,
            isSystem: true, sortOrder: i * 10 + j,
          },
        });
        createdSub++;
      } else if (!existingSub.parentId || existingSub.parentId !== topId) {
        await prisma.category.update({
          where: { id: existingSub.id },
          data: { parentId: topId, color: top.color, isSystem: true, sortOrder: i * 10 + j },
        });
        updated++;
      }
    }
  }
  console.log(`✓ Kategoriyalar: +${createdTop} top, +${createdSub} sub, ${updated} yangilandi`);
}

async function backfillCounterpartyManual() {
  // isManual ustuni yangi qo'shildi — eski qatorlarga to'g'ri qiymat berib chiqamiz.
  try {
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE counterparties
      SET is_manual = NOT (inn ~ '^[0-9]{9}$' OR inn ~ '^[0-9]{14}$')
      WHERE is_manual IS NULL OR is_manual = false
    `);
    if (typeof updated === 'number' && updated > 0) {
      console.log(`✓ counterparties.is_manual backfilled: ${updated} qator`);
    }
  } catch (e: any) {
    if (!/does not exist/i.test(e?.message || '')) {
      console.log(`⚠ is_manual backfill xato: ${e?.message}`);
    }
  }
}

async function backfillTransactionDirection() {
  // Bank `dir` field ba'zan noto'g'ri kelgan tranzaksiyalar uchun yo'nalishni qayta hisoblash:
  //   to_account = bizning hisob_no  →  KIRIM (IN)
  //   from_account = bizning hisob_no  →  CHIQIM (OUT)
  // Faqat yo'nalish noto'g'ri bo'lganlarni yangilaymiz.
  try {
    const fixedIn = await prisma.$executeRawUnsafe(`
      UPDATE transactions t
      SET direction = 'IN'
      FROM bank_accounts a
      WHERE t.account_id = a.id
        AND t.to_account = a.account_no
        AND t.direction = 'OUT'
    `);
    const fixedOut = await prisma.$executeRawUnsafe(`
      UPDATE transactions t
      SET direction = 'OUT'
      FROM bank_accounts a
      WHERE t.account_id = a.id
        AND t.from_account = a.account_no
        AND t.direction = 'IN'
    `);
    const inN = typeof fixedIn === 'number' ? fixedIn : 0;
    const outN = typeof fixedOut === 'number' ? fixedOut : 0;
    if (inN + outN > 0) {
      console.log(`✓ Transactions direction backfilled: ${inN} → IN, ${outN} → OUT`);
    }
  } catch (e: any) {
    console.log(`⚠ direction backfill xato: ${e?.message}`);
  }
}

async function backfillIpakExternalIdPrefix() {
  // Ipak Yo'li bank tranzaksiyalarining externalId'siga IP_ prefiksi qo'shamiz
  // (agar hali qo'shilmagan bo'lsa). Kapitalbank ID'lari bilan ajratish uchun.
  try {
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE transactions t
      SET external_id = 'IP_' || external_id
      FROM banks b
      WHERE t.bank_id = b.id
        AND b.code = 'IPAK_YULI'
        AND t.external_id IS NOT NULL
        AND t.external_id NOT LIKE 'IP\\_%' ESCAPE '\\'
    `);
    if (typeof updated === 'number' && updated > 0) {
      console.log(`✓ Ipak Yo'li externalId backfilled: ${updated} qator`);
    }
  } catch (e: any) {
    console.log(`⚠ Ipak Yo'li externalId backfill xato: ${e?.message}`);
  }
}

async function backfillHistoryActorEmail() {
  // counterparty_history.actor_name — avval fullName saqlanardi.
  // Endi email (login) saqlaymiz. Eski qatorlarni admin_users'dan email bilan yangilab chiqamiz.
  try {
    const updated = await prisma.$executeRawUnsafe(`
      UPDATE counterparty_history h
      SET actor_name = u.email
      FROM admin_users u
      WHERE h.actor_id = u.id
        AND u.email IS NOT NULL
        AND (h.actor_name IS NULL OR h.actor_name <> u.email)
    `);
    if (typeof updated === 'number' && updated > 0) {
      console.log(`✓ counterparty_history.actor_name backfilled (email): ${updated} qator`);
    }
  } catch (e: any) {
    if (!/does not exist/i.test(e?.message || '')) {
      console.log(`⚠ actor_name backfill xato: ${e?.message}`);
    }
  }
}

main()
  .then(() => backfillCounterpartyManual())
  .then(() => backfillHistoryActorEmail())
  .then(() => backfillIpakExternalIdPrefix())
  .then(() => backfillTransactionDirection())
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
