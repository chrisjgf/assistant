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
  | "escalate_ai"
  | "accept_task"
  | "deny_task"
  | "plan_task"
  | "execute_task"
  | "collect_context"
  | "task_status"
  | "wipe_context"
  | "ignored"

export interface VoiceCommand {
  type: VoiceCommandType
  containerId?: ContainerId
  targetAI?: "gemini" | "claude" | "local"
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

  // Close container: "close container A", "close A", or "close container" (closes current)
  const closeMatch = normalized.match(/^close\s*(container)?(\s*[a-d])?$/i)
  if (closeMatch) {
    const target = closeMatch[2]?.trim().toLowerCase()
    if (target) {
      // Specific container requested
      if (target !== "main" && CONTAINER_NAMES.includes(target as ContainerId)) {
        return { type: "close_container", containerId: target as ContainerId, rawText: text }
      }
    } else {
      // No container specified - close current (containerId undefined, handler will use current)
      return { type: "close_container", rawText: text }
    }
  }

  // === AI Switching Commands ===

  // Switch to AI: "switch to claude", "switch to gemini", or "switch to local"
  const aiSwitchPattern = new RegExp(
    `^switch\\s+to\\s+(${CLAUDE_VARIANTS.join("|")}|gemini|local)$`,
    "i"
  )
  const aiSwitchMatch = normalized.match(aiSwitchPattern)
  if (aiSwitchMatch) {
    const target = aiSwitchMatch[1].toLowerCase()
    if (target === "gemini") {
      return { type: "switch_ai", targetAI: "gemini", rawText: text }
    } else if (target === "local") {
      return { type: "switch_ai", targetAI: "local", rawText: text }
    } else {
      // Claude variants
      return { type: "switch_ai", targetAI: "claude", rawText: text }
    }
  }

  // Escalate/move to AI with context: "escalate this to claude", "move to gemini"
  // "escalates" is a common mishearing of "escalate"
  const escalatePattern = new RegExp(
    `^(escalates?|move)\\s+(this\\s+)?(to\\s+)?(${CLAUDE_VARIANTS.join("|")}|gemini|local)$`,
    "i"
  )
  const escalateMatch = normalized.match(escalatePattern)
  if (escalateMatch) {
    const target = escalateMatch[4].toLowerCase()
    if (target === "gemini") {
      return { type: "escalate_ai", targetAI: "gemini", rawText: text }
    } else if (target === "local") {
      return { type: "escalate_ai", targetAI: "local", rawText: text }
    } else {
      return { type: "escalate_ai", targetAI: "claude", rawText: text }
    }
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

  // Collect project context - flexible matching
  if (
    normalized.includes("collect context") ||
    (normalized.includes("learn") && normalized.includes("project")) ||
    (normalized.includes("scan") && normalized.includes("project")) ||
    (normalized.includes("understand") && normalized.includes("codebase"))
  ) {
    return { type: "collect_context", rawText: text }
  }

  // Task status: "what's the task status on A", "task status", "what is the task status"
  const taskStatusMatch = normalized.match(/^what('s| is) the task status(\s+(on|for)\s*(container\s*)?([a-d]|main))?$/i)
  if (taskStatusMatch) {
    const target = taskStatusMatch[5]?.toLowerCase() as ContainerId | undefined
    return { type: "task_status", containerId: target, rawText: text }
  }
  // Simpler form: "task status on A" or just "task status"
  const simpleTaskStatus = normalized.match(/^task status(\s+(on|for)\s*(container\s*)?([a-d]|main))?$/i)
  if (simpleTaskStatus) {
    const target = simpleTaskStatus[4]?.toLowerCase() as ContainerId | undefined
    return { type: "task_status", containerId: target, rawText: text }
  }

  // Wipe context / clear history
  if (
    normalized.includes("wipe context") ||
    normalized.includes("zero context") ||
    normalized.includes("clear context") ||
    normalized.includes("wipe history") ||
    normalized.includes("clear history") ||
    normalized.includes("reset context") ||
    normalized.includes("fresh start") ||
    normalized === "start fresh" ||
    normalized === "start over"
  ) {
    return { type: "wipe_context", rawText: text }
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
