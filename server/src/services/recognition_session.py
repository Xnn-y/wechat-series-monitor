"""Run/account state and bounded logs for backend AI recognition."""
import base64
import json
import os
import re
import shutil
import time
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List

from src.config.settings import settings
from src.services.ai_recognition import AiRecognitionError, recognize_account_list_image, recognize_series_image

ROOT = Path(__file__).resolve().parents[2] / "data" / "runtime" / "recognition_runs"
LOCK = Lock()
SESSIONS: Dict[str, Dict[str, Any]] = {}


def recognize_screen(payload: Dict[str, Any]) -> Dict[str, Any]:
    run_id = safe_name(payload.get("run_id") or datetime.now().strftime("%Y%m%d_%H%M%S"))
    account = str(payload.get("account") or "unknown").strip() or "unknown"
    screen_index = int(payload.get("screen_index") or 0)
    image_base64 = str(payload.get("image_base64") or "")
    image_format = str(payload.get("image_format") or "jpg")

    if not image_base64:
        return {"ok": False, "titles": [], "should_continue": False, "reason": "missing_image"}

    with LOCK:
        session = get_session(run_id)
        account_state = get_account_state(session, account)
        if session.get("disabled"):
            return stop_response(session, account_state, "ai_disabled_for_run")
        if session["usage"]["calls"] >= settings.AI_MAX_CALLS_PER_RUN:
            session["disabled"] = True
            session["disabled_reason"] = "max_calls_for_run"
            return stop_response(session, account_state, "max_calls_for_run")
        if account_state["screen_calls"] >= settings.AI_MAX_SCREENS_PER_ACCOUNT:
            return stop_response(session, account_state, "max_screens_for_account")
        account_state["screen_calls"] += 1
        session["usage"]["calls"] += 1

    screenshot_path = save_screenshot(run_id, account, screen_index, image_base64, image_format)
    try:
        ai_result = recognize_series_image(
            image_base64=image_base64,
            image_format=image_format,
            mock_titles=payload.get("mock_titles"),
        )
        titles = ai_result["titles"]
        with LOCK:
            session = get_session(run_id)
            account_state = get_account_state(session, account)
            new_titles = merge_new_titles(account_state["titles"], titles)
            if new_titles:
                account_state["no_new_count"] = 0
            else:
                account_state["no_new_count"] += 1
            add_usage(session, ai_result.get("usage") or {})
            session["usage"]["success_calls"] += 1
            should_continue, reason = decide_continue(account_state)
            result = {
                "ok": True,
                "titles": titles,
                "new_titles": new_titles,
                "all_titles_for_account": account_state["titles"][:settings.AI_MAX_SERIES_PER_ACCOUNT],
                "should_continue": should_continue,
                "reason": reason,
                "usage": response_usage(session, account_state, ai_result),
            }
            append_log(run_id, {
                "run_id": run_id,
                "account": account,
                "screen_index": screen_index,
                "ok": True,
                "titles": titles,
                "new_titles": new_titles,
                "latency_ms": ai_result.get("latency_ms", 0),
                "usage": ai_result.get("usage") or {},
            })
            write_summary(run_id, session)
        cleanup_screenshot_if_success(screenshot_path)
        cleanup_old_runs()
        return result
    except AiRecognitionError as exc:
        with LOCK:
            session = get_session(run_id)
            account_state = get_account_state(session, account)
            session["usage"]["failed_calls"] += 1
            if exc.usage:
                add_usage(session, exc.usage)
            if exc.fatal:
                session["disabled"] = True
                session["disabled_reason"] = str(exc)
            append_log(run_id, {
                "run_id": run_id,
                "account": account,
                "screen_index": screen_index,
                "ok": False,
                "error": str(exc),
                "fatal": exc.fatal,
            })
            write_summary(run_id, session)
            return {
                "ok": False,
                "titles": [],
                "new_titles": [],
                "all_titles_for_account": account_state["titles"],
                "should_continue": False,
                "reason": "ai_error",
                "error": str(exc),
                "usage": response_usage(session, account_state, {"usage": exc.usage}),
            }


