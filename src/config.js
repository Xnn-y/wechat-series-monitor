module.exports = {
    wechatPackageName: "com.tencent.mm",

    outputDir: "/sdcard/Download/wechat_video_probe",
    collectOutputDir: "/sdcard/Download/wechat_video_collect",
    csvPath: "/sdcard/Download/wechat_video_watch.csv",

    collect: {
        scanWindowMinutes: 180,
        defaultAccountName: "unknown",
        writeUnmatchedRecords: false,
        evidenceRoiName: "video_detail_left_bottom",
        visionFallbackEnabled: false,
        visionFallbackWhenOcrCountBelow: 2,
        visionFallbackWhenMissingTime: true,
        showConsole: false,
        writeWhenOcrEmpty: false,
        fuzzyDuplicateEnabled: false,
        duplicateTitleSimilarity: 0.42,
        blackSampleStep: 24,
        blackMaxAverageBrightness: 12,
        blackMaxBrightPixelRatio: 0.02
    },

    series: {
        outputDir: "/sdcard/Download/wechat_video_series",
        csvPath: "/sdcard/Download/wechat_video_series.csv",
        showConsole: false,
        debugSummary: false,
        saveDebugArtifacts: false,
        freeEntryRoiName: "free_series_entry",
        panelTitleRoiName: "series_panel_title",
        freeEntryTextPattern: "免费剧集",
        entryClickMode: "ocr_then_fixed",
        freeEntryClickXRatioInLine: 0.55,
        freeEntryClickYPadding: 12,
        fallbackClickRatio: [0.36, 0.76],
        clickAfterMs: 1200,
        titleRecognitionMode: "ocr_score",
        titleVisionUseRoi: true,
        titleVisionMinConfidence: 0.6,
        writeWhenTitleEmpty: false,
        writeWhenPublishTimeEmpty: false,
        closePanelAfterCollect: false,
        blackSampleStep: 24,
        blackMaxAverageBrightness: 12,
        blackMaxBrightPixelRatio: 0.02
    },

    navigation: {
        outputDir: "/sdcard/Download/wechat_video_flow",
        showConsole: false,
        dryRun: false,
        launchWechat: false,
        launchWaitMs: 1500,
        verifyDelayMs: 900,
        requireStepVerify: true,
        useFixedNavigation: true,
        fixedPoints: {
            discover: [0.625, 0.945],
            channels: [0.20, 0.215],
            profileIcon: [0.936, 0.056],
            following: [0.50, 0.245]
        },
        saveDebugArtifacts: false,
        ocrMode: "paddle",
        ocrFallbackModes: ["paddle", "mlkit", "rapid", "generic"]
    },

    startup: {
        waitForWechatForeground: false,
        waitMode: "manualDelay",
        manualDelayMs: 8000,
        requireWechatPackage: false,
        waitTimeoutMs: 20000,
        settleMs: 1000,
        pollMs: 300
    },

    tree: {
        maxDepth: 40,
        maxNodes: 2500,
        includeInvisible: true
    },

    screenshot: {
        enabled: true,
        saveRoiImages: true
    },

    ocr: {
        enabled: true,
        mode: "paddle",
        fallbackModes: ["paddle", "mlkit", "rapid", "generic"],
        useSlim: true,
        cpuThreadNum: 4,
        useOpenCL: false
    },

    rois: [
        {
            name: "top_nav",
            description: "顶部导航/返回/标题区域",
            region: [0, 0, 1, 0.14]
        },
        {
            name: "middle_list",
            description: "关注列表或主要内容区域",
            region: [0, 0.12, 1, 0.72]
        },
        {
            name: "account_header",
            description: "账号主页顶部账号名区域",
            region: [0, 0.08, 1, 0.25]
        },
        {
            name: "video_grid",
            description: "账号主页视频宫格区域",
            region: [0, 0.28, 1, 0.62]
        },
        {
            name: "video_detail_left_bottom",
            description: "视频详情页左下标题/发布时间区域",
            region: [0, 0.52, 0.76, 0.38]
        },
        {
            name: "free_series_entry",
            description: "视频详情页左下免费剧集入口区域",
            region: [0, 0.68, 0.76, 0.18]
        },
        {
            name: "series_panel_title",
            description: "免费剧集弹出面板标题区，优先识别大号高亮剧名",
            region: [0.04, 0.28, 0.92, 0.36]
        },
        {
            name: "bottom_tab",
            description: "底部 Tab/操作区",
            region: [0, 0.86, 1, 0.14]
        }
    ]
};
