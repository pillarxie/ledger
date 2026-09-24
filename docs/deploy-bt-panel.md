# 部署到宝塔面板服务器（公网）

> 本文对应「整套搬到公网服务器、NAS 那套停掉」的方案。
> 全程在宝塔面板 + 一个终端里完成，不需要改代码。

## 0. 目标架构

```
Flutter App
   │  https://ledger.你的域名.com/api
   ▼
宝塔 nginx (80 / 443, Let's Encrypt 证书)
   │  反向代理
   ▼
127.0.0.1:3002          ← 只监听回环地址，公网直接打不到
   ▼
ledger-api 容器
   ├── ledger-postgres 容器   （仅容器内网 5432）
   └── ledger-redis 容器      （仅容器内网 6379）
```

对外只有一个入口：宝塔的 nginx。数据库、Redis、后端端口都不暴露。

---

## 0.1 最快路径：两条命令 + 三次点击

已经在服务器上装好 Docker 的话，部署本身只有两条命令。

**① 你的 Mac 上，传代码：**

```bash
cd /Users/iron/My/Node/ledger_service
tar czf - --exclude node_modules --exclude .git --exclude dist \
  --exclude data --exclude .env . \
  | ssh root@你的服务器IP 'mkdir -p /www/wwwroot/ledger && tar xzf - -C /www/wwwroot/ledger'
```

**② 服务器上，一键部署：**

```bash
cd /www/wwwroot/ledger && bash deploy.sh
```

`deploy.sh` 会自动完成：检查 Docker → 从模板生成 `.env` 并填入随机的
数据库密码和 JWT 密钥 → 创建数据目录 → 构建启动 → 等待健康检查通过 →
打印后续步骤。可以重复执行，不会覆盖已有的 `.env`。

**③ 宝塔面板里接上域名（三次点击）：**

1. **网站 → 添加站点**，域名填你的（不创建数据库和 FTP）
2. 进入该站点 → **反向代理 → 添加反向代理**
   - 目标 URL：`http://127.0.0.1:3002`
   - 发送域名：`$host`
3. 该站点 → **SSL → Let's Encrypt** 申请证书，然后打开 **强制 HTTPS**

前端就能填 `https://你的域名/api` 了。

> 下面第 1～13 节是手动操作的完整版，并且补充了防火墙、数据迁移、
> 备份、故障排查等内容。**只想跑起来的话，上面的 0.1 就够了。**

---

## 1. 先确认服务器环境

宝塔面板 → **终端**（或本地 `ssh` 登录），执行：

```bash
uname -m                    # x86_64 最常见；aarch64 才是 ARM
docker version
docker compose version
free -h
df -h /
```

- `docker` 命令不存在 → 宝塔面板左侧找 **Docker**（部分版本在「软件商店」搜 **Docker管理器**）安装。
- 内存建议 ≥ 1G。构建镜像比较吃内存，1G 以下容易 OOM；实在太小就按第 9 节在别处构建好再导入。

---

## 2. 把代码放上去

**在你的 Mac 上**打包（排除依赖和本地数据）：

```bash
cd /Users/iron/My/Node/ledger_service
tar czf ~/Desktop/ledger-deploy.tar.gz \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude data --exclude .env --exclude '.pnpm-store' \
  --exclude '.DS_Store' .
```

然后宝塔面板 → **文件** → 进入 `/www/wwwroot` → 新建目录 `ledger`
→ 上传 `ledger-deploy.tar.gz` → 右键 **解压**。

解压后确认 `/www/wwwroot/ledger` 下有这些：

```
Dockerfile              docker-compose.server.yml   docker-entrypoint.sh
.dockerignore           package.json                pnpm-lock.yaml
pnpm-workspace.yaml     prisma.config.ts            nest-cli.json
tsconfig.json           tsconfig.seed.json
prisma/                 src/
```

> `docker-compose.nas.yml` 是 NAS 版，服务器上不用它。
> 两个文件的差别：服务器版把 API 端口绑在 `127.0.0.1`，并默认关闭接口文档。

---

## 3. 配置镜像加速（国内服务器基本必做）

宝塔 → **Docker** → 设置 → **镜像加速**，填入：

```
https://docker.m.daocloud.io
https://dockerproxy.net
https://docker.1ms.run
```

没有这个菜单就改 `/etc/docker/daemon.json`：

```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.net",
    "https://docker.1ms.run"
  ]
}
```

然后 `systemctl restart docker`。

不配的话构建会卡在拉基础镜像，报：

```
Get "https://registry-1.docker.io/v2/library/node/22-alpine/manifests/...":
net/http: timeout awaiting response headers
```

---

## 4. 写 .env

> 用 `deploy.sh` 的话这步会自动完成（生成随机密钥），下面是想手动控制时看的。

