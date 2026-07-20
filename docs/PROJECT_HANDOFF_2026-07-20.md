# 项目交接结点：2026-07-20

> 目的：这是当前 `wechat-series-monitor` 项目的上下文压缩结点。后续如果开启新会话、推翻当前 OCR 路线、或改为 AI 识图方案，优先读取本文件，而不是回看整段历史对话。

## 1. 当前可用状态

- 最新确认提交：`198d205 fix(phase3): 提升剧集采集稳定性`
- 当前主线：`master`
- 当前架构已经从“手机脚本 + 本地 CSV”升级为：

```text
AutoJs6 手机采集脚本
  -> 本地 CSV/JSON 备份
  -> Flask 后端 API 上报
  -> SQLite 去重入库
  -> Web Dashboard 查看/筛选/维护
  -> 企业微信机器人通知新增剧集
```

线上入口：

```text
后台：      http://atool.fz-ue.com/dashboard
健康检查：  http://atool.fz-ue.com/health
手机上报：  http://atool.fz-ue.com/api/collect
```

当前域名分配：

```text
atool.fz-ue.com          -> 微信剧集监控
8.163.72.189:8081/8082  -> 图鸭项目
```

## 2. 代码结构速览

```text
src/phase3/
  main.js             主采集流程：遍历关注账号、进入账号、采集剧集、上报
  config.js           AutoJs6 配置、后端地址、OCR 引擎、滑动阈值
  screen.js           截图、滑动、返回等设备动作
  ocr.js              多 OCR 引擎调用与评分：paddle/mlkit/rapid/generic
  account_parser.js   关注列表账号识别、主页账号名识别、边界过滤
  actions.js          点击账号、点击剧集 Tab、页面判断
  series_parser.js    剧集页标题识别、剧名清洗、去重合并
  text_utils.js       繁简处理、OCR 纠错、标准账号归一、字符串相似度
  reporter.js         上报后端、同步标准账号库、心跳

src/phase3_full_collect.js
  AutoJs6 可直接运行的合成单文件。修改 src/phase3 后必须重新生成。

server/src/
  app.py              Flask app 入口
  routes/api.py       API、Dashboard、登录、标准账号库、OCR 别名
  db/database.py      SQLite 表结构、默认标准账号
  services/collector.py  采集数据归一、去重、入库
  services/notifier.py   企业微信通知
  static/dashboard.html  Web 后台单页
```

生成手机脚本：

```powershell
node tools\build_phase3_full_collect.js
```

本地检查：

```powershell
node --check src\phase3_full_collect.js
python server\tests\test_api.py
python server\tests\test_dashboard.py
python server\tests\test_e2e.py
```

## 3. 已完成的关键优化

### 3.1 后端与 Dashboard

- 增加 Flask 后端、SQLite 存储、去重入库、CSV 导出。
- 增加 Dashboard 登录页，支持查看采集记录、设备状态、筛选账号/剧名。
- 增加企业微信机器人通知：新增剧集入库后推送摘要。
- 增加设备心跳与离线判断，`DEVICE_OFFLINE_MINUTES` 当前服务器配置曾使用 `150`。
- 增加标准账号库：
  - 后台可添加/删除标准账号。
  - 手机端启动时通过 `/api/standard-accounts` 同步标准账号库。
  - 手机端内置标准账号作为后端同步失败时的兜底。
- 增加 OCR 别名管理：
  - 后端有 `ocr_aliases` 表。
  - Dashboard 可管理 OCR 错误文本到正确文本的映射。

### 3.2 关注列表遍历

解决过的问题：

- 已进入过的关注账号不应重复进入。
- 下滑时账号卡在屏幕边缘，OCR 会识别出头像、小字、客服、分享等非账号内容。
- 账号名包含繁体字时一般视为 OCR 错误，不作为最终账号名覆盖。
- 只采集标准账号，避免把非账号脏文本入库。
- 新关注账号可通过后台添加进标准账号库。

当前策略：

- `allowUnknownAccounts=false`，采集时只从标准账号候选中选择。
- 标准账号之间不再用宽松相似度判成“同一个已处理账号”，避免 `新想象短剧 / 新想象AI剧场 / 新想象AI短剧` 互相跳过。
- 账号 OCR 纠错和保守相似匹配集中在 `text_utils.js`。
- 已处理账号、锚点寻找、小幅滑动、下一行最大间距等逻辑在 `main.js`。

已知标准账号曾包括：

