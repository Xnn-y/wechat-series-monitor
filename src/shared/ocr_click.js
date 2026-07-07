/**
 * OCR 屏幕点击模块
 *
 * 核心流程：
 *   截图 → (可选裁剪ROI) → OCR识别 → 按文字匹配 → 计算屏幕坐标 → click(x, y)
 *
 * 对外接口：
 *   ocrClick(opts)          单目标点击，找到文字就点
 *   ocrFindPoint(opts)      只查找不点击，返回坐标
 *   ocrClickSequence(list)  按顺序执行多个点击
 */

module.exports = {
    ocrClick: ocrClick,
    ocrFindPoint: ocrFindPoint,
    ocrClickSequence: ocrClickSequence,
    // 也暴露内部函数方便调试
    _ocrScreen: ocrScreen,
    _findTextInOcr: findTextInOcr
};

// ============================================================
// 公开接口
// ============================================================

/**
 * OCR 识别屏幕文字并点击
 *
 * opts:
 *   target        {string}   要匹配的目标文字
 *   roi           {number[]} 可选，ROI 区域 [xRatio, yRatio, wRatio, hRatio]，不传则全屏
 *   matchMode     {string}   "contains"(默认) | "exact" | "regex"
 *   fallback      {number[]} 备选点击比例坐标 [xRatio, yRatio]，OCR 未命中时使用
 *   clickDelay    {number}   点击后等待毫秒数，默认 500
 *   dryRun        {boolean}  仅查找不实际点击，默认 false
 *   debugDir      {string}   可选，调试输出目录，传入则保存截图/OCR JSON
 *   ocrMode       {string}   OCR 引擎，默认 "paddle"
 *   ocrFallbackModes {string[]} OCR fallback 列表
 *
 * 返回值:
 *   ok            {boolean}  是否成功执行点击
 *   clickPoint    {object}   {x, y} 实际点击坐标
 *   source        {string}   "ocr" | "fallback" | "skipped"
 *   ocrResult     {object}   原始 OCR 结果
 *   matchItem     {object}   匹配到的 OCR 条目
 *   screenshotPath {string}  截图保存路径(仅 debugDir 时)
 */
function ocrClick(opts) {
    opts = normalizeOpts(opts);
    var result = ocrFindPoint(opts);
    if (!result.ok) return result;

    result.executed = true;
    if (!opts.dryRun) {
        click(result.clickPoint.x, result.clickPoint.y);
        sleep(opts.clickDelay);
    }

    if (opts.debugDir) {
        files.write(opts.debugDir + "/ocr_click_result.json", JSON.stringify(result, null, 2));
    }
    return result;
}

/**
 * 只查找不点击，返回匹配坐标
 * 参数同 ocrClick
 */
function ocrFindPoint(opts) {
    opts = normalizeOpts(opts);
    var result = {
        ok: false,
        clickPoint: null,
        source: "",
        ocrResult: null,
        matchItem: null,
        skippedReason: "",
        target: opts.target,
        roi: opts.roi,
        fallback: opts.fallback
    };

    if (!requestScreenCapture()) {
        result.skippedReason = "请求截图权限失败";
        return result;
    }
    sleep(300);

    var img = captureScreen();
    if (!img) {
        result.skippedReason = "captureScreen() 返回空";
        return result;
    }

    try {
        // 确定 OCR 区域
        var region = null;
        if (opts.roi) {
            region = normalizeRegion(opts.roi, img.getWidth(), img.getHeight());
        }

        // 保存截图（调试模式）
        if (opts.debugDir) {
            result.screenshotPath = opts.debugDir + "/ocr_click_screenshot.png";
            images.save(img, result.screenshotPath);
        }

        // 执行 OCR
        result.ocrResult = ocrScreen(img, region, opts);
        if (opts.debugDir) {
            files.write(opts.debugDir + "/ocr_click_ocr.json", JSON.stringify(result.ocrResult, null, 2));
        }

        // 匹配目标文字
        var match = findTextInOcr(result.ocrResult, opts.target, opts.matchMode);
        if (match) {
            var screenPoint = boundsCenter(match.bounds || {}, region);
            result.ok = true;
            result.source = "ocr";
            result.clickPoint = screenPoint;
            result.matchItem = match;
            return result;
        }

        // OCR 未命中，尝试 fallback
        if (opts.fallback && opts.fallback.length >= 2) {
            result.ok = true;
            result.source = "fallback";
            result.clickPoint = {
                x: Math.round(device.width * opts.fallback[0]),
                y: Math.round(device.height * opts.fallback[1])
            };
            result.skippedReason = "";
            return result;
        }

        result.skippedReason = "OCR 未匹配到目标文字 (" + opts.target + ")，且无 fallback 坐标";
        return result;
    } catch (e) {
        result.skippedReason = "异常: " + String(e);
        return result;
    } finally {
        if (img) img.recycle();
    }
}

