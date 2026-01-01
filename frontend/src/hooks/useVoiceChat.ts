import { useState, useEffect, useRef, useCallback } from "react"

export type Status = "idle" | "listening" | "processing" | "speaking"

export interface Message {
  id: string
  role: "user" | "assistant"
  text: string
  source?: "gemini" | "claude"
}

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

const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
const httpProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
const WS_URL = `${wsProtocol}//${window.location.hostname}:8000/ws`
const API_URL = `${httpProtocol}//${window.location.hostname}:8000`

export function useVoiceChat() {
  const [status, setStatus] = useState<Status>("idle")
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [activeAI, setActiveAIState] = useState<"gemini" | "claude">("gemini")

  // Helper to update both state and ref
  const setActiveAI = useCallback((ai: "gemini" | "claude") => {
    activeAIRef.current = ai
    setActiveAIState(ai)
  }, [])

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<Awaited<ReturnType<typeof window.vad.MicVAD.new>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const thinkingAudioRef = useRef<{ stop: () => void; pitchUp: () => void } | null>(null)
  const ttsRequestIdRef = useRef(0)
  const skipNextResponseRef = useRef(false)
  const aiDisabledRef = useRef(false)
  const claudeTaskRef = useRef<{ id: string; plan: string } | null>(null)
  const activeAIRef = useRef<"gemini" | "claude">("gemini")

  // Create a soft rhythmic thinking beat using Web Audio API
  const startThinkingBeat = useCallback(() => {
    if (thinkingAudioRef.current) return

    const audioContext = new AudioContext()
    const gainNode = audioContext.createGain()
    gainNode.gain.value = 0.15 // Soft volume
    gainNode.connect(audioContext.destination)

    let isPlaying = true
    let frequency = 220 // A3 note - soft tone (initial pitch)

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

      // Schedule next beat (600ms interval for gentle rhythm)
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
        frequency = 330 // E4 note - higher pitch for "generating voice"
      }
    }
  }, [])

  const stopThinkingBeat = useCallback(() => {
    thinkingAudioRef.current?.stop()
  }, [])

  const stopAudio = useCallback(() => {
    stopThinkingBeat()
    ttsRequestIdRef.current++ // Cancel any pending TTS
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.speechSynthesis.cancel()
    setSpeakingId(null)
  }, [stopThinkingBeat])

  const playTTS = useCallback(async (text: string, messageId: string) => {
    // Cancel any previous TTS but keep thinking beat running
    ttsRequestIdRef.current++
    const thisRequestId = ttsRequestIdRef.current

    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.speechSynthesis.cancel()

    setStatus("speaking")
    setSpeakingId(messageId)

    try {
      const response = await fetch(`${API_URL}/tts/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      if (thisRequestId !== ttsRequestIdRef.current) {
        console.log("TTS request cancelled - newer request pending")
        return
      }

      if (!response.ok) {
        throw new Error("TTS request failed")
      }

      // Check if response is chunked (octet-stream) or single WAV
      const contentType = response.headers.get("content-type") || ""

      if (contentType.includes("audio/wav")) {
        // Single chunk - use simple audio playback
        const audioBlob = await response.blob()
        if (thisRequestId !== ttsRequestIdRef.current) return

        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)
        audioRef.current = audio

        audio.onended = () => {
          setSpeakingId(null)
          setStatus("listening")
          URL.revokeObjectURL(audioUrl)
        }
        audio.onerror = () => {
          setSpeakingId(null)
          setStatus("listening")
        }

        stopThinkingBeat()
        await audio.play()
        return
      }

      // Chunked response - read length-prefixed WAV chunks
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body")

      const audioContext = new AudioContext()
      const audioQueue: AudioBuffer[] = []
      let isPlaying = false
      let readerDone = false
      let buffer = new Uint8Array(0)

      const checkComplete = () => {
        if (readerDone && audioQueue.length === 0 && !isPlaying) {
          setSpeakingId(null)
          setStatus("listening")
          audioContext.close()
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

      // Read and process chunks
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

        // Append new data to buffer
        const newBuffer = new Uint8Array(buffer.length + value.length)
        newBuffer.set(buffer)
        newBuffer.set(value, buffer.length)
        buffer = newBuffer

        // Parse length-prefixed chunks from buffer
        while (buffer.length >= 4) {
          const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, false)

          if (buffer.length < 4 + length) break // Need more data

          // Extract WAV chunk
          const wavData = buffer.slice(4, 4 + length)
          buffer = buffer.slice(4 + length)

          try {
            const audioBuffer = await audioContext.decodeAudioData(wavData.buffer.slice(wavData.byteOffset, wavData.byteOffset + wavData.byteLength))
            audioQueue.push(audioBuffer)
            console.log(`Queued audio chunk: ${(audioBuffer.duration).toFixed(2)}s`)

            // Start playback on first chunk
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
        setSpeakingId(null)
        setStatus("listening")
      }
      window.speechSynthesis.speak(utterance)
    }
  }, [stopThinkingBeat])

  const saveChat = useCallback(() => {
    const chatData = {
      timestamp: new Date().toISOString(),
      messages: messages,
    }
    const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `chat-${new Date().toISOString().slice(0, 19).replace(/[:-]/g, "")}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    console.log("Chat saved")
  }, [messages])

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      console.log("WebSocket connected")
      setError(null)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.type === "transcription") {
        // Normalize text - remove punctuation for comparison
        const normalized = data.text.toLowerCase().trim().replace(/[.!?,]/g, "")

        // Commands to handle locally (isolated phrases only)
        const ignoredCommands = ["stop", "okay", "ok", "got it"]
        const saveChatCommands = ["save chat", "safe chat"]
        const disableCommands = ["disable", "disabled", "pause"]
        const enableCommands = ["start", "enable", "resume"]

        // Helper to update last pending message
        const updatePendingMessage = (text: string | null) => {
          setMessages((prev) => {
            // Find last user message with "..."
            const lastPendingIndex = prev.findLastIndex(
              (msg) => msg.role === "user" && msg.text === "..."
            )
            if (lastPendingIndex === -1) return prev

            if (text === null) {
              // Remove the pending message
              return prev.filter((_, i) => i !== lastPendingIndex)
            }
            // Update with actual text
            return prev.map((msg, i) =>
              i === lastPendingIndex ? { ...msg, text } : msg
            )
          })
        }

        // Handle save chat commands
        if (saveChatCommands.includes(normalized)) {
          stopThinkingBeat()
          saveChat()
          updatePendingMessage("Save chat")
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text: "Chat saved.", source: activeAIRef.current },
          ])
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Handle disable commands
        if (disableCommands.includes(normalized)) {
          stopThinkingBeat()
          aiDisabledRef.current = true
          updatePendingMessage("Disable")
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text: "AI disabled. Say 'start' to re-enable.", source: activeAIRef.current },
          ])
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Handle enable commands
        if (enableCommands.includes(normalized)) {
          stopThinkingBeat()
          aiDisabledRef.current = false
          updatePendingMessage("Start")
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", text: "AI enabled.", source: activeAIRef.current },
          ])
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Handle Claude mode exit commands
        if (activeAIRef.current === "claude") {
          // Exit if user says "exit" or mentions "gemini"
          if (normalized === "exit" || normalized.includes("gemini")) {
            stopThinkingBeat()
            setActiveAI("gemini")
            updatePendingMessage(data.text)
            const messageId = crypto.randomUUID()
            setMessages((prev) => [
              ...prev,
              { id: messageId, role: "assistant", text: "Switched back to Gemini.", source: "gemini" },
            ])
            playTTS("Switched back to Gemini.", messageId)
            setStatus("listening")
            skipNextResponseRef.current = true
            return
          }
        }

        // Handle accept/deny when Claude task is pending
        if (claudeTaskRef.current) {
          const acceptCommands = ["accept", "except", "yes", "approve", "do it", "go ahead", "go for it", "proceed"]
          const denyCommands = ["deny", "no", "cancel", "nevermind", "never mind"]

          if (acceptCommands.includes(normalized)) {
            stopThinkingBeat()
            updatePendingMessage("Accept")
            wsRef.current?.send(JSON.stringify({
              type: "claude_confirm",
              taskId: claudeTaskRef.current.id
            }))
            claudeTaskRef.current = null
            setStatus("listening")
            skipNextResponseRef.current = true
            return
          }

          if (denyCommands.includes(normalized)) {
            stopThinkingBeat()
            updatePendingMessage("Cancel")
            wsRef.current?.send(JSON.stringify({
              type: "claude_deny",
              taskId: claudeTaskRef.current.id
            }))
            claudeTaskRef.current = null
            setStatus("listening")
            skipNextResponseRef.current = true
            return
          }
        }

        // Handle "switch to <AI>" commands
        const switchMatch = data.text.match(/^switch\s+to\s+(claude|cloud|claw|clude|clawed|clode|gemini)/i)
        if (switchMatch) {
          const target = switchMatch[1].toLowerCase()
          const isGemini = target === "gemini"
          stopThinkingBeat()
          updatePendingMessage(data.text)
          setActiveAI(isGemini ? "gemini" : "claude")
          const messageId = crypto.randomUUID()
          const aiName = isGemini ? "Gemini" : "Claude"
          setMessages((prev) => [
            ...prev,
            { id: messageId, role: "assistant", text: `Switched to ${aiName}.`, source: isGemini ? "gemini" : "claude" },
          ])
          playTTS(`Switched to ${aiName}.`, messageId)
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Detect "Claude, ..." pattern (including common mishearings)
        const claudeMatch = data.text.match(/^(claude|cloud|claw|clude|clawed|clode)[,.]?\s+(.+)/i)
        if (claudeMatch) {
          stopThinkingBeat()
          updatePendingMessage(data.text)
          startThinkingBeat() // Restart for Claude processing
          setActiveAI("claude") // Enter Claude mode

          // Send to Claude instead of Gemini
          wsRef.current?.send(JSON.stringify({
            type: "claude_request",
            text: claudeMatch[2]
          }))
          skipNextResponseRef.current = true
          return
        }

        // In Claude mode, route all messages to Claude
        if (activeAIRef.current === "claude") {
          stopThinkingBeat()
          updatePendingMessage(data.text)
          startThinkingBeat()

          // Clear pending task since user is sending new message
          claudeTaskRef.current = null

          wsRef.current?.send(JSON.stringify({
            type: "claude_request",
            text: data.text
          }))
          skipNextResponseRef.current = true
          return
        }

        // Ignore these isolated commands entirely
        if (ignoredCommands.includes(normalized)) {
          console.log(`Ignored command: "${data.text}"`)
          stopThinkingBeat()
          updatePendingMessage(null)
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // If AI is disabled, show the message but don't process with AI
        if (aiDisabledRef.current) {
          console.log("AI disabled, skipping message:", data.text)
          stopThinkingBeat()
          updatePendingMessage(data.text)
          setStatus("listening")
          skipNextResponseRef.current = true
          return
        }

        // Update pending message with actual transcription
        updatePendingMessage(data.text)
      } else if (data.type === "response") {
        // Skip response if previous command was filtered
        if (skipNextResponseRef.current) {
          skipNextResponseRef.current = false
          console.log("Skipped AI response for filtered command")
          return
        }

        // Pitch up the beat - AI responded, now generating voice
        thinkingAudioRef.current?.pitchUp()

        const messageId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: data.text, source: "gemini" },
        ])
        playTTS(data.text, messageId)
      } else if (data.type === "claude_plan") {
        // Claude has a plan, waiting for accept/deny
        stopThinkingBeat()
        claudeTaskRef.current = { id: data.taskId, plan: data.plan }
        setActiveAI("claude")

        const messageId = crypto.randomUUID()
        const displayText = `Claude's plan: ${data.plan}\n\nSay "accept" or "cancel".`
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: displayText, source: "claude" },
        ])

        // Speak a shorter version
        const shortPlan = data.plan.length > 300 ? data.plan.slice(0, 300) + "..." : data.plan
        playTTS(`Here's my plan: ${shortPlan}. Do you want me to proceed?`, messageId)
      } else if (data.type === "claude_running") {
        const messageId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: "Task started. I'll let you know when it's done.", source: "claude" },
        ])
        playTTS("Task started. I'll let you know when it's done.", messageId)
      } else if (data.type === "claude_complete") {
        // Summarize long results for TTS
        const resultText = data.result || "Task completed."
        const shortResult = resultText.length > 200 ? resultText.slice(0, 200) + "..." : resultText

        const messageId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: `Claude completed: ${resultText}`, source: "claude" },
        ])
        playTTS(`Task complete. ${shortResult}`, messageId)
      } else if (data.type === "claude_denied") {
        const messageId = crypto.randomUUID()
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: "Task cancelled.", source: "claude" },
        ])
        playTTS("Task cancelled.", messageId)
      } else if (data.type === "claude_error") {
        const messageId = crypto.randomUUID()
        const errorText = data.error || "An error occurred."
        setMessages((prev) => [
          ...prev,
          { id: messageId, role: "assistant", text: `Claude error: ${errorText}`, source: "claude" },
        ])
        playTTS(`Sorry, there was an error: ${errorText}`, messageId)
      }
    }

    ws.onerror = () => {
      setError("WebSocket connection failed. Is the backend running?")
      setStatus("idle")
    }

    ws.onclose = () => {
      console.log("WebSocket closed, reconnecting...")
      setTimeout(connectWebSocket, 3000)
    }

    wsRef.current = ws
  }, [playTTS, saveChat, setActiveAI, startThinkingBeat, stopThinkingBeat])

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

          // Add pending user message immediately
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "user", text: "..." },
          ])

          setStatus("processing")
          startThinkingBeat()
          const wavBuffer = encodeWAV(audio, 16000)
          wsRef.current.send(wavBuffer)
        },
        onVADMisfire: () => {
          console.log("VAD misfire (too short)")
        },
      })

      vadRef.current = myvad
      await myvad.start()
      setStatus("listening")
      setIsLoading(false)
    } catch (err) {
      console.error("VAD error:", err)
      setError(`VAD error: ${err instanceof Error ? err.message : String(err)}`)
      setIsLoading(false)
    }
  }, [connectWebSocket, startThinkingBeat, stopAudio])

  const stop = useCallback(() => {
    console.log("Stopping voice chat...")
    stopThinkingBeat()
    vadRef.current?.pause()
    vadRef.current?.destroy()
    vadRef.current = null
    wsRef.current?.close()
    setStatus("idle")
  }, [stopThinkingBeat])

  useEffect(() => {
    return () => {
      thinkingAudioRef.current?.stop()
      wsRef.current?.close()
      vadRef.current?.destroy()
    }
  }, [])

  return {
    status,
    messages,
    error,
    isLoading,
    isListening: status === "listening",
    isSpeaking: status === "speaking",
    speakingId,
    activeAI,
    start,
    stop,
    stopAudio,
    playTTS,
    saveChat,
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
