import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty({ example: "OOO Tashkent Mall" })
  @IsString() @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: '300123456' })
  @IsOptional() @IsString() @MaxLength(16)
  inn?: string;

  @ApiPropertyOptional({ example: '60101234567890123456' })
  @IsOptional() @IsString() @MaxLength(16)
  pinfl?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(64)
  shortName?: string;

  @ApiPropertyOptional({ example: 'Aliyev Akmal' })
  @IsOptional() @IsString() @MaxLength(128)
  contactPerson?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(32)
  bankAccount?: string;

  @ApiPropertyOptional({ example: '00974' })
  @IsOptional() @IsString() @MaxLength(8)
  bankMfo?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerDto extends CreateCustomerDto {
  declare name?: string;
}
