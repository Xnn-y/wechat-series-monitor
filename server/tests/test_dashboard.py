"""Quick dashboard route test"""
import sys, os

os.environ["APP_ENV"] = "test"
os.environ["DATABASE_URL"] = "sqlite:///server/data/collector.test.db"
os.environ["ADMIN_PASSWORD"] = "admin123"

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.app import create_app

app = create_app()
client = app.test_client()

# Test dashboard page
resp = client.get("/dashboard")
print(f"Dashboard status: {resp.status_code}")
print(f"Content type: {resp.content_type}")
has_html = "<!DOCTYPE html>" in resp.data.decode("utf-8")
print(f"Contains HTML: {has_html}")

# Test root redirect
resp2 = client.get("/")
print(f"Root status: {resp2.status_code}")
print(f"Redirect to dashboard: {'/dashboard' in resp2.location}")

if resp.status_code == 200 and has_html and 300 <= resp2.status_code < 400:
    print("\n✅ Dashboard 路由测试通过")
else:
    print("\n❌ Dashboard 路由测试失败")
