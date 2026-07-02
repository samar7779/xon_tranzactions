import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CreateChekDto, UpdateChekDto } from './dto/chek.dto';

// Telegram xabari uchun rus tilidagi yorliqlar (misolga mos)
const TG_VID: Record<string, string> = {
  original: 'Оригинал', ekzemplyar: 'Экземпляр',
  original_fixed: 'Тугирланган Оригинал', ekzemplyar_fixed: 'Тугирланган Экземпляр',
};

export interface ChekTgConfig {
  botToken: string;
  groupId: string;
  intervalMin: number;
  fromHour: number;
  toHour: number;
  enabled: boolean;
}
const DEFAULT_TG: ChekTgConfig = { botToken: '', groupId: '', intervalMin: 5, fromHour: 9, toHour: 21, enabled: false };
const TG_CONFIG_KEY = 'chek.tg.config';

type Actor = { id?: string | null; name?: string | null };

// Excel eksport uchun 4 tilli yorliqlar (frontend i18n bilan mos)
const EXPORT_LABELS: Record<string, any> = {
  uz: {
    sheet: 'Chek', date: 'Sana', contract: 'Shartnoma raqami', manager: 'Menejer', branch: 'Sotuv ofisi',
    object: 'Obyekt', vid: 'Shartnoma turi', kontrolyor: 'Kontrolyor', shtrafy: 'Jarima', prichina: 'Rad etish sababi', dobavil: 'Qo\'shdi',
    vidMap: { original: 'Original', ekzemplyar: 'Nusxa', original_fixed: 'Tuzatilgan original', ekzemplyar_fixed: 'Tuzatilgan nusxa' },
    kontrolyorMap: { prinyat: 'Qabul qilindi', otkaz: 'Rad etildi' },
  },
  uzc: {
    sheet: 'Чек', date: 'Сана', contract: 'Шартнома рақами', manager: 'Менежер', branch: 'Сотув офиси',
    object: 'Обект', vid: 'Шартнома тури', kontrolyor: 'Контролёр', shtrafy: 'Жарима', prichina: 'Рад этиш сабаби', dobavil: 'Қўшди',
    vidMap: { original: 'Оригинал', ekzemplyar: 'Нусха', original_fixed: 'Тузатилган оригинал', ekzemplyar_fixed: 'Тузатилган нусха' },
    kontrolyorMap: { prinyat: 'Қабул қилинди', otkaz: 'Рад этилди' },
  },
  ru: {
    sheet: 'Чек', date: 'Дата', contract: 'Номер договора', manager: 'Менеджер', branch: 'Сотув офис',
    object: 'Объект', vid: 'Вид договора', kontrolyor: 'Контролёр', shtrafy: 'Штрафы', prichina: 'Причина отказа', dobavil: 'Добавил',
    vidMap: { original: 'Оригинал', ekzemplyar: 'Экземпляр', original_fixed: 'Тугирланган Оригинал', ekzemplyar_fixed: 'Тугирланган Экземпляр' },
    kontrolyorMap: { prinyat: 'Принят', otkaz: 'Отказ' },
  },
  en: {
    sheet: 'Chek', date: 'Date', contract: 'Contract', manager: 'Manager', branch: 'Sales office',
    object: 'Object', vid: 'Contract type', kontrolyor: 'Controller', shtrafy: 'Penalty', prichina: 'Rejection reason', dobavil: 'Added by',
    vidMap: { original: 'Original', ekzemplyar: 'Copy', original_fixed: 'Corrected original', ekzemplyar_fixed: 'Corrected copy' },
    kontrolyorMap: { prinyat: 'Accepted', otkaz: 'Rejected' },
  },
};

/** BigInt → number (jarima summasi kichik — xavfsiz) va Date → ISO */
function serialize(row: any) {
  if (!row) return row;
  return {
    ...row,
    shtrafy: row.shtrafy == null ? null : Number(row.shtrafy),
    data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : row.data,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    tgSentAt: row.tgSentAt instanceof Date ? row.tgSentAt.toISOString() : (row.tgSentAt ?? null),
  };
}

