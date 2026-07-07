"auto";

var config = loadConfig();

main();

function loadConfig() {
    var defaults = {
        wechatPackageName: "com.tencent.mm",
        series: {
            outputDir: "/sdcard/Download/wechat_video_series",
            csvPath: "/sdcard/Download/wechat_video_series.csv",
            showConsole: false,
            debugSummary: false,
            saveDebugArtifacts: false,
            freeEntryRoiName: "free_series_entry",
            panelTitleRoiName: "series_panel_title",
            freeEntryTextPattern: "免费剧集",
            entryClickMode: "ocr_then_fixed",
            freeEntryClickXRatioInLine: 0.55,
            freeEntryClickYPadding: 12,
            fallbackClickRatio: [0.36, 0.76],
            clickAfterMs: 1200,
            titleRecognitionMode: "ocr_score",
            writeWhenTitleEmpty: false,
            closePanelAfterCollect: false,
            blackSampleStep: 24,
            blackMaxAverageBrightness: 12,
            blackMaxBrightPixelRatio: 0.02
        },
        screenshot: {
            enabled: true,
            saveRoiImages: true
        },
        ocr: {
            enabled: true,
            mode: "paddle",
            fallbackModes: ["paddle", "mlkit", "rapid", "generic"],
            useSlim: true,
            cpuThreadNum: 4,
            useOpenCL: false
        },
        rois: [
            { name: "free_series_entry", description: "视频详情页左下免费剧集入口区域", region: [0, 0.68, 0.76, 0.18] },
            { name: "series_panel_title", description: "免费剧集弹出面板标题区，优先识别大号高亮剧名", region: [0.04, 0.28, 0.92, 0.36] }
        ]
    };

    try {
        var externalConfig = require("../config.js");
        return mergeConfig(defaults, externalConfig || {});
    } catch (e) {
        return defaults;
    }
}

function mergeConfig(base, override) {
    for (var key in override) {
        if (override.hasOwnProperty(key)) {
            if (isPlainObject(base[key]) && isPlainObject(override[key])) {
                mergeConfig(base[key], override[key]);
            } else {
                base[key] = override[key];
            }
        }
    }
    return base;
}

function isPlainObject(value) {
    return value && Object.prototype.toString.call(value) === "[object Object]";
}

