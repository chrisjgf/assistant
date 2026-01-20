import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load env
load_dotenv(Path(__file__).parent.parent / ".env")

# Set CUDA device for TTS/STT before any CUDA imports
# Both use the same GPU (2080 Ti = cuda:0)
stt_device = os.getenv("STT_DEVICE", "")
if stt_device.startswith("cuda:"):
    os.environ["CUDA_VISIBLE_DEVICES"] = stt_device.split(":")[1]

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, List

from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi.responses import StreamingResponse

from services.whisper_service import transcribe, get_model as get_whisper_model
from services.tts_service import synthesize, get_model as get_tts_model, is_available as tts_available, split_into_sentences
from services.ai import get_ai_for_container, clear_all_sessions, clear_container_session
from services.claude_service import start_task, confirm_task, deny_task, chat_with_claude, collect_context
from services import session_service
from services import task_queue
from services import git_service
from services import fs_service
from services.intent_service import IntentService, ActionType
from services.action_executor import ActionExecutor

app = FastAPI()

# Default to assistant directory for self-iteration when no category directory is linked
DEFAULT_WORK_DIR = str(Path(__file__).parent.parent.absolute())

# Initialize intent detection and action execution services
intent_service = IntentService()
action_executor = ActionExecutor(
    search_root=os.getenv("FS_SEARCH_ROOT", "~/dev"),
    default_dir=DEFAULT_WORK_DIR
)


