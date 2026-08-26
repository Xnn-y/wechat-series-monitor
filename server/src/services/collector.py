"""server/src/services/collector.py - 采集数据写入 + 去重"""
import re
import sqlite3
from src.db import get_connection, normalize_standard_account_name


def normalize_text(text: str) -> str:
    """文本归一化：去空格、去标点差异、转小写"""
    if not text:
        return ""
    text = text.strip()
    # 去中文空格、全角空格
    text = re.sub(r"[\u3000\s]+", "", text)
    # 统一标点
    text = text.replace("：", ":").replace("，", ",").replace("。", ".")
    text = text.replace("（", "(").replace("）", ")")
    return text.lower()


def similar_series_key(text: str) -> str:
    return re.sub(r"[\u3000\s,，、。:：；;！？!?（）()\[\]【】《》\"'“”‘’._\-—–·|/\\]+", "", str(text or "")).lower()


def edit_distance(a: str, b: str) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def edit_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return 1.0 - edit_distance(a, b) / max(len(a), len(b))


def char_overlap_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    matched = sum(1 for ch in shorter if ch in longer)
    return matched / len(shorter)


def account_match_key(text: str, keep_ascii: bool = True) -> str:
    value = str(text or "").strip().lower()
    value = re.sub(r"[\u3000\s]+", "", value)
    # 头像/图标里的英文字母常被拼进账号名前缀，例如 QD驱督教育。
    value = re.sub(r"^[a-z]+(?=[\u3400-\u9fff])", "", value)
    value = (
        value.replace("敦", "教")
        .replace("数", "教")
        .replace("－", "-")
        .replace("—", "-")
        .replace("–", "-")
        .replace("一", "-")
    )
    value = re.sub(r"[-_·・.。,:：，、/\\|（）()\[\]【】《》\"'“”‘’]+", "", value)
    if not keep_ascii:
        value = re.sub(r"[a-z]+", "", value)
    return value


def account_key_match_score(raw_name: str, standard_name: str) -> float:
    raw_key = account_match_key(raw_name)
    standard_key = account_match_key(standard_name)
    if not raw_key or not standard_key:
        return 0.0
    if raw_key == standard_key:
        return 1.0

    raw_cjk_key = account_match_key(raw_name, keep_ascii=False)
    standard_cjk_key = account_match_key(standard_name, keep_ascii=False)
    if raw_cjk_key and standard_cjk_key:
        if raw_cjk_key == standard_cjk_key and min(len(raw_cjk_key), len(standard_cjk_key)) >= 4:
            return 0.98

        min_len = min(len(raw_cjk_key), len(standard_cjk_key))
        max_len = max(len(raw_cjk_key), len(standard_cjk_key))
        if min_len >= 5 and max_len - min_len <= 2:
            edit = edit_similarity(raw_cjk_key, standard_cjk_key)
            overlap = char_overlap_ratio(raw_cjk_key, standard_cjk_key)
            if edit >= 0.84 and overlap >= 0.84:
                return min(edit, overlap)

    return 0.0


def is_highly_similar_series_title(a: str, b: str) -> bool:
    ak = similar_series_key(a)
    bk = similar_series_key(b)
    if not ak or not bk:
        return False
    if ak == bk:
        return True
    min_len = min(len(ak), len(bk))
    max_len = max(len(ak), len(bk))
    length_gap = max_len - min_len
    # 同一标准账号下，4 字以上只相差一次增、删、改时按同一剧处理。
    # 2-3 字短剧名不做模糊合并，避免“晚归/晚风”这类真实不同剧名被过滤。
    if min_len >= 4 and length_gap <= 1 and edit_distance(ak, bk) <= 1:
        return True
    if min_len < 8:
        return False
    edit = edit_similarity(ak, bk)
    overlap = char_overlap_ratio(ak, bk)
    if length_gap <= 2 and edit >= 0.92 and overlap >= 0.96:
        return True
    if min_len >= 14 and length_gap <= 3 and edit >= 0.90 and overlap >= 0.95:
        return True
    return False


def has_similar_series_for_account(conn: sqlite3.Connection, account_norm: str, series_title: str) -> bool:
    rows = conn.execute(
        """SELECT series_name_raw
           FROM series_records
           WHERE account_name_normalized = ?
           ORDER BY created_at DESC
           LIMIT 200""",
        (account_norm,),
    ).fetchall()
    for row in rows:
        if is_highly_similar_series_title(series_title, row["series_name_raw"]):
            return True
    return False


def match_standard_account(conn: sqlite3.Connection, account_name: str) -> sqlite3.Row | None:
    account_norm = normalize_standard_account_name(account_name)
    if not account_norm:
        return None
    exact = conn.execute(
        """SELECT name, normalized_name
           FROM standard_accounts
           WHERE active = 1 AND normalized_name = ?""",
        (account_norm,),
    ).fetchone()
    if exact:
        return exact

    rows = conn.execute(
        """SELECT name, normalized_name
           FROM standard_accounts
           WHERE active = 1"""
    ).fetchall()
    scored = []
    for row in rows:
        score = account_key_match_score(account_name, row["name"])
        if score >= 0.84:
            scored.append((score, row))

    if not scored:
        return None

    scored.sort(key=lambda item: item[0], reverse=True)
    if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.03:
        return None
    return scored[0][1]


