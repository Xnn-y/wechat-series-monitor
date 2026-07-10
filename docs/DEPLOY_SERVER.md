# 服务器部署指南

本项目后端推荐部署在 Ubuntu 服务器上，用 Gunicorn 运行 Flask，用 systemd 保持常驻，用 Nginx 对外提供访问。

当前部署条件：

- 服务器系统：Ubuntu
- 访问方式：先用服务器 IP + 独立端口访问
- 示例服务器 IP：`8.163.72.189`
- 仓库状态：GitHub 私有仓库
- 当前服务器已有项目：
  - Nginx 已占用外部 `80`、`8081`
  - 已有项目内部监听 `127.0.0.1:8080`
  - 本项目使用内部 `127.0.0.1:5001`，外部 `8082`

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
PUBLIC_BASE_URL=http://8.163.72.189:8082
DEVICE_OFFLINE_MINUTES=150

COLLECTOR_TOKEN=换成一串强随机token
ADMIN_PASSWORD=换成后台登录密码
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=你的企业微信机器人key
```

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

写入。当前服务器的 `80` 和 `8081` 已被已有项目使用，本项目先使用外部端口 `8082`：

```nginx
server {
    listen 8082;
    server_name _;

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
http://8.163.72.189/dashboard
```

本项目实际访问地址：

```text
http://8.163.72.189:8082/dashboard
```

## 9. HTTPS

当前没有域名，先跳过 HTTPS。等以后有域名并解析到服务器后，再安装证书：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d 你的域名
```

完成后访问：

```text
https://你的域名/dashboard
```

## 10. Auto.js 配置

部署成功后，把手机脚本里的后端地址改成服务器地址：

```js
backend: {
    enabled: true,
    serverUrl: "http://8.163.72.189:8082",
    collectorToken: "和服务器 COLLECTOR_TOKEN 一样"
}
```

## 11. 更新后端代码

以后修 bug 后，本地提交推送，然后服务器执行：

```bash
cd /opt/wechat-series-monitor
git pull
source .venv/bin/activate
pip install -r server/requirements.txt
sudo systemctl restart wechat-series-monitor
sudo systemctl status wechat-series-monitor
```

## 12. 验证清单

部署后逐项验证：

1. `http://8.163.72.189:8082/health` 返回 `ok: true`
2. `http://8.163.72.189:8082/dashboard` 可以打开登录页
3. 输入 `ADMIN_PASSWORD` 可以登录
4. 企业微信通知里后台链接可以打开
5. 手机 Auto.js 上报后，后台“最近采集”出现新轮次
6. 有新增剧集时，企业微信群收到通知
7. 设备状态在 150 分钟内显示在线
