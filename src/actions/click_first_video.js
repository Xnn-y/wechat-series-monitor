/**
 * 点击账号主页第一个视频
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：已在某个视频号账号主页
 *
 * 逻辑：
 *   全屏 OCR → 找视频宫格第一行（同一Y高度出现≥2个文字块）→ 点击最左列
 *   OCR 未命中时用比例坐标 (16.5%, 42.5%) 兜底
 */

"auto";

// ============================================================
// 配置
// ============================================================
var FALLBACK = [0.165, 0.425];           // 第一个视频备选比例坐标
var CLICK_DELAY = 1500;
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 点击账号主页第一个视频 ===");

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

    // 跳过顶部账号信息区和按钮区（Y < 屏幕40%），只在视频宫格区域搜索
    var videoAreaMinY = Math.round(h * 0.40);
    var items = (ocrResult.items || []).slice();
    items = items.filter(function(it) {
        var y = it.bounds.top || 0;
        if (y < videoAreaMinY) return false;
        // 排除按钮类短文字
        var label = _clean(it.label || "");
        if (/^(已关注|私信|关注|取消关注|作品|合集|可能含有AI生成内容)$/.test(label)) return false;
        return true;
    });
    items.sort(function(a, b) {
        return (a.bounds.top || 0) - (b.bounds.top || 0);
    });

    // 按同行分组：同一高度(20px容差)出现多个即视为宫格行
    var gridRow = findFirstVideoRow(items);
    var clicked = false;
    var cx, cy, source;

    if (gridRow) {
        // 点击最左列
        var leftCol = gridRow[0];
        var rightCol = gridRow[gridRow.length - 1];
        cx = Math.round((leftCol.bounds.left + leftCol.bounds.right) / 2);
        cy = Math.round((leftCol.bounds.top + leftCol.bounds.bottom) / 2);
        source = "ocr_grid_row";
        console.log("找到宫格行: " + gridRow.length + " 列, Y=" + gridRow[0].bounds.top);
        for (var i = 0; i < gridRow.length; i++) {
            console.log("  列" + (i + 1) + ": \"" + _clean(gridRow[i].label) + "\"");
        }
    } else {
        cx = Math.round(w * FALLBACK[0]);
        cy = Math.round(h * FALLBACK[1]);
        source = "fallback_ratio";
        console.log("未找到宫格行，使用备用比例坐标");
    }

    console.log("点击: x=" + cx + " y=" + cy + " 来源=" + source);
    click(cx, cy);
    sleep(CLICK_DELAY);

    img.recycle();
    toastLog("已点击第一个视频: " + source);
}

// ============================================================
// 视频宫格检测
// ============================================================

function findFirstVideoRow(items) {
    var rowItems = [];
    var currentRowY = -1;
    var ROW_TOLERANCE = 22;

    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!label || label.length < 2) continue;
        var y = items[i].bounds.top || 0;

        if (currentRowY < 0) {
            currentRowY = y;
            rowItems = [items[i]];
        } else if (Math.abs(y - currentRowY) <= ROW_TOLERANCE) {
            rowItems.push(items[i]);
        } else {
            // 换行了，检查上一行是否是宫格行（≥2列）
            if (rowItems.length >= 2) {
                // 额外验证：两列之间有合理的间距（不会太窄贴在一起）
                var leftCol = rowItems[0];
                var rightCol = rowItems[rowItems.length - 1];
                var gap = (rightCol.bounds.left || 0) - (leftCol.bounds.right || 0);
                if (gap > 20 && rowItems.length <= 3) {
                    return rowItems;
                }
            }
            currentRowY = y;
            rowItems = [items[i]];
        }
    }

    // 检查最后一行
    if (rowItems.length >= 2) {
        var lc = rowItems[0];
        var rc = rowItems[rowItems.length - 1];
        var gap = (rc.bounds.left || 0) - (lc.bounds.right || 0);
        if (gap > 20 && rowItems.length <= 3) return rowItems;
    }

    return null;
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
