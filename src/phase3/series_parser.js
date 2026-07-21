var text = require("./text_utils.js");
var config = require("./config.js");
var volcOcr = require("./volc_ocr.js");
var aiRecognizer = require("./ai_recognizer.js");
var backendRecognizer = require("./backend_recognizer.js");
var aiDisabledForRun = false;
var backendAiDisabledForRun = false;

function readSeriesPage(img, ocr, ctx) {
    if (shouldUseBackendAiSeries()) {
        if (backendAiDisabledForRun) {
            throw new Error("BACKEND_AI_SERIES_DISABLED_FOR_RUN");
        }
        try {
            var backendResult = backendRecognizer.recognizeSeriesScreen(ctx || {}, img);
            return {
                names: backendResult.titles || [],
                shouldContinue: backendResult.should_continue !== false,
                reason: backendResult.reason || "",
                usage: backendResult.usage || {}
            };
        } catch (e) {
            warn("Backend AI series failed: " + e);
            if (!(config.backendRecognition && config.backendRecognition.fallbackLocalAi)) {
                backendAiDisabledForRun = true;
                throw new Error("BACKEND_AI_SERIES_STOP:" + e);
            }
        }
    }

    return {
        names: readSeriesNames(img, ocr),
        shouldContinue: true,
        reason: "local_recognition"
    };
}

function readSeriesNames(img, ocr) {
    if (shouldUseAiSeries()) {
        if (aiDisabledForRun) {
            throw new Error("AI_SERIES_DISABLED_FOR_RUN");
        }
        try {
            var aiResult = aiRecognizer.detectSeriesPage(img);
            var aiNames = extractAiSeriesTitles(aiResult);
            if (config.aiRecognition.debug) {
                log("AI series: cards=" + ((aiResult.seriesCards || []).length) + " candidates=" + aiNames.length);
            }
            return aiNames;
        } catch (e) {
            warn("AI series failed: " + e);
            if (!config.aiRecognition.fallbackLocalOcr) {
                aiDisabledForRun = true;
                throw new Error("AI_SERIES_STOP:" + e);
            }
        }
    }

    if (shouldUseVolcOcr()) {
        try {
            var volcResult = volcOcr.recognizeImage(img);
            volcResult.count = (volcResult.items || []).length;
            var volcNames = extractCompleteCardTitles(volcResult.items || [], img.getHeight());
            if (config.volcOcr.debug) {
                log("Volc OCR series: items=" + volcResult.count + " candidates=" + volcNames.length);
            }
            return volcNames;
        } catch (e) {
            warn("Volc OCR series failed: " + e);
            if (!config.volcOcr.fallbackLocalOcr) return [];
        }
    }

    var ocrResult = ocr.ocrScreen(img, null, "series");
    var names = extractCompleteCardTitles(ocrResult.items || [], img.getHeight());
    ocr.logOcrChoice("剧集页", ocrResult, names.length);
    return names;
}

function shouldUseAiSeries() {
    return !!(config.aiRecognition && config.aiRecognition.enabled && String(config.recognition && config.recognition.mode || "").toLowerCase() === "ai");
}

function shouldUseBackendAiSeries() {
    var mode = String(config.recognition && config.recognition.mode || "").toLowerCase();
    return !!(config.backendRecognition && config.backendRecognition.enabled && mode === "backend_ai");
}

function shouldUseVolcOcr() {
    return !!(config.volcOcr && config.volcOcr.enabled && volcOcr.isEnabled());
}

function prefersFreshImage() {
    return shouldUseBackendAiSeries() || shouldUseAiSeries() || shouldUseVolcOcr();
}

function maxSeriesScreens() {
    if (shouldUseBackendAiSeries()) {
        return Math.max(1, Math.min(
            Number(config.maxSeriesScrolls || 1),
            Number((config.aiRecognition && config.aiRecognition.maxScreensPerAccount) || config.maxSeriesScrolls || 1)
        ));
    }
    if (shouldUseAiSeries()) {
        return Math.max(1, Math.min(
            Number(config.maxSeriesScrolls || 1),
            Number((config.aiRecognition && config.aiRecognition.maxScreensPerAccount) || 1)
        ));
    }
    return Number(config.maxSeriesScrolls || 1);
}