/**
 * 按顺序执行多个点击
 *
 * list: [{label, target, roi, ...}, ...]
 *
 * 每个元素的 label 字段为可读名称，其余字段同 ocrClick 的 opts
 * 遇到失败会中止后续点击（除非 skipOnFail: true）
 *
 * 返回 {allOk, results: [{ok, label, ...}]}
 */
function ocrClickSequence(list, baseOpts) {
    baseOpts = baseOpts || {};
    var results = [];
    var allOk = true;

    for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var opts = {};
        for (var k in baseOpts) {
            if (baseOpts.hasOwnProperty(k)) opts[k] = baseOpts[k];
        }
        for (var k2 in item) {
            if (item.hasOwnProperty(k2)) opts[k2] = item[k2];
        }
        opts.label = item.label || ("步骤" + (i + 1));

        var res = ocrClick(opts);
        res.label = opts.label;
        results.push(res);

        if (!res.ok && !item.skipOnFail) {
            allOk = false;
            break;
        }
    }

    return {
        allOk: allOk,
        results: results
    };
}

// ============================================================
// 内部函数
// ============================================================

function normalizeOpts(opts) {
    return {
        target: String(opts.target || ""),
        roi: opts.roi || null,
        matchMode: opts.matchMode || "contains",
        fallback: opts.fallback || null,
        clickDelay: Number(opts.clickDelay || 500),
        dryRun: !!opts.dryRun,
        debugDir: opts.debugDir || null,
        ocrMode: opts.ocrMode || "paddle",
        ocrFallbackModes: opts.ocrFallbackModes || ["paddle", "mlkit", "rapid", "generic"],
        useSlim: opts.useSlim !== undefined ? opts.useSlim : true,
        cpuThreadNum: opts.cpuThreadNum || 4,
        useOpenCL: !!opts.useOpenCL
    };
}

/**
 * 执行 OCR
 * @param {Image} img      截图对象
 * @param {number[]} region 像素坐标 ROI [x, y, w, h]，null 为全屏
 * @param {object} opts    配置
 */
function ocrScreen(img, region, opts) {
    var baseOptions = {
        useSlim: opts.useSlim,
        cpuThreadNum: opts.cpuThreadNum,
        useOpenCL: opts.useOpenCL
    };
    if (region) baseOptions.region = region;

    var modes = opts.ocrFallbackModes.slice();
    if (modes.indexOf(opts.ocrMode) < 0) modes.unshift(opts.ocrMode);

    var errors = [];
    for (var i = 0; i < modes.length; i++) {
        var mode = modes[i];
        var attempt = tryOcrMode(img, baseOptions, mode);
        if (attempt.ok) {
            return {
                available: true,
                mode: mode,
                region: region,
                count: ocrResultLength(attempt.raw),
                items: normalizeOcrItems(attempt.raw),
                fallbackErrors: errors
            };
        }
        errors.push(mode + ": " + attempt.error);
    }

    return {
        available: false,
        mode: modes.join(","),
        region: region,
        count: 0,
        items: [],
        error: errors.join(" | "),
        errors: errors
    };
}

