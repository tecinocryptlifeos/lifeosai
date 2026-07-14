import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


class GeminiClient:
    """
    LifeOS Web AI Gemini client.

    Purpose:
    - Fast text response.
    - Automatic fallback when one Gemini model is overloaded.
    - Always raise a clear error after all fallback models fail.
    """

    DEFAULT_MODELS = [
        "gemini-2.5-flash-lite",
        "gemini-2.5-flash",
    ]

    def __init__(self, api_key=None, model=None, models=None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is missing")

        env_models = os.environ.get("GEMINI_TEXT_MODELS", "").strip()
        if model:
            self.models = [str(model).strip()]
        elif models:
            self.models = list(models)
        elif env_models:
            self.models = [m.strip() for m in env_models.split(",") if m.strip()]
        else:
            self.models = list(self.DEFAULT_MODELS)

    def _extract_text(self, payload):
        parts = (
            payload.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )

        text_parts = []
        for part in parts:
            if isinstance(part, dict) and part.get("text"):
                text_parts.append(part["text"])

        text = "\n".join(text_parts).strip()
        if not text:
            raise RuntimeError("Gemini returned empty text")
        return text

    def _extract_grounding_sources(self, payload):
        candidates = payload.get("candidates") or []
        metadata = candidates[0].get("groundingMetadata", {}) if candidates else {}
        sources = []
        seen = set()

        for chunk in metadata.get("groundingChunks") or []:
            web = chunk.get("web") if isinstance(chunk, dict) else None
            if not isinstance(web, dict):
                continue
            url = str(web.get("uri") or "").strip()
            title = " ".join(str(web.get("title") or "Web source").split())[:180]
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                continue
            normalized = parsed._replace(fragment="").geturl()
            if normalized in seen:
                continue
            seen.add(normalized)
            sources.append({"title": title or parsed.netloc, "url": normalized})
            if len(sources) >= 5:
                break

        return sources

    def _request(
        self,
        body,
        timeout,
        retries,
        allow_model_fallback_on_400=False,
        models=None,
    ):
        data = json.dumps(body).encode("utf-8")
        last_error = None
        requested_models = list(models or self.models)

        for _attempt in range(1, retries + 1):
            for model in requested_models:
                url = (
                    "https://generativelanguage.googleapis.com/v1beta/models/"
                    + model
                    + ":generateContent?key="
                    + self.api_key
                )
                req = urllib.request.Request(
                    url,
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )

                try:
                    with urllib.request.urlopen(req, timeout=timeout) as response:
                        raw = response.read().decode("utf-8", errors="replace")
                        return json.loads(raw), model
                except urllib.error.HTTPError as error:
                    err_body = error.read().decode("utf-8", errors="replace")
                    last_error = f"{model} HTTP {error.code}: {err_body[:700]}"
                    if error.code in (429, 500, 502, 503, 504) or (
                        allow_model_fallback_on_400 and error.code == 400
                    ):
                        time.sleep(0.35)
                        continue
                    raise RuntimeError(last_error)
                except Exception as error:
                    last_error = f"{model} {type(error).__name__}: {error}"
                    time.sleep(0.35)
                    continue

        raise RuntimeError(
            f"Gemini text request failed after fallback models {requested_models}. Last error: {last_error}"
        )

    def generate_text(self, prompt, timeout=12, retries=1, max_output_tokens=520):
        prompt = str(prompt or "").strip()
        if not prompt:
            raise ValueError("Prompt is required")

        timeout = min(int(timeout or 12), 12)
        retries = max(int(retries or 1), 1)

        body = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": prompt}],
                }
            ],
            "generationConfig": {
                "temperature": 0.45,
                "topP": 0.9,
                "maxOutputTokens": max_output_tokens,
            },
        }

        payload, _model = self._request(body, timeout, retries)
        return self._extract_text(payload)

    def generate_grounded_text(self, prompt, timeout=12, retries=1, max_output_tokens=900):
        """Generate an answer that may use Google Search and return safe source links."""
        prompt = str(prompt or "").strip()
        if not prompt:
            raise ValueError("Prompt is required")

        timeout = min(int(timeout or 12), 20)
        retries = max(int(retries or 1), 1)
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {
                "temperature": 0.35,
                "topP": 0.9,
                "maxOutputTokens": max_output_tokens,
                "thinkingConfig": {"thinkingBudget": 1024},
            },
        }
        configured_models = [
            item.strip()
            for item in os.environ.get(
                "GEMINI_GROUNDED_TEXT_MODELS",
                "gemini-2.5-flash",
            ).split(",")
            if item.strip()
        ]
        payload, model = self._request(
            body,
            timeout,
            retries,
            allow_model_fallback_on_400=True,
            models=configured_models,
        )
        sources = self._extract_grounding_sources(payload)
        return {
            "text": self._extract_text(payload),
            "sources": sources,
            "model": model,
            "grounded": bool(sources),
        }
