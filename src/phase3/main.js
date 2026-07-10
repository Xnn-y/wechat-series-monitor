"auto";

var config = require("./config.js");
var screen = require("./screen.js");
var ocr = require("./ocr.js");
var accountParser = require("./account_parser.js");
var seriesParser = require("./series_parser.js");
var csvStore = require("./csv_store.js");
var actions = require("./actions.js");
var reporter = require("./reporter.js");
var textUtils = require("./text_utils.js");
var time = require("./time.js");

function collectSeries(initialPage) {
    var allNames = [];
    var noNewCount = 0;

    sleep(config.pageDelay);
    for (var scroll = 0; scroll < config.maxSeriesScrolls; scroll++) {
        var pageNames;
        if (scroll === 0 && initialPage && initialPage.ocrResult) {
            pageNames = seriesParser.extractCompleteCardTitles(
                initialPage.ocrResult.items || [],
                initialPage.height || device.height
            );
            log("复用已在剧集页截图读取第一屏");
        } else {
            var pageImg = screen.ensureCapture();
            if (!pageImg) {
                warn("剧集页截图失败，结束当前账号采集");
                break;
            }

            pageNames = seriesParser.readSeriesNames(pageImg, ocr);
            pageImg.recycle();
        }

        var beforeCount = allNames.length;
        allNames = seriesParser.mergeAndDedup(allNames, pageNames);
        var newCount = allNames.length - beforeCount;

        log("本屏识别完整剧集：" + pageNames.join(" | "));
        log("新增剧集 " + newCount + " 个，累计 " + allNames.length + " 个");

        if (allNames.length >= config.maxSeries) {
            break;
        }

        if (newCount === 0) {
            noNewCount++;
            if (noNewCount >= config.maxNoNewSeriesPages) {
                log("连续 " + config.maxNoNewSeriesPages + " 屏没有新增完整剧集，按已到底处理");
                break;
            }
        } else {
            noNewCount = 0;
        }

        log("剧集未满 " + config.maxSeries + " 个，向下滑动继续识别");
        screen.scrollDown();
        sleep(config.scrollWait);
    }

    return allNames.slice(0, config.maxSeries);
}

function markNewSeries(existingRecords, outputRecords, observedRecords, accountName, seriesNames) {
    var appended = 0;
    var newRows = [];

    seriesNames.forEach(function (seriesName) {
        var collectTime = time.beijingTime();
        observedRecords.push({
            account: accountName,
            series: seriesName,
            collectTime: collectTime
        });

        if (csvStore.csvExists(existingRecords, accountName, seriesName)) {
            log("CSV已存在，跳过：" + accountName + " / " + seriesName);
            return;
        }

        var row = {
            account: accountName,
            series: seriesName,
            collectTime: collectTime
        };
        outputRecords.push(row);
        newRows.push(row);
        csvStore.addRecord(existingRecords, row);
        appended++;
        log("新增记录：" + accountName + " / " + seriesName);
    });

    if (newRows.length > 0) {
        csvStore.appendCsv(newRows);
        csvStore.saveIndex(existingRecords);
    }

    return appended;
}

function collectAccount(account, existingRecords, outputRecords, observedRecords) {
    log("进入账号：" + account.label);

    var clickResult = actions.clickAccount(account, ocr);
    if (!clickResult.success) {
        warn("进入账号失败：" + account.label);
        return false;
    }

    var profileAccountName = accountParser.extractProfileAccountName(
        clickResult.ocrResult,
        clickResult.img.getHeight(),
        account.label
    );
    if (profileAccountName && profileAccountName !== account.label) {
        log("账号名以主页识别为准：" + account.label + " -> " + profileAccountName);
    }

    var tabResult = actions.clickSeriesTab(clickResult.img, ocr);
    clickResult.img.recycle();
    if (!tabResult.success) {
        warn("未找到剧集Tab，跳过：" + account.label);
        screen.goBack();
        sleep(config.pageDelay);
        return false;
    }

    var initialSeriesPage = null;
    if (tabResult.alreadySeriesPage) {
        initialSeriesPage = {
            ocrResult: tabResult.firstPageOcr,
            height: tabResult.firstPageHeight
        };
    }
    var seriesNames = collectSeries(initialSeriesPage);
    var accountNameForCsv = profileAccountName || account.label;
    var appended = markNewSeries(existingRecords, outputRecords, observedRecords, accountNameForCsv, seriesNames);
    log("账号完成：" + accountNameForCsv + "，完整剧集 " + seriesNames.length + " 个，新增 " + appended + " 个");

    screen.goBack();
    sleep(config.pageDelay);
    return true;
}

