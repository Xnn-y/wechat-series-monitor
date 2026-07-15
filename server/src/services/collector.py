"""server/src/services/collector.py - 采集数据写入 + 去重"""
import re
import sqlite3
from src.db import get_connection


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


def sanitize_series_title(text: str) -> str:
    """剧名只保留中文、字母、数字、逗号和冒号。"""
    if not text:
        return ""

    text = str(text).strip().replace("，", ",").replace("：", ":")
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
            account_norm = normalize_text(account_corrected)
            series_norm = normalize_text(series_corrected)

            if not account_norm or not series_norm:
                continue

            try:
                conn.execute(
                    """INSERT INTO series_records
                       (run_id, account_name_raw, series_name_raw, episodes_raw,
                        account_name_normalized, series_name_normalized, collected_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (run_id, account_raw, series_corrected, episodes_raw,
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
        "inserted_records": inserted_records,
    }
