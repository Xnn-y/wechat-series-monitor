# 微信视频号自动采集脚本

本项目使用 AutoJs6 在手机端采集微信视频号关注账号的剧集信息。当前开发范围只从视频号「我的关注」列表之后开始：遍历关注账号、进入账号主页、点击「剧集」栏，直接在剧集栏页面 OCR 识别可见剧集名称，下滑继续读取，并记录读取时的北京时间。当前只采用本地 OCR 识别和坐标点击，不再调用外部 AI/视觉模型。

## 目录结构

```text
docs/
  README_RUN.md              运行说明
  DEVELOPMENT_PLAN.md        开发计划和阶段验收
src/
  config.js                  全局配置
  master_collect.js          当前主控入口：从“我的关注”列表开始采集
  actions/
    wechat_actions.js        可复用微信点击动作模块
    click_*.js               单步点击动作验证脚本
  flows/
    open_following_list.js   串联动作进入视频号“我的关注”
  collectors/
    collect_current_series.js 单页免费剧集弹窗验证备用
    collect_current_video.js 单视频详情页文案采集备用
  probes/
    probe_accessibility_tree.js
    probe_screen.js
  shared/
    ocr_click.js             OCR 点击辅助
assets/
  templates/                 后续模板匹配图片
logs/                        本地调试留痕
```

## 常用入口

- V1 页面探测：`src/probes/probe_accessibility_tree.js`
- 轻量截图/OCR 探测：`src/probes/probe_screen.js`
- 当前主控采集：`src/master_collect.js`（前置：已经停在“我的关注”列表）
- 打开我的关注流程：`src/flows/open_following_list.js`（可选辅助，不是当前主线）
- 单页免费剧集弹窗验证备用：`src/collectors/collect_current_series.js`
- 单视频详情文案采集备用：`src/collectors/collect_current_video.js`

详细运行步骤见 [docs/README_RUN.md](docs/README_RUN.md)。