function tryOcrMode(img, baseOptions, mode) {
    if (typeof ocr === "undefined") {
        return { ok: false, error: "当前 AutoJs6 环境未暴露 ocr" };
    }

    var options = {};
    for (var key in baseOptions) {
        if (baseOptions.hasOwnProperty(key)) options[key] = baseOptions[key];
    }

    try {
        if (mode === "paddle") {
            if (ocr.paddle && ocr.paddle.detect) {
                return { ok: true, raw: ocr.paddle.detect(img, options) };
            }
            if (ocr.detect) {
                options.mode = "paddle";
                return { ok: true, raw: ocr.detect(img, options) };
            }
            return { ok: false, error: "未找到 paddle.detect 或 ocr.detect" };
        }
        if (mode === "mlkit" && ocr.mlkit && ocr.mlkit.detect) {
            return { ok: true, raw: ocr.mlkit.detect(img, options) };
        }
        if (mode === "rapid" && ocr.rapid && ocr.rapid.detect) {
            return { ok: true, raw: ocr.rapid.detect(img, options) };
        }
        if (mode !== "generic") options.mode = mode;
        if (ocr.detect) return { ok: true, raw: ocr.detect(img, options) };
        return { ok: false, error: "未找到可用 OCR detect 接口" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

function ocrResultLength(results) {
    if (!results) return 0;
    if (typeof results.length === "number") return results.length;
    try {
        if (typeof results.size === "function") return results.size();
    } catch (e) {}
    return 0;
}

function normalizeOcrItems(results) {
    var out = [];
    if (!results) return out;
    var count = ocrResultLength(results);
    for (var i = 0; i < count; i++) {
        var item = getResultItem(results, i);
        if (!item) continue;
        out.push({
            label: item.label || item.text || "",
            confidence: item.confidence,
            bounds: rectToObject(item.bounds)
        });
    }
    return out;
}

function getResultItem(results, index) {
    try {
        if (typeof results.get === "function") return results.get(index);
        return results[index];
    } catch (e) {}
    return null;
}

function rectToObject(rect) {
    if (!rect) return null;
    return {
        left: Number(rect.left || 0),
        top: Number(rect.top || 0),
        right: Number(rect.right || 0),
        bottom: Number(rect.bottom || 0)
    };
}

/**
 * 在 OCR 结果中查找匹配的文字条目
 *
 * @param {object} ocrResult  OCR 结果 {items: [{label, bounds}]}
 * @param {string} target     目标文字
 * @param {string} mode       "exact" | "contains" | "regex"
 * @returns {object|null}     匹配的条目，或 null
 */
function findTextInOcr(ocrResult, target, mode) {
    if (!ocrResult || !ocrResult.items || !ocrResult.items.length) return null;
    if (!target) return null;

    var cleanTarget = cleanText(target);

    for (var i = 0; i < ocrResult.items.length; i++) {
        var item = ocrResult.items[i];
        var label = cleanText(item.label || "");
        if (!label) continue;

        if (mode === "exact") {
            if (label === cleanTarget) return item;
        } else if (mode === "regex") {
            try {
                if (new RegExp(target).test(label)) return item;
            } catch (e) {}
        } else {
            // "contains" 模式（默认）：双向包含
            if (label.indexOf(cleanTarget) >= 0 || cleanTarget.indexOf(label) >= 0) {
                return item;
            }
        }
    }
    return null;
}

/**
 * 计算 bounds 在屏幕上的中心像素坐标
 * 如果提供了 region 偏移量，将 ROI 内坐标映射回屏幕坐标
 */
function boundsCenter(bounds, region) {
    var left = Number(bounds.left || 0);
    var top = Number(bounds.top || 0);
    var right = Number(bounds.right || 0);
    var bottom = Number(bounds.bottom || 0);

    // 如果是 ROI 裁剪后的坐标，映射回屏幕坐标
    if (region && right <= region[2] + 10 && bottom <= region[3] + 10) {
        left += region[0];
        right += region[0];
        top += region[1];
        bottom += region[1];
    }

    return {
        x: Math.round((left + right) / 2),
        y: Math.round((top + bottom) / 2)
    };
}

/**
 * 将比例坐标 ROI 转为像素坐标
 * region: [xRatio, yRatio, wRatio, hRatio]，值为 0~1 的比例时自动换算
 */
function normalizeRegion(region, width, height) {
    var x = normVal(region[0], width);
    var y = normVal(region[1], height);
    var w = normVal(region[2], width);
    var h = normVal(region[3], height);

    if (w === 0 || w < 0) w = width - x;
    if (h === 0 || h < 0) h = height - y;

    x = clamp(Math.round(x), 0, width - 1);
    y = clamp(Math.round(y), 0, height - 1);
    w = clamp(Math.round(w), 1, width - x);
    h = clamp(Math.round(h), 1, height - y);

    return [x, y, w, h];
}

function normVal(value, total) {
    if (value > -1 && value < 1) return value * total;
    return value;
}

function cleanText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
}

function clamp(val, min, max) {
    if (isNaN(val)) return min;
    return Math.max(min, Math.min(max, val));
}
