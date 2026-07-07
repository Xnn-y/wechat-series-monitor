var config = require("./config.js");
var text = require("./text_utils.js");
var time = require("./time.js");

function readCsv() {
    var records = [];
    records.__index = {};

    try {
        readCustomerCsv(records);
        readIndex(records);
    } catch (e) {
        console.log("  [警告] 读取CSV或索引失败: " + e);
    }
    return records;
}

function csvExists(records, account, series) {
    var key = recordKey(account, series);
    if (!key) return true;
    if (records.__index && records.__index[key]) return true;

    for (var i = 0; i < records.length; i++) {
        if (recordKey(records[i].account, records[i].series) === key) return true;
    }
    return false;
}

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

function saveIndex(records) {
    if (!ensureDataDir()) return;
    var index = (records && records.__index) || {};
    var payload = {
        version: 1,
        updatedAt: time.beijingTime(),
        records: index
    };
    try {
        files.write(config.indexFile, JSON.stringify(payload, null, 2));
    } catch (e) {
        console.log("  [警告] 写入去重索引失败: " + e);
    }
}

function addRecord(records, row) {
    if (!records.__index) records.__index = {};
    var key = recordKey(row.account, row.series);
    if (!key) return;
    records.__index[key] = true;
    records.push({
        account: row.account,
        series: row.series,
        collectTime: row.collectTime || time.beijingTime()
    });
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

function readCustomerCsv(records) {
    if (!files.exists(config.csvFile)) return;

    var content = files.read(config.csvFile);
    var lines = content.split(/\r?\n/);
    if (lines.length === 0) return;

    var headers = parseCsvLine(lines[0]);
    var accountIndex = findHeader(headers, ["账号名称", "account"]);
    var seriesIndex = findHeader(headers, ["剧集名称", "series_name", "series"]);
    if (accountIndex < 0) accountIndex = 0;
    if (seriesIndex < 0) seriesIndex = 1;

    for (var i = 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        var cols = parseCsvLine(line);
        if (cols.length <= Math.max(accountIndex, seriesIndex)) continue;
        addRecord(records, {
            account: cols[accountIndex],
            series: cols[seriesIndex],
            collectTime: cols[2] || ""
        });
    }
}

function readIndex(records) {
    if (!files.exists(config.indexFile)) return;
    var payload = JSON.parse(files.read(config.indexFile));
    var index = payload.records || payload || {};
    if (!records.__index) records.__index = {};
    for (var key in index) {
        if (index.hasOwnProperty(key) && index[key]) records.__index[key] = true;
    }
}

function findHeader(headers, names) {
    for (var i = 0; i < headers.length; i++) {
        var h = String(headers[i] || "").trim();
        for (var j = 0; j < names.length; j++) {
            if (h === names[j]) return i;
        }
    }
    return -1;
}

function parseCsvLine(line) {
    var out = [];
    var cur = "";
    var inQuotes = false;
    line = String(line || "");

    for (var i = 0; i < line.length; i++) {
        var ch = line.charAt(i);
        if (ch === "\"") {
            if (inQuotes && line.charAt(i + 1) === "\"") {
                cur += "\"";
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function recordKey(account, series) {
    var accountKey = text.normalizeRecordKey(account);
    var seriesKey = text.normalizeRecordKey(series);
    if (!accountKey || !seriesKey) return "";
    return accountKey + "::" + seriesKey;
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
    readCsv: readCsv,
    csvExists: csvExists,
    writeCsv: writeCsv,
    appendCsv: appendCsv,
    saveIndex: saveIndex,
    addRecord: addRecord,
    displayTime: displayTime
};
