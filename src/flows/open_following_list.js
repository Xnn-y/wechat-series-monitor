/**
 * Navigate to WeChat Channels "我的关注" list.
 *
 * Start point: WeChat main tab page is preferred.
 * Output: concise JSON + summary for checking where the flow stopped.
 */

"auto";

var config = loadConfig();
var actions = loadActions();
var screenCaptureGranted = false;

main();

function loadConfig() {
    var defaults = {
        wechatPackageName: "com.tencent.mm",
        navigation: {
            outputDir: "/sdcard/Download/wechat_video_flow",
            showConsole: false,
            dryRun: false,
            launchWechat: false,
            launchWaitMs: 1500,
            verifyDelayMs: 900,
            requireStepVerify: true,
            useFixedNavigation: true,
            fixedPoints: {
                discover: [0.625, 0.945],
                channels: [0.20, 0.215],
                profileIcon: [0.936, 0.056],
                following: [0.50, 0.245]
            },
            saveDebugArtifacts: false,
            ocrMode: "paddle",
            ocrFallbackModes: ["paddle", "mlkit", "rapid", "generic"]
        }
    };
    try {
        var externalConfig = require("../config.js");
        return mergeConfig(defaults, externalConfig || {});
    } catch (e) {
        return defaults;
    }
}

function loadActions() {
    var paths = [
        "../actions/wechat_actions.js",
        "./actions/wechat_actions.js",
        "./wechat_actions.js",
        "wechat_actions.js"
    ];
    for (var i = 0; i < paths.length; i++) {
        try {
            return require(paths[i]);
        } catch (e) {
        }
    }
    return createInlineActions();
}

function createInlineActions() {
    return {
        clickDiscover: function (opts) {
            return inlineOcrClick("click_discover", "发现", [0, 0.85, 1, 0.15], [0.625, 0.945], 800, opts);
        },
        clickChannels: function (opts) {
            return inlineOcrClick("click_channels", "视频号", [0, 0.12, 1, 0.22], [0.20, 0.215], 1000, opts);
        },
        clickFollowing: function (opts) {
            return inlineOcrClick("click_following", "关注", [0, 0.05, 1, 0.55], [0.50, 0.245], 1000, opts);
        },
        clickProfileIcon: function (opts) {
            opts = opts || {};
            var point = {
                x: Math.round(device.width * 0.936),
                y: Math.round(device.height * 0.056)
            };
            if (!opts.dryRun) {
                click(point.x, point.y);
                sleep(opts.clickDelay || 1000);
            }
            return {
                ok: true,
                action: "click_profile_icon",
                source: "fixed_ratio",
                clickPoint: point,
                executed: !opts.dryRun,
                skippedReason: ""
            };
        },
        verifyText: function (opts) {
            opts = opts || {};
            var result = inlineOcrFindPoint({
                action: "verify_text",
                target: opts.target,
                roi: opts.roi || null,
                fallback: null,
                matchMode: opts.matchMode || "contains",
                ocrMode: opts.ocrMode,
                ocrFallbackModes: opts.ocrFallbackModes,
                debugDir: opts.debugDir
            });
            result.verifyTarget = opts.target;
            return result;
        },
        runSequence: inlineRunSequence
    };
}

function inlineRunSequence(steps, baseOpts) {
    baseOpts = baseOpts || {};
    var results = [];
    var allOk = true;
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var actionOpts = mergeSimple(baseOpts, step.opts || {});
        if (baseOpts.debugDir) actionOpts.debugDir = baseOpts.debugDir + "/" + pad2(i + 1) + "_" + step.name;
        ensureDebugDir(actionOpts.debugDir);

        var result = step.run(actionOpts);
        result.name = step.name;
        results.push(result);

        if (!result.ok) {
            allOk = false;
            result.stopReason = result.skippedReason || result.error || "action failed";
            break;
        }

        if (step.verify) {
            sleep(baseOpts.verifyDelay || 900);
            var verifyOpts = mergeSimple(baseOpts, step.verify);
            if (baseOpts.debugDir) verifyOpts.debugDir = baseOpts.debugDir + "/" + pad2(i + 1) + "_" + step.name + "_verify";
            ensureDebugDir(verifyOpts.debugDir);
            var verifyResult = actions.verifyText(verifyOpts);
            result.verify = {
                ok: verifyResult.ok,
                target: verifyResult.verifyTarget,
                source: verifyResult.source,
                clickPoint: verifyResult.clickPoint,
                skippedReason: verifyResult.skippedReason,
                matchText: verifyResult.matchItem ? verifyResult.matchItem.label : ""
            };
            if (step.requireVerify && !verifyResult.ok) {
                allOk = false;
                result.stopReason = "verify failed: " + step.verify.target;
                break;
            }
        }
    }
    return { allOk: allOk, results: results };
}

