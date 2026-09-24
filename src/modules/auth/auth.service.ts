import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from '../../common/decorators';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
  ) { }

  /**
   * 用户注册
   */
  async register(dto: RegisterDto) {
    // 检查用户名是否已存在
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: dto.username }, { email: dto.email }],
      },
    });

    if (existingUser) {
      if (existingUser.username === dto.username) {
        throw new ConflictException('用户名已存在');
      }
      throw new ConflictException('邮箱已被注册');
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // 创建用户（并发下唯一约束兜底）
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          password: hashedPassword,
        },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException('用户名或邮箱已被注册');
      }
      throw error;
    }

    // 生成令牌
    const tokens = await this.generateTokens(user.id, user.username, user.email);

    return {
      user: this.excludePassword(user),
      ...tokens,
    };
  }

  /**
   * 用户登录
   */
  async login(dto: LoginDto) {
    // 检查登录失败次数
    const failKey = `login_fail:${dto.email}`;
    let failCount = 0;
    try {
      failCount = parseInt((await this.redisService.get(failKey)) || '0');
    } catch (error) {
      // Redis 不可用时降级：跳过失败计数（fail-open），避免登录整体不可用
      this.logger.warn(
        `Redis 不可用，登录失败计数降级跳过: ${(error as Error).message}`,
      );
    }

    if (failCount >= 5) {
      throw new UnauthorizedException('登录失败次数过多，请15分钟后再试');
    }

    // 查找用户
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      await this.incrementLoginFail(failKey);
      throw new UnauthorizedException('邮箱或密码错误');
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      await this.incrementLoginFail(failKey);
      throw new UnauthorizedException('邮箱或密码错误');
    }

    // 清除失败记录（Redis 不可用时忽略）
    try {
      await this.redisService.del(failKey);
    } catch (error) {
      this.logger.warn(
        `Redis 不可用，登录失败计数清除跳过: ${(error as Error).message}`,
      );
    }

    // 生成令牌
    const tokens = await this.generateTokens(user.id, user.username, user.email);

    return {
      user: this.excludePassword(user),
      ...tokens,
    };
  }

  /**
   * 刷新令牌
   */
  async refreshToken(dto: RefreshTokenDto) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(dto.refreshToken, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('刷新令牌无效或已过期');
    }

    if (payload.tokenType !== 'refresh' || !payload.sessionId) {
      throw new UnauthorizedException('请使用刷新令牌');
    }
    await this.assertSessionActive(payload.sessionId);

    // 检查令牌是否在黑名单中
    const isBlacklisted = await this.redisService.exists(`blacklist:${dto.refreshToken}`);
    if (isBlacklisted) {
      throw new UnauthorizedException('令牌已失效');
    }

    // 查找用户
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    // 将旧刷新令牌加入黑名单
    const { refreshSecs } = this.getTokenTTL();
    await this.redisService.set(`blacklist:${dto.refreshToken}`, '1', refreshSecs);

    // 生成新令牌
    return this.generateTokens(user.id, user.username, user.email, payload.sessionId);
  }

  /**
   * 登出
   */
  async logout(refreshToken: string, user: JwtPayload) {
    const { refreshSecs } = this.getTokenTTL();
    await this.redisService.set(`revoked_session:${user.sessionId}`, '1', refreshSecs);
    if (refreshToken) {
      // 将刷新令牌加入黑名单
      const { refreshSecs } = this.getTokenTTL();
      await this.redisService.set(`blacklist:${refreshToken}`, '1', refreshSecs);
    }
    return { message: '登出成功' };
  }

  /** 本期不开放找回密码，不能假装已发送邮件或暴露重置令牌。 */
  async forgotPassword(_dto: ForgotPasswordDto) {
    throw new ServiceUnavailableException('找回密码暂未开放');
  }

  /**
   * 重置密码：校验一次性令牌并更新密码
   */
  async resetPassword(dto: ResetPasswordDto) {
    const key = `reset_token:${dto.token}`;
    const userId = await this.redisService.get(key);

    if (!userId) {
      throw new BadRequestException('重置令牌无效或已过期');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    // 令牌一次性使用，用完即销毁
    await this.redisService.del(key);

    // 清除该邮箱的登录失败计数，避免密码重置后仍被锁定
    await this.redisService.del(`login_fail:${user.email}`);

    return { message: '密码重置成功，请使用新密码登录' };
  }

  /**
   * 验证用户
   */
  async validateAccessToken(payload: JwtPayload) {
    if (payload.tokenType !== 'access' || !payload.sessionId) {
      throw new UnauthorizedException('访问令牌无效，请重新登录');
    }
    await this.assertSessionActive(payload.sessionId);
    const user = await this.validateUser(payload.sub);
    if (!user) throw new UnauthorizedException('用户不存在');
    return payload;
  }

  private async assertSessionActive(sessionId: string) {
    if (await this.redisService.exists(`revoked_session:${sessionId}`)) {
      throw new UnauthorizedException('登录会话已失效，请重新登录');
    }
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  /**
   * 读取 token 过期时间（统一以「秒」为单位）
   *
   * 设计约定：
   * - 环境变量存"秒数"（如 JWT_ACCESS_TOKEN_EXPIRES_IN=900）
   * - 内部消费时：传给 JWT 拼成 `${n}s`（带单位），传给 Redis/响应体则直接用数字
   *
   * ⚠️ 历史 bug：jsonwebtoken 把无单位字符串当 **毫秒**，导致 `900` 被解析为 0.9 秒
   */
  private getTokenTTL() {
    const accessSecs =
      Number(this.configService.get('JWT_ACCESS_TOKEN_EXPIRES_IN', 900)) || 900;
    const refreshSecs =
      Number(this.configService.get('JWT_REFRESH_TOKEN_EXPIRES_IN', 604800)) ||
      604800;
    return { accessSecs, refreshSecs };
  }

  /**
   * 生成访问令牌和刷新令牌
   */
  private async generateTokens(
    userId: string, username: string, email: string,
    sessionId: string = crypto.randomUUID(),
  ) {
    const payload = { sub: userId, username, email, sessionId };
    const { accessSecs, refreshSecs } = this.getTokenTTL();

    const accessToken = this.jwtService.sign({ ...payload, tokenType: 'access', jti: crypto.randomUUID() }, {
      expiresIn: `${accessSecs}s`,
    });

    const refreshToken = this.jwtService.sign({ ...payload, tokenType: 'refresh', jti: crypto.randomUUID() }, {
      expiresIn: `${refreshSecs}s`,
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: accessSecs,
      refreshTokenExpiresIn: refreshSecs,
    };
  }

  /**
   * 增加登录失败次数（Redis 不可用时降级跳过）
   */
  private async incrementLoginFail(key: string) {
    try {
      const count = await this.redisService.incr(key);
      if (count === 1) {
        // 15分钟过期
        await this.redisService.expire(key, 900);
      }
    } catch (error) {
      this.logger.warn(
        `Redis 不可用，登录失败计数跳过: ${(error as Error).message}`,
      );
    }
  }

  /**
   * 排除密码字段
   */
  private excludePassword(user: any) {
    const { password, ...result } = user;
    return result;
  }
}