function collectAccountsOnce(existingRecords, outputRecords, observedRecords) {
    var processedAccounts = {};
    var processedAccountLabels = [];
    var lastAccountLabel = "";
    var scannedCount = 0;
    var successCount = 0;
    var failCount = 0;
    var emptyPages = 0;
    var skippedTopOnce = false;
    var targetAccountCount = 0;
    var endedOnFollowingList = true;
    var endReason = "unknown";

    for (var step = 0; step < config.maxAccountSteps; step++) {
        if (targetAccountCount > 0 && scannedCount >= targetAccountCount) {
            log("已遍历关注账号数 " + scannedCount + "/" + targetAccountCount + "，结束");
            endReason = "scanned_all_accounts";
            break;
        }

        var img = screen.ensureCapture();
        if (!img) {
            warn("关注列表截图连续失败，结束本轮遍历");
            endedOnFollowingList = false;
            endReason = "capture_failed";
            break;
        }
        var ocrResult = ocr.ocrScreen(img, null, "account");
        if (targetAccountCount === 0) {
            var followTotal = accountParser.extractFollowTotal(ocrResult);
            if (followTotal > 1) {
                targetAccountCount = followTotal - 1;
                log("关注总数 " + followTotal + "，排除自己后需遍历 " + targetAccountCount + " 个账号");
            }
        }
        var visibleAccounts = accountParser.extractAccounts(ocrResult, img.getHeight());
        img.recycle();

        var targetAccount = null;
        var candidates = [];
        var lastVisibleY = -1;
        visibleAccounts.forEach(function (account, index) {
            if (!skippedTopOnce && index === 0) {
                log("跳过关注列表首项：" + account.label);
                rememberProcessedAccount(processedAccounts, processedAccountLabels, account.label);
                skippedTopOnce = true;
                return;
            }

            if (sameAccountLabel(account.label, lastAccountLabel)) {
                lastVisibleY = account.centerY;
            }

            if (isProcessedAccount(processedAccountLabels, account.label)) {
                return;
            }

            candidates.push(account);
        });

        log("关注列表第 " + (step + 1) + " 次扫描，识别账号："
            + visibleAccounts.map(function (item) { return item.label; }).join(" | "));

        targetAccount = pickNextAccount(candidates, lastVisibleY);

        if (!targetAccount) {
            emptyPages++;
            if (emptyPages >= config.maxEmptyAccountPages) {
                log("连续没有新账号，结束关注列表遍历");
                endReason = "no_new_accounts";
                break;
            }
            screen.scrollDownSmall();
            sleep(config.scrollWait);
            continue;
        }

        emptyPages = 0;
        rememberProcessedAccount(processedAccounts, processedAccountLabels, targetAccount.label);
        lastAccountLabel = targetAccount.label;
        scannedCount++;

        if (collectAccount(targetAccount, existingRecords, outputRecords, observedRecords)) {
            successCount++;
        } else {
            failCount++;
        }
    }

    return {
        scannedCount: scannedCount,
        successCount: successCount,
        failCount: failCount,
        endedOnFollowingList: endedOnFollowingList,
        endReason: endReason
    };
}

function pickNextAccount(candidates, lastVisibleY) {
    if (!candidates.length) return null;
    if (lastVisibleY >= 0) {
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i].centerY > lastVisibleY + config.accountNextRowGap) {
                return candidates[i];
            }
        }
        return null;
    }
    return candidates[0];
}

function rememberProcessedAccount(processedMap, processedLabels, label) {
    var key = textUtils.normalizeRecordKey(label);
    if (!key) return;
    processedMap[key] = true;
    if (!isProcessedAccount(processedLabels, label)) {
        processedLabels.push(label);
    }
}

