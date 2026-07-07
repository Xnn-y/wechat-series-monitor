"auto";

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
        tree: {
            maxDepth: 40,
            maxNodes: 2500,
            includeInvisible: true
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

    var startedAt = new Date();
    var runDir = makeRunDir(startedAt);
    var logs = [];

    logLine(logs, "V1 双探测开始");
    logLine(logs, "输出目录: " + runDir);

    var startupWait = waitForWechatForeground(logs);
    var environment = collectEnvironment();
    environment.startupWait = startupWait;
    writeJson(runDir + "/environment.json", environment);

    if (!startupWait.ok) {
        var invalidTreeResult = createEmptyTreeResult(startedAt, environment);
        invalidTreeResult.errors.push(startupWait.error);
        writeJson(runDir + "/accessibility_tree.json", invalidTreeResult);

        var invalidScreenResult = createEmptyScreenResult();
        invalidScreenResult.errors.push("样本无效，未执行截图/OCR");
        writeJson(runDir + "/screen_probe.json", invalidScreenResult);

        logLine(logs, "V1 双探测中止: 未进入微信前台");
        var invalidSummary = buildSummary(environment, invalidTreeResult, invalidScreenResult, logs);
        files.write(runDir + "/summary.txt", invalidSummary);
        files.write(runDir + "/log.txt", logs.join("\n") + "\n");

        toastLog("未切回微信，样本无效: " + runDir);
        return;
    }

    var rootInfo = getRootNode(logs);
    var root = rootInfo.node;
    var treeResult = createEmptyTreeResult(startedAt, environment);
    treeResult.rootAvailable = !!root;
    treeResult.rootSource = rootInfo.source;
    treeResult.rootCandidates = rootInfo.candidates;

    if (root) {
        treeResult.root = dumpNode(root, null, 0, treeResult);
        logLine(logs, "无障碍树节点数: " + treeResult.nodeCount);
        if (treeResult.nodeCount <= 1) {
            treeResult.flatNodes = collectFlatNodes(logs, config.tree.maxNodes);
            treeResult.flatNodeCount = treeResult.flatNodes.length;
            logLine(logs, "选择器平铺节点数: " + treeResult.flatNodeCount);
        }
    } else {
        treeResult.errors.push("未获取到 auto.rootInActiveWindow / auto.root / depth(0) 根节点");
        logLine(logs, "未获取到无障碍根节点");
    }
    writeJson(runDir + "/accessibility_tree.json", treeResult);

    var screenResult = captureAndOcr(runDir, logs);
    writeJson(runDir + "/screen_probe.json", screenResult);

    var summary = buildSummary(environment, treeResult, screenResult, logs);
    files.write(runDir + "/summary.txt", summary);
    files.write(runDir + "/log.txt", logs.join("\n") + "\n");

    logLine(logs, "V1 双探测完成");
    toastLog("探测完成: " + runDir);
}

function waitForWechatForeground(logs) {
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
        logLine(logs, "手动倒计时采样: 当前包名=" + manualBefore + ", " + delayMs + "ms 后开始采集");
        toastLog("请停留在微信目标页面，" + Math.round(delayMs / 1000) + " 秒后开始采样");
        sleep(delayMs);

        var manualAfter = safeCall(function () { return currentPackage(); });
        var manualMatched = manualAfter === config.wechatPackageName;
        var manualWarning = manualMatched ? null : "currentPackage() 未匹配微信；视频号全屏/悬浮窗环境下该字段可能不可靠，请结合截图判断";
        if (manualWarning) logLine(logs, manualWarning + "，当前包名=" + manualAfter);

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
            warning: manualWarning,
            error: null
        };
    }

    var timeoutMs = startup.waitTimeoutMs || 20000;
    var settleMs = startup.settleMs || 1000;
    var pollMs = startup.pollMs || 300;
    var started = Date.now();
    var before = safeCall(function () { return currentPackage(); });

    logLine(logs, "等待微信前台: 当前包名=" + before + ", 目标包名=" + config.wechatPackageName);
    toastLog("请切回微信目标页面，脚本会等待 " + Math.round(timeoutMs / 1000) + " 秒");

    while (Date.now() - started <= timeoutMs) {
        var pkg = safeCall(function () { return currentPackage(); });
        if (pkg === config.wechatPackageName) {
            logLine(logs, "已进入微信前台，稳定等待 " + settleMs + "ms");
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
    var message = "等待超时，未进入微信前台；当前包名=" + after;
    logLine(logs, message);
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
        error: message
    };
}