宝塔 → **文件** → 进入 `/www/wwwroot/ledger` → 新建文件 `.env`：

```ini
POSTGRES_USER=ledger
POSTGRES_DB=ledger_db
POSTGRES_PASSWORD=换成你自己的强密码
JWT_SECRET=换成 openssl rand -hex 32 的输出

API_PORT=3002
DATA_DIR=./data

JWT_ACCESS_TOKEN_EXPIRES_IN=900
JWT_REFRESH_TOKEN_EXPIRES_IN=604800
INVITE_CODE_LENGTH=6
INVITE_CODE_EXPIRES_DAYS=7

RUN_MIGRATIONS=true
SWAGGER_ENABLED=false
```

在终端生成密钥：

```bash
openssl rand -hex 32
```

> **公网服务器上 `JWT_SECRET` 和 `POSTGRES_PASSWORD` 必须改掉。**
> `JWT_SECRET` 泄露等于任何人都能伪造登录态。
>
> `SWAGGER_ENABLED=false` 会关掉 `/api/docs`，避免把全部接口定义暴露到公网。
> 调试时临时改成 `true` 重启即可。

接着建数据目录 —— **这一步不能省**：

```bash
cd /www/wwwroot/ledger
mkdir -p data/postgres data/redis data/uploads
```

不建的话 Postgres 会以 `FATAL: data directory "/var/lib/postgresql/data" has wrong ownership`
反复重启，api 会卡在 `dependency failed to start`。

---

## 5. 启动

宝塔 → **终端**：

```bash
cd /www/wwwroot/ledger

docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f api
```

首次构建要拉镜像 + 装依赖，5～20 分钟。日志出现下面这些就是正常的：

```
==> 同步数据库结构 (prisma migrate deploy)
Applying migration `20250325000000_init`
All migrations have been successfully applied.
🚀 Application is running on: http://localhost:3000/api
[RedisService] Redis connected at redis:6379
```

数据库迁移是自动的，第一次启动不需要手动建表。

验证（因为只监听回环，必须在服务器本机 curl）：

```bash
curl -s http://127.0.0.1:3002/api/health
# {"code":0,"message":"success","data":{"status":"ok","uptime":12,...}}
```

`docker compose ps` 里 `ledger-api` 应该是 `Up (healthy)`。

---

## 6. 宝塔反向代理 + HTTPS

### 6.1 解析域名

先在域名 DNS 服务商把 A 记录指向这台服务器的公网 IP。

### 6.2 添加站点

宝塔 → **网站** → **添加站点**：

- 域名：`ledger.你的域名.com`
- 数据库：不创建
- PHP 版本：纯静态

### 6.3 配反向代理

进入该站点 → **反向代理** → **添加反向代理**：

| 字段 | 值 |
| --- | --- |
| 代理名称 | `ledger` |
| 目标 URL | `http://127.0.0.1:3002` |
| 发送域名 | `$host` |

### 6.4 调大上传限制

编辑这个反向代理的配置文件，确认 `client_max_body_size` 不小于 `10m`
（头像上传限 5MB，nginx 默认 1m 会返回 413）：

```nginx
client_max_body_size 10m;
```

### 6.5 上 HTTPS

站点 → **SSL** → **Let's Encrypt** → 申请证书 → 打开 **强制 HTTPS**。

### 6.6 验证

```bash
curl -s https://ledger.你的域名.com/api/health
```

浏览器直接打开 `https://ledger.你的域名.com/api/health` 能看到 JSON 就成了。

> 后端所有业务接口都在 `/api` 前缀下，头像静态文件在 `/uploads/` 下。
> 整站反代即可，不需要为它们单独配 location。

---

## 7. 防火墙 / 安全组

**两处都要配**：云厂商控制台的**安全组** + 宝塔面板的**安全**。

| 端口 | 是否放行 | 说明 |
| --- | --- | --- |
| 80 / 443 | ✅ 必须 | 宝塔 nginx |
| 22 | ✅ 建议限来源 IP | SSH |
| 宝塔面板端口 | ✅ 建议限来源 IP | 面板 |
| 3002 | ❌ 不要 | 只绑 127.0.0.1，公网本来也访问不到 |
| 5432 / 6379 | ❌ 不要 | 只在容器内网 |

---

## 8. 迁移 NAS 上的数据（可选）

如果 NAS 上已经录了账，想搬到服务器。

**在 NAS 上导出：**

```bash
cd /vol2/1000/ledger
docker compose -f docker-compose.nas.yml exec -T postgres \
  pg_dump -U ledger ledger_db | gzip > /tmp/ledger-dump.sql.gz

# 上传头像文件
tar czf /tmp/ledger-uploads.tar.gz -C /vol2/1000/ledger/data uploads
```

