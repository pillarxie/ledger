# 把 Ledger 后端部署到飞牛 OS（fnOS）NAS

> **当前状态：已部署完成并验证通过。**
> 前端 app 直接连 `http://10.80.40.160:3002/api` 即可，
> 接口文档 http://10.80.40.160:3002/api/docs 。
> 实际部署记录见 [第 11 节](#11-部署完成记录)。

## 0. 最终架构

```
Flutter App (手机/桌面/Web)
        │  http://10.80.40.160:3002/api
        ▼
   ┌──────────────────────────────────────────────┐
   │ 飞牛 OS NAS  10.80.40.160 (x86_64)            │
   │                                               │
   │  ledger-api (NestJS)  ← 唯一对外端口 3002     │
   │      ├── ledger-postgres  (仅容器内网 5432)   │
   │      └── ledger-redis     (仅容器内网 6379)   │
   │                                               │
   │  /vol2/1000/ledger/data/…  持久化             │
   └──────────────────────────────────────────────┘
```

前端 app 只需要知道一个地址：`http://10.80.40.160:3002/api`。
数据库和 Redis **不对宿主机暴露端口**，只能被 api 容器访问。


---

## 1. 部署前准备

在 NAS 上确认三件事：

```bash
# 1) CPU 架构，决定构建镜像时用哪个 platform
uname -m          # x86_64 → amd64 ；aarch64 → arm64

# 2) Docker 是否可用（没装就在 应用中心 搜 "Docker" 安装）
docker version
docker compose version

# 3) 3000 端口是否被占用（飞牛自带服务一般占用 8000、5666 等）
ss -lntp | grep -E ':(3000|5432|6379)\b'
```

SSH 在 **设置 → 远程访问 → SSH**（或「终端」）里开启。

推荐部署目录：`/vol1/1000/docker/ledger`
（`/vol1` 是存储空间 1；换成你实际的卷名。放在这里的好处是数据在文件管理器里可见、可被 NAS 自带备份工具覆盖。）

```bash
mkdir -p /vol1/1000/docker/ledger
```

### 1.1 镜像加速（国内网络基本必配）

`node:22-alpine`、`postgres:15-alpine`、`redis:7-alpine` 都来自 Docker Hub。
国内直连 `registry-1.docker.io` 基本会超时：

```
Get "https://registry-1.docker.io/v2/library/node/manifests/...":
net/http: timeout awaiting response headers
```

解决方式二选一。

**方式一：给 Docker 配镜像加速（推荐，一次配好长期有效）**

飞牛的「Docker」应用 → 设置 → 镜像仓库 / 加速地址，添加：

```
https://docker.m.daocloud.io
https://dockerproxy.net
https://docker.1ms.run
```

也可以在 NAS 上直接改 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.net",
    "https://docker.1ms.run"
  ]
}
```

改完重启 Docker 服务。

**方式二：手动拉取后重新打标签**

```bash
docker pull docker.m.daocloud.io/library/node:22-alpine
docker tag  docker.m.daocloud.io/library/node:22-alpine node:22-alpine

docker pull docker.m.daocloud.io/library/postgres:15-alpine
docker tag  docker.m.daocloud.io/library/postgres:15-alpine postgres:15-alpine

docker pull docker.m.daocloud.io/library/redis:7-alpine
docker tag  docker.m.daocloud.io/library/redis:7-alpine redis:7-alpine
```

> 上面几个加速地址是社区维护的公共镜像源，随时可能失效或限流。
> 如果都不可用，就在**你的电脑上**构建好镜像再导出（方案 A），
> 这样 NAS 只需要 `docker load`，完全不碰 Docker Hub。
>
> npm 依赖同理：NAS 上构建时如果卡在下载依赖，
> 可在 Dockerfile 的 `pnpm install` 前加一行
> `RUN pnpm config set registry https://registry.npmmirror.com`，
> 或者构建时传 `--build-arg`。

---

## 2. 把代码和镜像放到 NAS 上

### 方案 A（推荐）：电脑上构建镜像，导出后导入 NAS

NAS 上不需要装 Node、pnpm、编译工具，也不用拉 npm 依赖，最省事、最不容易出错。

