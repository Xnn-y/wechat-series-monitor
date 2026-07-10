"""server/src/config/settings.py - 配置管理"""
import os
from dotenv import load_dotenv

# 加载 .env 文件（优先当前目录，再向上查找）
load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


class Settings:
    COLLECTOR_TOKEN: str = os.getenv("COLLECTOR_TOKEN", "dev_token")
    WECOM_WEBHOOK_URL: str = os.getenv("WECOM_WEBHOOK_URL", "")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin123")
    APP_ENV: str = os.getenv("APP_ENV", "local")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///server/data/collector.dev.db")
    PUBLIC_BASE_URL: str = os.getenv("PUBLIC_BASE_URL", "")


settings = Settings()
