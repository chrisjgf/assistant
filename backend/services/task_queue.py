"""Task queue service for per-container FIFO task scheduling with async locks."""

import asyncio
import uuid
from datetime import datetime
from dataclasses import dataclass, field
from typing import Dict, Optional, Any, List, Callable, Awaitable
from enum import Enum


class TaskStatus(Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class QueuedTask:
    """A task in the queue."""
    id: str
    container_id: str
    task_type: str  # "claude_request", "gemini_request", "local_request"
    payload: Dict[str, Any]
    status: TaskStatus = TaskStatus.QUEUED
    created_at: datetime = field(default_factory=datetime.utcnow)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[str] = None
    error: Optional[str] = None


@dataclass
class ContainerQueue:
    """Queue and lock for a single container."""
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    running_task: Optional[QueuedTask] = None
    processor_running: bool = False


# Global storage
_container_queues: Dict[str, ContainerQueue] = {}
_all_tasks: Dict[str, QueuedTask] = {}


def _get_container_queue(container_id: str) -> ContainerQueue:
    """Get or create a queue for a container."""
    if container_id not in _container_queues:
        _container_queues[container_id] = ContainerQueue()
    return _container_queues[container_id]


async def queue_task(
    container_id: str,
    task_type: str,
    payload: Dict[str, Any],
) -> QueuedTask:
    """Add a task to a container's queue.

    Args:
        container_id: The container to queue the task for
        task_type: Type of task ("claude_request", "gemini_request", "local_request")
        payload: Task-specific data

    Returns:
        The created QueuedTask
    """
    task = QueuedTask(
        id=str(uuid.uuid4())[:8],
        container_id=container_id,
        task_type=task_type,
        payload=payload,
    )

    _all_tasks[task.id] = task

    cq = _get_container_queue(container_id)
    await cq.queue.put(task)

    return task


def cancel_task(task_id: str) -> bool:
    """Cancel a task by ID.

    If the task is queued, it will be marked as cancelled.
    If the task is running, it cannot be cancelled (would need process termination).

    Args:
        task_id: The task ID to cancel

    Returns:
        True if task was cancelled, False if not found or already complete
    """
    task = _all_tasks.get(task_id)
    if not task:
        return False

    if task.status == TaskStatus.QUEUED:
        task.status = TaskStatus.CANCELLED
        task.completed_at = datetime.utcnow()
        return True

    # Running tasks can't be cancelled without process termination
    if task.status == TaskStatus.RUNNING:
        return False

    # Already complete/failed/cancelled
    return False


def cancel_running_task(container_id: str) -> Optional[QueuedTask]:
    """Get the running task for a container (for cancellation by caller).

    Args:
        container_id: The container ID

    Returns:
        The running task or None
    """
    cq = _container_queues.get(container_id)
    if cq and cq.running_task:
        return cq.running_task
    return None


def clear_queue(container_id: str) -> int:
    """Clear all pending tasks for a container.

    Args:
        container_id: The container to clear

    Returns:
        Number of tasks cancelled
    """
    cq = _container_queues.get(container_id)
    if not cq:
        return 0

    cancelled = 0

    # Mark all queued tasks as cancelled
    for task in _all_tasks.values():
        if task.container_id == container_id and task.status == TaskStatus.QUEUED:
            task.status = TaskStatus.CANCELLED
            task.completed_at = datetime.utcnow()
            cancelled += 1

    # Clear the queue (create new empty queue)
    _container_queues[container_id] = ContainerQueue(
        lock=cq.lock,
        running_task=cq.running_task,
        processor_running=cq.processor_running,
    )

    return cancelled


def get_queue_status(container_id: str) -> Dict[str, Any]:
    """Get the status of a container's queue.

    Args:
        container_id: The container to check

    Returns:
        Dict with queue statistics
    """
    cq = _container_queues.get(container_id)

    # Count tasks by status for this container
    queued = sum(1 for t in _all_tasks.values()
                 if t.container_id == container_id and t.status == TaskStatus.QUEUED)
    running = 1 if cq and cq.running_task else 0
    completed = sum(1 for t in _all_tasks.values()
                    if t.container_id == container_id and t.status == TaskStatus.COMPLETED)
    failed = sum(1 for t in _all_tasks.values()
                 if t.container_id == container_id and t.status == TaskStatus.FAILED)
    cancelled = sum(1 for t in _all_tasks.values()
                    if t.container_id == container_id and t.status == TaskStatus.CANCELLED)

    return {
        "container_id": container_id,
        "queued": queued,
        "running": running,
        "completed": completed,
        "failed": failed,
        "cancelled": cancelled,
        "running_task": {
            "id": cq.running_task.id,
            "type": cq.running_task.task_type,
            "started_at": cq.running_task.started_at.isoformat() if cq.running_task.started_at else None,
        } if cq and cq.running_task else None,
    }


def get_task(task_id: str) -> Optional[QueuedTask]:
    """Get a task by ID."""
    return _all_tasks.get(task_id)


def get_pending_tasks(container_id: str) -> List[QueuedTask]:
    """Get all pending (queued) tasks for a container."""
    return [
        t for t in _all_tasks.values()
        if t.container_id == container_id and t.status == TaskStatus.QUEUED
    ]


async def process_queue(
    container_id: str,
    handler: Callable[[QueuedTask], Awaitable[None]],
) -> None:
    """Process tasks from a container's queue.

    This should be started as an asyncio task when the first task is queued.
    It runs continuously until the queue is empty.

    Args:
        container_id: The container to process
        handler: Async function to execute each task
    """
    cq = _get_container_queue(container_id)

    # Prevent multiple processors
    if cq.processor_running:
        return

    cq.processor_running = True

    try:
        while True:
            try:
                # Wait for a task with timeout to allow clean shutdown
                task = await asyncio.wait_for(cq.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                # Check if queue is really empty
                if cq.queue.empty():
                    break
                continue

            # Skip cancelled tasks
            if task.status == TaskStatus.CANCELLED:
                cq.queue.task_done()
                continue

            # Acquire lock for exclusive execution
            async with cq.lock:
                task.status = TaskStatus.RUNNING
                task.started_at = datetime.utcnow()
                cq.running_task = task

                try:
                    await handler(task)
                    task.status = TaskStatus.COMPLETED
                except Exception as e:
                    task.status = TaskStatus.FAILED
                    task.error = str(e)
                finally:
                    task.completed_at = datetime.utcnow()
                    cq.running_task = None

            cq.queue.task_done()

    finally:
        cq.processor_running = False


def start_processor(
    container_id: str,
    handler: Callable[[QueuedTask], Awaitable[None]],
) -> None:
    """Start a queue processor if not already running.

    Args:
        container_id: The container to process
        handler: Async function to execute each task
    """
    cq = _get_container_queue(container_id)
    if not cq.processor_running:
        asyncio.create_task(process_queue(container_id, handler))