function inlineOcrClick(action, target, roi, fallback, clickDelay, opts) {
    opts = opts || {};
    var result = inlineOcrFindPoint({
        action: action,
        target: target,
        roi: roi,
        fallback: fallback,
        matchMode: opts.matchMode || "contains",
        ocrMode: opts.ocrMode,
        ocrFallbackModes: opts.ocrFallbackModes,
        debugDir: opts.debugDir
    });
    if (!result.ok) return result;
    result.executed = !opts.dryRun;
    if (!opts.dryRun) {
        click(result.clickPoint.x, result.clickPoint.y);
        sleep(clickDelay || opts.clickDelay || 800);
    }
    return result;
}

function inlineOcrFindPoint(opts) {
    var result = {
        ok: false,
        action: opts.action || "",
        clickPoint: null,
        source: "",
        ocrResult: null,
        matchItem: null,
        skippedReason: "",
        target: opts.target,
        roi: opts.roi,
        fallback: opts.fallback
    };

    if (!ensureScreenCapturePermission()) {
        result.skippedReason = "请求截图权限失败";
        return result;
    }

    var img = captureScreen();
    if (!img) {
        result.skippedReason = "captureScreen() 返回空";
        return result;
    }

    try {
        var region = opts.roi ? inlineNormalizeRegion(opts.roi, img.getWidth(), img.getHeight()) : null;
        if (opts.debugDir) {
            result.screenshotPath = opts.debugDir + "/ocr_click_screenshot.png";
            images.save(img, result.screenshotPath);
        }

        result.ocrResult = inlineOcrScreen(img, region, opts);
        if (opts.debugDir) writeJson(opts.debugDir + "/ocr_click_ocr.json", result.ocrResult);

        var match = inlineFindText(result.ocrResult, opts.target, opts.matchMode || "contains");
        if (match) {
            result.ok = true;
            result.source = "ocr";
            result.clickPoint = inlineBoundsCenter(match.bounds || {}, region);
            result.matchItem = match;
            return result;
        }

        if (region && result.ocrResult && result.ocrResult.count === 0) {
            result.ocrResultFull = inlineOcrScreen(img, null, opts);
            var match2 = inlineFindText(result.ocrResultFull, opts.target, opts.matchMode || "contains");
            if (match2) {
                result.ok = true;
                result.source = "ocr_fullscreen";
                result.clickPoint = inlineBoundsCenter(match2.bounds || {}, null);
                result.matchItem = match2;
                return result;
            }
        }

        if (opts.fallback && opts.fallback.length >= 2) {
            result.ok = true;
            result.source = "fallback";
            result.clickPoint = {
                x: Math.round(device.width * opts.fallback[0]),
                y: Math.round(device.height * opts.fallback[1])
            };
            return result;
        }

        result.skippedReason = "OCR 未匹配到目标文字: " + opts.target;
        return result;
    } catch (e) {
        result.skippedReason = "异常: " + String(e);
        return result;
    } finally {
        if (img) img.recycle();
    }
}

function ensureScreenCapturePermission() {
    if (screenCaptureGranted) return true;
    if (!requestScreenCapture()) return false;
    screenCaptureGranted = true;
    sleep(300);
    return true;
}

