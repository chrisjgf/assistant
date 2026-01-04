import asyncio
import os
import uuid
from typing import Dict, Optional, AsyncGenerator
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path


class TaskStatus(Enum):
    PLANNING = "planning"
    PENDING_APPROVAL = "pending_approval"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    DENIED = "denied"


@dataclass
class ClaudeTask:
    id: str
    prompt: str
    container_id: str = "main"
    plan: Optional[str] = None
    status: TaskStatus = TaskStatus.PLANNING
    result: Optional[str] = None
    error: Optional[str] = None


_tasks: Dict[str, ClaudeTask] = {}


def get_work_dir() -> str:
    """Get the working directory for Claude CLI."""
    return os.getenv("CLAUDE_WORK_DIR", str(Path.home() / "dev"))


async def chat_with_claude(user_message: str, conversation_context: str = "") -> str:
    """Have a brief conversational exchange with Claude CLI.

    Uses --allowedTools "" to prevent tool use and get fast responses.
    This is for discussion only - no file access or code execution.

    Args:
        user_message: The user's current message
        conversation_context: Optional previous conversation for context

    Returns:
        Claude's response text
    """
    # Build a prompt that explains limitations and encourages action trigger
    chat_prompt = f"""You are a voice assistant in DISCUSSION MODE. You CANNOT create files, run commands, or make changes.
If the user asks you to DO something (create, fix, write, etc.), tell them to say "do this" or "do it" when ready.
Keep responses brief (2-3 sentences).
{f"Context:{chr(10)}{conversation_context}{chr(10)}{chr(10)}" if conversation_context else ""}User: {user_message}"""

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", chat_prompt,
            "--allowedTools", "",  # No tools = fast response
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=30.0  # 30s for chat responses
        )

        if proc.returncode != 0:
            error_msg = stderr.decode().strip()
            return f"Sorry, I encountered an error: {error_msg}"

        return stdout.decode().strip()

    except asyncio.TimeoutError:
        return "Sorry, I took too long to respond. Try again."
    except FileNotFoundError:
        return "Claude CLI is not installed or not in PATH."
    except Exception as e:
        return f"Sorry, an error occurred: {str(e)}"


async def collect_context() -> str:
    """Run Claude with Read/Glob to explore and summarize the project."""
    prompt = """Explore this project and create a brief summary including:
- What the project does (1-2 sentences)
- Key files and their purposes
- Tech stack
- Directory structure overview
Keep it concise (under 500 words) as this will be included in future prompts."""

    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt,
            "--allowedTools", "Read,Glob,Grep,Bash",
            "--print",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=120.0  # 2 minute timeout for exploration
        )

        if proc.returncode != 0:
            return f"Error collecting context: {stderr.decode().strip()}"

        return stdout.decode().strip()

    except asyncio.TimeoutError:
        return "Context collection timed out after 2 minutes."
    except Exception as e:
        return f"Error: {str(e)}"


async def start_task(prompt: str, container_id: str = "main") -> ClaudeTask:
    """Start Claude in planning mode to get task plan."""
    task_id = str(uuid.uuid4())[:8]
    task = ClaudeTask(
        id=task_id,
        prompt=prompt,
        container_id=container_id,
        status=TaskStatus.PLANNING,
    )
    _tasks[task_id] = task

    try:
        # Run Claude with no tools for fast planning (--print prevents execution anyway)
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt,
            "--allowedTools", "",  # No tools = fast response
            "--print",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=30.0  # 30 second timeout
        )

        if proc.returncode != 0:
            task.status = TaskStatus.FAILED
            task.error = stderr.decode().strip() or "Claude planning failed"
            return task

        task.plan = stdout.decode().strip()
        task.status = TaskStatus.PENDING_APPROVAL

    except asyncio.TimeoutError:
        task.status = TaskStatus.FAILED
        task.error = "Claude planning timed out"
    except FileNotFoundError:
        task.status = TaskStatus.FAILED
        task.error = "Claude CLI not found. Is it installed?"
    except Exception as e:
        task.status = TaskStatus.FAILED
        task.error = str(e)

    return task


async def confirm_task(task_id: str, websocket) -> None:
    """Execute confirmed task in background."""
    task = _tasks.get(task_id)
    if not task:
        await websocket.send_json({
            "type": "claude_error",
            "containerId": "main",
            "taskId": task_id,
            "error": "Task not found"
        })
        return

    if task.status != TaskStatus.PENDING_APPROVAL:
        await websocket.send_json({
            "type": "claude_error",
            "containerId": task.container_id,
            "taskId": task_id,
            "error": f"Task is not pending approval (status: {task.status.value})"
        })
        return

    task.status = TaskStatus.RUNNING

    try:
        # Run Claude with full permissions
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", task.prompt, "--dangerously-skip-permissions",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )

        # Wait for completion (no timeout - tasks can be long)
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            task.status = TaskStatus.FAILED
            task.error = stderr.decode().strip() or "Claude execution failed"
            await websocket.send_json({
                "type": "claude_error",
                "containerId": task.container_id,
                "taskId": task_id,
                "error": task.error
            })
            return

        task.result = stdout.decode().strip()
        task.status = TaskStatus.COMPLETED

        # Send completion notification
        await websocket.send_json({
            "type": "claude_complete",
            "containerId": task.container_id,
            "taskId": task_id,
            "result": task.result
        })

    except Exception as e:
        task.status = TaskStatus.FAILED
        task.error = str(e)
        await websocket.send_json({
            "type": "claude_error",
            "containerId": task.container_id,
            "taskId": task_id,
            "error": task.error
        })


def deny_task(task_id: str) -> bool:
    """Mark task as denied. Returns True if task was found."""
    task = _tasks.get(task_id)
    if task:
        task.status = TaskStatus.DENIED
        return True
    return False


def get_task(task_id: str) -> Optional[ClaudeTask]:
    """Get task by ID."""
    return _tasks.get(task_id)
