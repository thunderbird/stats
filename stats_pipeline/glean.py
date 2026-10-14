"""Collect aggregate Thunderbird Glean data through the STMO read-only API.

Only aggregate counts leave the warehouse. All public records describe a
completed Monday–Sunday UTC submission window; they are not ADI/MAU estimates.
"""

import copy
import datetime as dt
import os
import re
import time

from .common import http_session, record_failure
from . import glean_sql

START_DATE = dt.date(2025, 5, 4)
BASE_URL = "https://sql.telemetry.mozilla.org"
SOURCE = "Thunderbird Desktop Glean via STMO / Telemetry (BigQuery)"
SECTIONS = ("metrics", "baseline", "addons", "oauth")
MIN_PUBLIC_CLIENTS = 100
PUBLIC_CHANNELS = frozenset({"esr", "release", "beta", "nightly"})
OTHER_LABEL = "__other__"
PLATFORM_DETAIL_VERSION = 1
PLATFORM_DESCRIPTION = (
    "Operating system version from each client's latest weekly baseline ping. "
    "Windows 10 and 11 use the reported build number; macOS reports Darwin "
    "kernel versions, and Linux reports kernel versions."
)
PRIVACY = {
    "minimum_label_clients": MIN_PUBLIC_CLIENTS,
    "suppressed_label": OTHER_LABEL,
    "static_label_exception": True,
    "coverage_versions": "major version; minimum client population applies",
}
# These names are fixed, public product concepts. Old snapshots did not retain
# per-label reporter counts, so only these labels can survive that migration.
STATIC_LABELS = {
    "mail_account_count": frozenset({"imap", "pop3", "nntp", "rss", "none", "movemail"}),
    "mail_oauth2_provider_count": glean_sql.OAUTH_ISSUERS,
    "addrbook_addressbook_count": frozenset({
        "jsaddrbook", "moz-abldapdirectory", "moz-abmdbdirectory", "moz-abcarddavdirectory",
    }),
    "calendar_calendar_count": frozenset({"storage", "caldav", "ics"}),
    "calendar_read_only_calendar_count": frozenset({"storage", "caldav", "ics"}),
    "mail_websearch_usage": frozenset({
        "google", "bing", "duckduckgo", "wikipedia", "amazon", "yahoo",
    }),
    "mail_mails_read": frozenset({"all"}),
    "compose_mails_sent": frozenset({"all"}),
    "mail_mails_read_secure": glean_sql.SECURITY_LABELS,
    "mail_secure_mail_loaded": glean_sql.SECURITY_LABELS,
}


class Client:
    """Bounded STMO queries; credentials stay in headers and never in JSON."""

    def __init__(self, api_key=None, *, session=None, timeout=300, poll_interval=1):
        api_key = api_key or os.getenv("GLEAN_API_KEY") or os.getenv("GLEAN_KEY")
        if not api_key:
            raise ValueError("GLEAN_API_KEY is required for Glean collection")
        if timeout <= 0 or poll_interval <= 0:
            raise ValueError("Glean timeouts and polling intervals must be positive")
        self.session = session or http_session()
        self.owned_session = session is None
        self.session.headers.update({"Authorization": f"Key {api_key}"})
        self.timeout, self.poll_interval = timeout, poll_interval
        self.source_id = None
        self._fields = None

    def close(self):
        if self.owned_session:
            self.session.close()

    def request(self, method, path, deadline, **kwargs):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("STMO query exceeded its time limit")
        response = getattr(self.session, method)(
            BASE_URL + path, timeout=min(30, remaining), **kwargs
        )
        response.raise_for_status()
        return response.json()

    def query(self, sql):
        # SQL is generated locally, never accepted from the public site.
        if not sql.lstrip().upper().startswith(("SELECT ", "WITH ")):
            raise ValueError("STMO collection requires a read-only SELECT query")
        deadline = time.monotonic() + self.timeout
        if self.source_id is None:
            sources = self.request("get", "/api/data_sources", deadline)
            source = next((s for s in sources if s.get("name") == "Telemetry (BigQuery)"), None)
            if source is None:
                raise ValueError("STMO Telemetry (BigQuery) data source was not found")
            self.source_id = source["id"]
        payload = self.request(
            "post", "/api/query_results", deadline,
            json={"data_source_id": self.source_id, "query": sql, "max_age": 0},
        )
        while "query_result" not in payload:
            job = payload.get("job", {})
            if job.get("status") in (4, 5):
                raise RuntimeError(f"STMO query failed: {job.get('error', 'cancelled')}")
            if job.get("status") == 3:
                result_id = str(job.get("query_result_id", ""))
                if not result_id.isdecimal():
                    raise ValueError("STMO returned an invalid query result ID")
                payload = self.request("get", f"/api/query_results/{result_id}", deadline)
                break
            job_id = str(job.get("id", ""))
            if not re.fullmatch(r"[a-zA-Z0-9_-]+", job_id):
                raise ValueError("STMO returned an invalid query job")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("STMO query exceeded its time limit")
            time.sleep(min(self.poll_interval, remaining))
            payload = self.request("get", f"/api/jobs/{job_id}", deadline)
        rows = payload.get("query_result", {}).get("data", {}).get("rows")
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ValueError("STMO query result is not a row array")
        return rows

    def fields(self):
        if self._fields is None:
            self._fields = {
                (row["table_name"], row["field_path"])
                for row in self.query(glean_sql.schema_query())
            }
        return self._fields