@app.on_event("startup")
async def startup_event():
    """Preload models at startup to avoid first-request latency."""
    print("Preloading Whisper model...")
    get_whisper_model()
    if tts_available():
        print("Preloading TTS model...")
        get_tts_model()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket connected")

    # Track the current container ID and global mode for audio messages
    current_container_id = "main"
    current_global_mode = False
    current_directory_path = None
    current_project_context = None

    try:
        while True:
            message = await websocket.receive()

            # Handle binary audio data
            if "bytes" in message:
                data = message["bytes"]
                container_id = current_container_id
                is_global_mode = current_global_mode
                print(f"Received {len(data)} bytes of audio for container {container_id}{' (global mode)' if is_global_mode else ''}")

                # Transcribe audio to text
                user_text = transcribe(data)
                print(f"Transcription: {user_text}")

                if not user_text:
                    continue

                # Send transcription to client
                await websocket.send_json({
                    "type": "transcription",
                    "containerId": container_id,
                    "text": user_text
                })

                # In global mode, skip AI response - frontend handles category creation
                if is_global_mode:
                    print("Global mode - skipping AI response")
                    continue

                # Get AI response using container-specific session
                ai = get_ai_for_container(container_id)
                ai_response = ai.get_response(user_text)
                print(f"AI response for {container_id}: {ai_response}")

                # Send AI response to client
                await websocket.send_json({
                    "type": "response",
                    "containerId": container_id,
                    "text": ai_response
                })

            # Handle JSON text messages
            elif "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")

                # Handle audio metadata (sets container for next audio message)
                if msg_type == "audio_meta":
                    current_container_id = data.get("containerId", "main")
                    current_global_mode = data.get("globalMode", False)
                    current_directory_path = data.get("directoryPath")
                    current_project_context = data.get("projectContext")
                    print(f"Set container ID to: {current_container_id}{' (global mode)' if current_global_mode else ''}")
                    if current_directory_path:
                        print(f"  Directory context: {current_directory_path}")

                elif msg_type == "gemini_request":
                    # Direct Gemini request for a specific container
                    container_id = data.get("containerId", "main")
                    text = data.get("text", "")
                    print(f"Gemini request for {container_id}: {text}")

                    ai = get_ai_for_container(container_id)
                    ai_response = ai.get_response(text)

                    await websocket.send_json({
                        "type": "response",
                        "containerId": container_id,
                        "text": ai_response
                    })

                elif msg_type == "local_request":
                    # Local LLM request for a specific container
                    container_id = data.get("containerId", "main")
                    text = data.get("text", "")
                    directory_path = data.get("directoryPath") or current_directory_path
                    print(f"Local LLM request for {container_id}: {text}")
                    if directory_path:
                        print(f"  Directory context: {directory_path}")

                    try:
                        ai = get_ai_for_container(container_id, "local", work_dir=directory_path)
                        ai_response = ai.get_response(text)

                        await websocket.send_json({
                            "type": "local_response",
                            "containerId": container_id,
                            "text": ai_response
                        })
                    except ConnectionError as e:
                        await websocket.send_json({
                            "type": "local_error",
                            "containerId": container_id,
                            "error": str(e)
                        })
                    except Exception as e:
                        await websocket.send_json({
                            "type": "local_error",
                            "containerId": container_id,
                            "error": f"Local LLM error: {str(e)}"
                        })

                elif msg_type == "claude_chat":
                    # Conversational Claude mode - quick chat without planning
                    container_id = data.get("containerId", "main")
                    text = data.get("text", "")
                    context = data.get("context", "")
                    project_context = data.get("projectContext", "")
                    print(f"Claude chat for {container_id}: {text}")

                    # Include project context if available
                    full_context = context
                    if project_context:
                        full_context = f"Project Context:\n{project_context}\n\n{context}"

                    response = await chat_with_claude(text, full_context)

                    await websocket.send_json({
                        "type": "claude_chat_response",
                        "containerId": container_id,
                        "text": response
                    })

                elif msg_type == "claude_collect_context":
                    # Collect project context
                    container_id = data.get("containerId", "main")
                    print(f"Collecting context for {container_id}")

                    context = await collect_context()

                    await websocket.send_json({
                        "type": "claude_context_collected",
                        "containerId": container_id,
                        "context": context
                    })

                elif msg_type == "claude_request":
                    # Planning mode - full plan with approval flow
                    container_id = data.get("containerId", "main")
                    print(f"Claude plan request for {container_id}: {data['text']}")
                    task = await start_task(data["text"], container_id)

                    if task.status.value == "failed":
                        await websocket.send_json({
                            "type": "claude_error",
                            "containerId": container_id,
                            "taskId": task.id,
                            "error": task.error
                        })
                    else:
                        await websocket.send_json({
                            "type": "claude_plan",
                            "containerId": container_id,
                            "taskId": task.id,
                            "plan": task.plan
                        })

                elif msg_type == "claude_confirm":
                    task_id = data.get("taskId")
                    container_id = data.get("containerId", "main")
                    print(f"Claude confirm for {container_id}: {task_id}")

                    await websocket.send_json({
                        "type": "claude_running",
                        "containerId": container_id,
                        "taskId": task_id
                    })

                    # Run in background so user can continue
                    asyncio.create_task(confirm_task(task_id, websocket))

                elif msg_type == "claude_deny":
                    task_id = data.get("taskId")
                    container_id = data.get("containerId", "main")
                    print(f"Claude deny for {container_id}: {task_id}")
                    deny_task(task_id)

                    await websocket.send_json({
                        "type": "claude_denied",
                        "containerId": container_id,
                        "taskId": task_id
                    })

                elif msg_type == "set_history":
                    # Set conversation history when switching AI providers
                    container_id = data.get("containerId", "main")
                    provider = data.get("provider", "gemini")
                    history = data.get("history", [])
                    print(f"Setting history for {container_id}/{provider}: {len(history)} messages")

                    if provider in ("gemini", "local"):
                        ai = get_ai_for_container(container_id, provider)
                        ai.set_history(history)

                elif msg_type == "clear_context":
                    # Clear all context for a container
                    container_id = data.get("containerId", "main")
                    print(f"Clearing context for {container_id}")

                    # Clear all AI sessions for this container
                    clear_container_session(container_id)

                # === Task Queue Messages ===

                elif msg_type == "queue_task":
                    # Add a task to the container's queue
                    container_id = data.get("containerId", "main")
                    task_type = data.get("taskType", "claude_request")
                    payload = data.get("payload", {})
                    print(f"Queueing {task_type} for {container_id}")

                    queued = await task_queue.queue_task(container_id, task_type, payload)

                    await websocket.send_json({
                        "type": "task_queued",
                        "containerId": container_id,
                        "taskId": queued.id,
                        "position": task_queue.get_queue_status(container_id)["queued"],
                    })

                    # Start processor if not running (handler defined below)
                    async def process_queued_task(task):
                        try:
                            if task.task_type == "claude_request":
                                claude_task = await start_task(task.payload.get("text", ""), container_id)
                                if claude_task.status.value == "failed":
                                    task.error = claude_task.error
                                    raise Exception(claude_task.error)
                                task.result = claude_task.plan
                                await websocket.send_json({
                                    "type": "queued_task_complete",
                                    "containerId": task.container_id,
                                    "taskId": task.id,
                                    "result": task.result,
                                })
                            elif task.task_type == "gemini_request":
                                ai = get_ai_for_container(task.container_id)
                                response = ai.get_response(task.payload.get("text", ""))
                                task.result = response
                                await websocket.send_json({
                                    "type": "queued_task_complete",
                                    "containerId": task.container_id,
                                    "taskId": task.id,
                                    "result": response,
                                })
                            elif task.task_type == "local_request":
                                directory_path = task.payload.get("directoryPath")
                                ai = get_ai_for_container(task.container_id, "local", work_dir=directory_path)
                                response = ai.get_response(task.payload.get("text", ""))
                                task.result = response
                                await websocket.send_json({
                                    "type": "queued_task_complete",
                                    "containerId": task.container_id,
                                    "taskId": task.id,
                                    "result": response,
                                })
                        except Exception as e:
                            await websocket.send_json({
                                "type": "queued_task_failed",
                                "containerId": task.container_id,
                                "taskId": task.id,
                                "error": str(e),
                            })

                    task_queue.start_processor(container_id, process_queued_task)

                elif msg_type == "cancel_task":
                    # Cancel a specific task by ID
                    task_id = data.get("taskId")
                    container_id = data.get("containerId", "main")
                    print(f"Cancelling task {task_id}")

                    cancelled = task_queue.cancel_task(task_id)

                    await websocket.send_json({
                        "type": "task_cancelled",
                        "containerId": container_id,
                        "taskId": task_id,
                        "success": cancelled,
                    })

                elif msg_type == "queue_status":
                    # Get queue status for a container
                    container_id = data.get("containerId", "main")
                    status = task_queue.get_queue_status(container_id)

                    await websocket.send_json({
                        "type": "queue_status_response",
                        "containerId": container_id,
                        "status": status,
                    })

                elif msg_type == "clear_queue":
                    # Clear all pending tasks for a container
                    container_id = data.get("containerId", "main")
                    print(f"Clearing queue for {container_id}")

                    count = task_queue.clear_queue(container_id)

                    await websocket.send_json({
                        "type": "queue_cleared",
                        "containerId": container_id,
                        "cancelledCount": count,
                    })

                # === Git Worktree Messages ===

                elif msg_type == "switch_branch":
                    # Switch container to a different branch (create worktree if needed)
                    container_id = data.get("containerId", "main")
                    branch = data.get("branch", "")
                    print(f"Switching {container_id} to branch {branch}")

                    # Create worktree if it doesn't exist
                    result = await git_service.create_worktree(branch)

                    if result.get("success"):
                        await websocket.send_json({
                            "type": "branch_switched",
                            "containerId": container_id,
                            "branch": branch,
                            "worktreePath": result.get("path"),
                            "created": result.get("created", False),
                        })
                    else:
                        await websocket.send_json({
                            "type": "branch_switch_failed",
                            "containerId": container_id,
                            "branch": branch,
                            "error": result.get("error"),
                        })

                elif msg_type == "list_branches":
                    # List available branches
                    container_id = data.get("containerId", "main")
                    branches = await git_service.list_branches()

                    await websocket.send_json({
                        "type": "branches_list",
                        "containerId": container_id,
                        "branches": branches,
                    })

                # === Directory Commands ===

                elif msg_type == "list_directory":
                    # List directory contents for the current category
                    category_id = data.get("categoryId", "main")
                    directory_path = data.get("directoryPath") or current_directory_path

                    if directory_path:
                        try:
                            items = os.listdir(directory_path)
                            dirs = [d for d in items if os.path.isdir(os.path.join(directory_path, d))]
                            files = [f for f in items if os.path.isfile(os.path.join(directory_path, f))]
                            message = f"Found {len(dirs)} folders and {len(files)} files."
                            if dirs[:5]:
                                message += f" Folders: {', '.join(dirs[:5])}."
                            if files[:5]:
                                message += f" Files: {', '.join(files[:5])}."
                        except Exception as e:
                            message = f"Error listing directory: {e}"
                    else:
                        message = "No directory linked to this category."

                    await websocket.send_json({
                        "type": "list_directory_response",
                        "categoryId": category_id,
                        "message": message
                    })

                # === Action Intent Detection ===

                elif msg_type == "action_request":
                    # LLM-based intent detection and action execution
                    category_id = data.get("categoryId", "main")
                    text = data.get("text", "")
                    conversation_history = data.get("history", [])
                    directory_path = data.get("directoryPath")  # Category's linked directory
                    print(f"Action request for {category_id}: {text}")
                    if directory_path:
                        print(f"  Context directory: {directory_path}")

                    # Detect intent using Local LLM
                    intent = intent_service.detect_intent(text, conversation_history)
                    print(f"Detected intent: {intent.action_type.value} (confidence: {intent.confidence})")

                    if intent.action_type == ActionType.QUESTION:
                        # Not an action - tell frontend to route to regular AI
                        await websocket.send_json({
                            "type": "action_result",
                            "categoryId": category_id,
                            "isAction": False,
                            "text": text,  # Original text for AI routing
                        })
                    else:
                        # Execute the action with context directory
                        result = action_executor.execute(intent, context_directory=directory_path)

                        await websocket.send_json({
                            "type": "action_result",
                            "categoryId": category_id,
                            "isAction": True,
                            "result": result.to_dict(),
                        })

    except WebSocketDisconnect:
        print("WebSocket disconnected")
        # Clear all AI sessions on disconnect
        clear_all_sessions()

