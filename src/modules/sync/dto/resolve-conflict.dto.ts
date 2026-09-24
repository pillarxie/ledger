import {
  IsArray,
  IsISO8601,
  IsBoolean,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  TransactionSyncData,
  CategorySyncData,
  AccountSyncData,
  BudgetSyncData,
} from './push-data.dto';

export class TransactionResolutionDto {
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @ApiProperty({ description: '账单ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'true 保留服务器版本，false 使用客户端数据' })
  @IsBoolean()
  useServer: boolean;

  @ApiPropertyOptional({ description: '客户端版本数据（useServer=false 时必填）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TransactionSyncData)
  data?: TransactionSyncData;

  @ApiPropertyOptional({ description: '客户端希望删除该账单（软删除）' })
  @IsOptional()
  @IsBoolean()
  deleted?: boolean;
}

export class CategoryResolutionDto {
  @ApiProperty({ description: '分类ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'true 保留服务器版本，false 使用客户端数据' })
  @IsBoolean()
  useServer: boolean;

  @ApiPropertyOptional({ description: '客户端版本数据（useServer=false 时必填）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CategorySyncData)
  data?: CategorySyncData;
}

export class AccountResolutionDto {
  @ApiProperty({ description: '账户ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'true 保留服务器版本，false 使用客户端数据' })
  @IsBoolean()
  useServer: boolean;

  @ApiPropertyOptional({ description: '客户端版本数据（useServer=false 时必填）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => AccountSyncData)
  data?: AccountSyncData;
}

export class BudgetResolutionDto {
  @ApiProperty({ description: '预算ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'true 保留服务器版本，false 使用客户端数据' })
  @IsBoolean()
  useServer: boolean;

  @ApiPropertyOptional({ description: '客户端版本数据（useServer=false 时必填）' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BudgetSyncData)
  data?: BudgetSyncData;
}

export class ResolveConflictsDto {
  @ApiPropertyOptional({ description: '账单冲突解决方案', type: [TransactionResolutionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransactionResolutionDto)
  transactions?: TransactionResolutionDto[];

  @ApiPropertyOptional({ description: '分类冲突解决方案', type: [CategoryResolutionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryResolutionDto)
  categories?: CategoryResolutionDto[];

  @ApiPropertyOptional({ description: '账户冲突解决方案', type: [AccountResolutionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountResolutionDto)
  accounts?: AccountResolutionDto[];

  @ApiPropertyOptional({ description: '预算冲突解决方案', type: [BudgetResolutionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetResolutionDto)
  budgets?: BudgetResolutionDto[];
}