def recognize_account_list_screen(payload: Dict[str, Any], standard_accounts: List[str]) -> Dict[str, Any]:
    run_id = safe_name(payload.get("run_id") or datetime.now().strftime("%Y%m%d_%H%M%S"))
    screen_index = int(payload.get("screen_index") or 0)
    image_base64 = str(payload.get("image_base64") or "")
    image_format = str(payload.get("image_format") or "jpg")
    account_key = "__account_list__"

    if not image_base64:
        return {"ok": False, "accounts": [], "reason": "missing_image"}

    with LOCK:
        session = get_session(run_id)
        account_state = get_account_state(session, account_key)
        if session.get("disabled"):
            return {
                "ok": True,
                "accounts": [],
                "reason": "ai_disabled_for_run",
                "usage": response_usage(session, account_state, {}),
            }
        if session["usage"]["calls"] >= settings.AI_MAX_CALLS_PER_RUN:
            session["disabled"] = True
            session["disabled_reason"] = "max_calls_for_run"
            return {
                "ok": True,
                "accounts": [],
                "reason": "max_calls_for_run",
                "usage": response_usage(session, account_state, {}),
            }
        account_state["screen_calls"] += 1
        session["usage"]["calls"] += 1

    screenshot_path = save_screenshot(run_id, "account_list", screen_index, image_base64, image_format)
    try:
        ai_result = recognize_account_list_image(
            image_base64=image_base64,
            image_format=image_format,
            standard_accounts=standard_accounts,
            mock_accounts=payload.get("mock_accounts"),
        )
        accounts = ai_result.get("accounts") or []
        with LOCK:
            session = get_session(run_id)
            account_state = get_account_state(session, account_key)
            add_usage(session, ai_result.get("usage") or {})
            session["usage"]["success_calls"] += 1
            result = {
                "ok": True,
                "accounts": accounts,
                "reason": "accounts_recognized" if accounts else "no_accounts",
                "usage": response_usage(session, account_state, ai_result),
            }
            append_log(run_id, {
                "run_id": run_id,
                "account": account_key,
                "screen_index": screen_index,
                "ok": True,
                "accounts": accounts,
                "latency_ms": ai_result.get("latency_ms", 0),
                "usage": ai_result.get("usage") or {},
            })
            write_summary(run_id, session)
        cleanup_screenshot_if_success(screenshot_path)
        cleanup_old_runs()
        return result
    except AiRecognitionError as exc:
        with LOCK:
            session = get_session(run_id)
            account_state = get_account_state(session, account_key)
            session["usage"]["failed_calls"] += 1
            if exc.usage:
                add_usage(session, exc.usage)
            if exc.fatal:
                session["disabled"] = True
                session["disabled_reason"] = str(exc)
            append_log(run_id, {
                "run_id": run_id,
                "account": account_key,
                "screen_index": screen_index,
                "ok": False,
                "error": str(exc),
                "fatal": exc.fatal,
            })
            write_summary(run_id, session)
            return {
                "ok": False,
                "accounts": [],
                "reason": "ai_error",
                "error": str(exc),
                "usage": response_usage(session, account_state, {"usage": exc.usage}),
            }


def get_summary(run_id: str) -> Dict[str, Any]:
    run_id = safe_name(run_id)
    with LOCK:
        if run_id in SESSIONS:
            write_summary(run_id, SESSIONS[run_id])
            return {"ok": True, **summary_payload(run_id, SESSIONS[run_id])}
    path = run_dir(run_id) / "summary.json"
    if path.exists():
        return {"ok": True, **json.loads(path.read_text(encoding="utf-8"))}
    return {"ok": False, "error": "summary not found"}


