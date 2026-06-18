/**
 * ═══════════════════════════════════════════════════════════════
 *   BACKFILL: счётчик (hisoblagich) tranzaksiyalarini qayta tasniflash
 * ═══════════════════════════════════════════════════════════════
 *
 * Maqsad:
 *   Eski (commit 2da4412 dan oldingi) noto'g'ri tasniflangan tranzaksiyalarni
 *   topib, ularni CLIENT > CLIENT_SCHETCHIK ('За счетчик') kategoriyaga ko'chirish.
 *   Bir vaqtning o'zida bog'langan OplataKv qatorlarini ham yangilash —
 *   ikkala jadval sinxron qoladi.
 *
 * Logikasi (Yangi commitda kelgan):
 *   1) Description ni .toUpperCase().replace(/Ё/g,'Е') bilan normalize qil
 *   2) KEYWORDS_SCHETCHIK = ['HISOBLAG','ХИСОБЛАГ','ХИСЛОБЛАГ','СЧЕТЧИК'] dan
 *      birortasi includes() qaytarsa — bu schotchik to'lov
 *
 * Bajariladi:
 *   A. transactions: categoryId=CLIENT, subcategoryId=CLIENT_SCHETCHIK
 *   B. oplata_kv (sourceTxId orqali bog'langan):
 *      - txType = 'За счетчик'
 *      - firstInstallment = NULL
 *      - monthlyAmount    = NULL
 *      - paymentCategory  = NULL  (re-split'da yangidan hisoblanadi)
 *   C. Affected contractNo lar ichidagi BOSHQA qatorlar ham reset qilinadi
 *      (firstInstallment/monthlyAmount/paymentCategory = NULL) — running totals
 *      o'zgaradi, splitInstallments yangidan hisoblashi kerak.
 *
 * Ishga tushirish:
 *   cd backend
 *   npx ts-node scripts/backfill-schotchik.ts                 # DRY-RUN (faqat ko'rsatadi)
 *   npx ts-node scripts/backfill-schotchik.ts --apply         # haqiqatda yangilaydi
 *   npx ts-node scripts/backfill-schotchik.ts --apply --from=2025-01-01
 *
 * Apply'dan keyin:
 *   - Admin paneldan 'Barcha hisoblar — orqa sanaga sync' tugmasini bosing
 *   - YOKI: curl -X POST .../api/oplata-kv/split (svgaga yangidan ajratish)
 */

// .env faylini yuklash — DATABASE_URL va boshqa env-larni o'qish uchun
// (NestJS @nestjs/config tarafida avtomatik, lekin bu standalone script)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

// ─── KONFIGURATSIYA (kodda mavjud yangi logikadan nusxa) ────────
const KEYWORDS_SCHETCHIK = ['HISOBLAG', 'ХИСОБЛАГ', 'ХИСЛОБЛАГ', 'СЧЕТЧИК'];
const normalizeYo = (s: string) => s.replace(/Ё/g, 'Е').replace(/ё/g, 'е');
const matchesSchetchik = (desc: string | null): boolean => {
  if (!desc) return false;
  const normalized = normalizeYo(desc.toUpperCase());
  return KEYWORDS_SCHETCHIK.some((k) => normalized.includes(k));
};

// ─── CLI ARGUMENTS ──────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const fromArg = process.argv.find((a) => a.startsWith('--from='))?.split('=')[1];
const toArg = process.argv.find((a) => a.startsWith('--to='))?.split('=')[1];

// ─── HELPERS ────────────────────────────────────────────────────
const sep = (ch: string = '─', n: number = 64) => ch.repeat(n);
const fmt = (n: number) => n.toLocaleString('ru-RU');
const trunc = (s: string | null, max: number = 80) =>
  !s ? '' : s.length > max ? s.slice(0, max - 1) + '…' : s;

