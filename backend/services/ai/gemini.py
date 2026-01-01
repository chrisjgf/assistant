import os
import google.generativeai as genai
from services.ai.base import AIProvider


SYSTEM_PROMPT = """You are a voice assistant engaged in natural spoken conversation. Your responses will be converted to speech, so:

- Keep responses concise (1-3 sentences) unless asked to elaborate
- Use natural, conversational language as if speaking aloud
- Avoid markdown, bullet points, or formatting that doesn't translate to speech
- Don't use asterisks, brackets, or special characters
- When asked to expand or explain more, provide fuller responses
- Be warm and personable while remaining helpful and accurate"""


class GeminiProvider(AIProvider):
    """Gemini AI provider implementation."""

    def __init__(self):
        self.model = None
        self.chat = None
        self._initialize()

    def _initialize(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set")

        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(
            "gemini-3-flash-preview",
            system_instruction=SYSTEM_PROMPT
        )
        self.chat = self.model.start_chat(history=[])

    def get_response(self, message: str) -> str:
        """Get a response from Gemini for the user message."""
        if self.chat is None:
            self._initialize()

        response = self.chat.send_message(message)
        return response.text

    def reset_chat(self) -> None:
        """Reset the chat history."""
        if self.model is not None:
            self.chat = self.model.start_chat(history=[])
