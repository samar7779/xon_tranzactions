import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAccountDto {
  @ApiProperty()
  @IsString()
  credentialId!: string;

  @ApiProperty({ example: '00974', description: 'MFO (5 belgi)' })
  @IsString() @MaxLength(8)
  branch!: string;

  @ApiProperty({ example: '20208000012345678001', description: '20-belgili hisob raqami' })
  @IsString() @MaxLength(32)
  accountNo!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  ownerName?: string;

  @ApiPropertyOptional({ example: 'UZS', default: 'UZS' })
  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  syncEnabled?: boolean;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  ownerName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  syncEnabled?: boolean;
}
