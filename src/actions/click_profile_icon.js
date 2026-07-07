/**
 * 点击视频号页面右上角「个人中心」图标
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在视频号页面
 *
 * 逻辑：
 *   右上角图标无文字，直接用比例坐标点击
 *   同时做全屏 OCR 兜底，如果能识别到"我的"或"个人"等文字也尝试匹配
 */

"auto";

// ============================================================
// 配置
// ============================================================
var ROI = [0.82, 0, 0.18, 0.12];       // 右上角区域 [xRatio, yRatio, wRatio, hRatio]
var FALLBACK = [0.936, 0.056];           // 右上角图标中心比例坐标
var CLICK_DELAY = 1000;
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 点击右上角个人中心图标 ===");
    console.log("屏幕尺寸: " + device.width + "x" + device.height);

    var result = clickTopRightIcon(FALLBACK, CLICK_DELAY);
    console.log("");
    console.log("执行结果:");
    console.log("  ok: " + result.ok);
    console.log("  点击坐标: " + (result.clickPoint ? result.clickPoint.x + "," + result.clickPoint.y : "无"));
    console.log("  来源: " + result.source);
    console.log("  跳过原因: " + (result.skippedReason || "无"));

    toastLog("点击个人中心完成: " + result.source);
}

function clickTopRightIcon(fallback, clickDelay) {
    var result = {
        ok: false,
        clickPoint: null,
        source: "",
        skippedReason: ""
    };

    if (!requestScreenCapture()) {
        result.skippedReason = "请求截图权限失败";
        return result;
    }
    sleep(300);

    var img = captureScreen();
    if (!img) {
        result.skippedReason = "captureScreen() 返回空";
        return result;
    }

    try {
        // 主方案：比例坐标直接点击（图标无文字，OCR 不可靠）
        result.ok = true;
        result.source = "fixed_ratio";
        result.clickPoint = {
            x: Math.round(device.width * fallback[0]),
            y: Math.round(device.height * fallback[1])
        };
        click(result.clickPoint.x, result.clickPoint.y);
        sleep(clickDelay);
        return result;
    } catch (e) {
        result.skippedReason = "异常: " + String(e);
        return result;
    } finally {
        if (img) img.recycle();
    }
}
