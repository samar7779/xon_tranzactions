import { Injectable, Logger } from '@nestjs/common';

const XONSAROY_BASE_URL = process.env.XONSAROY_API_URL || 'https://app-api.xonsaroy.uz/api/v4/client/order';
const XONSAROY_KEY = process.env.XONSAROY_API_KEY || 'G0C2kwSk3e3AnEZUMJhq067ZM5s9Wkuc';
const XONSAROY_SECRET = process.env.XONSAROY_API_SECRET || 'w1qBTE76Y4PKsbLeLjd2gt8UDDSHYJl0';

@Injectable()
export class CrmService {
  private readonly log = new Logger(CrmService.name);

  private auth() {
    return 'Basic ' + Buffer.from(`${XONSAROY_KEY}:${XONSAROY_SECRET}`).toString('base64');
  }

  private async call(path: string, body: Record<string, any>) {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) {
      if (v != null) form.set(k, String(v));
    }
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const res = await fetch(`${XONSAROY_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Authorization': this.auth(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.log.warn(`XonSaroy ${path} -> ${res.status}: ${text.slice(0, 200)}`);
        return { ok: false, status: res.status, error: text };
      }
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, status: 200, error: 'Invalid JSON', raw: text };
      }
    } catch (e: any) {
      this.log.error(`XonSaroy ${path} error: ${e?.message}`);
      return { ok: false, error: e?.message || 'Network error' };
    } finally {
      clearTimeout(tm);
    }
  }

  /**
   * Shartnoma raqami bo'yicha qidiruv — XonSaroy CRM'dan ro'yxat keladi.
   */
  async search(contractNumber: string, perPage = 20) {
    if (!contractNumber?.trim()) return { ok: false, error: 'contract kerak' };
    const r = await this.call('/index', { contract: contractNumber.trim(), 'per-page': perPage });
    if (!r.ok) return r;
    const items = r.data?.data || [];
    return { ok: true, total: items.length, items };
  }

  /**
   * Bitta shartnoma tafsilotini olish — to'liq schedule + payment history bilan.
   */
  async show(opts: { contract?: string; id?: string | number }) {
    if (!opts.contract && !opts.id) return { ok: false, error: 'contract yoki id kerak' };
    const body: Record<string, any> = {};
    if (opts.contract) body.contract = opts.contract.trim();
    else body.id = opts.id;
    const r = await this.call('/show', body);
    if (!r.ok) return r;
    return { ok: true, detail: r.data?.data || null };
  }
}