def empty_data():
    return {
        "schema": 1,
        "source": SOURCE,
        "window": "Monday–Sunday UTC; submission date; seven completed days",
        "metrics": {
            key: {**glean_sql.public_definition(definition), "records": {}}
            for key, definition in glean_sql.METRICS.items()
        },
        "platforms": {
            "label": "Platforms", "unit": "reporting clients",
            "description": PLATFORM_DESCRIPTION,
            "records": {},
        },
        "locales": {
            "label": "Application languages", "unit": "reporting clients",
            "description": "Application locale from each client's latest weekly baseline ping.",
            "records": {},
        },
        "addons": {
            "label": "Active extensions", "unit": "reporting clients",
            "description": "Latest add-ons ping per client; excludes themes and built-in add-ons.",
            "comparison": "Top ten are ranked within each Glean week, not the ATN ranking.",
            "records": {},
        },
        "oauth": oauth_definition(),
        "coverage": {"weeks": {}, "start": str(START_DATE)},
        "privacy": dict(PRIVACY),
    }


def oauth_definition():
    return {
        "label": "OAuth authentication", "unit": "authentication events",
        "description": "OAuth authentication-window outcomes from distinct event pings. "
                       "Counts windows shown, not background token refreshes or accounts.",
        "records": {},
    }


def latest_week(through):
    """Wait for one complete UTC ingestion day after the Sunday endpoint.

    The daily runner passes yesterday as ``through``. Consequently Monday's
    run still uses the preceding week; Tuesday's run can collect this Sunday.
    """
    eligible = through - dt.timedelta(days=1)
    return eligible - dt.timedelta(days=(eligible.weekday() + 1) % 7)


