import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CorrectionBotService } from './correction-bot.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { CrmService } from '../crm/crm.service';

/**
 * Tuzatish boti — XIZMAT (long-polling). Foydalanuvchi bot orqali AI AGENT (Claude)
 * bilan TABIIY suhbatlashadi: XATO ro'yxati → to'lovni tanlaydi → to'liq ma'lumot →
 * agent shartnoma so'raydi → user taxmin yozadi → CRM'dan mos shartnomalar INLINE
 * tugmalar → user tanlaydi → agent biriktiradi → guruhga "tuzatildi" xabari.
 *
 * Namuna: src/sverka-telegram (getUpdates), src/correction/agent-ai (Claude tool loop).
 */
type ChatState = {
  history: any[];
  currentOplataKvId?: string;
  currentContractNo?: string;
  pendingMatches?: Array<{ contract: string; client: string | null; object: string | null }>;
};

@Injectable()
export class CorrectionBotRunnerService implements OnModuleInit {
  private readonly log = new Logger(CorrectionBotRunnerService.name);
  private pollOffset = 0;
  private polling = false;
  private states = new Map<string, ChatState>();

  constructor(
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly cfg: CorrectionBotService,
    private readonly oplataKv: OplataKvService,
    private readonly crm: CrmService,
  ) {}

