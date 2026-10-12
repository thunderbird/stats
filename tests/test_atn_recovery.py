import ast
import datetime as dt
import json
import sys
from unittest.mock import Mock

import pytest

from stats_pipeline import atn
from stats_pipeline.artifacts import GROUPS, clean_artifact, clean_rows, tsv
from stats_pipeline.common import digest, json_bytes
from test_pipeline import MemoryS3


DAY = "2026-10-10"


@pytest.mark.parametrize(
    "bad",
    [
        ["wrong-day", "addon", "value", "1", ""],
        [DAY, "addon", "extra\tfield", "1", ""],
        [DAY, "addon", "new\nline", "1", ""],
        [DAY, "addon", "new\u2028line", "1", ""],
        [DAY, "addon", "value", "-1", ""],
        [DAY, "addon", "value", "NaN", ""],
        [DAY, "addon"],
    ],
)
def test_malformed_row_does_not_discard_valid_rows(bad, caplog):
    valid = [DAY, "addon!@example", "value", "10", ""]
    body = tsv(clean_rows([valid, bad], DAY, 5))
    assert clean_artifact(body, DAY, 5) == body
    assert b"addon!!@example" in body
    assert "Discarded 1 malformed" in caplog.text


def test_consumer_skips_malformed_physical_rows_without_double_escaping():
    good = tsv([[DAY, "addon!", "value", "10", ""]])
    bad = b"broken\trow\n" + DAY.encode() + b"\taddon\t\xff\t1\t\n"
    assert clean_artifact(good + bad + good, DAY, 5) == good + good
    with pytest.raises(ValueError, match="No usable"):
        clean_artifact(bad, DAY, 5)


class Handoffs(MemoryS3):
    def get_paginator(self, name):
        return self

    def paginate(self, *, Bucket, Prefix):
        yield {"Contents": [{"Key": key} for key in self.data if key.startswith(Prefix)]}

    def ready(self, day, revision="revision", *, malformed=False):
        manifest = {"day": day, "revision": revision, "artifacts": {}}
        for group in GROUPS.values():
            row = (
                [day, "addon", "app", "140.0", "1", ""]
                if group == "app"
                else [day, "addon", "value", "1", ""]
            )
            body = tsv([row]) + (b"malformed\trow\n" if malformed else b"")
            key = f"prod/atn/artifacts/{day}/{revision}/{group}"
            self.data[key] = body
            manifest["artifacts"][group] = {"key": key, "size": len(body), "sha256": digest(body)}
        self.data[f"prod/atn/ready/{day}.json"] = json_bytes(manifest)
        return manifest


@pytest.fixture
def consumer(tmp_path, monkeypatch):
    s3 = Handoffs()
    monkeypatch.setattr(atn.boto3, "client", lambda *a, **kw: s3)
    monkeypatch.setattr(atn, "utc_today", lambda: dt.date(2026, 10, 12))
    monkeypatch.setattr(atn, "get_container", Mock(return_value=object()))
    imported, operations = Mock(), Mock()
    monkeypatch.setattr(atn, "import_date", imported)
    monkeypatch.setattr(atn, "run_operation", operations)
    path = tmp_path / "completed.json"

    def run(first="2026-10-10", **kw):
        atn.consume("bucket", path, dt.date.fromisoformat(first), "addons", **kw)

    return s3, path, imported, operations, run