function extractAiSeriesTitles(aiResult) {
    var cards = (aiResult && aiResult.seriesCards) || [];
    var names = [];
    var seen = {};
    var minConfidence = Number((config.aiRecognition && config.aiRecognition.minConfidence) || 0);
    for (var i = 0; i < cards.length; i++) {
        var card = cards[i] || {};
        if (card.isCompleteCard === false) continue;
        if (Number(card.confidence || 0) < minConfidence) continue;
        var title = cleanSeriesTitle(card.title || "");
        if (!title || !isSeriesTitleCandidate(title)) continue;
        var key = text.toSimplified(text.stripPunct(title));
        if (seen[key]) continue;
        seen[key] = true;
        names.push(title);
    }
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
    return tabBottom + 20;
}

function titleAboveEpisode(items, episode, tabBottom, shortInlineTitle) {
    var candidates = [];
    var epX = episode.x;
    var epY = episode.y;
    var epLeft = Number((episode.bounds || {}).left || epX);

    for (var i = 0; i < items.length; i++) {
        var b = items[i].bounds || {};
        var label = text.clean(items[i].label || "");
        if (!label) continue;
        if (hasEpisodeCountLabel(label)) continue;
        if (text.isTabText(label)) continue;

        var top = b.top || 0;
        var bottom = Number(b.bottom || top);
        if (top <= tabBottom && epY > tabBottom + 80) continue;
        if (top > epY) continue;
        var distanceToEpisode = epY - bottom;
        if (distanceToEpisode < 0 || distanceToEpisode > 95) continue;
        if (!isTitlePartCandidate(label, b, episode)) continue;
        if (!isSameCardColumn(b, epX, epLeft)) continue;

        candidates.push({
            text: label,
            top: top,
            bottom: bottom,
            left: Number(b.left || 0),
            right: Number(b.right || b.left || 0),
            x: centerX(b)
        });
    }

    if (!candidates.length) return shortInlineTitle || "";
    candidates.sort(function(a, b) { return b.bottom - a.bottom; });

    var block = [candidates[0]];
    var anchor = candidates[0];
    for (var c = 1; c < candidates.length; c++) {
        var candidate = candidates[c];
        var verticalGap = anchor.top - candidate.bottom;
        if (verticalGap < 0 || verticalGap > 18) continue;
        if (!belongsToTitleBlock(candidate, anchor)) continue;
        block.push(candidate);
        anchor = candidate;
        if (block.length >= 2) break;
    }

    if (isTopEdgeResidue(block, episode)) return "";
    block.sort(function(a, b) {
        if (Math.abs(a.top - b.top) > 24) return a.top - b.top;
        return a.left - b.left;
    });
    var title = block.map(function(item) { return item.text; }).join("");
    if (shortInlineTitle && title.indexOf(shortInlineTitle) < 0) {
        title += shortInlineTitle;
    }
    return title;
}

function isSameCardColumn(bounds, epX, epLeft) {
    var left = Number(bounds.left || 0);
    var right = Number(bounds.right || left);
    var titleX = centerX(bounds);
    if (Math.abs(left - epLeft) <= 45) return true;
    if (left <= epX && epX <= right && Math.abs(titleX - epX) <= 220) return true;
    return false;
}

function belongsToTitleBlock(candidate, anchor) {
    var leftGap = Math.abs(candidate.left - anchor.left);
    var xGap = Math.abs(candidate.x - anchor.x);
    if (leftGap <= 45) return true;
    if (text.stripPunct(anchor.text || "").length <= 2 && candidate.left <= anchor.left && anchor.left <= candidate.right) {
        return true;
    }
    return xGap <= 120;
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
        if (gap >= -8 && gap <= 95 && gap < bestGap) {
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
        if (distanceToSelected > 18 || distanceToEpisode > 95) break;
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
    if (isTopEdgeResidue(result, episode)) return [];
    return result;
}

function isTopEdgeResidue(parts, episode) {
    if (!parts || parts.length !== 1) return false;
    var item = parts[0];
    var compact = text.stripPunct(text.toSimplified(text.clean(item.text || "")));
    var top = Number(item.top || item.y || 0);
    return Number(episode.y || 0) < 600 && top >= 360 && compact.length <= 5;
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
    readSeriesPage: readSeriesPage,
    readSeriesNames: readSeriesNames,
    prefersFreshImage: prefersFreshImage,
    maxSeriesScreens: maxSeriesScreens,
    extractCompleteCardTitles: extractCompleteCardTitles,
    mergeAndDedup: mergeAndDedup
};
