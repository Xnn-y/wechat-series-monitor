"""server/src/services/notifier.py - 企业微信群机器人通知"""
import requests
from src.config.settings import settings


def send_new_records_notification(run_id: str, device: str, finished_at: str,
                                  inserted_records: list[dict]) -> bool:
    """发送企业微信通知：本轮新增剧集摘要"""
    webhook_url = settings.WECOM_WEBHOOK_URL
    if not webhook_url or "change_me" in webhook_url:
        print(f"[NOTIFIER] Webhook 未配置，跳过通知。run_id={run_id} 新增={len(inserted_records)}")
        return False

    inserted_count = len(inserted_records)
    max_show = 10  # 最多展示前10条
    record_lines = []
    for i, rec in enumerate(inserted_records[:max_show]):
        episodes = rec.get('episodes', '')
        line = f"{i + 1}. {rec['account']} / {rec['series']}"
        if episodes:
            line += f" {episodes}"
        record_lines.append(line)

    if inserted_count > max_show:
        record_lines.append(f"... 等共 {inserted_count} 条新增")

    markdown_content = (
        f"## 剧集更新监控\n"
        f"本轮新增：**{inserted_count}** 条\n"
        f"采集设备：{device}\n"
        f"采集时间：{finished_at}\n"
    )
    if record_lines:
        markdown_content += "\n" + "\n".join(record_lines)
    dashboard_url = build_dashboard_url()
    if dashboard_url:
        markdown_content += f"\n\n[查看后台]({dashboard_url})"

    payload = {
        "msgtype": "markdown",
        "markdown": {
            "content": markdown_content,
        },
    }

    try:
        resp = requests.post(webhook_url, json=payload, timeout=10)
        success = resp.status_code == 200 and resp.json().get("errcode") == 0
        if not success:
            print(f"[NOTIFIER] 发送失败: {resp.status_code} {resp.text}")
        return success
    except requests.RequestException as e:
        print(f"[NOTIFIER] 请求异常: {e}")
        return False


def send_alert_notification(alerts: list[dict]) -> bool:
    """发送告警通知：心跳超时、连续零新增等"""
    webhook_url = settings.WECOM_WEBHOOK_URL
    if not webhook_url or "change_me" in webhook_url:
        print(f"[NOTIFIER] Webhook 未配置，跳过告警。告警数={len(alerts)}")
        return False

    if not alerts:
        return False

    lines = [
        "## ⚠️ 采集系统告警",
        "",
    ]
    for a in alerts:
        icon = {"heartbeat_timeout": "💔", "zero_insert": "📭"}.get(a["type"], "⚠️")
        lines.append(f"{icon} {a['message']}")

    dashboard_url = build_dashboard_url()
    if dashboard_url:
        lines.extend(["", f"[查看后台]({dashboard_url})"])

    markdown_content = "\n".join(lines)
    payload = {"msgtype": "markdown", "markdown": {"content": markdown_content}}

    try:
        resp = requests.post(webhook_url, json=payload, timeout=10)
        success = resp.status_code == 200 and resp.json().get("errcode") == 0
        if not success:
            print(f"[NOTIFIER] 告警发送失败: {resp.status_code} {resp.text}")
        return success
    except requests.RequestException as e:
        print(f"[NOTIFIER] 告警请求异常: {e}")
        return False


def build_dashboard_url() -> str:
    """Return the public dashboard URL configured for notification links."""
    base_url = (settings.PUBLIC_BASE_URL or "").strip().rstrip("/")
    if not base_url or "change_me" in base_url:
        return ""
    return base_url + "/dashboard"
