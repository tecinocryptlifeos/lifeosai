import json
import os
import time
import urllib.error
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

    def __init__(self, api_key=None, models=None):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is missing")

        env_models = os.environ.get("GEMINI_TEXT_MODELS", "").strip()
        if models:
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

        data = json.dumps(body).encode("utf-8")
        last_error = None

        for attempt in range(1, retries + 1):
            for model in self.models:
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
                        payload = json.loads(raw)
                        return self._extract_text(payload)

                except urllib.error.HTTPError as e:
                    err_body = e.read().decode("utf-8", errors="replace")
                    last_error = f"{model} HTTP {e.code}: {err_body[:700]}"

                    # Continue quickly on overload / temporary model failure.
                    if e.code in (429, 500, 502, 503, 504):
                        time.sleep(0.35)
                        continue

                    raise RuntimeError(last_error)

                except Exception as e:
                    last_error = f"{model} {type(e).__name__}: {e}"
                    time.sleep(0.35)
                    continue

        raise RuntimeError(
            f"Gemini text request failed after fallback models {self.models}. Last error: {last_error}"
        )
