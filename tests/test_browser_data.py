import json
from unittest.mock import Mock

import pytest

from stats_pipeline.browser_data import prepare
from stats_pipeline import releases
from stats_pipeline.validation import validate_record


def test_browser_partitions_preserve_all_counts_and_publish_optional_sources(tmp_path):
    data, output = tmp_path / "data", tmp_path / "site"
    data.mkdir()
    observations = {
        "2025-12-31": {"count": 101, "versions": {"128.0": 100, "3.0": 1}},
        "2026-01-01": {"count": 90, "versions": {"140.0": 90},
                       "channels": {"esr": {"140.0": 90}},
                       "channel_coverage": {"total": 90, "classified": 90, "unknown": 0}},
    }
    (data / "thunderbird_adi.json").write_text(json.dumps(observations))
    for name, value in [("glean.json", {"schema": 1}), ("release_history.json", {"releases": []})]:
        (data / name).write_text(json.dumps(value))
    prepare(data, output)
    manifest = json.loads((output / "data/index.json").read_text())
    combined = {}
    for chunk in manifest["adi"]["files"]:
        combined.update(json.loads((output / "data" / chunk["file"]).read_text()))
    assert combined == observations
    assert manifest["adi"]["channel_days"] == 1
    assert manifest["adi"]["channel_start"] == "2026-01-01"
    assert json.loads((output / "data" / manifest["adi"]["totals"]).read_text()) == {
        day: record["count"] for day, record in observations.items()
    }
    assert manifest["archive_end"] == "2025-05-31"
    assert (output / "data" / manifest["glean"]).is_file()
    assert (output / "data" / manifest["releases"]).is_file()


def test_authoritative_totals_do_not_rewrite_channel_observation_accounting(tmp_path):
    data, output = tmp_path / "data", tmp_path / "site"
    data.mkdir()
    observations = {
        "2026-10-11": {"count": 101, "versions": {"140.0": 101},
                       "channels": {"esr": {"140.0": 101}},
                       "channel_coverage": {"total": 101, "classified": 101, "unknown": 0}},
        "2026-10-12": {"count": 120, "versions": {"140.0": 120}},
    }
    totals = {"2026-10-11": 100, "2026-10-12": 120}
    (data / "thunderbird_adi.json").write_text(json.dumps(observations))
    (data / "adi_daily_totals.json").write_text(json.dumps({
        "source": "Authoritative published ADI snapshot", "counts": totals,
    }))

    prepare(data, output)

    assert json.loads((output / "data/adi-totals.json").read_bytes()) == totals
    assert json.loads((output / "data/adi-2026.json").read_bytes()) == observations
    manifest = json.loads((output / "data/index.json").read_bytes())
    assert manifest["adi"]["totals_source"] == "Authoritative published ADI snapshot"
    assert manifest["adi"]["end"] == "2026-10-12"
    assert manifest["adi"]["channel_end"] == "2026-10-11"


@pytest.mark.parametrize("payload", [
    {},
    {"source": "published", "counts": {}},
    {"source": "published", "counts": {"2026-10-12": -1}},
    {"source": "published", "counts": {"2026-10-12": 0}},
    {"source": "published", "counts": {"2026-10-12": 1.5}},
    {"source": "published", "counts": {"2026-10-12": True}},
    {"source": "", "counts": {"2026-10-12": 100}},
    {"source": "published", "counts": {"2026-10-11": 100, "2026-10-12": 100}},
])
def test_invalid_authoritative_totals_are_rejected(tmp_path, payload):
    (tmp_path / "thunderbird_adi.json").write_text(json.dumps({
        "2026-10-12": {"count": 100, "versions": {"140.0": 100}},
    }))
    (tmp_path / "adi_daily_totals.json").write_text(json.dumps(payload))

    with pytest.raises(ValueError):
        prepare(tmp_path, tmp_path / "site")


