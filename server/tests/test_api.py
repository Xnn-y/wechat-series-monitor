"""
server/tests/test_api.py - 后端 MVP 功能测试

运行方式（在项目根目录,要确认 server/.env 已配置）:
    cd server
    pip install -r requirements.txt
    python -m pytest tests/test_api.py -v
    或者直接运行:
    python tests/test_api.py
"""
import json
import sys
import os
from unittest.mock import patch

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///server/data/collector.test.db"
os.environ["ADMIN_PASSWORD"] = "admin123"
os.environ["WECOM_WEBHOOK_URL"] = "change_me"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.app import create_app
from src.db import init_db, get_connection, DB_PATH
import os as _os

ADMIN_HEADERS = {"X-Admin-Password": "admin123"}


def setup_module():
    """测试前：清理并重建数据库"""
    if _os.path.exists(DB_PATH):
        _os.remove(DB_PATH)
    init_db()


def test_health():
    """1. 健康检查"""
    app = create_app()
    client = app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "record_count" in data
    print(f"  [PASS] GET /health -> {data}")


def test_collect_no_token():
    """2. 无 Token 应返回 401"""
    app = create_app()
    client = app.test_client()
    resp = client.post("/api/collect", json={})
    assert resp.status_code == 401
    print(f"  [PASS] 无Token -> 401")