function isProcessedAccount(processedLabels, label) {
    var key = textUtils.normalizeRecordKey(label);
    if (!key) return true;
    for (var i = 0; i < processedLabels.length; i++) {
        if (sameAccountLabel(processedLabels[i], label)) return true;
    }
    return false;
}

function sameAccountLabel(a, b) {
    var ak = textUtils.normalizeRecordKey(a);
    var bk = textUtils.normalizeRecordKey(b);
    if (!ak || !bk) return false;
    if (ak === bk) return true;
    if (ak.length >= 3 && bk.length >= 3) {
        var shorter = ak.length <= bk.length ? ak : bk;
        var longer = ak.length <= bk.length ? bk : ak;
        if (longer.indexOf(shorter) >= 0 && (longer.length - shorter.length) <= 4) return true;
    }
    return textUtils.charOverlapRatio(ak, bk) >= 0.92;
}

function isFollowingListPage(ocrResult) {
    var items = (ocrResult && ocrResult.items) || [];
    var joined = items.map(function (item) {
        return textUtils.normalizeRecordKey(item.label || "");
    }).join(" ");
    if (joined.indexOf("我的关注") >= 0) return true;
    if (joined.indexOf("关注") >= 0 && joined.indexOf("已关注") < 0 && joined.indexOf("私信") < 0) return true;
    return accountParser.extractFollowTotal(ocrResult) > 0;
}

function captureAndCheckFollowingList() {
    var img = screen.ensureCapture();
    if (!img) return null;
    var ocrResult = ocr.ocrScreen(img, null, "account");
    var ok = isFollowingListPage(ocrResult);
    img.recycle();
    return ok;
}

function returnToFollowingList() {
    for (var i = 0; i < config.finishBackMaxSteps; i++) {
        var check = captureAndCheckFollowingList();
        if (check === true) {
            log("收尾: 已回到关注列表");
            return true;
        }
        if (check === null) {
            warn("收尾: 截图失败，无法确认当前位置，跳过返回操作");
            return false;
        }
        log("收尾: 当前不在关注列表，执行返回 " + (i + 1) + "/" + config.finishBackMaxSteps);
        screen.goBack();
        sleep(config.pageDelay);
    }
    var finalCheck = captureAndCheckFollowingList();
    if (finalCheck === true) {
        log("收尾: 已回到关注列表");
        return true;
    }
    if (finalCheck === null) {
        warn("收尾: 截图失败，无法确认当前位置");
        return false;
    }
    warn("收尾: 未能确认回到关注列表");
    return false;
}

function scrollFollowingListToTop() {
    log("收尾: 尝试回到关注列表顶部");
    for (var i = 0; i < config.finishScrollTopSwipes; i++) {
        screen.scrollToTopOnce();
        sleep(650);
    }
    log("收尾: 已执行顶部回滚手势 " + config.finishScrollTopSwipes + " 次");
}

function finishRun(summary) {
    if (summary && summary.endedOnFollowingList) {
        log("收尾: 主流程结束时已在关注列表，原因=" + summary.endReason);
        scrollFollowingListToTop();
        return;
    }
    if (returnToFollowingList()) {
        scrollFollowingListToTop();
    }
}

function main() {
    console.show();
    log("启动关注账号剧集采集");
    log("CSV路径：" + config.csvFile);

    screen.initCapture();

    var existingRecords = csvStore.readCsv();
    log("已加载历史记录 " + existingRecords.length + " 条");

    var outputRecords = [];
    var observedRecords = [];
    var summary = collectAccountsOnce(existingRecords, outputRecords, observedRecords);

    finishRun(summary);

    if (outputRecords.length === 0) {
        log("没有新增剧集记录");
    } else {
        log("本地新增剧集记录 " + outputRecords.length + " 条");
    }

    if (observedRecords.length > 0) {
        // 上报本轮识别到的全部记录，由后端统一去重、入库和通知。
        reporter.reportToBackend(observedRecords, summary);
    } else {
        log("本轮没有可上报的剧集识别结果");
    }

    // 发送心跳
    reporter.sendHeartbeat("idle");

    log("采集结束：遍历账号 " + summary.scannedCount
        + " 个，成功 " + summary.successCount
        + " 个，失败 " + summary.failCount
        + " 个，新增记录 " + outputRecords.length + " 条");
}

main();