def _integer(value, label):
    if isinstance(value, bool):
        raise ValueError(f"Invalid {label}: expected a non-negative integer")
    try:
        integer = int(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError(f"Invalid {label}: expected a non-negative integer") from error
    if integer < 0 or integer != value:
        raise ValueError(f"Invalid {label}: expected a non-negative integer")
    return integer


def _public_counts(values, *, channels=False, versions=False):
    if not isinstance(values, dict):
        raise ValueError("Invalid public Glean count map")
    grouped = {}
    for key, count in values.items():
        count = _integer(count, "public Glean count")
        if not isinstance(key, str) or not key:
            raise ValueError("Invalid public Glean count label")
        if channels:
            key = key.lower() if key.lower() in PUBLIC_CHANNELS else "other"
        elif versions:
            match = re.fullmatch(r"([0-9]{1,4})(?:\.[0-9]{1,6})*(?:(?:a|b)[0-9]{1,4}|esr)?",
                                 key.lower())
            key = str(int(match[1])) if match else "other"
        grouped[key] = grouped.get(key, 0) + count
    if channels:
        return grouped
    output = {}
    for key, count in grouped.items():
        if versions:
            key = key if key == "other" or count >= MIN_PUBLIC_CLIENTS else "other"
        else:
            key = key if key == OTHER_LABEL or count >= MIN_PUBLIC_CLIENTS else OTHER_LABEL
        output[key] = output.get(key, 0) + count
    return output


def _sanitize_coverage(record):
    coverage = record.get("coverage")
    if not isinstance(coverage, dict):
        return
    for name in ("channels", "versions"):
        if name in coverage:
            coverage[name] = _public_counts(
                coverage[name], channels=name == "channels", versions=name == "versions",
            )


def _sanitize_metric_record(metric, record):
    values = record.get("versions")
    if not isinstance(values, dict):
        raise ValueError("Invalid public Glean metric values")
    reporters = record.get("label_clients", {})
    if not isinstance(reporters, dict):
        raise ValueError("Invalid public Glean label populations")
    population = record.get("count")
    if population is not None:
        population = _integer(population, "public Glean reporting population")
    static = STATIC_LABELS.get(metric, frozenset({"all"}))
    public_values, public_reporters = {}, {}
    for key, value in values.items():
        if not isinstance(key, str) or not key:
            raise ValueError("Invalid public Glean metric label")
        value = _integer(value, "public Glean metric value")
        clients = reporters.get(key)
        if clients is not None:
            clients = _integer(clients, "public Glean label population")
            if population is not None and clients > population:
                raise ValueError("Public Glean label population exceeds reporting population")
        retain = key == OTHER_LABEL or key in static or (
            metric != "mail_oauth2_provider_count"
            and clients is not None and clients >= MIN_PUBLIC_CLIENTS
        )
        public_key = key if retain else OTHER_LABEL
        public_values[public_key] = public_values.get(public_key, 0) + value
        if retain and key != OTHER_LABEL and clients is not None:
            public_reporters[key] = clients
    record["versions"] = public_values
    if public_reporters:
        record["label_clients"] = public_reporters
    else:
        record.pop("label_clients", None)
    _sanitize_coverage(record)


def sanitize_public(data):
    """Return a safe copy, including older/subset snapshots, without network I/O.

    Unknown historical label populations are not inferred from measurement
    totals: free-form labels without reporter counts are conservatively folded.
    The suppression bucket has no fabricated distinct-client count, since
    clients can report more than one suppressed label.
    """
    if not isinstance(data, dict):
        raise ValueError("Invalid public Glean data")
    output = copy.deepcopy(data)
    metrics = output.get("metrics", {})
    if not isinstance(metrics, dict):
        raise ValueError("Invalid public Glean metrics")
    for metric, group in metrics.items():
        if not isinstance(group, dict) or not isinstance(group.get("records", {}), dict):
            raise ValueError("Invalid public Glean metric records")
        for record in group.get("records", {}).values():
            if not isinstance(record, dict):
                raise ValueError("Invalid public Glean metric record")
            _sanitize_metric_record(metric, record)
    for name in ("platforms", "locales", "addons"):
        if name not in output:
            continue
        group = output[name]
        if not isinstance(group, dict) or not isinstance(group.get("records", {}), dict):
            raise ValueError("Invalid public Glean distribution records")
        for record in group.get("records", {}).values():
            if not isinstance(record, dict):
                raise ValueError("Invalid public Glean distribution record")
            if name != "addons" and "versions" in record:
                record["versions"] = _public_counts(record["versions"])
            if name == "addons" and "top10" in record:
                record["top10"] = {
                    key: count for key, count in record["top10"].items()
                    if _integer(count, "popular add-on clients") >= MIN_PUBLIC_CLIENTS
                }
            _sanitize_coverage(record)
    if "oauth" in output:
        group = output["oauth"]
        if not isinstance(group, dict) or not isinstance(group.get("records", {}), dict):
            raise ValueError("Invalid public Glean OAuth records")
        for record in group.get("records", {}).values():
            _sanitize_oauth_record(record)
    output["privacy"] = dict(PRIVACY)
    return output


def _sanitize_oauth_record(record, *, issuer=False):
    """Keep enum labels exact and use distinct reporters to suppress versions."""
    if not isinstance(record, dict) or not isinstance(record.get("breakdowns"), dict):
        raise ValueError("Invalid public Glean OAuth record")
    populations = record.get("label_clients", {})
    if not isinstance(populations, dict):
        raise ValueError("Invalid OAuth label populations")
    safe_counts, safe_clients = {}, {}
    for dimension, values in record["breakdowns"].items():
        if dimension not in glean_sql.OAUTH_DIMENSIONS or (issuer and dimension == "issuer"):
            raise ValueError("Invalid OAuth dimension")
        if not isinstance(values, dict) or not isinstance(populations.get(dimension, {}), dict):
            raise ValueError("Invalid OAuth dimension counts")
        reporters = populations.get(dimension, {})
        grouped, named = {}, {}
        for key, value in values.items():
            if not isinstance(key, str) or not key:
                raise ValueError("Invalid OAuth label")
            value = _integer(value, "OAuth event total")
            count = reporters.get(key)
            if count is not None:
                count = _integer(count, "OAuth label population")
                if count > record["count"] or count > value:
                    raise ValueError("OAuth label population exceeds its population or events")
            if dimension == "version":
                safe = key == "other" or (
                    re.fullmatch(r"[0-9]{1,4}", key) is not None
                    and count is not None and count >= MIN_PUBLIC_CLIENTS
                )
                public_key = key if safe else "other"
            else:
                safe = key in glean_sql.OAUTH_LABELS[dimension]
                public_key = key if safe else (
                    OTHER_LABEL if dimension == "issuer" else
                    "other" if dimension == "channel" else "Unknown"
                )
            grouped[public_key] = grouped.get(public_key, 0) + value
            # A sum of per-label populations is not a distinct-client count.
            # Keep counts only for unchanged named labels, not merged buckets.
            if safe and public_key not in ("other", OTHER_LABEL, "Unknown") and count is not None:
                named[public_key] = count
        safe_counts[dimension] = grouped
        safe_clients[dimension] = named
    record["breakdowns"] = safe_counts
    record["label_clients"] = safe_clients
    if issuer:
        record.pop("issuers", None)
        return
    issuers = record.get("issuers", {})
    if not isinstance(issuers, dict):
        raise ValueError("Invalid OAuth provider records")
    # Unknown historical issuer details cannot be merged without inventing a
    # distinct-client count. Their events remain in the global issuer marginal.
    safe_issuers = {}
    for key, detail in issuers.items():
        if key not in glean_sql.OAUTH_LABELS["issuer"]:
            continue
        _sanitize_oauth_record(detail, issuer=True)
        safe_issuers[key] = detail
    record["issuers"] = safe_issuers


def _counts(rows, section):
    result = {}
    for row in rows:
        if row["section"] != section:
            continue
        key = row.get("key")
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"Invalid or duplicate {section} key")
        result[key] = _integer(row["count"], f"{section} count")
    return result


