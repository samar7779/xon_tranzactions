import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { contractVariants } from './contract-parser';

/**
 * CRM shartnomalari uchun lokal kesh.
 *
 * Maqsad: har tranzaksiyada XonSaroy CRM'ga so'rov yubormaslik.
 *
 * Ish jarayoni:
 *   1) lookup(number) chaqiriladi
 *   2) Avval `crm_contracts` jadvalida bormi (variantlar bilan)
 *      - Bor va so'nggi 24 soat ichida tekshirilgan → keshdan qaytaramiz
 *      - Bor lekin eskirgan → fonda yangilash (lekin keshni qaytaramiz, kutib o'tirmaymiz)
 *      - Yo'q → CRM'ga so'rov
 *   3) CRM javobi keladi → keshga yoziladi
 *   4) CRM'da topilmasa ham keshda `found=false` qatori qoladi (qayta-qayta urinmaslik uchun)
 */

export interface CachedContract {
  contractNumber: string;
  customerName: string | null;
  status: string | null;
  objectName: string | null;
  apartmentNumber: string | null;
  phone: string | null;
  found: boolean;
  lastVerifiedAt: Date;
}

export interface ReverifyStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number;
  done: number;
  fixed: number;      // CRM'да topildi → found=true bo'ldi
  notFound: number;   // CRM'да yo'q (haqiqatan topilmadi)
  errors: number;     // CRM API xatosi (timeout va h.k.)
  fixedSamples: { contract: string; from?: string | null; client: string | null; object: string | null; status: string | null }[];
  notFoundSamples: { contract: string; reason: string }[];
}

const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 soat
// Avval 7 kun edi — juda uzoq. Endi 4 soatda bir marta XATO shartnomalar
// qayta CRM ga tekshiriladi (CRM ma'lumotlari tezroq sinxronlanadi).
const NOT_FOUND_RETRY_AFTER_MS = 4 * 60 * 60 * 1000; // 4 soat

@Injectable()
export class CrmContractCacheService {
  private readonly log = new Logger(CrmContractCacheService.name);

