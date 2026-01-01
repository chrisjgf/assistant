import type { Container } from "../context/ContainerContext"
import { MAX_CONTAINERS } from "../context/ContainerContext"

interface ContainerTabsProps {
  containers: Map<string, Container>
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onClose: (id: string) => void
}

function getStatusColor(status: Container["status"]): string {
  switch (status) {
    case "processing":
      return "bg-yellow-400"
    case "ready":
      return "bg-green-400"
    case "speaking":
      return "bg-blue-400"
    default:
      return "bg-gray-400"
  }
}

function getStatusPulse(status: Container["status"]): string {
  if (status === "processing" || status === "speaking") {
    return "animate-pulse"
  }
  return ""
}

export function ContainerTabs({
  containers,
  activeId,
  onSelect,
  onCreate,
  onClose,
}: ContainerTabsProps) {
  // Sort containers: main first, then alphabetically
  const sortedContainers = Array.from(containers.entries()).sort(([a], [b]) => {
    if (a === "main") return -1
    if (b === "main") return 1
    return a.localeCompare(b)
  })

  const canCreate = containers.size < MAX_CONTAINERS

  return (
    <div className="flex items-center gap-1 overflow-x-auto px-2 py-1 bg-gray-800 border-b border-gray-700">
      {sortedContainers.map(([id, container]) => {
        const isActive = id === activeId
        const isMain = id === "main"

        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium
              transition-colors duration-150 whitespace-nowrap
              ${isActive
                ? "bg-gray-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-650 hover:text-white"
              }
            `}
          >
            {/* Status indicator */}
            <span
              className={`w-2 h-2 rounded-full ${getStatusColor(container.status)} ${getStatusPulse(container.status)}`}
            />

            {/* Tab name */}
            <span>
              {isMain ? "Main" : id.toUpperCase()}
            </span>

            {/* AI badge */}
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                container.activeAI === "claude"
                  ? "bg-orange-500/20 text-orange-400"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {container.activeAI === "claude" ? "C" : "G"}
            </span>

            {/* Close button (not for main) */}
            {!isMain && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(id)
                }}
                className="ml-1 p-0.5 rounded hover:bg-gray-500 text-gray-400 hover:text-white"
                title={`Close container ${id.toUpperCase()}`}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </button>
        )
      })}

      {/* Create new container button */}
      <button
        onClick={onCreate}
        disabled={!canCreate}
        className={`
          flex items-center justify-center w-8 h-8 rounded-lg
          transition-colors duration-150
          ${canCreate
            ? "bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
            : "bg-gray-800 text-gray-600 cursor-not-allowed"
          }
        `}
        title={canCreate ? "Create new container" : "Maximum containers reached"}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
      </button>
    </div>
  )
}
