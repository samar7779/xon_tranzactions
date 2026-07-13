import { ApiProperty } from '@nestjs/swagger';
import type { SheetTarget } from '../google-export.service';

/**
 * Config saqlash — 2 (yoki undan ko'p) sheet target.
 * Chuqur validatsiya service ichida (validateTarget) bajariladi.
 */
export class SaveExportConfigDto {
  @ApiProperty({ description: 'Sheet target massivi', type: 'array' })
  sheets!: SheetTarget[];
}

/**
 * Bitta sheet uchun eksportni ishga tushirish — joriy (forma) qiymatlari.
 */
export class RunExportDto {
  @ApiProperty({ description: 'Ishga tushiriladigan sheet konfiguratsiyasi' })
  target!: SheetTarget;
}