def test_standard_accounts():
    """3. 标准账号库查询与维护"""
    app = create_app()
    client = app.test_client()

    blocked = client.get("/api/standard-accounts")
    assert blocked.status_code == 401

    resp = client.get(
        "/api/standard-accounts",
        headers={"X-Collector-Token": "dev_token"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    names = data["names"]
    assert "鬼谷剧场" in names
    assert "白脸蛋剧场" in names
    assert "金天漫剧" in names
    assert "陈先生勒剧场" in names
    assert "新想象AI短剧" in names

    resp2 = client.post(
        "/api/standard-accounts",
        json={"name": "测试标准账号"},
        headers=ADMIN_HEADERS,
    )
    assert resp2.status_code == 200
    created = resp2.get_json()["account"]
    assert created["name"] == "测试标准账号"

    resp3 = client.delete(
        f"/api/standard-accounts/{created['id']}",
        headers=ADMIN_HEADERS,
    )
    assert resp3.status_code == 200
    assert resp3.get_json()["ok"] is True
    print("  [PASS] 标准账号库 -> token 查询/admin 增删")


def test_collect_with_token():
    """4. 正常上报（含 Token）"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_001",
        "started_at": "2026-07-09 14:30:00",
        "finished_at": "2026-07-09 14:35:00",
        "records": [
            {"account_name": "萌萌虎剧场", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 14:32:10"},
            {"account_name": "星辰短剧", "series_name": "重生之都市仙尊", "episodes": "32集", "collected_at": "2026-07-09 14:33:00"},
            {"account_name": "萌萌虎剧场", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 14:34:00"},
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["received"] == 3
    assert data["inserted"] == 1     # 第2条非标准账号被拒绝，第3条是重复的
    assert data["duplicates"] == 1
    assert data["rejected_accounts"] == 1
    print(f"  [PASS] POST /api/collect -> received=3 inserted=1 duplicates=1 rejected_accounts=1")


def test_dedup():
    """5. 重复上报不应新增"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_002",
        "started_at": "2026-07-09 15:00:00",
        "finished_at": "2026-07-09 15:05:00",
        "records": [
            {"account_name": "萌萌虎剧场", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 15:02:00"},
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["ok"] is True
    assert data["inserted"] == 0
    assert data["duplicates"] == 1
    print(f"  [PASS] 去重测试 -> inserted=0 duplicates=1")


def test_normalization_dedup():
    """6. 归一化去重：空格/标点差异应视为重复"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_003",
        "started_at": "2026-07-09 16:00:00",
        "finished_at": "2026-07-09 16:05:00",
        "records": [
            # 加多余空格，应与"萌萌虎剧场 / 海带崩盘前..."重复
            {"account_name": " 萌萌虎剧场 ", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 16:02:00"},
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["inserted"] == 0
    assert data["duplicates"] == 1
    print(f"  [PASS] 归一化去重 -> inserted=0 duplicates=1 (空格被归一化)")


def test_series_title_symbol_sanitize():
    """7. 剧名只保留逗号、冒号这两类符号"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_symbols",
        "started_at": "2026-07-09 16:30:00",
        "finished_at": "2026-07-09 16:35:00",
        "records": [
            {"account_name": "江十三动画", "series_name": "|不再回头高价抢莓后,全村慌了", "episodes": "", "collected_at": "2026-07-09 16:31:00"},
            {"account_name": "江十三动画", "series_name": "人/离如婚自由|余额反转全家赶我走那天,我含泪看了眼余额", "episodes": "", "collected_at": "2026-07-09 16:32:00"},
            {"account_name": "江十三动画", "series_name": "讨情三万八,女屠户把破猪|场干成金饭碗", "episodes": "", "collected_at": "2026-07-09 16:33:00"},
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["ok"] is True
    assert data["inserted"] == 3

    resp2 = client.get("/api/records?run_id=20260709_test_symbols", headers=ADMIN_HEADERS)
    records = resp2.get_json()["records"]
    names = {r["series_name_raw"] for r in records}
    assert "不再回头高价抢莓后,全村慌了" in names
    assert "人离如婚自由余额反转全家赶我走那天,我含泪看了眼余额" in names
    assert "讨情三万八,女屠户把破猪场干成金饭碗" in names
    assert all("|" not in name and "/" not in name for name in names)
    print("  [PASS] 剧名符号清洗 -> 仅保留逗号和冒号")


def test_similar_series_dedup_same_account_only():
    """8. 同账号下高度相似剧名应视为重复，不影响其他账号"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_similar_titles",
        "started_at": "2026-07-09 17:00:00",
        "finished_at": "2026-07-09 17:05:00",
        "records": [
            {
                "account_name": "美好时光短剧场",
                "series_name": "后妈说她衣柜里没有人直播间网友笑疯了",
                "episodes": "",
                "collected_at": "2026-07-09 17:01:00",
            },
            {
                "account_name": "美好时光短剧场",
                "series_name": "后妈说她衣柜里没有人直播间网友疯了",
                "episodes": "",
                "collected_at": "2026-07-09 17:02:00",
            },
            {
                "account_name": "快乐时光短剧场",
                "series_name": "后妈说她衣柜里没有人直播间网友疯了",
                "episodes": "",
                "collected_at": "2026-07-09 17:03:00",
            },
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["ok"] is True
    assert data["received"] == 3
    assert data["inserted"] == 2
    assert data["duplicates"] == 1
    print("  [PASS] 同账号高度相似剧名去重 -> inserted=2 duplicates=1")


def test_single_character_series_dedup_and_notification():
    """同账号单字误差不入库、不通知，真实不同或跨账号剧名仍保留"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260727_test_single_character_titles",
        "started_at": "2026-07-27 14:00:00",
        "finished_at": "2026-07-27 14:05:00",
        "records": [
            {"account_name": "美好时光短剧场", "series_name": "九三重生之卡牌风云", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "九三重主之卡牌风云", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "我的稻虾田我说了算", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "我的稻虾田我说了算了", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "睿睿衣舍", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "睿睿别离", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "晚归", "episodes": ""},
            {"account_name": "美好时光短剧场", "series_name": "晚风", "episodes": ""},
            {"account_name": "快乐时光短剧场", "series_name": "九三重主之卡牌风云", "episodes": ""},
        ],
    }

    with patch("src.routes.api.send_new_records_notification", return_value=True) as notify:
        resp = client.post(
            "/api/collect",
            json=payload,
            headers={"X-Collector-Token": "dev_token"},
        )

    data = resp.get_json()
    assert data["ok"] is True
    assert data["received"] == 9
    assert data["inserted"] == 7
    assert data["duplicates"] == 2
    assert data["notified"] is True

    notified_records = notify.call_args.kwargs["inserted_records"]
    notified_pairs = {(row["account"], row["series"]) for row in notified_records}
    assert ("美好时光短剧场", "九三重主之卡牌风云") not in notified_pairs
    assert ("美好时光短剧场", "我的稻虾田我说了算了") not in notified_pairs
    assert ("美好时光短剧场", "九三重生之卡牌风云") in notified_pairs
    assert ("美好时光短剧场", "我的稻虾田我说了算") in notified_pairs
    assert ("美好时光短剧场", "睿睿衣舍") in notified_pairs
    assert ("美好时光短剧场", "睿睿别离") in notified_pairs
    assert ("美好时光短剧场", "晚归") in notified_pairs
    assert ("美好时光短剧场", "晚风") in notified_pairs
    assert ("快乐时光短剧场", "九三重主之卡牌风云") in notified_pairs

    resp2 = client.get(
        "/api/records?run_id=20260727_test_single_character_titles",
        headers=ADMIN_HEADERS,
    )
    stored_pairs = {
        (row["account_name_raw"], row["series_name_raw"])
        for row in resp2.get_json()["records"]
    }
    assert stored_pairs == notified_pairs
    print("  [PASS] 单字误差不入库通知，短剧名/真实不同剧名/跨账号剧名正常保留")


def test_reject_non_standard_account_records():
    """9. 无法匹配标准账号库的记录禁止入库"""
    app = create_app()
    client = app.test_client()

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_reject_unknown_account",
        "started_at": "2026-07-09 18:00:00",
        "finished_at": "2026-07-09 18:05:00",
        "records": [
            {
                "account_name": "不存在的脏账号",
                "series_name": "这条不能入库",
                "episodes": "",
                "collected_at": "2026-07-09 18:01:00",
            },
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["ok"] is True
    assert data["received"] == 1
    assert data["inserted"] == 0
    assert data["duplicates"] == 0
    assert data["rejected_accounts"] == 1

    resp2 = client.get("/api/records?run_id=20260709_test_reject_unknown_account", headers=ADMIN_HEADERS)
    assert resp2.get_json()["total"] == 0
    print("  [PASS] 非标准账号禁入库 -> rejected_accounts=1")


def test_loose_standard_account_match_for_ocr_noise():
    """10. 标准账号匹配允许头像前缀、连接符、少量 OCR 混淆"""
    app = create_app()
    client = app.test_client()

    create_resp = client.post(
        "/api/standard-accounts",
        json={"name": "驱督教育-智能ai"},
        headers=ADMIN_HEADERS,
    )
    assert create_resp.status_code == 200

    payload = {
        "device": "test_phone_01",
        "run_id": "20260709_test_loose_standard_account",
        "started_at": "2026-07-09 18:10:00",
        "finished_at": "2026-07-09 18:15:00",
        "records": [
            {
                "account_name": "QD驱督敦育-智能",
                "series_name": "头像前缀混入测试",
                "episodes": "",
                "collected_at": "2026-07-09 18:11:00",
            },
            {
                "account_name": "驱督数育-智能",
                "series_name": "末尾ai丢失测试",
                "episodes": "",
                "collected_at": "2026-07-09 18:12:00",
            },
        ],
    }

    resp = client.post(
        "/api/collect",
        json=payload,
        headers={"X-Collector-Token": "dev_token"},
    )
    data = resp.get_json()
    assert data["ok"] is True
    assert data["received"] == 2
    assert data["inserted"] == 2
    assert data["rejected_accounts"] == 0

    resp2 = client.get("/api/records?run_id=20260709_test_loose_standard_account", headers=ADMIN_HEADERS)
    records = resp2.get_json()["records"]
    assert len(records) == 2
    assert {r["account_name_raw"] for r in records} == {"驱督教育-智能ai"}
    print("  [PASS] 标准账号 OCR 宽松匹配 -> 驱督教育-智能ai")


def test_get_records():
    """11. 查询记录"""
    app = create_app()
    client = app.test_client()

    blocked = client.get("/api/records")
    assert blocked.status_code == 401

    resp = client.get("/api/records", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["total"] >= 2
    print(f"  [PASS] GET /api/records -> total={data['total']}")

    # 筛选测试
    resp2 = client.get("/api/records?account=萌萌虎", headers=ADMIN_HEADERS)
    data2 = resp2.get_json()
    assert data2["ok"] is True
    assert data2["total"] >= 1
    print(f"  [PASS] GET /api/records?account=萌萌虎 -> total={data2['total']}")

    resp3 = client.get("/api/records?run_id=20260709_test_001", headers=ADMIN_HEADERS)
    data3 = resp3.get_json()
    assert data3["ok"] is True
    assert data3["total"] == 1
    assert all(r["run_id"] == "20260709_test_001" for r in data3["records"])
    print(f"  [PASS] GET /api/records?run_id=20260709_test_001 -> total={data3['total']}")


def test_get_runs():
    """12. 查询采集轮次"""
    app = create_app()
    client = app.test_client()

    resp = client.get("/api/runs", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert len(data["runs"]) >= 2
    print(f"  [PASS] GET /api/runs -> {len(data['runs'])} runs")


def test_get_summary():
    """13. 团队后台总览"""
    app = create_app()
    client = app.test_client()

    blocked = client.get("/api/summary")
    assert blocked.status_code == 401

    resp = client.get("/api/summary", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "total_records" in data
    assert "today_records" in data
    assert "devices" in data
    assert "recent_runs" in data
    assert data["device_count"] >= 1
    print(f"  [PASS] GET /api/summary -> devices={data['device_count']} total={data['total_records']}")


def test_export_csv():
    """14. CSV 导出"""
    app = create_app()
    client = app.test_client()

    resp = client.get("/api/export.csv", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    csv_text = resp.data.decode("utf-8-sig")
    assert "账号" in csv_text
    assert "萌萌虎剧场" in csv_text
    print(f"  [PASS] GET /api/export.csv -> {len(csv_text)} bytes")


if __name__ == "__main__":
    setup_module()
    test_health()
    test_collect_no_token()
    test_standard_accounts()
    test_collect_with_token()
    test_dedup()
    test_normalization_dedup()
    test_series_title_symbol_sanitize()
    test_similar_series_dedup_same_account_only()
    test_single_character_series_dedup_and_notification()
    test_reject_non_standard_account_records()
    test_loose_standard_account_match_for_ocr_noise()
    test_get_records()
    test_get_runs()
    test_get_summary()
    test_export_csv()
    print("\n===== 全部 15 项测试通过 ✅ =====")