function createEmptyTreeResult(startedAt, environment) {
    return {
        capturedAt: startedAt.toISOString(),
        environment: environment,
        rootAvailable: false,
        rootSource: null,
        rootCandidates: [],
        nodeCount: 0,
        visibleNodeCount: 0,
        clickableNodeCount: 0,
        scrollableNodeCount: 0,
        textNodeCount: 0,
        flatNodeCount: 0,
        flatNodes: [],
        truncated: false,
        root: null,
        errors: []
    };
}

function createEmptyScreenResult() {
    return {
        screenshotEnabled: config.screenshot.enabled,
        screenshotPath: null,
        screenshotSize: null,
        ocrEnabled: config.ocr.enabled,
        fullScreenOcr: null,
        roiResults: [],
        errors: []
    };
}

function collectEnvironment() {
    var wechatVersion = null;
    var wechatLastUpdateTime = null;

    try {
        var info = context.getPackageManager().getPackageInfo(config.wechatPackageName, 0);
        wechatVersion = info.versionName;
        wechatLastUpdateTime = info.lastUpdateTime;
    } catch (e) {
        wechatVersion = "unavailable: " + String(e);
    }

    return {
        timestamp: formatBeijingDateTime(new Date()),
        device: {
            width: device.width,
            height: device.height,
            brand: device.brand,
            manufacturer: device.manufacturer,
            model: device.model,
            sdkInt: device.sdkInt,
            release: device.release
        },
        currentPackage: safeCall(function () { return currentPackage(); }),
        currentActivity: safeCall(function () { return currentActivity(); }),
        autoState: safeCall(function () { return auto.state; }),
        autoService: !!auto.service,
        wechat: {
            packageName: config.wechatPackageName,
            versionName: wechatVersion,
            lastUpdateTime: wechatLastUpdateTime
        }
    };
}

function getRootNode(logs) {
    var candidates = [];

    addRootCandidate(candidates, "auto.rootInActiveWindow", function () {
        return auto.rootInActiveWindow;
    }, logs);

    addRootCandidate(candidates, "auto.root", function () {
        return auto.root;
    }, logs);

    addRootCandidate(candidates, "depth(0).findOnce()", function () {
        return depth(0).findOnce();
    }, logs);

    var best = null;
    for (var i = 0; i < candidates.length; i++) {
        var item = candidates[i];
        if (!item.node) continue;
        item.probe = probeNodeTree(item.node, 120);
        item.score = scoreRootProbe(item.probe);
        logLine(logs, "根节点候选: " + item.source +
            " score=" + item.score +
            " probeNodes=" + item.probe.nodeCount +
            " childLinks=" + item.probe.childLinkCount +
            " visible=" + item.probe.visibleNodeCount +
            " text=" + item.probe.textNodeCount);
        if (!best || item.score > best.score) best = item;
    }

    if (!best) {
        return { node: null, source: null, candidates: summarizeRootCandidates(candidates) };
    }

    logLine(logs, "根节点来源: " + best.source);
    return {
        node: best.node,
        source: best.source,
        candidates: summarizeRootCandidates(candidates)
    };
}

function addRootCandidate(candidates, source, getter, logs) {
    try {
        var node = getter();
        candidates.push({
            source: source,
            available: !!node,
            node: node,
            score: 0,
            probe: null,
            error: null
        });
        if (!node) logLine(logs, source + " 返回空");
    } catch (e) {
        candidates.push({
            source: source,
            available: false,
            node: null,
            score: 0,
            probe: null,
            error: String(e)
        });
        logLine(logs, source + " 不可用: " + e);
    }
}

function summarizeRootCandidates(candidates) {
    var out = [];
    for (var i = 0; i < candidates.length; i++) {
        out.push({
            source: candidates[i].source,
            available: candidates[i].available,
            score: candidates[i].score,
            probe: candidates[i].probe,
            error: candidates[i].error
        });
    }
    return out;
}

function probeNodeTree(root, limit) {
    var stats = {
        nodeCount: 0,
        visibleNodeCount: 0,
        textNodeCount: 0,
        clickableNodeCount: 0,
        scrollableNodeCount: 0,
        childLinkCount: 0,
        maxDepth: 0
    };
    var queue = [{ node: root, depth: 0 }];

    while (queue.length > 0 && stats.nodeCount < limit) {
        var current = queue.shift();
        var node = current.node;
        if (!node) continue;

        stats.nodeCount++;
        if (current.depth > stats.maxDepth) stats.maxDepth = current.depth;
        if (boolMethod(node, "visibleToUser")) stats.visibleNodeCount++;
        if (stringMethod(node, "text") || stringMethod(node, "desc")) stats.textNodeCount++;
        if (boolMethod(node, "clickable")) stats.clickableNodeCount++;
        if (boolMethod(node, "scrollable")) stats.scrollableNodeCount++;

        var childCount = getChildCount(node);
        stats.childLinkCount += childCount;
        for (var i = 0; i < childCount && queue.length + stats.nodeCount < limit; i++) {
            queue.push({ node: getChild(node, i), depth: current.depth + 1 });
        }
    }

    return stats;
}

