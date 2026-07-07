/**
 * 遍历测试：关注账号遍历 + 视频遍历（不含导航）
 *
 * 前提：手动进入微信 → 发现 → 视频号 → 个人中心 → 关注列表页面
 * 功能：
 *   1. OCR 读取关注列表 → 提取账号名和点击 Y 坐标
 *   2. 跳过第一个（自己），逐个点击账号
 *   3. 进入账号主页 → 点击第一个视频 → 采集信息 → back
 *   4. back 回关注列表 → 下一账号
 *   5. 一屏账号完后滑动加载更多
 *
 * 运行方式：VS Code 插件右键 → "运行当前文件"（自包含单文件）
 */

"auto";

// ============================================================
// 配置
// ============================================================
var OCR_MODE = "paddle";
var OCR_FALLBACK_MODES = ["paddle", "mlkit", "rapid", "generic"];
var PAGE_DELAY = 1200;
var COLLECT_WINDOW_HOURS = 2;
var COLLECT_WINDOW_BUFFER = 1;
var COLLECT_WINDOW_MS = (COLLECT_WINDOW_HOURS + COLLECT_WINDOW_BUFFER) * 3600000;

// ============================================================
// 主流程
// ============================================================
main();

function main() {
    console.show();
    console.log("=== 遍历测试 ===");
    console.log("时间窗口: " + (COLLECT_WINDOW_HOURS + COLLECT_WINDOW_BUFFER) + "h (" + COLLECT_WINDOW_HOURS + "h采集 + " + COLLECT_WINDOW_BUFFER + "h缓冲)");
    console.log("前置：请确保已在「关注」列表页面");
    console.log("=== 开始 ===");

    if (!requestScreenCapture()) {
        console.log("错误: 请求截图权限失败");
        exit();
    }
    sleep(500);

    // ---- 读取关注列表 ----
    var img = captureScreen();
    if (!img) { console.log("截图失败"); exit(); }
    var ocrResult = _ocrScreen(img, null);
    var accounts = _extractAccounts(ocrResult, img.getHeight());
    img.recycle();

    console.log("检测到 " + accounts.length + " 个账号");
    for (var a = 0; a < accounts.length; a++) {
        console.log("  [" + a + "] " + accounts[a].label + " Y=" + accounts[a].centerY);
    }

    if (accounts.length === 0) {
        console.log("无账号");
        exit();
    }

    // ---- 遍历账号 ----
    var processed = {};
    var startIndex = 1; // 跳过第0个（自己）

    for (var i = startIndex; i < accounts.length; i++) {
        var account = accounts[i];
        if (processed[account.label]) {
            console.log("跳过已处理: " + account.label);
            continue;
        }

        console.log("\n--- [" + i + "/" + (accounts.length - 1) + "] " + account.label + " ---");

        // 点击账号（用 OCR 识别的文字区域中心X）
        var cx = account.textCenterX;
        var cy = account.centerY;
        console.log("  点击账号: textCenterX=" + cx + " centerY=" + cy);
        click(cx, cy);
        sleep(PAGE_DELAY + 500);

        // ---- 遍历视频 ----
        var videoIndex = 0;
        var accountDone = false; // true: 所有视频已超出窗口，退出此账号

        while (!accountDone && videoIndex < 20) {
            sleep(800);
            var vImg = captureScreen();
            if (!vImg) { console.log("截图失败，跳过"); accountDone = true; break; }
            var vH = vImg.getHeight();
            var vOcr = _ocrScreen(vImg, null);

            // 检测视频宫格（纯 OCR）
            var cells = _detectVideoCells(vOcr, vH);
            vImg.recycle();
            console.log("  检测到 " + cells.length + " 个视频宫格");

            if (videoIndex >= cells.length) {
                console.log("  视频[" + videoIndex + "] 超出可见范围，退出此账号");
                accountDone = true;
                break;
            }

            // 点击第 N 个视频（用列中心坐标）
            var cell = cells[videoIndex];
            var cx = cell.cx;
            var cy = cell.cy;
            console.log("  点击视频[" + videoIndex + "]: (" + cx + "," + cy + ") col=" + cell.col + "/" + cell.rowCols + " \"" + cell.label.substring(0, 12) + "\"");
            click(cx, cy);
            sleep(PAGE_DELAY);

            // 提取视频详情页信息
            var infoImg = captureScreen();
            if (!infoImg) {
                console.log("  信息采集截图失败，返回账号主页");
                back();
                sleep(PAGE_DELAY);
                accountDone = true;
                break;
            }

            var infoOcr = _ocrScreen(infoImg, null);
            var items = infoOcr.items || [];
            var seriesName = _extractSeriesName(items);
            var publishTimeRaw = _extractPublishTime(items);
            infoImg.recycle();

            console.log("  剧名: " + (seriesName || "未识别") + " | 发布时间: " + (publishTimeRaw || "未识别"));

            // 判断时间窗口
            var inWindow = false;
            if (publishTimeRaw) {
                var actualTime = _parseRelativeTime(publishTimeRaw);
                if (actualTime) {
                    var ageMs = Date.now() - actualTime.getTime();
                    inWindow = ageMs <= COLLECT_WINDOW_MS;
                    var ageMin = Math.round(ageMs / 60000);
                    console.log("  距今 " + ageMin + " 分钟 | " + (inWindow ? "在窗口内" : "超出窗口"));
                }
            }

            if (!inWindow) {
                console.log("  超出时间窗口，退出此账号");
                back(); // 回账号主页
                sleep(PAGE_DELAY);
                accountDone = true;
                break;
            }

            // 在窗口内：采集成功，回账号主页，继续下一个视频
            console.log("  采集成功: " + (seriesName || "无剧名"));
            back(); // 回账号主页
            sleep(PAGE_DELAY);
            videoIndex++;
        }

        processed[account.label] = true;

        // 回关注列表
        back();
        sleep(PAGE_DELAY);
    }

    console.log("\n=== 遍历完成 ===");
    toastLog("遍历完成");
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
// OCR 视频宫格检测
// ============================================================

function _detectVideoCells(ocrResult, screenHeight) {
    var items = (ocrResult.items || []).slice();
    var minY = Math.round(screenHeight * 0.40);
    var maxY = Math.round(screenHeight * 0.85); // 底部15%排除（可能是评论、推荐等）

    // 过滤：排除顶部/底部区域和非宫格文字
    items = items.filter(function(it) {
        var y = it.bounds.top || 0;
        if (y < minY || y > maxY) return false;
        var label = _clean(it.label || "");
        if (/^(已关注|私信|关注|取消关注|作品|合集|可能含有AI生成内容)$/.test(label)) return false;
        return true;
    });
    items.sort(function(a, b) { return (a.bounds.top || 0) - (b.bounds.top || 0); });

    // 按行分组（Y容差22px，与 click_first_video.js 一致）
    var rows = [];
    var ROW_TOL = 22;
    var curRow = [];
    var curY = -1;

    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        if (!label || label.length < 2) continue;
        var y = items[i].bounds.top || 0;

        if (curY < 0 || Math.abs(y - curY) <= ROW_TOL) {
            curRow.push(items[i]);
            if (curY < 0) curY = y;
        } else {
            if (_isGridRow(curRow)) rows.push(curRow);
            curRow = [items[i]];
            curY = y;
        }
    }
    if (_isGridRow(curRow)) rows.push(curRow);

    // 每行按 X 排序，展平为 cell 列表（行优先、列从左到右）
    var allCells = [];
    for (var r = 0; r < rows.length; r++) {
        rows[r].sort(function(a, b) { return (a.bounds.left || 0) - (b.bounds.left || 0); });
        var nCols = rows[r].length;

        for (var c = 0; c < rows[r].length; c++) {
            var it = rows[r][c];
            var b = it.bounds;
            // 用列中心X（比文字中心X更稳定），Y 用文字上移 60px（文字在缩略图底部，向上移点击图片区域）
            var colW = device.width / nCols;
            var cellCx = Math.round(c * colW + colW / 2);
            var cellCy = Math.round(((b.top || 0) + (b.bottom || 0)) / 2 - colW * 0.25);
            allCells.push({
                x1: b.left || 0,
                x2: b.right || 0,
                y1: b.top || 0,
                y2: b.bottom || 0,
                cx: cellCx,
                cy: cellCy,
                col: c,
                rowCols: nCols,
                label: _clean(it.label)
            });
        }
        console.log("  宫格行" + r + ": " + nCols + " 列, Y=" + rows[r][0].bounds.top);
    }

    if (allCells.length === 0) {
        console.log("  未检测到宫格行，使用比例估算");
        // 兜底：按3列等分屏幕宽度，行高估算
        var colW = device.width / 3;
        var rowH = Math.round(colW * 0.56); // 视频缩略图 16:9 比例
        var gridStartY = Math.round(screenHeight * 0.42);
        for (var vi = 0; vi < 9; vi++) {
            var col = vi % 3;
            var row = Math.floor(vi / 3);
            allCells.push({
                x1: Math.round(col * colW),
                x2: Math.round((col + 1) * colW),
                y1: gridStartY + row * rowH,
                y2: gridStartY + (row + 1) * rowH,
                cx: Math.round(col * colW + colW / 2),
                cy: Math.round(gridStartY + row * rowH + rowH / 2),
                col: col,
                rowCols: 3,
                label: "估算"
            });
        }
    }

    return allCells;
}

// 校验是否为宫格行：≥2列，列间距>20px，≤3列（与 click_first_video.js 一致）
function _isGridRow(row) {
    if (!row || row.length < 2 || row.length > 3) return false;
    var leftCol = row[0];
    var rightCol = row[row.length - 1];
    var gap = (rightCol.bounds.left || 0) - (leftCol.bounds.right || 0);
    return gap > 20;
}

// ============================================================
// 视频信息提取
// ============================================================

function _extractSeriesName(items) {
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

function _extractPublishTime(items) {
    for (var i = 0; i < items.length; i++) {
        var label = _clean(items[i].label);
        var y = items[i].bounds.top || 0;
        if (y > 2100) continue;
        if (/^刚刚$/.test(label)) return label;
        var m = label.match(/^(\d+)\s*(分钟前|小时前|天前)$/);
        if (m) return m[1] + m[2];
    }
    return null;
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
        var attempt = _tryOcr(img, baseOptions, mode);
        if (attempt.ok) {
            var items = _normalizeItems(attempt.raw);
            return { mode: mode, count: items.length, items: items };
        }
        errors.push(mode + ": " + attempt.error);
    }
    return { mode: modes.join(","), count: 0, items: [] };
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

function _clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function _parseRelativeTime(text) {
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
