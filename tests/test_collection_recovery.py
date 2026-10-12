import datetime as dt
import json
from unittest.mock import Mock

import pytest

from stats_pipeline import cloudfront, pipeline
from stats_pipeline.artifacts import GROUPS
from stats_pipeline.common import Failures, atomic_json, dates
from stats_pipeline.config import Config
from stats_pipeline.state import Store
from test_pipeline import MemoryS3
from tools import globaladdons, monthlyusers, platlang, scalars


@pytest.fixture
def collection(tmp_path, monkeypatch):
    config = Config("bucket", late_days=1)
    s3 = MemoryS3()
    store = Store(s3, config)
    baseline = {
        "thunderbird_adi.json": {
            str(day): {"count": 100, "versions": {"115.0": 20, "128.0": 80}}
            for day in dates(dt.date(2026, 9, 1), dt.date(2026, 10, 9))
        },
        "thunderbird_ami.json": {"2026-10-04": {"ami": 100, "78": 0.8, "start_date": "2026-09-05"}},
        "addon_stats.json": {
            "2026-10-04": {"total": 100, "addon_count": 80, "minustop10_count": 60}
        },
        "platforms.json": {"2026-10-04": {"count": 100, "versions": {}}},
        "locales.json": {"2026-10-04": {"count": 100, "versions": {}}},
        "telemetry.json": {"a": {"2026-10-04": {"count": 100, "versions": {}}}},
        "sumo.json": {"2026-10-09": 10},
    }
    for name, value in baseline.items():
        atomic_json(tmp_path / name, value)
    original = store.snapshot(tmp_path, "before", {}, "old-code", None)
    session = Mock()
    session.client.return_value = s3
    monkeypatch.setattr(pipeline.boto3, "Session", lambda **kw: session)
    monkeypatch.setattr(pipeline, "utc_today", lambda: dt.date(2026, 10, 12))
    monkeypatch.setattr(monthlyusers, "start_date", dt.date(2026, 10, 4))
    return config, store, tmp_path, baseline, original


def sources(monkeypatch, fail_aus=None, incomplete_atn=None):
    monkeypatch.setattr(
        pipeline, "source_manifest", lambda s3, kind, day: {"sha256": f"{kind}-{day}"}
    )

    def collect(s3, client, config, day, kind, source, run_id, failures, groups=None):
        if kind == "aus":
            if day == fail_aus:
                raise RuntimeError("AUS unavailable")
            return {"count": 80, "versions": {"128.0": 80}}
        artifacts = {g: {"key": f"{day}/{g}"} for g in GROUPS.values()}
        if day == incomplete_atn:
            failures.record(f"atn/{day}/locale", RuntimeError("locale query failed"))
            artifacts = {}
        return {
            "rows": {
                "app": [[day, cloudfront.THEME, "thunderbird", "115.0", "20", ""]],
                "version": [[day, cloudfront.THEME, "115.0", "20", ""]],
            },
            "artifacts": artifacts,
        }

    monkeypatch.setattr(pipeline, "collect_source", collect)


def test_failed_aus_day_preserves_atn_handoff_and_next_daily_result(collection, monkeypatch):
    config, store, directory, baseline, original = collection
    sources(monkeypatch, fail_aus="2026-10-10")
    with pytest.raises(pipeline.CollectionFailed, match="AUS unavailable"):
        pipeline.run(
            config,
            directory,
            "code",
            component="daily",
            start=dt.date(2026, 10, 10),
            through=dt.date(2026, 10, 11),
        )
    saved, _ = store.current()
    assert saved["run_id"] != original["run_id"]
    assert saved["checkpoints"]["daily"]["pending"] == ["2026-10-10"]
    adi = json.loads((directory / "thunderbird_adi.json").read_bytes())
    assert "2026-10-10" not in adi and adi["2026-10-11"]["count"] == 100
    assert json.loads(store.get("prod/atn/ready/2026-10-10.json")[0])["day"] == "2026-10-10"
    assert json.loads(store.get("prod/atn/ready/2026-10-11.json")[0])["day"] == "2026-10-11"