```text
鬼谷剧场
虾仁无下限
西柚虾
江十三动画
米糕短剧
微码剧场
漫绘短剧社
微时光短剧场
欢乐时光短剧场
美好时光短剧场
快乐时光短剧场
漫剧放映屋剧场
漫剧星隅剧场
漫剧拾光剧场
玲和美
阿文爱看剧
萌萌虎剧场
玖爱看漫剧
超爽漫剧
甜文禁
柒柒书漫
天使不会哭呀
金森文化
白脸蛋剧场
金天漫剧
逐梦漫剧
娃娃漫剧
啵啵漫剧
陈先生勒剧场
新想象短剧
新想象AI剧场
新想象AI短剧
```

### 3.3 账号 OCR 纠错

已处理的典型错误：

```text
玲利姜 / 玲利美             -> 玲和美
玖愛看漫剧 / 玫爱看漫剧      -> 玖爱看漫剧
起爽浸剧 / 超爽浸剧          -> 超爽漫剧
西袖虾                      -> 西柚虾
阿女爱看剧                  -> 阿文爱看剧
甜女禁                      -> 甜文禁
金天浸剧 / 金夭漫剧          -> 金天漫剧
破破漫剧 / 破暖漫剧          -> 啵啵漫剧
陳先生勒剧场                 -> 陈先生勒剧场
```

目前不是无限放宽相似度，而是：

- 优先走明确账号级纠错。
- 再进行标准账号库内的保守相似匹配。
- 要求长度接近、尾部一致、最佳匹配明显高于第二名。
- 歧义明显的文本不强行归类。

### 3.4 剧集 Tab 点击

修过的问题：

- 主页内容区的 `剧集(45)` 被误当成顶部 `剧集` Tab。
- 有时进入账号后截图还没稳定，导致找不到顶部 `剧集` Tab。
- OCR 只识别到 `主页/视频`，漏识别 `剧集`。
- `天使不会哭呀` 曾误判“当前已在剧集页”，导致跳过 Tab 后采集失败。

当前策略在 `actions.js`：

- 点击 Tab 前重新截图并重试。
- 只把 `主页/视频/剧集` 同一行附近的 `剧集` 当 Tab。
- 排除带数量的 `剧集(45)`。
- 如果同一行右侧有 `全部`，认为是主页内容区标题，不点击。
- 如果只看到 `主页/视频`，按同一行间距推算 `剧集` Tab 位置。
- `天使不会哭呀` 强制点击 `剧集` Tab，不允许走“已在剧集页，跳过 Tab”分支。

### 3.5 剧名解析与清洗

修过的问题：

- 剧名不能包含繁体字。
- 剧名只允许中文/英文/数字，以及逗号、冒号。
- 海报图片内的小字、宣传语可能被 OCR 拼到剧名里。
- 长剧名换行时可能只识别到前半段或后半段。
- `《》`、竖线、斜杠等符号会污染剧名。

当前策略在 `series_parser.js`：

- 优先从集数附近读取标题。
- 只取离集数最近的连续标题行，避免把海报宣传语拼进标题。
- 往上合并标题行时要求字号接近，保留正常换行标题。
- 通过 `text_utils.sanitizeSeriesTitleSymbols()` 清理多余符号。

## 4. 当前仍然脆弱的地方

OCR 方案本质上仍然不稳定，主要风险：

1. 微信页面变化、字体变化、暗色/亮色、网络慢加载，都会影响 OCR 和坐标判断。
2. 账号列表滚动仍依赖锚点、行距和屏幕边界，极端情况下可能卡住或跳过。
3. 标准账号库能挡住脏账号，但也要求新账号及时加入标准库。
4. 剧名依赖“集数附近标题”这一 UI 规律，如果微信布局改变会失效。
5. 海报大字和剧名真实标题有时高度接近，仍可能误判。
6. `requestScreenCapture` 可能出现 AutoJs6 虚拟显示数量达到上限，需要重启 AutoJs6/手机释放。
7. 全流程跑一次时间较长，验证成本高。

## 5. 如果下一步改为 AI 识图，建议不要推翻全部

建议保留：

- 后端 API、数据库、去重、通知、Dashboard。
- 标准账号库。
- 手机端页面动作：进入账号、返回、滑动、点击。
- 本地 CSV/JSON 备份。
- 日志格式和采集结果结构。

建议替换或抽象：

