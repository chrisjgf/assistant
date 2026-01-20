import { useState, useCallback, useEffect } from "react"
import { AppProvider, useApp } from "./context/AppContext"
import { ModeToggle } from "./components/ModeToggle"
import { CategoryList } from "./components/CategoryList"
import { CategoryDetail } from "./components/CategoryDetail"
import { CategoryManagement } from "./components/CategoryManagement"
import { VoiceButton } from "./components/VoiceButton"
import { TTSPage } from "./components/TTSPage"
import { ContainerProvider } from "./context/ContainerContext"
import { useContainers } from "./hooks/useContainers"
import { useSharedVoice } from "./hooks/useSharedVoice"
import { ChatView } from "./components/ChatView"
import { StatusIndicator } from "./components/StatusIndicator"
import { ContainerTabs } from "./components/ContainerTabs"
import type { Task } from "./types"

function TodoBrainContent() {
  const { selectedCategory, activeMode, currentView, navigateToView, selectCategory } = useApp()
  const {
    isConnected,
    isLoading,
    start,
    stop,
    globalStatus,
    listeningMode,
    navigationRequest,
    clearNavigationRequest,
    hasBufferedSpeech,
    isProcessing,
  } = useSharedVoice()

  const handleTaskAction = useCallback((task: Task, categoryId: string) => {
    // TODO: Send task to Claude for execution
    console.log("Task action:", task.text, "in category:", categoryId)
  }, [])

  // Handle navigation requests from voice commands
  useEffect(() => {
    if (navigationRequest) {
      navigateToView(navigationRequest)
      clearNavigationRequest()
    }
  }, [navigationRequest, navigateToView, clearNavigationRequest])

  const handleCloseManagement = useCallback(() => {
    navigateToView(selectedCategory ? "chat" : "list")
  }, [navigateToView, selectedCategory])

  const handleSelectCategoryFromManagement = useCallback((id: string) => {
    selectCategory(id)
    navigateToView("chat")
  }, [selectCategory, navigateToView])

  // Render content based on current view
  const renderContent = () => {
    if (currentView === "management") {
      return (
        <CategoryManagement
          onClose={handleCloseManagement}
          onSelectCategory={handleSelectCategoryFromManagement}
        />
      )
    }

    if (selectedCategory) {
      return <CategoryDetail onTaskAction={handleTaskAction} />
    }

    return <CategoryList />
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="app__header">
        <h1 className="app__title">
          {activeMode === "todo" ? "Todo" : "Brain"}
        </h1>
        <div className="app__header-right">
          <span className="app__status">{globalStatus}</span>
          <ModeToggle />
        </div>
      </header>

      {/* Main Content */}
      <main className="app__main">
        {renderContent()}
      </main>

      {/* Footer with Voice Button */}
      <footer className="app__footer">
        <VoiceButton
          onStart={start}
          onStop={stop}
          isConnected={isConnected}
          isLoading={isLoading}
          isActive={listeningMode}
          hasBufferedSpeech={hasBufferedSpeech}
          isProcessing={isProcessing}
        />
      </footer>
    </div>
  )
}

function TodoBrainApp() {
  // Wrap with both contexts: AppProvider for new UI, ContainerProvider for voice
  return (
    <ContainerProvider>
      <AppProvider>
        <TodoBrainContent />
      </AppProvider>
    </ContainerProvider>
  )
}

function App() {
  const path = window.location.pathname

  if (path === "/tts") {
    return <TTSPage />
  }

  // Legacy voice assistant route
  if (path === "/voice") {
    // Import dynamically to avoid loading old context when not needed
    return <LegacyVoiceAssistant />
  }

  return <TodoBrainApp />
}

// Keep legacy voice assistant accessible at /voice
function LegacyVoiceAssistant() {
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
      sendText,
      listeningMode,
    } = useSharedVoice()

    const [textInput, setTextInput] = useState("")
    const [showTextInput, setShowTextInput] = useState(false)

    const handleTextSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      if (textInput.trim()) {
        sendText(textInput)
        setTextInput("")
      }
    }

    const isActive = listeningMode

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
        <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold text-white">Voice Assistant (Legacy)</h1>
            <a href="/" className="text-blue-400 hover:text-blue-300 text-sm">
              New UI
            </a>
            <a href="/tts" className="text-blue-400 hover:text-blue-300 text-sm">
              TTS Only
            </a>
          </div>
          <StatusIndicator status={globalStatus} activeAI={activeContainer.activeAI} />
        </header>

        <ContainerTabs
          containers={containers}
          activeId={activeContainerId}
          onSelect={switchToContainer}
          onCreate={handleCreateContainer}
          onClose={deleteContainer}
        />

        <ChatView
          messages={activeContainer.messages}
          speakingId={activeContainer.speakingId}
          onSpeak={handleSpeak}
          onStopSpeak={stopAudio}
        />

        <footer className="bg-gray-800 border-t border-gray-700 p-4">
          {error && (
            <p className="text-red-400 text-sm mb-2 text-center">{error}</p>
          )}

          {showTextInput ? (
            <form onSubmit={handleTextSubmit} className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowTextInput(false)}
                className="p-2 text-gray-400 hover:text-white transition-colors"
                title="Switch to voice"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                  <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z" />
                </svg>
              </button>
              <input
                type="text"
                value={textInput}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTextInput(e.target.value)}
                placeholder="Type a message..."
                autoFocus
                className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={!textInput.trim()}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </form>
          ) : (
            <div className="flex justify-center gap-3">
              <button
                onClick={isActive ? stop : start}
                disabled={isLoading}
                className={`px-6 py-3 rounded-full font-medium transition-colors disabled:opacity-50 ${
                  isActive
                    ? "bg-green-500 hover:bg-green-600 text-white"
                    : "bg-blue-500 hover:bg-blue-600 text-white"
                }`}
              >
                {isLoading ? "Loading..." : isActive ? "Send" : "Start Listening"}
              </button>
              <button
                onClick={() => setShowTextInput(true)}
                className="p-3 bg-gray-700 hover:bg-gray-600 text-white rounded-full transition-colors"
                title="Type a message"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z" />
                </svg>
              </button>
            </div>
          )}
        </footer>
      </div>
    )
  }

  return (
    <ContainerProvider>
      <VoiceAssistantContent />
    </ContainerProvider>
  )
}

export default App