function main() {
    if (config.series.showConsole) console.show();

    var startedAt = new Date();
    var runDir = makeRunDir(startedAt);
    var logs = [];
    logLine(logs, "免费剧集剧名采集开始");
    logLine(logs, "输出目录: " + runDir);

    var result = {
        capturedAt: formatBeijingDateTime(startedAt),
        currentPackage: safeCall(function () { return currentPackage(); }),
        currentActivity: safeCall(function () { return currentActivity(); }),
        beforeScreenshotPath: null,
        afterScreenshotPath: null,
        freeEntryRoiPath: null,
        titleRoiPath: null,
        freeEntryOcr: null,
        freeEntryCandidates: [],
        titleOcr: null,
        clickPoint: null,
        clickSource: "",
        panelDiagnostics: null,
        titleRoiDiagnostics: null,
        titleCandidates: [],
        beforeOcr: null,
        recognitionSource: "",
        seriesName: "",
        readTimeBeijing: formatBeijingDateTime(startedAt),
        csvPath: config.series.csvPath,
        written: false,
        skippedReason: "",
        errors: []
    };

    var beforeImg = null;
    var afterImg = null;
    try {
        if (!requestScreenCapture()) {
            throw new Error("请求截图权限失败");
        }
        sleep(500);

        beforeImg = captureScreen();
        if (!beforeImg) throw new Error("首次 captureScreen() 返回空");
        result.beforeScreenshotPath = runDir + "/before_click.png";
        images.save(beforeImg, result.beforeScreenshotPath);
        result.beforeOcr = runOcr(beforeImg, null);
        if (shouldSaveDebugArtifacts()) writeJson(runDir + "/ocr_before_click.json", result.beforeOcr);
        logLine(logs, "读取北京时间: " + result.readTimeBeijing);

        var freeEntry = locateFreeSeriesEntry(beforeImg, runDir, logs);
        result.freeEntryRoiPath = freeEntry.roiPath;
        result.freeEntryOcr = freeEntry.ocr;
        result.freeEntryCandidates = freeEntry.candidates || [];
        result.clickPoint = freeEntry.clickPoint;
        result.clickSource = freeEntry.source;

        logLine(logs, "点击免费剧集入口: " + JSON.stringify(result.clickPoint) + " source=" + result.clickSource);
        click(result.clickPoint.x, result.clickPoint.y);
        sleep(config.series.clickAfterMs || 1200);

        afterImg = captureScreen();
        if (!afterImg) throw new Error("点击后 captureScreen() 返回空");
        result.afterScreenshotPath = runDir + "/after_panel.png";
        images.save(afterImg, result.afterScreenshotPath);
        result.panelDiagnostics = analyzeImageBrightness(afterImg);

        var titleResult = readSeriesTitle(afterImg, runDir, logs);
        result.titleRoiPath = titleResult.roiPath;
        result.titleOcr = titleResult.ocr;
        result.titleRoiDiagnostics = titleResult.diagnostics;
        result.titleCandidates = titleResult.candidates;
        result.recognitionSource = titleResult.source;
        result.seriesName = titleResult.seriesName;
        result.readTimeBeijing = formatBeijingDateTime(new Date());

        result.skippedReason = getSkipReason(result);
        if (!result.skippedReason) {
            var writeResult = appendCsvRecord(config.series.csvPath, result);
            result.written = writeResult.written;
            logLine(logs, writeResult.message);
        } else {
            logLine(logs, "未写入 CSV: " + result.skippedReason);
        }

        if (config.series.closePanelAfterCollect) {
            back();
            sleep(500);
        }
    } catch (e) {
        result.errors.push(String(e));
        logLine(logs, "错误: " + e);
    } finally {
        if (beforeImg) beforeImg.recycle();
        if (afterImg) afterImg.recycle();
    }

    cleanupTemporaryArtifacts(result);
    writeJson(runDir + "/collect_current_series.json", compactResultForJson(result));
    files.write(runDir + "/summary.txt", buildSummary(result, logs));
    if (shouldSaveDebugArtifacts()) files.write(runDir + "/log.txt", logs.join("\n") + "\n");
    toastLog("免费剧集剧名采集完成: " + runDir);
}

function locateFreeSeriesEntry(img, runDir, logs) {
    var roi = findRoi(config.series.freeEntryRoiName);
    var region = normalizeRegion(roi.region, img.getWidth(), img.getHeight());
    var clip = images.clip(img, region[0], region[1], region[2], region[3]);
    var roiPath = runDir + "/roi_" + roi.name + ".png";
    images.save(clip, roiPath);
    clip.recycle();

    if (config.series.entryClickMode === "fixed") {
        var fixed = config.series.fallbackClickRatio || [0.36, 0.76];
        return {
            roiPath: roiPath,
            ocr: null,
            candidates: [],
            clickPoint: {
                x: Math.round(device.width * fixed[0]),
                y: Math.round(device.height * fixed[1])
            },
            source: "fixed_ratio"
        };
    }

    var ocrResult = runOcr(img, region);
    if (shouldSaveDebugArtifacts()) writeJson(runDir + "/ocr_roi_" + roi.name + ".json", ocrResult);

    var lineHit = findFreeSeriesLine(ocrResult, region);
    if (lineHit) {
        if (shouldSaveDebugArtifacts()) writeJson(runDir + "/free_entry_candidates.json", lineHit.candidates);
        return {
            roiPath: roiPath,
            ocr: ocrResult,
            candidates: lineHit.candidates,
            clickPoint: lineHit.clickPoint,
            source: "ocr_line"
        };
    }

    var fallback = config.series.fallbackClickRatio || [0.36, 0.76];
    logLine(logs, "OCR 未命中免费剧集入口，使用备用比例坐标");
    return {
        roiPath: roiPath,
        ocr: ocrResult,
        candidates: [],
        clickPoint: {
            x: Math.round(device.width * fallback[0]),
            y: Math.round(device.height * fallback[1])
        },
        source: "fallback_ratio"
    };
}

