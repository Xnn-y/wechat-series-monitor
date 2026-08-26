/**
 * csv_store.js - CSV 追加写入（纯备份，不参与去重逻辑）
 *
 * 去重完全由后端 SQLite 唯一索引负责。
 * 本地 CSV 只做追加式备份记录。
 */
var config = require("./config.js");
var time = require("./time.js");

function writeCsv(results) {
    appendCsv(results);
}

function appendCsv(results) {
    if (!results || results.length === 0) return;
    if (!ensureDataDir()) return;

    var isNew = !files.exists(config.csvFile);
    var lines = [];
    if (isNew) lines.push("账号名称,剧集名称,采集时间");

    for (var i = 0; i < results.length; i++) {
        var acc = csvEscape(results[i].account);
        var ser = csvEscape(results[i].series);
        var collectTime = results[i].collectTime || time.beijingTime();
        lines.push(acc + "," + ser + "," + csvEscape(displayTime(collectTime)));
    }

    try {
        if (isNew) {
            files.write(config.csvFile, lines.join("\n"));
        } else {
            files.append(config.csvFile, lines.join("\n") + "\n");
        }
    } catch (e) {
        console.log("  [警告] 写入CSV失败: " + e);
    }
}

function ensureDataDir() {
    try {
        var dir = new java.io.File(config.csvDir);
        if (dir.exists() && !dir.isDirectory()) {
            console.log("  [警告] 数据目录路径已存在但不是目录: " + config.csvDir);
            return false;
        }
        if (!dir.exists() && !dir.mkdirs()) {
            console.log("  [警告] 创建数据目录失败: " + config.csvDir);
            return false;
        }
        return true;
    } catch (e) {
        console.log("  [警告] 准备数据目录失败: " + e);
        return false;
    }
}

function displayTime(value) {
    value = String(value || "");
    var match = value.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return value;
    return match[1] + " " + match[2] + "时" + match[3] + "分" + match[4] + "秒";
}

function csvEscape(s) {
    s = String(s || "");
    if (s.indexOf(",") >= 0 || s.indexOf("\"") >= 0 || s.indexOf("\n") >= 0) {
        return "\"" + s.replace(/"/g, "\"\"") + "\"";
    }
    return s;
}

module.exports = {
    writeCsv: writeCsv,
    appendCsv: appendCsv
};