function scoreRootProbe(probe) {
    if (!probe) return 0;
    return probe.nodeCount * 10 +
        probe.childLinkCount * 8 +
        probe.visibleNodeCount * 5 +
        probe.textNodeCount * 8 +
        probe.clickableNodeCount * 4 +
        probe.scrollableNodeCount * 4 +
        probe.maxDepth * 3;
}

function dumpNode(node, parentPath, index, result) {
    if (!node || result.nodeCount >= config.tree.maxNodes) {
        result.truncated = true;
        return null;
    }

    var visible = boolMethod(node, "visibleToUser");
    if (!config.tree.includeInvisible && !visible) {
        return null;
    }

    var path = parentPath === null ? "0" : parentPath + "." + index;
    var bounds = rectToObject(nodeBounds(node));
    var textValue = stringMethod(node, "text");
    var descValue = stringMethod(node, "desc");
    var clickable = boolMethod(node, "clickable");
    var scrollable = boolMethod(node, "scrollable");

    result.nodeCount++;
    if (visible) result.visibleNodeCount++;
    if (clickable) result.clickableNodeCount++;
    if (scrollable) result.scrollableNodeCount++;
    if (textValue || descValue) result.textNodeCount++;

    var item = {
        path: path,
        indexInParent: safeCall(function () { return node.indexInParent(); }),
        depth: nodeDepth(node, itemDepthFromPath(path)),
        text: textValue,
        desc: descValue,
        id: nodeString(node, "id"),
        className: nodeString(node, "className"),
        packageName: nodeString(node, "packageName"),
        bounds: bounds,
        center: bounds ? { x: Math.round((bounds.left + bounds.right) / 2), y: Math.round((bounds.top + bounds.bottom) / 2) } : null,
        clickable: clickable,
        longClickable: boolMethod(node, "longClickable"),
        scrollable: scrollable,
        enabled: boolMethod(node, "enabled"),
        visibleToUser: visible,
        selected: boolMethod(node, "selected"),
        checkable: boolMethod(node, "checkable"),
        checked: boolMethod(node, "checked"),
        focusable: boolMethod(node, "focusable"),
        focused: boolMethod(node, "focused"),
        childCount: getChildCount(node),
        children: []
    };

    if (item.depth >= config.tree.maxDepth) {
        item.truncatedChildren = true;
        result.truncated = true;
        return item;
    }

    for (var i = 0; i < item.childCount; i++) {
        if (result.nodeCount >= config.tree.maxNodes) {
            item.truncatedChildren = true;
            result.truncated = true;
            break;
        }
        var child = getChild(node, i);
        var childDump = dumpNode(child, path, i, result);
        if (childDump) item.children.push(childDump);
    }

    return item;
}

function captureAndOcr(runDir, logs) {
    var result = {
        screenshotEnabled: config.screenshot.enabled,
        screenshotPath: null,
        screenshotSize: null,
        ocrEnabled: config.ocr.enabled,
        fullScreenOcr: null,
        roiResults: [],
        errors: []
    };

    if (!config.screenshot.enabled) {
        return result;
    }

    var img = null;
    try {
        if (!requestScreenCapture()) {
            result.errors.push("请求截图权限失败");
            return result;
        }

        sleep(500);
        img = captureScreen();
        if (!img) {
            result.errors.push("captureScreen() 返回空");
            return result;
        }

        result.screenshotPath = runDir + "/screenshot.png";
        result.screenshotSize = { width: img.getWidth(), height: img.getHeight() };
        images.save(img, result.screenshotPath);
        logLine(logs, "截图已保存: " + result.screenshotPath);

        if (config.ocr.enabled) {
            result.fullScreenOcr = runOcr(img, null);
            writeJson(runDir + "/ocr_fullscreen.json", result.fullScreenOcr);

            for (var i = 0; i < config.rois.length; i++) {
                var roi = config.rois[i];
                var region = normalizeRegion(roi.region, img.getWidth(), img.getHeight());
                var roiItem = {
                    name: roi.name,
                    description: roi.description,
                    region: region,
                    imagePath: null,
                    ocr: null
                };

                if (config.screenshot.saveRoiImages) {
                    var clip = null;
                    try {
                        clip = images.clip(img, region[0], region[1], region[2], region[3]);
                        roiItem.imagePath = runDir + "/roi_" + roi.name + ".png";
                        images.save(clip, roiItem.imagePath);
                    } catch (clipError) {
                        roiItem.clipError = String(clipError);
                    } finally {
                        if (clip) clip.recycle();
                    }
                }

                roiItem.ocr = runOcr(img, region);
                result.roiResults.push(roiItem);
                writeJson(runDir + "/ocr_roi_" + roi.name + ".json", roiItem);
            }
        }
    } catch (e) {
        result.errors.push(String(e));
    } finally {
        if (img) img.recycle();
    }

    return result;
}

