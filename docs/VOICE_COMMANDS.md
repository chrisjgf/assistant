# Voice Commands

This document describes how voice commands work in the assistant, including how to use them and how they are processed internally.

## Overview

The voice command system allows hands-free control of the assistant through natural speech. Commands are processed through a multi-stage pipeline:

1. **Voice Activity Detection (VAD)** - Detects when you start/stop speaking
2. **Speech-to-Text** - Whisper transcribes audio to text
3. **Command Parsing** - Frontend checks for recognized commands
4. **Command Handling** - Actions are executed locally or routed to AI

## Using Voice Commands

Press the microphone button to enter listening mode. Speak clearly, then press the button again (or say "send") to process your speech.

### Quick Reference

| Category | Command Examples |
|----------|-----------------|
| **Category Navigation** | "switch to work", "go to social category" |
| **Category Creation** | "create a work category", "new category called projects" |
| **Category Management** | "manage categories", "list categories" |
| **AI Switching** | "switch to claude", "switch to gemini", "switch to local" |
| **AI Escalation** | "escalate to claude", "move to gemini" |
| **Task Control** | "accept", "cancel", "plan this", "do this" |
| **Context** | "collect context", "wipe context", "clear history" |
| **Playback** | "repeat", "repeat that", "repeat the second last message" |
| **Session** | "save chat", "disable", "start" |
| **Voice Mode** | "stop listening", "send now" |
| **Directories** | "set directory to /path/to/project" |

---

## Command Categories

### Category Creation

Create new categories using natural speech. This works in two modes:

#### Global Mode (No Category Selected)
When no category is selected, speak naturally to create one:
- "Create a social category"
- "Make a work category"
- "New category called projects"
- "Add a hobby category"

The system extracts the category name and creates it automatically.

#### From Within a Category
Use explicit commands:
- "create category" → Opens category management
- "new category" → Opens category management
- "manage categories" → Opens category management UI

### Category Navigation

Switch between existing categories:
- "switch to [name]" - e.g., "switch to work"
- "go to [name] category" - e.g., "go to social category"
- "select [name]" - e.g., "select projects"

Uses fuzzy matching, so "switch to soc" will match "Social".

### AI Provider Commands

**Switch AI** (clears context):
- "switch to claude" (variants: "cloud", "claw", "clude")
- "switch to gemini"
- "switch to local"

**Escalate to AI** (preserves context):
- "escalate to claude"
- "move to gemini"
- "escalate to local"

**Direct Claude Address**:
Prefix any message with "Claude, ..." to route directly to Claude:
- "Claude, explain this code"
- "Claude, help me fix this bug"

### Task Control (Claude Mode)

When using Claude for coding tasks:

| Command | Action |
|---------|--------|
| "accept" / "yes" / "approve" / "go ahead" | Accept proposed plan |
| "deny" / "no" / "cancel" / "nevermind" | Reject proposed plan |
| "plan this" | Create a plan from conversation |
| "do this" / "execute" | Plan and auto-execute |
| "task status" | Check current task status |

### Context Management

- "collect context" / "learn this project" / "scan project" - Scan codebase for context
- "wipe context" / "clear history" / "start fresh" - Clear conversation history
- "set directory to [path]" - Link a directory to current category

### Playback Commands

Repeat previous assistant messages:
- "repeat" / "repeat that" / "say that again"
- "repeat the last message"
- "repeat the second last message"
- "repeat the third last message"

### Session Commands

- "save chat" - Export conversation as JSON
- "disable" / "pause" - Disable AI responses
- "start" / "enable" / "resume" - Re-enable AI responses

### Voice Mode Commands

- "stop listening" - Exit listening mode
- "send" / "send now" / "that's all" - Process speech immediately

### Task Queue Commands

- "cancel task" - Cancel current queued task
- "queue status" - Check task queue
- "clear queue" - Clear all pending tasks

### Git Commands

- "switch to branch [name]" - Switch git branch
- "list branches" - Show available branches

---

## Architecture

### Frontend Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│  Microphone │───▶│  VAD (Web)  │───▶│ Audio Buffer │
└─────────────┘    └─────────────┘    └──────┬───────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────┐
│              WebSocket to Backend                    │
│  1. Send audio_meta (categoryId, globalMode)        │
│  2. Send WAV audio buffer                           │
└─────────────────────────────────────────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────┐
                              │  Backend: Whisper STT │
                              │  Returns transcription│
                              └───────────┬───────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────┐
│           Frontend: parseVoiceCommand()             │
│  voiceCommands.ts - Pattern matching                │
└─────────────────────────────────────────────────────┘
                                          │
                   ┌──────────────────────┼──────────────────────┐
                   │                      │                      │
                   ▼                      ▼                      ▼
          ┌───────────────┐    ┌──────────────────┐    ┌─────────────┐
          │ Command Found │    │ Claude Address   │    │ No Command  │
          │ handleVoice() │    │ "Claude, ..."    │    │ Route to AI │
          └───────────────┘    └──────────────────┘    └─────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `frontend/src/utils/voiceCommands.ts` | Command pattern matching |