function readSeriesTitle(img, runDir, logs) {
    var roi = findRoi(config.series.panelTitleRoiName);
    var region = normalizeRegion(roi.region, img.getWidth(), img.getHeight());
    var clip = images.clip(img, region[0], region[1], region[2], region[3]);
    var roiPath = runDir + "/roi_" + roi.name + ".png";
    images.save(clip, roiPath);
    var diagnostics = analyzeImageBrightness(clip);
    clip.recycle();

    var ocrResult = runOcr(img, region);
    if (shouldSaveDebugArtifacts()) writeJson(runDir + "/ocr_roi_" + roi.name + ".json", ocrResult);

    var titleExtract = extractSeriesName(ocrResult);
    return {
        roiPath: roiPath,
        ocr: ocrResult,
        diagnostics: diagnostics,
        candidates: titleExtract.candidates,
        source: "ocr_score",
        seriesName: titleExtract.seriesName,
        readTimeBeijing: ""
    };
}

function extractSeriesName(ocrResult) {
    var lines = ocrLineObjects(ocrResult);
    var candidates = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line.text || isTitleNoise(line.text)) continue;
        line.score = scoreTitleLine(line);
        candidates.push(line);
    }
    if (!candidates.length) return { seriesName: "", candidates: [] };
    candidates.sort(function (a, b) {
        if (Math.abs(b.score - a.score) > 0.01) return b.score - a.score;
        return a.top - b.top;
    });
    return {
        seriesName: candidates[0].text.slice(0, 80),
        candidates: candidates
    };
}

function scoreTitleLine(line) {
    var score = 0;
    score += line.maxHeight * 8;
    score += line.avgHeight * 4;
    score -= line.top * 0.03;

    if (line.text.length > 36) score -= 120;
    if (isDescriptionLike(line.text)) score -= 160;
    if (/^\d/.test(line.text)) score -= 80;

    return score;
}

function isDescriptionLike(line) {
    return /核心|架构师|倾力|完成|名额|关系户|占据|心寒|选择|项目，|她选择/.test(line);
}

function ocrLines(ocrResult) {
    var lineObjects = ocrLineObjects(ocrResult);
    var out = [];
    for (var i = 0; i < lineObjects.length; i++) out.push(lineObjects[i].text);
    return out;
}

function ocrLineObjects(ocrResult) {
    if (!ocrResult || !ocrResult.items) return [];
    var items = ocrResult.items.slice();
    items.sort(function (a, b) {
        var ab = a.bounds || {};
        var bb = b.bounds || {};
        var ay = Number(ab.top || 0);
        var by = Number(bb.top || 0);
        if (Math.abs(ay - by) > 18) return ay - by;
        return Number(ab.left || 0) - Number(bb.left || 0);
    });

    var lines = [];
    var current = [];
    var currentBounds = [];
    var currentY = null;
    for (var i = 0; i < items.length; i++) {
        var text = cleanText(items[i].label || "");
        if (!text) continue;
        var bounds = items[i].bounds || {};
        var y = Number(bounds.top || 0);
        if (currentY === null || Math.abs(y - currentY) <= 22) {
            current.push(text);
            currentBounds.push(bounds);
            if (currentY === null) currentY = y;
        } else {
            lines.push(makeLineObject(current, currentBounds));
            current = [text];
            currentBounds = [bounds];
            currentY = y;
        }
    }
    if (current.length) lines.push(makeLineObject(current, currentBounds));
    return lines;
}

