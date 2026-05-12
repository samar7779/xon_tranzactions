import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'ACCOUNTANT' })
  @IsString() @MaxLength(64)
  name!: string;

  @ApiProperty({ example: 'Hisobchi' })
  @IsString() @MaxLength(128)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiProperty({ type: [String], example: ['dashboard:view', 'transactions:view'] })
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(128)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions?: string[];
}
