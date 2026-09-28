import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { redactSecrets } from './leader-code-tools.service';
import { ToolImpl } from './leader.types';

/**
 * Leader agentlari — FACTS asboblari (v1: FAQAT O'QISH).
 *
 * Qoidalar:
 *  - Biznes jadvallarga hech narsa yozilmaydi; tashqi (bank/CRM) so'rov yo'q.
 *  - Faqat kerakli maydonlar select qilinadi. Sirlar (parol, token, kalit hash, sid, login),
 *    IP, telefon, pinfl, email, fayl yo'llari, xom JSON — hech qachon qaytarilmaydi.
 *  - Kirish tekshiriladi: sana (YYYY-MM-DD, Toshkent), oraliq <= 31 kun, limit/soat chegaralari.
 *  - Natija JSON-xavfsiz: BigInt/Decimal -> Number, Date -> Toshkent vaqti matni; ~19 KB dan oshmaydi.
 *  - Xato bo'lsa throw emas — { error } qaytariladi.
 *  - Raw SQL faqat READ ONLY tranzaksiya ichida, parametrli $queryRaw bilan.
 */

const TZ_MS = 5 * 60 * 60 * 1000; // Toshkent = UTC+5 (yozgi vaqt yo'q)
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 31;
const MAX_RESULT_CHARS = 19_000;
const XATO_CACHE_MS = 10 * 60 * 1000;
const COMMON_NOTE = " Vaqtlar Toshkent (UTC+5), summalar so'mda. Faqat o'qiydi.";

/** Setting jadvalidan faqat shu kalitlar o'qiladi (qolganlarida sir bo'lishi mumkin). */
const SETTING_WHITELIST = new Set<string>([
  'sverka.telegram.notifiedToday',
  'sverka.telegram.history',
  'crmSverka.lastRun',
  'bulkSync.enabled',
  'bulkSync.lastRunAt',
  'bulkSync.timeOfDay',
  'bulkSync.intervalDays',
  'sync.minDate',
  'xonpay.cron.enabled',
  'xonpay.cron.intervalMinutes',
  'shmitd.enabled',
  'shmitd.cronTimes',
  'counterparties.xontaminot.lastSyncAt',
  'counterparties.xontaminot.lastSyncStats',
  'agent.lastResult',
  'oplatykv.txAutoSyncMinutes',
  'oplatykv.txMinDate',
]);

/** Kirish xatosi — modelga aniq sabab bilan { error } qaytadi. */
class FactsInputError extends Error {}

type Handler = (input: any) => Promise<any>;

interface FactDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  handler: Handler;
}

// ─── Vaqt yordamchilari ─────────────────────────────────────────────

/** Toshkent bo'yicha bugungi sana (YYYY-MM-DD). */
function tashToday(): string {
  return new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
}

