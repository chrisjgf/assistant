import os
import re
import json
import httpx
from pathlib import Path
from ddgs import DDGS
from services.ai.base import AIProvider


# Load SPEAKER.md for voice command reference
SPEAKER_MD_PATH = Path(__file__).parent.parent.parent / "SPEAKER.md"
SPEAKER_COMMANDS = ""
if SPEAKER_MD_PATH.exists():
    SPEAKER_COMMANDS = SPEAKER_MD_PATH.read_text()

SYSTEM_PROMPT = f"""You are a voice assistant engaged in natural spoken conversation. Your responses will be converted to speech, so:

- Keep responses concise (1-3 sentences) unless asked to elaborate
- Use natural, conversational language as if speaking aloud
- Avoid markdown, bullet points, or formatting that doesn't translate to speech
- Don't use asterisks, brackets, or special characters
- When asked to expand or explain more, provide fuller responses
- Be warm and personable while remaining helpful and accurate

## Available Tools

You have access to these tools - USE THEM when appropriate:

- **web_search**: Search the web for current information, news, weather, or facts
- **read_file**: Read file contents from the filesystem
- **write_file**: Create or modify files - USE THIS when asked to fix, edit, update, or change files
- **list_files**: List directory contents

IMPORTANT: When the user asks you to fix, edit, modify, update, or change a file, you MUST use the write_file tool to make the changes. Do not say you cannot edit files - you can and should use your tools.

## Available Voice Commands

The following document describes voice command patterns recognized by the app. When users ask about available commands or what they can say, reference this:

{SPEAKER_COMMANDS}"""

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
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file from the filesystem",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file to read (relative or absolute)"
                    },
                    "max_lines": {
                        "type": "integer",
                        "description": "Maximum number of lines to read (default 100)",
                        "default": 100
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write content to a file (creates or overwrites)",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the file to write"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file"
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files and directories in a path",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list (default: current directory)",
                        "default": "."
                    },
                    "show_hidden": {
                        "type": "boolean",
                        "description": "Whether to show hidden files (starting with .)",
                        "default": False
                    }
                },
                "required": []
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


def execute_read_file(path: str, max_lines: int = 100, work_dir: str = None) -> str:
    """Read the contents of a file."""
    try:
        # Resolve path relative to work_dir if provided
        if work_dir and not os.path.isabs(path):
            full_path = os.path.join(work_dir, path)
        else:
            full_path = os.path.expanduser(path)

        if not os.path.exists(full_path):
            return f"File not found: {path}"
        if not os.path.isfile(full_path):
            return f"Not a file: {path}"

        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()[:max_lines]
        content = "".join(lines)
        if len(lines) == max_lines:
            content += f"\n... (truncated at {max_lines} lines)"
        return content
    except Exception as e:
        return f"Error reading file: {str(e)}"


