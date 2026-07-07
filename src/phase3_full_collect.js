/**
 * Phase 3：完整遍历采集 + CSV 写入
 *
 * 前提：手动进入微信 → 发现 → 视频号 → 个人中心 → 关注列表页面
 * 功能：
 *   1. 读取关注列表所有账号（跳过"自己"）
 *   2. 遍历每个账号：进入主页 → 剧集Tab → 滚动采集（最多12部）
 *   3. 采集完返回关注列表，继续下一个账号
 *   4. 全部采集完毕后写入 CSV（去重追加）
 *
 * CSV 文件：data/series_data.csv
 * 格式：account,series_name,collect_time
 */

"auto";

// ============================================================
// 配置
// ============================================================
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var PAGE_DELAY = 1200;
var MAX_SERIES = 12;
var MAX_SCROLLS = 6;
var SCROLL_WAIT = 1800;
var SERIES_TAB_ROI = [0, 0.28, 1, 0.15];

var CSV_DIR = files.path("./data");
var CSV_FILE = files.path("./data/series_data.csv");

// ============================================================
// 主流程
// ============================================================

main();

function main() {
    console.show();
    console.setSize(800, 700);
    console.log("╔══════════════════════════════════════╗");
    console.log("║   Phase 3：完整遍历 + CSV 写入        ║");
    console.log("╚══════════════════════════════════════╝");
    console.log("  每账号最多 " + MAX_SERIES + " 部剧集");
    console.log("  CSV: " + CSV_FILE);
    console.log("");

    // ==== 初始化截图 ====
    _initCapture();

    // ==== 步骤1：读取关注列表 ====
    console.log("=== 步骤1：读取关注列表 ===");
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
    if (accounts.length < 2) { console.log("[错误] 关注列表只有自己，无需采集"); exit(); }

    // ==== 读取已有 CSV 记录（用于去重） ====
    var existingRecords = _readCsv();
    console.log("\n  已有 CSV 记录: " + existingRecords.length + " 条");

    // ==== 步骤2：遍历所有账号 ====
    var collectTime = _beijingTime();
    var allResults = [];       // [{ account, series }]
    var successCount = 0;
    var failCount = 0;

    for (var accIdx = 1; accIdx < accounts.length; accIdx++) {
        var account = accounts[accIdx];
        console.log("\n═══════════════════════════════════════");
        console.log("  账号 [" + (accIdx) + "/" + (accounts.length - 1) + "]: " + account.label);
        console.log("═══════════════════════════════════════");

        // 点击账号
        console.log("  → 点击账号...");
        var clickResult = _clickAccount(account);
        if (!clickResult.success) {
            console.log("  [跳过] 点击账号失败");
            failCount++;
            _goBack();
            sleep(PAGE_DELAY);
            continue;
        }

        // 点击剧集Tab
        console.log("  → 查找剧集Tab...");
        var tabOk = _clickSeriesTab(clickResult.img);
        clickResult.img.recycle();
        if (!tabOk) {
            console.log("  [跳过] 未找到剧集Tab");
            failCount++;
            _goBack();
            sleep(PAGE_DELAY);
            continue;
        }

        // 滚动采集剧集名
        console.log("  → 采集剧集...");
        var names = _collectSeries();
        var newCount = 0;
        for (var ni = 0; ni < names.length; ni++) {
            if (!_csvExists(existingRecords, account.label, names[ni])) {
                allResults.push({ account: account.label, series: names[ni] });
                existingRecords.push({ account: account.label, series: names[ni] });
                newCount++;
            }
        }

        console.log("  → 剧集: " + names.length + " 部, 新增: " + newCount + " 部");
        successCount++;

        // 返回关注列表
        _goBack();
        sleep(PAGE_DELAY);
    }

    // ==== 写入 CSV ====
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║   采集汇总                             ║");
    console.log("╠══════════════════════════════════════╣");
    console.log("║  成功: " + successCount + " 个账号                           ║");
    console.log("║  失败: " + failCount + " 个账号                           ║");
    console.log("║  新剧集: " + allResults.length + " 部                          ║");
    console.log("╚══════════════════════════════════════╝");

    if (allResults.length > 0) {
        _writeCsv(allResults, collectTime);
        console.log("\n  已写入 CSV: " + allResults.length + " 条 → " + CSV_FILE);
    } else {
        console.log("\n  无新剧集，CSV 未更新");
    }

    console.log("\n=== Phase 3 完成 ===");
    toastLog("采集完成: " + successCount + "个账号, " + allResults.length + "部新剧集");
}