**在你的 Mac 上：**

```bash
cd /Users/iron/My/Node/ledger_service

# 按 NAS 架构二选一
docker buildx build --platform linux/amd64 -t ledger-service:latest --load .   # x86_64 NAS
docker buildx build --platform linux/arm64 -t ledger-service:latest --load .   # ARM NAS

# 导出（约 300–500 MB）
docker save ledger-service:latest | gzip > ledger-service.tar.gz
```

**传到 NAS：**

```bash
# 镜像
scp ledger-service.tar.gz <用户名>@<NAS-IP>:/vol1/1000/docker/ledger/

# 部署文件（image 已就绪时，这些是运行 compose 和后续维护所需）
rsync -av --exclude node_modules --exclude .git --exclude dist --exclude data \
  ./ <用户名>@<NAS-IP>:/vol1/1000/docker/ledger/
```

**在 NAS 上导入镜像：**

```bash
cd /vol1/1000/docker/ledger
gunzip -c ledger-service.tar.gz | docker load
docker images | grep ledger-service
```

### 方案 B：直接在 NAS 上构建

适合 NAS 是 x86_64 且配置不差的情况。代码用上面的 `rsync` 传过去后：

```bash
cd /vol1/1000/docker/ledger
docker compose -f docker-compose.nas.yml up -d --build
```

首次构建需要拉 node:22-alpine 和依赖，视网络情况 5–20 分钟。

### 方案 C：飞牛 Docker 应用的图形界面

「Docker」应用 → **Compose** → 新建项目，项目路径选 `/vol1/1000/docker/ledger`，
把 `docker-compose.nas.yml` 的内容粘进去，然后启动。
（用这个方式时 `.env` 也要提前放在同目录，构建方式等同方案 B。）

---

## 3. 配置 .env

```bash
cd /vol1/1000/docker/ledger
cp .env.nas.example .env

# 生成一个真正的 JWT 密钥
openssl rand -hex 32
```

编辑 `.env`，**至少改这两项**：

| 变量 | 说明 |
| --- | --- |
| `POSTGRES_PASSWORD` | 数据库密码，自己定一个强密码 |
| `JWT_SECRET` | 上面 `openssl rand -hex 32` 的输出；泄露等于任何人都能伪造登录态 |

再确认几个：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `API_PORT` | `3000` | NAS 上对前端暴露的端口 |
| `DATA_DIR` | `./data` | 数据目录；想放绝对路径就写 `/vol1/1000/docker/ledger/data` |
| `POSTGRES_USER` / `POSTGRES_DB` | `ledger` / `ledger_db` | 一般不用改 |

**先确认端口没被占用**（飞牛上很容易被别的服务先占了）：

```bash
ss -lntp | grep -E ':(3000|3001|3002)\b'
```

以上面这台 NAS（10.80.40.160）为例，实测：

| 端口 | 状态 |
| --- | --- |
| 3000 | **已被占用**（一个带 Basic 认证的 nginx，返回 401） |
| 3001 | 已被占用 |
| 3002 / 8080 / 8081 / 9000 / 18000 | 空闲 |

所以这台机器上要写 `API_PORT=3002`。

**手动创建数据目录**——这一步不能省。Compose 不会替你建好这些子目录，
而 Postgres 对数据目录的属主很敏感：

```bash
mkdir -p data/postgres data/redis data/uploads
chown -R 1000:1000 data
```

> 实测：如果不预先创建，`data/postgres` 会由 Docker 以 root 身份建出来，
> Postgres 会以 `FATAL: data directory "/var/lib/postgresql/data" has wrong ownership`
> 反复重启，进而让 api 卡在 `dependency failed to start`。
>
> （在 macOS 的 Docker Desktop 上，即使预创建了目录，bind mount 的 chown
> 也可能因 VirtioFS 限制不生效，需要改用命名卷。NAS 是原生 Linux，不存在这个问题。）

> 注意：`.env` 已在 `.gitignore` / `.dockerignore` 中，不会被提交，也不会被打进镜像。

---

## 4. 启动

