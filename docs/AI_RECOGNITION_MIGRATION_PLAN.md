# AI 识图识别层改造计划

> 目标：用 AI 识图替换当前 OCR 识别层，但不推翻 AutoJs6 页面动作、标准账号库、后端 API、SQLite 去重、企业微信通知和 Dashboard。

## 1. 改造原则

- AI 只替换“截图到结构化识别结果”这一层，不接管整个采集流程。
- 保留现有手机端动作层：截图、点击账号、点击 Tab、返回、滑动、收尾回到关注列表。
- 保留现有业务层：标准账号库、采集上报、去重入库、通知、Dashboard、CSV/JSON 本地备份。
- 先做离线实验和 shadow mode，不直接把 AI 结果接入主循环通知。
- OCR 里沉淀的页面经验不能丢，应迁移为 AI prompt、JSON schema 和后处理校验规则。
- 任何低置信、边缘裁切、结构不完整的结果都跳过或暂存，不反复重试烧成本。

## 2. 当前需要替换的范围

当前识别链路：

```text
screen.ensureCapture()
  -> ocr.ocrScreen()
  -> account_parser / actions / series_parser
  -> account / tab / series title
```

目标识别链路：

```text
screen.ensureCapture()
  -> recognizer.detect*
  -> AI JSON
  -> 规则校验
  -> account / tab / series card
```

明确保留：

```text
src/phase3/main.js              遍历状态机先尽量保留
src/phase3/screen.js            截图、滑动、返回
src/phase3/reporter.js          标准账号同步、上报、心跳
server/src/routes/api.py        API 和 Dashboard 路由
server/src/services/collector.py 入库、去重，后续增强通知保护
server/src/services/notifier.py 企业微信通知
```

逐步替换或抽象：

```text
src/phase3/ocr.js               从主识别入口退为回滚/对照
src/phase3/account_parser.js    保留账号清洗和标准账号校验，减少 OCR items 行解析
src/phase3/actions.js           Tab 定位改吃 AI 返回坐标
src/phase3/series_parser.js     剧集标题解析改吃 AI 返回卡片
src/phase3/text_utils.js        保留归一化、相似度、标准账号匹配
```

## 3. OCR 经验迁移规则

### 3.1 OCR 专用逻辑

这些逻辑后续可以弱化：

- OCR 多引擎选择和评分。
- OCR items 按行合并。
- 依赖 OCR 框高度、行距、字号的标题拼接。
- 账号级 OCR 错字替换作为主识别手段。

### 3.2 页面领域规则

这些逻辑必须迁移到 AI 识别协议和后处理：

- 剧名通常位于封面卡片下方、集数上方。
- 业务结果只需要剧名；集数只作为辅助锚点，用来确认卡片下方正式标题区域已经露出。
- 不要求整张卡片完整露出；只要卡片下方正式剧名和集数同时露出，就可以采集。
- 屏幕顶部或底部被裁切的卡片标记为 incomplete，不进入采集结果。
- 不读取封面内部宣传语、大字海报文案、角标、按钮、标签作为剧名。
- 标题换行时，只合并同一卡片内连续标题行。
- 剧集 Tab 必须位于主页/视频同一行附近。
- 不能把主页内容区的 `剧集(45)` 当作顶部 Tab。
- 关注列表账号必须在安全区域内，不能取头像、小字、客服、分享等内容。

### 3.3 业务保护规则

这些规则继续保留并加强：

- `allowUnknownAccounts=false`，AI 识别出的账号仍必须匹配标准账号库。
- 已处理账号、锚点、下一行选择、滚动策略仍由主流程控制。
- 同账号相似剧名不应直接触发新增通知。
- AI 低置信结果跳过或写 debug，不自动入库。
- 每张截图最多调用一次 AI，避免页面卡住时持续调用。

## 4. 统一识别协议

建议新增统一识别入口：

```text
src/phase3/recognizer.js
src/phase3/ai_recognizer.js
src/phase3/ocr_recognizer.js
src/phase3/recognition_rules.js
```

主流程只依赖：

```javascript
recognizer.detectFollowingAccounts(image)
recognizer.detectProfile(image)
recognizer.detectSeriesPage(image)
recognizer.detectFollowingListState(image)
```

### 4.1 关注列表返回格式

```json
{
  "pageType": "following",
  "confidence": 0.9,
  "followTotal": 32,
  "accounts": [
    {
      "label": "西柚虾",
      "center": [520, 430],
      "bounds": [160, 390, 720, 470],
      "isCompleteRow": true,
      "confidence": 0.93
    }
  ],
  "warnings": []
}
```

### 4.2 主页和 Tab 返回格式

