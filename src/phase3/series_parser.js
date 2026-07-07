var text = require("./text_utils.js");

function readSeriesNames(img, ocr) {
    var ocrResult = ocr.ocrScreen(img, null, "series");
    var names = extractCompleteCardTitles(ocrResult.items || [], img.getHeight());
    ocr.logOcrChoice("剧集页", ocrResult, names.length);
    return names;
}

function extractCompleteCardTitles(items, screenHeight) {
    var tabBottom = findSeriesContentTop(items, screenHeight);
    var episodeItems = [];

    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var label = text.clean(items[i].label || "");
        if (!label || (b.top || 0) <= tabBottom) continue;

        var inlineTitle = extractInlineTitleBeforeEpisode(label);
        if (inlineTitle) {
            episodeItems.push({
                text: label,
                title: inlineTitle,
                x: centerX(b),
                y: b.top || 0,
                bounds: b,
                inline: true
            });
        } else if (/^\d+\s*集$/.test(label)) {
            episodeItems.push({
                text: label,
                title: "",
                x: centerX(b),
                y: b.top || 0,
                bounds: b,
                inline: false
            });
        }
    }

    episodeItems.sort(function(a, b) { return a.y - b.y; });

    var names = [];
    var seen = {};
    for (var e = 0; e < episodeItems.length; e++) {
        var episode = episodeItems[e];
        var title = episode.title || titleAboveEpisode(items, episode, tabBottom);
        title = cleanSeriesTitle(title);
        if (!title || !isSeriesTitleCandidate(title)) continue;

        var key = text.toSimplified(text.stripPunct(title));
        if (seen[key]) continue;
        seen[key] = true;
        names.push(title);
    }
    return names;
}

function findSeriesContentTop(items, screenHeight) {
    var tabBottom = 0;
    for (var i = 0; i < items.length; i++) {
        var label = text.clean(items[i].label || "");
        if (label === "主页" || label === "视频" || label === "剧集") {
            var b = items[i].bounds || {};
            tabBottom = Math.max(tabBottom, b.bottom || 0);
        }
    }
    if (tabBottom === 0) tabBottom = Math.round(screenHeight * 0.35);
    return tabBottom + 40;
}

function titleAboveEpisode(items, episode, tabBottom) {
    var titleParts = [];
    var minY = Math.max(tabBottom, episode.y - 180);
    var maxY = episode.y + 4;
    var columnCenter = episode.x;
    var columnHalfWidth = Math.max(130, device.width * 0.24);

    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var label = text.clean(items[i].label || "");
        if (!label) continue;
        if (/^\d+\s*集$/.test(label)) continue;
        if (text.isTabText(label)) continue;

        var top = b.top || 0;
        if (top < minY || top > maxY) continue;
        if (Math.abs(centerX(b) - columnCenter) > columnHalfWidth) continue;
        if (text.countChineseChars(text.stripPunct(label)) < 2) continue;

        titleParts.push({ text: label, y: top, x: b.left || 0 });
    }

    titleParts.sort(function(a, b) {
        if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
        return a.x - b.x;
    });
    return titleParts.map(function(item) { return item.text; }).join("");
}

function extractInlineTitleBeforeEpisode(label) {
    var cleanLabel = text.clean(label).replace(/\s+/g, "");
    var match = cleanLabel.match(/^(.+?)(\d{1,3})集$/);
    if (!match) return "";

    var title = match[1];
    if (/^\d+$/.test(title)) return "";
    if (text.countChineseChars(text.stripPunct(title)) < 2) return "";
    return title;
}

function cleanSeriesTitle(title) {
    return text.clean(title)
        .replace(/\s+/g, "")
        .replace(/^\d+/, "")
        .replace(/[，,。；;：:、]+$/g, "");
}

function isSeriesTitleCandidate(title) {
    var compact = text.stripPunct(title);
    if (!compact || compact.length < 2 || compact.length > 40) return false;
    if (text.countChineseChars(compact) < 2) return false;
    if (/^\d+$/.test(compact)) return false;
    if (/^\d+集$/.test(compact)) return false;
    if (/^(主页|视频|剧集|全部|私信|已关注|原创内容)$/.test(compact)) return false;
    if (/^(赞|评论|转发|搜索|更多|返回)$/.test(compact)) return false;
    return true;
}

function mergeAndDedup(existing, newNames) {
    for (var i = 0; i < newNames.length; i++) {
        if (!nameExists(existing, newNames[i])) existing.push(newNames[i]);
    }
    return dedupSubstrings(existing);
}

function nameExists(list, name) {
    var cleanName = text.toSimplified(text.stripPunct(name));
    for (var i = 0; i < list.length; i++) {
        var cleanItem = text.toSimplified(text.stripPunct(list[i]));
        if (cleanItem === cleanName) return true;
        if (cleanItem.indexOf(cleanName) >= 0 || cleanName.indexOf(cleanItem) >= 0) return true;
        if (text.charOverlapRatio(list[i], name) >= 0.6) return true;
    }
    if (isFragmentMerge(cleanName, list)) return true;
    for (var j = 0; j < list.length; j++) {
        if (text.charOverlapRatio(name, list[j]) >= 0.7) return true;
    }
    return false;
}

function isFragmentMerge(name, existing) {
    if (existing.length < 2) return false;
    var nameLen = name.length;
    var prefixLen = 0;
    for (var p = nameLen; p >= 2; p--) {
        var prefix = name.substring(0, p);
        for (var i = 0; i < existing.length; i++) {
            if (text.toSimplified(text.stripPunct(existing[i])).indexOf(prefix) >= 0) {
                prefixLen = p;
                break;
            }
        }
        if (prefixLen > 0) break;
    }
    var suffixLen = 0;
    for (var s = nameLen; s >= 2; s--) {
        var suffix = name.substring(nameLen - s);
        for (var j = 0; j < existing.length; j++) {
            if (text.toSimplified(text.stripPunct(existing[j])).indexOf(suffix) >= 0) {
                suffixLen = s;
                break;
            }
        }
        if (suffixLen > 0) break;
    }
    return prefixLen + suffixLen >= nameLen * 0.6;
}

function dedupSubstrings(list) {
    var result = [];
    for (var i = 0; i < list.length; i++) {
        var keep = true;
        var cleanI = text.toSimplified(text.stripPunct(list[i]));
        for (var j = 0; j < list.length; j++) {
            if (i === j) continue;
            var cleanJ = text.toSimplified(text.stripPunct(list[j]));
            if (cleanJ.indexOf(cleanI) >= 0 && cleanJ.length > cleanI.length) {
                keep = false;
                break;
            }
        }
        if (keep) result.push(list[i]);
    }
    return result;
}

function centerX(bounds) {
    return (Number(bounds.left || 0) + Number(bounds.right || 0)) / 2;
}

module.exports = {
    readSeriesNames: readSeriesNames,
    extractCompleteCardTitles: extractCompleteCardTitles,
    mergeAndDedup: mergeAndDedup
};
