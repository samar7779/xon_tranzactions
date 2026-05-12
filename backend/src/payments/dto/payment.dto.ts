import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from 'class-validator';

export class AllocationDto {
  @ApiProperty()
  @IsString()
  stageId!: string;

  @ApiProperty({ example: 200000000 })
  @IsNumber() @IsPositive()
  amount!: number;
}

export class LinkPaymentsDto {
  @ApiProperty()
  @IsString()
  transactionId!: string;

  @ApiProperty({ type: [AllocationDto], description: 'Bir tranzaksiyani bir nechta bosqichga taqsimlash' })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => AllocationDto)
  allocations!: AllocationDto[];

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notes?: string;
}
