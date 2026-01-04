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
from services.ai import get_ai_for_container, clear_all_sessions
from services.claude_service import start_task, confirm_task, deny_task, chat_with_claude, collect_context

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

if __name__ == "__main__":
    import uvicorn
    cert_dir = Path(__file__).parent.parent / "certs"
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        ssl_keyfile=str(cert_dir / "key.pem"),
        ssl_certfile=str(cert_dir / "cert.pem"),
    )
