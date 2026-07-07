"auto";

var config = loadConfig();

main();

function loadConfig() {
    var defaults = {
        wechatPackageName: "com.tencent.mm",
        collectOutputDir: "/sdcard/Download/wechat_video_collect",
        csvPath: "/sdcard/Download/wechat_video_watch.csv",
        collect: {
            scanWindowMinutes: 180,
            defaultAccountName: "unknown",
            writeUnmatchedRecords: false,
            evidenceRoiName: "video_detail_left_bottom",
            showConsole: false,
            writeWhenOcrEmpty: false,
            fuzzyDuplicateEnabled: false,
            duplicateTitleSimilarity: 0.42,
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
            { name: "video_detail_left_bottom", description: "视频详情页左下标题/发布时间区域", region: [0, 0.52, 0.76, 0.38] }
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
    if (config.collect.showConsole) console.show();

    var startedAt = new Date();
    var runDir = makeRunDir(startedAt);
    var logs = [];
    logLine(logs, "V2 单视频详情采集开始");
    logLine(logs, "输出目录: " + runDir);

    var environment = collectEnvironment();
    writeJson(runDir + "/environment.json", environment);

    var result = {
        capturedAt: startedAt.toISOString(),
        environment: environment,
        screenshotPath: null,
        roiPath: null,
        roi: null,
        ocr: null,
        parsed: null,
        recognitionSource: "ocr",
        imageDiagnostics: null,
        roiDiagnostics: null,
        csvPath: config.csvPath,
        written: false,
        duplicate: false,
        skippedReason: "",
        errors: []
    };

    var img = null;
    var clip = null;
    try {
        if (!requestScreenCapture()) {
            throw new Error("请求截图权限失败");
        }
        sleep(500);
        img = captureScreen();
        if (!img) throw new Error("captureScreen() 返回空");

        result.screenshotPath = runDir + "/screenshot.png";
        images.save(img, result.screenshotPath);
        result.imageDiagnostics = analyzeImageBrightness(img);
        logLine(logs, "截图已保存: " + result.screenshotPath);

        var roi = findRoi(config.collect.evidenceRoiName);
        var region = normalizeRegion(roi.region, img.getWidth(), img.getHeight());
        result.roi = {
            name: roi.name,
            description: roi.description,
            region: region
        };

        clip = images.clip(img, region[0], region[1], region[2], region[3]);
        result.roiPath = runDir + "/roi_" + roi.name + ".png";
        images.save(clip, result.roiPath);
        result.roiDiagnostics = analyzeImageBrightness(clip);
        logLine(logs, "ROI 已保存: " + result.roiPath);

        result.ocr = runOcr(img, region);
        writeJson(runDir + "/ocr_roi_" + roi.name + ".json", result.ocr);

        result.parsed = parseVideoDetail(result.ocr, startedAt);
        result.parsed.accountName = result.parsed.accountName || config.collect.defaultAccountName;
        result.parsed.evidenceDir = runDir;
        result.parsed.screenshotPath = result.screenshotPath;
        result.parsed.roiPath = result.roiPath;
        result.parsed.currentActivity = environment.currentActivity;
        result.skippedReason = getSkipReason(result);
        if (!result.skippedReason && shouldWriteRecord(result.parsed)) {
            var writeResult = appendCsvRecord(config.csvPath, result.parsed);
            result.written = writeResult.written;
            result.duplicate = writeResult.duplicate;
            logLine(logs, writeResult.message);
        } else if (result.skippedReason) {
            logLine(logs, "未写入 CSV: " + result.skippedReason);
        } else {
            logLine(logs, "未写入 CSV: 未命中窗口且配置不写入未命中记录");
        }
    } catch (e) {
        result.errors.push(String(e));
        logLine(logs, "错误: " + e);
    } finally {
        if (clip) clip.recycle();
        if (img) img.recycle();
    }

    writeJson(runDir + "/collect_current_video.json", result);
    files.write(runDir + "/summary.txt", buildSummary(result, logs));
    files.write(runDir + "/log.txt", logs.join("\n") + "\n");

    logLine(logs, "V2 单视频详情采集完成");
    toastLog("V2 采集完成: " + runDir);
}

function collectEnvironment() {
    var wechatVersion = null;
    try {
        var info = context.getPackageManager().getPackageInfo(config.wechatPackageName, 0);
        wechatVersion = info.versionName;
    } catch (e) {
        wechatVersion = "unavailable: " + String(e);
    }

    return {
        timestamp: formatBeijingDateTime(new Date()),
        currentPackage: safeCall(function () { return currentPackage(); }),
        currentActivity: safeCall(function () { return currentActivity(); }),
        device: {
            width: device.width,
            height: device.height,
            brand: device.brand,
            model: device.model,
            sdkInt: device.sdkInt,
            release: device.release
        },
        wechat: {
            packageName: config.wechatPackageName,
            versionName: wechatVersion
        }
    };
}

function parseVideoDetail(ocrResult, now) {
    var lines = ocrLines(ocrResult);
    var rawText = lines.join("\n");
    var timeInfo = extractPublishTime(lines, now);
    var titleLines = [];

    for (var i = 0; i < lines.length; i++) {
        var line = cleanText(lines[i]);
        if (!line) continue;
        if (timeInfo && line.indexOf(timeInfo.publishTimeText) >= 0) continue;
        if (isNoiseLine(line)) continue;
        titleLines.push(line);
    }

    return {
        detectedAt: formatBeijingDateTime(now),
        accountName: "",
        title: titleLines.join(" ").slice(0, 300),
        publishTimeText: timeInfo ? timeInfo.publishTimeText : "",
        publishAgeMinutes: timeInfo ? timeInfo.ageMinutes : null,
        withinWindow: timeInfo ? timeInfo.ageMinutes <= config.collect.scanWindowMinutes : false,
        scanWindowMinutes: config.collect.scanWindowMinutes,
        rawText: rawText,
        ocrMode: ocrResult ? ocrResult.mode : "",
        ocrCount: ocrResult && ocrResult.count !== undefined ? ocrResult.count : null,
        remark: timeInfo ? "" : "未识别到发布时间",
        dedupeKey: ""
    };
}

function ocrLines(ocrResult) {
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
    var currentY = null;
    for (var i = 0; i < items.length; i++) {
        var text = cleanText(items[i].label || "");
        if (!text) continue;
        var bounds = items[i].bounds || {};
        var y = Number(bounds.top || 0);
        if (currentY === null || Math.abs(y - currentY) <= 18) {
            current.push(text);
            if (currentY === null) currentY = y;
        } else {
            lines.push(current.join(""));
            current = [text];
            currentY = y;
        }
    }
    if (current.length) lines.push(current.join(""));
    return lines;
}

function extractPublishTime(lines, now) {
    var text = cleanText(lines.join(" "));
    var match;

    if (/刚刚/.test(text)) {
        return { publishTimeText: "刚刚", ageMinutes: 0 };
    }

    match = text.match(/(\d{1,3})\s*分[钟鐘鈡]前?/);
    if (match) {
        return { publishTimeText: match[0], ageMinutes: parseInt(match[1], 10) };
    }

    match = text.match(/(\d{1,2})\s*小时[前]?/);
    if (match) {
        return { publishTimeText: match[0], ageMinutes: parseInt(match[1], 10) * 60 };
    }

    match = text.match(/今天\s*(\d{1,2})[:：](\d{2})/);
    if (match) {
        var published = new Date(now.getTime());
        published.setHours(parseInt(match[1], 10));
        published.setMinutes(parseInt(match[2], 10));
        published.setSeconds(0);
        published.setMilliseconds(0);
        var diff = Math.round((now.getTime() - published.getTime()) / 60000);
        if (diff < 0) diff += 24 * 60;
        return { publishTimeText: match[0], ageMinutes: diff };
    }

    match = text.match(/(\d{1,2})[:：](\d{2})/);
    if (match) {
        var today = new Date(now.getTime());
        today.setHours(parseInt(match[1], 10));
        today.setMinutes(parseInt(match[2], 10));
        today.setSeconds(0);
        today.setMilliseconds(0);
        var minutes = Math.round((now.getTime() - today.getTime()) / 60000);
        if (minutes >= 0 && minutes <= 24 * 60) {
            return { publishTimeText: match[0], ageMinutes: minutes };
        }
    }

    return null;
}

function isNoiseLine(line) {
    return /^(推荐|关注|朋友|赞|评论|转发|合集|可能含有AI生成内容)$/.test(line) ||
        /^#/.test(line) ||
        /^[\d\s]+$/.test(line);
}

function shouldWriteRecord(parsed) {
    return parsed.withinWindow || config.collect.writeUnmatchedRecords;
}

function getSkipReason(result) {
    if (result.imageDiagnostics && result.imageDiagnostics.likelyBlack) {
        return "整屏截图疑似黑屏";
    }
    if (result.roiDiagnostics && result.roiDiagnostics.likelyBlack) {
        return "ROI 疑似黑屏";
    }
    if (!config.collect.writeWhenOcrEmpty && (!result.ocr || !result.ocr.count)) {
        return "OCR 结果为空";
    }
    return "";
}

function analyzeImageBrightness(img) {
    var width = img.getWidth();
    var height = img.getHeight();
    var step = config.collect.blackSampleStep || 24;
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
        likelyBlack: average <= config.collect.blackMaxAverageBrightness &&
            brightRatio <= config.collect.blackMaxBrightPixelRatio
    };
}

function appendCsvRecord(path, parsed) {
    ensureCsv(path);
    parsed.dedupeKey = makeDedupeKey(parsed);

    var existing = files.read(path);
    if (existing.indexOf(parsed.dedupeKey) >= 0) {
        return { written: false, duplicate: true, message: "CSV 已存在相同记录，跳过写入" };
    }

    var duplicate = findFuzzyDuplicate(existing, parsed);
    if (duplicate) {
        return {
            written: false,
            duplicate: true,
            message: "CSV 已存在相似记录，跳过写入，相似度=" + duplicate.similarity
        };
    }

    var row = [
        parsed.dedupeKey,
        parsed.detectedAt,
        parsed.accountName,
        parsed.title,
        parsed.publishTimeText,
        parsed.publishAgeMinutes,
        parsed.withinWindow,
        parsed.scanWindowMinutes,
        parsed.ocrMode,
        parsed.ocrCount,
        parsed.currentActivity,
        parsed.roiPath,
        parsed.screenshotPath,
        parsed.remark,
        parsed.rawText
    ].map(csvCell).join(",") + "\n";

    files.append(path, row);
    return { written: true, duplicate: false, message: "CSV 已写入: " + path };
}

function findFuzzyDuplicate(csvText, parsed) {
    if (!config.collect.fuzzyDuplicateEnabled) return null;
    if (!parsed.publishTimeText || !parsed.title) return null;

    var rows = parseCsvRecords(csvText);
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row.publish_time_text || row.publish_time_text !== parsed.publishTimeText) continue;
        if (row.account_name && parsed.accountName && row.account_name !== parsed.accountName) continue;

        var similarity = textSimilarity(row.title || row.raw_text || "", parsed.title || parsed.rawText || "");
        if (similarity >= config.collect.duplicateTitleSimilarity) {
            return {
                row: row,
                similarity: Math.round(similarity * 1000) / 1000
            };
        }
    }

    return null;
}

