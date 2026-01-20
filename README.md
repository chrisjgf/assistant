# Speaker

A voice assistant application with multi-container support, session persistence, and AI integration.

## Features

- Multi-container voice chat with separate AI contexts
- Session persistence with auto-save
- Task queue system with cancellation
- Git worktree support for multi-branch development
- Voice command parsing and execution
- WebSocket-based real-time communication

## Getting Started

### Prerequisites

- Node.js >= 16
- Python 3.8+
- Ollama (for local LLM)
- Google Cloud account (for Gemini API)

### Installation

1. Clone the repository
2. Install backend dependencies:
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```

### Running the Application

1. Start the backend:
   ```bash
   ./start.sh backend
   ```
2. Start the frontend:
   ```bash
   ./start.sh frontend
   ```

### Voice Commands

See [SPEAKER.md](SPEAKER.md) for the full list of supported voice commands and natural language patterns.

## Project Structure

```
backend/
  main.py                    # FastAPI app, WebSocket /ws, REST endpoints
  services/
    whisper_service.py       # STT: faster-whisper large-v3
    tts_service.py           # TTS: Chatterbox with voice cloning
    claude_service.py        # Claude CLI wrapper (chat + planning modes)
    session_service.py       # Session persistence (JSON files)
    task_queue.py            # Per-container FIFO task queues
    git_service.py           # Git worktree management
    ai/
      base.py                # AIProvider abstract base
      gemini.py              # Google Gemini
      local.py               # Ollama + DuckDuckGo search
  data/
    sessions/                # Session JSON files (auto-created)

frontend/src/
  context/ContainerContext.tsx   # State: 5 containers (main, a-d), session integration
  hooks/
    useSharedVoice.ts            # Core: VAD, WebSocket, TTS, commands
    useSession.ts                # Session persistence management
    useTaskQueue.ts              # Task queue management
    useGitWorktree.ts            # Git worktree management
    useVoiceChat.ts              # Legacy hook
  utils/
    voiceCommands.ts             # Command parsing
    sessionStorage.ts            # localStorage wrapper
  components/
    ChatView.tsx                 # Messages with TTS playback
    ContainerTabs.tsx            # Tab navigation
    StatusIndicator.tsx          # Status display
```

## Development

### Adding New Voice Commands

To add a new voice command:
1. Add the command pattern to `frontend/src/utils/voiceCommands.ts`
2. Implement the command handler in `frontend/src/hooks/useSharedVoice.ts`
3. Update the README documentation

### Adding New AI Providers

To add a new AI provider:
1. Create a new class that inherits from `AIProvider` in `backend/services/ai/`
2. Implement the required methods: `get_response`, `reset_chat`, and `set_history`
3. Register the provider in `backend/main.py`

### Session Management

Sessions are automatically saved to `backend/data/sessions/` with UUID tokens. The frontend uses localStorage for temporary session data.

### Task Queue

Each container has its own task queue. Tasks are processed in FIFO order with support for cancellation.

### Git Worktree Support

The application supports multi-branch development using git worktrees. Commands include:
- `GET /git/branches` - List available branches
- `POST /git/worktree` - Create a new worktree
- `DELETE /git/worktree/{branch}` - Remove a worktree

## API Endpoints

- `GET /` - Main page
- `GET /ws` - WebSocket connection for voice chat
- `GET /sessions` - List all sessions
- `GET /sessions/{id}` - Get a specific session
- `POST /sessions` - Create a new session
- `PUT /sessions/{id}` - Update a session
- `DELETE /sessions/{id}` - Delete a session
- `GET /git/branches` - List git branches
- `POST /git/worktree` - Create git worktree
- `DELETE /git/worktree/{branch}` - Delete git worktree

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```
GEMINI_API_KEY=your_gemini_api_key_here
LOCAL_LLM_MODEL=qwen3-coder-256k
CLAUDE_WORK_DIR=/path/to/claudeworkdir
```

## License

This project is licensed under the MIT License.