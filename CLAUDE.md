# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Voice-controlled AI assistant with a React frontend and Python FastAPI backend. Users can speak to either Gemini (for quick conversational responses) or Claude (for code tasks with planning/approval flow). Supports multiple concurrent chat "containers" and text-to-speech output.

## Development Commands

### Backend (Python/FastAPI)
```bash
cd backend
source venv/bin/activate
python main.py  # Runs on https://0.0.0.0:8000 with SSL
```

### Frontend (React/Vite)
```bash
cd frontend
npm install
npm run dev     # Dev server with HMR
npm run build   # Build: tsc -b && vite build
npm run lint    # ESLint
```

### Environment Setup
Copy `.env.example` to `.env` and set:
- `GEMINI_API_KEY` - Required for Gemini AI
- `CUDA_DEVICE` - Optional GPU selection
- `CLAUDE_WORK_DIR` - Working directory for Claude CLI (defaults to ~/dev)

SSL certificates required in `certs/` (key.pem, cert.pem).

## Architecture

### Backend (`backend/`)
- `main.py` - FastAPI app with WebSocket (`/ws`) for real-time voice/AI communication and REST endpoints (`/tts`, `/tts/stream`)
- `services/whisper_service.py` - Speech-to-text using faster-whisper (large-v3 on CUDA)
- `services/tts_service.py` - Text-to-speech using Chatterbox TTS with optional voice cloning from `sample/reference_voice.wav`
- `services/claude_service.py` - Claude CLI integration with two modes:
  - Chat mode: Quick conversation via `--allowedTools ""`
  - Planning mode: Full task execution with `--dangerously-skip-permissions`
- `services/ai/` - AI provider abstraction (currently Gemini only)

### Frontend (`frontend/src/`)
- `context/ContainerContext.tsx` - State management for up to 5 chat containers (main, a-d) using React reducer
- `hooks/useSharedVoice.ts` - Core voice interaction logic: VAD (voice activity detection), WebSocket, TTS playback with chunked streaming
- `utils/voiceCommands.ts` - Voice command parsing for container switching, AI switching, task approval
- `components/ChatView.tsx` - Message display with per-message TTS playback

### Communication Flow
1. VAD detects speech end, sends WAV audio via WebSocket with container metadata
2. Backend transcribes with Whisper, returns transcription
3. Frontend parses for voice commands or routes to appropriate AI
4. AI response sent back, frontend plays TTS (chunked streaming for long responses)

### Voice Commands
Key commands parsed in `voiceCommands.ts`:
- `"switch to claude/gemini"` - Change AI provider
- `"switch to container A"` - Change active container
- `"accept/cancel"` - Approve/deny Claude task plan
- `"Claude, ..."` - Direct address switches to Claude mode
- `"collect context"` / `"learn about this project"` - Claude scans project

### Container System
Multiple independent chat sessions with separate AI instances, message history, and speaking state. Background containers can queue TTS for when switched back to.
