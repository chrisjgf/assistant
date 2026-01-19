/**
 * Task queue management hook for per-container FIFO task scheduling.
 */

import { useState, useCallback, useEffect, useRef } from "react"

export interface QueuedTask {
  id: string
  containerId: string
  taskType: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  position?: number
  result?: string
  error?: string
}

export interface QueueStatus {
  containerId: string
  queued: number
  running: number
  completed: number
  failed: number
  cancelled: number
  runningTask: {
    id: string
    type: string
    startedAt: string | null
  } | null
}

export interface UseTaskQueueReturn {
  queueTask: (containerId: string, taskType: string, payload: Record<string, unknown>) => void
  cancelTask: (taskId: string, containerId: string) => void
  getQueueStatus: (containerId: string) => void
  clearQueue: (containerId: string) => void
  queueStatus: QueueStatus | null
  setQueueStatus: React.Dispatch<React.SetStateAction<QueueStatus | null>>
  recentTasks: QueuedTask[]
  setRecentTasks: React.Dispatch<React.SetStateAction<QueuedTask[]>>
}

/**
 * Hook for managing task queues via WebSocket.
 * Must be used within a component that has access to the WebSocket.
 */
export function useTaskQueue(
  wsRef: React.RefObject<WebSocket | null>,
  onTaskComplete?: (task: QueuedTask) => void,
  onTaskFailed?: (task: QueuedTask) => void,
): UseTaskQueueReturn {
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [recentTasks, setRecentTasks] = useState<QueuedTask[]>([])
  const taskCallbacksRef = useRef({ onTaskComplete, onTaskFailed })

  // Keep callbacks ref updated
  useEffect(() => {
    taskCallbacksRef.current = { onTaskComplete, onTaskFailed }
  }, [onTaskComplete, onTaskFailed])

  // Queue a new task
  const queueTask = useCallback(
    (containerId: string, taskType: string, payload: Record<string, unknown>) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "queue_task",
          containerId,
          taskType,
          payload,
        })
      )
    },
    [wsRef]
  )

  // Cancel a specific task
  const cancelTask = useCallback(
    (taskId: string, containerId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "cancel_task",
          taskId,
          containerId,
        })
      )
    },
    [wsRef]
  )

  // Get queue status for a container
  const getQueueStatus = useCallback(
    (containerId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "queue_status",
          containerId,
        })
      )
    },
    [wsRef]
  )

  // Clear all pending tasks for a container
  const clearQueue = useCallback(
    (containerId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "clear_queue",
          containerId,
        })
      )
    },
    [wsRef]
  )

  return {
    queueTask,
    cancelTask,
    getQueueStatus,
    clearQueue,
    queueStatus,
    setQueueStatus,
    recentTasks,
    setRecentTasks,
  }
}

/**
 * Handle queue-related WebSocket messages.
 * Call this from your WebSocket message handler.
 */
export function handleQueueMessage(
  data: Record<string, unknown>,
  setQueueStatus: (status: QueueStatus | null) => void,
  setRecentTasks: React.Dispatch<React.SetStateAction<QueuedTask[]>>,
  onTaskComplete?: (task: QueuedTask) => void,
  onTaskFailed?: (task: QueuedTask) => void,
): boolean {
  const msgType = data.type as string

  switch (msgType) {
    case "task_queued": {
      const task: QueuedTask = {
        id: data.taskId as string,
        containerId: data.containerId as string,
        taskType: "unknown",
        status: "queued",
        position: data.position as number,
      }
      setRecentTasks((prev) => [...prev.slice(-19), task])
      return true
    }

    case "queued_task_complete": {
      const task: QueuedTask = {
        id: data.taskId as string,
        containerId: data.containerId as string,
        taskType: "unknown",
        status: "completed",
        result: data.result as string,
      }
      setRecentTasks((prev) =>
        prev.map((t) => (t.id === task.id ? task : t))
      )
      onTaskComplete?.(task)
      return true
    }

    case "queued_task_failed": {
      const task: QueuedTask = {
        id: data.taskId as string,
        containerId: data.containerId as string,
        taskType: "unknown",
        status: "failed",
        error: data.error as string,
      }
      setRecentTasks((prev) =>
        prev.map((t) => (t.id === task.id ? task : t))
      )
      onTaskFailed?.(task)
      return true
    }

    case "task_cancelled": {
      const taskId = data.taskId as string
      setRecentTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, status: "cancelled" as const } : t
        )
      )
      return true
    }

    case "queue_status_response": {
      setQueueStatus(data.status as QueueStatus)
      return true
    }

    case "queue_cleared": {
      // Update recent tasks to mark cancelled
      setRecentTasks((prev) =>
        prev.map((t) =>
          t.containerId === data.containerId && t.status === "queued"
            ? { ...t, status: "cancelled" as const }
            : t
        )
      )
      return true
    }

    default:
      return false
  }
}