def test_index_failure_does_not_repeat_database_import_or_block_totals_and_average(consumer):
    s3, path, imported, operations, run = consumer
    s3.ready(DAY, malformed=True)
    s3.ready("2026-10-11")

    def fail_one_index(container, operation, day=None):
        if operation == "index" and day == DAY:
            raise RuntimeError("search unavailable")

    operations.side_effect = fail_one_index
    with pytest.raises(RuntimeError, match="search unavailable"):
        run()
    state = json.loads(path.read_bytes())
    assert state["progress"][DAY] == {"revision": "revision", "imported": True, "totals": True}
    assert state["completed"] == {"2026-10-11": "revision"}
    assert state["average_pending"] is False
    assert any(c.args[1] == "average" for c in operations.call_args_list)
    imported.assert_any_call(
        atn.get_container(),
        s3.ready(DAY, malformed=True),
        {
            f"update_counts_by_{g}.hive": tsv(
                [[DAY, "addon", "app", "140.0", "1", ""]]
                if g == "app"
                else [[DAY, "addon", "value", "1", ""]]
            )
            for g in GROUPS.values()
        },
        False,
    )
    imported.reset_mock()
    operations.reset_mock(side_effect=True)
    run()
    imported.assert_not_called()
    operations.assert_called_once_with(atn.get_container(), "index", DAY)
    assert json.loads(path.read_bytes())["completed"] == {DAY: "revision", "2026-10-11": "revision"}


def test_bad_day_does_not_block_later_day_but_average_waits_for_required_data(consumer):
    s3, path, imported, operations, run = consumer
    broken = s3.ready(DAY)
    s3.ready("2026-10-11")
    key = broken["artifacts"]["app"]["key"]
    original = s3.data[key]
    s3.data[key] = b"checksum mismatch"
    with pytest.raises(RuntimeError, match="checksum"):
        run()
    assert [c.args[1]["day"] for c in imported.call_args_list] == ["2026-10-11"]
    assert all(c.args[1] != "average" for c in operations.call_args_list)
    assert json.loads(path.read_bytes())["average_pending"] is True
    s3.data[key] = original
    imported.reset_mock()
    operations.reset_mock()
    run()
    assert [c.args[1]["day"] for c in imported.call_args_list] == [DAY]
    operations.assert_any_call(atn.get_container(), "average")


def test_average_failure_retries_without_reimporting_any_days(consumer):
    s3, path, imported, operations, run = consumer
    s3.ready("2026-10-11")

    def fail_average(container, operation, day=None):
        if operation == "average":
            raise RuntimeError("average error")

    operations.side_effect = fail_average
    with pytest.raises(RuntimeError, match="average error"):
        run(first="2026-10-11")
    assert json.loads(path.read_bytes())["completed"] == {"2026-10-11": "revision"}
    imported.reset_mock()
    operations.reset_mock(side_effect=True)
    run(first="2026-10-11")
    imported.assert_not_called()
    operations.assert_called_once_with(atn.get_container(), "average")


def test_corrupt_ready_manifests_do_not_block_good_imports(consumer):
    s3, path, imported, operations, run = consumer
    s3.data["prod/atn/ready/invalid-name.json"] = b"{}"
    s3.data[f"prod/atn/ready/{DAY}.json"] = json_bytes({"day": DAY})
    s3.ready("2026-10-11")
    with pytest.raises(RuntimeError):
        run()
    assert [c.args[1]["day"] for c in imported.call_args_list] == ["2026-10-11"]
    assert json.loads(path.read_bytes())["completed"] == {"2026-10-11": "revision"}


def test_changed_revision_reimports_but_validate_only_and_dry_run_never_acknowledge(consumer):
    s3, path, imported, operations, run = consumer
    s3.ready("2026-10-11")
    run(first="2026-10-11")
    before = path.read_bytes()
    imported.reset_mock()
    operations.reset_mock()
    run(first="2026-10-11", validate_only=True)
    assert imported.call_args.args[-1] is True
    operations.assert_not_called()
    assert path.read_bytes() == before
    imported.reset_mock()
    s3.ready("2026-10-11", revision="new-revision")
    run(first="2026-10-11", dry_run=True)
    imported.assert_not_called()
    assert path.read_bytes() == before
    run(first="2026-10-11")
    assert imported.call_args.args[1]["revision"] == "new-revision"
    assert json.loads(path.read_bytes())["completed"] == {"2026-10-11": "new-revision"}


