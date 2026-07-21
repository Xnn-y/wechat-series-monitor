import os
import sys

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///server/data/collector.test.db"
os.environ["COLLECTOR_TOKEN"] = "dev_token"
os.environ["AI_RECOGNITION_PROVIDER"] = "mock"
os.environ["AI_MAX_SCREENS_PER_ACCOUNT"] = "6"
os.environ["AI_MAX_NO_NEW_SCREENS"] = "2"
os.environ["AI_MAX_SERIES_PER_ACCOUNT"] = "12"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.app import create_app


HEADERS = {"X-Collector-Token": "dev_token"}
IMAGE_BASE64 = "aGVsbG8="


def test_recognize_series_and_summary():
    app = create_app()
    client = app.test_client()
    run_id = "test_recognition_run"

    resp = client.post(
        "/api/collector/series/recognize",
        json={
            "run_id": run_id,
            "account": "account_a",
            "screen_index": 0,
            "image_base64": IMAGE_BASE64,
            "image_format": "jpg",
            "mock_titles": ["Title A", "Title B"],
        },
        headers=HEADERS,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["titles"] == ["TitleA", "TitleB"]
    assert data["new_titles"] == ["TitleA", "TitleB"]
    assert data["should_continue"] is True
    assert data["usage"]["screen_calls_for_run"] == 1

    resp2 = client.get(
        f"/api/collector/series/recognize/summary?run_id={run_id}",
        headers=HEADERS,
    )
    assert resp2.status_code == 200
    summary = resp2.get_json()
    assert summary["ok"] is True
    assert summary["ai_usage"]["calls"] == 1
    assert summary["ai_usage"]["success_calls"] == 1
    assert summary["ai_usage"]["total_tokens"] == 0


def test_recognize_series_no_new_stop():
    app = create_app()
    client = app.test_client()
    run_id = "test_no_new_stop"

    for index in range(3):
        resp = client.post(
            "/api/collector/series/recognize",
            json={
                "run_id": run_id,
                "account": "account_a",
                "screen_index": index,
                "image_base64": IMAGE_BASE64,
                "image_format": "jpg",
                "mock_titles": ["Title A"],
            },
            headers=HEADERS,
        )
        assert resp.status_code == 200
        data = resp.get_json()

    assert data["new_titles"] == []
    assert data["should_continue"] is False
    assert data["reason"] == "no_new_series_limit"


def test_recognize_series_keeps_leading_digits():
    app = create_app()
    client = app.test_client()
    run_id = "test_leading_digits"

    resp = client.post(
        "/api/collector/series/recognize",
        json={
            "run_id": run_id,
            "account": "account_a",
            "screen_index": 0,
            "image_base64": IMAGE_BASE64,
            "image_format": "jpg",
            "mock_titles": ["1980的救赎"],
        },
        headers=HEADERS,
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["titles"] == ["1980的救赎"]