def baseline_records(rows):
    totals = [row for row in rows if row["section"] == "total"]
    if len(totals) != 1:
        raise ValueError("Baseline query must return one total")
    total = _integer(totals[0]["count"], "baseline total")
    if not total:
        raise ValueError("No Glean baseline clients in the reporting week")
    coverage = {section: _counts(rows, section) for section in ("channels", "versions")}
    records = {}
    for name in ("platforms", "locales"):
        counts = _counts(rows, name)
        if sum(counts.values()) != total:
            raise ValueError(f"{name} counts do not match the baseline population")
        records[name] = {
            "count": total, "versions": _public_counts(counts),
            "coverage": copy.deepcopy(coverage),
        }
        _sanitize_coverage(records[name])
    return records


def metric_records(rows, supported):
    records = {}
    for key in supported:
        values = [row for row in rows if row.get("metric") == key]
        if not values:
            continue
        summaries = [row for row in values if row["section"] == "summary"]
        if len(summaries) != 1:
            raise ValueError(f"Expected one Glean reporter count for {key}")
        reporters = _integer(summaries[0]["count"], f"{key} reporters")
        totals, label_clients = {}, {}
        for row in values:
            if row["section"] == "value":
                if not isinstance(row["key"], str) or not row["key"] or row["key"] in totals:
                    raise ValueError(f"Invalid or duplicate Glean value key for {key}")
                totals[row["key"]] = _integer(row["total"], f"{key} value")
                label_clients[row["key"]] = _integer(row["count"], f"{key} label reporters")
                if label_clients[row["key"]] > reporters:
                    raise ValueError(f"Label reporter count exceeds population for {key}")
        if reporters < 1 or not totals:
            raise ValueError(f"Incomplete observed Glean metric: {key}")
        records[key] = {
            "count": reporters, "total": sum(totals.values()), "versions": totals,
            "label_clients": label_clients,
            "coverage": {
                "channels": _counts(values, "channel"),
                "versions": _counts(values, "version"),
            },
        }
        _sanitize_metric_record(key, records[key])
    if any(row.get("metric") not in supported for row in rows):
        raise ValueError("Query returned an unexpected Glean metric")
    return records


