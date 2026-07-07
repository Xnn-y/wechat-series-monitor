var config = loadConfig();

main();

function loadConfig() {
    var defaults = {
        wechatPackageName: "com.tencent.mm",
        outputDir: "/sdcard/Download/wechat_video_probe",
        startup: {
            waitForWechatForeground: false,
            waitMode: "manualDelay",
            manualDelayMs: 8000,
            requireWechatPackage: false,
            waitTimeoutMs: 20000,
            settleMs: 1000,
            pollMs: 300
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
            { name: "top_nav", description: "顶部导航/返回/标题区域", region: [0, 0, 1, 0.14] },
            { name: "middle_list", description: "关注列表或主要内容区域", region: [0, 0.12, 1, 0.72] },
            { name: "account_header", description: "账号主页顶部账号名区域", region: [0, 0.08, 1, 0.25] },
            { name: "video_grid", description: "账号主页视频宫格区域", region: [0, 0.28, 1, 0.62] },
            { name: "video_detail_left_bottom", description: "视频详情页左下标题/发布时间区域", region: [0, 0.52, 0.76, 0.38] },
            { name: "bottom_tab", description: "底部 Tab/操作区", region: [0, 0.86, 1, 0.14] }
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
    console.show();

    var runDir = makeRunDir(new Date());
    var result = {
        capturedAt: formatBeijingDateTime(new Date()),
        startupWait: null,
        currentPackage: null,
        currentActivity: null,
        screenshotPath: null,
        screenshotSize: null,
        rois: [],
        errors: []
    };

    result.startupWait = waitForWechatForeground();
    result.currentPackage = safeCall(function () { return currentPackage(); });
    result.currentActivity = safeCall(function () { return currentActivity(); });
    if (!result.startupWait.ok) {
        result.errors.push(result.startupWait.error);
        result.errors.push("样本无效，未执行截图/OCR");
        writeJson(runDir + "/screen_only_probe.json", result);
        toastLog("未切回微信，样本无效: " + runDir);
        exit();
    }

    if (!requestScreenCapture()) {
        result.errors.push("请求截图权限失败");
        writeJson(runDir + "/screen_only_probe.json", result);
        toastLog("请求截图权限失败");
        exit();
    }

    sleep(500);

    var img = null;
    try {
        img = captureScreen();
        if (!img) throw new Error("captureScreen() 返回空");

        result.screenshotPath = runDir + "/screenshot.png";
        result.screenshotSize = { width: img.getWidth(), height: img.getHeight() };
        images.save(img, result.screenshotPath);

        result.fullScreenOcr = runOcr(img, null);
        writeJson(runDir + "/ocr_fullscreen.json", result.fullScreenOcr);

        for (var i = 0; i < config.rois.length; i++) {
            var roi = config.rois[i];
            var region = normalizeRegion(roi.region, img.getWidth(), img.getHeight());
            var item = {
                name: roi.name,
                description: roi.description,
                region: region,
                imagePath: runDir + "/roi_" + roi.name + ".png",
                ocr: runOcr(img, region)
            };

            var clip = images.clip(img, region[0], region[1], region[2], region[3]);
            images.save(clip, item.imagePath);
            clip.recycle();

            result.rois.push(item);
            writeJson(runDir + "/ocr_roi_" + roi.name + ".json", item);
        }
    } catch (e) {
        result.errors.push(String(e));
    } finally {
        if (img) img.recycle();
    }

    writeJson(runDir + "/screen_only_probe.json", result);
    toastLog("屏幕探测完成: " + runDir);
}

function waitForWechatForeground() {
    var startup = config.startup || {};
    if (startup.waitForWechatForeground === false) {
        var disabledPackage = safeCall(function () { return currentPackage(); });
        return {
            ok: true,
            disabled: true,
            targetPackage: config.wechatPackageName,
            packageBeforeWait: disabledPackage,
            packageAfterWait: disabledPackage,
            packageMatched: disabledPackage === config.wechatPackageName,
            waitedMs: 0,
            warning: null,
            error: null
        };
    }

    var mode = startup.waitMode || "manualDelay";
    if (mode === "manualDelay") {
        var delayMs = startup.manualDelayMs || 8000;
        var manualStarted = Date.now();
        var manualBefore = safeCall(function () { return currentPackage(); });

        toastLog("请停留在微信目标页面，" + Math.round(delayMs / 1000) + " 秒后开始采样");
        sleep(delayMs);

        var manualAfter = safeCall(function () { return currentPackage(); });
        var manualMatched = manualAfter === config.wechatPackageName;
        return {
            ok: true,
            disabled: false,
            mode: mode,
            targetPackage: config.wechatPackageName,
            packageBeforeWait: manualBefore,
            packageAfterWait: manualAfter,
            packageMatched: manualMatched,
            currentActivityAfterWait: safeCall(function () { return currentActivity(); }),
            waitedMs: Date.now() - manualStarted,
            warning: manualMatched ? null : "currentPackage() 未匹配微信；请结合截图判断",
            error: null
        };
    }

    var timeoutMs = startup.waitTimeoutMs || 20000;
    var settleMs = startup.settleMs || 1000;
    var pollMs = startup.pollMs || 300;
    var started = Date.now();
    var before = safeCall(function () { return currentPackage(); });

    toastLog("请切回微信目标页面，脚本会等待 " + Math.round(timeoutMs / 1000) + " 秒");
    while (Date.now() - started <= timeoutMs) {
        var pkg = safeCall(function () { return currentPackage(); });
        if (pkg === config.wechatPackageName) {
            sleep(settleMs);
            return {
                ok: true,
                disabled: false,
                mode: mode,
                targetPackage: config.wechatPackageName,
                packageBeforeWait: before,
                packageAfterWait: safeCall(function () { return currentPackage(); }),
                packageMatched: safeCall(function () { return currentPackage(); }) === config.wechatPackageName,
                currentActivityAfterWait: safeCall(function () { return currentActivity(); }),
                waitedMs: Date.now() - started,
                warning: null,
                error: null
            };
        }
        sleep(pollMs);
    }

    var after = safeCall(function () { return currentPackage(); });
    return {
        ok: false,
        disabled: false,
        mode: mode,
        targetPackage: config.wechatPackageName,
        packageBeforeWait: before,
        packageAfterWait: after,
        packageMatched: after === config.wechatPackageName,
        currentActivityAfterWait: safeCall(function () { return currentActivity(); }),
        waitedMs: Date.now() - started,
        warning: null,
        error: "等待超时，未进入微信前台；当前包名=" + after
    };
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

function cloneOptions(options) {
    var out = {};
    for (var key in options) {
        if (options.hasOwnProperty(key)) out[key] = options[key];
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

function normalizeOcrResults(results) {
    var out = [];
    if (!results) return out;
    var count = resultLength(results);
    for (var i = 0; i < count; i++) {
        var item = getResultItem(results, i);
        if (!item) continue;
        out.push({
            label: item.label || item.text || "",
            confidence: item.confidence,
            bounds: rectToObject(item.bounds)
        });
    }
    return out;
}

function getResultItem(results, index) {
    try {
        if (typeof results.get === "function") return results.get(index);
        return results[index];
    } catch (e) {
    }
    return null;
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

function makeRunDir(date) {
    var dir = config.outputDir + "/" + formatDate(date) + "_screen";
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
