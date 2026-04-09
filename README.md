# api-trans

一个面向 AI API 中转场景的轻量控制台，主打 **天卡 / 月卡 / 永久额度** 三种计费模式。

它不是单纯的 token 扣费面板，而是更适合做“套餐制中转站”的项目：

- **天卡**：每天固定额度，适合短期高频用户
- **月卡**：每天固定额度，适合长期稳定用户
- **永久额度**：按量消耗，适合零散调用或补充余额

对于很多中转站来说，这种模式比纯 token 余额制更好卖、更好控，也更容易做套餐设计。

---

## 项目截图

> 你可以把自己的截图放到 `docs/` 目录，例如：
>
> - `docs/dashboard.png`
> - `docs/admin-panel.png`

### 用户控制台

- API Key 管理
- 今日已用 / 今日剩余
- 登录公告弹窗
- 兑换码充值
- 使用记录分页

_建议放一张用户首页截图：`docs/dashboard.png`_

### 管理后台

- 用户管理
- 天卡 / 月卡 / 永久额度管理
- 兑换码生成与导出
- 公告弹窗配置
- 平台统计

_建议放一张管理后台截图：`docs/admin-panel.png`_

---

## 为什么这个项目的天卡 / 月卡模式更有优势

### 1. 比纯余额制更容易卖

用户买“天卡 / 月卡”比买一串抽象 token 更容易理解：

- 今天能用多少
- 还剩多少
- 到什么时候到期

这个项目已经把这些信息做进控制台里，用户不需要自己换算。

### 2. 更适合中转站做套餐

很多中转站实际运营时，最常见的不是“无限细粒度 token 售卖”，而是：

- 日卡套餐
- 月卡套餐
- 补量包

这个项目天然支持这种结构：

- **日卡/月卡** 负责“每日额度”
- **永久额度** 负责补充与兜底

### 3. 用户更容易接受“每日重置”逻辑

对普通用户来说：

- 今天可用多少
- 今天用了多少
- 今天还剩多少

这种信息比“累计消耗了多少百万 token”更直观。

项目已经内置：

- 今日已用额度
- 今日剩余额度
- 到期时间（北京时间）
- 用户管理里的卡类型 / 每日额度 / 今日已用 / 到期时间

### 4. 管理端更容易控风险

套餐制最大的优势之一就是可控。

这个项目支持你从后台直接看到：

- 用户是 **天卡 / 月卡 / 永久额度 / 无卡** 哪种类型
- 每日额度多少
- 今天已经用了多少
- 什么时候到期

这样你在运营时更容易判断：

- 哪个用户快到期
- 哪个用户今日消耗异常
- 哪类套餐更受欢迎

### 5. 适合搭配兑换码系统做分发

项目内置兑换码系统，直接支持：

- 永久额度充值码
- 天卡兑换码
- 月卡兑换码

这意味着你可以很方便地做：

- 渠道分发
- 活动赠送
- 代理售卖
- 批量发卡

对于中转站来说，这个能力非常实用。

---

## 主要功能

### 用户侧

- 登录 / 注册
- API Key 管理
- OpenAI 兼容 Base URL 展示与复制
- 使用统计图表
- 今日已用 / 今日剩余 / 永久额度展示
- 使用记录分页查看
- 兑换码充值
- 登录后弹窗公告
- 常态公告展示

### 管理后台

- 平台总览
- 用户管理
- 卡类型筛选（天卡 / 月卡 / 永久额度 / 无卡）
- 今日已用额度展示
- 到期时间（北京时间）展示
- 兑换码生成 / 删除 / 导出
- 渠道管理 / 默认模型管理
- 公告内容管理
- 登录公告弹窗开关

### 网关 / 转发能力

- OpenAI 兼容 `/v1/*`
- 支持 `/v1/chat/completions`
- 支持 OpenAI Responses 风格请求透传
- 多上游渠道切换
- 使用日志 / 消费日志记录

