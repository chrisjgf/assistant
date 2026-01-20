import { useState } from "react"
import { useApp } from "../context/AppContext"
import type { Task } from "../types"

interface TaskItemProps {
  task: Task
  onToggle: (taskId: string, completed: boolean) => void
  onDelete: (taskId: string) => void
  onAction: (task: Task) => void
}

function TaskItem({ task, onToggle, onDelete, onAction }: TaskItemProps) {
  return (
    <div className={`task-item ${task.completed ? "task-item--completed" : ""}`}>
      <button
        className="task-item__checkbox"
        onClick={() => onToggle(task.id, !task.completed)}
        aria-label={task.completed ? "Mark incomplete" : "Mark complete"}
      >
        {task.completed ? "✓" : "○"}
      </button>
      <span className="task-item__text">{task.text}</span>
      <div className="task-item__actions">
        <button
          className="task-item__action-button"
          onClick={() => onAction(task)}
          aria-label="Work on task with AI"
          title="Work on this with AI"
        >
          ▶
        </button>
        <button
          className="task-item__delete"
          onClick={() => onDelete(task.id)}
          aria-label="Delete task"
        >
          ×
        </button>
      </div>
    </div>
  )
}

interface TaskListProps {
  tasks: Task[]
  categoryId: string
  onTaskAction?: (task: Task) => void
  className?: string
}

export function TaskList({ tasks, categoryId, onTaskAction, className = "" }: TaskListProps) {
  const { createTask, updateTask, deleteTask } = useApp()

  const [newTaskText, setNewTaskText] = useState("")
  const [showCompleted, setShowCompleted] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  const pendingTasks = tasks.filter((t) => !t.completed)
  const completedTasks = tasks.filter((t) => t.completed)

  const handleCreateTask = async () => {
    if (!newTaskText.trim()) return

    setIsCreating(true)
    try {
      await createTask(categoryId, newTaskText.trim())
      setNewTaskText("")
    } finally {
      setIsCreating(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isCreating) {
      handleCreateTask()
    }
  }

  const handleToggle = async (taskId: string, completed: boolean) => {
    await updateTask(taskId, { completed })
  }

  const handleDelete = async (taskId: string) => {
    await deleteTask(taskId)
  }

  const handleAction = (task: Task) => {
    if (onTaskAction) {
      onTaskAction(task)
    }
  }

  return (
    <div className={`task-list ${className}`}>
      <div className="task-list__create">
        <input
          type="text"
          className="task-list__input"
          placeholder="Add a new task..."
          value={newTaskText}
          onChange={(e) => setNewTaskText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isCreating}
        />
        <button
          className="task-list__add-button"
          onClick={handleCreateTask}
          disabled={isCreating || !newTaskText.trim()}
        >
          {isCreating ? "..." : "+"}
        </button>
      </div>

      {pendingTasks.length === 0 && completedTasks.length === 0 ? (
        <div className="task-list__empty">
          No tasks yet. Add one above.
        </div>
      ) : (
        <>
          <div className="task-list__pending">
            {pendingTasks.length === 0 ? (
              <div className="task-list__all-done">All tasks completed!</div>
            ) : (
              pendingTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onAction={handleAction}
                />
              ))
            )}
          </div>

          {completedTasks.length > 0 && (
            <div className="task-list__completed-section">
              <button
                className="task-list__toggle-completed"
                onClick={() => setShowCompleted(!showCompleted)}
              >
                {showCompleted ? "▼" : "▶"} Completed ({completedTasks.length})
              </button>

              {showCompleted && (
                <div className="task-list__completed">
                  {completedTasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                      onAction={handleAction}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
