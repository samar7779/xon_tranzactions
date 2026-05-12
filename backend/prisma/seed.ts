import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@xon.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026';
  const fullName = process.env.SEED_ADMIN_NAME || 'Bosh Admin';

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`⚠ Admin allaqachon mavjud: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.adminUser.create({
      data: { email, passwordHash, fullName, role: 'SUPERADMIN' },
    });
    console.log(`✓ Birinchi admin yaratildi: ${user.email} (parol: ${password})`);
    console.log('  → Iltimos, birinchi kirishdan keyin parolni o\'zgartiring.');
  }

  // KapitalBank — default bank yozuvi
  const kbCode = 'KAPITALBANK';
  const kb = await prisma.bank.findUnique({ where: { code: kbCode } });
  if (!kb) {
    await prisma.bank.create({
      data: {
        code: kbCode,
        name: 'Kapitalbank',
        apiBaseUrl: process.env.KAPITALBANK_API_URL || 'https://m.bank24.uz:2713/Mobile.svc',
        apiKind: 'KAPITALBANK_V3',
      },
    });
    console.log('✓ Kapitalbank yozuvi qo\'shildi');
  } else {
    console.log('⚠ Kapitalbank yozuvi allaqachon mavjud');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
