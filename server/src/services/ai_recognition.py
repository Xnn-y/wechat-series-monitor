"""AI series title recognition service."""
import json
import re
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List

from src.config.settings import settings
from src.services.collector import sanitize_series_title


class AiRecognitionError(RuntimeError):
    def __init__(self, message: str, fatal: bool = False, usage=None):
        super().__init__(message)
        self.fatal = fatal
        self.usage = usage or {}


def recognize_series_image(image_base64: str, image_format: str = "jpg", mock_titles=None) -> Dict[str, Any]:
    provider = (settings.AI_RECOGNITION_PROVIDER or "volcengine").strip().lower()
    started = time.time()

    if provider == "mock":
        titles = [clean_title(t) for t in (mock_titles or [])]
        titles = [t for t in titles if t]
        return {
            "ok": True,
            "titles": dedup_titles(titles),
            "raw_cards": [{"title": t, "isCompleteCard": True, "confidence": 1.0} for t in titles],
            "latency_ms": int((time.time() - started) * 1000),
            "usage": empty_usage(),
            "raw_usage": {},
        }

    if provider != "volcengine":
        raise AiRecognitionError(f"unsupported AI provider: {provider}", fatal=True)
    if not settings.ARK_API_KEY:
        raise AiRecognitionError("ARK_API_KEY is not configured", fatal=True)

    payload = {
        "model": settings.AI_RECOGNITION_MODEL,
        "max_output_tokens": settings.AI_RECOGNITION_MAX_OUTPUT_TOKENS,
        "input": [{
            "role": "user",
            "content": [
                {"type": "input_text", "text": build_series_prompt()},
                {"type": "input_image", "image_url": image_data_url(image_base64, image_format)},
            ],
        }],
    }
    apply_thinking_controls(payload)
    response = post_responses(payload)
    output_text = extract_output_text(response)
    parsed = parse_json_output(output_text)
    titles, cards = extract_titles_from_payload(parsed)
    usage = extract_usage(response)
    return {
        "ok": True,
        "titles": titles,
        "raw_cards": cards,
        "latency_ms": int((time.time() - started) * 1000),
        "usage": usage,
        "raw_usage": response.get("usage") or {},
    }


def build_series_prompt() -> str:
    return "\n".join([
        "You are recognizing a WeChat video account series tab screenshot.",
        "Return JSON only. No markdown. No explanation.",
        "Return the smallest possible JSON object.",
        'The only allowed output shape is: {"cards":[{"t":"title1","e":47},{"t":"title2","e":60}]}',
        "Each item must contain t as the formal title and e as the visible episode count number.",
        "Do not include confidence, warnings, reasons, schema text, or any extra keys.",
        "Only detect usable series cards from the current screenshot.",
        "A card is usable only when the same card's cover image and episode count are both visible.",
        "The formal title is in the gray info area below the cover image and above the episode count.",
        "Never output large text inside the poster/cover image, even when it looks like a title.",
        "If the gray info area title below the cover is not visible, ignore that card.",
        "If the cover image is not visible, the title may be edge residue; mark incomplete or ignore it.",
        "If the episode count is not visible directly below the title, ignore that card.",
        "Do not read poster slogans, large cover text, promotional copy, UI tabs, buttons, or product labels as titles.",
        "If the title wraps to two lines, merge only adjacent title lines in the same gray info area.",
    ])


def apply_thinking_controls(payload: Dict[str, Any]) -> None:
    thinking_type = (settings.AI_RECOGNITION_THINKING_TYPE or "").strip().lower()
    if thinking_type and thinking_type not in {"none", "off"}:
        payload["thinking"] = {"type": thinking_type}

    reasoning_effort = (settings.AI_RECOGNITION_REASONING_EFFORT or "").strip().lower()
    if reasoning_effort and reasoning_effort not in {"none", "off"}:
        payload["reasoning"] = {"effort": reasoning_effort}


def image_data_url(image_base64: str, image_format: str) -> str:
    data = (image_base64 or "").strip()
    if data.startswith("data:image/"):
        return data
    fmt = (image_format or "jpg").strip().lower()
    if fmt == "jpg":
        fmt = "jpeg"
    return f"data:image/{fmt};base64,{data}"


