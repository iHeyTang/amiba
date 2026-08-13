"""Wire each installed mention source's resolver skill into the agent.

A mention source is a cross-cutting bundle: a ``search`` capability the backplane
serves to the composer (this package's :mod:`loader`) **and** a resolver skill
the agent reads when a mentioned handle shows up in a turn. The composer half is
served over HTTP here; the agent half is plain skill markdown under
``~/.hermes/mention-sources/<name>/skills/``.

The agent discovers skills via ``skills.external_dirs`` in ``~/.hermes/
config.yaml``. The backplane owns this wiring. We add each source's ``skills/``
dir idempotently; the agent picks them up on its next start.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import List

from .loader import USER_SOURCES_DIR

logger = logging.getLogger(__name__)

_SKILLS_DIRNAME = "skills"


def _collect_skills_dirs() -> List[Path]:
    """Every legacy source's resolver ``skills/`` dir on disk."""
    dirs: List[Path] = []
    try:
        if USER_SOURCES_DIR.is_dir():
            for entry in sorted(USER_SOURCES_DIR.iterdir()):
                if not entry.is_dir() or entry.name.startswith("."):
                    continue
                sk = (entry / _SKILLS_DIRNAME).resolve()
                if sk.is_dir():
                    dirs.append(sk)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not scan source skills dirs: %s", exc)
    return dirs


def wire_skills_dirs() -> None:
    """Idempotently add every source's ``skills/`` dir to
    ``skills.external_dirs`` so resolver skills enter the system-prompt index.

    Failures are swallowed + logged: a broken/managed config must not take the
    backplane down. Always re-adds missing absolute paths on the next call.
    """
    targets = _collect_skills_dirs()
    if not targets:
        return
    try:
        from hermes_cli.config import load_config, save_config, is_managed
    except Exception as exc:  # noqa: BLE001
        logger.debug("hermes_cli.config import failed, skipping skills wiring: %s", exc)
        return
    try:
        if is_managed():
            logger.debug("Managed config — leaving skills.external_dirs alone")
            return
        config = load_config()
        if not isinstance(config, dict):
            config = {}
        skills_section = config.get("skills")
        if not isinstance(skills_section, dict):
            skills_section = {}
        raw_dirs = skills_section.get("external_dirs")
        if raw_dirs is None:
            existing: list = []
        elif isinstance(raw_dirs, str):
            existing = [raw_dirs]
        elif isinstance(raw_dirs, list):
            existing = list(raw_dirs)
        else:
            logger.warning(
                "skills.external_dirs has unexpected type %s; not modifying",
                type(raw_dirs).__name__,
            )
            return

        hermes_home = USER_SOURCES_DIR.parent
        resolved_existing: set = set()
        for entry in existing:
            try:
                s = str(entry).strip()
                if not s:
                    continue
                expanded = os.path.expanduser(os.path.expandvars(s))
                p = Path(expanded)
                p = p.resolve() if p.is_absolute() else (hermes_home / p).resolve()
                resolved_existing.add(p)
            except Exception:  # noqa: BLE001
                continue

        added: list = []
        for target in targets:
            if target in resolved_existing:
                continue
            existing.append(str(target))
            resolved_existing.add(target)
            added.append(str(target))
        if not added:
            return
        skills_section["external_dirs"] = existing
        config["skills"] = skills_section
        save_config(config)
        logger.info("Added mention-source skills dirs to skills.external_dirs: %s", added)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to wire mention-source skills dirs into config.yaml: %s", exc)
