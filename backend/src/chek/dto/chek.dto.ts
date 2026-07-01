import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';

// Вид договора — 4 variant (kanonik kalitlar)
export const VID_DOGOVORA = [
  'original',           // Оригинал
  'ekzemplyar',         // Экземпляр
  'original_fixed',     // Тугирланган (tuzatilgan) Оригинал
  'ekzemplyar_fixed',   // Тугирланган (tuzatilgan) Экземпляр
] as const;

// Контролёр — 2 variant
export const KONTROLYOR = ['otkaz', 'prinyat'] as const; // Отказ | Принят

export class CreateChekDto {
  @ApiProperty({ example: '1777AFS26HP', description: 'Shartnoma raqami' })
  @IsString() @MaxLength(128)
  contractNumber!: string;

  // CRM'dan olingan (frontend yuboradi — qayta so'rov qilmaslik uchun)
  @ApiPropertyOptional({ description: 'Menejer (CRM created_by)' })
  @IsOptional() @IsString() @MaxLength(255)
  manager?: string;

  @ApiPropertyOptional({ description: 'Menejer telefoni' })
  @IsOptional() @IsString() @MaxLength(64)
  managerPhone?: string;

  @ApiPropertyOptional({ description: 'Сотув офис (CRM branch)' })
  @IsOptional() @IsString() @MaxLength(255)
  branchName?: string;

  @ApiPropertyOptional({ description: 'Obyekt (CRM object)' })
  @IsOptional() @IsString() @MaxLength(255)
  objectName?: string;

  @ApiProperty({ example: '2026-07-01', description: 'Дата (ISO — default: bugun)' })
  @IsDateString()
  data!: string;

  @ApiProperty({ enum: VID_DOGOVORA, description: 'Вид договора' })
  @IsIn(VID_DOGOVORA as unknown as string[])
  vidDogovora!: string;

  @ApiProperty({ enum: KONTROLYOR, description: 'Контролёр: otkaz | prinyat' })
  @IsIn(KONTROLYOR as unknown as string[])
  kontrolyor!: string;

  @ApiPropertyOptional({ description: 'Причина отказа (matn)' })
  @IsOptional() @IsString()
  prichinaOtkaza?: string;

  @ApiPropertyOptional({ description: 'Штрафы — suma (ixtiyoriy)' })
  @IsOptional() @IsInt() @Min(0)
  shtrafy?: number;
}

export class UpdateChekDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(128)
  contractNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  manager?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(64)
  managerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  branchName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  objectName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  data?: string;

  @ApiPropertyOptional({ enum: VID_DOGOVORA })
  @IsOptional() @IsIn(VID_DOGOVORA as unknown as string[])
  vidDogovora?: string;

  @ApiPropertyOptional({ enum: KONTROLYOR })
  @IsOptional() @IsIn(KONTROLYOR as unknown as string[])
  kontrolyor?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  prichinaOtkaza?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0)
  shtrafy?: number;

  @ApiPropertyOptional({ description: 'Telegram xabari yuborildimi (kelajak uchun)' })
  @IsOptional() @IsBoolean()
  tgSend?: boolean;
}
