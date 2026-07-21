# 后端统一 AI 剧名识别方案

## 目标

把“剧集页截图识别剧名”的 AI 调用从 AutoJs6 手机脚本迁移到后端。

手机脚本只负责：
- 进入账号主页
- 点击剧集 Tab
- 截图
- 把截图上传给后端
- 根据后端返回结果继续下滑或停止

后端负责：
- 保存 AI key 和模型配置
- 调用火山方舟 Responses
- 维护 prompt、解析和清洗逻辑
- 保留现有剧集页识别经验规则，辅助 AI 做准确判断
- 控制每个账号、每轮采集的 AI 调用次数
- 统计 AI 调用次数和 token 消耗
- 失败熔断，避免配置错误时持续烧额度
- 临时保存截图，跑完后按策略清理
- 记录识别日志，方便排查
- 统一做剧名去重和是否继续下滑的判断

这个方案不改现有后端数据库、Dashboard、通知、标准账号库，只新增一个“截图识别剧名”的后端能力。

## 为什么比手机端直接调 AI 更好

当前临时方案：

```text
手机截图
  -> 手机脚本调用火山方舟 AI
  -> 手机脚本解析剧名
  -> 手机脚本上报后端
```

建议方案：

```text
手机截图
  -> 上传给后端识别接口
  -> 后端调用火山方舟 AI
  -> 后端返回剧名、统计信息和是否继续下滑
  -> 手机脚本继续点击/滑动
```

优势：
- AI key 不再放手机上，安全性更好。
- prompt、模型、超时、额度控制都在后端，后续调整不用重新同步 AutoJs6 脚本。
- 后端可以记录每次识别的截图、AI 原始返回、最终剧名、耗时、错误原因、token usage。
- 后端可以统一限制每个账号最多调用几次 AI。
- 后端可以做整轮采集熔断，比如 key 错、额度不足、接口异常时立刻停止后续 AI 调用。
- 后端可以按截图 hash 做缓存，同一张图不重复调用 AI。
- 后续如果想改成“OCR + AI 混合识别”，只需要改后端，手机脚本不用变。

## 必须保留的识别经验规则

迁移到后端 function 后，不能只让 AI 自由识图。当前 OCR 阶段已经验证过一些有用规则，这些规则要进入后端 prompt、后处理和验收逻辑。

必须保留：

```text
只识别剧集 Tab 页面里的剧名
只有同一张卡片的封面图和集数同时露出，才允许识别该卡片
正式剧名位于封面图下方、集数上方
集数只作为剧名定位辅助，不作为最终业务结果
不要把封面内部大字、宣传语、海报文案当剧名
不要把顶部/底部只露出一部分、缺少封面图或缺少集数的残片当完整剧名
剧名可能有两行，需要按同一个灰色信息区合并
同一屏内相同剧名要去重
跨屏相同剧名要去重，只把新增剧名计入 new_titles
边缘卡片如果封面图和集数同时可见，说明中间剧名区域完整露出，可以识别
边缘卡片如果只露出剧名和集数，但封面图不可见，不能证明剧名完整，应标记为不完整或忽略
```

后端可以把这些规则分三层实现：

```text
prompt 层：
    明确告诉 AI 只返回封面图下方、集数上方的正式剧名。
    明确告诉 AI：封面图和集数必须同时可见，才算完整卡片。
    明确要求忽略封面内部文字、宣传语、按钮、Tab、商品字样。

schema 层：
    让 AI 返回 title、episodes、isCompleteCard、confidence、reason。
    后端最终只使用 title，episodes 只用于辅助判断。

后处理层：
    过滤低置信度结果。
    过滤 UI 文本和明显宣传语。
    过滤没有封面图锚点或没有集数锚点的边缘残片。
    对同屏和跨屏剧名做标准化去重。
```

这样后端 function 不是“纯 AI 识图”，而是“AI 识图 + 已验证规则约束 + 后端状态判断”。

