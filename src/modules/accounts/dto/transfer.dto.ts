import { IsString, IsNumber, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TransferDto {
  @ApiProperty({ description: '源账户ID' })
  @IsString()
  fromAccountId: string;

  @ApiProperty({ description: '目标账户ID' })
  @IsString()
  toAccountId: string;

  @ApiProperty({ description: '转账金额', example: 100.0 })
  @IsNumber()
  @Min(0.01)
  amount: number;
}
