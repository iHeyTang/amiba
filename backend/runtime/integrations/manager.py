"""Integration lifecycle as plain Python: list / install / remove / reload.

Returns plain dicts, raises plain exceptions. The backplane's
``/hermes/integrations*`` admin routes (``integrations_gateway``) wrap this and
the desktop UI drives those — there is no ``hermes integration`` CLI anymore
(this framework used to be a hermes plugin; it now lives in the backplane).

HTTP-agnostic: knows nothing about routers or aiohttp. Install writes files +
updates the in-process registry via :mod:`loader`.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import loader as _loader
from .loader import USER_INTEGRATIONS_DIR

logger = logging.getLogger(__name__)

_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_NAME_MAX_LEN = 32
_AUDIT_LOG = USER_INTEGRATIONS_DIR / ".audit.log"


class IntegrationError(Exception):
    """Raised by manager operations. CLI prints .args[0]; HTTP turns it into 400."""


class NameInvalid(IntegrationError):
    pass


class NameTaken(IntegrationError):
    pass


class NotFound(IntegrationError):
    pass


def validate_name(name: object) -> str:
    if (
        not isinstance(name, str)
        or not _NAME_RE.match(name)
        or len(name) > _NAME_MAX_LEN
    ):
        raise NameInvalid(
            f"invalid name {name!r}; must match {_NAME_RE.pattern} "
            f"(max {_NAME_MAX_LEN} chars)"
        )
    return name


def _resolve_target_dir(name: str) -> Path:
    target = (USER_INTEGRATIONS_DIR / name).resolve()
    root = USER_INTEGRATIONS_DIR.resolve()
    if not (target == root or root in target.parents):
        raise NameInvalid(f"resolved path {target} escapes {root}")
    return target


def _audit(event: str, **fields: object) -> None:
    try:
        USER_INTEGRATIONS_DIR.mkdir(parents=True, exist_ok=True)
        record = {"ts": time.time(), "event": event, **fields}
        with _AUDIT_LOG.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        logger.exception("audit log write failed (event=%s)", event)


def _manifest_name(src_dir: Path) -> Optional[str]:
    """Read ``name`` from ``<src_dir>/integration.yaml`` if present."""
    meta = _loader._read_meta(src_dir)
    name = meta.get("name")
    return name if isinstance(name, str) and name else None


def _git_clone(url: str, ref: Optional[str], subdir: Optional[str]) -> Dict[str, Any]:
    """Clone *url* (optionally at *ref*) into a temp dir; return src + sha + tmp_root."""
    tmp_root = Path(tempfile.mkdtemp(prefix="hermes-integration-"))
    clone_dir = tmp_root / "repo"
    cmd = ["git", "clone", "--depth", "1"]
    if ref:
        cmd += ["--branch", ref]
    cmd += [url, str(clone_dir)]
    try:
        subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=120)
    except FileNotFoundError as exc:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise IntegrationError("git not found on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise IntegrationError(f"git clone timed out: {url}") from exc
    except subprocess.CalledProcessError as exc:
        shutil.rmtree(tmp_root, ignore_errors=True)
        detail = (exc.stderr or "").strip().splitlines()[-1:] or [str(exc)]
        raise IntegrationError(f"git clone failed: {detail[0]}") from exc

    try:
        sha = subprocess.run(
            ["git", "-C", str(clone_dir), "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True, timeout=30,
        ).stdout.strip()
    except Exception:
        sha = ref or "HEAD"

    src = clone_dir
    if subdir:
        candidate = (clone_dir / subdir).resolve()
        if clone_dir.resolve() not in candidate.parents and candidate != clone_dir.resolve():
            shutil.rmtree(tmp_root, ignore_errors=True)
            raise IntegrationError(f"subdir {subdir!r} escapes the cloned repo")
        if not candidate.is_dir():
            shutil.rmtree(tmp_root, ignore_errors=True)
            raise IntegrationError(f"subdir {subdir!r} not found in {url}")
        src = candidate
    return {"src": src, "sha": sha, "tmp_root": tmp_root}


def list_integrations() -> Dict[str, Any]:
    """Snapshot of loaded + last-scan failures."""
    state = _loader.get_state()
    loaded = [
        {
            "name": e.name,
            "path": str(e.path),
            "mount": f"/integrations/{e.name}/",
            "version": (e.meta or {}).get("version"),
            "description": (e.meta or {}).get("description"),
            "endpoints": (e.meta or {}).get("endpoints"),
            "has_search": e.search is not None,
        }
        for e in state.loaded
    ]
    return {
        "integrations": loaded,
        "failed": list(state.failed),
        "user_dir": str(USER_INTEGRATIONS_DIR),
    }


def install(
    name: Optional[str] = None,
    *,
    handler_py: Optional[str] = None,
    init_py: Optional[str] = None,
    yaml: Optional[str] = None,
    extra_files: Optional[Dict[str, str]] = None,
    from_path: Optional[str] = None,
    from_git: Optional[str] = None,
    git_ref: Optional[str] = None,
    subdir: Optional[str] = None,
    overwrite: bool = False,
) -> Dict[str, Any]:
    """Write files for *name* under ``~/.hermes/integrations/<name>/``.

    Sources (first match wins): ``from_git`` (clone), ``from_path`` (copy),
    or inline (``handler_py`` etc.). For dir sources ``name`` may be omitted —
    read from the package's ``integration.yaml``. Does not reload the registry;
    the caller does (CLI pokes the backplane; admin endpoint chains reload).
    """
    tmp_root: Optional[Path] = None
    target: Optional[Path] = None
    provenance: Optional[Dict[str, Any]] = None
    try:
        src_dir: Optional[Path] = None
        if isinstance(from_git, str) and from_git:
            cloned = _git_clone(from_git, git_ref, subdir)
            tmp_root = cloned["tmp_root"]
            src_dir = cloned["src"]
            provenance = {"git": from_git, "ref": git_ref, "sha": cloned["sha"], "subdir": subdir}
        elif isinstance(from_path, str) and from_path:
            src_dir = Path(from_path).expanduser()
            if not src_dir.is_dir():
                raise IntegrationError(f"from_path {src_dir} is not a directory")

        if not (isinstance(name, str) and name):
            if src_dir is not None:
                name = _manifest_name(src_dir)
            if not (isinstance(name, str) and name):
                raise IntegrationError("name not given and not found in integration.yaml")
        validate_name(name)

        target = _resolve_target_dir(name)
        if target.exists():
            if not overwrite:
                raise NameTaken(
                    f"{name!r} already exists at {target}; pass overwrite=True to replace"
                )
            shutil.rmtree(target)

        if src_dir is not None:
            shutil.copytree(src_dir, target)
            if provenance is not None:
                (target / ".source.json").write_text(
                    json.dumps(provenance, ensure_ascii=False, indent=2), encoding="utf-8"
                )
        else:
            if handler_py is None and init_py is None:
                raise IntegrationError(
                    "provide handler_py (or init_py), a from_path, or a from_git source"
                )
            target.mkdir(parents=True, exist_ok=False)
            if isinstance(handler_py, str):
                (target / "handler.py").write_text(handler_py, encoding="utf-8")
            ip = init_py if init_py is not None else "from .handler import search  # noqa: F401\n"
            (target / "__init__.py").write_text(ip, encoding="utf-8")
            if isinstance(yaml, str) and yaml.strip():
                (target / "integration.yaml").write_text(yaml, encoding="utf-8")
            if extra_files:
                for filename, content in extra_files.items():
                    if not isinstance(filename, str) or not isinstance(content, str):
                        continue
                    if "/" in filename or "\\" in filename or filename.startswith("."):
                        continue
                    (target / filename).write_text(content, encoding="utf-8")
    except Exception:
        if target is not None:
            shutil.rmtree(target, ignore_errors=True)
        raise
    finally:
        if tmp_root is not None:
            shutil.rmtree(tmp_root, ignore_errors=True)

    _audit("install", name=name, path=str(target), overwrite=overwrite, source=provenance)
    return {
        "ok": True,
        "name": name,
        "path": str(target),
        "wrote": sorted(p.name for p in target.iterdir()),
        "source": provenance,
    }


def remove(name: str) -> Dict[str, Any]:
    """Delete files + drop from the in-process registry."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not target.exists():
        raise NotFound(f"{name!r} not found at {target}")
    shutil.rmtree(target)
    dropped = _loader.drop(name)
    _audit("remove", name=name, path=str(target), dropped=dropped)
    return {"ok": True, "name": name, "deleted_path": str(target), "dropped": dropped}


def reload(name: str) -> Dict[str, Any]:
    """Re-import + swap the integration in the in-process registry."""
    validate_name(name)
    target = _resolve_target_dir(name)
    if not target.exists() or not (target / "__init__.py").exists():
        raise NotFound(f"{name!r} not found at {target}")
    try:
        entry = _loader.load_one(name)
    except Exception as exc:
        _audit("reload_failed", name=name, error=str(exc))
        raise IntegrationError(f"reload failed: {exc}") from exc
    _audit("reload", name=name, path=str(target))
    return {
        "ok": True,
        "name": name,
        "path": str(entry.path),
        "mount": f"/integrations/{name}/",
        "meta": entry.meta,
    }
