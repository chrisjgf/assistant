import type { Message } from "../context/ContainerContext"

interface ChatViewProps {
  messages: Message[]
  speakingId: string | null
  onSpeak: (text: string, messageId: string) => void
  onStopSpeak: () => void
}

function SpeakerIcon({ speaking }: { speaking: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={`w-4 h-4 ${speaking ? "animate-pulse" : ""}`}
    >
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
      <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
    </svg>
  )
}

export function ChatView({ messages, speakingId, onSpeak, onStopSpeak }: ChatViewProps) {
  const handleSpeak = (message: Message) => {
    if (speakingId === message.id) {
      onStopSpeak()
    } else {
      onSpeak(message.text, message.id)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="text-center text-gray-500 mt-8">
          <p>Start speaking to begin a conversation</p>
        </div>
      )}

      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex ${
            message.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2 ${
              message.role === "user"
                ? "bg-blue-500 text-white"
                : "bg-gray-200 text-gray-900"
            }`}
          >
            {message.role === "assistant" && message.source && (
              <span
                className={`inline-block text-xs px-2 py-0.5 rounded-full mb-1 ${
                  message.source === "claude"
                    ? "bg-orange-100 text-orange-700"
                    : message.source === "local"
                    ? "bg-green-100 text-green-700"
                    : "bg-blue-100 text-blue-700"
                }`}
              >
                {message.source === "claude" ? "Claude" : message.source === "local" ? "Local" : "Gemini"}
              </span>
            )}
            <div className="flex items-start gap-2">
              <p className="text-sm whitespace-pre-wrap flex-1">{message.text}</p>
              <button
                onClick={() => handleSpeak(message)}
                className={`flex-shrink-0 p-1 rounded hover:bg-black/10 transition-colors ${
                  speakingId === message.id
                    ? "opacity-100"
                    : "opacity-60 hover:opacity-100"
                }`}
                title={speakingId === message.id ? "Stop" : "Speak"}
              >
                <SpeakerIcon speaking={speakingId === message.id} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
