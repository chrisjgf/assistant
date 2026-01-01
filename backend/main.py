import os
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

from services.whisper_service import transcribe
from services.tts_service import synthesize, get_model as get_tts_model, is_available as tts_available
from services.ai import get_ai_provider

app = FastAPI()


@app.on_event("startup")
async def startup_event():
    """Preload models at startup to avoid first-request latency."""
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
            data = await websocket.receive_bytes()
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
