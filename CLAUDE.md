# CLAUDE.md

Development guidance for Claude Code when working in this repository.

## Quick Reference

```bash
# Start everything
./start.sh

# Or individually:
./start.sh backend    # Port 8001 (HTTPS)
./start.sh frontend   # Port 5173
./start.sh llm        # Ollama on 11434
./start.sh status     # Check service health
```

## Project Structure

```
backend/
  main.py                    # FastAPI app, WebSocket /ws, REST /tts
  services/
    whisper_service.py       # STT: faster-whisper large-v3
    tts_service.py           # TTS: Chatterbox with voice cloning
    claude_service.py        # Claude CLI wrapper (chat + planning modes)
    ai/
      base.py                # AIProvider abstract base
      gemini.py              # Google Gemini
      local.py               # Ollama + DuckDuckGo search

frontend/src/
  context/ContainerContext.tsx   # State: 5 containers (main, a-d)
  hooks/
    useSharedVoice.ts            # Core: VAD, WebSocket, TTS, commands
    useVoiceChat.ts              # Legacy hook
  utils/voiceCommands.ts         # Command parsing
  components/
    ChatView.tsx                 # Messages with TTS playback
    ContainerTabs.tsx            # Tab navigation
    StatusIndicator.tsx          # Status display
```

## Key Patterns

**WebSocket Protocol** - Frontend sends audio as WAV binary after JSON metadata:
```js
ws.send(JSON.stringify({ type: "audio_meta", containerId }))
ws.send(wavBuffer)
```

**AI Provider Interface** - All providers implement:
```python
class AIProvider:
    def get_response(self, message: str) -> str
    def reset_chat(self) -> None
    def set_history(self, history: list[dict]) -> None
```

**Voice Command Flow** - `voiceCommands.ts` parses transcriptions before AI routing. Commands return `VoiceCommand` objects handled by `useSharedVoice.ts`.

## Environment

Copy `.env.example` to `.env`:
- `GEMINI_API_KEY` - Required
- `LOCAL_LLM_MODEL` - Ollama model (default: qwen3-coder-256k)
- `CLAUDE_WORK_DIR` - Claude CLI working directory

SSL certs required in `certs/` for microphone access.
