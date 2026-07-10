var text = require("./text_utils.js");

function extractAccounts(ocrResult, screenHeight) {
    var items = ocrResult.items || [];
    if (items.length === 0) return [];

    items.sort(function(a, b) { return (a.bounds.top || 0) - (b.bounds.top || 0); });

    var rows = [];
    var curRow = null;
    for (var i = 0; i < items.length; i++) {
        var label = text.clean(items[i].label);
        if (!label) continue;
        var b = items[i].bounds;
        var y = b.top || 0;

        if (!curRow || y - curRow.top > 30) {
            if (curRow && isAccountRow(curRow, screenHeight)) rows.push(normalizeAccountRow(curRow));
            curRow = { label: label, top: y, bottom: b.bottom || (y + 50), bounds: [b] };
        } else {
            curRow.label += label;
            curRow.bottom = Math.max(curRow.bottom, b.bottom || (y + 50));
            curRow.bounds.push(b);
        }
    }
    if (curRow && isAccountRow(curRow, screenHeight)) rows.push(normalizeAccountRow(curRow));

    for (i = 0; i < rows.length; i++) {
        rows[i].centerY = Math.round((rows[i].top + rows[i].bottom) / 2);
        var l = 9999, r = 0;
        for (var j = 0; j < rows[i].bounds.length; j++) {
            var b2 = rows[i].bounds[j];
            if (b2.left < l) l = b2.left;
            if (b2.right > r) r = b2.right;
        }
        rows[i].textCenterX = Math.round((l + r) / 2);
    }
    return rows;
}

function extractFollowTotal(ocrResult) {
    var items = (ocrResult && ocrResult.items) || [];
    for (var i = 0; i < items.length; i++) {
        var label = text.clean(items[i].label || "").replace(/\s+/g, "");
        var match = label.match(/我的关注[（(]?(\d+)[）)]?/);
        if (match) return Number(match[1]);
    }
    return 0;
}

function extractProfileAccountName(ocrResult, screenHeight, fallbackName) {
    var items = (ocrResult && ocrResult.items) || [];
    var best = null;

    for (var i = 0; i < items.length; i++) {
        var label = cleanAccountLabel(items[i].label || "");
        if (!isProfileNameCandidate(label)) continue;

        var b = items[i].bounds || {};
        var x = (Number(b.left || 0) + Number(b.right || 0)) / 2;
        var y = (Number(b.top || 0) + Number(b.bottom || 0)) / 2;
        if (y < screenHeight * 0.10 || y > screenHeight * 0.30) continue;
        if (x < device.width * 0.18 || x > device.width * 0.92) continue;

        var height = Math.max(1, Number(b.bottom || 0) - Number(b.top || 0));
        var score = height * 6 - label.length * 4 - y * 0.05;
        if (!best || score > best.score) {
            best = { label: label, score: score };
        }
    }

    if (best && best.label) return best.label;
    return cleanAccountLabel(fallbackName || "");
}

function isAccountRow(row, screenHeight) {
    var label = cleanAccountLabel(row.label);
    if (!label) return false;
    if (/我的关注/.test(label)) return false;
    if (/^(推荐|朋友|赞|评论|转发|可能含有AI生成内容)$/.test(label)) return false;
    if (row.top > screenHeight * 0.92) return false;
    if (label.length < 2) return false;
    if (text.countChineseChars(label) < 2) {
        return isLikelyTopSelfAccount(row, label, screenHeight);
    }
    return true;
}

function isLikelyTopSelfAccount(row, label, screenHeight) {
    if (row.top > screenHeight * 0.25) return false;
    return /^[A-Za-z0-9_.-]{2,24}$/.test(label);
}

function normalizeAccountRow(row) {
    row.label = cleanAccountLabel(row.label);
    return row;
}

function cleanAccountLabel(label) {
    label = text.clean(label)
        .replace(/^[^\u4e00-\u9fffA-Za-z0-9]+/, "")
        .replace(/[<《?？]+$/g, "");

    if (text.countChineseChars(label) >= 2) {
        label = label
            .replace(/[;；:：,，.。]+[A-Za-z0-9]+$/g, "")
            .replace(/[A-Za-z0-9]{1,3}$/g, "");
    }
    return text.clean(label);
}

function isProfileNameCandidate(label) {
    label = text.clean(label);
    if (!label) return false;
    if (label.length < 2 || label.length > 10) return false;
    if (text.countChineseChars(label) < 2) return false;
    if (/[，,。；;：:！!？?、]/.test(label)) return false;
    if (/^(主页|视频|剧集|已关注|私信|关注|搜索|更多|返回|原创内容)$/.test(label)) return false;
    if (/有限公司|文化传媒|广东|广州|福建|福州|惠州|市|区|省|分享|简介|好看|每天|更新|欢迎|觉得|关注/.test(label)) return false;
    if (/^\d+条/.test(label)) return false;
    return true;
}

module.exports = {
    extractAccounts: extractAccounts,
    extractFollowTotal: extractFollowTotal,
    extractProfileAccountName: extractProfileAccountName,
    cleanAccountLabel: cleanAccountLabel
};