def post_responses(payload: Dict[str, Any]) -> Dict[str, Any]:
    url = settings.AI_RECOGNITION_BASE_URL.rstrip("/") + "/responses"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.ARK_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=settings.AI_RECOGNITION_TIMEOUT_SECONDS) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        fatal = exc.code in {401, 403, 429}
        raise AiRecognitionError(f"AI HTTP {exc.code}: {body_text}", fatal=fatal) from exc
    except Exception as exc:
        raise AiRecognitionError(str(exc), fatal=False) from exc


def extract_output_text(response: Dict[str, Any]) -> str:
    if isinstance(response.get("output_text"), str):
        return response["output_text"]
    parts: List[str] = []
    for item in response.get("output") or []:
        for content in item.get("content") or []:
            text = content.get("text")
            if isinstance(text, str):
                parts.append(text)
    if not parts and isinstance(response.get("choices"), list):
        for choice in response.get("choices") or []:
            message = choice.get("message") or {}
            content = message.get("content")
            if isinstance(content, str):
                parts.append(content)
    if not parts:
        usage = extract_usage(response)
        detail = {
            "keys": sorted(response.keys()),
            "status": response.get("status"),
            "error": response.get("error"),
            "incomplete_details": response.get("incomplete_details"),
            "usage": response.get("usage"),
        }
        raise AiRecognitionError(
            "AI response missing output_text: " + json.dumps(detail, ensure_ascii=False),
            usage=usage,
        )
    return "\n".join(parts)


def parse_json_output(text: str) -> Dict[str, Any]:
    value = (text or "").strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value)
        value = re.sub(r"\s*```$", "", value)
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        start = value.find("{")
        end = value.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(value[start:end + 1])


def extract_titles_from_payload(payload: Dict[str, Any]):
    raw_cards = payload.get("cards")
    if isinstance(raw_cards, list):
        titles = []
        cards = []
        for item in raw_cards:
            title = ""
            episodes = 0
            if isinstance(item, list) and item:
                title = clean_title(item[0])
                if len(item) > 1:
                    episodes = parse_episode_count(item[1])
            elif isinstance(item, dict):
                title = clean_title(item.get("t") or item.get("title") or "")
                episodes = parse_episode_count(item.get("e") or item.get("episodes"))
            if not episodes:
                continue
            if title and is_title_candidate(title):
                titles.append(title)
                cards.append({"title": title, "episodes": episodes})
        return dedup_titles(titles), cards

    raw_titles = payload.get("titles")
    if isinstance(raw_titles, list):
        titles = []
        for item in raw_titles:
            title = clean_title(item)
            if title and is_title_candidate(title):
                titles.append(title)
        return dedup_titles(titles), [{"title": t} for t in titles]

    cards = payload.get("seriesCards") or []
    return extract_titles(cards), cards


def parse_episode_count(value: Any) -> int:
    if isinstance(value, int):
        return value
    match = re.search(r"\d{1,4}", str(value or ""))
    return int(match.group(0)) if match else 0


def extract_titles(cards: List[Dict[str, Any]]) -> List[str]:
    titles = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        if card.get("isCompleteCard") is False:
            continue
        confidence = float(card.get("confidence") or 0)
        if confidence and confidence < 0.55:
            continue
        title = clean_title(card.get("title") or "")
        if title and is_title_candidate(title):
            titles.append(title)
    return dedup_titles(titles)


def clean_title(value: Any) -> str:
    title = sanitize_series_title(str(value or "").strip())
    title = re.sub(r"^[,:]+|[,:]+$", "", title)
    return title


def is_title_candidate(title: str) -> bool:
    compact = re.sub(r"[,:\s]+", "", title)
    if len(compact) < 2 or len(compact) > 40:
        return False
    if re.fullmatch(r"\d+", compact):
        return False
    blocked = {"主页", "视频", "剧集", "全部", "私信", "已关注", "视频商品"}
    return compact not in blocked


def dedup_titles(titles: List[str]) -> List[str]:
    result: List[str] = []
    seen = set()
    for title in titles:
        key = re.sub(r"[,:\s]+", "", title).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(title)
    return result


def extract_usage(response: Dict[str, Any]) -> Dict[str, int]:
    raw = response.get("usage") or {}
    input_tokens = int(raw.get("input_tokens") or raw.get("prompt_tokens") or 0)
    output_tokens = int(raw.get("output_tokens") or raw.get("completion_tokens") or 0)
    total_tokens = int(raw.get("total_tokens") or input_tokens + output_tokens)
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
    }


def empty_usage() -> Dict[str, int]:
    return {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
