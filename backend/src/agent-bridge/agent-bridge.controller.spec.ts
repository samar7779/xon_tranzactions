import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest'; // @types/supertest yo'q → any (esModuleInterop default import)
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuditService } from '../audit/audit.service';
import { AgentBridgeController } from './agent-bridge.controller';
import { AgentBridgeGuard } from './agent-bridge.guard';
import { AgentBridgeService } from './agent-bridge.service';

/**
 * HTTP darajasi: global prefix + ValidationPipe (main.ts bilan bir xil) + guard + global audit.
 * supertest 127.0.0.1 orqali ulanadi → loopback sharti o'z-o'zidan bajariladi
 * (non-loopback holati guard.spec'da).
 */
describe('AgentBridgeController (HTTP)', () => {
  const KEY = 'k'.repeat(64);
  const H = 'x-agent-bridge-key';
  let app: INestApplication;
  const svcMock = {
    paymentCheck: jest.fn(async () => ({ ok: true, results: [] })),
    listExports: jest.fn(async () => ({ ok: true, credentialsAvailable: true, items: [] })),
    runExport: jest.fn(async (id: string) => ({ ok: true, sheet: { id, name: 'N', tabName: 'T' } })),
    crmLookup: jest.fn(async () => ({ ok: true, via: null, checkedDate: null, exact: [], sameAmount: [] })),
    chekFind: jest.fn(async () => ({ ok: true, result: 'not_found', conditions: null, tx: null })),
  };
  const auditMock = { record: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentBridgeController],
      providers: [
        AgentBridgeGuard,
        { provide: AgentBridgeService, useValue: svcMock },
        { provide: ConfigService, useValue: { get: (k: string) => (k === 'AGENT_BRIDGE_KEY' ? KEY : undefined) } },
        { provide: AuditService, useValue: auditMock },
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true },
    }));
    await app.init();
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());

  it('GET exports: kalitsiz → 403 (bir xil javob); kalit bilan → 200', async () => {
    const denied = await http().get('/api/agent-bridge/exports');
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Forbidden');
    expect(svcMock.listExports).not.toHaveBeenCalled();

    const ok = await http().get('/api/agent-bridge/exports').set(H, KEY);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, credentialsAvailable: true, items: [] });
  });

  it('noto\'g\'ri kalit → 403, javob kalitsiz holat bilan bir xil', async () => {
    const a = await http().get('/api/agent-bridge/exports').set(H, 'w'.repeat(64));
    const b = await http().get('/api/agent-bridge/exports');
    expect(a.status).toBe(403);
    expect(a.body).toEqual(b.body);
  });

  it.each([
    ['X-Forwarded-For', '1.2.3.4'],
    ['X-Real-IP', '1.2.3.4'],
    ['Forwarded', 'for=1.2.3.4'],
    ['X-Forwarded-Proto', 'https'],
  ])('kalit + %s → 403 (nginx orqali)', async (name, value) => {
    const r = await http().get('/api/agent-bridge/exports').set(H, KEY).set(name, value);
    expect(r.status).toBe(403);
    expect(svcMock.listExports).not.toHaveBeenCalled();
  });

  it('JWT Bearer bo\'lsa ham kalitsiz → 403', async () => {
    const r = await http().get('/api/agent-bridge/exports').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x');
    expect(r.status).toBe(403);
  });

  it('GET payment-check → servis (UPPERCASE, dublikatsiz) contracts + sheetIds bilan', async () => {
    const r = await http().get('/api/agent-bridge/payment-check?contracts=a123,B456,A123').set(H, KEY);
    expect(r.status).toBe(200);
    expect(svcMock.paymentCheck).toHaveBeenCalledWith(['A123', 'B456'], undefined);

    await http().get('/api/agent-bridge/payment-check?contracts=A123&sheetIds=sheet-1').set(H, KEY);
    expect(svcMock.paymentCheck).toHaveBeenLastCalledWith(['A123'], 'sheet-1');
  });

  it.each([
    'contracts=A1,B2,C3,D4',
    'contracts=A123&contracts=B456',
    'contracts=ABC-12',
    'contracts=',
    '',
  ])('payment-check?%s → 400, servis chaqirilmaydi', async (qs) => {
    const r = await http().get(`/api/agent-bridge/payment-check?${qs}`).set(H, KEY);
    expect(r.status).toBe(400);
    expect(svcMock.paymentCheck).not.toHaveBeenCalled();
  });

  const KOMP = '3734765350_2730_22.12.2025_20208000305742909002_22696000905500044001_200000000_-';
  it('GET crm-lookup: kalitsiz 403; kalit bilan servisga tozalangan qiymatlar; audit yozilmaydi (GET)', async () => {
    expect((await http().get(`/api/agent-bridge/crm-lookup?id=${KOMP}`)).status).toBe(403);
    const r = await http().get(`/api/agent-bridge/crm-lookup?id=${KOMP}&date=2025-12-22&amount=2000000`).set(H, KEY);
    expect(r.status).toBe(200);
    expect(svcMock.crmLookup).toHaveBeenCalledWith(KOMP, '2025-12-22', 2000000);
    expect(auditMock.record).not.toHaveBeenCalled();
  });

  it.each(['', 'id=12345678', `id=${KOMP}&date=22.12.2025`, `id=${KOMP}&id=${KOMP}`])('crm-lookup?%s → 400', async (qs) => {
    const r = await http().get(`/api/agent-bridge/crm-lookup?${qs}`).set(H, KEY);
    expect(r.status).toBe(400);
    expect(svcMock.crmLookup).not.toHaveBeenCalled();
  });

  it('GET chek-find: kalit bilan servisga, order majburiy', async () => {
    const r = await http().get('/api/agent-bridge/chek-find?order=10904304&amount=8132000&date=2026-09-29').set(H, KEY);
    expect(r.status).toBe(200);
    expect(svcMock.chekFind).toHaveBeenCalledWith({ orderNo: '10904304', amount: 8132000, date: '2026-09-29', recipientAccount: null, contractNo: null });
    expect((await http().get('/api/agent-bridge/chek-find?amount=8132000').set(H, KEY)).status).toBe(400);
    expect((await http().get('/api/agent-bridge/chek-find?order=10904304')).status).toBe(403);
    expect(svcMock.chekFind).toHaveBeenCalledTimes(1);
  });

  it('POST run → 200 va audit (actor: agent-bridge) yoziladi', async () => {
    const r = await http().post('/api/agent-bridge/exports/sheet-1723456789012-0/run').set(H, KEY);
    expect(r.status).toBe(200);
    expect(svcMock.runExport).toHaveBeenCalledWith('sheet-1723456789012-0');
    expect(auditMock.record).toHaveBeenCalledTimes(1);
    expect(auditMock.record).toHaveBeenCalledWith(expect.objectContaining({
      userId: null,
      userEmail: 'agent-bridge',
      userName: 'agent-bridge',
      method: 'POST',
      module: 'agent-bridge',
      action: 'Agent: Google eksport ishga tushirildi',
      path: '/api/agent-bridge/exports/sheet-1723456789012-0/run',
      success: true,
    }));
  });

  it('POST run: body e\'tiborga olinmaydi (target yuborib bo\'lmaydi)', async () => {
    const r = await http().post('/api/agent-bridge/exports/sheet-1/run').set(H, KEY).send({ target: { spreadsheetId: 'EVIL' } });
    expect(r.status).toBe(200);
    expect(svcMock.runExport).toHaveBeenCalledWith('sheet-1');
    expect(svcMock.runExport.mock.calls[0]).toHaveLength(1);
  });

  it('POST run kalitsiz → 403 va audit YOZILMAYDI, servis chaqirilmaydi', async () => {
    const r = await http().post('/api/agent-bridge/exports/sheet-1/run');
    expect(r.status).toBe(403);
    expect(auditMock.record).not.toHaveBeenCalled();
    expect(svcMock.runExport).not.toHaveBeenCalled();
  });

  it.each(['..%2Fx', 'a%20b', `${'x'.repeat(81)}`])('POST exports/%s/run → 400', async (id) => {
    const r = await http().post(`/api/agent-bridge/exports/${id}/run`).set(H, KEY);
    expect(r.status).toBe(400);
    expect(svcMock.runExport).not.toHaveBeenCalled();
  });

  it('GET run yo\'q (faqat POST) → 404', async () => {
    const r = await http().get('/api/agent-bridge/exports/sheet-1/run').set(H, KEY);
    expect(r.status).toBe(404);
  });

  it('metadata: faqat AgentBridgeGuard (JwtAuthGuard yo\'q)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentBridgeController)).toEqual([AgentBridgeGuard]);
  });
});
