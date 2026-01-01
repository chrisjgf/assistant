import { ContainerProvider } from "./context/ContainerContext"
import { useContainers } from "./hooks/useContainers"
import { useSharedVoice } from "./hooks/useSharedVoice"
import { ChatView } from "./components/ChatView"
import { StatusIndicator } from "./components/StatusIndicator"
import { ContainerTabs } from "./components/ContainerTabs"
import { TTSPage } from "./components/TTSPage"

function VoiceAssistantContent() {
  const {
    containers,
    activeContainerId,
    activeContainer,
    createContainer,
    switchToContainer,
    deleteContainer,
  } = useContainers()

  const {
    globalStatus,
    isLoading,
    error,
    start,
    stop,
    stopAudio,
    playTTS,
  } = useSharedVoice()

  const isActive = globalStatus !== "idle"

  const handleSpeak = (text: string, messageId: string) => {
    playTTS(activeContainerId, text, messageId)
  }

  const handleCreateContainer = () => {
    const newId = createContainer({ inheritAI: activeContainer.activeAI })
    if (newId) {
      switchToContainer(newId)
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-white">Voice Assistant</h1>
          <a href="/tts" className="text-blue-400 hover:text-blue-300 text-sm">
            TTS Only
          </a>
        </div>
        <StatusIndicator status={globalStatus} activeAI={activeContainer.activeAI} />
      </header>

      {/* Container Tabs */}
      <ContainerTabs
        containers={containers}
        activeId={activeContainerId}
        onSelect={switchToContainer}
        onCreate={handleCreateContainer}
        onClose={deleteContainer}
      />

      {/* Chat View for active container */}
      <ChatView
        messages={activeContainer.messages}
        speakingId={activeContainer.speakingId}
        onSpeak={handleSpeak}
        onStopSpeak={stopAudio}
      />

      {/* Footer */}
      <footer className="bg-gray-800 border-t border-gray-700 p-4">
        {error && (
          <p className="text-red-400 text-sm mb-2 text-center">{error}</p>
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

function VoiceAssistant() {
  return (
    <ContainerProvider>
      <VoiceAssistantContent />
    </ContainerProvider>
  )
}

function App() {
  const path = window.location.pathname

  if (path === "/tts") {
    return <TTSPage />
  }

  return <VoiceAssistant />
}

export default App
