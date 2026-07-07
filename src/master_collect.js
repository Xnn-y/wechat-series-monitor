/**
 * 视频号关注账号采集主控脚本
 *
 * 当前主流程：
 *   从已经打开的「我的关注」列表开始
 *   → 遍历每个关注账号（跳过第1个自己）
 *     → 进入账号主页 → OCR 识别「主页 / 视频 / 剧集」Tab → 点击「剧集」
 *     → 在剧集栏页面直接 OCR 读取四宫格剧集名称
 *     → 按账号+剧名去重写入 CSV，并记录当前北京时间
 *     → 当前账号读取 12 部剧后停止
 *   → back 返回关注列表 → 继续下一个账号
 *   → 一屏账号完毕 → 向上滑动加载更多
 *   → 直到遍历所有账号
 *
 * 输出: /sdcard/Download/wechat_video_watch.csv
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 * 前置条件：手动停在视频号「我的关注」列表
 * 说明：前置导航仍保留为可选兜底，但当前开发只聚焦关注列表之后的流程。
 */

"auto";

// ============================================================
// 配置
// ============================================================
var CSV_PATH = "/sdcard/Download/wechat_video_watch.csv";
var SERIES_LIMIT_PER_ACCOUNT = 12;        // 每个账号每轮最多读取 12 部剧
var MAX_EMPTY_SERIES_PAGES = 2;           // 连续几页没有可点剧集后停止当前账号
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var STEP_DELAY = 800;                     // 每步操作等待ms
var PAGE_DELAY = 1200;                    // 页面切换等待ms
var ASSUME_ALREADY_ON_FOLLOWING_LIST = true; // 当前主入口：默认从「我的关注」列表开始
var CAPTURE_RETRY = 2;
var CAPTURE_COOLDOWN_MS = 900;
var _lastCaptureAt = 0;

// 固定导航点击点。使用屏幕比例坐标，避免导航阶段触发截图权限。
var NAV_DISCOVER = [0.625, 0.945];
var NAV_CHANNELS = [0.20, 0.215];         // 发现页「视频号」左侧图标/文字区域
var NAV_PROFILE_ICON = [0.936, 0.056];
var NAV_FOLLOWING = [0.50, 0.245];