## 建议接口

新增接口：

```http
POST /api/collector/series/recognize
```

请求示例：

```json
{
  "collector_token": "...",
  "run_id": "20260721_153000_ab12",
  "account": "账号名",
  "screen_index": 0,
  "image_base64": "...",
  "image_format": "jpg"
}
```

返回示例：

```json
{
  "ok": true,
  "titles": ["剧名1", "剧名2"],
  "new_titles": ["剧名1"],
  "all_titles_for_account": ["剧名1", "剧名2"],
  "should_continue": true,
  "reason": "new_titles_found",
  "usage": {
    "provider": "volcengine",
    "model": "doubao-seed-2-0-lite-260215",
    "latency_ms": 8200,
    "screen_calls_for_account": 1,
    "screen_calls_for_run": 8,
    "input_tokens": 1260,
    "output_tokens": 180,
    "total_tokens": 1440
  }
}
```

失败返回示例：

```json
{
  "ok": false,
  "titles": [],
  "should_continue": false,
  "reason": "ai_error",
  "error": "timeout",
  "usage": {
    "screen_calls_for_account": 1,
    "screen_calls_for_run": 8,
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

手机脚本只需要关心：

```text
ok
titles
should_continue
reason
usage.screen_calls_for_run
usage.total_tokens
```

其他复杂逻辑放在后端。

## Token 和调用次数统计

token 统计要做成后端内置能力，不依赖人工去控制台查账单。

每次 AI 调用后，后端读取火山方舟 Responses 返回里的 `usage` 字段。不同兼容接口字段名可能不同，所以实现时要兼容：

```text
input_tokens  或 prompt_tokens
output_tokens 或 completion_tokens
total_tokens
```

后端每次识别都记录一条日志：

```json
{
  "run_id": "20260721_153000_ab12",
  "account": "账号名",
  "screen_index": 0,
  "ok": true,
  "latency_ms": 8200,
  "titles": ["剧名1", "剧名2"],
  "usage": {
    "input_tokens": 1260,
    "output_tokens": 180,
    "total_tokens": 1440,
    "raw_usage": {
      "input_tokens": 1260,
      "output_tokens": 180,
      "total_tokens": 1440
    }
  }
}
```

如果接口没有返回 usage：
- 调用次数仍然精确统计。
- token 字段填 0 或 null。
- 保留 `raw_usage` 为空，日志里标记 `usage_missing=true`。
- 后续再根据真实响应字段补适配，不影响主流程。

建议新增汇总接口：

```http
GET /api/collector/series/recognize/summary?run_id=20260721_153000_ab12
```

返回示例：

```json
{
  "ok": true,
  "run_id": "20260721_153000_ab12",
  "ai_usage": {
    "calls": 18,
    "success_calls": 17,
    "failed_calls": 1,
    "input_tokens": 22800,
    "output_tokens": 2300,
    "total_tokens": 25100,
    "usage_missing_calls": 0
  }
}
```

手机脚本跑完后可以打印：

```text
AI调用次数: 18
AI成功次数: 17
AI失败次数: 1
输入tokens: 22800
输出tokens: 2300
总tokens: 25100
```

## 日志保留限制

识别日志不能无限累计。建议把日志拆成两类：

```text
summary.json
    每轮只保留汇总：调用次数、成功失败次数、token 总量、账号数量、开始/结束时间。

recognition_log.jsonl
    每次 AI 调用一行明细：账号、屏序号、剧名、耗时、错误、usage。
```

默认保留策略：

```text
成功运行：
    删除截图
    删除或压缩 recognition_log.jsonl
    保留 summary.json

失败运行：
    保留失败账号相关截图
    保留 recognition_log.jsonl
    保留 summary.json

debug=true：
    保留本轮全部截图和完整 recognition_log.jsonl
