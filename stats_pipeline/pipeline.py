import copy
import datetime as dt
import logging
from pathlib import Path
import uuid

import boto3

from tools import globaladdons, monthlyusers, platlang, scalars, settings, sumo
from .adi import build_derived
from .cloudfront import SEAMONKEY, THEME, adi_record, collect, source_manifest
from .common import atomic_json, dates, json_bytes, utc_today
from .state import Store
from .validation import read_data, validate


def handoff(store, manifest):
    """Repeatable after a crash between snapshot commit and handoff publication."""
    if store.prefix != "prod":
        return
    for day, value in manifest["checkpoints"].get("sources", {}).items():
        if "artifacts" not in value:
            continue
        ready = {"schema": 1, "day": day, "revision": value["revision"],
                 "artifacts": value["artifacts"]}
        store.ready(day, ready)


def run(config, directory, revision, *, through=None, start=None, component="metrics", max_days=32, refresh_week=None):
    through = through or utc_today() - dt.timedelta(days=1)
    if through >= utc_today():
        raise ValueError("Only complete UTC days can be processed")
    if config.prefix == "stage":
        raise ValueError("Staging is read-only; use shadow for experimental collection")
    if refresh_week and (refresh_week.weekday() != 6 or refresh_week > through):
        raise ValueError("--refresh-week must be a completed Sunday")
    directory = Path(directory)
    session = boto3.Session(region_name=config.region)
    s3 = session.client("s3")
    store = Store(s3, config)
    manifest, etag = store.current()
    if manifest is None:
        raise ValueError("Seed authoritative state before running collectors")
    store.restore(manifest, directory)
    baseline = read_data(directory)
    checkpoints = copy.deepcopy(manifest["checkpoints"])
    run_id = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    if component == "sumo":
        atomic_json(directory / "sumo.json", sumo.collect(baseline["sumo.json"], through))
    else:
        adi = baseline["thunderbird_adi.json"].copy()
        latest = dt.date.fromisoformat(max(adi))
        if through < latest and not start:
            raise ValueError("Historical processing requires an explicit --start")
        first = start or min(latest + dt.timedelta(days=1), through - dt.timedelta(days=config.late_days-1))
        days = list(dates(first, through))
        if len(days) > max_days:
            raise ValueError(f"{len(days)} dates exceeds --max-days={max_days}; run a bounded backfill")
        changed, collected = [], {}
        source_state = checkpoints.setdefault("sources", {})
        for day in days:
            key = day.isoformat()
            sources = {kind: source_manifest(s3, kind, key) for kind in ("atn", "aus")}
            fingerprint = {kind: value["sha256"] for kind, value in sources.items()}
            previous = source_state.get(key, {})
            if not start and previous.get("fingerprints") == fingerprint and key in adi:
                continue
            rows, aus, artifacts = collect(s3, session.client("athena"), config, key, sources, run_id)
            source_key = f"{config.prefix}/sources/{run_id}/{key}.json"
            store.put(source_key, json_bytes(sources), IfNoneMatch="*")
            collected[key] = (rows, aus)
            source_state[key] = {"fingerprints": fingerprint, "artifacts": artifacts,
                                 "source_key": source_key, "revision": run_id}
            changed.append(key)
        if changed:
            # Legacy generation filters using the ending day's app counts for the whole run.
            last = max(collected)
            seamonkeys = {r[3] for r in collected[last][0]["app"] if r[1] == THEME and r[2] == SEAMONKEY}
            for key, (rows, aus) in collected.items():
                adi[key] = adi_record(rows["version"], aus, seamonkeys)
            atomic_json(directory / "thunderbird_adi.json", adi)
            build_derived(adi, directory)
        # All weekly collectors preserve their Sunday anchors and recover missing weeks.
        settings.s3bucket = config.telemetry_results
        settings.workgroup = config.telemetry_workgroup
        args = ["--input", str(directory/"thunderbird_ami.json"), "--adi", str(directory/"thunderbird_adi.json"),
                "--through", through.isoformat()]
        if changed:
            args.append("--recalculate")
        monthlyusers.main(args)
        for name, fn in [("addon_stats.json", globaladdons.collect), ("telemetry.json", scalars.collect),
                         ("platforms.json", lambda d, t: platlang.collect(d, t, platlang.run_platform_query)),
                         ("locales.json", lambda d, t: platlang.collect(d, t, platlang.run_locale_query))]:
            existing = copy.deepcopy(baseline[name])
            if refresh_week:
                if name == "telemetry.json":
                    for records in existing.values():
                        records.pop(refresh_week.isoformat(), None)
                else:
                    existing.pop(refresh_week.isoformat(), None)
            atomic_json(directory / name, fn(existing, through))
    summary = validate(directory, baseline, through if component == "metrics" else None)
    checkpoints[component] = {"through": through.isoformat(), "summary": summary}
    saved = store.snapshot(directory, run_id, checkpoints, revision, etag)
    handoff(store, saved)
    logging.info("Validated snapshot %s", run_id)
    return saved
