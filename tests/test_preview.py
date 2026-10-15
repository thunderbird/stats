import json
from unittest.mock import Mock

import pytest

from stats_pipeline.preview import ADI_SOURCE, prepare_preview_data, refresh_adi


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def test_preview_reuses_current_snapshot_and_retains_channel_observations(tmp_path):
    website, state, output = (tmp_path / name for name in ("website", "state", "output"))
    output.mkdir()
    old = {"count": 70, "versions": {"140": 70}}
    current = {"count": 100, "versions": {"140": 100}}
    enriched = {"count": 71, "versions": {"140": 71}, "channels": {"esr": {"140": 71}},
                "channel_coverage": {"total": 71, "classified": 71, "unknown": 0}}
    write_json(website / "thunderbird_adi.json", {"2026-10-11": old})
    write_json(state / "thunderbird_adi.json", {"2026-10-11": old, "2026-10-12": current})
    write_json(state / "adi-channels-preview.json", {"2026-10-11": enriched})
    write_json(state / "glean.json", {"schema": 1})
    write_json(state / "release_history.json", {"releases": []})
    write_json(website / "thunderbird_ami.json", {"2026-10-04": {"ami": 100}})
    write_json(state / "thunderbird_ami.json", {
        "2026-10-04": {"ami": 100}, "2026-10-11": {"ami": 110},
    })
    before = {path: path.read_bytes() for folder in (website, state) for path in folder.iterdir()}

    prepare_preview_data(website, state, output)

    assert json.loads((output / "thunderbird_adi.json").read_bytes()) == {
        "2026-10-11": enriched, "2026-10-12": current,
    }
    assert json.loads((output / "adi_daily_totals.json").read_bytes()) == {
        "source": "Authoritative ADI snapshot before local channel enrichment",
        "counts": {"2026-10-11": 70, "2026-10-12": 100},
    }
    assert (output / "glean.json").read_bytes() == (state / "glean.json").read_bytes()
    assert (output / "release_history.json").read_bytes() == (
        state / "release_history.json").read_bytes()
    assert (output / "thunderbird_ami.json").read_bytes() == (
        state / "thunderbird_ami.json").read_bytes()
    assert all(path.read_bytes() == body for path, body in before.items())


def test_channel_only_future_days_cannot_extend_authoritative_daily_dates(tmp_path):
    website, state, output = (tmp_path / name for name in ("website", "state", "output"))
    output.mkdir()
    record = {"count": 100, "versions": {"140": 100}}
    write_json(website / "thunderbird_adi.json", {"2026-10-11": record})
    write_json(state / "thunderbird_adi.json", {"2026-10-11": record})
    write_json(state / "adi-channels-preview.json", {"2026-10-12": record})

    prepare_preview_data(website, state, output)

    assert list(json.loads((output / "thunderbird_adi.json").read_bytes())) == ["2026-10-11"]


def test_preview_without_cached_snapshot_retains_existing_channel_fallback(tmp_path):
    website, state, output = (tmp_path / name for name in ("website", "state", "output"))
    output.mkdir()
    record = {"count": 100, "versions": {"140": 100}}
    write_json(website / "thunderbird_adi.json", {"2026-10-11": record})
    write_json(state / "adi-channels-preview.json", {"2026-10-12": record})

    prepare_preview_data(website, state, output)

    assert max(json.loads((output / "thunderbird_adi.json").read_bytes())) == "2026-10-12"
    assert not (output / "adi_daily_totals.json").exists()


def test_refresh_stores_public_snapshot_and_uses_network_only_when_requested(tmp_path):
    observations = {"2026-10-12": {"count": 9356503, "versions": {"140": 9356503}}}
    session = Mock()
    session.get.return_value.json.return_value = observations

    assert refresh_adi(tmp_path, session) == observations
    assert json.loads((tmp_path / "thunderbird_adi.json").read_bytes()) == observations
    session.get.assert_called_once_with(
        ADI_SOURCE, headers={"Cache-Control": "no-cache"}, timeout=60)
    session.get.return_value.raise_for_status.assert_called_once_with()


@pytest.mark.parametrize("invalid", [{}, [], {"2026-10-12": {"count": -1, "versions": {}}}])
def test_invalid_public_refresh_preserves_cached_snapshot(tmp_path, invalid):
    original = {"2026-10-11": {"count": 70, "versions": {"140": 70}}}
    target = tmp_path / "thunderbird_adi.json"
    write_json(target, original)
    before = target.read_bytes()
    session = Mock()
    session.get.return_value.json.return_value = invalid

    with pytest.raises(ValueError):
        refresh_adi(tmp_path, session)

    assert target.read_bytes() == before


def test_public_refresh_cannot_truncate_cached_history(tmp_path):
    target = tmp_path / "thunderbird_adi.json"
    write_json(target, {"2026-10-10": {"count": 70, "versions": {"140": 70}}})
    before = target.read_bytes()
    session = Mock()
    session.get.return_value.json.return_value = {
        "2026-10-12": {"count": 100, "versions": {"140": 100}}}

    with pytest.raises(ValueError, match="remove cached history"):
        refresh_adi(tmp_path, session)

    assert target.read_bytes() == before


@pytest.mark.parametrize("supplemental", [False, True])
def test_staging_build_preserves_snapshot_totals_and_isolates_supplements(tmp_path, supplemental):
    from stats_pipeline.cli import main

    website, data, supplements, output = (
        tmp_path / name for name in ("website", "snapshot", "supplements", "output"))
    website.mkdir()
    (website / "index.html").write_text("Reviewed dashboard")
    current = {"count": 100, "versions": {"140": 100}}
    enriched = {"count": 101, "versions": {"140": 101},
                "channels": {"esr": {"140": 101}},
                "channel_coverage": {"total": 101, "classified": 101, "unknown": 0}}
    write_json(data / "thunderbird_adi.json", {"2026-10-11": current})
    write_json(supplements / "adi-channels-preview.json", {
        "2026-10-11": enriched, "2026-10-12": enriched})
    write_json(supplements / "release_history.json", {"releases": []})
    write_json(supplements / "glean.json", {"metrics": {
        "filelink_uploaded_size": {"records": {"2026-10-11": {
            "count": 1, "total": 700, "versions": {"private-provider.invalid": 700}}}}}})
    manifest = tmp_path / "manifest.json"
    write_json(manifest, {"run_id": "production-snapshot", "files": {
        "thunderbird_adi.json": {}}})
    before = {path: path.read_bytes() for folder in (data, supplements)
              for path in folder.iterdir()}
    args = ["build", "--website", str(website), "--data", str(data),
            "--output", str(output), "--manifest", str(manifest), "--revision", "staging-code"]
    if supplemental:
        args += ["--supplemental-data", str(supplements)]

    main(args)

    assert json.loads((output / "data/adi-totals.json").read_bytes()) == {"2026-10-11": 100}
    assert json.loads((output / "thunderbird_adi.json").read_bytes()) == {
        "2026-10-11": enriched if supplemental else current}
    index = json.loads((output / "data/index.json").read_bytes())
    assert index["adi"]["end"] == "2026-10-11"
    assert bool(index["glean"]) == supplemental
    assert bool(index["releases"]) == supplemental
    if supplemental:
        for name in ("glean.json", "data/glean.json"):
            assert "private-provider.invalid" not in (output / name).read_text()
            assert '"__other__"' in (output / name).read_text()
    assert all(path.read_bytes() == body for path, body in before.items())
    assert json.loads((output / "deployment.json").read_bytes()) == {
        "snapshot": "production-snapshot", "website_revision": "staging-code"}
