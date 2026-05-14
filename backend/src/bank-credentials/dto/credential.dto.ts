import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export enum BankAuthModeEnum {
  IP_WHITELIST = 'IP_WHITELIST',
  SMS_SID = 'SMS_SID',
}

export class CreateCredentialDto {
  @ApiProperty()
  @IsString()
  bankId!: string;

  @ApiProperty({ example: 'Xon Saroy — Yunusobod filial' })
  @IsString() @MaxLength(128)
  label!: string;

  @ApiPropertyOptional({ example: 'IB#', description: 'KapitalBank IB# yoki bo\'sh' })
  @IsOptional() @IsString() @MaxLength(8)
  loginPrefix?: string;

  @ApiProperty()
  @IsString() @MinLength(2)
  loginName!: string;

  @ApiProperty({ description: 'Bank API paroli (shifrlanib saqlanadi)' })
  @IsString() @MinLength(1)
  password!: string;

  @ApiPropertyOptional({ description: 'KapitalBank Client.id (APILogin javobida) — auto-fill mumkin' })
  @IsOptional() @IsString()
  clientIdExt?: string;

  @ApiPropertyOptional({ description: 'MFO' })
  @IsOptional() @IsString() @MaxLength(8)
  branch?: string;

  @ApiPropertyOptional({ enum: BankAuthModeEnum, default: BankAuthModeEnum.IP_WHITELIST })
  @IsOptional() @IsEnum(BankAuthModeEnum)
  authMode?: BankAuthModeEnum;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false, description: 'ahost forwarder orqali yuborish' })
  @IsOptional() @IsBoolean()
  useProxy?: boolean;
}

export class UpdateCredentialDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  bankId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(128)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(8)
  loginPrefix?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  loginName?: string;

  @ApiPropertyOptional({ description: 'Yangi parol (agar o\'zgartirilsa)' })
  @IsOptional() @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  clientIdExt?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  branch?: string;

  @ApiPropertyOptional({ enum: BankAuthModeEnum })
  @IsOptional() @IsEnum(BankAuthModeEnum)
  authMode?: BankAuthModeEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  useProxy?: boolean;
}