把这两个文件下载到本地，再上传到服务器的 `/www/wwwroot/ledger/`。

**在服务器上导入：**

```bash
cd /www/wwwroot/ledger

# 先只起数据库
docker compose -f docker-compose.server.yml up -d postgres redis

# 导入表结构和数据
gunzip -c ledger-dump.sql.gz | \
  docker compose -f docker-compose.server.yml exec -T postgres psql -U ledger -d ledger_db

# 解开头像文件到 data/ 下
tar xzf ledger-uploads.tar.gz -C data/

# 再起 api
docker compose -f docker-compose.server.yml up -d
```

---

## 9. 服务器构建不动时的备选：导入现成镜像

如果服务器内存小、或者拉不动 Docker Hub，可以在**你的 Mac 上**构建好（注意服务器是
x86_64 就构建 amd64）：

```bash
cd /Users/iron/My/Node/ledger_service

docker pull --platform linux/amd64 docker.m.daocloud.io/library/node:22-alpine
docker tag  docker.m.daocloud.io/library/node:22-alpine node:22-alpine

docker buildx build --platform linux/amd64 -t ledger-service:latest --load .
docker save ledger-service:latest | gzip > ledger-service-amd64.tar.gz
```

把 `ledger-service-amd64.tar.gz` 上传到服务器，然后：

```bash
cd /www/wwwroot/ledger
gunzip -c ledger-service-amd64.tar.gz | docker load
docker compose -f docker-compose.server.yml up -d --no-build
```

> 注意：改了 `src/` 里的代码之后必须重新构建镜像，
> `--no-build` 不会自动帮你重新编译。

---

## 10. 停掉 NAS 上那套

**等服务器版确认完全正常之后再停。**

```bash
cd /vol2/1000/ledger
sudo docker compose -f docker-compose.nas.yml down
```

`down` 只删容器和网络，**不会删数据**（数据在 `data/` 目录里）。
不要顺手加 `-v`，那会连 Postgres/Redis 的数据一起清掉。

---

## 11. 前端改地址

```dart
const String apiBaseUrl = 'https://ledger.你的域名.com/api';

// 头像返回的是相对路径 /uploads/avatars/xxx.png，要拼上站点根地址（注意不是 /api）
String fullAvatarUrl(String p) => 'https://ledger.你的域名.com$p';
```

因为是正经 HTTPS，可以**删掉**之前为内网调试加的宽松配置：

- Android `AndroidManifest.xml` 里的 `android:usesCleartextTraffic="true"`
- iOS `Info.plist` 里的 `NSAppTransportSecurity` / `NSAllowsArbitraryLoads`

---

## 12. 日常运维

```bash
cd /www/wwwroot/ledger
alias lc='docker compose -f docker-compose.server.yml'

lc ps                     # 状态
lc logs -f api            # 实时日志
lc restart api            # 重启后端
lc down && lc up -d --no-build   # 完全重启

# 备份数据库
lc exec -T postgres pg_dump -U ledger ledger_db | gzip > backup-$(date +%F).sql.gz

# 备份上传文件
tar czf uploads-$(date +%F).tar.gz  -C data uploads
```

服务都是 `restart: unless-stopped`，服务器重启后会自动拉起。

建议把上面两条备份命令加到宝塔的**计划任务**里，每周跑一次。

### 更新代码后重新发布

```bash
cd /www/wwwroot/ledger
# 上传新代码覆盖 src/ 等文件后：
docker compose -f docker-compose.server.yml up -d --build
```

api 容器重启时会自动执行数据库迁移。

---

## 13. 常见问题

| 现象 | 处理 |
| --- | --- |
| `curl 127.0.0.1:3002` 通，但域名打不开 | 查安全组/宝塔防火墙是否放行 80、443；查 DNS 是否已生效（`dig ledger.你的域名.com`） |
| 反向代理报 502 | api 容器没起来：`lc logs api`；或代理目标写成了 `https://`（应当是 `http://127.0.0.1:3002`） |
| 上传头像返回 413 | nginx `client_max_body_size` 太小，见 6.4 |
| 构建卡在拉 `node:22-alpine` | 没配镜像加速，见第 3 节 |
| `FATAL: data directory ... has wrong ownership` | 没先 `mkdir -p data/postgres`，见第 4 节 |
| 登录成功但很快 401 | Redis 掉了，`lc logs redis` |
| 想临时看接口文档 | `.env` 里 `SWAGGER_ENABLED=true` → `lc up -d` → 访问 `/api/docs`，看完改回 `false` |
| 服务器被扫描/爆破 | 宝塔 → 安全 → 开 SSH 防爆破；面板端口别用默认的 8888；`POSTGRES_PASSWORD` 保持强密码 |
