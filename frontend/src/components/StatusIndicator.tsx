import type { Status } from "../hooks/useVoiceChat"

interface StatusIndicatorProps {
  status: Status
  activeAI?: "gemini" | "claude"
}

const statusConfig = {
  idle: {
    label: "Idle",
    color: "bg-gray-400",
    pulse: false,
  },
  listening: {
    label: "Listening",
    color: "bg-green-500",
    pulse: true,
  },
  processing: {
    label: "Processing",
    color: "bg-yellow-500",
    pulse: true,
  },
  speaking: {
    label: "Speaking",
    color: "bg-blue-500",
    pulse: true,
  },
}

export function StatusIndicator({ status, activeAI = "gemini" }: StatusIndicatorProps) {
  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div className="relative">
          <div
            className={`w-4 h-4 rounded-full ${config.color} ${
              config.pulse ? "animate-pulse" : ""
            }`}
          />
        </div>
        <span className="text-sm font-medium text-gray-700">{config.label}</span>
      </div>
      <span
        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          activeAI === "claude"
            ? "bg-orange-100 text-orange-700"
            : "bg-blue-100 text-blue-700"
        }`}
      >
        {activeAI === "claude" ? "Claude" : "Gemini"}
      </span>
    </div>
  )
}
