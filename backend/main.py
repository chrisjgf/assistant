import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv

# Load env before setting CUDA device
load_dotenv(Path(__file__).parent.parent / ".env")

# Set CUDA device if specified (must be before torch import)
cuda_device = os.getenv("CUDA_DEVICE")
if cuda_device:
    os.environ["CUDA_VISIBLE_DEVICES"] = cuda_device

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi.responses import StreamingResponse

from services.whisper_service import transcribe, get_model as get_whisper_model
from services.tts_service import synthesize, get_model as get_tts_model, is_available as tts_available, split_into_sentences
from services.ai import get_ai_provider
from services.claude_service import start_task, confirm_task, deny_task

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

    try:
        while True:
            message = await websocket.receive()

            # Handle binary audio data
            if "bytes" in message:
                data = message["bytes"]
                print(f"Received {len(data)} bytes of audio")

                # Transcribe audio to text
                user_text = transcribe(data)
                print(f"Transcription: {user_text}")

                if not user_text:
                    continue

                # Send transcription to client
                await websocket.send_json({
                    "type": "transcription",
                    "text": user_text
                })

                # Get AI response
                ai = get_ai_provider()
                ai_response = ai.get_response(user_text)
                print(f"AI response: {ai_response}")

                # Send AI response to client
                await websocket.send_json({
                    "type": "response",
                    "text": ai_response
                })

            # Handle JSON text messages (Claude commands)
            elif "text" in message:
                data = json.loads(message["text"])
                msg_type = data.get("type")

                if msg_type == "claude_request":
                    print(f"Claude request: {data['text']}")
                    task = await start_task(data["text"])

                    if task.status.value == "failed":
                        await websocket.send_json({
                            "type": "claude_error",
                            "taskId": task.id,
                            "error": task.error
                        })
                    else:
                        await websocket.send_json({
                            "type": "claude_plan",
                            "taskId": task.id,
                            "plan": task.plan
                        })

                elif msg_type == "claude_confirm":
                    task_id = data.get("taskId")
                    print(f"Claude confirm: {task_id}")

                    await websocket.send_json({
                        "type": "claude_running",
                        "taskId": task_id
                    })

                    # Run in background so user can continue
                    asyncio.create_task(confirm_task(task_id, websocket))

                elif msg_type == "claude_deny":
                    task_id = data.get("taskId")
                    print(f"Claude deny: {task_id}")
                    deny_task(task_id)

                    await websocket.send_json({
                        "type": "claude_denied",
                        "taskId": task_id
                    })

    except WebSocketDisconnect:
        print("WebSocket disconnected")

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
