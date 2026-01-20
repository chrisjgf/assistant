import React, { createContext, useReducer, useCallback, useMemo, useEffect, useRef, useContext } from "react"
import type {
  Mode,
  AIProvider,
  Status,
  CategoryStatus,
  ViewType,
  Message,
  Task,
  BrainEntry,
  TodoCategory,
  BrainCategory,
  AppState,
  AppAction,
  SessionResponse,
} from "../types"

// === Initial State ===

function createInitialState(): AppState {
  return {
    activeMode: "todo",
    todoCategories: [],
    brainCategories: [],
    selectedCategoryId: null,
    currentView: "list",
    globalStatus: "idle",
    speakingMessageId: null,
    claudeTask: null,
    error: null,
    pendingTTS: null,
    sessionId: null,
    isSessionLoading: true,
  }
}

// === Reducer ===

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // Mode
    case "SET_MODE":
      return { ...state, activeMode: action.payload, selectedCategoryId: null }

    // Category actions
    case "ADD_TODO_CATEGORY":
      return { ...state, todoCategories: [...state.todoCategories, action.payload] }

    case "ADD_BRAIN_CATEGORY":
      return { ...state, brainCategories: [...state.brainCategories, action.payload] }

    case "UPDATE_TODO_CATEGORY":
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.id ? { ...cat, ...action.payload.updates } : cat
        ),
      }

    case "UPDATE_BRAIN_CATEGORY":
      return {
        ...state,
        brainCategories: state.brainCategories.map((cat) =>
          cat.id === action.payload.id ? { ...cat, ...action.payload.updates } : cat
        ),
      }

    case "DELETE_CATEGORY":
      if (action.payload.mode === "todo") {
        return {
          ...state,
          todoCategories: state.todoCategories.filter((cat) => cat.id !== action.payload.id),
          selectedCategoryId: state.selectedCategoryId === action.payload.id ? null : state.selectedCategoryId,
        }
      } else {
        return {
          ...state,
          brainCategories: state.brainCategories.filter((cat) => cat.id !== action.payload.id),
          selectedCategoryId: state.selectedCategoryId === action.payload.id ? null : state.selectedCategoryId,
        }
      }

    case "REORDER_TODO_CATEGORIES":
      return { ...state, todoCategories: action.payload }

    case "REORDER_BRAIN_CATEGORIES":
      return { ...state, brainCategories: action.payload }

    case "SELECT_CATEGORY":
      return { ...state, selectedCategoryId: action.payload }

    // Task actions
    case "ADD_TASK": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, tasks: [...cat.tasks, action.payload.task] }
            : cat
        ),
      }
    }

    case "UPDATE_TASK": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) => ({
          ...cat,
          tasks: cat.tasks.map((task) =>
            task.id === action.payload.taskId ? { ...task, ...action.payload.updates } : task
          ),
        })),
      }
    }

    case "DELETE_TASK": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) => ({
          ...cat,
          tasks: cat.tasks.filter((task) => task.id !== action.payload.taskId),
        })),
      }
    }

    // Entry actions
    case "ADD_ENTRY": {
      return {
        ...state,
        brainCategories: state.brainCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, entries: [...cat.entries, action.payload.entry] }
            : cat
        ),
      }
    }

    case "DELETE_ENTRY": {
      return {
        ...state,
        brainCategories: state.brainCategories.map((cat) => ({
          ...cat,
          entries: cat.entries.filter((entry) => entry.id !== action.payload.entryId),
        })),
      }
    }

    // Message actions
    case "ADD_MESSAGE": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, messages: [...cat.messages, action.payload.message] }
            : cat
        ),
      }
    }

    case "UPDATE_MESSAGE": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? {
                ...cat,
                messages: cat.messages.map((msg) =>
                  msg.id === action.payload.messageId ? { ...msg, text: action.payload.text } : msg
                ),
              }
            : cat
        ),
      }
    }

    case "REMOVE_MESSAGE": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, messages: cat.messages.filter((msg) => msg.id !== action.payload.messageId) }
            : cat
        ),
      }
    }

    case "CLEAR_MESSAGES": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId ? { ...cat, messages: [] } : cat
        ),
      }
    }

    // AI/Status actions
    case "SET_AI": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId ? { ...cat, activeAI: action.payload.ai } : cat
        ),
      }
    }

    case "SET_STATUS":
      return { ...state, globalStatus: action.payload }

    case "SET_SPEAKING":
      return { ...state, speakingMessageId: action.payload }

    case "SET_CLAUDE_TASK":
      return { ...state, claudeTask: action.payload }

    case "SET_ERROR":
      return { ...state, error: action.payload }

    case "SET_PENDING_TTS":
      return { ...state, pendingTTS: action.payload }

    case "SET_CATEGORY_STATUS": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, status: action.payload.status }
            : cat
        ),
      }
    }

    case "SET_CATEGORY_SPEAKING": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, speakingId: action.payload.messageId }
            : cat
        ),
      }
    }

    case "SET_PROJECT_CONTEXT": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, projectContext: action.payload.context }
            : cat
        ),
      }
    }

    case "SET_DIRECTORY_PATH": {
      return {
        ...state,
        todoCategories: state.todoCategories.map((cat) =>
          cat.id === action.payload.categoryId
            ? { ...cat, directoryPath: action.payload.path }
            : cat
        ),
      }
    }

    case "SET_CURRENT_VIEW":
      return { ...state, currentView: action.payload }

    // Session actions
    case "SET_SESSION_ID":
      return { ...state, sessionId: action.payload }

    case "SET_SESSION_LOADING":
      return { ...state, isSessionLoading: action.payload }

    case "RESTORE_SESSION":
      return {
        ...state,
        activeMode: action.payload.activeMode,
        todoCategories: action.payload.todoCategories,
        brainCategories: action.payload.brainCategories,
        isSessionLoading: false,
      }

    default:
      return state
  }
}