def test_atn_dimension_failure_does_not_block_adi_or_mau(collection, monkeypatch):
    config, store, directory, baseline, original = collection
    sources(monkeypatch, incomplete_atn="2026-10-11")
    with pytest.raises(pipeline.CollectionFailed, match="locale query failed"):
        pipeline.run(config, directory, "code", component="daily")
    adi = json.loads((directory / "thunderbird_adi.json").read_bytes())
    assert adi["2026-10-11"]["count"] == 100
    assert "prod/atn/ready/2026-10-11.json" not in store.s3.data
    monkeypatch.setattr(monthlyusers, "query_glean_data", lambda: {"2026-10-11": 120})
    pipeline.run(config, directory, "code", component="mau")
    assert json.loads((directory / "thunderbird_ami.json").read_bytes())["2026-10-11"]["ami"] == 120


def test_glean_failure_does_not_block_other_components_or_daily_handoff(collection, monkeypatch):
    config, store, directory, baseline, original = collection
    sources(monkeypatch)

    def fail_glean():
        raise RuntimeError("Glean offline")

    monkeypatch.setattr(monthlyusers, "query_glean_data", fail_glean)

    def weekly(data, through, **kw):
        data["2026-10-11"] = {"count": 110, "versions": {}}
        return data

    monkeypatch.setattr(
        pipeline,
        "WEEKLY",
        {
            "addons": ("addon_stats.json", lambda data, through, **kw: data),
            "scalars": ("telemetry.json", lambda data, through, **kw: data),
            "platforms": ("platforms.json", weekly),
            "locales": ("locales.json", weekly),
        },
    )
    with pytest.raises(pipeline.CollectionFailed, match="Glean offline"):
        pipeline.run(config, directory, "code")
    saved, _ = store.current()
    assert saved["checkpoints"]["mau"]["errors"]
    assert (
        json.loads((directory / "thunderbird_ami.json").read_bytes())
        == baseline["thunderbird_ami.json"]
    )
    assert "2026-10-11" in json.loads((directory / "locales.json").read_bytes())
    assert "2026-10-11" in json.loads((directory / "thunderbird_adi.json").read_bytes())
    assert "prod/atn/ready/2026-10-11.json" in store.s3.data


def test_invalid_refresh_preserves_previous_point_and_saves_valid_points(collection, monkeypatch):
    config, store, directory, baseline, original = collection

    def mixed(data, through, **kw):
        data["2026-10-04"] = {"count": -1, "versions": {}}
        data["2026-10-11"] = {"count": 110, "versions": {"Linux": 110}}
        return data

    monkeypatch.setitem(pipeline.WEEKLY, "platforms", ("platforms.json", mixed))
    with pytest.raises(pipeline.CollectionFailed, match="Invalid count"):
        pipeline.run(
            config, directory, "code", component="platforms", refresh_week=dt.date(2026, 10, 4)
        )
    records = json.loads((directory / "platforms.json").read_bytes())
    assert records["2026-10-04"] == baseline["platforms.json"]["2026-10-04"]
    assert records["2026-10-11"]["count"] == 110


def test_pending_day_is_retried_after_recent_window(collection, monkeypatch):
    config, store, directory, baseline, original = collection
    _, etag = store.current()
    store.snapshot(directory, "pending", {"daily": {"pending": ["2026-09-10"]}}, "code", etag)
    seen = []

    def source(s3, kind, day):
        seen.append(day)
        raise RuntimeError("unavailable")

    monkeypatch.setattr(pipeline, "source_manifest", source)
    with pytest.raises(pipeline.CollectionFailed):
        pipeline.run(config, directory, "code", component="daily")
    assert "2026-09-10" in seen
    assert store.current()[0]["checkpoints"]["daily"]["pending"] == [
        "2026-09-10",
        "2026-10-10",
        "2026-10-11",
    ]


