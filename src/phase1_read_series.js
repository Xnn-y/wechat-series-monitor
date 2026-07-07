/**
 * Phase 1：单账号剧集名读取（控制台输出）
 *
 * 前提：手动进入微信 → 发现 → 视频号 → 个人中心 → 关注列表页面
 * 功能：
 *   1. OCR 读取关注列表 → 打印所有账号
 *   2. 点击第一个非"自己"的账号（跳过 index 0）
 *   3. 进入主页后，OCR 找「剧集」Tab 并点击
 *   4. OCR 剧集页面，打印剧集名 + 北京时间
 *   5. 不做 CSV 写入，不做滚动分页
 *
 * 验证：控制台打印的剧集名应与手机屏幕上看到的逐一对应
 */

"auto";

// ============================================================
// 配置
// ============================================================
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var PAGE_DELAY = 1200;

// 剧集 Tab 在主页中的区域（比例坐标，用于 OCR ROI 裁剪）
var SERIES_TAB_ROI = [0, 0.28, 1, 0.15];       // 28%-43% 高度

// 剧集列表内容区域
var SERIES_LIST_ROI = [0, 0.12, 1, 0.76];

// ============================================================
// 主流程
// ============================================================

main();

function main() {
    console.show();
    console.setSize(800, 600);
    console.log("╔══════════════════════════════════════╗");
    console.log("║   Phase 1：单账号剧集名读取           ║");
    console.log("╚══════════════════════════════════════╝");
    console.log("");
    console.log("前置：请确保已在「关注」列表页面");
    console.log("");
    console.log("=== 步骤1：读取关注列表 ===");

    // 初始化截图：启动时一次性处理权限，后续不再弹窗
    _initCapture();

    // ---- 读取关注列表 ----
    var img = _safeCapture();
    if (!img) {
        // 首帧偶尔仍需二次申请
        console.log("  首帧失败，重新申请权限...");
        try { images.stopScreenCapture(); } catch (e) {}
        sleep(500);
        if (!requestScreenCapture()) { console.log("[错误] 截图权限失败"); exit(); }
        sleep(1500);
        img = _safeCapture();
        if (!img) { console.log("[错误] 截图仍然失败，请重启 AutoJs6"); exit(); }
    }
    var ocrResult = _ocrScreen(img, null);
    var accounts = _extractAccounts(ocrResult, img.getHeight());
    img.recycle();

    if (accounts.length === 0) {
        console.log("[错误] 未识别到任何账号");
        exit();
    }

    console.log("识别到 " + accounts.length + " 个账号：");
    for (var a = 0; a < accounts.length; a++) {
        var tag = (a === 0) ? " [跳过-自己]" : "";
        console.log("  [" + a + "] " + accounts[a].label + tag + " Y=" + accounts[a].centerY);
    }

    if (accounts.length < 2) {
        console.log("[错误] 关注列表只有自己，无可遍历账号");
        exit();
    }

    // ---- 步骤2：点击第一个非自己账号 ----
    var target = accounts[1];
    console.log("");
    console.log("=== 步骤2：点击账号 [" + target.label + "] ===");

    var clickResult = _clickAccount(target);
    if (!clickResult.success) {
        console.log("[错误] 点击账号失败，请确认坐标是否正确，终止运行");
        exit();
    }
    console.log("[成功] 已进入账号主页");

    // ---- 步骤3：点击「剧集」Tab ----
    // 复用步骤2的验证截图，避免重复截图导致 MediaProjection 报错
    console.log("");
    console.log("=== 步骤3：查找并点击「剧集」Tab ===");

    var seriesTabClicked = _clickSeriesTab(clickResult.img);
    clickResult.img.recycle();

    if (!seriesTabClicked) {
        console.log("[错误] 未找到「剧集」Tab，无法继续");
        exit();
    }
    console.log("[成功] 已进入剧集页面");

    // ---- 步骤4：读取剧集名 ----
    console.log("");
    console.log("=== 步骤4：读取剧集名称 ===");

    sleep(PAGE_DELAY);
    var seriesImg = _retryCapture(2, 600);
    if (!seriesImg) { console.log("[错误] 剧集页截图失败"); exit(); }

    var seriesNames = _readSeriesNames(seriesImg);
    seriesImg.recycle();

    console.log("");
    console.log("┌──────────────────────────────────────┐");
    console.log("│  账号: " + padRight(target.label, 28) + "│");
    console.log("│  读取时间: " + _beijingTime() + " │");
    console.log("│  剧集数: " + seriesNames.length + "                            │");
    console.log("├──────────────────────────────────────┤");
    for (var i = 0; i < seriesNames.length; i++) {
        console.log("│  " + padRight((i + 1) + ". " + seriesNames[i], 36) + "│");
    }
    if (seriesNames.length === 0) {
        console.log("│  (未识别到剧集名，请检查截图)         │");
    }
    console.log("└──────────────────────────────────────┘");

    console.log("");
    console.log("=== Phase 1 完成 ===");
    console.log("验证：请对比控制台输出的剧集名与手机屏幕上显示的是否一致。");

    toastLog("Phase 1 完成: " + target.label + " (" + seriesNames.length + "部)");
}

