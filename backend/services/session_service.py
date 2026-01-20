"""Session persistence service for Todo/Brain mode storage."""

import json
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Literal

# Session storage directory
SESSIONS_DIR = Path(__file__).parent.parent / "data" / "sessions"


# === Data Types ===

@dataclass
class Message:
    """Chat message in a category conversation."""
    id: str
    role: Literal["user", "assistant"]
    text: str
    source: Optional[str] = None  # "gemini" | "claude" | "local"


@dataclass
class Task:
    """A task item in a TodoCategory."""
    id: str
    text: str
    completed: bool = False
    createdAt: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


@dataclass
class BrainEntry:
    """An entry in a BrainCategory."""
    id: str
    text: str
    createdAt: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


@dataclass
class TodoCategory:
    """A category in Todo mode containing tasks and AI conversation."""
    id: str
    name: str
    order: int
    tasks: List[Task] = field(default_factory=list)
    messages: List[Message] = field(default_factory=list)
    activeAI: Literal["gemini", "claude", "local"] = "local"
    directoryPath: Optional[str] = None
    status: str = "idle"
    projectContext: Optional[str] = None
    speakingId: Optional[str] = None


@dataclass
class BrainCategory:
    """A category in Brain mode containing timestamped entries."""
    id: str
    name: str
    order: int
    entries: List[BrainEntry] = field(default_factory=list)
    directoryPath: Optional[str] = None


@dataclass
class Session:
    """Full session with Todo and Brain categories."""
    id: str
    createdAt: str
    updatedAt: str
    activeMode: Literal["todo", "brain"] = "todo"
    todoCategories: List[TodoCategory] = field(default_factory=list)
    brainCategories: List[BrainCategory] = field(default_factory=list)
    # Legacy containers field for backward compatibility
    containers: Dict[str, Any] = field(default_factory=dict)


# === Helpers ===