function inlineOcrScreen(img, region, opts) {
    var baseOptions = { useSlim: true, cpuThreadNum: 4, useOpenCL: false };
    if (region) baseOptions.region = region;
    var modes = (opts.ocrFallbackModes || ["paddle", "mlkit", "rapid", "generic"]).slice();
    var ocrMode = opts.ocrMode || "paddle";
    if (modes.indexOf(ocrMode) < 0) modes.unshift(ocrMode);

    var errors = [];
    for (var i = 0; i < modes.length; i++) {
        var attempt = inlineTryOcrMode(img, baseOptions, modes[i]);
        if (attempt.ok) {
            var items = inlineNormalizeOcrItems(attempt.raw);
            return {
                available: true,
                mode: modes[i],
                region: region,
                count: items.length,
                items: items,
                fallbackErrors: errors
            };
        }
        errors.push(modes[i] + ": " + attempt.error);
    }
    return { available: false, mode: modes.join(","), region: region, count: 0, items: [], error: errors.join(" | "), errors: errors };
}

function inlineTryOcrMode(img, baseOptions, mode) {
    if (typeof ocr === "undefined") return { ok: false, error: "当前 AutoJs6 环境未暴露 ocr" };
    var options = mergeSimple({}, baseOptions);
    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) return { ok: true, raw: ocr.paddle.detect(img, options) };
            if (ocr.detect) {
                options.mode = "paddle";
                return { ok: true, raw: ocr.detect(img, options) };
            }
            return { ok: false, error: "未找到 paddle.detect 或 ocr.detect" };
        }
        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) return { ok: true, raw: ocr.mlkit.detect(img, options) };
        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) return { ok: true, raw: ocr.rapid.detect(img, options) };
        if (mode !== "generic") options.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, options) };
        return { ok: false, error: "未找到可用 OCR detect 接口" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function inlineNormalizeOcrItems(results) {
    var out = [];
    if (!results) return out;
    var count = inlineOcrResultLength(results);
    for (var i = 0; i < count; i++) {
        var item = inlineGetResultItem(results, i);
        if (!item) continue;
        out.push({
            label: item.label || item.text || "",
            confidence: item.confidence,
            bounds: inlineRectToObject(item.bounds)
        });
    }
    return out;
}

function inlineFindText(ocrResult, target, mode) {
    if (!ocrResult || !ocrResult.items || !ocrResult.items.length || !target) return null;
    var cleanTarget = cleanText(target);
    for (var i = 0; i < ocrResult.items.length; i++) {
        var item = ocrResult.items[i];
        var label = cleanText(item.label || "");
        if (!label) continue;
        if (mode === "exact" && label === cleanTarget) return item;
        if (mode === "regex") {
            try {
                if (new RegExp(target).test(label)) return item;
            } catch (e) {
            }
        }
        if (mode !== "exact" && mode !== "regex") {
            if (label.indexOf(cleanTarget) >= 0 || cleanTarget.indexOf(label) >= 0) return item;
        }
    }
    return null;
}

function inlineBoundsCenter(bounds, region) {
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
    return { x: Math.round((left + right) / 2), y: Math.round((top + bottom) / 2) };
}

function inlineNormalizeRegion(region, width, height) {
    var x = inlineNormVal(region[0], width);
    var y = inlineNormVal(region[1], height);
    var w = inlineNormVal(region[2], width);
    var h = inlineNormVal(region[3], height);
    if (w === 0 || w < 0) w = width - x;
    if (h === 0 || h < 0) h = height - y;
    x = clamp(Math.round(x), 0, width - 1);
    y = clamp(Math.round(y), 0, height - 1);
    w = clamp(Math.round(w), 1, width - x);
    h = clamp(Math.round(h), 1, height - y);
    return [x, y, w, h];
}

function inlineRectToObject(rect) {
    if (!rect) return null;
    return {
        left: Number(rect.left || 0),
        top: Number(rect.top || 0),
        right: Number(rect.right || 0),
        bottom: Number(rect.bottom || 0)
    };
}

function inlineOcrResultLength(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try {
        if (typeof results.size === "function") return results.size();
    } catch (e) {
    }
    return 0;
}

function inlineGetResultItem(results, index) {
    try {
        if (typeof results.get === "function") return results.get(index);
        return results[index];
    } catch (e) {
    }
    return null;
}

function inlineNormVal(value, total) {
    if (value > -1 && value < 1) return value * total;
    return value;
}

function mergeSimple(base, override) {
    var out = {};
    copySimple(out, base || {});
    copySimple(out, override || {});
    return out;
}

function copySimple(target, source) {
    for (var key in source) {
        if (source.hasOwnProperty(key)) target[key] = source[key];
    }
}

function ensureDebugDir(dir) {
    if (!dir) return;
    try {
        files.ensureDir(dir + "/.keep");
    } catch (e) {
    }
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
    if (isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function main() {
    if (config.navigation.showConsole) console.show();

    var startedAt = new Date();
    var runDir = makeRunDir(startedAt);
    var logs = [];
    var result = {
        capturedAt: formatBeijingDateTime(startedAt),
        currentPackageBefore: safeCall(function () { return currentPackage(); }),
        currentActivityBefore: safeCall(function () { return currentActivity(); }),
        currentPackageAfter: "",
        currentActivityAfter: "",
        outputDir: runDir,
        allOk: false,
        steps: [],
        stoppedAt: "",
        errors: []
    };

    try {
        logLine(logs, "打开我的关注流程开始");
        if (config.navigation.launchWechat) {
            logLine(logs, "启动微信: " + config.wechatPackageName);
            launch(config.wechatPackageName);
            sleep(config.navigation.launchWaitMs || 1500);
        }

        var sequence = actions.runSequence(buildSteps(), {
            dryRun: !!config.navigation.dryRun,
            verifyDelay: config.navigation.verifyDelayMs || 900,
            debugDir: config.navigation.saveDebugArtifacts ? runDir : null,
            ocrMode: config.navigation.ocrMode,
            ocrFallbackModes: config.navigation.ocrFallbackModes
        });
        result.allOk = sequence.allOk;
        result.steps = compactSteps(sequence.results);
        result.stoppedAt = findStoppedStep(sequence.results);
    } catch (e) {
        result.errors.push(String(e));
        logLine(logs, "错误: " + e);
    }

    result.currentPackageAfter = safeCall(function () { return currentPackage(); });
    result.currentActivityAfter = safeCall(function () { return currentActivity(); });

    writeJson(runDir + "/open_following_list.json", result);
    files.write(runDir + "/summary.txt", buildSummary(result, logs));
    if (config.navigation.saveDebugArtifacts) files.write(runDir + "/log.txt", logs.join("\n") + "\n");
    toastLog(buildToastMessage(result));
}

function buildSteps() {
    if (config.navigation.useFixedNavigation !== false) return buildFixedSteps();

    var requireVerify = config.navigation.requireStepVerify !== false;
    return [
        {
            name: "click_discover",
            run: actions.clickDiscover,
            verify: { target: "视频号", roi: [0, 0.08, 1, 0.80] },
            requireVerify: requireVerify
        },
        {
            name: "click_channels",
            run: actions.clickChannels,
            verify: { target: "关注|朋友|推荐|我", matchMode: "regex", roi: [0, 0, 1, 0.30] },
            requireVerify: false
        },
        {
            name: "click_profile_icon",
            run: actions.clickProfileIcon,
            verify: { target: "关注", roi: [0, 0.05, 1, 0.55] },
            requireVerify: requireVerify
        },
        {
            name: "click_following",
            run: actions.clickFollowing,
            verify: { target: "我的关注|关注", matchMode: "regex", roi: [0, 0, 1, 0.35] },
            requireVerify: false
        }
    ];
}

function buildFixedSteps() {
    return [
        {
            name: "click_discover",
            run: function (opts) {
                return fixedClick("click_discover", getFixedPoint("discover", [0.625, 0.945]), 800, opts);
            },
            requireVerify: false
        },
        {
            name: "click_channels",
            run: function (opts) {
                return fixedClick("click_channels", getFixedPoint("channels", [0.20, 0.215]), 1000, opts);
            },
            requireVerify: false
        },
        {
            name: "click_profile_icon",
            run: function (opts) {
                return fixedClick("click_profile_icon", getFixedPoint("profileIcon", [0.936, 0.056]), 1000, opts);
            },
            requireVerify: false
        },
        {
            name: "click_following",
            run: function (opts) {
                return fixedClick("click_following", getFixedPoint("following", [0.50, 0.245]), 1000, opts);
            },
            requireVerify: false
        }
    ];
}

function fixedClick(action, ratio, delayMs, opts) {
    opts = opts || {};
    var point = {
        x: Math.round(device.width * ratio[0]),
        y: Math.round(device.height * ratio[1])
    };
    if (!opts.dryRun) {
        click(point.x, point.y);
        sleep(delayMs || opts.clickDelay || 1000);
    }
    return {
        ok: true,
        action: action,
        source: "fixed_ratio",
        clickPoint: point,
        executed: !opts.dryRun,
        skippedReason: ""
    };
}

function getFixedPoint(name, fallback) {
    var points = config.navigation.fixedPoints || {};
    var point = points[name] || fallback;
    if (!point || point.length < 2) return fallback;
    return point;
}

function compactSteps(steps) {
    var out = [];
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        out.push({
            name: step.name,
            ok: step.ok,
            source: step.source || step.method || "",
            clickPoint: step.clickPoint || null,
            executed: step.executed,
            verify: step.verify || null,
            skippedReason: step.skippedReason || "",
            stopReason: step.stopReason || "",
            error: step.error || ""
        });
    }
    return out;
}

function findStoppedStep(steps) {
    for (var i = 0; i < steps.length; i++) {
        if (!steps[i].ok || steps[i].stopReason) return steps[i].name;
    }
    return "";
}

function buildSummary(result, logs) {
    var lines = [];
    lines.push("微信视频号打开我的关注");
    lines.push("");
    lines.push("状态: " + (result.allOk && !result.errors.length ? "成功" : "失败"));
    if (result.stoppedAt) lines.push("停止步骤: " + result.stoppedAt);
    lines.push("运行前: " + result.currentPackageBefore + " / " + result.currentActivityBefore);
    lines.push("运行后: " + result.currentPackageAfter + " / " + result.currentActivityAfter);
    lines.push("");
    lines.push("步骤:");
    for (var i = 0; i < result.steps.length; i++) {
        var step = result.steps[i];
        var point = step.clickPoint ? " (" + step.clickPoint.x + "," + step.clickPoint.y + ")" : "";
        lines.push("- " + step.name + ": " + (step.ok ? "ok" : "fail") + " " + step.source + point);
        if (step.verify) lines.push("  verify: " + (step.verify.ok ? "ok" : "fail") + " " + step.verify.target + " " + (step.verify.matchText || ""));
        if (step.stopReason) lines.push("  stop: " + step.stopReason);
        if (step.skippedReason) lines.push("  reason: " + step.skippedReason);
        if (step.error) lines.push("  error: " + step.error);
    }
    if (result.errors.length) lines.push("错误: " + result.errors.join(" | "));
    lines.push("");
    lines.push("输出目录: " + result.outputDir);
    if (logs.length) {
        lines.push("");
        lines.push("日志:");
        for (var j = 0; j < logs.length; j++) lines.push("- " + logs[j]);
    }
    return lines.join("\n");
}

function buildToastMessage(result) {
    if (result.allOk && !result.errors.length) return "打开我的关注流程完成: 成功";
    var text = "打开我的关注流程失败";
    if (result.stoppedAt) text += ": " + result.stoppedAt;
    var step = findStepByName(result.steps, result.stoppedAt);
    if (step) {
        var reason = step.stopReason || step.skippedReason || step.error || "";
        if (!reason && step.verify && !step.verify.ok) reason = "verify " + step.verify.target;
        if (reason) text += " - " + reason;
    }
    if (result.errors.length) text += " - " + result.errors[0];
    return text;
}

function findStepByName(steps, name) {
    for (var i = 0; i < steps.length; i++) {
        if (steps[i].name === name) return steps[i];
    }
    return null;
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

function makeRunDir(date) {
    var dir = config.navigation.outputDir + "/" + formatDate(date);
    files.ensureDir(dir + "/.keep");
    return dir;
}

function writeJson(path, value) {
    files.write(path, JSON.stringify(value, null, 2));
}

function logLine(logs, text) {
    logs.push(formatBeijingDateTime(new Date()) + " " + text);
}

function safeCall(fn) {
    try {
        return fn();
    } catch (e) {
        return "";
    }
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
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return date.getFullYear() + "-" +
        pad(date.getMonth() + 1) + "-" +
        pad(date.getDate()) + " " +
        pad(date.getHours()) + ":" +
        pad(date.getMinutes()) + ":" +
        pad(date.getSeconds()) + " 北京时间";
}
