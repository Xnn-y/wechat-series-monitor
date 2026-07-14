var config = require("./config.js");

function initCapture() {
    try { images.stopScreenCapture(); } catch (e) {}
    sleep(500);
    if (!requestScreenCapture()) {
        console.log("[错误] 请求截图权限失败");
        exit();
    }
    sleep(1500);
    console.log("  截图权限就绪");
}

function safeCapture() {
    try { return captureScreen(); } catch (e) { return null; }
}

function ensureCapture() {
    var tries = config.captureRetryTries || 8;
    var interval = config.captureRetryInterval || 650;
    var img = retryCapture(tries, interval);
    if (img) return img;

    if (config.captureRecoverEnabled) {
        img = recoverCaptureSession(tries, interval);
        if (img) return img;
    }

    if (!img) {
        console.log("[错误] 截图连续失败，请手动检查投屏/截图权限后重跑脚本");
        return null;
    }
    return img;
}

function recoverCaptureSession(tries, interval) {
    var maxRecover = config.captureRecoverMaxTries || 1;
    var recoverDelay = config.captureRecoverDelay || 1800;

    for (var i = 0; i < maxRecover; i++) {
        console.log("  截图连续失败，尝试自动重建截图会话 " + (i + 1) + "/" + maxRecover);
        try { images.stopScreenCapture(); } catch (e) {}
        sleep(500);
        if (!requestScreenCapture()) {
            console.log("  自动重建截图会话失败");
            continue;
        }
        sleep(recoverDelay);
        var img = retryCapture(tries, interval);
        if (img) {
            console.log("  截图会话已恢复");
            return img;
        }
    }
    return null;
}

function retryCapture(maxTries, intervalMs) {
    for (var i = 0; i < maxTries; i++) {
        var img = safeCapture();
        if (img) return img;
        if (i < maxTries - 1) sleep(intervalMs);
    }
    return null;
}

function scrollDown() {
    var w = device.width;
    var h = device.height;
    swipe(w / 2, Math.round(h * 0.82), w / 2, Math.round(h * 0.28), 700);
}

function scrollDownSeriesMore() {
    var w = device.width;
    var h = device.height;
    swipe(w / 2, Math.round(h * 0.86), w / 2, Math.round(h * 0.20), 850);
}

function scrollDownSmall() {
    var w = device.width;
    var h = device.height;
    var distance = Math.round(h * config.accountSmallScrollRatio);
    var startY = Math.round(h * 0.72);
    swipe(w / 2, startY, w / 2, Math.max(Math.round(h * 0.30), startY - distance), 450);
}

function scrollDownRevealNextAccount() {
    var w = device.width;
    var h = device.height;
    var distance = Math.round(h * (config.accountRevealNextScrollRatio || 0.22));
    var startY = Math.round(h * 0.76);
    swipe(w / 2, startY, w / 2, Math.max(Math.round(h * 0.28), startY - distance), 560);
}

function scrollToTopOnce() {
    var w = device.width;
    var h = device.height;
    swipe(w / 2, Math.round(h * 0.28), w / 2, Math.round(h * 0.82), 650);
}

function goBack() {
    back();
}

function toPixelRegion(roi, w, h) {
    var x = normVal(roi[0], w), y = normVal(roi[1], h);
    var rw = normVal(roi[2], w), rh = normVal(roi[3], h);
    if (rw <= 0) rw = w - x;
    if (rh <= 0) rh = h - y;
    x = Math.round(Math.max(0, Math.min(x, w - 1)));
    y = Math.round(Math.max(0, Math.min(y, h - 1)));
    rw = Math.round(Math.max(1, Math.min(rw, w - x)));
    rh = Math.round(Math.max(1, Math.min(rh, h - y)));
    return [x, y, rw, rh];
}

function normVal(v, total) {
    return (v > -1 && v < 1) ? v * total : v;
}

module.exports = {
    initCapture: initCapture,
    safeCapture: safeCapture,
    ensureCapture: ensureCapture,
    recoverCaptureSession: recoverCaptureSession,
    retryCapture: retryCapture,
    scrollDown: scrollDown,
    scrollDownSeriesMore: scrollDownSeriesMore,
    scrollDownSmall: scrollDownSmall,
    scrollDownRevealNextAccount: scrollDownRevealNextAccount,
    scrollToTopOnce: scrollToTopOnce,
    goBack: goBack,
    toPixelRegion: toPixelRegion
};
