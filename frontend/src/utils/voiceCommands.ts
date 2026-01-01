import type { ContainerId } from "../context/ContainerContext"
import { CONTAINER_NAMES } from "../context/ContainerContext"

export type VoiceCommandType =
  | "switch_container"
  | "create_container"
  | "close_container"
  | "send_to_container"
  | "save_chat"
  | "disable_ai"
  | "enable_ai"
  | "switch_ai"
  | "accept_task"
  | "deny_task"
  | "plan_task"
  | "execute_task"
  | "ignored"

export interface VoiceCommand {
  type: VoiceCommandType
  containerId?: ContainerId
  targetAI?: "gemini" | "claude"
  rawText: string
}

// Common mishearings of "Claude"
const CLAUDE_VARIANTS = ["claude", "cloud", "claw", "clude", "clawed", "clode"]

// Container name patterns
const CONTAINER_PATTERN = /(?:container\s*)?([a-d])/i

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const normalized = text.toLowerCase().trim().replace(/[.!?,]/g, "")

  // === Container Commands ===

  // Switch to container: flexible patterns
  // "switch to main", "switch to main container", "switch to container a", "switch to a",
  // "change to main", "go to container b", "switch to the main container", etc.
  const switchMatch = normalized.match(/^(switch|change|go)\s+to\s+(the\s+)?(main|container\s*[a-d]|[a-d])(\s+container)?$/i)
  if (switchMatch) {
    const target = switchMatch[3].toLowerCase().replace(/container\s*/, "")
    if (target === "main" || CONTAINER_NAMES.includes(target as ContainerId)) {
      return { type: "switch_container", containerId: target as ContainerId, rawText: text }
    }
  }

  // Create container: "create container", "create a new container", "new container", "open container A"
  const createMatch = normalized.match(/^(create|new|open)\s+(a\s+)?(new\s+)?(container|tab)(\s+[a-d])?$/i)
  if (createMatch) {
    const specificId = createMatch[5]?.trim().toLowerCase() as ContainerId | undefined
    return { type: "create_container", containerId: specificId, rawText: text }
  }

  // Send to container: "enter that into container A", "send this to A"
  const sendMatch = normalized.match(/^(enter|send|put)\s+(that|this|it)\s+(into|to|in)\s+(container\s*[a-d]|[a-d])$/i)
  if (sendMatch) {
    const target = sendMatch[4].toLowerCase().replace(/container\s*/, "")
    if (CONTAINER_NAMES.includes(target as ContainerId)) {
      return { type: "send_to_container", containerId: target as ContainerId, rawText: text }
    }
  }

  // Close container: "close container A", "close A"
  const closeMatch = normalized.match(/^close\s+(container\s*[a-d]|[a-d])$/i)
  if (closeMatch) {
    const target = closeMatch[1].toLowerCase().replace(/container\s*/, "")
    if (target !== "main" && CONTAINER_NAMES.includes(target as ContainerId)) {
      return { type: "close_container", containerId: target as ContainerId, rawText: text }
    }
  }

  // === AI Switching Commands ===

  // Switch to AI: "switch to claude" or "switch to gemini"
  const aiSwitchPattern = new RegExp(
    `^switch\\s+to\\s+(${CLAUDE_VARIANTS.join("|")}|gemini)$`,
    "i"
  )
  const aiSwitchMatch = normalized.match(aiSwitchPattern)
  if (aiSwitchMatch) {
    const target = aiSwitchMatch[1].toLowerCase()
    const isGemini = target === "gemini"
    return { type: "switch_ai", targetAI: isGemini ? "gemini" : "claude", rawText: text }
  }

  // === Local Commands ===

  // Save chat
  if (normalized === "save chat" || normalized === "safe chat") {
    return { type: "save_chat", rawText: text }
  }

  // Disable AI
  if (["disable", "disabled", "pause"].includes(normalized)) {
    return { type: "disable_ai", rawText: text }
  }

  // Enable AI
  if (["start", "enable", "resume"].includes(normalized)) {
    return { type: "enable_ai", rawText: text }
  }

  // Accept task
  if (["accept", "except", "yes", "approve", "go ahead", "go for it", "proceed"].includes(normalized)) {
    return { type: "accept_task", rawText: text }
  }

  // Deny task
  if (["deny", "no", "cancel", "nevermind", "never mind"].includes(normalized)) {
    return { type: "deny_task", rawText: text }
  }

  // Plan task (Claude mode only)
  if (["plan this", "plan it", "make a plan", "create a plan"].includes(normalized)) {
    return { type: "plan_task", rawText: text }
  }

  // Execute task (Claude mode only)
  if (["do this", "do it", "execute", "run it", "execute this", "run this"].includes(normalized)) {
    return { type: "execute_task", rawText: text }
  }

  // Ignored commands
  if (["stop", "okay", "ok", "got it"].includes(normalized)) {
    return { type: "ignored", rawText: text }
  }

  // No command recognized
  return null
}

// Check if text starts with "Claude, ..." pattern
export function parseClaudeDirectAddress(text: string): { prompt: string } | null {
  const claudePattern = new RegExp(`^(${CLAUDE_VARIANTS.join("|")})[,.]?\\s+(.+)`, "i")
  const match = text.match(claudePattern)
  if (match) {
    return { prompt: match[2] }
  }
  return null
}

// Check if text mentions exiting Claude mode
export function isClaudeExitCommand(text: string): boolean {
  const normalized = text.toLowerCase().trim().replace(/[.!?,]/g, "")
  return normalized === "exit" || normalized.includes("gemini")
}

// Extract container ID from various formats
export function extractContainerId(text: string): ContainerId | null {
  const match = text.toLowerCase().match(CONTAINER_PATTERN)
  if (match) {
    const id = match[1].toLowerCase()
    if (CONTAINER_NAMES.includes(id as ContainerId) && id !== "main") {
      return id as ContainerId
    }
  }
  if (text.toLowerCase().includes("main")) {
    return "main"
  }
  return null
}
