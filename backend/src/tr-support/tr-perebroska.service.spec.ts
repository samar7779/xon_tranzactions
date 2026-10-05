import { Logger } from '@nestjs/common';
import { TrPerebroskaService } from './tr-perebroska.service';

const F = 'leader_bot_0123456789abcdef.pdf';
const FILE = { buffer: Buffer.from('%PDF'), originalname: 'perebroska_tr_support.pdf', mimetype: 'application/pdf', size: 4 };

describe('TrPerebroskaService', () => {
  let prisma: any;
  let oplataKv: { analyzePerereboskaAriza: jest.Mock; createPerereboska: jest.Mock };
  let trAriza: { readFile: jest.Mock };
  let svc: TrPerebroskaService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = {
      oplataKv: {
        findMany: jest.fn(async () => [
          { id: 'd1', contractNo: '4105SRH26RL', paymentAmount: '70944290', date: new Date('2026-10-05'), client: 'AHMEDOVA', object: 'SRH' },
          { id: 's1', contractNo: '24SRH24EF', paymentAmount: '-70944290', date: new Date('2026-10-05'), client: 'AHMEDOV', object: 'SRH' },
        ]),
      },
    };
    oplataKv = {
      analyzePerereboskaAriza: jest.fn(async () => ({
        ok: true, extracted: { fromContractNo: '24SRH24EF', totalAmount: 70944290, destinations: [] },
        agentState: 'verified', agentReason: 'ok', warnings: [], balanceEnough: true, duplicates: [],
      })),
      createPerereboska: jest.fn(async () => ({ ok: true, groupId: 'g1', sourceId: 's1', destIds: ['d1'], amount: 70944290 })),
    };
    trAriza = { readFile: jest.fn(async () => FILE) };
    svc = new TrPerebroskaService(prisma, oplataKv as any, trAriza as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('tahlil: bot fayli -> panel bilan bir xil analyzePerereboskaAriza', async () => {
    const r = await svc.tahlil(F);
    expect(trAriza.readFile).toHaveBeenCalledWith(F, 'perebroska_tr_support');
    expect(oplataKv.analyzePerereboskaAriza).toHaveBeenCalledWith(FILE);
    expect(r).toMatchObject({ ok: true, agentState: 'verified', warnings: [], balanceEnough: true });
    expect(r.extracted.fromContractNo).toBe('24SRH24EF');
  });

  it('yarat: createPerereboska (tasdiqlovchi actor va izoh bilan), natijada OplatyKv qatorlari tartib bilan', async () => {
    const r = await svc.yarat({
      fayl: F, fromContractNo: '24SRH24EF', amount: 70944290, date: '2026-10-05',
      destinations: [{ contractNo: '4105SRH26RL', amount: 70944290 }], agentState: 'verified', agentReason: 'ok',
      agentData: { x: 1 }, tasdiq: 'Salokhiddin', izoh: 'ariza 03.10',
    });
    expect(oplataKv.createPerereboska).toHaveBeenCalledWith(expect.objectContaining({
      fromContractNo: '24SRH24EF', amount: 70944290, date: '2026-10-05', file: FILE,
      actor: { id: null, name: 'TR Support · tasdiq: Salokhiddin' }, note: 'TR Support · tasdiq: Salokhiddin; ariza 03.10',
      agentUsed: true, agentState: 'verified', agentData: { x: 1 },
    }));
    expect(r).toMatchObject({ ok: true, groupId: 'g1', amount: 70944290 });
    expect(r.qatorlar.map((x) => [x.contractNo, x.summa])).toEqual([['24SRH24EF', -70944290], ['4105SRH26RL', 70944290]]);
  });
});
