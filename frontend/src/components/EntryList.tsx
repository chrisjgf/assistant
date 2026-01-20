import { useState } from "react"
import { useApp } from "../context/AppContext"
import type { BrainEntry } from "../types"

interface EntryItemProps {
  entry: BrainEntry
  onDelete: (entryId: string) => void
}

function EntryItem({ entry, onDelete }: EntryItemProps) {
  const date = new Date(entry.createdAt)
  const dateStr = date.toLocaleDateString()
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  return (
    <div className="entry-item">
      <div className="entry-item__header">
        <span className="entry-item__date">{dateStr}</span>
        <span className="entry-item__time">{timeStr}</span>
        <button
          className="entry-item__delete"
          onClick={() => onDelete(entry.id)}
          aria-label="Delete entry"
        >
          ×
        </button>
      </div>
      <div className="entry-item__text">{entry.text}</div>
    </div>
  )
}

interface EntryListProps {
  entries: BrainEntry[]
  categoryId: string
  className?: string
}

export function EntryList({ entries, categoryId, className = "" }: EntryListProps) {
  const { createEntry, deleteEntry } = useApp()

  const [newEntryText, setNewEntryText] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Group entries by date
  const groupedEntries = entries.reduce((groups, entry) => {
    const date = new Date(entry.createdAt).toLocaleDateString()
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(entry)
    return groups
  }, {} as Record<string, BrainEntry[]>)

  // Sort dates (newest first)
  const sortedDates = Object.keys(groupedEntries).sort((a, b) => {
    return new Date(b).getTime() - new Date(a).getTime()
  })

  const handleCreateEntry = async () => {
    if (!newEntryText.trim()) return

    setIsCreating(true)
    try {
      await createEntry(categoryId, newEntryText.trim())
      setNewEntryText("")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isCreating) {
      e.preventDefault()
      handleCreateEntry()
    }
  }

  const handleDelete = async (entryId: string) => {
    await deleteEntry(entryId)
  }

  return (
    <div className={`entry-list ${className}`}>
      <div className="entry-list__create">
        <textarea
          className="entry-list__input"
          placeholder="Add a new note..."
          value={newEntryText}
          onChange={(e) => setNewEntryText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
          rows={3}
        />
        <button
          className="entry-list__add-button"
          onClick={handleCreateEntry}
          disabled={isCreating || !newEntryText.trim()}
        >
          {isCreating ? "..." : "Add"}
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="entry-list__empty">
          No entries yet. Add one above.
        </div>
      ) : (
        <div className="entry-list__groups">
          {sortedDates.map((date) => (
            <div key={date} className="entry-list__group">
              <div className="entry-list__group-header">{date}</div>
              <div className="entry-list__group-entries">
                {groupedEntries[date]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((entry) => (
                    <EntryItem
                      key={entry.id}
                      entry={entry}
                      onDelete={handleDelete}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