def get_session(run_id: str) -> Dict[str, Any]:
    if run_id not in SESSIONS:
        SESSIONS[run_id] = {
            "run_id": run_id,
            "started_at": datetime.now().isoformat(timespec="seconds"),
            "updated_at": datetime.now().isoformat(timespec="seconds"),
            "accounts": {},
            "disabled": False,
            "disabled_reason": "",
            "usage": {
                "calls": 0,
                "success_calls": 0,
                "failed_calls": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "total_tokens": 0,
                "usage_missing_calls": 0,
            },
        }
    return SESSIONS[run_id]


def get_account_state(session: Dict[str, Any], account: str) -> Dict[str, Any]:
    accounts = session.setdefault("accounts", {})
    if account not in accounts:
        accounts[account] = {"titles": [], "screen_calls": 0, "no_new_count": 0}
    return accounts[account]


def merge_new_titles(existing: List[str], titles: List[str]) -> List[str]:
    new_titles = []
    for title in titles:
        if not title_exists(existing, title):
            existing.append(title)
            new_titles.append(title)
    if len(existing) > settings.AI_MAX_SERIES_PER_ACCOUNT:
        del existing[settings.AI_MAX_SERIES_PER_ACCOUNT:]
    return new_titles


def title_exists(existing: List[str], title: str) -> bool:
    key = title_key(title)
    for item in existing:
        item_key = title_key(item)
        if key == item_key or key in item_key or item_key in key:
            return True
    return False


def title_key(title: str) -> str:
    return re.sub(r"[,:\s]+", "", str(title or "")).lower()


def decide_continue(account_state: Dict[str, Any]):
    if len(account_state["titles"]) >= settings.AI_MAX_SERIES_PER_ACCOUNT:
        return False, "max_series_reached"
    if account_state["screen_calls"] >= settings.AI_MAX_SCREENS_PER_ACCOUNT:
        return False, "max_screens_for_account"
    if account_state["no_new_count"] >= settings.AI_MAX_NO_NEW_SCREENS:
        return False, "no_new_series_limit"
    return True, "new_titles_found" if account_state["no_new_count"] == 0 else "no_new_series"


def add_usage(session: Dict[str, Any], usage: Dict[str, Any]):
    if not usage:
        session["usage"]["usage_missing_calls"] += 1
        return
    session["usage"]["input_tokens"] += int(usage.get("input_tokens") or 0)
    session["usage"]["output_tokens"] += int(usage.get("output_tokens") or 0)
    session["usage"]["total_tokens"] += int(usage.get("total_tokens") or 0)
    if not any(int(usage.get(k) or 0) for k in ("input_tokens", "output_tokens", "total_tokens")):
        session["usage"]["usage_missing_calls"] += 1


def response_usage(session: Dict[str, Any], account_state: Dict[str, Any], ai_result: Dict[str, Any]) -> Dict[str, Any]:
    usage = ai_result.get("usage") or {}
    return {
        "provider": settings.AI_RECOGNITION_PROVIDER,
        "model": settings.AI_RECOGNITION_MODEL,
        "latency_ms": int(ai_result.get("latency_ms") or 0),
        "screen_calls_for_account": account_state["screen_calls"],
        "screen_calls_for_run": session["usage"]["calls"],
        "input_tokens": int(usage.get("input_tokens") or 0),
        "output_tokens": int(usage.get("output_tokens") or 0),
        "total_tokens": int(usage.get("total_tokens") or 0),
        "run_total_tokens": session["usage"]["total_tokens"],
    }


