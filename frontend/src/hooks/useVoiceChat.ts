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

const WS_URL = "ws://localhost:8000/ws"
const API_URL = "http://localhost:8000"

export function useVoiceChat() {
  const [status, setStatus] = useState<Status>("idle")
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const vadRef = useRef<Awaited<ReturnType<typeof window.vad.MicVAD.new>> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    window.speechSynthesis.cancel()
    setSpeakingId(null)
  }, [])

  const playTTS = useCallback(async (text: string, messageId: string) => {
    stopAudio()
    setStatus("speaking")
    setSpeakingId(messageId)

    try {
      const response = await fetch(`${API_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      if (!response.ok) {
        throw new Error("TTS request failed")
      }

      const audioBlob = await response.blob()
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

      await audio.play()
    } catch (err) {
      console.warn("TTS failed, using browser TTS:", err)
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.onend = () => {
        setSpeakingId(null)
        setStatus("listening")
      }
      window.speechSynthesis.speak(utterance)
    }
  }, [stopAudio])

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
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "user", text: data.text },
        ])
      } else if (data.type === "response") {
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
  }, [playTTS])

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

          setStatus("processing")
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
  }, [connectWebSocket])

  const stop = useCallback(() => {
    console.log("Stopping voice chat...")
    vadRef.current?.pause()
    vadRef.current?.destroy()
    vadRef.current = null
    wsRef.current?.close()
    setStatus("idle")
  }, [])

  useEffect(() => {
    return () => {
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
