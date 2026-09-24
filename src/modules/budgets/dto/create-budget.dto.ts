import {
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BudgetPeriod } from '@prisma/client';

export class CreateBudgetDto {
  @ApiProperty({ description: '预算金额', example: 5000.00 })
  @IsNumber()
  @Min(0.01, { message: '预算金额必须大于 0' })
  amount: number;

  @ApiProperty({ description: '预算周期', enum: BudgetPeriod })
  @IsEnum(BudgetPeriod)
  period: BudgetPeriod;

  @ApiPropertyOptional({ description: '分类ID（null为总预算）' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '家庭ID' })
  @IsOptional()
  @IsString()
  familyId?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01' })
  @IsDateString()
  startDate: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