// ============================================================
// 滚动采集剧集名（单个账号）
// ============================================================

function _collectSeries() {
    var allNames = [];
    var noNewCount = 0;
    sleep(PAGE_DELAY);

    for (var scroll = 0; scroll < MAX_SCROLLS; scroll++) {
        var pageImg = _safeCapture();
        if (!pageImg) {
            console.log("    [警告] 截图失败，跳过本轮");
            break;
        }

        var pageNames = _readSeriesNames(pageImg);
        pageImg.recycle();

        var beforeCount = allNames.length;
        allNames = _mergeAndDedup(allNames, pageNames);
        var newCount = allNames.length - beforeCount;

        console.log("    第" + (scroll + 1) + "页: " + pageNames.length + " 部, 新增 " + newCount + ", 累计 " + allNames.length);

        if (allNames.length >= MAX_SERIES) break;
        if (newCount === 0) {
            noNewCount++;
            if (noNewCount >= 2) break;
        } else {
            noNewCount = 0;
        }

        _scrollDown();
        sleep(SCROLL_WAIT);
    }

    return allNames.slice(0, MAX_SERIES);
}

// ============================================================
// CSV 读写
// ============================================================

function _readCsv() {
    var records = [];
    if (!files.exists(CSV_FILE)) return records;
    try {
        var content = files.read(CSV_FILE);
        var lines = content.split(/\r?\n/);
        for (var i = 1; i < lines.length; i++) {  // 跳过表头
            var line = lines[i].trim();
            if (!line) continue;
            var cols = line.split(",");
            if (cols.length >= 2) {
                records.push({ account: cols[0].trim(), series: cols[1].trim() });
            }
        }
    } catch (e) {
        console.log("  [警告] 读取CSV失败: " + e);
    }
    return records;
}

function _csvExists(records, account, series) {
    for (var i = 0; i < records.length; i++) {
        if (records[i].account === account && records[i].series === series) return true;
    }
    return false;
}

function _writeCsv(results, time) {
    // 确保目录存在
    if (!files.exists(CSV_DIR)) {
        files.createWithDirs(CSV_DIR);
    }

    var isNew = !files.exists(CSV_FILE);
    var lines = [];
    if (isNew) {
        lines.push("account,series_name,collect_time");
    }

    // 只在内存中去重（文件级去重已在主循环中完成）
    for (var i = 0; i < results.length; i++) {
        // CSV 字段含逗号时用引号包裹
        var acc = _csvEscape(results[i].account);
        var ser = _csvEscape(results[i].series);
        lines.push(acc + "," + ser + "," + time);
    }

    try {
        if (isNew) {
            files.write(CSV_FILE, lines.join("\n"));
        } else {
            files.write(CSV_FILE, lines.join("\n") + "\n", "a");  // 追加模式
        }
    } catch (e) {
        console.log("  [警告] 写入CSV失败: " + e);
    }
}

function _csvEscape(s) {
    if (s.indexOf(",") >= 0 || s.indexOf("\"") >= 0 || s.indexOf("\n") >= 0) {
        return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
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
        click(pt.x, pt.y);
        sleep(PAGE_DELAY + 800);

        var verifyImg = _retryCapture(2, 500);
        if (!verifyImg) continue;

        var vOcr = _ocrScreen(verifyImg, null);
        var stillOnFollow = false;
        for (var vi = 0; vi < (vOcr.items || []).length; vi++) {
            if (_clean(vOcr.items[vi].label || "").indexOf("我的关注") >= 0) {
                stillOnFollow = true; break;
            }
        }

        if (!stillOnFollow) {
            return { success: true, img: verifyImg };
        }
        verifyImg.recycle();
    }

    return { success: false };
}

// ============================================================
// 查找并点击「剧集」Tab
// ============================================================

function _clickSeriesTab(img) {
    var w = img.getWidth();
    var h = img.getHeight();

    var roi = _toPixelRegion(SERIES_TAB_ROI, w, h);
    var ocrResult = _ocrScreen(img, roi);

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
        click(best.x, best.y);
        sleep(PAGE_DELAY);
        return true;
    }

    // 兜底：固定坐标
    click(Math.round(w * 0.30), Math.round(h * 0.34));
    sleep(PAGE_DELAY);
    return true;
}