  onModuleInit() {
    this.loop().catch((e) => this.log.warn(`bot loop tugadi: ${e?.message}`));
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  private state(chatId: string): ChatState {
    let s = this.states.get(chatId);
    if (!s) { s = { history: [] }; this.states.set(chatId, s); }
    return s;
  }

  // ─── Long-polling ─────────────────────────────────────────────────
  private async loop() {
    while (true) {
      try {
        if (!(await this.cfg.isEnabled())) { await this.sleep(15_000); continue; }
        const token = await this.cfg.getToken();
        if (!token) { await this.sleep(15_000); continue; }
        if (this.polling) { await this.sleep(2000); continue; }
        this.polling = true;
        // webhook o'chirib qo'yamiz (getUpdates bilan konflikt bo'lmasin)
        if (this.pollOffset === 0) {
          await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`).catch(() => {});
        }
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ offset: this.pollOffset, timeout: 25, allowed_updates: ['message', 'callback_query'] }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (data?.ok && Array.isArray(data.result)) {
          for (const u of data.result) {
            this.pollOffset = u.update_id + 1;
            try {
              if (u.message?.text) await this.onMessage(token, u.message);
              else if (u.callback_query) await this.onCallback(token, u.callback_query);
            } catch (e: any) { this.log.warn(`update xato: ${e?.message}`); }
          }
        }
      } catch (e: any) {
        this.log.debug?.(`getUpdates: ${e?.message}`);
        await this.sleep(3000);
      } finally {
        this.polling = false;
      }
    }
  }

  // ─── Telegram yordamchilar ────────────────────────────────────────
  private async tg(token: string, method: string, payload: any): Promise<any> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    } catch { return {}; }
  }
  private send(token: string, chatId: string, text: string, replyMarkup?: any) {
    return this.tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  }

  // ─── Xabar ────────────────────────────────────────────────────────
  private async onMessage(token: string, msg: any) {
    const chatId = String(msg.chat.id);
    const text = String(msg.text || '').trim();

    // Ruxsat tekshiruvi (begonalar kira olmaydi)
    const who = await this.cfg.isAllowed(chatId);
    if (!who.ok) {
      await this.send(token, chatId,
        `🔒 <b>Ruxsat yo'q.</b>\n\nSizning chat ID: <code>${chatId}</code>\n\nAdmin panelга (Agent → Tuzatish bot → Ruxsat berilganlar) shu ID va ismingizni qo'shsin.`);
      return;
    }

    if (text === '/start') {
      this.states.delete(chatId);
      await this.send(token, chatId,
        `👋 Assalomu alaykum, <b>${who.name}</b>!\n\nMen XATO to'lovlarni to'g'rilashda yordam beraman.\n\n• «XATO to'lovlar» deb yozing — ro'yxatni ko'rsataman\n• To'lovni tanlab, unга to'g'ri shartnomani biriktiramiz.\n\nBoshladik? 🙂`);
      return;
    }

    // Agent (Claude) bilan suhbat
    await this.tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
    const reply = await this.agentTurn(chatId, text, who.name || chatId);
    const s = this.state(chatId);
    // Agar CRM nomzodlar tayyor bo'lsa — INLINE tugmalar
    let markup: any = undefined;
    if (s.pendingMatches && s.pendingMatches.length) {
      markup = {
        inline_keyboard: s.pendingMatches.slice(0, 8).map((m, i) => [{
          text: `📄 ${m.contract}${m.client ? ' · ' + m.client.slice(0, 24) : ''}`,
          callback_data: `asg:${i}`,
        }]),
      };
    }
    await this.send(token, chatId, reply || '—', markup);
  }

  // ─── Inline tugma (shartnoma tanlandi) ────────────────────────────
  private async onCallback(token: string, cq: any) {
    const chatId = String(cq.message?.chat?.id);
    const data = String(cq.data || '');
    const who = await this.cfg.isAllowed(chatId);
    if (!who.ok) { await this.tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Ruxsat yo\'q' }); return; }

    const m = data.match(/^asg:(\d+)$/);
    if (!m) { await this.tg(token, 'answerCallbackQuery', { callback_query_id: cq.id }); return; }
    const s = this.state(chatId);
    const pick = s.pendingMatches?.[Number(m[1])];
    if (!pick || !s.currentOplataKvId) {
      await this.tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Muddati o\'tgan — qaytadan boshlang', show_alert: true });
      return;
    }
    await this.tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: 'Biriktirilyapti…' });
    const r = await this.oplataKv.botAssignContract(s.currentOplataKvId, pick.contract, who.name || chatId);
    if (!r.ok) { await this.send(token, chatId, `❌ Xato: ${r.error}`); return; }

    // Tugmalarni olib tashlaymiz + tasdiq
    if (cq.message?.message_id) {
      await this.tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } });
    }
    await this.send(token, chatId,
      `✅ <b>Biriktirildi!</b>\n\nShartnoma: <code>${r.contractNo}</code>\nKlient: ${r.client || '—'}\nBajardi: ${who.name}`);

    // Guruhga xabar
    const groupId = await this.cfg.getGroupId();
    if (groupId) {
      await this.send(token, groupId,
        `✅ <b>XATO to'lov to'g'rilandi</b>\n\nShartnoma: <code>${r.contractNo}</code>\nKlient: ${r.client || '—'}${r.object ? '\nObyekt: ' + r.object : ''}\n👤 Bajardi: <b>${who.name}</b>`);
    }

    // Suhbat holatini tozalaymiz
    s.pendingMatches = undefined; s.currentOplataKvId = undefined; s.currentContractNo = undefined;
    s.history.push({ role: 'user', content: `(tizim: "${pick.contract}" shartnomasi biriktirildi va guruhga xabar berildi)` });
  }

  // ─── Claude suhbat turi (tool loop) ───────────────────────────────
  private async agentTurn(chatId: string, userText: string, actorName: string): Promise<string> {
    const apiKey = await this.getClaudeKey();
    if (!apiKey) return '⚠️ AI kaliti sozlanmagan (Admin → Agent → AI kalit).';
    const model = (await this.settings.get('agent.aiModel')) || 'claude-sonnet-4-6';
    const s = this.state(chatId);
    s.history.push({ role: 'user', content: userText });
    if (s.history.length > 24) s.history = s.history.slice(-24);

    const system = [
      `Sen XATO to'lovlarni to'g'rilashga yordam beruvchi yordamchisan. Foydalanuvchi: ${actorName}.`,
      `Tabiiy, qisqa va do'stona o'zbek tilida gaplash (robot emas).`,
      `Oqim: 1) foydalanuvchi XATO to'lovlarni so'rasa list_xato bilan ko'rsat.`,
      `2) foydalanuvchi bir to'lovni tanlasa (shartnoma raqami/ID/summa aytadi) payment_info bilan to'liq ma'lumotini ko'rsat.`,
      `3) qaysi shartnomaga biriktirishni so'ra. Foydalanuvchi taxminiy raqam yozsa crm_search bilan qidir.`,
      `MUHIM: crm_search chaqirganda topilgan shartnomalarni matnda SANAB O'TIRMA — shunchaki "Quyidagilardan to'g'risini tanlang 👇" deb yoz, chunki tugmalar avtomat ko'rsatiladi.`,
      `Foydalanuvchi tugmani bosgach tizim biriktiradi va guruhga xabar beradi — sen faqat tabiiy tasdiqlaysan.`,
      `Summalar UZS. Sanalarni odam o'qiydigan ko'rinishda ber.`,
    ].join('\n');

    const tools = [
      { name: 'list_xato', description: "XATO (CRM'da topilmagan) to'lovlar ro'yxati.", input_schema: { type: 'object', properties: { query: { type: 'string', description: 'ixtiyoriy filtr: shartnoma/klient/obyekt' } } } },
      { name: 'payment_info', description: "Bitta XATO to'lovning to'liq ma'lumoti (shartnoma/ID/summa bo'yicha).", input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'crm_search', description: "CRM'dan shartnoma qidirish (taxminiy raqam bo'yicha). Foydalanuvchiga inline tugmalar ko'rsatiladi.", input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
    ];

    const convo = [...s.history];
    try {
      let reply = '';
      for (let i = 0; i < 6; i++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1200, system, messages: convo, tools }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return `⚠️ AI xato: ${data?.error?.message || res.status}`;

        if (data?.stop_reason === 'tool_use') {
          convo.push({ role: 'assistant', content: data.content });
          const toolResults: any[] = [];
          for (const block of data.content || []) {
            if (block.type !== 'tool_use') continue;
            let result: any;
            if (block.name === 'list_xato') result = await this.toolListXato(String(block.input?.query || ''));
            else if (block.name === 'payment_info') result = await this.toolPaymentInfo(chatId, String(block.input?.query || ''));
            else if (block.name === 'crm_search') result = await this.toolCrmSearch(chatId, String(block.input?.query || ''));
            else result = { error: 'nomalum tool' };
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
          convo.push({ role: 'user', content: toolResults });
          continue;
        }
        reply = (data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
        break;
      }
      if (reply) s.history.push({ role: 'assistant', content: reply });
      return reply || 'Tushunmadim — boshqacha yozib ko\'ring.';
    } catch (e: any) {
      return `⚠️ Xato: ${e?.message}`;
    }
  }

  private async getClaudeKey(): Promise<string | null> {
    const enc = await this.settings.get('agent.aiKey');
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  // ─── Tool'lar ─────────────────────────────────────────────────────
  private async toolListXato(query: string) {
    const { rows, count } = await this.oplataKv.getXatoListForAgent({ limit: 2000 });
    const q = query.trim().toLowerCase();
    const filtered = q ? rows.filter((r: any) =>
      (r.contractNo || '').toLowerCase().includes(q) || (r.client || '').toLowerCase().includes(q) ||
      (r.object || '').toLowerCase().includes(q) || (r.purpose || '').toLowerCase().includes(q)) : rows;
    return {
      jamiXato: count,
      korsatildi: Math.min(filtered.length, 15),
      royxat: filtered.slice(0, 15).map((r: any) => ({
        oplataKvId: r.id, shartnoma: r.contractNo, klient: r.client, obyekt: r.object,
        summa: r.paymentAmount != null ? Number(r.paymentAmount) : null, sana: r.date,
      })),
    };
  }

  private async toolPaymentInfo(chatId: string, query: string) {
    const { rows } = await this.oplataKv.getXatoListForAgent({ limit: 2000 });
    const q = query.trim().toLowerCase();
    const hit = rows.find((r: any) =>
      String(r.id).toLowerCase() === q ||
      (r.contractNo || '').toLowerCase().includes(q) ||
      (r.client || '').toLowerCase().includes(q));
    if (!hit) return { topildi: false, xabar: 'Bunday XATO to\'lov topilmadi. Ro\'yxatdan aniqroq bering.' };
    this.state(chatId).currentOplataKvId = hit.id; // biriktirish uchun eslab qolamiz
    return {
      topildi: true,
      toliqMalumot: {
        shartnoma: hit.contractNo, klient: hit.client, obyekt: hit.object,
        summa: hit.paymentAmount != null ? Number(hit.paymentAmount) : null,
        sana: hit.date, tur: hit.txType, maqsad: hit.purpose,
      },
    };
  }

  private async toolCrmSearch(chatId: string, query: string) {
    const q = query.trim();
    if (!q) return { xato: 'Qidiruv so\'zi kerak' };
    const res: any = await this.crm.searchContracts(q, 8);
    const items: any[] = res?.items || [];
    const s = this.state(chatId);
    s.pendingMatches = items.map((it) => ({ contract: it.contract, client: it.clientFullName || null, object: it.object || null }));
    s.currentContractNo = q;
    return {
      topildi: items.length,
      shartnomalar: items.map((it) => ({ shartnoma: it.contract, klient: it.clientFullName, obyekt: it.object })),
      eslatma: items.length ? 'Foydalanuvchiga inline tugmalar ko\'rsatiladi — matnda sanab o\'tirma.' : 'Hech narsa topilmadi — boshqa raqam so\'ra.',
    };
  }
}
