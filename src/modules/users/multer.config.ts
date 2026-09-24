import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

/** 头像文件存放目录（相对于项目根目录） */
export const UPLOADS_ROOT = join(process.cwd(), 'uploads');
export const AVATAR_UPLOAD_DIR = join(UPLOADS_ROOT, 'avatars');

/** 允许的头像扩展名 */
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
/** 头像大小上限：5MB */
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

/**
 * 头像上传配置工厂
 *
 * 每次调用都会确保上传目录存在（diskStorage 不会自动创建目录）
 */
export function createAvatarMulterOptions(): MulterOptions {
  if (!existsSync(AVATAR_UPLOAD_DIR)) {
    mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
  }

  return {
    storage: diskStorage({
      destination: AVATAR_UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        // 使用随机文件名，避免路径猜测与覆盖
        cb(null, `${randomUUID()}${ext}`);
      },
    }),
    limits: {
      fileSize: MAX_AVATAR_SIZE,
    },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return cb(
          new BadRequestException(
            `仅支持以下图片格式: ${ALLOWED_EXTENSIONS.join(', ')}`,
          ),
          false,
        );
      }
      cb(null, true);
    },
  };
}
