# 微信视频号采集脚本运行说明

## 文件

- `src/config.js`：输出目录、OCR 参数、ROI 区域配置。
- `src/master_collect.js`：当前主控入口，默认从已经打开的「我的关注」列表开始。
- `src/probes/probe_accessibility_tree.js`：无障碍树 + 截图 + OCR 双探测入口。
- `src/probes/probe_screen.js`：只做截图 + ROI + OCR 的轻量入口。
- `src/collectors/collect_current_series.js`：单页免费剧集弹窗验证备用入口，不参与当前主线。
- `src/collectors/collect_current_video.js`：单视频详情页文案采集备用入口。
- `src/shared/ocr_click.js`：OCR 点击辅助模块。

## 手机准备

1. 安装 AutoJs6。
2. 开启 AutoJs6 的无障碍权限。
3. 开启悬浮窗权限。
4. 首次运行截图脚本时，同意截图权限弹窗。
5. 如果使用 Paddle OCR，确认当前 AutoJs6 构建内置或可用 Paddle OCR。

## OCR-only 配置

当前主流程不再调用外部 AI/视觉模型，只使用 AutoJs6 本地 OCR：

- OCR 识别账号主页的 `主页 / 视频 / 剧集` Tab。
- OCR 直接读取剧集栏页面中的剧集名称。
- 记录读取时的北京时间，不再读取页面发布时间。
- OCR 识别账号主页的 `主页 / 视频 / 剧集` Tab。

在 `src/config.js` 中确认：

```javascript
ocr: {
    enabled: true,
    mode: "paddle",
    fallbackModes: ["paddle", "mlkit", "rapid", "generic"]
},
series: {
    titleRecognitionMode: "ocr_score"
}
```

不需要填写 API Key，`src/config.js` 中也不再保留 `visionApi` 配置。

## 推荐运行顺序

当前主线不再验证“微信主页 -> 发现 -> 视频号 -> 我的关注”的前置导航，只开发「我的关注」列表之后的动作。

1. 手动打开微信视频号「我的关注」列表。
2. 在 AutoJs6 中运行 `src/master_collect.js`。
3. 观察日志是否出现 `入口: 已假设当前在「我的关注」列表，跳过前置导航`。
4. 确认脚本能 OCR 读取可见关注账号，并点击目标账号进入主页。
5. 进入账号主页后，确认日志出现 `账号主页 Tab`、`点击「剧集」Tab`、`剧集栏 OCR 候选`。
6. 进入账号主页 `剧集` 栏后，确认脚本直接 OCR 读取可见剧集名称，并把读取时的北京时间写入 CSV。

探测脚本只在某个页面识别失败时再单独运行，用于校准 ROI 和坐标。

## VS Code 联调说明

如果使用 VS Code 插件的“运行当前文件”，插件可能只发送当前脚本内容到手机，不会同时发送 `src/config.js`。因此 `src/probes/probe_accessibility_tree.js` 和 `src/probes/probe_screen.js` 已内置默认配置：

- 只运行当前文件：可以直接跑。
- 同步整个 `src/` 目录：探测脚本会优先尝试读取 `src/config.js`，用于覆盖默认配置。

推荐 V1 验证时先直接运行 `src/probes/probe_accessibility_tree.js` 当前文件；确认能生成输出后，再考虑同步整个 `src/` 目录。

## 需要分别探测的页面

- 微信「发现」页。
- 视频号首页。
- 视频号个人页。
- 「我的关注」列表。
- 任意目标账号主页。
- 任意视频详情页，最好包含 `3分钟前` 或 `1小时前`。
- 任意视频详情页，最好包含 `3小时前` 或更早。

## 输出说明

每次运行会创建一个类似下面的目录：

```text
/sdcard/Download/wechat_video_probe/20260703_101530/
```

主要文件：

