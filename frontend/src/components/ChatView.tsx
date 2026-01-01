import type { Message } from "../hooks/useVoiceChat"

interface ChatViewProps {
  messages: Message[]
}

export function ChatView({ messages }: ChatViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
            <p className="text-sm whitespace-pre-wrap">{message.text}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
