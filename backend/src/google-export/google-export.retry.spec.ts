import { isTransientGoogleError, withRetry, formatExportFailureAlert } from './google-export.retry';
import { GoogleExportService, SheetTarget } from './google-export.service';

const noSleep = () => Promise.resolve();
const gErr = (status: number, message = 'x') =>
  Object.assign(new Error(message), { response: { status, data: { error: { message } } } });

describe('isTransientGoogleError', () => {
  it.each([429, 500, 502, 503, 504])('HTTP %s → vaqtinchalik', (s) => {
    expect(isTransientGoogleError(gErr(s))).toBe(true);
  });
  it.each([400, 401, 403, 404])('HTTP %s → doimiy (qayta urinilmaydi)', (s) => {
    expect(isTransientGoogleError(gErr(s, 'The service is currently unavailable'))).toBe(false);
  });
  it('tarmoq kodlari va gaxios raqamli satr kodi', () => {
    expect(isTransientGoogleError(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientGoogleError(Object.assign(new Error('boom'), { code: '503' }))).toBe(true);
    expect(isTransientGoogleError(Object.assign(new Error('nope'), { code: '403' }))).toBe(false);
  });
  it('status yo\'q — matn bo\'yicha', () => {
    expect(isTransientGoogleError(new Error('The service is currently unavailable.'))).toBe(true);
    expect(isTransientGoogleError(new Error('Unable to parse range: Лист1!A2:A'))).toBe(false);
    expect(isTransientGoogleError(null)).toBe(false);
  });
});

describe('withRetry', () => {
  it('vaqtinchalik xatodan keyin muvaffaqiyat — kutish tartibi 2s/5s', async () => {
    const waits: number[] = [];
    let calls = 0;
    const out = await withRetry(async () => {
      calls++;
      if (calls < 3) throw gErr(503, 'The service is currently unavailable.');
      return 'ok';
    }, { sleep: async (ms) => { waits.push(ms); } });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 5000]);
  });

  it('urinishlar tugasa — oxirgi xato tashlanadi (jami 4 urinish)', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw gErr(503); }, { sleep: noSleep })).rejects.toThrow();
    expect(calls).toBe(4);
  });

  it('doimiy xatoda darhol to\'xtaydi', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw gErr(403, 'permission'); }, { sleep: noSleep })).rejects.toThrow('permission');
    expect(calls).toBe(1);
  });
});

describe('formatExportFailureAlert', () => {
  const base = { name: 'Сотув Булими отчети', tabName: 'Лист1', mode: 'cron' as const, error: 'The service is currently unavailable.', nowMs: Date.UTC(2026, 8, 30, 6, 9) };
  it('Toshkent vaqti, bosqich va holat', () => {
    const t = formatExportFailureAlert({ ...base, writeMode: 'replace', step: 'write' });
    expect(t).toContain('30.09.2026 11:09 (avtomatik)');
    expect(t).toContain('Bosqich: sheetga yozish');
    expect(t).toContain("eski ma'lumot o'chirilmagan");
  });
  it('clear bosqichi va upsert uchun boshqa izoh', () => {
    expect(formatExportFailureAlert({ ...base, writeMode: 'replace', step: 'clear' })).toContain('pastdagi eski ortiqcha');
    expect(formatExportFailureAlert({ ...base, writeMode: 'upsert', step: 'write' })).toContain('Upsert rejimi');
  });
});

