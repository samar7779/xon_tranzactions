import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsPositive,
  IsString, MaxLength, Min, ValidateNested,
} from 'class-validator';

export enum ContractStatusEnum {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  SUSPENDED = 'SUSPENDED',
}

export class StageInput {
  @ApiProperty({ example: 'Avans' })
  @IsString() @MaxLength(128)
  title!: string;

  @ApiProperty({ example: 450000000 })
  @IsNumber() @IsPositive()
  amount!: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional() @IsNumber() @Min(0)
  percentage?: number;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional() @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}

export class CreateContractDto {
  @ApiProperty()
  @IsString()
  customerId!: string;

  @ApiProperty({ example: 'Tashkent Mall qurilishi' })
  @IsString() @MaxLength(255)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  projectAddress?: string;

  @ApiPropertyOptional({ description: 'Shartnoma raqami (avtomatik bo\'sh qoldirsangiz)' })
  @IsOptional() @IsString() @MaxLength(64)
  number?: string;

  @ApiProperty({ example: 1500000000 })
  @IsNumber() @IsPositive()
  totalAmount!: number;

  @ApiPropertyOptional({ default: 'UZS' })
  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiProperty({ example: '2026-01-15' })
  @IsDateString()
  signDate!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ContractStatusEnum, default: ContractStatusEnum.ACTIVE })
  @IsOptional() @IsEnum(ContractStatusEnum)
  status?: ContractStatusEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;

  @ApiProperty({ type: [StageInput], description: 'Bosqichlar (avans, poydevor, ...)' })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => StageInput)
  stages!: StageInput[];
}

export class UpdateContractDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  projectAddress?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: ContractStatusEnum })
  @IsOptional() @IsEnum(ContractStatusEnum)
  status?: ContractStatusEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}