- `environment.json`：设备、微信版本、当前包名、当前 Activity。
- `accessibility_tree.json`：当前页面无障碍树。
- `screenshot.png`：当前整屏截图。
- `screen_probe.json`：截图和 OCR 汇总。
- `ocr_fullscreen.json`：整屏 OCR 结果。
- `ocr_roi_*.json`：各个 ROI 的 OCR 结果。
- `roi_*.png`：各个 ROI 裁剪图。
- `summary.txt`：人眼快速查看的摘要。
- `log.txt`：运行日志。

## AutoJs6 辅助操作

AutoJs6 自带布局分析时，可以打开悬浮按钮里的布局分析功能；也可以运行示例里的“音量减键分析布局”，用音量减键触发布局范围显示。

重点记录关键控件的：

- `fullId` / `id`
- `text`
- `desc`
- `className`
- `bounds`
- 是否 `clickable`
- 是否 `scrollable`

## 判断标准

- 如果 `accessibility_tree.json` 能看到账号名、关注入口、返回按钮或列表容器，后续优先用节点。
- 默认不等待微信前台，运行即采样；如果 `当前包名` 或 `包名匹配微信` 看起来不对，先结合 `screenshot.png` 判断是否确实采到了目标页面。
- 如果 `summary.txt` 里 `节点总数` 仍然是 1，请看 `根节点候选` 日志和 `平铺节点` 数量；平铺节点大于 1 也说明选择器还能读到一部分无障碍节点。
- OCR 会按 `paddle -> mlkit -> rapid -> generic` 自动回退；如果都失败，`summary.txt` 会把每种模式的失败原因列出来。
- 如果节点没有文本但有 `bounds`，后续用节点提供坐标，OCR 提供文字。
- 当前主线不读取页面发布时间，也不进入剧集详情页；剧集名称直接来自账号主页 `剧集` 栏页面。
- 如果 OCR 干扰大，调整 `src/config.js` 里的 ROI。

## 单页免费剧集弹窗验证备用

运行入口：`src/collectors/collect_current_series.js`。

这个入口是备用工具，不参与当前阶段 1 主线。当前主线不再打开免费剧集弹窗。

输出位置：

```text
/sdcard/Download/wechat_video_series/
/sdcard/Download/wechat_video_series.csv
```

验证步骤：

1. 手动打开一个视频详情页，确保左下区域能看到“免费剧集：xxx 全xx集”入口。
2. 运行 `src/collectors/collect_current_series.js`。
3. 脚本会先 OCR 查找包含“免费剧集 / 剧集 / 全xx集”的入口整行，并点击胶囊框中部；如果 OCR 没命中，会使用 `src/config.js` 里的 `series.fallbackClickRatio` 备用坐标。
4. 等弹出第二张图那种剧集面板后，脚本会 OCR 点击前详情页和 `series_panel_title` ROI。
5. 打开最新 `/sdcard/Download/wechat_video_series/时间戳/summary.txt`。
6. 先只看 `summary.txt` 里的 `状态`、`剧名`、`点击`、`识别`、`CSV`。
7. 检查 `剧名` 是否正确，例如第二张图应识别为 `三千万项目后，她成了总裁`。
8. 检查 `/sdcard/Download/wechat_video_series.csv` 是否新增记录。

本阶段只验证“当前视频详情页 -> 免费剧集弹窗 -> 返回剧集名称”。不再读取页面发布时间。

当前默认只使用 OCR 识别剧名。主控脚本会另外记录读取时的北京时间。

默认输出保持简洁，只保留：

```text
summary.txt
collect_current_series.json
after_panel.png
roi_free_series_entry.png
roi_series_panel_title.png
```

如果点击位置不准，先看 `roi_free_series_entry.png` 是否裁到入口条；如果没裁到，调整 `free_series_entry` ROI。如果裁到了但点位偏，调整 `series.freeEntryClickXRatioInLine` 或 `series.freeEntryClickYPadding`。如果剧名裁剪不准，调整 `series_panel_title` ROI。

需要查看 OCR 候选、完整路径和日志时，把 `src/config.js` 里的：

```javascript
debugSummary: true,
saveDebugArtifacts: true
```

再运行一次。

## 打开“我的关注”流程验证

运行入口：`src/flows/open_following_list.js`。

