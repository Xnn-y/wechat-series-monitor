/**
 * 视频详情页：采集剧集名称和发布时间（纯本地OCR）
 *
 * 两步采集：
 *   1. 视频详情页 → OCR 提取「发布时间」
 *   2. 点击「免费剧集」→ 面板 OCR 提取「完整剧名」→ back() 返回详情页
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在视频详情页
 */

"auto";

// ============================================================
// 配置
// ============================================================
var COLLECT_WINDOW_HOURS = 2;
var COLLECT_WINDOW_BUFFER = 1;
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];

// 免费剧集入口配置（复用 click_free_series.js 参数）
var FREE_ENTRY_ROI = [0, 0.68, 0.76, 0.18];
var FREE_ENTRY_FALLBACK = [0.36, 0.76];
var FREE_ENTRY_CLICK_X = 0.30;

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 视频详情采集（两步：时间+完整剧名） ===");

    // 只申请一次截图权限
    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        exit();
    }
    sleep(300);

    // ---- 第一步：视频详情页 OCR，提取发布时间 ----
    var img = captureScreen();
    if (!img) { console.log("截图失败"); exit(); }
    var w = img.getWidth(), h = img.getHeight();
    console.log("屏幕: " + w + "x" + h);

    var ocr1 = _ocrScreen(img, null);
    console.log("OCR1(详情页): " + ocr1.mode + " | 条目: " + ocr1.count);
    var items1 = ocr1.items || [];

    var publishTimeRaw = extractPublishTime(items1);
    console.log("发布时间: " + (publishTimeRaw || "未识别"));
    img.recycle();

    if (!publishTimeRaw) {
        console.log("错误: 未识别到发布时间");
        toastLog("采集失败: 时间未识别");
        exit();
    }

    // 推算实际时间
    var actualTime = parseRelativeTime(publishTimeRaw);
    var now = Date.now();
    var maxAge = (COLLECT_WINDOW_HOURS + COLLECT_WINDOW_BUFFER) * 3600000;
    var inWindow = actualTime ? (now - actualTime.getTime()) <= maxAge : false;
    console.log("推算时间: " + (actualTime ? formatTime(actualTime) : "无法推算"));
    console.log("窗口内: " + inWindow + " (距今 " + (actualTime ? Math.round((now - actualTime.getTime()) / 60000) : 0) + " 分钟)");

    // ---- 第二步：点击免费剧集，获取完整剧名 ----
    console.log("\n--- 点击免费剧集获取完整剧名 ---");

    var seriesName = extractSeriesName(items1); // 先尝试从详情页获取
    console.log("详情页剧名: " + (seriesName || "未识别"));

    // 点击免费剧集
    _clickFreeSeriesEntry(w, h);

    sleep(800);
    // OCR 免费剧集面板
    var img2 = captureScreen();
    if (img2) {
        var ocr2 = _ocrScreen(img2, null);
        console.log("OCR2(剧集面板): " + ocr2.mode + " | 条目: " + ocr2.count);
        var items2 = ocr2.items || [];

        // 从面板提取完整剧名
        var fullName = extractSeriesNameFromPanel(items2, h, seriesName);
        if (fullName) {
            console.log("面板完整剧名: " + fullName);
            seriesName = fullName;
        }
        img2.recycle();

        // 返回视频详情页
        sleep(300);
        back();
        sleep(1000);
    }

    // ---- 汇总 ----
    console.log("\n=== 采集结果 ===");
    console.log("剧名:         " + (seriesName || "N/A"));
    console.log("发布时间:     " + publishTimeRaw);
    console.log("实际时间:     " + (actualTime ? formatTime(actualTime) : "N/A"));
    console.log("在窗口内:     " + (inWindow ? "是" : "否"));

    toastLog("采集完成: " + (seriesName || "未知") + " | " + publishTimeRaw);
}

// ============================================================
// 免费剧集点击（内联版）
// ============================================================

