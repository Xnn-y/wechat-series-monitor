# 项目清理与后端化改造计划

> 历史方案：本文记录清理和后端建设过程，其中目录建议可能已完成或过时；当前结构请以根 README 为准。

## 目标

当前项目已经从单机 AutoJs6 采集脚本，升级为团队长期监控系统的雏形。下一阶段目标不是继续堆脚本能力，而是把系统拆成三层：

```text
AutoJs6 采集端 -> 后端服务 -> 企业微信通知 / 团队查看后台
```

手机只负责微信页面操作、OCR 和采集结果上报；后端负责去重、存储、通知、查询、导出和异常监控。

## 当前结论

后端方案是当前优选路线。

原因：

- 团队多人查看不再依赖某一台电脑或 Syncthing 文件夹。
- 去重从 CSV 扫描升级为数据库唯一约束和模糊匹配。
- 企业微信通知由后端统一发送，避免手机脚本重复通知或漏通知。
- 手机脚本负担更小，更适合 24 小时运行。
- 后续可以自然扩展网页后台、日报、账号统计、异常报警、人工修正 OCR 等能力。

## 清理原则

清理前必须先做快照，不直接删除当前可运行主线。

执行顺序：

1. 创建清理前快照。
2. 确认当前可运行主线文件。
3. 把旧路线移动到归档目录。
4. 删除确定无价值的临时产物。
5. 重建 README 和运行说明。
6. 再开始后端目录搭建。

当前不建议直接删除旧脚本，因为这些文件里可能还有可复用的 OCR、点击、探测逻辑。第一轮清理以归档为主。

## 当前主线保留

这些文件属于当前工作路线，第一轮必须保留：

```text
src/phase3/
src/phase3_full_collect.js
tools/build_phase3_full_collect.js
docs/PROJECT_CLEANUP_AND_BACKEND_PLAN.md
```

说明：

- `src/phase3/` 是当前模块化源码。
- `src/phase3_full_collect.js` 是给 AutoJs6 直接运行的合成脚本。
- `tools/build_phase3_full_collect.js` 负责从模块源码生成单文件脚本。

## 归档候选

这些是早期路线、探测工具或备用验证脚本，建议移动到 `archive/legacy-autojs/`：

```text
src/phase1_read_series.js
src/phase2_scroll_collect.js
src/master_collect.js
src/config.js
src/actions/
src/flows/
src/collectors/
src/probes/
src/shared/
assets/
logs/
docs/README_RUN.md
docs/DEVELOPMENT_PLAN.md
```

归档原因：

- 主线已经切换到 `phase3_full_collect.js`。
- 旧文档存在编码损坏，继续放在主目录会误导后续开发。
- 探测脚本后续可能还要参考，但不应和主线入口混在一起。

## 删除候选

这些属于临时分析产物或旧通知路线，确认后可以删除或移出仓库：

```text
.graphify_ast.json
.graphify_detect.json
graphify-out/
src/test_lark_notify.js
```

注意：

- `src/test_lark_notify.js` 可能包含真实飞书 webhook 或密钥，不应长期保留。
- `graphify-out/` 是分析产物，不属于业务代码。
- `_snapshots/` 建议先保留，等后端主线稳定后再移到仓库外备份目录。

## 建议的新目录结构

第一阶段采用清晰但不过度复杂的结构：

```text
20260702/
  apps/
    autojs/
      src/
        phase3/
      dist/
        phase3_full_collect.js
      tools/
        build_phase3_full_collect.js
    backend/
      src/
        config/
        db/
        routes/
        services/
        utils/
      migrations/
      scripts/
      tests/
      package.json 或 pyproject.toml
  docs/
    PROJECT_CLEANUP_AND_BACKEND_PLAN.md
    AUTOJS_RUNBOOK.md
    BACKEND_API.md
    DEPLOYMENT.md
  archive/
    legacy-autojs/
    snapshots/
  README.md
```

如果想减少移动成本，也可以先使用过渡结构：

```text
src/
  phase3/
  phase3_full_collect.js
server/
  src/
  data/
  migrations/
  tests/
tools/
docs/
archive/
```

推荐先用过渡结构，等后端稳定后再升级到 `apps/` 多应用结构。

## 后端 MVP 范围

第一版后端只做必须能力：

### 接口

```text
GET  /health
POST /api/collect
GET  /api/records
GET  /api/runs
GET  /api/export.csv
```

### AutoJs6 上报格式

