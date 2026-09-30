import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TrArizaService } from './tr-ariza.service';

describe('TrArizaService', () => {
  let dir: string;
  let prisma: any;
  let oplataKv: { findXatoRows: jest.Mock };
  let crmCache: { lookup: jest.Mock };
  let correction: { createRequestWithFile: jest.Mock };
  let agentAi: { isEnabled: jest.Mock; processRequest: jest.Mock };
  let svc: TrArizaService;
  const FAYL = 'leader_bot_0123456789abcdef.jpg';
  const ROW = { id: 'okv1', date: new Date('2026-09-29'), contractNo: '217VHA23EU', paymentAmount: 7100000, client: null,
    object: null, purpose: "... Suyunova Karomat", sourceTxId: 'EXT1' };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trariza-'));
    fs.writeFileSync(path.join(dir, FAYL), Buffer.from('rasm'));
    prisma = {
      setting: { findUnique: jest.fn(async ({ where }: any) => (where.key === 'agent.aiName' ? { value: 'Shomurad AI' } : { value: '2026-07-01' })) },
      transaction: {
        findFirst: jest.fn(async () => ({ id: 'ctx1', externalId: 'EXT1' })),
        findMany: jest.fn(async () => [{ id: 'ctx1', externalId: 'EXT1', toAccount: '20208000205720456001', fromAccount: '17409', direction: 'IN' }]),
      },
      xatoCorrectionRequest: {
        findMany: jest.fn(async () => []),
        findUnique: jest.fn(async () => ({ id: 'req1', status: 'approved', agentState: 'done', agentReason: 'mos', reviewedByName: 'Shomurad AI',
          reviewedByType: 'agent', rejectReason: null, appliedContractNo: '467RMZ26HA', proposedContractNo: '467RMZ26HA', reviewedAt: null })),
      },
      oplataKv: { findUnique: jest.fn(async () => ({ id: 'okv1' })) },
    };
    oplataKv = { findXatoRows: jest.fn(async () => [ROW]) };
    crmCache = { lookup: jest.fn(async (c: string) => (c === '467RMZ26HA'
      ? { contractNumber: '467RMZ26HA', found: true, customerName: 'SUYUNOVA KAROMAT', objectName: 'RMZ' } : { contractNumber: c, found: false })) };
    correction = { createRequestWithFile: jest.fn(async () => ({ ok: true, id: 'req1' })) };
    agentAi = { isEnabled: jest.fn(async () => true), processRequest: jest.fn(async () => ({ ok: true })) };
    svc = new TrArizaService(prisma, oplataKv as any, crmCache as any, correction as any, agentAi as any,
      { get: (k: string) => (k === 'AGENTS_UPLOADS_DIR' ? dir : undefined) } as any);
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('find: XATO ro\'yxati filtri (summa, ±3 kun, ro\'yxat sanasi), hisob bilan tanlash, CRM tekshiruvi', async () => {
    const r = await svc.find({ summa: 7100000, sana: '2026-09-29', hisob: '20208000205720456001', shartnoma: '467RMZ26HA' });
    const a = oplataKv.findXatoRows.mock.calls[0][0];
    expect(a).toMatchObject({ amount: 7100000, listDateFrom: '2026-07-01' });
    expect(a.from.toISOString().slice(0, 10)).toBe('2026-09-26');
    expect(a.to.toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ oplataKvId: 'okv1', txId: 'EXT1', toAccount: '20208000205720456001', pending: null });
    expect(r.hisobMos).toBe(true);
    expect(r.crm).toMatchObject({ contract: '467RMZ26HA', found: true, customerName: 'SUYUNOVA KAROMAT' });
    expect(r.aiName).toBe('Shomurad AI');
  });

  it('submit: fayl bot papkasidan, createRequestWithFile (XATO sahifasi bilan bir xil) + AI darrov', async () => {
    const r = await svc.submit({ oplataKvId: 'okv1', contractNo: '467rmz26ha', fayl: FAYL, yubordi: 'TR Support · Samar' });
    expect(r).toMatchObject({ ok: true, id: 'req1', alreadyPending: false, contract: '467RMZ26HA', aiEnabled: true, aiName: 'Shomurad AI' });
    const [input, file] = correction.createRequestWithFile.mock.calls[0];
    expect(input).toMatchObject({ oplataKvId: 'okv1', proposedContractNo: '467RMZ26HA', source: 'telegram', submittedByName: 'TR Support · Samar' });
    expect(file).toMatchObject({ originalname: 'ariza_tr_support.jpg', mimetype: 'image/jpeg', size: 4 });
    expect(agentAi.processRequest).toHaveBeenCalledWith('req1');
  });

  it('submit rad: XATO ro\'yxatida emas, CRM\'da yo\'q, fayl nomi/joyi noto\'g\'ri', async () => {
    oplataKv.findXatoRows.mockResolvedValueOnce([]);
    await expect(svc.submit({ oplataKvId: 'okv1', contractNo: '467RMZ26HA', fayl: FAYL, yubordi: 'S' })).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.submit({ oplataKvId: 'okv1', contractNo: '999XXX9', fayl: FAYL, yubordi: 'S' })).rejects.toThrow("CRM'da topilmadi");
    for (const bad of ['../etc/passwd', 'leader_bot_0123456789abcdef.pdf', 'x.jpg', 'leader_bot_ffffffffffffffff.jpg']) {
      await expect(svc.submit({ oplataKvId: 'okv1', contractNo: '467RMZ26HA', fayl: bad, yubordi: 'S' })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(correction.createRequestWithFile).not.toHaveBeenCalled();
  });

  it('allaqachon ariza bor — AI qayta chaqirilmaydi; status', async () => {
    correction.createRequestWithFile.mockResolvedValueOnce({ ok: true, id: 'req0', alreadyPending: true });
    const r = await svc.submit({ oplataKvId: 'okv1', contractNo: '467RMZ26HA', fayl: FAYL, yubordi: 'S' });
    expect(r).toMatchObject({ id: 'req0', alreadyPending: true });
    expect(agentAi.processRequest).not.toHaveBeenCalled();
    const s = await svc.status('req1');
    expect(s).toMatchObject({ status: 'approved', agentState: 'done', reviewedBy: 'Shomurad AI', contract: '467RMZ26HA', aiName: 'Shomurad AI' });
  });
});
