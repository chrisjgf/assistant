import asyncio
import os
import uuid
from typing import Dict, Optional
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
    plan: Optional[str] = None
    status: TaskStatus = TaskStatus.PLANNING
    result: Optional[str] = None
    error: Optional[str] = None


_tasks: Dict[str, ClaudeTask] = {}


def get_work_dir() -> str:
    """Get the working directory for Claude CLI."""
    return os.getenv("CLAUDE_WORK_DIR", str(Path.home() / "dev"))


async def start_task(prompt: str) -> ClaudeTask:
    """Start Claude in planning mode to get task plan."""
    task_id = str(uuid.uuid4())[:8]
    task = ClaudeTask(
        id=task_id,
        prompt=prompt,
        status=TaskStatus.PLANNING,
    )
    _tasks[task_id] = task

    try:
        # Run Claude with --print to get plan without executing
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt, "--print",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(),
            timeout=60.0  # 60 second timeout for planning
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
            "taskId": task_id,
            "error": "Task not found"
        })
        return

    if task.status != TaskStatus.PENDING_APPROVAL:
        await websocket.send_json({
            "type": "claude_error",
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
                "taskId": task_id,
                "error": task.error
            })
            return

        task.result = stdout.decode().strip()
        task.status = TaskStatus.COMPLETED

        # Send completion notification
        await websocket.send_json({
            "type": "claude_complete",
            "taskId": task_id,
            "result": task.result
        })

    except Exception as e:
        task.status = TaskStatus.FAILED
        task.error = str(e)
        await websocket.send_json({
            "type": "claude_error",
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
