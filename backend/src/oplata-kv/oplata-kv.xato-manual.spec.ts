import { Logger } from '@nestjs/common';
import { OplataKvService } from './oplata-kv.service';

/**
 * QOIDA (egasi tasdiqlagan): ОплатыКв'da CRM'da yo'q shartnoma XATO bo'lishi kerak —
 * MANBADAN QAT'I NAZAR (avto, "Qo'lda", "Ariza").
 *   - CRM'da bor (found=true) → shartnoma, XATO emas.
 *   - CRM'da yo'q (kesh found=false) → XATO.
 *   - Qo'lda/ariza + kesh YO'Q (tekshirilmagan) → hali XATO emas, lekin fonda
 *     crmCache.lookup bilan tekshiriladi (keyin found=false → XATO).
 *   - Avto → avvalgidek (CRM-tasdiqlanmagan → XATO).
 */
describe("OplataKvService.computeContractXato — CRM'da yo'q shartnoma XATO", () => {
  let prisma: any;
  let crmCache: { lookup: jest.Mock };
  let svc: OplataKvService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = {
      transaction: { findMany: jest.fn(async () => []) },
      crmContract: { findMany: jest.fn(async () => []) },
    };
    crmCache = { lookup: jest.fn(async () => null) };
    // constructor: prisma, crmService, crmCache, settings, config, http, categorization, crypto
    svc = new OplataKvService(
      prisma, {} as any, crmCache as any, {} as any, { get: () => undefined } as any,
      {} as any, {} as any, {} as any,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  const run = (items: any[]) => (svc as any).computeContractXato(items) as Promise<{
    isXato: (it: { sourceTxId: string | null; contractNo: string }) => boolean;
    sourceOf: (it: { sourceTxId: string | null }) => 'manual' | 'ariza' | null;
  }>;
  const flush = () => new Promise((r) => setImmediate(r));
  const manualTx = (id: string, attachments = 0) => ({ id, externalId: id, _count: { attachments } });
  const crm = (cn: string, found: boolean) => ({ contractNumber: cn, found });

  it("qo'lda + kesh found=false → XATO", async () => {
    prisma.transaction.findMany.mockResolvedValue([manualTx('tx1')]);
    prisma.crmContract.findMany.mockResolvedValue([crm('CNF', false)]);
    const { isXato, sourceOf } = await run([{ sourceTxId: 'tx1', contractNo: 'CNF' }]);
    expect(sourceOf({ sourceTxId: 'tx1' })).toBe('manual');
    expect(isXato({ sourceTxId: 'tx1', contractNo: 'CNF' })).toBe(true);
  });

  it("qo'lda + found=true → XATO emas", async () => {
    prisma.transaction.findMany.mockResolvedValue([manualTx('tx2')]);
    prisma.crmContract.findMany.mockResolvedValue([crm('CV', true)]);
    const { isXato } = await run([{ sourceTxId: 'tx2', contractNo: 'CV' }]);
    expect(isXato({ sourceTxId: 'tx2', contractNo: 'CV' })).toBe(false);
  });

  it('ariza + kesh found=false → XATO', async () => {
    prisma.transaction.findMany.mockResolvedValue([manualTx('tx3', 2)]);
    prisma.crmContract.findMany.mockResolvedValue([crm('CA', false)]);
    const { isXato, sourceOf } = await run([{ sourceTxId: 'tx3', contractNo: 'CA' }]);
    expect(sourceOf({ sourceTxId: 'tx3' })).toBe('ariza');
    expect(isXato({ sourceTxId: 'tx3', contractNo: 'CA' })).toBe(true);
  });

  it('avto + kesh yo\'q → XATO (o\'zgarmagan)', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);        // manual emas
    prisma.crmContract.findMany.mockResolvedValue([]);        // kesh yo'q
    const { isXato, sourceOf } = await run([{ sourceTxId: 'tx4', contractNo: 'CAUTO' }]);
    expect(sourceOf({ sourceTxId: 'tx4' })).toBeNull();
    expect(isXato({ sourceTxId: 'tx4', contractNo: 'CAUTO' })).toBe(true);
  });

  it('avto + found=false → XATO', async () => {
    prisma.transaction.findMany.mockResolvedValue([]);
    prisma.crmContract.findMany.mockResolvedValue([crm('CAF', false)]);
    const { isXato } = await run([{ sourceTxId: 'tx6', contractNo: 'CAF' }]);
    expect(isXato({ sourceTxId: 'tx6', contractNo: 'CAF' })).toBe(true);
  });

  it("qo'lda + kesh YO'Q → XATO emas, lekin crmCache.lookup chaqiriladi", async () => {
    prisma.transaction.findMany.mockResolvedValue([manualTx('tx5')]);
    prisma.crmContract.findMany.mockResolvedValue([]);        // kesh qatori yo'q
    const { isXato } = await run([{ sourceTxId: 'tx5', contractNo: 'CUNK' }]);
    expect(isXato({ sourceTxId: 'tx5', contractNo: 'CUNK' })).toBe(false);
    await flush();
    expect(crmCache.lookup).toHaveBeenCalledWith('CUNK');
  });

  it('667308ZUR23ES (qo\'lda, CRM\'da yo\'q) → XATO; 1689ZUR24NU (CRM\'da bor) → XATO emas', async () => {
    prisma.transaction.findMany.mockResolvedValue([manualTx('t667')]);  // faqat 667 qo'lda
    prisma.crmContract.findMany.mockResolvedValue([
      crm('667308ZUR23ES', false),   // CRM'da yo'q (o'chirilgan, tiklanmagan)
      crm('1689ZUR24NU', true),      // CRM'da bor ("Удалено" lekin to'lovlardan tiklangan)
    ]);
    const items = [
      { sourceTxId: 't667', contractNo: '667308ZUR23ES' },
      { sourceTxId: 't1689', contractNo: '1689ZUR24NU' },
    ];
    const { isXato } = await run(items);
    expect(isXato(items[0])).toBe(true);   // qo'lda + found=false → XATO
    expect(isXato(items[1])).toBe(false);  // CRM'da bor → shartnoma
  });
});
