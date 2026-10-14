from unittest.mock import Mock

import pytest

from stats_pipeline import aus_sql, cloudfront
from stats_pipeline.channels import aus_record, channel_from_aus_uri, normalize_channel
from stats_pipeline.common import Failures
from stats_pipeline.config import Config


DAY = "2026-10-11"


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("esr", "esr"),
        (" RELEASE ", "release"),
        ("Beta", "beta"),
        ("nightly", "nightly"),
        ("daily", "nightly"),
        ("esr-cck-partner", "esr"),
        ("%65sr", "esr"),
        (None, "unknown"),
        ("", "unknown"),
        ("default", "unknown"),
        ("aurora", "unknown"),
        ("release-localtest", "unknown"),
        ("128.0esr", "unknown"),
    ],
)
def test_channel_normalization_requires_explicit_known_channel(raw, expected):
    assert normalize_channel(raw) == expected


@pytest.mark.parametrize("protocol", [3, 6])
def test_aus_channel_position_matches_recorded_update_protocol(protocol):
    uri = (
        f"/update/{protocol}/Thunderbird/153.4.0/20260929234349/"
        "WINNT_x86_64-msvc-x64/en-US/esr/Windows_NT/default/default/update.xml"
    )
    assert channel_from_aus_uri(uri) == "esr"


@pytest.mark.parametrize(
    "uri",
    ["/update/VersionCheck.php", "/other/6/Thunderbird/140/build/os/en-US/esr/os/update.xml"],
)
def test_other_update_urls_are_unclassified(uri):
    assert channel_from_aus_uri(uri) == "unknown"


def test_multiple_channels_for_one_version_are_added_without_pruning():
    result = aus_record(
        [[DAY, "140.0", "esr", "7"], [DAY, "140.0", "release", "4"],
         [DAY, "140.0", "esr-cck-partner", "2"], [DAY, "1.0", "", "1"]], DAY
    )
    assert result["count"] == 14
    assert result["versions"] == {"140.0": 13, "1.0": 1}
    assert result["channels"] == {
        "esr": {"140.0": 9}, "release": {"140.0": 4}, "unknown": {"1.0": 1}
    }
    assert result["channel_coverage"] == {"total": 14, "classified": 13, "unknown": 1}


def test_legacy_aus_rows_keep_original_version_merge_and_unknown_coverage():
    result = aus_record([[DAY, "140.0", "3"], [DAY, "140.0", "7"]], DAY)
    assert result["count"] == 10
    assert result["versions"] == {"140.0": 7}
    assert result["channels"] == {"unknown": {"140.0": 10}}


@pytest.mark.parametrize(
    "rows",
    [[], [["wrong-day", "140.0", "esr", "3"]], [[DAY, "140.0", "esr", "-1"]],
     [[DAY, "140.0", "esr", "nan"]], [[DAY, "140.0"]]],
)
def test_invalid_aus_aggregate_rejects_dependent_day(rows):
    with pytest.raises(ValueError):
        aus_record(rows, DAY)


def test_adi_channels_keep_all_atn_observations_even_when_versions_overlap():
    rows = [[DAY, cloudfront.THEME, "115.0", "10", ""],
            [DAY, cloudfront.THEME, "140.0", "20", ""],
            [DAY, cloudfront.THEME, "2.53", "30", ""],
            [DAY, "addon@example", "128.0", "500", ""]]
    aus = aus_record([[DAY, "140.0", "esr", "80"], [DAY, "140.0", "release", "20"]], DAY)
    result = cloudfront.adi_record(rows, aus, {"2.53"})
    # Public legacy versions still use the original overwrite behavior.
    assert result["count"] == 130
    assert result["versions"] == {"115.0": 10, "140.0": 100}
    # Channel slices account for every observation in the unchanged total.
    assert result["channels"] == {
        "esr": {"140.0": 80}, "release": {"140.0": 20},
        "unknown": {"115.0": 10, "140.0": 20},
    }
    assert result["channel_coverage"] == {"total": 130, "classified": 100, "unknown": 30}


def test_incomplete_channel_totals_are_rejected_instead_of_silently_published():
    with pytest.raises(ValueError, match="do not match ADI"):
        cloudfront.adi_record([], {"count": 10, "versions": {"140": 10},
                                  "channels": {"esr": {"140": 9}}}, set())


def test_collection_queries_channel_rows_and_retains_legacy_count_filter(monkeypatch):
    athena = Mock()
    athena.rows.return_value = [[DAY, "140.0", "esr", "10"]]
    monkeypatch.setattr(cloudfront, "Athena", lambda *args: athena)
    result = cloudfront.collect_source(
        Mock(), object(), Config("bucket"), DAY, "aus",
        {"bucket": "source", "objects": []}, "run", Failures()
    )
    query = athena.rows.call_args.args[0]
    assert "split_part(cs_uri, '/', 9)" in query
    assert "WHERE cs_uri LIKE '%update%' GROUP BY 1, 2, 3" in query
    assert result["channels"] == {"esr": {"140.0": 10}}
    # Original query remains available for old consumers.
    assert "GROUP BY 1, 2\n" in aus_sql.count_query("source")
