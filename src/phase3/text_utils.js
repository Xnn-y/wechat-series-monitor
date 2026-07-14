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
        [0x5287,0x5267],[0x5834,0x573A],[0x865F,0x53F7],[0x8996,0x89C6],[0x983B,0x9891],[0x7E6A,0x7ED8],
        [0x767C,0x53D1],[0x9032,0x8FDB],[0x9019,0x8FD9],[0x8CEC,0x8D26],[0x9801,0x9875],[0x9EDE,0x70B9],
        [0x64CA,0x51FB],[0x6EFF,0x6EE1],[0x5F8C,0x540E],[0x9EBC,0x4E48],[0x8207,0x4E0E],[0x8A3B,0x6CE8],
        [0x7D71,0x7EDF],[0x8077,0x804C],[0x8B49,0x8BC1],[0x70BA,0x4E3A],[0x5F9E,0x4ECE],[0x60E1,0x6076],
        [0x60F1,0x607C],[0x60F2,0x60B2],[0x611B,0x7231],[0x820A,0x65E7],[0x89AA,0x4EB2],[0x91AB,0x533B],
        [0x807D,0x542C],[0x8B80,0x8BFB],[0x8B8A,0x53D8],[0x958B,0x5F00],[0x95DC,0x5173],[0x95C6,0x677F],
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

function hasTraditionalChinese(s) {
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
        if (TRAD_TO_SIMP[s.charAt(i)]) return true;
    }
    return false;
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
    var sa = normalizeRecordKey(a);
    var sb = normalizeRecordKey(b);
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
    return normalizeOcrConfusions(toSimplified(stripPunct(applyKnownOcrCorrections(clean(s)))).toLowerCase());
}

var KNOWN_ACCOUNT_NAMES = [
    "鬼谷剧场",
    "虾仁无下限",
    "西柚虾",
    "江十三动画",
    "米糕短剧",
    "微码剧场",
    "漫绘短剧社",
    "微时光短剧场",
    "欢乐时光短剧场",
    "美好时光短剧场",
    "快乐时光短剧场",
    "漫剧放映屋剧场",
    "漫剧星隅剧场",
    "漫剧拾光剧场",
    "玲和美",
    "阿文爱看剧",
    "萌萌虎剧场",
    "玖爱看漫剧",
    "超爽漫剧",
    "甜文禁",
    "柒柒书漫",
    "天使不会哭呀",
    "金森文化"
];

function applyKnownOcrCorrections(s) {
    s = String(s || "");
    return s
        .replace(/玲利姜/g, "玲和美")
        .replace(/玲利美/g, "玲和美")
        .replace(/玖愛看漫剧/g, "玖爱看漫剧")
        .replace(/玫爱看漫剧/g, "玖爱看漫剧")
        .replace(/玫愛者漫剧/g, "玖爱看漫剧")
        .replace(/起爽浸剧/g, "超爽漫剧")
        .replace(/起爽漫剧/g, "超爽漫剧")
        .replace(/超爽浸剧/g, "超爽漫剧")
        .replace(/超爽漫剧妙/g, "超爽漫剧")
        .replace(/起爽/g, "超爽")
        .replace(/西袖虾/g, "西柚虾")
        .replace(/阿女爱看剧/g, "阿文爱看剧")
        .replace(/甜女禁/g, "甜文禁")
        .replace(/師欢乐时光短场/g, "欢乐时光短剧场")
        .replace(/欢乐时光短场/g, "欢乐时光短剧场")
        .replace(/欢乐时光短剧场/g, "欢乐时光短剧场")
        .replace(/抬光/g, "拾光")
        .replace(/捨光/g, "拾光")
        .replace(/舍光/g, "拾光")
        .replace(/抬儿/g, "拾光")
        .replace(/忆念/g, "")
        .replace(/菱亭/g, "")
        .replace(/麦亭/g, "")
        .replace(/楚$/g, "")
        .replace(/(拾光){2,}/g, "拾光");
}

