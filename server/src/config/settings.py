"""server/src/config/settings.py - 配置管理"""
import os
from dotenv import load_dotenv

# 加载 .env 文件（优先当前目录，再向上查找）
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def env_int(name: str, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


class Settings:
    COLLECTOR_TOKEN: str = os.getenv("COLLECTOR_TOKEN", "dev_token")
    WECOM_WEBHOOK_URL: str = os.getenv("WECOM_WEBHOOK_URL", "")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin123")
    VIEWER_PASSWORD: str = os.getenv("VIEWER_PASSWORD", "viewer123")
    APP_ENV: str = os.getenv("APP_ENV", "local")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///server/data/collector.dev.db")
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "")
    DEVICE_OFFLINE_MINUTES: int = env_int("DEVICE_OFFLINE_MINUTES", 150)
    ARK_API_KEY: str = os.getenv("ARK_API_KEY", "")
    AI_RECOGNITION_PROVIDER: str = os.getenv("AI_RECOGNITION_PROVIDER", "volcengine")
    AI_RECOGNITION_MODEL: str = os.getenv("AI_RECOGNITION_MODEL", "doubao-seed-2-0-lite-260215")
    AI_RECOGNITION_BASE_URL: str = os.getenv("AI_RECOGNITION_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
    AI_RECOGNITION_TIMEOUT_SECONDS: int = env_int("AI_RECOGNITION_TIMEOUT_SECONDS", 90)
    AI_RECOGNITION_MAX_OUTPUT_TOKENS: int = env_int("AI_RECOGNITION_MAX_OUTPUT_TOKENS", 512)
    AI_RECOGNITION_THINKING_TYPE: str = os.getenv("AI_RECOGNITION_THINKING_TYPE", "disabled")
    AI_RECOGNITION_REASONING_EFFORT: str = os.getenv("AI_RECOGNITION_REASONING_EFFORT", "minimal")
    AI_MAX_SCREENS_PER_ACCOUNT: int = env_int("AI_MAX_SCREENS_PER_ACCOUNT", 6)
    AI_MAX_NO_NEW_SCREENS: int = env_int("AI_MAX_NO_NEW_SCREENS", 2)
    AI_MAX_SERIES_PER_ACCOUNT: int = env_int("AI_MAX_SERIES_PER_ACCOUNT", 12)
    AI_MAX_CALLS_PER_RUN: int = env_int("AI_MAX_CALLS_PER_RUN", 120)
    AI_DEBUG_KEEP_SCREENSHOTS: bool = os.getenv("AI_DEBUG_KEEP_SCREENSHOTS", "").strip().lower() in {"1", "true", "yes", "on"}
    AI_RECOGNITION_KEEP_SUMMARY_RUNS: int = env_int("AI_RECOGNITION_KEEP_SUMMARY_RUNS", 30)
    AI_RECOGNITION_KEEP_FAILED_DAYS: int = env_int("AI_RECOGNITION_KEEP_FAILED_DAYS", 7)
    AI_RECOGNITION_MAX_RUNTIME_MB: int = env_int("AI_RECOGNITION_MAX_RUNTIME_MB", 1024)
    AI_RECOGNITION_MAX_LOG_MB: int = env_int("AI_RECOGNITION_MAX_LOG_MB", 10)


settings = Settings()
