import { useApp } from "../context/AppContext"
import type { Mode } from "../types"

interface ModeToggleProps {
  className?: string
}

export function ModeToggle({ className = "" }: ModeToggleProps) {
  const { activeMode, setMode } = useApp()

  const handleModeChange = (mode: Mode) => {
    setMode(mode)
  }

  return (
    <div className={`mode-toggle ${className}`}>
      <button
        className={`mode-toggle__button ${activeMode === "todo" ? "mode-toggle__button--active" : ""}`}
        onClick={() => handleModeChange("todo")}
        aria-pressed={activeMode === "todo"}
      >
        Todo
      </button>
      <button
        className={`mode-toggle__button ${activeMode === "brain" ? "mode-toggle__button--active" : ""}`}
        onClick={() => handleModeChange("brain")}
        aria-pressed={activeMode === "brain"}
      >
        Brain
      </button>
    </div>
  )
}
