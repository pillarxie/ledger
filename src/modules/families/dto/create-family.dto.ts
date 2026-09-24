import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFamilyDto {
  @ApiProperty({ description: '家庭名称', example: '我的家庭' })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ description: '家庭描述' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}