```json
{
  "device": "huawei_p30_01",
  "run_id": "20260709_143000",
  "started_at": "2026-07-09 14:30:00",
  "finished_at": "2026-07-09 14:35:00",
  "records": [
    {
      "account_name": "萌萌虎剧场",
      "series_name": "海带崩盘前，全村骂我是骗子",
      "episodes": "49集",
      "collected_at": "2026-07-09 14:32:10"
    }
  ]
}
```

### 后端返回格式

```json
{
  "ok": true,
  "received": 12,
  "inserted": 3,
  "duplicates": 9,
  "notified": true
}
```

## 数据库设计

第一版建议用 SQLite，足够稳定，部署简单。

核心表：

```text
devices
collection_runs
series_records
notification_logs
ocr_aliases
```

关键唯一约束：

```text
normalized_account_name + normalized_series_name
```

说明：

- 原始 OCR 文本要保留。
- 归一化后的账号名和剧名用于去重。
- 后续可以增加人工修正表，把错误 OCR 映射到正确名称。

## 企业微信通知策略

飞书通知停止维护，后续改为企业微信群机器人。

通知由后端发送，不由 AutoJs6 直接发送。

触发规则：

```text
本轮 inserted > 0 时发送企业微信通知
```

通知内容：

```text
剧集更新监控
本轮新增：3 条
采集设备：huawei_p30_01
采集时间：2026-07-09 14:35:00

1. 萌萌虎剧场
   海带崩盘前，全村骂我是骗子 49集

2. xxx
   xxx

查看后台：http://server/records
```

## 安全策略

第一阶段不做复杂登录，但必须有基本保护：

- AutoJs6 上报接口使用 `X-Collector-Token`。
- 企业微信 webhook 不写死在代码里，放环境变量。
- 后台页面至少使用访问密码或内网访问限制。
- 不把真实 webhook、token、secret 提交到仓库。

建议环境变量：

```text
COLLECTOR_TOKEN=
WECOM_WEBHOOK_URL=
ADMIN_PASSWORD=
DATABASE_URL=
```

## 部署选择

按推荐顺序：

1. 局域网电脑或小主机部署后端，手机和团队在同一网络或 VPN 内访问。
2. 云服务器部署后端，手机直接上报公网 HTTPS 地址。
3. NAS 部署后端，适合长期低成本运行。

如果团队需要随时随地查看，最终建议云服务器或有内网穿透/VPN 的小主机。

## 阶段计划

### 阶段 0：清理与定版

目标：

- 保留当前 AutoJs6 主线。
- 归档旧路线。
- 删除临时产物和飞书测试文件。
- 文档只保留当前路线。

验收标准：

- 主目录能一眼看出当前主线。
- `src/phase3_full_collect.js` 仍可运行。
- `node --check src/phase3_full_collect.js` 通过。

### 阶段 1：后端 MVP

目标：

- 建立后端项目。
- 提供 `/api/collect` 接口。
- SQLite 保存记录。
- 数据库去重。
- 企业微信机器人发送新增摘要。

验收标准：

- 用测试 JSON POST 能写入数据库。
- 重复 POST 不重复新增。
- 新增记录会推送企业微信群。
- 无新增记录不推送。

### 阶段 2：AutoJs6 接入后端

目标：

- AutoJs6 每轮采集结束后上报后端。
- 保留本地 CSV 作为备份。
- 后端返回 inserted/duplicates 统计。

验收标准：

- 手机跑完一轮，后端能看到 run 和 records。
- 企业微信群收到新增摘要。
- 手机本地 CSV 仍能保留完整备份。

### 阶段 3：团队查看后台

目标：

- 提供简单网页列表。
- 支持按账号、剧名、日期筛选。
- 支持 CSV 导出。

验收标准：

- 团队成员打开网页能查看最新记录。
- 能导出完整 CSV。
- 页面可以看到最后一次采集时间和设备状态。

### 阶段 4：稳定性与运营能力

目标：

- 采集心跳。
- 失败报警。
- OCR 修正映射。
- 日报或定时汇总。

验收标准：

- 超过指定时间未上报会通知企业微信。
- OCR 错名可以在后台修正。
- 修正后不影响历史追溯。

## 下一步建议

下一步先执行阶段 0。

具体操作：

1. 再做一次清理前快照。
2. 创建 `archive/legacy-autojs/`。
3. 移动旧路线文件。
4. 删除 graphify 临时产物和飞书测试文件。
5. 重建 README，明确当前入口和后端化路线。
6. 确认主脚本语法检查通过。

完成阶段 0 后，再创建后端骨架。