def _ensure_sessions_dir() -> None:
    """Create sessions directory if it doesn't exist."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _get_session_path(session_id: str) -> Path:
    """Get the file path for a session."""
    return SESSIONS_DIR / f"{session_id}.json"


def _session_to_dict(session: Session) -> Dict[str, Any]:
    """Convert Session dataclass to JSON-serializable dict."""
    return {
        "id": session.id,
        "createdAt": session.createdAt,
        "updatedAt": session.updatedAt,
        "activeMode": session.activeMode,
        "todoCategories": [asdict(c) for c in session.todoCategories],
        "brainCategories": [asdict(c) for c in session.brainCategories],
        "containers": session.containers,  # Legacy
    }


def _dict_to_session(data: Dict[str, Any]) -> Session:
    """Convert dict to Session dataclass."""
    todo_cats = []
    for cat_data in data.get("todoCategories", []):
        tasks = [Task(**t) for t in cat_data.get("tasks", [])]
        messages = [Message(**m) for m in cat_data.get("messages", [])]
        todo_cats.append(TodoCategory(
            id=cat_data["id"],
            name=cat_data["name"],
            order=cat_data.get("order", 0),
            tasks=tasks,
            messages=messages,
            activeAI=cat_data.get("activeAI", "local"),
        ))

    brain_cats = []
    for cat_data in data.get("brainCategories", []):
        entries = [BrainEntry(**e) for e in cat_data.get("entries", [])]
        brain_cats.append(BrainCategory(
            id=cat_data["id"],
            name=cat_data["name"],
            order=cat_data.get("order", 0),
            entries=entries,
        ))

    return Session(
        id=data["id"],
        createdAt=data["createdAt"],
        updatedAt=data["updatedAt"],
        activeMode=data.get("activeMode", "todo"),
        todoCategories=todo_cats,
        brainCategories=brain_cats,
        containers=data.get("containers", {}),
    )


def _save_session(session: Session) -> None:
    """Save session to file."""
    session_path = _get_session_path(session.id)
    with open(session_path, "w") as f:
        json.dump(_session_to_dict(session), f, indent=2)


# === Session CRUD ===

def create_session() -> Dict[str, Any]:
    """Create a new session with a unique ID.

    Returns:
        Session dict with id, timestamps, and empty categories
    """
    _ensure_sessions_dir()

    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    session = Session(
        id=session_id,
        createdAt=now,
        updatedAt=now,
        activeMode="todo",
        todoCategories=[],
        brainCategories=[],
        containers={},
    )

    _save_session(session)
    return _session_to_dict(session)


def get_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve a session by ID.

    Args:
        session_id: The session UUID

    Returns:
        Session dict or None if not found
    """
    session_path = _get_session_path(session_id)

    if not session_path.exists():
        return None

    try:
        with open(session_path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def update_session(session_id: str, containers: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a session's container data (legacy support).

    Args:
        session_id: The session UUID
        containers: Dict mapping containerId to container data

    Returns:
        Updated session dict or None if not found
    """
    session_data = get_session(session_id)

    if session_data is None:
        return None

    session_data["containers"] = containers
    session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    session_path = _get_session_path(session_id)
    with open(session_path, "w") as f:
        json.dump(session_data, f, indent=2)

    return session_data


def update_session_full(session_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a full session with new schema.

    Args:
        session_id: The session UUID
        data: Full session data including categories

    Returns:
        Updated session dict or None if not found
    """
    session_data = get_session(session_id)

    if session_data is None:
        return None

    # Update fields
    if "activeMode" in data:
        session_data["activeMode"] = data["activeMode"]
    if "todoCategories" in data:
        session_data["todoCategories"] = data["todoCategories"]
    if "brainCategories" in data:
        session_data["brainCategories"] = data["brainCategories"]
    if "containers" in data:
        session_data["containers"] = data["containers"]

    session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    session_path = _get_session_path(session_id)
    with open(session_path, "w") as f:
        json.dump(session_data, f, indent=2)

    return session_data


def delete_session(session_id: str) -> bool:
    """Delete a session.

    Args:
        session_id: The session UUID

    Returns:
        True if deleted, False if not found
    """
    session_path = _get_session_path(session_id)

    if not session_path.exists():
        return False

    try:
        session_path.unlink()
        return True
    except IOError:
        return False


def list_sessions(limit: int = 50) -> List[Dict[str, Any]]:
    """List recent sessions.

    Args:
        limit: Maximum number of sessions to return

    Returns:
        List of session metadata (id, createdAt, updatedAt)
    """
    _ensure_sessions_dir()

    sessions = []
    for session_file in SESSIONS_DIR.glob("*.json"):
        try:
            with open(session_file, "r") as f:
                data = json.load(f)
                sessions.append({
                    "id": data.get("id"),
                    "createdAt": data.get("createdAt"),
                    "updatedAt": data.get("updatedAt"),
                    "activeMode": data.get("activeMode", "todo"),
                    "todoCount": len(data.get("todoCategories", [])),
                    "brainCount": len(data.get("brainCategories", [])),
                    "containerCount": len(data.get("containers", {})),  # Legacy
                })
        except (json.JSONDecodeError, IOError):
            continue

    # Sort by updatedAt descending
    sessions.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)

    return sessions[:limit]


# === Category CRUD ===

def create_category(session_id: str, mode: Literal["todo", "brain"], name: str) -> Optional[Dict[str, Any]]:
    """Create a new category in a session.

    Args:
        session_id: The session UUID
        mode: "todo" or "brain"
        name: Category name

    Returns:
        The created category dict or None if session not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return None

    category_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    if mode == "todo":
        categories = session_data.get("todoCategories", [])
        category = {
            "id": category_id,
            "name": name,
            "order": len(categories),
            "tasks": [],
            "messages": [],
            "activeAI": "local",
        }
        categories.append(category)
        session_data["todoCategories"] = categories
    else:
        categories = session_data.get("brainCategories", [])
        category = {
            "id": category_id,
            "name": name,
            "order": len(categories),
            "entries": [],
        }
        categories.append(category)
        session_data["brainCategories"] = categories

    session_data["updatedAt"] = now
    _save_session(_dict_to_session(session_data))

    return category


def update_category(session_id: str, mode: Literal["todo", "brain"], category_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a category.

    Args:
        session_id: The session UUID
        mode: "todo" or "brain"
        category_id: The category UUID
        updates: Fields to update (name, order, etc.)

    Returns:
        Updated category dict or None if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return None

    key = "todoCategories" if mode == "todo" else "brainCategories"
    categories = session_data.get(key, [])

    for i, cat in enumerate(categories):
        if cat["id"] == category_id:
            # Update allowed fields
            if "name" in updates:
                cat["name"] = updates["name"]
            if "order" in updates:
                cat["order"] = updates["order"]
            if mode == "todo" and "activeAI" in updates:
                cat["activeAI"] = updates["activeAI"]
            if "directoryPath" in updates:
                cat["directoryPath"] = updates["directoryPath"]

            categories[i] = cat
            session_data[key] = categories
            session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _save_session(_dict_to_session(session_data))
            return cat

    return None


def delete_category(session_id: str, mode: Literal["todo", "brain"], category_id: str) -> bool:
    """Delete a category.

    Args:
        session_id: The session UUID
        mode: "todo" or "brain"
        category_id: The category UUID

    Returns:
        True if deleted, False if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return False

    key = "todoCategories" if mode == "todo" else "brainCategories"
    categories = session_data.get(key, [])

    for i, cat in enumerate(categories):
        if cat["id"] == category_id:
            categories.pop(i)
            # Reorder remaining
            for j, c in enumerate(categories):
                c["order"] = j
            session_data[key] = categories
            session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _save_session(_dict_to_session(session_data))
            return True

    return False


def reorder_categories(session_id: str, mode: Literal["todo", "brain"], category_ids: List[str]) -> bool:
    """Reorder categories.

    Args:
        session_id: The session UUID
        mode: "todo" or "brain"
        category_ids: List of category IDs in desired order

    Returns:
        True if reordered, False if session not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return False

    key = "todoCategories" if mode == "todo" else "brainCategories"
    categories = session_data.get(key, [])

    # Create lookup
    cat_map = {c["id"]: c for c in categories}

    # Reorder based on provided IDs
    reordered = []
    for i, cid in enumerate(category_ids):
        if cid in cat_map:
            cat = cat_map[cid]
            cat["order"] = i
            reordered.append(cat)

    session_data[key] = reordered
    session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    _save_session(_dict_to_session(session_data))

    return True


# === Task CRUD (Todo mode) ===

def create_task(session_id: str, category_id: str, text: str) -> Optional[Dict[str, Any]]:
    """Create a new task in a Todo category.

    Args:
        session_id: The session UUID
        category_id: The category UUID
        text: Task text

    Returns:
        The created task dict or None if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return None

    categories = session_data.get("todoCategories", [])

    for cat in categories:
        if cat["id"] == category_id:
            task = {
                "id": str(uuid.uuid4()),
                "text": text,
                "completed": False,
                "createdAt": datetime.utcnow().isoformat() + "Z",
            }
            cat["tasks"].append(task)
            session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _save_session(_dict_to_session(session_data))
            return task

    return None


def update_task(session_id: str, task_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update a task.

    Args:
        session_id: The session UUID
        task_id: The task UUID
        updates: Fields to update (text, completed)

    Returns:
        Updated task dict or None if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return None

    for cat in session_data.get("todoCategories", []):
        for i, task in enumerate(cat.get("tasks", [])):
            if task["id"] == task_id:
                if "text" in updates:
                    task["text"] = updates["text"]
                if "completed" in updates:
                    task["completed"] = updates["completed"]

                cat["tasks"][i] = task
                session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
                _save_session(_dict_to_session(session_data))
                return task

    return None


def delete_task(session_id: str, task_id: str) -> bool:
    """Delete a task.

    Args:
        session_id: The session UUID
        task_id: The task UUID

    Returns:
        True if deleted, False if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return False

    for cat in session_data.get("todoCategories", []):
        for i, task in enumerate(cat.get("tasks", [])):
            if task["id"] == task_id:
                cat["tasks"].pop(i)
                session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
                _save_session(_dict_to_session(session_data))
                return True

    return False


# === Entry CRUD (Brain mode) ===

def create_entry(session_id: str, category_id: str, text: str) -> Optional[Dict[str, Any]]:
    """Create a new entry in a Brain category.

    Args:
        session_id: The session UUID
        category_id: The category UUID
        text: Entry text

    Returns:
        The created entry dict or None if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return None

    categories = session_data.get("brainCategories", [])

    for cat in categories:
        if cat["id"] == category_id:
            entry = {
                "id": str(uuid.uuid4()),
                "text": text,
                "createdAt": datetime.utcnow().isoformat() + "Z",
            }
            cat["entries"].append(entry)
            session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
            _save_session(_dict_to_session(session_data))
            return entry

    return None


def delete_entry(session_id: str, entry_id: str) -> bool:
    """Delete a brain entry.

    Args:
        session_id: The session UUID
        entry_id: The entry UUID

    Returns:
        True if deleted, False if not found
    """
    session_data = get_session(session_id)
    if session_data is None:
        return False

    for cat in session_data.get("brainCategories", []):
        for i, entry in enumerate(cat.get("entries", [])):
            if entry["id"] == entry_id:
                cat["entries"].pop(i)
                session_data["updatedAt"] = datetime.utcnow().isoformat() + "Z"
                _save_session(_dict_to_session(session_data))
                return True

    return False
