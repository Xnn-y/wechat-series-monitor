var config = require("./config.js");
var screen = require("./screen.js");
var text = require("./text_utils.js");

function clickAccount(account, ocrRunner) {
    var w = device.width;
    var points = [
        { x: Math.round(w * 0.50), y: account.centerY, label: "center" },
        { x: Math.round(w * 0.45), y: account.centerY, label: "mid_left" },
        { x: Math.round(w * 0.55), y: account.centerY, label: "mid_right" },
        { x: account.textCenterX, y: account.centerY, label: "text_center" }
    ];

    for (var pi = 0; pi < points.length; pi++) {
        var pt = points[pi];
        click(pt.x, pt.y);
        sleep(config.pageDelay + 800);

        var verifyImg = screen.retryCapture(2, 500);
        if (!verifyImg) continue;

        var vOcr = ocrRunner.ocrScreen(verifyImg, null);
        if (isAccountProfile(vOcr)) return { success: true, img: verifyImg };
        verifyImg.recycle();
    }

    return { success: false };
}

function isAccountProfile(ocrResult) {
    var labels = [];
    for (var i = 0; i < ((ocrResult && ocrResult.items) || []).length; i++) {
        labels.push(text.clean(ocrResult.items[i].label || ""));
    }
    var joined = labels.join(" ");
    if (joined.indexOf("我的关注") >= 0) return false;
    if (joined.indexOf("主页") >= 0 && (joined.indexOf("视频") >= 0 || joined.indexOf("剧集") >= 0)) return true;
    if (joined.indexOf("剧集") >= 0 && joined.indexOf("已关注") >= 0) return true;
    if (joined.indexOf("已关注") >= 0 && (joined.indexOf("私信") >= 0 || joined.indexOf("客服") >= 0)) return true;
    return false;
}

function clickSeriesTab(initialImg, ocrRunner) {
    sleep(config.pageDelay);

    var img = screen.retryCapture(5, 500);
    if (!img) {
        warn("剧集Tab截图失败，使用进入账号后的截图兜底");
        img = initialImg || null;
        if (!img) return false;
    }
    var ownsImage = img !== initialImg;

    var w = img.getWidth();
    var h = img.getHeight();
    var ocrResult = ocrRunner.ocrScreen(img, null, "tab");

    var best = null;
    for (var i = 0; i < (ocrResult.items || []).length; i++) {
        var label = text.clean(ocrResult.items[i].label || "");
        var bounds = ocrResult.items[i].bounds || {};
        if (label.indexOf("剧集") >= 0 && isTabBounds(bounds, w, h)) {
            var score = tabScore(label);
            if (!best || score > best.score) {
                var point = tabClickPoint(label, bounds);
                best = {
                    label: label,
                    score: score,
                    x: point.x,
                    y: point.y
                };
            }
        }
    }

    if (best) {
        log("点击剧集Tab：" + best.label + " @ " + best.x + "," + best.y);
        click(best.x, best.y);
        sleep(config.pageDelay);
        if (ownsImage) img.recycle();
        return true;
    }

    if (looksLikeSeriesPage(ocrResult, h)) {
        log("未定位到剧集Tab，但当前页面已有剧集卡片，直接读取");
        if (ownsImage) img.recycle();
        return true;
    }

    if (ownsImage) img.recycle();
    return false;
}

function tabScore(label) {
    if (label === "剧集") return 120;
    if (/^(主页|视频|剧集)$/.test(label)) return 100;
    if (label.indexOf("剧集") >= 0 && label.length <= 8) return 80;
    return 50;
}

function tabClickPoint(label, bounds) {
    var left = Number(bounds.left || 0);
    var right = Number(bounds.right || 0);
    var top = Number(bounds.top || 0);
    var bottom = Number(bounds.bottom || 0);
    var cleanLabel = text.clean(label).replace(/\s+/g, "");
    var index = cleanLabel.indexOf("剧集");
    var x;

    if (cleanLabel === "剧集" || index < 0 || right <= left) {
        x = (left + right) / 2;
    } else {
        x = left + ((index + 1) / Math.max(cleanLabel.length, 1)) * (right - left);
    }

    return {
        x: Math.round(x),
        y: Math.round((top + bottom) / 2)
    };
}

function looksLikeSeriesPage(ocrResult, h) {
    var episodeCount = 0;
    var hasSeriesHeader = false;
    for (var i = 0; i < ((ocrResult && ocrResult.items) || []).length; i++) {
        var item = ocrResult.items[i];
        var label = text.clean(item.label || "").replace(/\s+/g, "");
        var b = item.bounds || {};
        var y = (Number(b.top || 0) + Number(b.bottom || 0)) / 2;
        if (label.indexOf("剧集") >= 0 && y > h * 0.25 && y < h * 0.70) hasSeriesHeader = true;
        if (/^\d{1,3}集$/.test(label) && y > h * 0.35) episodeCount++;
        if (/^.+\d{1,3}集$/.test(label) && y > h * 0.35) episodeCount++;
    }
    return hasSeriesHeader && episodeCount > 0;
}

function isTabBounds(bounds, w, h) {
    var x = (Number(bounds.left || 0) + Number(bounds.right || 0)) / 2;
    var y = (Number(bounds.top || 0) + Number(bounds.bottom || 0)) / 2;
    if (y < h * 0.25 || y > h * 0.50) return false;
    if (x < w * 0.03 || x > w * 0.70) return false;
    return true;
}

module.exports = {
    clickAccount: clickAccount,
    isAccountProfile: isAccountProfile,
    clickSeriesTab: clickSeriesTab
};
