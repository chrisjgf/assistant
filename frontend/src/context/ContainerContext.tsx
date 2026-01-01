import React, { createContext, useReducer, useCallback, useMemo } from "react"

// Types inlined to avoid import issues
export type Status = "idle" | "listening" | "processing" | "speaking"
export type ContainerStatus = "idle" | "processing" | "ready" | "speaking"

export interface Message {
  id: string
  role: "user" | "assistant"
  text: string
  source?: "gemini" | "claude"
}

export interface ClaudeTask {
  id: string
  plan: string
}

export interface Container {
  id: string
  name: string
  messages: Message[]
  status: ContainerStatus
  activeAI: "gemini" | "claude"
  speakingId: string | null
  claudeTask: ClaudeTask | null
  error: string | null
  pendingTTS: { text: string; messageId: string } | null
}

export const MAX_CONTAINERS = 5
export const CONTAINER_NAMES = ["main", "a", "b", "c", "d"] as const
export type ContainerId = (typeof CONTAINER_NAMES)[number]

export function getContainerDisplayName(id: string): string {
  if (id === "main") return "Main"
  return `Container ${id.toUpperCase()}`
}

export function createContainer(
  id: ContainerId,
  options?: {
    inheritAI?: "gemini" | "claude"
    initialMessages?: Message[]
  }
): Container {
  return {
    id,
    name: getContainerDisplayName(id),
    messages: options?.initialMessages || [],
    status: "idle",
    activeAI: options?.inheritAI || "gemini",
    speakingId: null,
    claudeTask: null,
    error: null,
    pendingTTS: null,
  }
}

export type ContainerAction =
  | { type: "CREATE_CONTAINER"; payload: { id: ContainerId; inheritAI?: "gemini" | "claude"; initialMessages?: Message[] } }
  | { type: "DELETE_CONTAINER"; payload: { id: string } }
  | { type: "SET_ACTIVE"; payload: { id: string } }
  | { type: "ADD_MESSAGE"; payload: { containerId: string; message: Message } }
  | { type: "UPDATE_MESSAGE"; payload: { containerId: string; messageId: string; text: string } }
  | { type: "REMOVE_MESSAGE"; payload: { containerId: string; messageId: string } }
  | { type: "SET_STATUS"; payload: { containerId: string; status: ContainerStatus } }
  | { type: "SET_SPEAKING"; payload: { containerId: string; messageId: string | null } }
  | { type: "SET_ERROR"; payload: { containerId: string; error: string | null } }
  | { type: "SET_AI"; payload: { containerId: string; ai: "gemini" | "claude" } }
  | { type: "SET_CLAUDE_TASK"; payload: { containerId: string; task: ClaudeTask | null } }
  | { type: "SET_PENDING_TTS"; payload: { containerId: string; tts: { text: string; messageId: string } | null } }

export interface ContainerState {
  containers: Map<string, Container>
  activeContainerId: string
}

function containerReducer(state: ContainerState, action: ContainerAction): ContainerState {
  switch (action.type) {
    case "CREATE_CONTAINER": {
      if (state.containers.size >= MAX_CONTAINERS) {
        console.warn("Maximum containers reached")
        return state
      }
      if (state.containers.has(action.payload.id)) {
        console.warn(`Container ${action.payload.id} already exists`)
        return state
      }
      const newContainer = createContainer(action.payload.id, {
        inheritAI: action.payload.inheritAI,
        initialMessages: action.payload.initialMessages,
      })
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.id, newContainer)
      return { ...state, containers: newContainers }
    }

    case "DELETE_CONTAINER": {
      if (action.payload.id === "main") {
        console.warn("Cannot delete main container")
        return state
      }
      if (!state.containers.has(action.payload.id)) {
        return state
      }
      const newContainers = new Map(state.containers)
      newContainers.delete(action.payload.id)
      const newActiveId = state.activeContainerId === action.payload.id ? "main" : state.activeContainerId
      return { ...state, containers: newContainers, activeContainerId: newActiveId }
    }

    case "SET_ACTIVE": {
      if (!state.containers.has(action.payload.id)) {
        console.warn(`Container ${action.payload.id} does not exist`)
        return state
      }
      return { ...state, activeContainerId: action.payload.id }
    }

    case "ADD_MESSAGE": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        messages: [...container.messages, action.payload.message],
      })
      return { ...state, containers: newContainers }
    }

    case "UPDATE_MESSAGE": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        messages: container.messages.map((msg) =>
          msg.id === action.payload.messageId ? { ...msg, text: action.payload.text } : msg
        ),
      })
      return { ...state, containers: newContainers }
    }

    case "REMOVE_MESSAGE": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        messages: container.messages.filter((msg) => msg.id !== action.payload.messageId),
      })
      return { ...state, containers: newContainers }
    }

    case "SET_STATUS": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        status: action.payload.status,
      })
      return { ...state, containers: newContainers }
    }

    case "SET_SPEAKING": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        speakingId: action.payload.messageId,
      })
      return { ...state, containers: newContainers }
    }

    case "SET_ERROR": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        error: action.payload.error,
      })
      return { ...state, containers: newContainers }
    }

    case "SET_AI": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        activeAI: action.payload.ai,
      })
      return { ...state, containers: newContainers }
    }

    case "SET_CLAUDE_TASK": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        claudeTask: action.payload.task,
      })
      return { ...state, containers: newContainers }
    }

    case "SET_PENDING_TTS": {
      const container = state.containers.get(action.payload.containerId)
      if (!container) return state
      const newContainers = new Map(state.containers)
      newContainers.set(action.payload.containerId, {
        ...container,
        pendingTTS: action.payload.tts,
      })
      return { ...state, containers: newContainers }
    }

    default:
      return state
  }
}