这一段现在只是可选辅助流程，不是当前主线。主控脚本默认不会调用它。

前置条件：建议先停在微信主界面，底部能看到“微信 / 通讯录 / 发现 / 我”。

流程：

1. OCR 点击底部“发现”。
2. OCR 点击“视频号”。
3. 固定比例点击右上角个人中心图标。
4. OCR 点击“关注”。
5. 每步点击后做轻量 OCR 验证，失败就停止。

输出位置：

```text
/sdcard/Download/wechat_video_flow/
```

默认只保存：

```text
summary.txt
open_following_list.json
```

先看 `summary.txt` 里的 `状态`、`停止步骤` 和每一步的 `verify`。如果某一步点错，再单独运行对应的 `src/actions/click_*.js` 校准 ROI 或 fallback 坐标。

## 阶段 1：关注列表后 12 部剧采集验证

当前总控入口：`src/master_collect.js`。

前置条件：手动停在视频号「我的关注」列表。`src/master_collect.js` 默认 `ASSUME_ALREADY_ON_FOLLOWING_LIST = true`，不会再自动点击发现、视频号、个人中心或关注入口。

目标：从「我的关注」列表开始，进入关注账号主页，点击 `剧集`，直接在剧集栏页面 OCR 读取可见剧集名称，并把 `账号 + 剧名 + 读取北京时间` 写入 CSV。每个账号每轮最多读取 12 部剧；CSV 中已存在同账号同剧名时跳过不写。

从关注列表进入账号主页后，脚本会先 OCR 识别账号主页顶部的三个 Tab：

```text
主页
视频
剧集
```

识别到 `剧集` 后点击该 Tab，停留在如截图所示的剧集栏页面。脚本直接按从上到下、从左到右 OCR 读取可见剧名；当前页读完后向下滑动，继续读取，直到当前账号读取 12 部或连续无可读剧集。

验证顺序：

1. 手动打开「我的关注」列表。
2. 运行 `src/master_collect.js`。
3. 日志应先出现：

```text
入口: 已假设当前在「我的关注」列表，跳过前置导航
```

4. 随后应出现类似：

```text
账号主页 Tab: 主页=true 视频=true 剧集=true
点击「剧集」Tab: x=... y=... source=ocr_tab
剧集栏 OCR 候选: xxx / yyy / zzz
剧集[1/12]: xxx | 读取时间 2026-07-06 HH:mm:ss
已写入CSV: xxx
```

5. 检查 `/sdcard/Download/wechat_video_watch.csv` 表头应为：

```text
账号,剧名,读取北京时间
```

6. 第一次运行：确认至少写入当前账号识别到的剧集，目标是最多 12 条。
7. 第二次运行同一账号：确认日志出现 `CSV 已存在，跳过`，CSV 不重复增加相同 `账号 + 剧名`。
8. 当前账号剧集页一屏读完后，确认脚本会向下滑动继续读取下一屏。

截图权限异常处理：

- 如果日志出现 `captureScreen 异常` 或 `Don't re-use the resultData`，先确认没有同时运行多个 AutoJs6 脚本。
- 当前 `src/master_collect.js` 已统一使用安全截图封装，会自动冷却后重试；偶发一次重试日志不算失败。
- 如果连续失败，停止 AutoJs6 当前脚本，重新运行 `src/master_collect.js`，并在系统截图权限弹窗中重新允许。

如果识别不到 `剧集`，脚本会使用备用比例坐标 `SERIES_TAB_FALLBACK = [0.335, 0.365]`。如果点击偏了，就优先调这个坐标。

阶段通过标准：

- 能从「我的关注」列表进入账号主页。
- 能进入 `剧集` Tab。
- 能在剧集栏页面直接 OCR 读到剧名。
- 当前页读完后能下滑继续读取。
- CSV 写入 `账号,剧名,读取北京时间`。
- 重复运行不会写入同账号同剧名。
- 当前账号最多读取 12 部后停止。

这个阶段验证通过后，再进入下一步：扩大到更多关注账号和处理长 CSV 查询效率。
