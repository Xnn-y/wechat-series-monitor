/**
 * Phase 2：剧集页滚动分页采集
 *
 * 前提：手动进入微信 → 发现 → 视频号 → 个人中心 → 关注列表页面
 * 功能：
 *   1-3. 同 Phase 1（读关注列表 → 点账号 → 点剧集Tab）
 *   4. 剧集页初始读取 + 向下滚动读取更多，直到 12 部或无法加载
 *   5. 打印全部剧集名 + 北京时间
 *
 * 验证：确认滚动后能读取到新剧集名，累计不超过 12 部
 */

"auto";

// ============================================================
// 配置
// ============================================================
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var PAGE_DELAY = 1200;
var MAX_SERIES = 12;            // 每账号最多采集 12 部
var MAX_SCROLLS = 6;            // 最多滚动 6 次，防止无限循环
var SCROLL_WAIT = 1800;         // 滚动后等待加载

// 剧集 Tab ROI
var SERIES_TAB_ROI = [0, 0.28, 1, 0.15];

// ============================================================
// 主流程
// ============================================================

main();

function main() {
    console.show();
    console.setSize(800, 600);
    console.log("╔══════════════════════════════════════╗");
    console.log("║   Phase 2：滚动分页采集               ║");
    console.log("╚══════════════════════════════════════╝");
    console.log("  目标: 每账号最多 " + MAX_SERIES + " 部剧集");
    console.log("");

    // 初始化截图
    console.log("=== 步骤1：读取关注列表 ===");
    _initCapture();

    var img = _safeCapture();
    if (!img) {
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

    if (accounts.length === 0) { console.log("[错误] 未识别到任何账号"); exit(); }
    console.log("识别到 " + accounts.length + " 个账号：");
    for (var a = 0; a < accounts.length; a++) {
        var tag = (a === 0) ? " [跳过-自己]" : "";
        console.log("  [" + a + "] " + accounts[a].label + tag);
    }
    if (accounts.length < 2) { console.log("[错误] 关注列表只有自己"); exit(); }

    // 步骤2：点击账号
    var target = accounts[1];
    console.log("\n=== 步骤2：点击账号 [" + target.label + "] ===");
    var clickResult = _clickAccount(target);
    if (!clickResult.success) { console.log("[错误] 点击账号失败"); exit(); }
    console.log("[成功] 已进入账号主页");

    // 步骤3：点击剧集Tab
    console.log("\n=== 步骤3：查找并点击「剧集」Tab ===");
    var seriesTabClicked = _clickSeriesTab(clickResult.img);
    clickResult.img.recycle();
    if (!seriesTabClicked) { console.log("[错误] 未找到剧集Tab"); exit(); }
    console.log("[成功] 已进入剧集页面");

    // 步骤4：读取剧集名 + 滚动分页
    console.log("\n=== 步骤4：读取剧集（最多" + MAX_SERIES + "部）===");
    var allNames = [];
    var noNewCount = 0;

    sleep(PAGE_DELAY);

    for (var scroll = 0; scroll < MAX_SCROLLS; scroll++) {
        var pageImg = _safeCapture();
        if (!pageImg) {
            console.log("  [警告] 截图失败，跳过本轮");
            break;
        }

        var pageNames = _readSeriesNames(pageImg);
        pageImg.recycle();

        var newCount = 0;
        for (var i = 0; i < pageNames.length; i++) {
            if (!_nameExists(allNames, pageNames[i])) {
                allNames.push(pageNames[i]);
                newCount++;
            }
        }

        // 子串去重：如果短名是长名的子串，保留长的，删短的
        allNames = _dedupSubstrings(allNames);

        console.log("  本页 " + pageNames.length + " 部, 新增 " + newCount + " 部, 累计 " + allNames.length + " 部");

        if (allNames.length >= MAX_SERIES) {
            console.log("  → 已达 " + MAX_SERIES + " 部上限，停止滚动");
            break;
        }

        if (newCount === 0) {
            noNewCount++;
            if (noNewCount >= 2) {
                console.log("  → 连续无新增，停止滚动");
                break;
            }
        } else {
            noNewCount = 0;
        }

        // 向下滚动
        console.log("  ↓ 向下滚动...");
        _scrollDown();
        sleep(SCROLL_WAIT);
    }

    // 截断到 MAX_SERIES
    allNames = allNames.slice(0, MAX_SERIES);

    // 输出结果
    console.log("\n┌──────────────────────────────────────┐");
    console.log("│  账号: " + padRight(target.label, 28) + "│");
    console.log("│  读取时间: " + _beijingTime() + " │");
    console.log("│  剧集数: " + allNames.length + "                            │");
    console.log("├──────────────────────────────────────┤");
    for (var j = 0; j < allNames.length; j++) {
        console.log("│  " + padRight((j + 1) + ". " + allNames[j], 36) + "│");
    }
    if (allNames.length === 0) {
        console.log("│  (未识别到剧集名)                     │");
    }
    console.log("└──────────────────────────────────────┘");

    console.log("\n=== Phase 2 完成 ===");
    toastLog("Phase 2 完成: " + target.label + " (" + allNames.length + "部)");
}

// ============================================================
// 滚动页面
// ============================================================

function _scrollDown() {
    var w = device.width;
    var h = device.height;
    // 从 75% 高度滑到 25% 高度，模拟手指上滑
    swipe(w / 2, Math.round(h * 0.75), w / 2, Math.round(h * 0.25), 500);
}

// ============================================================
// 点击账号
// ============================================================

function _clickAccount(account) {
    var w = device.width;
    var points = [
        { x: Math.round(w * 0.50), y: account.centerY, label: "center" },
        { x: Math.round(w * 0.45), y: account.centerY, label: "mid_left" },
        { x: Math.round(w * 0.55), y: account.centerY, label: "mid_right" },
        { x: account.textCenterX, y: account.centerY, label: "text_center" }
    ];

    for (var pi = 0; pi < points.length; pi++) {
        var pt = points[pi];
        console.log("  尝试点击: x=" + pt.x + " y=" + pt.y + " (" + pt.label + ")");
        click(pt.x, pt.y);
        sleep(PAGE_DELAY + 800);

        var verifyImg = _retryCapture(2, 500);
        if (!verifyImg) { console.log("  → 验证截图失败，尝试下一个位置"); continue; }

        var vOcr = _ocrScreen(verifyImg, null);
        var stillOnFollow = false;
        for (var vi = 0; vi < (vOcr.items || []).length; vi++) {
            if (_clean(vOcr.items[vi].label || "").indexOf("我的关注") >= 0) {
                stillOnFollow = true; break;
            }
        }

        if (!stillOnFollow) {
            console.log("  → 页面已跳转，点击成功 (" + pt.label + ")");
            return { success: true, img: verifyImg };
        }
        console.log("  → 仍在关注页，重试...");
        verifyImg.recycle();
    }

    console.log("  [警告] 所有点击位置均未跳转");
    return { success: false };
}

// 重试截图（纯等待重试，不做微滑动）
function _retryCapture(maxTries, intervalMs) {
    for (var i = 0; i < maxTries; i++) {
        var img = _safeCapture();
        if (img) return img;
        if (i < maxTries - 1) sleep(intervalMs);
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
            var score = (label === "剧集") ? 100 : (label.indexOf("剧集") === 0) ? 80 : 50;
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

    // 找到 Tab 行底部 Y（"主页"/"视频"/"剧集" 中最大的 bottom）
    var tabBottom = 0;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label || "");
        if (label === "主页" || label === "视频" || label === "剧集") {
            var b = items[i].bounds || {};
            tabBottom = Math.max(tabBottom, b.bottom || 0);
        }
    }
    // 兜底：如果没检测到Tab，用屏幕35%高度作为最低过滤线
    if (tabBottom === 0) tabBottom = Math.round(img.getHeight() * 0.35);
    // 加 40px 安全边距
    tabBottom += 40;
    console.log("  Tab底部Y=" + tabBottom);

    var contentItems = [];
    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var y = b.top || 0;
        if (y <= tabBottom) continue;

        var label = _clean(items[i].label || "");
        if (!label) continue;

        // 排除：集数标识、"主页/视频/剧集"Tab文字、UI元素
        if (/^\d+集$/.test(label)) continue;
        if (_isTabText(label)) continue;

        contentItems.push({ text: label, y: y, x: b.left || 0, isChinese: _hasChinese(label) });
    }

    // 按行分组
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

    // 过滤：整行纯中文才是剧集行
    var seriesRows = [];
    for (var r = 0; r < rows.length; r++) {
        var allChinese = true;
        for (var ci = 0; ci < rows[r].length; ci++) {
            if (!rows[r][ci].isChinese) { allChinese = false; break; }
        }
        if (allChinese && rows[r].length > 0) seriesRows.push(rows[r]);
    }

    // 提取
    var names = [];
    for (var r = 0; r < seriesRows.length; r++) {
        seriesRows[r].sort(function(a, b) { return a.x - b.x; });
        for (var ci = 0; ci < seriesRows[r].length; ci++) {
            names.push(seriesRows[r][ci].text);
        }
    }

    return names;
}

