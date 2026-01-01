# Voice AI Chat App - Tasks

## Completed
- [x] Initialize Vite + React + TypeScript project with Bun
- [x] Set up Tailwind CSS
- [x] Create Python backend with FastAPI
- [x] Implement whisper_service.py (faster-whisper transcription)
- [x] Implement tts_service.py (Piper TTS synthesis)
- [x] Implement gemini_service.py (Gemini chat)
- [x] Create WebSocket endpoint in main.py
- [x] Create useVoiceChat.ts hook (VAD + WebSocket + audio)
- [x] Create ChatView.tsx component
- [x] Create StatusIndicator.tsx component
- [x] Wire up App.tsx

## To Run

### Backend
```bash
cd backend
pip install -r requirements.txt
# Create .env with GEMINI_API_KEY
python main.py
```

### Frontend
```bash
cd frontend
bun install
bun dev
```

## Notes
- First run will download Whisper (~150MB) and Piper TTS models (~30MB)
- Set your GEMINI_API_KEY in a .env file in the project root
