/**
 * Type definitions for the Todo/Brain voice assistant app.
 */

// === Mode Types ===

export type Mode = "todo" | "brain"

export type AIProvider = "gemini" | "claude" | "local"

export type Status = "idle" | "listening" | "processing" | "speaking"

// === Message Types ===

export interface Message {
  id: string
  role: "user" | "assistant"
  text: string
  source?: AIProvider
}

// === Task Types (Todo mode) ===

export interface Task {
  id: string
  text: string
  completed: boolean
  createdAt: string
}

// === Entry Types (Brain mode) ===

export interface BrainEntry {
  id: string
  text: string
  createdAt: string
}

// === Category Types ===

export type CategoryStatus = "idle" | "processing" | "speaking" | "ready"

export type ViewType = "list" | "chat" | "management"

export interface TodoCategory {
  id: string
  name: string
  order: number
  tasks: Task[]
  messages: Message[]
  activeAI: AIProvider
  directoryPath: string | null  // Associated filesystem path
  status: CategoryStatus
  projectContext: string | null
  speakingId: string | null  // Currently speaking message ID
}

export interface BrainCategory {
  id: string
  name: string
  order: number
  entries: BrainEntry[]
  directoryPath: string | null  // Associated filesystem path
}

// === Claude Task Types (for AI planning flow) ===

export interface ClaudeTask {
  id: string
  plan: string
}

// === App State ===

export interface AppState {
  // Mode
  activeMode: Mode

  // Categories
  todoCategories: TodoCategory[]
  brainCategories: BrainCategory[]

  // Selection
  selectedCategoryId: string | null

  // Navigation
  currentView: ViewType

  // Voice/UI state
  globalStatus: Status
  speakingMessageId: string | null
  claudeTask: ClaudeTask | null
  error: string | null
  pendingTTS: { text: string; messageId: string } | null

  // Session
  sessionId: string | null
  isSessionLoading: boolean
}

// === Action Types ===

export type AppAction =
  // Mode
  | { type: "SET_MODE"; payload: Mode }

  // Category actions
  | { type: "ADD_TODO_CATEGORY"; payload: TodoCategory }
  | { type: "ADD_BRAIN_CATEGORY"; payload: BrainCategory }
  | { type: "UPDATE_TODO_CATEGORY"; payload: { id: string; updates: Partial<TodoCategory> } }
  | { type: "UPDATE_BRAIN_CATEGORY"; payload: { id: string; updates: Partial<BrainCategory> } }
  | { type: "DELETE_CATEGORY"; payload: { mode: Mode; id: string } }
  | { type: "REORDER_TODO_CATEGORIES"; payload: TodoCategory[] }
  | { type: "REORDER_BRAIN_CATEGORIES"; payload: BrainCategory[] }
  | { type: "SELECT_CATEGORY"; payload: string | null }

  // Task actions (Todo mode)
  | { type: "ADD_TASK"; payload: { categoryId: string; task: Task } }
  | { type: "UPDATE_TASK"; payload: { taskId: string; updates: Partial<Task> } }
  | { type: "DELETE_TASK"; payload: { taskId: string } }

  // Entry actions (Brain mode)
  | { type: "ADD_ENTRY"; payload: { categoryId: string; entry: BrainEntry } }
  | { type: "DELETE_ENTRY"; payload: { entryId: string } }

  // Message actions (for selected category)
  | { type: "ADD_MESSAGE"; payload: { categoryId: string; message: Message } }
  | { type: "UPDATE_MESSAGE"; payload: { categoryId: string; messageId: string; text: string } }
  | { type: "REMOVE_MESSAGE"; payload: { categoryId: string; messageId: string } }
  | { type: "CLEAR_MESSAGES"; payload: { categoryId: string } }

  // AI/Status actions
  | { type: "SET_AI"; payload: { categoryId: string; ai: AIProvider } }
  | { type: "SET_STATUS"; payload: Status }
  | { type: "SET_CATEGORY_STATUS"; payload: { categoryId: string; status: CategoryStatus } }
  | { type: "SET_SPEAKING"; payload: string | null }
  | { type: "SET_CATEGORY_SPEAKING"; payload: { categoryId: string; messageId: string | null } }
  | { type: "SET_CLAUDE_TASK"; payload: ClaudeTask | null }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SET_PENDING_TTS"; payload: { text: string; messageId: string } | null }
  | { type: "SET_PROJECT_CONTEXT"; payload: { categoryId: string; context: string | null } }
  | { type: "SET_DIRECTORY_PATH"; payload: { categoryId: string; path: string | null } }

  // Navigation
  | { type: "SET_CURRENT_VIEW"; payload: ViewType }

  // Session actions
  | { type: "SET_SESSION_ID"; payload: string | null }
  | { type: "SET_SESSION_LOADING"; payload: boolean }
  | { type: "RESTORE_SESSION"; payload: {
      activeMode: Mode
      todoCategories: TodoCategory[]
      brainCategories: BrainCategory[]
    } }

// === API Response Types ===

export interface SessionResponse {
  id: string
  createdAt: string
  updatedAt: string
  activeMode: Mode
  todoCategories: TodoCategory[]
  brainCategories: BrainCategory[]
  containers?: Record<string, unknown> // Legacy
}

export interface CategoryResponse {
  id: string
  name: string
  order: number
  tasks?: Task[]
  messages?: Message[]
  activeAI?: AIProvider
  entries?: BrainEntry[]
}

export interface TaskResponse {
  id: string
  text: string
  completed: boolean
  createdAt: string
}

export interface EntryResponse {
  id: string
  text: string
  createdAt: string
}
