# Speaker Voice Patterns

This document describes the natural language patterns the voice assistant recognizes for app actions. When in Local LLM mode, the system uses AI-powered intent detection to understand these commands.

## How It Works

1. User speaks a command in natural language
2. The Local LLM analyzes the intent
3. If it's an app action, the system executes it
4. If it's a question, it routes to the conversational AI

## App Actions

### Category Management

**Create a category:**
- "Create a new category called [name]"
- "Make a new container for [project]"
- "Create a category and connect it to [directory]"
- "New container for the [name] project"
- "Set up a workspace for [name]"

**Examples:**
- "Create a new category called Frontend"
- "Make a container for the social media project"
- "Create a new container and hook it up to the social directory under dev"

### Directory Operations

**Link a directory:**
- "Hook up [category] to the [directory] folder"
- "Link this category to [path]"
- "Connect to [directory]"
- "Associate directory [path]"
- "Set the directory to [path]"

**Find a directory:**
- "Find the [name] directory"
- "Where is [name]"
- "Locate [name] folder"
- "Find [name] under [parent]"

**List directories:**
- "What directories are under [path]"
- "List folders in [location]"
- "Show directories"

**Examples:**
- "Link this to the frontend folder under assistant"
- "Find the social directory under dev"
- "What folders are under my dev directory"

### Navigation

**Navigate to a category:**
- "Go to [category name]"
- "Switch to the [name] category"
- "Open [category name]"

**Examples:**
- "Go to the Frontend category"
- "Switch to my work container"

## Fuzzy Matching

The system uses fuzzy matching for both directory and category names:

| User Says | Matches |
|-----------|---------|
| "social" | social, social-media, social-app |
| "front" | frontend, front-end, frontpage |
| "assistant" | assistant, voice-assistant |

## Parent Directory Hints

You can specify where to search with phrases like:
- "under dev" - searches in directories containing "dev"
- "in the assistant folder" - searches within assistant/
- "inside frontend" - searches within frontend/

## Natural Language Examples

| User Says | Action |
|-----------|--------|
| "Create a new container and hook it up to the social directory under dev" | Creates category, finds `~/dev/*/social*`, links it |
| "I want to work on the assistant project" | Finds assistant directory, creates/selects category |
| "Find where the frontend code is" | Searches for frontend directories |
| "What projects do I have under dev" | Lists directories in ~/dev |
| "Link this to the backend folder" | Finds and links backend directory |

## Configuration

The filesystem search root defaults to `~/dev`. Set the `FS_SEARCH_ROOT` environment variable to change it:

```bash
export FS_SEARCH_ROOT=~/projects
```

## Extending Patterns

The intent detection is powered by the Local LLM, which means:
- New patterns can be understood without code changes
- The LLM uses semantic understanding, not just keyword matching
- Context from recent conversation helps disambiguation

To add new action types, update:
1. `backend/services/intent_service.py` - Add ActionType enum value and update prompt
2. `backend/services/action_executor.py` - Add handler method
3. `frontend/src/hooks/useSharedVoice.ts` - Add action_result handler
