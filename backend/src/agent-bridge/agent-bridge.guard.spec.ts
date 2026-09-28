import { ForbiddenException, Logger } from '@nestjs/common';
import { AgentBridgeGuard, safeKeyEqual, isKeyConfigured } from './agent-bridge.guard';

/**
 * AgentBridgeGuard — ko'prikning yagona himoyasi (JWT yo'q). Kalitsiz / noto'g'ri kalit /
 * qisqa kalit / proxy header / loopback emas → 403; to'g'ri holat → o'tadi.
 */
describe('AgentBridgeGuard', () => {
  const KEY = 'k'.repeat(64);
  let warnSpy: jest.SpyInstance;

  // Default parametr EMAS — mkGuard(undefined) aynan "env kalit yo'q" holatini bersin.
  const mkGuard = (...args: [envKey?: string | undefined]) => {
    const envKey = args.length ? args[0] : KEY;
    return new AgentBridgeGuard({ get: (k: string) => (k === 'AGENT_BRIDGE_KEY' ? envKey : undefined) } as any);
  };
  const mkCtx = (req: any, type = 'http') =>
    ({ getType: () => type, switchToHttp: () => ({ getRequest: () => req }) }) as any;
  const mkReq = (over: { headers?: Record<string, any>; remoteAddress?: string | undefined } = {}) => ({
    method: 'GET',
    url: '/api/agent-bridge/exports',
    originalUrl: '/api/agent-bridge/exports',
    headers: over.headers ?? { 'x-agent-bridge-key': KEY },
    socket: { remoteAddress: 'remoteAddress' in over ? over.remoteAddress : '127.0.0.1' },
  });

  /** Rad etilishini va javob BIR XIL ekanini (oracle yo'q) tekshiradi. */
  const expectForbidden = (guard: AgentBridgeGuard, req: any) => {
    let err: any;
    try { guard.canActivate(mkCtx(req)); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.getResponse()).toEqual(new ForbiddenException('Forbidden').getResponse());
    expect(req.user).toBeUndefined(); // rad etilganda actor o'rnatilmaydi
  };

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warnSpy.mockRestore());

  // ── to'g'ri holat ──
  it("to'g'ri kalit + loopback + proxy-header yo'q → o'tadi, req.user = agent-bridge", () => {
    const req: any = mkReq();
    expect(mkGuard().canActivate(mkCtx(req))).toBe(true);
    expect(req.user).toMatchObject({ id: null, email: 'agent-bridge', fullName: 'agent-bridge', role: 'AGENT_BRIDGE' });
  });

  it.each(['::1', '::ffff:127.0.0.1'])('loopback %s → o\'tadi', (ra) => {
    const req: any = mkReq({ remoteAddress: ra });
    expect(mkGuard().canActivate(mkCtx(req))).toBe(true);
  });

  it('env kalitdagi bo\'shliqlar trim qilinadi (header toza kalit) → o\'tadi', () => {
    const req: any = mkReq();
    expect(mkGuard(`  ${KEY}\n`).canActivate(mkCtx(req))).toBe(true);
  });

  // ── (a) kalit sozlanmagan / qisqa ──
  it.each([
    ['yo\'q', undefined],
    ['bo\'sh', ''],
    ['31 belgi', 'k'.repeat(31)],
    ['faqat bo\'shliqlar', ' '.repeat(40)],
  ])('env kalit %s → 403 (header\'da xuddi shu qiymat bo\'lsa ham)', (_n, envKey) => {
    const guard = mkGuard(envKey as any);
    expectForbidden(guard, mkReq({ headers: { 'x-agent-bridge-key': envKey ?? '' } }));
    expectForbidden(guard, mkReq());
  });

  // ── kalitsiz / noto'g'ri kalit ──
  it('header yo\'q → 403', () => {
    expectForbidden(mkGuard(), mkReq({ headers: {} }));
  });
  it('header bo\'sh → 403', () => {
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': '' } }));
  });
  it('header massiv (takroriy) → 403', () => {
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': [KEY, KEY] } }));
  });
  it('noto\'g\'ri kalit, bir xil uzunlik (oxirgi belgi farqli) → 403', () => {
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': 'k'.repeat(63) + 'x' } }));
  });
  it('noto\'g\'ri kalit, boshqa uzunlik → 403 (throw emas)', () => {
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': 'short' } }));
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': KEY + 'k' } }));
  });

  // ── (b) nginx orqali kelgan (proxy headerlar) ──
  it.each([
    ['x-forwarded-for', '1.2.3.4'],
    ['x-forwarded-for', ''],
    ['x-real-ip', '1.2.3.4'],
    ['forwarded', 'for=1.2.3.4'],
    ['x-forwarded-proto', 'https'],
    ['x-forwarded-host', 'transactions.xonapps.uz'],
  ])('to\'g\'ri kalit + %s="%s" → 403', (name, value) => {
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': KEY, [name]: value } }));
  });

  // ── (c) loopback emas ──
  it.each(['10.0.0.5', '127.0.0.2', '::ffff:10.0.0.5', '185.228.88.247', undefined])('remoteAddress %s → 403', (ra) => {
    expectForbidden(mkGuard(), mkReq({ remoteAddress: ra as any }));
  });

  it('http bo\'lmagan kontekst → 403', () => {
    expect(() => mkGuard().canActivate(mkCtx(mkReq(), 'rpc'))).toThrow(ForbiddenException);
  });

  // ── log'ga kalit tushmaydi ──
  it('rad etish log\'ida kalit qiymatlari yo\'q', () => {
    const WRONG = 'w'.repeat(64);
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': WRONG } }));
    expectForbidden(mkGuard(), mkReq({ headers: { 'x-agent-bridge-key': KEY, 'x-forwarded-for': '1.2.3.4' } }));
    expect(warnSpy).toHaveBeenCalled();
    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain(WRONG);
  });

  // ── rejectReason tartibi (ichki, faqat log uchun) ──
  it('kalit sozlanmagan bo\'lsa proxy-header bo\'lsa ham sabab key-not-configured', () => {
    const req = mkReq({ headers: { 'x-forwarded-for': '1.2.3.4' }, remoteAddress: '10.0.0.5' });
    expect(mkGuard('').rejectReason(req)).toBe('key-not-configured');
  });
  it('sabablar: proxy-header → not-loopback → no-key → bad-key → null', () => {
    const g = mkGuard();
    expect(g.rejectReason(mkReq({ headers: { 'x-real-ip': '1.1.1.1' }, remoteAddress: '10.0.0.5' }))).toBe('proxy-header:x-real-ip');
    expect(g.rejectReason(mkReq({ headers: {}, remoteAddress: '10.0.0.5' }))).toBe('not-loopback');
    expect(g.rejectReason(mkReq({ headers: {} }))).toBe('no-key');
    expect(g.rejectReason(mkReq({ headers: { 'x-agent-bridge-key': 'nope' } }))).toBe('bad-key');
    expect(g.rejectReason(mkReq())).toBeNull();
  });
});

describe('safeKeyEqual / isKeyConfigured', () => {
  it('teng → true; farqli (shu jumladan farqli uzunlik) → false, throw qilmaydi', () => {
    expect(safeKeyEqual('a'.repeat(40), 'a'.repeat(40))).toBe(true);
    expect(safeKeyEqual('a'.repeat(40), 'a'.repeat(39) + 'b')).toBe(false);
    expect(() => safeKeyEqual('a', 'a'.repeat(64))).not.toThrow();
    expect(safeKeyEqual('a', 'a'.repeat(64))).toBe(false);
    expect(safeKeyEqual('', 'a'.repeat(64))).toBe(false);
  });
  it('isKeyConfigured: >= 32 belgi (trim\'dan keyin)', () => {
    expect(isKeyConfigured(undefined)).toBe(false);
    expect(isKeyConfigured('')).toBe(false);
    expect(isKeyConfigured('x'.repeat(31))).toBe(false);
    expect(isKeyConfigured(`  ${'x'.repeat(31)}  `)).toBe(false);
    expect(isKeyConfigured('x'.repeat(32))).toBe(true);
  });
});