// 判断是否为 Tab 行文字（主页/视频/剧集及其组合）
function _isTabText(label) {
    if (label === "主页" || label === "视频" || label === "剧集") return true;
    // 组合形式如 "主页 视频"、"主页 视频 剧集"
    var parts = label.split(/\s+/);
    var tabCount = 0;
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "主页" || parts[i] === "视频" || parts[i] === "剧集") tabCount++;
    }
    return tabCount >= 2; // 包含2个及以上Tab关键词
}

// ============================================================
// 工具函数
// ============================================================

// 检查名字是否已存在（去标点后比对，含子串匹配）
function _nameExists(list, name) {
    var cleanName = _stripPunct(name);
    for (var i = 0; i < list.length; i++) {
        var cleanItem = _stripPunct(list[i]);
        if (cleanItem === cleanName) return true;
        if (cleanItem.indexOf(cleanName) >= 0 || cleanName.indexOf(cleanItem) >= 0) return true;
    }
    return false;
}

// 子串去重：短名是长名的一部分时，保留长的
function _dedupSubstrings(list) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
        var keep = true;
        var cleanI = _stripPunct(list[i]);
        for (var j = 0; j < list.length; j++) {
            if (i === j) continue;
            var cleanJ = _stripPunct(list[j]);
            if (cleanJ.indexOf(cleanI) >= 0 && cleanJ.length > cleanI.length) {
                keep = false;
                break;
            }
        }
        if (keep) result.push(list[i]);
    }
    return result;
}

