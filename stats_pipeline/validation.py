import datetime as dt
import json
from pathlib import Path

REQUIRED = {"thunderbird_adi.json", "thunderbird_ami.json", "addon_stats.json",
            "telemetry.json", "platforms.json", "locales.json", "sumo.json"}


def read_data(directory):
    return {p.name: json.loads(p.read_bytes()) for p in Path(directory).glob("*.json")}


def nonnegative(value):
    return type(value) is int and value >= 0


def count_record(record, name):
    if not isinstance(record, dict) or not nonnegative(record.get("count")):
        raise ValueError(f"Invalid count: {name}")
    if not isinstance(record.get("versions"), dict) or any(
            not nonnegative(v) for v in record["versions"].values()):
        raise ValueError(f"Invalid version counts: {name}")


def validate(directory, baseline=None, through=None):
    data = read_data(directory)
    if REQUIRED - data.keys():
        raise ValueError(f"Missing datasets: {sorted(REQUIRED - data.keys())}")
    if baseline:
        if set(baseline) - data.keys():
            raise ValueError("Historical dataset removed")
        for name in REQUIRED - {"telemetry.json"}:
            if set(baseline[name]) - data[name].keys():
                raise ValueError(f"Historical dates removed from {name}")
        for scalar, records in baseline["telemetry.json"].items():
            if scalar not in data["telemetry.json"] or set(records) - data["telemetry.json"][scalar].keys():
                raise ValueError(f"Historical scalar data removed: {scalar}")
    for name in REQUIRED - {"telemetry.json"}:
        if not data[name]:
            raise ValueError(f"Empty dataset: {name}")
        for day, record in data[name].items():
            dt.date.fromisoformat(day)
            if name == "sumo.json":
                if not nonnegative(record):
                    raise ValueError(f"Invalid SUMO record: {day}")
            elif name == "thunderbird_ami.json":
                if not nonnegative(record.get("ami")) or not 0 < record.get("78", 0) <= 1:
                    raise ValueError(f"Invalid MAU record: {day}")
                dt.date.fromisoformat(record["start_date"])
            elif name == "addon_stats.json":
                if not all(nonnegative(record.get(k)) for k in ("total", "addon_count", "minustop10_count")):
                    raise ValueError(f"Invalid addon record: {day}")
                if not record["minustop10_count"] <= record["addon_count"] <= record["total"]:
                    raise ValueError(f"Inconsistent addon counts: {day}")
            else:
                count_record(record, f"{name}/{day}")
                if name == "thunderbird_adi.json" and sum(record["versions"].values()) > record["count"]:
                    raise ValueError(f"Inconsistent ADI: {day}")
    for scalar, records in data["telemetry.json"].items():
        for day, record in records.items():
            dt.date.fromisoformat(day)
            count_record(record, f"{scalar}/{day}")
    if through:
        if through.isoformat() not in data["thunderbird_adi.json"]:
            raise ValueError("ADI does not cover the requested end date")
        for name in ("thunderbird_ami.json", "addon_stats.json", "locales.json", "platforms.json"):
            if (through - dt.date.fromisoformat(max(data[name]))).days > 13:
                raise ValueError(f"Stale weekly dataset: {name}")
    return {name: {"records": len(records), "latest": max(records) if records else None}
            for name, records in data.items() if name in REQUIRED - {"telemetry.json"}}