/** Date -> 'YYYY-MM-DD HH:mm' (Toshkent). */
function tashStr(d: Date | null | undefined): string | null {
  if (!d || isNaN(d.getTime())) return null;
  return new Date(d.getTime() + TZ_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** ISO matn -> Toshkent vaqti matni (o'qib bo'lmasa qisqartirilgan asl matn). */
function isoTash(s: any): string | null {
  if (s === undefined || s === null || s === '') return null;
  const d = new Date(String(s));
  return isNaN(d.getTime()) ? clean(s, 40) : tashStr(d);
}

/**
 * Deploy logi vaqti ('YYYY-MM-DD HH:mm:ss', deploy.sh `date` — server soat mintaqasida, zonasiz) -> Toshkent.
 * Node jarayoni server TZ'sida ishlaydi, shuning uchun zonasiz matn lokal vaqt sifatida o'qiladi.
 */
function localTash(s: any): string | null {
  if (s === undefined || s === null || s === '') return null;
  const str = String(s).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(str);
  const d = m ? new Date(`${m[1]}T${m[2]}`) : new Date(str);
  return isNaN(d.getTime()) ? clean(str, 40) : tashStr(d);
}

/** @db.Date ustun -> 'YYYY-MM-DD' (UTC yarim tun sifatida saqlanadi). */
function dateOnly(d: Date | null | undefined): string | null {
  if (!d || isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dayStart(d: string): Date {
  return new Date(`${d}T00:00:00+05:00`);
}

function dayEnd(d: string): Date {
  return new Date(`${d}T23:59:59.999+05:00`);
}

function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Raw SQL uchun UTC timestamp matni (ustunlar tz'siz, UTC saqlanadi) — session TimeZone'ga bog'liq emas. */
function pgTs(d: Date): string {
  return d.toISOString().replace('T', ' ').replace('Z', '');
}

/** Davomiylik: "2 soat 10 daq" ko'rinishida. */
function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0 daq';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} daq`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} soat ${min % 60} daq`;
  return `${Math.floor(h / 24)} kun ${h % 24} soat`;
}

// ─── Kirish tekshiruvi ──────────────────────────────────────────────

function parseDay(v: any, field: string): string | null {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const raw = String(v).trim();
  const s = raw.toLowerCase();
  const today = tashToday();
  if (s === 'bugun' || s === 'today') return today;
  if (s === 'kecha' || s === 'yesterday') return addDays(today, -1);
  let y: number;
  let m: number;
  let d: number;
  let mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) {
    y = +mt[1]; m = +mt[2]; d = +mt[3];
  } else if ((mt = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/))) {
    d = +mt[1]; m = +mt[2]; y = +mt[3];
  } else if ((mt = s.match(/^(\d{1,2})[./](\d{1,2})$/))) {
    d = +mt[1]; m = +mt[2]; y = +today.slice(0, 4);
  } else {
    throw new FactsInputError(`${field}: sana formati noto'g'ri ("${raw.slice(0, 20)}"), YYYY-MM-DD kerak`);
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 2000 || y > 2100) {
    throw new FactsInputError(`${field}: bunday sana yo'q ("${raw.slice(0, 20)}")`);
  }
  return dt.toISOString().slice(0, 10);
}

/** Oraliq: ikkalasi yo'q -> bugun; faqat date_from -> bugungacha; faqat date_to -> o'sha bitta kun. */
function parseRange(input: any): { from: string; to: string; days: number } {
  const today = tashToday();
  let from = parseDay(input?.date_from, 'date_from');
  let to = parseDay(input?.date_to, 'date_to');
  if (!from && !to) {
    from = today;
    to = today;
  } else if (!to) {
    to = from <= today ? today : from;
  } else if (!from) {
    from = to;
  }
  if (from > to) throw new FactsInputError(`date_from (${from}) date_to (${to}) dan keyin bo'lmasin`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new FactsInputError(`Oraliq ${days} kun — ko'pi bilan ${MAX_RANGE_DAYS} kun bo'lsin, bo'lib so'ra`);
  }
  return { from, to, days };
}

function parseIntArg(v: any, def: number, min: number, max: number, field: string, notes: string[]): number {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new FactsInputError(`${field}: son bo'lishi kerak`);
  let k = Math.floor(n);
  if (k < min) { notes.push(`${field} ${min} ga ko'tarildi`); k = min; }
  if (k > max) { notes.push(`${field} ${max} bilan cheklandi`); k = max; }
  return k;
}

function parseText(v: any, field: string, maxLen: number, required: boolean): string | null {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw new FactsInputError(`${field} majburiy`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > maxLen) throw new FactsInputError(`${field}: ${maxLen} belgidan uzun bo'lmasin`);
  return s;
}

function parseDirection(v: any): 'IN' | 'OUT' {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'IN' || s === 'KIRIM') return 'IN';
  if (s === 'OUT' || s === 'CHIQIM') return 'OUT';
  throw new FactsInputError("direction: 'IN' (kirim) yoki 'OUT' (chiqim) bo'lishi kerak");
}

// ─── Qiymat tozalash ────────────────────────────────────────────────

/** Pul -> Number (2 xona). Decimal/BigInt/string/null qabul qiladi. */
function money(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Erkin matnni tozalash: avval umumiy redaktor (leader-code-tools: token shakllari, SNAKE/camelCase
 * tayinlashlar — BANK_FORWARDER_SECRET=, DB_PASSWORD:, accessToken, xt_, JWT, AKIA, Bearer, qisqa kodlar),
 * keyin URL ichidagi login:parol, email, pinfl (14 raqam), +998 telefonlar, Telegram guruh ID yashiriladi;
 * uzunlik cheklanadi. Xato matnlari va izohlar shu orqali o'tadi.
 */
function clean(v: any, max = 200): string | null {
  if (v === undefined || v === null) return null;
  let t = redactSecrets(typeof v === 'string' ? v : String(v));
  t = t
    .replace(/-100\d{9,13}\b/g, '***')
    .replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}/g, '***')
    .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, '***')
    .replace(/\bx[sk]_live_\w+/g, '***')
    .replace(/\bghp_\w+/g, '***')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***')
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***@')
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{8,}/g, '$1 ***')
    .replace(/\b(password|passwd|pwd|parol|secret|token|api[_-]?key|apikey|sid|authorization|login)(\s*[:=]\s*)("?)[^\s"',;&]+/gi, '$1$2$3***')
    .replace(/([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+\.[A-Za-z0-9.-]+)/g, '$1***@$2')
    .replace(/\+?998[\s\-()]*\d{2}[\s\-()]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, '***')
    .replace(/\b\d{14}\b/g, '***');
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

function parseJson(s: string | null | undefined): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/** Setting'dagi yoqilgan/o'chirilgan qiymat. */
function flag(v: string | null | undefined): boolean {
  return v === '1' || v === 'true';
}

@Injectable()
export class LeaderFactsService {
  private readonly log = new Logger(LeaderFactsService.name);
  private defsCache: FactDef[] | null = null;
  // XATO tranzaksiyalar soni og'ir (CRM tasdiqlanganlar bilan solishtiradi) — 10 daqiqa kesh
  private xatoCache: { at: number; value: any } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Leader/Support/Checker uchun asboblar ro'yxati (har chaqiruvda yangi obyektlar — tashqi mutatsiyadan himoya). */
  tools(): ToolImpl[] {
    if (!this.defsCache) this.defsCache = this.buildDefs();
    return this.defsCache.map((d) => ({
      name: d.name,
      description: d.description,
      input_schema: JSON.parse(JSON.stringify(d.input_schema)),
      run: (input: any) => this.exec(d.name, d.handler, input),
    }));
  }

  // ═══════════════════ Asbob ta'riflari ═══════════════════

  private buildDefs(): FactDef[] {
    const range = {
      date_from: {
        type: 'string',
        description: "Boshlanish sanasi YYYY-MM-DD (Toshkent kuni); 'bugun'/'kecha' ham bo'ladi. Ikkalasi berilmasa — bugun. Faqat date_from berilsa — o'sha kundan bugungacha.",
      },
      date_to: {
        type: 'string',
        description: "Tugash sanasi YYYY-MM-DD (shu kun ham kiradi). Bitta kun uchun date_from bilan bir xil ber. Oraliq ko'pi bilan 31 kun.",
      },
    };
    const hours = {
      hours: { type: 'integer', minimum: 1, maximum: 72, description: "Oxirgi necha soat (1-72, standart 24)." },
    };
    const empty = { type: 'object', properties: {}, additionalProperties: false };

    return [
      {
        name: 'txn_summary',
        description:
          "Bank tranzaksiyalari bo'yicha kirim (IN) va chiqim (OUT) jami: holat kesimi, bank kesimi, kategoriya kesimi va " +
          "(oraliq 1 kundan ko'p bo'lsa) kunma-kun. Asosiy jami faqat COMPLETED va UZS. TRANSFER (o'z hisoblarimiz orasidagi " +
          "o'tkazma) jamiga KIRADI — alohida ko'rsatilgan, tashqi kirim taxmini ham bor. Qachon: 'bugun/kecha/shu hafta bankka " +
          "qancha tushdi, qancha chiqdi', 'kirim trendi'. Mijozlarning kvartira to'lovlari uchun client_income ishlat." + COMMON_NOTE,
        input_schema: { type: 'object', properties: { ...range }, additionalProperties: false },
        handler: (i) => this.txnSummary(i),
      },
      {
        name: 'txn_top',
        description:
          "Oraliqdagi eng katta bank tranzaksiyalari (kirim yoki chiqim), summa bo'yicha kamayish tartibida: summa, vaqt, " +
          "kimdan/kimga, shartnoma, bank, hisob, kategoriya kodi, izoh (120 belgi), holat. Standart holatda faqat COMPLETED. " +
          "Qachon: 'bugungi eng katta kirimlar', 'kimga katta pul chiqdi'." + COMMON_NOTE,
        input_schema: {
          type: 'object',
          properties: {
            ...range,
            direction: { type: 'string', enum: ['IN', 'OUT'], description: 'IN = kirim, OUT = chiqim.' },
            limit: { type: 'integer', minimum: 1, maximum: 20, description: "Nechta (1-20, standart 10)." },
            only_completed: { type: 'boolean', description: "true (standart) — faqat COMPLETED; false — barcha holatlar." },
          },
          required: ['direction'],
          additionalProperties: false,
        },
        handler: (i) => this.txnTop(i),
      },
      {
        name: 'client_income',
        description:
          "Mijozlardan tushum (OplataKv — kvartira/avtostoyanka to'lovlari jadvali): vznos to'lovlari kunma-kun jami va soni, " +
          "1-vznos/oylik bo'linishi, to'lov turi kesimi, top 10 obyekt, qaytarishlar (vozvrat) alohida. jami ichida " +
          "'Vznos ot imeni klienta' ham bor — bu o'z shartnomalarimiz reestri (tushum emas): obyekt reytingidan chiqarilgan, " +
          "summasi boshqaShaxsNomidan da alohida. jami panel 'Kunlik xulosa' bilan bir xil. Qachon: 'bugun mijozlardan qancha " +
          "tushdi', 'qaysi obyektga ko'p tushdi', 'qaytarishlar qancha'. Bank tushumi uchun txn_summary." + COMMON_NOTE,
        input_schema: { type: 'object', properties: { ...range }, additionalProperties: false },
        handler: (i) => this.clientIncome(i),
      },
      {
        name: 'contract_payments',
        description:
          "Bitta shartnoma bo'yicha to'lovlar: OplataKv jami (sof, to'langan, qaytarilgan, 1-vznos, oylik, soni), oxirgi 10 " +
          "qator, CRM keshidan mijoz nomi/obyekt/holat, bank tomonida shu shartnoma raqamli COMPLETED tranzaksiyalar jami. " +
          "Aniq topilmasa o'xshash raqamlar taklif qilinadi. Qachon: 'X shartnoma bo'yicha qancha to'langan', 'oxirgi " +
          "to'lovi qachon'. Telefon va shaxsiy ma'lumot berilmaydi." + COMMON_NOTE,
        input_schema: {
          type: 'object',
          properties: { contract_no: { type: 'string', description: 'Shartnoma raqami (aynan yoki katta-kichik harfsiz).' } },
          required: ['contract_no'],
          additionalProperties: false,
        },
        handler: (i) => this.contractPayments(i),
      },
      {
        name: 'account_balances',
        description:
          "Bank hisoblaridagi qoldiq (BankAccount.balance): hisoblar ro'yxati (qoldiq bo'yicha, ko'pi bilan 20) va bank kesimida " +
          "jami. Jamiga faqat sync yoqilgan va bank faol hisoblar kiradi; sync'siz hisob qoldig'i noma'lum. lastSyncedAt qoldiq " +
          "qanchalik yangi ekanini ko'rsatadi. Qachon: 'hisoblarda qancha pul bor', 'Kapitalbankda qoldiq qancha'." + COMMON_NOTE,
        input_schema: {
          type: 'object',
          properties: {
            bank: { type: 'string', description: "Bank kodi yoki nomi qismi (masalan KAPITALBANK, ipak, hamkor). Ixtiyoriy." },
            account: { type: 'string', description: "Hisob raqami yoki egasi nomi qismi. Ixtiyoriy." },
          },
          additionalProperties: false,
        },
        handler: (i) => this.accountBalances(i),
      },
      {
        name: 'sync_status',
        description:
          "Bank sync salomatligi: har faol hisob uchun oxirgi sync logi va signallar — stale (uzoq vaqt sync yo'q), " +
          "login_suspect (PARTIAL, 0 ta olingan, 10+ xato: ehtimol login/parol/IP muammosi), hung (RUNNING 15 daqiqadan " +
          "oshgan), failed; bugungi sync jami; bank ulanishlari holati (sirlarsiz). Qachon: 'qaysi bank sync bo'lmayapti', " +
          "'bank ulanishi ishlayaptimi', 'bugun nechta yangi yozuv keldi'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.syncStatus(),
      },
      {
        name: 'sverka_status',
        description:
          "Bank sverkasi holati: bugungi farqlar (hisob, bank, farq summasi, aybdor taxmini, yopilganmi) — avtomat sverka " +
          "saqlagan natija; sverka tarixi (oxirgi 10 amal); CRM va OplataKv sverkasining oxirgi ishga tushishi. Jonli sverka " +
          "QILINMAYDI. Hamkorbank sverka qilinmaydi. Qachon: 'bugun sverkada farq bormi', 'CRM sverka qachon ishladi'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.sverkaStatus(),
      },
      {
        name: 'xato_summary',
        description:
          "XATO to'lovlar va tuzatish arizalari: arizalar holat bo'yicha (pending/approved/rejected), AI agent holati, bugun " +
          "yuborilgan va ko'rib chiqilgan, agent o'zi hal qilganlar, kutayotganlardan 5 namuna; CRM'da tasdiqlanmagan " +
          "shartnomali CLIENT tranzaksiyalar soni va summasi (10 daqiqa kesh). Qachon: 'XATO to'lovlar nechta', 'arizalar " +
          "qancha kutyapti', 'agent nechtasini hal qildi'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.xatoSummary(),
      },
      {
        name: 'bank_changes',
        description:
          "Bank tomonida o'chirilgan (DELETED), o'zgartirilgan (EDITED) yoki boshqa kunga ko'chirilgan (MOVED) tranzaksiyalar " +
          "(aniqlangan vaqt bo'yicha): tur bo'yicha soni va summa, oxirgi 20 yozuv. Qachon: 'bank bugun biror to'lovni " +
          "o'chirdimi', 'qaysi to'lovlar o'zgardi'." + COMMON_NOTE,
        input_schema: { type: 'object', properties: { ...range }, additionalProperties: false },
        handler: (i) => this.bankChanges(i),
      },
      {
        name: 'integrations_status',
        description:
          "Integratsiyalar holati: XonPay sync (oxirgi 5, restart orfanlari belgilangan) va 7 kunlik moslanmagan XonPay " +
          "to'lovlari, Google Sheets eksport (har sheet oxirgi 2 ishga tushishi), Shmidt hisobot (oxirgi 3), bulk-sync jadvali, " +
          "kontragentlar (DIDOX) yangilanishi, XATO-notifikator oxirgi natijasi, oxirgi Excel importlar. Qachon: 'XonPay " +
          "ishlayaptimi', 'eksport cron xato beryaptimi', 'Shmidt hisobot ketdimi', 'bulk sync qachon ishladi'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.integrationsStatus(),
      },
      {
        name: 'api_usage',
        description:
          "Tashqi developer API (/api/v1) foydalanishi oxirgi N soatda: status sinflari (2xx/4xx/5xx), top 10 yo'l, kalit nomi " +
          "bo'yicha so'rovlar, noyob IP SONI (IP'larning o'zi berilmaydi), oxirgi 5xx xatolar; API kalitlar ro'yxati (sirsiz). " +
          "Qachon: 'API'ga kim murojaat qilyapti', 'API xato beryaptimi', 'qaysi kalit muddati tugaydi'." + COMMON_NOTE,
        input_schema: { type: 'object', properties: { ...hours }, additionalProperties: false },
        handler: (i) => this.apiUsage(i),
      },
      {
        name: 'panel_activity',
        description:
          "Admin paneldagi amallar oxirgi N soatda (faqat o'zgartiruvchi so'rovlar: POST/PATCH/PUT/DELETE): oxirgi 30 amal " +
          "(kim, modul, amal, natija), foydalanuvchi va modul bo'yicha soni, muvaffaqiyatsiz kirishlar soni; oxirgi kirgan 10 " +
          "foydalanuvchi. IP berilmaydi. Qachon: 'bugun panelda kim nima qildi', 'kim oxirgi marta kirdi', 'parol terish " +
          "urinishlari bormi'." + COMMON_NOTE,
        input_schema: { type: 'object', properties: { ...hours }, additionalProperties: false },
        handler: (i) => this.panelActivity(i),
      },
      {
        name: 'deploy_status',
        description:
          "Oxirgi deploy holati (idle/running/success/failed, commit, boshlangan/tugagan vaqt, xato) va git'dagi oxirgi 10 " +
          "commit. Qachon: 'oxirgi deploy qachon bo'ldi', 'deploy muvaffaqiyatlimi', 'serverda qaysi versiya turibdi'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.deployStatus(),
      },
      {
        name: 'system_status',
        description:
          "Server resurslari: disk bandligi (%), xotira (RAM), yuklama (load average), server va backend jarayoni ishlash " +
          "vaqti, Node versiyasi. Qachon: 'server qanday ahvolda', 'disk to'lib qoldimi', 'backend qachon qayta ishga tushgan'." + COMMON_NOTE,
        input_schema: empty,
        handler: () => this.systemStatus(),
      },
    ];
  }

  // ═══════════════════ Umumiy ijro ═══════════════════

  private async exec(name: string, fn: Handler, input: any): Promise<any> {
    const t0 = Date.now();
    try {
      const args = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      const out = await fn(args);
      const res = this.fit(this.safe(out));
      const ms = Date.now() - t0;
      if (ms > 5000) this.log.warn(`facts ${name}: ${ms} ms (sekin)`);
      return res;
    } catch (e: any) {
      if (e instanceof FactsInputError) return { error: e.message };
      this.log.warn(`facts ${name} xato: ${clean(e?.message, 300)}`);
      return { error: `Ma'lumot olinmadi (${name}): ${clean(e?.message, 200) || "noma'lum xato"}` };
    }
  }

  /** JSON-xavfsiz: BigInt/Decimal -> Number, Date -> Toshkent vaqti, NaN/Infinity -> null. */
  private safe(v: any, depth = 0): any {
    if (v === null || v === undefined) return v === undefined ? undefined : null;
    if (depth > 8) return null;
    if (typeof v === 'bigint') {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : v.toString();
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v instanceof Date) return tashStr(v);
    if (Prisma.Decimal.isDecimal(v)) return money(v);
    if (Array.isArray(v)) return v.map((x) => this.safe(x, depth + 1));
    if (typeof v === 'object') {
      const o: Record<string, any> = {};
      for (const k of Object.keys(v)) {
        const x = this.safe(v[k], depth + 1);
        if (x !== undefined) o[k] = x;
      }
      return o;
    }
    return v;
  }

  /** Natija hajmini cheklash: eng katta massivlarni yarmiga qisqartiradi. */
  private fit(obj: any, max = MAX_RESULT_CHARS): any {
    let s = JSON.stringify(obj);
    if (s.length <= max || !obj || typeof obj !== 'object') return obj;
    for (let i = 0; i < 16 && s.length > max; i++) {
      const arrs: Array<{ holder: any; key: string; len: number }> = [];
      const walk = (o: any, depth: number) => {
        if (!o || typeof o !== 'object' || depth > 4) return;
        for (const k of Object.keys(o)) {
          const x = o[k];
          if (Array.isArray(x) && x.length > 1) arrs.push({ holder: o, key: k, len: JSON.stringify(x).length });
          if (x && typeof x === 'object') walk(x, depth + 1);
        }
      };
      walk(obj, 0);
      if (!arrs.length) break;
      arrs.sort((a, b) => b.len - a.len);
      const t = arrs[0];
      t.holder[t.key] = t.holder[t.key].slice(0, Math.ceil(t.holder[t.key].length / 2));
      obj.qisqartirildi = "Natija katta edi — ro'yxatlar qisqartirildi";
      s = JSON.stringify(obj);
    }
    if (s.length > max) return { error: "Natija juda katta — oraliqni qisqartirib qayta so'ra" };
    return obj;
  }

  /** Prisma groupBy — TS'dagi 'having' mapped-type muammosi sabab any (mavjud koddagi kabi). */
  private gb(delegate: any, args: any): Promise<any[]> {
    return delegate.groupBy(args);
  }

  /** Raw SQL faqat READ ONLY tranzaksiya ichida (+ 15 s statement_timeout). */
  private async readOnly<T = any>(query: Prisma.PrismaPromise<T>): Promise<T> {
    const res = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
      this.prisma.$executeRawUnsafe("SET LOCAL statement_timeout = '15s'"),
      query,
    ]);
    return res[2] as T;
  }

  /** Setting'lardan faqat oq ro'yxatdagilarni o'qiydi. */
  private async readSettings(keys: string[]): Promise<Record<string, { value: string | null; updatedAt: Date }>> {
    const allowed = keys.filter((k) => SETTING_WHITELIST.has(k));
    const out: Record<string, { value: string | null; updatedAt: Date }> = {};
    if (!allowed.length) return out;
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: allowed } },
      select: { key: true, value: true, updatedAt: true },
    });
    for (const r of rows) out[r.key] = { value: r.value, updatedAt: r.updatedAt };
    return out;
  }

  private repoDir(): string {
    return process.env.LEADER_REPO_DIR || path.resolve(process.cwd(), '..');
  }

  /** git — shell'siz, 10 s timeout. */
  private git(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args],
        { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout ?? ''))),
      );
    });
  }

  // ═══════════════════ 1. txn_summary ═══════════════════

  private async txnSummary(input: any) {
    const r = parseRange(input);
    const where: any = { txnDate: { gte: dayStart(r.from), lte: dayEnd(r.to) } };
    const doneUzs: any = { ...where, status: 'COMPLETED', currency: 'UZS' };

    const [byState, byBank, byCat, banks, cats] = await Promise.all([
      this.gb(this.prisma.transaction, {
        by: ['direction', 'status', 'currency'], where,
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.gb(this.prisma.transaction, {
        by: ['bankId', 'direction'], where: doneUzs,
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.gb(this.prisma.transaction, {
        by: ['categoryId', 'direction'], where: doneUzs,
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.prisma.bank.findMany({ select: { id: true, code: true } }),
      this.prisma.category.findMany({ select: { id: true, code: true, name: true } }),
    ]);

    const empty = () => ({ summa: 0, soni: 0 });
    const add = (acc: { summa: number; soni: number }, g: any) => {
      acc.summa = money(acc.summa + money(g._sum?.amount));
      acc.soni += num(g._count?._all);
    };

    const tot = { IN: empty(), OUT: empty() };
    const other: any[] = [];
    const holat = byState.map((g) => ({
      yonalish: g.direction, holat: g.status, valyuta: g.currency,
      summa: money(g._sum?.amount), soni: num(g._count?._all),
    }));
    for (const g of byState) {
      if (g.status !== 'COMPLETED') continue;
      if (g.currency === 'UZS') add(tot[g.direction as 'IN' | 'OUT'], g);
      else other.push({ yonalish: g.direction, valyuta: g.currency, summa: money(g._sum?.amount), soni: num(g._count?._all) });
    }

    const bankCode = new Map(banks.map((b) => [b.id, b.code]));
    const perBank = new Map<string, { bank: string; kirim: any; chiqim: any }>();
    for (const g of byBank) {
      const code = bankCode.get(g.bankId) || "(bank yo'q)";
      const row = perBank.get(code) || { bank: code, kirim: empty(), chiqim: empty() };
      add(g.direction === 'IN' ? row.kirim : row.chiqim, g);
      perBank.set(code, row);
    }

    const catMap = new Map(cats.map((c) => [c.id, c]));
    const transfer = { IN: empty(), OUT: empty() };
    const catRows: Record<'IN' | 'OUT', any[]> = { IN: [], OUT: [] };
    for (const g of byCat) {
      const c = catMap.get(g.categoryId);
      if (c?.code === 'TRANSFER') add(transfer[g.direction as 'IN' | 'OUT'], g);
      catRows[g.direction as 'IN' | 'OUT'].push({
        kod: c?.code || '(kategoriyasiz)', nomi: c?.name || null,
        summa: money(g._sum?.amount), soni: num(g._count?._all),
      });
    }
    for (const k of ['IN', 'OUT'] as const) {
      catRows[k].sort((a, b) => b.summa - a.summa);
      catRows[k] = catRows[k].slice(0, 8);
    }

    // Kunma-kun (Toshkent kuni) — faqat oraliq 1 kundan ko'p bo'lsa
    let kunlik: any[] | undefined;
    if (r.days > 1) {
      const rows = await this.readOnly<any[]>(this.prisma.$queryRaw<any[]>`
        SELECT to_char((t.txn_date + interval '5 hours')::date, 'YYYY-MM-DD') AS d,
               t.direction::text AS dir,
               COALESCE(SUM(t.amount), 0) AS s,
               COUNT(*)::int AS n
        FROM transactions t
        WHERE t.txn_date >= ${pgTs(dayStart(r.from))}::timestamp
          AND t.txn_date <= ${pgTs(dayEnd(r.to))}::timestamp
          AND t.status = 'COMPLETED'
          AND t.currency = 'UZS'
        GROUP BY 1, 2
        ORDER BY 1`);
      const byDay = new Map<string, any>();
      for (const x of rows || []) {
        const row = byDay.get(x.d) || { sana: x.d, kirim: 0, kirimSoni: 0, chiqim: 0, chiqimSoni: 0 };
        if (x.dir === 'IN') { row.kirim = money(x.s); row.kirimSoni = num(x.n); } else { row.chiqim = money(x.s); row.chiqimSoni = num(x.n); }
        byDay.set(x.d, row);
      }
      kunlik = [];
      for (let d = r.from; d <= r.to; d = addDays(d, 1)) {
        kunlik.push(byDay.get(d) || { sana: d, kirim: 0, kirimSoni: 0, chiqim: 0, chiqimSoni: 0 });
      }
    }

    return {
      davr: { dan: r.from, gacha: r.to, kunlar: r.days },
      asosiyJami: {
        izoh: 'Faqat COMPLETED, UZS',
        kirim: tot.IN, chiqim: tot.OUT, sof: money(tot.IN.summa - tot.OUT.summa),
      },
      ichkiOtkazma: {
        izoh: "TRANSFER kategoriyasi (o'z hisoblarimiz orasida) — asosiy jamiga kirgan",
        kirim: transfer.IN, chiqim: transfer.OUT,
      },
      tashqiKirimTaxminiy: money(tot.IN.summa - transfer.IN.summa),
      tashqiChiqimTaxminiy: money(tot.OUT.summa - transfer.OUT.summa),
      boshqaValyuta: other.length ? other : undefined,
      holatKesimi: holat,
      bankKesimi: [...perBank.values()].sort((a, b) => b.kirim.summa - a.kirim.summa),
      kategoriyaKesimi: { kirim: catRows.IN, chiqim: catRows.OUT },
      kunlik,
      eslatma: [
        'PENDING/CANCELLED holatlar asosiy jamiga kirmaydi (holatKesimi da ko\'rinadi).',
        "Kategoriyasi qo'yilmagan tranzaksiyalar '(kategoriyasiz)' qatorida.",
      ],
    };
  }

  // ═══════════════════ 2. txn_top ═══════════════════

  private async txnTop(input: any) {
    const r = parseRange(input);
    const dir = parseDirection(input.direction);
    const notes: string[] = [];
    const limit = parseIntArg(input.limit, 10, 1, 20, 'limit', notes);
    const onlyCompleted = input.only_completed !== false && input.only_completed !== 'false';

    const where: any = { txnDate: { gte: dayStart(r.from), lte: dayEnd(r.to) }, direction: dir };
    if (onlyCompleted) where.status = 'COMPLETED';

    const rows = await this.prisma.transaction.findMany({
      where,
      orderBy: [{ amount: 'desc' }, { txnDate: 'desc' }],
      take: limit,
      select: {
        amount: true, currency: true, txnDate: true, status: true,
        fromName: true, toName: true, contractNumber: true, description: true,
        bank: { select: { code: true } },
        account: { select: { accountNo: true } },
        category: { select: { code: true } },
        subcategory: { select: { code: true } },
      },
    });

    return {
      davr: { dan: r.from, gacha: r.to, kunlar: r.days },
      yonalish: dir,
      faqatCompleted: onlyCompleted,
      soni: rows.length,
      items: rows.map((t) => ({
        summa: money(t.amount),
        valyuta: t.currency,
        vaqt: tashStr(t.txnDate),
        holat: t.status,
        kimdan: clean(t.fromName, 80),
        kimga: clean(t.toName, 80),
        shartnoma: t.contractNumber,
        bank: t.bank?.code || null,
        hisob: t.account?.accountNo || null,
        kategoriya: t.category?.code || null,
        subkategoriya: t.subcategory?.code || null,
        izoh: clean(t.description, 120),
      })),
      eslatma: notes.length ? notes : undefined,
    };
  }

  // ═══════════════════ 3. client_income ═══════════════════

  private async clientIncome(input: any) {
    const r = parseRange(input);
    const dateW = { gte: new Date(r.from), lte: new Date(r.to) };
    const vznos: any = { txType: { contains: 'взнос', mode: 'insensitive' } };
    const otImeni: any = { txType: { contains: 'от имени', mode: 'insensitive' } };
    const base: any = { date: dateW, paymentAmount: { gt: 0 }, ...vznos };
    const sums = { paymentAmount: true, firstInstallment: true, monthlyAmount: true } as const;

    const [daily, total, topObj, byType, imeni, refunds] = await Promise.all([
      this.gb(this.prisma.oplataKv, {
        by: ['date'], where: base, _sum: sums, _count: { _all: true }, orderBy: { date: 'asc' },
      }),
      this.prisma.oplataKv.aggregate({ where: base, _sum: sums, _count: { _all: true } }),
      this.gb(this.prisma.oplataKv, {
        by: ['object'], where: { ...base, NOT: otImeni },
        _sum: { paymentAmount: true }, _count: { _all: true },
        orderBy: { _sum: { paymentAmount: 'desc' } }, take: 10,
      }),
      this.gb(this.prisma.oplataKv, {
        by: ['txType'], where: base,
        _sum: { paymentAmount: true }, _count: { _all: true },
        orderBy: { _sum: { paymentAmount: 'desc' } }, take: 8,
      }),
      this.prisma.oplataKv.aggregate({
        where: { date: dateW, paymentAmount: { gt: 0 }, AND: [vznos, otImeni] } as any,
        _sum: { paymentAmount: true }, _count: { _all: true },
      }),
      this.prisma.oplataKv.aggregate({
        where: { date: dateW, paymentAmount: { lt: 0 }, txType: { startsWith: 'возврат', mode: 'insensitive' } } as any,
        _sum: { paymentAmount: true }, _count: { _all: true },
      }),
    ]);

    return {
      davr: { dan: r.from, gacha: r.to, kunlar: r.days },
      jami: {
        summa: money(total._sum?.paymentAmount),
        vznos1: money(total._sum?.firstInstallment),
        oylik: money(total._sum?.monthlyAmount),
        soni: num((total._count as any)?._all),
      },
      kunlik: daily.map((g) => ({
        sana: dateOnly(g.date),
        summa: money(g._sum?.paymentAmount),
        vznos1: money(g._sum?.firstInstallment),
        oylik: money(g._sum?.monthlyAmount),
        soni: num(g._count?._all),
      })),
      turKesimi: byType.map((g) => ({ tur: g.txType, summa: money(g._sum?.paymentAmount), soni: num(g._count?._all) })),
      topObyektlar: topObj.map((g) => ({ obyekt: g.object || '(obyektsiz)', summa: money(g._sum?.paymentAmount), soni: num(g._count?._all) })),
      boshqaShaxsNomidan: {
        izoh:
          "'Vznos ot imeni klienta' — o'z shartnomalarimiz reestri, obyekt tushumi emas. jami ichida bor (Kunlik xulosa " +
          "ham shunday), obyekt reytingidan chiqarilgan. Javobda alohida qator qilib ayt.",
        summa: money(imeni._sum?.paymentAmount),
        soni: num((imeni._count as any)?._all),
      },
      qaytarishlar: {
        izoh: "paymentAmount < 0 va turi 'vozvrat' bilan boshlanadi; summa musbat ko'rsatilgan",
        summa: Math.abs(money(refunds._sum?.paymentAmount)),
        soni: num((refunds._count as any)?._all),
      },
      eslatma: [
        "Manba: OplataKv (mijoz to'lovlari reestri), filtr: summa > 0 va turida 'vznos' so'zi bor.",
        "Sana — OplataKv.date (to'lov kuni, Toshkent kalendari).",
      ],
    };
  }

  // ═══════════════════ 4. contract_payments ═══════════════════

  private async contractPayments(input: any) {
    let cn = parseText(input.contract_no, 'contract_no', 60, true);
    const notes: string[] = [];
    const sums = { paymentAmount: true, firstInstallment: true, monthlyAmount: true } as const;

    let agg = await this.prisma.oplataKv.aggregate({ where: { contractNo: cn }, _sum: sums, _count: { _all: true } });
    let cnt = num((agg._count as any)?._all);

    // Aynan topilmasa — katta-kichik harfsiz aniq moslik
    if (cnt === 0) {
      const alt = await this.prisma.oplataKv.findFirst({
        where: { contractNo: { equals: cn, mode: 'insensitive' } },
        select: { contractNo: true },
      });
      if (alt?.contractNo && alt.contractNo !== cn) {
        notes.push(`"${cn}" o'rniga "${alt.contractNo}" topildi (harf registri farqi)`);
        cn = alt.contractNo;
        agg = await this.prisma.oplataKv.aggregate({ where: { contractNo: cn }, _sum: sums, _count: { _all: true } });
        cnt = num((agg._count as any)?._all);
      }
    }

    const [crm, last, paid, refund, bankSide] = await Promise.all([
      this.prisma.crmContract.findUnique({
        where: { contractNumber: cn },
        select: {
          customerName: true, objectName: true, apartmentNumber: true, status: true,
          virtualStatus: true, propertyType: true, found: true, lastVerifiedAt: true,
        },
      }),
      this.prisma.oplataKv.findMany({
        where: { contractNo: cn },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 10,
        select: {
          date: true, paymentAmount: true, firstInstallment: true, monthlyAmount: true,
          paymentCategory: true, txType: true, object: true, client: true, paymentMethod: true,
        },
      }),
      this.prisma.oplataKv.aggregate({ where: { contractNo: cn, paymentAmount: { gt: 0 } }, _sum: { paymentAmount: true }, _count: { _all: true } }),
      this.prisma.oplataKv.aggregate({ where: { contractNo: cn, paymentAmount: { lt: 0 } }, _sum: { paymentAmount: true }, _count: { _all: true } }),
      this.gb(this.prisma.transaction, {
        by: ['direction'], where: { contractNumber: cn, status: 'COMPLETED' },
        _sum: { amount: true }, _count: { _all: true }, _max: { txnDate: true },
      }),
    ]);

    if (cnt === 0 && !crm && bankSide.length === 0) {
      let oxshash: string[] = [];
      if (cn.length >= 3) {
        const sim = await this.gb(this.prisma.oplataKv, {
          by: ['contractNo'], where: { contractNo: { contains: cn, mode: 'insensitive' } },
          _count: { _all: true }, orderBy: { contractNo: 'asc' }, take: 5,
        });
        oxshash = sim.map((s) => s.contractNo);
      }
      return {
        shartnoma: cn,
        topildi: false,
        oxshashRaqamlar: oxshash.length ? oxshash : undefined,
        eslatma: ["OplataKv, CRM keshi va bank tranzaksiyalarida bu raqam yo'q."],
      };
    }

    const bank: any = {};
    for (const g of bankSide) {
      bank[g.direction === 'IN' ? 'kirim' : 'chiqim'] = {
        summa: money(g._sum?.amount), soni: num(g._count?._all), oxirgi: tashStr(g._max?.txnDate),
      };
    }
    const fallbackClient = last.find((x) => x.client)?.client || null;
    const fallbackObject = last.find((x) => x.object)?.object || null;

    return {
      shartnoma: cn,
      topildi: true,
      mijoz: {
        nomi: crm?.customerName || fallbackClient,
        obyekt: crm?.objectName || fallbackObject,
        xonadon: crm?.apartmentNumber || null,
        crmHolati: crm?.status || null,
        virtualHolat: crm?.virtualStatus || null,
        turi: crm?.propertyType || null,
        crmdaTasdiqlangan: crm ? crm.found : null,
        crmTekshirilgan: tashStr(crm?.lastVerifiedAt),
      },
      oplataKv: {
        sof: money(agg._sum?.paymentAmount),
        tolangan: money(paid._sum?.paymentAmount),
        tolanganSoni: num((paid._count as any)?._all),
        qaytarilgan: Math.abs(money(refund._sum?.paymentAmount)),
        qaytarilganSoni: num((refund._count as any)?._all),
        vznos1: money(agg._sum?.firstInstallment),
        oylik: money(agg._sum?.monthlyAmount),
        qatorlar: cnt,
      },
      oxirgiQatorlar: last.map((x) => ({
        sana: dateOnly(x.date),
        summa: money(x.paymentAmount),
        vznos1: x.firstInstallment == null ? null : money(x.firstInstallment),
        oylik: x.monthlyAmount == null ? null : money(x.monthlyAmount),
        toifa: x.paymentCategory,
        tur: x.txType,
        obyekt: x.object,
        usul: x.paymentMethod,
      })),
      bankTomonida: Object.keys(bank).length ? bank : null,
      eslatma: [
        ...notes,
        "sof = barcha qatorlar yig'indisi (to'lovlar - qaytarishlar/perebroska manbai).",
        "bankTomonida — shu shartnoma raqami yozilgan COMPLETED bank tranzaksiyalari (OplataKv bilan to'liq mos kelmasligi mumkin).",
      ],
    };
  }

  // ═══════════════════ 5. account_balances ═══════════════════

  private async accountBalances(input: any) {
    const bankQ = parseText(input.bank, 'bank', 40, false);
    const accQ = parseText(input.account, 'account', 60, false);
    const where: any = {};
    if (bankQ) {
      where.bank = { OR: [{ code: { contains: bankQ, mode: 'insensitive' } }, { name: { contains: bankQ, mode: 'insensitive' } }] };
    }
    if (accQ) {
      where.OR = [{ accountNo: { contains: accQ } }, { ownerName: { contains: accQ, mode: 'insensitive' } }];
    }

    const rows = await this.prisma.bankAccount.findMany({
      where,
      select: {
        accountNo: true, ownerName: true, balance: true, currency: true,
        lastSyncedAt: true, syncEnabled: true,
        bank: { select: { code: true, name: true, isActive: true } },
      },
    });

    const perBank = new Map<string, any>();
    let unknown = 0;
    const list = rows.map((a) => {
      const counted = a.syncEnabled && a.bank?.isActive && a.balance != null;
      const code = a.bank?.code || '?';
      if (counted) {
        const key = `${code}|${a.currency}`;
        const b = perBank.get(key) || { bank: code, valyuta: a.currency, jami: 0, hisoblar: 0 };
        b.jami = money(b.jami + money(a.balance));
        b.hisoblar += 1;
        perBank.set(key, b);
      } else {
        unknown += 1;
      }
      return {
        bank: code,
        accountNo: a.accountNo,
        ownerName: clean(a.ownerName, 80),
        qoldiq: a.balance == null ? null : money(a.balance),
        valyuta: a.currency,
        yangilangan: tashStr(a.lastSyncedAt),
        syncEnabled: a.syncEnabled,
        jamigaKirgan: !!counted,
      };
    });
    list.sort((x, y) => Number(y.jamigaKirgan) - Number(x.jamigaKirgan) || (y.qoldiq ?? 0) - (x.qoldiq ?? 0));

    const banks = [...perBank.values()].sort((a, b) => b.jami - a.jami);
    const umumiy: Record<string, number> = {};
    for (const b of banks) umumiy[b.valyuta] = money((umumiy[b.valyuta] || 0) + b.jami);

    return {
      filtr: { bank: bankQ, account: accQ },
      umumiyJami: umumiy,
      bankKesimi: banks,
      hisoblarSoni: rows.length,
      jamigaKirmagan: unknown,
      hisoblar: list.slice(0, 20),
      korsatilmagan: list.length > 20 ? list.length - 20 : undefined,
      eslatma: [
        "Jamiga faqat sync yoqilgan, bank faol va qoldig'i bor hisoblar kiradi; sync'siz hisob qoldig'i (0 bo'lsa ham) noma'lum.",
        "Qoldiq oddiy sync'da yangilanadi (backfill'da emas). Hamkorbank qoldig'i faqat vipiska saldo kelganda yangilanadi.",
        "yangilangan = hisobning oxirgi sync vaqti (qoldiq aynan shu paytdagi bo'lishi shart emas).",
      ],
    };
  }

  // ═══════════════════ 6. sync_status ═══════════════════

  private async syncStatus() {
    const now = Date.now();
    const today = tashToday();
    const since = new Date(now - 3 * DAY_MS);

    const [accounts, inactiveCount, creds, todayAgg, todayByStatus] = await Promise.all([
      this.prisma.bankAccount.findMany({
        where: { syncEnabled: true, bank: { isActive: true }, credential: { isActive: true } },
        select: {
          id: true, accountNo: true, ownerName: true, lastSyncedAt: true,
          bank: { select: { code: true, syncIntervalMinutes: true } },
        },
      }),
      this.prisma.bankAccount.count({
        where: { OR: [{ syncEnabled: false }, { bank: { isActive: false } }, { credential: { isActive: false } }] },
      }),
      this.prisma.bankCredential.findMany({
        select: {
          label: true, isActive: true, authMode: true, lastError: true, lastVerifiedAt: true,
          bank: { select: { code: true } },
        },
      }),
      this.prisma.syncLog.aggregate({
        where: { startedAt: { gte: dayStart(today) } },
        _sum: { fetched: true, saved: true, errors: true }, _count: { _all: true },
      }),
      this.gb(this.prisma.syncLog, {
        by: ['status'], where: { startedAt: { gte: dayStart(today) } }, _count: { _all: true },
      }),
    ]);

    // Har hisob uchun oxirgi log (oxirgi 3 kun ichida)
    const ids = accounts.map((a) => a.id);
    const latest = ids.length
      ? await this.gb(this.prisma.syncLog, {
          by: ['accountId'], where: { accountId: { in: ids }, startedAt: { gte: since } }, _max: { startedAt: true },
        })
      : [];
    const pairs = latest.filter((g) => g.accountId && g._max?.startedAt);
    const logs = pairs.length
      ? await this.prisma.syncLog.findMany({
          where: { OR: pairs.map((g) => ({ accountId: g.accountId, startedAt: g._max.startedAt })) },
          select: {
            accountId: true, status: true, fetched: true, saved: true, errors: true,
            errorMessage: true, startedAt: true, finishedAt: true,
          },
        })
      : [];
    const lastLog = new Map<string, (typeof logs)[number]>();
    for (const l of logs) if (l.accountId && !lastLog.has(l.accountId)) lastLog.set(l.accountId, l);

    const problems: any[] = [];
    const healthy: string[] = [];
    for (const a of accounts) {
      const interval = num(a.bank?.syncIntervalMinutes);
      const l = lastLog.get(a.id);
      const signals: string[] = [];
      if (interval > 0) {
        const age = a.lastSyncedAt ? now - a.lastSyncedAt.getTime() : Infinity;
        if (age > 3 * interval * 60_000) {
          signals.push(a.lastSyncedAt
            ? `stale: ${ago(age)} sync yo'q (interval ${interval} daq)`
            : "stale: hech qachon sync bo'lmagan");
        }
      }
      if (!l) {
        signals.push("no_log: oxirgi 3 kunda sync logi yo'q");
      } else {
        if (l.status === 'PARTIAL' && l.fetched === 0 && l.errors >= 10) {
          signals.push(`login_suspect: PARTIAL, 0 ta olindi, ${l.errors} xato`);
        }
        if (l.status === 'RUNNING' && now - l.startedAt.getTime() > 15 * 60_000) {
          signals.push(`hung: RUNNING ${ago(now - l.startedAt.getTime())} (restartdan qolib ketgan bo'lishi mumkin)`);
        }
        if (l.status === 'FAILED') signals.push('failed: oxirgi sync FAILED');
      }
      const code = a.bank?.code || '?';
      if (signals.length) {
        problems.push({
          bank: code,
          accountNo: a.accountNo,
          ownerName: clean(a.ownerName, 80),
          interval: interval || "avto o'chiq",
          lastSyncedAt: tashStr(a.lastSyncedAt),
          signallar: signals,
          oxirgiLog: l
            ? {
                status: l.status, fetched: l.fetched, saved: l.saved, errors: l.errors,
                errorMessage: clean(l.errorMessage, 200), startedAt: tashStr(l.startedAt), finishedAt: tashStr(l.finishedAt),
              }
            : null,
        });
      } else {
        healthy.push(`${code} ${a.accountNo}: ${tashStr(a.lastSyncedAt) || '-'}${interval ? '' : " (avto o'chiq)"}`);
      }
    }

    const holat: Record<string, number> = {};
    for (const g of todayByStatus) holat[g.status] = num(g._count?._all);

    return {
      hozir: tashStr(new Date(now)),
      jami: { faolHisoblar: accounts.length, muammoli: problems.length, sog: healthy.length, nofaolYokiSyncsiz: inactiveCount },
      muammolar: problems.slice(0, 20),
      soglar: healthy.slice(0, 20),
      bugun: {
        loglar: num((todayAgg._count as any)?._all),
        olingan: num(todayAgg._sum?.fetched),
        saqlangan: num(todayAgg._sum?.saved),
        xatolar: num(todayAgg._sum?.errors),
        holatKesimi: holat,
      },
      ulanishlar: creds.map((c) => ({
        bank: c.bank?.code || '?',
        nomi: clean(c.label, 80),
        faol: c.isActive,
        rejim: c.authMode,
        oxirgiXato: clean(c.lastError, 200),
        oxirgiTekshiruv: tashStr(c.lastVerifiedAt),
      })),
      eslatma: [
        "Login/parol xatosi ko'pincha PARTIAL + errorMessage bo'sh bo'lib yoziladi; lastSyncedAt baribir yangilanadi — shuning uchun login_suspect signaliga qara.",
        "Aniq xato matni faqat server journald logida.",
        "ulanishlar.oxirgiXato/oxirgiTekshiruv faqat qo'lda ulanish tekshiruvida yoziladi — eskirgan bo'lishi mumkin.",
        "Bank paroli muddati haqida ma'lumot tizimda yo'q.",
      ],
    };
  }

  // ═══════════════════ 7. sverka_status ═══════════════════

  /**
   * Sverka tarixi tafsiloti: chat_* amallarida (guruh qo'shish/o'chirish) tafsilot berilmaydi;
   * qolganlarida chat ID, bot nomi va guruh nomi kabi kalitlar olib tashlanadi.
   */
  private sverkaHistDetails(action: any, details: any): string | null {
    if (!details || typeof details !== 'object') return null;
    if (/^chat_/i.test(String(action || ''))) return null;
    const drop = /^(chat|chatid|chat_id|chats|name|botusername|bottoken|token)$/i;
    const safe: Record<string, any> = {};
    for (const [k, v] of Object.entries(details)) {
      if (drop.test(k)) continue;
      safe[k] = v;
    }
    return Object.keys(safe).length ? clean(JSON.stringify(safe), 150) : null;
  }

  private async sverkaStatus() {
    const today = tashToday();
    const s = await this.readSettings(['sverka.telegram.notifiedToday', 'sverka.telegram.history', 'crmSverka.lastRun']);

    const store = parseJson(s['sverka.telegram.notifiedToday']?.value);
    const isToday = store?.date === today;
    const accs: any[] = store?.accounts && typeof store.accounts === 'object' ? Object.values(store.accounts) : [];
    const items = accs
      .map((a: any) => ({
        accountNo: a?.accountNo || null,
        ownerName: clean(a?.ownerName, 80),
        bankName: a?.bankName || null,
        farq: money(a?.totalFarq),
        aybdor: clean(a?.culprit, 200),
        ishonch: a?.confidence || null,
        yopilgan: !!a?.dismissed,
      }))
      .sort((a, b) => Number(a.yopilgan) - Number(b.yopilgan) || b.farq - a.farq);
    const open = items.filter((x) => !x.yopilgan);

    const hist = parseJson(s['sverka.telegram.history']?.value);
    const history = Array.isArray(hist)
      ? hist.slice(0, 10).map((h: any) => ({
          vaqt: isoTash(h?.timestamp),
          amal: h?.action || null,
          manba: h?.source || null,
          kim: /^-?\d{6,}$/.test(String(h?.actorName ?? '').trim()) ? '(chat)' : clean(h?.actorName, 60),
          tafsilot: this.sverkaHistDetails(h?.action, h?.details),
        }))
      : [];

    const run = parseJson(s['crmSverka.lastRun']?.value);
    const crm = run
      ? {
          holat: run.status || null,
          boshlangan: isoTash(run.startedAt),
          tugagan: isoTash(run.finishedAt),
          crmSoni: run.crmCount ?? null,
          bizdaSoni: run.ourCount ?? null,
          ogohlantirish: clean(run.warning, 200),
          xato: clean(run.error, 200),
          kimBoshlagan: clean(run.actor, 60),
        }
      : null;

    return {
      bugun: today,
      bankSverka: {
        saqlanganSana: store?.date || null,
        bugungimi: isToday,
        yopilmaganFarqlar: isToday ? open.length : 0,
        yopilganlar: isToday ? items.length - open.length : 0,
        farqlar: isToday ? items.slice(0, 20) : [],
        oxirgiYangilanish: tashStr(s['sverka.telegram.notifiedToday']?.updatedAt),
      },
      tarix: history,
      crmSverka: crm,
      eslatma: [
        "Avtomat sverka har 30 daqiqada farqlarni yangilaydi (sverka chatlari sozlangan bo'lsa). Bu asbob jonli sverka qilmaydi.",
        "Faqat Kapitalbank va Ipak Yo'li hisoblari sverka qilinadi; Hamkorbank sverka qilinmaydi.",
        "Saqlangan sana bugun bo'lmasa — bugun hali farq qayd etilmagan yoki avtomat sverka ishlamagan.",
        "CRM sverka farqlari ro'yxati DB'da saqlanmaydi (faqat panelda ko'rinadi); bu yerda faqat oxirgi ishga tushish holati.",
      ],
    };
  }

  // ═══════════════════ 8. xato_summary ═══════════════════

  private async xatoSummary() {
    const today = tashToday();
    const t0 = dayStart(today);

    const [byStatusAgent, submittedToday, reviewedToday, agentAll, agentToday, oldest, samples, xato] = await Promise.all([
      this.gb(this.prisma.xatoCorrectionRequest, { by: ['status', 'agentState'], _count: { _all: true } }),
      this.prisma.xatoCorrectionRequest.count({ where: { submittedAt: { gte: t0 } } }),
      this.gb(this.prisma.xatoCorrectionRequest, {
        by: ['status', 'reviewedByType'], where: { reviewedAt: { gte: t0 } }, _count: { _all: true },
      }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'approved', reviewedByType: 'agent' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'approved', reviewedByType: 'agent', reviewedAt: { gte: t0 } } }),
      this.prisma.xatoCorrectionRequest.findFirst({
        where: { status: 'pending' }, orderBy: { submittedAt: 'asc' }, select: { submittedAt: true },
      }),
      this.prisma.xatoCorrectionRequest.findMany({
        where: { status: 'pending' },
        orderBy: { submittedAt: 'desc' },
        take: 5,
        select: {
          submittedAt: true, submittedByName: true, source: true, proposedContractNo: true,
          snapContractNo: true, snapAmount: true, snapObject: true, agentState: true, agentReason: true,
        },
      }),
      this.xatoTxCount(),
    ]);

    const holat: Record<string, number> = {};
    const agentHolati: Record<string, number> = {};
    const pendingAgent: Record<string, number> = {};
    for (const g of byStatusAgent) {
      const n = num(g._count?._all);
      holat[g.status] = (holat[g.status] || 0) + n;
      const a = g.agentState || "yo'q";
      agentHolati[a] = (agentHolati[a] || 0) + n;
      if (g.status === 'pending') pendingAgent[a] = (pendingAgent[a] || 0) + n;
    }
    const korildi: Record<string, number> = {};
    for (const g of reviewedToday) {
      const k = `${g.status}/${g.reviewedByType || '?'}`;
      korildi[k] = (korildi[k] || 0) + num(g._count?._all);
    }

    return {
      arizalar: {
        holat,
        agentHolati,
        kutayotganlarAgentHolati: pendingAgent,
        bugunYuborilgan: submittedToday,
        bugunKorildi: korildi,
        agentHalQilganJami: agentAll,
        agentHalQilganBugun: agentToday,
        engEskiKutayotgan: tashStr(oldest?.submittedAt),
        kutayotganNamunalar: samples.map((x) => ({
          yuborilgan: tashStr(x.submittedAt),
          kim: clean(x.submittedByName, 60),
          manba: x.source,
          taklifShartnoma: x.proposedContractNo,
          asliShartnoma: x.snapContractNo,
          summa: x.snapAmount == null ? null : money(x.snapAmount),
          obyekt: clean(x.snapObject, 60),
          agentHolati: x.agentState,
          agentIzohi: clean(x.agentReason, 150),
        })),
      },
      xatoTranzaksiyalar: xato,
      eslatma: [
        "XATO tranzaksiya = CLIENT kategoriya, shartnoma raqami bor, qo'lda kiritilmagan, import emas, CRM'da tasdiqlanmagan.",
        "agentHalQilgan = status approved va reviewedByType agent.",
      ],
    };
  }

  /** CRM'da tasdiqlanmagan shartnomali CLIENT tranzaksiyalar (og'ir — 10 daqiqa kesh). */
  private async xatoTxCount(): Promise<any> {
    if (this.xatoCache && Date.now() - this.xatoCache.at < XATO_CACHE_MS) {
      return { ...this.xatoCache.value, keshdan: true };
    }
    try {
      const rows = await this.readOnly<any[]>(this.prisma.$queryRaw<any[]>`
        SELECT COUNT(*) FILTER (WHERE t.xato_hidden IS NOT TRUE)::int AS active,
               COALESCE(SUM(t.amount) FILTER (WHERE t.xato_hidden IS NOT TRUE), 0) AS active_sum,
               COUNT(*) FILTER (WHERE t.xato_hidden = true)::int AS hidden
        FROM transactions t
        JOIN categories c ON c.id = t.category_id AND c.code = 'CLIENT'
        WHERE t.is_contract_manual = false
          AND t.source NOT IN ('IMPORT', 'ALOQA_BANK')
          AND t.contract_number IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM crm_contracts cc
            WHERE cc.contract_number = t.contract_number AND cc.found = true
          )`);
      const r0 = rows?.[0] || {};
      const value = {
        faol: num(r0.active),
        faolSumma: money(r0.active_sum),
        yashirilgan: num(r0.hidden),
        hisoblangan: tashStr(new Date()),
      };
      this.xatoCache = { at: Date.now(), value };
      return value;
    } catch (e: any) {
      this.log.warn(`xatoTxCount xato: ${clean(e?.message, 200)}`);
      return { error: `XATO soni olinmadi: ${clean(e?.message, 150)}` };
    }
  }

  // ═══════════════════ 9. bank_changes ═══════════════════

  private async bankChanges(input: any) {
    const r = parseRange(input);
    const where: any = { detectedAt: { gte: dayStart(r.from), lte: dayEnd(r.to) } };

    const [byType, last] = await Promise.all([
      this.gb(this.prisma.transactionChangeLog, {
        by: ['changeType'], where, _count: { _all: true }, _sum: { amount: true },
      }),
      this.prisma.transactionChangeLog.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        take: 20,
        select: {
          changeType: true, detectedAt: true, txnDate: true, amount: true, direction: true,
          contractNumber: true, accountNoSnap: true, bankNameSnap: true, fieldsChanged: true,
          detectedBy: true, note: true,
        },
      }),
    ]);

    return {
      davr: { dan: r.from, gacha: r.to, kunlar: r.days },
      turKesimi: byType.map((g) => ({ tur: g.changeType, soni: num(g._count?._all), summa: money(g._sum?.amount) })),
      oxirgilar: last.map((x) => ({
        tur: x.changeType,
        aniqlangan: tashStr(x.detectedAt),
        tranzaksiyaVaqti: tashStr(x.txnDate),
        summa: x.amount == null ? null : money(x.amount),
        yonalish: x.direction,
        shartnoma: x.contractNumber,
        hisob: x.accountNoSnap,
        bank: x.bankNameSnap,
        ozgarganMaydonlar: (x.fieldsChanged || []).slice(0, 10),
        kimAniqladi: clean(x.detectedBy, 60),
        izoh: clean(x.note, 150),
      })),
      eslatma: [
        "DELETED = bank tomonida o'chirilgan/bekor qilingan, EDITED = maydon o'zgargan, MOVED = boshqa kunga ko'chirilgan.",
        "Davr aniqlangan vaqt (detectedAt) bo'yicha, tranzaksiya sanasi bo'yicha emas.",
      ],
    };
  }

  // ═══════════════════ 10. integrations_status ═══════════════════

  private async integrationsStatus() {
    const today = tashToday();
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const settingKeys = [
      'bulkSync.enabled', 'bulkSync.lastRunAt', 'bulkSync.timeOfDay', 'bulkSync.intervalDays', 'sync.minDate',
      'xonpay.cron.enabled', 'xonpay.cron.intervalMinutes', 'shmitd.enabled', 'shmitd.cronTimes',
      'counterparties.xontaminot.lastSyncAt', 'counterparties.xontaminot.lastSyncStats', 'agent.lastResult',
      'oplatykv.txAutoSyncMinutes', 'oplatykv.txMinDate',
    ];

    const [xpLogs, xpUnmatched, sheets, shmitd, cpErr, cpAgg, imports, st] = await Promise.all([
      this.prisma.xonpaySyncLog.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5,
        select: {
          trigger: true, status: true, fetched: true, inserted: true, updated: true, matched: true,
          errors: true, errorMessage: true, startedAt: true, finishedAt: true, durationMs: true,
        },
      }),
      this.prisma.xonpayTransaction.aggregate({
        where: { isMatched: false, datePaid: { gte: new Date(addDays(today, -6)), lte: new Date(today) } },
        _sum: { amount: true }, _count: { _all: true },
      }),
      this.gb(this.prisma.exportCronLog, {
        by: ['sheetId'], where: { startedAt: { gte: since30 } }, _max: { startedAt: true },
        orderBy: { _max: { startedAt: 'desc' } }, take: 15,
      }),
      this.prisma.shmitdLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: 3,
        select: {
          targetDate: true, sentAt: true, status: true, totalCount: true, yellowCount: true,
          redCount: true, error: true, triggeredBy: true,
        },
      }),
      this.prisma.counterparty.count({ where: { isActive: true, lastFetchError: { not: null } } }),
      this.prisma.counterparty.aggregate({ where: { isActive: true }, _count: { _all: true }, _max: { lastFetchedAt: true } }),
      this.prisma.importBatch.findMany({
        orderBy: { importedAt: 'desc' },
        take: 3,
        select: {
          kind: true, fileName: true, importedBy: true, importedAt: true,
          rowsTotal: true, rowsAdded: true, rowsSkipped: true, rowsErrors: true,
        },
      }),
      this.readSettings(settingKeys),
    ]);

    // Har sheet uchun oxirgi 2 ishga tushish
    const perSheet = await Promise.all(
      sheets.map((s) =>
        this.prisma.exportCronLog.findMany({
          where: { sheetId: s.sheetId },
          orderBy: { startedAt: 'desc' },
          take: 2,
          select: {
            sheetName: true, source: true, writeMode: true, mode: true, status: true,
            rowsFetched: true, rowsWritten: true, durationMs: true, error: true, triggeredBy: true, startedAt: true,
          },
        }),
      ),
    );

    const v = (k: string) => st[k]?.value ?? null;
    const lastResult = v('agent.lastResult');
    let agentVaqt: string | null = null;
    let agentMatn: string | null = null;
    if (lastResult) {
      const ix = lastResult.indexOf(' · ');
      if (ix > 0) {
        agentVaqt = isoTash(lastResult.slice(0, ix));
        agentMatn = clean(lastResult.slice(ix + 3), 250);
      } else {
        agentMatn = clean(lastResult, 250);
      }
    }
    const xpInterval = Number(v('xonpay.cron.intervalMinutes'));

    return {
      xonpay: {
        cronYoqilgan: v('xonpay.cron.enabled') !== 'false',
        intervalDaq: Number.isFinite(xpInterval) && xpInterval > 0 ? xpInterval : 60,
        oxirgiSynclar: xpLogs.map((l) => ({
          trigger: l.trigger,
          status: l.status,
          orfan: !!l.errorMessage && l.errorMessage.includes('orphan'),
          olingan: l.fetched, qoshilgan: l.inserted, yangilangan: l.updated, moslangan: l.matched, xatolar: l.errors,
          xato: clean(l.errorMessage, 200),
          boshlangan: tashStr(l.startedAt),
          tugagan: tashStr(l.finishedAt),
          davomiylikSek: l.durationMs == null ? null : Math.round(l.durationMs / 1000),
        })),
        moslanmagan7kun: {
          soni: num((xpUnmatched._count as any)?._all),
          summa: money(xpUnmatched._sum?.amount),
          izoh: "XonPay'da bor, bankda hali topilmagan (oxirgi 7 kun, to'lov sanasi bo'yicha); bugungi/kechagilar hali bankka tushmagan bo'lishi mumkin",
        },
      },
      googleEksport: perSheet
        .filter((rows) => rows.length)
        .map((rows) => ({
          sheet: rows[0].sheetName,
          manba: rows[0].source,
          yozishRejimi: rows[0].writeMode,
          oxirgi: {
            status: rows[0].status, rejim: rows[0].mode, olingan: rows[0].rowsFetched, yozilgan: rows[0].rowsWritten,
            davomiylikSek: Math.round(num(rows[0].durationMs) / 1000), xato: clean(rows[0].error, 200),
            kim: clean(rows[0].triggeredBy, 60), vaqt: tashStr(rows[0].startedAt),
          },
          oldingiStatus: rows[1]?.status || null,
          ketmaKet2Xato: rows.length === 2 && rows[0].status === 'error' && rows[1].status === 'error',
        })),
      shmidt: {
        yoqilgan: flag(v('shmitd.enabled')),
        vaqtlar: v('shmitd.cronTimes'),
        oxirgilar: shmitd.map((x) => ({
          hisobotSanasi: x.targetDate, yuborilgan: tashStr(x.sentAt), status: x.status,
          jami: x.totalCount, sariq: x.yellowCount, qizil: x.redCount,
          xato: clean(x.error, 200), kim: clean(x.triggeredBy, 60),
        })),
      },
      bulkSync: {
        yoqilgan: flag(v('bulkSync.enabled')),
        soat: v('bulkSync.timeOfDay') || '18:00',
        intervalKun: Number(v('bulkSync.intervalDays')) || 1,
        oxirgiIshlagan: isoTash(v('bulkSync.lastRunAt')),
      },
      bankSync: { minSana: v('sync.minDate') },
      oplataKvAvtoSync: {
        intervalDaq: Number(v('oplatykv.txAutoSyncMinutes')) || 0,
        minSana: v('oplatykv.txMinDate'),
      },
      kontragentlar: {
        faol: num((cpAgg._count as any)?._all),
        xatoliYangilanish: cpErr,
        oxirgiYangilanganKontragent: tashStr(cpAgg._max?.lastFetchedAt),
        xontaminotOxirgiSync: isoTash(v('counterparties.xontaminot.lastSyncAt')),
        xontaminotStatistika: clean(v('counterparties.xontaminot.lastSyncStats'), 300),
      },
      xatoNotifikator: { vaqt: agentVaqt, natija: agentMatn },
      oxirgiImportlar: imports.map((b) => ({
        tur: b.kind, fayl: clean(b.fileName, 80), kim: clean(b.importedBy, 60), vaqt: tashStr(b.importedAt),
        jami: b.rowsTotal, qoshilgan: b.rowsAdded, otkazilgan: b.rowsSkipped, xatolar: b.rowsErrors,
      })),
      eslatma: [
        "XonPay 'orfan' = server restartida uzilgan sync (haqiqiy nosozlik emas).",
        "OplataKv avto-sync oxirgi vaqti faqat xotirada saqlanadi — DB'da logi yo'q.",
      ],
    };
  }

  // ═══════════════════ 11. api_usage ═══════════════════

  private async apiUsage(input: any) {
    const notes: string[] = [];
    const h = parseIntArg(input.hours, 24, 1, 72, 'hours', notes);
    const since = new Date(Date.now() - h * 3600_000);
    const where: any = { createdAt: { gte: since } };

    const [byCode, topPaths, byKey, agg, ipRows, keys, err5xx] = await Promise.all([
      this.gb(this.prisma.apiRequestLog, { by: ['statusCode'], where, _count: { _all: true } }),
      this.gb(this.prisma.apiRequestLog, {
        by: ['path'], where, _count: { path: true }, orderBy: { _count: { path: 'desc' } }, take: 10,
      }),
      this.gb(this.prisma.apiRequestLog, { by: ['apiKeyId'], where, _count: { _all: true } }),
      this.prisma.apiRequestLog.aggregate({ where, _count: { _all: true }, _avg: { durationMs: true }, _max: { durationMs: true } }),
      this.readOnly<any[]>(this.prisma.$queryRaw<any[]>`
        SELECT COUNT(DISTINCT ip)::int AS n
        FROM api_request_logs
        WHERE created_at >= ${pgTs(since)}::timestamp`),
      this.prisma.apiKey.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true, name: true, scopes: true, isActive: true, expiresAt: true, revokedAt: true,
          lastUsedAt: true, totalRequests: true,
        },
      }),
      this.prisma.apiRequestLog.findMany({
        where: { ...where, statusCode: { gte: 500 } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { method: true, path: true, statusCode: true, errorMessage: true, createdAt: true },
      }),
    ]);

    const sinf: Record<string, number> = {};
    for (const g of byCode) {
      const k = `${Math.floor(num(g.statusCode) / 100)}xx`;
      sinf[k] = (sinf[k] || 0) + num(g._count?._all);
    }
    const keyName = new Map(keys.map((k) => [k.id, k.name]));
    // Ro'yxatda bo'lmagan (eski) kalitlar nomini alohida olamiz
    const missing = byKey.map((g) => g.apiKeyId).filter((id) => id && !keyName.has(id));
    if (missing.length) {
      const extra = await this.prisma.apiKey.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } });
      for (const k of extra) keyName.set(k.id, k.name);
    }
    const now = Date.now();

    return {
      oyna: { soat: h, dan: tashStr(since) },
      jami: num((agg._count as any)?._all),
      ortachaMs: agg._avg?.durationMs == null ? null : Math.round(num(agg._avg.durationMs)),
      maksMs: agg._max?.durationMs ?? null,
      statusSinflari: sinf,
      topYollar: topPaths.map((g) => ({ yol: clean(g.path, 120), soni: num(g._count?.path) })),
      kalitBoyicha: byKey
        .map((g) => ({ kalit: g.apiKeyId ? keyName.get(g.apiKeyId) || "(o'chirilgan kalit)" : '(kalitsiz)', soni: num(g._count?._all) }))
        .sort((a, b) => b.soni - a.soni)
        .slice(0, 15),
      noyobIpSoni: num(ipRows?.[0]?.n),
      oxirgi5xx: err5xx.map((x) => ({
        vaqt: tashStr(x.createdAt), method: x.method, yol: clean(x.path, 120), status: x.statusCode, xato: clean(x.errorMessage, 150),
      })),
      kalitlar: keys.map((k) => ({
        nomi: k.name,
        ruxsatlar: (k.scopes || []).slice(0, 10),
        faol: k.isActive,
        muddati: tashStr(k.expiresAt),
        muddatiOtgan: !!k.expiresAt && k.expiresAt.getTime() < now,
        bekorQilingan: tashStr(k.revokedAt),
        oxirgiIshlatilgan: tashStr(k.lastUsedAt),
        jamiSorovlar: k.totalRequests,
      })),
      eslatma: notes.length ? notes : undefined,
    };
  }

  // ═══════════════════ 12. panel_activity ═══════════════════

  private async panelActivity(input: any) {
    const notes: string[] = [];
    const h = parseIntArg(input.hours, 24, 1, 72, 'hours', notes);
    const since = new Date(Date.now() - h * 3600_000);
    const where: any = { createdAt: { gte: since } };

    const [last, total, failedLogins, byUser, byModule, users, userCounts] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          userName: true, module: true, action: true, method: true,
          statusCode: true, success: true, createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.count({ where: { ...where, module: 'auth', success: false, path: { endsWith: '/login' } } }),
      this.gb(this.prisma.auditLog, {
        by: ['userName'], where: { ...where, userName: { not: null } },
        _count: { userName: true }, orderBy: { _count: { userName: 'desc' } }, take: 10,
      }),
      this.gb(this.prisma.auditLog, {
        by: ['module'], where, _count: { module: true }, orderBy: { _count: { module: 'desc' } }, take: 10,
      }),
      this.prisma.adminUser.findMany({
        where: { lastLoginAt: { not: null } },
        orderBy: { lastLoginAt: 'desc' },
        take: 10,
        select: { fullName: true, lastLoginAt: true, isActive: true, role: true, roleRef: { select: { name: true } } },
      }),
      this.gb(this.prisma.adminUser, { by: ['isActive'], _count: { _all: true } }),
    ]);

    const who = (name: string | null) => clean(name, 60) || "(ism yo'q)";
    const uc: Record<string, number> = {};
    for (const g of userCounts) uc[g.isActive ? 'faol' : 'nofaol'] = num(g._count?._all);

    return {
      oyna: { soat: h, dan: tashStr(since) },
      jamiAmallar: total,
      muvaffaqiyatsizKirishlar: failedLogins,
      foydalanuvchiBoyicha: byUser.map((g) => ({ kim: clean(g.userName, 60) || '(nomsiz)', soni: num(g._count?.userName) })),
      modulBoyicha: byModule.map((g) => ({ modul: g.module, soni: num(g._count?.module) })),
      oxirgiAmallar: last.map((x) => ({
        vaqt: tashStr(x.createdAt),
        kim: who(x.userName),
        modul: x.module,
        amal: clean(x.action, 120),
        method: x.method,
        status: x.statusCode,
        muvaffaqiyatli: x.success,
      })),
      oxirgiKirganlar: users.map((u) => ({
        kim: who(u.fullName),
        rol: u.roleRef?.name || u.role,
        faol: u.isActive,
        oxirgiKirish: tashStr(u.lastLoginAt),
      })),
      foydalanuvchilarSoni: uc,
      eslatma: [
        "Faqat o'zgartiruvchi so'rovlar (POST/PATCH/PUT/DELETE) yoziladi; ko'rish (GET) yozilmaydi.",
        ...notes,
      ],
    };
  }

  // ═══════════════════ 13. deploy_status ═══════════════════

  private async deployStatus() {
    let st: any = null;
    let manba = '';
    try {
      const svc = this.moduleRef.get(DeployService, { strict: false });
      if (svc) {
        st = await svc.status();
        manba = 'DeployService';
      }
    } catch { /* fallback — HTTP */ }
    if (!st) {
      try {
        const port = process.env.PORT || '3001';
        const r = await fetch(`http://127.0.0.1:${port}/api/_deploy/status`, { signal: AbortSignal.timeout(5000) });
        st = await r.json();
        manba = 'http';
      } catch (e: any) {
        st = { ok: false, error: e?.message };
        manba = "yo'q";
      }
    }

    const deploy = {
      manba,
      holat: st?.state ?? null,
      commit: st?.currentCommit || null,
      boshlangan: localTash(st?.startedAt),
      tugagan: localTash(st?.finishedAt),
      xabar: clean(st?.message, 200),
      xato: clean(st?.error, 300),
      joriyFaza: st?.currentPhase ?? null,
      progressFoiz: st?.progressPercent ?? null,
      otganSoniya: st?.elapsedSeconds || null,
    };

    let git: any;
    try {
      const dir = this.repoDir();
      const [branch, log] = await Promise.all([
        this.git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).catch(() => ''),
        this.git(['log', '-10', '--format=%h|%ad|%s', '--date=iso'], dir),
      ]);
      git = {
        branch: branch.trim() || null,
        commitlar: log
          .split('\n')
          .filter((l) => l.trim())
          .map((line) => {
            const [hash, sana, ...rest] = line.split('|');
            return { hash, sana: localTash(sana) || sana, xabar: clean(rest.join('|'), 150) };
          }),
      };
    } catch (e: any) {
      git = { error: `git log o'qilmadi: ${clean(e?.message, 150)}` };
    }

    return {
      deploy,
      git,
      eslatma: [
        'Deploy va commit vaqtlari Toshkent vaqtiga o\'girilgan (deploy logi server soatida yoziladi).',
        "Holat: idle — deploy yo'q/log bo'sh, running — ketmoqda, success — muvaffaqiyatli, failed — xato bilan tugagan.",
      ],
    };
  }

  // ═══════════════════ 14. system_status ═══════════════════

  private async systemStatus() {
    const dir = this.repoDir();
    let disk: any;
    try {
      disk = await this.diskInfo(dir);
    } catch (e: any) {
      disk = { error: `Disk o'qilmadi: ${clean(e?.message, 150)}` };
    }

    const total = os.totalmem();
    const free = os.freemem();
    let available: number | null = null;
    try {
      const mi = await fs.promises.readFile('/proc/meminfo', 'utf8');
      const m = mi.match(/^MemAvailable:\s+(\d+)\s+kB/m);
      if (m) available = Number(m[1]) * 1024;
    } catch { /* linux emas */ }
    const avail = available ?? free;
    const gb = (b: number) => Math.round((b / 1024 ** 3) * 100) / 100;
    const load = os.loadavg();

    return {
      disk,
      xotira: {
        jamiGb: gb(total),
        boshGb: gb(avail),
        bandFoiz: total > 0 ? Math.round(((total - avail) / total) * 1000) / 10 : null,
        izoh: available != null ? 'MemAvailable (kesh bo\'shatilishi mumkin qismi bilan)' : 'os.freemem',
      },
      yuklama: {
        m1: Math.round(load[0] * 100) / 100,
        m5: Math.round(load[1] * 100) / 100,
        m15: Math.round(load[2] * 100) / 100,
        cpuSoni: os.cpus()?.length || null,
      },
      serverIshlashVaqti: ago(os.uptime() * 1000),
      backendIshlashVaqti: ago(process.uptime() * 1000),
      backendRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      node: process.version,
      platforma: `${os.platform()} ${os.release()}`,
      hozir: tashStr(new Date()),
    };
  }

  private async diskInfo(dir: string): Promise<any> {
    const gb = (b: number) => Math.round((b / 1024 ** 3) * 100) / 100;
    const statfs = (fs.promises as any).statfs;
    if (typeof statfs === 'function') {
      const s = await statfs.call(fs.promises, dir);
      const bsize = Number(s.bsize);
      const used = (Number(s.blocks) - Number(s.bfree)) * bsize;
      const avail = Number(s.bavail) * bsize;
      const pct = used + avail > 0 ? (used / (used + avail)) * 100 : 0;
      return { jamiGb: gb(Number(s.blocks) * bsize), bandGb: gb(used), boshGb: gb(avail), bandFoiz: Math.round(pct * 10) / 10 };
    }
    // Eski Node — df (shell'siz)
    const out: string = await new Promise((resolve, reject) => {
      execFile('df', ['-Pk', dir], { timeout: 10_000, windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(String(stdout ?? ''))));
    });
    const line = out.trim().split('\n')[1] || '';
    const p = line.split(/\s+/);
    const totalK = Number(p[1]);
    const usedK = Number(p[2]);
    const availK = Number(p[3]);
    if (!Number.isFinite(totalK) || !Number.isFinite(usedK) || !Number.isFinite(availK)) {
      throw new Error("df natijasi tushunarsiz");
    }
    const pct = usedK + availK > 0 ? (usedK / (usedK + availK)) * 100 : 0;
    return { jamiGb: gb(totalK * 1024), bandGb: gb(usedK * 1024), boshGb: gb(availK * 1024), bandFoiz: Math.round(pct * 10) / 10 };
  }
}