// ============================================================
// 点击账号（参考 click_following_account.js）
// ============================================================

function _clickAccount(account) {
    var w = device.width;
    var points = [
        { x: Math.round(w * 0.50), y: account.centerY, label: "center" },
        { x: Math.round(w * 0.45), y: account.centerY, label: "mid_left" },
        { x: Math.round(w * 0.55), y: account.centerY, label: "mid_right" },
        { x: account.textCenterX, y: account.centerY, label: "text_center(" + account.textCenterX + ")" }
    ];

    for (var pi = 0; pi < points.length; pi++) {
        var pt = points[pi];
        console.log("  尝试点击: x=" + pt.x + " y=" + pt.y + " (" + pt.label + ")");
        click(pt.x, pt.y);
        sleep(PAGE_DELAY + 800);

        // 截图验证（可能失败，连续重试2次）
        var verifyImg = _retryCapture(2, 500);
        if (!verifyImg) {
            console.log("  → 验证截图失败，尝试下一个位置");
            continue;
        }

        var vOcr = _ocrScreen(verifyImg, null);
        var stillOnFollow = false;
        for (var vi = 0; vi < (vOcr.items || []).length; vi++) {
            if (_clean(vOcr.items[vi].label || "").indexOf("我的关注") >= 0) {
                stillOnFollow = true;
                break;
            }
        }

        if (!stillOnFollow) {
            console.log("  → 页面已跳转，点击成功 (" + pt.label + ")");
            return { success: true, img: verifyImg }; // 返回截图供步骤3复用
        }
        console.log("  → 仍在关注页，重试...");
        verifyImg.recycle();
    }

    console.log("  [警告] 所有点击位置均未跳转");
    return { success: false };
}

// 重试截图：多次尝试，间隔等待（不重新申请权限）
// 每次失败后做微滑动强制屏幕变化，解决 MediaProjection "Don't re-use" 限制
function _retryCapture(maxTries, intervalMs) {
    for (var i = 0; i < maxTries; i++) {
        var img = _safeCapture();
        if (img) return img;
        if (i < maxTries - 1) {
            // 微滑动（1px）强制屏幕变化
            var cx = device.width / 2;
            var cy = device.height / 2;
            swipe(cx, cy, cx, cy - 1, 30);
            sleep(intervalMs);
        }
    }
    return null;
}

// ============================================================
// 查找并点击「剧集」Tab
// ============================================================

