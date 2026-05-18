import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as path from 'path';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Tranzaksiya fayllari (ariza, hujjat, rasm).
 *
 * Fayllar diskda saqlanadi: UPLOADS_DIR/attachments/{txId}/{id}__{filename}
 * DB'da metadata + path.
 *
 * Yaratish/o'chirishda Telegram guruhga xabar yuboriladi
 * (ATTACHMENTS_NOTIFY_CHAT yoki default -5150947522).
 */
@Injectable()
export class AttachmentsService {
  private readonly log = new Logger(AttachmentsService.name);
  private readonly uploadsDir: string;
  private readonly tgToken: string;
  private readonly tgChat: string;
  private readonly appUrl: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private http: HttpService,
  ) {
    this.uploadsDir = config.get<string>('UPLOADS_DIR') || '/var/www/xon_tranzactions/uploads';
    this.tgToken = config.get<string>('TG_BOT_TOKEN') || '';
    this.tgChat = config.get<string>('ATTACHMENTS_NOTIFY_CHAT') || '-5150947522';
    this.appUrl = config.get<string>('APP_URL') || 'https://transactions.xonapps.uz';
  }

  /** Tranzaksiya uchun barcha biriktirilgan fayllar */
  async list(txId: string) {
    const items = await this.prisma.transactionAttachment.findMany({
      where: { txId },
      orderBy: { uploadedAt: 'desc' },
    });
    return { ok: true, items };
  }

  /**
   * Yangi fayl biriktirish.
   * Diskda saqlaydi, DB'ga yozadi, Telegram'ga xabar yuboradi.
   */
  async upload(
    txId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    opts: { type?: string; contractNumber?: string | null; notes?: string | null; uploadedBy?: string | null } = {},
  ) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuborilmadi');
    if (file.size === 0) throw new BadRequestException("Bo'sh fayl");
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException('Fayl 25 MB dan oshmasligi kerak');

    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { id: true, contractNumber: true, externalId: true },
    });
    if (!tx) throw new NotFoundException('Tranzaksiya topilmadi');

    // Cleanup filename (xavfsizlik)
    const safeName = file.originalname.replace(/[^\w\d.\-_ ()\[\]а-яёА-ЯЁa-zA-Z0-9]/g, '_').slice(0, 200);

    // DB yozuvi (id avtomatik cuid)
    const att = await this.prisma.transactionAttachment.create({
      data: {
        txId,
        type: opts.type || 'ariza',
        filename: safeName,
        mimeType: file.mimetype.slice(0, 128),
        fileSize: file.size,
        storagePath: '', // pastda yangilaymiz
        contractNumber: opts.contractNumber?.slice(0, 128) || tx.contractNumber || null,
        notes: opts.notes || null,
        uploadedBy: opts.uploadedBy?.slice(0, 190) || null,
      },
    });

    // Disk papka: UPLOADS_DIR/attachments/{txId}/
    const dir = path.join(this.uploadsDir, 'attachments', txId);
    await fs.mkdir(dir, { recursive: true });
    const diskPath = path.join(dir, `${att.id}__${safeName}`);
    await fs.writeFile(diskPath, file.buffer);

    // DB'da yo'lni yangilash
    await this.prisma.transactionAttachment.update({
      where: { id: att.id },
      data: { storagePath: diskPath },
    });

    // Telegram xabar
    void this.notifyTelegram('uploaded', {
      attachment: { ...att, storagePath: diskPath },
      transaction: tx,
    });

    return { ok: true, item: { ...att, storagePath: diskPath } };
  }

  /** Faylni o'qish — download uchun stream */
  async getFile(txId: string, attId: string) {
    const att = await this.prisma.transactionAttachment.findFirst({
      where: { id: attId, txId },
    });
    if (!att) throw new NotFoundException('Fayl topilmadi');
    try {
      await fs.access(att.storagePath);
    } catch {
      throw new NotFoundException('Fayl diskda yo\'q (qayta yuklang)');
    }
    return { stream: createReadStream(att.storagePath), att };
  }

  /** Faylni o'chirish — diskdan ham, DB'dan ham. Telegram'ga xabar. */
  async delete(txId: string, attId: string, deletedBy?: string) {
    const att = await this.prisma.transactionAttachment.findFirst({
      where: { id: attId, txId },
      include: { transaction: { select: { id: true, contractNumber: true, externalId: true } } },
    });
    if (!att) throw new NotFoundException('Fayl topilmadi');

    // Diskdan o'chirish
    try {
      await fs.unlink(att.storagePath);
    } catch (e: any) {
      this.log.warn(`Disk fayl o'chirilmadi (${att.storagePath}): ${e?.message}`);
    }

    await this.prisma.transactionAttachment.delete({ where: { id: attId } });

    // Telegram xabar
    void this.notifyTelegram('deleted', {
      attachment: att,
      transaction: att.transaction,
      deletedBy,
    });

    return { ok: true, deleted: att.filename };
  }

  /** Telegram notification — uploaded/deleted */
  private async notifyTelegram(action: 'uploaded' | 'deleted', payload: {
    attachment: any;
    transaction: { id: string; contractNumber: string | null; externalId: string | null };
    deletedBy?: string;
  }) {
    if (!this.tgToken || !this.tgChat) return;
    try {
      const a = payload.attachment;
      const t = payload.transaction;
      const icon = action === 'uploaded' ? '📎' : '🗑️';
      const verb = action === 'uploaded' ? 'biriktirildi' : 'o\'chirildi';
      const actor = action === 'uploaded' ? a.uploadedBy : (payload.deletedBy || '?');
      const sizeKb = (a.fileSize / 1024).toFixed(1);
      const date = new Date().toLocaleString('uz-UZ', {
        timeZone: 'Asia/Tashkent',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      const txUrl = `${this.appUrl}/uz/transactions?id=${encodeURIComponent(t.id)}`;
      const text = [
        `${icon} <b>Ariza ${verb}</b>`,
        ``,
        `📄 <code>${this.escape(a.filename)}</code> · ${sizeKb} KB`,
        a.contractNumber ? `📋 Shartnoma: <code>${this.escape(a.contractNumber)}</code>` : null,
        t.externalId ? `🧾 Tranzaksiya: <code>${this.escape(t.externalId).slice(0, 80)}</code>` : null,
        `👤 ${this.escape(actor || '?')}`,
        `🕒 ${date}`,
        ``,
        `<a href="${txUrl}">↗ Tranzaksiyani ochish</a>`,
      ].filter(Boolean).join('\n');

      await firstValueFrom(
        this.http.post(
          `https://api.telegram.org/bot${this.tgToken}/sendMessage`,
          {
            chat_id: this.tgChat,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          },
          { timeout: 8000 },
        ),
      );
    } catch (e: any) {
      this.log.warn(`Telegram notification xato: ${e?.message}`);
    }
  }

  private escape(s: string | null | undefined): string {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
