var config = require("./config.js");

function recognizeSeriesScreen(ctx, img) {
    var cfg = config.backendRecognition || {};
    if (!cfg.enabled) {
        throw new Error("backend recognition disabled");
    }
    var serverUrl = (config.backend && config.backend.serverUrl) || "";
    var token = (config.backend && config.backend.collectorToken) || "";
    if (!serverUrl) throw new Error("backend serverUrl is not configured");
    if (!token) throw new Error("backend collectorToken is not configured");

    var encodeStarted = Date.now();
    var imageBase64 = imageToBase64(img);
    var encodeMs = Date.now() - encodeStarted;
    var imageBytes = estimateBase64Bytes(imageBase64);
    var payload = {
        run_id: (ctx && ctx.runId) || "",
        account: (ctx && ctx.account) || "unknown",
        screen_index: Number((ctx && ctx.screenIndex) || 0),
        image_base64: imageBase64,
        image_format: "jpg"
    };
    var url = serverUrl.replace(/\/+$/, "") + "/api/collector/series/recognize";
    var httpStarted = Date.now();
    var responseText = postJson(url, token, payload, Number(cfg.timeout || 120000));
    var httpMs = Date.now() - httpStarted;
    var result = JSON.parse(responseText);
    if (!result.ok) {
        throw new Error("backend recognition failed: " + (result.error || result.reason || responseText));
    }
    if (cfg.debug) {
        var usage = result.usage || {};
        log("[backend AI] titles=" + ((result.titles || []).length)
            + " continue=" + result.should_continue
            + " reason=" + result.reason
            + " calls=" + (usage.screen_calls_for_run || 0)
            + " tokens=" + (usage.run_total_tokens || usage.total_tokens || 0));
        logTiming(ctx, encodeMs, imageBytes, httpMs, result);
    }
    return result;
}

function estimateBase64Bytes(value) {
    var text = String(value || "");
    var comma = text.indexOf(",");
    if (comma >= 0) text = text.substring(comma + 1);
    var padding = 0;
    if (/==$/.test(text)) padding = 2;
    else if (/=$/.test(text)) padding = 1;
    return Math.max(0, Math.floor(text.length * 3 / 4) - padding);
}

function logTiming(ctx, encodeMs, imageBytes, httpMs, result) {
    var usage = (result && result.usage) || {};
    var timing = (result && result.timing) || {};
    var aiMs = Number(timing.ai_latency_ms || usage.latency_ms || 0);
    var serverMs = Number(timing.server_route_ms || timing.server_total_ms || 0);
    var beforeServerMs = serverMs > 0 ? Math.max(0, httpMs - serverMs) : 0;
    log("[AI timing] account=" + ((ctx && ctx.account) || "unknown")
        + " screen=" + Number((ctx && ctx.screenIndex) || 0)
        + " encode=" + encodeMs + "ms"
        + " image=" + Math.round(imageBytes / 1024) + "KB"
        + " http=" + httpMs + "ms"
        + " server=" + serverMs + "ms"
        + " ai=" + aiMs + "ms"
        + " before_server=" + beforeServerMs + "ms"
        + " json_parse=" + Number(timing.json_parse_ms || 0) + "ms"
        + " image_save=" + Number(timing.screenshot_save_ms || 0) + "ms");
}

function fetchSummary(runId) {
    var serverUrl = (config.backend && config.backend.serverUrl) || "";
    var token = (config.backend && config.backend.collectorToken) || "";
    if (!serverUrl || !token || !runId) return null;
    var url = serverUrl.replace(/\/+$/, "") + "/api/collector/series/recognize/summary?run_id=" + encodeURIComponent(runId);
    var res = http.get(url, {
        headers: {
            "X-Collector-Token": token
        }
    });
    var statusCode = Number(res.statusCode || res.status || 0);
    var bodyText = readResponseBody(res);
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error("backend summary HTTP " + statusCode + ": " + bodyText);
    }
    return JSON.parse(bodyText);
}

function imageToBase64(img) {
    if (images.toBase64) {
        return images.toBase64(img, "jpg", 82);
    }
    if (images.toBytes) {
        var bytes = images.toBytes(img, "jpg", 82);
        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
    }
    throw new Error("AutoJs images.toBase64/toBytes is unavailable");
}

function postJson(url, token, payload, timeout) {
    var body = JSON.stringify(payload);
    var res;
    if (typeof http.postJson === "function") {
        res = http.postJson(url, payload, {
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "X-Collector-Token": token
            },
            timeout: timeout
        });
    } else {
        res = http.request(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                "X-Collector-Token": token
            },
            body: body,
            timeout: timeout
        });
    }
    var statusCode = Number(res.statusCode || res.status || 0);
    var text = readResponseBody(res);
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error("backend recognition HTTP " + statusCode + ": " + text);
    }
    return text;
}

function readResponseBody(res) {
    try {
        if (typeof res.body === "function") {
            return res.body().string();
        }
        if (typeof res.body === "object" && res.body.string) {
            return res.body.string();
        }
        return String(res.body || "");
    } catch (e) {
        return "";
    }
}

module.exports = {
    recognizeSeriesScreen: recognizeSeriesScreen,
    fetchSummary: fetchSummary
};
