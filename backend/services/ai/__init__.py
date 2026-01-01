from services.ai.base import AIProvider
from services.ai.gemini import GeminiProvider

_providers = {
    "gemini": GeminiProvider,
}

_instance: AIProvider | None = None


def get_ai_provider(name: str = "gemini") -> AIProvider:
    """Get an AI provider instance by name."""
    global _instance

    if _instance is None:
        if name not in _providers:
            raise ValueError(f"Unknown AI provider: {name}. Available: {list(_providers.keys())}")
        _instance = _providers[name]()

    return _instance