function collectFlatNodes(logs, maxNodes) {
    var collection = null;
    try {
        collection = classNameMatches(/.*/).find();
    } catch (e1) {
        logLine(logs, "classNameMatches(/.*/).find() 不可用: " + e1);
    }

    if (!collection) {
        try {
            collection = textMatches(/.*/).find();
        } catch (e2) {
            logLine(logs, "textMatches(/.*/).find() 不可用: " + e2);
        }
    }

    if (!collection) return [];

    var out = [];
    var total = nodeCollectionLength(collection);
    var count = Math.min(total, maxNodes);
    for (var i = 0; i < count; i++) {
        var node = nodeCollectionGet(collection, i);
        if (!node) continue;
        var bounds = rectToObject(nodeBounds(node));
        out.push({
            path: "flat." + i,
            text: stringMethod(node, "text"),
            desc: stringMethod(node, "desc"),
            id: nodeString(node, "id"),
            className: nodeString(node, "className"),
            packageName: nodeString(node, "packageName"),
            bounds: bounds,
            center: bounds ? { x: Math.round((bounds.left + bounds.right) / 2), y: Math.round((bounds.top + bounds.bottom) / 2) } : null,
            clickable: boolMethod(node, "clickable"),
            scrollable: boolMethod(node, "scrollable"),
            enabled: boolMethod(node, "enabled"),
            visibleToUser: boolMethod(node, "visibleToUser"),
            childCount: getChildCount(node)
        });
    }
    return out;
}

function nodeCollectionLength(collection) {
    try {
        if (typeof collection.size === "function") return collection.size();
        if (typeof collection.length === "number") return collection.length;
    } catch (e) {
    }
    return 0;
}

