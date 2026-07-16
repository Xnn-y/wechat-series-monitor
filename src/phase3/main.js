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
        if (newCount === 0) {
            screen.scrollDownSeriesMore();
        } else {
            screen.scrollDown();
        }
        sleep(config.scrollWait);
    }

    return allNames.slice(0, config.maxSeries);
}

function markNewSeries(outputRecords, observedRecords, accountName, seriesNames) {
    var appended = 0;
    var rows = [];

    seriesNames.forEach(function (seriesName) {
        var collectTime = time.beijingTime();
        var row = {
            account: accountName,
            series: seriesName,
            collectTime: collectTime
        };
        observedRecords.push(row);
        outputRecords.push(row);
        rows.push(row);
        appended++;
        log("记录：" + accountName + " / " + seriesName);
    });

    if (rows.length > 0) {
        csvStore.appendCsv(rows);
    }

    return appended;
}

function collectAccount(account, outputRecords, observedRecords) {
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
    profileAccountName = pickTrustedProfileAccountName(account.label, profileAccountName);
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
    var appended = markNewSeries(outputRecords, observedRecords, accountNameForCsv, seriesNames);
    log("账号完成：" + accountNameForCsv + "，完整剧集 " + seriesNames.length + " 个，新增 " + appended + " 个");

    screen.goBack();
    sleep(config.pageDelay);
    return true;
}

function pickTrustedProfileAccountName(listName, profileName) {
    listName = accountParser.cleanAccountLabel(listName || "");
    profileName = accountParser.cleanAccountLabel(profileName || "");
    if (!profileName || profileName === listName) return listName;
    if (textUtils.hasTraditionalChinese(profileName)) {
        log("主页账号名含繁体，保留列表名：" + listName + " / " + profileName);
        return listName;
    }
    if (accountParser.hasNoisyAccountChars(profileName)) {
        log("主页账号名疑似误识别，保留列表名：" + listName + " / " + profileName);
        return listName;
    }
    var similarity = textUtils.similarityRatio(listName, profileName);
    if (similarity < (config.profileNameOverrideSimilarity || 0.78)) {
        log("主页账号名与列表名不一致，保留列表名：" + listName + " / " + profileName + " similarity=" + Math.round(similarity * 100));
        return listName;
    }
    return profileName;
}

