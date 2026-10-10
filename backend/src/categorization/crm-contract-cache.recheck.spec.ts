import { CrmContractCacheService } from './crm-contract-cache.service';

// 10.10.2026: to'lovlar tarixi fallback'i (qat'iy qoidagacha) keshga yozgan soxta "o'chirilgan"
// qatorlar deploydan keyin o'zi qayta tekshiriladi — CRM'da yo'q bo'lsa found=false (XATO).
describe('CrmContractCacheService — soxta "o\'chirilgan (crm)" qatorlarni qayta tekshirish', () => {
  function make(searchItems: Record<string, any[] | null>, marker = false) {
    const updates: any[] = [];
    const prisma: any = {
      crmContract: {
        findUnique: jest.fn().mockResolvedValue(marker ? { contractNumber: 'm' } : null),
        findMany: jest.fn().mockResolvedValue(Object.keys(searchItems).map((c) => ({ contractNumber: c }))),
        updateMany: jest.fn().mockImplementation((a: any) => { updates.push(a); return Promise.resolve({ count: 1 }); }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const crm: any = {
      searchContracts: jest.fn().mockImplementation((c: string) => {
        const items = searchItems[c];
        return Promise.resolve(items === null ? { ok: false, error: 'tarmoq' } : { ok: true, items });
      }),
    };
    return { svc: new CrmContractCacheService(prisma, crm), prisma, crm, updates };
  }

  it('CRM\'da yo\'q → found=false; haqiqiy o\'chirilgan → tegilmaydi; tarmoq xatosi → tegilmaydi', async () => {
    const { svc, prisma, updates } = make({
      '667308ZUR23ES': [],                                   // bank to'lovi, shartnoma emas
      '1689ZUR24NU': [{ contract: '1689ZUR24NU' }],          // CRM'da o'chirilgan, lekin bor
      '777ZUR23AA': null,                                     // CRM javob bermadi
    });
    await (svc as any).recheckDeletedFallbackOnce();
    expect(updates.map((u) => u.where.contractNumber)).toEqual(['667308ZUR23ES']);
    expect(updates[0].data.found).toBe(false);
    expect(prisma.crmContract.upsert).toHaveBeenCalledTimes(1);   // marker yozildi — qayta ishlamaydi
  });

  it('marker bor bo\'lsa — hech narsa qilmaydi', async () => {
    const { svc, crm, updates } = make({ '667308ZUR23ES': [] }, true);
    await (svc as any).recheckDeletedFallbackOnce();
    expect(crm.searchContracts).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });
});
