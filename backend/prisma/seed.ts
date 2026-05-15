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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
