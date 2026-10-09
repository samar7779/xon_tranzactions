import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaService } from '../common/prisma/prisma.service';
import { tashkentKun } from '../common/tashkent';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * TA'MINOT ERP (xontaminot) BILAN MOSLASH
 * ═══════════════════════════════════════════════════════════════════════
 * Manba: "Взаиморасчеты" Google Sheet → ta'minot ERP `public.tulovlar` jadvali
 * (har 2 soatda sync bo'ladi). U yerda har to'lov uchun yetkazib beruvchi,
 * xarajat moddasi, obyekt va shartnoma raqami bor.
 *
 * Biz bank tranzaksiyamizni o'sha qatorga bog'lab, shu uchtasini ko'rsatamiz.
 * ⚠️ FAQAT O'QIYMIZ — ta'minot bazasiga hech narsa yozilmaydi.
 *
 * Moslash kaliti (2026-09-18 da real ma'lumotda o'lchandi):
 *   summa aniq teng + sana farqi ≤ 2 kun + (shartnoma tokeni YOKI yetkazib beruvchi nomi)
 *   — sana farqi 98% hollarda 0-1 kun; shartnoma tokeni ≥4 belgi bo'lishi shart
 *     (`№1`, `№3` kabi qisqa raqamlar yolg'on moslik beradi).
 */
@Injectable()
export class TaminotService {
  private readonly log = new Logger(TaminotService.name);
  private pool: Pool | null = null;

  /** Avtomat moslashtirish holati — ustma-ust ishga tushmasligi va status uchun. */
  private cronIshlayapti = false;
  private cronOxirgi: {
    boshlandi: string; tugadi: string | null; korildi: number;
    mos: number; noaniq: number; topilmadi: number; xato: string | null;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * AVTOMAT MOSLASHTIRISH — kuniga 3 marta (Toshkent).
   *
   * Qo'ldagi tugma bilan AYNAN bir xil ishni bajaradi, boshqa hech narsa qilmaydi:
   *   • `rematch: false` — faqat hali bog'lanmagan tranzaksiyalarga tegadi,
   *     mavjud ma'lumot ustiga yozmaydi;
   *   • ta'minot bazasiga faqat SELECT ketadi;
   *   • natija faqat bizning `transactions.erp*` ustunlariga yoziladi.
   *
   * O'chirish: TAMINOT_MATCH_CRON_ENABLED=0
   * Jadval o'zgartirish: TAMINOT_MATCH_CRON='0 0 8,14,20 * * *'
   */
  @Cron(process.env.TAMINOT_MATCH_CRON || '0 0 8,14,20 * * *', {
    name: 'taminot-match',
    timeZone: 'Asia/Tashkent',
  })
  async cronMoslashtirish(): Promise<void> {
    if (process.env.TAMINOT_MATCH_CRON_ENABLED === '0') return;
    if (this.cronIshlayapti) {
      this.log.warn("ta'minot avto-moslashtirish: oldingisi hali tugamagan — o'tkazib yuborildi");
      return;
    }
    if (!this.config.get<string>('TAMINOT_DATABASE_URL') && !process.env.TAMINOT_DATABASE_URL) {
      return; // ulanish sozlanmagan — jim o'tamiz
    }

    this.cronIshlayapti = true;
    const boshlandi = new Date();
    // Oxirgi 45 kun — eski to'lovlar allaqachon bog'langan, qayta ko'rish shart emas.
    const dateFrom = new Date(boshlandi.getTime() - 45 * 86_400_000)
      .toISOString().slice(0, 10);
    this.cronOxirgi = {
      boshlandi: boshlandi.toISOString(), tugadi: null,
      korildi: 0, mos: 0, noaniq: 0, topilmadi: 0, xato: null,
    };
    try {
      const r = await this.matchTransactions({ dateFrom, dryRun: false, rematch: false });
      this.cronOxirgi = {
        ...this.cronOxirgi,
        tugadi: new Date().toISOString(),
        korildi: r.scanned ?? 0,
        mos: r.matched ?? 0,
        noaniq: r.ambiguous ?? 0,
        topilmadi: r.notFound ?? 0,
      };
      this.log.log(
        `ta'minot avto-moslashtirish: ko'rildi=${r.scanned} mos=${r.matched} topilmadi=${r.notFound}`,
      );
    } catch (e: any) {
      this.cronOxirgi = { ...this.cronOxirgi!, tugadi: new Date().toISOString(), xato: e?.message || String(e) };
      this.log.error(`ta'minot avto-moslashtirish xato: ${e?.message}`);
    } finally {
      this.cronIshlayapti = false;
    }
  }

  /** Avtomat moslashtirish holati — panel ko'rsatishi uchun. */
  cronHolati() {
    return {
      ok: true as const,
      yoqilgan: process.env.TAMINOT_MATCH_CRON_ENABLED !== '0',
      jadval: process.env.TAMINOT_MATCH_CRON || '0 0 8,14,20 * * *',
      ishlayapti: this.cronIshlayapti,
      oxirgi: this.cronOxirgi,
    };
  }

  /** Ta'minot bazasiga o'qish uchun ulanish (lazy, bitta pool). */
  private getPool(): Pool {
    if (this.pool) return this.pool;
    const url = this.config.get<string>('TAMINOT_DATABASE_URL');
    if (!url) {
      throw new Error(
        "TAMINOT_DATABASE_URL sozlanmagan — serverdagi backend/.env ga qo'shing " +
        '(faqat o\'qish huquqiga ega foydalanuvchi bilan)',
      );
    }
    this.pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 30_000 });
    return this.pool;
  }

  /** Ulanishni tekshirish — sozlash to'g'ri bajarilganini bilish uchun. */
  async ping(): Promise<{ ok: boolean; message: string; rows?: number; oxirgiSana?: string | null }> {
    try {
      const r = await this.getPool().query(
        `select count(*)::int as n, max(tulov_sanasi)::date as oxirgi from public.tulovlar`,
      );
      return {
        ok: true,
        message: "Ta'minot bazasiga ulanish ishlayapti",
        rows: r.rows[0]?.n ?? 0,
        oxirgiSana: r.rows[0]?.oxirgi ? String(r.rows[0].oxirgi) : null,
      };
    } catch (e: any) {
      return { ok: false, message: e?.message || 'ulanib bo\'lmadi' };
    }
  }

  // ─────────────────────── matn normalizatsiyasi ───────────────────────

  /** Kirill ↔ lotin farqini yo'qotadi: "ЭКО ДИЗАЙН" va "EKO DIZAYN" bir xil bo'ladi. */
  private static readonly CYR: Record<string, string> = {
    А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'J', З: 'Z', И: 'I', Й: 'Y',
    К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F',
    Х: 'H', Ц: 'S', Ч: 'C', Ш: 'S', Щ: 'S', Ъ: '', Ы: 'I', Ь: '', Э: 'E', Ю: 'U', Я: 'A',
    Ў: 'O', Қ: 'K', Ғ: 'G', Ҳ: 'H',
  };
  private static readonly DROP_WORDS = ['ООО', 'OOO', 'MCHJ', 'МЧЖ', 'ХК', 'XK', 'ЧП', 'ИП', 'АО', 'ЗАО'];

  /** Majburiyat jamisi necha kunlik tarixdan yig'iladi (shartnoma bir yildan uzoq cho'zilishi mumkin). */
  private static readonly MAJBURIYAT_TARIX_KUN = 730;
  /** Summa shiftidagi yo'l qo'yiladigan farq: 1% yoki 10 000 so'm (yaxlitlash uchun). */
  private static readonly SHIFT_FOIZ = 0.01;
  private static readonly SHIFT_MIN = 10_000;

  private coarse(s: string | null | undefined): string {
    let x = String(s || '').toUpperCase();
    for (const w of TaminotService.DROP_WORDS) x = x.split(w).join(' ');
    x = Array.from(x).map((ch) => (TaminotService.CYR[ch] !== undefined ? TaminotService.CYR[ch] : ch)).join('');
    for (const [a, b] of [['SH', 'S'], ['CH', 'C'], ['YU', 'U'], ['YA', 'A'], ['X', 'H'], ['Q', 'K'], ['W', 'V']]) {
      x = x.split(a).join(b);
    }
    return x.replace(/[^0-9A-Z]/g, '');
  }

  /**
   * Shartnoma TOKENINI bir xil yozuvga keltiradi (kirill ↔ lotin).
   *
   * ⚠️ Ilgari yetkazib beruvchi NOMI `coarse()` orqali transliteratsiya
   * qilinardi, shartnoma tokeni esa YO'Q. Shuning uchun ERP'dagi "34/VATAN"
   * bank izohidagi "№34/ВАТАН" bilan hech qachon mos kelmasdi — ikkalasi
   * bir xil shartnoma bo'lsa ham. Endi ikkala tomon bir xil qoida bilan
   * normallashtiriladi.
   *
   * `coarse()` dan farqi: DROP_WORDS (OOO/MCHJ...) olib tashlanmaydi — ular
   * token ichida tasodifan uchrab, raqamni buzmasligi uchun.
   */
  private normTok(s: string | null | undefined): string {
    let x = String(s || '').toUpperCase();
    x = Array.from(x)
      .map((ch) => (TaminotService.CYR[ch] !== undefined ? TaminotService.CYR[ch] : ch))
      .join('');
    for (const [a, b] of [['SH', 'S'], ['CH', 'C'], ['YU', 'U'], ['YA', 'A'], ['X', 'H'], ['Q', 'K'], ['W', 'V']]) {
      x = x.split(a).join(b);
    }
    return x.replace(/[^0-9A-Z]/g, '');
  }

  /**
   * ERP "Дог№" dan shartnoma tokeni: "№ 34/VATAN от 10.2.2026" → "34VATAN"
   *
   * ⚠️ Sanani kesish uchun "ОТ" so'zi bo'yicha ajratiladi. Ilgari bu kirillcha
   * matnda ISHLAMASDI: JS regexdagi `\b` faqat [A-Za-z0-9_] uchun chegara
   * hisoblaydi, kirill harflari esa "so'z belgisi" emas — shuning uchun
   * `\bОТ\b` hech qachon mos kelmasdi va sana tokenga qo'shilib ketardi:
   *   "№ 01/2026 от 6.1.2026" → "012026OT612026"  (to'g'risi: "012026")
   * Shuning uchun avval transliteratsiya qilamiz (probellar saqlanadi), keyin
   * lotincha "OT" bo'yicha kesamiz — endi `\b` to'g'ri ishlaydi.
   */
  private dogToken(s: string | null | undefined): string {
    let up = String(s || '').toUpperCase();
    up = Array.from(up)
      .map((ch) => (TaminotService.CYR[ch] !== undefined ? TaminotService.CYR[ch] : ch))
      .join('');
    const head = up.split(/\bOT\b/)[0];
    const t = this.normTok(head);
    return t.length >= 4 ? t : '';
  }

  /**
   * ERP "Дог№" yoki bank izohidan SHARTNOMA SANASI:
   *   "№ 34/VATAN от 10.2.2026" → "2026-02-10"
   *
   * Nega kerak: bitta yetkazib beruvchi bilan bir xil raqamli shartnoma yillar
   * davomida qayta tuzilishi mumkin. Raqam bir xil, sana boshqa — bu IKKI
   * ALOHIDA majburiyat. Sanani hisobga olmasak, o'tgan yilgi shartnoma to'lovi
   * bu yilgi majburiyat hisobiga yozilib ketadi.
   *
   * `dogToken()` "ОТ" dan OLDINGI qismni oladi, bu funksiya — KEYINGISINI.
   */
  private sanaOt(s: string | null | undefined): string {
    let up = String(s || '').toUpperCase();
    up = Array.from(up)
      .map((ch) => (TaminotService.CYR[ch] !== undefined ? TaminotService.CYR[ch] : ch))
      .join('');
    const bolak = up.split(/\bOT\b/);
    const quyruq = bolak.length > 1 ? bolak.slice(1).join(' ') : up;
    const dmy = quyruq.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    const ymd = quyruq.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    const [kun, oy, yil] = dmy
      ? [dmy[1], dmy[2], dmy[3]]
      : ymd ? [ymd[3], ymd[2], ymd[1]] : ['', '', ''];
    const y = Number(yil), o = Number(oy), d = Number(kun);
    if (!(y >= 2000 && y <= 2100 && o >= 1 && o <= 12 && d >= 1 && d <= 31)) return '';
    return `${y}-${String(o).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  /** Bank izohidan shartnoma tokenlari: "договору №335LMC от ..." → {"335LMC"} */
  private descTokens(d: string | null | undefined): Set<string> {
    const out = new Set<string>();
    const up = String(d || '').toUpperCase();
    const re = /[№N]\s*([0-9A-ZА-ЯЁ/\-.]{4,20})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(up)) !== null) {
      const t = this.normTok(m[1]);
      if (t.length >= 4) out.add(t);
    }
    return out;
  }

  // ─────────────────────────── moslash ───────────────────────────

  /**
   * Bank tranzaksiyalarini ta'minot to'lovlariga bog'laydi.
   *
   * @param opts.dateFrom  qaysi sanadan (standart 2026-05-01 — undan oldingilarga tegilmaydi)
   * @param opts.dryRun    true (standart) — hech narsa yozilmaydi
   * @param opts.rematch   true — allaqachon bog'langanlarni ham qayta ko'rish
   */
  async matchTransactions(opts?: {
    dateFrom?: string;
    dateTo?: string;
    dryRun?: boolean;
    rematch?: boolean;
    limit?: number;
  }): Promise<{
    ok: true;
    dryRun: boolean;
    dateFrom: string;
    scanned: number;
    /** Shu davrda ALLAQACHON bog'langanlar — rematch=false da ular ko'rilmaydi */
    alreadyLinked: number;
    erpRows: number;
    matched: number;
    ambiguous: number;
    notFound: number;
    /** Eski bog'lanish bekor qilindi (qayta ko'rishda mos kelmay qolgan) */
    cleared: number;
    /** Shartnoma mos keldi, lekin summa majburiyatdan oshib ketdi — yozilmadi */
    shiftRad: number;
    byArticle: Array<{ article: string; count: number }>;
    reasons: Array<{ reason: string; count: number }>;
    nearMiss: Array<{
      date: string; amount: string; bankName: string;
      erpDate: string; erpAmount: string; erpSupplier: string;
      erpArticle: string; erpContract: string; sabab: string;
    }>;
    // "summa bor, lekin shartnoma/nom mos emas" guruhi uchun yonma-yon taqqoslash
    nomFarqi: Array<{
      date: string; amount: string; kunFarq: number;
      bankNom: string; bankNomNorm: string;
      erpNom: string; erpNomNorm: string;
      erpDog: string; erpDogTok: string; bankToklar: string;
    }>;
    /** Summa shifti rad etganlar — shartnoma to'g'ri, lekin jami oshib ketgan */
    shiftOshdi: Array<{
      date: string; amount: string; bankName: string;
      contract: string; contractDate: string; supplier: string;
      erpTotal: string; alreadyUsed: string; excess: string; how: string;
    }>;
    samples: Array<{
      date: string; amount: string; bankName: string;
      supplier: string; article: string; contract: string; dayDiff: number; how: string;
    }>;
  }> {
    const dryRun = opts?.dryRun !== false;
    const dateFrom = opts?.dateFrom || '2026-05-01';
    const dateTo = opts?.dateTo || null;
    const take = Math.min(100_000, Math.max(1, opts?.limit ?? 100_000));

    // ── 1) Bizning tranzaksiyalar ──
    // CLIENT (mijoz to'lovlari) chetlab o'tiladi — ular ОплатыКв mantiqiga tegishli.
    const txs = await this.prisma.transaction.findMany({
      where: {
        txnDate: {
          gte: new Date(`${dateFrom}T00:00:00+05:00`),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:00`) } : {}),
        },
        ...(opts?.rematch ? {} : { erpPaymentId: null }),
        // ⚠️ Yo'nalish bo'yicha FILTRLAMAYMIZ. "Ta'minotda faqat chiqim bor"
        // degan taxmin bilan direction='OUT' qo'yib ko'rildi — mosliklar 123 dan
        // 0 ga tushdi, ya'ni topilgan mosliklarning hammasi KIRIM tomonda ekan.
        // Sababi aniqlanmaguncha filtr qo'shilmaydi (2026-10-05).
        NOT: { category: { code: 'CLIENT' } },
      },
      select: {
        id: true, txnDate: true, amount: true, direction: true,
        fromName: true, toName: true, description: true, erpPaymentId: true,
      },
      orderBy: { txnDate: 'asc' },
      take,
    });

    if (txs.length === 0) {
      return { ok: true, dryRun, dateFrom, scanned: 0, alreadyLinked: 0, erpRows: 0, matched: 0, ambiguous: 0, notFound: 0, cleared: 0, shiftRad: 0, byArticle: [], reasons: [], nearMiss: [], nomFarqi: [], shiftOshdi: [], samples: [] };
    }

    // ── 2) Ta'minot to'lovlari (±3 kun kengaytirilgan oyna bilan) ──
    const erpFrom = new Date(`${dateFrom}T00:00:00+05:00`);
    erpFrom.setDate(erpFrom.getDate() - 3);
    const res = await this.getPool().query(
      // Master jadval ustun nomlari turlicha bo'lishi mumkin (nomi/name/title) —
      // to_jsonb bilan olamiz, shunda sxema o'zgarsa ham so'rov yiqilmaydi.
      // ⚠️ sana MATN qilib olinadi: pg drayveri `date` ustunini Date obyektiga
      // aylantiradi, uni matn deb o'qisak "Tue Sep 22" kabi buzuq qiymat chiqadi
      // va sana farqi NaN bo'lib, ±2 kun cheklovi jimgina ishlamay qoladi.
      `select p.id::text                                          as id,
              to_char(p.tulov_sanasi, 'YYYY-MM-DD')               as sana,
              round(coalesce(p.executed_amount, p.summa))::bigint as summa,
              coalesce(t.j->>'nomi', t.j->>'name', t.j->>'title',
                       p.legacy_meta->>'rawPayee', '')            as taminotchi,
              coalesce(k.j->>'nomi', k.j->>'name', k.j->>'title', '') as kategoriya,
              coalesce(p.legacy_meta->>'dogNo', '')               as dogno,
              coalesce(o.j->>'nomi', o.j->>'name', o.j->>'title', '') as obyekt
         from public.tulovlar p
         left join lateral (select to_jsonb(s) j from public.taminotchilar s       where s.id = p.taminotchi_id) t on true
         left join lateral (select to_jsonb(c) j from public.tulov_kategoriyalar c where c.id = p.category_id)   k on true
         left join lateral (select to_jsonb(ob) j from public.obyekts ob          where ob.id = p.obyekt_id)    o on true
        where p.tulov_sanasi >= $1`,
      [erpFrom.toISOString().slice(0, 10)],
    );

    // summa va shartnoma tokeni bo'yicha indekslar
    const byAmount = new Map<number, any[]>();
    const byDog = new Map<string, any[]>();
    for (const r of res.rows) {
      const amt = Number(r.summa);
      if (!Number.isFinite(amt)) continue;
      const sana = new Date(`${String(r.sana).slice(0, 10)}T12:00:00Z`);
      if (isNaN(sana.getTime())) continue; // sanasi o'qilmagan qator moslashda qatnashmasin
      const item = {
        id: String(r.id),
        summa: amt,
        sana,
        taminotchi: String(r.taminotchi || ''),
        taminotchiC: this.coarse(r.taminotchi),
        kategoriya: String(r.kategoriya || ''),
        dogno: String(r.dogno || ''),
        dogTok: this.dogToken(r.dogno),
        dogSana: this.sanaOt(r.dogno),
        obyekt: String(r.obyekt || ''),
      };
      const arr = byAmount.get(amt);
      if (arr) arr.push(item); else byAmount.set(amt, [item]);
      // Shartnoma tokeni bo'yicha indeks — moslik topilmaganda SABABINI aytish uchun
      if (item.dogTok) {
        const d = byDog.get(item.dogTok);
        if (d) d.push(item); else byDog.set(item.dogTok, [item]);
      }
    }

    // ── 2b) MAJBURIYATLAR: shartnoma (№ + sana) kesimida JAMI summa ──
    //
    // «PROWAYS» holati: bitta 100 mln majburiyat bir nechta hisob raqamdan
    // bir nechta bo'lak qilib to'lanadi. Hech bir bo'lak ERP qatoriga summa
    // bo'yicha teng kelmaydi, shuning uchun 1-bosqich ularni topa olmaydi.
    //
    // Yechim — summani TASHLAB YUBORMASLIK, balki SHIFT qilib ishlatish:
    // bir shartnoma bo'yicha yozilgan to'lovlar yig'indisi o'sha shartnoma
    // majburiyatidan OSHMASLIGI shart. Oshsa — yozmaymiz, odam ko'rsin.
    //
    // Jami butun tarix bo'yicha olinadi (faqat so'nggi kunlar emas), aks holda
    // shift haqiqiydan kichik chiqib, to'g'ri to'lovlar ham rad etilardi.
    const majFrom = new Date(`${dateFrom}T00:00:00+05:00`);
    majFrom.setDate(majFrom.getDate() - TaminotService.MAJBURIYAT_TARIX_KUN);
    const majRes = await this.getPool().query(
      `select coalesce(p.legacy_meta->>'dogNo', '')                        as dogno,
              coalesce(t.j->>'nomi', t.j->>'name', t.j->>'title',
                       p.legacy_meta->>'rawPayee', '')                     as taminotchi,
              coalesce(k.j->>'nomi', k.j->>'name', k.j->>'title', '')      as kategoriya,
              coalesce(o.j->>'nomi', o.j->>'name', o.j->>'title', '')      as obyekt,
              count(*)::int                                               as qator,
              sum(round(coalesce(p.executed_amount, p.summa)))::bigint     as jami,
              min(p.id::text)                                             as namuna
         from public.tulovlar p
         left join lateral (select to_jsonb(s) j from public.taminotchilar s       where s.id = p.taminotchi_id) t on true
         left join lateral (select to_jsonb(c) j from public.tulov_kategoriyalar c where c.id = p.category_id)   k on true
         left join lateral (select to_jsonb(ob) j from public.obyekts ob          where ob.id = p.obyekt_id)    o on true
        where coalesce(p.legacy_meta->>'dogNo', '') <> ''
          and p.tulov_sanasi >= $1
        group by 1, 2, 3, 4`,
      [majFrom.toISOString().slice(0, 10)],
    );

    /** Kalit: shartnoma tokeni + shartnoma sanasi — "34VATAN|2026-02-10". */
    type Majburiyat = {
      dogTok: string; dogSana: string; dogno: string;
      jami: number; qator: number;
      taminotchi: string; taminotchiC: string; kategoriya: string; obyekt: string;
      namuna: string; xilma: boolean;
    };
    const byMajburiyat = new Map<string, Majburiyat>();
    for (const r of majRes.rows) {
      const dogTok = this.dogToken(r.dogno);
      if (!dogTok) continue;
      const dogSana = this.sanaOt(r.dogno);
      const kalit = `${dogTok}|${dogSana}`;
      const jami = Number(r.jami) || 0;
      const bor = byMajburiyat.get(kalit);
      if (!bor) {
        byMajburiyat.set(kalit, {
          dogTok, dogSana, dogno: String(r.dogno || ''),
          jami, qator: Number(r.qator) || 0,
          taminotchi: String(r.taminotchi || ''),
          taminotchiC: this.coarse(r.taminotchi),
          kategoriya: String(r.kategoriya || ''),
          obyekt: String(r.obyekt || ''),
          namuna: String(r.namuna),
          xilma: false,
        });
        continue;
      }
      // Bir shartnoma ostida turli modda/obyekt/yetkazib beruvchi bo'lsa —
      // qaysi birini yozishni bilmaymiz. Jami esa baribir qo'shiladi (shift).
      bor.jami += jami;
      bor.qator += Number(r.qator) || 0;
      const farq = bor.taminotchi !== String(r.taminotchi || '')
        || bor.kategoriya !== String(r.kategoriya || '')
        || bor.obyekt !== String(r.obyekt || '');
      if (farq) bor.xilma = true;
    }

    /** Bitta token bir nechta shartnoma sanasiga tegishli bo'lsa — sanasiz yozish taqiqlanadi. */
    const tokenSanalari = new Map<string, Set<string>>();
    for (const m of byMajburiyat.values()) {
      const s = tokenSanalari.get(m.dogTok);
      if (s) s.add(m.dogSana); else tokenSanalari.set(m.dogTok, new Set([m.dogSana]));
    }

    // Allaqachon bog'langanlar soni — "Mos topildi: 1" chalg'itmasligi uchun.
    // rematch=false bo'lsa ular umuman ko'rilmaydi, shuning uchun natijada
    // kichik raqam chiqadi va ish qilinmayotgandek tuyuladi.
    const alreadyLinked = await this.prisma.transaction.count({
      where: {
        txnDate: {
          gte: new Date(`${dateFrom}T00:00:00+05:00`),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:00`) } : {}),
        },
        erpPaymentId: { not: null },
      },
    });

    // ── 2c) BAND summa: har bir majburiyatdan allaqachon qancha yozilgan ──
    //
    // Shift tekshiruvi bitta to'lov uchun emas, shartnoma bo'yicha JAMI uchun
    // ishlaydi. Shu sababli oldin bog'langan to'lovlar ham hisobga olinadi.
    // Hozir skanerlanayotganlari chiqarib tashlanadi — ular qayta sanalmasin.
    const skanId = new Set(txs.map((t) => t.id));
    const band = new Map<string, number>();
    const bandQator = await this.prisma.transaction.findMany({
      where: { erpPaymentId: { not: null }, NOT: { erpContract: null } },
      select: { id: true, amount: true, erpContract: true },
    });
    for (const b of bandQator) {
      if (skanId.has(b.id)) continue;
      const tok = this.dogToken(b.erpContract);
      if (!tok) continue;
      const kalit = `${tok}|${this.sanaOt(b.erpContract)}`;
      band.set(kalit, (band.get(kalit) || 0) + Math.round(Math.abs(Number(b.amount))));
    }

    /**
     * SUMMA SHIFTI — moslikni yozishdan oldingi oxirgi tekshiruv.
     *
     * Shartnoma bo'yicha yozilgan to'lovlar yig'indisi ta'minotdagi majburiyat
     * jamisidan oshib ketmasligi kerak. Oshsa — bu boshqa shartnoma yoki
     * noto'g'ri moslik, tegmaymiz.
     */
    const shiftTekshir = (m: Majburiyat | undefined, amt: number): { ok: boolean; band: number; jami: number } => {
      if (!m) return { ok: false, band: 0, jami: 0 };
      const kalit = `${m.dogTok}|${m.dogSana}`;
      const oldin = band.get(kalit) || 0;
      const chek = m.jami + Math.max(m.jami * TaminotService.SHIFT_FOIZ, TaminotService.SHIFT_MIN);
      return { ok: oldin + amt <= chek, band: oldin, jami: m.jami };
    };

    /** ERP qatoridan majburiyat kaliti — "34VATAN|2026-02-10". */
    const majTop = (c: { dogTok?: string; dogSana?: string }): Majburiyat | undefined =>
      c.dogTok ? byMajburiyat.get(`${c.dogTok}|${c.dogSana || ''}`) : undefined;

    // ── 3) Moslash ──
    const MAX_DAY = 2;
    const tally = new Map<string, number>();
    const reasons = new Map<string, number>();
    const samples: any[] = [];
    const nearMiss: any[] = [];
    // Eng katta guruh — "summa bor, lekin shartnoma/nom mos emas". Nega mos
    // kelmaganini ko'rish uchun bank va ERP nomlarini YONMA-YON saqlaymiz
    // (xom holda ham, normallashtirilgan holda ham).
    const nomFarqi: any[] = [];
    let matched = 0, ambiguous = 0, notFound = 0, cleared = 0, shiftRad = 0;
    /** Summa shifti sabab rad etilganlar — odam ko'rishi uchun ro'yxat. */
    const shiftOshdi: any[] = [];

    /**
     * Qayta ko'rish (rematch) paytida moslik topilmasa — eski bog'lanish bekor
     * qilinadi. Aks holda ilgari NOTO'G'RI yozilgan ma'lumot joyida qolib ketardi
     * (±2 kun cheklovi buzuq sana tufayli ishlamay turgan edi).
     */
    const eskiniTozala = async (tx: any) => {
      if (dryRun || !opts?.rematch || !tx.erpPaymentId) return;
      cleared++;
      await this.prisma.transaction.update({
        where: { id: tx.id },
        data: {
          erpPaymentId: null, erpSupplier: null, erpArticle: null,
          erpContract: null, erpObject: null, erpMatchedAt: null,
        },
      }).catch((e) => this.log.warn(`erp tozalash xato (${tx.id}): ${e?.message}`));
    };

    for (const tx of txs) {
      const amt = Math.round(Math.abs(Number(tx.amount)));
      /** Topilgan mosliкni yozadi (ikkala bosqich uchun umumiy). */
      const yoz = async (c: any, diff: number, usul: string) => {
        matched++;
        const label = c.kategoriya || '(moddasiz)';
        tally.set(label, (tally.get(label) || 0) + 1);
        if (samples.length < 25) {
          samples.push({
            date: tashkentKun(tx.txnDate),
            amount: String(tx.amount),
            bankName: (tx.direction === 'IN' ? tx.fromName : tx.toName)?.slice(0, 30) || '',
            supplier: String(c.taminotchi || '').slice(0, 28),
            article: String(c.kategoriya || '').slice(0, 30),
            contract: String(c.dogno || '').slice(0, 26),
            dayDiff: diff,
            how: usul,
          });
        }
        if (!dryRun) {
          await this.prisma.transaction.update({
            where: { id: tx.id },
            data: {
              erpPaymentId: c.id,
              erpSupplier: String(c.taminotchi || '').slice(0, 255) || null,
              erpArticle: String(c.kategoriya || '').slice(0, 255) || null,
              erpContract: String(c.dogno || '').slice(0, 255) || null,
              erpObject: String(c.obyekt || '').slice(0, 255) || null,
              erpMatchedAt: new Date(),
            },
          }).catch((e) => this.log.warn(`erp yozish xato (${tx.id}): ${e?.message}`));
        }
        // Shu shartnoma bo'yicha band summa oshadi — keyingi bo'lak (PROWAYS)
        // to'g'ri tekshirilsin. DRY-RUN da ham oshiriladi: aks holda sinov
        // natijasi haqiqiy ishga tushirishdan farq qilib qolardi.
        if (c.dogTok) {
          const k = `${c.dogTok}|${c.dogSana || ''}`;
          band.set(k, (band.get(k) || 0) + amt);
        }
      };
      const txDay = new Date(tx.txnDate);
      const toks = this.descTokens(tx.description);
      const names = `${this.coarse(tx.toName)}|${this.coarse(tx.fromName)}`;
      // Nomni ikki tomonlama solishtirish uchun alohida ham saqlaymiz.
      const nomlar = [this.coarse(tx.toName), this.coarse(tx.fromName)].filter((n) => n.length >= 8);

      // Moslik topilmasa SABABINI aniqlaydi — shartnoma tokeni bo'yicha eng yaqin nomzod
      const sababniYoz = () => {
        notFound++;
        let eng: any = null;
        for (const t of toks) {
          for (const c of byDog.get(t) || []) {
            const dd = Math.round(Math.abs(c.sana.getTime() - txDay.getTime()) / 86_400_000);
            const score = (c.summa === amt ? 0 : 1_000_000) + dd;
            if (!eng || score < eng.score) eng = { c, dd, score };
          }
        }
        let sabab: string;
        if (eng) {
          sabab = eng.c.summa === amt
            ? `shartnoma mos, lekin sana ${eng.dd} kun farq qiladi`
            : 'shartnoma mos, lekin summa boshqa';
        } else if (byAmount.has(amt)) {
          sabab = 'summa bor, lekin shartnoma/nom mos emas';
          if (nomFarqi.length < 20) {
            const yaqin = (byAmount.get(amt) || [])
              .map((c: any) => ({ c, dd: Math.round(Math.abs(c.sana.getTime() - txDay.getTime()) / 86_400_000) }))
              .filter((x: any) => x.dd <= MAX_DAY)
              .sort((a: any, b: any) => a.dd - b.dd)[0];
            if (yaqin) {
              nomFarqi.push({
                date: tashkentKun(tx.txnDate),
                amount: String(amt),
                kunFarq: yaqin.dd,
                bankNom: (tx.direction === 'IN' ? tx.fromName : tx.toName)?.slice(0, 40) || '',
                bankNomNorm: names.slice(0, 70),
                erpNom: String(yaqin.c.taminotchi || '').slice(0, 40),
                erpNomNorm: String(yaqin.c.taminotchiC || '').slice(0, 40),
                erpDog: String(yaqin.c.dogno || '').slice(0, 24),
                erpDogTok: yaqin.c.dogTok || '',
                bankToklar: Array.from(toks).slice(0, 4).join(', '),
              });
            }
          }
        } else {
          sabab = "ta'minotda bunday summa yo'q";
        }
        reasons.set(sabab, (reasons.get(sabab) || 0) + 1);
        if (eng && nearMiss.length < 15) {
          nearMiss.push({
            date: tashkentKun(tx.txnDate),
            amount: String(amt),
            bankName: (tx.direction === 'IN' ? tx.fromName : tx.toName)?.slice(0, 26) || '',
            erpDate: eng.c.sana.toISOString().slice(0, 10),
            erpAmount: String(eng.c.summa),
            erpSupplier: eng.c.taminotchi.slice(0, 24),
            erpArticle: eng.c.kategoriya.slice(0, 26),
            erpContract: eng.c.dogno.slice(0, 22),
            sabab,
          });
        }
      };

      /**
       * 2-BOSQICH — summa teng bo'lmasa ham, SHARTNOMA + SANA mos kelsa.
       *
       * Bank bitta to'lov qiladi, ta'minotda esa u bir nechta qatorga bo'linib
       * yoziladi (modda yoki obyekt bo'yicha). Shuning uchun summa hech qachon
       * aniq teng bo'lmaydi va 1-bosqich ularni topa olmaydi. Haqiqiy misol:
       *   bank  500 000 000  MUROT-INSHOATI  №138LUS  05.10
       *   erp   364 094 000  MUROT-INSHOATI  №138LUS  05.10
       *
       * Bu yerda PUL emas, faqat YORLIQ (modda/obyekt/yetkazib beruvchi)
       * ko'chiriladi — shuning uchun summa farqi xavfli emas. Himoya: topilgan
       * nomzodlarning hammasi BIR XIL modda/obyekt/yetkazib beruvchi bo'lishi
       * shart. Turlicha bo'lsa — qaysi birini yozishni bilmaymiz, tegmaymiz.
       */
      const ikkinchiBosqich = (): { c: any; diff: number } | 'noaniq' | null => {
        const nomzod: Array<{ c: any; diff: number }> = [];
        const korilgan = new Set<string>();
        for (const t of toks) {
          for (const c of byDog.get(t) || []) {
            if (korilgan.has(c.id)) continue;
            korilgan.add(c.id);
            const diff = Math.round(Math.abs(c.sana.getTime() - txDay.getTime()) / 86_400_000);
            if (diff <= MAX_DAY) nomzod.push({ c, diff });
          }
        }
        if (!nomzod.length) return null;
        const xil = new Set(nomzod.map((x) => `${x.c.taminotchi}|${x.c.kategoriya}|${x.c.obyekt}`));
        if (xil.size > 1) return 'noaniq';
        return nomzod.sort((a, b) => a.diff - b.diff)[0];
      };

      /**
       * SUMMA DARVOZASI — hamma bosqich yozishdan oldin shu yerdan o'tadi.
       *
       * Summa "hisobga olinmaydi" degan holat YO'Q. Uch imkoniyat:
       *   1. summa aniq teng         → o'tadi (eng ishonchli)
       *   2. shartnoma majburiyatidan OSHMAYDI → o'tadi (bo'lib to'lash)
       *   3. oshib ketadi            → YOZILMAYDI, ro'yxatga tushadi
       *
       * 2-holatda shartnoma bo'yicha ALLAQACHON yozilgan to'lovlar ham qo'shib
       * hisoblanadi, shuning uchun bir majburiyatga chegaradan ortiq pul
       * yozilmaydi.
       */
      const summaDarvoza = (c: any, usul: string, shiftShart = false): boolean => {
        // `shiftShart` — 3-bosqich uchun: u yerda `c` sun'iy yig'ilgan majburiyat,
        // uning summasi to'lov summasiga tasodifan teng chiqib, tekshiruvni
        // chetlab o'tib ketmasligi kerak.
        if (!shiftShart && Number(c.summa) === amt) return true;
        const m = majTop(c);
        if (!m) {
          shiftRad++;
          const s = "shartnoma jamisi aniqlanmadi — summa tekshirilmadi";
          reasons.set(s, (reasons.get(s) || 0) + 1);
          return false;
        }
        const t = shiftTekshir(m, amt);
        if (t.ok) return true;
        shiftRad++;
        const s = 'summa shartnoma majburiyatidan oshib ketdi';
        reasons.set(s, (reasons.get(s) || 0) + 1);
        if (shiftOshdi.length < 20) {
          shiftOshdi.push({
            date: tashkentKun(tx.txnDate),
            amount: String(amt),
            bankName: (tx.direction === 'IN' ? tx.fromName : tx.toName)?.slice(0, 30) || '',
            contract: String(c.dogno || '').slice(0, 30),
            contractDate: c.dogSana || '',
            supplier: String(c.taminotchi || '').slice(0, 28),
            erpTotal: String(t.jami),
            alreadyUsed: String(t.band),
            excess: String(t.band + amt - t.jami),
            how: usul,
          });
        }
        return false;
      };

      /**
       * 3-BOSQICH — «PROWAYS» holati: bitta majburiyat bir nechta hisob
       * raqamdan bir nechta bo'lak bo'lib to'langan.
       *
       * Misol: PROWAYS MCHJ ga 100 mln to'lash kerak, biz 40 + 35 + 25 qilib
       * uch hisobdan chiqardik. Hech bir bo'lak ERP qatoriga teng emas va
       * to'lov kunlari ham ta'minot qatoridan uzoq — 1 va 2-bosqich topmaydi.
       *
       * Shu yerda PAYMENT sanasi emas, SHARTNOMA sanasi hal qiladi:
       * shartnoma raqami + shartnoma sanasi bir xil bo'lsa, bu bitta
       * majburiyat. Summa esa shift sifatida ishlaydi (summaDarvoza).
       */
      const uchinchiBosqich = (): { c: any; diff: number } | 'noaniq' | null => {
        const bankDogSana = this.sanaOt(tx.description);
        const nomzod: Majburiyat[] = [];
        for (const t of toks) {
          const sanalar = tokenSanalari.get(t);
          if (!sanalar || sanalar.size === 0) continue;
          for (const sn of sanalar) {
            // Bank izohida shartnoma sanasi bor bo'lsa — AYNAN mos kelishi shart.
            // Yo'q bo'lsa — token bitta shartnoma sanasiga tegishli bo'lishi shart,
            // aks holda qaysi shartnomaga tushganini bilmaymiz.
            if (bankDogSana) { if (sn !== bankDogSana) continue; }
            else if (sanalar.size > 1) return 'noaniq';
            const m = byMajburiyat.get(`${t}|${sn}`);
            if (m) nomzod.push(m);
          }
        }
        if (!nomzod.length) return null;
        const xil = new Set(nomzod.map((m) => `${m.taminotchi}|${m.kategoriya}|${m.obyekt}`));
        if (xil.size > 1 || nomzod.some((m) => m.xilma)) return 'noaniq';
        const m = nomzod[0];

        // Yetkazib beruvchi nomi ham mos kelsin (token tasodifan uchrab qolmasin).
        const erpNom = m.taminotchiC || '';
        if (erpNom.length >= 8 && !nomlar.some((n) => n.includes(erpNom) || erpNom.includes(n))) return null;

        // Sana mantiqi: shartnomadan oldin to'lov bo'lmaydi, 2 yildan keyin ham emas.
        if (m.dogSana) {
          const dog = new Date(`${m.dogSana}T12:00:00Z`);
          const kun = Math.round((txDay.getTime() - dog.getTime()) / 86_400_000);
          if (kun < -5 || kun > TaminotService.MAJBURIYAT_TARIX_KUN) return null;
        }
        return {
          c: {
            id: m.namuna, summa: m.jami, sana: txDay,
            taminotchi: m.taminotchi, taminotchiC: m.taminotchiC,
            kategoriya: m.kategoriya, dogno: m.dogno,
            dogTok: m.dogTok, dogSana: m.dogSana, obyekt: m.obyekt,
          },
          diff: 0,
        };
      };

      /** 2 → 3-bosqich ketma-ketligi (uch joyda bir xil ishlatiladi). */
      const qolganBosqichlar = async (): Promise<boolean> => {
        const t2 = ikkinchiBosqich();
        if (t2 === 'noaniq') { ambiguous++; await eskiniTozala(tx); return true; }
        if (t2) {
          if (summaDarvoza(t2.c, 'shartnoma')) { await yoz(t2.c, t2.diff, 'shartnoma'); return true; }
          // Shift rad etdi. 3-bosqich AYNAN shu majburiyatga boradi, demak u ham
          // rad etiladi — qayta sanamaymiz, sabab allaqachon yozilgan.
          await eskiniTozala(tx);
          return true;
        }
        const t3 = uchinchiBosqich();
        if (t3 === 'noaniq') { ambiguous++; await eskiniTozala(tx); return true; }
        if (t3) {
          if (summaDarvoza(t3.c, 'majburiyat', true)) { await yoz(t3.c, t3.diff, 'majburiyat'); return true; }
          await eskiniTozala(tx);
          return true;
        }
        return false;
      };

      const cands = byAmount.get(amt);
      if (!cands || cands.length === 0) {
        if (await qolganBosqichlar()) continue;
        sababniYoz(); await eskiniTozala(tx); continue;
      }

      const hits: Array<{ c: any; diff: number; byDog: boolean; byName: boolean }> = [];
      for (const c of cands) {
        const diff = Math.round(Math.abs(c.sana.getTime() - txDay.getTime()) / 86_400_000);
        if (diff > MAX_DAY) continue;
        const byDog = !!c.dogTok && toks.has(c.dogTok);
        // ⚠️ Ilgari faqat `names.includes(erpNom)` tekshirilardi — ya'ni ERP nomi
        // bank nomining ICHIDA TO'LIQ bo'lishi shart edi. Bank uzun nomlarni
        // KESIB saqlaydi, shuning uchun bitta harf yetishmay mos kelmasdi:
        //   bank: ...SARDORBEKSOBITHONOG    erp: ...SARDORBEKSOBITHONOGLI
        // Endi ikki tomonlama tekshiriladi (qaysi biri qisqa bo'lsa, u
        // ikkinchisining ichida bo'lsa yetarli). Noto'g'ri moslik bo'lmasligi
        // uchun ikkala nom ham kamida 8 belgi bo'lishi shart.
        const erpNom = c.taminotchiC || '';
        const byName = erpNom.length >= 8 &&
          nomlar.some((n) => n.includes(erpNom) || erpNom.includes(n));
        if (byDog || byName) hits.push({ c, diff, byDog, byName });
      }
      if (hits.length === 0) {
        if (await qolganBosqichlar()) continue;
        sababniYoz(); await eskiniTozala(tx); continue;
      }

      hits.sort((a, b) => (a.diff - b.diff) || ((b.byDog ? 1 : 0) - (a.byDog ? 1 : 0)));
      // Turli yetkazib beruvchiga teng nomzodlar — noaniq, tegmaymiz
      const best = hits[0];
      const rivals = hits.filter((h) => h.diff === best.diff && h.c.taminotchi !== best.c.taminotchi);
      if (rivals.length > 0) { ambiguous++; await eskiniTozala(tx); continue; }

      await yoz(best.c, best.diff,
        best.byDog && best.byName ? 'shartnoma+nom' : best.byDog ? 'shartnoma' : 'nom');
    }

    const byArticle = Array.from(tally.entries())
      .map(([article, count]) => ({ article, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    this.log.log(
      `taminot moslash: skan ${txs.length}, ERP ${res.rows.length}, majburiyat ${byMajburiyat.size}, ` +
      `mos ${matched}, noaniq ${ambiguous}, topilmadi ${notFound}, summa oshdi ${shiftRad}` +
      `${dryRun ? ' [DRY-RUN]' : ' [YOZILDI]'}`,
    );

    return {
      ok: true, dryRun, dateFrom,
      scanned: txs.length, alreadyLinked, erpRows: res.rows.length,
      matched, ambiguous, notFound, cleared, shiftRad, byArticle, samples,
      reasons: Array.from(reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      nearMiss,
      nomFarqi,
      shiftOshdi,
    };
  }
}
