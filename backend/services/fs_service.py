"""Filesystem service for directory browsing and fuzzy matching."""

import os
from pathlib import Path
from typing import List, Optional
from dataclasses import dataclass
from difflib import SequenceMatcher


@dataclass
class DirectoryMatch:
    """Represents a fuzzy-matched directory."""
    path: str
    name: str
    score: float  # Fuzzy match score 0.0-1.0


@dataclass
class DirectoryInfo:
    """Information about a directory."""
    path: str
    name: str
    is_project: bool  # Has package.json, pyproject.toml, etc.
    children: List[str]


def list_directory(path: str, max_depth: int = 1) -> List[str]:
    """
    List directory contents up to max_depth.

    Args:
        path: Starting directory path (supports ~ expansion)
        max_depth: How deep to recurse (1 = immediate children only)

    Returns:
        List of absolute directory paths
    """
    result = []
    base = Path(path).expanduser().resolve()

    if not base.exists() or not base.is_dir():
        return result

    def walk(current: Path, depth: int):
        if depth > max_depth:
            return
        try:
            for item in sorted(current.iterdir()):
                # Skip hidden directories and common non-project dirs
                if item.name.startswith('.'):
                    continue
                if item.name in ('node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build'):
                    continue
                if item.is_dir():
                    result.append(str(item))
                    walk(item, depth + 1)
        except PermissionError:
            pass

    walk(base, 0)
    return result


def fuzzy_match(query: str, candidates: List[str], threshold: float = 0.4) -> List[DirectoryMatch]:
    """
    Fuzzy match a query against directory paths.

    Args:
        query: Search term (e.g., "social")
        candidates: List of directory paths to search
        threshold: Minimum score to include (0.0-1.0)

    Returns:
        List of matches sorted by score descending
    """
    matches = []
    query_lower = query.lower()

    for path in candidates:
        name = Path(path).name.lower()

        # Exact match gets highest score
        if name == query_lower:
            score = 1.0
        # Exact substring match gets high score
        elif query_lower in name:
            # Prefer matches at the start
            if name.startswith(query_lower):
                score = 0.9
            else:
                score = 0.7
        # Check if query words appear in name
        elif all(word in name for word in query_lower.split()):
            score = 0.6
        else:
            # Use sequence matcher for fuzzy matching
            score = SequenceMatcher(None, query_lower, name).ratio()

        if score >= threshold:
            matches.append(DirectoryMatch(
                path=path,
                name=Path(path).name,
                score=score
            ))

    # Sort by score descending
    matches.sort(key=lambda m: m.score, reverse=True)
    return matches


def find_directory(
    hint: str,
    parent_hint: Optional[str] = None,
    search_root: str = "~/dev"
) -> List[DirectoryMatch]:
    """
    Find directories matching a hint, optionally under a parent hint.

    Args:
        hint: Directory name to search for (e.g., "social")
        parent_hint: Optional parent directory hint (e.g., "dev" for "under dev")
        search_root: Root directory to search from

    Returns:
        List of matching directories sorted by relevance
    """
    root = Path(search_root).expanduser().resolve()

    if not root.exists():
        return []

    # Get all directories up to depth 3
    all_dirs = list_directory(str(root), max_depth=3)

    # If parent hint provided, filter to directories under matching parents
    if parent_hint:
        parent_matches = fuzzy_match(parent_hint, all_dirs, threshold=0.5)
        if parent_matches:
            # Search only under the best matching parent(s)
            filtered_dirs = []
            for parent in parent_matches[:3]:  # Check top 3 parent matches
                parent_path = parent.path
                for d in all_dirs:
                    if d.startswith(parent_path + os.sep) and d != parent_path:
                        filtered_dirs.append(d)
            if filtered_dirs:
                all_dirs = filtered_dirs

    return fuzzy_match(hint, all_dirs)


def get_directory_info(path: str) -> DirectoryInfo:
    """
    Get information about a directory.

    Args:
        path: Directory path

    Returns:
        DirectoryInfo with path, name, project detection, and children
    """
    p = Path(path).expanduser().resolve()

    # Check for project markers
    project_markers = [
        'package.json', 'pyproject.toml', 'Cargo.toml',
        'go.mod', 'pom.xml', 'build.gradle', 'Makefile',
        'requirements.txt', 'setup.py', 'CMakeLists.txt'
    ]
    is_project = any((p / marker).exists() for marker in project_markers)

    children = []
    try:
        for item in sorted(p.iterdir()):
            if not item.name.startswith('.'):
                children.append(item.name)
        children = children[:20]  # Limit to 20 items
    except PermissionError:
        pass

    return DirectoryInfo(
        path=str(p),
        name=p.name,
        is_project=is_project,
        children=children
    )


def resolve_path(path: str) -> str:
    """Resolve a path with ~ expansion to absolute path."""
    return str(Path(path).expanduser().resolve())
