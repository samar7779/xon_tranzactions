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
}
