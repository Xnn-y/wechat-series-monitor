function sdcardPath() {
    try {
        if (files.getSdcardPath) return files.getSdcardPath();
    } catch (e) {}
    return "/sdcard";
}

function joinPath(a, b) {
    a = String(a || "");
    b = String(b || "");
    return a.replace(/[\/\\]+$/, "") + "/" + b.replace(/^[\/\\]+/, "");
}

var dataDir = joinPath(joinPath(sdcardPath(), "AutoJs6"), "phase3_data");

var config = {
    ocr: {
        mode: "paddle",
        fallbackModes: ["paddle", "mlkit", "rapid", "generic"],
        multiEngine: true,
        useSlim: false,
        cpuThreadNum: 4,
        useOpenCL: false,
        detLongSize: 960,
        scoreThreshold: 0.45,
        mergeLine: true,
        debug: true
    },
    pageDelay: 1200,
    captureRetryTries: 12,
    captureRetryInterval: 900,
    captureRecoverEnabled: false,
    captureRecoverMaxTries: 1,
    captureRecoverDelay: 1800,
    maxSeries: 12,
    maxSeriesScrolls: 10,
    maxNoNewSeriesPages: 3,
    maxAccountScrolls: 30,
    maxAccountSteps: 200,
    maxEmptyAccountPages: 2,
    accountSmallScrollRatio: 0.16,
    accountNextRowGap: 36,
    finishBackMaxSteps: 4,
    finishScrollTopSwipes: 8,
    scrollWait: 1800,
    seriesTabRoi: [0, 0.28, 1, 0.15],
    csvDir: dataDir,
    csvFile: joinPath(dataDir, "series_data.csv"),
    indexFile: joinPath(dataDir, "series_index.json"),
    backend: {
        enabled: true,
        serverUrl: "http://192.168.65.182:5000",
        collectorToken: "dev_token"
    }
};

module.exports = config;