// ─── run() replace rejimi: avval yozadi, keyin faqat pastki qoldiqni tozalaydi ───
describe('GoogleExportService.run (replace)', () => {
  const target: SheetTarget = {
    id: 'sheet-1', name: 'Test', spreadsheetId: 'SPREAD', tabName: 'Лист1', startRow: 2,
    dateFrom: null, filter: {}, columns: [{ col: 'A', field: 'id' }, { col: 'C', field: 'paymentAmount' }],
  };

  function makeService(sheetsApi: any, rows: any[]) {
    const config = { get: jest.fn(() => undefined) };
    const oplataKv = { getRowsForExport: jest.fn(async () => rows) };
    const svc = new GoogleExportService(config as any, {} as any, oplataKv as any, {} as any, {} as any, {} as any);
    const anySvc = svc as any;
    jest.spyOn(anySvc, 'loadCredentials').mockResolvedValue({ client_email: 'x', private_key: 'y' });
    jest.spyOn(anySvc, 'makeSheetsClient').mockReturnValue(sheetsApi);
    jest.spyOn(anySvc, 'ensureGrid').mockResolvedValue(undefined);
    jest.spyOn(anySvc, 'saveUpsertKeys').mockResolvedValue(undefined);
    jest.spyOn(anySvc, 'saveWrittenIds').mockResolvedValue(undefined);
    return svc;
  }

  function makeApi(order: string[], failWrite?: () => any) {
    return {
      spreadsheets: {
        values: {
          batchUpdate: jest.fn(async (req: any) => {
            order.push('write');
            const f = failWrite?.();
            if (f) throw f;
            return { data: {} };
          }),
          batchClear: jest.fn(async (req: any) => { order.push('clear'); return { data: {} }; }),
        },
      },
    };
  }

  it('yozish tozalashdan OLDIN; tozalash faqat yozilgan qatorlardan pastda', async () => {
    const order: string[] = [];
    const api = makeApi(order);
    const svc = makeService(api, [{ id: 'r1', paymentAmount: 10 }, { id: 'r2', paymentAmount: -5 }]);
    const res: any = await svc.run(target);
    expect(res.ok).toBe(true);
    expect(order).toEqual(['write', 'clear']);
    expect(api.spreadsheets.values.batchClear.mock.calls[0][0].requestBody.ranges).toEqual(["'Лист1'!A4:A", "'Лист1'!C4:C"]);
    expect(res.writtenRange).toBe('Лист1!A2:C3');
  });

  it('ma\'lumot jadval oxirigacha to\'lgan (grid 3 qator) — tozalash CHAQIRILMAYDI, xato yo\'q', async () => {
    // Real holat 30.09: 'Туловлар'!A270009:A — grid 270008 qator, Google "exceeds grid limits" dedi.
    const order: string[] = [];
    const api = makeApi(order);
    const svc = makeService(api, [{ id: 'r1', paymentAmount: 10 }, { id: 'r2', paymentAmount: 5 }]);
    jest.spyOn(svc as any, 'ensureGrid').mockResolvedValue(3); // startRow 2 + 2 qator = 3-qatorgacha
    const res: any = await svc.run(target);
    expect(res.ok).toBe(true);
    expect(order).toEqual(['write']);
    expect(res.clearedRanges).toEqual([]);
  });

  it('pastda eski qatorlar bor (grid 10) — faqat yozilganidan pastini tozalaydi', async () => {
    const order: string[] = [];
    const api = makeApi(order);
    const svc = makeService(api, [{ id: 'r1', paymentAmount: 10 }, { id: 'r2', paymentAmount: 5 }]);
    jest.spyOn(svc as any, 'ensureGrid').mockResolvedValue(10);
    const res: any = await svc.run(target);
    expect(order).toEqual(['write', 'clear']);
    expect(api.spreadsheets.values.batchClear.mock.calls[0][0].requestBody.ranges).toEqual(["'Лист1'!A4:A", "'Лист1'!C4:C"]);
  });

  it('0 qator — faqat startRow dan tozalaydi (avvalgi xulq)', async () => {
    const order: string[] = [];
    const api = makeApi(order);
    const res: any = await makeService(api, []).run(target);
    expect(res.ok).toBe(true);
    expect(order).toEqual(['clear']);
    expect(api.spreadsheets.values.batchClear.mock.calls[0][0].requestBody.ranges).toEqual(["'Лист1'!A2:A", "'Лист1'!C2:C"]);
  });

  it('yozish doimiy yiqilsa — tozalash CHAQIRILMAYDI (sheet bo\'sh qolmaydi)', async () => {
    const order: string[] = [];
    const api = makeApi(order, () => gErr(403, 'The caller does not have permission'));
    const res: any = await makeService(api, [{ id: 'r1', paymentAmount: 1 }]).run(target);
    expect(res).toMatchObject({ ok: false, step: 'write' });
    expect(api.spreadsheets.values.batchClear).not.toHaveBeenCalled();
  });

  it('vaqtinchalik 503 dan keyin qayta urinib yozadi', async () => {
    jest.useFakeTimers();
    try {
      const order: string[] = [];
      let n = 0;
      const api = makeApi(order, () => (++n === 1 ? gErr(503, 'The service is currently unavailable.') : null));
      const p = makeService(api, [{ id: 'r1', paymentAmount: 1 }]).run(target);
      await jest.advanceTimersByTimeAsync(2000);
      const res: any = await p;
      expect(res.ok).toBe(true);
      expect(order).toEqual(['write', 'write', 'clear']);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ─── runAndLog: cron yiqilsa egaga Telegram (soatiga 1 marta), qo'lda — yo'q ───
describe('GoogleExportService.runAndLog ogohlantirish', () => {
  const env: Record<string, string> = { LEADER_BOT_TOKEN: 'TKN', LEADER_TG_ID: '42' };
  const target = { id: 's1', name: 'Сотув', tabName: 'Лист1', writeMode: 'replace' } as any;
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  function svcWith(cfg: Record<string, string>) {
    const prisma = { exportCronLog: { create: jest.fn(async () => ({})) } };
    const svc = new GoogleExportService({ get: (k: string) => cfg[k] } as any, {} as any, {} as any, {} as any, {} as any, prisma as any);
    jest.spyOn(svc, 'run').mockResolvedValue({ ok: false, step: 'write', error: 'The service is currently unavailable.' } as any);
    return svc;
  }
  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    (global as any).fetch = fetchMock;
  });
  afterAll(() => { (global as any).fetch = realFetch; });

  it('cron xatosi → 1 ta xabar egaga; 1 soat ichida takrorlanmaydi', async () => {
    const svc = svcWith(env);
    await svc.runAndLog(target, 'cron', 'cron');
    await svc.runAndLog(target, 'cron', 'cron');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTKN/sendMessage');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('Сотув / Лист1');
  });

  it("qo'lda run xatosi yoki EXPORT_ALERT_ENABLED=0 → xabar yo'q", async () => {
    await svcWith(env).runAndLog(target, 'manual', 'manual:x');
    await svcWith({ ...env, EXPORT_ALERT_ENABLED: '0' }).runAndLog(target, 'cron', 'cron');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Telegram yiqilsa ham runAndLog natijani qaytaradi', async () => {
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));
    const res: any = await svcWith(env).runAndLog(target, 'cron', 'cron');
    expect(res).toMatchObject({ ok: false, step: 'write' });
  });
});
