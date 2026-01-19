/**
 * Session storage utility for conversation persistence.
 * Uses localStorage for instant recovery with backend JSON as primary store.
 */

import type { Message } from "../context/ContainerContext"

const SESSION_ID_KEY = "assistant_session_id"
const SESSION_CACHE_KEY = "assistant_session_cache"

export interface SessionContainer {
  messages: Message[]
  activeAI: "gemini" | "claude" | "local"
  projectContext: string | null
  branch: string | null
}

export interface Session {
  id: string
  createdAt: string
  updatedAt: string
  containers: Record<string, SessionContainer>
}

/**
 * Get the current session ID from localStorage.
 */
export function getSessionId(): string | null {
  return localStorage.getItem(SESSION_ID_KEY)
}

/**
 * Set the current session ID in localStorage.
 */
export function setSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_ID_KEY, sessionId)
}

/**
 * Clear the current session ID from localStorage.
 */
export function clearSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(SESSION_CACHE_KEY)
}

/**
 * Get cached session data from localStorage.
 * Used as fallback when backend is unavailable.
 */
export function getCachedSession(): Session | null {
  const cached = localStorage.getItem(SESSION_CACHE_KEY)
  if (!cached) return null

  try {
    return JSON.parse(cached) as Session
  } catch {
    return null
  }
}

/**
 * Cache session data in localStorage.
 * Called after successful backend save.
 */
export function setCachedSession(session: Session): void {
  localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(session))
}

/**
 * Convert container Map to session containers format.
 */
export function containersToSessionData(
  containers: Map<string, {
    messages: Message[]
    activeAI: "gemini" | "claude" | "local"
    projectContext: string | null
    branch?: string | null
  }>
): Record<string, SessionContainer> {
  const result: Record<string, SessionContainer> = {}

  containers.forEach((container, id) => {
    result[id] = {
      messages: container.messages,
      activeAI: container.activeAI,
      projectContext: container.projectContext,
      branch: container.branch ?? null,
    }
  })

  return result
}

/**
 * Check if session data has meaningful content worth saving.
 */
export function hasContent(containers: Record<string, SessionContainer>): boolean {
  return Object.values(containers).some(
    (c) => c.messages.length > 0 || c.projectContext
  )
}
