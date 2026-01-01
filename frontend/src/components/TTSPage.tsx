import { useState, useRef, useCallback } from "react"

const httpProtocol = window.location.protocol === "https:" ? "https:" : "http:"
const API_URL = `${httpProtocol}//${window.location.hostname}:8000`

export function TTSPage() {
  const [text, setText] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null)

  const stopAudio = useCallback(() => {
    if (currentSourceRef.current) {
      currentSourceRef.current.stop()
      currentSourceRef.current = null
    }
    setIsPlaying(false)
  }, [])

  const generate = useCallback(async () => {
    if (!text.trim()) return

    stopAudio()
    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/tts/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`)
      }

      const contentType = response.headers.get("content-type") || ""

      // Single WAV response
      if (contentType.includes("audio/wav")) {
        const audioBlob = await response.blob()
        const audioUrl = URL.createObjectURL(audioBlob)
        const audio = new Audio(audioUrl)

        audio.onended = () => {
          setIsPlaying(false)
          URL.revokeObjectURL(audioUrl)
        }
        audio.onerror = () => {
          setIsPlaying(false)
          setError("Audio playback failed")
        }

        setIsGenerating(false)
        setIsPlaying(true)
        await audio.play()
        return
      }

      // Chunked response
      const reader = response.body?.getReader()
      if (!reader) throw new Error("No response body")

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const audioQueue: AudioBuffer[] = []
      let isPlayingChunks = false
      let readerDone = false
      let buffer = new Uint8Array(0)

      const checkComplete = () => {
        if (readerDone && audioQueue.length === 0 && !isPlayingChunks) {
          setIsPlaying(false)
          audioContext.close()
          audioContextRef.current = null
        }
      }

      const playNext = () => {
        if (audioQueue.length === 0) {
          isPlayingChunks = false
          checkComplete()
          return
        }
        isPlayingChunks = true
        const audioBuffer = audioQueue.shift()!
        const source = audioContext.createBufferSource()
        source.buffer = audioBuffer
        source.connect(audioContext.destination)
        source.onended = playNext
        currentSourceRef.current = source
        source.start()
      }

      while (true) {
        const { done, value } = await reader.read()

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

            if (!isPlayingChunks) {
              setIsGenerating(false)
              setIsPlaying(true)
              playNext()
            }
          } catch (decodeErr) {
            console.warn("Failed to decode audio chunk:", decodeErr)
          }
        }
      }

      setIsGenerating(false)
    } catch (err) {
      console.error("TTS error:", err)
      setError(err instanceof Error ? err.message : "TTS failed")
      setIsGenerating(false)
    }
  }, [text, stopAudio])

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Text to Speech</h1>
        <a href="/" className="text-blue-500 hover:text-blue-600 text-sm">
          Back to Voice Assistant
        </a>
      </header>

      <main className="flex-1 p-4 flex flex-col gap-4 max-w-2xl mx-auto w-full">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter text to synthesize..."
          className="flex-1 min-h-[200px] p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />

        {error && (
          <p className="text-red-500 text-sm text-center">{error}</p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={generate}
            disabled={isGenerating || !text.trim()}
            className="px-6 py-3 rounded-full font-medium transition-colors disabled:opacity-50 bg-blue-500 hover:bg-blue-600 text-white"
          >
            {isGenerating ? "Generating..." : "Generate Speech"}
          </button>

          {isPlaying && (
            <button
              onClick={stopAudio}
              className="px-6 py-3 rounded-full font-medium transition-colors bg-red-500 hover:bg-red-600 text-white"
            >
              Stop
            </button>
          )}
        </div>

        <div className="text-center text-sm text-gray-500">
          {isPlaying && "Playing..."}
        </div>
      </main>
    </div>
  )
}