@Injectable()
export class ChekService {
  private readonly log = new Logger(ChekService.name);
  private lastNotifyAt = 0;

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  /** CRM'dan menejer / sotuv ofisi / obyekt (Baza tab — shartnoma kiritilganda) */
  async crmLookup(contract: string) {
    return this.crm.getContractMeta(contract);
  }

  /** Baza tab — jonli autocomplete (shartnoma yozganda moslar) */
  async crmSearch(contract: string) {
    return this.crm.searchContracts(contract, 8);
  }

  async create(dto: CreateChekDto, actor: Actor) {
    const contract = dto.contractNumber?.trim();
    if (!contract) throw new BadRequestException('Shartnoma raqami kerak');

    const row = await this.prisma.chekDog.create({
      data: {
        contractNumber: contract,
        manager: dto.manager || null,
        managerPhone: dto.managerPhone || null,
        branchName: dto.branchName || null,
        objectName: dto.objectName || null,
        crmStatus: dto.crmStatus || null,
        data: new Date(dto.data),
        vidDogovora: dto.vidDogovora,
        kontrolyor: dto.kontrolyor,
        prichinaOtkaza: dto.prichinaOtkaza || null,
        shtrafy: dto.shtrafy != null ? BigInt(dto.shtrafy) : null,
        dobavilId: actor?.id || null,
        dobavilName: actor?.name || null,
      },
    });
    return { ok: true, item: serialize(row) };
  }

