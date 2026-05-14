import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum BankApiKindEnum {
  KAPITALBANK_V3 = 'KAPITALBANK_V3',
  GENERIC = 'GENERIC',
}

export class CreateBankDto {
  @ApiProperty({ example: 'KAPITALBANK' })
  @IsString() @MaxLength(32)
  code!: string;

  @ApiProperty({ example: 'Kapitalbank' })
  @IsString() @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ example: 'https://m.bank24.uz:2713/Mobile.svc' })
  @IsOptional() @IsString()
  apiBaseUrl?: string;

  @ApiPropertyOptional({ enum: BankApiKindEnum, default: BankApiKindEnum.KAPITALBANK_V3 })
  @IsOptional() @IsEnum(BankApiKindEnum)
  apiKind?: BankApiKindEnum;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateBankDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(128)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  apiBaseUrl?: string;

  @ApiPropertyOptional({ enum: BankApiKindEnum })
  @IsOptional() @IsEnum(BankApiKindEnum)
  apiKind?: BankApiKindEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Sync intervali (daqiqa)', minimum: 1, maximum: 1440 })
  @IsOptional() @IsInt() @Min(1) @Max(1440)
  syncIntervalMinutes?: number;
}
