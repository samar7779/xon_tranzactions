import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum AdminRoleEnum {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  VIEWER = 'VIEWER',
}

export class CreateAdminDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: AdminRoleEnum, default: AdminRoleEnum.ADMIN })
  @IsOptional() @IsEnum(AdminRoleEnum)
  role?: AdminRoleEnum = AdminRoleEnum.ADMIN;
}

export class UpdateAdminDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: AdminRoleEnum })
  @IsOptional() @IsEnum(AdminRoleEnum)
  role?: AdminRoleEnum;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional() @IsString() @MinLength(8)
  password?: string;
}
