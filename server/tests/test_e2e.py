"""server/tests/test_e2e.py - 端到端模拟 AutoJs6 上报"""
import sys
import os

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///server/data/collector.test.db"
os.environ["ADMIN_PASSWORD"] = "admin123"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.app import create_app
from src.db import DB_PATH

# 清理
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

app = create_app()
client = app.test_client()
admin_headers = {"X-Admin-Password": "admin123"}

# 模拟 AutoJs6 reporter 上报格式
payload = {
    "device": "huawei_p30_01",
    "run_id": "20260709_143000",
    "started_at": "2026-07-09 14:30:00",
    "finished_at": "2026-07-09 14:35:00",
    "records": [
        {"account_name": "萌萌虎剧场", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 14:32:10"},
        {"account_name": "星辰短剧", "series_name": "重生之都市仙尊", "episodes": "32集", "collected_at": "2026-07-09 14:33:00"},
        {"account_name": "微风剧场", "series_name": "总裁的秘密恋人", "episodes": "55集", "collected_at": "2026-07-09 14:34:00"},
    ],
}

resp = client.post("/api/collect", json=payload, headers={"X-Collector-Token": "dev_token"})
print("=== 上报结果 ===")
data = resp.get_json()
print(f"ok: {data['ok']}")
print(f"received: {data['received']}")
print(f"inserted: {data['inserted']}")
print(f"duplicates: {data['duplicates']}")
print(f"notified: {data['notified']}")

# 模拟第二轮上报（含重复数据）
payload2 = {
    "device": "huawei_p30_01",
    "run_id": "20260709_150000",
    "started_at": "2026-07-09 15:00:00",
    "finished_at": "2026-07-09 15:05:00",
    "records": [
        {"account_name": "萌萌虎剧场", "series_name": "海带崩盘前，全村骂我是骗子", "episodes": "49集", "collected_at": "2026-07-09 15:02:00"},
        {"account_name": "新剧场", "series_name": "新的开始", "episodes": "20集", "collected_at": "2026-07-09 15:03:00"},
    ],
}

resp2 = client.post("/api/collect", json=payload2, headers={"X-Collector-Token": "dev_token"})
print()
print("=== 第二轮上报（含重复） ===")
data2 = resp2.get_json()
print(f"inserted: {data2['inserted']} (应为 1)")
print(f"duplicates: {data2['duplicates']} (应为 1)")

# 查询总记录数
resp3 = client.get("/api/records", headers=admin_headers)
total = resp3.get_json()["total"]
print()
print(f"=== 数据库总记录: {total} (应为 4) ===")
if total == 4:
    print("✅ 端到端测试通过")
else:
    print(f"❌ 失败: 期望 4, 实际 {total}")
