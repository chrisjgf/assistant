/**
 * Session management hook for conversation persistence.
 * Handles loading/saving sessions via REST API with localStorage caching.
 */

import { useState, useCallback, useRef, useEffect } from "react"
import { API_URL } from "./useSharedVoice"
import {
  getSessionId,
  setSessionId,
  clearSessionId,
  getCachedSession,
  setCachedSession,
  containersToSessionData,
  hasContent,
  type Session,
  type SessionContainer,
} from "../utils/sessionStorage"
import type { Message } from "../context/ContainerContext"

const DEBOUNCE_MS = 2000 // Save 2 seconds after last change

export interface UseSessionReturn {
  sessionId: string | null
  isLoading: boolean
  error: string | null
  loadSession: () => Promise<Session | null>
  saveSession: (containers: Map<string, {
    messages: Message[]
    activeAI: "gemini" | "claude" | "local"
    projectContext: string | null
    branch?: string | null
  }>) => void
  createNewSession: () => Promise<Session | null>
  clearSession: () => void
}

export function useSession(): UseSessionReturn {
  const [sessionId, setSessionIdState] = useState<string | null>(() => getSessionId())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDataRef = useRef<Record<string, SessionContainer> | null>(null)

  // Create a new session via backend
  const createNewSession = useCallback(async (): Promise<Session | null> => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/session`, {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`)
      }

      const session: Session = await response.json()
      setSessionId(session.id)
      setSessionIdState(session.id)
      setCachedSession(session)

      return session
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session")
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Load session from backend, falling back to cache
  const loadSession = useCallback(async (): Promise<Session | null> => {
    const id = getSessionId()

    if (!id) {
      // No existing session, try to load from cache or create new
      const cached = getCachedSession()
      if (cached && hasContent(cached.containers)) {
        // Recreate session with cached data
        const newSession = await createNewSession()
        if (newSession) {
          // Save cached data to new session
          try {
            await fetch(`${API_URL}/session/${newSession.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ containers: cached.containers }),
            })
          } catch {
            // Ignore save failure, cache is still valid
          }
        }
        return newSession
      }
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/session/${id}`)

      if (response.status === 404) {
        // Session gone from backend, check cache
        const cached = getCachedSession()
        if (cached && cached.id === id) {
          // Recreate with cached data
          const newSession = await createNewSession()
          if (newSession && hasContent(cached.containers)) {
            await fetch(`${API_URL}/session/${newSession.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ containers: cached.containers }),
            })
          }
          return newSession
        }
        // No cache, clear stale ID
        clearSessionId()
        setSessionIdState(null)
        return null
      }

      if (!response.ok) {
        throw new Error(`Failed to load session: ${response.status}`)
      }

      const session: Session = await response.json()
      setCachedSession(session)
      setSessionIdState(session.id)

      return session
    } catch (err) {
      // On error, try cache
      const cached = getCachedSession()
      if (cached) {
        setSessionIdState(cached.id)
        return cached
      }

      setError(err instanceof Error ? err.message : "Failed to load session")
      return null
    } finally {
      setIsLoading(false)
    }
  }, [createNewSession])

  // Debounced save to backend
  const doSave = useCallback(async () => {
    const data = pendingDataRef.current
    if (!data) return

    let id = sessionId
    if (!id) {
      // Create session on first save
      const newSession = await createNewSession()
      if (!newSession) return
      id = newSession.id
    }

    try {
      const response = await fetch(`${API_URL}/session/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containers: data }),
      })

      if (response.ok) {
        const session: Session = await response.json()
        setCachedSession(session)
      }
    } catch (err) {
      console.warn("Session save failed:", err)
      // Still update cache for local fallback
      if (id) {
        setCachedSession({
          id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          containers: data,
        })
      }
    }

    pendingDataRef.current = null
  }, [sessionId, createNewSession])

  // Queue save with debounce
  const saveSession = useCallback(
    (containers: Map<string, {
      messages: Message[]
      activeAI: "gemini" | "claude" | "local"
      projectContext: string | null
      branch?: string | null
    }>) => {
      const data = containersToSessionData(containers)

      // Skip save if no content
      if (!hasContent(data)) return

      pendingDataRef.current = data

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Schedule save
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null
        doSave()
      }, DEBOUNCE_MS)
    },
    [doSave]
  )

  // Clear session
  const clearSession = useCallback(() => {
    // Cancel pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = null
    }
    pendingDataRef.current = null

    // Delete from backend
    if (sessionId) {
      fetch(`${API_URL}/session/${sessionId}`, { method: "DELETE" }).catch(() => {})
    }

    clearSessionId()
    setSessionIdState(null)
  }, [sessionId])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Save any pending data before unmount
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
        doSave()
      }
    }
  }, [doSave])

  return {
    sessionId,
    isLoading,
    error,
    loadSession,
    saveSession,
    createNewSession,
    clearSession,
  }
}