// 账号主页 Tab 参数
var PROFILE_TAB_ROI = [0, 0.30, 1, 0.16];
var SERIES_TAB_FALLBACK = [0.335, 0.365];

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=".repeat(40));
    console.log("视频号采集主控脚本 启动");
    console.log("模式: 从「我的关注」列表开始，每个账号读取 " + SERIES_LIMIT_PER_ACCOUNT + " 部剧");
    console.log("CSV: " + CSV_PATH);
    console.log("=".repeat(40));

    // 只申请截图权限，不立即截图，避免 MediaProjection 会话复用异常
    if (!_primeScreenCapture()) {
        console.log("错误: 无法建立截图会话");
        exit();
    }

    // 初始化 CSV
    initCsv();

    var collected = 0;
    var scanned = 0;

    // ---- 当前主入口：从「我的关注」列表开始 ----
    if (ASSUME_ALREADY_ON_FOLLOWING_LIST) {
        console.log("入口: 已假设当前在「我的关注」列表，跳过前置导航");
    } else {
        console.log("入口: 执行可选前置导航到「我的关注」列表");
        if (!navigateToFollowingList()) {
            console.log("严重错误: 无法到达关注列表");
            toastLog("采集中止");
            exit();
        }
    }

    // ---- 读取关注总数 ----
    _ensureCapturePermission();
    var totalAccounts = readFollowingCount();
    console.log("关注总数: " + (totalAccounts || "未知"));

    // ---- 外层循环：遍历关注账号 ----
    var processedNames = {}; // 去重：已处理的账号名
    var accountIndex = 0;
    var round = 0;
    var maxRounds = 50; // 安全上限

    sleep(500);
    while (round < maxRounds) {
        round++;

        // 全屏 OCR 获取可见账号
        _ensureCapturePermission();
        var img = _safeCaptureScreen("关注列表 OCR");
        if (!img) break;
        var ocrResult = _ocrScreen(img, null);
        var accounts = extractFollowingAccounts(ocrResult, img.getHeight());
        img.recycle();

        // 过滤已处理的账号 + 跳过自己
        var pending = [];
        for (var i = 0; i < accounts.length; i++) {
            if (i === 0 && round === 1) continue; // 跳过第一个（自己）
            var name = accounts[i].label;
            if (!processedNames[name]) {
                pending.push(accounts[i]);
            }
        }

        if (pending.length === 0) {
            console.log("当前屏无新账号，滑动加载...");
            _swipeUp();
            sleep(PAGE_DELAY);
            continue;
        }

        // ---- 内层：点击每个账号 ----
        for (var i = 0; i < pending.length; i++) {
            var account = pending[i];
            accountIndex++;
            console.log("\n--- 账号[" + accountIndex + "/" + (totalAccounts || "?") + "] \"" + account.label + "\" ---");

            // 点击账号
            click(Math.round(device.width * 0.5), account.centerY);
            sleep(PAGE_DELAY + 500);

            if (!clickSeriesTab()) {
                console.log("未能进入「剧集」页，跳过此账号");
                back();
                sleep(PAGE_DELAY);
                processedNames[account.label] = true;
                continue;
            }

            // ---- 内层循环：在账号主页「剧集」栏直接读取剧集卡片 ----
            var accountCollected = 0;
            var accountScanned = 0;
            var emptyPages = 0;
            var seenSeriesInAccount = {};

            while (accountScanned < SERIES_LIMIT_PER_ACCOUNT) {
                var visibleSeries = readVisibleSeriesNames();
                var newThisPage = 0;

                for (var s = 0; s < visibleSeries.length && accountScanned < SERIES_LIMIT_PER_ACCOUNT; s++) {
                    var seriesName = visibleSeries[s].name;
                    var seriesKey = _normalizeCsvKey(seriesName);
                    if (!seriesKey || seenSeriesInAccount[seriesKey]) continue;
                    seenSeriesInAccount[seriesKey] = true;
                    newThisPage++;
                    accountScanned++;
                    scanned++;

                    var readTime = _formatBeijingTime(new Date());
                    console.log("剧集[" + accountScanned + "/" + SERIES_LIMIT_PER_ACCOUNT + "]: " + seriesName + " | 读取时间 " + readTime);

                    var writeResult = writeCsvRow({
                        account: account.label,
                        series: seriesName,
                        readTimeBeijing: readTime
                    });
                    if (writeResult.written) {
                        collected++;
                        accountCollected++;
                        console.log("已写入CSV: " + seriesName);
                    } else {
                        console.log("CSV 已存在，跳过: " + seriesName);
                    }
                }

                if (accountScanned >= SERIES_LIMIT_PER_ACCOUNT) break;

                if (newThisPage === 0) {
                    emptyPages++;
                    if (emptyPages >= MAX_EMPTY_SERIES_PAGES) {
                        console.log("连续无可读剧集，结束此账号");
                        break;
                    }
                    console.log("当前页没有新的剧名，向下滑动继续");
                } else {
                    emptyPages = 0;
                    console.log("当前页读取 " + newThisPage + " 部，向下滑动继续");
                }

                _swipeUp();
                sleep(PAGE_DELAY);
            }

            processedNames[account.label] = true;
            console.log("账号 \"" + account.label + "\" 读取 " + accountScanned + " 部，新写入 " + accountCollected + " 条");

            // 返回关注列表
            back();
            sleep(PAGE_DELAY);
        }

        // 滑动加载更多账号
        _swipeUp();
        sleep(PAGE_DELAY);
    }

    console.log("\n=== 采集结束 ===");
    console.log("共读取: " + scanned + " 部");
    console.log("新写入: " + collected + " 条");
    console.log("遍历账号: " + accountIndex + " 个");
    toastLog("采集完成: " + collected + "条");
}

// ============================================================
// 导航：完整路径到关注列表
// ============================================================

function navigateToFollowingList() {
    // 使用固定比例坐标点击（避免 navigation 阶段频繁 captureScreen 导致 MediaProjection 超时）
    // 步骤1: 底部「发现」
    _navClick("发现", NAV_DISCOVER, PAGE_DELAY);

    // 步骤2: 「视频号」
    _navClick("视频号", NAV_CHANNELS, PAGE_DELAY);

    // 步骤3: 右上角个人中心
    _navClick("右上角个人中心", NAV_PROFILE_ICON, PAGE_DELAY);

    // 步骤4: 「关注」
    _navClick("关注", NAV_FOLLOWING, PAGE_DELAY);

    return true;
}

