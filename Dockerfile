#
# Ledger Service 生产镜像
# - 使用 pnpm 安装依赖：仓库里真正同步的是 pnpm-lock.yaml，
#   package-lock.json 已过期，npm ci 会直接报错退出。
# - 多阶段构建，最终镜像只保留运行所需内容，并以非 root 用户运行。
#

# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder

# Prisma 的 schema engine 在 alpine(musl) 上需要 openssl
RUN apk add --no-cache openssl

# 与开发机保持一致的 pnpm 主版本，避免 lockfile 兼容问题
RUN npm i -g pnpm@11.17.0

WORKDIR /app

# 先只拷贝依赖清单，最大化利用 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 再拷贝源码
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json nest-cli.json ./
COPY src ./src

# prisma generate 不建立数据库连接，这里只是给配置一个占位值
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
RUN pnpm exec prisma generate \
 && pnpm run build

# ---------- 运行阶段 ----------
FROM node:22-alpine AS production

RUN apk add --no-cache openssl \
 && npm i -g pnpm@11.17.0

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# 运行时依赖：保留 devDependencies，
# 因为容器启动时要执行 `prisma migrate deploy`（prisma CLI 属于 devDependencies）。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile \
 && pnpm store prune

COPY --from=builder /app/dist ./dist
COPY prisma ./prisma
# prisma.config.ts + tsconfig(.seed).json 让容器内可以执行
#   pnpm exec prisma db seed   （初始化演示账号与默认分类）
COPY prisma.config.ts tsconfig.json tsconfig.seed.json ./

# 只为 generate 提供占位值，用行内环境变量而不是 ENV，
# 避免这个假地址被固化进最终镜像
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public" \
      pnpm exec prisma generate

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# 必须显式 755：容器以非 root 的 node 用户运行，
# 脚本需要「可读」才能被 sh 解释执行（711 会报 Permission denied）
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/uploads/avatars \
 && chown -R node:node /app

USER node

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
