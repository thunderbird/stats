"""Dated Release and ESR metadata for browser version cohort rules."""

import datetime as dt
import re

from .common import http_session

BASE = "https://product-details.mozilla.org/1.0/"
HISTORICAL_ESR = {10, 17, 24, 31, 38, 45, 52, 60, 68, 78, 91, 102, 115, 128, 140}
# Thunderbird's long-support releases used the release update channel through
# 115. The 128 release introduced a distinct ESR update channel. These tagged
# build configurations are the source of that historical mapping, rather than
# an inference from the versions reported in update requests.
CHANNEL_HISTORY_SOURCES = [
    "https://hg.mozilla.org/releases/comm-esr115/raw-file/THUNDERBIRD_115_0_RELEASE/taskcluster/ci/build/kind.yml",
    "https://hg.mozilla.org/releases/comm-esr128/raw-file/THUNDERBIRD_128_0esr_RELEASE/taskcluster/kinds/build/kind.yml",
]


def annotate_update_channel(item):
    """Attach the actual update-channel name to a known ESR release record."""
    major = int(item["version"].split(".")[0])
    return {**item, "channel": "esr",
            "update_channel": "release" if major < 128 else "esr"}


def collect(previous=None, session=None):
    session = session or http_session()

    def fetch(name):
        response = session.get(BASE + name + ".json", timeout=30)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict) or not result:
            raise ValueError("Invalid product details: " + name)
        return result
    current = fetch("thunderbird_versions")
    history = fetch("thunderbird_history_major_releases")
    history.update(fetch("thunderbird_history_stability_releases"))
    families = set(HISTORICAL_ESR)
    for item in (previous or {}).get("releases", []):
        families.add(int(item["version"].split(".")[0]))
    for key in ("THUNDERBIRD_ESR", "THUNDERBIRD_ESR_NEXT"):
        if current.get(key):
            families.add(int(current[key].split(".")[0]))
    releases = {item["version"]: annotate_update_channel(item)
                for item in (previous or {}).get("releases", [])}
    for version, day in history.items():
        if not re.fullmatch(r"\d+(?:\.\d+)*", version):
            continue
        if int(version.split(".")[0]) in families:
            dt.date.fromisoformat(day)
            releases[version] = annotate_update_channel(
                {"version": version, "date": day, "channel": "esr"})
    if not releases:
        raise ValueError("No ESR release dates in product details")
    release_history = []
    for version, day in history.items():
        if not re.fullmatch(r"\d+(?:\.\d+)*", version):
            continue
        dt.date.fromisoformat(day)
        release_history.append({"version": version, "date": day, "channel": "release"})
    return {"source": BASE, "channel_history_sources": CHANNEL_HISTORY_SOURCES,
            "release_releases": sorted(release_history, key=lambda item: (
                item["date"], tuple(map(int, item["version"].split("."))))),
            "releases": sorted(releases.values(), key=lambda item: (
        item["date"], tuple(map(int, item["version"].split("."))))) }
