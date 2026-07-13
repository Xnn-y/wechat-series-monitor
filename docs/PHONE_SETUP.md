# 手机端 AutoJs6 免打扰配置指南

目标：让 AutoJs6 脚本运行时不会弹出任何权限确认、电池优化、悬浮窗等弹窗打断采集流程。

适用机型：华为 P30 / EMUI / 鸿蒙，其他品牌大同小异。

---

## 1. ADB 授权（推荐，一次性）

手机连电脑，开启 USB 调试后执行：

```cmd
adb shell pm grant org.autojs.autojs6 android.permission.SYSTEM_ALERT_WINDOW
adb shell settings put secure accessibility_enabled 1
adb shell settings put secure enabled_accessibility_services org.autojs.autojs6/org.autojs.autojs6.accessibility.AccessibilityService
adb shell appops set org.autojs.autojs6 TOAST_WINDOW deny
```

> 注意：手机需先在 **设置 → 关于手机 → 连续点版本号 7 次** 开启开发者选项，再开启 USB 调试。

---

## 2. 无障碍服务

**设置 → 辅助功能 → 无障碍 → AutoJs6 → 开启**

> 如果 ADB 命令已执行过，此项已自动开启。

---

## 3. 悬浮窗权限

**设置 → 应用 → 应用管理 → AutoJs6 → 权限 → 悬浮窗 → 允许**

---

## 4. 后台弹出界面（关键！）

**设置 → 应用 → 应用管理 → AutoJs6 → 权限 → 后台弹出界面 → 禁止**

> ⚠️ 此权限必须设为禁止，否则悬浮窗提示等会弹出打断脚本。

---

## 5. 截图权限

**设置 → 隐私 → 权限管理 → 特殊权限 → 截屏 → AutoJs6 → 始终允许**

> 不要选"每次询问"，否则每轮截图都会弹确认框。

---

## 6. 电池优化

**设置 → 应用 → 特殊访问权限 → 电池优化 → 找到 AutoJs6 → 设为"不允许"**

> 即不对 AutoJs6 进行电池优化，防止后台被系统 kill。

---

## 7. 应用启动管理

**设置 → 应用 → 应用启动管理 → 找到 AutoJs6 → 改为"手动管理"**

勾选三项：
- ✅ 自启动
- ✅ 关联启动
- ✅ 后台活动

---

## 8. 手机管家

**手机管家 → 右上角 ⚙️ → 关闭 "智能维护"**

> 避免系统自动清理 AutoJs6 后台进程。

---

## 9. 锁屏与休眠

**设置 → 显示 → 休眠 → 设为 "10 分钟" 或 "永不"**

> 脚本运行期间需要屏幕常亮，否则截图会黑屏。

---

## 10. 开发者选项（如已开启）

**设置 → 开发者选项**

| 选项 | 设置 |
|---|---|
| 不保留活动 | ❌ 关闭 |
| 后台进程限制 | 标准限制 |

---

## 11. 首次运行验证

配置完成后，跑一次脚本确认日志中无 "权限被拒绝" 或弹窗打断，且上报和心跳正常发送。

---

## 其他品牌补充

| 品牌 | 额外注意 |
|---|---|
| 小米 | 设置 → 授权管理 → 自启动管理 → AutoJs6 开启；MIUI 优化关闭 |
| OPPO/一加 | 设置 → 电池 → 应用速冻 → AutoJs6 关闭 |
| vivo | i管家 → 权限管理 → 自启动 → AutoJs6 开启 |
| 三星 | 设置 → 电池和设备维护 → 电池 → 后台使用限制 → AutoJs6 永不休眠 |