def addon_record(rows):
    summaries = [row for row in rows if row["section"] == "summary"]
    if len(summaries) != 1:
        raise ValueError("Add-ons query must return one population total")
    row = summaries[0]
    total = _integer(row["count"], "add-ons population")
    reporting = _integer(row["reporting_clients"], "add-ons reporting population")
    source_clients = _integer(row.get("source_clients", total), "add-ons source population")
    if not total or reporting != total:
        raise ValueError("Add-ons snapshots are absent or not arrays for some reporting clients")
    if source_clients < total:
        raise ValueError("Add-ons snapshot population exceeds source population")
    count = _integer(row["addon_count"], "extension users")
    minus = _integer(row["minustop10_count"], "extension users excluding top ten")
    if not 0 <= minus <= count <= total:
        raise ValueError("Add-ons client counts are inconsistent")
    record = {
        "total": total, "addon_count": count, "minustop10_count": minus,
        "top10": {key: value for key, value in _counts(rows, "popular").items()
                  if value >= MIN_PUBLIC_CLIENTS},
        "coverage": {"channels": _counts(rows, "channel"),
                     "versions": _counts(rows, "version"),
                     "source_clients": source_clients,
                     "missing_snapshots": source_clients - total},
    }
    _sanitize_coverage(record)
    return record


def oauth_record(rows):
    """Build independent marginals and provider drilldowns from aggregates."""
    summaries = [row for row in rows if row.get("scope") == "all"
                 and row.get("section") == "summary"]
    if len(summaries) != 1:
        raise ValueError("OAuth query must return one population total")

    def summary(row):
        return {
            "count": _integer(row.get("count"), "OAuth population"),
            "total": _integer(row.get("total"), "OAuth event total"),
            "breakdowns": {}, "label_clients": {},
        }

    record = summary(summaries[0])
    record["issuers"] = {}
    for row in rows:
        if row.get("scope") == "issuer" and row.get("section") == "summary":
            key = row.get("issuer")
            if not isinstance(key, str) or not key or key in record["issuers"]:
                raise ValueError("Invalid or duplicate OAuth provider")
            record["issuers"][key] = summary(row)
    for row in rows:
        scope, dimension = row.get("scope"), row.get("section")
        if scope not in ("all", "issuer"):
            raise ValueError("Invalid OAuth aggregate scope")
        if dimension == "summary":
            continue
        if dimension not in glean_sql.OAUTH_DIMENSIONS or dimension == "issuer":
            raise ValueError("Invalid OAuth aggregate dimension")
        target = record if scope == "all" else record["issuers"].get(row.get("issuer"))
        if target is None:
            raise ValueError("OAuth provider marginal lacks a summary")
        key = row.get("key")
        values = target["breakdowns"].setdefault(dimension, {})
        if not isinstance(key, str) or not key or key in values:
            raise ValueError("Invalid or duplicate OAuth aggregate label")
        values[key] = _integer(row.get("total"), "OAuth event total")
        target["label_clients"].setdefault(dimension, {})[key] = _integer(
            row.get("count"), "OAuth label population",
        )
    record["breakdowns"]["issuer"] = {
        key: value["total"] for key, value in record["issuers"].items()
    }
    record["label_clients"]["issuer"] = {
        key: value["count"] for key, value in record["issuers"].items()
    }
    # Validate raw marginals before privacy folding can merge any categories.
    _validate_oauth_record(record)
    _sanitize_oauth_record(record)
    _validate_oauth_record(record)
    return record


def _validate_oauth_record(record, *, issuer=False):
    if not isinstance(record, dict):
        raise ValueError("Invalid OAuth record")
    population = _integer(record.get("count"), "OAuth population")
    total = _integer(record.get("total"), "OAuth event total")
    if not 0 < population <= total:
        raise ValueError("OAuth records require events and a reporting population")
    dimensions = set(glean_sql.OAUTH_DIMENSIONS) - ({"issuer"} if issuer else set())
    breakdowns, populations = record.get("breakdowns"), record.get("label_clients", {})
    if not isinstance(breakdowns, dict) or set(breakdowns) != dimensions:
        raise ValueError("OAuth record lacks independent dimension marginals")
    if not isinstance(populations, dict) or set(populations) - dimensions:
        raise ValueError("Invalid OAuth label populations")
    for dimension, values in breakdowns.items():
        if not isinstance(values, dict) or any(not isinstance(key, str) or not key for key in values):
            raise ValueError("Invalid OAuth dimension labels")
        if sum(_integer(value, "OAuth marginal total") for value in values.values()) != total:
            raise ValueError("OAuth dimension does not sum to its event total")
        reporters = populations.get(dimension, {})
        if not isinstance(reporters, dict) or any(
            key not in values or _integer(count, "OAuth label population") > min(population, values[key])
            for key, count in reporters.items()
        ):
            raise ValueError("OAuth label population exceeds its population or events")
    if not issuer:
        issuers = record.get("issuers")
        if not isinstance(issuers, dict):
            raise ValueError("Invalid OAuth provider records")
        for key, detail in issuers.items():
            _validate_oauth_record(detail, issuer=True)
            if (detail["total"] != breakdowns["issuer"].get(key)
                    or detail["count"] > population):
                raise ValueError("OAuth provider does not match its global marginal")


