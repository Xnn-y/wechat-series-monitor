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

        var inlineTitle = extractInlineTitleBeforeEpisode(label, false);
        if (inlineTitle) {
            episodeItems.push({
                text: label,
                title: inlineTitle,
                shortInlineTitle: "",
                x: centerX(b),
                y: b.top || 0,
                bounds: b,
                inline: true
            });
        } else if (hasEpisodeCountLabel(label)) {
            var shortInlineTitle = extractInlineTitleBeforeEpisode(label, true);
            episodeItems.push({
                text: label,
                title: "",
                shortInlineTitle: shortInlineTitle,
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
        var title = episode.title || titleAboveEpisode(items, episode, tabBottom, episode.shortInlineTitle);
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

function titleAboveEpisode(items, episode, tabBottom, shortInlineTitle) {
    var titleParts = [];
    var minY = Math.max(tabBottom, episode.y - 180);
    var maxY = episode.y + 4;
    var columnCenter = episode.x;
    var columnHalfWidth = Math.max(130, device.width * 0.24);

    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var label = text.clean(items[i].label || "");
        if (!label) continue;
        if (hasEpisodeCountLabel(label)) continue;
        if (text.isTabText(label)) continue;

        var top = b.top || 0;
        if (top < minY || top > maxY) continue;
        if (Math.abs(centerX(b) - columnCenter) > columnHalfWidth) continue;
        if (!isTitlePartCandidate(label, b, episode)) continue;

        titleParts.push({
            text: label,
            y: top,
            bottom: Number(b.bottom || top),
            x: b.left || 0
        });
    }

    titleParts = nearestTitleRows(titleParts, episode);
    titleParts.sort(function(a, b) {
        if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
        return a.x - b.x;
    });
    var title = titleParts.map(function(item) { return item.text; }).join("");
    if (shortInlineTitle && title.indexOf(shortInlineTitle) < 0) {
        title += shortInlineTitle;
    }
    return title;
}

function nearestTitleRows(titleParts, episode) {
    if (!titleParts.length) return titleParts;

    var rows = [];
    var sorted = titleParts.slice().sort(function(a, b) {
        if (Math.abs(a.y - b.y) > 24) return a.y - b.y;
        return a.x - b.x;
    });

    for (var i = 0; i < sorted.length; i++) {
        var item = sorted[i];
        var last = rows.length ? rows[rows.length - 1] : null;
        if (!last || Math.abs(item.y - last.y) > 24) {
            rows.push({
                y: item.y,
                bottom: item.bottom,
                height: Math.max(1, item.bottom - item.y),
                items: [item]
            });
        } else {
            last.bottom = Math.max(last.bottom, item.bottom);
            last.height = Math.max(last.height, Math.max(1, item.bottom - item.y));
            last.items.push(item);
        }
    }

    var bestIndex = -1;
    var bestGap = 99999;
    for (var r = 0; r < rows.length; r++) {
        var gap = episode.y - rows[r].bottom;
        if (gap >= -8 && gap <= 125 && gap < bestGap) {
            bestGap = gap;
            bestIndex = r;
        }
    }
    if (bestIndex < 0) return titleParts;

    var selected = [rows[bestIndex]];
    var anchorHeight = Math.max(1, rows[bestIndex].height || (rows[bestIndex].bottom - rows[bestIndex].y));
    for (var p = bestIndex - 1; p >= 0; p--) {
        var distanceToSelected = selected[0].y - rows[p].bottom;
        var distanceToEpisode = episode.y - rows[p].bottom;
        var rowHeight = Math.max(1, rows[p].height || (rows[p].bottom - rows[p].y));
        if (distanceToSelected > 58 || distanceToEpisode > 150) break;
        if (rowHeight < anchorHeight * 0.68) break;
        selected.unshift(rows[p]);
    }

    var result = [];
    for (var s = 0; s < selected.length; s++) {
        selected[s].items.sort(function(a, b) { return a.x - b.x; });
        for (var j = 0; j < selected[s].items.length; j++) {
            result.push(selected[s].items[j]);
        }
    }
    return result;
}

function extractInlineTitleBeforeEpisode(label, allowShort) {
    var cleanLabel = text.clean(label).replace(/\s+/g, "");
    var match = cleanLabel.match(/^(.+?)(\d{1,3})集$/);
    if (!match) return "";

    var title = match[1];
    if (/^\d+$/.test(title)) return "";
    var chineseCount = text.countChineseChars(text.stripPunct(title));
    if (chineseCount < 2) {
        return allowShort && chineseCount === 1 ? title : "";
    }
    return title;
}

function hasEpisodeCountLabel(label) {
    label = text.clean(label).replace(/\s+/g, "");
    return /^\d{1,3}集$/.test(label) || /^.+?\d{1,3}集$/.test(label);
}

function isTitlePartCandidate(label, bounds, episode) {
    var cleanLabel = text.toSimplified(text.clean(label)).replace(/\s+/g, "");
    var compact = text.stripPunct(cleanLabel).replace(/[\-—–_~·•《》「」『』【】]/g, "");
    var chineseCount = text.countChineseChars(compact);
    if (chineseCount >= 2) return true;
    if (chineseCount !== 1) return false;
    if (/^(集|第|共|全|更|赞|评|分|私|信)$/.test(compact)) return false;
    if (/^[\-—–_~·•.。:：，,、]+$/.test(cleanLabel)) return false;
    var bottom = Number(bounds.bottom || bounds.top || 0);
    var gap = episode.y - bottom;
    return gap >= -8 && gap <= 95;
}

function cleanSeriesTitle(title) {
    title = text.applyKnownOcrCorrections(title);
    title = extractDecoratedTitle(title);
    title = text.toSimplified(text.clean(title))
        .replace(/\s+/g, "")
        .replace(/^\d+/, "")
        .replace(/[《》「」『』【】]/g, "")
        .replace(/^[\-—–_~·•.。:：，,、]+/, "")
        .replace(/[\-—–_~·•.。；;：:，,、]+$/g, "");
    title = text.sanitizeSeriesTitleSymbols(title);
    if (text.hasTraditionalChinese(title)) return "";
    return title;
}

function isSeriesTitleCandidate(title) {
    title = text.toSimplified(text.clean(title));
    if (text.hasTraditionalChinese(title)) return false;
    var compact = text.stripPunct(title);
    compact = compact.replace(/[\-—–_~·•《》「」『』【】]/g, "");
    if (!compact || compact.length < 2 || compact.length > 40) return false;
    if (text.countChineseChars(compact) < 2) return false;
    if (/^[\-—–_~·•]+$/.test(title)) return false;
    if (/^\d+$/.test(compact)) return false;
    if (/^\d+集$/.test(compact)) return false;
    if (/^(主页|视频|剧集|全部|私信|已关注|原创内容)$/.test(compact)) return false;
    if (/^(赞|评论|转发|搜索|更多|返回)$/.test(compact)) return false;
    return true;
}

function extractDecoratedTitle(title) {
    title = text.clean(title);
    var match = title.match(/《([^》]{2,40})》/);
    if (match) return match[1];
    match = title.match(/「([^」]{2,40})」/);
    if (match) return match[1];
    match = title.match(/『([^』]{2,40})』/);
    if (match) return match[1];
    return title;
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
