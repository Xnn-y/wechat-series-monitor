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
        detLongSize: 1280,
        scoreThreshold: 0.4,
        mergeLine: true,
        debug: true
    },
    recognition: {
        mode: "backend_ai",
        aiEnabled: false,
        minConfidence: 0.78,
        maxAiCallsPerScreen: 1,
        debug: true
    },
    backendRecognition: {
        enabled: true,
        timeout: 120000,
        fallbackLocalAi: false,
        debug: true
    },
    aiRecognition: {
        enabled: true,
        provider: "volcengine",
        configFile: joinPath(dataDir, "ai_recognition_config.json"),
        apiKey: "",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        model: "doubao-seed-2-0-lite-260215",
        timeout: 90000,
        minConfidence: 0.65,
        fallbackLocalOcr: false,
        maxScreensPerAccount: 6,
        debug: true
    },
    volcOcr: {
        enabled: false,
        configFile: joinPath(dataDir, "volc_ocr_config.json"),
        accessKeyId: "",
        secretAccessKey: "",
        mode: "default",
        filterThresh: 60,
        timeout: 30000,
        fallbackLocalOcr: true,
        debug: true
    },
    pageDelay: 1200,
    captureRetryTries: 12,
    captureRetryInterval: 900,
    captureRecoverEnabled: false,
    captureRecoverMaxTries: 1,
    captureRecoverDelay: 1800,
    maxSeries: 12,
    maxSeriesScrolls: 6,
    maxNoNewSeriesPages: 2,
    maxAccountScrolls: 30,
    maxAccountSteps: 200,
    maxEmptyAccountPages: 2,
    maxAnchorSeekPages: 8,
    maxRevealNextPages: 5,
    accountSmallScrollRatio: 0.10,
    accountRevealNextScrollRatio: 0.22,
    accountNextRowGap: 36,
    accountNextMaxGap: 420,
    accountSafeTopRatio: 0.16,
    accountSafeBottomRatio: 0.97,
    accountTextMinXRatio: 0.16,
    allowUnknownAccounts: false,
    standardAccountOrderMode: true,
    profileNameOverrideSimilarity: 0.92,
    finishBackMaxSteps: 4,
    finishScrollTopSwipes: 8,
    scrollWait: 1800,
    seriesTabRoi: [0, 0.28, 1, 0.15],
    csvDir: dataDir,
    csvFile: joinPath(dataDir, "series_data.csv"),
    indexFile: joinPath(dataDir, "series_index.json"),
    backend: {
        enabled: true,
        serverUrl: "http://atool.fz-ue.com",
        collectorToken: "wm_20260710_server_x9Kp72Qz"
    }
};

module.exports = config;
