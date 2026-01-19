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

from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi.responses import StreamingResponse

from services.whisper_service import transcribe, get_model as get_whisper_model
from services.tts_service import synthesize, get_model as get_tts_model, is_available as tts_available, split_into_sentences
from services.ai import get_ai_for_container, clear_all_sessions, clear_container_session
from services.claude_service import start_task, confirm_task, deny_task, chat_with_claude, collect_context
from services import session_service
from services import task_queue
from services import git_service

app = FastAPI()


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

    # Track the current container ID for audio messages
    current_container_id = "main"

    try:
        while True:
            message = await websocket.receive()

            # Handle binary audio data
            if "bytes" in message:
                data = message["bytes"]
                container_id = current_container_id
                print(f"Received {len(data)} bytes of audio for container {container_id}")

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
                    print(f"Set container ID to: {current_container_id}")

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
                    print(f"Local LLM request for {container_id}: {text}")

                    try:
                        ai = get_ai_for_container(container_id, "local")
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
                                ai = get_ai_for_container(task.container_id, "local")
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
    containers: dict


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
    """Update a session's container data."""
    session = session_service.update_session(session_id, request.containers)
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