```

全局清理限制：

```text
最多保留最近 30 轮 summary
最多保留最近 7 天的失败诊断日志
runtime/recognition_runs 总目录超过 1GB 时，优先删除最旧的成功运行目录
单个 recognition_log.jsonl 超过 10MB 时轮转为 recognition_log.1.jsonl
```

这样日常只积累很小的 summary 文件，只有失败时才保留可排查材料。

## 后端停止规则

建议后端统一控制每个账号的识别状态。

推荐配置：

```text
每个账号最多 AI 识别 6 屏
连续 2 屏没有新增剧名，就认为到底
每个账号最多采集 12 个剧名
每轮采集最大 AI 调用次数可配置，例如 120 次
```

单账号逻辑：

```text
如果 AI 调用失败：
    停止当前账号
    如果是 key 错、额度不足、服务异常，则触发整轮熔断

如果当前屏识别到新增剧名：
    no_new_count = 0
    如果未达到 12 个剧名，并且未达到 6 屏上限，则继续下滑

如果当前屏没有新增剧名：
    no_new_count += 1
    如果 no_new_count >= 2，则停止当前账号
```

整轮熔断逻辑：

```text
如果出现 key 无效、额度不足、连续多次 AI 服务失败：
    本轮后续账号不再调用 AI
    接口直接返回 should_continue=false
```

这样可以避免配置错误或接口异常时持续消耗额度。

## 截图临时存储策略

后端可以临时保存截图，方便排查问题。

建议路径：

```text
server/data/runtime/recognition_runs/{run_id}/
  account_001_screen_001.jpg
  account_001_screen_002.jpg
  recognition_log.jsonl
```

清理策略：

```text
如果本轮成功：
    删除截图
    只保留精简识别日志和 usage 汇总

如果某张图识别失败：
    保留失败截图和 AI 原始返回，方便排查

如果 debug=true：
    保留本轮全部截图
