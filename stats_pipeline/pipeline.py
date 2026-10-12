import copy
import datetime as dt
import logging
from pathlib import Path
import tempfile
import uuid

import boto3
from botocore.config import Config as BotoConfig

from tools import globaladdons, monthlyusers, platlang, scalars, settings
from . import sumo
from .adi import build_derived
from .artifacts import GROUPS
from .cloudfront import SEAMONKEY, THEME, adi_record, collect_source, source_manifest
from .common import Failures, atomic_json, atomic_write, dates, json_bytes, utc_today
from .state import Store
from .validation import check_freshness, merge_records, read_data, validate, validate_record

COMPONENTS = ("daily", "mau", "addons", "scalars", "platforms", "locales", "sumo")
WEEKLY = {
    "addons": ("addon_stats.json", globaladdons.collect),
    "scalars": ("telemetry.json", scalars.collect),
    "platforms": (
        "platforms.json",
        lambda data, through, **kw: platlang.collect(
            data, through, platlang.run_platform_query, **kw
        ),
    ),
    "locales": (
        "locales.json",
        lambda data, through, **kw: platlang.collect(
            data, through, platlang.run_locale_query, **kw
        ),
    ),
}


class CollectionFailed(RuntimeError):
    def __init__(self, manifest, errors):
        self.manifest, self.errors = manifest, errors
        super().__init__("; ".join(f"{e['component']}: {e['error']}" for e in errors))


def handoff(store, manifest, failures):
    """Retry each committed handoff independently of other days and collectors."""
    if store.prefix == "prod":
        for day, value in manifest["checkpoints"].get("sources", {}).items():
            if "artifacts" in value:
                failures.attempt(
                    f"handoff/{day}",
                    store.ready,
                    day,
                    {
                        "schema": 1,
                        "day": day,
                        "revision": value["revision"],
                        "artifacts": value["artifacts"],
                    },
                )


def recalculate_mau(data, adi, through, failures):
    result, _, _ = monthlyusers.collect(
        copy.deepcopy(data),
        adi,
        through,
        recalculate=True,
        add_missing=False,
        on_error=lambda day, error: failures.record(f"mau/coverage/{day}", error),
    )
    return result


