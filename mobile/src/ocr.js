var config = require("./config.js");
var text = require("./text_utils.js");
var seriesParser = require("./series_parser.js");

function ocrScreen(img, region, purpose) {
    var baseOptions = {
        useSlim: config.ocr.useSlim,
        cpuThreadNum: config.ocr.cpuThreadNum,
        useOpenCL: config.ocr.useOpenCL
    };
    if (config.ocr.detLongSize > 0) baseOptions.detLongSize = config.ocr.detLongSize;
    if (config.ocr.scoreThreshold !== null && config.ocr.scoreThreshold !== undefined) baseOptions.scoreThreshold = config.ocr.scoreThreshold;
    if (config.ocr.mergeLine) baseOptions.mergeLine = true;
    if (region) baseOptions.region = region;

    var modes = config.ocr.fallbackModes.slice();
    if (modes.indexOf(config.ocr.mode) < 0) modes.unshift(config.ocr.mode);
    var attempts = [];
    var errors = [];

    for (var i = 0; i < modes.length; i++) {
        var mode = modes[i];
        if (mode === "generic" && hasAvailableAttempt(attempts)) continue;

        var attempt = tryOcr(img, baseOptions, mode);
        if (attempt.ok) {
            var items = normalizeItems(attempt.raw, mode);
            var result = {
                mode: mode,
                count: items.length,
                items: items,
                score: scoreOcrItems(items, mode, img, purpose),
                errors: errors.slice()
            };
            if (!config.ocr.multiEngine) return result;
            attempts.push(result);
        } else {
            errors.push(mode + ": " + attempt.error);
        }
    }

    var best = pickBestOcrAttempt(attempts);
    if (best) {
        best.selection = "multi_engine_score";
        best.attempts = attempts;
        best.errors = errors;
        return best;
    }
    return { mode: "none", count: 0, items: [], score: -9999, errors: errors, attempts: attempts };
}

function hasAvailableAttempt(attempts) {
    for (var i = 0; i < attempts.length; i++) {
        if (attempts[i] && attempts[i].count > 0) return true;
    }
    return false;
}

function pickBestOcrAttempt(attempts) {
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
        if (!attempts[i] || attempts[i].count <= 0) continue;
        if (!best || attempts[i].score > best.score) best = attempts[i];
    }
    return best;
}

function scoreOcrItems(items, mode, img, purpose) {
    if (!items || items.length === 0) return -1000;

    var textLength = 0;
    var chineseCount = 0;
    var confSum = 0;
    var confCount = 0;
    var duplicateCount = 0;
    var seen = {};

    for (var i = 0; i < items.length; i++) {
        var label = text.clean(items[i].label || "");
        if (!label) continue;
        textLength += label.length;
        chineseCount += text.countChineseChars(label);
        if (seen[label]) duplicateCount++;
        seen[label] = true;

        var conf = normalizeConfidence(items[i].confidence);
        if (conf !== null) {
            confSum += conf;
            confCount++;
        }
    }

    var avgConfidence = confCount ? confSum / confCount : 0.5;
    var score = 0;
    score += items.length * 4;
    score += Math.min(textLength, 260) * 0.6;
    score += Math.min(chineseCount, 180) * 1.1;
    score += avgConfidence * 60;
    score -= duplicateCount * 8;
    score += ocrModeWeight(mode);

    if (purpose === "series") {
        score += scoreSeriesOcrItems(items, img ? img.getHeight() : 0);
    }

    return score;
}

function scoreSeriesOcrItems(items, screenHeight) {
    var names = seriesParser.extractCompleteCardTitles(items, screenHeight || device.height);
    var textLen = 0;
    for (var i = 0; i < names.length; i++) textLen += names[i].length;
    return names.length * 160 + Math.min(textLen, 160) * 2;
}

function ocrModeWeight(mode) {
    if (mode === "paddle") return 4;
    if (mode === "mlkit") return 2;
    if (mode === "rapid") return -5;
    if (mode === "generic") return -3;
    return 0;
}

function normalizeConfidence(confidence) {
    if (confidence === undefined || confidence === null || confidence === "") return null;
    var value = Number(confidence);
    if (isNaN(value)) return null;
    if (value > 1) value = value / 100;
    if (value < 0) return null;
    return Math.max(0, Math.min(1, value));
}

function logOcrChoice(label, result, candidateCount) {
    if (!config.ocr.debug || !result) return;
    var parts = [];
    if (result.attempts && result.attempts.length) {
        for (var i = 0; i < result.attempts.length; i++) {
            var attempt = result.attempts[i];
            parts.push(attempt.mode + ":" + attempt.count + "/" + Math.round(attempt.score));
        }
    }
    var suffix = parts.length ? " attempts=[" + parts.join(" ") + "]" : "";
    console.log("    OCR " + label + ": mode=" + result.mode +
        " items=" + result.count +
        " score=" + Math.round(result.score || 0) +
        " candidates=" + candidateCount + suffix);
}

function tryOcr(img, baseOptions, mode) {
    if (typeof ocr === "undefined") return { ok: false, error: "ocr 不可用" };
    var opts = {};
    for (var k in baseOptions) {
        if (baseOptions.hasOwnProperty(k)) opts[k] = baseOptions[k];
    }
    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) return { ok: true, raw: ocr.paddle.detect(img, opts) };
            if (ocr.detect) {
                opts.mode = "paddle";
                return { ok: true, raw: ocr.detect(img, opts) };
            }
            return { ok: false, error: "paddle 不可用" };
        }
        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) return { ok: true, raw: ocr.mlkit.detect(img, opts) };
        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) return { ok: true, raw: ocr.rapid.detect(img, opts) };
        if (mode !== "generic") opts.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, opts) };
        return { ok: false, error: "无可用 OCR" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function normalizeItems(results, mode) {
    var out = [];
    if (!results) return out;
    var count = ocrLen(results);
    for (var i = 0; i < count; i++) {
        var item = getItem(results, i);
        if (!item) continue;
        out.push({ label: item.label || item.text || "", confidence: item.confidence, bounds: rectObj(item.bounds), mode: mode });
    }
    return out;
}

function getItem(results, idx) {
    try {
        if (typeof results.get === "function") return results.get(idx);
        return results[idx];
    } catch (e) {}
    return null;
}

function ocrLen(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try {
        if (typeof results.size === "function") return results.size();
    } catch (e) {}
    return 0;
}

function rectObj(rect) {
    if (!rect) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: Number(rect.left || 0), top: Number(rect.top || 0), right: Number(rect.right || 0), bottom: Number(rect.bottom || 0) };
}

module.exports = {
    ocrScreen: ocrScreen,
    logOcrChoice: logOcrChoice
};
