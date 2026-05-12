import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM bilan bank credential parollarini shifrlash.
 * Format: base64(iv | ciphertext | authTag)  — iv 12 byte, tag 16 byte.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('CRED_ENC_KEY', '');
    if (!raw) {
      throw new InternalServerErrorException(
        'CRED_ENC_KEY .env da sozlanmagan — credential parollarini shifrlab bo\'lmaydi',
      );
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new InternalServerErrorException(
        `CRED_ENC_KEY 32 byte (base64) bo'lishi kerak — hozirgi: ${buf.length} byte`,
      );
    }
    this.key = buf;
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, ct, tag]).toString('base64');
  }

  decrypt(payload: string): string {
    const data = Buffer.from(payload, 'base64');
    if (data.length < 12 + 16 + 1) {
      throw new InternalServerErrorException('Shifrlangan ma\'lumot yaroqsiz');
    }
    const iv = data.subarray(0, 12);
    const tag = data.subarray(data.length - 16);
    const ct = data.subarray(12, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  }
}
