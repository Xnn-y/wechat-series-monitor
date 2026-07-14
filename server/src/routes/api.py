"""server/src/routes/api.py - 所有 API 路由"""
import csv
import io
import os
from functools import wraps
from flask import Blueprint, request, jsonify, Response, send_from_directory
from src.config.settings import settings
from src.db import get_connection, DB_PATH
from src.services import process_collect, send_new_records_notification, record_heartbeat, run_health_check

api = Blueprint("api", __name__)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static")


# ============================================================
# 鉴权装饰器
# ============================================================
def require_token(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-Collector-Token", "")
        if token != settings.COLLECTOR_TOKEN:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapper


def require_viewer(f):
    """查看者权限：VIEWER_PASSWORD 或 ADMIN_PASSWORD 均可。"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        req_pwd = request.headers.get("X-Admin-Password", "")
        admin_pwd = (settings.ADMIN_PASSWORD or "").strip()
        viewer_pwd = (settings.VIEWER_PASSWORD or "").strip()
        # 两种密码都接受
        if req_pwd == admin_pwd or (viewer_pwd and req_pwd == viewer_pwd):
            return f(*args, **kwargs)
        return jsonify({"ok": False, "error": "password required"}), 401
    return wrapper


def require_admin(f):
    """管理员权限：仅 ADMIN_PASSWORD。"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        req_pwd = request.headers.get("X-Admin-Password", "")
        admin_pwd = (settings.ADMIN_PASSWORD or "").strip()
        if req_pwd and req_pwd == admin_pwd:
            return f(*args, **kwargs)
        return jsonify({"ok": False, "error": "admin password required"}), 401
    return wrapper


# ============================================================
# GET /health - 健康检查
# ============================================================
@api.route("/health", methods=["GET"])
def health():
    conn = get_connection()
    try:
        row = conn.execute("SELECT COUNT(*) AS cnt FROM series_records").fetchone()
        count = row["cnt"]
    finally:
        conn.close()
    result = {"ok": True, "record_count": count}
    if settings.APP_ENV != "production":
        result["db"] = str(DB_PATH)
    return jsonify(result)


# ============================================================
# POST /api/collect - 采集上报（需 Token）
# ============================================================
@api.route("/api/collect", methods=["POST"])
@require_token
def collect():
    payload = request.get_json(silent=True)
    if not payload:
        return jsonify({"ok": False, "error": "请求体不能为空"}), 400

    result = process_collect(payload)

    if not result.get("ok"):
        return jsonify(result), 400

    # 有新增记录时发送通知
    if result["inserted"] > 0:
        notified = send_new_records_notification(
            run_id=payload.get("run_id", ""),
            device=payload.get("device", "unknown"),
            finished_at=payload.get("finished_at", ""),
            inserted_records=result.get("inserted_records", []),
        )
        result["notified"] = notified
    else:
        result["notified"] = False

    return jsonify(result)


# ============================================================
# GET /api/records - 查询剧集记录
# 支持参数: account, series, date_from, date_to, limit, offset
# ============================================================
@api.route("/api/records", methods=["GET"])
@require_viewer
def get_records():
    run_id = request.args.get("run_id", "").strip()
    account = request.args.get("account", "").strip()
    series = request.args.get("series", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()
    try:
        limit = min(int(request.args.get("limit", "100")), 1000)
    except ValueError:
        limit = 100
    try:
        offset = int(request.args.get("offset", "0"))
    except ValueError:
        offset = 0

    conn = get_connection()
    try:
        where_clauses = []
        params = []

        if run_id:
            where_clauses.append("run_id = ?")
            params.append(run_id)
        if account:
            where_clauses.append("account_name_normalized LIKE ?")
            params.append(f"%{account}%")
        if series:
            where_clauses.append("series_name_normalized LIKE ?")
            params.append(f"%{series}%")
        if date_from:
            where_clauses.append("collected_at >= ?")
            params.append(date_from)
        if date_to:
            where_clauses.append("collected_at <= ?")
            params.append(date_to + " 23:59:59")

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        # 总数
        count_row = conn.execute(
            f"SELECT COUNT(*) AS total FROM series_records {where_sql}", params
        ).fetchone()
        total = count_row["total"]

        # 分页数据
        rows = conn.execute(
            f"""SELECT id, run_id, account_name_raw, series_name_raw, episodes_raw,
                       account_name_normalized, series_name_normalized, collected_at
                FROM series_records {where_sql}
                ORDER BY collected_at DESC
                LIMIT ? OFFSET ?""",
            params + [limit, offset],
        ).fetchall()

        records = [dict(r) for r in rows]
    finally:
        conn.close()

    return jsonify({"ok": True, "total": total, "limit": limit, "offset": offset, "records": records})


# ============================================================
# GET /api/runs - 查询采集轮次
# ============================================================
@api.route("/api/runs", methods=["GET"])
@require_viewer
def get_runs():
    try:
        limit = min(int(request.args.get("limit", "20")), 100)
    except ValueError:
        limit = 20

    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT run_id, device_name, started_at, finished_at,
                      received, inserted, duplicates, created_at
               FROM collection_runs
               ORDER BY created_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
        runs = [dict(r) for r in rows]
    finally:
        conn.close()

    return jsonify({"ok": True, "runs": runs})


# ============================================================
# GET /api/summary - 团队后台总览
# ============================================================
@api.route("/api/summary", methods=["GET"])
@require_viewer
def get_summary():
    conn = get_connection()
    try:
        total_records = conn.execute(
            "SELECT COUNT(*) AS cnt FROM series_records"
        ).fetchone()["cnt"]

        today_records = conn.execute(
            """SELECT COUNT(*) AS cnt FROM series_records
               WHERE collected_at >= date('now', 'localtime')
                 AND collected_at < date('now', 'localtime', '+1 day')"""
        ).fetchone()["cnt"]

        latest_run_row = conn.execute(
            """SELECT run_id, device_name, started_at, finished_at,
                      received, inserted, duplicates, created_at
               FROM collection_runs
               ORDER BY created_at DESC
               LIMIT 1"""
        ).fetchone()

        recent_run_rows = conn.execute(
            """SELECT run_id, device_name, started_at, finished_at,
                      received, inserted, duplicates, created_at
               FROM collection_runs
               ORDER BY created_at DESC
               LIMIT 5"""
        ).fetchall()

        device_rows = conn.execute(
            """SELECT name, first_seen, last_seen,
                      CAST((julianday('now') - julianday(last_seen)) * 24 * 60 AS INTEGER) AS minutes_ago
               FROM devices
               ORDER BY last_seen DESC"""
        ).fetchall()

        account_rows = conn.execute(
            """SELECT account_name_raw AS account, COUNT(*) AS count
               FROM series_records
               WHERE collected_at >= date('now', 'localtime')
                 AND collected_at < date('now', 'localtime', '+1 day')
               GROUP BY account_name_raw
               ORDER BY count DESC, account_name_raw ASC
               LIMIT 50"""
        ).fetchall()
    finally:
        conn.close()

    devices = []
    online_devices = 0
    for row in device_rows:
        minutes_ago = row["minutes_ago"] if row["minutes_ago"] is not None else 999999
        online = minutes_ago <= settings.DEVICE_OFFLINE_MINUTES
        if online:
            online_devices += 1
        devices.append({
            "name": row["name"],
            "first_seen": row["first_seen"],
            "last_seen": row["last_seen"],
            "minutes_ago": minutes_ago,
            "online": online,
        })

    latest_run = dict(latest_run_row) if latest_run_row else None

    return jsonify({
        "ok": True,
        "total_records": total_records,
        "today_records": today_records,
        "latest_run": latest_run,
        "recent_runs": [dict(r) for r in recent_run_rows],
        "devices": devices,
        "online_devices": online_devices,
        "device_count": len(devices),
        "today_by_account": [dict(r) for r in account_rows],
    })


# ============================================================
# GET /api/export.csv - CSV 导出（支持筛选）
# ============================================================
@api.route("/api/export.csv", methods=["GET"])
@require_viewer
def export_csv():
    account = request.args.get("account", "").strip()
    series = request.args.get("series", "").strip()
    date_from = request.args.get("date_from", "").strip()
    date_to = request.args.get("date_to", "").strip()

    conn = get_connection()
    try:
        where_clauses = []
        params = []
        if account:
            where_clauses.append("account_name_normalized LIKE ?")
            params.append(f"%{account}%")
        if series:
            where_clauses.append("series_name_normalized LIKE ?")
            params.append(f"%{series}%")
        if date_from:
            where_clauses.append("collected_at >= ?")
            params.append(date_from)
        if date_to:
            where_clauses.append("collected_at <= ?")
            params.append(date_to + " 23:59:59")

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

        rows = conn.execute(
            f"""SELECT account_name_raw, series_name_raw, episodes_raw, collected_at
                FROM series_records {where_sql}
                ORDER BY collected_at DESC""",
            params,
        ).fetchall()
    finally:
        conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["账号", "剧名", "集数", "采集时间"])
    for r in rows:
        writer.writerow([r["account_name_raw"], r["series_name_raw"],
                         r["episodes_raw"], r["collected_at"]])

    csv_content = output.getvalue()
    output.close()

    return Response(
        csv_content,
        mimetype="text/csv",
        headers={
            "Content-Disposition": "attachment; filename=export.csv",
            "Content-Type": "text/csv; charset=utf-8-sig",
        },
    )


# ============================================================
# POST /api/heartbeat - 设备心跳上报（需 Token）
# ============================================================
@api.route("/api/heartbeat", methods=["POST"])
@require_token
def heartbeat():
    payload = request.get_json(silent=True) or {}
    device_name = payload.get("device", "unknown")
    status = payload.get("status", "alive")
    record_heartbeat(device_name, status)
    return jsonify({"ok": True, "device": device_name, "status": status})


# ============================================================
# GET /api/health-check - 运行健康检查，返回告警列表
# ============================================================
@api.route("/api/health-check", methods=["GET"])
@require_viewer
def health_check():
    result = run_health_check()
    return jsonify(result)


# ============================================================
# GET /api/ocr-aliases - 查询 OCR 别名列表
# ============================================================
@api.route("/api/ocr-aliases", methods=["GET"])
@require_viewer
def get_ocr_aliases():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, raw_text, correct_text, field_type, created_by, created_at "
            "FROM ocr_aliases ORDER BY field_type, created_at DESC"
        ).fetchall()
        aliases = [dict(r) for r in rows]
    finally:
        conn.close()
    return jsonify({"ok": True, "aliases": aliases})


