import os
import re
import json
import httpx
from ddgs import DDGS
from services.ai.base import AIProvider


SYSTEM_PROMPT = """You are a voice assistant engaged in natural spoken conversation. Your responses will be converted to speech, so:

- Keep responses concise (1-3 sentences) unless asked to elaborate
- Use natural, conversational language as if speaking aloud
- Avoid markdown, bullet points, or formatting that doesn't translate to speech
- Don't use asterisks, brackets, or special characters
- When asked to expand or explain more, provide fuller responses
- Be warm and personable while remaining helpful and accurate

You have access to a web_search tool. Use it when you need current information, facts you're unsure about, or when the user asks about recent events, news, weather, or anything time-sensitive."""

DEFAULT_LOCAL_LLM_URL = "http://localhost:11434"
MODEL_NAME = "qwen3-coder-256k"
CONTEXT_SIZE = 262144  # 256k context

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information, news, weather, or facts",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Number of results to return (1-10)",
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
]


def execute_web_search(query: str, max_results: int = 5) -> str:
    """Execute a web search using DuckDuckGo."""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        if not results:
            return "No search results found."
        return "\n".join([f"- {r['title']}: {r['body']}" for r in results])
    except Exception as e:
        return f"Search failed: {str(e)}"


class LocalProvider(AIProvider):
    """Local LLM provider using Ollama API with tool calling."""

    def __init__(self):
        self.base_url = os.getenv("LOCAL_LLM_URL", DEFAULT_LOCAL_LLM_URL)
        self.model = os.getenv("LOCAL_LLM_MODEL", MODEL_NAME)
        self.history: list[dict] = []
        self.client = httpx.Client(timeout=120.0)

    def _call_llm(self, messages: list, use_tools: bool = True) -> dict:
        """Make a call to the Ollama API."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "num_ctx": CONTEXT_SIZE,
            },
        }
        if use_tools:
            payload["tools"] = TOOLS

        response = self.client.post(
            f"{self.base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        # Debug: log if tool calls are present
        msg = data.get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if tool_calls:
            print(f"[Debug] Tool calls detected: {[tc['function']['name'] for tc in tool_calls]}")
        else:
            print(f"[Debug] No tool calls. Content: {msg.get('content', '')[:100]}...")

        return data

    def _execute_tool(self, tool_name: str, arguments: dict) -> str:
        """Execute a tool and return the result."""
        if tool_name == "web_search":
            query = arguments.get("query", "")
            max_results = arguments.get("max_results", 5)
            print(f"[Tool] Searching: {query}")
            result = execute_web_search(query, max_results)
            print(f"[Tool] Results: {result[:200]}...")
            return result
        return f"Unknown tool: {tool_name}"

    def get_response(self, message: str) -> str:
        """Get a response from the local LLM, handling tool calls if needed."""
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        messages.extend(self.history)
        messages.append({"role": "user", "content": message})

        try:
            # First LLM call
            data = self._call_llm(messages)
            assistant_msg = data.get("message", {})

            # Check for tool calls
            tool_calls = assistant_msg.get("tool_calls", [])
            if tool_calls:
                # Add assistant message with tool calls to conversation
                messages.append({
                    "role": "assistant",
                    "content": assistant_msg.get("content") or "",
                    "tool_calls": tool_calls
                })

                # Execute each tool call
                for tool_call in tool_calls:
                    tool_name = tool_call["function"]["name"]
                    arguments = tool_call["function"].get("arguments", {})
                    if isinstance(arguments, str):
                        arguments = json.loads(arguments)
                    result = self._execute_tool(tool_name, arguments)

                    # Add tool result to conversation
                    messages.append({
                        "role": "tool",
                        "content": result
                    })

                # Get final response after tool execution
                data = self._call_llm(messages, use_tools=False)
                assistant_msg = data.get("message", {})

            # Extract final content
            content = assistant_msg.get("content", "")

            # Strip thinking tags if present
            content = re.sub(r"<think>.*?</think>\s*", "", content, flags=re.DOTALL)

            # Update history
            self.history.append({"role": "user", "content": message})
            self.history.append({"role": "assistant", "content": content})

            # Keep history manageable (last 20 exchanges)
            if len(self.history) > 40:
                self.history = self.history[-40:]

            return content

        except httpx.ConnectError:
            raise ConnectionError(f"Cannot connect to Ollama at {self.base_url}. Is it running?")
        except httpx.HTTPStatusError as e:
            raise RuntimeError(f"Ollama request failed: {e.response.status_code}")

    def reset_chat(self) -> None:
        """Reset the conversation history."""
        self.history = []

    def set_history(self, history: list[dict]) -> None:
        """Set conversation history from external source."""
        # Convert to local format
        self.history = []
        for msg in history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            self.history.append({"role": role, "content": content})

    def is_available(self) -> bool:
        """Check if Ollama is accessible."""
        try:
            response = self.client.get(f"{self.base_url}/api/tags", timeout=2.0)
            return response.status_code == 200
        except Exception:
            return False
