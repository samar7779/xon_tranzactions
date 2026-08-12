import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

/** Qo'lда order raqam(lar)ini tekshirish */
export class ManualCheckDto {
  @ApiPropertyOptional({ description: "Order raqamlari (vergul yoki yangi qator bilan)" })
  @IsOptional() @IsString()
  orderNos?: string;
}

/** AI yordamchi chat — bitta xabar almashish */
export class AssistantChatDto {
  @ApiPropertyOptional({ description: "Suhbat tarixi [{role:'user'|'assistant', content:string}]" })
  @IsOptional()
  messages?: Array<{ role: string; content: string }>;

  @ApiPropertyOptional({ description: 'Kontekst — joriy orderlar/natijalar, shartnoma' })
  @IsOptional()
  context?: any;
}

/** Murojaat yaratish */
export class CreateTicketDto {
  @ApiPropertyOptional() @IsOptional() @IsString() contractNo?: string;
  @ApiPropertyOptional() @IsOptional() orderNos?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() matchedTxExtId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
  @ApiPropertyOptional() @IsString() summary!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() details?: string;
  @ApiPropertyOptional() @IsOptional() transcript?: any;
  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
}

/** Murojaatni yangilash (holat / mas'ul / hal qilish) */
export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: ['new', 'in_progress', 'resolved', 'rejected'] })
  @IsOptional() @IsIn(['new', 'in_progress', 'resolved', 'rejected'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() resolution?: string;
}

/** Murojaatlar ro'yxati filtri */
export class ListTicketsDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  perPage?: number = 30;

  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;

  @ApiPropertyOptional({ enum: ['all', 'new', 'in_progress', 'resolved', 'rejected'] })
  @IsOptional() @IsIn(['all', 'new', 'in_progress', 'resolved', 'rejected'])
  status?: string;

  @ApiPropertyOptional({ description: "'1' — faqat menga biriktirilgan" })
  @IsOptional() @IsString()
  mine?: string;
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