def execute_write_file(path: str, content: str, work_dir: str = None) -> str:
    """Write content to a file."""
    try:
        # Resolve path relative to work_dir if provided
        if work_dir and not os.path.isabs(path):
            full_path = os.path.join(work_dir, path)
        else:
            full_path = os.path.expanduser(path)

        # Ensure parent directory exists
        parent = os.path.dirname(full_path)
        if parent and not os.path.exists(parent):
            os.makedirs(parent, exist_ok=True)

        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully wrote to {path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"


def execute_list_files(path: str = ".", show_hidden: bool = False, work_dir: str = None) -> str:
    """List files and directories in a path."""
    try:
        # Resolve path relative to work_dir if provided
        if work_dir and not os.path.isabs(path):
            full_path = os.path.join(work_dir, path)
        else:
            full_path = os.path.expanduser(path)

        if not os.path.exists(full_path):
            return f"Path not found: {path}"
        if not os.path.isdir(full_path):
            return f"Not a directory: {path}"

        items = os.listdir(full_path)
        if not show_hidden:
            items = [i for i in items if not i.startswith(".")]

        # Separate dirs and files
        dirs = []
        files = []
        for item in sorted(items):
            item_path = os.path.join(full_path, item)
            if os.path.isdir(item_path):
                dirs.append(f"📁 {item}/")
            else:
                files.append(f"📄 {item}")

        result = []
        if dirs:
            result.extend(dirs)
        if files:
            result.extend(files)

        if not result:
            return "Directory is empty."
        return "\n".join(result[:50])  # Limit to 50 items
    except Exception as e:
        return f"Error listing directory: {str(e)}"


class LocalProvider(AIProvider):
    """Local LLM provider using Ollama API with tool calling."""

    def __init__(self, work_dir: str = None):
        self.base_url = os.getenv("LOCAL_LLM_URL", DEFAULT_LOCAL_LLM_URL)
        self.model = os.getenv("LOCAL_LLM_MODEL", MODEL_NAME)
        self.work_dir = work_dir  # Working directory for file operations
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
        elif tool_name == "read_file":
            path = arguments.get("path", "")
            max_lines = arguments.get("max_lines", 100)
            print(f"[Tool] Reading file: {path}")
            result = execute_read_file(path, max_lines, self.work_dir)
            print(f"[Tool] Read {len(result)} chars")
            return result
        elif tool_name == "write_file":
            path = arguments.get("path", "")
            content = arguments.get("content", "")
            print(f"[Tool] Writing file: {path}")
            result = execute_write_file(path, content, self.work_dir)
            print(f"[Tool] Write result: {result}")
            return result
        elif tool_name == "list_files":
            path = arguments.get("path", ".")
            show_hidden = arguments.get("show_hidden", False)
            print(f"[Tool] Listing files: {path}")
            result = execute_list_files(path, show_hidden, self.work_dir)
            print(f"[Tool] Found items: {result[:200]}...")
            return result
        return f"Unknown tool: {tool_name}"

    def _parse_text_tool_calls(self, content: str) -> list:
        """Parse tool calls from text format like <function=name>{args}</function>."""
        # Match patterns like: <function=write_file>{"path": "test.md", "content": "hello"}</function>
        # Use a more robust pattern that handles nested braces and multi-line content
        pattern = r'<function=(\w+)>\s*(\{.*?\})\s*(?:</function>)?'
        matches = re.findall(pattern, content, re.DOTALL)

        tool_calls = []
        for name, args_str in matches:
            try:
                # Try to parse as JSON
                args = json.loads(args_str)
                tool_calls.append({
                    "function": {"name": name, "arguments": args}
                })
                print(f"[Debug] Found text tool call: {name}({args})")
            except json.JSONDecodeError as e:
                print(f"[Debug] Failed to parse tool call args for {name}: {e}")
                continue
        return tool_calls

    def _load_project_context(self) -> str:
        """Load CLAUDE.md from work_dir if available."""
        if not self.work_dir:
            return ""
        claude_md_path = Path(self.work_dir) / "CLAUDE.md"
        if claude_md_path.exists():
            try:
                content = claude_md_path.read_text()
                return f"\n\n## Project Context\n\nYou are working in: {self.work_dir}\n\n{content}"
            except Exception as e:
                print(f"[Warning] Failed to read CLAUDE.md: {e}")
                return f"\n\nYou are working in: {self.work_dir}"
        return f"\n\nYou are working in: {self.work_dir}" if self.work_dir else ""

    def get_response(self, message: str) -> str:
        """Get a response from the local LLM, handling tool calls if needed."""
        # Include project context (CLAUDE.md) if work_dir is set
        system_content = SYSTEM_PROMPT + self._load_project_context()
        messages = [{"role": "system", "content": system_content}]
        messages.extend(self.history)
        messages.append({"role": "user", "content": message})

        try:
            # First LLM call
            data = self._call_llm(messages)
            assistant_msg = data.get("message", {})

            # Check for tool calls (structured format)
            tool_calls = assistant_msg.get("tool_calls", [])

            # Fallback: parse tool calls from text content if no structured calls
            if not tool_calls:
                text_content = assistant_msg.get("content", "")
                tool_calls = self._parse_text_tool_calls(text_content)
                if tool_calls:
                    print(f"[Debug] Parsed tool calls from text: {[tc['function']['name'] for tc in tool_calls]}")

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