function parseCsvRecords(csvText) {
    var lines = String(csvText || "").split(/\r?\n/);
    if (lines.length < 2) return [];
    var headers = parseCsvLine(lines[0]);
    var out = [];
    for (var i = 1; i < lines.length; i++) {
        if (!lines[i]) continue;
        var values = parseCsvLine(lines[i]);
        var row = {};
        for (var j = 0; j < headers.length; j++) {
            row[headers[j]] = values[j] || "";
        }
        out.push(row);
    }
    return out;
}

function parseCsvLine(line) {
    var out = [];
    var current = "";
    var quoted = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (quoted) {
            if (ch === '"') {
                if (line.charAt(i + 1) === '"') {
                    current += '"';
                    i++;
                } else {
                    quoted = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                quoted = true;
            } else if (ch === ",") {
                out.push(current);
                current = "";
            } else {
                current += ch;
            }
        }
    }
    out.push(current);
    return out;
}

function textSimilarity(a, b) {
    var left = normalizeForSimilarity(a);
    var right = normalizeForSimilarity(b);
    if (!left || !right) return 0;
    if (left === right) return 1;

    var leftSet = charSet(left);
    var rightSet = charSet(right);
    var intersection = 0;
    var union = {};

    for (var key in leftSet) {
        if (leftSet.hasOwnProperty(key)) {
            union[key] = true;
            if (rightSet[key]) intersection++;
        }
    }
    for (var rightKey in rightSet) {
        if (rightSet.hasOwnProperty(rightKey)) union[rightKey] = true;
    }

    var unionCount = 0;
    for (var unionKey in union) {
        if (union.hasOwnProperty(unionKey)) unionCount++;
    }

    return unionCount ? intersection / unionCount : 0;
}

