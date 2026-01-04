import { useState, useEffect, useRef, useCallback } from "react"
import { useContainers } from "./useContainers"
import { parseVoiceCommand, parseClaudeDirectAddress, isClaudeExitCommand } from "../utils/voiceCommands"
import type { VoiceCommand } from "../utils/voiceCommands"
import type { Status, Message, ContainerId } from "../context/ContainerContext"
import { CONTAINER_NAMES } from "../context/ContainerContext"

declare global {
  interface Window {
    vad: {
      MicVAD: {
        new: (options: {
          onSpeechStart?: () => void
          onSpeechEnd?: (audio: Float32Array) => void
          onVADMisfire?: () => void
        }) => Promise<{
          start: () => Promise<void>
          pause: () => void
          destroy: () => void
        }>
      }
    }
  }
}

const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:"
const httpProtocol = window.location.protocol === "https:" ? "https:" : "http:"
const WS_URL = `${wsProtocol}//${window.location.hostname}:8001/ws`
export const API_URL = `${httpProtocol}//${window.location.hostname}:8001`

// Valid short words that should not be filtered as noise
const VALID_SHORT_WORDS = new Set([
  "a", "i", "k", "ok", "go", "no", "yes", "hi", "hey", "bye", "do", "so", "to", "on", "in", "up", "it", "is", "be", "we", "me", "my", "an", "or", "if", "at", "as", "by", "of"
])

/**
 * Check if transcription is likely background noise or illegible speech.
 * Conservative approach: only filter obvious garbage, allow valid short words.
 */
function isLikelyNoise(text: string): boolean {
  const trimmed = text.trim().toLowerCase()

  // Empty or whitespace only
  if (!trimmed) return true

  // Single character - allow if it's a valid short word
  if (trimmed.length === 1) {
    return !VALID_SHORT_WORDS.has(trimmed)
  }

  // Check if it's a valid short word
  if (VALID_SHORT_WORDS.has(trimmed)) return false

  // Mostly non-alphanumeric (> 50% symbols/punctuation)
  const alphanumeric = trimmed.replace(/[^a-z0-9]/gi, "")
  if (alphanumeric.length < trimmed.length * 0.5) return true

  // Repeated character patterns (3+ same char in a row)
  if (/(.)\1{2,}/.test(trimmed)) return true

  // Very short with no vowels (likely noise like "mmm", "shh")
  if (trimmed.length <= 3 && !/[aeiou]/i.test(trimmed)) return true

  return false
}

export interface UseSharedVoiceReturn {
  globalStatus: Status
  isConnected: boolean
  isLoading: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  stopAudio: () => void
  sendClaudeConfirm: (containerId: string, taskId: string) => void
  sendClaudeDeny: (containerId: string, taskId: string) => void
  saveChat: () => void
  playTTS: (containerId: string, text: string, messageId: string) => Promise<void>
}

