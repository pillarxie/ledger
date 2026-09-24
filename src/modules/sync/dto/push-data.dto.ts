import {
  IsArray,
  IsIn,
  Min,
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TransactionSyncData {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  familyId?: string;

  @IsIn(['expense', 'income'])
  type: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  categoryId: string;

  @IsOptional()
  @IsString()
  subCategoryId?: string;

  @IsString()
  accountId: string;

  @IsISO8601()
  date: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsBoolean()
  isFamilyShared?: boolean;
}

export class CategorySyncData {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  familyId?: string;

  @IsString()
  name: string;

  @IsIn(['expense', 'income'])
  type: string;

  @IsString()
  icon: string;

  @IsString()
  color: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isFamilyShared?: boolean;
}

export class AccountSyncData {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsIn(['cash', 'debitCard', 'creditCard', 'alipay', 'wechat', 'other'])
  type: string;

  @IsNumber()
  balance: number;

  @IsString()
  icon: string;

  @IsString()
  color: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isIncludedInTotal?: boolean;
}

export class BudgetSyncData {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  familyId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsIn(['monthly', 'yearly'])
  period: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsISO8601()
  startDate: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PushDataDto {
  @ApiProperty({ description: '设备ID' })
  @IsString()
  deviceId: string;

  @ApiPropertyOptional({ description: '账单数据', type: [TransactionSyncData] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransactionSyncData)
  transactions?: TransactionSyncData[];

  @ApiPropertyOptional({ description: '分类数据', type: [CategorySyncData] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategorySyncData)
  categories?: CategorySyncData[];

  @ApiPropertyOptional({ description: '账户数据', type: [AccountSyncData] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountSyncData)
  accounts?: AccountSyncData[];

  @ApiPropertyOptional({ description: '预算数据', type: [BudgetSyncData] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetSyncData)
  budgets?: BudgetSyncData[];
}