function normalizeForSimilarity(text) {
    return cleanText(text)
        .replace(/可能含有AI生成内容/g, "")
        .replace(/免费剧集/g, "")
        .replace(/全集/g, "")
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
        .toLowerCase();
}

function charSet(text) {
    var out = {};
    for (var i = 0; i < text.length; i++) {
        out[text.charAt(i)] = true;
    }
    return out;
}

function ensureCsv(path) {
    ensureParentDir(path);
    if (!files.exists(path)) {
        files.write(path, [
            "dedupe_key",
            "detected_at",
            "account_name",
            "title",
            "publish_time_text",
            "publish_age_minutes",
            "within_window",
            "scan_window_minutes",
            "ocr_mode",
            "ocr_count",
            "activity",
            "roi_path",
            "screenshot_path",
            "remark",
            "raw_text"
        ].join(",") + "\n");
    }
}

function ensureParentDir(path) {
    var slashIndex = String(path).lastIndexOf("/");
    if (slashIndex >= 0) {
        files.ensureDir(String(path).substring(0, slashIndex) + "/.keep");
    }
}

function makeDedupeKey(parsed) {
    var source = [
        parsed.accountName,
        parsed.title,
        parsed.publishTimeText,
        parsed.rawText
    ].join("|");
    return md5(source);
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

function findRoi(name) {
    for (var i = 0; i < config.rois.length; i++) {
        if (config.rois[i].name === name) return config.rois[i];
    }
    return config.rois[0];
}

function runOcr(img, region) {
    if (!config.ocr.enabled) return { available: false, disabled: true };

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
    var parsed = result.parsed || {};
    var lines = [];
    lines.push("微信视频号 V2 单视频详情采集摘要");
    lines.push("");
    lines.push("时间: " + formatBeijingDateTime(new Date(result.capturedAt)));
    lines.push("当前包名: " + result.environment.currentPackage);
    lines.push("当前 Activity: " + result.environment.currentActivity);
    lines.push("微信版本: " + result.environment.wechat.versionName);
    lines.push("");
    lines.push("截图/OCR:");
    lines.push("- 截图: " + (result.screenshotPath || "无"));
    lines.push("- ROI: " + (result.roiPath || "无"));
    if (result.imageDiagnostics) {
        lines.push("- 整屏疑似黑屏: " + result.imageDiagnostics.likelyBlack);
        lines.push("- 整屏平均亮度: " + Math.round(result.imageDiagnostics.averageBrightness * 100) / 100);
        lines.push("- 整屏亮像素比例: " + Math.round(result.imageDiagnostics.brightPixelRatio * 10000) / 100 + "%");
    }
    if (result.roiDiagnostics) {
        lines.push("- ROI 疑似黑屏: " + result.roiDiagnostics.likelyBlack);
        lines.push("- ROI 平均亮度: " + Math.round(result.roiDiagnostics.averageBrightness * 100) / 100);
        lines.push("- ROI 亮像素比例: " + Math.round(result.roiDiagnostics.brightPixelRatio * 10000) / 100 + "%");
    }
    lines.push("- OCR 模式: " + (result.ocr ? result.ocr.mode : "未执行"));
    lines.push("- OCR 数量: " + (result.ocr ? result.ocr.count : "未执行"));
    if (result.ocr && result.ocr.error) lines.push("- OCR 错误: " + result.ocr.error);
    lines.push("- 最终识别来源: " + (result.recognitionSource || "ocr"));
    lines.push("");
    lines.push("解析:");
    lines.push("- OCR 文本候选: " + (parsed.title || ""));
    lines.push("- 发布时间: " + (parsed.publishTimeText || ""));
    lines.push("- 距今分钟: " + (parsed.publishAgeMinutes === null || parsed.publishAgeMinutes === undefined ? "" : parsed.publishAgeMinutes));
    lines.push("- 命中窗口: " + parsed.withinWindow);
    lines.push("- CSV 写入: " + result.written);
    lines.push("- 重复记录: " + result.duplicate);
    lines.push("- 模糊去重: " + config.collect.fuzzyDuplicateEnabled);
    if (result.skippedReason) lines.push("- 跳过原因: " + result.skippedReason);
    lines.push("- CSV: " + result.csvPath);
    if (parsed.remark) lines.push("- 备注: " + parsed.remark);
    if (result.errors.length) lines.push("- 错误: " + result.errors.join(" | "));
    lines.push("");
    lines.push("原始 OCR 文本:");
    lines.push(parsed.rawText || "");
    lines.push("");
    lines.push("日志:");
    for (var i = 0; i < logs.length; i++) lines.push("- " + logs[i]);
    return lines.join("\n");
}

function makeRunDir(date) {
    var dir = config.collectOutputDir + "/" + formatDate(date);
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
    var line = "[" + new Date().toISOString() + "] " + message;
    logs.push(line);
    console.log(line);
}

function cleanText(text) {
    return String(text || "")
        .replace(/\s+/g, "")
        .replace(/[，,。]+$/g, "")
        .trim();
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