function _clickFreeSeriesEntry(w, h) {
    var region = _toPixelRegion(FREE_ENTRY_ROI, w, h);
    var img = captureScreen();
    if (!img) return;

    var ocrResult = _ocrScreen(img, region);
    var lines = _ocrLineObjects(ocrResult);
    var best = null;
    for (var i = 0; i < lines.length; i++) {
        var compact = _clean(lines[i].text).replace(/\s+/g, "");
        var score = 0;
        if (compact.indexOf("免费剧集") >= 0) score += 100;
        if (compact.indexOf("剧集") >= 0) score += 45;
        if (compact.indexOf("免费") >= 0) score += 20;
        if (score > 0 && (!best || score > best.score)) {
            best = { line: lines[i], score: score };
        }
    }

    var cx, cy;
    if (best) {
        var coordIsScreen = (best.line.top > region[3] + 10);
        var l = Math.max(0, best.line.left - 24);
        var r = Math.min(w, Math.max(best.line.right + 24, region[0] + region[2] * 0.72));
        var t = Math.max(0, best.line.top - 12);
        var b = Math.min(h, best.line.bottom + 12);
        if (!coordIsScreen) { l += region[0]; r += region[0]; t += region[1]; b += region[1]; }
        cx = Math.round(l + (r - l) * FREE_ENTRY_CLICK_X);
        cy = Math.round((t + b) / 2);
        console.log("点击免费剧集: x=" + cx + " y=" + cy);
    } else {
        cx = Math.round(w * FREE_ENTRY_FALLBACK[0]);
        cy = Math.round(h * FREE_ENTRY_FALLBACK[1]);
        console.log("点击免费剧集(fallback): x=" + cx + " y=" + cy);
    }

    click(cx, cy);
    img.recycle();
}

// ============================================================
// 信息提取
// ============================================================

function extractSeriesName(items) {
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        var m = label.match(/免费剧集[：:]\s*(.+?)(?:\s*全\d+集|$)/);
        if (m && m[1]) {
            var name = m[1].replace(/[.。,，！!]+$/g, "").trim();
            if (name.length >= 2) return name;
        }
    }
    return null;
}

function extractSeriesNameFromPanel(items, screenHeight, detailName) {
    // 面板顶部区域（视频仍在播放，字幕在下方）
    // 剧名通常在面板最上方 Y<35%，字幕会出现在更下方
    var candidates = [];
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        var y = items[i].bounds.top || 0;
        // 严格限制：只在面板最顶部区域查找（Y < 屏幕 35%）
        if (y > screenHeight * 0.35) continue;
        if (label.length < 3) continue;
        if (label.length > 40) continue;
        if (/^[\d\-,\s]+$/.test(label)) continue;
        if (/^(免费|剧集|全集|选集|排序|最新|最热|弹|评论)/.test(label)) continue;
        if (label.indexOf("#") >= 0) continue;

        candidates.push({ label: label, y: y, len: label.length });
    }

    if (candidates.length === 0) return null;

    // 优先用详情页剧名做锚定：找到包含详情页名片段的最长候选
    if (detailName && detailName.length >= 3) {
        // 从详情页名去掉末尾可能截断的部分，取前几个字做锚定
        var anchor = detailName.substring(0, Math.min(6, detailName.length - 1));
        var matched = [];
        for (i = 0; i < candidates.length; i++) {
            if (candidates[i].label.indexOf(anchor) >= 0) {
                matched.push(candidates[i]);
            }
        }
        if (matched.length > 0) {
            matched.sort(function(a, b) { return b.len - a.len; });
            var clean = matched[0].label.replace(/^[a-zA-Z0-9\s\.\,\!\?\-\+\=\(\)\[\]\{\}]+/g, "");
            clean = clean.split(/\s+/)[0];
            if (clean.length >= 3) return clean;
            return matched[0].label;
        }
    }

    // 兜底：取面板最上方、文字最长的那条
    candidates.sort(function(a, b) {
        if (a.y !== b.y) return a.y - b.y;
        return b.len - a.len;
    });

    var best = candidates[0];
    var clean = best.label.replace(/^[a-zA-Z0-9\s\.\,\!\?\-\+\=\(\)\[\]\{\}]+/g, "");
    clean = clean.split(/\s+/)[0];
    if (clean.length >= 3) return clean;
    return best.label;
}

function extractPublishTime(items) {
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        var y = items[i].bounds.top || 0;
        if (y > 2100) continue;

        if (/^刚刚$/.test(label)) return label;
        var m = label.match(/^(\d+)\s*(分钟前|小时前|天前)$/);
        if (m) return m[1] + m[2];
        m = label.match(/^(\d+)\s*(秒前)$/);
        if (m) return "刚刚";
    }
    return null;
}

function parseRelativeTime(text) {
    var now = new Date();
    if (!text) return null;
    if (text === "刚刚") return now;

    var m = text.match(/^(\d+)\s*(分钟前|小时前|天前|秒前)$/);
    if (!m) return null;

    var num = parseInt(m[1], 10);
    var unit = m[2];
    var ms = 0;
    if (unit === "秒前") ms = num * 1000;
    else if (unit === "分钟前") ms = num * 60000;
    else if (unit === "小时前") ms = num * 3600000;
    else if (unit === "天前") ms = num * 86400000;

    return new Date(now.getTime() - ms);
}

function formatTime(date) {
    if (!date) return "N/A";
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
        " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes()) + ":" + pad2(date.getSeconds());
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

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
