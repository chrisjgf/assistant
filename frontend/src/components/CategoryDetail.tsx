import { useState, useEffect, useCallback } from "react"
import { useApp } from "../context/AppContext"
import { ProgressBar } from "./ProgressBar"
import { TaskList } from "./TaskList"
import { EntryList } from "./EntryList"
import type { TodoCategory, BrainCategory, Task, Message } from "../types"

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
)

const API_BASE = `${window.location.protocol}//${window.location.hostname}:8001`

// RecentMessages component - shows last few messages from conversation
interface RecentMessagesProps {
  messages: Message[]
  maxCount?: number
  className?: string
}

function RecentMessages({ messages, maxCount = 3, className = "" }: RecentMessagesProps) {
  const recentMessages = messages
    .filter(m => m.text !== "..." && m.text.length > 0)
    .slice(-maxCount)

  if (recentMessages.length === 0) {
    return null
  }

  return (
    <div className={`recent-messages ${className}`}>
      <div className="recent-messages__header">Recent</div>
      <div className="recent-messages__list">
        {recentMessages.map((msg) => (
          <div
            key={msg.id}
            className={`recent-messages__item recent-messages__item--${msg.role}`}
          >
            <span className="recent-messages__role">
              {msg.role === "user" ? "You" : msg.source || "AI"}:
            </span>
            <span className="recent-messages__text">
              {msg.text.length > 100 ? msg.text.slice(0, 100) + "..." : msg.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface CategoryDetailProps {
  onTaskAction?: (task: Task, categoryId: string) => void
  className?: string
}

export function CategoryDetail({ onTaskAction, className = "" }: CategoryDetailProps) {
  const { activeMode, selectedCategory, selectCategory, deleteCategory, sessionId } = useApp()

  const [synopsis, setSynopsis] = useState<string | null>(null)
  const [isSynopsisLoading, setIsSynopsisLoading] = useState(false)

  const isTodo = activeMode === "todo"
  const todoCategory = isTodo && selectedCategory ? (selectedCategory as TodoCategory) : null
  const brainCategory = !isTodo && selectedCategory ? (selectedCategory as BrainCategory) : null

  const completedCount = todoCategory?.tasks.filter((t) => t.completed).length || 0
  const totalCount = todoCategory?.tasks.length || 0
  const pendingCount = totalCount - completedCount

  // Fetch synopsis when category changes or tasks change
  const fetchSynopsis = useCallback(async () => {
    if (!sessionId || !todoCategory || pendingCount === 0) {
      setSynopsis(null)
      return
    }

    setIsSynopsisLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/session/${sessionId}/categories/todo/${todoCategory.id}/synopsis`,
        { method: "POST" }
      )
      if (res.ok) {
        const data = await res.json()
        setSynopsis(data.synopsis)
      }
    } catch (err) {
      console.error("Failed to fetch synopsis:", err)
    } finally {
      setIsSynopsisLoading(false)
    }
  }, [sessionId, todoCategory?.id, pendingCount])

  // Reset synopsis when category changes
  useEffect(() => {
    setSynopsis(null)
  }, [selectedCategory?.id])

  if (!selectedCategory) {
    return (
      <div className={`category-detail category-detail--empty ${className}`}>
        <div className="category-detail__placeholder">
          Select a category to view details
        </div>
      </div>
    )
  }

  const handleTaskAction = (task: Task) => {
    if (onTaskAction && todoCategory) {
      onTaskAction(task, todoCategory.id)
    }
  }

  const handleBack = () => {
    selectCategory(null)
  }

  const handleRefreshSynopsis = () => {
    fetchSynopsis()
  }

  const handleDelete = async () => {
    if (window.confirm(`Are you sure you want to delete "${selectedCategory.name}"?`)) {
      await deleteCategory(selectedCategory.id)
    }
  }

  return (
    <div className={`category-detail ${className}`}>
      <div className="category-detail__header">
        <button
          className="category-detail__back"
          onClick={handleBack}
          aria-label="Back to category list"
        >
          ← Back
        </button>
        <div className="category-detail__title-group">
          <h2 className="category-detail__title">{selectedCategory.name}</h2>
          {selectedCategory.directoryPath && (
            <span className="category-detail__path" title={selectedCategory.directoryPath}>
              {selectedCategory.directoryPath}
            </span>
          )}
        </div>
        <button
          className="category-detail__delete"
          onClick={handleDelete}
          aria-label="Delete category"
          title="Delete category"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Recent voice messages (only for Todo categories which have messages) */}
      {todoCategory && todoCategory.messages && todoCategory.messages.length > 0 && (
        <RecentMessages
          messages={todoCategory.messages}
          maxCount={5}
          className="category-detail__recent"
        />
      )}

      {isTodo && todoCategory && (
        <>
          <div className="category-detail__progress">
            <ProgressBar completed={completedCount} total={totalCount} />
          </div>

          <div className="category-detail__synopsis">
            <div className="category-detail__synopsis-header">
              <strong>Up Next:</strong>
              {pendingCount > 0 && (
                <button
                  className="category-detail__synopsis-refresh"
                  onClick={handleRefreshSynopsis}
                  disabled={isSynopsisLoading}
                  aria-label="Get AI recommendation"
                >
                  {isSynopsisLoading ? "..." : "Get AI Suggestion"}
                </button>
              )}
            </div>
            <div className="category-detail__synopsis-content">
              {totalCount === 0 ? (
                <span>Add tasks to get started</span>
              ) : completedCount === totalCount ? (
                <span>All tasks complete!</span>
              ) : synopsis ? (
                <span>{synopsis}</span>
              ) : (
                <span>Click "Get AI Suggestion" for recommendations</span>
              )}
            </div>
          </div>

          <TaskList
            tasks={todoCategory.tasks}
            categoryId={todoCategory.id}
            onTaskAction={handleTaskAction}
            className="category-detail__tasks"
          />
        </>
      )}

      {!isTodo && brainCategory && (
        <EntryList
          entries={brainCategory.entries}
          categoryId={brainCategory.id}
          className="category-detail__entries"
        />
      )}
    </div>
  )
}
