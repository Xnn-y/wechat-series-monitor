var config = require("./config.js");
var ocrRecognizer = require("./ocr_recognizer.js");
var aiRecognizer = require("./ai_recognizer.js");

function recognitionMode() {
    return ((config.recognition && config.recognition.mode) || "ocr").toLowerCase();
}

function shouldUseAi() {
    var mode = recognitionMode();
    return mode === "ai" || mode === "ai_shadow";
}

function isShadowMode() {
    return recognitionMode() === "ai_shadow";
}

function logDebug(message) {
    if (config.recognition && config.recognition.debug) {
        log("[识别层] " + message);
    }
}

function withOptionalAiShadow(label, img, ocrFn, aiFn) {
    var ocrResult = ocrFn(img);
    if (isShadowMode()) {
        var aiResult = safeAiCall(label, img, aiFn);
        logDebug(label + " shadow AI confidence=" + Math.round(Number(aiResult.confidence || 0) * 100)
            + " warnings=" + ((aiResult.warnings || []).join("|")));
        return {
            engine: "ocr",
            raw: ocrResult.raw || ocrResult,
            aiShadow: aiResult
        };
    }
    return ocrResult;
}

function safeAiCall(label, img, aiFn) {
    if (!shouldUseAi() || !(config.recognition && config.recognition.aiEnabled)) {
        return {
            engine: "ai",
            pageType: "unknown",
            confidence: 0,
            warnings: ["ai_disabled"]
        };
    }
    try {
        return aiFn(img);
    } catch (e) {
        return {
            engine: "ai",
            pageType: "unknown",
            confidence: 0,
            warnings: [label + "_ai_error: " + String(e)]
        };
    }
}

function detectRawText(img, purpose) {
    return ocrRecognizer.detectRawText(img, purpose);
}

function detectFollowingAccounts(img) {
    if (recognitionMode() === "ai") return safeAiCall("following", img, aiRecognizer.detectFollowingAccounts);
    return withOptionalAiShadow("following", img, ocrRecognizer.detectFollowingAccounts, aiRecognizer.detectFollowingAccounts);
}

function detectProfile(img) {
    if (recognitionMode() === "ai") return safeAiCall("profile", img, aiRecognizer.detectProfile);
    return withOptionalAiShadow("profile", img, ocrRecognizer.detectProfile, aiRecognizer.detectProfile);
}

function detectTabs(img) {
    if (recognitionMode() === "ai") return safeAiCall("tabs", img, aiRecognizer.detectTabs);
    return withOptionalAiShadow("tabs", img, ocrRecognizer.detectTabs, aiRecognizer.detectTabs);
}

function detectSeriesPage(img) {
    if (recognitionMode() === "ai") return safeAiCall("series", img, aiRecognizer.detectSeriesPage);
    return withOptionalAiShadow("series", img, ocrRecognizer.detectSeriesPage, aiRecognizer.detectSeriesPage);
}

module.exports = {
    detectRawText: detectRawText,
    detectFollowingAccounts: detectFollowingAccounts,
    detectProfile: detectProfile,
    detectTabs: detectTabs,
    detectSeriesPage: detectSeriesPage
};

