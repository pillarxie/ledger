# Auth 测试

## 测试分层

| 类型 | 位置 | 依赖 | 命令 |
|------|------|------|------|
| 单元测试 | `src/modules/auth/*.spec.ts` | 全部 mock | `npm test` |
| E2E 测试 | `test/auth.e2e-spec.ts` | 内存替身 Prisma/Redis | `npm run test:e2e` |
| 覆盖率 | — | — | `npm run test:cov` |

> 单元 + E2E 均**不依赖** Postgres / Redis，CI 环境直接可跑。

## 单元测试覆盖

### `auth.service.spec.ts`（13 case）

**register**
- 成功创建用户、密码经 bcrypt 加密、响应剥离 password
- 用户名已存在 → `ConflictException('用户名已存在')`
- 邮箱已注册 → `ConflictException('邮箱已被注册')`

**login**
- 凭据正确 → 返回 tokens 并清除失败计数
- 用户不存在 → 累加失败次数 + `UnauthorizedException`
- 密码错误 → 累加失败次数 + `UnauthorizedException`
- 首次失败时设置 15 分钟过期
- 累计 ≥ 5 次失败 → 直接拒绝，不再查库

**refreshToken**
- 合法 token → 旧 token 进入黑名单，签发新 tokens
- `verify` 抛异常 → `UnauthorizedException('刷新令牌无效或已过期')`
- token 在黑名单 → `UnauthorizedException('令牌已失效')`
- 用户已被删除 → `UnauthorizedException('用户不存在')`

**logout**
- 传入 refreshToken 时加入黑名单
- 空 refreshToken 时不调用 redis

### `auth.controller.spec.ts`（5 case）

测试 Controller 将 DTO 透传给 Service：register / login / logout / refreshToken / getCurrentUser

## E2E 覆盖（15 case）

通过 supertest 走真实 HTTP（含全局管道、过滤器、拦截器、JwtAuthGuard），底层只把 PrismaService / RedisService 替换为内存实现。

**POST /api/auth/register**
- 合法参数 → 201，返回 user + tokens
- username/email/password 不合规 → 400（管道校验）
- 用户名或邮箱已存在 → 409

**POST /api/auth/login**
- 凭据正确 → 201
- 密码错误 / 用户不存在 → 401
- 累计 5 次失败 → 第 6 次返回"登录失败次数过多"
- 登录成功后失败计数被清零

**POST /api/auth/refresh & /api/auth/logout**
- 合法 refreshToken → 返回新 tokens
- 使用过一次的 refreshToken 再次刷新 → 401（黑名单）
- 非法 refreshToken → 401
- logout 后该 refreshToken 不能再用

## 与真实 DB 跑集成测试

如果要 e2e 跑真实数据库，把内存替身换成真实 PrismaService 即可。推荐做法：

```bash
# 1. 起独立测试 postgres
docker run -d --name pg-test -p 5433:5432 \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=ledger_test \
  postgres:15-alpine

# 2. 设置测试 DATABASE_URL 并 migrate
DATABASE_URL='postgresql://test:test@localhost:5433/ledger_test?schema=public' \
  npx prisma migrate deploy

# 3. 移除 e2e 测试中 .overrideProvider(PrismaService)，跑：
DATABASE_URL='...' npm run test:e2e
```

## 常见坑

- tsconfig 必须有 `"types": ["jest", "node"]` 才能识别全局 `describe / it / expect`
- ~~`JWT_ACCESS_TOKEN_EXPIRES_IN` 必须带单位~~ —— 已在 `auth.service.ts` 内修复，env 存"纯秒数"，代码消费时自动拼 `'s'` 单位