```bash
cd /vol1/1000/docker/ledger

# 方案 A（镜像已导入）
docker compose -f docker-compose.nas.yml up -d --no-build

# 方案 B（在 NAS 上构建）
docker compose -f docker-compose.nas.yml up -d --build

# 看日志
docker compose -f docker-compose.nas.yml logs -f api
```

正常情况下 api 日志里会依次出现：

```
==> 同步数据库结构 (prisma migrate deploy)
==> 数据库结构已是最新
🚀 Application is running on: http://localhost:3000/api
📚 API Documentation: http://localhost:3000/api/docs
```

数据库迁移是**自动**的：api 容器启动时先执行 `prisma migrate deploy`（失败会重试，
`RUN_MIGRATIONS=false` 可关闭），所以你第一次启动不需要手动建表。

---

## 5. 验证

```bash
# 1) 容器状态，三个都应是 Up (healthy)
docker compose -f docker-compose.nas.yml ps

# 2) 本机探活
curl -I http://127.0.0.1:3000/api/docs

# 3) 局域网探活（把 IP 换成 NAS 的，在手机浏览器里也能打开）
curl -I http://10.80.40.160:3002/api/docs

# 4) 表结构是否建好
docker compose -f docker-compose.nas.yml exec postgres \
  psql -U ledger -d ledger_db -c '\dt'
```

浏览器打开 `http://<NAS-IP>:3000/api/docs` 能看到 Swagger 就说明后端已经在 NAS 上跑起来了。

---

## 6. 前端 Flutter 侧要改的地方

### 6.1 接口地址

```dart
// 局域网
const String apiBaseUrl = 'http://10.80.40.160:3002/api';

// 有域名 + HTTPS 时
// const String apiBaseUrl = 'https://ledger.example.com/api';
```

后端所有接口都挂在 `/api` 前缀下，不要漏掉。

### 6.2 头像等静态资源的完整地址

后端返回的头像字段是**相对路径**（`/uploads/avatars/xxx.png`），
Flutter 里要自己拼上站点根地址（注意：不是 `/api`）：

```dart
String fullAvatarUrl(String avatarPath) =>
    'http://10.80.40.160:3002$avatarPath';
```

### 6.3 允许明文 HTTP（仅内网调试需要）

Android 9+ 和 iOS 默认都禁止明文 HTTP，不改的话 app 会直接连不上。

**Android** — `android/app/src/main/AndroidManifest.xml`：

```xml
<application
    android:usesCleartextTraffic="true"
    ... >
```

**iOS** — `ios/Runner/Info.plist`：

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
</dict>
```

> 这两项属于"为了内网调试放宽安全策略"。如果要长期在公网用，
> 正确做法是给它配 HTTPS（见下一节），然后把这些放宽项删掉。

### 6.4 Web 版（Flutter Web）

后端 `main.ts` 里 CORS 是 `origin: true, credentials: true`，会回显任意来源，
所以 Flutter Web 直接访问即可，不用额外改后端。
但反过来也意味着**任何网站都能带着凭证调你的接口**——如果要收紧，
需要把 `origin` 改成白名单（我可以另外帮你改）。

---

## 7. 外网访问

### 7.1 先说结论：飞牛远程访问不能直接接第三方 app

飞牛 fnOS 提供 4 种远程访问方式，但**都不能**把你的 Flutter app 直接接到本项目的 API 上：

| 飞牛的方式 | 能否给 Flutter app 用 | 原因 |
| --- | --- | --- |
| 方法1 公网 IP 直连 | ❌ 本机不具备条件 | 需要运营商给公网 IP + 路由器端口转发；本机出口是移动 `221.130.52.226`，NAS 自己在 `10.80.40.0/22` 私网内，**没有公网 IPv6**，入向端口映射基本不可行 |
| 方法2 DDNS 域名 + 证书 | ❌ 同上 | 依赖公网 IP 才能被外部解析到，前置条件不满足 |
| 方法3 FN Connect | ❌ 设计上不支持 | 见下 |
| 方法4 客户端 P2P | ❌ 只服务飞牛官方 App | 必须用飞牛 App 才能建立 P2P，第三方客户端接不进去 |

### 7.2 为什么 FN Connect 不行

实测你这台 NAS（`/usr/trim/etc/network_cert_all.conf`）：

```
fn_id   = meetsnow
域名     = 5ddd.com
证书     = *.meetsnow.5ddd.com   ← 已签发但 "used": false
```

访问 `https://meetsnow.5ddd.com` 会 **302 跳到 `https://5ddd.com/meetsnow`**，
落到一个 FN Connect 登录门户页，也就是说转发前要过飞牛账号的浏览器登录态。

