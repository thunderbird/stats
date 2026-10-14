from unittest.mock import Mock

from stats_pipeline.releases import CHANNEL_HISTORY_SOURCES, collect


def test_release_history_records_historical_and_modern_update_channels():
    session = Mock()
    session.get.side_effect = [
        Mock(json=lambda: {"THUNDERBIRD_ESR": "140.3.0", "THUNDERBIRD_ESR_NEXT": ""}),
        Mock(json=lambda: {"115.0": "2023-07-11", "128.0": "2024-07-11",
                           "129.0": "2024-08-06"}),
        Mock(json=lambda: {"115.13.1": "2024-08-01", "128.1.0": "2024-08-06"}),
    ]
    prior = {"releases": [{"version": "102.0", "date": "2022-06-28", "channel": "esr"}]}
    result = collect(prior, session)
    by_version = {release["version"]: release for release in result["releases"]}
    assert by_version["102.0"]["update_channel"] == "release"
    assert by_version["115.0"]["update_channel"] == "release"
    assert by_version["115.13.1"]["update_channel"] == "release"
    assert by_version["128.0"]["update_channel"] == "esr"
    assert by_version["128.1.0"]["update_channel"] == "esr"
    assert "129.0" not in by_version
    assert all(release["channel"] == "esr" for release in by_version.values())
    assert result["channel_history_sources"] == CHANNEL_HISTORY_SOURCES
    all_versions = {release["version"]: release for release in result["release_releases"]}
    assert all_versions["129.0"] == {"version": "129.0", "date": "2024-08-06", "channel": "release"}
    assert all_versions["128.1.0"]["date"] == "2024-08-06"
    assert all(release["channel"] == "release" for release in result["release_releases"])
    # Enriching previous records must not mutate the prior snapshot.
    assert "update_channel" not in prior["releases"][0]
