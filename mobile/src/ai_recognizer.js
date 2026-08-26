var config = require("./config.js");

function notConfiguredResult(pageType) {
    return {
        engine: "ai",
        pageType: pageType || "unknown",
        confidence: 0,
        accounts: [],
        tabs: [],
        seriesCards: [],
        warnings: ["ai_recognizer_not_configured"]
    };
}

function detectFollowingAccounts(img) {
    return notConfiguredResult("following");
}

function detectProfile(img) {
    return notConfiguredResult("profile");
}

function detectTabs(img) {
    return notConfiguredResult("profile");
}

function detectSeriesPage(img) {
    var cfg = loadConfig();
    if (!cfg.enabled) return notConfiguredResult("series");
    if (!cfg.apiKey) throw new Error("AI apiKey is not configured");
    if (!cfg.model) throw new Error("AI model is not configured");

    var payload = {
        model: cfg.model,
        input: [{
            role: "user",
            content: [
                { type: "input_text", text: buildSeriesPrompt() },
                { type: "input_image", image_url: imageToDataUrl(img) }
            ]
        }]
    };
    var body = JSON.stringify(payload);
    var responseText = httpPost(
        String(cfg.baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "") + "/responses",
        {
            "Authorization": "Bearer " + cfg.apiKey,
            "Content-Type": "application/json"
        },
        body,
        Number(cfg.timeout || 90000)
    );
    var response = JSON.parse(responseText);
    return normalizeAiResult(parseJsonOutput(extractOutputText(response)));
}

function loadConfig() {
    var base = config.aiRecognition || {};
    var out = {};
    for (var k in base) {
        if (base.hasOwnProperty(k)) out[k] = base[k];
    }
    if (out.configFile) {
        try {
            if (files.exists(out.configFile)) {
                var fileConfig = JSON.parse(files.read(out.configFile));
                for (var fk in fileConfig) {
                    if (fileConfig.hasOwnProperty(fk) && fileConfig[fk] !== undefined && fileConfig[fk] !== "") {
                        out[fk] = fileConfig[fk];
                    }
                }
            }
        } catch (e) {
            throw new Error("Failed to read AI configFile: " + e);
        }
    }
    return out;
}

function buildSeriesPrompt() {
    return [
        "You are recognizing a WeChat video account series page screenshot.",
        "Return JSON only. No markdown. No explanation.",
        "The business output is formal series title only. Episode count is optional and only an anchor.",
        "Detect only usable series cards from the current screenshot.",
        "A card is usable when the formal title area below the cover and the episode count area are visible.",
        "The full cover image does not need to be visible.",
        "Do not read poster slogans, large cover text, promotional copy, UI tabs, buttons, or edge residue as formal titles.",
        "If the formal title is cut by the top/bottom screen edge, mark the card incomplete.",
        "If the title wraps to two lines, merge only adjacent title lines in the same card.",
        "If only cover image is visible and the formal title/episode area is not visible, do not collect it.",
        "Return shape:",
        "{",
        '  "pageType": "series",',
        '  "confidence": 0.0,',
        '  "seriesCards": [',
        '    {"title": "series title", "episodes": 0, "isCompleteCard": true, "confidence": 0.0, "warnings": []}',
        "  ],",
        '  "warnings": []',
        "}"
    ].join("\n");
}

function imageToDataUrl(img) {
    var base64;
    if (images.toBase64) {
        base64 = images.toBase64(img, "jpg", 82);
    } else if (images.toBytes) {
        var bytes = images.toBytes(img, "jpg", 82);
        base64 = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
    } else {
        throw new Error("AutoJs images.toBase64/toBytes is unavailable");
    }
    return "data:image/jpeg;base64," + base64;
}

function httpPost(url, headers, body, timeout) {
    var res = http.request(url, {
        method: "POST",
        headers: headers,
        body: body,
        timeout: timeout
    });
    var statusCode = Number(res.statusCode || res.status || 0);
    var text = res.body ? res.body.string() : "";
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error("AI HTTP " + statusCode + ": " + text);
    }
    return text;
}

function extractOutputText(response) {
    if (typeof response.output_text === "string") return response.output_text;
    var parts = [];
    var output = response.output || [];
    for (var i = 0; i < output.length; i++) {
        var content = output[i].content || [];
        for (var j = 0; j < content.length; j++) {
            if (typeof content[j].text === "string") parts.push(content[j].text);
        }
    }
    if (!parts.length) throw new Error("AI response missing output_text");
    return parts.join("\n");
}

function parseJsonOutput(text) {
    text = String(text || "").trim();
    if (text.indexOf("```") === 0) {
        text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        var start = text.indexOf("{");
        var end = text.lastIndexOf("}");
        if (start < 0 || end <= start) throw e;
        return JSON.parse(text.substring(start, end + 1));
    }
}

function normalizeAiResult(result) {
    result = result || {};
    if (!result.seriesCards || !result.seriesCards.length) {
        result.seriesCards = [];
    }
    result.engine = "ai";
    result.pageType = result.pageType || "series";
    result.confidence = Number(result.confidence || 0);
    result.warnings = result.warnings || [];
    for (var i = 0; i < result.seriesCards.length; i++) {
        var card = result.seriesCards[i] || {};
        card.title = card.title === null || card.title === undefined ? "" : String(card.title);
        card.confidence = Number(card.confidence || result.confidence || 0);
        card.isCompleteCard = card.isCompleteCard !== false;
        card.warnings = card.warnings || [];
        result.seriesCards[i] = card;
    }
    return result;
}

module.exports = {
    detectFollowingAccounts: detectFollowingAccounts,
    detectProfile: detectProfile,
    detectTabs: detectTabs,
    detectSeriesPage: detectSeriesPage
};
