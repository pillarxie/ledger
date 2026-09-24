import {
  IsString,
  IsNumber,
  IsEnum,
  IsDateString,
  IsBoolean,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class CreateTransactionDto {
  @ApiProperty({ description: '账单类型', enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ description: '金额', example: 100.00 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiProperty({ description: '分类ID' })
  @IsString()
  categoryId: string;

  @ApiPropertyOptional({ description: '子分类ID' })
  @IsOptional()
  @IsString()
  subCategoryId?: string;

  @ApiProperty({ description: '账户ID' })
  @IsString()
  accountId: string;

  @ApiProperty({ description: '日期', example: '2024-01-15' })
  @IsDateString()
  date: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '标签', example: ['餐饮', '工作餐'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '地点' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ description: '是否计入家庭账本' })
  @IsOptional()
  @IsBoolean()
  isFamilyShared?: boolean;

  @ApiPropertyOptional({ description: '家庭ID' })
  @IsOptional()
  @IsString()
  familyId?: string;
}