```json
{
  "pageType": "profile",
  "confidence": 0.9,
  "accountName": "西柚虾",
  "isSeriesPage": false,
  "tabs": [
    { "label": "主页", "center": [180, 330], "bounds": [140, 305, 220, 360], "confidence": 0.9 },
    { "label": "视频", "center": [320, 330], "bounds": [280, 305, 360, 360], "confidence": 0.9 },
    { "label": "剧集", "center": [460, 330], "bounds": [420, 305, 500, 360], "confidence": 0.88 }
  ],
  "warnings": []
}
```

### 4.3 剧集页返回格式

```json
{
  "pageType": "series",
  "confidence": 0.91,
  "seriesCards": [
    {
      "title": "某某剧名",
      "episodes": 80,
      "bounds": [40, 420, 1020, 760],
      "titleBounds": [80, 650, 720, 700],
      "episodeBounds": [80, 705, 180, 740],
      "isCompleteCard": true,
      "incompleteReason": null,
      "confidence": 0.9,
      "warnings": []
    }
  ],
  "warnings": []
}
```

边缘卡片示例：

```json
{
  "title": "某某剧名",
  "episodes": null,
  "isCompleteCard": false,
  "incompleteReason": "card_edge_cut_off",
  "confidence": 0.62
}
```

## 5. 阶段计划

### 阶段 0：建立实验目录

新增：

```text
experiments/ai_recognition/
  samples/following/
  samples/profile/
  samples/series/
  expected.json
  schema.json
  rules.md
  run_eval.py
  REPORT.md
```

目标：

- 不修改主流程。
- 收集真实截图样本。
- 把页面规则写成 `rules.md`。
- 用 `expected.json` 标注账号、Tab、剧名和完整卡片状态；集数可作为辅助锚点记录。

验证：

```text
run_eval.py 可以读取样本、校验 schema、输出 REPORT.md。
即使暂时使用 mock AI 输出，也要先跑通评测流程。
```

### 阶段 1：AI 离线评测

目标：

- 对关注列表、主页、剧集页分别调用 AI。
- 要求 AI 只返回 JSON。
- 统计准确率、漏识别、误识别、JSON 格式失败、耗时和成本。

重点样本：

```text
关注列表：账号在边缘、头像干扰、小字干扰、客服/分享文本。
主页：Tab 正常、Tab 漏识别、页面未加载完、已有剧集页。
剧集页：长标题、换行标题、海报宣传语、顶部裁切、底部裁切、集数不可见但标题区域可判断的场景。
```

通过标准：

```text
JSON 格式稳定。
剧集完整卡片判断可靠。
剧名识别明显优于 OCR，集数只作为辅助锚点/debug 字段。
AI 不频繁脑补不存在的剧名。
```

### 阶段 2：引入 recognizer 抽象但不接管

新增识别抽象：

```text
src/phase3/recognizer.js
src/phase3/ai_recognizer.js
src/phase3/ocr_recognizer.js
```

配置新增：

```javascript
recognition: {
    mode: "ocr",        // ocr | ai_shadow | ai
    aiEnabled: false,
    minConfidence: 0.78,
    maxAiCallsPerScreen: 1
}
```

目标：

- `mode="ocr"` 时行为不变。
- `mode="ai_shadow"` 时调用 AI 并写 debug，但不影响采集结果。
- `mode="ai"` 后续才接管识别。

验证：

```text
node tools\build_phase3_full_collect.js
node --check src\phase3_full_collect.js
```

### 阶段 3：剧集页 AI shadow mode

目标：

- 在 `collectSeries()` 中保留 OCR 结果作为正式结果。
- 同时调用 AI 识别剧集页，记录 AI 返回的 cards。
- 对比 OCR title 与 AI title，不改变上报内容。

记录内容：

```text
截图时间
账号名
OCR 识别剧名
AI 识别卡片
AI incomplete 原因
AI 置信度
差异说明
```

通过标准：

```text
AI 能稳定识别完整卡片。
AI 能正确跳过边缘卡片。
AI 对长标题、错字、海报宣传语的表现优于 OCR。
```

### 阶段 4：剧集页 AI 正式接管

目标：

- `collectSeries()` 改为使用 AI `detectSeriesPage()` 的 cards。
- `series_parser.mergeAndDedup()` 可保留，但输入建议升级为 `{title, episodes, confidence}`，其中 `episodes` 只作为辅助锚点/debug 字段。
- OCR 保留为回滚路径。

入采规则：

```text
isCompleteCard = true
title 非空
confidence >= minConfidence
标题通过 sanitizeSeriesTitleSymbols
```

验证：

```text
node tools\build_phase3_full_collect.js
node --check src\phase3_full_collect.js
小范围手机实测 1-3 个账号，不全量跑。
```

### 阶段 5：剧集 Tab AI 接管