// === Context Value Interface ===

export interface AppContextValue {
  // State
  state: AppState
  dispatch: React.Dispatch<AppAction>

  // Derived values
  activeMode: Mode
  todoCategories: TodoCategory[]
  brainCategories: BrainCategory[]
  selectedCategory: TodoCategory | BrainCategory | null
  globalStatus: Status
  currentView: ViewType

  // Mode actions
  setMode: (mode: Mode) => void

  // Navigation actions
  navigateToView: (view: ViewType) => void

  // Category actions
  createCategory: (name: string) => Promise<TodoCategory | BrainCategory | undefined>
  updateCategory: (id: string, updates: Partial<TodoCategory | BrainCategory>) => void
  deleteCategory: (id: string) => Promise<void>
  reorderCategories: (categoryIds: string[]) => Promise<void>
  selectCategory: (id: string | null) => void
  setDirectoryPath: (categoryId: string, path: string | null) => void
  setCategoryStatus: (categoryId: string, status: CategoryStatus) => void
  setCategorySpeaking: (categoryId: string, messageId: string | null) => void
  setProjectContext: (categoryId: string, context: string | null) => void

  // Task actions (Todo mode)
  createTask: (categoryId: string, text: string) => Promise<void>
  updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>

  // Entry actions (Brain mode)
  createEntry: (categoryId: string, text: string) => Promise<void>
  deleteEntry: (entryId: string) => Promise<void>

  // Message actions
  addMessage: (categoryId: string, message: Message) => void
  updateMessage: (categoryId: string, messageId: string, text: string) => void
  removeMessage: (categoryId: string, messageId: string) => void
  clearMessages: (categoryId: string) => void

  // AI actions
  setAI: (categoryId: string, ai: AIProvider) => void

  // Session
  sessionId: string | null
  isSessionLoading: boolean
  clearSession: () => void
}

// === Context ===

export const AppContext = createContext<AppContextValue | null>(null)

// === API Helpers ===

const API_BASE = `${window.location.protocol}//${window.location.hostname}:8001`

async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}

