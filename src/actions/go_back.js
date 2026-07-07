/**
 * 返回上一页（系统 back 键）
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：任意页面
 *
 * 逻辑：
 *   优先调用 Android 系统 back()
 *   fallback: 点击左上角返回按钮区域
 */

"auto";

// ============================================================
// 配置
// ============================================================
var CLICK_DELAY = 1000;                   // 返回后等待页面切换
var FALLBACK_BACK = [0.06, 0.056];        // 左上角返回按钮比例坐标（fallback 用）

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 返回上一页 ===");
    console.log("屏幕尺寸: " + device.width + "x" + device.height);

    var result = goBack();
    console.log("");
    console.log("执行结果:");
    console.log("  ok: " + result.ok);
    console.log("  方式: " + result.method);
    console.log("  错误: " + (result.error || "无"));

    toastLog("返回完成: " + result.method);
}

function goBack() {
    // 方案1：系统 back()
    try {
        back();
        sleep(CLICK_DELAY);
        return { ok: true, method: "system_back", error: null };
    } catch (e) {
        // back() 失败了，尝试 fallback
    }

    // 方案2：点击左上角返回按钮
    try {
        click(Math.round(device.width * FALLBACK_BACK[0]), Math.round(device.height * FALLBACK_BACK[1]));
        sleep(CLICK_DELAY);
        return { ok: true, method: "fallback_click", error: null };
    } catch (e2) {
        return { ok: false, method: "none", error: "back() 和 fallback 点击均失败: " + String(e2) };
    }
}