function _navClick(label, ratio, delayMs) {
    var x = Math.round(device.width * ratio[0]);
    var y = Math.round(device.height * ratio[1]);
    console.log("导航: 点击「" + label + "」 x=" + x + " y=" + y + " ratio=" + ratio[0] + "," + ratio[1]);
    click(x, y);
    sleep(delayMs || PAGE_DELAY);
}

// ============================================================
// 关注列表相关
// ============================================================

function readFollowingCount() {
    var img = _safeCaptureScreen("读取关注总数");
    if (!img) return null;
    var ocrResult = _ocrScreen(img, null);
    img.recycle();
    sleep(300); // 等待 VirtualDisplay 释放
    var items = ocrResult.items || [];
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        var m = label.match(/我的关注[\(（](\d+)[\)）]/);
        if (m) return parseInt(m[1], 10);
    }
    return null;
}

function extractFollowingAccounts(ocrResult, screenHeight) {
    var items = ocrResult.items || [];
    if (items.length === 0) return [];

    items.sort(function(a, b) { return (a.bounds.top || 0) - (b.bounds.top || 0); });

    var rows = [];
    var currentRow = null;
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!label) continue;
        var b = items[i].bounds;
        var y = b.top || 0;

        if (!currentRow || y - currentRow.top > 30) {
            if (currentRow && isFollowingAccountRow(currentRow, screenHeight)) {
                rows.push(currentRow);
            }
            currentRow = {
                label: label,
                top: y,
                bottom: b.bottom || (y + 50),
                bounds: [b]
            };
        } else {
            currentRow.label = currentRow.label + label;
            currentRow.bottom = Math.max(currentRow.bottom, b.bottom || (y + 50));
            currentRow.bounds.push(b);
        }
    }
    if (currentRow && isFollowingAccountRow(currentRow, screenHeight)) {
        rows.push(currentRow);
    }

    for (i = 0; i < rows.length; i++) {
        rows[i].centerY = Math.round((rows[i].top + rows[i].bottom) / 2);
        var leftmost = 9999, rightmost = 0;
        for (var j = 0; j < rows[i].bounds.length; j++) {
            var b2 = rows[i].bounds[j];
            if (b2.left < leftmost) leftmost = b2.left;
            if (b2.right > rightmost) rightmost = b2.right;
        }
        rows[i].textCenterX = Math.round((leftmost + rightmost) / 2);
    }
    return rows;
}

function isFollowingAccountRow(row, screenHeight) {
    var label = row.label;
    if (!label) return false;
    if (/我的关注/.test(label)) return false;
    if (/^(推荐|朋友|赞|评论|转发|可能含有AI生成内容)$/.test(label)) return false;
    if (row.top > screenHeight * 0.92) return false;
    if (label.length < 2) return false;
    return true;
}

// ============================================================
// 账号主页 Tab：主页 / 视频 / 剧集
// ============================================================

function clickSeriesTab() {
    _ensureCapturePermission();
    var img = _safeCaptureScreen("识别账号主页 Tab");
    if (!img) return false;

    var w = img.getWidth(), h = img.getHeight();
    var region = _toPixelRegion(PROFILE_TAB_ROI, w, h);
    var ocrResult = _ocrScreen(img, region);
    var tabs = extractProfileTabs(ocrResult, region);
    img.recycle();

    var hasHome = false;
    var hasVideo = false;
    var seriesTab = null;

    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].label === "主页") hasHome = true;
        if (tabs[i].label === "视频") hasVideo = true;
        if (tabs[i].label === "剧集") seriesTab = tabs[i];
    }

    console.log("账号主页 Tab: 主页=" + hasHome + " 视频=" + hasVideo + " 剧集=" + !!seriesTab);

    var cx, cy, source;
    if (seriesTab) {
        cx = seriesTab.cx;
        cy = seriesTab.cy;
        source = "ocr_tab";
    } else {
        cx = Math.round(device.width * SERIES_TAB_FALLBACK[0]);
        cy = Math.round(device.height * SERIES_TAB_FALLBACK[1]);
        source = "fallback_ratio";
    }

    console.log("点击「剧集」Tab: x=" + cx + " y=" + cy + " source=" + source);
    click(cx, cy);
    sleep(PAGE_DELAY);
    return true;
}

