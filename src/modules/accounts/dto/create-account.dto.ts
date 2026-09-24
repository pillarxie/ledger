import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsInt,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccountType } from '@prisma/client';

export class CreateAccountDto {
  @ApiProperty({ description: '账户名称', example: '支付宝' })
  @IsString()
  name: string;

  @ApiProperty({ description: '账户类型', enum: AccountType })
  @IsEnum(AccountType)
  type: AccountType;

  @ApiPropertyOptional({ description: '初始余额', example: 1000.00 })
  @IsOptional()
  @IsNumber()
  balance?: number;

  @ApiProperty({ description: '图标', example: 'account_balance_wallet' })
  @IsString()
  icon: string;

  @ApiProperty({ description: '颜色', example: '#1677FF' })
  @IsString()
  color: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '是否计入总资产' })
  @IsOptional()
  @IsBoolean()
  isIncludedInTotal?: boolean;
}
