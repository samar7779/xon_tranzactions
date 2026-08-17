import { SverkaAgentService } from './sverka-agent.service';

/**
 * buildProposedActions — Sverka agentining XAVFSIZLIK yadrosi: tuzatish targetlari
 * FAQAT diagnose'dan quriladi (agent o'ylab topmaydi). Bu testlar tasnif to'g'riligini
 * qotiradi (regressiya himoyasi).
 */
describe('SverkaAgentService.buildProposedActions', () => {
  // Injected deps ishlatilmaydi (sof mantiq) — dummy o'tkazamiz.
  const svc = new SverkaAgentService({} as any, {} as any, {} as any, {} as any);
  const build = (diag: any, date: string) => (svc as any).buildProposedActions(diag, date);
  const DATE = '2026-08-17';

  it('bankOnly (b2Id bor) → addMissing', () => {
    const r = build({ bankOnly: [{ b2Id: 'B1', amount: 1000, direction: 'IN', docNumber: '5', fromName: 'X', purpose: 'p' }], dbOnly: [], amountMismatch: [] }, DATE);
    expect(r.addMissing).toHaveLength(1);
    expect(r.addMissing[0]).toMatchObject({ b2Id: 'B1', amount: 1000, direction: 'IN' });
    expect(r.fixDates).toHaveLength(0);
    expect(r.fixAmounts).toHaveLength(0);
    expect(r.unresolved).toHaveLength(0);
  });

  it('bankOnly, b2Id/generalId yo\'q → qo\'shilmaydi (target yo\'q)', () => {
    const r = build({ bankOnly: [{ amount: 100, direction: 'IN' }], dbOnly: [], amountMismatch: [] }, DATE);
    expect(r.addMissing).toHaveLength(0);
  });

  it('bankOnly + existsOnDate → fixDates (yangi sana = sverka kuni)', () => {
    const r = build({ bankOnly: [{ b2Id: 'B2', amount: 500, existsOnDate: '2026-08-14', existingTxId: 'T2' }], dbOnly: [], amountMismatch: [] }, DATE);
    expect(r.addMissing).toHaveLength(0); // existsOnDate → dublikat bo'lmasin, qo'shilmaydi
    expect(r.fixDates).toHaveLength(1);
    expect(r.fixDates[0]).toMatchObject({ txId: 'T2', newDate: DATE, fromDate: '2026-08-14' });
  });

  it('bankOnly + existsOnDate === sverka kuni → fixDates YO\'Q', () => {
    const r = build({ bankOnly: [{ b2Id: 'B9', amount: 500, existsOnDate: DATE, existingTxId: 'T9' }], dbOnly: [], amountMismatch: [] }, DATE);
    expect(r.fixDates).toHaveLength(0);
  });

  it('dbOnly + foundOnBankDate → fixDates (yangi sana = bank qo\'shni kuni)', () => {
    const r = build({ bankOnly: [], dbOnly: [{ id: 'T3', amount: 700, foundOnBankDate: '2026-08-18' }], amountMismatch: [] }, DATE);
    expect(r.fixDates).toHaveLength(1);
    expect(r.fixDates[0]).toMatchObject({ txId: 'T3', newDate: '2026-08-18', fromDate: DATE });
    expect(r.unresolved).toHaveLength(0);
  });

  it('dbOnly, neighbor yo\'q → unresolved (avto-tuzatib bo\'lmaydi)', () => {
    const r = build({ bankOnly: [], dbOnly: [{ id: 'T4', amount: 900 }], amountMismatch: [] }, DATE);
    expect(r.unresolved).toHaveLength(1);
    expect(r.fixDates).toHaveLength(0);
    expect(r.addMissing).toHaveLength(0);
  });

  it('amountMismatch → fixAmounts (yangi summa = BANK summasi)', () => {
    const r = build({ bankOnly: [], dbOnly: [], amountMismatch: [{ txId: 'T5', bankAmount: 1500, dbAmount: 1400, diff: 100, direction: 'IN' }] }, DATE);
    expect(r.fixAmounts).toHaveLength(1);
    expect(r.fixAmounts[0]).toMatchObject({ txId: 'T5', newAmount: 1500, dbAmount: 1400 });
  });

  it('bo\'sh diagnose → hammasi bo\'sh', () => {
    const r = build({ bankOnly: [], dbOnly: [], amountMismatch: [] }, DATE);
    expect(r.addMissing).toHaveLength(0);
    expect(r.fixDates).toHaveLength(0);
    expect(r.fixAmounts).toHaveLength(0);
    expect(r.unresolved).toHaveLength(0);
  });

  it('null/undefined maydonlar → yiqilmaydi', () => {
    const r = build({}, DATE);
    expect(r.addMissing).toHaveLength(0);
    expect(r.unresolved).toHaveLength(0);
  });
});
