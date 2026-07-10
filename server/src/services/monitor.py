"""server/src/services/monitor.py - 心跳监控 + 异常检测"""
from src.db import get_connection
from src.config.settings import settings
from src.services.notifier import send_alert_notification


# 心跳超时阈值（分钟）
HEARTBEAT_TIMEOUT_MINUTES = settings.DEVICE_OFFLINE_MINUTES

# 连续零新增轮次报警阈值
CONSECUTIVE_ZERO_INSERT_THRESHOLD = 3


def record_heartbeat(device_name: str, status: str = "alive") -> None:
    """记录一次设备心跳"""
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO devices (name, first_seen, last_seen)
               VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(name) DO UPDATE SET last_seen = CURRENT_TIMESTAMP""",
            (device_name,),
        )
        # 更新设备最后在线时间
        conn.execute(
            "UPDATE devices SET last_seen = CURRENT_TIMESTAMP WHERE name = ?",
            (device_name,),
        )
        # 写入心跳日志
        conn.execute(
            "INSERT INTO heartbeat_logs (device_name, status) VALUES (?, ?)",
            (device_name, status),
        )
        conn.commit()
    finally:
        conn.close()


def check_device_health() -> list[dict]:
    """检查所有设备心跳，返回超时设备列表"""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT name, first_seen, last_seen,
                      CAST((julianday('now') - julianday(last_seen)) * 24 * 60 AS INTEGER) AS minutes_ago
               FROM devices
               WHERE minutes_ago > ?
               ORDER BY minutes_ago DESC""",
            (HEARTBEAT_TIMEOUT_MINUTES,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def check_consecutive_zero_runs(device_name: str) -> int:
    """检查某设备最近连续几轮 inserted=0，返回连续次数"""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT inserted FROM collection_runs
               WHERE device_name = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (device_name, CONSECUTIVE_ZERO_INSERT_THRESHOLD),
        ).fetchall()

        count = 0
        for r in rows:
            if r["inserted"] == 0:
                count += 1
            else:
                break
        return count
    finally:
        conn.close()


def run_health_check() -> dict:
    """执行一次健康检查，返回异常摘要"""
    alerts = []

    # 1. 心跳超时检查
    timeout_devices = check_device_health()
    for dev in timeout_devices:
        msg = f"设备 {dev['name']} 心跳超时，已离线 {dev['minutes_ago']} 分钟"
        alerts.append({"type": "heartbeat_timeout", "message": msg, "device": dev["name"]})

    # 2. 连续零新增检查
    conn = get_connection()
    try:
        devices = conn.execute("SELECT DISTINCT device_name FROM collection_runs ORDER BY device_name").fetchall()
    finally:
        conn.close()

    for dev in devices:
        zero_count = check_consecutive_zero_runs(dev["device_name"])
        if zero_count >= CONSECUTIVE_ZERO_INSERT_THRESHOLD:
            msg = f"设备 {dev['device_name']} 连续 {zero_count} 轮采集无新增，请检查"
            alerts.append({"type": "zero_insert", "message": msg, "device": dev["device_name"]})

    # 3. 如有告警则发送通知
    if alerts:
        send_alert_notification(alerts)

    return {
        "ok": True,
        "checked_at": None,  # will be set by caller
        "timeout_devices": len(timeout_devices),
        "alerts": alerts,
    }
