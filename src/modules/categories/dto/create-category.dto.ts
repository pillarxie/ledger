import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TransactionType } from '@prisma/client';

export class CreateCategoryDto {
  @ApiProperty({ description: '分类名称', example: '餐饮' })
  @IsString()
  name: string;

  @ApiProperty({ description: '分类类型', enum: TransactionType })
  @IsEnum(TransactionType)
  type: TransactionType;

  @ApiProperty({ description: '图标', example: 'restaurant' })
  @IsString()
  icon: string;

  @ApiProperty({ description: '颜色', example: '#FF6B6B' })
  @IsString()
  color: string;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '是否家庭共享' })
  @IsOptional()
  @IsBoolean()
  isFamilyShared?: boolean;

  @ApiPropertyOptional({ description: '家庭ID' })
  @IsOptional()
  @IsString()
  familyId?: string;
}
