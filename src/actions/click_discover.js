/**
 * 点击微信底部「发现」按钮
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（单文件内联，无需同步整个 src）
 * 前置条件：先在微信主界面（四个 Tab：微信、通讯录、发现、我 可见）
 *
 * 逻辑：
 *   OCR 识别屏幕底部区域 → 匹配「发现」文字 → 点击其中心坐标
 *   OCR 未命中时用备用比例坐标 (62.5%, 94.5%) 兜底
 */

"auto";

// ============================================================
// 配置
// ============================================================
var TARGET = "发现";
var ROI = [0, 0.85, 1, 0.15];          // 底部 Tab 栏 [xRatio, yRatio, wRatio, hRatio]
var FALLBACK = [0.625, 0.945];          // 第三个 Tab 备用比例坐标
var CLICK_DELAY = 800;
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();

    var result = ocrClick(TARGET, ROI, FALLBACK, CLICK_DELAY);
    console.log("");
    console.log("执行结果:");
    console.log("  ok: " + result.ok);
    console.log("  点击坐标: " + (result.clickPoint ? result.clickPoint.x + "," + result.clickPoint.y : "无"));
    console.log("  来源: " + result.source);
    console.log("  跳过原因: " + (result.skippedReason || "无"));
    if (result.ocrResult) {
        console.log("  OCR 模式: " + result.ocrResult.mode);
        console.log("  OCR 条目数: " + (result.ocrResult.count || 0));
    }
    if (result.matchItem) {
        console.log("  匹配文字: " + result.matchItem.label);
    }

    toastLog("点击「发现」完成: " + result.source);
}

// ============================================================
// OCR 点击核心逻辑（内联版）
// ============================================================

function ocrClick(target, roi, fallback, clickDelay) {
    var result = ocrFindPoint(target, roi, fallback);
    if (!result.ok) return result;

    result.executed = true;
    click(result.clickPoint.x, result.clickPoint.y);
    sleep(clickDelay);
    return result;
}

function ocrFindPoint(target, roi, fallback) {
    var result = {
        ok: false,
        clickPoint: null,
        source: "",
        ocrResult: null,
        matchItem: null,
        skippedReason: "",
        target: target,
        roi: roi,
        fallback: fallback
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
        var region = roi ? toPixelRegion(roi, img.getWidth(), img.getHeight()) : null;
        result.ocrResult = _ocrScreen(img, region);
        var match = _findText(result.ocrResult, target);

        if (match) {
            result.ok = true;
            result.source = "ocr";
            result.clickPoint = _boundsCenter(match.bounds, region);
            result.matchItem = match;
            return result;
        }

        // OCR 未命中，fallback
        if (fallback && fallback.length >= 2) {
            result.ok = true;
            result.source = "fallback";
            result.clickPoint = {
                x: Math.round(device.width * fallback[0]),
                y: Math.round(device.height * fallback[1])
            };
            return result;
        }

        result.skippedReason = "OCR 未匹配到 \"" + target + "\"，且无 fallback";
        return result;
    } catch (e) {
        result.skippedReason = "异常: " + String(e);
        return result;
    } finally {
        if (img) img.recycle();
    }
}

// ============================================================
// OCR 引擎
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
            return {
                available: true,
                mode: mode,
                region: region,
                count: _ocrLen(attempt.raw),
                items: _normalizeItems(attempt.raw),
                fallbackErrors: errors
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
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function _ocrLen(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try { if (typeof results.size === "function") return results.size(); } catch (e) {}
    return 0;
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
    try {
        if (typeof results.get === "function") return results.get(index);
        return results[index];
    } catch (e) {}
    return null;
}

function _rectToObj(rect) {
    if (!rect) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: Number(rect.left || 0), top: Number(rect.top || 0), right: Number(rect.right || 0), bottom: Number(rect.bottom || 0) };
}

// ============================================================
// 文字匹配 & 坐标计算
// ============================================================

function _findText(ocrResult, target) {
    if (!ocrResult || !ocrResult.items || !ocrResult.items.length || !target) return null;
    var ct = _clean(target);
    for (var i = 0; i < ocrResult.items.length; i++) {
        var label = _clean(ocrResult.items[i].label);
        if (label && label.indexOf(ct) >= 0) return ocrResult.items[i];
    }
    return null;
}

function _boundsCenter(bounds, region) {
    var l = Number(bounds.left || 0), t = Number(bounds.top || 0);
    var r = Number(bounds.right || 0), b = Number(bounds.bottom || 0);
    // ROI 内坐标映射回屏幕坐标
    if (region && r <= region[2] + 10 && b <= region[3] + 10) {
        l += region[0]; r += region[0]; t += region[1]; b += region[1];
    }
    return { x: Math.round((l + r) / 2), y: Math.round((t + b) / 2) };
}

function toPixelRegion(roi, w, h) {
    var x = _normVal(roi[0], w), y = _normVal(roi[1], h);
    var rw = _normVal(roi[2], w), rh = _normVal(roi[3], h);
    if (rw <= 0) rw = w - x; if (rh <= 0) rh = h - y;
    x = _clamp(Math.round(x), 0, w - 1); y = _clamp(Math.round(y), 0, h - 1);
    rw = _clamp(Math.round(rw), 1, w - x); rh = _clamp(Math.round(rh), 1, h - y);
    return [x, y, rw, rh];
}

function _normVal(v, total) { return (v > -1 && v < 1) ? v * total : v; }
function _clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function _clamp(v, min, max) { if (isNaN(v)) return min; return Math.max(min, Math.min(max, v)); }
