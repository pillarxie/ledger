#!/bin/sh
# 容器启动入口：先把数据库结构同步到最新，再启动应用。
# 依赖 compose 的健康检查，所以正常情况下这里一次就能成功；
# 仍保留重试，避免 NAS 重启后 Postgres 初始化慢导致的启动失败。
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "==> 同步数据库结构 (prisma migrate deploy)"
  attempt=0
  max_attempts="${MIGRATION_MAX_ATTEMPTS:-60}"
  until pnpm exec prisma migrate deploy; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "!! 数据库迁移失败，已重试 ${attempt} 次，放弃启动" >&2
      exit 1
    fi
    echo "   数据库尚未就绪或迁移失败，2 秒后重试 (${attempt}/${max_attempts})"
    sleep 2
  done
  echo "==> 数据库结构已是最新"
else
  echo "==> 已跳过数据库迁移 (RUN_MIGRATIONS=false)"
fi

exec "$@"
