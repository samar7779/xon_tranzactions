import { BadRequestException } from '@nestjs/common';
import {
  assertExportId, parseChekFind, parseContracts, parseCrmLookup, parseSheetIds, parseTxApply, parseTxChoice, parseTxRef,
} from './agent-bridge.validation';

const expect400 = (fn: () => unknown, mustNotEcho?: string) => {
  let err: any;
  try { fn(); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(BadRequestException);
  if (mustNotEcho) expect(JSON.stringify(err.getResponse())).not.toContain(mustNotEcho);
};

describe('parseContracts', () => {
  it('bitta shartnoma → UPPERCASE massiv', () => {
    expect(parseContracts('2592VTN26LM')).toEqual(['2592VTN26LM']);
    expect(parseContracts('4120srh26n4')).toEqual(['4120SRH26N4']);
  });
  it('dublikat (registrdan qat\'i nazar) olib tashlanadi, tartib saqlanadi', () => {
    expect(parseContracts('abc1,ABC1')).toEqual(['ABC1']);
    expect(parseContracts('B456,A123,b456')).toEqual(['B456', 'A123']);
  });
  it('bo\'shliq trim, oxirgi bo\'sh token tashlanadi', () => {
    expect(parseContracts('A123, B456 ,')).toEqual(['A123', 'B456']);
  });
  it('3 ta → ruxsat; 4 ta → 400 (dedupe\'dan oldin sanaladi)', () => {
    expect(parseContracts('A11,B22,C33')).toEqual(['A11', 'B22', 'C33']);
    expect400(() => parseContracts('A11,B22,C33,D44'));
    expect400(() => parseContracts('A11,A11,A11,A11'));
  });
  it('uzunlik: 2 belgi → 400; 20 → ok; 21 → 400', () => {
    expect400(() => parseContracts('AB'));
    expect(parseContracts('A'.repeat(20))).toEqual(['A'.repeat(20)]);
    expect400(() => parseContracts('A'.repeat(21)));
  });
  it.each(['ABC-12', 'ABC/12', 'ABC 12', 'АБВ123', "A1B2';--", '%41%42%43', 'ABC_12', 'ABC.12'])(
    'ruxsat etilmagan belgi %p → 400 va xabarda kirish qiymati yo\'q',
    (v) => expect400(() => parseContracts(v), v),
  );
  it.each([
    ['bo\'sh string', ''],
    ['faqat vergul', ','],
    ['faqat bo\'shliq', '   '],
    ['undefined', undefined],
    ['massiv', ['A123']],
    ['raqam', 123],
    ['obyekt', { a: 'A123' }],
    ['201 belgili string', 'A123,'.repeat(40) + 'A'],
  ])('%s → 400', (_n, v) => expect400(() => parseContracts(v as any)));
});

describe('parseSheetIds', () => {
  it('undefined / \'\' → null (hammasi)', () => {
    expect(parseSheetIds(undefined)).toBeNull();
    expect(parseSheetIds('')).toBeNull();
  });
  it('vergul bilan ro\'yxat', () => {
    expect(parseSheetIds('sheet-1,sheet-1723456789012-0')).toEqual(['sheet-1', 'sheet-1723456789012-0']);
    expect(parseSheetIds(' sheet-1 , sheet_2 ,')).toEqual(['sheet-1', 'sheet_2']);
  });
  it('11 ta → 400; 10 ta → ok', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `s${i}`);
    expect(parseSheetIds(ten.join(','))).toHaveLength(10);
    expect400(() => parseSheetIds([...ten, 's10'].join(',')));
  });
  it.each(['../x', 'a b', 'a/b', 'sheet%2F1', 'x'.repeat(81)])('%p → 400', (v) => expect400(() => parseSheetIds(v), v));
  it.each([[['sheet-1']], [123], [','], [null]])('%p → 400', (v) => expect400(() => parseSheetIds(v)));
});

describe('assertExportId', () => {
  it('yaroqli id qaytadi', () => {
    expect(assertExportId('sheet-1723456789012-0')).toBe('sheet-1723456789012-0');
    expect(assertExportId('sheet-1')).toBe('sheet-1');
    expect(assertExportId('x'.repeat(80))).toBe('x'.repeat(80));
  });
  it.each(['', '../etc', 'a/b', 'a b', 'x'.repeat(81), 'sheet-1\n'])('%p → 400', (v) => expect400(() => assertExportId(v)));
  it.each([[undefined], [null], [['sheet-1']], [1]])('%p → 400', (v) => expect400(() => assertExportId(v)));
});

