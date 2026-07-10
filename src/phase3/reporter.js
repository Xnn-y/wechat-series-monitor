/**
 * phase3/reporter.js - 采集结果上报后端
 *
 * 每轮采集结束后，将本轮结果 POST 到后端 /api/collect。
 * 本地 CSV 仍保留完整备份，上报不影响本地存储。
 */

var config = require("./config.js");
var time = require("./time.js");

/**
 * 上报本轮采集结果到后端
 * @param {Array} outputRecords - [{account, series, collectTime}, ...]
 * @param {Object} summary - {scannedCount, successCount, failCount, endReason}
 * @returns {Object} {ok, received, inserted, duplicates, notified, error}
 */
function reportToBackend(outputRecords, summary) {
    if (config.backend && config.backend.enabled === false) {
        log("[上报] 后端上报已关闭，跳过");
        return { ok: false, skipped: true, error: "backend disabled" };
    }

    if (!outputRecords || outputRecords.length === 0) {
        log("[上报] 没有可上报记录，跳过");
        return { ok: true, skipped: true, received: 0, inserted: 0, duplicates: 0 };
    }

    var serverUrl = (config.backend && config.backend.serverUrl) || "";
    var token = (config.backend && config.backend.collectorToken) || "";

    if (!serverUrl) {
        log("[上报] 后端地址未配置，跳过上报");
        return { ok: false, error: "serverUrl 未配置" };
    }

    var collectUrl = serverUrl.replace(/\/+$/, "") + "/api/collect";

    // 生成 run_id
    var now = new Date();
    var runId = time.beijingTime().replace(/[:\-\s]/g, "_")
        .replace(/\.\d+/, "");

    // 收集本轮开始时间：取最早记录的采集时间
    var startedAt = runId;
    if (outputRecords.length > 0) {
        startedAt = outputRecords[0].collectTime || time.beijingTime();
    }
    var finishedAt = time.beijingTime();

    // 设备标识
    var deviceName = "";
    try {
        if (typeof device !== "undefined") {
            deviceName = device.model || device.product || "unknown";
        }
    } catch (e) {}
    if (!deviceName) deviceName = "android_device";

    // 构建 records 数组
    var records = [];
    for (var i = 0; i < outputRecords.length; i++) {
        records.push({
            account_name: outputRecords[i].account || "",
            series_name: outputRecords[i].series || "",
            episodes: outputRecords[i].episodes || "",
            collected_at: outputRecords[i].collectTime || finishedAt
        });
    }

    var payload = {
        device: deviceName,
        run_id: runId,
        started_at: startedAt,
        finished_at: finishedAt,
        records: records
    };

    log("[上报] 准备发送 " + records.length + " 条记录到 " + collectUrl);

    try {
        var res;
        if (typeof http.postJson === "function") {
            res = http.postJson(collectUrl, payload, {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Collector-Token": token
                }
            });
        } else {
            // Fallback: 手动构造 POST
            var body = JSON.stringify(payload);
            res = http.post(collectUrl, body, {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Collector-Token": token
                }
            });
        }

        var statusCode = res.statusCode || 0;
        var bodyText = "";
        try {
            if (typeof res.body === "function") {
                bodyText = res.body().string();
            } else if (typeof res.body === "object" && res.body.string) {
                bodyText = res.body.string();
            } else {
                bodyText = String(res.body || "");
            }
        } catch (e) {
            bodyText = "[无法读取响应体]";
        }

        log("[上报] HTTP " + statusCode + ": " + bodyText);

        if (statusCode === 200 || statusCode === 201) {
            try {
                var result = JSON.parse(bodyText);
                log("[上报] 成功: received=" + result.received
                    + " inserted=" + result.inserted
                    + " duplicates=" + result.duplicates
                    + " notified=" + result.notified);
                return result;
            } catch (e) {
                log("[上报] JSON 解析失败: " + e);
                return { ok: false, error: "JSON 解析失败" };
            }
        } else {
            log("[上报] 失败: HTTP " + statusCode);
            return { ok: false, error: "HTTP " + statusCode, body: bodyText };
        }
    } catch (e) {
        log("[上报] 网络异常: " + e);
        return { ok: false, error: String(e) };
    }
}

/**
 * 发送心跳到后端
 * @param {string} status - "alive" | "collecting" | "idle" | "error"
 */
function sendHeartbeat(status) {
    if (config.backend && config.backend.enabled === false) return;

    var serverUrl = (config.backend && config.backend.serverUrl) || "";
    var token = (config.backend && config.backend.collectorToken) || "";

    if (!serverUrl) return;

    var heartbeatUrl = serverUrl.replace(/\/+$/, "") + "/api/heartbeat";
    var deviceName = "";
    try {
        if (typeof device !== "undefined") {
            deviceName = device.model || device.product || "unknown";
        }
    } catch (e) {}
    if (!deviceName) deviceName = "android_device";

    var payload = { device: deviceName, status: status || "alive" };

    try {
        if (typeof http.postJson === "function") {
            http.postJson(heartbeatUrl, payload, {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Collector-Token": token
                }
            });
        } else {
            http.post(heartbeatUrl, JSON.stringify(payload), {
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    "X-Collector-Token": token
                }
            });
        }
        log("[心跳] 已发送: " + status);
    } catch (e) {
        log("[心跳] 发送异常: " + e);
    }
}

module.exports = {
    reportToBackend: reportToBackend,
    sendHeartbeat: sendHeartbeat
};