def collect_daily(
    config,
    directory,
    baseline,
    checkpoints,
    store,
    session,
    run_id,
    through,
    start,
    max_days,
    failures,
):
    adi = copy.deepcopy(baseline["thunderbird_adi.json"])
    latest = dt.date.fromisoformat(max(adi))
    if through < latest and not start:
        raise ValueError("Historical processing requires an explicit --start")
    first = start or min(
        latest + dt.timedelta(days=1), through - dt.timedelta(days=config.late_days - 1)
    )
    pending = set(checkpoints.get("daily", {}).get("pending", []))
    days = sorted(
        set(dates(first, through))
        | {dt.date.fromisoformat(day) for day in pending if day <= through.isoformat()}
    )
    if max_days < 1:
        raise ValueError("--max-days must be positive")
    if len(days) > max_days and start:
        raise ValueError(f"{len(days)} dates exceeds --max-days={max_days}")
    deferred = {day.isoformat() for day in days[max_days:]}
    days = days[:max_days]
    source_state = checkpoints.setdefault("sources", {})
    collected, complete = {}, {}
    for day in days:
        key = day.isoformat()
        sources = {
            kind: failures.attempt(f"{kind}/{key}/sources", source_manifest, store.s3, kind, key)
            for kind in ("atn", "aus")
        }
        fingerprints = {kind: source["sha256"] for kind, source in sources.items() if source}
        previous = source_state.get(key, {})
        needs_adi = (
            key not in adi
            or len(fingerprints) != 2
            or previous.get("fingerprints") != fingerprints
            or start is not None
        )
        atn_done = (
            sources["atn"] is not None
            and "artifacts" in previous
            and previous.get("atn_fingerprint", previous.get("fingerprints", {}).get("atn"))
            == fingerprints.get("atn")
        )
        if not needs_adi and atn_done:
            pending.discard(key)
            continue
        current = copy.deepcopy(previous)
        provenance = {kind: value for kind, value in sources.items() if value}
        source_key = f"{config.prefix}/sources/{run_id}/{key}.json"
        if provenance:
            store.put(source_key, json_bytes(provenance), IfNoneMatch="*")
            current["source_key"] = source_key
        atn = None
        # A completed ATN handoff needs no re-query while AUS is unavailable.
        if sources["atn"] and (not atn_done or (needs_adi and sources["aus"])):
            atn = failures.attempt(
                f"atn/{key}",
                collect_source,
                store.s3,
                session.client("athena"),
                config,
                key,
                "atn",
                sources["atn"],
                run_id,
                failures,
                groups={"app", "version"} if atn_done else None,
            )
            if atn and set(atn["artifacts"]) == set(GROUPS.values()):
                current.update(
                    artifacts=atn["artifacts"], revision=run_id, atn_fingerprint=fingerprints["atn"]
                )
                atn_done = True
        aus = None
        if sources["aus"] and needs_adi:
            aus = failures.attempt(
                f"aus/{key}",
                collect_source,
                store.s3,
                session.client("athena"),
                config,
                key,
                "aus",
                sources["aus"],
                run_id,
                failures,
            )
        if atn and {"app", "version"} <= atn["rows"].keys() and aus is not None:
            collected[key] = (atn["rows"], aus)
            complete[key] = fingerprints
        source_state[key] = current
        if not atn_done or (needs_adi and key not in collected):
            pending.add(key)
        else:
            pending.discard(key)
    if collected:
        last = max(collected)
        seamonkeys = {
            r[3] for r in collected[last][0]["app"] if r[1] == THEME and r[2] == SEAMONKEY
        }
        updated = copy.deepcopy(adi)
        accepted = set()
        for key, (rows, aus) in collected.items():

            def make_record(rows=rows, aus=aus, key=key):
                record = adi_record(rows["version"], aus, seamonkeys)
                validate_record("thunderbird_adi.json", key, record)
                return record

            record = failures.attempt(f"daily/ADI/{key}", make_record)
            if record is not None:
                updated[key] = record
                accepted.add(key)
            else:
                pending.add(key)
        # Build everything before touching the working snapshot. A disk write
        # failure aborts this component; it cannot publish a partial derived set.
        with tempfile.TemporaryDirectory(dir=directory) as temp:
            atomic_json(Path(temp) / "thunderbird_adi.json", updated)

            def derive():
                build_derived(updated, temp)
                return True

            built = failures.attempt("daily/derived", derive)
            if built:
                for path in Path(temp).glob("*.json"):
                    atomic_write(directory / path.name, path.read_bytes())
                adi = updated
                for key in accepted:
                    source_state[key]["fingerprints"] = complete[key]
            else:
                pending.update(collected)
    adjusted = recalculate_mau(baseline["thunderbird_ami.json"], adi, through, failures)
    atomic_json(directory / "thunderbird_ami.json", adjusted)
    if through.isoformat() not in adi:
        failures.record("daily/coverage", ValueError(f"ADI is not complete through {through}"))
    return sorted(pending | deferred)


def _run_component(config, directory, revision, component, through, start, max_days, refresh_week):
    directory = Path(directory)
    directory.parent.mkdir(parents=True, exist_ok=True)
    # Never let files from an interrupted run or another component enter the
    # authoritative snapshot. Each transaction starts from an exact restore.
    with tempfile.TemporaryDirectory(dir=directory.parent, prefix=".collect-") as work:
        return _collect_component(
            config,
            Path(work),
            directory,
            revision,
            component,
            through,
            start,
            max_days,
            refresh_week,
        )