// ============================================================
// 读取剧集名列表
// ============================================================

function _readSeriesNames(img) {
    var ocrResult = _ocrScreen(img, null);
    var items = ocrResult.items || [];

    // Tab 行底部 Y
    var tabBottom = 0;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label || "");
        if (label === "主页" || label === "视频" || label === "剧集") {
            var b = items[i].bounds || {};
            tabBottom = Math.max(tabBottom, b.bottom || 0);
        }
    }
    if (tabBottom === 0) tabBottom = Math.round(img.getHeight() * 0.35);
    tabBottom += 40;

    var contentItems = [];
    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        if ((b.top || 0) <= tabBottom) continue;

        var label = _clean(items[i].label || "");
        if (!label) continue;
        if (/^\d+集$/.test(label)) continue;
        if (_isTabText(label)) continue;

        contentItems.push({ text: label, y: b.top || 0, x: b.left || 0, isChinese: _hasChinese(label) });
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

    // 整行纯中文
    var seriesRows = [];
    for (var r = 0; r < rows.length; r++) {
        var allChinese = true;
        for (var ci = 0; ci < rows[r].length; ci++) {
            if (!rows[r][ci].isChinese) { allChinese = false; break; }
        }
        if (allChinese && rows[r].length > 0) seriesRows.push(rows[r]);
    }

    // 提取：去标点后至少 4 个中文字符
    var names = [];
    for (var r = 0; r < seriesRows.length; r++) {
        seriesRows[r].sort(function(a, b) { return a.x - b.x; });
        for (var ci = 0; ci < seriesRows[r].length; ci++) {
            var clean = _stripPunct(seriesRows[r][ci].text);
            if (_hasChinese(clean) && clean.length >= 4) {
                names.push(clean);
            }
        }
    }

    return names;
}

// ============================================================
// 合并去重
// ============================================================

function _mergeAndDedup(existing, newNames) {
    for (var i = 0; i < newNames.length; i++) {
        if (!_nameExists(existing, newNames[i])) {
            existing.push(newNames[i]);
        }
    }
    return _dedupSubstrings(existing);
}

function _nameExists(list, name) {
    var cleanName = _toSimplified(_stripPunct(name));
    for (var i = 0; i < list.length; i++) {
        var cleanItem = _toSimplified(_stripPunct(list[i]));
        if (cleanItem === cleanName) return true;
        if (cleanItem.indexOf(cleanName) >= 0 || cleanName.indexOf(cleanItem) >= 0) return true;
        if (_charOverlapRatio(list[i], name) >= 0.6) return true;
    }
    if (_isFragmentMerge(cleanName, list)) return true;
    for (var i = 0; i < list.length; i++) {
        if (_charOverlapRatio(name, list[i]) >= 0.7) return true;
    }
    return false;
}

function _isFragmentMerge(name, existing) {
    if (existing.length < 2) return false;
    var nameLen = name.length;
    var prefixLen = 0;
    for (var p = nameLen; p >= 2; p--) {
        var prefix = name.substring(0, p);
        for (var i = 0; i < existing.length; i++) {
            if (_toSimplified(_stripPunct(existing[i])).indexOf(prefix) >= 0) {
                prefixLen = p; break;
            }
        }
        if (prefixLen > 0) break;
    }
    var suffixLen = 0;
    for (var s = nameLen; s >= 2; s--) {
        var suffix = name.substring(nameLen - s);
        for (var i = 0; i < existing.length; i++) {
            if (_toSimplified(_stripPunct(existing[i])).indexOf(suffix) >= 0) {
                suffixLen = s; break;
            }
        }
        if (suffixLen > 0) break;
    }
    return prefixLen + suffixLen >= nameLen * 0.6;
}

function _dedupSubstrings(list) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
        var keep = true;
        var cleanI = _toSimplified(_stripPunct(list[i]));
        for (var j = 0; j < list.length; j++) {
            if (i === j) continue;
            var cleanJ = _toSimplified(_stripPunct(list[j]));
            if (cleanJ.indexOf(cleanI) >= 0 && cleanJ.length > cleanI.length) {
                keep = false; break;
            }
        }
        if (keep) result.push(list[i]);
    }
    return result;
}

// ============================================================
// 文本工具
// ============================================================

function _stripPunct(s) {
    return s.replace(/[,，。.、；;：:！!？?""''（）()【】\[\]\s]/g, "");
}