// ─── ASOSIY ────────────────────────────────────────────────────
async function main() {
  const prisma = new PrismaClient();
  const startTime = Date.now();

  try {
    console.log('\n' + sep('═'));
    console.log('  SCHOTCHIK BACKFILL SCRIPT');
    console.log(`  Mode: ${APPLY ? '🟢 APPLY (yangilanadi)' : '🟡 DRY-RUN (faqat ko\'rsatadi)'}`);
    console.log(sep('═'));

    // ── Step 1: Sanaga konfiguratsiyani o'qish ──────────────────
    console.log('\n📅 Step 1: Sanani aniqlash');
    let minDate: Date | null = null;
    if (fromArg) {
      minDate = new Date(fromArg);
      console.log(`  --from= bilan o'rnatildi: ${minDate.toISOString().slice(0, 10)}`);
    } else {
      const setting = await prisma.setting.findUnique({ where: { key: 'sync.minDate' } });
      if (setting?.value) {
        minDate = new Date(setting.value);
        console.log(`  DB'dan o'qildi (sync.minDate): ${minDate.toISOString().slice(0, 10)}`);
      } else {
        minDate = new Date('2024-01-01');
        console.log(`  Sozlama yo'q, default: ${minDate.toISOString().slice(0, 10)}`);
      }
    }
    const maxDate = toArg ? new Date(toArg) : new Date();
    console.log(`  Tekshiriladigan diapazon: ${minDate.toISOString().slice(0, 10)} → ${maxDate.toISOString().slice(0, 10)}`);

    // ── Step 2: Kategoriya ID larini topish ─────────────────────
    console.log('\n🏷️  Step 2: Kategoriya ID larini topish');
    const clientCat = await prisma.category.findFirst({
      where: { code: 'CLIENT', parentId: null },
      select: { id: true, name: true },
    });
    if (!clientCat) throw new Error('CLIENT root kategoriyasi topilmadi (seed yetishmaydi)');

    const schetchikCat = await prisma.category.findFirst({
      where: { code: 'CLIENT_SCHETCHIK' },
      select: { id: true, name: true, parentId: true },
    });
    if (!schetchikCat) throw new Error('CLIENT_SCHETCHIK subkategoriyasi topilmadi (seed yetishmaydi)');

    console.log(`  ✓ CLIENT             : ${clientCat.id}  "${clientCat.name}"`);
    console.log(`  ✓ CLIENT_SCHETCHIK   : ${schetchikCat.id}  "${schetchikCat.name}"`);

    // ── Step 3: Tranzaksiyalarni skanerlash ─────────────────────
    console.log('\n🔍 Step 3: Tranzaksiyalarni skanerlash');

    // Faqat description bo'yicha keyword-ehtimolli tranzaksiyalarni olib
    // kelamiz (DB'dan optimallashtirilgan filter — to'liq jadvalni o'qimaymiz)
    const allTx = await prisma.transaction.findMany({
      where: {
        txnDate: { gte: minDate, lte: maxDate },
        OR: [
          { description: { contains: 'СЧЕТЧИК', mode: 'insensitive' } },
          { description: { contains: 'СЧЁТЧИК', mode: 'insensitive' } },
          { description: { contains: 'HISOBLAG', mode: 'insensitive' } },
          { description: { contains: 'ХИСОБЛАГ', mode: 'insensitive' } },
          { description: { contains: 'ХИСЛОБЛАГ', mode: 'insensitive' } },
          { description: { contains: 'хисоблаг', mode: 'insensitive' } },
          { description: { contains: 'хислоблаг', mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        externalId: true,
        txnDate: true,
        amount: true,
        direction: true,
        description: true,
        categoryId: true,
        subcategoryId: true,
        subcategory: { select: { id: true, code: true, name: true } },
      },
      orderBy: { txnDate: 'asc' },
    });

    console.log(`  DB filter natijasi: ${fmt(allTx.length)} ta potentsial qator`);

    // JS tarafida yangi keyword logikasi bilan aniq tekshirish
    const matched = allTx.filter((tx) => matchesSchetchik(tx.description));
    console.log(`  Yangi keyword bilan match: ${fmt(matched.length)} ta`);

    const alreadyCorrect = matched.filter((tx) => tx.subcategoryId === schetchikCat.id);
    const needsUpdate = matched.filter((tx) => tx.subcategoryId !== schetchikCat.id);
    console.log(`    ├ Allaqachon to'g'ri (CLIENT_SCHETCHIK): ${fmt(alreadyCorrect.length)} ta`);
    console.log(`    └ Yangilash kerak                       : ${fmt(needsUpdate.length)} ta`);

    if (needsUpdate.length === 0) {
      console.log('\n✅ Hech narsa yangilash shart emas. Yakun.');
      return;
    }

    // ── Step 4: Hozirgi subkategoriyalar bo'yicha guruh ────────
    console.log('\n📊 Step 4: Hozirgi subkategoriyalar bo\'yicha taqsim');
    const groupBySub = new Map<string, number>();
    for (const tx of needsUpdate) {
      const k = tx.subcategory?.name || tx.subcategory?.code || '(kategoriyasiz)';
      groupBySub.set(k, (groupBySub.get(k) || 0) + 1);
    }
    [...groupBySub.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([name, count]) => {
        console.log(`  ${count.toString().padStart(5)} × "${name}"  →  "За счетчик"`);
      });

    // ── Step 5: Namuna (eng birinchi 15 ta) ─────────────────────
    console.log('\n📋 Step 5: Namuna (birinchi 15 ta tranzaksiya)');
    needsUpdate.slice(0, 15).forEach((tx, i) => {
      const sign = tx.direction === 'IN' ? '+' : '-';
      const amt = `${sign}${fmt(Number(tx.amount))}`.padStart(14);
      const date = tx.txnDate.toISOString().slice(0, 10);
      const curr = (tx.subcategory?.name || '—').slice(0, 22).padEnd(22);
      console.log(`  ${(i + 1).toString().padStart(2)}. ${date} | ${amt} UZS | ${curr} | "${trunc(tx.description, 60)}"`);
    });
    if (needsUpdate.length > 15) {
      console.log(`     ... yana ${fmt(needsUpdate.length - 15)} ta tranzaksiya`);
    }

    // ── Step 6: Bog'langan OplataKv qatorlarni topish ──────────
    console.log('\n🔗 Step 6: Bog\'langan OplataKv qatorlarni topish');
    const sourceIds: string[] = [];
    for (const tx of needsUpdate) {
      if (tx.externalId) sourceIds.push(tx.externalId);
      sourceIds.push(tx.id);
    }

    const linkedOplataKv = await prisma.oplataKv.findMany({
      where: { sourceTxId: { in: sourceIds } },
      select: {
        id: true, sourceTxId: true, contractNo: true, txType: true,
        firstInstallment: true, monthlyAmount: true, paymentCategory: true,
      },
    });

    console.log(`  Topildi: ${fmt(linkedOplataKv.length)} ta OplataKv qatori`);

    // Affected contracts
    const affectedContracts = new Set(linkedOplataKv.map((r) => r.contractNo));
    console.log(`  Affected contracts: ${fmt(affectedContracts.size)} ta`);

    // Boshqa qatorlar — bir xil kontraktda lekin schotchik emas
    const otherInContracts = await prisma.oplataKv.count({
      where: {
        contractNo: { in: [...affectedContracts] },
        id: { notIn: linkedOplataKv.map((r) => r.id) },
        OR: [
          { firstInstallment: { not: null } },
          { monthlyAmount: { not: null } },
          { paymentCategory: { not: null } },
        ],
      },
    });
    console.log(`  Bir xil kontraktdagi boshqa split qilingan qatorlar: ${fmt(otherInContracts)} ta`);
    console.log(`    └ Bularning ham firstInstallment/monthlyAmount/paymentCategory NULL ga reset`);
    console.log(`      qilinadi (chunki running totals o\'zgaradi, splitInstallments qayta hisoblaydi)`);

    // ── Step 7: APPLY yoki DRY-RUN ──────────────────────────────
    if (!APPLY) {
      console.log('\n' + sep('═'));
      console.log('  🟡 DRY-RUN MODE — hech narsa yangilanmadi');
      console.log('  Haqiqiy yangilash uchun: --apply flag bilan qayta ishga tushiring');
      console.log('  Misol:  npx ts-node scripts/backfill-schotchik.ts --apply');
      console.log(sep('═') + '\n');
      return;
    }

    console.log('\n🔧 Step 7: Yangilash boshlanyapti (APPLY mode)...');
    const txIds = needsUpdate.map((t) => t.id);

    // (A) Transaction yangilanyapti
    const updatedTx = await prisma.transaction.updateMany({
      where: { id: { in: txIds } },
      data: {
        categoryId: clientCat.id,
        subcategoryId: schetchikCat.id,
      },
    });
    console.log(`  ✓ Transaction.subcategoryId yangilandi: ${fmt(updatedTx.count)} ta`);

    // (B) OplataKv qatorlar (bog'langan tranzaksiyalar uchun)
    if (linkedOplataKv.length > 0) {
      const updatedOk = await prisma.oplataKv.updateMany({
        where: { id: { in: linkedOplataKv.map((r) => r.id) } },
        data: {
          txType: 'За счетчик',
          firstInstallment: null,
          monthlyAmount: null,
          paymentCategory: null,
        },
      });
      console.log(`  ✓ OplataKv (bog'langan) yangilandi: ${fmt(updatedOk.count)} ta`);
    }

    // (C) Affected kontraktlardagi BOSHQA qatorlar ham reset
    if (affectedContracts.size > 0) {
      const resetOther = await prisma.oplataKv.updateMany({
        where: {
          contractNo: { in: [...affectedContracts] },
          id: { notIn: linkedOplataKv.map((r) => r.id) },
        },
        data: {
          firstInstallment: null,
          monthlyAmount: null,
          paymentCategory: null,
        },
      });
      console.log(`  ✓ Boshqa qatorlar reset qilindi: ${fmt(resetOther.count)} ta`);
    }

    console.log('\n' + sep('═'));
    console.log('  ✅ Backfill yakunlandi.');
    console.log(sep('═'));
    console.log('\n💡 Keyingi qadam — running totals qayta hisoblanishi uchun:');
    console.log('   Admin paneldan tugma boshing:');
    console.log('   "Barcha hisoblar — orqa sanaga sync"');
    console.log('   (yoki splitInstallments cron avtomatik ishga tushadi)');
    console.log('');

  } catch (e: any) {
    console.error('\n❌ XATO:', e?.message || e);
    if (e?.stack) console.error(e.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`⏱  Vaqt: ${elapsed} sekund\n`);
  }
}

main();