```text
当前：截图 -> OCR items -> account_parser / series_parser
未来：截图 -> AI 识图 JSON -> account_parser / series_parser 或新 parser
```

最好先定义一个“识别层适配器”，而不是把 AI 调用直接塞进主流程：

```javascript
recognizer.detectFollowingAccounts(image) -> [{ label, bounds, centerY, confidence }]
recognizer.detectProfile(image)           -> { accountName, tabs, isSeriesPage, confidence }
recognizer.detectSeriesCards(image)       -> [{ title, episodes, bounds, confidence }]
recognizer.detectTabs(image)              -> [{ label, bounds, confidence }]
```

第一阶段建议做混合策略：

1. OCR 正常高置信时继续用 OCR。
2. OCR 找不到 Tab、账号不在标准库、剧名疑似过长/过脏时，才调用 AI 兜底。
3. 先不直接自动入库 AI 结果，可先打日志或写本地 debug 文件，积累样本。
4. 采样 20-50 张真实截图做离线评测，再决定是否全量替换。

这样可以控制成本，避免“一个循环 bug 持续调用 AI 烧钱”。

## 6. AI 识图方向的最小实验设计

建议新增目录：

```text
experiments/ai_recognition/
  samples/              手动放真实截图
  expected.json          人工标注的期望账号/剧名
  run_eval.*             调用 AI 或 mock AI 的评测脚本
  REPORT.md             记录准确率、失败样例、成本估算
```

评测目标：

- 关注列表：识别账号名、过滤头像/客服/分享/页面小字。
- 主页：识别 `主页/视频/剧集` Tab 位置，判断是否需要点击。
- 剧集页：识别卡片标题和集数，不读取海报宣传语。
- 返回格式必须稳定 JSON，不能只返回自然语言。

建议先回答这几个问题：

1. 一次完整采集大约截图多少张？
2. AI 调用是否只在失败兜底时使用？
3. AI 是否需要返回坐标，还是只返回文本？
4. 手机端直接调用 AI，还是截图上报后端由后端调用 AI？
5. AI 识别失败时是否允许跳过当前账号，而不是重试烧钱？

## 7. 下一会话如何无痛衔接

新会话不需要复制这整个历史聊天。建议只提供以下内容：

1. 仓库路径：

```text
F:\Py_project\Test\20260702
```

2. 交接文档：

```text
docs/PROJECT_HANDOFF_2026-07-20.md
```

3. 最新稳定提交：

```text
198d205 fix(phase3): 提升剧集采集稳定性
```

4. 想做的新方向，例如：

```text
我要从当前 OCR 方案切到 AI 识图兜底/替代方案，先不要大改主流程，请先读 docs/PROJECT_HANDOFF_2026-07-20.md、README.md 和当前 git 状态，然后给我一个最小实验方案。
```

## 8. 下一会话推荐开场提示词

可以直接复制：

```text
你接手的是 F:\Py_project\Test\20260702 的 wechat-series-monitor 项目。
请先读取 docs/PROJECT_HANDOFF_2026-07-20.md 和 README.md，再看 git log -3 / git status。
当前稳定结点是 198d205 fix(phase3): 提升剧集采集稳定性。
我准备后续从 OCR 识别方向转向 AI 识图识别，但不想推翻后端、标准账号库、通知和 Dashboard。
请先基于交接文档总结当前架构、风险点，并给出一个最小可验证的 AI 识图替代/兜底方案。
在我确认前不要直接大改主流程。
```

如果只是继续修当前 OCR 脚本，可以改成：

```text
请基于 docs/PROJECT_HANDOFF_2026-07-20.md 接着修当前 OCR 采集脚本。
优先保持 src/phase3 模块化源码和 src/phase3_full_collect.js 同步。
每次修改后运行 node tools\build_phase3_full_collect.js 和 node --check src\phase3_full_collect.js。
```

## 9. 当前工作原则

- 不要直接修改 `src/phase3_full_collect.js`，应先改 `src/phase3/`，再运行构建脚本生成。
- 后端 `.env`、数据库、真实 webhook 不提交。
- 手机端脚本改动一般不需要重启后端。
- 后端 API、Dashboard、数据库 schema 改动需要重启服务器服务。
- 新增账号优先通过后台标准账号库维护。
- 对 OCR 识别错误，优先用后台 OCR 别名或 `text_utils.js` 账号级纠错，不要轻易放宽全局相似度。
- 如果引入 AI 识图，必须先做离线样本评测和成本控制，不要直接接入主循环全量调用。
