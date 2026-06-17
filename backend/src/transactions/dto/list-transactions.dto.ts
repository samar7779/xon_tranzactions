import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsEnum, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export enum TxnTypeEnum {
  TRANSFER = 'TRANSFER',
  PAYMENT = 'PAYMENT',
  SALARY = 'SALARY',
  TAX = 'TAX',
  FEE = 'FEE',
  REFUND = 'REFUND',
  OTHER = 'OTHER',
}
export enum TxnStatusEnum {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REVERSED = 'REVERSED',
}
export enum TxnDirEnum {
  IN = 'IN',
  OUT = 'OUT',
}

export class ListTransactionsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  perPage?: number = 50;

  @ApiPropertyOptional({ enum: TxnTypeEnum })
  @IsOptional() @IsEnum(TxnTypeEnum)
  type?: TxnTypeEnum;

  @ApiPropertyOptional({ enum: TxnStatusEnum })
  @IsOptional() @IsEnum(TxnStatusEnum)
  status?: TxnStatusEnum;

  @ApiPropertyOptional({ enum: TxnDirEnum })
  @IsOptional() @IsEnum(TxnDirEnum)
  direction?: TxnDirEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  bankId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  accountId?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional() @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional() @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Qidiruv (description, name, ref)' })
  @IsOptional() @IsString()
  q?: string;

  // ─── Google Sheets stilida per-column filterlar (vergul bilan ajratilgan) ───
  @ApiPropertyOptional({ description: "Bank ID'lari (vergul bilan)" })
  @IsOptional() @IsString()
  bankIds?: string;

  @ApiPropertyOptional({ description: "Bank hisob ID'lari (vergul bilan)" })
  @IsOptional() @IsString()
  accountIds?: string;

  @ApiPropertyOptional({ description: "Top kategoriya ID'lari (vergul bilan)" })
  @IsOptional() @IsString()
  categoryIds?: string;

  @ApiPropertyOptional({ description: "Subkategoriya ID'lari (vergul bilan)" })
  @IsOptional() @IsString()
  subcategoryIds?: string;

  @ApiPropertyOptional({ description: "Yo'nalish (vergul bilan: IN,OUT)" })
  @IsOptional() @IsString()
  directions?: string;

  @ApiPropertyOptional({ description: 'Shartnoma holati (vergul bilan: verified,unverified,none)' })
  @IsOptional() @IsString()
  contractStatuses?: string;

  @ApiPropertyOptional({ description: 'Shartnoma manbasi (vergul bilan: manual,ariza)' })
  @IsOptional() @IsString()
  contractSources?: string;

  @ApiPropertyOptional({ description: 'Summa pastki chegara' })
  @IsOptional() @Type(() => Number)
  amountMin?: number;

  @ApiPropertyOptional({ description: 'Summa yuqori chegara' })
  @IsOptional() @Type(() => Number)
  amountMax?: number;

  @ApiPropertyOptional({ description: "Hisob nomi (Yuboruvchi/Qabul qiluvchi, ko'p qiymat vergul bilan)" })
  @IsOptional() @IsString()
  hisobNomi?: string;

  // distinct endpoint uchun (whitelist'dan o'tish uchun ham bu yerda bo'lishi kerak)
  @ApiPropertyOptional({ description: "distinct uchun ustun nomi" })
  @IsOptional() @IsString()
  column?: string;

  @ApiPropertyOptional({ description: "distinct uchun qidirish (limit'dan tashqarisini ham topadi)" })
  @IsOptional() @IsString()
  search?: string;

  // export uchun
  @ApiPropertyOptional() @IsOptional() @IsString()
  matchStatus?: string;

  @ApiPropertyOptional({ description: 'Import batch ID — faqat shu yuklamadagi tranzaksiyalar' })
  @IsOptional() @IsString()
  batchId?: string;
}
