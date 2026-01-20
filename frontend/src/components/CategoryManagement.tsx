import { useState, useCallback } from "react"
import { useApp } from "../context/AppContext"
import type { TodoCategory, BrainCategory } from "../types"

interface CategoryManagementProps {
  onClose: () => void
  onSelectCategory: (id: string) => void
}

export function CategoryManagement({ onClose, onSelectCategory }: CategoryManagementProps) {
  const {
    activeMode,
    todoCategories,
    brainCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    setDirectoryPath,
  } = useApp()

  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editDirectory, setEditDirectory] = useState("")

  const categories = activeMode === "todo" ? todoCategories : brainCategories

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    await createCategory(newName.trim())
    setNewName("")
  }, [newName, createCategory])

  const handleStartEdit = useCallback((cat: TodoCategory | BrainCategory) => {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditDirectory((cat as TodoCategory).directoryPath || "")
  }, [])

  const clearEditState = useCallback(() => {
    setEditingId(null)
    setEditName("")
    setEditDirectory("")
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (!editingId || !editName.trim()) return

    updateCategory(editingId, { name: editName.trim() })

    if (activeMode === "todo") {
      setDirectoryPath(editingId, editDirectory.trim() || null)
    }

    clearEditState()
  }, [editingId, editName, editDirectory, activeMode, updateCategory, setDirectoryPath, clearEditState])

  const handleCancelEdit = clearEditState

  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm("Are you sure you want to delete this category?")) {
      await deleteCategory(id)
    }
  }, [deleteCategory])

  return (
    <div className="category-management">
      <div className="category-management__header">
        <h2>Manage {activeMode === "todo" ? "Todo" : "Brain"} Categories</h2>
        <button
          className="category-management__close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>

      {/* Create new category */}
      <div className="category-management__create">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name..."
          className="category-management__input"
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
        />
        <button
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="category-management__button category-management__button--primary"
        >
          Create
        </button>
      </div>

      {/* Category list */}
      <div className="category-management__list">
        {categories.length === 0 ? (
          <p className="category-management__empty">No categories yet. Create one above.</p>
        ) : (
          categories.map((cat) => (
            <div key={cat.id} className="category-management__item">
              {editingId === cat.id ? (
                <div className="category-management__edit">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Category name"
                    className="category-management__input"
                    autoFocus
                  />
                  {activeMode === "todo" && (
                    <input
                      type="text"
                      value={editDirectory}
                      onChange={(e) => setEditDirectory(e.target.value)}
                      placeholder="Directory path (e.g., ~/dev/project)"
                      className="category-management__input category-management__input--directory"
                    />
                  )}
                  <div className="category-management__edit-actions">
                    <button
                      onClick={handleSaveEdit}
                      className="category-management__button category-management__button--primary"
                    >
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="category-management__button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    className="category-management__item-info"
                    onClick={() => onSelectCategory(cat.id)}
                  >
                    <span className="category-management__item-name">{cat.name}</span>
                    {"directoryPath" in cat && cat.directoryPath && (
                      <span className="category-management__item-path" title={cat.directoryPath}>
                        {cat.directoryPath}
                      </span>
                    )}
                  </div>
                  <div className="category-management__item-actions">
                    <button
                      onClick={() => handleStartEdit(cat)}
                      className="category-management__icon-button"
                      title="Edit"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(cat.id)}
                      className="category-management__icon-button category-management__icon-button--danger"
                      title="Delete"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
