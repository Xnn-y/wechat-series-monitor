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
        if (isAccountProfile(vOcr)) return { success: true, img: verifyImg, ocrResult: vOcr };
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

function clickSeriesTab(initialImg, ocrRunner, options) {
    options = options || {};
    var forceClickTab = shouldForceClickSeriesTab(options.accountLabel);
    sleep(config.pageDelay);

    var attempts = Math.max(1, config.seriesTabFindTries || 3);
    for (var attempt = 0; attempt < attempts; attempt++) {
        var img = screen.retryCapture(attempt === 0 ? 5 : 2, 500);
        if (!img && attempt === 0) img = initialImg || null;
        if (!img) warn("剧集Tab截图失败");
        if (!img) continue;

        var ownsImage = img !== initialImg;
        var w = img.getWidth();
        var h = img.getHeight();
        var ocrResult = ocrRunner.ocrScreen(img, null, "tab");

        if (looksLikeSeriesPage(ocrResult, w, h) && !forceClickTab) {
            log("当前已在剧集页，跳过Tab点击，直接读取");
            if (ownsImage) img.recycle();
            return {
                success: true,
                alreadySeriesPage: true,
                firstPageOcr: ocrResult,
                firstPageHeight: h
            };
        } else if (looksLikeSeriesPage(ocrResult, w, h) && forceClickTab) {
            log("强制点击剧集Tab，忽略已在剧集页判断：" + options.accountLabel);
        }

        var best = null;
        for (var i = 0; i < (ocrResult.items || []).length; i++) {
            var label = text.clean(ocrResult.items[i].label || "");
            var bounds = ocrResult.items[i].bounds || {};
            if (isSeriesTabCandidate(label, bounds, w, h, ocrResult.items || [])) {
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

        if (!best) best = fallbackSeriesTabPoint(ocrResult.items || [], w, h);

        if (best) {
            log("点击剧集Tab：" + best.label + " @ " + best.x + "," + best.y);
            click(best.x, best.y);
            sleep(config.pageDelay);
            if (ownsImage) img.recycle();
            return { success: true, clickedTab: true };
        }

        if (ownsImage) img.recycle();
        if (attempt < attempts - 1) sleep(500);
    }

    return { success: false };
}

function shouldForceClickSeriesTab(accountLabel) {
    if (config.forceClickSeriesTab === true) return true;
    var normalized = text.canonicalizeKnownAccountName(accountLabel || "");
    return normalized === "天使不会哭呀";
}

function isSeriesTabCandidate(label, bounds, w, h, items) {
    var cleanLabel = text.clean(label).replace(/\s+/g, "");
    if (cleanLabel.indexOf("剧集") < 0) return false;
    if (!isTabBounds(bounds, w, h)) return false;
    if (/剧集[（(]?\d+/.test(cleanLabel)) return false;
    if (/^剧集/.test(cleanLabel) && hasSameRowText(items, bounds, "全部")) return false;
    if (cleanLabel === "剧集") return true;
    if (cleanLabel.indexOf("主页") >= 0 || cleanLabel.indexOf("视频") >= 0) return true;
    return hasSameRowText(items, bounds, "主页") || hasSameRowText(items, bounds, "视频");
}

function hasSameRowText(items, bounds, expected) {
    var top = Number(bounds.top || 0);
    var bottom = Number(bounds.bottom || top);
    var centerY = (top + bottom) / 2;
    for (var i = 0; i < (items || []).length; i++) {
        var item = items[i] || {};
        var b = item.bounds || {};
        if (b === bounds) continue;
        var label = text.clean(item.label || "").replace(/\s+/g, "");
        if (label.indexOf(expected) < 0) continue;
        var itemTop = Number(b.top || 0);
        var itemBottom = Number(b.bottom || itemTop);
        var itemCenterY = (itemTop + itemBottom) / 2;
        if (Math.abs(itemCenterY - centerY) <= 36) return true;
    }
    return false;
}

function fallbackSeriesTabPoint(items, w, h) {
    var home = findExactTab(items, "主页", w, h);
    var video = findExactTab(items, "视频", w, h);
    if (home && video && Math.abs(home.y - video.y) <= 40) {
        var step = video.x - home.x;
        if (step > w * 0.06 && step < w * 0.22) {
            return {
                label: "推算剧集Tab",
                score: 60,
                x: Math.round(video.x + step),
                y: Math.round((home.y + video.y) / 2)
            };
        }
    }
    return null;
}

function findExactTab(items, expected, w, h) {
    for (var i = 0; i < (items || []).length; i++) {
        var label = text.clean(items[i].label || "").replace(/\s+/g, "");
        var b = items[i].bounds || {};
        if (label === expected && isTabBounds(b, w, h)) {
            return {
                x: Math.round(centerX(b)),
                y: Math.round((Number(b.top || 0) + Number(b.bottom || 0)) / 2)
            };
        }
    }
    return null;
}

function centerX(bounds) {
    return (Number(bounds.left || 0) + Number(bounds.right || 0)) / 2;
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

function looksLikeSeriesPage(ocrResult, w, h) {
    var episodeCount = 0;
    var hasSeriesHeader = false;
    var hasHomeVideoTabs = false;
    var hasHomeTab = false;
    var hasVideoTab = false;
    var hasLatestVideoSection = false;
    var lowerCardTextCount = 0;
    for (var i = 0; i < ((ocrResult && ocrResult.items) || []).length; i++) {
        var item = ocrResult.items[i];
        var label = text.clean(item.label || "").replace(/\s+/g, "");
        var b = item.bounds || {};
        var x = (Number(b.left || 0) + Number(b.right || 0)) / 2;
        var y = (Number(b.top || 0) + Number(b.bottom || 0)) / 2;
        if (y > h * 0.25 && y < h * 0.50) {
            if (label === "主页") hasHomeTab = true;
            if (label === "视频") hasVideoTab = true;
        }
        if (label === "最新视频" || label === "作品") {
            hasLatestVideoSection = true;
        }
        if (label.indexOf("剧集") >= 0 && y > h * 0.25 && y < h * 0.70) {
            hasSeriesHeader = true;
        }
        if (/^\d{1,3}集$/.test(label) && y > h * 0.35) episodeCount++;
        if (/^.+\d{1,3}集$/.test(label) && y > h * 0.35) episodeCount++;
        if (y > h * 0.38 && text.countChineseChars(text.stripPunct(label)) >= 4) {
            lowerCardTextCount++;
        }
    }
    hasHomeVideoTabs = hasHomeTab && hasVideoTab;
    if (hasHomeVideoTabs || hasHomeTab || hasVideoTab || hasLatestVideoSection) return false;
    return hasSeriesHeader && (
        episodeCount > 0 ||
        lowerCardTextCount >= 2
    );
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
