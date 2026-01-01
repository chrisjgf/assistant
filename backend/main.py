from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from services.whisper_service import transcribe
from services.tts_service import synthesize

app = FastAPI()

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
    uvicorn.run(app, host="0.0.0.0", port=8000)
