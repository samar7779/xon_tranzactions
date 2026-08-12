import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/** Qo'lда order raqam(lar)ini tekshirish */
export class ManualCheckDto {
  @ApiPropertyOptional({ description: "Order raqamlari (vergul yoki yangi qator bilan)" })
  @IsOptional() @IsString()
  orderNos?: string;
}

/** Chek order tarixi — ro'yxat filtri */
export class ListChekOrderDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  perPage?: number = 30;

  @ApiPropertyOptional({ description: 'Erkin qidiruv — order № / shartnoma / ism' })
  @IsOptional() @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ['all', 'found', 'mismatch', 'not_found'] })
  @IsOptional() @IsIn(['all', 'found', 'mismatch', 'not_found'])
  result?: string;

  @ApiPropertyOptional({ description: 'Sana boshi (YYYY-MM-DD)' })
  @IsOptional() @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Sana oxiri (YYYY-MM-DD)' })
  @IsOptional() @IsString()
  dateTo?: string;
}
