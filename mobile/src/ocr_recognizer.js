var ocr = require("./ocr.js");

function detectRawText(img, purpose) {
    return ocr.ocrScreen(img, null, purpose);
}

function detectFollowingAccounts(img) {
    return {
        engine: "ocr",
        raw: ocr.ocrScreen(img, null, "account")
    };
}

function detectProfile(img) {
    return {
        engine: "ocr",
        raw: ocr.ocrScreen(img, null, "profile")
    };
}

function detectTabs(img) {
    return {
        engine: "ocr",
        raw: ocr.ocrScreen(img, null, "tab")
    };
}

function detectSeriesPage(img) {
    return {
        engine: "ocr",
        raw: ocr.ocrScreen(img, null, "series")
    };
}

module.exports = {
    detectRawText: detectRawText,
    detectFollowingAccounts: detectFollowingAccounts,
    detectProfile: detectProfile,
    detectTabs: detectTabs,
    detectSeriesPage: detectSeriesPage
};

