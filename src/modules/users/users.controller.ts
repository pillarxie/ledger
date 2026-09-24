import {
  BadRequestException,
  Controller,
  Get,
  Put,
  Delete,
  Body,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { unlink } from 'fs/promises';
import { join } from 'path';
import 'multer';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../../common/decorators';
import { createAvatarMulterOptions, UPLOADS_ROOT } from './multer.config';

@ApiTags('用户')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: '获取当前用户信息' })
  async getCurrentUser(@CurrentUser('sub') userId: string) {
    return this.usersService.findById(userId);
  }

  @Put('me')
  @ApiOperation({ summary: '更新用户信息' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(userId, dto);
  }

  @Put('me/avatar')
  @ApiOperation({ summary: '更新用户头像' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['avatar'],
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
          description: '头像图片（jpg/png/webp/gif，最大 5MB）',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('avatar', createAvatarMulterOptions()))
  async updateAvatar(
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传头像文件');
    }

    const avatarUrl = `/uploads/avatars/${file.filename}`;

    // 删除旧的头像文件（仅清理本地上传的头像，忽略失败）
    const current = await this.usersService.findById(userId);
    if (current.avatar && current.avatar.startsWith('/uploads/avatars/')) {
      const oldPath = join(
        UPLOADS_ROOT,
        current.avatar.replace('/uploads/', ''),
      );
      unlink(oldPath).catch(() => {
        // 旧文件清理失败不影响本次更新
      });
    }

    return this.usersService.updateAvatar(userId, avatarUrl);
  }

  @Delete('me')
  @ApiOperation({ summary: '注销账号' })
  async deleteAccount(@CurrentUser('sub') userId: string) {
    // 先清理本地上传的头像文件
    const current = await this.usersService.findById(userId);
    if (current.avatar && current.avatar.startsWith('/uploads/avatars/')) {
      const avatarPath = join(
        UPLOADS_ROOT,
        current.avatar.replace('/uploads/', ''),
      );
      unlink(avatarPath).catch(() => {
        // 文件清理失败不影响注销
      });
    }

    return this.usersService.delete(userId);
  }

  @Get('me/stats')
  @ApiOperation({ summary: '获取用户统计信息' })
  async getStats(@CurrentUser('sub') userId: string) {
    return this.usersService.getStats(userId);
  }
}