// 繁简映射：用 charCode 构建，避免 Rhino 引擎解析中文键值的编码问题
var TRAD_TO_SIMP = (function() {
    var pairs = [
        [0x7D05,0x7EA2],[0x9580,0x95E8],[0x898B,0x89C1],[0x99AC,0x9A6C],[0x98A8,0x98CE],[0x8ECA,0x8F66],
        [0x6771,0x4E1C],[0x9577,0x957F],[0x958B,0x5F00],[0x95DC,0x5173],[0x66F8,0x4E66],[0x6642,0x65F6],
        [0x6703,0x4F1A],[0x4F86,0x6765],[0x5C0D,0x5BF9],[0x52D5,0x52A8],[0x842C,0x4E07],[0x904E,0x8FC7],
        [0x500B,0x4E2A],[0x5011,0x4EEC],[0x8AAA,0x8BF4],[0x5B78,0x5B66],[0x5BE6,0x5B9E],[0x9AD4,0x4F53],
        [0x9F8D,0x9F99],[0x9CF3,0x51E4],[0x5922,0x68A6],[0x611B,0x7231],[0x570B,0x56FD],[0x8ECD,0x519B],
        [0x6A02,0x4E50],[0x6C23,0x6C14],[0x96FB,0x7535],[0x982D,0x5934],[0x8072,0x58F0],[0x8655,0x5904],
        [0x98DB,0x98DE],[0x9B5A,0x9C7C],[0x9CE5,0x9E1F],[0x7570,0x5F02],[0x8449,0x53F6],[0x7FA9,0x4E49],
        [0x8C50,0x4E30],[0x96F2,0x4E91],[0x967D,0x9633],[0x9670,0x9634],[0x9060,0x8FDC],[0x9023,0x8FDE],
        [0x6975,0x6781],[0x6BBA,0x6740],[0x7121,0x65E0],[0x9054,0x8FBE],[0x723E,0x5C14],[0x8F15,0x8F7B],
        [0x969B,0x9645],[0x96A8,0x968F],[0x96D6,0x867D],[0x9748,0x7075],[0x975C,0x9759],[0x96D9,0x53CC],
        [0x96E3,0x96BE],[0x96E2,0x79BB],[0x97FF,0x54CD],[0x986F,0x663E],[0x9A5A,0x60CA]
    ];
    var map = {};
    for (var i = 0; i < pairs.length; i++) {
        map[String.fromCharCode(pairs[i][0])] = String.fromCharCode(pairs[i][1]);
    }
    return map;
})();

function _toSimplified(s) {
    if (typeof s !== "string") return String(s || "");
    if (typeof TRAD_TO_SIMP === "undefined") return s;  // Rhino 编码兼容
    var result = "";
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        result += TRAD_TO_SIMP[ch] || ch;
    }
    return result;
}

function _charOverlapRatio(a, b) {
    var sa = _toSimplified(_stripPunct(a));
    var sb = _toSimplified(_stripPunct(b));
    if (sa.length === 0 || sb.length === 0) return 0;
    var shorter = sa.length <= sb.length ? sa : sb;
    var longer = sa.length <= sb.length ? sb : sa;
    var matchCount = 0;
    for (var i = 0; i < shorter.length; i++) {
        if (longer.indexOf(shorter.charAt(i)) >= 0) matchCount++;
    }
    return matchCount / shorter.length;
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
    return chCount >= 3 && (chCount / total) >= 0.70;
}

function _isTabText(label) {
    if (label === "主页" || label === "视频" || label === "剧集") return true;
    var parts = label.split(/\s+/);
    var tabCount = 0;
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "主页" || parts[i] === "视频" || parts[i] === "剧集") tabCount++;
    }
    return tabCount >= 2;
}

function _clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

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
// 截图工具
// ============================================================

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

function _retryCapture(maxTries, intervalMs) {
    for (var i = 0; i < maxTries; i++) {
        var img = _safeCapture();
        if (img) return img;
        if (i < maxTries - 1) sleep(intervalMs);
    }
    return null;
}

// ============================================================
// 导航
// ============================================================

function _scrollDown() {
    var w = device.width;
    var h = device.height;
    swipe(w / 2, Math.round(h * 0.75), w / 2, Math.round(h * 0.25), 500);
}

function _goBack() {
    back();
}

// ============================================================
// 时间
// ============================================================

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

// ============================================================
// 坐标
// ============================================================

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
