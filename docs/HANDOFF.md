# 维护与接手说明

更新时间：2026-08-26

本文面向所有需要理解、运行或继续维护本仓库的人。系统已在实际环境中使用，修改时应优先保证采集完整性、去重正确性和现有运行链路稳定。

## 系统职责

```text
AutoJs6 手机采集
  -> 后端 AI 剧名识别
  -> 手机本地 CSV 备份
  -> Flask API 上报
  -> SQLite 去重入库
  -> 企业微信新增通知
  -> Dashboard 查看与 CSV 导出
```

手机端负责页面操作、截图和采集；后端负责鉴权、识别、去重、持久化、通知和查询。两端共享的接口与字段变化必须同步验证。

## 当前维护基线

- `src/phase3/config.js` 的默认识别模式为 `backend_ai`。
- `src/phase3/` 是可维护源码，`src/phase3_full_collect.js` 是构建后的 AutoJs6 单文件入口。
- 手机端启动前有单实例保护，避免定时任务重叠运行。
- 线上 API 使用 HTTPS；本地开发仍可使用 `127.0.0.1` HTTP。
- 本地 OCR、标签页判断和既有采集流程仍是重要的回退与诊断基础，不应在没有对照验证时删除。

## 关键目录

- `src/phase3/`：手机采集、页面识别、AI 调用和运行控制。
- `server/src/`：Flask API、鉴权、数据库、通知和 Dashboard。
- `server/tests/`：后端与识别接口回归测试。
- `tools/build_phase3_full_collect.js`：生成手机端单文件。
- `docs/`：部署、配置、识别实验和历史说明。

## 修改与验证

修改手机端模块后先重新构建：

```powershell
node tools\build_phase3_full_collect.js
```

提交前至少运行：

```powershell
$env:PYTHONIOENCODING='utf-8'
python server\tests\test_api.py
python server\tests\test_dashboard.py
python server\tests\test_e2e.py
python server\tests\test_notifier.py
python server\tests\test_recognition_api.py
node --check src\phase3_full_collect.js
```

自动测试通过不等于手机端真实验收通过。涉及识别、滑动、标签页或截图范围的修改，应在设备上验证一次完整采集，并确认本地 CSV、后端记录和通知结果一致。

## 部署与运行边界

- 部署前先确认当前没有正在执行的采集任务。
- 生产更新按“本地测试、提交推送、服务器拉取、重启、健康检查、业务抽查”执行。
- 不在未确认运行状态时重启后端或替换手机脚本。
- 不提交 `.env`、Token、账号密码、Webhook、AI 密钥、数据库或真实截图。
- 日志可以记录阶段、耗时、状态码和请求体长度，但不能记录完整密钥或签名 URL。

## 常见风险

- 微信页面结构或文案变化会导致标签页判断、点击位置和截图范围失效。
- 图片上传通常是 AI 识别耗时的主要部分；判断性能原因前，应分别记录客户端编码、上传、代理和上游耗时。
- AI 返回通过模拟测试只说明协议兼容，不代表真实模型、网络和图片质量已经验收。
- 定时任务可能被重复触发，修改入口逻辑时必须保留并验证单实例保护。
- 识别结果应优先保证正确性；任何降采样、裁剪或调用次数优化都需要同一批样本的离线对比和可回退方案。

## 首次接手检查

1. 阅读根 README、本文件、手机配置和部署说明。
2. 查看当前 Git 状态与最近提交，不覆盖他人的未提交改动。
3. 运行完整自动测试。
4. 核对服务器环境变量和设备本地配置，但不要复制凭据到文档。
5. 在可控时间窗完成一次设备端采集和后台结果核对。
