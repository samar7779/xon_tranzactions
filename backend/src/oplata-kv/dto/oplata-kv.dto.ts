import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min,
} from 'class-validator';

export enum OplataKvCategoryEnum {
  MONTHLY = 'MONTHLY',  // ежемесячный
  FIRST   = 'FIRST',    // 1 взнос
  GENERAL = 'GENERAL',  // Общий
}

export class CreateOplataKvDto {
  @ApiProperty({ example: '7331MSO26KK', description: 'Дог № — shartnoma raqami' })
  @IsString() @MaxLength(50)
  contractNo!: string;

  @ApiProperty({ example: '2026-05-21', description: 'Дата (ISO format)' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ description: 'Сумма оплаты — +/-' })
  @IsOptional() @IsNumber()
  paymentAmount?: number;

  @ApiPropertyOptional({ description: '1 взнос — +/-' })
  @IsOptional() @IsNumber()
  firstInstallment?: number;

  @ApiPropertyOptional({ description: 'ежемесячный — +/-' })
  @IsOptional() @IsNumber()
  monthlyAmount?: number;

  @ApiPropertyOptional({ description: 'Назначение платежа' })
  @IsOptional() @IsString()
  purpose?: string;

  @ApiPropertyOptional({ description: 'Тип' })
  @IsOptional() @IsString() @MaxLength(60)
  txType?: string;

  @ApiPropertyOptional({ description: 'Примечание' })
  @IsOptional() @IsString()
  note?: string;

  @ApiPropertyOptional({ enum: OplataKvCategoryEnum, description: 'Оплата (MONTHLY | FIRST | GENERAL)' })
  @IsOptional() @IsEnum(OplataKvCategoryEnum)
  paymentCategory?: OplataKvCategoryEnum;

  @ApiPropertyOptional({ description: 'Объект' })
  @IsOptional() @IsString() @MaxLength(255)
  object?: string;

  @ApiPropertyOptional({ description: 'Клиент' })
  @IsOptional() @IsString() @MaxLength(255)
  client?: string;

  @ApiPropertyOptional({ description: 'Способ оплаты' })
  @IsOptional() @IsString() @MaxLength(120)
  paymentMethod?: string;
}

export class UpdateOplataKvDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(50)
  contractNo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  date?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  paymentAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  firstInstallment?: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  monthlyAmount?: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  purpose?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(60)
  txType?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  note?: string | null;

  @ApiPropertyOptional({ enum: OplataKvCategoryEnum })
  @IsOptional() @IsEnum(OplataKvCategoryEnum)
  paymentCategory?: OplataKvCategoryEnum | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  object?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  client?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(120)
  paymentMethod?: string | null;
}

export class ListOplataKvDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, description: '1..200' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  perPage?: number = 50;

  @ApiPropertyOptional({ description: 'Erkin qidiruv — contractNo / client / object / purpose / note' })
  @IsOptional() @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Sana boshi (YYYY-MM-DD)' })
  @IsOptional() @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Sana oxiri (YYYY-MM-DD)' })
  @IsOptional() @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Shartnoma raqami (aniq teng yoki LIKE)' })
  @IsOptional() @IsString()
  contractNo?: string;

  @ApiPropertyOptional({ enum: OplataKvCategoryEnum })
  @IsOptional() @IsEnum(OplataKvCategoryEnum)
  paymentCategory?: OplataKvCategoryEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  client?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  object?: string;

  // ─── Per-ustun multi-select filterlari (vergul bilan) — Google Sheets style ───
  @ApiPropertyOptional({ description: 'Shartnoma raqamlari (vergul bilan ajratilgan)' })
  @IsOptional() @IsString()
  contractNos?: string;

  @ApiPropertyOptional({ description: 'Kategoriyalar (vergul bilan): MONTHLY,FIRST,GENERAL' })
  @IsOptional() @IsString()
  paymentCategories?: string;

  @ApiPropertyOptional({ description: "Mijozlar ro'yxati (vergul bilan)" })
  @IsOptional() @IsString()
  clients?: string;

  @ApiPropertyOptional({ description: "Obyektlar ro'yxati (vergul bilan)" })
  @IsOptional() @IsString()
  objects?: string;

  @ApiPropertyOptional({ description: "To'lov usullari (vergul bilan)" })
  @IsOptional() @IsString()
  paymentMethods?: string;

  @ApiPropertyOptional({ description: 'Tiplar (vergul bilan)' })
  @IsOptional() @IsString()
  txTypes?: string;

  @ApiPropertyOptional({ description: "Manba filter: manual | excel | transaction (vergul bilan ko'p)" })
  @IsOptional() @IsString()
  sources?: string;

  @ApiPropertyOptional({ description: "Faqat XATO qatorlar: 'true' bo'lsa CRM da topilmaganlar ko'rsatiladi" })
  @IsOptional() @IsString()
  xatoOnly?: string;

  // ─── Distinct endpoint uchun (ListOplataKvDto qayta ishlatilgani uchun) ───
  @ApiPropertyOptional({ description: 'Distinct uchun ustun nomi (faqat /distinct endpoint)' })
  @IsOptional() @IsString()
  column?: string;

  @ApiPropertyOptional({ description: "Distinct popoveridagi qidiruv (faqat /distinct)" })
  @IsOptional() @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Tartiblash maydoni' })
  @IsOptional() @IsIn(['date', 'createdAt', 'updatedAt', 'paymentAmount', 'firstInstallment', 'monthlyAmount', 'contractNo'])
  sortBy?: 'date' | 'createdAt' | 'updatedAt' | 'paymentAmount' | 'firstInstallment' | 'monthlyAmount' | 'contractNo';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional() @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}
