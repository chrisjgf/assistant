"""Action executor - performs app actions based on detected intent."""

import os
from dataclasses import dataclass
from typing import Optional, List, Dict, Any

from services.intent_service import DetectedIntent, ActionType
from services import fs_service


@dataclass
class ActionResult:
    """Result of an executed action."""
    success: bool
    action_type: str
    message: str
    # Action-specific data
    category_id: Optional[str] = None
    category_name: Optional[str] = None
    directory_path: Optional[str] = None
    navigate_to: Optional[str] = None
    directory_matches: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary, excluding None values."""
        result = {
            "success": self.success,
            "action_type": self.action_type,
            "message": self.message,
        }
        optional_fields = [
            "category_id", "category_name", "directory_path",
            "navigate_to", "directory_matches", "error"
        ]
        for field in optional_fields:
            value = getattr(self, field)
            if value is not None:
                result[field] = value
        return result


class ActionExecutor:
    """Executes app actions based on detected intents."""

    def __init__(self, search_root: str = "~/dev", default_dir: Optional[str] = None):
        """
        Initialize the action executor.

        Args:
            search_root: Root directory for filesystem searches
            default_dir: Default directory when no context is provided (e.g., assistant directory)
        """
        self.search_root = search_root
        self.default_dir = default_dir

    def execute(self, intent: DetectedIntent, context_directory: Optional[str] = None) -> ActionResult:
        """
        Execute an action based on detected intent.

        Args:
            intent: The detected user intent
            context_directory: Optional directory path for context (e.g., category's linked directory)

        Returns:
            ActionResult with success status and action-specific data
        """
        # Store context for use in handlers - use context directory, fall back to default
        self._context_directory = context_directory or self.default_dir

        handlers = {
            ActionType.CREATE_CATEGORY: self._create_category,
            ActionType.LINK_DIRECTORY: self._link_directory,
            ActionType.NAVIGATE_CATEGORY: self._navigate_category,
            ActionType.FIND_DIRECTORY: self._find_directory,
            ActionType.LIST_DIRECTORIES: self._list_directories,
        }

        handler = handlers.get(intent.action_type)
        if handler:
            return handler(intent)

        # ActionType.QUESTION or unknown
        return ActionResult(
            success=False,
            action_type="question",
            message="This is a question, not an action",
        )

    def _create_category(self, intent: DetectedIntent) -> ActionResult:
        """
        Create a new category, optionally with directory link.

        The frontend will handle the actual category creation via AppContext.
        We prepare the data and find the directory if specified.
        """
        category_name = intent.category_name

        # If no name specified, try to derive from directory hint
        if not category_name and intent.directory_hint:
            category_name = intent.directory_hint.title()

        if not category_name:
            category_name = "New Category"

        result = ActionResult(
            success=True,
            action_type="create_category",
            message="",
            category_name=category_name,
            navigate_to=category_name if intent.navigate_after else None,
        )

        # If directory hint provided, find matching directory
        if intent.directory_hint:
            matches = fs_service.find_directory(
                intent.directory_hint,
                intent.parent_hint,
                self.search_root
            )
            if matches:
                best_match = matches[0]
                result.directory_path = best_match.path
                result.message = f"Create '{category_name}' linked to {best_match.name}"
            else:
                result.message = f"Create '{category_name}' (directory '{intent.directory_hint}' not found)"
        else:
            result.message = f"Create category '{category_name}'"

        return result

    def _link_directory(self, intent: DetectedIntent) -> ActionResult:
        """Link a directory to the current category."""
        if not intent.directory_hint:
            return ActionResult(
                success=False,
                action_type="link_directory",
                message="No directory specified",
                error="Please specify which directory to link"
            )

        matches = fs_service.find_directory(
            intent.directory_hint,
            intent.parent_hint,
            self.search_root
        )

        if not matches:
            return ActionResult(
                success=False,
                action_type="link_directory",
                message=f"Could not find directory matching '{intent.directory_hint}'",
                error="Directory not found"
            )

        best_match = matches[0]

        # If multiple good matches, include alternatives
        alternatives = None
        if len(matches) > 1 and matches[1].score > 0.5:
            alternatives = [
                {"path": m.path, "name": m.name, "score": m.score}
                for m in matches[:3]
            ]

        return ActionResult(
            success=True,
            action_type="link_directory",
            message=f"Linked to {best_match.name}",
            directory_path=best_match.path,
            directory_matches=alternatives,
        )

    def _navigate_category(self, intent: DetectedIntent) -> ActionResult:
        """Navigate to a category by name."""
        if not intent.category_name:
            return ActionResult(
                success=False,
                action_type="navigate_category",
                message="No category specified",
                error="Please specify which category to navigate to"
            )

        return ActionResult(
            success=True,
            action_type="navigate_category",
            message=f"Switching to '{intent.category_name}'",
            navigate_to=intent.category_name,
        )

    def _find_directory(self, intent: DetectedIntent) -> ActionResult:
        """Find and list matching directories."""
        if not intent.directory_hint:
            return ActionResult(
                success=False,
                action_type="find_directory",
                message="No directory specified",
                error="Please specify what directory to find"
            )

        matches = fs_service.find_directory(
            intent.directory_hint,
            intent.parent_hint,
            self.search_root
        )

        if not matches:
            return ActionResult(
                success=True,
                action_type="find_directory",
                message=f"No directories matching '{intent.directory_hint}' found",
                directory_matches=[]
            )

        # Format matches for response
        match_list = [
            {"path": m.path, "name": m.name, "score": m.score}
            for m in matches[:5]  # Top 5
        ]

        # Build spoken response
        if len(matches) == 1:
            message = f"Found {matches[0].name} at {matches[0].path}"
        else:
            names = ", ".join(m.name for m in matches[:3])
            message = f"Found {len(matches)} matches: {names}"

        return ActionResult(
            success=True,
            action_type="find_directory",
            message=message,
            directory_path=matches[0].path if matches else None,
            directory_matches=match_list
        )

    def _list_directories(self, intent: DetectedIntent) -> ActionResult:
        """List directories in a location."""
        # Priority: 1. parent hint, 2. context directory (linked dir), 3. search root
        list_path = self._context_directory or self.search_root

        if intent.parent_hint:
            # Try to find the parent directory first
            search_root = self._context_directory or self.search_root
            parent_matches = fs_service.find_directory(
                intent.parent_hint,
                None,
                search_root
            )
            if parent_matches:
                list_path = parent_matches[0].path

        dirs = fs_service.list_directory(list_path, max_depth=1)

        if not dirs:
            return ActionResult(
                success=True,
                action_type="list_directories",
                message=f"No directories found in {list_path}",
                directory_matches=[]
            )

        # Format directory list
        match_list = [
            {"path": d, "name": os.path.basename(d), "score": 1.0}
            for d in dirs[:10]  # Top 10
        ]

        names = ", ".join(os.path.basename(d) for d in dirs[:5])
        message = f"Found {len(dirs)} directories: {names}"
        if len(dirs) > 5:
            message += f" and {len(dirs) - 5} more"

        return ActionResult(
            success=True,
            action_type="list_directories",
            message=message,
            directory_matches=match_list
        )
