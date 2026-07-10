"""server/src/app.py - Flask 应用入口"""
import sys
import os

# 确保 server/ 在 Python 路径中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from flask import Flask
from src.db import init_db
from src.routes import api


def create_app() -> Flask:
    app = Flask(__name__)

    # 注册蓝图
    app.register_blueprint(api)

    # 启动时初始化数据库
    with app.app_context():
        init_db()

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5000, debug=True)
