// Legacy container IDs for backward compatibility
const CONTAINER_NAMES = ["main", "a", "b", "c", "d"] as const
type ContainerId = typeof CONTAINER_NAMES[number]

export type VoiceCommandType =
  | "switch_container"
  | "switch_category"
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
  | "repeat_message"
  | "ignored"
  // Task queue commands
  | "cancel_queue_task"
  | "queue_status"
  | "clear_queue"
  // Git worktree commands
  | "switch_branch"
  | "list_branches"
  // Voice toggle mode commands
  | "stop_listening"
  | "send_now"
  // Category management commands
  | "manage_categories"
  | "list_categories"
  | "set_directory"
  | "create_category_with_name"
  | "list_directory"

export interface VoiceCommand {
  type: VoiceCommandType
  containerId?: ContainerId  // Legacy container IDs
  categoryId?: string  // Category UUID for AppContext
  categoryName?: string  // For category switching by name (fuzzy match)
  targetAI?: "gemini" | "claude" | "local"
  messageOffset?: number  // For repeat_message: 1 = last, 2 = second last, etc.
  branch?: string  // For switch_branch command
  directoryPath?: string  // For set_directory command
  rawText: string
}

// Common mishearings of "Claude"
const CLAUDE_VARIANTS = ["claude", "cloud", "claw", "clude", "clawed", "clode"]

// Container name patterns
const CONTAINER_PATTERN = /(?:container\s*)?([a-d])/i

