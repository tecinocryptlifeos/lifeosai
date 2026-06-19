import base64
import json
import os
import urllib.error
import urllib.request
import wave
from pathlib import Path

DEFAULT_TTS_MODELS = (
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-preview-tts",
)

TTS_VOICE = os.environ.get("LIFEOS_TTS_VOICE", "Despina")
TRANSIENT_HTTP_CODES = {429, 500, 502, 503, 504}


def write_wav(path, pcm_data, channels=1, rate=24000, sample_width=2):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(rate)
        wav_file.writeframes(pcm_data)


def build_voice_prompt(text):
    clean = " ".join(str(text or "").replace("*", "").split())

    return (
        "Read the following text exactly as written. "
        "Do not add words. Do not remove words. Do not summarize. "
        "Do not rephrase. Use a calm, smooth, warm London English "
        "female executive-advisor delivery. Use natural pauses, but "
        "keep the wording exactly the same. Text to read: " + clean
    )


def _model_list():
    configured = os.environ.get("LIFEOS_TTS_MODELS", "").strip()

    if configured:
        models = [item.strip() for item in configured.split(",")]
        return [item for item in models if item]

    legacy = os.environ.get("LIFEOS_TTS_MODEL", "").strip()

    if legacy:
        return [legacy] + [
            model
            for model in DEFAULT_TTS_MODELS
            if model != legacy
        ]

    return list(DEFAULT_TTS_MODELS)


def generate_lifeos_voice_wav(
    text,
    output_path,
    voice_name=None,
    timeout=42,
):
    api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing")

    clean_text = " ".join(str(text or "").split())

    if not clean_text:
        raise ValueError("Voice text is required")

    voice = voice_name or TTS_VOICE
    prompt = build_voice_prompt(clean_text)
    last_error = None

    for model in _model_list():
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            + model
            + ":generateContent"
        )

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt,
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": voice,
                        }
                    }
                },
            },
            "model": model,
        }

        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "x-goog-api-key": api_key,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(
                request,
                timeout=timeout,
            ) as response:
                result = json.loads(
                    response.read().decode("utf-8")
                )

        except urllib.error.HTTPError as error:
            body = error.read().decode(
                "utf-8",
                errors="replace",
            )

            last_error = (
                f"{model} HTTP {error.code}: {body[:1000]}"
            )

            if error.code in TRANSIENT_HTTP_CODES:
                continue

            raise RuntimeError(last_error) from error

        except Exception as error:
            last_error = (
                f"{model} {type(error).__name__}: {error}"
            )
            continue

        try:
            part = result["candidates"][0]["content"]["parts"][0]
            inline = (
                part.get("inlineData")
                or part.get("inline_data")
            )
            encoded = inline.get("data") if inline else None

            if not encoded:
                raise RuntimeError(
                    "No inline audio data was returned"
                )

            pcm_data = base64.b64decode(encoded)
            write_wav(output_path, pcm_data)

            return str(output_path)

        except Exception as error:
            last_error = (
                f"{model} invalid audio response: {error}"
            )

    raise RuntimeError(
        "Gemini TTS failed across all configured models. "
        f"Last error: {last_error}"
    )