function _clickSeriesTab(img) {
    var w = img.getWidth();
    var h = img.getHeight();

    var roi = _toPixelRegion(SERIES_TAB_ROI, w, h);
    var ocrResult = _ocrScreen(img, roi);

    console.log("  Tab区域OCR(" + ocrResult.mode + "): " + (ocrResult.items || []).length + "条");

    var best = null;
    for (var i = 0; i < (ocrResult.items || []).length; i++) {
        var label = _clean(ocrResult.items[i].label || "");
        var bounds = ocrResult.items[i].bounds || {};

        if (label.indexOf("剧集") >= 0) {
            var score = (label === "剧集") ? 100 :
                        (label.indexOf("剧集") === 0) ? 80 : 50;
            if (!best || score > best.score) {
                best = {
                    label: label,
                    x: Math.round((bounds.left + bounds.right) / 2) + roi[0],
                    y: Math.round((bounds.top + bounds.bottom) / 2) + roi[1]
                };
            }
        }
    }

    if (best) {
        console.log("  OCR 匹配: \"" + best.label + "\" → (" + best.x + "," + best.y + ")");
        click(best.x, best.y);
        sleep(PAGE_DELAY);
        return true;
    }

    // OCR 未匹配：使用固定坐标（"剧集"是第3个Tab）
    var fallbackX = Math.round(w * 0.30);
    var fallbackY = Math.round(h * 0.34);
    console.log("  OCR 未匹配，固定坐标: (" + fallbackX + "," + fallbackY + ")");
    click(fallbackX, fallbackY);
    sleep(PAGE_DELAY);
    return true;
}

// ============================================================
// 读取剧集名列表
// ============================================================

function _readSeriesNames(img) {
    var ocrResult = _ocrScreen(img, null);
    var items = ocrResult.items || [];

    // 找到 Tab 行底部 Y
    var tabBottom = 0;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label || "");
        if (label === "主页" || label === "视频" || label === "剧集") {
            var b = items[i].bounds || {};
            tabBottom = Math.max(tabBottom, b.bottom || 0);
        }
    }
    console.log("  Tab底部Y=" + tabBottom);

    // 收集 Tab 以下的文字
    var contentItems = [];
    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var y = b.top || 0;
        if (y <= tabBottom) continue;

        var label = _clean(items[i].label || "");
        if (!label) continue;

        if (/^\d+集$/.test(label)) continue;
        if (label === "私信" || label === "已关注" || label.indexOf("朋友关注") >= 0) continue;

        contentItems.push({ text: label, y: y, x: b.left || 0, isChinese: _hasChinese(label) });
    }

    // 按行分组（Y 差 < 30px 视为同一行）
    var rows = [];
    for (var i = 0; i < contentItems.length; i++) {
        var added = false;
        for (var r = 0; r < rows.length; r++) {
            if (Math.abs(contentItems[i].y - rows[r][0].y) < 30) {
                rows[r].push(contentItems[i]);
                added = true;
                break;
            }
        }
        if (!added) rows.push([contentItems[i]]);
    }

    // 过滤：整行都是中文的才是剧集行（混有乱码的是 UI 元素行）
    var seriesRows = [];
    for (r = 0; r < rows.length; r++) {
        var allChinese = true;
        for (var ci = 0; ci < rows[r].length; ci++) {
            if (!rows[r][ci].isChinese) { allChinese = false; break; }
        }
        if (allChinese && rows[r].length > 0) seriesRows.push(rows[r]);
    }

    // 每行按 X 排序，提取剧集名
    var names = [];
    console.log("  剧集行(" + seriesRows.length + "行):");
    for (r = 0; r < seriesRows.length; r++) {
        seriesRows[r].sort(function(a, b) { return a.x - b.x; });
        for (ci = 0; ci < seriesRows[r].length; ci++) {
            console.log("    \"" + seriesRows[r][ci].text + "\" Y=" + seriesRows[r][ci].y + " X=" + seriesRows[r][ci].x);
            names.push(seriesRows[r][ci].text);
        }
    }

    return names;
}

// 判断字符串是否包含至少 2 个中文字符
function _hasChinese(s) {
    var count = 0;
    for (var i = 0; i < s.length; i++) {
        var code = s.charCodeAt(i);
        if ((code >= 0x4E00 && code <= 0x9FFF) ||
            (code >= 0x3400 && code <= 0x4DBF) ||
            (code >= 0xF900 && code <= 0xFAFF)) {
            count++;
            if (count >= 2) return true;
        }
    }
    return false;
}