export function useSharedVoice(): UseSharedVoiceReturn {
  const {
    containers,
    activeContainerId,
    activeContainer,
    dispatch,
    createContainer,
    switchToContainer,
    deleteContainer,
    getNextAvailableContainerId,
  } = useContainers()

  const [globalStatus, setGlobalStatus] = useState<Status>("idle")
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<Awaited<ReturnType<typeof window.vad.MicVAD.new>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const thinkingAudioRef = useRef<{ stop: () => void; pitchUp: () => void } | null>(null)
  const ttsRequestIdRef = useRef(0)
  const skipNextResponseRef = useRef(false)
  const aiDisabledRef = useRef(false)
  const activeContainerIdRef = useRef(activeContainerId)
  const containersRef = useRef(containers)

  // Keep refs in sync with state
  useEffect(() => {
    activeContainerIdRef.current = activeContainerId
  }, [activeContainerId])

  useEffect(() => {
    containersRef.current = containers
  }, [containers])

  // Create a soft rhythmic thinking beat using Web Audio API
  const startThinkingBeat = useCallback(() => {
    if (thinkingAudioRef.current) return

    const audioContext = new AudioContext()
    const gainNode = audioContext.createGain()
    gainNode.gain.value = 0.15
    gainNode.connect(audioContext.destination)

    let isPlaying = true
    let frequency = 220

    const playBeat = () => {
      if (!isPlaying) return

      const oscillator = audioContext.createOscillator()
      const beatGain = audioContext.createGain()

      oscillator.type = "sine"
      oscillator.frequency.value = frequency

      beatGain.gain.setValueAtTime(0.3, audioContext.currentTime)
      beatGain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15)

      oscillator.connect(beatGain)
      beatGain.connect(gainNode)

      oscillator.start(audioContext.currentTime)
      oscillator.stop(audioContext.currentTime + 0.15)

      setTimeout(playBeat, 600)
    }

    playBeat()

    thinkingAudioRef.current = {
      stop: () => {
        isPlaying = false
        audioContext.close()
        thinkingAudioRef.current = null
      },
      pitchUp: () => {
        frequency = 330
      },
    }
  }, [])

  const stopThinkingBeat = useCallback(() => {
    thinkingAudioRef.current?.stop()
  }, [])

  const stopAudio = useCallback(() => {
    stopThinkingBeat()
    ttsRequestIdRef.current++
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    window.speechSynthesis.cancel()

    // Clear speaking state for active container
    dispatch({
      type: "SET_SPEAKING",
      payload: { containerId: activeContainerIdRef.current, messageId: null },
    })
  }, [stopThinkingBeat, dispatch])

  const playTTS = useCallback(
    async (containerId: string, text: string, messageId: string) => {
      // Only play TTS for active container
      if (containerId !== activeContainerIdRef.current) {
        // Store pending TTS for background container
        dispatch({
          type: "SET_PENDING_TTS",
          payload: { containerId, tts: { text, messageId } },
        })
        dispatch({
          type: "SET_STATUS",
          payload: { containerId, status: "ready" },
        })
        return
      }

      ttsRequestIdRef.current++
      const thisRequestId = ttsRequestIdRef.current

      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      window.speechSynthesis.cancel()

      setGlobalStatus("speaking")
      dispatch({ type: "SET_STATUS", payload: { containerId, status: "speaking" } })
      dispatch({ type: "SET_SPEAKING", payload: { containerId, messageId } })

      try {
        const response = await fetch(`${API_URL}/tts/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })

        if (thisRequestId !== ttsRequestIdRef.current) return
        if (!response.ok) throw new Error("TTS request failed")

        const contentType = response.headers.get("content-type") || ""

        if (contentType.includes("audio/wav")) {
          const audioBlob = await response.blob()
          if (thisRequestId !== ttsRequestIdRef.current) return

          const audioUrl = URL.createObjectURL(audioBlob)
          const audio = new Audio(audioUrl)
          audioRef.current = audio

          audio.onended = () => {
            dispatch({ type: "SET_SPEAKING", payload: { containerId, messageId: null } })
            dispatch({ type: "SET_STATUS", payload: { containerId, status: "idle" } })
            setGlobalStatus("listening")
            URL.revokeObjectURL(audioUrl)
          }
          audio.onerror = () => {
            dispatch({ type: "SET_SPEAKING", payload: { containerId, messageId: null } })
            dispatch({ type: "SET_STATUS", payload: { containerId, status: "idle" } })
            setGlobalStatus("listening")
          }

          stopThinkingBeat()
          await audio.play()
          return
        }

        // Chunked response handling
        const reader = response.body?.getReader()
        if (!reader) throw new Error("No response body")

        const audioContext = new AudioContext()
        audioContextRef.current = audioContext
        const audioQueue: AudioBuffer[] = []
        let isPlaying = false
        let readerDone = false
        let buffer = new Uint8Array(0)

        const checkComplete = () => {
          if (readerDone && audioQueue.length === 0 && !isPlaying) {
            dispatch({ type: "SET_SPEAKING", payload: { containerId, messageId: null } })
            dispatch({ type: "SET_STATUS", payload: { containerId, status: "idle" } })
            setGlobalStatus("listening")
            audioContext.close()
            audioContextRef.current = null
          }
        }

        const playNext = () => {
          if (audioQueue.length === 0) {
            isPlaying = false
            checkComplete()
            return
          }
          isPlaying = true
          const audioBuffer = audioQueue.shift()!
          const source = audioContext.createBufferSource()
          source.buffer = audioBuffer
          source.connect(audioContext.destination)
          source.onended = playNext
          source.start()
        }

        while (true) {
          const { done, value } = await reader.read()

          if (thisRequestId !== ttsRequestIdRef.current) {
            reader.cancel()
            audioContext.close()
            return
          }

          if (done) {
            readerDone = true
            checkComplete()
            break
          }

          const newBuffer = new Uint8Array(buffer.length + value.length)
          newBuffer.set(buffer)
          newBuffer.set(value, buffer.length)
          buffer = newBuffer

          while (buffer.length >= 4) {
            const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)
            if (buffer.length < 4 + length) break

            const wavData = buffer.slice(4, 4 + length)
            buffer = buffer.slice(4 + length)

            try {
              const audioBuffer = await audioContext.decodeAudioData(
                wavData.buffer.slice(wavData.byteOffset, wavData.byteOffset + wavData.byteLength)
              )
              audioQueue.push(audioBuffer)

              if (!isPlaying) {
                stopThinkingBeat()
                playNext()
              }
            } catch (decodeErr) {
              console.warn("Failed to decode audio chunk:", decodeErr)
            }
          }
        }
      } catch (err) {
        console.warn("TTS failed, using browser TTS:", err)
        stopThinkingBeat()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.onend = () => {
          dispatch({ type: "SET_SPEAKING", payload: { containerId, messageId: null } })
          dispatch({ type: "SET_STATUS", payload: { containerId, status: "idle" } })
          setGlobalStatus("listening")
        }
        window.speechSynthesis.speak(utterance)
      }
    },
    [stopThinkingBeat, dispatch]
  )

  // Handle switching containers - play pending TTS
  useEffect(() => {
    const container = containers.get(activeContainerId)
    if (container?.pendingTTS) {
      const { text, messageId } = container.pendingTTS
      dispatch({ type: "SET_PENDING_TTS", payload: { containerId: activeContainerId, tts: null } })
      playTTS(activeContainerId, text, messageId)
    }
  }, [activeContainerId, containers, dispatch, playTTS])

  const saveChat = useCallback(() => {
    const container = containersRef.current.get(activeContainerIdRef.current)
    if (!container) return

    const chatData = {
      timestamp: new Date().toISOString(),
      containerId: activeContainerIdRef.current,
      messages: container.messages,
    }
    const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `chat-${activeContainerIdRef.current}-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const sendClaudeChat = useCallback((containerId: string, text: string, context: string = "") => {
    const container = containersRef.current.get(containerId)
    wsRef.current?.send(JSON.stringify({
      type: "claude_chat",
      containerId,
      text,
      context,
      projectContext: container?.projectContext || "",
    }))
  }, [])

  const sendClaudePlanRequest = useCallback((containerId: string, text: string) => {
    const container = containersRef.current.get(containerId)
    const projectContext = container?.projectContext || ""
    const fullPrompt = projectContext ? `Project Context:\n${projectContext}\n\nTask: ${text}` : text
    wsRef.current?.send(JSON.stringify({
      type: "claude_request",
      containerId,
      text: fullPrompt,
    }))
  }, [])

  const sendClaudeConfirm = useCallback((containerId: string, taskId: string) => {
    wsRef.current?.send(JSON.stringify({
      type: "claude_confirm",
      containerId,
      taskId,
    }))
  }, [])

  const sendClaudeDeny = useCallback((containerId: string, taskId: string) => {
    wsRef.current?.send(JSON.stringify({
      type: "claude_deny",
      containerId,
      taskId,
    }))
  }, [])

  // Helper to update pending message
  const updatePendingMessage = useCallback(
    (containerId: string, text: string | null) => {
      const container = containersRef.current.get(containerId)
      if (!container) return

      const lastPendingIndex = container.messages.findLastIndex(
        (msg) => msg.role === "user" && msg.text === "..."
      )
      if (lastPendingIndex === -1) return

      const pendingMessage = container.messages[lastPendingIndex]
      if (text === null) {
        dispatch({ type: "REMOVE_MESSAGE", payload: { containerId, messageId: pendingMessage.id } })
      } else {
        dispatch({ type: "UPDATE_MESSAGE", payload: { containerId, messageId: pendingMessage.id, text } })
      }
    },
    [dispatch]
  )

  // Add local assistant message
  const addLocalResponse = useCallback(
    (containerId: string, text: string, source: "gemini" | "claude" | "local" = "gemini") => {
      const messageId = crypto.randomUUID()
      dispatch({
        type: "ADD_MESSAGE",
        payload: { containerId, message: { id: messageId, role: "assistant", text, source } },
      })
      return messageId
    },
    [dispatch]
  )

  // Handle voice commands
  const handleVoiceCommand = useCallback(
    (command: VoiceCommand, containerId: string): boolean => {
      const currentContainers = containersRef.current
      const container = currentContainers.get(containerId)

      switch (command.type) {
        case "switch_container": {
          if (command.containerId && currentContainers.has(command.containerId)) {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)
            switchToContainer(command.containerId)
            const messageId = addLocalResponse(containerId, `Switched to ${command.containerId === "main" ? "main" : `container ${command.containerId.toUpperCase()}`}.`)
            playTTS(containerId, `Switched to ${command.containerId === "main" ? "main" : `container ${command.containerId.toUpperCase()}`}.`, messageId)
            return true
          }
          return false
        }

        case "create_container": {
          stopThinkingBeat()
          updatePendingMessage(containerId, command.rawText)

          let newId: ContainerId | null = null
          if (command.containerId && !currentContainers.has(command.containerId)) {
            dispatch({
              type: "CREATE_CONTAINER",
              payload: { id: command.containerId, inheritAI: container?.activeAI },
            })
            newId = command.containerId
          } else {
            newId = createContainer({ inheritAI: container?.activeAI })
          }

          if (newId) {
            switchToContainer(newId)
            const messageId = addLocalResponse(containerId, `Created container ${newId.toUpperCase()}.`)
            playTTS(containerId, `Created container ${newId.toUpperCase()}.`, messageId)
          } else {
            const messageId = addLocalResponse(containerId, "Maximum containers reached.")
            playTTS(containerId, "Maximum containers reached.", messageId)
          }
          return true
        }

        case "send_to_container": {
          if (!command.containerId) return false
          stopThinkingBeat()
          updatePendingMessage(containerId, command.rawText)

          // Get recent context (last 5 messages)
          const recentMessages = container?.messages.slice(-5) || []

          // Create or update target container
          const targetExists = currentContainers.has(command.containerId)
          if (!targetExists) {
            dispatch({
              type: "CREATE_CONTAINER",
              payload: {
                id: command.containerId,
                inheritAI: container?.activeAI,
                initialMessages: recentMessages,
              },
            })
          } else {
            // Add context to existing container
            for (const msg of recentMessages) {
              dispatch({
                type: "ADD_MESSAGE",
                payload: { containerId: command.containerId, message: { ...msg, id: crypto.randomUUID() } },
              })
            }
          }

          // Set container to processing and send request
          dispatch({ type: "SET_STATUS", payload: { containerId: command.containerId, status: "processing" } })

          // Build a summary prompt from recent context
          const contextSummary = recentMessages
            .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`)
            .join("\n")

          const targetAI = container?.activeAI || "gemini"
          if (targetAI === "claude") {
            sendClaudeRequest(command.containerId, `Continue working on this: ${contextSummary}`)
          } else if (targetAI === "local") {
            wsRef.current?.send(JSON.stringify({
              type: "local_request",
              containerId: command.containerId,
              text: `Continue working on this: ${contextSummary}`,
            }))
          } else {
            // For Gemini, we send via WebSocket
            wsRef.current?.send(JSON.stringify({
              type: "gemini_request",
              containerId: command.containerId,
              text: `Continue working on this: ${contextSummary}`,
            }))
          }

          const messageId = addLocalResponse(containerId, `Sent context to container ${command.containerId.toUpperCase()}. It's working in the background.`)
          playTTS(containerId, `Sent to container ${command.containerId.toUpperCase()}. It's working in the background.`, messageId)
          return true
        }

        case "close_container": {
          // Use specified container or current container
          const targetContainer = command.containerId || containerId

          // Can't close main
          if (targetContainer === "main") {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)
            const messageId = addLocalResponse(containerId, "Cannot close the main container.")
            playTTS(containerId, "Cannot close the main container.", messageId)
            return true
          }

          // Can't close if only one container exists
          if (currentContainers.size <= 1) {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)
            const messageId = addLocalResponse(containerId, "Cannot close the only container.")
            playTTS(containerId, "Cannot close the only container.", messageId)
            return true
          }

          if (currentContainers.has(targetContainer)) {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)
            deleteContainer(targetContainer)
            const messageId = addLocalResponse(containerId, `Closed container ${targetContainer.toUpperCase()}.`)
            playTTS(containerId, `Closed container ${targetContainer.toUpperCase()}.`, messageId)
            return true
          }
          return false
        }

        case "save_chat": {
          stopThinkingBeat()
          saveChat()
          updatePendingMessage(containerId, "Save chat")
          addLocalResponse(containerId, "Chat saved.", container?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "disable_ai": {
          stopThinkingBeat()
          aiDisabledRef.current = true
          updatePendingMessage(containerId, "Disable")
          addLocalResponse(containerId, "AI disabled. Say 'start' to re-enable.", container?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "enable_ai": {
          stopThinkingBeat()
          aiDisabledRef.current = false
          updatePendingMessage(containerId, "Start")
          addLocalResponse(containerId, "AI enabled.", container?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "switch_ai": {
          if (command.targetAI) {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)
            dispatch({ type: "SET_AI", payload: { containerId, ai: command.targetAI } })

            // Build conversation history to transfer to the new AI
            const historyMessages = container?.messages
              .filter((m) => m.text !== "...")
              .slice(-20) // Last 20 messages for context
              .map((m) => ({
                role: m.role,
                content: m.text,
              })) || []

            // Send history to backend for the new AI provider
            if (historyMessages.length > 0) {
              wsRef.current?.send(JSON.stringify({
                type: "set_history",
                containerId,
                provider: command.targetAI,
                history: historyMessages,
              }))
            }

            const aiNames: Record<string, string> = { gemini: "Gemini", claude: "Claude", local: "Local" }
            const aiName = aiNames[command.targetAI] || command.targetAI
            const messageId = addLocalResponse(containerId, `Switched to ${aiName}.`, command.targetAI)
            playTTS(containerId, `Switched to ${aiName}.`, messageId)
            return true
          }
          return false
        }

        case "escalate_ai": {
          if (command.targetAI) {
            stopThinkingBeat()
            updatePendingMessage(containerId, command.rawText)

            // Create new container with current messages
            const currentMessages = container?.messages || []
            const newId = createContainer({
              inheritAI: command.targetAI,
              initialMessages: currentMessages,
            })

            if (newId) {
              switchToContainer(newId)
              const aiNames: Record<string, string> = { gemini: "Gemini", claude: "Claude", local: "Local" }
              const aiName = aiNames[command.targetAI]
              const messageId = addLocalResponse(newId, `Escalated to ${aiName} in container ${newId.toUpperCase()}.`, command.targetAI)
              playTTS(newId, `Moved to ${aiName}.`, messageId)
            } else {
              const messageId = addLocalResponse(containerId, "No container slots available.", container?.activeAI)
              playTTS(containerId, "No container slots available.", messageId)
            }
            return true
          }
          return false
        }

        case "accept_task": {
          const task = container?.claudeTask
          if (task) {
            // Existing flow: confirm pending task
            stopThinkingBeat()
            updatePendingMessage(containerId, "Accept")
            sendClaudeConfirm(containerId, task.id)
            dispatch({ type: "SET_CLAUDE_TASK", payload: { containerId, task: null } })
            setGlobalStatus("listening")
            return true
          } else if (container?.activeAI === "claude") {
            // No pending task, but in Claude mode - execute last user request
            const lastUserMessage = container.messages
              .filter((m) => m.role === "user" && m.text !== "...")
              .pop()
            if (lastUserMessage) {
              stopThinkingBeat()
              updatePendingMessage(containerId, "Accept")
              startThinkingBeat()
              const messageId = addLocalResponse(containerId, "Working on that now...", "claude")
              playTTS(containerId, "Working on it.", messageId)
              sendClaudePlanRequest(containerId, lastUserMessage.text)
              return true
            }
          }
          return false
        }

        case "deny_task": {
          const task = container?.claudeTask
          if (task) {
            stopThinkingBeat()
            updatePendingMessage(containerId, "Cancel")
            sendClaudeDeny(containerId, task.id)
            dispatch({ type: "SET_CLAUDE_TASK", payload: { containerId, task: null } })
            setGlobalStatus("listening")
            return true
          }
          return false
        }

        case "task_status": {
          // Check task status on specified container or current container
          const targetId = command.containerId || containerId
          const targetContainer = containersRef.current.get(targetId)
          stopThinkingBeat()
          updatePendingMessage(containerId, command.rawText)

          if (!targetContainer) {
            const messageId = addLocalResponse(containerId, `Container ${targetId.toUpperCase()} does not exist.`)
            playTTS(containerId, `Container ${targetId.toUpperCase()} does not exist.`, messageId)
            return true
          }

          const containerName = targetId === "main" ? "Main" : targetId.toUpperCase()
          const task = targetContainer.claudeTask

          if (task) {
            const shortPlan = task.plan.length > 100 ? task.plan.slice(0, 100) + "..." : task.plan
            const messageId = addLocalResponse(containerId, `${containerName} has a pending task: ${shortPlan}`)
            playTTS(containerId, `${containerName} has a pending task awaiting approval.`, messageId)
          } else {
            const messageId = addLocalResponse(containerId, `No active task on ${containerName}.`)
            playTTS(containerId, `No active task on ${containerName}.`, messageId)
          }
          return true
        }

        case "plan_task": {
          // Only works in Claude mode - trigger planning from conversation
          if (container?.activeAI === "claude") {
            stopThinkingBeat()
            updatePendingMessage(containerId, "Plan this")
            startThinkingBeat()

            // Build context from recent conversation
            const context = container.messages
              .slice(-10)
              .map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")

            const messageId = addLocalResponse(containerId, "Creating a plan based on our conversation...", "claude")
            playTTS(containerId, "Let me create a plan for that.", messageId)

            sendClaudePlanRequest(containerId, `Based on this conversation, create a detailed plan:\n\n${context}`)
            return true
          }
          return false
        }

        case "execute_task": {
          // Only works in Claude mode - plan and auto-execute
          if (container?.activeAI === "claude") {
            stopThinkingBeat()
            updatePendingMessage(containerId, "Do this")
            startThinkingBeat()

            // Build context from recent conversation
            const context = container.messages
              .slice(-10)
              .map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")

            const messageId = addLocalResponse(containerId, "I'll create a plan and execute it...", "claude")
            playTTS(containerId, "I'll work on that now.", messageId)

            // For now, just trigger planning - user can say "accept" after
            // TODO: Auto-accept after plan is received
            sendClaudePlanRequest(containerId, `Based on this conversation, create and execute a plan:\n\n${context}`)
            return true
          }
          return false
        }

        case "collect_context": {
          stopThinkingBeat()
          updatePendingMessage(containerId, "Collect context")
          startThinkingBeat()

          dispatch({ type: "SET_AI", payload: { containerId, ai: "claude" } })
          const messageId = addLocalResponse(containerId, "Scanning project...", "claude")
          playTTS(containerId, "Let me explore this project.", messageId)

          wsRef.current?.send(JSON.stringify({
            type: "claude_collect_context",
            containerId
          }))
          return true
        }

        case "wipe_context": {
          stopThinkingBeat()
          updatePendingMessage(containerId, null) // Remove the pending message

          // Clear messages in UI
          dispatch({ type: "CLEAR_MESSAGES", payload: { containerId } })

          // Clear backend session for all providers
          wsRef.current?.send(JSON.stringify({
            type: "clear_context",
            containerId,
          }))

          const messageId = addLocalResponse(containerId, "Context cleared. Starting fresh.", container?.activeAI)
          playTTS(containerId, "Context cleared. Starting fresh.", messageId)
          return true
        }

        case "ignored": {
          stopThinkingBeat()
          updatePendingMessage(containerId, null)
          setGlobalStatus("listening")
          return true
        }

        default:
          return false
      }
    },
    [
      dispatch,
      createContainer,
      switchToContainer,
      deleteContainer,
      stopThinkingBeat,
      startThinkingBeat,
      updatePendingMessage,
      addLocalResponse,
      playTTS,
      saveChat,
      sendClaudeChat,
      sendClaudePlanRequest,
      sendClaudeConfirm,
      sendClaudeDeny,
    ]
  )

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log("WebSocket connected")
      setIsConnected(true)
      setError(null)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const containerId = data.containerId || activeContainerIdRef.current
      const container = containersRef.current.get(containerId)

      if (data.type === "transcription") {
        const text = data.text

        // Filter out background noise / illegible transcriptions
        if (isLikelyNoise(text)) {
          return
        }

        // Check for voice commands first
        const command = parseVoiceCommand(text)
        if (command) {
          const handled = handleVoiceCommand(command, containerId)
          if (handled) {
            skipNextResponseRef.current = true
            return
          }
        }

        // Check for Claude direct address: "Claude, ..."
        const claudeAddress = parseClaudeDirectAddress(text)
        if (claudeAddress) {
          stopThinkingBeat()
          updatePendingMessage(containerId, text)
          startThinkingBeat()
          dispatch({ type: "SET_AI", payload: { containerId, ai: "claude" } })
          // Use chat mode for conversation (not planning)
          sendClaudeChat(containerId, claudeAddress.prompt)
          skipNextResponseRef.current = true
          return
        }

        // Handle Claude mode exit
        if (container?.activeAI === "claude" && isClaudeExitCommand(text)) {
          stopThinkingBeat()
          dispatch({ type: "SET_AI", payload: { containerId, ai: "gemini" } })
          updatePendingMessage(containerId, text)
          const messageId = addLocalResponse(containerId, "Switched back to Gemini.", "gemini")
          playTTS(containerId, "Switched back to Gemini.", messageId)
          skipNextResponseRef.current = true
          return
        }

        // If in Local mode, route to Local LLM
        if (container?.activeAI === "local") {
          stopThinkingBeat()
          updatePendingMessage(containerId, text)
          startThinkingBeat()
          wsRef.current?.send(JSON.stringify({
            type: "local_request",
            containerId,
            text,
          }))
          skipNextResponseRef.current = true
          return
        }

        // If in Claude mode, route to Claude
        if (container?.activeAI === "claude") {
          stopThinkingBeat()
          updatePendingMessage(containerId, text)
          startThinkingBeat()

          // Check if this is an action request - route to planning instead of chat
          const actionWords = ["create", "make", "write", "fix", "run", "delete", "update", "add", "remove", "install", "build", "edit", "change", "modify"]
          const lowerText = text.toLowerCase()
          const isActionRequest = actionWords.some((word) => lowerText.includes(word))

          if (isActionRequest) {
            // Action request - go straight to planning/execution
            const messageId = addLocalResponse(containerId, "Working on that...", "claude")
            playTTS(containerId, "Working on that.", messageId)
            sendClaudePlanRequest(containerId, text)
          } else {
            // Discussion only - use chat mode
            const context = container.messages
              .slice(-6)
              .map((m) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")
            sendClaudeChat(containerId, text, context)
          }

          skipNextResponseRef.current = true
          return
        }

        // AI disabled check
        if (aiDisabledRef.current) {
          stopThinkingBeat()
          updatePendingMessage(containerId, text)
          setGlobalStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Normal transcription - update pending message
        updatePendingMessage(containerId, text)
      } else if (data.type === "response") {
        if (skipNextResponseRef.current) {
          skipNextResponseRef.current = false
          return
        }

        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        dispatch({
          type: "ADD_MESSAGE",
          payload: { containerId, message: { id: messageId, role: "assistant", text: data.text, source: "gemini" } },
        })
        dispatch({ type: "SET_STATUS", payload: { containerId, status: "speaking" } })
        playTTS(containerId, data.text, messageId)
      } else if (data.type === "claude_chat_response") {
        // Conversational Claude response
        stopThinkingBeat()
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        dispatch({
          type: "ADD_MESSAGE",
          payload: { containerId, message: { id: messageId, role: "assistant", text: data.text, source: "claude" } },
        })
        dispatch({ type: "SET_STATUS", payload: { containerId, status: "speaking" } })
        playTTS(containerId, data.text, messageId)
      } else if (data.type === "local_response") {
        // Local LLM response
        stopThinkingBeat()
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        dispatch({
          type: "ADD_MESSAGE",
          payload: { containerId, message: { id: messageId, role: "assistant", text: data.text, source: "local" } },
        })
        dispatch({ type: "SET_STATUS", payload: { containerId, status: "speaking" } })
        playTTS(containerId, data.text, messageId)
      } else if (data.type === "local_error") {
        // Local LLM error
        stopThinkingBeat()
        const errorText = data.error || "Local AI is not available."
        const messageId = addLocalResponse(containerId, `Local error: ${errorText}`, "local")
        playTTS(containerId, `Sorry, ${errorText}`, messageId)
      } else if (data.type === "claude_context_collected") {
        // Project context collected
        stopThinkingBeat()
        dispatch({
          type: "SET_PROJECT_CONTEXT",
          payload: { containerId, context: data.context }
        })
        const shortContext = data.context.length > 200 ? data.context.slice(0, 200) + "..." : data.context
        const messageId = crypto.randomUUID()
        dispatch({
          type: "ADD_MESSAGE",
          payload: { containerId, message: { id: messageId, role: "assistant", text: `Context collected:\n\n${shortContext}`, source: "claude" } },
        })
        dispatch({ type: "SET_STATUS", payload: { containerId, status: "speaking" } })
        playTTS(containerId, "I've learned about this project. You can now ask me questions about it.", messageId)
      } else if (data.type === "claude_plan") {
        stopThinkingBeat()
        dispatch({
          type: "SET_CLAUDE_TASK",
          payload: { containerId, task: { id: data.taskId, plan: data.plan } },
        })
        dispatch({ type: "SET_AI", payload: { containerId, ai: "claude" } })

        const messageId = crypto.randomUUID()
        const displayText = `Claude's plan: ${data.plan}\n\nSay "accept" or "cancel".`
        dispatch({
          type: "ADD_MESSAGE",
          payload: { containerId, message: { id: messageId, role: "assistant", text: displayText, source: "claude" } },
        })

        const shortPlan = data.plan.length > 300 ? data.plan.slice(0, 300) + "..." : data.plan
        playTTS(containerId, `Here's my plan: ${shortPlan}. Do you want me to proceed?`, messageId)
      } else if (data.type === "claude_running") {
        const messageId = addLocalResponse(containerId, "Task started. I'll let you know when it's done.", "claude")
        playTTS(containerId, "Task started. I'll let you know when it's done.", messageId)
      } else if (data.type === "claude_complete") {
        const resultText = data.result || "Task completed."
        const shortResult = resultText.length > 200 ? resultText.slice(0, 200) + "..." : resultText

        const messageId = addLocalResponse(containerId, `Claude completed: ${resultText}`, "claude")
        dispatch({ type: "SET_STATUS", payload: { containerId, status: "ready" } })
        playTTS(containerId, `Task complete. ${shortResult}`, messageId)
      } else if (data.type === "claude_denied") {
        const messageId = addLocalResponse(containerId, "Task cancelled.", "claude")
        playTTS(containerId, "Task cancelled.", messageId)
      } else if (data.type === "claude_error") {
        const errorText = data.error || "An error occurred."
        const messageId = addLocalResponse(containerId, `Claude error: ${errorText}`, "claude")
        playTTS(containerId, `Sorry, there was an error: ${errorText}`, messageId)
      }
    }

    ws.onerror = () => {
      setError("WebSocket connection failed. Is the backend running?")
      setGlobalStatus("idle")
      setIsConnected(false)
    }

    ws.onclose = () => {
      console.log("WebSocket closed, reconnecting...")
      setIsConnected(false)
      setTimeout(connectWebSocket, 3000)
    }

    wsRef.current = ws
  }, [
    dispatch,
    handleVoiceCommand,
    stopThinkingBeat,
    startThinkingBeat,
    updatePendingMessage,
    addLocalResponse,
    playTTS,
    sendClaudeChat,
  ])

  const start = useCallback(async () => {
    if (!window.vad) {
      setError("VAD not loaded. Please refresh the page.")
      return
    }

    setIsLoading(true)
    console.log("Starting voice chat...")

    try {
      connectWebSocket()

      const myvad = await window.vad.MicVAD.new({
        onSpeechStart: () => {
          console.log("Speech started")
          stopAudio()
        },
        onSpeechEnd: (audio) => {
          console.log("Speech ended, sending audio...")
          if (wsRef.current?.readyState !== WebSocket.OPEN) {
            console.log("WebSocket not ready")
            return
          }

          const containerId = activeContainerIdRef.current

          // Add pending user message
          dispatch({
            type: "ADD_MESSAGE",
            payload: {
              containerId,
              message: { id: crypto.randomUUID(), role: "user", text: "..." },
            },
          })

          setGlobalStatus("processing")
          dispatch({ type: "SET_STATUS", payload: { containerId, status: "processing" } })
          startThinkingBeat()

          // Encode and send audio with container ID
          const wavBuffer = encodeWAV(audio, 16000)

          // Send container ID as JSON first, then audio
          wsRef.current?.send(JSON.stringify({ type: "audio_meta", containerId }))
          wsRef.current?.send(wavBuffer)
        },
        onVADMisfire: () => {
          console.log("VAD misfire (too short)")
        },
      })

      vadRef.current = myvad
      await myvad.start()
      setGlobalStatus("listening")
      setIsLoading(false)
    } catch (err) {
      console.error("VAD error:", err)
      setError(`VAD error: ${err instanceof Error ? err.message : String(err)}`)
      setIsLoading(false)
    }
  }, [connectWebSocket, startThinkingBeat, stopAudio, dispatch])

  const stop = useCallback(() => {
    console.log("Stopping voice chat (listening only)...")
    // Only stop VAD/listening - let audio and processing continue
    vadRef.current?.pause()
    vadRef.current?.destroy()
    vadRef.current = null
    setGlobalStatus("idle")
    // Do NOT close WebSocket or stop thinking beat - actions continue
  }, [])

  useEffect(() => {
    return () => {
      thinkingAudioRef.current?.stop()
      wsRef.current?.close()
      vadRef.current?.destroy()
    }
  }, [])

  return {
    globalStatus,
    isConnected,
    isLoading,
    error,
    start,
    stop,
    stopAudio,
    sendClaudeConfirm,
    sendClaudeDeny,
    saveChat,
    playTTS,
  }
}

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, samples.length * 2, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buffer
}