更关键的是它的路由方式。飞牛的应用是走**统一网关**对外暴露的：

- 统一网关监听 `5666`(http) / `5667`(https)，配置在 `/usr/trim/nginx/conf/nginx.conf`
- 应用的公网路径固定是 `/app/{应用名}`，例如当前这台机器上注册了
  `/app/text-editor`、`/app/trim-openclaw`
- 服务本身要监听安装目录里的 **Unix Socket**，由应用包 manifest 里的
  `gatewayPrefix` / `gatewaySocket` 决定路由

这几个路由是 `.fpk` 应用包**安装时**生成到 nginx 里的。
我们用 `docker compose` 手工部署的项目没有任何注册入口，
所以统一网关和 FN Connect 都不会认得它。另外官方文档明确写了
**FN Connect 中继转发有限速**，本来也不适合当 API 通道。

> 想让 ledger 走统一网关，只能把它重做成 `.fpk` 应用包（manifest + 生命周期脚本 +
> 监听 Unix Socket + 复用 fnOS 登录态）。工作量不小，而且 API 会被绑死在飞牛的会话体系上，
> 对手机 App 来说是很差的选择。

### 7.3 推荐方案

| 方案 | 适用场景 | 特点 |
| --- | --- | --- |
| **Tailscale**（最省事） | 自己和家人用 | NAS 和手机加入同一虚拟局域网，app 直接连 `http://100.x.x.x:3002`。不用公网 IP、不用买域名、不用证书，穿透 CGNAT |
| **Cloudflare Tunnel**（最通用） | 要给别人用 / 想要正式域名 | NAS 主动向 Cloudflare 建出向隧道，得到 `https://ledger.你的域名.com`，真 HTTPS 证书，无需公网 IP。需要一个域名（约 ¥50/年） |
| **frp / 花生壳** | 有公网 VPS 时 | 常规内网穿透，需要自备服务器 |

**Tailscale 步骤**（NAS 上，SSH 执行）：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# 手机装 Tailscale 并登录同一账号，然后 app 指向：
#   http://100.x.y.z:3002/api      （100.x.y.z 是 NAS 的 Tailscale IP）
```

**Cloudflare Tunnel 步骤**（NAS 上，需要先有域名并托管到 Cloudflare）：

```bash
# 用 docker 跑 tunnel，加到 docker-compose.nas.yml 里
#   cloudflared:
#     image: cloudflare/cloudflared:latest
#     restart: unless-stopped
#     command: tunnel --no-autoupdate run --token <你的隧道Token>
#     network_mode: host
# 在 Cloudflare Zero Trust 面板里把 公共主机名 ledger.你的域名.com
# 指向服务 http://127.0.0.1:3002
```

之后前端地址写 `https://ledger.你的域名.com/api`，因为是正经 HTTPS，
Android 的 `usesCleartextTraffic` 和 iOS 的 ATS 例外都可以去掉。

### 7.4 如果以后真要自建反代

同机加一个 Caddy 容器：

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./data/caddy:/data
```

`Caddyfile`：

```
ledger.example.com {
    reverse_proxy api:3000
}
```

Caddy 会自动申请并续期证书。注意这仍然需要外部流量能到达这台机器的 80/443，
所以只有在拿到公网 IP、或者前面套了 Cloudflare Tunnel 的前提下才有意义。

---

## 8. 备份与升级

### 备份

```bash
cd /vol1/1000/docker/ledger

# 数据库
docker compose -f docker-compose.nas.yml exec -T postgres \
  pg_dump -U ledger ledger_db | gzip > backup-$(date +%F).sql.gz

