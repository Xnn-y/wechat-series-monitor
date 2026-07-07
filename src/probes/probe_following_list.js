/**
 * 关注列表探针 —— 全屏 OCR + 页面结构分析
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在视频号「关注」列表页面
 *
 * 输出：
 *   屏幕尺寸、顶部/底部固定栏高度估算、单行账号条目高度、
 *   全屏 OCR 全部文字及坐标
 */

"auto";

// ============================================================
// 配置
// ============================================================
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var AVG_CHAR_HEIGHT = 64;   // OCR 中文字符常见高度（px），用于推算行距

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 关注列表 OCR 探针 ===");

    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        exit();
    }
    sleep(500);

    var img = captureScreen();
    if (!img) {
        console.log("错误: captureScreen() 返回空");
        exit();
    }

    var w = img.getWidth(), h = img.getHeight();
    console.log("屏幕尺寸: " + w + "x" + h);

    // 全屏 OCR
    console.log("\n--- 全屏 OCR ---");
    var fullOcr = _ocrScreen(img, null);
    console.log("引擎: " + fullOcr.mode + " | 条目数: " + fullOcr.count);
    if (fullOcr.error) console.log("错误: " + fullOcr.error);
    if (fullOcr.fallbackErrors && fullOcr.fallbackErrors.length) {
        console.log("引擎失败: " + fullOcr.fallbackErrors.join("; "));
    }

    var items = fullOcr.items || [];
    console.log("\n--- 全部识别文字（按 Y 坐标排序）---");
    items.sort(function (a, b) {
        return (a.bounds.top || 0) - (b.bounds.top || 0);
    });

    var minY = h, maxY = 0;
    var locations = []; // { y, label }
    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds;
        var label = _clean(items[i].label);
        if (!label) continue;
        var y = b.top || 0;
        console.log("  y=" + padNum(y, 4) + " \"" + label + "\" @ [" + b.left + "," + b.top + " " + b.right + "," + b.bottom + "]");
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        locations.push({ y: y, label: label });
    }

    // 估算行高：找相邻不同行的 Y 间距
    var rowHeights = [];
    for (i = 1; i < locations.length; i++) {
        var gap = locations[i].y - locations[i - 1].y;
        if (gap > 40 && gap < 300) {
            rowHeights.push(gap);
        }
    }
    var avgRowHeight = 0;
    if (rowHeights.length > 0) {
        avgRowHeight = Math.round(rowHeights.reduce(function (a, b) { return a + b; }, 0) / rowHeights.length);
    }

    // 估算可见行数
    var visibleArea = maxY - minY;
    var rowCount = avgRowHeight > 0 ? Math.round(visibleArea / avgRowHeight) : "无法估算";

    console.log("\n--- 页面结构估算 ---");
    console.log("首行 Y: " + minY);
    console.log("末行 Y: " + maxY);
    console.log("可见区域高度: " + visibleArea + "px (" + Math.round(visibleArea / h * 100) + "% 屏幕)");
    console.log("预估行高: " + avgRowHeight + "px");
    console.log("预估可见行数: " + rowCount);
    console.log("预估总行数(按全屏算): " + (avgRowHeight > 0 ? Math.floor(h / avgRowHeight) : "???"));

    // 滑动逻辑建议
    console.log("\n--- 滑动策略建议 ---");
    if (avgRowHeight > 0) {
        var visibleRows = Math.floor((h - minY) / avgRowHeight);
        console.log("可见账号数 ≈ " + visibleRows);
        console.log("建议: 每次点击后如果滑到屏幕底部，向上滑动 " + Math.round(h * 0.6) + "px (60% 屏幕)");
        console.log("滑动区间: 从 y=" + Math.round(h * 0.75) + " 滑到 y=" + Math.round(h * 0.25));
    }

    img.recycle();
    toastLog("探针完成，关注页 OCR 已输出");
}

// ============================================================
// OCR 引擎（内联）
// ============================================================

function _ocrScreen(img, region) {
    var baseOptions = { useSlim: true, cpuThreadNum: 4, useOpenCL: false };
    if (region) baseOptions.region = region;

    var modes = OCR_FALLBACK_MODES.slice();
    if (modes.indexOf(OCR_MODE) < 0) modes.unshift(OCR_MODE);

    var errors = [];
    for (var i = 0; i < modes.length; i++) {
        var mode = modes[i];
        var attempt = _tryOcrMode(img, baseOptions, mode);
        if (attempt.ok) {
            var items = _normalizeItems(attempt.raw);
            return {
                available: true, mode: mode, region: region,
                count: items.length, items: items, fallbackErrors: errors
            };
        }
        errors.push(mode + ": " + attempt.error);
    }

    return {
        available: false, mode: modes.join(","), region: region,
        count: 0, items: [], error: errors.join(" | "), errors: errors
    };
}

function _tryOcrMode(img, baseOptions, mode) {
    if (typeof ocr === "undefined") return { ok: false, error: "环境未暴露 ocr" };
    var opts = {};
    for (var k in baseOptions) { if (baseOptions.hasOwnProperty(k)) opts[k] = baseOptions[k]; }
    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) return { ok: true, raw: ocr.paddle.detect(img, opts) };
            if (ocr.detect) { opts.mode = "paddle"; return { ok: true, raw: ocr.detect(img, opts) }; }
            return { ok: false, error: "未找到 paddle.detect / ocr.detect" };
        }
        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) return { ok: true, raw: ocr.mlkit.detect(img, opts) };
        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) return { ok: true, raw: ocr.rapid.detect(img, opts) };
        if (mode !== "generic") opts.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, opts) };
        return { ok: false, error: "未找到 OCR detect" };
    } catch (e) { return { ok: false, error: String(e) }; }
}

function _normalizeItems(results) {
    var out = [];
    if (!results) return out;
    var count = _ocrLen(results);
    for (var i = 0; i < count; i++) {
        var item = _getItem(results, i);
        if (!item) continue;
        out.push({ label: item.label || item.text || "", confidence: item.confidence, bounds: _rectToObj(item.bounds) });
    }
    return out;
}

function _getItem(results, index) {
    try { if (typeof results.get === "function") return results.get(index); return results[index]; } catch (e) {}
    return null;
}

function _ocrLen(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try { if (typeof results.size === "function") return results.size(); } catch (e) {}
    return 0;
}

function _rectToObj(rect) {
    if (!rect) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: Number(rect.left || 0), top: Number(rect.top || 0), right: Number(rect.right || 0), bottom: Number(rect.bottom || 0) };
}

function _clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function padNum(n, width) {
    var s = String(n);
    while (s.length < width) s = " " + s;
    return s;
}
