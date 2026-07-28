"""企业微信通知内容测试。"""
import os
import sys
from unittest.mock import Mock, patch

os.environ["APP_ENV"] = "test"
os.environ["WECOM_WEBHOOK_URL"] = "https://example.test/wecom"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.services.notifier import send_new_records_notification


def make_records(count: int) -> list[dict]:
    return [
        {"account": "测试账号", "series": f"测试剧名{i:02d}", "episodes": ""}
        for i in range(1, count + 1)
    ]


def send_and_get_content(records: list[dict]) -> str:
    response = Mock(status_code=200)
    response.json.return_value = {"errcode": 0}

    with (
        patch("src.services.notifier.settings.WECOM_WEBHOOK_URL", "https://example.test/wecom"),
        patch("src.services.notifier.requests.post", return_value=response) as post,
    ):
        assert send_new_records_notification(
            run_id="notification_limit_test",
            device="test_device",
            finished_at="2026-07-28 10:00:00",
            inserted_records=records,
        ) is True

    return post.call_args.kwargs["json"]["markdown"]["content"]


def test_notification_displays_25_records():
    content = send_and_get_content(make_records(25))

    assert "1. 测试账号 / 测试剧名01" in content
    assert "25. 测试账号 / 测试剧名25" in content
    assert "等共" not in content


def test_notification_truncates_after_25_records():
    content = send_and_get_content(make_records(30))

    assert "25. 测试账号 / 测试剧名25" in content
    assert "测试剧名26" not in content
    assert "... 等共 30 条新增" in content
