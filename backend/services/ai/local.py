import os
import httpx
from services.ai.base import AIProvider


SYSTEM_PROMPT = """You are a voice assistant engaged in natural spoken conversation. Your responses will be converted to speech, so:

- Keep responses concise (1-3 sentences) unless asked to elaborate
- Use natural, conversational language as if speaking aloud
- Avoid markdown, bullet points, or formatting that doesn't translate to speech
- Don't use asterisks, brackets, or special characters
- When asked to expand or explain more, provide fuller responses
- Be warm and personable while remaining helpful and accurate"""

DEFAULT_LOCAL_LLM_URL = "http://localhost:8080"
MODEL_NAME = "Qwen/Qwen2.5-72B-Instruct-AWQ"


class LocalProvider(AIProvider):
    """Local LLM provider using OpenAI-compatible API."""

    def __init__(self):
        self.base_url = os.getenv("LOCAL_LLM_URL", DEFAULT_LOCAL_LLM_URL)
        self.model = MODEL_NAME
        self.history: list[dict[str, str]] = []
        self.client = httpx.Client(timeout=120.0)

    def get_response(self, message: str) -> str:
        """Get a response from the local LLM for the user message."""
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(self.history)
        messages.append({"role": "user", "content": message})

        try:
            response = self.client.post(
                f"{self.base_url}/v1/chat/completions",
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                },
            )
            response.raise_for_status()
            data = response.json()

            assistant_message = data["choices"][0]["message"]["content"]

            # Update history
            self.history.append({"role": "user", "content": message})
            self.history.append({"role": "assistant", "content": assistant_message})

            # Keep history manageable (last 20 exchanges)
            if len(self.history) > 40:
                self.history = self.history[-40:]

            return assistant_message

        except httpx.ConnectError:
            raise ConnectionError(f"Cannot connect to local LLM at {self.base_url}. Is it running?")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Local LLM request failed: {e.response.status_code}")

    def reset_chat(self) -> None:
        """Reset the conversation history."""
        self.history = []

    def is_available(self) -> bool:
        """Check if the local LLM is accessible."""
        try:
            response = self.client.get(f"{self.base_url}/health", timeout=2.0)
            return response.status_code == 200
        except Exception:
            return False
