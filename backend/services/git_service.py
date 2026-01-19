"""Git worktree service for multi-branch work support."""

import asyncio
import os
import re
from pathlib import Path
from typing import List, Dict, Optional, Any


def get_work_dir() -> Path:
    """Get the working directory for git operations."""
    return Path(os.getenv("CLAUDE_WORK_DIR", str(Path.home() / "dev")))


def get_worktrees_dir() -> Path:
    """Get the directory where worktrees are created."""
    return get_work_dir().parent / ".worktrees"


def sanitize_branch_name(branch: str) -> str:
    """Sanitize branch name for use as directory name.

    Args:
        branch: Git branch name

    Returns:
        Safe directory name
    """
    # Replace slashes with dashes, remove other special chars
    safe = re.sub(r"[/\\]", "-", branch)
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", safe)
    return safe


async def get_current_branch() -> Optional[str]:
    """Get the current branch of the main working directory.

    Returns:
        Branch name or None if not a git repo
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "rev-parse", "--abbrev-ref", "HEAD",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, _ = await proc.communicate()

        if proc.returncode != 0:
            return None

        return stdout.decode().strip()

    except Exception:
        return None


async def list_branches() -> List[Dict[str, Any]]:
    """List all branches in the repository.

    Returns:
        List of branch info dicts with name, current, hasWorktree
    """
    branches = []
    current = await get_current_branch()

    try:
        # Get all branches
        proc = await asyncio.create_subprocess_exec(
            "git", "branch", "-a", "--format=%(refname:short)",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, _ = await proc.communicate()

        if proc.returncode != 0:
            return []

        # Get existing worktrees
        worktrees = await list_worktrees()
        worktree_branches = {w["branch"] for w in worktrees}

        for line in stdout.decode().strip().split("\n"):
            branch = line.strip()
            if not branch or branch.startswith("origin/"):
                continue

            branches.append({
                "name": branch,
                "current": branch == current,
                "hasWorktree": branch in worktree_branches,
            })

    except Exception:
        pass

    return branches


async def list_worktrees() -> List[Dict[str, Any]]:
    """List all existing worktrees.

    Returns:
        List of worktree info dicts with path, branch, head
    """
    worktrees = []

    try:
        proc = await asyncio.create_subprocess_exec(
            "git", "worktree", "list", "--porcelain",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        stdout, _ = await proc.communicate()

        if proc.returncode != 0:
            return []

        # Parse porcelain output
        current_wt: Dict[str, Any] = {}
        for line in stdout.decode().split("\n"):
            line = line.strip()
            if not line:
                if current_wt:
                    worktrees.append(current_wt)
                    current_wt = {}
                continue

            if line.startswith("worktree "):
                current_wt["path"] = line[9:]
            elif line.startswith("HEAD "):
                current_wt["head"] = line[5:]
            elif line.startswith("branch "):
                # refs/heads/branch-name -> branch-name
                current_wt["branch"] = line[7:].replace("refs/heads/", "")
            elif line == "detached":
                current_wt["detached"] = True

        if current_wt:
            worktrees.append(current_wt)

    except Exception:
        pass

    return worktrees


async def create_worktree(branch: str) -> Dict[str, Any]:
    """Create a worktree for a branch.

    If the worktree already exists, returns its info.
    If the branch doesn't exist, creates it from current HEAD.

    Args:
        branch: Branch name

    Returns:
        Dict with success, path, branch, error
    """
    worktrees_dir = get_worktrees_dir()
    worktrees_dir.mkdir(parents=True, exist_ok=True)

    safe_name = sanitize_branch_name(branch)
    worktree_path = worktrees_dir / safe_name

    # Check if worktree already exists
    if worktree_path.exists():
        return {
            "success": True,
            "path": str(worktree_path),
            "branch": branch,
            "existed": True,
        }

    try:
        # Check if branch exists
        proc = await asyncio.create_subprocess_exec(
            "git", "rev-parse", "--verify", f"refs/heads/{branch}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        await proc.communicate()
        branch_exists = proc.returncode == 0

        if branch_exists:
            # Create worktree for existing branch
            proc = await asyncio.create_subprocess_exec(
                "git", "worktree", "add", str(worktree_path), branch,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=get_work_dir()
            )
        else:
            # Create new branch and worktree
            proc = await asyncio.create_subprocess_exec(
                "git", "worktree", "add", "-b", branch, str(worktree_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=get_work_dir()
            )

        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            return {
                "success": False,
                "error": stderr.decode().strip() or "Failed to create worktree",
            }

        return {
            "success": True,
            "path": str(worktree_path),
            "branch": branch,
            "created": True,
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


async def remove_worktree(branch: str) -> Dict[str, Any]:
    """Remove a worktree.

    Args:
        branch: Branch name

    Returns:
        Dict with success, error
    """
    safe_name = sanitize_branch_name(branch)
    worktree_path = get_worktrees_dir() / safe_name

    if not worktree_path.exists():
        return {
            "success": False,
            "error": "Worktree does not exist",
        }

    try:
        # Remove the worktree
        proc = await asyncio.create_subprocess_exec(
            "git", "worktree", "remove", str(worktree_path), "--force",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        _, stderr = await proc.communicate()

        if proc.returncode != 0:
            return {
                "success": False,
                "error": stderr.decode().strip() or "Failed to remove worktree",
            }

        return {"success": True}

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
        }


def get_worktree_path(branch: Optional[str]) -> Path:
    """Get the working path for a branch.

    If branch is None or doesn't have a worktree, returns main working dir.

    Args:
        branch: Branch name or None

    Returns:
        Path to use for git/Claude operations
    """
    if not branch:
        return get_work_dir()

    safe_name = sanitize_branch_name(branch)
    worktree_path = get_worktrees_dir() / safe_name

    if worktree_path.exists():
        return worktree_path

    return get_work_dir()


async def cleanup_orphaned_worktrees() -> int:
    """Remove worktrees that no longer have a corresponding branch.

    Returns:
        Number of worktrees removed
    """
    removed = 0

    try:
        # Prune worktrees first
        proc = await asyncio.create_subprocess_exec(
            "git", "worktree", "prune",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=get_work_dir()
        )
        await proc.communicate()

        # Get list of branches
        branches = await list_branches()
        branch_names = {b["name"] for b in branches}

        # Check each worktree directory
        worktrees_dir = get_worktrees_dir()
        if worktrees_dir.exists():
            for item in worktrees_dir.iterdir():
                if item.is_dir():
                    # If no branch matches this worktree, remove it
                    matching = any(
                        sanitize_branch_name(b) == item.name
                        for b in branch_names
                    )
                    if not matching:
                        result = await remove_worktree(item.name)
                        if result.get("success"):
                            removed += 1

    except Exception:
        pass

    return removed
