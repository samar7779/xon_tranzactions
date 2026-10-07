import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * Kategoriya SUB-AGENTI — qoidalar, schotchik, minfin va ta'minot bosqichlari
 * hal qila olmagan to'lovlar bo'yicha O'YLAB qaror chiqaradi.
 *
 * Qoidalar (qat'iy, buzilmaydi):
 *  - Agent HECH NARSA YOZMAYDI. Faqat taklif qaytaradi, yozishni orkestrator
 *    qiladi — shunda har bir o'zgarish audit log'ga tushadi va qaytarilishi mumkin.
 *  - Mijoz to'lovlari (CLIENT) umuman berilmaydi — ular ОплатыКв mantiqi.
 *  - Ishonch 70 dan past bo'lsa qo'yilmaydi, "odam ko'rsin" bo'lib qoladi.
 *  - Javob faqat JSON. Boshqa matn kelsa — qaror emas, xato deb sanaladi.
 *
 * Kalit mavjud naqsh bo'yicha: Setting 'agent.aiKey' (shifrlangan) yoki env
 * ANTHROPIC_API_KEY — chek-order, correction va leader bilan bir xil.
 */
@Injectable()
export class KategoriyaAiService {
  private readonly log = new Logger(KategoriyaAiService.name);

  private static readonly API_URL = 'https://api.anthropic.com/v1/messages';
  private static readonly MODEL = process.env.KATEGORIYA_AI_MODEL || 'claude-sonnet-5';
  private static readonly MAX_TOKENS = 8000;
  private static readonly TIMEOUT_MS = 120_000;
  /** Bir so'rovda nechta to'lov — ko'p bo'lsa model e'tibori tarqaladi. */
  static readonly PAKET = 25;
  /** Shundan past ishonch bilan hech narsa yozilmaydi. */
  static readonly MIN_ISHONCH = 70;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async kalit(): Promise<string | null> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: 'agent.aiKey' } });
      if (row?.value) {
        try {
          const k = this.crypto.decrypt(row.value);
          if (k) return k;
        } catch {
          this.log.warn("agent.aiKey deshifrlanmadi — env ANTHROPIC_API_KEY ga o'tildi");
        }
      }
    } catch (e: any) {
      this.log.warn(`agent.aiKey o'qilmadi: ${e?.message}`);
    }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  /**
   * Bir paket to'lov bo'yicha qaror so'raydi.
   *
   * @param bilim    agents/knowledge/kategoriya.md mazmuni (qoidalar, modda ro'yxati)
   * @param tolovlar modelga ko'rsatiladigan to'lovlar (sir ma'lumot YO'Q)
   */
  async qaror(
    bilim: string,
    tolovlar: Array<{
      id: string; sana: string; summa: string; yonalish: string;
      kontragent: string; izoh: string;
      shartnoma?: string | null; shartnomaSana?: string | null;
      hisob?: string | null; bank?: string | null;
    }>,
    kategoriyalar: Array<{ code: string; name: string }>,
  ): Promise<{
    ok: boolean;
    error?: string;
    qarorlar: Array<{
      id: string; categoryCode: string | null; modda: string | null;
      obyekt: string | null; shartnoma: string | null; shartnomaSana: string | null;
      ishonch: number; sabab: string;
    }>;
  }> {
    const apiKey = await this.kalit();
    if (!apiKey) return { ok: false, error: 'AI kaliti sozlanmagan (agent.aiKey yoki ANTHROPIC_API_KEY)', qarorlar: [] };
    if (tolovlar.length === 0) return { ok: true, qarorlar: [] };

    const prompt = [
      bilim.trim(),
      '',
      '## Mavjud kategoriyalar (faqat shu kodlardan birini tanla)',
      kategoriyalar.map((c) => `- ${c.code} — ${c.name}`).join('\n'),
      '',
      '## Tekshirish kerak bo\'lgan to\'lovlar',
      JSON.stringify(tolovlar, null, 1),
      '',
      '## Javob shakli',
      'FAQAT JSON massiv qaytar, boshqa matn yozma. Har element:',
      '{"id":"<to\'lov id>","categoryCode":"<kod yoki null>","modda":"<xarajat moddasi yoki null>",',
      ' "obyekt":"<obyekt nomi yoki null>","shartnoma":"<shartnoma № yoki null>",',
      ' "shartnomaSana":"<YYYY-MM-DD yoki null>","ishonch":<0..100>,"sabab":"<qisqa izoh, o\'zbekcha>"}',
      '',
      'Qoidalar:',
      `- Ishonching ${KategoriyaAiService.MIN_ISHONCH} dan past bo'lsa ham qaytar, lekin ishonchni rost ko'rsat — past bo'lsa yozilmaydi.`,
      '- Taxmin qilma. Izohda asos bo\'lmasa — categoryCode null, sababda nima yetishmaganini yoz.',
      '- Mijozning uy to\'lovi bo\'lsa — hech narsa qo\'yma, sababda "mijoz to\'lovi" deb yoz.',
    ].join('\n');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), KategoriyaAiService.TIMEOUT_MS);
    try {
      const res = await fetch(KategoriyaAiService.API_URL, {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: KategoriyaAiService.MODEL,
          max_tokens: KategoriyaAiService.MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const matn = await res.text().catch(() => '');
        return { ok: false, error: `AI ${res.status}: ${matn.slice(0, 300)}`, qarorlar: [] };
      }
      const data: any = await res.json();
      const matn = String(data?.content?.[0]?.text || '');
      const qarorlar = this.jsonAjrat(matn);
      if (!qarorlar) return { ok: false, error: `AI javobi JSON emas: ${matn.slice(0, 200)}`, qarorlar: [] };
      return { ok: true, qarorlar };
    } catch (e: any) {
      const sabab = e?.name === 'AbortError' ? 'AI javob bermadi (timeout)' : String(e?.message || e);
      return { ok: false, error: sabab, qarorlar: [] };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Model javobidan JSON massivni ajratadi.
   * Model ba'zan ```json ... ``` bloki yoki oldidan bir qator matn qo'shadi —
   * shuning uchun birinchi '[' dan oxirgi ']' gacha olinadi.
   */
  private jsonAjrat(matn: string): Array<any> | null {
    const bosh = matn.indexOf('[');
    const oxir = matn.lastIndexOf(']');
    if (bosh < 0 || oxir <= bosh) return null;
    let xom: any;
    try {
      xom = JSON.parse(matn.slice(bosh, oxir + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(xom)) return null;
    const chiq: any[] = [];
    for (const r of xom) {
      if (!r || typeof r !== 'object' || !r.id) continue;
      const n = Number(r.ishonch);
      chiq.push({
        id: String(r.id),
        categoryCode: r.categoryCode ? String(r.categoryCode).slice(0, 32) : null,
        modda: r.modda ? String(r.modda).slice(0, 255) : null,
        obyekt: r.obyekt ? String(r.obyekt).slice(0, 255) : null,
        shartnoma: r.shartnoma ? String(r.shartnoma).slice(0, 255) : null,
        shartnomaSana: /^\d{4}-\d{2}-\d{2}$/.test(String(r.shartnomaSana || '')) ? String(r.shartnomaSana) : null,
        ishonch: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0,
        sabab: String(r.sabab || '').slice(0, 1000),
      });
    }
    return chiq;
  }
}
