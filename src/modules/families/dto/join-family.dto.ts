import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinFamilyDto {
  @ApiProperty({ description: '邀请码', example: 'A3B9K2' })
  @IsString()
  @Length(4, 8)
  inviteCode: string;
}
