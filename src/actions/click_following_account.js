/**
 * 点击关注列表中第 N 个账号
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在视频号「关注」列表页面
 *
 * 逻辑：
 *   全屏 OCR → 提取账号名行（排除标题"我的关注"、底部Tab等杂项）
 *   → 按 Y 从上到下排序 → 点击第 N 行账号区域
 *   OCR 未命中时用首行位置 + N*行高估算坐标兜底
 *
 * 配置：修改 TARGET_INDEX 指定点击第几个（从1开始）
 */

"auto";

// ============================================================
// 配置
// ============================================================
var TARGET_INDEX = 2;                    // 点击第几个账号（1=第一个）
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var CLICK_DELAY = 1000;

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 点击关注列表第 " + TARGET_INDEX + " 个账号 ===");

    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        exit();
    }
    sleep(500);

    var img = captureScreen();
    if (!img) { console.log("错误: captureScreen() 返回空"); exit(); }

    var w = img.getWidth(), h = img.getHeight();
    console.log("屏幕: " + w + "x" + h);

    // 全屏 OCR
    var ocrResult = _ocrScreen(img, null);
    console.log("OCR: " + ocrResult.mode + " | 条目: " + ocrResult.count);

    // 提取账号名行
    var accounts = extractAccounts(ocrResult, h);
    console.log("提取账号行数: " + accounts.length);
    for (var i = 0; i < accounts.length; i++) {
        console.log("  [" + (i + 1) + "] \"" + accounts[i].label +
            "\" textX=" + accounts[i].textCenterX + " centerY=" + accounts[i].centerY);
    }

    if (accounts.length === 0) {
        console.log("错误: 未识别到任何账号");
        img.recycle();
        exit();
    }

    if (TARGET_INDEX > accounts.length) {
        console.log("警告: 目标序号 " + TARGET_INDEX + " 超出可见范围(" + accounts.length + "个)，需要先滑动");
        img.recycle();
        exit();
    }

    var target = accounts[TARGET_INDEX - 1];
    // 点击策略：先用文字区域中心X + 行中心Y；再尝试屏幕中心X + 行中心Y
    var points = [
        { x: target.textCenterX, y: target.centerY, label: "text_center" },
        { x: Math.round(w * 0.5), y: target.centerY, label: "screen_center" },
        { x: Math.round(w * 0.35), y: target.centerY, label: "left_area" }
    ];

    var clicked = false;
    for (var pi = 0; pi < points.length; pi++) {
        var pt = points[pi];
        console.log("尝试点击: x=" + pt.x + " y=" + pt.y + " (" + pt.label + ") 账号=\"" + target.label + "\"");
        click(pt.x, pt.y);
        sleep(CLICK_DELAY);

        // 截图验证是否跳转了（判断页面变化）
        var img2 = captureScreen();
        if (img2) {
            var verifyOcr = _ocrScreen(img2, null);
            var stillOnFollow = false;
            var items = verifyOcr.items || [];
            for (var vi = 0; vi < items.length; vi++) {
                if (_clean(items[vi].label || "").indexOf("我的关注") >= 0) {
                    stillOnFollow = true;
                    break;
                }
            }
            img2.recycle();
            if (!stillOnFollow) {
                console.log("  页面已跳转，点击成功 (" + pt.label + ")");
                clicked = true;
                break;
            }
            console.log("  仍在关注页，重试下一个位置");
        }
    }

    if (!clicked) {
        // 最后兜底：屏幕中心
        console.log("兜底点击: x=" + Math.round(w / 2) + " y=" + target.centerY);
        click(Math.round(w / 2), target.centerY);
        sleep(CLICK_DELAY);
    }

    img.recycle();
    toastLog("已点击第" + TARGET_INDEX + "个: " + target.label);
}

// ============================================================
// 账号行提取
// ============================================================

function extractAccounts(ocrResult, screenHeight) {
    var items = ocrResult.items || [];
    if (items.length === 0) return [];

    // 按 Y 排序
    items.sort(function (a, b) {
        var ay = a.bounds.top || 0;
        var by = b.bounds.top || 0;
        return ay - by;
    });

    // 合并同一行的文字
    var rows = [];
    var currentRow = null;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!label) continue;
        var b = items[i].bounds;
        var y = b.top || 0;

        if (!currentRow || y - currentRow.top > 30) {
            if (currentRow && isAccountRow(currentRow, screenHeight)) {
                rows.push(currentRow);
            }
            currentRow = { label: label, top: y, bottom: b.bottom || (y + 50), bounds: [b] };
        } else {
            // 同行合并
            currentRow.label = currentRow.label + label;
            currentRow.bottom = Math.max(currentRow.bottom, b.bottom || (y + 50));
            currentRow.bounds.push(b);
        }
    }
    if (currentRow && isAccountRow(currentRow, screenHeight)) {
        rows.push(currentRow);
    }

    // 补充 centerY 和 textCenterX（文字区域水平中心）
    for (i = 0; i < rows.length; i++) {
        rows[i].centerY = Math.round((rows[i].top + rows[i].bottom) / 2);
        var leftmost = 9999, rightmost = 0;
        for (var j = 0; j < rows[i].bounds.length; j++) {
            var b = rows[i].bounds[j];
            if (b.left < leftmost) leftmost = b.left;
            if (b.right > rightmost) rightmost = b.right;
        }
        rows[i].textCenterX = Math.round((leftmost + rightmost) / 2);
    }
    return rows;
}

function isAccountRow(row, screenHeight) {
    var label = row.label;
    if (!label) return false;
    // 排除非账号行
    if (/我的关注/.test(label)) return false;
    if (/^(推荐|朋友|关注|赞|评论|转发|可能含有AI生成内容)$/.test(label)) return false;
    if (row.top > screenHeight * 0.92) return false;  // 底部栏区域
    if (label.length < 2) return false;
    return true;
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