# 头像等上传文件
tar czf uploads-$(date +%F).tar.gz data/uploads
```

建议把这两条加进飞牛的定时任务，并让 NAS 的备份工具覆盖 `data/` 目录。

### 升级后端

```bash
# 1) 电脑上重新构建并导出（方案 A）
docker buildx build --platform linux/amd64 -t ledger-service:latest --load .
docker save ledger-service:latest | gzip > ledger-service.tar.gz
scp ledger-service.tar.gz <用户名>@<NAS-IP>:/vol1/1000/docker/ledger/

# 2) NAS 上
cd /vol1/1000/docker/ledger
gunzip -c ledger-service.tar.gz | docker load
docker compose -f docker-compose.nas.yml up -d --no-build
```

api 容器重启时会自动把数据库迁移到新版本。

---

## 9. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `/bin/sh: can't open '/usr/local/bin/docker-entrypoint.sh': Permission denied` | 脚本权限是 `711`：非 root 的 `node` 用户有执行位但没有**读**位，`sh` 无法读取脚本内容。Dockerfile 里已显式 `chmod 755` |
| `npm ci ... package.json and package-lock.json are not in sync` | 仓库里 `package-lock.json` 已过期（缺 `@prisma/adapter-pg`、`pg`、`multer`）。Dockerfile 已改为使用 `pnpm-lock.yaml`，如果你看到这个错误说明用的是旧 Dockerfile |
| `Get "https://registry-1.docker.io/v2/...": net/http: timeout awaiting response headers` | Docker Hub 不可达，配置镜像加速，见 1.1 |
| `FATAL: data directory "/var/lib/postgresql/data" has wrong ownership` | 没预创建 `data/postgres`，见第 3 节 |
| 构建后运行报 `Cannot find module '../build/Release/bcrypt_lib.node'` 之类 | 构建时把开发机的 `node_modules` 拷进了镜像。`.dockerignore` 就是防这个的，确认它存在 |
| api 启动反复重试迁移后退出 | 看 `docker compose logs postgres`；多半是 `data/postgres` 权限或 `POSTGRES_PASSWORD` 与已有数据卷不匹配（改过密码但卷里还是旧密码） |
| 头像上传报 500 | `data/uploads` 不可写：`chown -R 1000:1000 data/uploads` |
| 手机能开 `http://NAS-IP:3000/api/docs`，但 app 连不上 | Android/iOS 的明文 HTTP 限制，见 6.3 |
| 局域网打不开 `/api/docs` | 检查 NAS 防火墙是否放行 3000；`docker compose ps` 看端口映射；换个端口试 `API_PORT=3001` |
| 登录成功但很快 401 | Redis 掉了（refresh token 黑名单/会话校验依赖 Redis），`docker compose logs redis` |
| `git clone` 部署后数据库没有任何表 | `prisma/migrations` 曾被 `.gitignore` 忽略（已修正）。确认迁移目录已提交 |

---

## 10. 安全清单（公网暴露前必做）

- [ ] `.env` 里的 `JWT_SECRET` 已改成 `openssl rand -hex 32` 的随机值
- [ ] `POSTGRES_PASSWORD` 不是默认值
- [ ] Postgres / Redis 端口没有映射到宿主机（本 compose 已保证）
- [ ] 前面挂了 HTTPS 反向代理，而不是裸奔 3000 端口
- [ ] 定期备份 `data/postgres` 与 `data/uploads`
- [ ] 可选：生产环境关闭 Swagger（`http://<NAS-IP>:3000/api/docs` 会暴露全部接口定义）

---

## 11. 部署完成记录

### 11.1 当前线上的实际配置

服务**已经部署并跑在 NAS 上**，实测可用：

| 项目 | 值 |
| --- | --- |
| API 地址（前端 app 用这个） | `http://10.80.40.160:3002/api` |
| Swagger 文档 | http://10.80.40.160:3002/api/docs |
| NAS | `snow` / Debian 12 (飞牛 OS)，内核 6.12.18-trim，**x86_64** |
| 部署目录 | `/vol2/1000/ledger` |
| 数据目录 | `/vol2/1000/ledger/data`（Postgres / Redis / 上传文件） |
| Compose 项目名 | `ledger`（`docker compose ls` 可见） |
| 镜像 | `ledger-service:latest`（amd64，由 arm64 的 Mac 交叉构建后导入） |
| 端口 | `3002`（该机 3000/3001 已被 `chromium` 容器占用） |
| 演示账号 | `demo@ledger.app / Password123!` |

