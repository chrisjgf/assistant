from abc import ABC, abstractmethod


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    @abstractmethod
    def get_response(self, message: str) -> str:
        """Get a response from the AI for the given message."""
        pass

    @abstractmethod
    def reset_chat(self) -> None:
        """Reset the conversation history."""
        pass

    def set_history(self, history: list[dict]) -> None:
        """Set the conversation history from external source.

        Args:
            history: List of messages with 'role' and 'content' keys
        """
        # Default implementation does nothing - subclasses can override
        pass
