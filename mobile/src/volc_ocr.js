var config = require("./config.js");

var SERVICE = "cv";
var REGION = "cn-north-1";
var HOST = "visual.volcengineapi.com";
var ACTION = "MultiLanguageOCR";
var VERSION = "2022-08-31";

function isEnabled() {
    return !!(config.volcOcr && config.volcOcr.enabled);
}

function recognizeImage(img) {
    var cfg = loadConfig();
    if (!cfg.accessKeyId || !cfg.secretAccessKey) {
        throw new Error("Volc OCR accessKeyId/secretAccessKey is not configured");
    }

    var imageBase64 = imageToBase64(img);
    var body = formEncode({
        image_base64: imageBase64,
        mode: cfg.mode || "default",
        filter_thresh: String(cfg.filterThresh || 60)
    });
    var payloadHash = sha256Hex(body);
    var date = requestDate();
    var query = {
        Action: ACTION,
        Version: VERSION
    };
    var authorization = signRequest(cfg.accessKeyId, cfg.secretAccessKey, date.shortDate, date.xDate, query, body, payloadHash);
    var url = "https://" + HOST + "/?" + canonicalQueryString(query);
    var headers = {
        "Host": HOST,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Date": date.xDate,
        "X-Content-Sha256": payloadHash,
        "Authorization": authorization
    };

    var response = httpRequest(url, headers, body, Number(cfg.timeout || 30000));
    var parsed = JSON.parse(response);
    if (parsed.status && Number(parsed.status) !== 10000) {
        throw new Error("Volc OCR status=" + parsed.status + " message=" + (parsed.message || ""));
    }
    return {
        mode: "volc",
        count: 0,
        items: normalizeItems(parsed),
        score: 0,
        raw: parsed
    };
}

function loadConfig() {
    var base = config.volcOcr || {};
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
            throw new Error("Failed to read Volc OCR configFile: " + e);
        }
    }
    return out;
}

function imageToBase64(img) {
    if (images.toBase64) {
        return images.toBase64(img, "jpg", 85);
    }
    if (images.toBytes) {
        var bytes = images.toBytes(img, "jpg", 85);
        return android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP);
    }
    throw new Error("AutoJs images.toBase64/toBytes is unavailable");
}

function httpRequest(url, headers, body, timeout) {
    var options = {
        method: "POST",
        headers: headers,
        body: body,
        timeout: timeout
    };
    var res = http.request(url, options);
    var statusCode = Number(res.statusCode || res.status || 0);
    var text = res.body ? res.body.string() : "";
    if (statusCode < 200 || statusCode >= 300) {
        throw new Error("Volc OCR HTTP " + statusCode + ": " + text);
    }
    return text;
}

function normalizeItems(response) {
    var infos = [];
    try {
        infos = (response.data && response.data.ocr_infos) || [];
    } catch (e) {
        infos = [];
    }
    var items = [];
    for (var i = 0; i < infos.length; i++) {
        var info = infos[i] || {};
        var label = String(info.text || info.words || "");
        if (!label) continue;
        items.push({
            label: label,
            confidence: info.prob,
            bounds: rectFromPoints(info.rect || info.points || info.polygon),
            mode: "volc"
        });
    }
    return items;
}

function rectFromPoints(points) {
    if (!points || !points.length) return { left: 0, top: 0, right: 0, bottom: 0 };
    var left = 999999;
    var top = 999999;
    var right = 0;
    var bottom = 0;
    for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var x = 0;
        var y = 0;
        if (p && typeof p.x !== "undefined") {
            x = Number(p.x);
            y = Number(p.y);
        } else if (p && p.length >= 2) {
            x = Number(p[0]);
            y = Number(p[1]);
        }
        if (isNaN(x) || isNaN(y)) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
    }
    if (left === 999999) return { left: 0, top: 0, right: 0, bottom: 0 };
    return { left: left, top: top, right: right, bottom: bottom };
}

function signRequest(accessKeyId, secretAccessKey, shortDate, xDate, query, body, payloadHash) {
    var signedHeaders = "content-type;host;x-content-sha256;x-date";
    var canonicalHeaders =
        "content-type:application/x-www-form-urlencoded\n" +
        "host:" + HOST + "\n" +
        "x-content-sha256:" + payloadHash + "\n" +
        "x-date:" + xDate + "\n";
    var canonicalRequest = [
        "POST",
        "/",
        canonicalQueryString(query),
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join("\n");
    var credentialScope = shortDate + "/" + REGION + "/" + SERVICE + "/request";
    var stringToSign = [
        "HMAC-SHA256",
        xDate,
        credentialScope,
        sha256Hex(canonicalRequest)
    ].join("\n");
    var signingKey = signatureKey(secretAccessKey, shortDate, REGION, SERVICE);
    var signature = hmacSha256Hex(signingKey, stringToSign);
    return "HMAC-SHA256 Credential=" + accessKeyId + "/" + credentialScope +
        ", SignedHeaders=" + signedHeaders +
        ", Signature=" + signature;
}

function signatureKey(secretAccessKey, shortDate, region, service) {
    var kDate = hmacSha256Bytes(toBytes(secretAccessKey), shortDate);
    var kRegion = hmacSha256Bytes(kDate, region);
    var kService = hmacSha256Bytes(kRegion, service);
    return hmacSha256Bytes(kService, "request");
}

function requestDate() {
    var sdf = new java.text.SimpleDateFormat("yyyyMMdd'T'HHmmss'Z'");
    sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
    var xDate = String(sdf.format(new java.util.Date()));
    return {
        xDate: xDate,
        shortDate: xDate.substring(0, 8)
    };
}

function formEncode(params) {
    var parts = [];
    var keys = [];
    for (var key in params) {
        if (params.hasOwnProperty(key)) keys.push(key);
    }
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        parts.push(percentEncode(k) + "=" + percentEncode(params[k]));
    }
    return parts.join("&");
}

function canonicalQueryString(query) {
    var keys = [];
    for (var key in query) {
        if (query.hasOwnProperty(key)) keys.push(key);
    }
    keys.sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        parts.push(percentEncode(keys[i]) + "=" + percentEncode(query[keys[i]]));
    }
    return parts.join("&");
}

function percentEncode(value) {
    return encodeURIComponent(String(value))
        .replace(/[!'()*]/g, function(ch) {
            return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
        });
}

function sha256Hex(value) {
    var md = java.security.MessageDigest.getInstance("SHA-256");
    md.update(toBytes(value));
    return bytesToHex(md.digest());
}

function hmacSha256Bytes(keyBytes, value) {
    var mac = javax.crypto.Mac.getInstance("HmacSHA256");
    mac.init(new javax.crypto.spec.SecretKeySpec(keyBytes, "HmacSHA256"));
    return mac.doFinal(toBytes(value));
}

function hmacSha256Hex(keyBytes, value) {
    return bytesToHex(hmacSha256Bytes(keyBytes, value));
}

function toBytes(value) {
    if (value && value.getClass && String(value.getClass()).indexOf("[B") >= 0) return value;
    return new java.lang.String(String(value)).getBytes("UTF-8");
}

function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
        var v = bytes[i];
        if (v < 0) v += 256;
        if (v < 16) out += "0";
        out += v.toString(16);
    }
    return out;
}

module.exports = {
    isEnabled: isEnabled,
    recognizeImage: recognizeImage
};
