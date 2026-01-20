import { useState, useEffect, useRef, useCallback } from "react"
import { useApp } from "../context/AppContext"
import { parseVoiceCommand, parseClaudeDirectAddress, isClaudeExitCommand } from "../utils/voiceCommands"
import type { VoiceCommand } from "../utils/voiceCommands"
import type { Status, TodoCategory, Message } from "../types"

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

/**
 * Strip markdown formatting from text before sending to TTS.
 * Preserves readable text while removing formatting syntax.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")  // Code blocks
    .replace(/`([^`]+)`/g, "$1")                  // Inline code
    .replace(/\*\*([^*]+)\*\*/g, "$1")            // Bold
    .replace(/\*([^*]+)\*/g, "$1")                // Italic
    .replace(/__([^_]+)__/g, "$1")                // Bold alt
    .replace(/_([^_]+)_/g, "$1")                  // Italic alt
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // Links
    .replace(/^#+\s+/gm, "")                      // Headers
    .replace(/^[-*+]\s+/gm, "")                   // List items
    .replace(/^>\s+/gm, "")                       // Blockquotes
    .replace(/^---+$/gm, "")                      // Horizontal rules
    .trim()
}

export type NavigationRequest = "management" | "list" | "chat" | null

export interface UseSharedVoiceReturn {
  globalStatus: Status
  isConnected: boolean
  isLoading: boolean
  error: string | null
  listeningMode: boolean
  hasBufferedSpeech: boolean
  isProcessing: boolean
  navigationRequest: NavigationRequest
  clearNavigationRequest: () => void
  start: () => Promise<void>
  stop: () => void
  stopAudio: () => void
  processNow: () => void
  sendClaudeConfirm: (containerId: string, taskId: string) => void
  sendClaudeDeny: (containerId: string, taskId: string) => void
  saveChat: () => void
  playTTS: (containerId: string, text: string, messageId: string) => Promise<void>
  sendText: (text: string) => void
}

