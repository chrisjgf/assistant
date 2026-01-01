from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from services.whisper_service import transcribe

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

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
