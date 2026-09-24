import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class CategoryOrderItem {
  @ApiProperty({ description: '分类ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: '排序值' })
  @IsInt()
  sortOrder: number;
}

export class ReorderCategoryDto {
  @ApiProperty({ description: '排序项列表', type: [CategoryOrderItem] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryOrderItem)
  orders: CategoryOrderItem[];
}
