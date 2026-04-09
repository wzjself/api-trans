#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/wzjself/api-trans.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/api-trans}"
BRANCH="${BRANCH:-main}"
APP_BASE_URL="${APP_BASE_URL:-http://127.0.0.1:18080}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-strong-password}"
ADMIN_INITIAL_BALANCE="${ADMIN_INITIAL_BALANCE:-1000000}"
USER_INITIAL_BALANCE="${USER_INITIAL_BALANCE:-100000}"
TOKEN_SECRET="${TOKEN_SECRET:-$(openssl rand -hex 24 2>/dev/null || date +%s | sha256sum | cut -d' ' -f1)}"
MYSQL_HOST="${MYSQL_HOST:-host.docker.internal}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-change-me-mysql-password}"
MYSQL_DATABASE="${MYSQL_DATABASE:-api_trans}"
TZ_VALUE="${TZ:-Asia/Shanghai}"

command -v git >/dev/null 2>&1 || { echo "git 未安装"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "docker 未安装"; exit 1; }

echo ">>> 安装目录: ${INSTALL_DIR}"
mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo ">>> 发现已有仓库，执行更新"
  git -C "$INSTALL_DIR" fetch --all --prune
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
else
  echo ">>> 克隆项目"
  rm -rf "$INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

mkdir -p state
[ -f state/active_color ] || echo blue > state/active_color

cat > .env <<EOF
TZ=${TZ_VALUE}
PORT=3000
APP_BASE_URL=${APP_BASE_URL}
VITE_PUBLIC_API_BASE=${APP_BASE_URL}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_INITIAL_BALANCE=${ADMIN_INITIAL_BALANCE}
USER_INITIAL_BALANCE=${USER_INITIAL_BALANCE}
TOKEN_SECRET=${TOKEN_SECRET}
MYSQL_HOST=${MYSQL_HOST}
MYSQL_PORT=${MYSQL_PORT}
MYSQL_USER=${MYSQL_USER}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_DATABASE=${MYSQL_DATABASE}
EOF

echo ">>> 生成 docker-compose.override.yml"
cat > docker-compose.override.yml <<EOF
services:
  api-trans-blue:
    env_file:
      - .env
  api-trans-green:
    env_file:
      - .env
EOF

echo ">>> 确保 shared-services 网络存在"
docker network inspect shared-services >/dev/null 2>&1 || docker network create shared-services >/dev/null

echo ">>> 启动初始颜色 blue"
bash deploy/switch.sh blue

echo
echo "安装完成"
echo "项目目录: $INSTALL_DIR"
echo "访问地址: ${APP_BASE_URL}"
echo "管理员账号: ${ADMIN_EMAIL}"
echo "管理员密码: ${ADMIN_PASSWORD}"
echo
echo "后续更新："
echo "  cd ${INSTALL_DIR} && git pull && bash deploy/switch.sh green"
