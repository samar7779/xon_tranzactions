import { extractContractCandidates, objectCodeOf, stripGluedOt } from './contract-parser';

describe('contract-parser', () => {
  describe('yopishgan "от/OT" (egasi qoidasi, 2026-10-05)', () => {
    it('2118MSO252POT → asosiy + kesilgan nomzod (asosiydan keyin darrov)', () => {
      expect(extractContractCandidates('Oplata po dogovoru 2118MSO252POT 10.05.2026')).toEqual(
        expect.arrayContaining(['2118MSO252POT', '2118MSO252P']),
      );
      expect(extractContractCandidates('Oplata po dogovoru 2118MSO252POT 10.05.2026').slice(0, 2))
        .toEqual(['2118MSO252POT', '2118MSO252P']);
    });

    it('kirill "от", katta-kichik harf, ortidan yopishgan sana', () => {
      for (const izoh of [
        'Оплата по договору №2118MSO252Pот 10.05.2026',
        'Оплата по договору №2118MSO252PОТ',
        'договор 2118MSO252Pot10.05.2026',
      ]) {
        const c = extractContractCandidates(izoh);
        expect(c[0]).toBe('2118MSO252POT');
        expect(c).toContain('2118MSO252P');
      }
    });

    it('"от" bo\'shliq bilan bo\'lsa asosiy o\'zi to\'g\'ri; OT bo\'lmasa kesilgan nomzod yo\'q', () => {
      expect(extractContractCandidates('dogovor 2118MSO252P от 10.05.2026')[0]).toBe('2118MSO252P');
      expect(extractContractCandidates('dogovor 217AFS24YL za kv')).not.toContain('217AFS24');
    });

    it('stripGluedOt: kesilgani to\'liq raqam formatida bo\'lishi shart', () => {
      expect(stripGluedOt('2118MSO252POT')).toBe('2118MSO252P');
      expect(stripGluedOt('2118MSO252POT10')).toBe('2118MSO252P');
      expect(stripGluedOt('2118MSO252POTX')).toBeNull();     // OT dan keyin harf — "от" emas
      expect(stripGluedOt('2118MSOT')).toBeNull();           // kesilsa dum qolmaydi
      expect(stripGluedOt('217AFS24YL')).toBeNull();
    });
  });

  it('objectCodeOf: kanonik obyekt kodi (O/0/О)', () => {
    expect(objectCodeOf('2118MS0252P')).toBe('MSO');
    expect(objectCodeOf('217AFS24YL')).toBe('AFS');
    expect(objectCodeOf('XATO')).toBeNull();
    expect(objectCodeOf(null)).toBeNull();
  });
});
