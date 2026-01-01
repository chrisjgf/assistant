import type { Status } from "../hooks/useVoiceChat"

interface StatusIndicatorProps {
  status: Status
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
}

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const config = statusConfig[status]

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <div
          className={`w-4 h-4 rounded-full ${config.color} ${
            config.pulse ? "animate-pulse" : ""
          }`}
        />
      </div>
      <span className="text-sm font-medium text-gray-700">{config.label}</span>
    </div>
  )
}