function makeLineObject(parts, boundsList) {
    var top = 999999;
    var bottom = 0;
    var left = 999999;
    var right = 0;
    var maxHeight = 0;
    var heightSum = 0;
    var heightCount = 0;

    for (var i = 0; i < boundsList.length; i++) {
        var b = boundsList[i] || {};
        var itemTop = Number(b.top || 0);
        var itemBottom = Number(b.bottom || 0);
        var itemLeft = Number(b.left || 0);
        var itemRight = Number(b.right || 0);
        var itemHeight = itemBottom - itemTop;

        top = Math.min(top, itemTop);
        bottom = Math.max(bottom, itemBottom);
        left = Math.min(left, itemLeft);
        right = Math.max(right, itemRight);
        if (itemHeight > 0) {
            maxHeight = Math.max(maxHeight, itemHeight);
            heightSum += itemHeight;
            heightCount++;
        }
    }

    if (top === 999999) top = 0;
    if (left === 999999) left = 0;

    return {
        text: cleanText(parts.join("")),
        top: top,
        bottom: bottom,
        left: left,
        right: right,
        maxHeight: maxHeight,
        avgHeight: heightCount ? heightSum / heightCount : Math.max(0, bottom - top),
        score: 0
    };
}

function isTitleNoise(line) {
    return /^(\d+[-~]\d+|\d+|全\d+集|免费剧集|转发截图|可能含有AI生成内容)$/.test(line) ||
        /^(赞|评论|转发|合集)$/.test(line);
}

function findFreeSeriesLine(ocrResult, region) {
    var lines = ocrLineObjects(ocrResult);
    var candidates = [];
    for (var i = 0; i < lines.length; i++) {
        var line = normalizeLineToScreen(lines[i], region);
        line.score = scoreFreeSeriesLine(line.text);
        if (line.score > 0) candidates.push(line);
    }
    candidates.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return b.right - a.right;
    });

    if (!candidates.length) return null;

    var best = candidates[0];
    var clickXRatio = config.series.freeEntryClickXRatioInLine;
    if (clickXRatio === undefined || clickXRatio === null) clickXRatio = 0.55;
    var paddingY = config.series.freeEntryClickYPadding || 0;
    var left = Math.max(0, best.left - 24);
    var right = Math.min(device.width, Math.max(best.right + 24, region[0] + region[2] * 0.72));
    var top = Math.max(0, best.top - paddingY);
    var bottom = Math.min(device.height, best.bottom + paddingY);

    return {
        candidates: candidates,
        clickPoint: {
            x: Math.round(left + (right - left) * clickXRatio),
            y: Math.round((top + bottom) / 2)
        }
    };
}

function scoreFreeSeriesLine(text) {
    var compact = cleanText(text).replace(/\s+/g, "");
    if (!compact) return 0;
    var score = 0;
    if (compact.indexOf("免费剧集") >= 0) score += 100;
    if (compact.indexOf("剧集") >= 0) score += 45;
    if (/全\s*\d+\s*集/.test(compact) || /全[一二三四五六七八九十百千万\d]+集/.test(compact)) score += 35;
    if (compact.indexOf("免费") >= 0) score += 20;
    if (compact.indexOf("可能含有AI生成内容") >= 0) score -= 80;
    if (compact.length > 40) score -= 20;
    return score;
}

function normalizeLineToScreen(line, region) {
    var out = {};
    for (var key in line) {
        if (line.hasOwnProperty(key)) out[key] = line[key];
    }

    if (region && out.right <= region[2] + 10 && out.bottom <= region[3] + 10) {
        out.left += region[0];
        out.right += region[0];
        out.top += region[1];
        out.bottom += region[1];
    }
    return out;
}

