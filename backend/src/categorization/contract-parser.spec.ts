import { extractContractCandidates, extractContractNumber, objectCodeOf, stripGluedOt, lookalikeVariants } from './contract-parser';

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

  // ── "сонли / sonli" to'ldiruvchi so'zi (10.10.2026 real xato) ──
  // Bank izohi: "№006AFS сонли шартнома бўйича". Transliteratsiya ko'rinish
  // bo'yicha (С→C, О→O, Н→H) ishlagani uchun "сон" → "COH" bo'lib, regexning
  // dum qismi uni yutib yuborgan va "006AFSCOH" degan MAVJUD BO'LMAGAN
  // shartnoma yaratilgan. 218 ta to'lov shunga biriktirilib qolgan edi.
  describe("to'ldiruvchi so'z raqamga qo'shilmasin", () => {
    it('kirillcha "сонли" dumga aylanmaydi', () => {
      expect(extractContractNumber('№006AFS сонли шартнома бўйича')).not.toBe('006AFSCOH');
      expect(extractContractCandidates('№006AFS сонли шартнома')).not.toContain('006AFSCOH');
    });

    it('lotincha "SONLI" dumga aylanmaydi', () => {
      expect(extractContractNumber('020SLQ SONLI shartnoma')).not.toBe('020SLQSONLI');
      expect(extractContractCandidates('020SLQ SONLI shartnoma')).not.toContain('020SLQSONLI');
    });

    it("to'ldiruvchidan KEYINGI haqiqiy dum topiladi", () => {
      // "сонли" olib tashlangach "1689ZUR 24NU" qoladi
      expect(extractContractNumber('№1689ZUR сонли 24NU шартнома')).toBe('1689ZUR24NU');
    });

    it("haqiqiy raqamlarga tegmaydi", () => {
      expect(extractContractNumber('oplata 1689ZUR24NU uchun')).toBe('1689ZUR24NU');
      expect(extractContractNumber('dogovor 2118MSO252P ot 10.05.2026')).toBe('2118MSO252P');
      // "SON" so'z ichida bo'lsa kesilmaydi (masalan ism/so'z tarkibida)
      expect(extractContractNumber('150VTN23CV SONIROV')).toBe('150VTN23CV');
    });
  });

  // Kirill shakl/tovush adashuvi (10.10.2026 real xato):
  // arizada "413VTN23НХ" (kirill Н), AI tovushga qarab "413VTN23NX" qaytargan.
  describe('lookalikeVariants', () => {
    it("N <-> H almashtiradi (413VTN23NX -> 413VTN23HX)", () => {
      expect(lookalikeVariants('413VTN23NX')).toContain('413VTN23HX');
    });

    it('qolgan juftlar: R<->P, V<->B, S<->C', () => {
      expect(lookalikeVariants('100ORZ23RA')).toContain('100OPZ23PA');
      expect(lookalikeVariants('1VDY24VB')).toContain('1BDY24BV');
      expect(lookalikeVariants('5SLQ22SC')).toContain('5CLQ22CS');
    });

    it("originalning o'zi qaytmaydi", () => {
      expect(lookalikeVariants('413VTN23NX')).not.toContain('413VTN23NX');
    });

    it("almashtiriladigan harf bo'lmasa bo'sh", () => {
      expect(lookalikeVariants('1234')).toEqual([]);
      expect(lookalikeVariants('')).toEqual([]);
    });

    it("kombinatsiya portlamaydi (chegara)", () => {
      expect(lookalikeVariants('NHRPVBSCNHRP').length).toBeLessThanOrEqual(64);
    });
  });
});