export function useSharedVoice(): UseSharedVoiceReturn {
  const {
    state,
    dispatch,
    createCategory,
    selectCategory,
    addMessage,
    updateMessage,
    removeMessage,
    clearMessages,
    setAI,
    setCategoryStatus,
    setCategorySpeaking,
    setProjectContext,
    setDirectoryPath,
    navigateToView,
  } = useApp()

  // Derive values from state
  const categories = state.todoCategories
  const selectedCategoryId = state.selectedCategoryId

  const [globalStatus, setGlobalStatus] = useState<Status>("idle")
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listeningMode, setListeningMode] = useState(false)
  const [hasBufferedSpeech, setHasBufferedSpeech] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [navigationRequest, setNavigationRequest] = useState<NavigationRequest>(null)

  // Ref to track listening mode for use in callbacks
  const listeningModeRef = useRef(false)

  // Clear navigation request (should be called by parent after handling)
  const clearNavigationRequest = useCallback(() => {
    setNavigationRequest(null)
  }, [])

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<Awaited<ReturnType<typeof window.vad.MicVAD.new>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const thinkingAudioRef = useRef<{ stop: () => void; pitchUp: () => void } | null>(null)
  const ttsRequestIdRef = useRef(0)
  const skipNextResponseRef = useRef(false)
  const aiDisabledRef = useRef(false)
  const selectedCategoryIdRef = useRef(selectedCategoryId)
  const categoriesRef = useRef(categories)

  // Helper to find category by ID
  const getCategoryById = useCallback((categoryId: string | null): TodoCategory | undefined => {
    if (!categoryId) return undefined
    return categoriesRef.current.find(c => c.id === categoryId)
  }, [])

  // Helper to find category by name (fuzzy match)
  const findCategoryByName = useCallback((name: string): TodoCategory | undefined => {
    const normalized = name.toLowerCase()
    return categoriesRef.current.find(c =>
      c.name.toLowerCase().includes(normalized) ||
      normalized.includes(c.name.toLowerCase())
    )
  }, [])

  // Message buffering - collect speech segments before processing
  const speechBufferRef = useRef<Float32Array[]>([])
  const bufferTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Helper to concatenate multiple audio buffers into one
  const concatenateAudioBuffers = useCallback((buffers: Float32Array[]): Float32Array => {
    const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0)
    const result = new Float32Array(totalLength)
    let offset = 0
    for (const buf of buffers) {
      result.set(buf, offset)
      offset += buf.length
    }
    return result
  }, [])

  // Process buffered speech - called after buffer delay
  const processBufferedSpeech = useCallback(() => {
    if (speechBufferRef.current.length === 0) return
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.log("WebSocket not ready, clearing buffer")
      speechBufferRef.current = []
      setHasBufferedSpeech(false)
      return
    }

    const categoryId = selectedCategoryIdRef.current
    const category = categoryId ? categoriesRef.current.find(c => c.id === categoryId) : undefined
    const isGlobalMode = !categoryId
    console.log(`Processing ${speechBufferRef.current.length} buffered speech segment(s)${isGlobalMode ? " (global mode)" : ""}`)

    // Mark as processing and clear buffer state
    setIsProcessing(true)
    setHasBufferedSpeech(false)

    // Concatenate all buffered audio
    const combinedAudio = concatenateAudioBuffers(speechBufferRef.current)
    speechBufferRef.current = []

    // Encode and send audio with category ID (backend accepts containerId or categoryId)
    // In global mode, we send without a category - backend will just transcribe
    const wavBuffer = encodeWAV(combinedAudio, 16000)
    wsRef.current?.send(JSON.stringify({
      type: "audio_meta",
      containerId: categoryId,
      globalMode: isGlobalMode,
      directoryPath: category?.directoryPath || null,
      projectContext: category?.projectContext || null
    }))
    wsRef.current?.send(wavBuffer)
  }, [concatenateAudioBuffers])

  // Keep refs in sync with state
  useEffect(() => {
    selectedCategoryIdRef.current = selectedCategoryId
  }, [selectedCategoryId])

  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])

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

    // Clear speaking state for active category
    const categoryId = selectedCategoryIdRef.current
    if (categoryId) {
      setCategorySpeaking(categoryId, null)
    }
  }, [stopThinkingBeat, setCategorySpeaking])

  const playTTS = useCallback(
    async (categoryId: string, text: string, messageId: string) => {
      // Only play TTS for active category
      if (categoryId !== selectedCategoryIdRef.current) {
        // Store pending TTS for background category (global state)
        dispatch({ type: "SET_PENDING_TTS", payload: { text, messageId } })
        setCategoryStatus(categoryId, "ready")
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
      setCategoryStatus(categoryId, "speaking")
      setCategorySpeaking(categoryId, messageId)

      try {
        const response = await fetch(`${API_URL}/tts/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: stripMarkdown(text) }),
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
            setCategorySpeaking(categoryId, null)
            setCategoryStatus(categoryId, "idle")
            URL.revokeObjectURL(audioUrl)

            // In toggle mode, resume listening instead of destroying VAD
            if (listeningModeRef.current && vadRef.current) {
              setGlobalStatus("listening")
              vadRef.current.start().catch(console.error)
            } else {
              // Original behavior: destroy VAD
              if (vadRef.current) {
                vadRef.current.pause()
                vadRef.current.destroy()
                vadRef.current = null
              }
              setGlobalStatus("idle")
            }
          }
          audio.onerror = () => {
            setCategorySpeaking(categoryId, null)
            setCategoryStatus(categoryId, "idle")
            if (vadRef.current) {
              vadRef.current.pause()
              vadRef.current.destroy()
              vadRef.current = null
            }
            setGlobalStatus("idle")
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
            setCategorySpeaking(categoryId, null)
            setCategoryStatus(categoryId, "idle")
            audioContext.close()
            audioContextRef.current = null

            // In toggle mode, resume listening instead of destroying VAD
            if (listeningModeRef.current && vadRef.current) {
              setGlobalStatus("listening")
              vadRef.current.start().catch(console.error)
            } else {
              // Original behavior: destroy VAD
              if (vadRef.current) {
                vadRef.current.pause()
                vadRef.current.destroy()
                vadRef.current = null
              }
              setGlobalStatus("idle")
            }
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
          setCategorySpeaking(categoryId, null)
          setCategoryStatus(categoryId, "idle")

          // In toggle mode, resume listening instead of destroying VAD
          if (listeningModeRef.current && vadRef.current) {
            setGlobalStatus("listening")
            vadRef.current.start().catch(console.error)
          } else {
            // Original behavior: destroy VAD
            if (vadRef.current) {
              vadRef.current.pause()
              vadRef.current.destroy()
              vadRef.current = null
            }
            setGlobalStatus("idle")
          }
        }
        window.speechSynthesis.speak(utterance)
      }
    },
    [stopThinkingBeat, setCategorySpeaking, setCategoryStatus, dispatch]
  )

  // Handle switching categories - play pending TTS
  useEffect(() => {
    if (state.pendingTTS && selectedCategoryId) {
      const { text, messageId } = state.pendingTTS
      dispatch({ type: "SET_PENDING_TTS", payload: null })
      playTTS(selectedCategoryId, text, messageId)
    }
  }, [selectedCategoryId, state.pendingTTS, dispatch, playTTS])

  const saveChat = useCallback(() => {
    const categoryId = selectedCategoryIdRef.current
    const category = getCategoryById(categoryId)
    if (!category) return

    const chatData = {
      timestamp: new Date().toISOString(),
      categoryId,
      categoryName: category.name,
      messages: category.messages,
    }
    const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `chat-${category.name.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [getCategoryById])

  const sendClaudeChat = useCallback((categoryId: string, text: string, context: string = "") => {
    const category = getCategoryById(categoryId)
    wsRef.current?.send(JSON.stringify({
      type: "claude_chat",
      containerId: categoryId,  // Backend accepts containerId
      text,
      context,
      projectContext: category?.projectContext || "",
    }))
  }, [getCategoryById])

  const sendClaudePlanRequest = useCallback((categoryId: string, text: string) => {
    const category = getCategoryById(categoryId)
    const projectContext = category?.projectContext || ""
    const fullPrompt = projectContext ? `Project Context:\n${projectContext}\n\nTask: ${text}` : text
    wsRef.current?.send(JSON.stringify({
      type: "claude_request",
      containerId: categoryId,  // Backend accepts containerId
      text: fullPrompt,
    }))
  }, [getCategoryById])

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
    (categoryId: string, text: string | null) => {
      const category = getCategoryById(categoryId)
      if (!category) return

      const lastPendingIndex = category.messages.findLastIndex(
        (msg: Message) => msg.role === "user" && msg.text === "..."
      )
      if (lastPendingIndex === -1) return

      const pendingMessage = category.messages[lastPendingIndex]
      if (text === null) {
        removeMessage(categoryId, pendingMessage.id)
      } else {
        updateMessage(categoryId, pendingMessage.id, text)
      }
    },
    [getCategoryById, removeMessage, updateMessage]
  )

  // Add local assistant message
  const addLocalResponse = useCallback(
    (categoryId: string, text: string, source: "gemini" | "claude" | "local" = "gemini") => {
      const messageId = crypto.randomUUID()
      const message: Message = { id: messageId, role: "assistant", text, source }
      addMessage(categoryId, message)
      return messageId
    },
    [addMessage]
  )

  // Handle voice commands
  const handleVoiceCommand = useCallback(
    (command: VoiceCommand, categoryId: string): boolean => {
      const currentCategories = categoriesRef.current
      const category = getCategoryById(categoryId)

      switch (command.type) {
        // Switch to category by name (fuzzy match)
        case "switch_category": {
          if (command.categoryName) {
            const targetCategory = findCategoryByName(command.categoryName)
            if (targetCategory) {
              stopThinkingBeat()
              updatePendingMessage(categoryId, command.rawText)
              selectCategory(targetCategory.id)
              const messageId = addLocalResponse(categoryId, `Switched to ${targetCategory.name}.`)
              playTTS(categoryId, `Switched to ${targetCategory.name}.`, messageId)
              return true
            } else {
              // Category not found - inform user
              const messageId = addLocalResponse(categoryId, `Category "${command.categoryName}" not found.`)
              playTTS(categoryId, `Category ${command.categoryName} not found.`, messageId)
              return true
            }
          }
          return false
        }

        // Legacy container switching - for backward compatibility
        case "switch_container": {
          // In category mode, we ignore legacy container switches
          // but we could map them if needed
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          const messageId = addLocalResponse(categoryId, "Container switching not available. Use category names instead.")
          playTTS(categoryId, "Container switching not available. Use category names instead.", messageId)
          return true
        }

        case "create_container": {
          // In category mode, redirect to category management
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          navigateToView("management")
          setNavigationRequest("management")
          const messageId = addLocalResponse(categoryId, "Opening category management to create a new category.")
          playTTS(categoryId, "Opening category management to create a new category.", messageId)
          return true
        }

        case "send_to_container": {
          // In category mode, this functionality is not directly applicable
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          const messageId = addLocalResponse(categoryId, "Send to container not available in category mode.")
          playTTS(categoryId, "Send to container not available in category mode.", messageId)
          return true
        }

        case "save_chat": {
          stopThinkingBeat()
          saveChat()
          updatePendingMessage(categoryId, "Save chat")
          addLocalResponse(categoryId, "Chat saved.", category?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "disable_ai": {
          stopThinkingBeat()
          aiDisabledRef.current = true
          updatePendingMessage(categoryId, "Disable")
          addLocalResponse(categoryId, "AI disabled. Say 'start' to re-enable.", category?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "enable_ai": {
          stopThinkingBeat()
          aiDisabledRef.current = false
          updatePendingMessage(categoryId, "Start")
          addLocalResponse(categoryId, "AI enabled.", category?.activeAI)
          setGlobalStatus("listening")
          return true
        }

        case "switch_ai": {
          if (command.targetAI) {
            stopThinkingBeat()
            updatePendingMessage(categoryId, command.rawText)
            setAI(categoryId, command.targetAI)

            // Build conversation history to transfer to the new AI
            const historyMessages = category?.messages
              .filter((m: Message) => m.text !== "...")
              .slice(-20) // Last 20 messages for context
              .map((m: Message) => ({
                role: m.role,
                content: m.text,
              })) || []

            // Send history to backend for the new AI provider
            if (historyMessages.length > 0) {
              wsRef.current?.send(JSON.stringify({
                type: "set_history",
                containerId: categoryId,
                provider: command.targetAI,
                history: historyMessages,
              }))
            }

            const aiNames: Record<string, string> = { gemini: "Gemini", claude: "Claude", local: "Local" }
            const aiName = aiNames[command.targetAI] || command.targetAI
            const messageId = addLocalResponse(categoryId, `Switched to ${aiName}.`, command.targetAI)
            playTTS(categoryId, `Switched to ${aiName}.`, messageId)
            return true
          }
          return false
        }

        case "escalate_ai": {
          // In category mode, we switch AI without creating new container
          if (command.targetAI) {
            stopThinkingBeat()
            updatePendingMessage(categoryId, command.rawText)
            setAI(categoryId, command.targetAI)

            const aiNames: Record<string, string> = { gemini: "Gemini", claude: "Claude", local: "Local" }
            const aiName = aiNames[command.targetAI]
            const messageId = addLocalResponse(categoryId, `Escalated to ${aiName}.`, command.targetAI)
            playTTS(categoryId, `Moved to ${aiName}.`, messageId)
            return true
          }
          return false
        }

        case "accept_task": {
          const task = state.claudeTask
          if (task) {
            // Existing flow: confirm pending task
            stopThinkingBeat()
            updatePendingMessage(categoryId, "Accept")
            sendClaudeConfirm(categoryId, task.id)
            dispatch({ type: "SET_CLAUDE_TASK", payload: null })
            setGlobalStatus("listening")
            return true
          } else if (category?.activeAI === "claude") {
            // No pending task, but in Claude mode - execute last user request
            const lastUserMessage = category.messages
              .filter((m: Message) => m.role === "user" && m.text !== "...")
              .pop()
            if (lastUserMessage) {
              stopThinkingBeat()
              updatePendingMessage(categoryId, "Accept")
              startThinkingBeat()
              const messageId = addLocalResponse(categoryId, "Working on that now...", "claude")
              playTTS(categoryId, "Working on it.", messageId)
              sendClaudePlanRequest(categoryId, lastUserMessage.text)
              return true
            }
          }
          return false
        }

        case "deny_task": {
          const task = state.claudeTask
          if (task) {
            stopThinkingBeat()
            updatePendingMessage(categoryId, "Cancel")
            sendClaudeDeny(categoryId, task.id)
            dispatch({ type: "SET_CLAUDE_TASK", payload: null })
            setGlobalStatus("listening")
            return true
          }
          return false
        }

        case "task_status": {
          // Check task status for current category
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)

          const categoryName = category?.name || "current"
          const task = state.claudeTask

          if (task) {
            const shortPlan = task.plan.length > 100 ? task.plan.slice(0, 100) + "..." : task.plan
            const messageId = addLocalResponse(categoryId, `${categoryName} has a pending task: ${shortPlan}`)
            playTTS(categoryId, `${categoryName} has a pending task awaiting approval.`, messageId)
          } else {
            const messageId = addLocalResponse(categoryId, `No active task on ${categoryName}.`)
            playTTS(categoryId, `No active task on ${categoryName}.`, messageId)
          }
          return true
        }

        case "plan_task": {
          // Only works in Claude mode - trigger planning from conversation
          if (category?.activeAI === "claude") {
            stopThinkingBeat()
            updatePendingMessage(categoryId, "Plan this")
            startThinkingBeat()

            // Build context from recent conversation
            const context = category.messages
              .slice(-10)
              .map((m: Message) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")

            const messageId = addLocalResponse(categoryId, "Creating a plan based on our conversation...", "claude")
            playTTS(categoryId, "Let me create a plan for that.", messageId)

            sendClaudePlanRequest(categoryId, `Based on this conversation, create a detailed plan:\n\n${context}`)
            return true
          }
          return false
        }

        case "execute_task": {
          // Only works in Claude mode - plan and auto-execute
          if (category?.activeAI === "claude") {
            stopThinkingBeat()
            updatePendingMessage(categoryId, "Do this")
            startThinkingBeat()

            // Build context from recent conversation
            const context = category.messages
              .slice(-10)
              .map((m: Message) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")

            const messageId = addLocalResponse(categoryId, "I'll create a plan and execute it...", "claude")
            playTTS(categoryId, "I'll work on that now.", messageId)

            // For now, just trigger planning - user can say "accept" after
            sendClaudePlanRequest(categoryId, `Based on this conversation, create and execute a plan:\n\n${context}`)
            return true
          }
          return false
        }

        case "collect_context": {
          stopThinkingBeat()
          updatePendingMessage(categoryId, "Collect context")
          startThinkingBeat()

          setAI(categoryId, "claude")
          const messageId = addLocalResponse(categoryId, "Scanning project...", "claude")
          playTTS(categoryId, "Let me explore this project.", messageId)

          wsRef.current?.send(JSON.stringify({
            type: "claude_collect_context",
            containerId: categoryId
          }))
          return true
        }

        case "wipe_context": {
          stopThinkingBeat()
          updatePendingMessage(categoryId, null) // Remove the pending message

          // Clear messages in UI
          clearMessages(categoryId)

          // Clear backend session for all providers
          wsRef.current?.send(JSON.stringify({
            type: "clear_context",
            containerId: categoryId,
          }))

          const messageId = addLocalResponse(categoryId, "Context cleared. Starting fresh.", category?.activeAI)
          playTTS(categoryId, "Context cleared. Starting fresh.", messageId)
          return true
        }

        case "repeat_message": {
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)

          // Get assistant messages from history (excluding pending "...")
          const assistantMessages = category?.messages.filter(
            (msg: Message) => msg.role === "assistant" && msg.text !== "..."
          ) || []

          if (assistantMessages.length === 0) {
            const messageId = addLocalResponse(categoryId, "I haven't said anything yet.", category?.activeAI)
            playTTS(categoryId, "I haven't said anything yet.", messageId)
            return true
          }

          // Get the requested message by offset (1 = last, 2 = second last, etc.)
          const offset = command.messageOffset || 1
          const targetIndex = assistantMessages.length - offset

          if (targetIndex < 0) {
            const available = assistantMessages.length
            const messageId = addLocalResponse(
              categoryId,
              `I only have ${available} message${available === 1 ? "" : "s"} in this conversation.`,
              category?.activeAI
            )
            playTTS(categoryId, `I only have ${available} message${available === 1 ? "" : "s"} in this conversation.`, messageId)
            return true
          }

          const targetMessage = assistantMessages[targetIndex]

          // Replay the TTS for the target message
          playTTS(categoryId, targetMessage.text, targetMessage.id)
          return true
        }

        case "stop_listening": {
          // Exit listening mode entirely
          stopThinkingBeat()
          updatePendingMessage(categoryId, null)
          listeningModeRef.current = false
          setListeningMode(false)
          vadRef.current?.pause()
          vadRef.current?.destroy()
          vadRef.current = null
          setGlobalStatus("idle")
          return true
        }

        case "send_now": {
          // Process current buffer immediately without exiting listening mode
          stopThinkingBeat()
          updatePendingMessage(categoryId, null)
          // Clear any pending buffer timeout
          if (bufferTimeoutRef.current) {
            clearTimeout(bufferTimeoutRef.current)
            bufferTimeoutRef.current = null
          }
          processBufferedSpeech()
          return true
        }

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

        case "manage_categories": {
          // Navigate to category management view
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          navigateToView("management")
          setNavigationRequest("management")
          const messageId = addLocalResponse(categoryId, "Opening category management.", category?.activeAI)
          playTTS(categoryId, "Opening category management.", messageId)
          return true
        }

        case "list_categories": {
          // Navigate to category list
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          navigateToView("list")
          setNavigationRequest("list")
          const categoryNames = currentCategories.map(c => c.name).join(", ")
          const messageId = addLocalResponse(categoryId, `Your categories: ${categoryNames || "none yet"}.`, category?.activeAI)
          playTTS(categoryId, `You have ${currentCategories.length} categories: ${categoryNames || "none yet"}.`, messageId)
          return true
        }

        case "set_directory": {
          // Set directory path for current category
          if (command.directoryPath && categoryId) {
            stopThinkingBeat()
            updatePendingMessage(categoryId, command.rawText)
            setDirectoryPath(categoryId, command.directoryPath)
            const messageId = addLocalResponse(categoryId, `Directory set to: ${command.directoryPath}`, category?.activeAI)
            playTTS(categoryId, `Directory linked to ${command.directoryPath}`, messageId)
            return true
          }
          return false
        }

        case "list_directory": {
          // List directory contents for the current category
          stopThinkingBeat()
          updatePendingMessage(categoryId, command.rawText)
          startThinkingBeat()

          // Send request to backend
          wsRef.current?.send(JSON.stringify({
            type: "list_directory",
            categoryId,
            directoryPath: category?.directoryPath
          }))
          return true
        }

        case "ignored": {
          stopThinkingBeat()
          updatePendingMessage(categoryId, null)
          setGlobalStatus("listening")
          return true
        }

        default:
          return false
      }
    },
    [
      state,
      dispatch,
      selectCategory,
      createCategory,
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
      processBufferedSpeech,
      getCategoryById,
      findCategoryByName,
      setAI,
      clearMessages,
      setDirectoryPath,
      navigateToView,
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
      const categoryId = data.containerId || selectedCategoryIdRef.current
      const category = getCategoryById(categoryId)

      if (data.type === "transcription") {
        const text = data.text

        // Filter out background noise / illegible transcriptions
        if (isLikelyNoise(text)) {
          setIsProcessing(false)
          return
        }

        // Handle global mode (no category selected) - parse for category creation
        if (!selectedCategoryIdRef.current) {
          console.log("Global mode transcription:", text)
          stopThinkingBeat()

          // Parse for category creation commands
          // Matches: "create a category called work", "create a social category", "make a work category"
          // Try specific "called/named" pattern first, then fallback to general pattern
          const createMatch = text.match(/(?:create|make|new|add)\s+(?:a\s+)?(?:new\s+)?category\s+(?:called\s+|named\s+)(.+)/i) ||
                              text.match(/(?:create|make|new|add)\s+(?:a\s+)?(?!new\s+category)(.+?)\s+category(?:\s|$)/i)

          if (createMatch) {
            const rawName = createMatch[1].trim()
            // Capitalize first letter of each word
            const categoryName = rawName
              .split(/\s+/)
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(" ")

            console.log(`Creating category: "${categoryName}"`)

            // Create the category and use the returned object directly
            createCategory(categoryName).then((newCategory) => {
              if (newCategory) {
                selectCategory(newCategory.id)
                // Manually sync ref so playTTS works immediately (React state hasn't propagated yet)
                selectedCategoryIdRef.current = newCategory.id
                navigateToView("chat")
                // Use custom TTS service
                playTTS(newCategory.id, `Created ${categoryName} category. How can I help?`, crypto.randomUUID())
              }
            })
            skipNextResponseRef.current = true
            setGlobalStatus("idle")
            setIsProcessing(false)
            return
          }

          // Not a category creation command - prompt user
          // Use browser TTS since we have no category for proper TTS routing
          const utterance = new SpeechSynthesisUtterance(
            "Please create a category first. Say something like: create a work category."
          )
          window.speechSynthesis.speak(utterance)
          setGlobalStatus("idle")
          setIsProcessing(false)
          skipNextResponseRef.current = true
          return
        }

        // Check for voice commands first
        const command = parseVoiceCommand(text)
        if (command && categoryId) {
          const handled = handleVoiceCommand(command, categoryId)
          if (handled) {
            setIsProcessing(false)
            skipNextResponseRef.current = true
            return
          }
        }

        // Check for Claude direct address: "Claude, ..."
        const claudeAddress = parseClaudeDirectAddress(text)
        if (claudeAddress && categoryId) {
          stopThinkingBeat()
          updatePendingMessage(categoryId, text)
          startThinkingBeat()
          setAI(categoryId, "claude")
          // Use chat mode for conversation (not planning)
          sendClaudeChat(categoryId, claudeAddress.prompt)
          skipNextResponseRef.current = true
          return
        }

        // Handle Claude mode exit
        if (category?.activeAI === "claude" && isClaudeExitCommand(text) && categoryId) {
          stopThinkingBeat()
          setAI(categoryId, "gemini")
          updatePendingMessage(categoryId, text)
          const messageId = addLocalResponse(categoryId, "Switched back to Gemini.", "gemini")
          playTTS(categoryId, "Switched back to Gemini.", messageId)
          setIsProcessing(false)
          skipNextResponseRef.current = true
          return
        }

        // If in Local mode, first check for app actions via intent detection
        if (category?.activeAI === "local" && categoryId) {
          stopThinkingBeat()
          updatePendingMessage(categoryId, text)
          startThinkingBeat()

          // Build conversation history for context
          const history = category.messages
            .filter((m: Message) => m.text !== "...")
            .slice(-10)
            .map((m: Message) => ({ role: m.role, content: m.text }))

          // Send action_request for intent detection
          wsRef.current?.send(JSON.stringify({
            type: "action_request",
            categoryId,
            text,
            history,
            directoryPath: category.directoryPath,  // Context for file operations
          }))
          skipNextResponseRef.current = true
          return
        }

        // If in Claude mode, route to Claude
        if (category?.activeAI === "claude" && categoryId) {
          stopThinkingBeat()
          updatePendingMessage(categoryId, text)
          startThinkingBeat()

          // Check if this is an action request - route to planning instead of chat
          const actionWords = ["create", "make", "write", "fix", "run", "delete", "update", "add", "remove", "install", "build", "edit", "change", "modify"]
          const lowerText = text.toLowerCase()
          const isActionRequest = actionWords.some((word) => lowerText.includes(word))

          if (isActionRequest) {
            // Action request - go straight to planning/execution
            const messageId = addLocalResponse(categoryId, "Working on that...", "claude")
            playTTS(categoryId, "Working on that.", messageId)
            sendClaudePlanRequest(categoryId, text)
          } else {
            // Discussion only - use chat mode
            const context = category.messages
              .slice(-6)
              .map((m: Message) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
              .join("\n")
            sendClaudeChat(categoryId, text, context)
          }

          skipNextResponseRef.current = true
          return
        }

        // AI disabled check
        if (aiDisabledRef.current && categoryId) {
          stopThinkingBeat()
          updatePendingMessage(categoryId, text)
          setGlobalStatus("listening")
          setIsProcessing(false)
          skipNextResponseRef.current = true
          return
        }

        // Normal transcription - update pending message
        if (categoryId) {
          updatePendingMessage(categoryId, text)
        }
      } else if (data.type === "response" && categoryId) {
        if (skipNextResponseRef.current) {
          skipNextResponseRef.current = false
          return
        }

        setIsProcessing(false)
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        const message: Message = { id: messageId, role: "assistant", text: data.text, source: "gemini" }
        addMessage(categoryId, message)
        setCategoryStatus(categoryId, "speaking")
        playTTS(categoryId, data.text, messageId)
      } else if (data.type === "claude_chat_response" && categoryId) {
        // Conversational Claude response
        setIsProcessing(false)
        stopThinkingBeat()
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        const message: Message = { id: messageId, role: "assistant", text: data.text, source: "claude" }
        addMessage(categoryId, message)
        setCategoryStatus(categoryId, "speaking")
        playTTS(categoryId, data.text, messageId)
      } else if (data.type === "local_response" && categoryId) {
        // Local LLM response
        setIsProcessing(false)
        stopThinkingBeat()
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        const message: Message = { id: messageId, role: "assistant", text: data.text, source: "local" }
        addMessage(categoryId, message)
        setCategoryStatus(categoryId, "speaking")
        playTTS(categoryId, data.text, messageId)
      } else if (data.type === "local_error" && categoryId) {
        // Local LLM error
        setIsProcessing(false)
        stopThinkingBeat()
        const errorText = data.error || "Local AI is not available."
        const messageId = addLocalResponse(categoryId, `Local error: ${errorText}`, "local")
        playTTS(categoryId, `Sorry, ${errorText}`, messageId)
      } else if (data.type === "list_directory_response") {
        // Directory listing response
        setIsProcessing(false)
        stopThinkingBeat()
        const targetCategoryId = data.categoryId || categoryId
        if (targetCategoryId) {
          const messageId = addLocalResponse(targetCategoryId, data.message)
          playTTS(targetCategoryId, data.message, messageId)
        }
      } else if (data.type === "claude_context_collected" && categoryId) {
        // Project context collected
        setIsProcessing(false)
        stopThinkingBeat()
        setProjectContext(categoryId, data.context)
        const shortContext = data.context.length > 200 ? data.context.slice(0, 200) + "..." : data.context
        const messageId = crypto.randomUUID()
        const message: Message = { id: messageId, role: "assistant", text: `Context collected:\n\n${shortContext}`, source: "claude" }
        addMessage(categoryId, message)
        setCategoryStatus(categoryId, "speaking")
        playTTS(categoryId, "I've learned about this project. You can now ask me questions about it.", messageId)
      } else if (data.type === "claude_plan" && categoryId) {
        setIsProcessing(false)
        stopThinkingBeat()
        dispatch({ type: "SET_CLAUDE_TASK", payload: { id: data.taskId, plan: data.plan } })
        setAI(categoryId, "claude")

        const messageId = crypto.randomUUID()
        const displayText = `Claude's plan: ${data.plan}\n\nSay "accept" or "cancel".`
        const message: Message = { id: messageId, role: "assistant", text: displayText, source: "claude" }
        addMessage(categoryId, message)

        const shortPlan = data.plan.length > 300 ? data.plan.slice(0, 300) + "..." : data.plan
        playTTS(categoryId, `Here's my plan: ${shortPlan}. Do you want me to proceed?`, messageId)
      } else if (data.type === "claude_running" && categoryId) {
        setIsProcessing(false)
        const messageId = addLocalResponse(categoryId, "Task started. I'll let you know when it's done.", "claude")
        playTTS(categoryId, "Task started. I'll let you know when it's done.", messageId)
      } else if (data.type === "claude_complete" && categoryId) {
        setIsProcessing(false)
        const resultText = data.result || "Task completed."
        const shortResult = resultText.length > 200 ? resultText.slice(0, 200) + "..." : resultText

        const messageId = addLocalResponse(categoryId, `Claude completed: ${resultText}`, "claude")
        setCategoryStatus(categoryId, "ready")
        playTTS(categoryId, `Task complete. ${shortResult}`, messageId)
      } else if (data.type === "claude_denied" && categoryId) {
        setIsProcessing(false)
        const messageId = addLocalResponse(categoryId, "Task cancelled.", "claude")
        playTTS(categoryId, "Task cancelled.", messageId)
      } else if (data.type === "claude_error" && categoryId) {
        setIsProcessing(false)
        const errorText = data.error || "An error occurred."
        const messageId = addLocalResponse(categoryId, `Claude error: ${errorText}`, "claude")
        playTTS(categoryId, `Sorry, there was an error: ${errorText}`, messageId)
      } else if (data.type === "action_result") {
        // LLM intent detection result
        const targetCategoryId = data.categoryId || categoryId

        if (!data.isAction) {
          // Not an app action - route to regular local LLM
          // Note: isProcessing stays true until local_response comes back
          wsRef.current?.send(JSON.stringify({
            type: "local_request",
            containerId: targetCategoryId,
            text: data.text,
          }))
          return
        }

        // Handle app action
        setIsProcessing(false)
        stopThinkingBeat()
        const result = data.result

        if (result.action_type === "create_category" && targetCategoryId) {
          // Create category action
          const messageId = addLocalResponse(targetCategoryId, result.message, "local")
          playTTS(targetCategoryId, result.message, messageId)

          // Create the category using AppContext
          if (result.category_name) {
            createCategory(result.category_name)
          }

          if (result.navigate_to) {
            navigateToView("management")
            setNavigationRequest("management")
          }
        } else if (result.action_type === "link_directory" && targetCategoryId) {
          // Link directory action - integrate with AppContext
          const messageId = addLocalResponse(targetCategoryId, result.message, "local")
          playTTS(targetCategoryId, result.message, messageId)

          // Set directory path using AppContext
          if (result.directory_path) {
            setDirectoryPath(targetCategoryId, result.directory_path)
          }
        } else if (result.action_type === "navigate_category" && targetCategoryId) {
          // Navigate to category
          const messageId = addLocalResponse(targetCategoryId, result.message, "local")
          playTTS(targetCategoryId, result.message, messageId)

          // If a category was specified, select it
          if (result.category_id) {
            selectCategory(result.category_id)
          }
          navigateToView("list")
          setNavigationRequest("list")
        } else if ((result.action_type === "find_directory" || result.action_type === "list_directories") && targetCategoryId) {
          // Directory search results
          let response = result.message
          if (result.directory_matches?.length) {
            const names = result.directory_matches.slice(0, 3).map((m: { name: string }) => m.name).join(", ")
            response = `${result.message}: ${names}`
          }
          const messageId = addLocalResponse(targetCategoryId, response, "local")
          playTTS(targetCategoryId, response, messageId)
        } else if (targetCategoryId) {
          // Unknown action type - just announce
          const messageId = addLocalResponse(targetCategoryId, result.message || "Action completed.", "local")
          playTTS(targetCategoryId, result.message || "Done.", messageId)
        }
      }
    }

    ws.onerror = () => {
      setError("WebSocket connection failed. Is the backend running?")
      setGlobalStatus("idle")
      setIsConnected(false)
      setIsProcessing(false)
    }

    ws.onclose = () => {
      console.log("WebSocket closed, reconnecting...")
      setIsConnected(false)
      setIsProcessing(false)
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
    getCategoryById,
    setAI,
    addMessage,
    setCategoryStatus,
    setProjectContext,
    createCategory,
    setDirectoryPath,
    selectCategory,
    navigateToView,
    sendClaudePlanRequest,
  ])

  const start = useCallback(async () => {
    if (!window.vad) {
      setError("VAD not loaded. Please refresh the page.")
      return
    }

    // Stop any playing TTS immediately when user taps to listen
    stopAudio()

    // Enable toggle/listening mode
    listeningModeRef.current = true
    setListeningMode(true)

    setIsLoading(true)
    console.log("Starting voice chat (toggle mode)...")

    try {
      connectWebSocket()

      const myvad = await window.vad.MicVAD.new({
        onSpeechStart: () => {
          console.log("Speech started")
          stopAudio()

          // Cancel pending buffer timeout when new speech starts
          if (bufferTimeoutRef.current) {
            clearTimeout(bufferTimeoutRef.current)
            bufferTimeoutRef.current = null
          }
        },
        onSpeechEnd: (audio) => {
          console.log("Speech ended, buffering (manual send mode)...")

          const catId = selectedCategoryIdRef.current
          const isFirstSegment = speechBufferRef.current.length === 0

          // Add audio to buffer
          speechBufferRef.current.push(audio)
          setHasBufferedSpeech(true)

          // Add pending message if we have a category, otherwise just buffer
          // (global mode will handle transcription for category creation)
          if (isFirstSegment && catId) {
            const message: Message = { id: crypto.randomUUID(), role: "user", text: "..." }
            addMessage(catId, message)
          }
          // Stay in listening state - user will click stop to send
          setGlobalStatus("listening")
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
  }, [connectWebSocket, startThinkingBeat, stopAudio, addMessage, processBufferedSpeech])

  const stop = useCallback(() => {
    console.log("Stopping voice chat and sending...")

    // Disable listening mode
    listeningModeRef.current = false
    setListeningMode(false)

    // Stop VAD
    vadRef.current?.pause()
    vadRef.current?.destroy()
    vadRef.current = null

    // Clear any pending buffer timeout
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current)
      bufferTimeoutRef.current = null
    }

    // Process buffered speech if any exists
    if (speechBufferRef.current.length > 0) {
      setGlobalStatus("processing")
      startThinkingBeat()
      processBufferedSpeech()
    } else {
      // No speech to process - just go idle
      setGlobalStatus("idle")
    }
    // Do NOT close WebSocket - actions continue
  }, [processBufferedSpeech, startThinkingBeat])

  // Process current buffer immediately without exiting listening mode
  const processNow = useCallback(() => {
    console.log("Processing speech buffer now...")

    // Clear any pending buffer timeout
    if (bufferTimeoutRef.current) {
      clearTimeout(bufferTimeoutRef.current)
      bufferTimeoutRef.current = null
    }

    // Process whatever is in the buffer
    processBufferedSpeech()
  }, [processBufferedSpeech])

  // Send text message (simulates transcription flow for typed input)
  const sendText = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return

    // Ensure WebSocket is connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      connectWebSocket()
    }

    const categoryId = selectedCategoryIdRef.current
    const category = getCategoryById(categoryId)

    if (!categoryId) return

    // Add user message to UI
    const userMessageId = crypto.randomUUID()
    const userMessage: Message = { id: userMessageId, role: "user", text: trimmed }
    addMessage(categoryId, userMessage)

    // Check for voice commands
    const command = parseVoiceCommand(trimmed)
    if (command) {
      const handled = handleVoiceCommand(command, categoryId)
      if (handled) return
    }

    // Check for Claude direct address
    const claudeAddress = parseClaudeDirectAddress(trimmed)
    if (claudeAddress) {
      startThinkingBeat()
      setAI(categoryId, "claude")
      sendClaudeChat(categoryId, claudeAddress.prompt)
      return
    }

    // Handle Claude mode exit
    if (category?.activeAI === "claude" && isClaudeExitCommand(trimmed)) {
      setAI(categoryId, "gemini")
      const messageId = addLocalResponse(categoryId, "Switched back to Gemini.", "gemini")
      playTTS(categoryId, "Switched back to Gemini.", messageId)
      return
    }

    // Start processing
    setGlobalStatus("processing")
    setCategoryStatus(categoryId, "processing")
    startThinkingBeat()

    // Route to appropriate AI
    if (category?.activeAI === "local") {
      wsRef.current?.send(JSON.stringify({
        type: "local_request",
        containerId: categoryId,
        text: trimmed,
      }))
    } else if (category?.activeAI === "claude") {
      // Check if action request
      const actionWords = ["create", "make", "write", "fix", "run", "delete", "update", "add", "remove", "install", "build", "edit", "change", "modify"]
      const lowerText = trimmed.toLowerCase()
      const isActionRequest = actionWords.some((word) => lowerText.includes(word))

      if (isActionRequest) {
        sendClaudePlanRequest(categoryId, trimmed)
      } else {
        const context = category.messages
          .slice(-6)
          .map((m: Message) => `${m.role === "user" ? "User" : "Claude"}: ${m.text}`)
          .join("\n")
        sendClaudeChat(categoryId, trimmed, context)
      }
    } else {
      // Gemini
      wsRef.current?.send(JSON.stringify({
        type: "gemini_request",
        containerId: categoryId,
        text: trimmed,
      }))
    }
  }, [
    connectWebSocket,
    getCategoryById,
    addMessage,
    handleVoiceCommand,
    startThinkingBeat,
    addLocalResponse,
    playTTS,
    sendClaudeChat,
    sendClaudePlanRequest,
    setAI,
    setCategoryStatus,
  ])

  // Auto-connect WebSocket on mount so isConnected is true before user interaction
  useEffect(() => {
    connectWebSocket()
  }, [connectWebSocket])

  useEffect(() => {
    return () => {
      thinkingAudioRef.current?.stop()
      wsRef.current?.close()
      vadRef.current?.destroy()
      if (bufferTimeoutRef.current) {
        clearTimeout(bufferTimeoutRef.current)
      }
    }
  }, [])

  return {
    globalStatus,
    isConnected,
    isLoading,
    error,
    listeningMode,
    hasBufferedSpeech,
    isProcessing,
    navigationRequest,
    clearNavigationRequest,
    start,
    stop,
    stopAudio,
    processNow,
    sendClaudeConfirm,
    sendClaudeDeny,
    saveChat,
    playTTS,
    sendText,
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