  /** Tarix tab — ro'yxat (qidiruv + paginatsiya) */
  async list(opts: { q?: string; page?: number; perPage?: number }) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(1, opts.perPage || 50));
    const q = opts.q?.trim();

    // Faqat shartnoma raqami bo'yicha qidiruv
    const where = q
      ? { contractNumber: { contains: q, mode: 'insensitive' as const } }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.chekDog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.chekDog.count({ where }),
    ]);

    return {
      ok: true,
      total,
      page,
      perPage,
      items: rows.map(serialize),
    };
  }

  /** Filtrlangan ma'lumotni Excel (.xlsx) sifatida eksport */
  async exportXlsx(filters: {
    q?: string; manager?: string; branch?: string; object?: string;
    kontrolyor?: string; dateFrom?: string; dateTo?: string; lang?: string;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const where: any = {};
    if (filters.q?.trim()) where.contractNumber = { contains: filters.q.trim(), mode: 'insensitive' };
    if (filters.manager) where.manager = filters.manager;
    if (filters.branch) where.branchName = filters.branch;
    if (filters.object) where.objectName = filters.object;
    if (filters.kontrolyor) where.kontrolyor = filters.kontrolyor;
    if (filters.dateFrom || filters.dateTo) {
      where.data = {};
      if (filters.dateFrom) where.data.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.data.lte = new Date(filters.dateTo);
    }

    const items = await this.prisma.chekDog.findMany({ where, orderBy: { createdAt: 'desc' } });
    const L = EXPORT_LABELS[filters.lang || 'ru'] || EXPORT_LABELS.ru;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet(L.sheet);
    ws.columns = [
      { header: L.date, key: 'data', width: 12 },
      { header: L.contract, key: 'contract', width: 18 },
      { header: L.manager, key: 'manager', width: 26 },
      { header: L.branch, key: 'branch', width: 18 },
      { header: L.object, key: 'object', width: 24 },
      { header: L.vid, key: 'vid', width: 20 },
      { header: L.kontrolyor, key: 'kontrolyor', width: 16 },
      { header: L.shtrafy, key: 'shtrafy', width: 14 },
      { header: L.prichina, key: 'prichina', width: 30 },
      { header: L.dobavil, key: 'dobavil', width: 26 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };

    for (const it of items) {
      const raw = it.data instanceof Date ? it.data.toISOString().slice(0, 10) : String(it.data).slice(0, 10);
      const [y, m, dd] = raw.split('-');
      ws.addRow({
        data: dd && m && y ? `${dd}.${m}.${y}` : raw,
        contract: it.contractNumber,
        manager: it.manager || '',
        branch: it.branchName || '',
        object: it.objectName || '',
        vid: L.vidMap[it.vidDogovora] || it.vidDogovora,
        kontrolyor: L.kontrolyorMap[it.kontrolyor] || it.kontrolyor,
        shtrafy: it.shtrafy != null ? Number(it.shtrafy) : '',
        prichina: it.prichinaOtkaza || '',
        dobavil: it.dobavilName || '',
      });
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `chek_${ts}.xlsx` };
  }

  async getOne(id: string) {
    const row = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Topilmadi');
    return { ok: true, item: serialize(row) };
  }

  async update(id: string, dto: UpdateChekDto) {
    const exists = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Topilmadi');

    const data: any = {};
    if (dto.contractNumber !== undefined) data.contractNumber = dto.contractNumber.trim();
    if (dto.manager !== undefined) data.manager = dto.manager || null;
    if (dto.managerPhone !== undefined) data.managerPhone = dto.managerPhone || null;
    if (dto.branchName !== undefined) data.branchName = dto.branchName || null;
    if (dto.objectName !== undefined) data.objectName = dto.objectName || null;
    if (dto.data !== undefined) data.data = new Date(dto.data);
    if (dto.vidDogovora !== undefined) data.vidDogovora = dto.vidDogovora;
    if (dto.kontrolyor !== undefined) {
      data.kontrolyor = dto.kontrolyor;
      // Kontrolyor o'zgarsa (masalan otkaz -> prinyat, "To'g'rlandi") — qayta yuborilsin
      if (dto.kontrolyor !== exists.kontrolyor) { data.tgSend = false; data.tgSentAt = null; }
    }
    if (dto.prichinaOtkaza !== undefined) data.prichinaOtkaza = dto.prichinaOtkaza || null;
    if (dto.shtrafy !== undefined) data.shtrafy = dto.shtrafy != null ? BigInt(dto.shtrafy) : null;
    if (dto.tgSend !== undefined) data.tgSend = dto.tgSend;

    const row = await this.prisma.chekDog.update({ where: { id }, data });
    return { ok: true, item: serialize(row) };
  }

  async remove(id: string) {
    const exists = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Topilmadi');
    await this.prisma.chekDog.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────── Telegram ─────────────────────

  async getTgConfig(): Promise<ChekTgConfig> {
    const s = await this.prisma.setting.findUnique({ where: { key: TG_CONFIG_KEY } });
    if (!s?.value) return { ...DEFAULT_TG };
    try { return { ...DEFAULT_TG, ...JSON.parse(s.value) }; } catch { return { ...DEFAULT_TG }; }
  }

  async setTgConfig(cfg: Partial<ChekTgConfig>, by?: string): Promise<{ ok: true; config: ChekTgConfig }> {
    const cur = await this.getTgConfig();
    const next: ChekTgConfig = {
      botToken: (cfg.botToken ?? cur.botToken).trim(),
      groupId: String(cfg.groupId ?? cur.groupId).trim(),
      intervalMin: Math.max(1, Number(cfg.intervalMin ?? cur.intervalMin) || 5),
      fromHour: Math.min(23, Math.max(0, Number(cfg.fromHour ?? cur.fromHour) || 0)),
      toHour: Math.min(24, Math.max(0, Number(cfg.toHour ?? cur.toHour) || 24)),
      enabled: cfg.enabled ?? cur.enabled,
    };
    await this.prisma.setting.upsert({
      where: { key: TG_CONFIG_KEY },
      create: { key: TG_CONFIG_KEY, value: JSON.stringify(next), updatedBy: by || null },
      update: { value: JSON.stringify(next), updatedBy: by || null },
    });
    return { ok: true, config: next };
  }

  private buildTgMessage(row: any): string {
    const vid = TG_VID[row.vidDogovora] || row.vidDogovora || '—';
    const kontr = row.kontrolyor === 'otkaz' ? '❌ Отказ' : '✅ Принят';
    const dt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    let when = '';
    try {
      when = new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'Asia/Tashkent',
      }).format(dt).replace(', ', ' ');
    } catch { when = dt.toISOString().slice(0, 16).replace('T', ' '); }

    const lines = [
      '📣 Реестр Договоров',
      `📄 Договор №: ${row.contractNumber}`,
      `👨‍💼 Менеджер: ${row.manager || '—'}`,
      `🏢 Офис продаж: ${row.branchName || '—'}`,
      `📌 Статус: ${row.crmStatus || '—'}`,
      `📑 Вид договора: ${vid}`,
      `🕵️ Контролёр: ${kontr}`,
    ];
    if (row.kontrolyor === 'otkaz' && row.prichinaOtkaza) lines.push(`⚠️ Причина: ${row.prichinaOtkaza}`);
    lines.push(`🕒 ${when}`);
    return lines.join('\n');
  }

  private async tgSendMessage(token: string, chatId: string, text: string): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        this.log.warn(`Telegram sendMessage ${res.status}: ${t.slice(0, 200)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.log.warn(`Telegram sendMessage xato: ${e?.message}`);
      return false;
    }
  }

  /** Bitta yozuvni qo'lda yuborish — force=true bo'lsa tgSend holatiga qaramaydi */
  async sendOne(id: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.getTgConfig();
    if (!cfg.botToken || !cfg.groupId) return { ok: false, error: 'Telegram sozlanmagan (token/guruh)' };
    const row = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Topilmadi');
    const ok = await this.tgSendMessage(cfg.botToken, cfg.groupId, this.buildTgMessage(row));
    if (ok) await this.prisma.chekDog.update({ where: { id }, data: { tgSend: true, tgSentAt: new Date() } });
    return { ok, error: ok ? undefined : 'Yuborilmadi' };
  }

  /** Test xabar — sozlamalarni tekshirish uchun */
  async tgTest(): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.getTgConfig();
    if (!cfg.botToken || !cfg.groupId) return { ok: false, error: 'Telegram sozlanmagan (token/guruh)' };
    const ok = await this.tgSendMessage(cfg.botToken, cfg.groupId, '✅ Реестр Договоров — тест хабари. Бот ишлаяпти.');
    return { ok, error: ok ? undefined : 'Yuborilmadi' };
  }

  private inWindow(hour: number, from: number, to: number): boolean {
    if (from === to) return true;                 // 24 soat
    if (from < to) return hour >= from && hour < to;
    return hour >= from || hour < to;             // tungi oralik
  }

  /** Har daqiqada tekshiradi; enabled + soat oynasi + interval bo'yicha yuboradi. */
  @Cron(CronExpression.EVERY_MINUTE)
  async notifyCron() {
    try {
      const cfg = await this.getTgConfig();
      if (!cfg.enabled || !cfg.botToken || !cfg.groupId) return;

      const hourStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Tashkent' }).format(new Date());
      const hour = Number(hourStr);
      if (!this.inWindow(hour, cfg.fromHour, cfg.toHour)) return;

      const now = Date.now();
      if (now - this.lastNotifyAt < cfg.intervalMin * 60_000) return;
      this.lastNotifyAt = now;

      // Faqat yuborilmagan (tgSend=false) yozuvlar
      const rows = await this.prisma.chekDog.findMany({
        where: { tgSend: false },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      if (rows.length === 0) return;

      let sent = 0;
      for (const row of rows) {
        const ok = await this.tgSendMessage(cfg.botToken, cfg.groupId, this.buildTgMessage(row));
        if (ok) {
          await this.prisma.chekDog.update({ where: { id: row.id }, data: { tgSend: true, tgSentAt: new Date() } });
          sent++;
        }
      }
      if (sent > 0) this.log.log(`chek TG: ${sent} ta xabar yuborildi`);
    } catch (e: any) {
      this.log.warn(`chek notifyCron xato: ${e?.message}`);
    }
  }
}
