/**
 * 视频详情页：点击左下角「免费剧集」入口
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在视频详情页，左下角显示「免费剧集」入口文字
 *
 * 逻辑：
 *   裁剪左下角 ROI → OCR 匹配「免费剧集」→ 点击文字行左侧区域
 *   OCR 未命中时用备用比例坐标 (36%, 76%) 兜底
 */

"auto";

// ============================================================
// 配置
// ============================================================
var TARGET_PATTERN = "免费剧集";
var ROI = [0, 0.68, 0.76, 0.18];         // 左下角免费剧集入口 [xRatio, yRatio, wRatio, hRatio]
var FALLBACK = [0.36, 0.76];              // 备用比例坐标
var CLICK_X_RATIO_IN_LINE = 0.30;         // 匹配行内，X 偏移比例（偏左命中按钮）
var CLICK_DELAY = 1200;
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 点击「免费剧集」入口 ===");

    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        exit();
    }
    sleep(500);

    var img = captureScreen();
    if (!img) { console.log("错误: captureScreen() 返回空"); exit(); }

    var w = img.getWidth(), h = img.getHeight();
    console.log("屏幕: " + w + "x" + h);

    // 裁剪 ROI
    var region = _toPixelRegion(ROI, w, h);

    // OCR ROI
    var ocrResult = _ocrScreen(img, region);
    console.log("OCR: " + ocrResult.mode + " | 条目: " + ocrResult.count);

    // 查找免费剧集文字
    var lines = _ocrLineObjects(ocrResult);
    var best = null;
    for (var i = 0; i < lines.length; i++) {
        var compact = _clean(lines[i].text).replace(/\s+/g, "");
        var score = 0;
        if (compact.indexOf("免费剧集") >= 0) score += 100;
        if (compact.indexOf("剧集") >= 0) score += 45;
        if (compact.indexOf("免费") >= 0) score += 20;
        if (compact.indexOf("可能含有AI生成内容") >= 0) score -= 80;
        if (score > 0 && (!best || score > best.score)) {
            best = { line: lines[i], score: score };
        }
    }

    var cx, cy, source;
    if (best) {
        var coordIsScreen = (best.line.top > region[3] + 10);
        var l = Math.max(0, best.line.left - 24);
        var r = Math.min(w, Math.max(best.line.right + 24, region[0] + region[2] * 0.72));
        var t = Math.max(0, best.line.top - 12);
        var b = Math.min(h, best.line.bottom + 12);

        if (!coordIsScreen) { l += region[0]; r += region[0]; t += region[1]; b += region[1]; }

        cx = Math.round(l + (r - l) * CLICK_X_RATIO_IN_LINE);
        cy = Math.round((t + b) / 2);
        source = "ocr_line";
        console.log("匹配到: \"" + best.line.text + "\"");
    } else {
        cx = Math.round(w * FALLBACK[0]);
        cy = Math.round(h * FALLBACK[1]);
        source = "fallback";
        console.log("未匹配，使用备用坐标");
    }

    console.log("点击: x=" + cx + " y=" + cy + " 来源=" + source);
    click(cx, cy);
    sleep(CLICK_DELAY);

    img.recycle();
    toastLog("免费剧集点击完成: " + source);
}

// ============================================================
// OCR 行对象
// ============================================================

function _ocrLineObjects(ocrResult) {
    if (!ocrResult || !ocrResult.items) return [];
    var items = ocrResult.items.slice();
    items.sort(function(a, b) {
        var ay = a.bounds.top || 0;
        var by = b.bounds.top || 0;
        if (Math.abs(ay - by) > 22) return ay - by;
        return (a.bounds.left || 0) - (b.bounds.left || 0);
    });

    var lines = [];
    var current = [];
    var currentY = -1;
    for (var i = 0; i < items.length; i++) {
        var text = _clean(items[i].label);
        if (!text) continue;
        var y = items[i].bounds.top || 0;
        if (currentY < 0 || Math.abs(y - currentY) <= 22) {
            current.push(items[i]);
            if (currentY < 0) currentY = y;
        } else {
            lines.push(_makeLineObj(current));
            current = [items[i]];
            currentY = y;
        }
    }
    if (current.length) lines.push(_makeLineObj(current));
    return lines;
}

function _makeLineObj(parts) {
    var top = 999999, bottom = 0, left = 999999, right = 0;
    for (var i = 0; i < parts.length; i++) {
        var b = parts[i].bounds || {};
        top = Math.min(top, b.top || 0);
        bottom = Math.max(bottom, b.bottom || 0);
        left = Math.min(left, b.left || 0);
        right = Math.max(right, b.right || 0);
    }
    return {
        text: _clean(parts.map(function(p) { return p.label; }).join("")),
        top: top, bottom: bottom, left: left, right: right
    };
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

function _toPixelRegion(roi, w, h) {
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