def test_failure_outside_average_window_does_not_block_current_average(consumer):
    s3, path, imported, operations, run = consumer
    for n in range(12):
        s3.ready((dt.date(2026, 10, 11) - dt.timedelta(days=n)).isoformat())
    s3.data["prod/atn/ready/2026-09-28.json"] = b"{}"
    with pytest.raises(RuntimeError):
        run(first="2026-09-28")
    assert json.loads(path.read_bytes())["average_pending"] is False
    operations.assert_any_call(atn.get_container(), "average")


def test_cleanup_failure_does_not_turn_committed_import_into_retry(monkeypatch):
    checked = Mock(side_effect=["/tmp", "committed", RuntimeError("cleanup only")])
    monkeypatch.setattr(atn, "exec_checked", checked)
    container = Mock()
    atn.import_date(container, {"day": DAY}, {"update_counts_by_app.hive": b"row"})
    assert checked.call_count == 3


def test_catalog_and_import_totals_use_separate_jobs_and_locks():
    catalog = atn.container_script(operation="catalog")
    totals = atn.container_script(DAY, operation="totals")
    assert "'catalog' == 'catalog'" in catalog
    assert "stat_tasks._get_daily_jobs(date)" in catalog
    assert "stat_tasks._get_metrics_jobs(date)" in totals
    assert "update_global_totals(" not in catalog  # legacy task swallows SQL errors
    compile(catalog, "<catalog>", "exec")
    compile(totals, "<totals>", "exec")


def test_catalog_retry_preserves_successful_readings_and_retries_only_missing_totals():
    wrapper = ast.parse(atn.container_script(operation="catalog"))
    source = ast.literal_eval(wrapper.body[1].value.args[0].args[0])
    function = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == "write_totals")
    rows = {("existing", DAY): 3}

    class Cursor:
        def execute(self, sql, params):
            if sql.startswith("REPLACE"):
                name, count, day = params
                rows[name, day] = count
            else:
                self.value = rows.get(tuple(params))

        def fetchone(self):
            return (self.value,) if self.value is not None else None

        def close(self):
            pass

    namespace = {"connection": Mock(cursor=Cursor)}
    exec(compile(ast.Module(body=[function], type_ignores=[]), "<write-totals>", "exec"), namespace)
    jobs = {
        "existing": Mock(return_value=4),
        "failed": Mock(side_effect=[RuntimeError("temporary"), 5]),
        "good": Mock(return_value=6),
    }
    with pytest.raises(RuntimeError, match="temporary"):
        namespace["write_totals"](DAY, jobs, preserve_existing=True)
    assert rows == {("existing", DAY): 3, ("good", DAY): 6}
    namespace["write_totals"](DAY, jobs, preserve_existing=True)
    jobs["existing"].assert_not_called()
    assert jobs["failed"].call_count == 2
    jobs["good"].assert_called_once()
    assert rows["failed", DAY] == 5
    namespace["write_totals"](DAY, {"existing": jobs["existing"]})
    assert rows["existing", DAY] == 4  # Import-dependent totals still refresh.


@pytest.mark.parametrize("always_fail", [False, True])
def test_catalog_retries_are_bounded_and_keep_original_day(monkeypatch, always_fail):
    monkeypatch.setattr(sys, "argv", ["tb-stats-atn", "--catalog-only"])
    today = Mock(side_effect=[dt.date(2026, 10, 12), dt.date(2026, 10, 13)])
    monkeypatch.setattr(atn, "utc_today", today)
    container = object()
    monkeypatch.setattr(atn, "get_container", lambda name: container)
    sleep = Mock()
    monkeypatch.setattr(atn.time, "sleep", sleep)
    operation = Mock(side_effect=RuntimeError("unavailable") if always_fail else [RuntimeError("transient"), None])
    monkeypatch.setattr(atn, "run_operation", operation)
    if always_fail:
        with pytest.raises(RuntimeError, match="unavailable"):
            atn.main()
    else:
        atn.main()
    assert operation.call_count == (6 if always_fail else 2)
    assert sleep.call_count == operation.call_count - 1
    assert all(call.args == (container, "catalog", "2026-10-11") for call in operation.call_args_list)
    assert all(call.args == (300,) for call in sleep.call_args_list)
    today.assert_called_once()
