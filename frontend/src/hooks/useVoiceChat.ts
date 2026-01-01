import { useState, useEffect, useRef, useCallback } from "react"

export type Status = "idle" | "listening" | "processing" | "speaking"

export interface Message {
  id: string
  role: "user" | "assistant"
  text: string
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

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<Awaited<ReturnType<typeof window.vad.MicVAD.new>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const thinkingAudioRef = useRef<{ stop: () => void; pitchUp: () => void } | null>(null)
  const ttsRequestIdRef = useRef(0)
  const skipNextResponseRef = useRef(false)

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
      const response = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      // Check if this request is still the latest
      if (thisRequestId !== ttsRequestIdRef.current) {
        console.log("TTS request cancelled - newer request pending")
        return
      }

      if (!response.ok) {
        throw new Error("TTS request failed")
      }

      const audioBlob = await response.blob()

      // Check again after blob download
      if (thisRequestId !== ttsRequestIdRef.current) {
        console.log("TTS request cancelled - newer request pending")
        return
      }

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

      // Stop thinking beat just before audio plays
      stopThinkingBeat()
      await audio.play()
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
            { id: crypto.randomUUID(), role: "assistant", text: "Chat saved." },
          ])
          setStatus("listening")
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
          { id: messageId, role: "assistant", text: data.text },
        ])
        playTTS(data.text, messageId)
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
  }, [playTTS, saveChat, stopThinkingBeat])

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