目标：

- `actions.clickSeriesTab()` 改为优先使用 AI 返回的 `tabs`。
- 后处理继续校验 `剧集` Tab 与 `主页/视频` 同行。
- 排除 `剧集(数字)` 和主页内容区标题。
- 对 `天使不会哭呀` 这类特殊账号保留强制点击策略，直到样本证明不需要。

验证：

```text
主页能正确点击剧集 Tab。
已经在剧集页时能识别 isSeriesPage。
不会误点内容区的 剧集(45)。
```

### 阶段 6：关注列表 AI 接管

目标：

- `account_parser.extractAccounts()` 从 OCR items 行解析改为消费 AI `accounts`。
- 但 `main.js` 的遍历状态机先保留：
  - `processedAccounts`
  - `lastAccountLabel`
  - `pickNextAccount`
  - `anchorVisible`
  - `scrollDownSmall`
  - `scrollDownRevealNextAccount`

入选规则：

```text
isCompleteRow = true
confidence >= minConfidence
label 匹配标准账号库
bounds 在安全区域内
```

验证：

```text
不会采未知账号。
不会重复进入已处理账号。
标准账号名称相近时不互相跳过。
滚动到底逻辑仍正常。
```

### 阶段 7：后端新增相似剧名通知保护

当前问题：

```text
后端按 account_name_normalized + series_name_normalized 唯一约束去重。
只要识别错 1 个字，就会被当作新剧并通知。
```

目标：

- 在 `process_collect()` 插入前查询同账号历史剧名。
- 如果新剧名与历史剧名高度相似但不完全相同，标记为 suspicious。
- suspicious 记录第一版可以不通知，或进入 pending 表等待人工确认。

建议字段或表：

```text
pending_series_records
  id
  run_id
  account_name_raw
  series_name_raw
  episodes_raw
  matched_existing_id
  matched_existing_title
  similarity
  reason
  created_at
```

第一版也可以先不建完整人工确认流程，只在返回结果中增加：

```json
{
  "suspicious_records": [
    {
      "account": "西柚虾",
      "series": "疑似错字剧名",
      "matched_series": "历史相似剧名",
      "similarity": 0.92,
      "action": "skipped_notification"
    }
  ]
}
```

验证：

```text
同账号相似错字不会触发企业微信新增通知。
完全不同新剧仍正常入库和通知。
Dashboard 仍能查看正常记录。
```

### 阶段 8：清理 OCR 专用逻辑

条件：

```text
AI 剧集页、Tab、关注列表都已通过实测。
至少保留一段时间可回滚的 ocr mode。
后端通知保护已生效。
```

可清理：

- 不再使用的 OCR 行合并逻辑。
- 过多账号 OCR 错字硬编码。
- 只服务 OCR items 的标题拼接逻辑。

仍建议保留：

- `text_utils` 的归一化、相似度、标准账号匹配。
- OCR 回滚入口，至少保留到 AI 路线稳定后再删除。

## 6. 验证清单

每个阶段至少执行：

```powershell
node tools\build_phase3_full_collect.js
node --check src\phase3_full_collect.js
```

涉及后端时执行：

```powershell
python server\tests\test_api.py
python server\tests\test_dashboard.py
python server\tests\test_e2e.py
```

AI 实验阶段执行：

```powershell
python experiments\ai_recognition\run_eval.py
```

手机小范围实测顺序：

```text
1 个账号 -> 3 个账号 -> 10 个账号 -> 全量账号
```

每次实测必须检查：

```text
是否误进账号
是否误点 Tab
是否采到边缘不完整剧名
是否把海报宣传语当剧名
是否产生错字新增通知
AI 调用次数和成本是否可控
失败时是否跳过而不是无限重试
```

## 7. 不建议立即做的事

- 不要直接大改 `src/phase3/main.js` 主状态机。
- 不要立即删除 `ocr.js`。
- 不要让 AI 结果绕过标准账号库。
- 不要让 AI 结果直接绕过后端去重和通知逻辑。
- 不要在页面卡住时反复调用 AI。
- 不要在没有离线样本评测的情况下全量上线。

## 8. 推荐实施顺序

```text
1. 新建 experiments/ai_recognition 实验骨架。
2. 整理 rules.md，把 OCR 经验迁移成 AI 规则。
3. 收集 20-50 张真实截图并人工标注 expected.json。
4. 跑通 AI JSON schema 评测。
5. 加 recognizer 抽象和 ai_shadow 模式。
6. 剧集页 AI shadow 对比。
7. 剧集页 AI 正式接管。
8. 剧集 Tab AI 接管。
9. 关注列表 AI 接管。
10. 后端相似剧名通知保护。
11. 稳定后清理 OCR 专用逻辑。
```
