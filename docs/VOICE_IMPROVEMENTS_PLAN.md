# Voice Handling & Contextual Awareness Improvements

This document details the implementation plan for seven enhancements to the voice assistant system.

---

## Table of Contents

1. [Category Name Extraction](#1-category-name-extraction)
2. [Context-Specific Directory Commands](#2-context-specific-directory-commands)
3. [Voice Commands via Markdown](#3-voice-commands-via-markdown)
4. [Self-Iteration Default Directory](#4-self-iteration-default-directory)
5. [File Editing via Local LLM](#5-file-editing-via-local-llm)
6. [VoiceButton UI Improvements](#6-voicebutton-ui-improvements)
7. [Recent Speech Display](#7-recent-speech-display)
8. [Implementation Order](#implementation-order)
9. [File Reference](#file-reference)

---

## 1. Category Name Extraction

### Problem

When saying "create a new category called Work", the system creates a category named "New" instead of "Work". The voice command parser doesn't extract the category name from natural speech.

### Root Cause

In `frontend/src/utils/voiceCommands.ts` (lines 379-391), the parser matches exact phrases like "create category" and returns a `manage_categories` command type with no name extraction.

### Solution

Add a regex pattern with a capture group before the existing category management patterns:

```typescript
// frontend/src/utils/voiceCommands.ts

// Add new command type
export type VoiceCommandType =
  // ... existing types
  | "create_category_with_name"

// Add pattern before line 379
const createCategoryMatch = normalized.match(
  /^(?:create|make|new|add)\s+(?:a\s+)?(?:new\s+)?category\s+(?:called|named)\s+(.+)$/i
)
if (createCategoryMatch) {
  const rawName = createCategoryMatch[1].trim()
  const categoryName = rawName
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
  return { type: "create_category_with_name", categoryName, rawText: text }
}
```

Add handler in `useSharedVoice.ts`:

```typescript
// frontend/src/hooks/useSharedVoice.ts - in handleVoiceCommand switch

case "create_category_with_name": {
  if (command.categoryName) {
    stopThinkingBeat()
    updatePendingMessage(categoryId, command.rawText)

    createCategory(command.categoryName).then((newCategory) => {
      if (newCategory) {
        selectCategory(newCategory.id)
        navigateToView("chat")
        const messageId = addLocalResponse(categoryId, `Created ${command.categoryName} category.`)
        playTTS(categoryId, `Created ${command.categoryName}. How can I help?`, messageId)
      }
    })
    return true
  }
  return false
}
```

### Test Cases

| Voice Input | Expected Result |
|-------------|-----------------|
| "create a new category called Projects" | Creates "Projects" category |
| "make a category named Frontend" | Creates "Frontend" category |
| "new category called my work stuff" | Creates "My Work Stuff" category |
| "create category" | Opens category management (existing behavior) |

---

## 2. Context-Specific Directory Commands

### Problem

When inside a category linked to a directory (e.g., "social" linked to `/home/x01/dev/social`), commands like "list the directory" or "show files here" don't know which directory to use.

### Root Cause

The `directoryPath` field exists on categories but isn't passed through WebSocket messages to the backend. The IntentService and ActionExecutor don't receive directory context.

### Solution

#### Step 1: Pass directory context in WebSocket messages

```typescript
// frontend/src/hooks/useSharedVoice.ts - processBufferedSpeech

wsRef.current?.send(JSON.stringify({
  type: "audio_meta",
  containerId: categoryId,
  globalMode: isGlobalMode,
  directoryPath: category?.directoryPath || null,    // ADD
  projectContext: category?.projectContext || null   // ADD
}))
```

#### Step 2: Track context in backend

```python
# backend/main.py - WebSocket handler

# Add state variables
current_directory_path = None
current_project_context = None

# In audio_meta handler
elif msg_type == "audio_meta":
    current_container_id = data.get("containerId", "main")
    current_global_mode = data.get("globalMode", False)
    current_directory_path = data.get("directoryPath")      # ADD
    current_project_context = data.get("projectContext")    # ADD
```

#### Step 3: Add list_directory command

```typescript
// frontend/src/utils/voiceCommands.ts

// Add command type
| "list_directory"

// Add pattern
const listDirMatch = normalized.match(
  /^(?:list|show)\s+(?:the\s+)?(?:directory|files|folder)(?:\s+here)?$/i
)
if (listDirMatch) {
  return { type: "list_directory", rawText: text }
}
```

#### Step 4: Add backend handler

```python
# backend/main.py

elif msg_type == "list_directory":
    category_id = data.get("categoryId", "main")
    directory_path = data.get("directoryPath") or current_directory_path

    if directory_path:
        try:
            items = os.listdir(directory_path)
            dirs = [d for d in items if os.path.isdir(os.path.join(directory_path, d))]
            files = [f for f in items if os.path.isfile(os.path.join(directory_path, f))]
            message = f"Found {len(dirs)} folders and {len(files)} files."
            if dirs[:5]:
                message += f" Folders: {', '.join(dirs[:5])}."
            if files[:5]:
                message += f" Files: {', '.join(files[:5])}."
        except Exception as e:
            message = f"Error listing directory: {e}"
    else:
        message = "No directory linked to this category."

    await websocket.send_json({
        "type": "list_directory_response",
        "categoryId": category_id,
        "message": message
    })
```

#### Step 5: Handle response in frontend

```typescript
// frontend/src/hooks/useSharedVoice.ts - WebSocket message handler

case "list_directory_response": {
  const { categoryId, message } = data
  const messageId = addLocalResponse(categoryId, message)
  playTTS(categoryId, message, messageId)
  break
}
```

### Test Cases

| Context | Voice Input | Expected Result |
|---------|-------------|-----------------|
| Category linked to `/dev/social` | "list the directory" | Shows files in /dev/social |
| Category with no directory | "show files here" | "No directory linked to this category" |
| Category linked to project | "what files are here" | Lists directory contents |

---

## 3. Voice Commands via Markdown

### Problem

Voice commands are hardcoded as regex patterns in `voiceCommands.ts`. The LLM doesn't know what commands are available, making natural language interpretation difficult. Users can't easily modify command patterns.

### Solution

Use the existing `speaker.md` file as the single source of truth for voice commands. Load it into the LLM system prompt so it can interpret commands naturally.

#### Step 1: Enhance speaker.md

The file already exists with good structure. Add any missing commands and ensure it's comprehensive.

#### Step 2: Load in Local LLM provider

```python
# backend/services/ai/local.py

from pathlib import Path

# Load speaker.md at module level
SPEAKER_MD_PATH = Path(__file__).parent.parent.parent / "speaker.md"
SPEAKER_COMMANDS = ""
if SPEAKER_MD_PATH.exists():
    SPEAKER_COMMANDS = SPEAKER_MD_PATH.read_text()

# Update SYSTEM_PROMPT
SYSTEM_PROMPT = f"""You are a voice assistant engaged in natural spoken conversation. Your responses will be converted to speech, so:

- Keep responses concise (1-3 sentences) unless asked to elaborate
- Use natural, conversational language as if speaking aloud
- Avoid markdown, bullet points, or formatting that doesn't translate to speech
- Don't use asterisks, brackets, or special characters
- When asked to expand or explain more, provide fuller responses
- Be warm and personable while remaining helpful and accurate

## Available Voice Commands

The following document describes voice command patterns you should recognize:

{SPEAKER_COMMANDS}

When the user speaks, first check if they're requesting one of the above app actions.
If so, respond with a JSON action block: {{"action": "command_name", "params": {{...}}}}
Otherwise, respond conversationally.

You have access to tools for web search, reading files, and writing files."""
```

#### Step 3: Load in Intent Service

```python
# backend/services/intent_service.py

from pathlib import Path

SPEAKER_MD_PATH = Path(__file__).parent.parent / "speaker.md"
SPEAKER_CONTEXT = ""
if SPEAKER_MD_PATH.exists():
    SPEAKER_CONTEXT = SPEAKER_MD_PATH.read_text()

# Include in INTENT_SYSTEM_PROMPT
INTENT_SYSTEM_PROMPT = f"""You are an intent classifier for a voice-controlled coding assistant.

## Voice Command Reference
{SPEAKER_CONTEXT}

Classify the user's request into one of the defined action types or "question" if it's regular conversation.
"""
```

### Benefits

- Single source of truth for voice commands
- Users can edit `speaker.md` to customize commands
- LLM uses semantic understanding, not just regex
- New patterns work without code changes

---

## 4. Self-Iteration Default Directory

### Problem

When a category has no linked directory, file operations have no context. The system should default to the assistant's own directory for self-modification.

### Solution

```python
# backend/main.py

from pathlib import Path

# Default to assistant directory
DEFAULT_WORK_DIR = str(Path(__file__).parent.parent.absolute())
```

```python
# backend/services/action_executor.py

class ActionExecutor:
    def __init__(self, search_root: str = "~/dev", default_dir: str = None):
        self.search_root = os.path.expanduser(search_root)
        self.default_dir = default_dir

    def execute(self, intent: DetectedIntent, context_directory: str = None) -> ActionResult:
        # Use context directory, fall back to default (assistant directory)
        self._context_directory = context_directory or self.default_dir
        # ... rest of method
```

```python
# backend/main.py - initialization

action_executor = ActionExecutor(
    search_root=os.getenv("FS_SEARCH_ROOT", "~/dev"),
    default_dir=DEFAULT_WORK_DIR
)
```

### Result

- Categories without linked directories use assistant directory by default
- "List files" in a new category shows assistant project files
- Enables self-modification of the assistant

---

## 5. File Editing via Local LLM

### Problem

Users should be able to say "add a new voice command to the speaker markdown file" and have the Local LLM directly edit the file.

### Solution

Add file manipulation tools to the Local LLM provider.

#### Step 1: Add tools definition

```python
# backend/services/ai/local.py

TOOLS = [
    # Existing web_search tool...
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read the contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or relative file path"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or append content to a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path"
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write"
                    },
                    "append": {
                        "type": "boolean",
                        "description": "Append instead of overwrite",
                        "default": False
                    }
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files in a directory",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Glob pattern (default: *)",
                        "default": "*"
                    }
                },
                "required": ["path"]
            }
        }
    }
]
```

#### Step 2: Add tool execution functions

```python
# backend/services/ai/local.py

def execute_read_file(path: str, work_dir: str = None) -> str:
    """Read file contents."""
    try:
        full_path = Path(path) if Path(path).is_absolute() else Path(work_dir or ".") / path
        if full_path.exists():
            return full_path.read_text()
        return f"File not found: {path}"
    except Exception as e:
        return f"Error reading file: {e}"

def execute_write_file(path: str, content: str, append: bool = False, work_dir: str = None) -> str:
    """Write to file."""
    try:
        full_path = Path(path) if Path(path).is_absolute() else Path(work_dir or ".") / path
        mode = "a" if append else "w"
        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, mode) as f:
            f.write(content)
        return f"Successfully {'appended to' if append else 'wrote'} {path}"
    except Exception as e:
        return f"Error writing file: {e}"

def execute_list_files(path: str, pattern: str = "*", work_dir: str = None) -> str:
    """List directory contents."""
    try:
        full_path = Path(path) if Path(path).is_absolute() else Path(work_dir or ".") / path
        files = list(full_path.glob(pattern))
        if not files:
            return f"No files found matching '{pattern}' in {path}"
        return "\n".join(str(f.name) for f in files[:50])
    except Exception as e:
        return f"Error listing files: {e}"
```

#### Step 3: Update LocalProvider class

```python
# backend/services/ai/local.py

class LocalProvider(AIProvider):
    def __init__(self, work_dir: str = None):
        self.base_url = os.getenv("LOCAL_LLM_URL", DEFAULT_LOCAL_LLM_URL)
        self.model = os.getenv("LOCAL_LLM_MODEL", MODEL_NAME)
        self.history: list[dict] = []
        self.work_dir = work_dir or str(Path(__file__).parent.parent.parent)
        self.client = httpx.Client(timeout=120.0)

    def _execute_tool(self, tool_name: str, arguments: dict) -> str:
        """Execute a tool and return the result."""
        if tool_name == "web_search":
            # ... existing code
        elif tool_name == "read_file":
            return execute_read_file(
                arguments.get("path", ""),
                self.work_dir
            )
        elif tool_name == "write_file":
            return execute_write_file(
                arguments.get("path", ""),
                arguments.get("content", ""),
                arguments.get("append", False),
                self.work_dir
            )
        elif tool_name == "list_files":
            return execute_list_files(
                arguments.get("path", "."),
                arguments.get("pattern", "*"),
                self.work_dir
            )
        return f"Unknown tool: {tool_name}"
```

#### Step 4: Update provider factory

```python
# backend/services/ai/__init__.py

def get_ai_for_container(container_id: str, provider: str = "gemini", work_dir: str = None) -> AIProvider:
    if provider == "local":
        return LocalProvider(work_dir=work_dir)
    # ... rest
```

### Test Cases

| Voice Input | Expected Behavior |
|-------------|-------------------|
| "Add a command for checking weather to speaker.md" | LLM reads speaker.md, appends weather command section |
| "Show me the voice commands file" | LLM reads and summarizes speaker.md |
| "What files are in this directory" | LLM lists files in work_dir |

---

## 6. VoiceButton UI Improvements

### Problem

1. "Tap to Listen" text is shown (should be icon only)
2. User can tap "stop" before speech is buffered, interrupting processing
3. No visual feedback during processing state

### Solution

#### Step 1: Update VoiceButton props and state

```typescript
// frontend/src/components/VoiceButton.tsx

interface VoiceButtonProps {
  onStart: () => void
  onStop: () => void
  isConnected: boolean
  isLoading: boolean
  isActive?: boolean
  isProcessing?: boolean           // NEW: Processing state
  hasBufferedSpeech?: boolean      // NEW: Whether speech is buffered
  disabled?: boolean
  className?: string
  compact?: boolean                // NEW: Icon-only mode
}
```

#### Step 2: Update click handler to block early stop

```typescript
const handleClick = () => {
  if (disabled || isLoading || isProcessing) return

  if (isActive) {
    // Prevent stopping if no speech buffered yet
    if (!hasBufferedSpeech) {
      return  // Block early stop
    }
    // Stop and send
    if (externalIsActive === undefined) {
      setInternalIsActive(false)
      stopTimer()
    }
    onStop()
  } else {
    // Start listening
    if (externalIsActive === undefined) {
      setInternalIsActive(true)
      startTimer()
    }
    onStart()
  }
}
```

#### Step 3: Update button state and labels

```typescript
// Determine button state
let buttonState: "idle" | "recording" | "loading" | "disconnected" | "processing"
let buttonLabel: string | null = null  // null for icon-only

if (!isConnected) {
  buttonState = "disconnected"
  buttonLabel = compact ? null : "Disconnected"
} else if (isLoading) {
  buttonState = "loading"
  buttonLabel = compact ? null : "Connecting..."
} else if (isProcessing) {
  buttonState = "processing"
  buttonLabel = compact ? null : "Processing..."
} else if (isActive) {
  buttonState = "recording"
  buttonLabel = compact ? null : `${formatTime(elapsedTime)}`  // Time only, no "Tap to Send"
} else {
  buttonState = "idle"
  buttonLabel = null  // Icon only - remove "Tap to Listen"
}
```

#### Step 4: Update render with processing spinner

```tsx
<button
  className={`voice-button voice-button--${buttonState} ${compact ? 'voice-button--compact' : ''}`}
  onClick={handleClick}
  disabled={disabled || !isConnected || isLoading || isProcessing}
  aria-label={isActive ? "Stop and send" : "Start listening"}
>
  <div className="voice-button__icon">
    {isProcessing ? (
      // Spinner during processing
      <svg viewBox="0 0 24 24" width="24" height="24" className="voice-button__spinner">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"
                fill="none" strokeDasharray="31.4" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate"
                           from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/>
        </circle>
      </svg>
    ) : isActive ? (
      // Send arrow when recording
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
      </svg>
    ) : (
      // Microphone when idle
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
      </svg>
    )}
  </div>
  {buttonLabel && <span className="voice-button__label">{buttonLabel}</span>}
  {isActive && !isProcessing && <div className="voice-button__pulse" />}
</button>
```

#### Step 5: Expose buffer state from useSharedVoice

```typescript
// frontend/src/hooks/useSharedVoice.ts

export interface UseSharedVoiceReturn {
  // ... existing
  hasBufferedSpeech: boolean
  isProcessing: boolean
}

export function useSharedVoice(): UseSharedVoiceReturn {
  // ... existing code

  const hasBufferedSpeech = speechBufferRef.current.length > 0
  const isProcessing = globalStatus === "processing"

  return {
    // ... existing
    hasBufferedSpeech,
    isProcessing,
  }
}
```

#### Step 6: Add CSS styles

```css
/* frontend/src/index.css */

.voice-button--compact {
  padding: 0.75rem;
  border-radius: 50%;
  min-width: auto;
}

.voice-button--compact .voice-button__label {
  display: none;
}

.voice-button--processing {
  background-color: #f59e0b;  /* Amber */
  color: #ffffff;
  cursor: wait;
}

.voice-button__spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

### Visual States

| State | Icon | Label | Background |
|-------|------|-------|------------|
| Idle | Microphone | (none) | Blue |
| Recording | Send arrow | "00:15" (time) | Red + pulse |
| Processing | Spinner | "Processing..." | Amber |
| Loading | Microphone | "Connecting..." | Gray |
| Disconnected | Microphone | "Disconnected" | Dark gray |

---

## 7. Recent Speech Display

### Problem

No visibility into recent voice interactions on the category detail page. Users can't see what was just said or the LLM response.

### Solution

Add a compact "Recent" section showing the last 1-2 exchanges (user message + assistant response).

#### Step 1: Create RecentMessages component

```tsx
// frontend/src/components/CategoryDetail.tsx

import type { Message } from "../types"

interface RecentMessagesProps {
  messages: Message[]
  maxExchanges?: number
}

function RecentMessages({ messages, maxExchanges = 2 }: RecentMessagesProps) {
  // Get last N exchanges (user + assistant pairs)
  const recentMessages: Message[] = []
  let exchangeCount = 0

  for (let i = messages.length - 1; i >= 0 && exchangeCount < maxExchanges; i--) {
    const msg = messages[i]
    if (msg.text === "...") continue  // Skip pending messages
    recentMessages.unshift(msg)
    if (msg.role === "user") exchangeCount++
  }

  if (recentMessages.length === 0) return null

  return (
    <div className="category-detail__recent-messages">
      <div className="category-detail__recent-header">
        <span>Recent</span>
      </div>
      <div className="category-detail__recent-content">
        {recentMessages.map((msg) => (
          <div
            key={msg.id}
            className={`category-detail__recent-msg category-detail__recent-msg--${msg.role}`}
          >
            <span className="category-detail__recent-role">
              {msg.role === "user" ? "You" : msg.source || "AI"}:
            </span>
            <span className="category-detail__recent-text">
              {msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

#### Step 2: Add to CategoryDetail render

```tsx
// frontend/src/components/CategoryDetail.tsx

export function CategoryDetail({ onTaskAction, className = "" }: CategoryDetailProps) {
  // ... existing code

  return (
    <div className={`category-detail ${className}`}>
      {/* Header */}
      <div className="category-detail__header">
        {/* ... existing */}
      </div>

      {/* Progress bar (todo mode) */}
      {isTodo && todoCategory && (
        <div className="category-detail__progress">
          <ProgressBar completed={completedCount} total={totalCount} />
        </div>
      )}

      {/* NEW: Recent messages section */}
      {todoCategory && todoCategory.messages.length > 0 && (
        <RecentMessages messages={todoCategory.messages} maxExchanges={2} />
      )}

      {/* Synopsis section */}
      {isTodo && todoCategory && (
        <div className="category-detail__synopsis">
          {/* ... existing */}
        </div>
      )}

      {/* Task/Entry lists */}
      {/* ... existing */}
    </div>
  )
}
```

#### Step 3: Add CSS styles

```css
/* frontend/src/index.css */

/* ========================================
   Recent Messages (CategoryDetail)
   ======================================== */

.category-detail__recent-messages {
  margin-bottom: 1rem;
  padding: 0.75rem;
  background-color: #1f2937;
  border-radius: 0.5rem;
  border-left: 3px solid #3b82f6;
}

.category-detail__recent-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.category-detail__recent-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.category-detail__recent-msg {
  display: flex;
  gap: 0.5rem;
  font-size: 0.875rem;
  line-height: 1.4;
}

.category-detail__recent-msg--user {
  color: #9ca3af;
}

.category-detail__recent-msg--assistant {
  color: #f9fafb;
}

.category-detail__recent-role {
  font-weight: 500;
  flex-shrink: 0;
}

.category-detail__recent-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

### Visual Design

```
┌─────────────────────────────────────────┐
│ RECENT                                  │
│ ├─ You: create a new category called... │
│ └─ AI: Created Projects category. How...│
└─────────────────────────────────────────┘
```

- Compact box with left blue border accent
- Small uppercase header "RECENT"
- User messages in muted gray
- AI messages in white
- Text truncated at 100 characters with ellipsis

---

## Implementation Order

| Order | Feature | Dependencies | Estimated Effort |
|-------|---------|--------------|------------------|
| 1 | Category Name Extraction | None | Low |
| 2 | Voice Commands in speaker.md | None | Medium |
| 3 | Context-Specific Commands | None | Medium |
| 4 | Self-Iteration Default | None | Low |
| 5 | File Editing via Local LLM | #2 (speaker.md) | Medium |
| 6 | VoiceButton UI | None | Medium |
| 7 | Recent Speech Display | None | Low |

**Rationale:**
- #1 is an isolated fix with immediate UX benefit
- #2 establishes foundation for LLM-based command interpretation
- #3-4 add context awareness
- #5 builds on #2 for self-modification
- #6-7 are frontend-only, can be done in parallel

---

## File Reference

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/voiceCommands.ts` | Add `create_category_with_name` type and regex, `list_directory` command |
| `frontend/src/hooks/useSharedVoice.ts` | New command handlers, expose `hasBufferedSpeech`/`isProcessing`, pass `directoryPath` |
| `frontend/src/components/VoiceButton.tsx` | Remove text label, add processing state, buffer check |
| `frontend/src/components/CategoryDetail.tsx` | Add `RecentMessages` component |
| `frontend/src/index.css` | Compact button styles, processing state, recent messages styles |
| `backend/services/ai/local.py` | Load speaker.md, add file tools, work_dir parameter |
| `backend/services/intent_service.py` | Load speaker.md for intent context |
| `backend/main.py` | DEFAULT_WORK_DIR, list_directory handler, track directory context |
| `backend/services/action_executor.py` | Use default_dir fallback |
| `speaker.md` | Enhance with complete command reference |

### Files to Read (Context)

| File | Purpose |
|------|---------|
| `frontend/src/types/index.ts` | Message, TodoCategory interfaces |
| `frontend/src/context/AppContext.tsx` | State management patterns |
| `backend/services/fs_service.py` | Filesystem utilities |

---

## Testing Checklist

- [ ] "Create a new category called Projects" → creates "Projects" (not "New")
- [ ] "Make a category named Frontend" → creates "Frontend"
- [ ] "List files here" (in linked category) → shows directory contents
- [ ] "List the directory" (no link) → "No directory linked" message
- [ ] Voice button shows microphone icon only (no text) when idle
- [ ] Cannot tap stop immediately after starting (before speech)
- [ ] Processing spinner appears while transcribing
- [ ] Recent exchanges visible on category detail page
- [ ] "Add a command to speaker.md" → LLM modifies file
- [ ] "Show me the voice commands" → LLM reads and summarizes speaker.md
