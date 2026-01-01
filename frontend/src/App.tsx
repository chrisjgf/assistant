import { useVoiceChat } from "./hooks/useVoiceChat"
import { ChatView } from "./components/ChatView"
import { StatusIndicator } from "./components/StatusIndicator"

function App() {
  const { status, messages, error, isLoading, start, stop } = useVoiceChat()

  const isActive = status !== "idle"

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Voice Assistant</h1>
        <StatusIndicator status={status} />
      </header>

      <ChatView messages={messages} />

      <footer className="bg-white border-t border-gray-200 p-4">
        {error && (
          <p className="text-red-500 text-sm mb-2 text-center">{error}</p>
        )}

        <div className="flex justify-center">
          <button
            onClick={isActive ? stop : start}
            disabled={isLoading}
            className={`px-6 py-3 rounded-full font-medium transition-colors disabled:opacity-50 ${
              isActive
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            }`}
          >
            {isLoading ? "Loading..." : isActive ? "Stop" : "Start Listening"}
          </button>
        </div>
      </footer>
    </div>
  )
}

export default App