function canonicalizeKnownAccountName(s) {
    var corrected = clean(applyKnownOcrCorrections(s));
    var key = normalizeRecordKey(corrected);
    if (!key) return corrected;

    var bestName = "";
    var bestScore = 0;
    for (var i = 0; i < KNOWN_ACCOUNT_NAMES.length; i++) {
        var known = KNOWN_ACCOUNT_NAMES[i];
        var knownKey = normalizeRecordKey(known);
        var score = accountNameMatchScore(key, knownKey);
        if (score > bestScore) {
            bestScore = score;
            bestName = known;
        }
    }

    if (bestScore >= 0.78) return bestName;
    return corrected;
}

function isKnownAccountName(s) {
    var key = normalizeRecordKey(s);
    if (!key) return false;
    for (var i = 0; i < KNOWN_ACCOUNT_NAMES.length; i++) {
        if (normalizeRecordKey(KNOWN_ACCOUNT_NAMES[i]) === key) return true;
    }
    return false;
}

function accountNameMatchScore(key, knownKey) {
    if (!key || !knownKey) return 0;
    if (key === knownKey) return 1;
    if (key.indexOf(knownKey) >= 0) {
        return knownKey.length >= 4 ? 0.95 : 0.82;
    }
    if (knownKey.indexOf(key) >= 0 && key.length >= 3) {
        return key.length / knownKey.length;
    }

    var overlap = plainOverlapRatio(key, knownKey);
    var edit = editSimilarity(key, knownKey);
    return overlap * 0.45 + edit * 0.55;
}

function plainOverlapRatio(a, b) {
    var shorter = a.length <= b.length ? a : b;
    var longer = a.length <= b.length ? b : a;
    if (!shorter) return 0;
    var count = 0;
    for (var i = 0; i < shorter.length; i++) {
        if (longer.indexOf(shorter.charAt(i)) >= 0) count++;
    }
    return count / shorter.length;
}

function editSimilarity(a, b) {
    var distance = levenshteinDistance(a, b);
    var maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - distance / maxLen;
}

function levenshteinDistance(a, b) {
    var prev = [];
    var curr = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (j = 1; j <= b.length; j++) {
            var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + cost
            );
        }
        var tmp = prev;
        prev = curr;
        curr = tmp;
    }
    return prev[b.length];
}

function normalizeOcrConfusions(s) {
    return String(s || "")
        .replace(/孑/g, "子")
        .replace(/妳/g, "你")
        .replace(/[丨|]/g, "1")
        .replace(/[〇○]/g, "0");
}

function similarityRatio(a, b) {
    var ak = normalizeRecordKey(a);
    var bk = normalizeRecordKey(b);
    if (!ak || !bk) return 0;
    if (ak === bk) return 1;
    var overlap = charOverlapRatio(ak, bk);
    var lenRatio = Math.min(ak.length, bk.length) / Math.max(ak.length, bk.length);
    return overlap * 0.75 + lenRatio * 0.25;
}

function isLikelySameText(a, b, threshold) {
    threshold = threshold === undefined ? 0.86 : threshold;
    var ak = normalizeRecordKey(a);
    var bk = normalizeRecordKey(b);
    if (!ak || !bk) return false;
    if (ak === bk) return true;
    if (ak.length >= 4 && bk.length >= 4) {
        if (ak.indexOf(bk) >= 0 || bk.indexOf(ak) >= 0) return true;
    }
    return similarityRatio(ak, bk) >= threshold;
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
    hasTraditionalChinese: hasTraditionalChinese,
    countChineseChars: countChineseChars,
    hasChinese: hasChinese,
    charOverlapRatio: charOverlapRatio,
    normalizeRecordKey: normalizeRecordKey,
    applyKnownOcrCorrections: applyKnownOcrCorrections,
    canonicalizeKnownAccountName: canonicalizeKnownAccountName,
    isKnownAccountName: isKnownAccountName,
    normalizeOcrConfusions: normalizeOcrConfusions,
    similarityRatio: similarityRatio,
    isLikelySameText: isLikelySameText,
    isTabText: isTabText
};