def _collect_component(
    config, directory, output_directory, revision, component, through, start, max_days, refresh_week
):
    directory = Path(directory)
    session = boto3.Session(region_name=config.region)
    s3 = session.client(
        "s3",
        config=BotoConfig(max_pool_connections=16, retries={"mode": "standard", "max_attempts": 4}),
    )
    store = Store(s3, config)
    manifest, etag = store.current()
    if manifest is None:
        raise ValueError("Seed authoritative state before running collectors")
    store.restore(manifest, directory)
    validate(directory)
    baseline = read_data(directory)
    checkpoints = copy.deepcopy(manifest["checkpoints"])
    run_id = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    failures = Failures()
    details = {}
    if component == "daily":
        details["pending"] = collect_daily(
            config,
            directory,
            baseline,
            checkpoints,
            store,
            session,
            run_id,
            through,
            start,
            max_days,
            failures,
        )
    elif component == "sumo":
        details["source"] = {}
        result = failures.attempt(
            "sumo", sumo.collect, baseline["sumo.json"], through, source_info=details["source"]
        )
        if result is not None:
            atomic_json(
                directory / "sumo.json",
                merge_records("sumo.json", baseline["sumo.json"], result, failures.record),
            )
        if not details["source"]:
            details["source"] = checkpoints.get("sumo", {}).get("source", {})
    else:
        settings.s3bucket = config.telemetry_results
        settings.workgroup = config.telemetry_workgroup
        if component == "mau":
            filename = "thunderbird_ami.json"
            result = failures.attempt(
                "mau",
                monthlyusers.collect,
                copy.deepcopy(baseline[filename]),
                baseline["thunderbird_adi.json"],
                through,
                recalculate=True,
                on_error=lambda day, error: failures.record(f"mau/{day}", error),
            )
            if result is not None:
                atomic_json(
                    directory / filename,
                    merge_records(filename, baseline[filename], result[0], failures.record),
                )
        else:
            filename, collector = WEEKLY[component]
            existing = copy.deepcopy(baseline[filename])
            if refresh_week:
                records = existing.values() if component == "scalars" else [existing]
                for values in records:
                    values.pop(refresh_week.isoformat(), None)
            result = failures.attempt(
                component,
                collector,
                existing,
                through,
                on_error=lambda day, error: failures.record(f"{component}/{day}", error),
            )
            if result is not None:
                if component == "scalars":
                    result = {
                        scalar: merge_records(
                            scalar, baseline[filename].get(scalar, {}), values, failures.record
                        )
                        for scalar, values in result.items()
                    }
                else:
                    result = merge_records(filename, baseline[filename], result, failures.record)
                atomic_json(directory / filename, result)
        records = read_data(directory)[filename]
        if component == "scalars":
            for scalar, values in records.items():
                failures.attempt(
                    f"scalars/{scalar}/freshness", check_freshness, scalar, values, through
                )
        else:
            failures.attempt(f"{component}/freshness", check_freshness, filename, records, through)
    try:
        summary = validate(directory, baseline)
    except Exception as error:
        # A malformed result must not contaminate the next independent component.
        raise CollectionFailed(
            manifest,
            failures.errors
            + [{"component": component, "type": type(error).__name__, "error": str(error)}],
        ) from error
    checkpoints[component] = {
        "through": through.isoformat(),
        "summary": summary,
        "errors": failures.errors.copy(),
        **details,
    }
    saved = store.snapshot(directory, run_id, checkpoints, revision, etag)
    handoff(store, saved, failures)
    failures.attempt("local-output", store.restore, saved, output_directory)
    logging.info("Validated snapshot %s (%s)", run_id, component)
    if failures.errors:
        raise CollectionFailed(saved, failures.errors)
    return saved


def run(
    config,
    directory,
    revision,
    *,
    through=None,
    start=None,
    component="metrics",
    max_days=32,
    refresh_week=None,
    report=None,
):
    through = through or utc_today() - dt.timedelta(days=1)
    if component == "sumo":
        through = min(through, sumo.latest_complete_day())
    if through >= utc_today():
        raise ValueError("Only complete UTC days can be processed")
    if config.prefix == "stage":
        raise ValueError("Staging is read-only; use shadow for experimental collection")
    if refresh_week and (refresh_week.weekday() != 6 or refresh_week > through):
        raise ValueError("--refresh-week must be a completed Sunday")
    names = COMPONENTS[:-1] if component == "metrics" else [component]
    if any(name not in COMPONENTS for name in names):
        raise ValueError(f"Unknown component: {component}")
    manifest, errors = None, []
    for name in names:
        try:
            manifest = _run_component(
                config, directory, revision, name, through, start, max_days, refresh_week
            )
        except CollectionFailed as error:
            manifest = error.manifest
            errors.extend(error.errors)
        except Exception as error:
            errors.append({"component": name, "error": str(error), "type": type(error).__name__})
            logging.exception("Failed %s; continuing independent components", name)
    if report:
        atomic_json(
            report, {"snapshot": manifest["run_id"] if manifest else None, "errors": errors}
        )
    if errors:
        raise CollectionFailed(manifest, errors)
    return manifest