class TTSRequest(BaseModel):
    text: str

@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    try:
        audio_bytes = synthesize(request.text)
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as e:
        print(f"TTS error: {e}")
        return Response(content=str(e), status_code=500)


@app.post("/tts/stream")
async def text_to_speech_chunked(request: TTSRequest):
    """Stream TTS audio in chunks for faster time-to-first-audio."""
    sentences = split_into_sentences(request.text)

    if len(sentences) <= 1:
        # Short text, use regular TTS
        audio_bytes = synthesize(request.text)
        return Response(content=audio_bytes, media_type="audio/wav")

    print(f"Chunked TTS: {len(sentences)} sentences")

    def generate():
        # Generate all chunks in parallel using thread pool
        with ThreadPoolExecutor(max_workers=3) as executor:
            # Submit all synthesis jobs
            futures = [executor.submit(synthesize, s) for s in sentences]

            # Yield chunks in order (wait for each in sequence)
            # They run in parallel but we stream in order
            for i, future in enumerate(futures):
                try:
                    audio_bytes = future.result()
                    # Length-prefixed format: 4-byte big-endian length + data
                    length = len(audio_bytes)
                    yield length.to_bytes(4, 'big') + audio_bytes
                    print(f"Streamed chunk {i+1}/{len(sentences)}: {length} bytes")
                except Exception as e:
                    print(f"Chunk {i+1} failed: {e}")

    return StreamingResponse(generate(), media_type="application/octet-stream")