// 去除标点符号
function _stripPunct(s) {
    return s.replace(/[,，。.、；;：:！!？?""''（）()【】\[\]\s]/g, "");
}

function _hasChinese(s) {
    var total = s.length;
    if (total < 2) return false;
    var chCount = 0;
    for (var i = 0; i < total; i++) {
        var code = s.charCodeAt(i);
        if ((code >= 0x4E00 && code <= 0x9FFF) ||
            (code >= 0x3400 && code <= 0x4DBF) ||
            (code >= 0xF900 && code <= 0xFAFF)) {
            chCount++;
        }
    }
    // 至少 3 个中文字符，且中文字符占比 >= 70%
    return chCount >= 3 && (chCount / total) >= 0.70;
}

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

function _initCapture() {
    try { images.stopScreenCapture(); } catch (e) {}
    sleep(500);
    if (!requestScreenCapture()) { console.log("[错误] 请求截图权限失败"); exit(); }
    sleep(1500);
    console.log("  截图权限就绪");
}

function _safeCapture() {
    try { return captureScreen(); } catch (e) { return null; }
}

function padRight(s, len) {
    var str = String(s);
    var width = 0;
    for (var i = 0; i < str.length; i++) {
        width += (str.charCodeAt(i) > 127) ? 2 : 1;
    }
    while (width < len) { str += " "; width++; }
    return str;
}

// ============================================================
// OCR 引擎
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
            return { mode: mode, count: _ocrLen(attempt.raw), items: _normalizeItems(attempt.raw) };
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
        out.push({ label: item.label || item.text || "", confidence: item.confidence, bounds: _rectObj(item.bounds) });
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
// 关注列表账号提取
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
            curRow = { label: label, top: y, bottom: b.bottom || (y + 50), bounds: [b] };
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
