"""Post one local screenshot to the backend series recognition endpoint."""
import argparse
import base64
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def post_json(url, token, payload, timeout):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "X-Collector-Token": token,
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def get_json(url, token, timeout):
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"X-Collector-Token": token},
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("image", help="Path to one screenshot image")
    parser.add_argument("--server", default="http://127.0.0.1:5000")
    parser.add_argument("--token", default="dev_token")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--account", default="local_test_account")
    parser.add_argument("--screen-index", type=int, default=0)
    parser.add_argument("--timeout", type=int, default=150)
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        raise SystemExit(f"Image not found: {image_path}")

    run_id = args.run_id or time.strftime("local_ai_test_%Y%m%d_%H%M%S")
    suffix = image_path.suffix.lower().lstrip(".") or "jpg"
    if suffix == "jpeg":
        suffix = "jpg"

    payload = {
        "run_id": run_id,
        "account": args.account,
        "screen_index": args.screen_index,
        "image_base64": base64.b64encode(image_path.read_bytes()).decode("ascii"),
        "image_format": suffix,
    }

    base_url = args.server.rstrip("/")
    recognize_url = base_url + "/api/collector/series/recognize"
    summary_url = (
        base_url
        + "/api/collector/series/recognize/summary?run_id="
        + urllib.parse.quote(run_id)
    )

    try:
        result = post_json(recognize_url, args.token, payload, args.timeout)
        print("=== recognize result ===")
        print(json.dumps(result, ensure_ascii=False, indent=2))

        summary = get_json(summary_url, args.token, args.timeout)
        print("\n=== usage summary ===")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {exc.code}: {body}") from exc


if __name__ == "__main__":
    main()
