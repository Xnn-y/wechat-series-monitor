function clean(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
}

function stripPunct(s) {
    return String(s || "").replace(/[,，。.、；;：:！!？?""''（）()【】\[\]\s]/g, "");
}

var TRAD_TO_SIMP = (function() {
    var pairs = [
        [0x7D05,0x7EA2],[0x9580,0x95E8],[0x898B,0x89C1],[0x99AC,0x9A6C],[0x98A8,0x98CE],[0x8ECA,0x8F66],
        [0x6771,0x4E1C],[0x9577,0x957F],[0x958B,0x5F00],[0x95DC,0x5173],[0x66F8,0x4E66],[0x6642,0x65F6],
        [0x6703,0x4F1A],[0x4F86,0x6765],[0x5C0D,0x5BF9],[0x52D5,0x52A8],[0x842C,0x4E07],[0x904E,0x8FC7],
        [0x500B,0x4E2A],[0x5011,0x4EEC],[0x8AAA,0x8BF4],[0x5B78,0x5B66],[0x5BE6,0x5B9E],[0x9AD4,0x4F53],
        [0x9F8D,0x9F99],[0x9CF3,0x51E4],[0x5922,0x68A6],[0x611B,0x7231],[0x570B,0x56FD],[0x8ECD,0x519B],
        [0x6A02,0x4E50],[0x6C23,0x6C14],[0x96FB,0x7535],[0x982D,0x5934],[0x8072,0x58F0],[0x8655,0x5904],
        [0x98DB,0x98DE],[0x9B5A,0x9C7C],[0x9CE5,0x9E1F],[0x7570,0x5F02],[0x8449,0x53F6],[0x7FA9,0x4E49],
        [0x8C50,0x4E30],[0x96F2,0x4E91],[0x967D,0x9633],[0x9670,0x9634],[0x9060,0x8FDC],[0x9023,0x8FDE],
        [0x6975,0x6781],[0x6BBA,0x6740],[0x7121,0x65E0],[0x9054,0x8FBE],[0x723E,0x5C14],[0x8F15,0x8F7B],
        [0x969B,0x9645],[0x96A8,0x968F],[0x96D6,0x867D],[0x9748,0x7075],[0x975C,0x9759],[0x96D9,0x53CC],
        [0x96E3,0x96BE],[0x96E2,0x79BB],[0x97FF,0x54CD],[0x986F,0x663E],[0x9A5A,0x60CA]
    ];
    var map = {};
    for (var i = 0; i < pairs.length; i++) {
        map[String.fromCharCode(pairs[i][0])] = String.fromCharCode(pairs[i][1]);
    }
    return map;
})();

function toSimplified(s) {
    if (typeof s !== "string") return String(s || "");
    var result = "";
    for (var i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        result += TRAD_TO_SIMP[ch] || ch;
    }
    return result;
}

function countChineseChars(s) {
    s = String(s || "");
    var count = 0;
    for (var i = 0; i < s.length; i++) {
        var code = s.charCodeAt(i);
        if ((code >= 0x4E00 && code <= 0x9FFF) ||
            (code >= 0x3400 && code <= 0x4DBF) ||
            (code >= 0xF900 && code <= 0xFAFF)) {
            count++;
        }
    }
    return count;
}

function hasChinese(s) {
    var total = String(s || "").length;
    if (total < 2) return false;
    var chCount = countChineseChars(s);
    return chCount >= 3 && (chCount / total) >= 0.70;
}

function charOverlapRatio(a, b) {
    var sa = toSimplified(stripPunct(a));
    var sb = toSimplified(stripPunct(b));
    if (sa.length === 0 || sb.length === 0) return 0;
    var shorter = sa.length <= sb.length ? sa : sb;
    var longer = sa.length <= sb.length ? sb : sa;
    var matchCount = 0;
    for (var i = 0; i < shorter.length; i++) {
        if (longer.indexOf(shorter.charAt(i)) >= 0) matchCount++;
    }
    return matchCount / shorter.length;
}

function normalizeRecordKey(s) {
    return toSimplified(stripPunct(clean(s))).toLowerCase();
}

function isTabText(label) {
    if (label === "主页" || label === "视频" || label === "剧集") return true;
    var parts = String(label || "").split(/\s+/);
    var tabCount = 0;
    for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "主页" || parts[i] === "视频" || parts[i] === "剧集") tabCount++;
    }
    return tabCount >= 2;
}

module.exports = {
    clean: clean,
    stripPunct: stripPunct,
    toSimplified: toSimplified,
    countChineseChars: countChineseChars,
    hasChinese: hasChinese,
    charOverlapRatio: charOverlapRatio,
    normalizeRecordKey: normalizeRecordKey,
    isTabText: isTabText
};
