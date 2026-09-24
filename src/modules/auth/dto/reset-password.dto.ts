import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: '重置令牌（通过忘记密码接口获取）' })
  @IsString()
  token: string;

  @ApiProperty({
    description: '新密码',
    example: 'NewPassword123!',
    minLength: 8,
    maxLength: 64,
  })
  @IsString()
  @MinLength(8, { message: '密码至少8个字符' })
  @MaxLength(64, { message: '密码最多64个字符' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
    message: '密码必须包含大小写字母和数字',
  })
  newPassword: string;
}
