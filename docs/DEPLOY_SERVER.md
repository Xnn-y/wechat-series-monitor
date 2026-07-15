# 服务器部署指南

本项目后端推荐部署在 Ubuntu 服务器上，用 Gunicorn 运行 Flask，用 systemd 保持常驻，用 Nginx 对外提供访问。

当前部署条件：

- 服务器系统：Ubuntu
- 访问方式：域名 `http://atool.fz-ue.com` 访问微信剧集监控
- 示例服务器 IP：`8.163.72.189`
- 仓库状态：GitHub 私有仓库
- 当前服务器已有项目：
  - 微信剧集监控内部监听 `127.0.0.1:5001`，外部使用域名默认 `80` 端口
  - 图鸭项目内部监听 `127.0.0.1:8080`
  - 图鸭项目外部保留裸 IP 端口 `8081`、`8082`

当前端口关系：

```text
http://atool.fz-ue.com/        -> Nginx 80 -> 127.0.0.1:5001 微信剧集监控
http://8.163.72.189:8081/      -> 图鸭 admin_web
http://8.163.72.189:8082/      -> 图鸭 custom_web
```

## 1. 本地提交并推送代码

在本地项目根目录执行：

```powershell
git status
git add server/requirements.txt server/.env.example server/src/config/settings.py server/src/routes/api.py server/src/services/monitor.py server/src/static/dashboard.html server/tests/test_api.py server/tests/test_e2e.py docs/DEPLOY_SERVER.md
git commit -m "feat(server): add dashboard summary and deployment config"
git push
```

注意：`server/.env` 不要提交，它包含真实 webhook 和密码。

## 2. 服务器基础环境

在服务器执行：

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip nginx
```

## 3. 拉取私有仓库项目

推荐放在 `/opt`：

```bash
cd /opt
sudo git clone https://github.com/Xnn-y/wechat-series-monitor.git
sudo chown -R $USER:$USER /opt/wechat-series-monitor
cd /opt/wechat-series-monitor
```

执行 `git clone` 时，GitHub 会要求输入账号和密码：

- Username：你的 GitHub 用户名
- Password：粘贴 GitHub Personal Access Token，不是 GitHub 登录密码

注意：GitHub Token 不要发给任何人，也不要截图。长期使用建议后续改成 SSH key 拉取。

## 4. 创建 Python 虚拟环境

```bash
cd /opt/wechat-series-monitor
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
```

## 5. 配置服务器环境变量

```bash
cp server/.env.example server/.env
nano server/.env
```

服务器建议配置：

```env
APP_ENV=production
DATABASE_URL=sqlite:////opt/wechat-series-monitor/server/data/collector.prod.db
PUBLIC_BASE_URL=http://atool.fz-ue.com
DEVICE_OFFLINE_MINUTES=150

COLLECTOR_TOKEN=换成一串强随机token
ADMIN_PASSWORD=换成后台登录密码
VIEWER_PASSWORD=换成只读查看密码
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的企业微信机器人key
```

`WECOM_WEBHOOK_URL` 用于企业微信群机器人通知。后端在 `/api/collect` 收到新增剧集并成功入库后，会通过这个 webhook 推送本轮新增摘要。

## 6. 测试后端能否启动

```bash
cd /opt/wechat-series-monitor
source .venv/bin/activate
gunicorn -w 2 -b 127.0.0.1:5001 "server.src.app:create_app()"
```

然后另开一个终端测试：

```bash
curl http://127.0.0.1:5001/health
```

看到 `{"ok":true,...}` 后按 `Ctrl+C` 停掉 Gunicorn。

## 7. 配置 systemd 常驻服务

创建服务文件：

```bash
sudo nano /etc/systemd/system/wechat-series-monitor.service
```

写入：

```ini
[Unit]
Description=WeChat Series Monitor Backend
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/wechat-series-monitor
Environment=PYTHONPATH=/opt/wechat-series-monitor/server
ExecStart=/opt/wechat-series-monitor/.venv/bin/gunicorn -w 2 -b 127.0.0.1:5001 "src.app:create_app()"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

