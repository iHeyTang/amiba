"""Mention-source lifecycle = git OR local-path, tracked in a small registry.

A mention source is a directory under ``~/.hermes/mention-sources/<name>/``. Two
install methods, recorded per-source in ``.registry.json`` so lifecycle can
dispatch on provenance instead of guessing:

- **git**  — ``git clone <url>`` into the dir (a real checkout). Update = ``git
  pull``. For distribution.
- **path** — a **symlink** to a local directory (editable, like ``pip install
  -e``). Edits to the dev repo are live; "update" just re-imports — NO git.

So `update` reads the registry and does the right thing (pull vs reload); it
never blindly git-pulls a local-path source. Remove = delete the dir/symlink +
drop the registry entry.

HTTP-agnostic: returns plain dicts, raises plain exceptions. The caller reloads
the in-process registry via :mod:`loader` after a mutation.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import loader as _loader
from .loader import USER_SOURCES_DIR, validate_name

logger = logging.getLogger(__name__)

_REGISTRY_PATH = USER_SOURCES_DIR / ".registry.json"


class SourceError(Exception):
    """Raised by manager operations. CLI/HTTP turn .args[0] into a message."""


class NameInvalid(SourceError):
    pass


class NameTaken(SourceError):
    pass


class NotFound(SourceError):
    pass


# --- registry: name -> origin {method, url?/ref?/path?} ---------------------


def _read_registry() -> Dict[str, Any]:
    try:
        with _REGISTRY_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except FileNotFoundError:
        return {}
    except Exception as exc:  # noqa: BLE001
        logger.warning("mention-sources registry unreadable (%s); ignoring", exc)
        return {}


def _write_registry(reg: Dict[str, Any]) -> None:
    try:
        USER_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        with _REGISTRY_PATH.open("w", encoding="utf-8") as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        logger.warning("could not write mention-sources registry: %s", exc)


def _set_origin(name: str, origin: Dict[str, Any]) -> None:
    reg = _read_registry()
    reg[name] = origin
    _write_registry(reg)


def _drop_origin(name: str) -> None:
    reg = _read_registry()
    if name in reg:
        del reg[name]
        _write_registry(reg)


def get_origin(name: str) -> Optional[Dict[str, Any]]:
    """Recorded install method for *name*, or inferred for legacy installs."""
    origin = _read_registry().get(name)
    if isinstance(origin, dict) and origin.get("method"):
        return origin
    # Legacy (installed before the registry existed): infer from disk.
    target = USER_SOURCES_DIR / name
    if target.is_symlink():
        return {"method": "path", "path": str(target.resolve())}
    if (target / ".git").is_dir() and _git_remote_url(target):
        return {"method": "git", "url": _git_remote_url(target)}
    return None


# --- helpers ----------------------------------------------------------------


def _resolve_target_dir(name: str) -> Path:
    """``<sources>/<name>`` with a traversal guard. Does NOT resolve symlinks
    (we want the symlink path itself, not its target)."""
    root = USER_SOURCES_DIR.resolve()
    target = root / name
    if not (target == root or root in target.resolve().parents or root in target.parents):
        raise NameInvalid(f"resolved path {target} escapes {root}")
    return target


def _remove_target(target: Path) -> None:
    """Delete a source dir or unlink a symlink."""
    if target.is_symlink():
        target.unlink()
    elif target.exists():
        shutil.rmtree(target)


def _manifest_name(src_dir: Path) -> Optional[str]:
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


def _git_remote_url(dir_: Path) -> Optional[str]:
    if not (dir_ / ".git").is_dir():
        return None
    try:
        out = subprocess.run(
            ["git", "-C", str(dir_), "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=15,
        )
        url = out.stdout.strip()
        return url or None
    except Exception:  # noqa: BLE001
        return None


# --- lifecycle --------------------------------------------------------------


def _diagnose_unloaded(name: str, origin: Optional[Dict[str, Any]]) -> str:
    """Human hint for a registered source that isn't currently loaded.

    The registry says it's installed but the loader didn't pick it up — usually
    because the on-disk target moved out from under a symlink. Tells the user
    what's wrong and that Remove (then re-install) is the way out.
    """
    target = USER_SOURCES_DIR / name
    if target.is_symlink() and not target.exists():
        try:
            dest = os.readlink(target)
        except OSError:
            dest = "?"
        return (
            f"symlink target is gone ({dest}) — the local source was moved or "
            f"renamed; Remove this and re-install from its new path"
        )
    if not target.exists() and not target.is_symlink():
        recorded = (origin or {}).get("path") or (origin or {}).get("url")
        where = f" ({recorded})" if recorded else ""
        return f"install location no longer exists{where} — Remove and re-install"
    if not (target / "__init__.py").exists():
        return "source folder has no __init__.py — not a valid mention source"
    return "registered but not loaded — try Reload, or Remove and re-install"


def list_sources() -> Dict[str, Any]:
    """Installed-source snapshot, with the **registry** as the source of truth.

    A source counts as installed iff it's in ``.registry.json`` (or present on
    disk as a legacy install predating the registry). Every row carries a
    ``status``:

    - ``loaded``  — imported cleanly; ``search`` is live.
    - ``failed``  — on disk but raised while importing (``error`` has details).
    - ``missing`` — in the registry but its target can't be found/loaded
      (dangling symlink, deleted dir, no ``__init__.py``). Surfaced with a hint
      so it doesn't silently vanish from the UI while still blocking re-install.
    """
    state = _loader.get_state()
    rows: List[Dict[str, Any]] = []
    seen: set = set()

    def _row(name: str, *, status: str, entry=None, origin=None, error=None) -> Dict[str, Any]:
        meta = (entry.meta or {}) if entry is not None else {}
        return {
            "name": name,
            "path": str(entry.path) if entry is not None else str(USER_SOURCES_DIR / name),
            "search_mount": f"/mention-sources/{name}/search",
            "version": meta.get("version"),
            "description": meta.get("description"),
            "has_search": entry.search is not None if entry is not None else False,
            "origin": origin if origin is not None else get_origin(name),
            "status": status,
            **({"error": error} if error else {}),
        }

    for e in state.loaded:
        seen.add(e.name)
        rows.append(_row(e.name, status="loaded", entry=e))

    for f in state.failed:
        name = f.get("name", "")
        if not name or name in seen:
            continue
        seen.add(name)
        rows.append(_row(name, status="failed", error=f.get("error")))

    # Registry is authoritative: list entries the loader never picked up (e.g. a
    # dangling symlink) instead of letting them disappear from the snapshot.
    for name, origin in _read_registry().items():
        if name in seen:
            continue
        seen.add(name)
        clean = origin if isinstance(origin, dict) else None
        rows.append(_row(name, status="missing", origin=clean, error=_diagnose_unloaded(name, clean)))

    return {
        "sources": rows,
        "failed": list(state.failed),  # kept for backward-compat consumers
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
    """Install a mention source.

    ``from_git`` → ``git clone`` (a real checkout; updatable via ``git pull``).
    ``from_path`` → **symlink** to the local dir (editable; edits are live).
    ``name`` may be omitted — read from the manifest. Records the install method
    in ``.registry.json``. Does not reload the registry; the caller does.
    """
    if from_git:
        return _install_git(name=name, url=from_git, ref=git_ref, overwrite=overwrite)
    if from_path:
        return _install_path(name=name, path=from_path, overwrite=overwrite)
    raise SourceError("provide a from_git URL or a from_path directory")


def _install_git(*, name, url, ref, overwrite) -> Dict[str, Any]:
    tmp_root = Path(tempfile.mkdtemp(prefix="hermes-mention-source-"))
    try:
        clone_dir = tmp_root / "repo"
        clone_args = ["clone", "--depth", "1"]
        if ref:
            clone_args += ["--branch", ref]
        clone_args += [url, str(clone_dir)]
        _run_git(clone_args)

        if not (isinstance(name, str) and name):
            name = _manifest_name(clone_dir)
        if not (isinstance(name, str) and name):
            raise SourceError("name not given and not found in the manifest")
        validate_name(name)

        target = _resolve_target_dir(name)
        if target.exists() or target.is_symlink():
            if not overwrite:
                raise NameTaken(f"{name!r} already exists at {target}; pass overwrite=True")
            _remove_target(target)

        USER_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        shutil.move(str(clone_dir), str(target))
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

    origin = {"method": "git", "url": url, "ref": ref}
    _set_origin(name, origin)
    return {"ok": True, "name": name, "path": str(target), "method": "git", "origin": origin}


def _install_path(*, name, path, overwrite) -> Dict[str, Any]:
    src = Path(path).expanduser().resolve()
    if not src.is_dir():
        raise SourceError(f"from_path {src} is not a directory")
    if not (isinstance(name, str) and name):
        name = _manifest_name(src)
    if not (isinstance(name, str) and name):
        raise SourceError("name not given and not found in the manifest")
    validate_name(name)

    target = _resolve_target_dir(name)
    if target.exists() or target.is_symlink():
        if not overwrite:
            raise NameTaken(f"{name!r} already exists at {target}; pass overwrite=True")
        _remove_target(target)

    USER_SOURCES_DIR.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(src, target, target_is_directory=True)  # editable dev install
    except OSError as exc:
        raise SourceError(f"could not symlink {target} -> {src}: {exc}") from exc

    origin = {"method": "path", "path": str(src)}
    _set_origin(name, origin)
    return {"ok": True, "name": name, "path": str(src), "method": "path", "origin": origin}


def update(name: str) -> Dict[str, Any]:
    """Update a source the way it was installed: git → ``git pull``; local path →
    just re-import the (live, symlinked) code. Never git-pulls a path source."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not (target.exists() or target.is_symlink()):
        raise NotFound(f"{name!r} not found at {target}")

    origin = get_origin(name)
    method = (origin or {}).get("method")
    action: str
    if method == "git":
        _run_git(["-C", str(target), "pull", "--ff-only"], timeout=120)
        action = "git pull"
    elif method == "path":
        action = "reload (editable)"  # symlink already points at live code
    else:
        # Unknown/legacy: pull only if there's a real remote, else just reload.
        if _git_remote_url(target):
            _run_git(["-C", str(target), "pull", "--ff-only"], timeout=120)
            action = "git pull"
        else:
            action = "reload"

    entry = _loader.load_one(name)
    return {"ok": True, "name": name, "method": method or "unknown", "action": action, "meta": entry.meta}


def reload(name: str) -> Dict[str, Any]:
    """Re-import a source into the registry without touching git/disk."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not (target.exists() or target.is_symlink()) or not (target / "__init__.py").exists():
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
    """Delete the source dir/symlink, drop from the registry + the in-process state."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not (target.exists() or target.is_symlink()):
        raise NotFound(f"{name!r} not found at {target}")
    _remove_target(target)
    _drop_origin(name)
    dropped = _loader.drop(name)
    return {"ok": True, "name": name, "deleted_path": str(target), "dropped": dropped}