```

存储压力不大。比如每账号最多 6 屏，30 个账号最多 180 张图；每张压缩后约 200KB - 800KB，一轮通常几十到一百多 MB，跑完删除即可。

## 手机脚本改造范围

保留：
- 账号列表识别
- 进入账号主页
- 点击剧集 Tab
- 截图
- 滑动
- 返回
- 最终上报采集结果

替换：

```text
series_parser.readSeriesNames(image)
```

改为：

```text
backend_recognizer.recognizeSeriesScreen(account, screenIndex, image)
```

手机脚本不再保存：
- ARK_API_KEY
- AI prompt
- 模型名
- AI 调用策略

手机脚本只根据后端返回执行：

```text
titles -> 合并到当前账号剧名列表
should_continue -> 是否继续下滑
ok=false -> 当前账号停止
usage -> 累加或最终打印调用次数和 token
```

## 后端实现步骤

### 1. 增加后端配置

建议放到后端 `.env`：

```text
ARK_API_KEY=...
AI_RECOGNITION_MODEL=doubao-seed-2-0-lite-260215
AI_RECOGNITION_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
AI_RECOGNITION_MAX_OUTPUT_TOKENS=512
AI_RECOGNITION_THINKING_TYPE=disabled
AI_RECOGNITION_REASONING_EFFORT=minimal
AI_MAX_SCREENS_PER_ACCOUNT=6
AI_MAX_NO_NEW_SCREENS=2
AI_MAX_SERIES_PER_ACCOUNT=12
AI_MAX_CALLS_PER_RUN=120
AI_DEBUG_KEEP_SCREENSHOTS=false
AI_RECOGNITION_KEEP_SUMMARY_RUNS=30
AI_RECOGNITION_KEEP_FAILED_DAYS=7
AI_RECOGNITION_MAX_RUNTIME_MB=1024
AI_RECOGNITION_MAX_LOG_MB=10
```

### 2. 新增 AI 识别服务

建议文件：

```text
server/src/services/ai_recognition.py
```

职责：
- 调用火山方舟 Responses
- 发送截图
- 解析 AI 返回 JSON
- 清洗剧名
- 保留封面图/剧名/集数位置规则
- 过滤封面内文字、宣传语、UI 文本和边缘残片
- 提取 usage/token 字段
- 返回结构化结果

### 3. 新增识别会话状态服务

建议文件：

```text
server/src/services/recognition_session.py
```

职责：
- 记录每轮 run_id
- 记录每个账号已经识别几屏
- 记录每个账号已经识别出的剧名
- 记录连续无新增次数
- 记录本轮 AI 总调用次数
- 记录本轮 token 总消耗
- 控制熔断状态
- 管理临时截图目录
- 清理过期 summary、失败日志和截图
- 提供 summary 查询

### 4. 新增后端接口

建议文件：

```text
server/src/routes/collector_recognition.py
```

接口：

```text
POST /api/collector/series/recognize
GET  /api/collector/series/recognize/summary
```

### 5. 修改 AutoJs6 脚本

新增：

```text
src/phase3/backend_recognizer.js
```

让剧集页识别改为：

```text
截图 -> 上传后端 -> 后端返回 titles、should_continue、usage
```

脚本结束时输出后端 summary：

```text
AI调用次数、成功次数、失败次数、输入tokens、输出tokens、总tokens
```

### 6. 验证

先离线验证：

```text
把 12 张 series 样本截图发给本地后端接口，只验证单图剧名识别
对比 expected.json
检查接口返回 titles 是否正确
检查封面内部大字、宣传语、UI 文本是否没有被提升为剧名
检查 usage 是否记录调用次数和 token
检查 summary 是否能汇总整轮 token
检查日志是否按保留策略清理
检查超时、key 错、额度不足时是否熔断
检查成功后截图是否清理
```

继续下滑逻辑不能用这 12 张混合样本验证，因为它们不是同一个账号的连续截图。继续下滑必须用：

```text
同一个账号连续 3-6 张截图
或真机只跑 1 个账号
```

重点验证：

```text
new_titles 是否只包含新增剧名
all_titles_for_account 是否跨屏去重
连续 2 屏无新增是否停止
累计满 12 个剧名是否停止
最多 6 屏是否停止
```

再手机验证：

```text
只跑 1 个账号
确认手机端不再直接调用 AI
确认后端收到截图
确认后端识别结果返回给手机
确认脚本结束时打印 AI 调用次数和 token
确认 Dashboard、通知、入库逻辑不受影响
```

## 迁移顺序

建议按这个顺序做：

```text
1. 保留当前手机端 AI 方案，不删除
2. 新增后端识别接口和 token 统计
3. 用 12 张本地样本测试后端接口
4. 手机脚本改为调用后端识别接口
5. 只跑 1 个账号验证
6. 再跑小批量账号
7. 后端方案稳定后，再移除手机端 AI key 配置要求
```

## 验收标准

满足以下条件才算可用：
- 手机端不再需要 `ai_recognition_config.json`
- AI key 只放在后端 `.env`
- 每个账号最多 6 次 AI 调用
- 连续 2 屏无新增就停止当前账号
- key 错、额度不足、接口异常时整轮熔断
- 每次识别都记录调用次数
- 如果火山返回 usage，每次识别都记录 input/output/total tokens
- 脚本跑完后能看到本轮 AI 调用次数和 token 汇总
- 已有剧集页识别经验规则不能丢失
- 封面内部文字、宣传语、UI 文本不能被当成剧名
- 同账号连续截图能正确验证继续下滑和停止逻辑
- 成功运行后截图自动清理
- 成功运行不无限保留 jsonl 明细日志
- 失败日志最多保留最近 7 天
- summary 默认最多保留最近 30 轮
- 失败截图可保留用于排查
- 原有后端入库、去重、Dashboard、通知不受影响
- 12 张样本可以通过后端接口完成评测
