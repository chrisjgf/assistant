"""Session persistence service for conversation storage."""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

# Session storage directory
SESSIONS_DIR = Path(__file__).parent.parent / "data" / "sessions"


def _ensure_sessions_dir() -> None:
    """Create sessions directory if it doesn't exist."""
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)


def _get_session_path(session_id: str) -> Path:
    """Get the file path for a session."""
    return SESSIONS_DIR / f"{session_id}.json"


def create_session() -> Dict[str, Any]:
    """Create a new session with a unique ID.

    Returns:
        Session dict with id, timestamps, and empty containers
    """
    _ensure_sessions_dir()

    session_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat() + "Z"

    session = {
        "id": session_id,
        "createdAt": now,
        "updatedAt": now,
        "containers": {}
    }

    # Save immediately
    session_path = _get_session_path(session_id)
    with open(session_path, "w") as f:
        json.dump(session, f, indent=2)

    return session


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
    """Update a session's container data.

    Args:
        session_id: The session UUID
        containers: Dict mapping containerId to container data

    Returns:
        Updated session dict or None if not found
    """
    session = get_session(session_id)

    if session is None:
        return None

    session["containers"] = containers
    session["updatedAt"] = datetime.utcnow().isoformat() + "Z"

    session_path = _get_session_path(session_id)
    with open(session_path, "w") as f:
        json.dump(session, f, indent=2)

    return session


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
                    "containerCount": len(data.get("containers", {}))
                })
        except (json.JSONDecodeError, IOError):
            continue

    # Sort by updatedAt descending
    sessions.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)

    return sessions[:limit]