function findTextItem(ocrResult, pattern) {
    if (!ocrResult || !ocrResult.items) return null;
    var expected = cleanText(pattern);
    for (var i = 0; i < ocrResult.items.length; i++) {
        var item = ocrResult.items[i];
        var label = cleanText(item.label || "");
        if (label.indexOf(expected) >= 0 || expected.indexOf(label) >= 0) return item;
    }
    return null;
}

function boundsCenter(bounds, region) {
    var left = Number(bounds.left || 0);
    var top = Number(bounds.top || 0);
    var right = Number(bounds.right || 0);
    var bottom = Number(bounds.bottom || 0);

    if (region && right <= region[2] + 10 && bottom <= region[3] + 10) {
        left += region[0];
        right += region[0];
        top += region[1];
        bottom += region[1];
    }

    return {
        x: Math.round((left + right) / 2),
        y: Math.round((top + bottom) / 2)
    };
}

function getSkipReason(result) {
    if (result.panelDiagnostics && result.panelDiagnostics.likelyBlack) {
        return "点击后截图疑似黑屏";
    }
    if (result.titleRoiDiagnostics && result.titleRoiDiagnostics.likelyBlack) {
        return "剧名 ROI 疑似黑屏";
    }
    if (!config.series.writeWhenTitleEmpty && !result.seriesName) {
        return "未识别到剧名";
    }
    return "";
}

function appendCsvRecord(path, result) {
    ensureCsv(path);
    var dedupeKey = md5([result.seriesName].join("|"));
    var existing = files.read(path);
    if (existing.indexOf(dedupeKey) >= 0) {
        return { written: false, message: "CSV 已存在相同记录，跳过写入" };
    }

    var row = [
        dedupeKey,
        result.capturedAt,
        result.seriesName,
        result.readTimeBeijing,
        result.clickSource,
        result.clickPoint ? result.clickPoint.x : "",
        result.clickPoint ? result.clickPoint.y : "",
        result.titleRoiPath,
        result.afterScreenshotPath
    ].map(csvCell).join(",") + "\n";
    files.append(path, row);
    return { written: true, message: "CSV 已写入: " + path };
}

function ensureCsv(path) {
    ensureParentDir(path);
    if (!files.exists(path)) {
        files.write(path, [
            "dedupe_key",
            "detected_at",
            "series_name",
            "read_time_beijing",
            "click_source",
            "click_x",
            "click_y",
            "title_roi_path",
            "panel_screenshot_path"
        ].join(",") + "\n");
    }
}

function ensureParentDir(path) {
    var slashIndex = String(path).lastIndexOf("/");
    if (slashIndex >= 0) {
        files.ensureDir(String(path).substring(0, slashIndex) + "/.keep");
    }
}

