import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ description: '注册邮箱', example: 'john@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}