# ============================================================
# POST /api/ocr-aliases - 创建 OCR 别名修正
# ============================================================
@api.route("/api/ocr-aliases", methods=["POST"])
@require_admin
def create_ocr_alias():
    payload = request.get_json(silent=True) or {}
    raw_text = (payload.get("raw_text") or "").strip()
    correct_text = (payload.get("correct_text") or "").strip()
    field_type = payload.get("field_type", "account")

    if not raw_text or not correct_text:
        return jsonify({"ok": False, "error": "raw_text 和 correct_text 不能为空"}), 400

    conn = get_connection()
    try:
        conn.execute(
            """INSERT OR REPLACE INTO ocr_aliases (raw_text, correct_text, field_type, created_by)
               VALUES (?, ?, ?, 'manual')""",
            (raw_text, correct_text, field_type),
        )
        conn.commit()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        conn.close()

    return jsonify({"ok": True, "raw_text": raw_text, "correct_text": correct_text})


# ============================================================
# DELETE /api/ocr-aliases/<int:alias_id> - 删除 OCR 别名
# ============================================================
@api.route("/api/ocr-aliases/<int:alias_id>", methods=["DELETE"])
@require_admin
def delete_ocr_alias(alias_id):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM ocr_aliases WHERE id = ?", (alias_id,))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