def sanitize_series_title(text: str) -> str:
    """剧名只保留中文、字母、数字、逗号和冒号。"""
    if not text:
        return ""

    text = str(text).strip().replace("，", ",").replace("：", ":").replace("銀", "银")
    chars = []
    for ch in text:
        code = ord(ch)
        if ch in {",", ":"}:
            chars.append(ch)
        elif "0" <= ch <= "9" or "A" <= ch <= "Z" or "a" <= ch <= "z":
            chars.append(ch)
        elif 0x4E00 <= code <= 0x9FFF or 0x3400 <= code <= 0x4DBF or 0xF900 <= code <= 0xFAFF:
            chars.append(ch)

    cleaned = "".join(chars)
    cleaned = re.sub(r"^[,:]+|[,:]+$", "", cleaned)
    cleaned = re.sub(r",{2,}", ",", cleaned)
    cleaned = re.sub(r":{2,}", ":", cleaned)
    return cleaned


def apply_ocr_aliases(text: str, field_type: str) -> str:
    """查 ocr_aliases 表，用修正后的文本替换 OCR 错误"""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT correct_text FROM ocr_aliases WHERE raw_text = ? AND field_type = ?",
            (text, field_type),
        ).fetchone()
        return row["correct_text"] if row else text
    finally:
        conn.close()


def upsert_device(conn: sqlite3.Connection, device_name: str):
    """记录或更新设备信息"""
    conn.execute(
        """INSERT INTO devices (name, first_seen, last_seen)
           VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT(name) DO UPDATE SET last_seen = CURRENT_TIMESTAMP""",
        (device_name,),
    )


def insert_run(conn: sqlite3.Connection, run_data: dict):
    """插入采集轮次记录"""
    conn.execute(
        """INSERT OR IGNORE INTO collection_runs
           (run_id, device_name, started_at, finished_at, received, inserted, duplicates)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            run_data["run_id"],
            run_data["device"],
            run_data["started_at"],
            run_data["finished_at"],
            run_data["received"],
            run_data["inserted"],
            run_data["duplicates"],
        ),
    )


def process_collect(payload: dict) -> dict:
    """
    处理一次采集上报：
    1. 注册/更新设备
    2. 逐条归一化 + OCR 别名修正
    3. 去重写入 series_records
    4. 写入 collection_runs
    返回 {ok, received, inserted, duplicates}
    """
    device = payload.get("device", "unknown")
    run_id = payload.get("run_id", "")
    started_at = payload.get("started_at", "")
    finished_at = payload.get("finished_at", "")
    records = payload.get("records", [])

    if not run_id or not records:
        return {"ok": False, "error": "run_id 和 records 不能为空"}

    received = len(records)
    inserted = 0
    duplicates = 0
    rejected_accounts = 0
    inserted_records = []

    conn = get_connection()
    try:
        upsert_device(conn, device)

        # 先插入 collection_run，满足 series_records 的外键约束
        insert_run(conn, {
            "run_id": run_id,
            "device": device,
            "started_at": started_at,
            "finished_at": finished_at,
            "received": received,
            "inserted": 0,       # 先占位，后续 UPDATE
            "duplicates": 0,
        })

        for rec in records:
            account_raw = rec.get("account_name", "")
            series_raw = rec.get("series_name", "")
            episodes_raw = rec.get("episodes", "")
            collected_at = rec.get("collected_at", finished_at or started_at)

            # OCR 别名修正
            account_corrected = apply_ocr_aliases(account_raw, "account")
            series_corrected = sanitize_series_title(apply_ocr_aliases(series_raw, "series"))

            # 归一化
            standard_account = match_standard_account(conn, account_corrected)
            if not standard_account:
                rejected_accounts += 1
                continue

            account_corrected = standard_account["name"]
            account_norm = normalize_text(account_corrected)
            series_norm = normalize_text(series_corrected)

            if not account_norm or not series_norm:
                continue

            if has_similar_series_for_account(conn, account_norm, series_corrected):
                duplicates += 1
                continue

            try:
                conn.execute(
                    """INSERT INTO series_records
                       (run_id, account_name_raw, series_name_raw, episodes_raw,
                        account_name_normalized, series_name_normalized, collected_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (run_id, account_corrected, series_corrected, episodes_raw,
                     account_norm, series_norm, collected_at),
                )
                inserted += 1
                inserted_records.append({
                    "account": account_corrected,
                    "series": series_corrected,
                    "episodes": episodes_raw,
                })
            except sqlite3.IntegrityError:
                # 违反唯一约束 = 重复
                duplicates += 1
                continue

        # 更新 run 的统计数
        conn.execute(
            """UPDATE collection_runs
               SET received = ?, inserted = ?, duplicates = ?
               WHERE run_id = ?""",
            (received, inserted, duplicates, run_id),
        )

        conn.commit()
    finally:
        conn.close()

    return {
        "ok": True,
        "received": received,
        "inserted": inserted,
        "duplicates": duplicates,
        "rejected_accounts": rejected_accounts,
        "inserted_records": inserted_records,
    }
