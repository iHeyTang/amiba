"""Profile management backed by Hermes' public profile module.

Profiles are an upstream Hermes concept and remain authoritative there.  This
module only normalizes the Python objects into a stable JSON shape for Amiba;
it deliberately does not mirror profile state in a second store.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional


def _profiles_module():
    from hermes_cli import profiles as profiles_mod  # type: ignore

    return profiles_mod


def _profile_dir(name: str) -> Path:
    profiles_mod = _profiles_module()
    canon = profiles_mod.normalize_profile_name(name)
    profiles_mod.validate_profile_name(canon)
    if canon != "default" and not profiles_mod.profile_exists(canon):
        raise FileNotFoundError(f"Profile '{canon}' does not exist")
    path = Path(profiles_mod.get_profile_dir(canon))
    if not path.is_dir():
        raise FileNotFoundError(f"Profile '{canon}' does not exist")
    return path


def _profile_payload(info: Any) -> Dict[str, Any]:
    path = Path(getattr(info, "path", ""))
    return {
        "name": str(getattr(info, "name", "")),
        "path": str(path),
        "is_default": bool(getattr(info, "is_default", False)),
        "model": getattr(info, "model", None),
        "provider": getattr(info, "provider", None),
        "has_env": bool(getattr(info, "has_env", False)),
        "skill_count": int(getattr(info, "skill_count", 0) or 0),
        "gateway_running": bool(getattr(info, "gateway_running", False)),
        "description": str(getattr(info, "description", "") or ""),
        "description_auto": bool(getattr(info, "description_auto", False)),
        "distribution_name": getattr(info, "distribution_name", None),
        "distribution_version": getattr(info, "distribution_version", None),
        "distribution_source": getattr(info, "distribution_source", None),
        "soul_exists": (path / "SOUL.md").is_file(),
    }


def _pin_secondary_api_listener_off(profile_dir: Path) -> None:
    """Keep named profiles routable through the default multiplexer.

    Named profiles still need their own ``API_SERVER_KEY`` for `/p/<profile>`
    authentication. Hermes treats the presence of that key as an instruction
    to enable a standalone API listener unless config explicitly disables it;
    a secondary listener conflicts with multiplexing and the gateway skips the
    whole profile. Pinning only this listener off preserves every other
    profile-specific platform choice.
    """
    from hermes_cli.config import atomic_config_write, read_user_config_raw  # type: ignore

    config_path = profile_dir / "config.yaml"
    config = read_user_config_raw(config_path)
    if not isinstance(config, dict):
        config = {}
    platforms = config.setdefault("platforms", {})
    if not isinstance(platforms, dict):
        platforms = {}
        config["platforms"] = platforms
    api_server = platforms.setdefault("api_server", {})
    if not isinstance(api_server, dict):
        api_server = {}
        platforms["api_server"] = api_server
    if api_server.get("enabled") is False:
        return
    api_server["enabled"] = False
    atomic_config_write(config_path, config)


def list_profiles_response() -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    profile_infos = list(profiles_mod.list_profiles())
    # Migrate profiles created before Amiba adopted Hermes multiplex routing.
    # The write is idempotent and touches only the secondary API-listener flag.
    for item in profile_infos:
        if str(getattr(item, "name", "")) == "default":
            continue
        try:
            _pin_secondary_api_listener_off(Path(getattr(item, "path", "")))
        except Exception:
            # Listing remains useful even when one profile is read-only.
            pass
    profiles = [_profile_payload(item) for item in profile_infos]
    try:
        active = profiles_mod.get_active_profile() or "default"
    except Exception:
        active = "default"
    try:
        current = profiles_mod.get_active_profile_name() or "default"
    except Exception:
        current = "default"
    return {"ok": True, "profiles": profiles, "active": active, "current": current}


def create_profile(
    name: str,
    *,
    clone_from: Optional[str] = None,
    description: str = "",
) -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    source = (clone_from or "").strip() or None
    path = profiles_mod.create_profile(
        name=name,
        clone_from=source,
        clone_config=source is not None,
        description=description,
    )
    if source is None:
        # Keep parity with `hermes profile create`: fresh profiles receive the
        # bundled skills, while cloned profiles already copied their source.
        profiles_mod.seed_profile_skills(path, quiet=True)
    _pin_secondary_api_listener_off(Path(path))
    # Hermes' own CLI and dashboard both create the convenience launcher when
    # the alias is safe. Profiles created from Amiba should behave identically
    # when the user later switches to the terminal.
    if not profiles_mod.check_alias_collision(name):
        profiles_mod.create_wrapper_script(name)
    return {"ok": True, "name": profiles_mod.normalize_profile_name(name)}


def rename_profile(name: str, new_name: str) -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    profiles_mod.rename_profile(name, new_name)
    return {"ok": True, "name": profiles_mod.normalize_profile_name(new_name)}


def delete_profile(name: str) -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    profiles_mod.delete_profile(name, yes=True)
    return {"ok": True}


def set_active_profile(name: str) -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    profiles_mod.set_active_profile(name)
    return {"ok": True, "active": profiles_mod.normalize_profile_name(name)}


def read_profile_soul(name: str) -> Dict[str, Any]:
    path = _profile_dir(name) / "SOUL.md"
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {"ok": True, "content": "", "exists": False}
    return {"ok": True, "content": content, "exists": True}


def write_profile_soul(name: str, content: str) -> Dict[str, Any]:
    path = _profile_dir(name) / "SOUL.md"
    path.write_text(content, encoding="utf-8")
    return {"ok": True, "exists": True}


def write_profile_description(name: str, description: str) -> Dict[str, Any]:
    profiles_mod = _profiles_module()
    profiles_mod.write_profile_meta(
        _profile_dir(name),
        description=description.strip(),
        description_auto=False,
    )
    return {
        "ok": True,
        "description": description.strip(),
        "description_auto": False,
    }
