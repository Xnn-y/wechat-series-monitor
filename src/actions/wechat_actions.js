/**
 * Reusable WeChat navigation actions.
 *
 * The files in src/actions/click_*.js are still useful as standalone
 * one-step test scripts. This module is for flow scripts that need to call
 * those actions as functions.
 */

var ocrClickModule = require("../shared/ocr_click.js");

module.exports = {
    clickDiscover: clickDiscover,
    clickChannels: clickChannels,
    clickProfileIcon: clickProfileIcon,
    clickFollowing: clickFollowing,
    goBack: goBackAction,
    verifyText: verifyText,
    runSequence: runSequence
};

var DEFAULTS = {
    dryRun: false,
    clickDelay: 1000,
    verifyDelay: 800,
    debugDir: null,
    ocrMode: "paddle",
    ocrFallbackModes: ["paddle", "mlkit", "rapid", "generic"]
};

var ACTIONS = {
    discover: {
        target: "发现",
        roi: [0, 0.85, 1, 0.15],
        fallback: [0.625, 0.945],
        clickDelay: 800
    },
    channels: {
        target: "视频号",
        roi: [0, 0.12, 1, 0.22],
        fallback: [0.20, 0.215],
        clickDelay: 1000
    },
    following: {
        target: "关注",
        roi: [0, 0.05, 1, 0.55],
        fallback: [0.50, 0.245],
        clickDelay: 1000
    },
    profileIcon: {
        fallback: [0.936, 0.056],
        clickDelay: 1000
    },
    back: {
        fallback: [0.06, 0.056],
        clickDelay: 1000
    }
};

function clickDiscover(opts) {
    return clickTextAction("discover", opts);
}

function clickChannels(opts) {
    return clickTextAction("channels", opts);
}

function clickFollowing(opts) {
    return clickTextAction("following", opts);
}

function clickTextAction(name, opts) {
    opts = mergeOpts(ACTIONS[name], opts || {});
    var result = ocrClickModule.ocrClick({
        target: opts.target,
        roi: opts.roi,
        fallback: opts.fallback,
        matchMode: opts.matchMode || "contains",
        clickDelay: opts.clickDelay,
        dryRun: opts.dryRun,
        debugDir: opts.debugDir,
        ocrMode: opts.ocrMode,
        ocrFallbackModes: opts.ocrFallbackModes
    });
    result.action = name;
    return result;
}

function clickProfileIcon(opts) {
    opts = mergeOpts(ACTIONS.profileIcon, opts || {});
    var point = {
        x: Math.round(device.width * opts.fallback[0]),
        y: Math.round(device.height * opts.fallback[1])
    };
    var result = {
        ok: true,
        action: "profileIcon",
        source: "fixed_ratio",
        clickPoint: point,
        skippedReason: "",
        executed: !opts.dryRun
    };
    if (!opts.dryRun) {
        click(point.x, point.y);
        sleep(opts.clickDelay);
    }
    return result;
}

function goBackAction(opts) {
    opts = mergeOpts(ACTIONS.back, opts || {});
    if (opts.dryRun) {
        return { ok: true, action: "back", method: "dry_run", executed: false };
    }
    try {
        back();
        sleep(opts.clickDelay);
        return { ok: true, action: "back", method: "system_back", executed: true };
    } catch (e) {
        try {
            var point = {
                x: Math.round(device.width * opts.fallback[0]),
                y: Math.round(device.height * opts.fallback[1])
            };
            click(point.x, point.y);
            sleep(opts.clickDelay);
            return { ok: true, action: "back", method: "fallback_click", clickPoint: point, executed: true };
        } catch (e2) {
            return { ok: false, action: "back", method: "none", error: String(e2), executed: false };
        }
    }
}

function verifyText(opts) {
    opts = mergeOpts({}, opts || {});
    var result = ocrClickModule.ocrFindPoint({
        target: opts.target,
        roi: opts.roi || null,
        fallback: null,
        matchMode: opts.matchMode || "contains",
        dryRun: true,
        debugDir: opts.debugDir,
        ocrMode: opts.ocrMode,
        ocrFallbackModes: opts.ocrFallbackModes
    });
    result.action = "verifyText";
    result.verifyTarget = opts.target;
    return result;
}

function runSequence(steps, baseOpts) {
    baseOpts = mergeOpts({}, baseOpts || {});
    var results = [];
    var allOk = true;

    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        var actionOpts = mergeOpts(baseOpts, step.opts || {});
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
            sleep(baseOpts.verifyDelay);
            var verifyOpts = mergeOpts(baseOpts, step.verify);
            if (baseOpts.debugDir) verifyOpts.debugDir = baseOpts.debugDir + "/" + pad2(i + 1) + "_" + step.name + "_verify";
            ensureDebugDir(verifyOpts.debugDir);
            var verifyResult = verifyText(verifyOpts);
            result.verify = compactVerifyResult(verifyResult);
            if (step.requireVerify && !verifyResult.ok) {
                allOk = false;
                result.stopReason = "verify failed: " + step.verify.target;
                break;
            }
        }
    }

    return {
        allOk: allOk,
        results: results
    };
}

function compactVerifyResult(result) {
    return {
        ok: result.ok,
        target: result.verifyTarget,
        source: result.source,
        clickPoint: result.clickPoint,
        skippedReason: result.skippedReason,
        matchText: result.matchItem ? result.matchItem.label : ""
    };
}

function mergeOpts(base, override) {
    var out = {};
    copyInto(out, DEFAULTS);
    copyInto(out, base || {});
    copyInto(out, override || {});
    return out;
}

function copyInto(target, source) {
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