> 数据放在 `/vol2` 而不是 `/vol1`：这台机器 `/vol1` 只有 48G 且已用 89%，
> 而 `/vol2` 有 466G / 空闲 291G。

### 11.2 验证结果

以下全部是实机跑通并核对过的输出：

| 验证项 | 结果 |
| --- | --- |
| 容器状态 | `ledger-api` `Up (healthy)` `0.0.0.0:3002->3000/tcp`；`ledger-postgres`、`ledger-redis` 均 healthy 且**无宿主机端口映射** |
| 数据库自动迁移 | 容器日志：`Applying migration 20250325000000_init` → `All migrations have been successfully applied.` |
| Redis | 日志：`[RedisService] Redis connected at redis:6379` |
| 表结构 | 9 张表：`users` `accounts` `transactions` `categories` `budgets` `families` `family_members` `sync_logs` `_prisma_migrations` |
| 种子数据 | 演示账号 `demo@ledger.app / Password123!`，默认分类 12 个 |
| 跨机访问 | 从另一台机器（`10.80.47.185`）请求 `http://10.80.40.160:3002/api/docs` → 200 |
| 登录 | 远程 `POST /api/auth/login` → `code:0` + accessToken |
| 鉴权接口 | 带 token 请求 `/api/categories` → 12 条分类（餐饮/交通/购物…） |
| 错误密码 | → `{"code":1002,"message":"邮箱或密码错误"}` |
| 未授权访问 | 无 token 请求 `/api/transactions` → `{"code":1002,"message":"未授权访问"}` |
| 重启自愈 | 三个服务均为 `restart: unless-stopped`，NAS 重启后会自动拉起 |

### 11.3 在 NAS 上执行 docker 命令要带 sudo

`snow` 用户在 `Administrators` 组里，但**不在 `docker` 组**，
所以直接跑 `docker ps` 会报 `permission denied ... /var/run/docker.sock`。

日常运维统一这样写：

```bash
# 看状态
echo '<密码>' | sudo -S docker compose -f /vol2/1000/ledger/docker-compose.nas.yml ps

# 看日志
echo '<密码>' | sudo -S docker logs -f ledger-api

# 重启 / 停止 / 启动
echo '<密码>' | sudo -S docker compose -f /vol2/1000/ledger/docker-compose.nas.yml restart
echo '<密码>' | sudo -S docker compose -f /vol2/1000/ledger/docker-compose.nas.yml down
echo '<密码>' | sudo -S docker compose -f /vol2/1000/ledger/docker-compose.nas.yml up -d --no-build
```

想省掉密码，可以把用户加进 docker 组（需重新登录生效，注意这等于给了该用户 root 级权限）：

```bash
echo '<密码>' | sudo -S usermod -aG docker snow
```

### 11.4 打包镜像时踩到的坑

从 arm64 的 Mac 构建 NAS 用的 amd64 镜像时，Docker Hub 直连超时，
需要先从镜像源拉取基础镜像再打上原本的标签：

```bash
docker pull --platform linux/amd64 docker.m.daocloud.io/library/node:22-alpine
docker tag docker.m.daocloud.io/library/node:22-alpine node:22-alpine
docker buildx build --platform linux/amd64 -t ledger-service:amd64 --load .
docker save ledger-service:amd64 | gzip > ledger-service-amd64.tar.gz
```

在 NAS 上导入时注意 **`sudo -S` 会吃掉标准输入**，
下面这种写法是错的（tar 流会被 `echo` 截断，报
`open /vol1/docker/tmp/docker-import-xxx/repositories: no such file or directory`）：

```bash
# ❌ 错误
gunzip -c img.tar.gz | echo '密码' | sudo -S docker load

# ✅ 正确：把管道放进提权后的 shell 里
echo '密码' | sudo -S sh -c 'gunzip -c /vol2/1000/ledger/ledger-service-amd64.tar.gz | docker load'
```

镜像导入后 `ledger-service-amd64.tar.gz`（327M）还留在 `/vol2/1000/ledger/`，
确认服务正常后可以删掉。

