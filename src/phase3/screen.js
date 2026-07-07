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
    var img = safeCapture();
    if (img) return img;

    console.log("  首帧失败，重新申请权限...");
    try { images.stopScreenCapture(); } catch (e) {}
    sleep(500);
    if (!requestScreenCapture()) {
        console.log("[错误] 截图权限失败");
        exit();
    }
    sleep(1500);
    img = safeCapture();
    if (!img) {
        console.log("[错误] 截图仍然失败，请重启 AutoJs6");
        exit();
    }
    return img;
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

function scrollDownSmall() {
    var w = device.width;
    var h = device.height;
    var distance = Math.round(h * config.accountSmallScrollRatio);
    var startY = Math.round(h * 0.72);
    swipe(w / 2, startY, w / 2, Math.max(Math.round(h * 0.30), startY - distance), 450);
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
    retryCapture: retryCapture,
    scrollDown: scrollDown,
    scrollDownSmall: scrollDownSmall,
    goBack: goBack,
    toPixelRegion: toPixelRegion
};