def test_unrelated_stale_data_and_local_scratch_cannot_block_or_enter_snapshot(
    collection, monkeypatch
):
    config, store, directory, baseline, original = collection
    (directory / "stray.json").write_text("not even JSON")

    def collect(data, through, **kw):
        return data | {"2026-11-01": {"count": 110, "versions": {}}}

    monkeypatch.setattr(pipeline, "utc_today", lambda: dt.date(2026, 11, 2))
    monkeypatch.setitem(pipeline.WEEKLY, "locales", ("locales.json", collect))
    pipeline.run(config, directory, "code", component="locales", through=dt.date(2026, 11, 1))
    saved, _ = store.current()
    assert "stray.json" not in saved["files"]
    assert (
        saved["files"]["thunderbird_ami.json"]["sha256"]
        == original["files"]["thunderbird_ami.json"]["sha256"]
    )


def test_query_and_cleanup_errors_do_not_discard_other_atn_dimensions(monkeypatch):
    athena = Mock()
    athena.executions = []
    monkeypatch.setattr(cloudfront, "Athena", lambda *a: athena)
    monkeypatch.setattr(cloudfront.cloudfront_sql, "by_type", lambda view, qtype, day: qtype)

    def query(qtype):
        if qtype == "locale":
            raise RuntimeError("bad locale query")
        return (
            [["2026-10-11", "addon", "app", "140", "1", ""]]
            if qtype == "app"
            else [["2026-10-11", "addon", "data", "1", ""]]
        )

    athena.rows.side_effect = query
    athena.execute.side_effect = [None, None, RuntimeError("cleanup failed"), None]
    s3 = Mock()
    failures = Failures()
    result = cloudfront.collect_source(
        s3,
        object(),
        Config("bucket"),
        "2026-10-11",
        "atn",
        {"bucket": "source", "objects": []},
        "run",
        failures,
    )
    assert set(result["rows"]) == {"app", "os", "status", "version"}
    assert result["artifacts"] == {}
    assert len(failures.errors) == 2


@pytest.mark.parametrize("module", [globaladdons, platlang, scalars])
def test_weekly_query_error_does_not_stop_later_week(module, monkeypatch):
    monkeypatch.setattr(module.tools, "date_range", lambda *a, **kw: ["2026-10-04", "2026-10-11"])
    query = Mock()
    query.query_totalusers.return_value = query
    query.totalusers, query.addon_totalusers = 100, 80
    query.keyedscalar_users.return_value.format_data.return_value.json.return_value = {
        "count": 100,
        "versions": {},
    }
    constructor = Mock(side_effect=[RuntimeError("first week failed"), query])
    errors = []

    def on_error(day, error):
        errors.append(day)

    if module == globaladdons:
        monkeypatch.setattr(module.tools, "TotalAddonUsers", constructor)
        result = module.collect({}, dt.date(2026, 10, 11), on_error)
    elif module == scalars:
        monkeypatch.setattr(module.settings, "keyedscalars", [{"key": "scalar"}])
        monkeypatch.setattr(module.tools, "AthenaQuery", constructor)
        result = module.collect({}, dt.date(2026, 10, 11), on_error)["scalar"]
    else:
        func = Mock(side_effect=[RuntimeError("first week failed"), {"count": 100, "versions": {}}])
        result = module.collect({}, dt.date(2026, 10, 11), func, on_error)
    assert errors and set(result) == {"2026-10-11"}


def test_mau_failure_preserves_successful_weeks_and_reuses_one_glean_request(monkeypatch):
    monkeypatch.setattr(
        monthlyusers.tools, "date_range", lambda *a, **kw: ["2026-10-04", "2026-10-11"]
    )
    query = Mock(return_value={"2026-10-04": 100, "2026-10-11": 110})
    monkeypatch.setattr(monthlyusers, "query_glean_data", query)
    monkeypatch.setattr(
        monthlyusers, "percent_represented", Mock(side_effect=[ValueError("missing ADI"), 0.8])
    )
    failures = Failures()
    result, _, added = monthlyusers.collect({}, {}, on_error=failures.record)
    assert set(result) == {"2026-10-11"} and added == 1
    assert failures.errors[0]["component"] == "2026-10-04"
    query.assert_called_once()
