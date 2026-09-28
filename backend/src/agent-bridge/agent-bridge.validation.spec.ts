import { BadRequestException } from '@nestjs/common';
import { assertExportId, parseContracts, parseSheetIds } from './agent-bridge.validation';

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