function collectAccountsOnce(outputRecords, observedRecords) {
    var processedAccounts = {};
    var processedAccountLabels = [];
    var lastAccountLabel = "";
    var scannedCount = 0;
    var successCount = 0;
    var failCount = 0;
    var emptyPages = 0;
    var anchorSeekPages = 0;
    var revealNextPages = 0;
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
        var knownCandidates = [];
        var lastVisibleY = -1;
        visibleAccounts.forEach(function (account) {
            if (sameAccountLabel(account.label, lastAccountLabel)) {
                lastVisibleY = account.centerY;
            }

            if (isProcessedAccount(processedAccounts, processedAccountLabels, account.label)) {
                return;
            }

            candidates.push(account);
            if (textUtils.isKnownAccountName(account.label)) {
                knownCandidates.push(account);
            }
        });

        log("关注列表第 " + (step + 1) + " 次扫描，识别账号："
            + visibleAccounts.map(function (item) { return item.label; }).join(" | "));

        if (config.allowUnknownAccounts !== true && knownCandidates.length < candidates.length) {
            log("忽略非标准账号候选：" + candidates.filter(function (item) {
                return !textUtils.isKnownAccountName(item.label);
            }).map(function (item) { return item.label; }).join(" | "));
        }

        var pickCandidates = (config.allowUnknownAccounts === true && knownCandidates.length === 0)
            ? candidates
            : knownCandidates;
        var pickResult = pickNextAccount(pickCandidates, lastVisibleY, lastAccountLabel);
        targetAccount = pickResult.account;

        if (!targetAccount) {
            if (lastAccountLabel) {
                if (pickResult.anchorVisible) {
                    anchorSeekPages = 0;
                    revealNextPages++;
                    if (revealNextPages >= (config.maxRevealNextPages || 5)) {
                        warn("连续无法露出上次账号后的下一行，按关注列表已到底处理：" + lastAccountLabel);
                        endReason = "reached_list_bottom";
                        break;
                    }
                    log("上次账号仍在屏幕内但下一行未完整露出，继续下滑露出下一账号：" + lastAccountLabel);
                    screen.scrollDownRevealNextAccount();
                    sleep(config.scrollWait);
                    continue;
                }
                anchorSeekPages++;
                if (anchorSeekPages >= (config.maxAnchorSeekPages || 8)) {
                    warn("连续找不到上次账号锚点，结束遍历：" + lastAccountLabel);
                    endReason = "anchor_lost";
                    break;
                }
                screen.scrollDownSmall();
                sleep(config.scrollWait);
                continue;
            }
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
        anchorSeekPages = 0;
        revealNextPages = 0;
        rememberProcessedAccount(processedAccounts, processedAccountLabels, targetAccount.label);
        lastAccountLabel = targetAccount.label;
        scannedCount++;

        if (collectAccount(targetAccount, outputRecords, observedRecords)) {
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

function pickNextAccount(candidates, lastVisibleY, lastAccountLabel) {
    var result = { account: null, anchorVisible: lastVisibleY >= 0 };
    if (!candidates.length) return result;
    if (lastVisibleY >= 0) {
        var nearest = null;
        var nearestGap = 99999;
        for (var i = 0; i < candidates.length; i++) {
            var gap = candidates[i].centerY - lastVisibleY;
            if (gap > config.accountNextRowGap && gap < nearestGap) {
                nearest = candidates[i];
                nearestGap = gap;
            }
        }
        if (nearest && nearestGap <= (config.accountNextMaxGap || 180)) {
            log("选择上次账号下方最近一行：" + lastAccountLabel + " -> " + nearest.label + " gap=" + nearestGap);
            result.account = nearest;
            return result;
        }
        if (nearest) {
            log("下方最近账号距离过大，继续小幅下滑：" + lastAccountLabel + " -> " + nearest.label + " gap=" + nearestGap);
        } else {
            log("未找到紧挨上次账号的完整下一行，继续小幅下滑：" + lastAccountLabel);
        }
        return result;
    }
    if (lastAccountLabel) {
        log("本屏未看到上次账号锚点，继续小幅下滑寻找：" + lastAccountLabel);
        return result;
    }
    result.account = candidates[0];
    return result;
}

function rememberProcessedAccount(processedMap, processedLabels, label) {
    var key = textUtils.normalizeRecordKey(label);
    if (!key) return;
    var alreadyProcessed = isProcessedAccount(processedMap, processedLabels, label);
    processedMap[key] = true;
    if (!alreadyProcessed) {
        processedLabels.push(label);
    }
}

function isProcessedAccount(processedMap, processedLabels, label) {
    var key = textUtils.normalizeRecordKey(label);
    if (!key) return true;
    if (processedMap && processedMap[key]) return true;
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
    if (textUtils.isKnownAccountName(a) && textUtils.isKnownAccountName(b)) return false;
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

    var standardAccounts = reporter.fetchStandardAccounts();
    if (textUtils.setKnownAccountNames(standardAccounts)) {
        log("标准账号库已更新：" + textUtils.getKnownAccountNames().length + " 个");
    } else {
        log("使用内置标准账号库：" + textUtils.getKnownAccountNames().length + " 个");
    }

    screen.initCapture();

    var outputRecords = [];
    var observedRecords = [];
    var summary = collectAccountsOnce(outputRecords, observedRecords);

    finishRun(summary);

    if (outputRecords.length === 0) {
        log("没有新增剧集记录");
    } else {
        log("本地新增剧集记录 " + outputRecords.length + " 条");
    }

    if (observedRecords.length > 0) {
        // 上报本轮识别到的全部记录，由后端统一去重、入库和通知。
        var backendResult = reporter.reportToBackend(observedRecords, summary);
        if (backendResult && backendResult.ok && backendResult.inserted > 0) {
            var insertedRecs = backendResult.inserted_records || [];
            log("========== 本轮后端新增入库 " + insertedRecs.length + " 条 ==========");
            for (var ir = 0; ir < insertedRecs.length; ir++) {
                var rec = insertedRecs[ir];
                log(rec.account + " / " + rec.series + "  " + (rec.episodes || ""));
            }
            log("========================================");
        }
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