function _isSeriesName(text) {
    if (!text || text.length < 2) return false;

    // 排除 Tab 标签
    if (/^(主页|剧集|视频|作品|合集|直播|店铺|会员)$/.test(text)) return false;

    // 排除按钮/操作文字
    if (/^(已关注|关注|私信|取消关注|赞|评论|转发|分享|可能含有AI生成内容)$/.test(text)) return false;

    // 排除纯数字/序号
    if (/^[\d\s.]+$/.test(text)) return false;

    // 排除常见 UI 噪点
    if (/^(推荐|朋友|我的|发现|消息|我|通用)$/.test(text)) return false;

    return true;
}

// ============================================================
// 行分组：将 OCR items 按 Y 坐标合并为行
// ============================================================

function _groupLines(items, roi) {
    if (!items || items.length === 0) return [];

    // 按 Y 排序
    items.sort(function(a, b) {
        return (a.bounds.top || 0) - (b.bounds.top || 0);
    });

    var lines = [];
    var curParts = [];
    var curTop = -1;
    var curBottom = 0;
    var LINE_TOL = 22;

    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label || "");
        if (!label) continue;

        var b = items[i].bounds || {};
        // 转换到屏幕坐标（如果使用了 ROI）
        var y = (b.top || 0) + (roi ? roi[1] : 0);

        if (curTop < 0 || Math.abs(y - curTop) <= LINE_TOL) {
            curParts.push(label);
            if (curTop < 0) curTop = y;
            curBottom = Math.max(curBottom, (b.bottom || 0) + (roi ? roi[1] : 0));
        } else {
            lines.push({ text: curParts.join(" "), top: curTop, bottom: curBottom });
            curParts = [label];
            curTop = y;
            curBottom = (b.bottom || 0) + (roi ? roi[1] : 0);
        }
    }
    if (curParts.length > 0) {
        lines.push({ text: curParts.join(" "), top: curTop, bottom: curBottom });
    }

    return lines;
}

// ============================================================
// 关注列表账号提取（复用 test_traversal.js 逻辑）
// ============================================================

function _extractAccounts(ocrResult, screenHeight) {
    var items = ocrResult.items || [];
    if (items.length === 0) return [];

    items.sort(function(a, b) { return (a.bounds.top || 0) - (b.bounds.top || 0); });

    var rows = [];
    var curRow = null;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!label) continue;
        var b = items[i].bounds;
        var y = b.top || 0;

        if (!curRow || y - curRow.top > 30) {
            if (curRow && _isAccountRow(curRow, screenHeight)) rows.push(curRow);
            curRow = {
                label: label,
                top: y,
                bottom: b.bottom || (y + 50),
                bounds: [b]
            };
        } else {
            curRow.label += label;
            curRow.bottom = Math.max(curRow.bottom, b.bottom || (y + 50));
            curRow.bounds.push(b);
        }
    }
    if (curRow && _isAccountRow(curRow, screenHeight)) rows.push(curRow);

    for (i = 0; i < rows.length; i++) {
        rows[i].centerY = Math.round((rows[i].top + rows[i].bottom) / 2);
        var l = 9999, r = 0;
        for (var j = 0; j < rows[i].bounds.length; j++) {
            var b2 = rows[i].bounds[j];
            if (b2.left < l) l = b2.left;
            if (b2.right > r) r = b2.right;
        }
        rows[i].textCenterX = Math.round((l + r) / 2);
    }
    return rows;
}

function _isAccountRow(row, screenHeight) {
    var label = row.label;
    if (!label) return false;
    if (/我的关注/.test(label)) return false;
    if (/^(推荐|朋友|赞|评论|转发|可能含有AI生成内容)$/.test(label)) return false;
    if (row.top > screenHeight * 0.92) return false;
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
    for (var i = 0; i < modes.length; i++) {
        var mode = modes[i];
        var attempt = _tryOcr(img, baseOptions, mode);
        if (attempt.ok) {
            return {
                mode: mode,
                count: _ocrLen(attempt.raw),
                items: _normalizeItems(attempt.raw)
            };
        }
    }
    return { mode: "none", count: 0, items: [] };
}

