import { useEffect, useRef, useCallback, useState } from "react"

interface VoiceButtonProps {
  onStart: () => void
  onStop: () => void
  isConnected: boolean
  isLoading: boolean
  isActive?: boolean // External control of active state (listening mode enabled)
  hasBufferedSpeech?: boolean // True when speech has been captured
  isProcessing?: boolean // True when processing request
  disabled?: boolean
  compact?: boolean // Compact mode for inline use (icon only)
  className?: string
}

export function VoiceButton({
  onStart,
  onStop,
  isConnected,
  isLoading,
  isActive: externalIsActive,
  hasBufferedSpeech = false,
  isProcessing = false,
  disabled = false,
  compact = false,
  className = "",
}: VoiceButtonProps) {
  // Use external isActive if provided, otherwise maintain internal state
  const [internalIsActive, setInternalIsActive] = useState(false)
  const isActive = externalIsActive !== undefined ? externalIsActive : internalIsActive

  const [elapsedTime, setElapsedTime] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  // Start the timer
  const startTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    setElapsedTime(0)

    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [])

  // Stop the timer
  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setElapsedTime(0)
  }, [])

  // Sync timer with external isActive state
  useEffect(() => {
    if (externalIsActive !== undefined) {
      if (externalIsActive && !timerRef.current) {
        startTimer()
      } else if (!externalIsActive && timerRef.current) {
        stopTimer()
      }
    }
  }, [externalIsActive, startTimer, stopTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  const handleClick = () => {
    if (disabled || isLoading || isProcessing) return

    if (isActive) {
      // Block stop if no speech has been buffered yet (BUG-002 fix)
      if (!hasBufferedSpeech) {
        console.log("No speech buffered yet, ignoring stop")
        return
      }
      // Stop
      if (externalIsActive === undefined) {
        setInternalIsActive(false)
        stopTimer()
      }
      onStop()
    } else {
      // Start
      if (externalIsActive === undefined) {
        setInternalIsActive(true)
        startTimer()
      }
      onStart()
    }
  }

  // Format elapsed time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  // Determine button state using explicit conditions for clarity
  const buttonState = (() => {
    if (!isConnected) return "disconnected"
    if (isLoading) return "loading"
    if (isProcessing) return "processing"
    if (isActive) return "recording"
    return "idle"
  })() as "idle" | "recording" | "loading" | "disconnected" | "processing"

  // Processing spinner SVG
  const ProcessingSpinner = () => (
    <svg viewBox="0 0 24 24" fill="none" width="24" height="24" className="voice-button__spinner">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )

  // Render icon based on state
  const renderIcon = () => {
    if (buttonState === "processing") {
      return <ProcessingSpinner />
    }
    if (isActive && hasBufferedSpeech) {
      // Send icon when active with speech buffered
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      )
    }
    // Microphone icon when idle or listening without speech
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
      </svg>
    )
  }

  // Label for non-compact mode
  const label = (() => {
    if (compact) return null

    const labels: Record<string, string | null> = {
      disconnected: "Disconnected",
      loading: "Connecting...",
      processing: "Processing...",
      recording: formatTime(elapsedTime),
      idle: null,
    }
    return labels[buttonState] ?? null
  })()

  return (
    <div className={`voice-controls ${compact ? "voice-controls--compact" : ""} ${className}`}>
      <button
        className={`voice-button voice-button--${buttonState}${compact ? " voice-button--compact" : ""}`}
        onClick={handleClick}
        disabled={disabled || !isConnected || isLoading || isProcessing}
        aria-label={isActive ? "Stop and send" : "Start listening"}
      >
        <div className="voice-button__icon">
          {renderIcon()}
        </div>
        {label && <span className="voice-button__label">{label}</span>}
        {isActive && !isProcessing && (
          <div className="voice-button__pulse" />
        )}
      </button>
    </div>
  )
}
