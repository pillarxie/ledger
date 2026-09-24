#!/usr/bin/env bash
#
# 服务器一键部署脚本
#
#   cd /www/wwwroot/ledger && bash deploy.sh
#
# 做四件事，可重复执行：
#   1. 检查 Docker 环境
#   2. 没有 .env 就生成一个，并自动填入随机的数据库密码和 JWT 密钥
#   3. 创建数据目录（Postgres 对目录属主敏感，这步不能省）
#   4. 构建并启动，然后等待健康检查通过
#
# 不会覆盖已存在的 .env，所以重复执行是安全的。

set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="docker-compose.server.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "!! 当前目录找不到 $COMPOSE_FILE，请确认在项目根目录执行" >&2
  exit 1
fi

# ---------- 1. 检查 Docker ----------

echo "==> 检查 Docker"
if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
!! 没有安装 Docker。两种装法：
   1) 宝塔面板左侧 → Docker → 安装
   2) 或者执行：curl -fsSL https://get.docker.com | sh
EOF
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "!! docker compose 插件不可用，请升级 Docker 或单独安装 compose 插件" >&2
  exit 1
fi

if ! docker ps >/dev/null 2>&1; then
  echo "!! 当前用户没有访问 Docker 的权限。请用 root 执行，或者在命令前加 sudo：" >&2
  echo "   sudo bash deploy.sh" >&2
  exit 1
fi

echo "    Docker $(docker version --format '{{.Server.Version}}') / $(docker compose version --short)"

# ---------- 2. 准备 .env ----------

echo "==> 准备 .env"
if [ -f .env ]; then
  echo "    .env 已存在，保持不变（不会覆盖你的密钥）"
else
  if [ ! -f .env.server.example ]; then
    echo "!! 找不到 .env.server.example，无法生成配置" >&2
    exit 1
  fi

  # openssl 不一定有，没有就退回 /dev/urandom
  gen_hex() {
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex "$1"
    else
      head -c "$(( $1 * 2 ))" /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
  }

  db_pw="$(gen_hex 16)"
  jwt_secret="$(gen_hex 32)"

  # 这里用 awk 而不是 sed -i：GNU sed 和 macOS/BSD sed 的 -i 参数不兼容，
  # awk 两边都能跑，脚本在本地也能测
  awk -v pw="$db_pw" -v jwt="$jwt_secret" '
    { gsub(/CHANGE_ME_db_password/, pw); gsub(/CHANGE_ME_openssl_rand_hex_32/, jwt); print }
  ' .env.server.example > .env

  echo "    已生成 .env，并写入随机的 POSTGRES_PASSWORD 和 JWT_SECRET"
fi

# 读取端口，用于后面的健康检查
API_PORT="$(grep -E '^API_PORT=' .env | head -1 | cut -d= -f2 | tr -d '[:space:]')"
API_PORT="${API_PORT:-3002}"

# 确认占位符都换掉了（只看非注释行，注释里出现 CHANGE_ME 是正常的）
if grep -nE '^[^#]*CHANGE_ME' .env >/dev/null; then
  echo "!! .env 里还有没替换的 CHANGE_ME，请手动改掉：" >&2
  grep -nE '^[^#]*CHANGE_ME' .env >&2
  exit 1
fi

# ---------- 3. 创建数据目录 ----------

echo "==> 创建数据目录"
mkdir -p data/postgres data/redis data/uploads
echo "    data/{postgres,redis,uploads}"

# ---------- 4. 构建并启动 ----------

echo "==> 构建并启动（首次构建较慢，请耐心等待）"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "==> 等待服务就绪"
ready=false
for i in $(seq 1 90); do
  if curl -fsS --max-time 3 "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done

echo
docker compose -f "$COMPOSE_FILE" ps

if [ "$ready" != true ]; then
  echo "!! 等待超时，下面是现场信息" >&2
  echo >&2
  echo "---- 容器状态 ----" >&2
  docker compose -f "$COMPOSE_FILE" ps >&2 || true
  echo >&2
  echo "---- postgres 日志（尾部）----" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=40 postgres >&2 || true
  echo >&2
  echo "---- api 日志（尾部）----" >&2
  docker compose -f "$COMPOSE_FILE" logs --tail=40 api >&2 || true
  echo >&2

  pg_log="$(docker compose -f "$COMPOSE_FILE" logs postgres 2>/dev/null || true)"

  # 识别「Postgres 半初始化」：initdb 成功了，但建库那一步失败，
  # 于是数据目录非空、再启动时被跳过初始化，数据库永远建不出来。
  # 首次部署时如果被打断（断电、Ctrl+C、磁盘满、权限异常）会撞上。
  if printf '%s' "$pg_log" | grep -q "wrong ownership" \
     && printf '%s' "$pg_log" | grep -q "does not exist"; then
    cat >&2 <<EOF
============================================================
诊断：Postgres 第一次初始化中途失败了，数据目录处于「半初始化」
      状态。再启动时它会认为"数据库已存在"从而跳过初始化，
      所以那个库永远建不出来，重跑脚本也没用。

如果这是首次部署、库里还没有任何数据，清掉重来即可：

    docker compose -f $COMPOSE_FILE down
    rm -rf data/postgres
    bash deploy.sh

如果库里已经有数据，千万不要删 data/postgres，
先把整个 data/postgres 目录备份走再说。
============================================================
EOF
  fi

  exit 1
fi

echo
echo "==> 部署完成，健康检查返回："
curl -s "http://127.0.0.1:${API_PORT}/api/health"
echo
echo
cat <<EOF
--------------------------------------------------------------
后端已在 127.0.0.1:${API_PORT} 上运行，公网直连不到（有意为之）。

接下来在宝塔面板配反向代理，把它接到你的域名：
   网站 → 添加站点（填你的域名）
        → 该站点「反向代理」→ 添加反向代理
           目标 URL:  http://127.0.0.1:${API_PORT}
           发送域名:  \$host
        → 该站点「SSL」→ Let's Encrypt 申请证书 → 开启强制 HTTPS

然后前端填：
   https://你的域名/api

常用命令：
   查看日志   docker compose -f $COMPOSE_FILE logs -f api
   重启后端   docker compose -f $COMPOSE_FILE restart api
   全部停止   docker compose -f $COMPOSE_FILE down
--------------------------------------------------------------
EOF