@app.get("/health")
async def health():
    return {"status": "ok"}


# === Session Endpoints ===

class SessionUpdateRequest(BaseModel):
    containers: dict = {}
    activeMode: str = None
    todoCategories: list = None
    brainCategories: list = None


@app.post("/session")
async def create_session():
    """Create a new session and return its UUID."""
    session = session_service.create_session()
    return session


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    """Retrieve a session by ID."""
    session = session_service.get_session(session_id)
    if session is None:
        return Response(content="Session not found", status_code=404)
    return session


@app.put("/session/{session_id}")
async def update_session(session_id: str, request: SessionUpdateRequest):
    """Update a session's data including categories."""
    # Build update dict with non-None values
    data = {"containers": request.containers}
    if request.activeMode is not None:
        data["activeMode"] = request.activeMode
    if request.todoCategories is not None:
        data["todoCategories"] = request.todoCategories
    if request.brainCategories is not None:
        data["brainCategories"] = request.brainCategories

    session = session_service.update_session_full(session_id, data)
    if session is None:
        return Response(content="Session not found", status_code=404)
    return session


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Delete a session."""
    deleted = session_service.delete_session(session_id)
    if not deleted:
        return Response(content="Session not found", status_code=404)
    return {"status": "deleted"}


@app.get("/sessions")
async def list_sessions(limit: int = 50):
    """List recent sessions."""
    sessions = session_service.list_sessions(limit)
    return {"sessions": sessions}


# === Category Endpoints ===

class CategoryCreateRequest(BaseModel):
    name: str


class CategoryUpdateRequest(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None
    activeAI: Optional[str] = None
    directoryPath: Optional[str] = None


class CategoryReorderRequest(BaseModel):
    categoryIds: List[str]


@app.post("/session/{session_id}/categories/{mode}")
async def create_category(session_id: str, mode: str, request: CategoryCreateRequest):
    """Create a new category in a session."""
    if mode not in ("todo", "brain"):
        return Response(content="Mode must be 'todo' or 'brain'", status_code=400)

    category = session_service.create_category(session_id, mode, request.name)
    if category is None:
        return Response(content="Session not found", status_code=404)
    return category


@app.put("/session/{session_id}/categories/{mode}/{category_id}")
async def update_category(session_id: str, mode: str, category_id: str, request: CategoryUpdateRequest):
    """Update a category."""
    if mode not in ("todo", "brain"):
        return Response(content="Mode must be 'todo' or 'brain'", status_code=400)

    updates = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.order is not None:
        updates["order"] = request.order
    if request.activeAI is not None:
        updates["activeAI"] = request.activeAI
    if request.directoryPath is not None:
        updates["directoryPath"] = request.directoryPath

    category = session_service.update_category(session_id, mode, category_id, updates)
    if category is None:
        return Response(content="Category not found", status_code=404)
    return category


@app.delete("/session/{session_id}/categories/{mode}/{category_id}")
async def delete_category(session_id: str, mode: str, category_id: str):
    """Delete a category."""
    if mode not in ("todo", "brain"):
        return Response(content="Mode must be 'todo' or 'brain'", status_code=400)

    deleted = session_service.delete_category(session_id, mode, category_id)
    if not deleted:
        return Response(content="Category not found", status_code=404)
    return {"status": "deleted"}


@app.put("/session/{session_id}/categories/{mode}/reorder")
async def reorder_categories(session_id: str, mode: str, request: CategoryReorderRequest):
    """Reorder categories."""
    if mode not in ("todo", "brain"):
        return Response(content="Mode must be 'todo' or 'brain'", status_code=400)

    success = session_service.reorder_categories(session_id, mode, request.categoryIds)
    if not success:
        return Response(content="Session not found", status_code=404)
    return {"status": "reordered"}


# === Task Endpoints (Todo mode) ===

class TaskCreateRequest(BaseModel):
    text: str


class TaskUpdateRequest(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None


@app.post("/session/{session_id}/categories/todo/{category_id}/tasks")
async def create_task(session_id: str, category_id: str, request: TaskCreateRequest):
    """Create a new task in a Todo category."""
    task = session_service.create_task(session_id, category_id, request.text)
    if task is None:
        return Response(content="Category not found", status_code=404)
    return task


@app.put("/session/{session_id}/tasks/{task_id}")
async def update_task(session_id: str, task_id: str, request: TaskUpdateRequest):
    """Update a task."""
    updates = {}
    if request.text is not None:
        updates["text"] = request.text
    if request.completed is not None:
        updates["completed"] = request.completed

    task = session_service.update_task(session_id, task_id, updates)
    if task is None:
        return Response(content="Task not found", status_code=404)
    return task


@app.delete("/session/{session_id}/tasks/{task_id}")
async def delete_task(session_id: str, task_id: str):
    """Delete a task."""
    deleted = session_service.delete_task(session_id, task_id)
    if not deleted:
        return Response(content="Task not found", status_code=404)
    return {"status": "deleted"}


# === Entry Endpoints (Brain mode) ===

class EntryCreateRequest(BaseModel):
    text: str


@app.post("/session/{session_id}/categories/brain/{category_id}/entries")
async def create_entry(session_id: str, category_id: str, request: EntryCreateRequest):
    """Create a new entry in a Brain category."""
    entry = session_service.create_entry(session_id, category_id, request.text)
    if entry is None:
        return Response(content="Category not found", status_code=404)
    return entry


@app.delete("/session/{session_id}/entries/{entry_id}")
async def delete_entry(session_id: str, entry_id: str):
    """Delete a brain entry."""
    deleted = session_service.delete_entry(session_id, entry_id)
    if not deleted:
        return Response(content="Entry not found", status_code=404)
    return {"status": "deleted"}


# === Synopsis Endpoint ===

@app.post("/session/{session_id}/categories/todo/{category_id}/synopsis")
async def generate_synopsis(session_id: str, category_id: str):
    """Generate an AI synopsis for a Todo category's tasks."""
    session_data = session_service.get_session(session_id)
    if session_data is None:
        return Response(content="Session not found", status_code=404)

    categories = session_data.get("todoCategories", [])
    category = None
    for cat in categories:
        if cat["id"] == category_id:
            category = cat
            break

    if category is None:
        return Response(content="Category not found", status_code=404)

    tasks = category.get("tasks", [])
    pending_tasks = [t for t in tasks if not t.get("completed", False)]

    if not pending_tasks:
        return {"synopsis": "All tasks completed! Great job."}

    # Build prompt for AI
    task_list = "\n".join([f"- {t['text']}" for t in pending_tasks])
    prompt = f"""You are a helpful productivity assistant. Given these pending tasks for a category called "{category['name']}", provide a brief "Up Next" recommendation (2-3 sentences max). Focus on suggesting which task to tackle first and why.

Tasks:
{task_list}

Respond with just the recommendation, no preamble."""

    try:
        # Use local LLM for synopsis generation
        directory_path = category.get("directoryPath")
        ai = get_ai_for_container(f"synopsis_{category_id}", "local", work_dir=directory_path)
        synopsis = ai.get_response(prompt)
        return {"synopsis": synopsis.strip()}
    except Exception as e:
        # Fallback to a simple recommendation
        first_task = pending_tasks[0]["text"]
        return {"synopsis": f"Start with: {first_task}"}


