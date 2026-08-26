# 文档导航

本目录保存微信视频号剧集监控系统的部署、手机配置、识别方案和历史设计记录。首次了解项目时，建议按下面顺序阅读。

## 首次阅读

1. [`../README.md`](../README.md)：系统用途、当前状态、运行方式和测试命令。
2. [`HANDOFF.md`](./HANDOFF.md)：架构、维护边界、日常检查和已知风险。
3. [`PHONE_SETUP.md`](./PHONE_SETUP.md)：AutoJs6 手机端配置。
4. [`DEPLOY_SERVER.md`](./DEPLOY_SERVER.md)：服务器部署和更新流程。

## AI 识别

- [`AI_RECOGNITION_MIGRATION_PLAN.md`](./AI_RECOGNITION_MIGRATION_PLAN.md)：从本地 OCR 到 AI 识别的迁移与验收过程。
- [`BACKEND_AI_RECOGNITION_PLAN.md`](./BACKEND_AI_RECOGNITION_PLAN.md)：后端 AI 识别接口设计。
- [`AI_RECOGNITION_TIMING_DIAGNOSTICS.md`](./AI_RECOGNITION_TIMING_DIAGNOSTICS.md)：端到端耗时边界和诊断字段。

## 历史设计

- [`PROJECT_CLEANUP_AND_BACKEND_PLAN.md`](./PROJECT_CLEANUP_AND_BACKEND_PLAN.md)：项目清理与后端建设过程。
- [`PROJECT_HANDOFF_2026-07-20.md`](./PROJECT_HANDOFF_2026-07-20.md)：2026-07-20 的阶段快照，仅用于追溯当时状态。

带日期的文档是历史快照，不代表当前配置。线上地址、识别模式和测试范围以根 README、当前代码和本说明为准。
