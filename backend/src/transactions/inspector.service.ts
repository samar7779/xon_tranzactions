import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';

interface ParsedId {
  bankPrefix: 'IP' | null;
  generalId: string;
  num: string;
  ddate: string;
  accCt: string;
  accDt: string;
  amountTiyin: string;
  sign: '+' | '-';
  ourAccount: string;
}

/**
 * Bitta tranzaksiya ID'sini parse qilib, bankdan qidiradi.
 *
 * Strategiya:
 *   1) ddate kunini so'raymiz (asosiy)
 *   2) Topilmasa ±1, ±2 kun ham so'raymiz (bank ba'zan kechiktirib qo'yadi)
 *   3) Topilmasa eng yaqin 5 ta tranzaksiyani ko'rsatamiz
 *   4) Verdict: found / cancelled / shifted / unknown
 *   5) getDocDetails ham chaqiramiz (payment_state_name uchun)
 *
 * Kompozit ID format (sync.service makeCompositeId bilan teng):
 *   [IP_]{general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
 */
@Injectable()
export class InspectorService {
  private readonly log = new Logger(InspectorService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  /** Composite ID'ni komponentlarga ajratish. */
  parseId(rawId: string): ParsedId {
    if (!rawId || typeof rawId !== 'string') {
      throw new BadRequestException("ID bo'sh");
    }
    let id = rawId.trim();
    let bankPrefix: 'IP' | null = null;
    if (id.startsWith('IP_')) {
      bankPrefix = 'IP';
      id = id.slice(3);
    }
    const parts = id.split('_');
    if (parts.length < 7) {
      throw new BadRequestException(
        `ID format noto'g'ri (kutilgan 7 ta qism, kelgan ${parts.length}): ${rawId}`,
      );
    }
    const [generalId, num, ddate, accCt, accDt, amountTiyin, sign] = parts;
    if (sign !== '+' && sign !== '-') {
      throw new BadRequestException(`Sign noto'g'ri ("${sign}") — '+' yoki '-' bo'lishi kerak`);
    }
    return {
      bankPrefix,
      generalId,
      num,
      ddate,
      accCt,
      accDt,
      amountTiyin,
      sign,
      ourAccount: sign === '+' ? accDt : accCt,
    };
  }

  /** "dd.MM.yyyy" → Date */
  private parseDdate(s: string): Date | null {
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00+05:00`);
  }

  /** Date → "dd.MM.yyyy" */
  private fmtDdate(d: Date): string {
    return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
  }

  /** Bitta yozuv parsed bilan to'liq mos kelsa — qaysi maydon bo'yicha mos kelganini qaytaradi */
  private matchItem(it: KbDoc1CItem, parsed: ParsedId): string | null {
    if (it.general_id && it.general_id === parsed.generalId) return 'general_id';
    if (String(it.num || '') === parsed.num && it.ddate === parsed.ddate) return 'num+ddate';
    if (
      String(it.amount ?? '') === parsed.amountTiyin &&
      it.acc_ct === parsed.accCt &&
      it.acc_dt === parsed.accDt
    ) return 'amount+accounts';
    // Yumshoq match — faqat summa va bir hisob
    if (
      String(it.amount ?? '') === parsed.amountTiyin &&
      (it.acc_ct === parsed.accCt || it.acc_dt === parsed.accDt)
    ) return 'amount+one_account';
    return null;
  }

  /** Eng yaqin 5 ta tranzaksiyani topish (summa farqi bo'yicha) */
  private closestByAmount(items: KbDoc1CItem[], targetTiyin: number, top = 5): Array<KbDoc1CItem & { diff: number }> {
    return items
      .map((it) => ({ ...it, diff: Math.abs(Number(it.amount || 0) - targetTiyin) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, top);
  }

  /** Asosiy lookup — bir necha kun va getDocDetails bilan */
  async lookupFromBank(rawId: string) {
    const parsed = this.parseId(rawId);

    // ─── DB'dan account topamiz (credentials kerak) ───
    const account = await this.prisma.bankAccount.findFirst({
      where: { accountNo: parsed.ourAccount },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) {
      throw new NotFoundException(
        `Bizning DB'da ${parsed.ourAccount} hisobi topilmadi — bankdan ham so'ray olmaymiz`,
      );
    }
    const cred = account.credential;
    if (!cred) throw new BadRequestException(`${parsed.ourAccount} hisobiga bank ulanishi biriktirilmagan`);
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3') {
      throw new BadRequestException(`Hozircha faqat KAPITALBANK_V3 banklar uchun — bu ${bank.apiKind}`);
    }
    if (!bank.apiBaseUrl) throw new BadRequestException("Bank API URL'i sozlanmagan");

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    // ─── ±2 kun atrofini so'raymiz (parallel) ───
    const baseDate = this.parseDdate(parsed.ddate);
    const datesToCheck: string[] = [];
    if (baseDate) {
      for (const offset of [0, -1, 1, -2, 2]) {
        const d = new Date(baseDate.getTime() + offset * 86_400_000);
        datesToCheck.push(this.fmtDdate(d));
      }
    } else {
      datesToCheck.push(parsed.ddate);
    }

    const dayResults: Array<{
      date: string;
      items: KbDoc1CItem[];
      saldoIn: number | null;
      saldoOut: number | null;
      error: string | null;
    }> = [];

    await Promise.all(
      datesToCheck.map(async (date) => {
        try {
          const result = await this.kb.getDoc1C({
            baseUrl: bank.apiBaseUrl!,
            login,
            password,
            branch: account.branch,
            account: account.accountNo,
            date,
            useProxy: cred.useProxy === true,
          });
          dayResults.push({
            date,
            items: result?.content || [],
            saldoIn: result?.saldo_in ?? null,
            saldoOut: result?.saldo_out ?? null,
            error: null,
          });
        } catch (e: any) {
          dayResults.push({
            date,
            items: [],
            saldoIn: null,
            saldoOut: null,
            error: e?.message || 'xato',
          });
        }
      }),
    );
    // Asl ddate birinchi tursin
    dayResults.sort((a, b) => (a.date === parsed.ddate ? -1 : b.date === parsed.ddate ? 1 : 0));

    // ─── Har bir kunda match topish ───
    let foundItem: KbDoc1CItem | null = null;
    let foundOnDate: string | null = null;
    let matchedBy: string | null = null;
    for (const day of dayResults) {
      for (const it of day.items) {
        const mb = this.matchItem(it, parsed);
        if (mb) {
          foundItem = it;
          foundOnDate = day.date;
          matchedBy = mb;
          break;
        }
      }
      if (foundItem) break;
    }

    // ─── Asl kun (ddate) statistikasi ───
    const mainDay = dayResults.find((d) => d.date === parsed.ddate);

    // ─── Eng yaqin tranzaksiyalar (asl kun + atrofdagi kunlar birlashtirilgan) ───
    const allItems = dayResults.flatMap((d) => d.items.map((it) => ({ ...it, _onDate: d.date })));
    const targetTiyin = Number(parsed.amountTiyin);
    const closest = this.closestByAmount(allItems as any, targetTiyin, 5);

    // ─── Verdict ───
    let verdict: 'found' | 'shifted' | 'cancelled' | 'no_data' | 'partial' = 'no_data';
    let verdictDetail = '';
    if (foundItem) {
      if (foundOnDate === parsed.ddate) {
        verdict = 'found';
        verdictDetail = `Tranzaksiya bankda mavjud, ${matchedBy} bo'yicha topildi`;
      } else {
        verdict = 'shifted';
        verdictDetail = `Tranzaksiya boshqa kunga ko'chirilgan: ${foundOnDate} (asl kun: ${parsed.ddate})`;
      }
    } else {
      const totalItemsAcrossDays = dayResults.reduce((s, d) => s + d.items.length, 0);
      const hasAnyData = dayResults.some((d) => !d.error);
      if (!hasAnyData) {
        verdict = 'no_data';
        verdictDetail = "Bankka ulanib bo'lmadi yoki barcha kunlar bo'sh";
      } else if (mainDay && !mainDay.error && totalItemsAcrossDays > 0) {
        verdict = 'cancelled';
        verdictDetail = `Tranzaksiya ${parsed.ddate} kuni va ±2 kun atrofida bank ro'yxatida yo'q — bekor qilingan yoki qaytarilgan bo'lishi mumkin (jami ${totalItemsAcrossDays} ta tranzaksiya tekshirildi)`;
      } else {
        verdict = 'partial';
        verdictDetail = `Ayrim kunlardan ma'lumot kelmadi — to'liq xulosa qilish qiyin`;
      }
    }