# === Git Worktree Endpoints ===

@app.get("/git/branches")
async def get_branches():
    """List all branches with worktree info."""
    branches = await git_service.list_branches()
    return {"branches": branches}


class WorktreeRequest(BaseModel):
    branch: str


@app.post("/git/worktree")
async def create_worktree(request: WorktreeRequest):
    """Create a worktree for a branch."""
    result = await git_service.create_worktree(request.branch)
    if not result.get("success"):
        return Response(content=result.get("error", "Unknown error"), status_code=400)
    return result


@app.delete("/git/worktree/{branch}")
async def delete_worktree(branch: str):
    """Remove a worktree."""
    result = await git_service.remove_worktree(branch)
    if not result.get("success"):
        return Response(content=result.get("error", "Unknown error"), status_code=400)
    return result


@app.get("/git/worktrees")
async def get_worktrees():
    """List all worktrees."""
    worktrees = await git_service.list_worktrees()
    return {"worktrees": worktrees}


# === Filesystem Endpoints ===

@app.get("/fs/list")
async def list_directory(path: str = "~/dev", max_depth: int = 1):
    """List directory contents."""
    dirs = fs_service.list_directory(path, max_depth)
    return {"directories": dirs, "count": len(dirs)}


@app.get("/fs/find")
async def find_directory(hint: str, parent: Optional[str] = None, root: str = "~/dev"):
    """Find directories by fuzzy match."""
    matches = fs_service.find_directory(hint, parent, root)
    return {
        "matches": [
            {"path": m.path, "name": m.name, "score": m.score}
            for m in matches
        ],
        "count": len(matches)
    }


@app.get("/fs/info")
async def get_directory_info(path: str):
    """Get directory information."""
    info = fs_service.get_directory_info(path)
    return {
        "path": info.path,
        "name": info.name,
        "isProject": info.is_project,
        "children": info.children,
    }


if __name__ == "__main__":
    import uvicorn
    cert_dir = Path(__file__).parent.parent / "certs"
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8001,
        ssl_keyfile=str(cert_dir / "key.pem"),
        ssl_certfile=str(cert_dir / "cert.pem"),
    )
