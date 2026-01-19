# Voice Assistant

A voice-controlled AI assistant with support for multiple AI providers and concurrent chat sessions.

## Features

- **Voice Interaction** - Speak naturally, get spoken responses via custom TTS
- **Multiple AI Providers** - Switch between Gemini, Claude, and Local LLM (Ollama)
- **Chat Containers** - Run up to 5 independent conversations simultaneously
- **Voice Commands** - Control the app hands-free ("switch to Claude", "create container", etc.)
- **Claude Code Integration** - Execute code tasks with planning/approval workflow

## Quick Start

1. **Setup environment**
   ```bash
   cp .env.example .env
   # Edit .env with your GEMINI_API_KEY
   ```

2. **Generate SSL certificates** (required for microphone access)
   ```bash
   mkdir -p certs
   openssl req -x509 -newkey rsa:4096 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes
   ```

3. **Start all services**
   ```bash
   ./start.sh
   ```

4. Open `https://localhost:5173` in your browser

## Requirements

- Python 3.11+ with CUDA support
- Node.js 18+ or Bun
- NVIDIA GPU (for Whisper STT and TTS)
- Optional: Ollama (for local LLM), Claude CLI (for code tasks)

## Voice Commands

| Command | Action |
|---------|--------|
| "Switch to Claude/Gemini/Local" | Change AI provider |
| "Switch to container A" | Change active container |
| "Create container" | Create new chat session |
| "Accept" / "Cancel" | Approve/deny Claude task |
| "Save chat" | Download conversation as JSON |

## Architecture

```
frontend/          React + Vite + TailwindCSS
backend/           FastAPI + WebSocket
  services/
    whisper_service.py   STT (faster-whisper)
    tts_service.py       TTS (Chatterbox)
    claude_service.py    Claude CLI integration
    ai/                  AI provider abstraction
```

## License

MIT