function extractProfileTabs(ocrResult, region) {
    var out = [];
    var items = ocrResult.items || [];
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!/^(主页|视频|剧集)$/.test(label)) continue;

        var b = items[i].bounds || {};
        var left = Number(b.left || 0);
        var right = Number(b.right || 0);
        var top = Number(b.top || 0);
        var bottom = Number(b.bottom || 0);

        if (region && right <= region[2] + 10 && bottom <= region[3] + 10) {
            left += region[0];
            right += region[0];
            top += region[1];
            bottom += region[1];
        }

        out.push({
            label: label,
            cx: Math.round((left + right) / 2),
            cy: Math.round((top + bottom) / 2)
        });
    }
    return out;
}

// ============================================================
// 剧集采集
// ============================================================

function readVisibleSeriesNames() {
    _ensureCapturePermission();
    var img = _safeCaptureScreen("读取剧集栏");
    if (!img) return [];
    var w = img.getWidth(), h = img.getHeight();
    var ocrResult = _ocrScreen(img, null);
    img.recycle();

    var lines = _ocrLineObjects(ocrResult);
    var candidates = [];
    var seen = {};
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.top < h * 0.36) continue;
        if (line.top > h * 0.92) continue;
        var name = _cleanSeriesGridName(line.text);
        if (!name) continue;
        var key = _normalizeCsvKey(name);
        if (!key || seen[key]) continue;
        seen[key] = true;
        candidates.push({
            name: name,
            top: line.top,
            left: line.left
        });
    }

    candidates.sort(function(a, b) {
        if (Math.abs(a.top - b.top) > 40) return a.top - b.top;
        return a.left - b.left;
    });

    console.log("剧集栏 OCR 候选: " + candidates.map(function(item) { return item.name; }).join(" / "));
    return candidates;
}

function _cleanSeriesGridName(text) {
    var label = _clean(text).replace(/\s+/g, "");
    if (!label) return "";
    if (label.length < 2 || label.length > 24) return "";
    if (/^\d+$/.test(label)) return "";
    if (/^\d+集$/.test(label)) return "";
    if (/^全\d+集$/.test(label)) return "";
    if (/^\d+[-~]\d+$/.test(label)) return "";
    if (/^(主页|视频|剧集|已关注|私信|关注|取消关注|作品|合集|动态|喜欢|朋友|推荐)$/.test(label)) return "";
    if (/^(赞|评论|转发|分享|收藏|更多|搜索|返回)$/.test(label)) return "";
    if (/可能含有AI生成内容/.test(label)) return "";
    if (/免费剧集/.test(label)) return "";
    if (/^[a-zA-Z0-9_\-]+$/.test(label)) return "";
    return label.replace(/[，,。.!！?？:：;；]+$/g, "");
}

// ============================================================
// CSV 操作
// ============================================================

function initCsv() {
    var headerText = "账号,剧名,读取北京时间";
    var header = "\uFEFF" + headerText + "\n";
    if (!files.exists(CSV_PATH)) {
        files.write(CSV_PATH, header, "utf-8");
        console.log("CSV 已创建");
        return;
    }

    var text = "";
    try {
        text = files.read(CSV_PATH, "utf-8") || "";
    } catch (e) {
        text = files.read(CSV_PATH) || "";
    }
    var firstLine = String(text).split(/\r?\n/)[0].replace(/^\uFEFF/, "");
    if (firstLine !== headerText) {
        var backupPath = CSV_PATH + ".bak_" + _formatBeijingTime(new Date()).replace(/[^0-9]/g, "");
        try {
            files.copy(CSV_PATH, backupPath);
            files.write(CSV_PATH, header, "utf-8");
            console.log("发现旧 CSV 表头，已备份到: " + backupPath);
        } catch (e2) {
            console.log("CSV 表头不是当前格式，备份失败: " + String(e2));
        }
    }
}

function writeCsvRow(data) {
    if (csvHasSeries(data.account, data.series)) {
        return { written: false, duplicate: true };
    }
    var row = [
        csvEscape(data.account || ""),
        csvEscape(data.series || ""),
        csvEscape(data.readTimeBeijing || "")
    ].join(",");
    try {
        files.append(CSV_PATH, row + "\n", "utf-8");
        return { written: true, duplicate: false };
    } catch (e) {
        console.log("CSV 写入失败: " + String(e));
        return { written: false, duplicate: false, error: String(e) };
    }
}

