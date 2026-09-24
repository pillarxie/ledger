import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/* ----------------------- 通用工厂：构造 mock 依赖 ----------------------- */

const mockUser = {
  id: 'u-1',
  username: 'alice',
  email: 'alice@ledger.app',
  password: 'hashed-pwd',
  avatar: null,
  phone: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildPrismaMock() {
  return {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

function buildRedisMock() {
  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  };
}

function buildJwtMock() {
  return {
    sign: jest.fn().mockReturnValue('jwt.signed.token'),
    verify: jest.fn(),
  };
}

function buildConfigMock() {
  const map: Record<string, unknown> = {
    JWT_SECRET: 'test-secret',
    JWT_ACCESS_TOKEN_EXPIRES_IN: 900,
    JWT_REFRESH_TOKEN_EXPIRES_IN: 604800,
  };
  return {
    get: jest.fn((key: string, fallback?: unknown) =>
      map[key] !== undefined ? map[key] : fallback,
    ),
  };
}

/* ------------------------------ 测试 ------------------------------ */

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let redis: ReturnType<typeof buildRedisMock>;
  let jwt: ReturnType<typeof buildJwtMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    redis = buildRedisMock();
    jwt = buildJwtMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: buildConfigMock() },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  /* ============================ register ============================ */

  describe('register', () => {
    const dto = {
      username: 'alice',
      email: 'alice@ledger.app',
      password: 'Passw0rd!',
    };

    it('成功创建新用户并返回 user + tokens（密码经过 bcrypt 加密）', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ ...mockUser, ...data }),
      );

      const result = await service.register(dto);

      // 用户名+邮箱去重查询
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: dto.username }, { email: dto.email }],
        },
      });

      // 密码被 bcrypt 加密（非明文存入）
      const createArg = prisma.user.create.mock.calls[0][0] as {
        data: { password: string };
      };
      expect(createArg.data.password).not.toBe(dto.password);
      expect(
        await bcrypt.compare(dto.password, createArg.data.password),
      ).toBe(true);

      // 响应中 password 字段被剥离
      expect(result.user).not.toHaveProperty('password');
      expect(result.user.email).toBe(dto.email);
      expect(result.accessToken).toBe('jwt.signed.token');
      expect(result.refreshToken).toBe('jwt.signed.token');
      // signature 调用了两次（access + refresh）
      expect(jwt.sign).toHaveBeenCalledTimes(2);
    });

    it('用户名已存在时抛 ConflictException（用户名已存在）', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        username: dto.username,
        email: 'other@ledger.app',
      });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
      await expect(service.register(dto)).rejects.toThrow('用户名已存在');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('邮箱已注册时抛 ConflictException（邮箱已被注册）', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...mockUser,
        username: 'someone_else',
        email: dto.email,
      });

      await expect(service.register(dto)).rejects.toThrow('邮箱已被注册');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  /* ============================== login ============================== */

  describe('login', () => {
    const dto = { email: 'alice@ledger.app', password: 'Passw0rd!' };
    let hashed: string;

    beforeAll(async () => {
      hashed = await bcrypt.hash(dto.password, 10);
    });

    it('凭据正确：返回 user + tokens 并清除失败计数', async () => {
      redis.get.mockResolvedValue('0');
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        email: dto.email,
        password: hashed,
      });

      const result = await service.login(dto);

      expect(redis.del).toHaveBeenCalledWith(`login_fail:${dto.email}`);
      expect(result.user.email).toBe(dto.email);
      expect(result.user).not.toHaveProperty('password');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it('用户不存在：抛 UnauthorizedException 并累加失败次数', async () => {
      redis.get.mockResolvedValue(null); // 0 次
      redis.incr.mockResolvedValue(1);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow('邮箱或密码错误');
      expect(redis.incr).toHaveBeenCalledWith(`login_fail:${dto.email}`);
      // 首次失败计数 → 设置 15min 过期
      expect(redis.expire).toHaveBeenCalledWith(`login_fail:${dto.email}`, 900);
    });

    it('密码错误：抛 UnauthorizedException 并累加失败次数', async () => {
      redis.get.mockResolvedValue('2');
      redis.incr.mockResolvedValue(3);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        email: dto.email,
        password: hashed,
      });

      await expect(
        service.login({ ...dto, password: 'wrong-pwd' }),
      ).rejects.toThrow('邮箱或密码错误');
      expect(redis.incr).toHaveBeenCalledWith(`login_fail:${dto.email}`);
      // 已是第 3 次（incr 返回 3），不再重置过期
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it('失败 ≥ 5 次：直接拒绝登录（不查库）', async () => {
      redis.get.mockResolvedValue('5');

      await expect(service.login(dto)).rejects.toThrow(
        '登录失败次数过多，请15分钟后再试',
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  /* ============================ refreshToken ============================ */

  describe('refreshToken', () => {
    const oldToken = 'old.refresh.token';

    it('合法 refreshToken：生成新 tokens 并把旧 token 加黑名单', async () => {
      jwt.verify.mockReturnValue({
        tokenType: 'refresh', sessionId: 's-1',
        sub: mockUser.id,
        username: mockUser.username,
        email: mockUser.email,
      });
      redis.exists.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.refreshToken({ refreshToken: oldToken });

      expect(redis.set).toHaveBeenCalledWith(
        `blacklist:${oldToken}`,
        '1',
        604800,
      );
      expect(result.accessToken).toBe('jwt.signed.token');
      expect(result.refreshToken).toBe('jwt.signed.token');
    });

    it('verify 抛错（token 无效或过期）→ UnauthorizedException', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(
        service.refreshToken({ refreshToken: 'bad' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.refreshToken({ refreshToken: 'bad' }),
      ).rejects.toThrow('刷新令牌无效或已过期');
    });

    it('token 已在黑名单 → 拒绝刷新', async () => {
      jwt.verify.mockReturnValue({ sub: 'u-1', username: 'a', email: 'a', tokenType: 'refresh', sessionId: 's-1' });
      redis.exists.mockImplementation(async (key: string) => key.startsWith('blacklist:') ? 1 : 0);

      await expect(
        service.refreshToken({ refreshToken: oldToken }),
      ).rejects.toThrow('令牌已失效');
    });

    it('token 合法但用户已被删除 → UnauthorizedException', async () => {
      jwt.verify.mockReturnValue({ sub: 'u-1', username: 'a', email: 'a', tokenType: 'refresh', sessionId: 's-1' });
      redis.exists.mockResolvedValue(0);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: oldToken }),
      ).rejects.toThrow('用户不存在');
    });
  });

  /* ============================== logout ============================== */

  describe('logout and session validation', () => {
    const user = { sub: 'u-1', username: 'a', email: 'a', tokenType: 'access' as const, sessionId: 's-1' };

    it('撤销整个会话并拉黑刷新令牌', async () => {
      await service.logout('rt-1', user);
      expect(redis.set).toHaveBeenCalledWith('blacklist:rt-1', '1', 604800);
      expect(redis.set).toHaveBeenCalledWith('revoked_session:s-1', '1', 604800);
    });

    it('拒绝 refresh token 作为 access token，未查询用户', async () => {
      await expect(service.validateAccessToken({ ...user, tokenType: 'refresh' })).rejects.toThrow(UnauthorizedException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('已退出会话的 access token 不再有效', async () => {
      redis.exists.mockResolvedValue(true);
      await expect(service.validateAccessToken(user)).rejects.toThrow('登录会话已失效');
    });

    it('禁止使用 access token 刷新', async () => {
      jwt.verify.mockReturnValue(user);
      await expect(service.refreshToken({ refreshToken: 'access' })).rejects.toThrow('请使用刷新令牌');
      expect(jwt.sign).not.toHaveBeenCalled();
    });

    it('已退出会话不能再刷新', async () => {
      jwt.verify.mockReturnValue({ ...user, tokenType: 'refresh' });
      redis.exists.mockResolvedValue(true);
      await expect(service.refreshToken({ refreshToken: 'refresh' })).rejects.toThrow('登录会话已失效');
    });
  });

  describe('forgotPassword', () => {
    it('本期未开放，不生成令牌也不假装发送邮件', async () => {
      await expect(service.forgotPassword({ email: 'alice@ledger.app' })).rejects.toThrow('找回密码暂未开放');
      expect(redis.set).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  /* ========================== resetPassword ========================== */

  describe('resetPassword', () => {
    const dto = { token: 'reset-token-abc', newPassword: 'NewPassw0rd!' };

    it('令牌有效：更新密码、销毁令牌并清除登录失败计数', async () => {
      redis.get.mockResolvedValue(mockUser.id);
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.resetPassword(dto);

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const updateArg = prisma.user.update.mock.calls[0][0] as {
        where: { id: string };
        data: { password: string };
      };
      expect(updateArg.where.id).toBe(mockUser.id);
      // 新密码经过 bcrypt 加密
      expect(updateArg.data.password).not.toBe(dto.newPassword);
      expect(
        await bcrypt.compare(dto.newPassword, updateArg.data.password),
      ).toBe(true);

      // 令牌一次性使用 + 清除登录失败计数
      expect(redis.del).toHaveBeenCalledWith('reset_token:reset-token-abc');
      expect(redis.del).toHaveBeenCalledWith(`login_fail:${mockUser.email}`);

      expect(result.message).toBe('密码重置成功，请使用新密码登录');
    });

    it('令牌无效或已过期：抛 BadRequestException', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow(
        '重置令牌无效或已过期',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('令牌有效但用户已不存在：抛 BadRequestException', async () => {
      redis.get.mockResolvedValue('u-ghost');
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resetPassword(dto)).rejects.toThrow('用户不存在');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