function nodeCollectionGet(collection, index) {
    try {
        if (typeof collection.get === "function") return collection.get(index);
        return collection[index];
    } catch (e) {
    }
    return null;
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

function buildSummary(environment, tree, screen, logs) {
    var lines = [];
    lines.push("微信视频号 V1 双探测摘要");
    lines.push("");
    lines.push("时间: " + environment.timestamp);
    lines.push("当前包名: " + environment.currentPackage);
    lines.push("当前 Activity: " + environment.currentActivity);
    lines.push("屏幕: " + environment.device.width + " x " + environment.device.height);
    lines.push("微信版本: " + environment.wechat.versionName);
    if (environment.startupWait) {
        lines.push("样本有效: " + environment.startupWait.ok);
        lines.push("等待模式: " + (environment.startupWait.mode || "disabled"));
        lines.push("等待前包名: " + environment.startupWait.packageBeforeWait);
        lines.push("等待后包名: " + environment.startupWait.packageAfterWait);
        lines.push("包名匹配微信: " + environment.startupWait.packageMatched);
        lines.push("等待耗时: " + environment.startupWait.waitedMs + "ms");
        if (environment.startupWait.warning) {
            lines.push("等待警告: " + environment.startupWait.warning);
        }
        if (environment.startupWait.error) {
            lines.push("等待错误: " + environment.startupWait.error);
        }
    }
    lines.push("");
    lines.push("无障碍树:");
    lines.push("- 根节点可用: " + tree.rootAvailable);
    lines.push("- 根节点来源: " + (tree.rootSource || "无"));
    lines.push("- 节点总数: " + tree.nodeCount);
    lines.push("- 平铺节点: " + tree.flatNodeCount);
    lines.push("- 可见节点: " + tree.visibleNodeCount);
    lines.push("- 可点击节点: " + tree.clickableNodeCount);
    lines.push("- 可滚动节点: " + tree.scrollableNodeCount);
    lines.push("- 有文本/描述节点: " + tree.textNodeCount);
    lines.push("- 是否截断: " + tree.truncated);
    lines.push("");
    lines.push("截图/OCR:");
    lines.push("- 截图: " + (screen.screenshotPath || "无"));
    lines.push("- 全屏 OCR 数量: " + ocrCountText(screen.fullScreenOcr));
    if (screen.fullScreenOcr && screen.fullScreenOcr.mode) {
        lines.push("- 全屏 OCR 模式: " + screen.fullScreenOcr.mode);
    }
    if (screen.fullScreenOcr && screen.fullScreenOcr.error) {
        lines.push("- 全屏 OCR 错误: " + screen.fullScreenOcr.error);
    }
    for (var errorIndex = 0; errorIndex < screen.errors.length; errorIndex++) {
        lines.push("- 截图/OCR 错误: " + screen.errors[errorIndex]);
    }
    for (var i = 0; i < screen.roiResults.length; i++) {
        var roi = screen.roiResults[i];
        lines.push("- ROI " + roi.name + ": " + ocrCountText(roi.ocr) + " 条");
        if (roi.ocr && roi.ocr.mode) {
            lines.push("  模式: " + roi.ocr.mode);
        }
        if (roi.ocr && roi.ocr.error) {
            lines.push("  错误: " + roi.ocr.error);
        }
    }
    lines.push("");
    lines.push("日志:");
    for (var j = 0; j < logs.length; j++) lines.push("- " + logs[j]);
    return lines.join("\n");
}

function makeRunDir(date) {
    var dir = config.outputDir + "/" + formatDate(date);
    ensureDir(dir);
    return dir;
}

function ensureDir(dir) {
    files.ensureDir(dir + "/.keep");
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

function getChildCount(node) {
    try {
        if (typeof node.childCount === "function") return node.childCount();
        if (typeof node.childCount === "number") return node.childCount;
        if (typeof node.getChildCount === "function") return node.getChildCount();
    } catch (e) {
    }
    return 0;
}

function getChild(node, index) {
    try {
        if (typeof node.child === "function") return node.child(index);
        if (typeof node.getChild === "function") return node.getChild(index);
    } catch (e) {
    }
    return null;
}

function callMethod(node, name) {
    try {
        if (node && typeof node[name] === "function") return node[name]();
    } catch (e) {
    }
    return null;
}

function stringMethod(node, name) {
    var value = nodeString(node, name);
    return value === null || value === undefined ? "" : String(value);
}

function boolMethod(node, name) {
    return !!nodeBoolean(node, name);
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

function nodeString(node, name) {
    var methodMap = {
        text: ["text", "getText"],
        desc: ["desc", "getContentDescription"],
        id: ["id", "getViewIdResourceName"],
        className: ["className", "getClassName"],
        packageName: ["packageName", "getPackageName"]
    };
    var methods = methodMap[name] || [name];
    for (var i = 0; i < methods.length; i++) {
        var value = callMethod(node, methods[i]);
        if (value !== null && value !== undefined) return String(value);
    }
    return "";
}

function nodeBoolean(node, name) {
    var methodMap = {
        clickable: ["clickable", "isClickable"],
        longClickable: ["longClickable", "isLongClickable"],
        scrollable: ["scrollable", "isScrollable"],
        enabled: ["enabled", "isEnabled"],
        visibleToUser: ["visibleToUser", "isVisibleToUser"],
        selected: ["selected", "isSelected"],
        checkable: ["checkable", "isCheckable"],
        checked: ["checked", "isChecked"],
        focusable: ["focusable", "isFocusable"],
        focused: ["focused", "isFocused"]
    };
    var methods = methodMap[name] || [name];
    for (var i = 0; i < methods.length; i++) {
        var value = callMethod(node, methods[i]);
        if (value !== null && value !== undefined) return !!value;
    }
    return false;
}

function nodeBounds(node) {
    var bounds = callMethod(node, "bounds") || callMethod(node, "boundsInScreen");
    if (bounds) return bounds;
    try {
        if (node && typeof node.getBoundsInScreen === "function") {
            var rect = new android.graphics.Rect();
            node.getBoundsInScreen(rect);
            return rect;
        }
    } catch (e) {
    }
    return null;
}

function nodeDepth(node, fallback) {
    var depthValue = callMethod(node, "depth");
    return depthValue === null || depthValue === undefined ? fallback : depthValue;
}

function itemDepthFromPath(path) {
    return path === "0" ? 0 : path.split(".").length - 1;
}

function ocrCountText(result) {
    if (!result) return "未执行";
    if (result.count !== undefined && result.count !== null) return result.count;
    if (result.error) return "失败";
    return "未知";
}
