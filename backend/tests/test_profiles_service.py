from pathlib import Path
from types import SimpleNamespace

from amiba_backplane.runtime.features.hermes_proxy.settings import profiles_service


def test_create_profile_matches_hermes_cli_side_effects(monkeypatch, tmp_path):
    calls = []
    fake = SimpleNamespace(
        create_profile=lambda **kwargs: calls.append(("create", kwargs)) or tmp_path,
        seed_profile_skills=lambda path, quiet: calls.append(
            ("seed", Path(path), quiet)
        ),
        check_alias_collision=lambda name: False,
        create_wrapper_script=lambda name: calls.append(("wrapper", name)),
        normalize_profile_name=lambda name: name.lower(),
    )
    monkeypatch.setattr(profiles_service, "_profiles_module", lambda: fake)
    monkeypatch.setattr(
        profiles_service,
        "_pin_secondary_api_listener_off",
        lambda path: calls.append(("pin", Path(path))),
    )

    result = profiles_service.create_profile("Researcher")

    assert result == {"ok": True, "name": "researcher"}
    assert ("seed", tmp_path, True) in calls
    assert ("wrapper", "Researcher") in calls
    assert ("pin", tmp_path) in calls


def test_clone_profile_keeps_hermes_as_the_source_of_truth(monkeypatch, tmp_path):
    calls = []
    fake = SimpleNamespace(
        create_profile=lambda **kwargs: calls.append(("create", kwargs)) or tmp_path,
        seed_profile_skills=lambda *args, **kwargs: calls.append(("seed",)),
        check_alias_collision=lambda name: True,
        create_wrapper_script=lambda name: calls.append(("wrapper", name)),
        normalize_profile_name=lambda name: name,
    )
    monkeypatch.setattr(profiles_service, "_profiles_module", lambda: fake)
    monkeypatch.setattr(
        profiles_service,
        "_pin_secondary_api_listener_off",
        lambda path: None,
    )

    profiles_service.create_profile("reviewer", clone_from="default")

    assert calls == [
        (
            "create",
            {
                "name": "reviewer",
                "clone_from": "default",
                "clone_config": True,
                "description": "",
            },
        )
    ]
