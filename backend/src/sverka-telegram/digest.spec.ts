import { renderDigest, faultLabel, fmtNum, DigestAccount } from './digest';

describe('sverka digest render', () => {
  const nowTk = '20.08.2026 14:30';
  const date = '2026-08-20';

  it('bo\'sh ro\'yxat → text bo\'sh (xabar o\'chiriladi)', () => {
    const r = renderDigest([], date, nowTk);
    expect(r.count).toBe(0);
    expect(r.text).toBe('');
    expect(r.keyboard.inline_keyboard).toEqual([]);
  });

  it('faultLabel — faqat confidence=high da aniq ayb', () => {
    expect(faultLabel('bank', 'high')).toContain('bank');
    expect(faultLabel('us', 'high')).toContain('biz');
    expect(faultLabel('mixed', 'high')).toContain('aralash');
    // ishonch past → noaniq (noto'g'ri ayb aytmaydi)
    expect(faultLabel('bank', 'low')).toContain('noaniq');
    expect(faultLabel('us', 'medium')).toContain('noaniq');
    expect(faultLabel('unknown', 'high')).toContain('noaniq');
  });

  it('farq bo\'yicha kamayish tartibida saralanadi', () => {
    const accounts: DigestAccount[] = [
      { accountId: 'a', accountNo: '111', totalFarq: 500000, culprit: 'bank', confidence: 'high', actionable: true, actionKind: 'ai' },
      { accountId: 'b', accountNo: '222', totalFarq: 2500000, culprit: 'us', confidence: 'high', actionable: true, actionKind: 'ai' },
      { accountId: 'c', accountNo: '333', totalFarq: 1200000, culprit: 'bank', confidence: 'low', actionable: false },
    ];
    const r = renderDigest(accounts, date, nowTk);
    expect(r.count).toBe(3);
    // eng katta (222) birinchi, keyin 333, keyin 111
    const i222 = r.text.indexOf('222');
    const i333 = r.text.indexOf('333');
    const i111 = r.text.indexOf('111');
    expect(i222).toBeLessThan(i333);
    expect(i333).toBeLessThan(i111);
  });

  it('tugmalar — faqat actionable hisoblar uchun, to\'g\'ri callback', () => {
    const accounts: DigestAccount[] = [
      { accountId: 'acc1', accountNo: '111', totalFarq: 2000000, actionable: true, actionKind: 'ai' },
      { accountId: 'acc2', accountNo: '222', totalFarq: 1000000, actionable: false },
      { accountId: 'acc3', accountNo: '333', totalFarq: 500000, actionable: true, actionKind: 'add' },
    ];
    const r = renderDigest(accounts, date, nowTk);
    const flat = r.keyboard.inline_keyboard.flat();
    const applyBtn = flat.find((b: any) => b.callback_data === `apply:acc1:${date}`);
    const fixBtn = flat.find((b: any) => b.callback_data === `fix:acc3:${date}`);
    expect(applyBtn).toBeTruthy();
    expect(applyBtn.text).toBe('✅ 1'); // 1-o'rinda (eng katta farq)
    expect(fixBtn).toBeTruthy();
    // acc2 actionable emas — tugmasi yo'q
    expect(flat.find((b: any) => String(b.callback_data).includes('acc2'))).toBeUndefined();
    // oxirgi qator: Yangilash + Yopish
    expect(flat.find((b: any) => b.callback_data === `refresh:${date}`)).toBeTruthy();
    expect(flat.find((b: any) => b.callback_data === `closeall:${date}`)).toBeTruthy();
  });

  it('maxRows — ko\'p hisob qisqartiriladi va "yana N ta" ko\'rsatiladi', () => {
    const accounts: DigestAccount[] = Array.from({ length: 40 }, (_, i) => ({
      accountId: `a${i}`, accountNo: String(1000 + i), totalFarq: (40 - i) * 1000, actionable: false,
    }));
    const r = renderDigest(accounts, date, nowTk, { maxRows: 30 });
    expect(r.count).toBe(40);
    expect(r.text).toContain('yana <b>10</b> ta');
  });

  it('callback_data 64 bayt limitidan oshmaydi (cuid uzunligida ham)', () => {
    const accounts: DigestAccount[] = [
      { accountId: 'clh3k9xyz0000abcd1234wxyz', accountNo: '111', totalFarq: 1000000, actionable: true, actionKind: 'ai' },
    ];
    const r = renderDigest(accounts, date, nowTk);
    for (const btn of r.keyboard.inline_keyboard.flat()) {
      expect(Buffer.byteLength(String(btn.callback_data), 'utf8')).toBeLessThanOrEqual(64);
    }
  });

  it('fmtNum — ru formatlash (bo\'shliq bilan ajratiladi)', () => {
    // ru-RU guruh ajratgichi NBSP bo'lishi mumkin — bo'shliqni normallashtirib solishtiramiz
    expect(fmtNum(2500000).replace(/\s/g, ' ')).toBe('2 500 000');
    expect(fmtNum(0)).toBe('0');
    expect(fmtNum(undefined)).toBe('0');
  });
});
