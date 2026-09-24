import { IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PullDataDto {
  @ApiProperty({ description: '设备ID' })
  @IsString()
  deviceId: string;

  @ApiProperty({ description: '上次同步时间' })
  @IsDateString()
  lastSyncAt: string;
}