function createInitialState(): ContainerState {
  const containers = new Map<string, Container>()
  containers.set("main", createContainer("main"))
  return {
    containers,
    activeContainerId: "main",
  }
}

export interface ContainerContextValue {
  containers: Map<string, Container>
  activeContainerId: string
  activeContainer: Container
  dispatch: React.Dispatch<ContainerAction>
  createContainer: (options?: { inheritAI?: "gemini" | "claude"; initialMessages?: Message[] }) => ContainerId | null
  deleteContainer: (id: string) => void
  switchToContainer: (id: string) => void
  sendToContainer: (containerId: string, context: Message[], prompt: string) => void
  getNextAvailableContainerId: () => ContainerId | null
}

export const ContainerContext = createContext<ContainerContextValue | null>(null)

export function ContainerProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(containerReducer, null, createInitialState)

  const getNextAvailableContainerId = useCallback((): ContainerId | null => {
    for (const name of CONTAINER_NAMES) {
      if (name !== "main" && !state.containers.has(name)) {
        return name
      }
    }
    return null
  }, [state.containers])

  const createContainerFn = useCallback(
    (options?: { inheritAI?: "gemini" | "claude"; initialMessages?: Message[] }): ContainerId | null => {
      const id = getNextAvailableContainerId()
      if (!id) {
        console.warn("No available container slots")
        return null
      }
      dispatch({
        type: "CREATE_CONTAINER",
        payload: { id, inheritAI: options?.inheritAI, initialMessages: options?.initialMessages },
      })
      return id
    },
    [getNextAvailableContainerId]
  )

  const deleteContainer = useCallback((id: string) => {
    dispatch({ type: "DELETE_CONTAINER", payload: { id } })
  }, [])

  const switchToContainer = useCallback((id: string) => {
    dispatch({ type: "SET_ACTIVE", payload: { id } })
  }, [])

  const sendToContainer = useCallback(
    (containerId: string, context: Message[], prompt: string) => {
      if (!state.containers.has(containerId)) {
        const validId = CONTAINER_NAMES.find((name) => name === containerId)
        if (!validId || validId === "main") {
          console.warn(`Invalid container ID: ${containerId}`)
          return
        }
        dispatch({
          type: "CREATE_CONTAINER",
          payload: {
            id: validId,
            inheritAI: state.containers.get(state.activeContainerId)?.activeAI,
            initialMessages: context,
          },
        })
      } else {
        for (const msg of context) {
          dispatch({
            type: "ADD_MESSAGE",
            payload: { containerId, message: { ...msg, id: crypto.randomUUID() } },
          })
        }
      }

      if (prompt) {
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            containerId,
            message: { id: crypto.randomUUID(), role: "user", text: prompt },
          },
        })
      }
    },
    [state.containers, state.activeContainerId]
  )

  const activeContainer = state.containers.get(state.activeContainerId) || state.containers.get("main")!

  const value = useMemo(
    (): ContainerContextValue => ({
      containers: state.containers,
      activeContainerId: state.activeContainerId,
      activeContainer,
      dispatch,
      createContainer: createContainerFn,
      deleteContainer,
      switchToContainer,
      sendToContainer,
      getNextAvailableContainerId,
    }),
    [state, activeContainer, createContainerFn, deleteContainer, switchToContainer, sendToContainer, getNextAvailableContainerId]
  )

  return <ContainerContext.Provider value={value}>{children}</ContainerContext.Provider>
}
