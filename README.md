# 微信视频号剧集采集系统

这个项目用于监控微信视频号关注账号的剧集更新。

当前架构是：

```text
AutoJs6 手机采集端
  -> 本地 CSV 备份
  -> 后端 API 上报
  -> SQLite 去重入库
  -> 企业微信群机器人通知
  -> 团队 Dashboard 查看 / CSV 导出
```

## 当前主线

```text
src/
  phase3/                    AutoJs6 模块化源码
  phase3_full_collect.js     AutoJs6 直接运行的合成单文件脚本

server/
  src/                       Flask 后端源码
  tests/                     后端测试脚本
  static/dashboard.html      团队查看页面
  requirements.txt           后端依赖
  .env.example               环境变量示例

tools/
  build_phase3_full_collect.js

docs/
  PROJECT_CLEANUP_AND_BACKEND_PLAN.md
```

旧路线、探测脚本、历史快照已经放在本地归档目录中，不再作为当前主线维护。

## 当前线上入口

```text
微信剧集监控后台：http://atool.fz-ue.com/dashboard
健康检查：http://atool.fz-ue.com/health
手机端上报：http://atool.fz-ue.com/api/collect
```

当前服务器上，`atool.fz-ue.com` 的 80 端口用于微信剧集监控；图鸭项目保留裸 IP + 独立端口访问，不再占用这个域名。

## 手机端运行

修改 `src/phase3/` 后，先重新生成 AutoJs6 单文件：

```powershell
node tools\build_phase3_full_collect.js
```

然后把下面这个文件放到 AutoJs6 运行：

```text
src/phase3_full_collect.js
```

手机端本地备份路径：

```text
/sdcard/AutoJs6/phase3_data/series_data.csv
/sdcard/AutoJs6/phase3_data/series_index.json
```

## 后端运行

安装依赖：

```powershell
python -m pip install -r server\requirements.txt
```

复制环境变量模板：

```powershell
copy server\.env.example server\.env
```

本地开发默认数据库：

```text
server/data/collector.dev.db
```

启动后端：

```powershell
python server\src\app.py
```

访问：

```text
http://127.0.0.1:5000/health
http://127.0.0.1:5000/dashboard
```

## 测试

PowerShell 建议先设置 UTF-8：

```powershell
$env:PYTHONIOENCODING='utf-8'
```

按顺序运行：

```powershell
python server\tests\test_api.py
python server\tests\test_dashboard.py
python server\tests\test_e2e.py
node --check src\phase3_full_collect.js
```

测试使用独立数据库：

```text
server/data/collector.test.db
```

## 服务器部署配置

服务器上使用 `server/.env` 指定生产配置：

```text
APP_ENV=production
DATABASE_URL=sqlite:////opt/wechat-series-monitor/server/data/collector.prod.db
PUBLIC_BASE_URL=http://atool.fz-ue.com
DEVICE_OFFLINE_MINUTES=150
COLLECTOR_TOKEN=change_me
ADMIN_PASSWORD=change_me
VIEWER_PASSWORD=change_me
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
```

AutoJs6 端需要把 `src/phase3/config.js` 里的后端地址改成服务器地址：

```javascript
backend: {
    enabled: true,
    serverUrl: "http://atool.fz-ue.com",
    collectorToken: "same_token_as_server"
}
```

`WECOM_WEBHOOK_URL` 是企业微信群机器人通知地址。采集入库出现新增剧集时，后端会通过它发送通知；它不是手机端启动脚本的触发 webhook。

## Git 约定

纳入 Git 的内容：

```text
src/phase3/
src/phase3_full_collect.js
server/src/
server/tests/
server/requirements.txt
server/.env.example
tools/
docs/
README.md
```

不纳入 Git 的内容：

```text
server/.env
server/data/*.db
__pycache__/
_snapshots/
archive/
logs/
```

后续更新服务器时建议流程：

```text
本地修改 -> 本地测试 -> git commit -> 推送 -> 服务器 git pull -> 重启服务
```