export function parseVoiceCommand(text: string): VoiceCommand | null {
  const normalized = text.toLowerCase().trim().replace(/[.!?,]/g, "")

  // === Container Commands ===

  // Switch to container: flexible patterns (legacy)
  // "switch to main", "switch to main container", "switch to container a", "switch to a",
  // "change to main", "go to container b", "switch to the main container", etc.
  const switchMatch = normalized.match(/^(switch|change|go)\s+to\s+(the\s+)?(main|container\s*[a-d]|[a-d])(\s+container)?$/i)
  if (switchMatch) {
    const target = switchMatch[3].toLowerCase().replace(/container\s*/, "")
    if (target === "main" || CONTAINER_NAMES.includes(target as ContainerId)) {
      return { type: "switch_container", containerId: target as ContainerId, rawText: text }
    }
  }

  // Switch to category: "switch to [name]", "go to [name] category", "select [name]"
  // Captures category name for fuzzy matching in the hook
  const categorySwitch = normalized.match(/^(switch|change|go|select)\s+(?:to\s+)?(?:the\s+)?(.+?)(?:\s+category)?$/i)
  if (categorySwitch) {
    const name = categorySwitch[2].trim()
    // Don't match if it looks like a container command or AI switch
    if (name && !CONTAINER_NAMES.includes(name as ContainerId) &&
        !["gemini", "claude", "local", "cloud", "claw"].includes(name)) {
      return { type: "switch_category", categoryName: name, rawText: text }
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

  // Repeat message commands
  // Simple: "repeat", "repeat that", "say that again", "what did you say", "come again"
  if (
    normalized === "repeat" ||
    normalized === "repeat that" ||
    normalized === "repeat this" ||
    normalized === "repeat it" ||
    normalized === "say that again" ||
    normalized === "say it again" ||
    normalized === "what did you say" ||
    normalized === "what was that" ||
    normalized === "come again" ||
    normalized === "pardon" ||
    normalized === "sorry what" ||
    normalized === "can you repeat that" ||
    normalized === "could you repeat that"
  ) {
    return { type: "repeat_message", messageOffset: 1, rawText: text }
  }

  // Indexed: "repeat the last message", "repeat the second last message", etc.
  const ordinals: Record<string, number> = {
    "last": 1,
    "first": 1,  // "first" in context of "repeat the first message" likely means last
    "second last": 2,
    "second to last": 2,
    "third last": 3,
    "third to last": 3,
    "fourth last": 4,
    "fourth to last": 4,
    "previous": 1,
    "one before": 2,
    "one before that": 2,
  }

  const repeatIndexMatch = normalized.match(
    /^repeat\s+(the\s+)?(last|first|second\s+(?:last|to\s+last)|third\s+(?:last|to\s+last)|fourth\s+(?:last|to\s+last)|previous|one\s+before(?:\s+that)?)\s*(?:message|response)?$/i
  )
  if (repeatIndexMatch) {
    const ordinalPhrase = repeatIndexMatch[2].toLowerCase()
    const offset = ordinals[ordinalPhrase] || 1
    return { type: "repeat_message", messageOffset: offset, rawText: text }
  }

  // Numeric: "repeat message 2", "repeat the 2nd message", "repeat the second message"
  const numericOrdinals: Record<string, number> = {
    "1": 1, "1st": 1, "first": 1,
    "2": 2, "2nd": 2, "second": 2,
    "3": 3, "3rd": 3, "third": 3,
    "4": 4, "4th": 4, "fourth": 4,
    "5": 5, "5th": 5, "fifth": 5,
  }

  const repeatNumericMatch = normalized.match(
    /^repeat\s+(the\s+)?(\d+|1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth)\s*(?:last\s+)?(?:message|response)?$/i
  )
  if (repeatNumericMatch) {
    const numericPhrase = repeatNumericMatch[2].toLowerCase()
    const offset = numericOrdinals[numericPhrase] || 1
    return { type: "repeat_message", messageOffset: offset, rawText: text }
  }

  // === Task Queue Commands ===

  // Cancel queue task: "cancel task", "cancel the task"
  if (
    normalized === "cancel task" ||
    normalized === "cancel the task" ||
    normalized === "cancel current task" ||
    normalized === "stop task"
  ) {
    return { type: "cancel_queue_task", rawText: text }
  }

  // Queue status: "queue status", "what's in the queue", "show queue"
  if (
    normalized === "queue status" ||
    normalized === "show queue" ||
    normalized === "whats in the queue" ||
    normalized === "what is in the queue" ||
    normalized === "check queue" ||
    normalized === "how many tasks"
  ) {
    return { type: "queue_status", rawText: text }
  }

  // Clear queue: "clear queue", "empty queue", "clear the queue"
  if (
    normalized === "clear queue" ||
    normalized === "clear the queue" ||
    normalized === "empty queue" ||
    normalized === "empty the queue" ||
    normalized === "cancel all tasks"
  ) {
    return { type: "clear_queue", rawText: text }
  }

  // === Git Worktree Commands ===

  // Switch branch: "switch to branch main", "use branch feature-x"
  const branchSwitchMatch = normalized.match(/^(switch to|use|checkout)\s+branch\s+(.+)$/i)
  if (branchSwitchMatch) {
    const branch = branchSwitchMatch[2].trim()
    return { type: "switch_branch", branch, rawText: text }
  }

  // List branches: "list branches", "what branches", "show branches"
  if (
    normalized === "list branches" ||
    normalized === "show branches" ||
    normalized === "what branches" ||
    normalized === "available branches" ||
    normalized.includes("what branches are available")
  ) {
    return { type: "list_branches", rawText: text }
  }

  // === Voice Toggle Mode Commands ===

  // Stop listening mode: "stop listening", "exit listening", "listening off"
  if (
    normalized === "stop listening" ||
    normalized === "exit listening" ||
    normalized === "listening off" ||
    normalized === "turn off listening" ||
    normalized === "disable listening"
  ) {
    return { type: "stop_listening", rawText: text }
  }

  // Send/process now: "send", "send it", "thats all", "im done"
  if (
    normalized === "send" ||
    normalized === "send it" ||
    normalized === "send now" ||
    normalized === "process" ||
    normalized === "process now" ||
    normalized === "thats all" ||
    normalized === "that is all" ||
    normalized === "im done" ||
    normalized === "i am done" ||
    normalized === "done talking" ||
    normalized === "finished"
  ) {
    return { type: "send_now", rawText: text }
  }

  // === Directory Commands ===

  // List directory: "list the directory", "show files here", "what files are here"
  const listDirMatch = normalized.match(
    /^(?:list|show)\s+(?:the\s+)?(?:directory|files|folder)(?:\s+here)?$/i
  )
  if (listDirMatch) {
    return { type: "list_directory", rawText: text }
  }

  // Also match: "what files are here", "what's in this directory"
  if (
    normalized === "what files are here" ||
    normalized === "whats in this directory" ||
    normalized === "what is in this directory" ||
    normalized === "show directory contents" ||
    normalized === "directory contents"
  ) {
    return { type: "list_directory", rawText: text }
  }

  // === Category Management Commands ===

  // Create category with specific name: "create a new category called Work", "make a category named Projects"
  const createCategoryWithNameMatch = normalized.match(
    /^(?:create|make|new|add)\s+(?:a\s+)?(?:new\s+)?category\s+(?:called|named)\s+(.+)$/i
  )
  if (createCategoryWithNameMatch) {
    const rawName = createCategoryWithNameMatch[1].trim()
    const categoryName = rawName
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ")
    return { type: "create_category_with_name", categoryName, rawText: text }
  }

  // Manage categories: "manage categories", "category settings", "create category", "new category"
  if (
    normalized === "manage categories" ||
    normalized === "category settings" ||
    normalized === "edit categories" ||
    normalized === "create category" ||
    normalized === "create a category" ||
    normalized === "new category" ||
    normalized === "create a new category" ||
    normalized === "add category" ||
    normalized === "add a category"
  ) {
    return { type: "manage_categories", rawText: text }
  }

  // List categories: "list categories", "what categories", "show categories"
  if (
    normalized === "list categories" ||
    normalized === "show categories" ||
    normalized === "what categories" ||
    normalized === "available categories" ||
    normalized.includes("what categories do i have") ||
    normalized.includes("what categories are there")
  ) {
    return { type: "list_categories", rawText: text }
  }

  // Set directory: "set directory to /path", "connect to /path", "associate directory /path"
  const setDirMatch = normalized.match(/^(?:set|connect|associate)\s+(?:this\s+)?(?:directory|folder|path)\s+(?:to\s+)?(.+)$/i)
  if (setDirMatch) {
    const dirPath = setDirMatch[1].trim()
    return { type: "set_directory", directoryPath: dirPath, rawText: text }
  }

  // Also match: "connect /path to this category", "connect the dev directory"
  const connectDirMatch = normalized.match(/^connect\s+(?:the\s+)?(.+?)(?:\s+to\s+(?:this|the)\s+category)?$/i)
  if (connectDirMatch && !normalized.includes("social")) {
    const dirPath = connectDirMatch[1].trim()
    // Only if it looks like a path (starts with / or ~ or contains /)
    if (dirPath.startsWith("/") || dirPath.startsWith("~") || dirPath.includes("/")) {
      return { type: "set_directory", directoryPath: dirPath, rawText: text }
    }
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
