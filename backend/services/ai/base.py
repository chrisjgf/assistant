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