def stop_response(session: Dict[str, Any], account_state: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return {
        "ok": True,
        "titles": [],
        "new_titles": [],
        "all_titles_for_account": account_state["titles"],
        "should_continue": False,
        "reason": reason,
        "usage": response_usage(session, account_state, {}),
    }


def run_dir(run_id: str) -> Path:
    return ROOT / safe_name(run_id)


def safe_name(value: Any) -> str:
    value = str(value or "").strip()
    value = re.sub(r"[^A-Za-z0-9_.-]+", "_", value)
    return value[:120] or "unknown"


def save_screenshot(run_id: str, account: str, screen_index: int, image_base64: str, image_format: str) -> Path:
    directory = run_dir(run_id)
    directory.mkdir(parents=True, exist_ok=True)
    fmt = "jpg" if (image_format or "jpg").lower() in {"jpg", "jpeg"} else "png"
    path = directory / f"{safe_name(account)}_screen_{screen_index:03d}.{fmt}"
    data = image_base64.split(",", 1)[1] if image_base64.startswith("data:image/") else image_base64
    path.write_bytes(base64.b64decode(data))
    return path


def cleanup_screenshot_if_success(path: Path):
    if settings.AI_DEBUG_KEEP_SCREENSHOTS:
        return
    try:
        path.unlink(missing_ok=True)
    except Exception:
        pass


def append_log(run_id: str, item: Dict[str, Any]):
    directory = run_dir(run_id)
    directory.mkdir(parents=True, exist_ok=True)
    log_path = directory / "recognition_log.jsonl"
    max_bytes = max(1, settings.AI_RECOGNITION_MAX_LOG_MB) * 1024 * 1024
    if log_path.exists() and log_path.stat().st_size > max_bytes:
        rotated = directory / "recognition_log.1.jsonl"
        if rotated.exists():
            rotated.unlink()
        log_path.rename(rotated)
    with log_path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(item, ensure_ascii=False) + "\n")


def write_summary(run_id: str, session: Dict[str, Any]):
    session["updated_at"] = datetime.now().isoformat(timespec="seconds")
    directory = run_dir(run_id)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "summary.json").write_text(
        json.dumps(summary_payload(run_id, session), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def summary_payload(run_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "run_id": run_id,
        "started_at": session.get("started_at"),
        "updated_at": session.get("updated_at"),
        "disabled": bool(session.get("disabled")),
        "disabled_reason": session.get("disabled_reason", ""),
        "account_count": len(session.get("accounts") or {}),
        "ai_usage": dict(session.get("usage") or {}),
    }


def cleanup_old_runs():
    ROOT.mkdir(parents=True, exist_ok=True)
    dirs = [p for p in ROOT.iterdir() if p.is_dir()]
    dirs.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    keep = max(1, settings.AI_RECOGNITION_KEEP_SUMMARY_RUNS)
    cutoff = datetime.now() - timedelta(days=max(1, settings.AI_RECOGNITION_KEEP_FAILED_DAYS))
    for idx, directory in enumerate(dirs):
        summary = directory / "summary.json"
        failed_log = directory / "recognition_log.jsonl"
        mtime = datetime.fromtimestamp(directory.stat().st_mtime)
        if idx >= keep and not failed_log.exists():
            shutil.rmtree(directory, ignore_errors=True)
        elif failed_log.exists() and mtime < cutoff:
            failed_log.unlink(missing_ok=True)
            for image in directory.glob("*_screen_*.*"):
                image.unlink(missing_ok=True)
        if not summary.exists() and not any(directory.iterdir()):
            shutil.rmtree(directory, ignore_errors=True)
    trim_runtime_size()


def trim_runtime_size():
    limit = max(1, settings.AI_RECOGNITION_MAX_RUNTIME_MB) * 1024 * 1024
    dirs = [p for p in ROOT.iterdir() if p.is_dir()]
    total = sum(file.stat().st_size for d in dirs for file in d.rglob("*") if file.is_file())
    if total <= limit:
        return
    dirs.sort(key=lambda p: p.stat().st_mtime)
    for directory in dirs:
        shutil.rmtree(directory, ignore_errors=True)
        total = sum(file.stat().st_size for d in ROOT.iterdir() if d.is_dir() for file in d.rglob("*") if file.is_file())
        if total <= limit:
            break
