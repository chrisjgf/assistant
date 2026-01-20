from services.ai.base import AIProvider
from services.ai.gemini import GeminiProvider
from services.ai.local import LocalProvider

_providers = {
    "gemini": GeminiProvider,
    "local": LocalProvider,
}

# Per-container AI sessions, keyed by (container_id, provider_name)
_container_sessions: dict[tuple[str, str], AIProvider] = {}

# Per-container work directories
_container_work_dirs: dict[str, str] = {}

# Legacy single instance for backwards compatibility
_instance: AIProvider | None = None


def set_container_work_dir(container_id: str, work_dir: str | None) -> None:
    """Set the working directory for a container's file operations."""
    global _container_work_dirs
    if work_dir:
        _container_work_dirs[container_id] = work_dir
    elif container_id in _container_work_dirs:
        del _container_work_dirs[container_id]


def get_ai_provider(name: str = "gemini") -> AIProvider:
    """Get an AI provider instance by name (legacy single instance)."""
    global _instance

    if _instance is None:
        if name not in _providers:
            raise ValueError(f"Unknown AI provider: {name}. Available: {list(_providers.keys())}")
        _instance = _providers[name]()

    return _instance


def get_ai_for_container(container_id: str, name: str = "gemini", work_dir: str = None) -> AIProvider:
    """Get or create an AI provider instance for a specific container and provider."""
    global _container_sessions, _container_work_dirs

    key = (container_id, name)

    # Update work_dir if provided
    if work_dir:
        _container_work_dirs[container_id] = work_dir

    if key not in _container_sessions:
        if name not in _providers:
            raise ValueError(f"Unknown AI provider: {name}. Available: {list(_providers.keys())}")
        # Pass work_dir to LocalProvider
        if name == "local":
            effective_work_dir = _container_work_dirs.get(container_id)
            _container_sessions[key] = _providers[name](work_dir=effective_work_dir)
        else:
            _container_sessions[key] = _providers[name]()
    elif name == "local" and work_dir:
        # Update existing LocalProvider's work_dir if changed
        provider = _container_sessions[key]
        if hasattr(provider, "work_dir"):
            provider.work_dir = work_dir

    return _container_sessions[key]


def clear_container_session(container_id: str, name: str | None = None) -> None:
    """Clear the AI session for a container (when container is closed)."""
    global _container_sessions
    if name:
        # Clear specific provider session
        key = (container_id, name)
        if key in _container_sessions:
            del _container_sessions[key]
    else:
        # Clear all provider sessions for this container
        keys_to_delete = [k for k in _container_sessions if k[0] == container_id]
        for key in keys_to_delete:
            del _container_sessions[key]


def clear_all_sessions() -> None:
    """Clear all container sessions (on disconnect)."""
    global _container_sessions
    _container_sessions = {}
