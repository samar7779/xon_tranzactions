import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

// Permissions ro'yxati (src/auth/permissions.ts bilan sinxron)
const PERMS = {
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
};
const ALL_PERMS = Object.values(PERMS);

const SYSTEM_ROLES = [
  {
    name: 'SUPERADMIN',
    label: 'Bosh administrator',
    description: 'Barcha ruxsatlarga ega — rollarni boshqarishi mumkin',
    permissions: ALL_PERMS,
  },
  {
    name: 'ADMIN',
    label: 'Administrator',
    description: 'Bank ulanishlari va hisoblarni boshqaradi, foydalanuvchilarga tegmaydi',
    permissions: [
      PERMS.DASHBOARD_VIEW, PERMS.TRANSACTIONS_VIEW,
      PERMS.ACCOUNTS_VIEW, PERMS.ACCOUNTS_MANAGE,
      PERMS.CREDENTIALS_VIEW, PERMS.CREDENTIALS_MANAGE, PERMS.CREDENTIALS_TEST,
      PERMS.BANKS_VIEW, PERMS.BANKS_MANAGE,
      PERMS.SYNC_VIEW, PERMS.SYNC_RUN,
    ],
  },
  {
    name: 'VIEWER',
    label: 'Kuzatuvchi',
    description: "Faqat o'qish — tranzaksiyalar va statistikani ko'radi",
    permissions: [
      PERMS.DASHBOARD_VIEW, PERMS.TRANSACTIONS_VIEW,
      PERMS.ACCOUNTS_VIEW, PERMS.CREDENTIALS_VIEW,
      PERMS.BANKS_VIEW, PERMS.SYNC_VIEW,
    ],
  },
];

async function main() {
  // 1. System rollar
  for (const r of SYSTEM_ROLES) {
    await prisma.role.upsert({
      where: { name: r.name },
      update: {
        label: r.label,
        description: r.description,
        permissions: r.permissions,
        isSystem: true,
      },
      create: {
        name: r.name,
        label: r.label,
        description: r.description,
        permissions: r.permissions,
        isSystem: true,
      },
    });
  }
  console.log(`✓ ${SYSTEM_ROLES.length} ta tizim roli sinxronlandi`);

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
        role: 'SUPERADMIN',
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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