  // Bir vaqtda bir xil shartnomaga ikkita parallel so'rov ketmasligi uchun in-flight map
  private inflight = new Map<string, Promise<CachedContract | null>>();

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  /**
   * Shartnoma raqami bo'yicha kesh + CRM lookup.
   * O/0 variantlarini ham tekshiradi.
   *
   * @param opts.forceRefresh — true bo'lsa cache o'chiriladi va fresh CRM lookup qilinadi
   */
  async lookup(
    contractNumber: string,
    opts?: { forceRefresh?: boolean; payerHint?: string },
  ): Promise<CachedContract | null> {
    if (!contractNumber) return null;
    // № va N° simbollarini olib tashlaymiz + bo'shliqlarni tozalaymiz
    const key = contractNumber
      .replace(/№/g, '')
      .replace(/N°/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toUpperCase();
    if (!key) return null;

    if (opts?.forceRefresh) {
      // Cache o'chiramiz — fresh lookup
      const variants = contractVariants(key).slice(0, 16);
      await this.prisma.crmContract.deleteMany({
        where: { contractNumber: { in: variants } },
      });
    }

    // Parallel chaqiruvlarni birlashtirish (number bo'yicha kesh)
    let cached: CachedContract | null;
    const existing = this.inflight.get(key);
    if (existing) {
      cached = await existing;
    } else {
      const promise = this.doLookup(key, opts?.payerHint).finally(() => this.inflight.delete(key));
      this.inflight.set(key, promise);
      cached = await promise;
    }

    // ── DUBLIKAT: kesh mijozi izoh (payerHint) ichidagi ismга mos kelmasa —
    // bir raqamда bir necha shartnoma bo'lishi mumkin. payer bo'yicha to'g'risini
    // qayta hal qilamiz (faqat payerHint berilганда — categorization). Fresh fetch
    // pickContractByName orqali izohdagi ismга mos shartnomani tanlaydi.
    if (opts?.payerHint && cached?.found && !this.crm.matchesPayer(cached.customerName, opts.payerHint)) {
      try {
        const specific = await this.fetchFromCrmAndCache(key, opts.payerHint);
        if (specific?.found) return specific;
      } catch { /* ignore — kesh qaytadi */ }
    }
    return cached;
  }

  private async doLookup(key: string, payerHint?: string): Promise<CachedContract | null> {
    // 1) Keshda bormi — variantlar bilan
    const variants = contractVariants(key).slice(0, 16); // xavfsizlik chegarasi
    const cached = await this.prisma.crmContract.findFirst({
      where: { contractNumber: { in: variants } },
      // FIX (B#9): found=true'ni prioritetlashtir — bir kalitga found=false + found=true
      // qatorlar bo'lsa, tasdiqlangani tanlanadi (CRM'da bor shartnoma XATO'да qotmasin).
      orderBy: [{ found: 'desc' }, { lastVerifiedAt: 'desc' }],
    });

    if (cached) {
      const age = Date.now() - cached.lastVerifiedAt.getTime();
      const stale = cached.found ? age > STALE_AFTER_MS : age > NOT_FOUND_RETRY_AFTER_MS;

      if (!stale) {
        // crm_status hali tekshirilmagan (eski, feature'dan oldingi qator) — fonda
        // bir marta yangilaymiz. Tekshirilgach virtualStatus '' yoki qiymat bo'ladi
        // (null EMAS), shu bois takror so'ralmaydi.
        if (cached.found && cached.virtualStatus == null) {
          this.refreshVirtualStatus(cached.contractNumber).catch(() => { /* ignore */ });
        }
        return toCached(cached);
      }
      // Eskirgan + found=false → SINXRON yangilab ko'ramiz (CRM ma'lumoti yangilangan bo'lishi mumkin)
      // Eskirgan + found=true → fonda yangilab keshdan qaytaramiz (tez)
      if (!cached.found) {
        // Cache o'chiramiz va yangidan CRM ga so'raymiz
        await this.prisma.crmContract.deleteMany({ where: { contractNumber: { in: variants } } });
        return this.fetchFromCrmAndCache(key, payerHint);
      }
      this.refreshInBackground(cached.contractNumber).catch(() => { /* ignore */ });
      return toCached(cached);
    }

    // 2) Yangi — CRM'ga so'rov yuboramiz (har bir variantni ketma-ket)
    return this.fetchFromCrmAndCache(key, payerHint);
  }

  private async fetchFromCrmAndCache(key: string, payerHint?: string): Promise<CachedContract | null> {
    const variants = contractVariants(key).slice(0, 8);
    for (const v of variants) {
      try {
        const res = await this.crm.show({ contract: v, payerHint });
        const detail: any = (res as any)?.detail;
        if ((res as any)?.ok && detail) {
          // XonSaroy client object'dan F.I.O. yig'ish (last + first + middle)
          // Strukturalar: c.first_name, c.attributes.first_name, c.client.attributes.first_name
          const buildName = (c: any): string | null => {
            if (!c) return null;
            if (typeof c === 'string') return c.trim() || null;
            const f = (v: any): string => {
              if (!v) return '';
              if (typeof v === 'string') return v;
              return v.lotin || v.kirill || v.uz || v.ru || '';
            };
            // Avval c.attributes da qarash (XonSaroy v4 strukturasi)
            const src = c.attributes && (c.attributes.first_name || c.attributes.last_name)
              ? c.attributes
              : c;
            const name = [f(src.last_name), f(src.first_name), f(src.middle_name)].filter(Boolean).join(' ').trim();
            if (name) return name;
            return src.full_name_lotin || src.full_name_kirill || src.full_name || src.name || src.fio || null;
          };
          // Xavfsiz qisqartirish — DB VarChar cheklovlariga sig'sin
          const trunc = (s: any, max: number): string | null => {
            if (s == null) return null;
            const str = String(s);
            return str.length > max ? str.slice(0, max) : str;
          };
          // client_full_name — /index item shakli (payerHint/dublikat yo'lidan kelganда)
          const customerName = buildName(detail.client) || detail.client_full_name || detail.fio || null; // Text — limit yo'q
          // Status XonSaroy da OBJECT bo'lishi mumkin: { type: 'cancelled', name: {uz, ru}, color }
          // type ni asosiy hisoblaymiz (cancelled, active, etc) — string bo'lsa o'zini ishlatamiz
          const extractStatus = (s: any): string | null => {
            if (!s) return null;
            if (typeof s === 'string') return s.toLowerCase() || null;
            if (typeof s === 'object') {
              const t = s.type || s.key || s.value?.type || s.name?.uz || s.name?.ru || s.name;
              if (typeof t === 'string') return t.toLowerCase();
              if (typeof t === 'object') return (t.uz || t.ru || '').toLowerCase() || null;
            }
            return null;
          };
          // deleted_at to'ldirilgan bo'lsa — bekor qilingan deb hisoblaymiz
          const statusRaw = extractStatus(detail.status || detail.contract_status);
          const status = trunc(detail.deleted_at && !statusRaw ? 'cancelled' : statusRaw, 128);
          // Obyekt nomi — CRM bir necha joyda saqlashi mumkin
          const extractObject = (d: any): string | null => {
            // XonSaroy v4 deep struktura: order_apartments[0].apartment.block.building.object.name
            const deep = d?.order_apartments?.[0]?.apartment?.block?.building?.object?.name;
            const candidates = [
              d?.object_name,
              d?.object,
              d?.info?.object,
              d?.info?.object_name,
              d?.client?.object_name,
              d?.client?.object,
              deep,
            ];
            for (const c of candidates) {
              if (!c) continue;
              if (typeof c === 'string' && c.trim()) return c.trim();
              if (typeof c === 'object') {
                const nm = c.name || c.value || c.uz || c.ru || c.lotin || c.kirill || c.title;
                if (nm && typeof nm === 'string' && nm.trim()) return nm.trim();
              }
            }
            return null;
          };
          const objectName = trunc(extractObject(detail), 255);
          const apartmentNumber = trunc(detail.apartment_number || detail.client?.apartment_number || null, 64);
          const phone = trunc(detail.client?.phone_primary || detail.client?.phone || null, 64);
          // CRM order/shartnoma ID — API'da order_id sifatida chiqadi
          const crmOrderId = trunc(
            detail.id != null ? String(detail.id) : (detail.order_id != null ? String(detail.order_id) : null),
            64,
          );
          // virtual_status (Бартер, Ипотека, Наличные...) — CRM'dan.
          // Topilmasa '' (null EMAS) — "tekshirildi" belgisi, qayta-qayta so'ramaymiz.
          //   null  = hali CRM'dan tekshirilmagan (eski qator) → backfill/lookup uni yangilaydi.
          const virtualStatus = extractVirtualStatus(detail);
          const contractKey = trunc(v.toUpperCase(), 128) as string;

          const saved = await this.prisma.crmContract.upsert({
            where: { contractNumber: contractKey },
            create: {
              contractNumber: contractKey,
              customerName, status, virtualStatus, objectName, apartmentNumber, phone, crmOrderId,
              rawSnapshot: pickSnapshot(detail),
              found: true,
            },
            update: {
              customerName, status, virtualStatus, objectName, apartmentNumber, phone, crmOrderId,
              rawSnapshot: pickSnapshot(detail),
              found: true,
              lastVerifiedAt: new Date(),
              lastError: null,
            },
          });
          return toCached(saved);
        }
      } catch (e: any) {
        this.log.warn(`CRM lookup xato (${v}): ${e?.message}`);
      }
    }

    // ── FALLBACK: /show topa olmadi — searchContracts (/index, qo'lда qidiruv
    // ISHLAYDIGAN yo'l) bilan urinamiz. CRM'да bor lekin /show bermagan contractlar
    // uchun (avto vs qo'lда parity kafolati). Foydalanuvchi qo'lда topa olsa — avto ham topsin.
    const scNorm = (s: any) => String(s || '').replace(/[\s\-_./]/g, '').toUpperCase();
    for (const v of contractVariants(key).slice(0, 4)) {
      try {
        const sc: any = await this.crm.searchContracts(v, 20);
        const items: any[] = sc?.items || [];
        if (!items.length) continue;
        const targ = scNorm(v);
        const hit = items.find((it) => scNorm(it.contract) === targ);
        if (hit) {
          const contractKey = String(hit.contract || v).toUpperCase().slice(0, 128);
          const saved = await this.prisma.crmContract.upsert({
            where: { contractNumber: contractKey },
            create: {
              contractNumber: contractKey,
              customerName: hit.clientFullName || null,
              status: hit.status ? String(hit.status).toLowerCase().slice(0, 128) : null,
              // /index virtual_status bermaydi → '' (tekshirildi belgisi; qayta so'ramaymiz)
              virtualStatus: '',
              objectName: hit.object ? String(hit.object).slice(0, 255) : null,
              apartmentNumber: hit.apartmentNumber ? String(hit.apartmentNumber).slice(0, 64) : null,
              crmOrderId: hit.id != null ? String(hit.id).slice(0, 64) : null,
              found: true,
            },
            update: {
              customerName: hit.clientFullName || null,
              status: hit.status ? String(hit.status).toLowerCase().slice(0, 128) : null,
              objectName: hit.object ? String(hit.object).slice(0, 255) : null,
              apartmentNumber: hit.apartmentNumber ? String(hit.apartmentNumber).slice(0, 64) : null,
              crmOrderId: hit.id != null ? String(hit.id).slice(0, 64) : null,
              found: true,
              lastVerifiedAt: new Date(),
              lastError: null,
            },
          });
          this.log.log(`CRM searchContracts fallback topdi: ${contractKey} (klient: ${hit.clientFullName || '-'})`);
          return toCached(saved);
        }
      } catch (e: any) {
        this.log.warn(`searchContracts fallback xato (${v}): ${e?.message}`);
      }
    }

    // CRM'da topilmadi — keshga "found=false" yozib qo'yamiz, qayta urinmaymiz (NOT_FOUND_RETRY_AFTER_MS davomida)
    const safeKey = key.length > 128 ? key.slice(0, 128) : key;
    const saved = await this.prisma.crmContract.upsert({
      where: { contractNumber: safeKey },
      create: {
        contractNumber: safeKey,
        found: false,
        lastError: 'Topilmadi',
      },
      update: {
        found: false,
        lastVerifiedAt: new Date(),
        lastError: 'Topilmadi',
      },
    });
    return toCached(saved);
  }

  private async refreshInBackground(contractNumber: string): Promise<void> {
    try {
      await this.fetchFromCrmAndCache(contractNumber);
    } catch {
      // ignore — log allaqachon yozilgan
    }
  }

  /**
   * crm_status backfill uchun — FAQAT virtual_status'ni CRM'dan yangilaydi (awaitable).
   * fetchFromCrmAndCache'dan farqi: CRM javob bermasa found=true qatorni BUZMAYDI
   * (found=false qilmaydi). Konvergensiya uchun har holda NULL'dan chiqaradi:
   *   - /show topsa → haqiqiy qiymat (yoki '' status yo'q bo'lsa)
   *   - /show bermasa → '' (keyingi 24h stale-refresh haqiqiy qiymat bilan to'ldiradi)
   */
  async refreshVirtualStatus(contractNumber: string): Promise<void> {
    const key = String(contractNumber || '')
      .replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
    if (!key) return;
    const variants = contractVariants(key).slice(0, 4);
    let vs: string | null = null;
    for (const v of variants) {
      try {
        const res: any = await this.crm.show({ contract: v });
        const detail: any = res?.detail;
        if (res?.ok && detail) { vs = extractVirtualStatus(detail); break; }
      } catch { /* keyingi variant */ }
    }
    try {
      await this.prisma.crmContract.updateMany({
        where: { contractNumber: { in: contractVariants(key).slice(0, 8) }, found: true },
        data: { virtualStatus: vs ?? '' },
      });
    } catch { /* ignore */ }
  }

  // ───────────── crm_order_id backfill (mavjud shartnomalar uchun) ─────────────

  private backfillRunning = false;

  /**
   * crmOrderId bo'sh (null) bo'lgan MAVJUD topilgan shartnomalarni CRM'dan qayta
   * olib order_id bilan to'ldiradi. Fonda ishlaydi (konkurentlik cheklangan).
   * FAQAT crmOrderId yangilanadi — found/nom/obyekt tegilmaydi. XATO/topilmagan
   * (found=false) shartnomalar tegilmaydi.
   */
  async backfillOrderIds(opts: { limit?: number } = {}): Promise<{ pending: number; alreadyRunning: boolean }> {
    if (this.backfillRunning) {
      const remaining = await this.prisma.crmContract.count({ where: { found: true, crmOrderId: null } });
      return { pending: remaining, alreadyRunning: true };
    }
    const limit = Math.min(100000, Math.max(1, opts.limit ?? 50000));
    const rows = await this.prisma.crmContract.findMany({
      where: { found: true, crmOrderId: null },
      select: { contractNumber: true },
      take: limit,
    });
    const keys = rows.map((r) => r.contractNumber);
    this.backfillRunning = true;
    this.runBackfill(keys)
      .catch((e) => this.log.warn(`crmOrderId backfill xato: ${e?.message}`))
      .finally(() => { this.backfillRunning = false; });
    return { pending: keys.length, alreadyRunning: false };
  }

  private async runBackfill(keys: string[]): Promise<void> {
    const CONCURRENCY = 4;
    let idx = 0;
    let done = 0;
    let filled = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try { if (await this.backfillOne(k)) filled++; } catch { /* ignore */ }
        if (++done % 200 === 0) this.log.log(`crmOrderId backfill: ${done}/${keys.length} (to'ldi: ${filled})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    this.log.log(`crmOrderId backfill tugadi: ${keys.length} ta ko'rildi, ${filled} ta to'ldi`);
  }

  /** Bitta shartnoma — CRM'dan order id olib, faqat crmOrderId ustunini yangilaydi */
  private async backfillOne(contractNumber: string): Promise<boolean> {
    const key = (contractNumber || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
    if (!key) return false;
    const variants = contractVariants(key).slice(0, 8);
    for (const v of variants) {
      try {
        const res = await this.crm.show({ contract: v });
        const detail: any = (res as any)?.detail;
        const oid = detail?.id ?? detail?.order_id;
        if (detail && oid != null) {
          // FIX (B#8): crmOrderId'ni FAQAT so'ralgan qatorga yozamiz — variantlarga EMAS.
          // Variantlar (I/1, O/0) boshqa REAL shartnoma bo'lishi mumkin (118MSOP26LA vs 118MS0P26LA)
          // — ularning order_id'sini noto'g'ri ustidan yozib yubormaymiz.
          await this.prisma.crmContract.updateMany({
            where: { contractNumber },
            data: { crmOrderId: String(oid).slice(0, 64) },
          });
          return true;
        }
      } catch { /* keyingi variantni sinaymiz */ }
    }
    return false;
  }

  // ───────────── XATO (found=false) shartnomalarni qayta tekshirish ─────────────

  private readonly SAMPLE_CAP = 200;
  private reverifyStatus: ReverifyStatus = {
    running: false, startedAt: null, finishedAt: null,
    total: 0, done: 0, fixed: 0, notFound: 0, errors: 0,
    fixedSamples: [], notFoundSamples: [],
  };

  /** Oxirgi (yoki joriy) qayta tekshirish hisoboti — frontend poll qiladi. */
  getReverifyStatus(): ReverifyStatus {
    return this.reverifyStatus;
  }

  /**
   * found=false (XATO — CRM'да topilmagan deb keshlangan) shartnomalarni CRM'ga
   * QAYTA tekshiradi (forceRefresh — keshni chetlab o'tib). CRM'да endi bor bo'lganlar
   * found=true ga o'tadi va XATO ro'yxatidan AVTOMATIK chiqadi (XATO filtri found=true
   * setni jonli o'qiydi — to'lovlarni qayta kategoriyalash shart emas). Fonда ishlaydi.
   *
   * Sabab: contract keyinroq CRM'ga qo'shilган YOKI o'sha payt CRM lookup buzuq param
   * bilan topa olmaган — natijada found=false keshlangan va 4 soatgacha qotib qolган.
   *
   * Batafsil hisobot getReverifyStatus() orqali: nechta tuzatildi (kim/obyekt bilan),
   * nechta CRM'да topilmadi, nechta CRM xatosi.
   */
  /**
   * Berilgan shartnoma raqamlari ro'yxatini CRM'ga qayta tekshiradi (forceRefresh).
   * Chaqiruvchi ro'yxatni beradi — masalan FAQAT hozir XATO bo'lgan oplata_kv
   * to'lovlarining shartnomalari (butun DB'даги minglab eski found=false emas).
   * Raqamlar normalizatsiya + dedup qilinadi. Fonда ishlaydi, darhol qaytadi.
   */
  reverifyContracts(rawKeys: string[]): { pending: number; alreadyRunning: boolean } {
    if (this.reverifyStatus.running) {
      return { pending: Math.max(0, this.reverifyStatus.total - this.reverifyStatus.done), alreadyRunning: true };
    }
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const rk of rawKeys || []) {
      const k = String(rk || '').replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();
      if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
    }
    this.reverifyStatus = {
      running: true, startedAt: new Date().toISOString(), finishedAt: null,
      total: keys.length, done: 0, fixed: 0, notFound: 0, errors: 0,
      fixedSamples: [], notFoundSamples: [],
    };
    this.runReverify(keys)
      .catch((e) => this.log.warn(`XATO reverify xato: ${e?.message}`))
      .finally(() => {
        this.reverifyStatus.running = false;
        this.reverifyStatus.finishedAt = new Date().toISOString();
      });
    return { pending: keys.length, alreadyRunning: false };
  }

  private async runReverify(keys: string[]): Promise<void> {
    const CONCURRENCY = 4;
    const st = this.reverifyStatus;
    let idx = 0;
    const worker = async () => {
      while (idx < keys.length) {
        const k = keys[idx++];
        try {
          const res = await this.lookup(k, { forceRefresh: true });
          if (res?.found) {
            st.fixed++;
            if (st.fixedSamples.length < this.SAMPLE_CAP) {
              st.fixedSamples.push({
                contract: res.contractNumber,
                client: res.customerName,
                object: res.objectName,
                status: res.status,
              });
            }
          } else {
            st.notFound++;
            if (st.notFoundSamples.length < this.SAMPLE_CAP) {
              st.notFoundSamples.push({ contract: k, reason: "CRM'да topilmadi" });
            }
          }
        } catch (e: any) {
          st.errors++;
          if (st.notFoundSamples.length < this.SAMPLE_CAP) {
            st.notFoundSamples.push({ contract: k, reason: 'CRM xatosi: ' + String(e?.message || '').slice(0, 80) });
          }
        }
        st.done++;
        if (st.done % 100 === 0) this.log.log(`XATO reverify: ${st.done}/${keys.length} (tuzatildi: ${st.fixed})`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    this.log.log(`XATO reverify tugadi: ${keys.length} ko'rildi, ${st.fixed} tuzatildi, ${st.notFound} topilmadi, ${st.errors} xato`);
  }
}

function toCached(row: any): CachedContract {
  return {
    contractNumber: row.contractNumber,
    customerName: row.customerName,
    status: row.status,
    objectName: row.objectName,
    apartmentNumber: row.apartmentNumber,
    phone: row.phone,
    found: !!row.found,
    lastVerifiedAt: row.lastVerifiedAt,
  };
}

/**
 * CRM javobining keshlanadigan qismi (juda katta JSON'ni saqlamaslik uchun).
 */
/**
 * CRM detail'idan virtual_status (Бартер, Ипотека, Наличные...) ni ajratib oladi.
 * Topilmasa '' qaytaradi (null EMAS) — "tekshirildi, status yo'q" belgisi.
 * DB VarChar(64) chegarasiga qisqartiradi.
 */
function extractVirtualStatus(detail: any): string {
  const vs = detail?.virtual_status?.value?.name || detail?.virtual_status?.name || detail?.virtual_status;
  if (!vs) return '';
  const s = typeof vs === 'object' ? (vs.ru || vs.uz || vs.uzc || null) : String(vs);
  if (!s) return '';
  return s.length > 64 ? s.slice(0, 64) : s;
}

function pickSnapshot(detail: any): any {
  if (!detail) return null;
  return {
    id: detail.id ?? detail.order_id ?? null,
    contract: detail.contract,
    status: detail.status,
    virtual_status: detail.virtual_status ?? null,
    total_amount: detail.total_amount,
    object_name: detail.object_name,
    apartment_number: detail.apartment_number,
    client: detail.client ? {
      full_name_lotin: detail.client.full_name_lotin,
      full_name_kirill: detail.client.full_name_kirill,
      phone_primary: detail.client.phone_primary,
      passport_series: detail.client.passport_series,
    } : null,
  };
}