# ============================================================
# PUT /api/records/<int:record_id> - 修改记录
# ============================================================
@api.route("/api/records/<int:record_id>", methods=["PUT"])
@require_admin
def update_record(record_id):
    payload = request.get_json(silent=True) or {}
    account_raw = (payload.get("account_name_raw") or "").strip()
    series_raw = (payload.get("series_name_raw") or "").strip()
    episodes = (payload.get("episodes_raw") or "").strip()

    if not account_raw or not series_raw:
        return jsonify({"ok": False, "error": "账号名和剧名不能为空"}), 400

    conn = get_connection()
    try:
        conn.execute(
            """UPDATE series_records
               SET account_name_raw = ?, series_name_raw = ?, episodes_raw = ?,
                   account_name_normalized = ?, series_name_normalized = ?
               WHERE id = ?""",
            (account_raw, series_raw, episodes,
             account_raw.strip().lower(), series_raw.strip().lower(),
             record_id),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({"ok": True})


# ============================================================
# DELETE /api/records/<int:record_id> - 删除单条记录
# ============================================================
@api.route("/api/records/<int:record_id>", methods=["DELETE"])
@require_admin
def delete_record(record_id):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM series_records WHERE id = ?", (record_id,))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


# ============================================================
# POST /api/records/batch-delete - 批量删除
# Body: {"ids": [1, 2, 3], "add_alias": true, "alias_type": "account"}
# ============================================================
@api.route("/api/records/batch-delete", methods=["POST"])
@require_admin
def batch_delete_records():
    payload = request.get_json(silent=True) or {}
    ids = payload.get("ids", [])
    add_alias = payload.get("add_alias", False)

    if not ids or not isinstance(ids, list):
        return jsonify({"ok": False, "error": "ids 不能为空"}), 400

    conn = get_connection()
    try:
        # 如需同时创建 OCR 别名
        if add_alias:
            alias_type = payload.get("alias_type", "account")
            rows = conn.execute(
                f"SELECT id, account_name_raw, series_name_raw FROM series_records WHERE id IN ({','.join('?'*len(ids))})",
                ids,
            ).fetchall()
            for r in rows:
                raw = r["account_name_raw"] if alias_type == "account" else r["series_name_raw"]
                conn.execute(
                    "INSERT OR IGNORE INTO ocr_aliases (raw_text, correct_text, field_type, created_by) VALUES (?, ?, ?, 'batch')",
                    (raw, raw, alias_type),
                )

        placeholders = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM series_records WHERE id IN ({placeholders})", ids)
        conn.commit()
        deleted = conn.total_changes
    finally:
        conn.close()

    return jsonify({"ok": True, "deleted": deleted})


# ============================================================
# GET /api/auth-check - 检测当前密码对应的角色
# ============================================================
@api.route("/api/auth-check", methods=["GET"])
def auth_check():
    req_pwd = request.headers.get("X-Admin-Password", "")
    admin_pwd = (settings.ADMIN_PASSWORD or "").strip()
    viewer_pwd = (settings.VIEWER_PASSWORD or "").strip()

    role = None
    if req_pwd and req_pwd == admin_pwd:
        role = "admin"
    elif viewer_pwd and req_pwd == viewer_pwd:
        role = "viewer"

    return jsonify({"ok": True, "role": role})


# ============================================================
# GET /api/active-dates - 返回有数据的日期及条数
# ============================================================
@api.route("/api/active-dates", methods=["GET"])
@require_viewer
def active_dates():
    from datetime import date, timedelta
    conn = get_connection()
    try:
        # 查询最近 7 天有数据的日期及条数
        rows = conn.execute(
            """SELECT DATE(collected_at) AS d, COUNT(*) AS cnt
               FROM series_records
               WHERE collected_at >= DATE('now', '-6 days')
               GROUP BY d
               ORDER BY d DESC"""
        ).fetchall()
        data_map = {r["d"]: r["cnt"] for r in rows}

        # 生成最近 7 天完整列表（包括无数据的）
        today = date.today()
        dates = []
        for i in range(6, -1, -1):
            d = (today - timedelta(days=i)).isoformat()
            dates.append({"date": d, "count": data_map.get(d, 0)})
    finally:
        conn.close()
    return jsonify({"ok": True, "dates": dates})


# ============================================================
# GET /dashboard - 团队查看后台页面
# ============================================================
@api.route("/dashboard", methods=["GET"])
@api.route("/dashboard/", methods=["GET"])
def dashboard():
    return send_from_directory(STATIC_DIR, "dashboard.html")


# ============================================================
# GET / - 首页重定向到 dashboard
# ============================================================
@api.route("/", methods=["GET"])
def index():
    from flask import redirect
    return redirect("/dashboard")
