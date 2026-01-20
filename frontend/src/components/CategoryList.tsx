import { useState } from "react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import type { DragEndEvent } from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useApp } from "../context/AppContext"
import type { TodoCategory, BrainCategory } from "../types"

interface SortableCategoryItemProps {
  category: TodoCategory | BrainCategory
  isSelected: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}

function SortableCategoryItem({ category, isSelected, onSelect, onDelete }: SortableCategoryItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // Calculate task progress for Todo categories
  const isTodoCategory = "tasks" in category
  const tasks = isTodoCategory ? (category as TodoCategory).tasks : []
  const totalCount = tasks.length
  const completedCount = tasks.filter((t) => t.completed).length

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`category-item ${isSelected ? "category-item--selected" : ""} ${isDragging ? "category-item--dragging" : ""}`}
    >
      <div
        className="category-item__drag-handle"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </div>
      <button
        className="category-item__content"
        onClick={() => onSelect(category.id)}
      >
        <span className="category-item__name">{category.name}</span>
        {isTodoCategory && totalCount > 0 && (
          <span className="category-item__progress">
            {completedCount}/{totalCount}
          </span>
        )}
        {!isTodoCategory && (
          <span className="category-item__count">
            {(category as BrainCategory).entries.length} entries
          </span>
        )}
      </button>
      <button
        className="category-item__delete"
        onClick={(e) => {
          e.stopPropagation()
          onDelete(category.id)
        }}
        aria-label={`Delete ${category.name}`}
      >
        ×
      </button>
    </div>
  )
}

interface CategoryListProps {
  className?: string
}

export function CategoryList({ className = "" }: CategoryListProps) {
  const {
    activeMode,
    todoCategories,
    brainCategories,
    selectedCategory,
    selectCategory,
    createCategory,
    deleteCategory,
    reorderCategories,
  } = useApp()

  const [newCategoryName, setNewCategoryName] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const categories = activeMode === "todo" ? todoCategories : brainCategories

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = categories.findIndex((cat) => cat.id === active.id)
    const newIndex = categories.findIndex((cat) => cat.id === over.id)
    const newOrder = arrayMove(categories, oldIndex, newIndex)
    reorderCategories(newOrder.map((c) => c.id))
  }

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return

    setIsCreating(true)
    try {
      await createCategory(newCategoryName.trim())
      setNewCategoryName("")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreating) {
      handleCreateCategory()
    }
  }

  return (
    <div className={`category-list ${className}`}>
      <div className="category-list__header">
        <h2 className="category-list__title">
          {activeMode === "todo" ? "Todo Categories" : "Brain Categories"}
        </h2>
      </div>

      <div className="category-list__create">
        <input
          type="text"
          className="category-list__input"
          placeholder={`New ${activeMode} category...`}
          value={newCategoryName}
          onChange={(e) => setNewCategoryName(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
        />
        <button
          className="category-list__add-button"
          onClick={handleCreateCategory}
          disabled={isCreating || !newCategoryName.trim()}
        >
          {isCreating ? "..." : "+"}
        </button>
      </div>

      {categories.length === 0 ? (
        <div className="category-list__empty">
          No categories yet. Create one above.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={categories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="category-list__items">
              {categories.map((category) => (
                <SortableCategoryItem
                  key={category.id}
                  category={category}
                  isSelected={selectedCategory?.id === category.id}
                  onSelect={selectCategory}
                  onDelete={deleteCategory}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  )
}