    // getDocDetails 403 qaytaradi (auth turli xil bo'lishi mumkin) — chaqirilmaydi.
    // Har bir chaqiruv +APILogin = 2 ta qo'shimcha bank so'rovi va 5-10s sekinlik,
    // bulk rejimda bu rate limit'ga olib keladi. Verdikt va parsed yetarli.
    const docDetails = { result: null, error: null, triedVariants: [] as string[] };

    return {
      ok: true,
      id: rawId,
      verdict,
      verdictDetail,
      parsed: {
        generalId: parsed.generalId,
        num: parsed.num,
        ddate: parsed.ddate,
        accCt: parsed.accCt,
        accDt: parsed.accDt,
        amountSom: targetTiyin / 100,
        direction: parsed.sign === '+' ? 'OUT (chiqim)' : 'IN (kirim)',
        ourAccount: parsed.ourAccount,
      },
      account: {
        id: account.id,
        accountNo: account.accountNo,
        ownerName: account.ownerName,
        branch: account.branch,
        bank: { code: account.bank?.code, name: account.bank?.name },
      },
      bankResponse: {
        mainDateTotalItems: mainDay?.items.length || 0,
        mainDateError: mainDay?.error || null,
        saldoInSom: mainDay?.saldoIn != null ? Number(mainDay.saldoIn) / 100 : null,
        saldoOutSom: mainDay?.saldoOut != null ? Number(mainDay.saldoOut) / 100 : null,
        matchedBy,
        foundOnDate,
        item: foundItem,
        daysChecked: dayResults.map((d) => ({
          date: d.date,
          itemCount: d.items.length,
          error: d.error,
        })),
        closest: closest.map((c: any) => ({
          general_id: c.general_id,
          num: c.num,
          ddate: c.ddate,
          onDate: c._onDate,
          amountSom: Number(c.amount || 0) / 100,
          amountDiffSom: c.diff / 100,
          acc_dt: c.acc_dt,
          acc_ct: c.acc_ct,
          name_dt: c.name_dt,
          name_ct: c.name_ct,
          purpose: c.purpose,
          dir: c.dir,
          state: c.state,
        })),
      },
      docDetails,
    };
  }

  /**
   * getDocDetails endpoint'ini turli variantlarda sinab ko'rish.
   * Yo'riqnomada cyrillic mangled bo'lib chiqdi, shuning uchun bir nechta usul sinaymiz:
   *   - GET + sid query
   *   - GET + Basic auth (sidsiz)
   *   - POST body
   */
  private async tryGetDocDetails(p: {
    baseUrl: string;
    login: string;
    password: string;
    useProxy: boolean;
    branch: string;
    account: string;
    bank_day: string;
    doc_id: string;
    sign: '+' | '-';
  }): Promise<{ result: any; error: string | null; triedVariants: string[] }> {
    const triedVariants: string[] = [];
    let lastError: string | null = null;

    // sid olamiz
    let sid: string | null = null;
    try {
      const loginRes = await this.kb.apiLogin({
        baseUrl: p.baseUrl, login: p.login, password: p.password, useProxy: p.useProxy,
      });
      sid = loginRes?.sid || null;
    } catch (e: any) {
      lastError = `APILogin: ${e?.message || 'xato'}`;
    }

    // doc_type 0/1/2 — tartib sign asosida (chiqim=1, kirim=0, ichki=2)
    const preferred = p.sign === '+' ? 1 : 0;
    const docTypes = [preferred, preferred === 1 ? 0 : 1, 2];

    if (sid) {
      for (const dt of docTypes) {
        const variant = `GET sid?dt=${dt}`;
        triedVariants.push(variant);
        try {
          const r: any = await this.kb.getDocDetails({
            baseUrl: p.baseUrl, login: p.login, password: p.password,
            sid, branch: p.branch, account: p.account,
            bank_day: p.bank_day, doc_id: p.doc_id, doc_type: dt,
            useProxy: p.useProxy,
          });
          if (r?.result && (!r.error || r.error.code === 0)) {
            return { result: { ...r.result, _variant: variant }, error: null, triedVariants };
          }
          if (r?.error?.message) lastError = `${variant}: ${r.error.message}`;
        } catch (e: any) {
          lastError = `${variant}: ${e?.message?.slice(0, 200) || 'xato'}`;
        }
      }
    }

    return { result: null, error: lastError, triedVariants };
  }

  /**
   * Tekshiruv natijalarini Excel'ga eksport qilish.
   * Frontend bulk inspector natijalarini POST qiladi.
   */
  async exportResultsToXlsx(results: Array<{ id: string; result?: any; error?: string }>) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar — ID Inspector';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tekshiruv natijalari');

    const VERDICT_LABEL: Record<string, string> = {
      found: 'Bankda mavjud',
      shifted: "Boshqa kunga ko'chirilgan",
      cancelled: "Bekor qilingan to'lov",
      no_data: "Ma'lumot olinmadi",
      partial: "To'liq emas",
    };

    ws.columns = [
      { header: '№', key: 'idx', width: 5 },
      { header: 'ID', key: 'id', width: 80 },
      { header: 'Holati', key: 'verdict', width: 26 },
      { header: 'Sana', key: 'date', width: 12 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: "Yo'nalish", key: 'direction', width: 12 },
      { header: 'general_id', key: 'generalId', width: 14 },
      { header: 'num', key: 'num', width: 12 },
      { header: 'acc_dt (debit)', key: 'accDt', width: 24 },
      { header: 'acc_ct (credit)', key: 'accCt', width: 24 },
      { header: 'Xato (agar bo\'lsa)', key: 'errMsg', width: 40 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, size: 10 };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    head.height = 22;

    results.forEach((r, i) => {
      const p = r.result?.parsed || {};
      const verdict = r.result?.verdict || (r.error ? 'error' : '');
      const verdictText = VERDICT_LABEL[verdict] || (r.error ? 'Xato' : '—');
      const row = ws.addRow({
        idx: i + 1,
        id: r.id,
        verdict: verdictText,
        date: p.ddate || '',
        amount: p.amountSom != null ? Number(p.amountSom) : '',
        direction: p.direction || '',
        generalId: p.generalId || '',
        num: p.num || '',
        accDt: p.accDt || '',
        accCt: p.accCt || '',
        errMsg: r.error || '',
      });
      row.font = { size: 9 };
      row.getCell('id').font = { name: 'Consolas', size: 8 };
      row.getCell('amount').numFmt = '#,##0';
      // Verdict rangi
      const vColors: Record<string, string> = {
        found: 'FF047857',
        shifted: 'FFB45309',
        cancelled: 'FFBE123C',
        no_data: 'FF64748B',
        partial: 'FFB45309',
        error: 'FFBE123C',
      };
      row.getCell('verdict').font = { size: 9, bold: true, color: { argb: vColors[verdict] || 'FF334155' } };
    });

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const filename = `id_tekshiruv_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, filename };
  }

  /**
   * Excel faylning A ustunidan ID'larni o'qib chiqaramiz.
   * - Birinchi qatorda header bo'lsa (composite ID formatiga to'g'ri kelmasa) — o'tkazib yuboriladi
   * - Bo'sh qatorlar o'tkazib yuboriladi
   * - IP_ prefiks va trim qo'llaniladi
   */
  async parseIdsFromExcel(buffer: Buffer): Promise<string[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const looksLikeId = (s: string) => {
      const clean = s.startsWith('IP_') ? s.slice(3) : s;
      return clean.split('_').length >= 7;
    };

    const ids: string[] = [];
    ws.eachRow((row, rowNumber) => {
      const v = row.getCell(1).value;
      if (v == null) return;
      const s = String(v).trim();
      if (!s) return;
      // Birinchi qator header bo'lishi mumkin — agar ID formatiga o'xshamasa, skip
      if (rowNumber === 1 && !looksLikeId(s)) return;
      ids.push(s);
    });
    return ids;
  }
}
