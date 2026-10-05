import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { AgentBridgeService } from './agent-bridge.service';

/**
 * Mock'lar QAT'IY: faqat ko'prik ishlatishi kerak bo'lgan metodlar bor — boshqa (yozuvchi)
 * metod chaqirilsa TypeError bilan test yiqiladi.
 */
describe('AgentBridgeService', () => {
  let chek: { paymentCheck: jest.Mock; resAllMatch: jest.Mock; findForAgent: jest.Mock };
  let crm: { lookupForAgent: jest.Mock };
  let trs: { options: jest.Mock; preview: jest.Mock; apply: jest.Mock };
  let gexp: { listSheetSources: jest.Mock; getRawConfig: jest.Mock; getConfig: jest.Mock; runAndLog: jest.Mock };
  let prisma: { exportCronLog: { findFirst: jest.Mock } };
  let svc: AgentBridgeService;

  const SAVED = [
    {
      id: 's1', name: 'Заявки', source: 'oplatakv', spreadsheetId: 'SECRET_SHEET_ID', tabName: 'Tab1', startRow: 2,
      dateFrom: '2026-01-01', writeMode: 'upsert', keyField: 'id', lastRowColumn: 'F',
      filter: { objects: ['SECRET_OBJ'] }, columns: [{ col: 'A', field: 'contractNo' }, { col: 'B', field: 'paymentAmount' }],
      cron: { enabled: true, everyMinutes: 15 },
    },
    {
      id: 's2', name: 'Tx', source: 'transaction', spreadsheetId: 'https://docs.google.com/x/SECRET2', tabName: 'T',
      startRow: 1, dateFrom: null, filter: {}, columns: [{ col: 'A', field: 'externalId' }],
    },
  ];

  const crmFound = {
    ok: true, found: true, price: 100, initialPlan: 30, monthlyPlan: 70, initial: 30, monthly: 20, total: 50,
    remaining: 50, count: 1, payments: [{ date: '2026-09-16', amount: 50, kind: 'monthly', type: 'Ежемесячный', extra: 'x' }],
    debug: 'detail|keys=SECRET_DEBUG',
  };
  const mkRes = (cn: string) => ({
    contract: cn,
    oplata: { ok: true, initial: 30, monthly: 20, total: 50, count: 2, payments: [{ date: '2026-09-16', first: 0, monthly: 20, total: 20 }] },
    crm: crmFound,
    sheets: [{ id: 's1', name: 'Заявки', ok: true, available: true, initial: 30, monthly: 20, total: 50, matchedRows: 1, rowsScanned: 10, payments: [] }],
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    chek = {
      paymentCheck: jest.fn(async (raw: string) => ({ ok: true, results: raw.split(',').map(mkRes) })),
      resAllMatch: jest.fn(() => true),
      findForAgent: jest.fn(),
    };
    crm = { lookupForAgent: jest.fn() };
    trs = { options: jest.fn(), preview: jest.fn(), apply: jest.fn() };
    gexp = {
      listSheetSources: jest.fn(async () => [
        { id: 's1', name: 'Заявки', source: 'oplatakv', hasPayColumns: true },
        { id: 's2', name: 'Tx', source: 'transaction', hasPayColumns: false },
      ]),
      getRawConfig: jest.fn(async () => SAVED),
      getConfig: jest.fn(async () => ({
        ok: true,
        credentials: { available: true, clientEmail: 'x@y.iam', projectId: 'proj', source: 'db' },
        sheets: SAVED,
      })),
      runAndLog: jest.fn(),
    };
    prisma = { exportCronLog: { findFirst: jest.fn(async () => null) } };
    svc = new AgentBridgeService(chek as any, gexp as any, prisma as any, { get: () => undefined } as any, crm as any, trs as any, {} as any);
  });
  afterEach(() => jest.restoreAllMocks());

  // ── tx-edit ──
  describe('tx-edit', () => {
    it('apply: TrSupportService.apply ga egasi manbasi bilan; javob whitelist', async () => {
      trs.apply.mockResolvedValue({ ok: true, batchId: 'b1', results: [
        { tx: 'T', id: 'e1', status: 'applied', changes: [{ field: 'shartnoma', from: null, to: 'X1' }], secret: 'S' },
        { tx: 'U', id: 'e2', status: 'applied', changes: [{ field: 'kategoriya', from: 'A', to: 'B' }], oplataKv: true },
      ], sync: { ok: true, added: 1, updated: 0, skipped: 0, at: 'x' } });
      const r = await svc.txEditApply({ items: [{ tx: 'T', kontragent: null, kategoriya: null, shartnoma: 'X1' }], approvedBy: 'Samar', comment: null });
      expect(trs.apply).toHaveBeenCalledWith([{ tx: 'T', kontragent: null, kategoriya: null, shartnoma: 'X1' }],
        { approvedBy: 'Samar', comment: null, requestedBy: 'Telegram egasi (TR Support bot)' });
      expect(r).toEqual({ ok: true, batchId: 'b1', results: [
        { tx: 'T', id: 'e1', status: 'applied', errors: [], changes: [{ field: 'shartnoma', from: null, to: 'X1' }], oplataKv: null },
        { tx: 'U', id: 'e2', status: 'applied', errors: [], changes: [{ field: 'kategoriya', from: 'A', to: 'B' }], oplataKv: true },
      ], sync: { ok: true, added: 1, updated: 0, skipped: 0 } });
    });
    it("options: kontragent -> kategoriyalar (id'larsiz)", async () => {
      trs.options.mockResolvedValue({ ok: true, tx: null, tree: [{ id: 'SECRET_ID', code: 'CLIENT', name: 'K', children: [{ id: 'SECRET_2', code: 'C1', name: 'V' }] }] });
      const r = await svc.txEditOptions('T');
      expect(r.kontragentlar).toEqual([{ code: 'CLIENT', name: 'K', kategoriyalar: [{ code: 'C1', name: 'V' }] }]);
      expect(JSON.stringify(r)).not.toMatch(/SECRET_/);
    });
  });

  // ── chek-find ──
  describe('chekFind', () => {
    it('matchOrder natijasi whitelist bilan (tavsif 300 belgi), boshqa maydon sizmaydi', async () => {
      chek.findForAgent.mockResolvedValue({
        orderNo: '10904304', extracted: { orderNo: '10904304' }, result: 'found',
        conditions: { order: true, account: null, date: true, amount: true, contract: null },
        matchedTx: {
          id: 'tx1', externalId: 'G_1_29.09.2026_A_B_813200000_-', direction: 'IN', amount: '8132000', currency: 'UZS',
          txnDate: new Date('2026-09-29T05:00:00Z'), docNumber: '10904304', reference: 'SECRET_REF', contractNumber: null,
          fromName: "G'AYBULLAYEVA DILRABO", fromAccount: 'SECRET_ACC', toName: 'X', toAccount: 'Y', description: 'd'.repeat(400),
        },
      });
      const r = await svc.chekFind({ orderNo: '10904304', amount: 8132000, date: '2026-09-29', recipientAccount: null, contractNo: null });
      expect(chek.findForAgent).toHaveBeenCalledWith({ orderNo: '10904304', amount: 8132000, date: '2026-09-29', recipientAccount: null, contractNo: null });
      expect(r.result).toBe('found');
      expect(r.tx).toMatchObject({ id: 'tx1', externalId: 'G_1_29.09.2026_A_B_813200000_-', amount: 8132000, contractNumber: null, docNumber: '10904304' });
      expect(r.tx!.description).toHaveLength(300);
      expect(JSON.stringify(r)).not.toMatch(/SECRET_/);
    });
    it('topilmadi → tx null', async () => {
      chek.findForAgent.mockResolvedValue({ result: 'not_found', matchedTx: null, conditions: null });
      const r = await svc.chekFind({ orderNo: '1', amount: null, date: null, recipientAccount: null, contractNo: null });
      expect(r).toEqual({ ok: true, result: 'not_found', conditions: null, tx: null });
    });
  });

  // ── crm-lookup ──
  describe('crmLookup', () => {
    it('aniq mos → whitelist qatorlar, via saqlanadi', async () => {
      crm.lookupForAgent.mockResolvedValue({
        ok: true, via: 'sana', checkedDate: '2026-09-29',
        exact: [{ contract: 'A1B2C3', date: '2026-09-29', amount: 8132000, initialAmount: 8132000, monthlyAmount: 0, otherAmount: 0,
          object: 'Obj', client: 'Ism', externalId: 'E', purpose: 'SECRET_PURPOSE', orderId: 'SECRET_ORDER' }],
        sameAmount: [],
      });
      const r: any = await svc.crmLookup('G_1_29.09.2026_A_B_813200000_-', '2026-09-29', 8132000);
      expect(crm.lookupForAgent).toHaveBeenCalledWith('G_1_29.09.2026_A_B_813200000_-', '2026-09-29', 8132000);
      expect(r).toMatchObject({ ok: true, via: 'sana', exact: [{ contract: 'A1B2C3', client: 'Ism', initialAmount: 8132000 }] });
      expect(JSON.stringify(r)).not.toMatch(/SECRET_/);
    });
    it('CRM xatosi yoki exception → ok:false (300 belgi)', async () => {
      crm.lookupForAgent.mockResolvedValueOnce({ ok: false, error: 'x'.repeat(500) });
      expect(await svc.crmLookup('A_B_C', null, null)).toEqual({ ok: false, error: 'x'.repeat(300) });
      crm.lookupForAgent.mockRejectedValueOnce(new Error('boom'));
      expect(await svc.crmLookup('A_B_C', null, null)).toEqual({ ok: false, error: 'boom' });
    });
  });

  // ── payment-check ──
  describe('paymentCheck', () => {
    it('mavjud chekOrder.paymentCheck AYNAN bir marta, panel parametrlari bilan (faqat to\'lov ustunli sheet)', async () => {
      await svc.paymentCheck(['A123', 'B456'], undefined);
      expect(chek.paymentCheck).toHaveBeenCalledTimes(1);
      expect(chek.paymentCheck).toHaveBeenCalledWith('A123,B456', { oplata: true, crm: true, sheetIds: ['s1'] });
    });

    it('allMatch = chekOrder.resAllMatch(res, [oplata, crm, sheet:<id>])', async () => {
      chek.resAllMatch.mockImplementation((res: any) => res.contract === 'A123');
      const r = await svc.paymentCheck(['A123', 'B456'], undefined);
      expect(chek.resAllMatch).toHaveBeenCalledTimes(2);
      for (const call of chek.resAllMatch.mock.calls) expect(call[1]).toEqual(['oplata', 'crm', 'sheet:s1']);
      expect(chek.resAllMatch.mock.calls[0][0].contract).toBe('A123');
      expect(r.results.map((x) => [x.contract, x.allMatch])).toEqual([['A123', true], ['B456', false]]);
    });

    it('javob: crm.debug va noma\'lum maydonlar yo\'q, qiymatlar saqlangan', async () => {
      const r = await svc.paymentCheck(['A123'], undefined);
      const json = JSON.stringify(r);
      expect(json).not.toContain('debug');
      expect(json).not.toContain('SECRET_DEBUG');
      expect(json).not.toContain('extra');
      expect(r.results[0].crm).toMatchObject({ ok: true, found: true, price: 100, total: 50, remaining: 50, count: 1 });
      expect(r.results[0].oplata).toMatchObject({ initial: 30, monthly: 20, total: 50, count: 2 });
      expect(r.results[0].sheets[0]).toMatchObject({ id: 's1', available: true, total: 50 });
      expect(r.sources).toEqual({ oplata: true, crm: true, sheets: [{ id: 's1', name: 'Заявки' }] });
      expect(typeof r.checkedAt).toBe('string');
    });

    it('CRM topilmadi → { ok:false, found:false }, xato matni 300 belgigacha', async () => {
      chek.paymentCheck.mockResolvedValueOnce({
        ok: true,
        results: [{ ...mkRes('A123'), crm: { ok: false, found: false, error: 'e'.repeat(1000), debug: 'noDetail' } }],
      });
      const r = await svc.paymentCheck(['A123'], undefined);
      expect(r.results[0].crm).toEqual({ ok: false, found: false, error: 'e'.repeat(300) });
    });

    it('viaPaymentHistory faqat true bo\'lsa chiqadi', async () => {
      chek.paymentCheck.mockResolvedValueOnce({ ok: true, results: [{ ...mkRes('A123'), crm: { ...crmFound, viaPaymentHistory: true } }] });
      const r = await svc.paymentCheck(['A123'], undefined);
      expect((r.results[0].crm as any).viaPaymentHistory).toBe(true);
    });

    it('sheetIds="s1" → ruxsat', async () => {
      await svc.paymentCheck(['A123'], 's1');
      expect(chek.paymentCheck).toHaveBeenCalledWith('A123', { oplata: true, crm: true, sheetIds: ['s1'] });
    });

    it.each(['s2', 'nope', 's1,nope'])('sheetIds=%p (to\'lov ustunsiz/noma\'lum) → 400, paymentCheck chaqirilmaydi', async (v) => {
      await expect(svc.paymentCheck(['A123'], v)).rejects.toBeInstanceOf(BadRequestException);
      expect(chek.paymentCheck).not.toHaveBeenCalled();
    });

    it('sheetIds formati buzuq → 400', async () => {
      await expect(svc.paymentCheck(['A123'], '../x')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.paymentCheck(['A123'], ['s1'])).rejects.toBeInstanceOf(BadRequestException);
      expect(chek.paymentCheck).not.toHaveBeenCalled();
    });

    it('sheet ro\'yxati bo\'sh → sheetIds: [] (ОплатыКв + CRM baribir ishlaydi)', async () => {
      gexp.listSheetSources.mockResolvedValueOnce([]);
      await svc.paymentCheck(['A123'], undefined);
      expect(chek.paymentCheck).toHaveBeenCalledWith('A123', { oplata: true, crm: true, sheetIds: [] });
      expect(chek.resAllMatch.mock.calls[0][1]).toEqual(['oplata', 'crm']);
    });
  });

  // ── exports ro'yxati ──
  describe('listExports', () => {
    it('sirlar javobda yo\'q; credentialsAvailable faqat boolean', async () => {
      const r = await svc.listExports();
      const json = JSON.stringify(r);
      for (const s of ['SECRET_SHEET_ID', 'SECRET2', 'x@y.iam', 'private_key', 'columns', 'spreadsheetId', 'lastRowColumn', 'proj']) { // filtr/cron — sabab tahlili uchun ochiq
        expect(json).not.toContain(s);
      }
      expect(r.credentialsAvailable).toBe(true);
      expect(r.items).toEqual([
        {
          id: 's1', name: 'Заявки', source: 'oplatakv', tabName: 'Tab1', writeMode: 'upsert', hasPayColumns: true,
          cron: { enabled: true, everyMinutes: 15, hourFrom: null, hourTo: null, days: [] },
          dateFrom: '2026-01-01',
          filter: { objects: ['SECRET_OBJ'], categories: [], txTypes: [], accounts: [], amountSign: null },
          keyField: 'id', fields: ['contractNo', 'paymentAmount'], lastRun: null,
        },
        {
          id: 's2', name: 'Tx', source: 'transaction', tabName: 'T', writeMode: 'replace', hasPayColumns: false,
          cron: { enabled: false, everyMinutes: null, hourFrom: null, hourTo: null, days: [] },
          dateFrom: null,
          filter: { objects: [], categories: [], txTypes: [], accounts: [], amountSign: null },
          keyField: null, fields: ['externalId'], lastRun: null,
        },
      ]);
    });

    it('oxirgi run: har sheet uchun findFirst(sheetId, startedAt desc); xato 300 belgigacha', async () => {
      const startedAt = new Date('2026-09-28T10:00:00Z');
      prisma.exportCronLog.findFirst.mockImplementation(async (q: any) =>
        q.where.sheetId === 's1'
          ? { startedAt, mode: 'manual', status: 'error', rowsWritten: 0, durationMs: 1200, triggeredBy: 'manual:agent-bridge', error: 'x'.repeat(1000) }
          : null,
      );
      const r = await svc.listExports();
      expect(prisma.exportCronLog.findFirst).toHaveBeenCalledTimes(2);
      for (const [q] of prisma.exportCronLog.findFirst.mock.calls) {
        expect(q.orderBy).toEqual({ startedAt: 'desc' });
        expect(['s1', 's2']).toContain(q.where.sheetId);
      }
      expect(r.items[0].lastRun).toEqual({
        startedAt: startedAt.toISOString(), mode: 'manual', status: 'error', rowsWritten: 0, durationMs: 1200,
        triggeredBy: 'manual:agent-bridge', error: 'x'.repeat(300),
      });
      expect(r.items[1].lastRun).toBeNull();
    });
  });

  // ── run ──
  describe('runExport', () => {
    it('noma\'lum id → 404, runAndLog chaqirilmaydi', async () => {
      await expect(svc.runExport('nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(gexp.runAndLog).not.toHaveBeenCalled();
    });

    it('ma\'lum id → runAndLog(SAQLANGAN target o\'zi, manual, manual:agent-bridge)', async () => {
      gexp.runAndLog.mockResolvedValue({ ok: true, rowsFetched: 5, rowsWritten: 5, dateTo: '2026-09-28', durationMs: 10 });
      await svc.runExport('s1');
      expect(gexp.runAndLog).toHaveBeenCalledTimes(1);
      expect(gexp.runAndLog.mock.calls[0][0]).toBe(SAVED[0]);
      expect(gexp.runAndLog.mock.calls[0][1]).toBe('manual');
      expect(gexp.runAndLog.mock.calls[0][2]).toBe('manual:agent-bridge');
    });

    it('ok:true javobi whitelist — spreadsheetId/debug/clearedRanges/columns yo\'q', async () => {
      gexp.runAndLog.mockResolvedValue({
        ok: true,
        sheet: { id: 's1', name: 'Заявки', spreadsheetId: 'SECRET', tabName: 'Tab1' },
        debug: { secretDebug: 1 }, clearedRanges: ['Tab1!A2:A'], columns: [{ col: 'A', field: 'contractNo' }],
        appliedFilter: { objects: 1 }, rowsFetched: 7, rowsWritten: 5, writtenRange: 'Tab1!A2:B6',
        writeMode: 'upsert', dateFrom: '2026-01-01', dateTo: '2026-09-28', startRow: 2, durationMs: 321,
      });
      const r = await svc.runExport('s1');
      const json = JSON.stringify(r);
      for (const s of ['SECRET', 'debug', 'clearedRanges', 'columns', 'appliedFilter', 'startRow']) expect(json).not.toContain(s);
      expect(r).toEqual({
        ok: true, sheet: { id: 's1', name: 'Заявки', tabName: 'Tab1' }, writeMode: 'upsert', rowsFetched: 7, rowsWritten: 5,
        writtenRange: 'Tab1!A2:B6', dateFrom: '2026-01-01', dateTo: '2026-09-28', durationMs: 321,
      });
    });

    it('ok:false (auth, durationMs yo\'q) → sheet{id,name}, durationMs raqam, xato 300 belgi', async () => {
      gexp.runAndLog.mockResolvedValue({ ok: false, step: 'auth', error: 'y'.repeat(500) });
      const r = await svc.runExport('s2');
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ ok: false, sheet: { id: 's2', name: 'Tx' }, step: 'auth', error: 'y'.repeat(300) });
      expect(typeof r.durationMs).toBe('number');
      expect(JSON.stringify(r)).not.toContain('SECRET2');
    });

    it('qulf: shu id ishlayotganda → 409; boshqa id → ruxsat; tugagach yana ruxsat', async () => {
      let resolveFirst: (v: any) => void = () => undefined;
      gexp.runAndLog.mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }));
      const first = svc.runExport('s1');
      await new Promise((r) => setImmediate(r)); // getRawConfig await'idan o'tsin (qulf olinsin)

      await expect(svc.runExport('s1')).rejects.toBeInstanceOf(ConflictException);

      gexp.runAndLog.mockResolvedValueOnce({ ok: true, rowsWritten: 1, dateTo: '2026-09-28' });
      await expect(svc.runExport('s2')).resolves.toMatchObject({ ok: true });

      resolveFirst({ ok: true, rowsWritten: 2, dateTo: '2026-09-28', durationMs: 1 });
      await expect(first).resolves.toMatchObject({ ok: true, rowsWritten: 2 });

      gexp.runAndLog.mockResolvedValueOnce({ ok: true, rowsWritten: 3, dateTo: '2026-09-28' });
      await expect(svc.runExport('s1')).resolves.toMatchObject({ ok: true, rowsWritten: 3 });
    });

    it('qulf xatoda ham ochiladi: runAndLog reject → keyingi chaqiruv 409 EMAS', async () => {
      gexp.runAndLog.mockRejectedValueOnce(new Error('boom'));
      await expect(svc.runExport('s1')).rejects.toThrow('boom');
      gexp.runAndLog.mockResolvedValueOnce({ ok: true, rowsWritten: 1, dateTo: '2026-09-28' });
      await expect(svc.runExport('s1')).resolves.toMatchObject({ ok: true });
    });
  });
});