---

## 计费模式说明

### 永久额度

- 用户拥有一个长期余额
- 每次请求按消耗扣减
- 适合按量付费用户

### 天卡

- 用户在有效期内每天拥有固定额度
- 每天按北京时间重置
- 更适合短期套餐、活动卡、体验卡

### 月卡

- 用户在有效期内每天拥有固定额度
- 每天按北京时间重置
- 更适合稳定长期用户

### 时间口径

项目内部“今日已用 / 今日剩余 / 柱状图日统计”等，都按：

- **北京时间（UTC+8）**
- **每天 0 点重置**

---

## 风控能力

为了保护用户信息和接口安全，项目已经加入基础风控：

### 登录风控

- 同一 **IP / 设备指纹**
- 连续登录失败 **10 次**
- 冷却 **10 分钟**

### 注册风控

- 同一 **IP / 设备指纹**
- 短时间内注册账号超过 **10 个**
- 禁止继续注册

---

## 一键安装（curl）

如果你的服务器已经具备：

- Git
- Docker
- Docker Compose Plugin
- 外部 MySQL

那么可以直接用下面的一条命令完成项目克隆、依赖环境准备、配置写入、容器启动：

```bash
curl -fsSL https://raw.githubusercontent.com/wzjself/api-trans/main/scripts/install.sh | bash
```

### 可选：自定义环境变量后再安装

```bash
export INSTALL_DIR=/opt/api-trans
export APP_BASE_URL=http://your-domain-or-ip:18080
export ADMIN_EMAIL=admin
export ADMIN_PASSWORD='your-strong-password'
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD='your-mysql-password'
export MYSQL_DATABASE=api_trans

curl -fsSL https://raw.githubusercontent.com/wzjself/api-trans/main/scripts/install.sh | bash
```

安装完成后默认会：

- 克隆仓库到 `/opt/api-trans`（可改）
- 生成 `.env`
- 创建 `shared-services` Docker 网络（如果不存在）
- 启动 blue 环境
- 自动通过网关暴露到 `18080`

---

## 手动部署教程

### 1. 克隆项目

```bash
git clone https://github.com/wzjself/api-trans.git
cd api-trans
```

### 2. 配置环境变量

复制并修改：

```bash
cp .env.example .env
```

重点配置：

- `APP_BASE_URL`
- `VITE_PUBLIC_API_BASE`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `TOKEN_SECRET`
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`

### 3. 准备 override 文件

```bash
cat > docker-compose.override.yml <<EOF
services:
  api-trans-blue:
    env_file:
      - .env
  api-trans-green:
    env_file:
      - .env
EOF
```

### 4. 确保共享网络存在

```bash
docker network inspect shared-services >/dev/null 2>&1 || docker network create shared-services
```

### 5. 首次部署

```bash
bash deploy/switch.sh blue
```

### 6. 后续蓝绿更新

```bash
git pull
bash deploy/switch.sh green
```

或再切回：

```bash
bash deploy/switch.sh blue
```

---

## 本地开发

### 1. 安装依赖

```bash
npm install
```

### 2. 启动前端开发环境

```bash
npm run dev
```

### 3. 启动后端

```bash
npm run server
```

---

## 技术栈

- **Frontend**: React + Vite + Tailwind
- **Backend**: Express
- **Database**: MySQL
- **Chart**: Recharts
- **Deploy**: Docker + Blue/Green Switch

---

## 适合谁

这个项目尤其适合：

- 想做 **套餐制 AI 中转站** 的个人站长
- 想卖 **天卡 / 月卡 / 充值码** 的运营场景
- 想把“按量付费”和“套餐制”混合起来的中转项目

如果你想做的是：

- 用户好理解
- 套餐好售卖
- 后台好管理
- 风险可控制

那它比单纯余额面板更合适。

---

## License

自用 / 私有部署场景可自行维护。