function csvCell(value) {
    if (value === null || value === undefined) return "";
    var text = String(value).replace(/"/g, '""').replace(/\r?\n/g, "\\n");
    return '"' + text + '"';
}

function md5(text) {
    try {
        var md = java.security.MessageDigest.getInstance("MD5");
        var bytes = new java.lang.String(text).getBytes("UTF-8");
        md.update(bytes);
        var digest = md.digest();
        var out = "";
        for (var i = 0; i < digest.length; i++) {
            var b = digest[i] & 0xff;
            if (b < 16) out += "0";
            out += b.toString(16);
        }
        return out;
    } catch (e) {
        return String(text).slice(0, 80);
    }
}

function analyzeImageBrightness(img) {
    var width = img.getWidth();
    var height = img.getHeight();
    var step = config.series.blackSampleStep || 24;
    var total = 0;
    var bright = 0;
    var sum = 0;

    for (var y = 0; y < height; y += step) {
        for (var x = 0; x < width; x += step) {
            var color = images.pixel(img, x, y);
            var r = colors.red(color);
            var g = colors.green(color);
            var b = colors.blue(color);
            var brightness = (r + g + b) / 3;
            sum += brightness;
            total++;
            if (brightness > 40) bright++;
        }
    }

    var average = total ? sum / total : 0;
    var brightRatio = total ? bright / total : 0;
    return {
        width: width,
        height: height,
        sampleStep: step,
        sampleCount: total,
        averageBrightness: average,
        brightPixelRatio: brightRatio,
        likelyBlack: average <= config.series.blackMaxAverageBrightness &&
            brightRatio <= config.series.blackMaxBrightPixelRatio
    };
}

function findRoi(name) {
    for (var i = 0; i < config.rois.length; i++) {
        if (config.rois[i].name === name) return config.rois[i];
    }
    return config.rois[0];
}

function runOcr(img, region) {
    if (!config.ocr.enabled) return { available: false, disabled: true, count: 0, items: [] };

    var baseOptions = {
        useSlim: config.ocr.useSlim,
        cpuThreadNum: config.ocr.cpuThreadNum,
        useOpenCL: config.ocr.useOpenCL
    };
    if (region) baseOptions.region = region;

    var modes = getOcrModes();
    var errors = [];
    for (var i = 0; i < modes.length; i++) {
        var mode = modes[i];
        var attempt = tryOcrMode(img, baseOptions, mode);
        if (attempt.ok) {
            return {
                available: true,
                mode: mode,
                region: region,
                count: resultLength(attempt.raw),
                items: normalizeOcrResults(attempt.raw),
                fallbackErrors: errors
            };
        }
        errors.push(mode + ": " + attempt.error);
    }

    return {
        available: false,
        mode: modes.join(","),
        region: region,
        count: 0,
        items: [],
        error: errors.join(" | "),
        errors: errors
    };
}

function getOcrModes() {
    var modes = [];
    if (config.ocr.mode) modes.push(config.ocr.mode);
    var fallbackModes = config.ocr.fallbackModes || [];
    for (var i = 0; i < fallbackModes.length; i++) {
        if (modes.indexOf(fallbackModes[i]) < 0) modes.push(fallbackModes[i]);
    }
    return modes.length > 0 ? modes : ["generic"];
}

function tryOcrMode(img, baseOptions, mode) {
    if (typeof ocr === "undefined") {
        return { ok: false, error: "当前 AutoJs6 环境未暴露 ocr" };
    }

    var options = cloneOptions(baseOptions);
    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) {
                return { ok: true, raw: ocr.paddle.detect(img, options) };
            }
            if (ocr.detect) {
                options.mode = "paddle";
                return { ok: true, raw: ocr.detect(img, options) };
            }
            return { ok: false, error: "未找到 paddle.detect 或 ocr.detect" };
        }

        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) {
            return { ok: true, raw: ocr.mlkit.detect(img, options) };
        }

        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) {
            return { ok: true, raw: ocr.rapid.detect(img, options) };
        }

        if (mode !== "generic") options.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, options) };

        return { ok: false, error: "未找到可用 OCR detect 接口" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function normalizeOcrResults(results) {
    var out = [];
    if (!results) return out;
    var count = resultLength(results);
    for (var i = 0; i < count; i++) {
        var item = getResultItem(results, i);
        if (!item) continue;
        out.push({
            label: String(item.label || item.text || ""),
            confidence: item.confidence,
            bounds: rectToObject(item.bounds)
        });
    }
    return out;
}

function resultLength(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try {
        if (typeof results.size === "function") return results.size();
    } catch (e) {
    }
    return 0;
}

function getResultItem(results, index) {
    try {
        if (typeof results.get === "function") return results.get(index);
        return results[index];
    } catch (e) {
    }
    return null;
}

function cloneOptions(options) {
    var out = {};
    for (var key in options) {
        if (options.hasOwnProperty(key)) out[key] = options[key];
    }
    return out;
}

function normalizeRegion(region, width, height) {
    var x = normalizeRegionValue(region[0], width);
    var y = normalizeRegionValue(region[1], height);
    var w = normalizeRegionValue(region[2], width);
    var h = normalizeRegionValue(region[3], height);

    if (w < 0) w = width - x;
    if (h < 0) h = height - y;

    x = clamp(Math.round(x), 0, width);
    y = clamp(Math.round(y), 0, height);
    w = clamp(Math.round(w), 0, width - x);
    h = clamp(Math.round(h), 0, height - y);

    return [x, y, w, h];
}

function normalizeRegionValue(value, total) {
    if (value > -1 && value < 1) return value * total;
    return value;
}

function rectToObject(rect) {
    if (!rect) return null;
    return {
        left: Number(rect.left),
        top: Number(rect.top),
        right: Number(rect.right),
        bottom: Number(rect.bottom),
        width: safeCall(function () { return rect.width(); }),
        height: safeCall(function () { return rect.height(); }),
        text: String(rect)
    };
}

function buildSummary(result, logs) {
    if (!config.series.debugSummary) return buildSimpleSummary(result);

    var lines = [];
    lines.push("微信视频号免费剧集剧名采集摘要");
    lines.push("");
    lines.push("时间: " + result.capturedAt);
    lines.push("当前包名: " + result.currentPackage);
    lines.push("当前 Activity: " + result.currentActivity);
    lines.push("");
    lines.push("截图:");
    lines.push("- 点击前: " + (result.beforeScreenshotPath || ""));
    lines.push("- 点击后面板: " + (result.afterScreenshotPath || ""));
    lines.push("- 免费剧集 ROI: " + (result.freeEntryRoiPath || ""));
    lines.push("- 剧名 ROI: " + (result.titleRoiPath || ""));
    lines.push("");
    lines.push("点击:");
    lines.push("- 来源: " + result.clickSource);
    lines.push("- 坐标: " + (result.clickPoint ? result.clickPoint.x + "," + result.clickPoint.y : ""));
    if (result.freeEntryCandidates && result.freeEntryCandidates.length) {
        lines.push("- 免费剧集入口候选:");
        for (var f = 0; f < result.freeEntryCandidates.length; f++) {
            var entry = result.freeEntryCandidates[f];
            lines.push("  " + (f + 1) + ". " + entry.text +
                " score=" + entry.score +
                " box=" + Math.round(entry.left) + "," + Math.round(entry.top) + "," +
                Math.round(entry.right) + "," + Math.round(entry.bottom));
        }
    }
    lines.push("");
    lines.push("识别:");
    lines.push("- 识别来源: " + (result.recognitionSource || ""));
    lines.push("- 剧名: " + (result.seriesName || ""));
    lines.push("- 读取北京时间: " + (result.readTimeBeijing || ""));
    lines.push("- 点击前 OCR 数量: " + (result.beforeOcr ? result.beforeOcr.count : ""));
    lines.push("- 入口 OCR 数量: " + (result.freeEntryOcr ? result.freeEntryOcr.count : ""));
    lines.push("- 剧名 OCR 数量: " + (result.titleOcr ? result.titleOcr.count : ""));
    if (result.titleCandidates && result.titleCandidates.length) {
        lines.push("- 剧名候选:");
        for (var c = 0; c < result.titleCandidates.length; c++) {
            var candidate = result.titleCandidates[c];
            lines.push("  " + (c + 1) + ". " + candidate.text +
                " score=" + Math.round(candidate.score * 100) / 100 +
                " h=" + Math.round(candidate.maxHeight * 100) / 100 +
                " top=" + Math.round(candidate.top * 100) / 100);
        }
    }
    if (result.titleOcr && result.titleOcr.error) lines.push("- 剧名 OCR 错误: " + result.titleOcr.error);
    lines.push("- CSV 写入: " + result.written);
    if (result.skippedReason) lines.push("- 跳过原因: " + result.skippedReason);
    lines.push("- CSV: " + result.csvPath);
    if (result.errors.length) lines.push("- 错误: " + result.errors.join(" | "));
    lines.push("");
    lines.push("日志:");
    for (var i = 0; i < logs.length; i++) lines.push("- " + logs[i]);
    return lines.join("\n");
}

function buildSimpleSummary(result) {
    var lines = [];
    var success = result.written && result.seriesName && !result.skippedReason && !result.errors.length;
    lines.push("微信视频号免费剧集采集");
    lines.push("");
    lines.push("状态: " + (success ? "成功" : "失败"));
    lines.push("剧名: " + (result.seriesName || ""));
    lines.push("读取北京时间: " + (result.readTimeBeijing || ""));
    lines.push("点击: " + (result.clickSource || "") +
        (result.clickPoint ? " (" + result.clickPoint.x + "," + result.clickPoint.y + ")" : ""));
    lines.push("识别: " + (result.recognitionSource || ""));

    lines.push("CSV: " + (result.written ? "已写入" : "未写入"));
    if (result.skippedReason) lines.push("原因: " + result.skippedReason);
    if (result.errors.length) lines.push("错误: " + result.errors.join(" | "));

    lines.push("");
    lines.push("输出目录: " + outputDirFromPath(result.afterScreenshotPath || result.beforeScreenshotPath || ""));
    lines.push("排查文件: after_panel.png, roi_free_series_entry.png, roi_series_panel_title.png");
    lines.push("详细日志: collect_current_series.json");
    lines.push("如需展开候选和完整路径，将 src/config.js 的 series.debugSummary 改为 true。");
    return lines.join("\n");
}

function outputDirFromPath(path) {
    var text = String(path || "");
    var index = text.lastIndexOf("/");
    return index >= 0 ? text.substring(0, index) : text;
}

function shouldSaveDebugArtifacts() {
    return config.series.saveDebugArtifacts === true || config.series.debugSummary === true;
}

function cleanupTemporaryArtifacts(result) {
    if (shouldSaveDebugArtifacts()) return;
    if (result.beforeScreenshotPath) {
        try {
            files.remove(result.beforeScreenshotPath);
            result.beforeScreenshotPath = "";
        } catch (e) {
        }
    }
}

function compactResultForJson(result) {
    if (shouldSaveDebugArtifacts()) return result;
    return {
        capturedAt: result.capturedAt,
        currentPackage: result.currentPackage,
        currentActivity: result.currentActivity,
        afterScreenshotPath: result.afterScreenshotPath,
        freeEntryRoiPath: result.freeEntryRoiPath,
        titleRoiPath: result.titleRoiPath,
        clickPoint: result.clickPoint,
        clickSource: result.clickSource,
        recognitionSource: result.recognitionSource,
        seriesName: result.seriesName,
        readTimeBeijing: result.readTimeBeijing,
        beforeOcrCount: result.beforeOcr ? result.beforeOcr.count : 0,
        titleOcrCount: result.titleOcr ? result.titleOcr.count : 0,
        csvPath: result.csvPath,
        written: result.written,
        skippedReason: result.skippedReason,
        errors: result.errors
    };
}

function makeRunDir(date) {
    var dir = config.series.outputDir + "/" + formatDate(date);
    files.ensureDir(dir + "/.keep");
    return dir;
}

function formatDate(date) {
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return date.getFullYear() +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) + "_" +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds());
}

function formatBeijingDateTime(date) {
    var beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return beijing.getUTCFullYear() + "-" +
        pad(beijing.getUTCMonth() + 1) + "-" +
        pad(beijing.getUTCDate()) + " " +
        pad(beijing.getUTCHours()) + ":" +
        pad(beijing.getUTCMinutes()) + ":" +
        pad(beijing.getUTCSeconds()) + " 北京时间";
}

function writeJson(path, value) {
    files.write(path, JSON.stringify(value, null, 2));
}

function logLine(logs, message) {
    var line = formatBeijingDateTime(new Date()) + " " + message;
    logs.push(line);
    console.log(line);
}

function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function safeCall(fn) {
    try {
        return fn();
    } catch (e) {
        return null;
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
