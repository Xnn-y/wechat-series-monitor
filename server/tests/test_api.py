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
    assert data["inserted"] == 2     # 第3条是重复的
    assert data["duplicates"] == 1
    print(f"  [PASS] POST /api/collect -> received=3 inserted=2 duplicates=1")


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


def test_get_records():
    """8. 查询记录"""
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
    assert data3["total"] == 2
    assert all(r["run_id"] == "20260709_test_001" for r in data3["records"])
    print(f"  [PASS] GET /api/records?run_id=20260709_test_001 -> total={data3['total']}")


def test_get_runs():
    """9. 查询采集轮次"""
    app = create_app()
    client = app.test_client()

    resp = client.get("/api/runs", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert len(data["runs"]) >= 2
    print(f"  [PASS] GET /api/runs -> {len(data['runs'])} runs")


def test_get_summary():
    """10. 团队后台总览"""
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
    """11. CSV 导出"""
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
    test_get_records()
    test_get_runs()
    test_get_summary()
    test_export_csv()
    print("\n===== 全部 11 项测试通过 ✅ =====")
