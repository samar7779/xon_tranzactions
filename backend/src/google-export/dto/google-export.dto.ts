import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsObject } from 'class-validator';
import type { SheetTarget } from '../google-export.service';

/**
 * Config saqlash — 2 (yoki undan ko'p) sheet target.
 * Chuqur validatsiya service ichida (validateTarget) bajariladi — bu yerda
 * faqat whitelist uchun tur belgilanadi (nested maydonlar o'zgarmay o'tadi).
 */
export class SaveExportConfigDto {
  @ApiProperty({ description: 'Sheet target massivi', type: 'array' })
  @IsArray()
  sheets!: SheetTarget[];
}

/**
 * Bitta sheet uchun eksportni ishga tushirish — joriy (forma) qiymatlari.
 */
export class RunExportDto {
  @ApiProperty({ description: 'Ishga tushiriladigan sheet konfiguratsiyasi' })
  @IsObject()
  target!: SheetTarget;
}