def _validate_record(record, *, addon=False, distribution=False):
    if not isinstance(record, dict):
        raise ValueError("Invalid Glean record")
    total = _integer(record.get("total" if addon else "count"), "Glean population")
    if total < 1:
        raise ValueError("Observed Glean records require a reporting population")
    if addon:
        count = _integer(record.get("addon_count"), "extension count")
        minus = _integer(record.get("minustop10_count"), "extension count excluding top ten")
        if not minus <= count <= total:
            raise ValueError("Add-ons count exceeds reporting population")
        top10 = record.get("top10", {})
        if not isinstance(top10, dict) or len(top10) > 10 or any(
            not isinstance(key, str) or not key
            or _integer(value, "popular add-on clients") > total
            for key, value in top10.items()
        ):
            raise ValueError("Invalid popular add-on client counts")
        source = _integer(record.get("coverage", {}).get("source_clients", total),
                          "add-ons source population")
        missing = _integer(record.get("coverage", {}).get("missing_snapshots", 0),
                           "missing add-ons snapshots")
        if source - missing != total:
            raise ValueError("Add-ons source population does not match snapshot coverage")
    else:
        values = record.get("versions")
        if not isinstance(values, dict) or not values:
            raise ValueError("Glean record has no aggregate values")
        summed = 0
        for key, value in values.items():
            if not isinstance(key, str) or not key:
                raise ValueError("Invalid Glean aggregate label")
            summed += _integer(value, "Glean aggregate value")
        if distribution and summed != total:
            raise ValueError("Glean distribution does not sum to its population")
        if not distribution and _integer(record.get("total"), "Glean measured total") != summed:
            raise ValueError("Glean values do not sum to their measured total")
        label_clients = record.get("label_clients", {})
        if not isinstance(label_clients, dict) or any(
            key not in values or _integer(value, "Glean label reporters") > total
            for key, value in label_clients.items()
        ):
            raise ValueError("Invalid Glean per-label reporting populations")
    coverage = record.get("coverage", {})
    for name in ("channels", "versions"):
        counts = coverage.get(name)
        if not isinstance(counts, dict) or sum(
            _integer(value, "Glean coverage") for value in counts.values()
        ) != total:
            raise ValueError(f"Glean {name} coverage does not match its population")


def validate(data):
    if not isinstance(data, dict) or data.get("schema") != 1 or data.get("source") != SOURCE:
        raise ValueError("Invalid Glean data schema or source")
    metrics = data.get("metrics")
    if not isinstance(metrics, dict) or any(
        not isinstance(key, str) or not re.fullmatch(r"[a-z][a-z0-9_]*", key)
        for key in metrics
    ):
        raise ValueError("Invalid Glean metric definitions")
    groups = [(key, value, False, False) for key, value in metrics.items()]
    groups += [(key, data.get(key), key == "addons", key != "addons")
               for key in ("platforms", "locales", "addons")]
    for key, group, addon, distribution in groups:
        if not isinstance(group, dict) or not isinstance(group.get("records"), dict):
            raise ValueError(f"Invalid Glean records for {key}")
        for day, record in group["records"].items():
            glean_sql.bounds(day)
            if dt.date.fromisoformat(day) < START_DATE:
                raise ValueError("Glean record predates the supported archive boundary")
            _validate_record(record, addon=addon, distribution=distribution)
    oauth = data.get("oauth")
    if oauth is not None:
        if not isinstance(oauth, dict) or not isinstance(oauth.get("records"), dict):
            raise ValueError("Invalid OAuth records")
        for day, record in oauth["records"].items():
            glean_sql.bounds(day)
            if dt.date.fromisoformat(day) < START_DATE:
                raise ValueError("OAuth record predates the supported archive boundary")
            _validate_oauth_record(record)
    coverage = data.get("coverage", {}).get("weeks")
    if not isinstance(coverage, dict):
        raise ValueError("Invalid Glean collection coverage")
    for day, sections in coverage.items():
        glean_sql.bounds(day)
        if not isinstance(sections, dict) or any(key not in SECTIONS for key in sections):
            raise ValueError("Invalid Glean weekly section coverage")
    result = {key: len(group["records"]) for key, group, _, _ in groups}
    if oauth is not None:
        result["oauth"] = len(oauth["records"])
    return result


