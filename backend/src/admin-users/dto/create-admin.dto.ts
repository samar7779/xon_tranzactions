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

  @ApiPropertyOptional({ enum: AdminRoleEnum, default: AdminRoleEnum.ADMIN, description: 'Legacy enum role' })
  @IsOptional() @IsEnum(AdminRoleEnum)
  role?: AdminRoleEnum = AdminRoleEnum.ADMIN;

  @ApiPropertyOptional({ description: 'Yangi RBAC: Role.id' })
  @IsOptional() @IsString()
  roleId?: string;
}

export class UpdateAdminDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  fullName?: string;

  @ApiPropertyOptional({ enum: AdminRoleEnum })
  @IsOptional() @IsEnum(AdminRoleEnum)
  role?: AdminRoleEnum;

  @ApiPropertyOptional({ description: 'Yangi RBAC: Role.id (null/bo\'sh — rolni olib tashlash)' })
  @IsOptional() @IsString()
  roleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional() @IsString() @MinLength(8)
  password?: string;
}
