from services.ai.base import AIProvider
from services.ai.gemini import GeminiProvider

_providers = {
    "gemini": GeminiProvider,
}

# Per-container AI sessions
_container_sessions: dict[str, AIProvider] = {}

# Legacy single instance for backwards compatibility
_instance: AIProvider | None = None


def get_ai_provider(name: str = "gemini") -> AIProvider:
    """Get an AI provider instance by name (legacy single instance)."""
    global _instance

    if _instance is None:
        if name not in _providers:
            raise ValueError(f"Unknown AI provider: {name}. Available: {list(_providers.keys())}")
        _instance = _providers[name]()

    return _instance


def get_ai_for_container(container_id: str, name: str = "gemini") -> AIProvider:
    """Get or create an AI provider instance for a specific container."""
    global _container_sessions

    if container_id not in _container_sessions:
        if name not in _providers:
            raise ValueError(f"Unknown AI provider: {name}. Available: {list(_providers.keys())}")
        _container_sessions[container_id] = _providers[name]()

    return _container_sessions[container_id]


def clear_container_session(container_id: str) -> None:
    """Clear the AI session for a container (when container is closed)."""
    global _container_sessions
    if container_id in _container_sessions:
        del _container_sessions[container_id]


def clear_all_sessions() -> None:
    """Clear all container sessions (on disconnect)."""
    global _container_sessions
    _container_sessions = {}