function csvHasSeries(account, series) {
    if (!files.exists(CSV_PATH)) return false;
    var targetAccount = _normalizeCsvKey(account);
    var targetSeries = _normalizeCsvKey(series);
    if (!targetAccount || !targetSeries) return false;

    var text = "";
    try {
        text = files.read(CSV_PATH, "utf-8") || "";
    } catch (e) {
        text = files.read(CSV_PATH) || "";
    }
    text = text.replace(/^\uFEFF/, "");
    var lines = text.split(/\r?\n/);
    for (var i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        var cells = parseCsvLine(lines[i]);
        if (cells.length < 2) continue;
        if (_normalizeCsvKey(cells[0]) === targetAccount &&
            _normalizeCsvKey(cells[1]) === targetSeries) {
            return true;
        }
    }
    return false;
}

function parseCsvLine(line) {
    var out = [];
    var cur = "";
    var inQuote = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === "\"") {
            if (inQuote && line.charAt(i + 1) === "\"") {
                cur += "\"";
                i++;
            } else {
                inQuote = !inQuote;
            }
        } else if (ch === "," && !inQuote) {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function _normalizeCsvKey(text) {
    return _clean(text).replace(/\s+/g, "").toLowerCase();
}

function csvEscape(val) {
    var s = String(val || "");
    if (s.indexOf(",") >= 0 || s.indexOf("\"") >= 0 || s.indexOf("\n") >= 0) {
        return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
}

// ============================================================
// 通用 OCR 点击
// ============================================================

function _ocrClickText(target, roi, fallback, clickDelay) {
    _ensureCapturePermission();
    var img = _safeCaptureScreen("OCR 点击 " + target);
    if (!img) return false;
    var w = img.getWidth(), h = img.getHeight();
    var region = roi ? _toPixelRegion(roi, w, h) : null;
    var ocrResult = _ocrScreen(img, region);

    var match = null;
    var items = ocrResult.items || [];
    var ct = _clean(target);
    for (var i = 0; i < items.length; i++) {
        if (_clean(items[i].label || "").indexOf(ct) >= 0) {
            match = items[i];
            break;
        }
    }

    var cx, cy;
    if (match) {
        var b = match.bounds;
        cx = Math.round((b.left + b.right) / 2);
        cy = Math.round((b.top + b.bottom) / 2);
        if (region && b.right <= region[2] + 10 && b.bottom <= region[3] + 10) {
            cx += region[0];
            cy += region[1];
        }
    } else if (fallback && fallback.length >= 2) {
        cx = Math.round(w * fallback[0]);
        cy = Math.round(h * fallback[1]);
    } else {
        img.recycle();
        return false;
    }

    img.recycle();
    click(cx, cy);
    sleep(clickDelay);
    return true;
}

function _swipeUp() {
    var w = device.width, h = device.height;
    swipe(w / 2, h * 0.75, w / 2, h * 0.35, 400);
}

function _formatBeijingTime(date) {
    if (!date) return "";
    var bj = new Date(date.getTime() + 8 * 3600000);
    return bj.getUTCFullYear() + "-" + _pad2(bj.getUTCMonth() + 1) + "-" + _pad2(bj.getUTCDate()) +
        " " + _pad2(bj.getUTCHours()) + ":" + _pad2(bj.getUTCMinutes()) + ":" + _pad2(bj.getUTCSeconds());
}

function _pad2(n) { return n < 10 ? "0" + n : String(n); }

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

var _captureGranted = false;
function _primeScreenCapture() {
    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        return false;
    }
    _captureGranted = true;
    sleep(800);
    return true;
}

function _ensureCapturePermission() {
    if (_captureGranted) return true;
    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        return false;
    }
    _captureGranted = true;
    sleep(300);
    return true;
}

function _safeCaptureScreen(label) {
    label = label || "截图";
    for (var i = 0; i <= CAPTURE_RETRY; i++) {
        if (!_ensureCapturePermission()) return null;

        var now = Date.now();
        var waitMs = CAPTURE_COOLDOWN_MS - (now - _lastCaptureAt);
        if (waitMs > 0) sleep(waitMs);

        try {
            var img = captureScreen();
            _lastCaptureAt = Date.now();
            if (img) return img;
            console.log(label + ": captureScreen 返回空，重试 " + (i + 1) + "/" + CAPTURE_RETRY);
        } catch (e) {
            console.log(label + ": captureScreen 异常，重试 " + (i + 1) + "/" + CAPTURE_RETRY + " - " + String(e));
            _captureGranted = false;
            sleep(1200);
        }
    }
    console.log(label + ": 截图失败");
    return null;
}
