# Linki 官网后端与内部看板

这个版本把原本的静态官网升级为带后端的数据收集站点：

- 公开站点：`http://localhost:3000`
- 表单提交接口：`POST /api/leads`
- 内部看板：`http://localhost:3001`
- 数据存储：SQLite，默认写入 `data/linki-leads.db`

## 本地启动

```sh
cp .env.example .env
npm run dev
```

启动前需要在 `.env` 中配置后台管理员账号密码：

```sh
ADMIN_USER=linki_admin
ADMIN_PASSWORD=请替换为高强度密码
```

## 生产启动

```sh
cp .env.example .env
node --env-file=.env server.js
```

生产环境建议在 `.env` 中配置：

- `ADMIN_USER` / `ADMIN_PASSWORD`：后台管理员账号密码，未配置时服务会拒绝启动
- `DB_PATH`：数据库文件路径，建议放在有备份的持久化目录
- `PORT` / `ADMIN_PORT`：公开站点和内部看板端口

## 后台登录

- `GET /login`：独立登录页
- `POST /api/login`：校验管理员账号密码，成功后写入 HttpOnly Session Cookie
- `GET /api/session`：返回当前登录状态
- `POST /api/logout`：退出登录并清除 Cookie
- `GET /`：已登录显示内部看板，未登录跳转 `/login`

Session ID 由服务端随机生成，保存在服务端内存中；浏览器关闭后 Cookie 自动失效，服务重启后需要重新登录。内部看板支持查看、分页、导出 CSV 和删除表单提交数据。

## 增长归因参数

后台“增长归因”按首次有效触点统计线索贡献。投放链接建议统一携带：

```text
?utm_source=facebook&utm_medium=paid-social&utm_campaign=launch-01&agent_id=prospecting-v2&prompt_id=privacy-angle-03&creative_id=video-07
```

- `agent_id`：生成或管理该创意策略的 Agent 版本
- `prompt_id`：具体文案或视觉 Prompt 编号
- `creative_id`：实际投放素材编号
- `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term`：标准渠道参数

看板展示的是表单线索贡献和用户亮点偏好。未接入广告平台花费、曝光与点击数据前，不将这些指标表述为 ROAS 或广告转化率。
