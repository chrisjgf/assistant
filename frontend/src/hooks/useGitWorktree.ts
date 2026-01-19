/**
 * Git worktree management hook for per-container branch targeting.
 */

import { useState, useCallback } from "react"
import { API_URL } from "./useSharedVoice"

export interface Branch {
  name: string
  current: boolean
  hasWorktree: boolean
}

export interface Worktree {
  path: string
  branch: string
  head?: string
  detached?: boolean
}

export interface UseGitWorktreeReturn {
  branches: Branch[]
  worktrees: Worktree[]
  isLoading: boolean
  error: string | null
  fetchBranches: () => Promise<void>
  fetchWorktrees: () => Promise<void>
  createWorktree: (branch: string) => Promise<{ success: boolean; path?: string; error?: string }>
  removeWorktree: (branch: string) => Promise<{ success: boolean; error?: string }>
  switchBranch: (containerId: string, branch: string) => void
  listBranches: (containerId: string) => void
}

/**
 * Hook for managing git worktrees via REST API and WebSocket.
 */
export function useGitWorktree(
  wsRef: React.RefObject<WebSocket | null>
): UseGitWorktreeReturn {
  const [branches, setBranches] = useState<Branch[]>([])
  const [worktrees, setWorktrees] = useState<Worktree[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch branches via REST
  const fetchBranches = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/git/branches`)
      if (!response.ok) {
        throw new Error(`Failed to fetch branches: ${response.status}`)
      }

      const data = await response.json()
      setBranches(data.branches || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch branches")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch worktrees via REST
  const fetchWorktrees = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/git/worktrees`)
      if (!response.ok) {
        throw new Error(`Failed to fetch worktrees: ${response.status}`)
      }

      const data = await response.json()
      setWorktrees(data.worktrees || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch worktrees")
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Create a worktree via REST
  const createWorktree = useCallback(
    async (branch: string): Promise<{ success: boolean; path?: string; error?: string }> => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`${API_URL}/git/worktree`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branch }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return { success: false, error: errorText }
        }

        const data = await response.json()

        // Refresh data
        await Promise.all([fetchBranches(), fetchWorktrees()])

        return { success: true, path: data.path }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to create worktree"
        setError(errorMsg)
        return { success: false, error: errorMsg }
      } finally {
        setIsLoading(false)
      }
    },
    [fetchBranches, fetchWorktrees]
  )

  // Remove a worktree via REST
  const removeWorktree = useCallback(
    async (branch: string): Promise<{ success: boolean; error?: string }> => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(`${API_URL}/git/worktree/${encodeURIComponent(branch)}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          const errorText = await response.text()
          return { success: false, error: errorText }
        }

        // Refresh data
        await Promise.all([fetchBranches(), fetchWorktrees()])

        return { success: true }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to remove worktree"
        setError(errorMsg)
        return { success: false, error: errorMsg }
      } finally {
        setIsLoading(false)
      }
    },
    [fetchBranches, fetchWorktrees]
  )

  // Switch container to branch via WebSocket
  const switchBranch = useCallback(
    (containerId: string, branch: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "switch_branch",
          containerId,
          branch,
        })
      )
    },
    [wsRef]
  )

  // List branches via WebSocket
  const listBranches = useCallback(
    (containerId: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn("WebSocket not connected")
        return
      }

      wsRef.current.send(
        JSON.stringify({
          type: "list_branches",
          containerId,
        })
      )
    },
    [wsRef]
  )

  return {
    branches,
    worktrees,
    isLoading,
    error,
    fetchBranches,
    fetchWorktrees,
    createWorktree,
    removeWorktree,
    switchBranch,
    listBranches,
  }
}

/**
 * Handle git-related WebSocket messages.
 * Call this from your WebSocket message handler.
 */
export function handleGitMessage(
  data: Record<string, unknown>,
  setBranches: (branches: Branch[]) => void,
  onBranchSwitched?: (containerId: string, branch: string, worktreePath: string) => void,
  onBranchSwitchFailed?: (containerId: string, branch: string, error: string) => void,
): boolean {
  const msgType = data.type as string

  switch (msgType) {
    case "branches_list": {
      setBranches((data.branches as Branch[]) || [])
      return true
    }

    case "branch_switched": {
      const containerId = data.containerId as string
      const branch = data.branch as string
      const worktreePath = data.worktreePath as string
      onBranchSwitched?.(containerId, branch, worktreePath)
      return true
    }

    case "branch_switch_failed": {
      const containerId = data.containerId as string
      const branch = data.branch as string
      const error = data.error as string
      onBranchSwitchFailed?.(containerId, branch, error)
      return true
    }

    default:
      return false
  }
}
