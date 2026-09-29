/**
 * Auth E2E 测试
 *
 * 通过 supertest 打真实 HTTP，但底层 Prisma / Redis 用内存替身，
 * 不依赖任何外部服务（postgres / redis），可在 CI 环境直接运行。
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { RedisService } from '../src/redis/redis.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/* ------------------- 内存版 Prisma：仅满足 auth 路径需要 ------------------- */

class InMemoryPrisma {
  loan = { findMany: async () => [] };
  private users: any[] = [];
  user = {
    findFirst: async ({ where }: any) => {
      if (!where?.OR) return null;
      return (
        this.users.find((u) =>
          (where.OR as { username?: string; email?: string }[]).some(
            (cond) =>
              (cond.username !== undefined && u.username === cond.username) ||
              (cond.email !== undefined && u.email === cond.email),
          ),
        ) || null
      );
    },
    findUnique: async ({ where }: any) => {
      if (where?.id) return this.users.find((u) => u.id === where.id) || null;
      if (where?.email)
        return this.users.find((u) => u.email === where.email) || null;
      if (where?.username)
        return this.users.find((u) => u.username === where.username) || null;
      return null;
    },
    create: async ({ data }: any) => {
      const u = {
        id: `u-${this.users.length + 1}`,
        avatar: null,
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      this.users.push(u);
      return u;
    },
  };
  reset() {
    this.users = [];
  }
  $connect = async () => undefined;
  $disconnect = async () => undefined;
  onModuleInit = async () => undefined;
  onModuleDestroy = async () => undefined;
}

/* ----------------------------- 内存版 Redis ----------------------------- */

class InMemoryRedis {
  private store = new Map<string, { value: string; expireAt?: number }>();

  private isExpired(key: string) {
    const item = this.store.get(key);
    if (!item) return true;
    if (item.expireAt && item.expireAt < Date.now()) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  async get(key: string) {
    return this.isExpired(key) ? null : this.store.get(key)!.value;
  }
  async set(key: string, value: string, ttl?: number) {
    this.store.set(key, {
      value,
      expireAt: ttl ? Date.now() + ttl * 1000 : undefined,
    });
    return 'OK';
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
  async exists(key: string) {
    return this.isExpired(key) ? 0 : 1;
  }
  async incr(key: string) {
    const cur = this.isExpired(key) ? 0 : parseInt(this.store.get(key)!.value);
    const next = cur + 1;
    this.store.set(key, { value: String(next) });
    return next;
  }
  async expire(key: string, seconds: number) {
    const item = this.store.get(key);
    if (item) item.expireAt = Date.now() + seconds * 1000;
    return 1;
  }
  reset() {
    this.store.clear();
  }
  onModuleInit = async () => undefined;
  onModuleDestroy = async () => undefined;
}

/* --------------------------------- 装配 --------------------------------- */

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: InMemoryPrisma;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    // 与生产 .env 保持一致：纯秒数。auth.service 内部会自动拼 's' 单位
    process.env.JWT_ACCESS_TOKEN_EXPIRES_IN = '900';
    process.env.JWT_REFRESH_TOKEN_EXPIRES_IN = '604800';
    process.env.DATABASE_URL =
      'postgresql://test:test@localhost:5432/test?schema=public';

    prisma = new InMemoryPrisma();
    redis = new InMemoryRedis();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(RedisService)
      .useValue(redis)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector));
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix('api');

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prisma.reset();
    redis.reset();
  });

  /* ============================== register ============================== */

  describe('POST /api/auth/register', () => {
    const valid = {
      username: 'alice',
      email: 'alice@ledger.app',
      password: 'Passw0rd!',
    };

    it('合法参数：注册成功并返回 user + tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(valid)
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.user).toMatchObject({
        username: valid.username,
        email: valid.email,
      });
      expect(res.body.data.user).not.toHaveProperty('password');
      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
    });

    it('用户名不合规 → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...valid, username: 'a' })
        .expect(400);
    });

    it('邮箱格式不合法 → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...valid, email: 'not-an-email' })
        .expect(400);
    });

    it('密码不含大写或数字 → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...valid, password: 'alllowercase' })
        .expect(400);
    });

    it('用户名已存在 → 409', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(valid)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...valid, email: 'other@ledger.app' })
        .expect(409);
      expect(res.body.message).toContain('用户名已存在');
    });

    it('邮箱已存在 → 409', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(valid)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ ...valid, username: 'other_one' })
        .expect(409);
      expect(res.body.message).toContain('邮箱已被注册');
    });
  });

  /* =============================== login =============================== */

  describe('POST /api/auth/login', () => {
    const valid = {
      username: 'alice',
      email: 'alice@ledger.app',
      password: 'Passw0rd!',
    };

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send(valid)
        .expect(201);
    });

    it('凭据正确：登录成功并返回 tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: valid.password })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.user.email).toBe(valid.email);
      expect(res.body.data.accessToken).toBeTruthy();
    });

    it('密码错误：401 + 「邮箱或密码错误」', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: 'WrongPwd123' })
        .expect(401);
      expect(res.body.message).toContain('邮箱或密码错误');
    });

    it('用户不存在：401', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nobody@ledger.app', password: 'Whatever1' })
        .expect(401);
    });

    it('累计 5 次失败 → 第 6 次直接被封禁', async () => {
      const wrong = { email: valid.email, password: 'Wrong1234' };
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send(wrong)
          .expect(401);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send(wrong)
        .expect(401);
      expect(res.body.message).toContain('登录失败次数过多');
    });

    it('登录成功后失败计数被清除', async () => {
      // 累积 2 次失败
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: 'Wrong1234' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: 'Wrong1234' })
        .expect(401);
      // 正确登录
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: valid.password })
        .expect(201);
      // 继续失败但允许（计数已清零）
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: valid.email, password: 'Wrong1234' })
        .expect(401);
      expect(res.body.message).toContain('邮箱或密码错误');
    });
  });

  /* ============================ refresh + logout ============================ */

  describe('POST /api/auth/refresh & /api/auth/logout', () => {
    let refreshToken: string;

    beforeEach(async () => {
      const reg = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: 'bob',
          email: 'bob@ledger.app',
          password: 'Passw0rd!',
        });
      refreshToken = reg.body.data.refreshToken;
    });

    it('合法 refreshToken：返回新 tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      expect(res.body.data.accessToken).toBeTruthy();
      expect(res.body.data.refreshToken).toBeTruthy();
    });

    it('refresh 一次后旧 token 进入黑名单 → 二次刷新失败', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);
      expect(res.body.message).toContain('令牌已失效');
    });

    it('非法 refreshToken → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: 'not.a.real.jwt' })
        .expect(401);
      expect(res.body.message).toContain('刷新令牌无效或已过期');
    });

    it('logout 后该 refreshToken 不能再用', async () => {
      // logout 需要 access token 鉴权
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'bob@ledger.app', password: 'Passw0rd!' })
        .expect(201);
      const accessToken = login.body.data.accessToken;
      const rt = login.body.data.refreshToken;

      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken: rt })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ refreshToken: rt })
        .expect(401);
      expect(res.body.message).toContain('令牌已失效');
    });
  });
});