| `frontend/src/hooks/useSharedVoice.ts` | Voice handling, command execution |
| `backend/services/intent_service.py` | LLM-based intent detection (Local mode) |
| `backend/services/action_executor.py` | Execute detected actions |
| `backend/services/fs_service.py` | Filesystem operations for directory commands |

### Command Types

Defined in `voiceCommands.ts`:

```typescript
export type VoiceCommandType =
  | "switch_container"      // Legacy container switching
  | "switch_category"       // Switch to category by name
  | "create_container"      // Create new (opens management)
  | "close_container"       // Close container
  | "send_to_container"     // Send to specific container
  | "save_chat"             // Export conversation
  | "disable_ai"            // Pause AI
  | "enable_ai"             // Resume AI
  | "switch_ai"             // Change AI provider
  | "escalate_ai"           // Change AI with context
  | "accept_task"           // Accept Claude plan
  | "deny_task"             // Reject Claude plan
  | "plan_task"             // Request plan from conversation
  | "execute_task"          // Auto-execute task
  | "collect_context"       // Scan project
  | "task_status"           // Check task status
  | "wipe_context"          // Clear history
  | "repeat_message"        // Replay TTS
  | "ignored"               // Ignored phrases
  | "cancel_queue_task"     // Cancel queued task
  | "queue_status"          // Check queue
  | "clear_queue"           // Clear task queue
  | "switch_branch"         // Git branch switch
  | "list_branches"         // List git branches
  | "stop_listening"        // Exit voice mode
  | "send_now"              // Process immediately
  | "manage_categories"     // Open category UI
  | "list_categories"       // Show categories
  | "set_directory"         // Link directory
```

---

## Local LLM Intent Detection

When using the **Local AI** mode, there's an additional layer of intent detection that uses the LLM to understand natural language requests for app actions.

### How It Works

1. User speaks naturally (e.g., "hook up the social directory")
2. Frontend sends `action_request` to backend
3. `IntentService` uses Local LLM to classify intent
4. If it's an app action, `ActionExecutor` handles it
5. If it's a question, routes to regular AI chat

### Detected Action Types

| Action | Triggers | Example |
|--------|----------|---------|
| `create_category` | "create", "make", "new category" | "create a work category" |
| `link_directory` | "link", "connect", "hook up" | "hook up the social directory" |
| `navigate_category` | "go to", "switch to", "open" | "go to my work category" |
| `find_directory` | "find", "where is", "locate" | "where is the social project" |
| `list_directories` | "list", "show", "what folders" | "what directories are under dev" |
| `question` | (default) | Regular conversation |

### Directory Fuzzy Matching

The `fs_service.py` provides fuzzy matching for directory names:

```
"social" → matches "social-app", "SocialNetwork", "my-social-project"
"under dev" → searches only in ~/dev subdirectories
```

---

## Adding New Commands

### 1. Add Command Type

In `frontend/src/utils/voiceCommands.ts`:

```typescript
export type VoiceCommandType =
  | // ... existing types
  | "my_new_command"
```

### 2. Add Interface Fields (if needed)

```typescript
export interface VoiceCommand {
  type: VoiceCommandType
  // Add new fields for your command
  myNewField?: string
  rawText: string
}
```

### 3. Add Pattern Matching

In `parseVoiceCommand()`:

```typescript
// My new command: "do something special"
if (
  normalized === "do something special" ||
  normalized.includes("something special")
) {
  return { type: "my_new_command", rawText: text }
}
```

### 4. Add Handler

In `frontend/src/hooks/useSharedVoice.ts`, inside `handleVoiceCommand()`:

```typescript
case "my_new_command": {
  stopThinkingBeat()
  updatePendingMessage(categoryId, command.rawText)

  // Your logic here
  const messageId = addLocalResponse(categoryId, "Did the special thing!")
  playTTS(categoryId, "Did the special thing!", messageId)
  return true
}
```

### 5. Backend Action (Optional)

For actions requiring backend processing, add to `intent_service.py` and `action_executor.py`.

---

## Troubleshooting

### Command Not Recognized

- Check exact phrasing in `voiceCommands.ts`
- Review transcription output in console
- Some words have common mishearings (e.g., "Claude" → "cloud", "claw")

### Audio Not Processing

- Ensure WebSocket is connected (check console)
- Verify microphone permissions in browser
- Check that VAD library loaded correctly

### TTS Not Playing

- Some browsers block autoplay - user interaction required first
- Check browser console for audio errors
- Verify TTS service is running (`/health` endpoint)

### Category Fuzzy Match Fails

- Category names are matched case-insensitively
- Partial matches work ("soc" matches "Social")
- Very short names may conflict with commands
