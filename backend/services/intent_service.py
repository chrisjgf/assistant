"""Intent detection service using Local LLM."""

import os
import re
import json
import httpx
from pathlib import Path
from typing import Optional, List
from dataclasses import dataclass, asdict
from enum import Enum


# Load SPEAKER.md for voice command reference
SPEAKER_MD_PATH = Path(__file__).parent.parent / "SPEAKER.md"
SPEAKER_CONTEXT = ""
if SPEAKER_MD_PATH.exists():
    SPEAKER_CONTEXT = SPEAKER_MD_PATH.read_text()


class ActionType(Enum):
    """Types of app actions the system can perform."""
    CREATE_CATEGORY = "create_category"
    LINK_DIRECTORY = "link_directory"
    NAVIGATE_CATEGORY = "navigate_category"
    FIND_DIRECTORY = "find_directory"
    LIST_DIRECTORIES = "list_directories"
    QUESTION = "question"  # Not an action, route to AI


@dataclass
class DetectedIntent:
    """Represents a detected user intent."""
    action_type: ActionType
    category_name: Optional[str] = None
    directory_hint: Optional[str] = None
    parent_hint: Optional[str] = None
    navigate_after: bool = False
    raw_text: str = ""
    confidence: float = 0.0

    def to_dict(self) -> dict:
        result = asdict(self)
        result["action_type"] = self.action_type.value
        return result


INTENT_SYSTEM_PROMPT = f"""You are an intent classifier for a voice-controlled coding assistant app. Your job is to determine if the user wants to perform an app action or ask a question.

The app manages "categories" (like containers/workspaces) that can be linked to filesystem directories for coding projects.

## Voice Command Reference
{SPEAKER_CONTEXT}

## Available Action Types for Classification
- create_category: Create a new category/container (triggers: "create", "make", "new category/container")
- link_directory: Connect a directory to the current category (triggers: "link", "connect", "hook up", "associate")
- navigate_category: Switch to/open a category (triggers: "go to", "switch to", "open" + category name)
- find_directory: Look up a directory path (triggers: "find", "where is", "locate" + directory name)
- list_directories: List directories in a location (triggers: "list", "show", "what directories/folders")
- question: Regular question or conversation (default if not an app action)

IMPORTANT: Only classify as an action if the user clearly intends to perform an app operation. General coding questions, requests for explanations, or conversational messages should be "question".

Respond with ONLY valid JSON, no other text:
{{
  "action_type": "create_category|link_directory|navigate_category|find_directory|list_directories|question",
  "category_name": "extracted category name or null",
  "directory_hint": "partial directory name to search for or null",
  "parent_hint": "parent directory hint (e.g., 'dev' from 'under dev') or null",
  "navigate_after": true if should navigate to the category after creating,
  "confidence": 0.0-1.0 how confident you are this is correct
}}"""


DEFAULT_LOCAL_LLM_URL = "http://localhost:11434"
MODEL_NAME = "qwen3-coder-256k"


class IntentService:
    """Service for detecting user intent using Local LLM."""

    def __init__(self):
        self.base_url = os.getenv("LOCAL_LLM_URL", DEFAULT_LOCAL_LLM_URL)
        self.model = os.getenv("LOCAL_LLM_MODEL", MODEL_NAME)
        self.client = httpx.Client(timeout=30.0)

    def _call_llm(self, messages: List[dict]) -> str:
        """Make a call to the Ollama API."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_ctx": 4096,  # Small context for intent detection
                "temperature": 0.1,  # Low temperature for consistent classification
            },
        }

        try:
            response = self.client.post(
                f"{self.base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("message", {}).get("content", "")

            # Strip thinking tags if present
            content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL)

            return content.strip()
        except Exception as e:
            print(f"[IntentService] LLM call failed: {e}")
            return ""

    def detect_intent(
        self,
        text: str,
        conversation_history: Optional[List[dict]] = None
    ) -> DetectedIntent:
        """
        Detect user intent from natural language.

        Args:
            text: The user's transcribed speech
            conversation_history: Recent conversation for context

        Returns:
            DetectedIntent with action type and extracted parameters
        """
        messages = [{"role": "system", "content": INTENT_SYSTEM_PROMPT}]

        # Add conversation context if available
        if conversation_history:
            context_text = "\n".join([
                f"{m.get('role', 'user')}: {m.get('content', '')}"
                for m in conversation_history[-5:]
            ])
            messages.append({
                "role": "user",
                "content": f"Recent conversation context:\n{context_text}\n\n---\n\nClassify this user request: \"{text}\""
            })
        else:
            messages.append({
                "role": "user",
                "content": f"Classify this user request: \"{text}\""
            })

        response = self._call_llm(messages)

        # Parse JSON response
        try:
            # Try to extract JSON from response (in case there's extra text)
            json_match = re.search(r'\{[^{}]*\}', response, re.DOTALL)
            if json_match:
                response = json_match.group()

            data = json.loads(response)

            action_type_str = data.get("action_type", "question")
            try:
                action_type = ActionType(action_type_str)
            except ValueError:
                action_type = ActionType.QUESTION

            return DetectedIntent(
                action_type=action_type,
                category_name=data.get("category_name"),
                directory_hint=data.get("directory_hint"),
                parent_hint=data.get("parent_hint"),
                navigate_after=data.get("navigate_after", False),
                raw_text=text,
                confidence=data.get("confidence", 0.5)
            )
        except (json.JSONDecodeError, KeyError) as e:
            print(f"[IntentService] Failed to parse response: {e}")
            print(f"[IntentService] Raw response: {response}")
            # Fallback to question if parsing fails
            return DetectedIntent(
                action_type=ActionType.QUESTION,
                raw_text=text,
                confidence=0.0
            )

    def is_available(self) -> bool:
        """Check if the LLM service is accessible."""
        try:
            response = self.client.get(f"{self.base_url}/api/tags", timeout=2.0)
            return response.status_code == 200
        except Exception:
            return False
