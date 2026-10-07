import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PrismaService } from '../common/prisma/prisma.service';

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
      return { ok: true, dryRun, dateFrom, scanned: 0, alreadyLinked: 0, erpRows: 0, matched: 0, ambiguous: 0, notFound: 0, cleared: 0, byArticle: [], reasons: [], nearMiss: [], nomFarqi: [], samples: [] };
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
    let matched = 0, ambiguous = 0, notFound = 0, cleared = 0;

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
                date: tx.txnDate.toISOString().slice(0, 10),
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
            date: tx.txnDate.toISOString().slice(0, 10),
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

      const cands = byAmount.get(amt);
      if (!cands || cands.length === 0) { sababniYoz(); await eskiniTozala(tx); continue; }

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
      if (hits.length === 0) { sababniYoz(); await eskiniTozala(tx); continue; }

      hits.sort((a, b) => (a.diff - b.diff) || ((b.byDog ? 1 : 0) - (a.byDog ? 1 : 0)));
      // Turli yetkazib beruvchiga teng nomzodlar — noaniq, tegmaymiz
      const best = hits[0];
      const rivals = hits.filter((h) => h.diff === best.diff && h.c.taminotchi !== best.c.taminotchi);
      if (rivals.length > 0) { ambiguous++; await eskiniTozala(tx); continue; }

      matched++;
      const label = best.c.kategoriya || '(moddasiz)';
      tally.set(label, (tally.get(label) || 0) + 1);
      if (samples.length < 25) {
        samples.push({
          date: tx.txnDate.toISOString().slice(0, 10),
          amount: String(tx.amount),
          bankName: (tx.direction === 'IN' ? tx.fromName : tx.toName)?.slice(0, 30) || '',
          supplier: best.c.taminotchi.slice(0, 28),
          article: best.c.kategoriya.slice(0, 30),
          contract: best.c.dogno.slice(0, 26),
          dayDiff: best.diff,
          how: best.byDog && best.byName ? 'shartnoma+nom' : best.byDog ? 'shartnoma' : 'nom',
        });
      }

      if (!dryRun) {
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: {
            erpPaymentId: best.c.id,
            erpSupplier: best.c.taminotchi.slice(0, 255) || null,
            erpArticle: best.c.kategoriya.slice(0, 255) || null,
            erpContract: best.c.dogno.slice(0, 255) || null,
            erpObject: best.c.obyekt.slice(0, 255) || null,
            erpMatchedAt: new Date(),
          },
        }).catch((e) => this.log.warn(`erp yozish xato (${tx.id}): ${e?.message}`));
      }
    }

    const byArticle = Array.from(tally.entries())
      .map(([article, count]) => ({ article, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    this.log.log(
      `taminot moslash: skan ${txs.length}, ERP ${res.rows.length}, mos ${matched}, ` +
      `noaniq ${ambiguous}, topilmadi ${notFound}${dryRun ? ' [DRY-RUN]' : ' [YOZILDI]'}`,
    );

    return {
      ok: true, dryRun, dateFrom,
      scanned: txs.length, alreadyLinked, erpRows: res.rows.length,
      matched, ambiguous, notFound, cleared, byArticle, samples,
      reasons: Array.from(reasons.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      nearMiss,
      nomFarqi,
    };
  }
}
