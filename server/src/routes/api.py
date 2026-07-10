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


def require_admin(f):
    """可选的管理员密码校验：配置了 ADMIN_PASSWORD 且请求头不带 X-Admin-Password 则拒绝"""
    @wraps(f)
    def wrapper(*args, **kwargs):
        admin_pwd = settings.ADMIN_PASSWORD
        if admin_pwd and admin_pwd != "admin123":
            req_pwd = request.headers.get("X-Admin-Password", "")
            if req_pwd != admin_pwd:
                return jsonify({"ok": False, "error": "admin password required"}), 401
        return f(*args, **kwargs)
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
    return jsonify({"ok": True, "db": str(DB_PATH), "record_count": count})


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
def get_records():
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
# GET /api/export.csv - CSV 导出（支持筛选）
# ============================================================
@api.route("/api/export.csv", methods=["GET"])
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
def health_check():
    result = run_health_check()
    return jsonify(result)


# ============================================================
# GET /api/ocr-aliases - 查询 OCR 别名列表
# ============================================================
@api.route("/api/ocr-aliases", methods=["GET"])
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
def delete_ocr_alias(alias_id):
    conn = get_connection()
    try:
        conn.execute("DELETE FROM ocr_aliases WHERE id = ?", (alias_id,))
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


# ============================================================
# GET /dashboard - 团队查看后台页面
# ============================================================
@api.route("/dashboard", methods=["GET"])
def dashboard():
    return send_from_directory(STATIC_DIR, "dashboard.html")


# ============================================================
# GET / - 首页重定向到 dashboard
# ============================================================
@api.route("/", methods=["GET"])
def index():
    from flask import redirect
    return redirect("/dashboard")
