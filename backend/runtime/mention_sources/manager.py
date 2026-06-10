"""Mention-source lifecycle = plain git operations: list / install / remove / update.

A mention source is just a directory under ``~/.hermes/mention-sources/<name>/``
— authored, versioned, and shared as a **git repo**. So maintenance IS git;
there's no bespoke package manager:

- **install** = ``git clone <url>`` into the sources dir (or copy a local path),
- **update**  = ``git -C <dir> pull``,
- **remove**  = delete the dir.

That hands versioning / update / provenance / rollback to git instead of
reinventing worse versions of them. The backplane's ``/hermes/mention-sources*``
admin routes wrap these; the desktop UI drives them.

HTTP-agnostic: returns plain dicts, raises plain exceptions. The caller reloads
the in-process registry via :mod:`loader` after a mutation.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import loader as _loader
from .loader import USER_SOURCES_DIR, validate_name

logger = logging.getLogger(__name__)


class SourceError(Exception):
    """Raised by manager operations. CLI/HTTP turn .args[0] into a message."""


class NameInvalid(SourceError):
    pass


class NameTaken(SourceError):
    pass


class NotFound(SourceError):
    pass


def _resolve_target_dir(name: str) -> Path:
    """``<sources>/<name>`` with a traversal guard."""
    target = (USER_SOURCES_DIR / name).resolve()
    root = USER_SOURCES_DIR.resolve()
    if not (target == root or root in target.parents):
        raise NameInvalid(f"resolved path {target} escapes {root}")
    return target


def _manifest_name(src_dir: Path) -> Optional[str]:
    """Read ``name`` from the source's manifest, if present."""
    meta = _loader._read_meta(src_dir)
    name = meta.get("name")
    return name if isinstance(name, str) and name else None


def _run_git(args: List[str], *, timeout: int = 120) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["git", *args], check=True, capture_output=True, text=True, timeout=timeout
        )
    except FileNotFoundError as exc:
        raise SourceError("git not found on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise SourceError(f"git timed out: git {' '.join(args[:2])}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip().splitlines()[-1:] or [str(exc)]
        raise SourceError(f"git failed: {detail[0]}") from exc


def list_sources() -> Dict[str, Any]:
    """Snapshot of loaded sources + last-scan failures (read from the registry)."""
    state = _loader.get_state()
    loaded = [
        {
            "name": e.name,
            "path": str(e.path),
            "search_mount": f"/mention-sources/{e.name}/search",
            "version": (e.meta or {}).get("version"),
            "description": (e.meta or {}).get("description"),
            "has_search": e.search is not None,
            "is_git": (e.path / ".git").is_dir(),
        }
        for e in state.loaded
    ]
    return {
        "sources": loaded,
        "failed": list(state.failed),
        "user_dir": str(USER_SOURCES_DIR),
    }


def install(
    *,
    name: Optional[str] = None,
    from_git: Optional[str] = None,
    git_ref: Optional[str] = None,
    from_path: Optional[str] = None,
    overwrite: bool = False,
) -> Dict[str, Any]:
    """Install a mention source under ``~/.hermes/mention-sources/<name>/``.

    ``from_git`` → ``git clone`` (the install dir stays a git repo, so
    :func:`update` can ``git pull`` it). ``from_path`` → copy a local dir (for
    development). ``name`` may be omitted for either — it's read from the
    source's manifest. Does not reload the registry; the caller does.
    """
    tmp_root: Optional[Path] = None
    try:
        # 1. Materialise the source into a temp dir (clone) or point at the path.
        src_dir: Optional[Path] = None
        if isinstance(from_git, str) and from_git:
            tmp_root = Path(tempfile.mkdtemp(prefix="hermes-mention-source-"))
            src_dir = tmp_root / "repo"
            clone_args = ["clone", "--depth", "1"]
            if git_ref:
                clone_args += ["--branch", git_ref]
            clone_args += [from_git, str(src_dir)]
            _run_git(clone_args)
        elif isinstance(from_path, str) and from_path:
            src_dir = Path(from_path).expanduser()
            if not src_dir.is_dir():
                raise SourceError(f"from_path {src_dir} is not a directory")
        else:
            raise SourceError("provide a from_git URL or a from_path directory")

        # 2. Resolve the name (given, else from the manifest).
        if not (isinstance(name, str) and name):
            name = _manifest_name(src_dir)
        if not (isinstance(name, str) and name):
            raise SourceError("name not given and not found in the manifest")
        validate_name(name)

        target = _resolve_target_dir(name)
        if target.exists():
            if not overwrite:
                raise NameTaken(f"{name!r} already exists at {target}; pass overwrite=True")
            shutil.rmtree(target)

        # 3. Move the clone (keeps .git → updatable) or copy the local path.
        USER_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        if tmp_root is not None:
            shutil.move(str(src_dir), str(target))
            tmp_root = None  # consumed by the move
        else:
            shutil.copytree(src_dir, target)
    finally:
        if tmp_root is not None:
            shutil.rmtree(tmp_root, ignore_errors=True)

    return {
        "ok": True,
        "name": name,
        "path": str(target),
        "is_git": (target / ".git").is_dir(),
    }


def update(name: str) -> Dict[str, Any]:
    """``git pull`` a git-installed source, then re-import it."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not target.exists():
        raise NotFound(f"{name!r} not found at {target}")
    if not (target / ".git").is_dir():
        raise SourceError(f"{name!r} isn't a git checkout; reinstall to update")
    _run_git(["-C", str(target), "pull", "--ff-only"], timeout=120)
    entry = _loader.load_one(name)
    return {"ok": True, "name": name, "path": str(entry.path), "meta": entry.meta}


def reload(name: str) -> Dict[str, Any]:
    """Re-import a source into the registry without touching git."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not target.exists() or not (target / "__init__.py").exists():
        raise NotFound(f"{name!r} not found at {target}")
    try:
        entry = _loader.load_one(name)
    except Exception as exc:
        raise SourceError(f"reload failed: {exc}") from exc
    return {
        "ok": True,
        "name": name,
        "path": str(entry.path),
        "search_mount": f"/mention-sources/{name}/search",
        "meta": entry.meta,
    }


def remove(name: str) -> Dict[str, Any]:
    """Delete the source dir + drop it from the registry."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not target.exists():
        raise NotFound(f"{name!r} not found at {target}")
    shutil.rmtree(target)
    dropped = _loader.drop(name)
    return {"ok": True, "name": name, "deleted_path": str(target), "dropped": dropped}