授权数据目录：

```bash
sudo chown -R www-data:www-data /opt/wechat-series-monitor/server/data
sudo chown www-data:www-data /opt/wechat-series-monitor/server/.env
```

启动服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable wechat-series-monitor
sudo systemctl start wechat-series-monitor
sudo systemctl status wechat-series-monitor
```

查看日志：

```bash
sudo journalctl -u wechat-series-monitor -f
```

## 8. 配置 Nginx

创建站点：

```bash
sudo nano /etc/nginx/sites-available/wechat-series-monitor
```

写入。当前域名 `atool.fz-ue.com` 走微信剧集监控；图鸭项目继续用裸 IP + `8081`、`8082`：

```nginx
server {
    listen 80;
    server_name atool.fz-ue.com;

    location / {
        proxy_pass http://127.0.0.1:5001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用站点：

```bash
sudo ln -s /etc/nginx/sites-available/wechat-series-monitor /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

访问：

```text
http://atool.fz-ue.com/dashboard
```

兼容旧登录路径：

```text
http://atool.fz-ue.com/login
```

## 9. HTTPS

当前先使用 HTTP。以后如果要给 `atool.fz-ue.com` 配 HTTPS，再安装证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d atool.fz-ue.com
```

完成后访问：

```text
https://atool.fz-ue.com/dashboard
```

## 10. Auto.js 配置

部署成功后，把手机脚本里的后端地址改成服务器地址：

```js
backend: {
    enabled: true,
    serverUrl: "http://atool.fz-ue.com",
    collectorToken: "和服务器 COLLECTOR_TOKEN 一样"
}
```

## 11. 更新后端代码

日常修改后端的工作流程，分三步：

### 11.1 本地修改 + 推送

在 VS Code 里改完代码后：

```powershell
cd f:\Py_project\Test\20260702

# 查看改了哪些文件
git status

# 添加所有改动
git add -A

# 提交（用 Conventional Commits 规范）
git commit -m "fix(server): 修复xxx问题"

# 推送到 GitHub
git push
```

常用 commit 前缀：

| 前缀 | 用途 |
|---|---|
| `fix:` | 修 bug |
| `feat:` | 新功能 |
| `chore:` | 杂项（配置、文档等） |
| `refactor:` | 重构，不改功能 |

### 11.2 服务器拉取

```bash
cd /opt/wechat-series-monitor
git pull

# 如果加了新的 Python 依赖才需要执行
source .venv/bin/activate
pip install -r server/requirements.txt
deactivate
```

### 11.3 重启服务

```bash
sudo systemctl restart wechat-series-monitor
sudo systemctl status wechat-series-monitor
```

看到 `active (running)` 即更新成功。

### 11.4 特殊情况

**新增了环境变量**（改了 `settings.py`）：
服务器上也要同步更新 `.env`：
```bash
nano /opt/wechat-series-monitor/server/.env
# 添加新的变量，保存后重启
sudo systemctl restart wechat-series-monitor
```

**数据库结构变了**（改了 `database.py`）：
新表会在服务重启时自动创建，无需手动迁移。

**出问题了要回滚**：
```bash
cd /opt/wechat-series-monitor
git log --oneline -5              # 看最近 5 次提交
git revert <commit-hash>          # 回滚某次提交
git push
# 然后服务器再 git pull + restart
```

## 12. 验证清单

部署后逐项验证：

1. `http://atool.fz-ue.com/health` 返回 `ok: true`
2. `http://atool.fz-ue.com/dashboard` 可以打开登录页
3. 输入 `ADMIN_PASSWORD` 可以登录
4. 企业微信通知里后台链接可以打开
5. 手机 Auto.js 上报后，后台“最近采集”出现新轮次
6. 有新增剧集时，企业微信群收到通知
7. 设备状态在 150 分钟内显示在线
