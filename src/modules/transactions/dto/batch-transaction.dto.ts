import { IsArray, IsString, IsEnum, ArrayMaxSize, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BatchTransactionDto {
  @ApiProperty({ description: '账单ID列表', example: ['uuid1', 'uuid2'] })
  @IsArray()
  @ArrayMinSize(1, { message: '账单ID列表不能为空' })
  @ArrayMaxSize(100, { message: '单次批量操作最多100条' })
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({ description: '操作类型', enum: ['delete'] })
  @IsEnum(['delete'])
  action: 'delete';
}
