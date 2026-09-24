import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 客户端某条实体的版本信息 */
export class EntityVersionDto {
  @ApiProperty({ description: '实体ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: '客户端最后修改时间', example: '2025-01-01T00:00:00.000Z' })
  @IsISO8601()
  updatedAt: string;

  @ApiPropertyOptional({ description: '客户端是否已删除该实体' })
  @IsOptional()
  @IsBoolean()
  deleted?: boolean;
}

export class ConflictCheckDto {
  @ApiProperty({ description: '设备ID' })
  @IsString()
  deviceId: string;

  @ApiProperty({
    description: '上次成功同步时间（服务端返回的 syncTime）',
    example: '2025-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  lastSyncAt: string;

  @ApiPropertyOptional({ description: '客户端账单版本列表', type: [EntityVersionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntityVersionDto)
  transactions?: EntityVersionDto[];

  @ApiPropertyOptional({ description: '客户端分类版本列表', type: [EntityVersionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntityVersionDto)
  categories?: EntityVersionDto[];

  @ApiPropertyOptional({ description: '客户端账户版本列表', type: [EntityVersionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntityVersionDto)
  accounts?: EntityVersionDto[];

  @ApiPropertyOptional({ description: '客户端预算版本列表', type: [EntityVersionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntityVersionDto)
  budgets?: EntityVersionDto[];
}