// === Provider ===

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, null, createInitialState)
  const sessionLoadedRef = useRef(false)
  const lastSaveRef = useRef<string>("")

  // Load or create session on mount
  useEffect(() => {
    if (sessionLoadedRef.current) return
    sessionLoadedRef.current = true

    const loadSession = async () => {
      // Check localStorage for existing session ID
      const storedSessionId = localStorage.getItem("sessionId")

      if (storedSessionId) {
        try {
          const session = await apiCall<SessionResponse>(`/session/${storedSessionId}`)
          // Ensure categories have default values for new fields
          const todoCategories = (session.todoCategories || []).map((cat) => ({
            ...cat,
            directoryPath: cat.directoryPath ?? null,
            status: cat.status ?? "idle" as const,
            projectContext: cat.projectContext ?? null,
            speakingId: cat.speakingId ?? null,
          }))
          const brainCategories = (session.brainCategories || []).map((cat) => ({
            ...cat,
            directoryPath: cat.directoryPath ?? null,
          }))
          dispatch({
            type: "RESTORE_SESSION",
            payload: {
              activeMode: session.activeMode || "todo",
              todoCategories,
              brainCategories,
            },
          })
          dispatch({ type: "SET_SESSION_ID", payload: session.id })
          return
        } catch {
          // Session not found, create new one
          localStorage.removeItem("sessionId")
        }
      }

      // Create new session
      try {
        const session = await apiCall<SessionResponse>("/session", { method: "POST" })
        localStorage.setItem("sessionId", session.id)
        dispatch({ type: "SET_SESSION_ID", payload: session.id })
        dispatch({ type: "SET_SESSION_LOADING", payload: false })
      } catch (err) {
        console.error("Failed to create session:", err)
        dispatch({ type: "SET_SESSION_LOADING", payload: false })
      }
    }

    loadSession()
  }, [])

  // Auto-save on state changes (debounced)
  useEffect(() => {
    if (!sessionLoadedRef.current || !state.sessionId) return

    const stateHash = JSON.stringify({
      mode: state.activeMode,
      todoCategories: state.todoCategories,
      brainCategories: state.brainCategories,
    })

    if (stateHash === lastSaveRef.current) return
    lastSaveRef.current = stateHash

    const saveTimeout = setTimeout(async () => {
      try {
        await apiCall(`/session/${state.sessionId}`, {
          method: "PUT",
          body: JSON.stringify({
            containers: {}, // Legacy
            activeMode: state.activeMode,
            todoCategories: state.todoCategories,
            brainCategories: state.brainCategories,
          }),
        })
      } catch (err) {
        console.error("Failed to save session:", err)
      }
    }, 500)

    return () => clearTimeout(saveTimeout)
  }, [state.sessionId, state.activeMode, state.todoCategories, state.brainCategories])

  // === Actions ===

  const setMode = useCallback((mode: Mode) => {
    dispatch({ type: "SET_MODE", payload: mode })
  }, [])

  const createCategory = useCallback(async (name: string): Promise<TodoCategory | BrainCategory | undefined> => {
    if (!state.sessionId) return undefined

    try {
      const category = await apiCall<TodoCategory | BrainCategory>(
        `/session/${state.sessionId}/categories/${state.activeMode}`,
        { method: "POST", body: JSON.stringify({ name }) }
      )

      if (state.activeMode === "todo") {
        // Ensure new fields have defaults
        const todoCategory: TodoCategory = {
          ...(category as TodoCategory),
          directoryPath: (category as TodoCategory).directoryPath ?? null,
          status: (category as TodoCategory).status ?? "idle",
          projectContext: (category as TodoCategory).projectContext ?? null,
          speakingId: (category as TodoCategory).speakingId ?? null,
        }
        dispatch({ type: "ADD_TODO_CATEGORY", payload: todoCategory })
        return todoCategory
      } else {
        // Ensure new fields have defaults
        const brainCategory: BrainCategory = {
          ...(category as BrainCategory),
          directoryPath: (category as BrainCategory).directoryPath ?? null,
        }
        dispatch({ type: "ADD_BRAIN_CATEGORY", payload: brainCategory })
        return brainCategory
      }
    } catch (err) {
      console.error("Failed to create category:", err)
      return undefined
    }
  }, [state.sessionId, state.activeMode])

  const updateCategory = useCallback((id: string, updates: Partial<TodoCategory | BrainCategory>) => {
    if (state.activeMode === "todo") {
      dispatch({ type: "UPDATE_TODO_CATEGORY", payload: { id, updates } })
    } else {
      dispatch({ type: "UPDATE_BRAIN_CATEGORY", payload: { id, updates } })
    }

    // Sync to backend (fire and forget)
    if (state.sessionId) {
      apiCall(`/session/${state.sessionId}/categories/${state.activeMode}/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      }).catch(console.error)
    }
  }, [state.sessionId, state.activeMode])

  const deleteCategory = useCallback(async (id: string) => {
    if (!state.sessionId) return

    dispatch({ type: "DELETE_CATEGORY", payload: { mode: state.activeMode, id } })

    try {
      await apiCall(`/session/${state.sessionId}/categories/${state.activeMode}/${id}`, {
        method: "DELETE",
      })
    } catch (err) {
      console.error("Failed to delete category:", err)
    }
  }, [state.sessionId, state.activeMode])

  const reorderCategories = useCallback(async (categoryIds: string[]) => {
    if (!state.sessionId) return

    // Optimistically update local state
    if (state.activeMode === "todo") {
      const reordered = categoryIds
        .map((id, i) => {
          const cat = state.todoCategories.find((c) => c.id === id)
          return cat ? { ...cat, order: i } : null
        })
        .filter(Boolean) as TodoCategory[]
      dispatch({ type: "REORDER_TODO_CATEGORIES", payload: reordered })
    } else {
      const reordered = categoryIds
        .map((id, i) => {
          const cat = state.brainCategories.find((c) => c.id === id)
          return cat ? { ...cat, order: i } : null
        })
        .filter(Boolean) as BrainCategory[]
      dispatch({ type: "REORDER_BRAIN_CATEGORIES", payload: reordered })
    }

    try {
      await apiCall(`/session/${state.sessionId}/categories/${state.activeMode}/reorder`, {
        method: "PUT",
        body: JSON.stringify({ categoryIds }),
      })
    } catch (err) {
      console.error("Failed to reorder categories:", err)
    }
  }, [state.sessionId, state.activeMode, state.todoCategories, state.brainCategories])

  const selectCategory = useCallback((id: string | null) => {
    dispatch({ type: "SELECT_CATEGORY", payload: id })
  }, [])

  const createTask = useCallback(async (categoryId: string, text: string) => {
    if (!state.sessionId) return

    try {
      const task = await apiCall<Task>(
        `/session/${state.sessionId}/categories/todo/${categoryId}/tasks`,
        { method: "POST", body: JSON.stringify({ text }) }
      )
      dispatch({ type: "ADD_TASK", payload: { categoryId, task } })
    } catch (err) {
      console.error("Failed to create task:", err)
    }
  }, [state.sessionId])

  const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
    if (!state.sessionId) return

    dispatch({ type: "UPDATE_TASK", payload: { taskId, updates } })

    try {
      await apiCall(`/session/${state.sessionId}/tasks/${taskId}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      })
    } catch (err) {
      console.error("Failed to update task:", err)
    }
  }, [state.sessionId])

  const deleteTask = useCallback(async (taskId: string) => {
    if (!state.sessionId) return

    dispatch({ type: "DELETE_TASK", payload: { taskId } })

    try {
      await apiCall(`/session/${state.sessionId}/tasks/${taskId}`, { method: "DELETE" })
    } catch (err) {
      console.error("Failed to delete task:", err)
    }
  }, [state.sessionId])

  const createEntry = useCallback(async (categoryId: string, text: string) => {
    if (!state.sessionId) return

    try {
      const entry = await apiCall<BrainEntry>(
        `/session/${state.sessionId}/categories/brain/${categoryId}/entries`,
        { method: "POST", body: JSON.stringify({ text }) }
      )
      dispatch({ type: "ADD_ENTRY", payload: { categoryId, entry } })
    } catch (err) {
      console.error("Failed to create entry:", err)
    }
  }, [state.sessionId])

  const deleteEntry = useCallback(async (entryId: string) => {
    if (!state.sessionId) return

    dispatch({ type: "DELETE_ENTRY", payload: { entryId } })

    try {
      await apiCall(`/session/${state.sessionId}/entries/${entryId}`, { method: "DELETE" })
    } catch (err) {
      console.error("Failed to delete entry:", err)
    }
  }, [state.sessionId])

  const addMessage = useCallback((categoryId: string, message: Message) => {
    dispatch({ type: "ADD_MESSAGE", payload: { categoryId, message } })
  }, [])

  const updateMessage = useCallback((categoryId: string, messageId: string, text: string) => {
    dispatch({ type: "UPDATE_MESSAGE", payload: { categoryId, messageId, text } })
  }, [])

  const removeMessage = useCallback((categoryId: string, messageId: string) => {
    dispatch({ type: "REMOVE_MESSAGE", payload: { categoryId, messageId } })
  }, [])

  const clearMessages = useCallback((categoryId: string) => {
    dispatch({ type: "CLEAR_MESSAGES", payload: { categoryId } })
  }, [])

  const setAI = useCallback((categoryId: string, ai: AIProvider) => {
    dispatch({ type: "SET_AI", payload: { categoryId, ai } })
  }, [])

  const navigateToView = useCallback((view: ViewType) => {
    dispatch({ type: "SET_CURRENT_VIEW", payload: view })
  }, [])

  const setDirectoryPath = useCallback((categoryId: string, path: string | null) => {
    dispatch({ type: "SET_DIRECTORY_PATH", payload: { categoryId, path } })

    // Sync to backend
    if (state.sessionId) {
      apiCall(`/session/${state.sessionId}/categories/todo/${categoryId}`, {
        method: "PUT",
        body: JSON.stringify({ directoryPath: path }),
      }).catch(console.error)
    }
  }, [state.sessionId])

  const setCategoryStatus = useCallback((categoryId: string, status: CategoryStatus) => {
    dispatch({ type: "SET_CATEGORY_STATUS", payload: { categoryId, status } })
  }, [])

  const setCategorySpeaking = useCallback((categoryId: string, messageId: string | null) => {
    dispatch({ type: "SET_CATEGORY_SPEAKING", payload: { categoryId, messageId } })
  }, [])

  const setProjectContext = useCallback((categoryId: string, context: string | null) => {
    dispatch({ type: "SET_PROJECT_CONTEXT", payload: { categoryId, context } })
  }, [])

  const clearSession = useCallback(async () => {
    if (state.sessionId) {
      try {
        await apiCall(`/session/${state.sessionId}`, { method: "DELETE" })
      } catch {
        // Ignore
      }
    }
    localStorage.removeItem("sessionId")
    dispatch({ type: "SET_SESSION_ID", payload: null })

    // Create new session
    try {
      const session = await apiCall<SessionResponse>("/session", { method: "POST" })
      localStorage.setItem("sessionId", session.id)
      dispatch({ type: "SET_SESSION_ID", payload: session.id })
      dispatch({ type: "RESTORE_SESSION", payload: {
        activeMode: "todo",
        todoCategories: [],
        brainCategories: [],
      } })
    } catch (err) {
      console.error("Failed to create new session:", err)
    }
  }, [state.sessionId])

  // === Derived Values ===

  const selectedCategory = useMemo(() => {
    if (!state.selectedCategoryId) return null

    if (state.activeMode === "todo") {
      return state.todoCategories.find((c) => c.id === state.selectedCategoryId) || null
    } else {
      return state.brainCategories.find((c) => c.id === state.selectedCategoryId) || null
    }
  }, [state.activeMode, state.selectedCategoryId, state.todoCategories, state.brainCategories])

  // === Context Value ===

  const value = useMemo(
    (): AppContextValue => ({
      state,
      dispatch,
      activeMode: state.activeMode,
      todoCategories: state.todoCategories,
      brainCategories: state.brainCategories,
      selectedCategory,
      globalStatus: state.globalStatus,
      currentView: state.currentView,
      setMode,
      navigateToView,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      selectCategory,
      setDirectoryPath,
      setCategoryStatus,
      setCategorySpeaking,
      setProjectContext,
      createTask,
      updateTask,
      deleteTask,
      createEntry,
      deleteEntry,
      addMessage,
      updateMessage,
      removeMessage,
      clearMessages,
      setAI,
      sessionId: state.sessionId,
      isSessionLoading: state.isSessionLoading,
      clearSession,
    }),
    [
      state,
      selectedCategory,
      setMode,
      navigateToView,
      createCategory,
      updateCategory,
      deleteCategory,
      reorderCategories,
      selectCategory,
      setDirectoryPath,
      setCategoryStatus,
      setCategorySpeaking,
      setProjectContext,
      createTask,
      updateTask,
      deleteTask,
      createEntry,
      deleteEntry,
      addMessage,
      updateMessage,
      removeMessage,
      clearMessages,
      setAI,
      clearSession,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

// === Hook ===

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error("useApp must be used within an AppProvider")
  }
  return context
}
