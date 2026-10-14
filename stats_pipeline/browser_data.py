"""Create the public, partitioned chart datasets from an authoritative snapshot."""

import json
from pathlib import Path

from .common import atomic_json


def prepare(data, output):
    data, output = Path(data), Path(output)
    target = output / "data"
    target.mkdir(parents=True, exist_ok=True)
    path = data / "thunderbird_adi.json"
    if not path.exists():
        return
    records = json.loads(path.read_text())
    if not isinstance(records, dict) or not records:
        raise ValueError("The browser ADI dataset must contain observations")
    from .validation import validate_record
    for day, record in records.items():
        validate_record("thunderbird_adi.json", day, record)
    totals = {day: record["count"] for day, record in sorted(records.items())}
    totals_source = "ADI observation totals"
    authoritative = data / "adi_daily_totals.json"
    if authoritative.exists():
        payload = json.loads(authoritative.read_text())
        if (not isinstance(payload, dict) or not isinstance(payload.get("counts"), dict)
                or not isinstance(payload.get("source"), str) or not payload["source"].strip()):
            raise ValueError("Authoritative daily totals require counts and source provenance")
        totals = payload["counts"]
        if totals.keys() != records.keys():
            raise ValueError("Authoritative daily totals must cover exactly the ADI observation dates")
        for day, count in totals.items():
            validate_record("thunderbird_adi.json", day, {"count": count, "versions": {}})
        totals_source = payload["source"]
    years = {}
    for day, record in sorted(records.items()):
        years.setdefault(day[:4], {})[day] = record
    files = []
    for year, values in years.items():
        filename = f"adi-{year}.json"
        atomic_json(target / filename, values)
        files.append({"file": filename, "start": min(values), "end": max(values)})
    atomic_json(target / "adi-totals.json", dict(sorted(totals.items())))
    glean_path = data / "glean.json"
    if glean_path.exists():
        from .glean import sanitize_public
        atomic_json(target / "glean.json", sanitize_public(json.loads(glean_path.read_text())))
    releases = data / "release_history.json"
    if releases.exists():
        atomic_json(target / "releases.json", json.loads(releases.read_text()))
    channel_days = [day for day, value in sorted(records.items()) if value.get("channels")]
    atomic_json(target / "index.json", {
        "schema": 1,
        "adi": {"start": min(records), "end": max(records), "files": files,
                "totals": "adi-totals.json",
                "source": "Thunderbird application and add-on update requests",
                "totals_source": totals_source,
                "unit": "Active daily installations (estimate)",
                "channel_days": len(channel_days),
                "channel_start": channel_days[0] if channel_days else None,
                "channel_end": channel_days[-1] if channel_days else None},
        "glean": "glean.json" if glean_path.exists() else None,
        "releases": "releases.json" if releases.exists() else None,
        "archive_end": "2025-05-31",
    })