def collect(
    existing, through, *, start=None, refresh_week=None, on_error=None, client=None, max_weeks=8,
):
    """Fill missing weekly sections; failed refreshes retain their previous data.

    Unsupported/unobserved metrics are explicitly listed in each successful
    week's coverage. An absent metric record never means a recorded zero.
    """
    if isinstance(max_weeks, bool) or not isinstance(max_weeks, int) or max_weeks < 1:
        raise ValueError("Glean max_weeks must be a positive integer")
    result = sanitize_public(existing or empty_data())
    validate(result)
    # OAuth is additive to schema 1: old snapshots remain valid archives and
    # acquire only the missing weekly section on the next collection run.
    result.setdefault("oauth", oauth_definition())
    # Cached baseline queries grouped only by OS family. Retry just this
    # section, preserving its old counts until a detailed query succeeds.
    result["platforms"]["description"] = PLATFORM_DESCRIPTION
    for day, sections in result["coverage"]["weeks"].items():
        baseline = sections.get("baseline")
        if (baseline and day in result["platforms"]["records"]
                and baseline.get("platform_detail") != PLATFORM_DETAIL_VERSION):
            baseline["pending_platform_detail"] = True
    baseline_refresh = {
        day for day, sections in result["coverage"]["weeks"].items()
        if sections.get("baseline", {}).get("pending_platform_detail")
    }
    # Schema changes must not make a valid stored snapshot unreadable. Add new
    # definitions before collecting and preserve removed definitions as history.
    added = set(glean_sql.METRICS) - set(result["metrics"])
    for name, definition in glean_sql.METRICS.items():
        group = result["metrics"].setdefault(name, {"records": {}})
        group.update(glean_sql.public_definition(definition))
        group.pop("retired", None)
    for name, group in result["metrics"].items():
        if name not in glean_sql.METRICS:
            group["retired"] = True
    for sections in result["coverage"]["weeks"].values():
        coverage = sections.get("metrics")
        if coverage is not None:
            known = set().union(*(coverage.get(key, []) for key in (
                "observed", "unobserved", "unsupported",
            )))
            pending_definitions = added | (set(glean_sql.METRICS) - known)
            if pending_definitions:
                # Keep the old successful audit if the expanded query fails.
                # A persistent retry marker also covers a missing definition
                # that the previous availability audit already mentioned.
                coverage["pending_definitions"] = sorted(pending_definitions | set(
                    coverage.get("pending_definitions", []),
                ))
    metric_refresh = {
        day for day, sections in result["coverage"]["weeks"].items()
        if sections.get("metrics", {}).get("pending_definitions")
    }
    start = max(START_DATE, start or START_DATE)
    first = start + dt.timedelta(days=(6 - start.weekday()) % 7)
    last = latest_week(through)
    if refresh_week is not None and (
        refresh_week.weekday() != 6 or not START_DATE <= refresh_week <= last
    ):
        raise ValueError("Glean refresh date must be a completed supported Sunday")
    days = []
    while first <= last:
        days.append(first)
        first += dt.timedelta(days=7)
    if refresh_week and refresh_week not in days:
        days.append(refresh_week)
    pending = [day for day in days if day == refresh_week or str(day) in metric_refresh
               or str(day) in baseline_refresh or any(
        section not in result["coverage"]["weeks"].get(str(day), {}) for section in SECTIONS
    )]
    if not pending:
        return result
    owned = client is None
    client = client or Client()
    try:
        fields = client.fields()
        supported = glean_sql.supported_metrics(fields)
        event_ids = sorted(key for key in supported if glean_sql.METRICS[key]["kind"] == "event")
        metric_ids = sorted(supported - set(event_ids))
        unsupported = sorted(set(glean_sql.METRICS) - supported)
        # Start with current data so a first run/backlog cannot leave the public
        # dashboard stale. Later runs progressively fill the older weeks.
        pending.sort(key=lambda day: (day != refresh_week, -day.toordinal()))
        for day in pending[:max_weeks]:
            key = str(day)
            coverage = result["coverage"]["weeks"].setdefault(key, {})
            for section in SECTIONS:
                if section in coverage and day != refresh_week and not (
                    (section == "metrics" and key in metric_refresh)
                    or (section == "baseline" and key in baseline_refresh)
                ):
                    continue
                try:
                    if section == "baseline":
                        rows = client.query(glean_sql.baseline_query(day))
                        if not rows or (len(rows) == 1 and rows[0].get("section") == "total"
                                        and _integer(rows[0].get("count"), "baseline total") == 0):
                            if any(key in result[name]["records"]
                                   for name in ("platforms", "locales")):
                                raise ValueError("Glean refresh lost baseline observations")
                            coverage[section] = {"status": "unobserved"}
                            continue
                        records = baseline_records(rows)
                        for record in records.values():
                            _validate_record(record, distribution=True)
                        for name, record in records.items():
                            result[name]["records"][key] = record
                        coverage[section] = {"status": "complete", "platform_detail": PLATFORM_DETAIL_VERSION}
                        baseline_refresh.discard(key)
                    elif section == "metrics":
                        rows = client.query(glean_sql.metric_query(day, metric_ids)) if metric_ids else []
                        if event_ids:
                            rows += client.query(glean_sql.event_query(day, event_ids))
                        records = metric_records(rows, supported)
                        for record in records.values():
                            _validate_record(record)
                        previous = {name for name, group in result["metrics"].items()
                                    if name in glean_sql.METRICS and key in group["records"]}
                        if previous - records.keys():
                            raise ValueError("Glean refresh lost previously observed metric data")
                        for name, record in records.items():
                            result["metrics"][name]["records"][key] = record
                        coverage[section] = {
                            "status": "complete", "observed": sorted(records),
                            "unobserved": sorted(supported - records.keys()),
                            "unsupported": unsupported,
                        }
                        metric_refresh.discard(key)
                    elif section == "oauth":
                        if not all(("events", field) in fields for field in glean_sql.EVENT_FIELDS):
                            coverage[section] = {"status": "unsupported"}
                            continue
                        rows = client.query(glean_sql.oauth_query(day))
                        if (len(rows) == 1 and rows[0].get("scope") == "all"
                                and rows[0].get("section") == "summary"
                                and _integer(rows[0].get("total"), "OAuth events") == 0
                                and _integer(rows[0].get("count"), "OAuth population") == 0):
                            if key in result["oauth"]["records"]:
                                raise ValueError("Glean refresh lost OAuth observations")
                            coverage[section] = {"status": "unobserved"}
                            continue
                        record = oauth_record(rows)
                        result["oauth"]["records"][key] = record
                        coverage[section] = {"status": "complete"}
                    else:
                        if ("addons", "metrics.object.addons_active_addons") not in fields:
                            coverage[section] = {"status": "unsupported"}
                            continue
                        rows = client.query(glean_sql.addons_query(day))
                        if len(rows) == 1 and rows[0].get("section") == "summary" and all(
                            _integer(rows[0].get(field), f"add-ons {field}") == 0
                            for field in ("count", "addon_count", "minustop10_count",
                                          "reporting_clients")
                        ):
                            if key in result["addons"]["records"]:
                                raise ValueError("Glean refresh lost add-on observations")
                            coverage[section] = {
                                "status": "unobserved",
                                "source_clients": _integer(rows[0].get("source_clients", 0),
                                                           "add-ons source population"),
                            }
                            continue
                        record = addon_record(rows)
                        _validate_record(record, addon=True)
                        result["addons"]["records"][key] = record
                        coverage[section] = {"status": "complete"}
                except Exception as error:
                    record_failure(on_error, f"{key}/{section}", error)
        result["coverage"]["pending"] = [str(day) for day in sorted(days)
                                         if str(day) in metric_refresh or str(day) in baseline_refresh or any(
            section not in result["coverage"]["weeks"].get(str(day), {}) for section in SECTIONS
        )]
        validate(result)
        return result
    finally:
        if owned:
            client.close()


def check_freshness(data, through):
    """Require completed section queries, without inventing absent metric values."""
    validate(data)
    week = str(latest_week(through))
    if latest_week(through) < START_DATE:
        return
    sections = data["coverage"]["weeks"].get(week, {})
    missing = [section for section in SECTIONS if section not in sections]
    if missing:
        raise ValueError(f"Glean data is not complete through {week}: {', '.join(missing)}")
    if sections["metrics"].get("pending_definitions"):
        raise ValueError(f"Glean metric definitions have not been refreshed for {week}")
    if sections["baseline"].get("pending_platform_detail"):
        raise ValueError(f"Glean operating system versions have not been refreshed for {week}")
    if sections["baseline"].get("status") != "complete":
        raise ValueError(f"Glean has no baseline observations for {week}")
