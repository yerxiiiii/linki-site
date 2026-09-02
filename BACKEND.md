# Linki 官网后端与内部看板

这个版本把原本的静态官网升级为带后端的数据收集站点：

- 公开站点：`http://localhost:3000`
- 表单提交接口：`POST /api/leads`
- 内部看板：`http://localhost:3001`
- 数据存储：SQLite，默认写入 `data/linki-leads.db`

## 本地启动

```sh
npm run dev
```

`dev` 会开启 `ADMIN_PUBLIC=1`，方便本地直接访问内部看板。

## 生产启动

```sh
cp .env.example .env
node --env-file=.env server.js
```

生产环境建议在 `.env` 中配置：

- `ADMIN_ALLOWED_IPS`：允许访问内部看板的办公室出口 IP
- `DB_PATH`：数据库文件路径，建议放在有备份的持久化目录
- `PORT` / `ADMIN_PORT`：公开站点和内部看板端口

内部看板支持查看、分页、导出 CSV 和删除表单提交数据。