function _tryOcr(img, baseOptions, mode) {
    if (typeof ocr === "undefined") return { ok: false, error: "ocr 不可用" };
    var opts = {};
    for (var k in baseOptions) { if (baseOptions.hasOwnProperty(k)) opts[k] = baseOptions[k]; }
    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) return { ok: true, raw: ocr.paddle.detect(img, opts) };
            if (ocr.detect) { opts.mode = "paddle"; return { ok: true, raw: ocr.detect(img, opts) }; }
            return { ok: false, error: "paddle 不可用" };
        }
        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) return { ok: true, raw: ocr.mlkit.detect(img, opts) };
        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) return { ok: true, raw: ocr.rapid.detect(img, opts) };
        if (mode !== "generic") opts.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, opts) };
        return { ok: false, error: "无可用 OCR" };
    } catch (e) { return { ok: false, error: String(e) }; }
}

function _normalizeItems(results) {
    var out = [];
    if (!results) return out;
    var count = _ocrLen(results);
    for (var i = 0; i < count; i++) {
        var item = _getItem(results, i);
        if (!item) continue;
        out.push({
            label: item.label || item.text || "",
            confidence: item.confidence,
            bounds: _rectObj(item.bounds)
        });
    }
    return out;
}

function _getItem(results, idx) {
    try { if (typeof results.get === "function") return results.get(idx); return results[idx]; } catch (e) {}
    return null;
}

function _ocrLen(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try { if (typeof results.size === "function") return results.size(); } catch (e) {}
    return 0;
}

function _rectObj(rect) {
    if (!rect) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: Number(rect.left || 0), top: Number(rect.top || 0), right: Number(rect.right || 0), bottom: Number(rect.bottom || 0) };
}

// ============================================================
// 工具函数
// ============================================================

function _clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function _toPixelRegion(roi, w, h) {
    var x = _normVal(roi[0], w), y = _normVal(roi[1], h);
    var rw = _normVal(roi[2], w), rh = _normVal(roi[3], h);
    if (rw <= 0) rw = w - x; if (rh <= 0) rh = h - y;
    x = Math.round(Math.max(0, Math.min(x, w - 1)));
    y = Math.round(Math.max(0, Math.min(y, h - 1)));
    rw = Math.round(Math.max(1, Math.min(rw, w - x)));
    rh = Math.round(Math.max(1, Math.min(rh, h - y)));
    return [x, y, rw, rh];
}

function _normVal(v, total) { return (v > -1 && v < 1) ? v * total : v; }

function _beijingTime() {
    var now = new Date();
    var beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    function p(n) { return n < 10 ? "0" + n : "" + n; }
    return beijing.getUTCFullYear() + "-" +
        p(beijing.getUTCMonth() + 1) + "-" +
        p(beijing.getUTCDate()) + " " +
        p(beijing.getUTCHours()) + ":" +
        p(beijing.getUTCMinutes()) + ":" +
        p(beijing.getUTCSeconds());
}

// 初始化截图权限（仅启动时调用一次）
function _initCapture() {
    try { images.stopScreenCapture(); } catch (e) {}
    sleep(500);

    if (!requestScreenCapture()) {
        console.log("[错误] 请求截图权限失败");
        exit();
    }
    sleep(1500); // 等待权限对话框消失
    console.log("  截图权限就绪");
}

// 安全截图：单次调用，不重新申请权限（权限由 _initCapture 统一处理）
function _safeCapture() {
    try {
        return captureScreen();
    } catch (e) {
        return null;
    }
}

function padRight(s, len) {
    var str = String(s);
    // 中文字符按2宽度计算
    var width = 0;
    for (var i = 0; i < str.length; i++) {
        width += (str.charCodeAt(i) > 127) ? 2 : 1;
    }
    while (width < len) { str += " "; width++; }
    return str;
}
