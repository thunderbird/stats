import csv
import datetime as dt
import io
from unittest.mock import Mock

import pytest
import requests

from stats_pipeline import sumo

REVISION = "a" * 40
BASE = f"https://raw.githubusercontent.com/{sumo.REPOSITORY}/{REVISION}"
NOW = dt.datetime(2026, 10, 11, 20, tzinfo=dt.UTC)


def csv_body(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["id", "created", "product", "is_spam", "content"])
    for question_id, created, spam in rows:
        writer.writerow([question_id, created, "thunderbird", spam, "text, with\nnewlines"])
    return output.getvalue().encode()


def source_session(files, watermark="2026-10-11T19:00:00Z"):
    routes = {f"{BASE}/.refresh-hwm": watermark.encode()}
    routes.update({f"{BASE}/{day.year}/questions-thunderbird-desktop-{day}.csv": body
                   for day, body in files.items()})

    def get(url, **kwargs):
        response = Mock()
        if url == f"https://api.github.com/repos/{sumo.REPOSITORY}/commits/main":
            response.json.return_value = {"sha": REVISION}
        elif url in routes:
            response.content = routes[url]
            response.text = routes[url].decode()
        else:
            response.raise_for_status.side_effect = requests.HTTPError("missing CSV")
        return response

    session = Mock()
    session.get.side_effect = get
    return session


def test_preserves_history_and_counts_pacific_days_with_spam(monkeypatch):
    day = dt.date(2026, 10, 10)
    monkeypatch.setattr(sumo, "START_DATE", day - dt.timedelta(days=1))
    session = source_session({
        day: csv_body([(1, "2026-10-10T06:59:59Z", False),
                       (2, "2026-10-10T07:00:00Z", False),
                       (3, "2026-10-10T23:59:59Z", True)]),
        day + dt.timedelta(days=1): csv_body([(4, "2026-10-11T06:59:59Z", False),
                                             (5, "2026-10-11T07:00:00Z", False)]),
    })
    original, provenance = {"2026-10-09": 99}, {}
    result = sumo.collect(original, day, session=session, now=NOW, source_info=provenance)
    assert result == {"2026-10-09": 99, "2026-10-10": 3}
    assert original == {"2026-10-09": 99}
    assert provenance["revision"] == REVISION
    assert provenance["timezone"] == "America/Los_Angeles"
    assert len(provenance["files"]) == 2
    assert all(len(f["sha256"]) == 64 for f in provenance["files"].values())
    assert all(REVISION in call.args[0] for call in session.get.call_args_list[1:])


@pytest.mark.parametrize("day,start,end", [
    (dt.date(2026, 3, 8), "2026-03-08T08:00:00Z", "2026-03-09T07:00:00Z"),
    (dt.date(2025, 11, 2), "2025-11-02T07:00:00Z", "2025-11-03T08:00:00Z"),
    (dt.date(2025, 12, 31), "2025-12-31T08:00:00Z", "2026-01-01T08:00:00Z"),
])
def test_dst_and_year_boundaries(monkeypatch, day, start, end):
    monkeypatch.setattr(sumo, "START_DATE", day)
    first = sumo.parse_timestamp(start)
    last = sumo.parse_timestamp(end)
    session = source_session({
        day: csv_body([(1, (first - dt.timedelta(seconds=1)).isoformat(), False),
                       (2, first.isoformat(), False)]),
        day + dt.timedelta(days=1): csv_body([
            (3, (last - dt.timedelta(seconds=1)).isoformat(), False),
            (4, last.isoformat(), False)]),
    })
    assert sumo.collect({}, day, session=session, now=NOW) == {day.isoformat(): 2}


def test_0400_run_excludes_unfinished_pacific_day(monkeypatch):
    day = dt.date(2026, 10, 9)
    monkeypatch.setattr(sumo, "START_DATE", day)
    session = source_session({day: csv_body([]), day + dt.timedelta(days=1): csv_body([])},
                             watermark="2026-10-11T03:00:00Z")
    now = dt.datetime(2026, 10, 11, 4, tzinfo=dt.UTC)
    assert sumo.collect({}, dt.date(2026, 10, 10), session=session, now=now) == {
        "2026-10-09": 0}


@pytest.mark.parametrize("problem", ["missing", "stale", "duplicate", "header", "row",
                                      "timestamp", "wrong_day", "product"])
def test_bad_source_never_mutates_history(monkeypatch, problem):
    day = dt.date(2026, 10, 10)
    monkeypatch.setattr(sumo, "START_DATE", day - dt.timedelta(days=1))
    files = {day: csv_body([(1, "2026-10-10T12:00:00Z", False)]),
             day + dt.timedelta(days=1): csv_body([])}
    watermark = "2026-10-11T19:00:00Z"
    if problem == "missing":
        del files[day + dt.timedelta(days=1)]
    elif problem == "stale":
        watermark = "2026-10-11T06:59:59Z"
    elif problem == "duplicate":
        files[day + dt.timedelta(days=1)] = csv_body([(1, "2026-10-11T01:00:00Z", False)])
    elif problem == "header":
        files[day] = b"<html>challenge</html>"
    elif problem == "row":
        files[day] = b"id,created,product,content\n1,2026-10-10T12:00:00Z,thunderbird\n"
    elif problem == "timestamp":
        files[day] = csv_body([(1, "2026-10-10T12:00:00", False)])
    elif problem == "wrong_day":
        files[day] = csv_body([(1, "2026-10-09T12:00:00Z", False)])
    elif problem == "product":
        files[day] = files[day].replace(b"thunderbird", b"firefox")
    original, provenance = {"2026-10-09": 42}, {}
    with pytest.raises((ValueError, requests.HTTPError)):
        sumo.collect(original, day, session=source_session(files, watermark), now=NOW,
                     source_info=provenance)
    assert original == {"2026-10-09": 42}
    assert provenance == {}


def test_completed_history_does_not_need_network(monkeypatch):
    day = dt.date(2026, 10, 10)
    monkeypatch.setattr(sumo, "START_DATE", day)
    session = Mock()
    assert sumo.collect({day.isoformat(): 12}, day, session=session, now=NOW) == {day.isoformat(): 12}
    session.get.assert_not_called()
