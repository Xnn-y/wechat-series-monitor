"""server/src/db/database.py - SQLite 数据库初始化"""
import sqlite3
import os
from urllib.parse import unquote

from src.config.settings import settings


PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def resolve_sqlite_path(database_url: str) -> str:
    """Resolve sqlite:/// URLs to an absolute database path."""
    url = database_url or "sqlite:///server/data/collector.dev.db"
    if not url.startswith("sqlite:///"):
        raise ValueError("Only sqlite:/// DATABASE_URL is supported currently")

    raw_path = unquote(url[len("sqlite:///"):])

    if os.path.isabs(raw_path) or (os.name == "nt" and len(raw_path) >= 2 and raw_path[1] == ":"):
        db_path = raw_path
    else:
        db_path = os.path.join(PROJECT_ROOT, raw_path)

    return os.path.abspath(db_path)


DB_PATH = resolve_sqlite_path(settings.DATABASE_URL)
DB_DIR = os.path.dirname(DB_PATH)

os.makedirs(DB_DIR, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    """获取数据库连接，启用 WAL 模式和外键"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """初始化数据库表结构"""
    conn = get_connection()
    cursor = conn.cursor()

    # ---- 设备表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS devices (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL UNIQUE,
            first_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---- 采集轮次表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS collection_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id      TEXT NOT NULL UNIQUE,
            device_name TEXT NOT NULL,
            started_at  DATETIME NOT NULL,
            finished_at DATETIME NOT NULL,
            received    INTEGER DEFAULT 0,
            inserted    INTEGER DEFAULT 0,
            duplicates  INTEGER DEFAULT 0,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_name) REFERENCES devices(name)
        )
    """)

    # ---- 剧集记录表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS series_records (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id                  TEXT NOT NULL,
            account_name_raw        TEXT NOT NULL,
            series_name_raw         TEXT NOT NULL,
            episodes_raw            TEXT,
            account_name_normalized TEXT NOT NULL,
            series_name_normalized  TEXT NOT NULL,
            collected_at            DATETIME NOT NULL,
            created_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (run_id) REFERENCES collection_runs(run_id)
        )
    """)

    # ---- 去重唯一约束 ----
    try:
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_series_dedup
            ON series_records(account_name_normalized, series_name_normalized)
        """)
    except sqlite3.OperationalError:
        pass  # 索引已存在

    # ---- 通知日志表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS notification_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id      TEXT NOT NULL,
            inserted    INTEGER NOT NULL,
            message     TEXT,
            success     INTEGER DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # ---- OCR 别名修正表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ocr_aliases (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_text    TEXT NOT NULL,
            correct_text TEXT NOT NULL,
            field_type  TEXT NOT NULL DEFAULT 'account',
            created_by  TEXT DEFAULT 'manual',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(raw_text, field_type)
        )
    """)

    # ---- 心跳日志表 ----
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS heartbeat_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            device_name TEXT NOT NULL,
            status      TEXT DEFAULT 'alive',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (device_name) REFERENCES devices(name)
        )
    """)

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"[OK] 数据库初始化完成: {DB_PATH}")