def test_manifest_references_must_exist(tmp_path):
    from stats_pipeline.website import verify_data_files
    target = tmp_path / "data"
    target.mkdir()
    (target / "index.json").write_text(json.dumps({
        "adi": {"files": [{"file": "adi-2026.json"}], "totals": "adi-totals.json"}
    }))
    with pytest.raises(ValueError, match="adi-2026.json"):
        verify_data_files(tmp_path)
    (target / "adi-2026.json").write_text("{}")
    with pytest.raises(ValueError, match="adi-totals.json"):
        verify_data_files(tmp_path)


@pytest.mark.parametrize("call", ["getJSON", "json", "fetch"])
def test_literal_json_dependencies_are_checked_for_modules(tmp_path, call):
    from stats_pipeline.website import verify_data_files
    (tmp_path / "chart.mjs").write_text(f'{call}("missing.json")')
    with pytest.raises(ValueError, match="missing.json"):
        verify_data_files(tmp_path)


def test_static_build_sanitizes_both_public_glean_paths(tmp_path):
    from stats_pipeline.website import build
    website, data, output = tmp_path / "source", tmp_path / "data", tmp_path / "site"
    website.mkdir()
    data.mkdir()
    (website / "index.html").write_text("Static dashboard")
    raw = {"metrics": {"filelink_uploaded_size": {"records": {"2026-10-11": {
        "count": 1, "total": 700, "versions": {"private-provider.invalid": 700}
    }}}}}
    (data / "glean.json").write_text(json.dumps(raw))
    (data / "thunderbird_adi.json").write_text(json.dumps({
        "2026-10-11": {"count": 10, "versions": {"140.0": 10}}
    }))
    build(website, data, output, {"run_id": "review", "files": {
        "glean.json": {}, "thunderbird_adi.json": {}
    }}, "test")
    for name in ("glean.json", "data/glean.json"):
        text = (output / name).read_text()
        assert "private-provider.invalid" not in text
        record = json.loads(text)["metrics"]["filelink_uploaded_size"]["records"]["2026-10-11"]
        assert record["versions"] == {"__other__": 700}
        assert record["total"] == 700
    assert json.loads((data / "glean.json").read_text()) == raw


@pytest.mark.parametrize("bad", [
    {"count": 1, "versions": {"140": 1}, "channels": {"esr": {"140": -1}}},
    {"count": 1, "versions": {"140": 1}, "channels": {"unknown-channel": {"140": 1}}},
    {"count": 1, "versions": {"140": 1}, "channels": {"esr": {"140": 2}}},
    {"count": 1, "versions": {"140": 1}, "channels": {"esr": {"140": 1}},
     "channel_coverage": {"total": 1, "classified": 0, "unknown": 1}},
])
def test_invalid_channel_data_is_rejected(bad):
    with pytest.raises(ValueError):
        validate_record("thunderbird_adi.json", "2026-01-01", bad)


def test_release_dates_exclude_release_and_beta_families_and_keep_prior_history():
    session = Mock()
    session.get.side_effect = [
        Mock(json=lambda: {"THUNDERBIRD_ESR": "140.3.0", "THUNDERBIRD_ESR_NEXT": "153.0"}),
        Mock(json=lambda: {"140.0": "2025-07-01", "153.0": "2026-06-01",
                           "152.0": "2026-05-01", "154.0b1": "2026-06-02"}),
        Mock(json=lambda: {"140.3.0": "2025-09-01", "153.0.1": "2026-06-02"}),
    ]
    old = {"version": "128.0", "date": "2024-07-01", "channel": "esr"}
    result = releases.collect({"releases": [old]}, session)
    assert [r["version"] for r in result["releases"]] == [
        "128.0", "140.0", "140.3.0", "153.0", "153.0.1"]
    assert result["releases"][0] == {**old, "update_channel": "esr"}
    assert all(call.kwargs["timeout"] == 30 for call in session.get.call_args_list)