describe('parseCrmLookup', () => {
  const ID = '3734765350_2730_22.12.2025_20208000305742909002_22696000905500044001_200000000_-';
  it('kompozit ID + ixtiyoriy sana/summa', () => {
    expect(parseCrmLookup(ID, undefined, undefined)).toEqual({ id: ID, date: null, amount: null });
    expect(parseCrmLookup('IP_' + ID, '2025-12-22', '2000000.50')).toEqual({ id: 'IP_' + ID, date: '2025-12-22', amount: 2000000.5 });
    // chiqim to'lovi: sign '+'
    const CHIQIM = ID.replace(/_-$/, '_+');
    expect(parseCrmLookup(CHIQIM, undefined, undefined).id).toBe(CHIQIM);
    expect(parseTxRef(CHIQIM)).toBe(CHIQIM);
  });
  it.each([
    [undefined], [''], ['12345678'], ['abc'], ['a_b c_d_e_f'], ["x'; DROP_TABLE"], ['_' + 'x'.repeat(10)], ['a_' + 'x'.repeat(200)],
  ])('yaroqsiz id %p → 400', (id) => {
    expect(() => parseCrmLookup(id, undefined, undefined)).toThrow(BadRequestException);
  });
  it('yaroqsiz sana/summa → 400', () => {
    expect(() => parseCrmLookup(ID, '22.12.2025', undefined)).toThrow(BadRequestException);
    expect(() => parseCrmLookup(ID, undefined, '-5')).toThrow(BadRequestException);
    expect(() => parseCrmLookup(ID, undefined, '0')).toThrow(BadRequestException);
    expect(() => parseCrmLookup(ID, undefined, ['1'])).toThrow(BadRequestException);
  });
});

describe('parseChekFind', () => {
  it('order majburiy; qolganlari ixtiyoriy, shartnoma UPPERCASE', () => {
    expect(parseChekFind({ order: '10904304' })).toEqual({ orderNo: '10904304', amount: null, date: null, recipientAccount: null, contractNo: null });
    expect(parseChekFind({ order: '10904304', amount: '8132000', date: '2026-09-29', account: '29824000300001188002', contract: 'abc123' }))
      .toEqual({ orderNo: '10904304', amount: 8132000, date: '2026-09-29', recipientAccount: '29824000300001188002', contractNo: 'ABC123' });
  });
  it.each([
    [{}], [{ order: '' }], [{ order: 'A1' }], [{ order: '1'.repeat(31) }], [{ order: ['1'] }],
    [{ order: '1', amount: '1,5' }], [{ order: '1', date: '29.09.2026' }], [{ order: '1', account: '12AB' }],
    [{ order: '1', contract: 'a-b' }],
  ])('yaroqsiz %p → 400', (q) => {
    expect(() => parseChekFind(q as any)).toThrow(BadRequestException);
  });
});

describe('tx-edit validatsiya', () => {
  it('tx ref, qiymatlar va apply body', () => {
    expect(parseTxRef('ck3q9x0000abcd')).toBe('ck3q9x0000abcd');
    expect(() => parseTxRef('a b')).toThrow(BadRequestException);
    expect(() => parseTxRef(['x'])).toThrow(BadRequestException);
    expect(parseTxChoice({ kontragent: '', kategoriya: ' Взносы за квартиры ', shartnoma: undefined }))
      .toEqual({ kontragent: null, kategoriya: 'Взносы за квартиры', shartnoma: null });
    expect(() => parseTxChoice({ shartnoma: 'x'.repeat(81) })).toThrow(BadRequestException);
    expect(() => parseTxChoice({ shartnoma: 'a\nb' })).toThrow(BadRequestException);
    expect(parseTxApply({ items: [{ tx: 'ck3q9x0000abcd', shartnoma: 'X1' }], approvedBy: ' Samar ' }))
      .toEqual({ items: [{ tx: 'ck3q9x0000abcd', kontragent: null, kategoriya: null, shartnoma: 'X1' }], approvedBy: 'Samar', comment: null });
    for (const bad of [null, 'x', { items: 'x', approvedBy: 'Samar' }, { items: [null], approvedBy: 'Samar' },
      { items: [{ tx: 'ck3q9x0000abcd' }], approvedBy: 'Samar', comment: 5 }]) {
      expect(() => parseTxApply(bad)).toThrow(BadRequestException);
    }
  });
});
