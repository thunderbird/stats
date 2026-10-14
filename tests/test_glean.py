import copy
import datetime as dt
import re
from unittest.mock import Mock

import pytest

from stats_pipeline import glean, glean_sql

WEEK = dt.date(2026, 10, 11)
THROUGH = WEEK + dt.timedelta(days=1)
METRIC = "mail_account_count"


def baseline_rows():
    return [
        {"section": "total", "key": "", "count": 8},
        {"section": "platforms", "key": "Windows", "count": 5},
        {"section": "platforms", "key": "Linux", "count": 3},
        {"section": "locales", "key": "en-US", "count": 6},
        {"section": "locales", "key": "de", "count": 2},
        {"section": "channels", "key": "esr", "count": 8},
        {"section": "versions", "key": "140.4.0", "count": 8},
    ]


def metric_rows():
    return [
        {"section": "summary", "metric": METRIC, "key": "", "count": 4, "total": None},
        {"section": "value", "metric": METRIC, "key": "imap", "count": 4, "total": 7},
        {"section": "value", "metric": METRIC, "key": "pop3", "count": 1, "total": 1},
        {"section": "channel", "metric": METRIC, "key": "esr", "count": 4, "total": None},
        {"section": "version", "metric": METRIC, "key": "140.4.0", "count": 4, "total": None},
    ]


def addon_rows():
    return [
        {"section": "summary", "key": "", "count": 8, "addon_count": 5,
         "minustop10_count": 2, "reporting_clients": 8},
        {"section": "channel", "key": "esr", "count": 8},
        {"section": "version", "key": "140.4.0", "count": 8},
        {"section": "popular", "key": "example@addon", "count": 3},
    ]


class FixtureClient:
    def __init__(self, failing=()):
        self.failing = set(failing)
        self.calls = []

    def fields(self):
        return {("metrics", row["field"]) for row in glean_sql.METRICS.values()} | {
            ("addons", "metrics.object.addons_active_addons")
        }

    def query(self, sql):
        section = "baseline" if ".baseline`" in sql else (
            "addons" if ".addons`" in sql else "metrics"
        )
        self.calls.append(section)
        if section in self.failing:
            raise RuntimeError("Source temporarily unavailable")
        return {"baseline": baseline_rows, "metrics": metric_rows, "addons": addon_rows}[section]()


def collect(client=None, **kwargs):
    return glean.collect({}, THROUGH, start=WEEK, client=client or FixtureClient(), **kwargs)


def test_collects_only_public_aggregates_with_explicit_populations():
    data = collect()
    assert data["platforms"]["records"][str(WEEK)] == {
        "count": 8, "versions": {"__other__": 8},
        "coverage": {"channels": {"esr": 8}, "versions": {"other": 8}},
    }
    account = data["metrics"][METRIC]["records"][str(WEEK)]
    assert account["count"] == 4
    assert account["total"] == 8
    assert account["versions"] == {"imap": 7, "pop3": 1}
    assert data["addons"]["records"][str(WEEK)]["minustop10_count"] == 2
    assert "client_id" not in str(data) and "document_id" not in str(data)
    assert glean.validate(data)[METRIC] == 1
    glean.check_freshness(data, WEEK + dt.timedelta(days=1))


def test_unobserved_metrics_are_absent_and_documented_not_zero():
    data = collect()
    coverage = data["coverage"]["weeks"][str(WEEK)]["metrics"]
    assert coverage["observed"] == [METRIC]
    assert "mail_mails_read" in coverage["unobserved"]
    assert not data["metrics"]["mail_mails_read"]["records"]


def test_zero_measurement_with_reporting_population_is_retained():
    rows = metric_rows()
    for row in rows:
        if row["section"] == "value":
            row["total"] = 0
    record = glean.metric_records(rows, {METRIC})[METRIC]
    assert record["total"] == 0 and record["count"] == 4
    glean._validate_record(record)


def test_completed_weeks_need_no_network():
    existing = collect()
    client = Mock()
    result = glean.collect(existing, THROUGH, start=WEEK, client=client)
    assert result == existing and result is not existing
    client.fields.assert_not_called()
    client.query.assert_not_called()


def test_os_family_cache_refreshes_only_baseline_and_retains_version_counts():
    source = collect()
    rows = baseline_rows()
    for row in rows:
        row["count"] *= 200
    for name, record in glean.baseline_records(rows).items():
        source[name]["records"][str(WEEK)] = record
    source["coverage"]["weeks"][str(WEEK)]["baseline"].pop("platform_detail")
    original = copy.deepcopy(source)
    detailed = [row for row in rows if row["section"] != "platforms"] + [
        {"section": "platforms", "key": "Windows 10", "count": 600},
        {"section": "platforms", "key": "Windows 11", "count": 400},
        {"section": "platforms", "key": "Linux 6.8", "count": 600},
    ]
    client = FixtureClient()
    client.query = lambda sql: (client.calls.append("baseline") or detailed)
    result = glean.collect(source, THROUGH, start=WEEK, client=client)
    assert client.calls == ["baseline"]
    assert result["platforms"]["records"][str(WEEK)]["versions"] == {
        "Windows 10": 600, "Windows 11": 400, "Linux 6.8": 600,
    }
    assert result["platforms"]["records"][str(WEEK)]["count"] == 1600
    assert result["metrics"] == original["metrics"]
    assert result["addons"] == original["addons"]
    assert result["coverage"]["weeks"][str(WEEK)]["baseline"] == {
        "status": "complete", "platform_detail": glean.PLATFORM_DETAIL_VERSION,
    }
    assert source == original


def test_os_detail_refresh_failure_preserves_counts_and_retries_only_baseline():
    source = collect()
    source["coverage"]["weeks"][str(WEEK)]["baseline"].pop("platform_detail")
    errors = []
    failed = glean.collect(source, THROUGH, start=WEEK, client=FixtureClient({"baseline"}),
                           on_error=lambda key, error: errors.append(key))
    assert errors == [f"{WEEK}/baseline"]
    assert failed["platforms"] == source["platforms"]
    assert failed["locales"] == source["locales"]
    assert failed["coverage"]["weeks"][str(WEEK)]["baseline"]["pending_platform_detail"]
    assert failed["coverage"]["pending"] == [str(WEEK)]
    with pytest.raises(ValueError, match="operating system versions have not been refreshed"):
        glean.check_freshness(failed, THROUGH)
    client = FixtureClient()
    recovered = glean.collect(failed, THROUGH, start=WEEK, client=client)
    assert client.calls == ["baseline"]
    assert "pending_platform_detail" not in recovered["coverage"]["weeks"][str(WEEK)]["baseline"]
    assert recovered["coverage"]["pending"] == []
    glean.check_freshness(recovered, THROUGH)


def test_os_detail_backfill_respects_week_limit_and_refreshes_newest_first():
    first = WEEK - dt.timedelta(days=7)
    source = glean.collect({}, THROUGH, start=first, max_weeks=2, client=FixtureClient())
    for sections in source["coverage"]["weeks"].values():
        sections["baseline"].pop("platform_detail")
    client = FixtureClient()
    result = glean.collect(source, THROUGH, start=first, max_weeks=1, client=client)
    assert client.calls == ["baseline"]
    assert result["coverage"]["weeks"][str(WEEK)]["baseline"]["platform_detail"] == glean.PLATFORM_DETAIL_VERSION
    assert result["coverage"]["pending"] == [str(first)]


def test_partial_failure_preserves_other_sections_and_can_retry():
    errors = []
    first = collect(FixtureClient({"metrics"}), on_error=lambda key, error: errors.append(key))
    assert errors == [f"{WEEK}/metrics"]
    assert first["platforms"]["records"] and first["addons"]["records"]
    assert "metrics" not in first["coverage"]["weeks"][str(WEEK)]
    retry = FixtureClient()
    result = glean.collect(first, THROUGH, start=WEEK, client=retry)
    assert retry.calls == ["metrics"]
    assert result == collect()
    assert not first["metrics"][METRIC]["records"]


def test_failed_refresh_keeps_good_history_and_metadata():
    existing = collect()
    result = glean.collect(
        existing, THROUGH, start=WEEK, refresh_week=WEEK,
        client=FixtureClient({"metrics", "baseline", "addons"}), on_error=lambda *_: None,
    )
    assert result == existing


def test_refresh_cannot_silently_erase_a_previously_observed_metric():
    existing = collect()
    client = FixtureClient()
    original = client.query
    client.query = lambda sql: [] if ".metrics`" in sql else original(sql)
    errors = []
    result = glean.collect(
        existing, THROUGH, start=WEEK, refresh_week=WEEK, client=client,
        on_error=lambda key, error: errors.append(str(error)),
    )
    assert result == existing
    assert errors == ["Glean refresh lost previously observed metric data"]


def test_unsupported_fields_do_not_break_baseline_or_other_metrics():
    client = FixtureClient()
    client.fields = lambda: {("metrics", glean_sql.METRICS[METRIC]["field"])}
    data = collect(client)
    coverage = data["coverage"]["weeks"][str(WEEK)]
    assert coverage["addons"] == {"status": "unsupported"}
    assert "mail_mails_read" in coverage["metrics"]["unsupported"]
    assert data["platforms"]["records"] and data["metrics"][METRIC]["records"]
    assert "addons" not in client.calls


@pytest.mark.parametrize("field,value", [("count", -1), ("addon_count", 9),
                                          ("minustop10_count", 6), ("reporting_clients", 7)])
def test_invalid_addon_counts_are_rejected(field, value):
    rows = addon_rows()
    rows[0][field] = value
    with pytest.raises(ValueError):
        glean.addon_record(rows)


def test_absent_addon_snapshots_are_measured_outside_the_denominator():
    rows = addon_rows()
    rows[0]["source_clients"] = 10
    record = glean.addon_record(rows)
    assert record["total"] == 8
    assert record["coverage"]["source_clients"] == 10
    assert record["coverage"]["missing_snapshots"] == 2
    glean._validate_record(record, addon=True)
    record["coverage"]["missing_snapshots"] = 1
    with pytest.raises(ValueError, match="snapshot coverage"):
        glean._validate_record(record, addon=True)


def test_distribution_must_match_distinct_client_total():
    rows = baseline_rows()
    rows[1]["count"] = 6
    with pytest.raises(ValueError, match="do not match"):
        glean.baseline_records(rows)


@pytest.mark.parametrize("mutate", [
    lambda data: data["platforms"]["records"][str(WEEK)]["coverage"]["channels"].update(esr=9),
    lambda data: data["metrics"][METRIC]["records"][str(WEEK)].update(total=99),
    lambda data: data["metrics"][METRIC]["records"].update({"2026-10-12": {}}),
    lambda data: data.update(source="untrusted"),
])
def test_invalid_public_data_is_rejected(mutate):
    data = collect()
    mutate(data)
    with pytest.raises(ValueError):
        glean.validate(data)


def test_missing_latest_week_fails_freshness():
    data = collect()
    with pytest.raises(ValueError, match="not complete"):
        glean.check_freshness(data, THROUGH + dt.timedelta(days=7))


@pytest.mark.parametrize("day", [dt.date(2026, 10, 12), "2026-10-11'; DROP TABLE x"])
def test_query_dates_cannot_inject_sql_or_select_partial_weeks(day):
    with pytest.raises(ValueError):
        glean_sql.metric_query(day)


def test_queries_preserve_gauge_and_counter_semantics_and_bound_all_scans():
    metric = glean_sql.metric_query(WEEK)
    assert "AS kind" in metric
    assert "QUALIFY kind = 'counter' OR ROW_NUMBER()" in metric
    assert "PARTITION BY document_id" in metric
    assert "PARTITION BY metric, client_id" in metric
    assert "SAFE_CAST(value.value AS INT64)" in metric
    for query in (metric, glean_sql.baseline_query(WEEK), glean_sql.addons_query(WEEK),
                  glean_sql.event_query(WEEK), glean_sql.oauth_query(WEEK)):
        assert "submission_timestamp >= TIMESTAMP('2026-10-05')" in query
        assert "submission_timestamp < TIMESTAMP('2026-10-12')" in query
        assert "NOT COALESCE(is_bot_generated, FALSE)" in query
    assert "'$.addonType'" in glean_sql.addons_query(WEEK)


def test_all_local_sql_relations_have_declared_ctes():
    for query in (glean_sql.baseline_query(WEEK), glean_sql.metric_query(WEEK),
                  glean_sql.addons_query(WEEK), glean_sql.event_query(WEEK),
                  glean_sql.oauth_query(WEEK)):
        declared = set(re.findall(r"(?:WITH|,)\s+(\w+)\s+AS\s*\(", query))
        relations = set(re.findall(r"\bFROM\s+([A-Za-z_]\w*)", query)) - {"UNNEST"}
        assert relations <= declared, f"Undeclared SQL relations: {relations - declared}"


def oauth_rows():
    dimensions = {
        "channel": {"esr": (8, 2), "release": (2, 1)},
        "version": {"140": (8, 2), "153": (2, 1)},
        "reason": {"no refresh token": (10, 3)},
        "result": {"succeeded": (9, 3), "cancelled": (1, 1)},
        "where": {"internal": (10, 3)},
    }
    rows = [{"scope": "all", "issuer": "", "section": "summary", "key": "",
             "count": 3, "total": 10}]
    for dimension, values in dimensions.items():
        for key, (total, count) in values.items():
            rows.append({"scope": "all", "issuer": "", "section": dimension,
                         "key": key, "total": total, "count": count})
    for issuer, total, count, channel, version in (
        ("accounts.google.com", 8, 2, "esr", "140"),
        ("www.fastmail.com", 2, 1, "release", "153"),
    ):
        rows.append({"scope": "issuer", "issuer": issuer, "section": "summary",
                     "key": "", "total": total, "count": count})
        for dimension, key in (("channel", channel), ("version", version),
                               ("reason", "no refresh token"), ("result", "succeeded"),
                               ("where", "internal")):
            rows.append({"scope": "issuer", "issuer": issuer, "section": dimension,
                         "key": key, "total": total - (dimension == "result" and total == 8),
                         "count": count})
        if total == 8:
            rows.append({"scope": "issuer", "issuer": issuer, "section": "result",
                         "key": "cancelled", "total": 1, "count": 1})
    return rows


def secure_event_rows():
    rows = []
    for metric in ("mail_mails_read_secure", "mail_secure_mail_loaded"):
        rows.extend([
            {"section": "summary", "metric": metric, "key": "", "count": 3, "total": None},
            {"section": "value", "metric": metric, "key": "OpenPGP · signed and encrypted",
             "count": 2, "total": 5},
            {"section": "value", "metric": metric, "key": "S/MIME · signed only",
             "count": 2, "total": 4},
            {"section": "value", "metric": metric, "key": "Unknown security details",
             "count": 1, "total": 1},
            {"section": "channel", "metric": metric, "key": "esr", "count": 2,
             "total": None},
            {"section": "channel", "metric": metric, "key": "release", "count": 1,
             "total": None},
            {"section": "version", "metric": metric, "key": "140.4.0", "count": 2,
             "total": None},
            {"section": "version", "metric": metric, "key": "153.0", "count": 1,
             "total": None},
        ])
    return rows


class EventFixtureClient(FixtureClient):
    def fields(self):
        return super().fields() | {("events", field) for field in glean_sql.EVENT_FIELDS}

    def query(self, sql):
        if "event.name = 'oauth2_authentication'" in sql:
            self.calls.append("oauth")
            if "oauth" in self.failing:
                raise RuntimeError("OAuth temporarily unavailable")
            return oauth_rows()
        if ".events`" in sql:
            self.calls.append("events")
            if "events" in self.failing:
                raise RuntimeError("Events temporarily unavailable")
            return secure_event_rows()
        return super().query(sql)


def test_secure_events_keep_read_and_load_measurements_and_distinct_populations():
    data = collect(EventFixtureClient())
    for key, unit in (("mail_mails_read_secure", "reads"), ("mail_secure_mail_loaded", "loads")):
        metric = data["metrics"][key]
        assert metric["kind"] == "event" and metric["unit"] == unit
        assert "event_name" not in metric and "field" not in metric and "table" not in metric
        record = metric["records"][str(WEEK)]
        assert record["total"] == 10
        assert record["count"] == 3
        # A client can use multiple kinds of secure mail. Do not sum label
        # populations or suppress these fixed security categories below 100.
        assert sum(record["label_clients"].values()) == 5
        assert record["versions"] == {
            "OpenPGP · signed and encrypted": 5,
            "S/MIME · signed only": 4,
            "Unknown security details": 1,
        }
        glean._validate_record(record)
    assert data["metrics"]["mail_mails_read"]["label"] == "All messages read"
    assert data["metrics"]["compose_mails_sent"]["label"] == "All messages sent"
    assert not any("sent_secure" in key for key in data["metrics"])


def test_event_query_preserves_events_and_missing_details_without_extra_multiplication():
    query = glean_sql.event_query(WEEK)
    assert "PARTITION BY document_id" in query
    assert "WITH OFFSET AS event_index" in query
    assert "event.category = 'mail'" in query
    assert "'mails_read_secure', 'secure_mail_loaded'" in query
    assert "CROSS JOIN UNNEST(event.extra)" not in query
    assert "is_signed IS NOT NULL AND is_encrypted IS NOT NULL" in query
    assert "Unknown security details" in query
    assert "COUNT(DISTINCT client_id)" in query
    assert "COUNT(*)" in query
    assert "PARTITION BY metric, client_id" in query
    assert "'signed and encrypted'" in query
    with pytest.raises(ValueError):
        glean_sql.event_query(WEEK, [METRIC])
    with pytest.raises(ValueError):
        glean_sql.metric_query(WEEK, ["mail_mails_read_secure"])
    with pytest.raises(ValueError):
        glean_sql.event_query("2026-10-11'; DROP TABLE x")


def test_secure_event_support_requires_nested_event_schema():
    fields = EventFixtureClient().fields()
    assert "'events'" in glean_sql.schema_query()
    assert "mail_mails_read_secure" in glean_sql.supported_metrics(fields)
    fields.remove(("events", "events.extra.value"))
    assert "mail_mails_read_secure" not in glean_sql.supported_metrics(fields)
    assert METRIC in glean_sql.supported_metrics(fields)


def test_oauth_events_have_independent_marginals_and_distinct_provider_populations():
    data = collect(EventFixtureClient())
    record = data["oauth"]["records"][str(WEEK)]
    assert record["total"] == 10 and record["count"] == 3
    assert record["breakdowns"]["issuer"] == {"accounts.google.com": 8, "www.fastmail.com": 2}
    assert record["breakdowns"]["result"] == {"succeeded": 9, "cancelled": 1}
    assert record["breakdowns"]["version"] == {"other": 10}
    assert record["issuers"]["accounts.google.com"]["total"] == 8
    assert record["issuers"]["accounts.google.com"]["count"] == 2
    assert record["issuers"]["accounts.google.com"]["breakdowns"]["result"] == {
        "succeeded": 7, "cancelled": 1,
    }
    assert all(sum(counts.values()) == 10 for counts in record["breakdowns"].values())
    assert data["coverage"]["weeks"][str(WEEK)]["oauth"] == {"status": "complete"}
    glean.check_freshness(data, THROUGH)


def test_oauth_query_deduplicates_before_scalar_extra_lookups_and_independent_grouping():
    query = glean_sql.oauth_query(WEEK)
    assert "PARTITION BY document_id" in query
    assert "event.name = 'oauth2_authentication'" in query
    assert "CROSS JOIN UNNEST(event.extra)" not in query
    assert "COUNT(*) AS total, COUNT(DISTINCT client_id) AS count" in query
    assert "(provider, result)" in query and "(provider, channel)" in query
    assert "(provider, channel, version" not in query
    assert "AS provider" in query and "GROUPING(provider)" in query
    assert "GROUPING(issuer)" not in query  # BigQuery resolves the output alias here.
    assert "submission_timestamp >= TIMESTAMP('2026-10-05')" in query
    assert "submission_timestamp < TIMESTAMP('2026-10-12')" in query
    assert "NOT COALESCE(is_bot_generated, FALSE)" in query
    assert "REGEXP_EXTRACT" in query
    with pytest.raises(ValueError):
        glean_sql.oauth_query("2026-10-11'; DROP TABLE x")


def test_old_snapshot_gains_only_missing_oauth_section_and_gauge_definition():
    source = collect(EventFixtureClient())
    del source["oauth"]
    del source["coverage"]["weeks"][str(WEEK)]["oauth"]
    del source["metrics"]["mail_oauth2_provider_count"]
    glean.validate(source)
    client = EventFixtureClient()
    updated = glean.collect(source, THROUGH, start=WEEK, client=client)
    assert client.calls == ["metrics", "events", "oauth"]
    assert source["platforms"] == updated["platforms"]
    assert source["metrics"]["mail_secure_mail_loaded"] == updated["metrics"]["mail_secure_mail_loaded"]
    assert "oauth" not in source
    glean.check_freshness(updated, THROUGH)


def test_oauth_failures_preserve_existing_section_and_retry_independently():
    source = collect(EventFixtureClient())
    failed = glean.collect(source, THROUGH, start=WEEK, refresh_week=WEEK,
                           client=EventFixtureClient({"oauth"}), on_error=lambda *_: None)
    assert failed == source
    del source["coverage"]["weeks"][str(WEEK)]["oauth"]
    first = glean.collect(source, THROUGH, start=WEEK, client=EventFixtureClient({"oauth"}),
                          on_error=lambda *_: None)
    assert first["oauth"] == source["oauth"]
    with pytest.raises(ValueError, match="oauth"):
        glean.check_freshness(first, THROUGH)
    retry = EventFixtureClient()
    recovered = glean.collect(first, THROUGH, start=WEEK, client=retry)
    assert retry.calls == ["oauth"]
    glean.check_freshness(recovered, THROUGH)


@pytest.mark.parametrize("mutate", [
    lambda rows: rows.append(copy.deepcopy(rows[1])),
    lambda rows: rows[1].update(total=99),
    lambda rows: rows[1].update(count=99),
    lambda rows: rows[1].update(section="private-dimension"),
    lambda rows: rows[1].update(count=-1),
])
def test_invalid_oauth_aggregates_are_rejected_atomically(mutate):
    source = collect(EventFixtureClient())
    rows = oauth_rows()
    mutate(rows)
    client = EventFixtureClient()
    original = client.query
    client.query = lambda sql: rows if "event.name = 'oauth2_authentication'" in sql else original(sql)
    errors = []
    result = glean.collect(source, THROUGH, start=WEEK, refresh_week=WEEK, client=client,
                           on_error=lambda key, error: errors.append(key))
    assert result == source
    assert errors == [f"{WEEK}/oauth"]


def test_unobserved_oauth_is_distinct_from_unsupported_and_cannot_erase_history():
    unsupported = collect()["coverage"]["weeks"][str(WEEK)]["oauth"]
    assert unsupported == {"status": "unsupported"}
    client = EventFixtureClient()
    original = client.query
    client.query = lambda sql: ([{"scope": "all", "section": "summary", "count": 0, "total": 0}]
                               if "event.name = 'oauth2_authentication'" in sql else original(sql))
    data = collect(client)
    assert data["coverage"]["weeks"][str(WEEK)]["oauth"] == {"status": "unobserved"}
    assert data["oauth"]["records"] == {}
    observed = collect(EventFixtureClient())
    errors = []
    result = glean.collect(observed, THROUGH, start=WEEK, refresh_week=WEEK, client=client,
                           on_error=lambda key, error: errors.append(str(error)))
    assert result == observed and errors == ["Glean refresh lost OAuth observations"]


def test_oauth_sanitizer_preserves_totals_and_removes_unknown_identifiers():
    source = {"oauth": {"records": {str(WEEK): glean.oauth_record(oauth_rows())}}}
    record = source["oauth"]["records"][str(WEEK)]
    record["breakdowns"]["version"] = {"140": 8, "private-build.invalid": 2}
    record["label_clients"]["version"] = {"140": 2, "private-build.invalid": 1}
    record["breakdowns"]["issuer"]["private-issuer.invalid"] = record["breakdowns"]["issuer"].pop("www.fastmail.com")
    record["issuers"]["private-issuer.invalid"] = record["issuers"].pop("www.fastmail.com")
    record["breakdowns"]["result"]["private-result.invalid"] = record["breakdowns"]["result"].pop("cancelled")
    safe = glean.sanitize_public(source)
    public = safe["oauth"]["records"][str(WEEK)]
    assert "private-" not in str(safe)
    assert public["total"] == 10 and public["count"] == 3
    assert public["breakdowns"]["issuer"] == {"accounts.google.com": 8, "__other__": 2}
    assert public["breakdowns"]["result"] == {"succeeded": 9, "Unknown": 1}
    assert public["breakdowns"]["version"] == {"other": 10}
    assert "other" not in public["label_clients"]["version"]
    assert "__other__" not in public["issuers"]
    assert glean.sanitize_public(safe) == safe
    glean._validate_oauth_record(public)
    assert "private-" in str(source)


def test_oauth_account_gauge_uses_latest_snapshot_and_known_provider_labels():
    key = "mail_oauth2_provider_count"
    definition = glean_sql.METRICS[key]
    assert definition["kind"] == "gauge"
    assert definition["field"] == "metrics.labeled_string.mail_oauth2_provider_count"
    assert key in glean_sql.supported_metrics(FixtureClient().fields())
    rows = [{**row, "metric": key} for row in metric_rows()]
    rows[1]["key"] = "accounts.google.com"
    rows[2]["key"] = "private-issuer.invalid"
    record = glean.metric_records(rows, {key})[key]
    assert record["versions"] == {"accounts.google.com": 7, "__other__": 1}


def test_adding_secure_events_reopens_old_weeks_and_failed_events_keep_existing_metrics():
    existing = collect()
    event_ids = {"mail_mails_read_secure", "mail_secure_mail_loaded"}
    for key in event_ids:
        existing["metrics"].pop(key)
    before = copy.deepcopy(existing["metrics"][METRIC]["records"])
    errors = []
    failed = glean.collect(
        existing, THROUGH, start=WEEK, client=EventFixtureClient({"events"}),
        on_error=lambda key, error: errors.append(str(error)),
    )
    assert errors == ["Events temporarily unavailable"]
    assert failed["metrics"][METRIC]["records"] == before
    assert set(failed["coverage"]["weeks"][str(WEEK)]["metrics"]["pending_definitions"]) == event_ids
    with pytest.raises(ValueError, match="definitions have not been refreshed"):
        glean.check_freshness(failed, THROUGH)
    retried = EventFixtureClient()
    recovered = glean.collect(failed, THROUGH, start=WEEK, client=retried)
    assert retried.calls == ["metrics", "events"]
    assert recovered["metrics"][METRIC]["records"] == before
    assert set(recovered["coverage"]["weeks"][str(WEEK)]["metrics"]["observed"]) == event_ids | {METRIC}
    assert "pending_definitions" not in recovered["coverage"]["weeks"][str(WEEK)]["metrics"]
    glean.check_freshness(recovered, THROUGH)


def response(payload):
    value = Mock()
    value.json.return_value = payload
    return value


def session_with_source():
    session = Mock()
    session.headers = {}
    session.get.return_value = response([{"id": 42, "name": "Telemetry (BigQuery)"}])
    return session


def test_stmo_immediate_result_uses_header_and_discovers_source():
    session = session_with_source()
    session.post.return_value = response({"query_result": {"data": {"rows": [{"count": 5}]}}})
    client = glean.Client("test-secret", session=session)
    assert client.query("SELECT COUNT(*)") == [{"count": 5}]
    assert session.headers["Authorization"] == "Key test-secret"
    request = session.post.call_args.kwargs
    assert request["json"] == {"data_source_id": 42, "query": "SELECT COUNT(*)", "max_age": 0}
    assert "test-secret" not in str(request)


def test_stmo_polls_then_reads_result(monkeypatch):
    monkeypatch.setattr(glean.time, "sleep", lambda *_: None)
    session = session_with_source()
    session.get.side_effect = [
        response([{"id": 42, "name": "Telemetry (BigQuery)"}]),
        response({"job": {"id": "job-123", "status": 3, "query_result_id": 81}}),
        response({"query_result": {"data": {"rows": [{"count": 5}]}}}),
    ]
    session.post.return_value = response({"job": {"id": "job-123", "status": 1}})
    assert glean.Client("test", session=session).query("SELECT 1") == [{"count": 5}]
    assert session.get.call_args.args[0].endswith("/api/query_results/81")


@pytest.mark.parametrize("status", [4, 5])
def test_stmo_terminal_failure_does_not_poll_forever(status):
    session = session_with_source()
    session.post.return_value = response({"job": {"id": "job", "status": status,
                                                 "error": "Query refused"}})
    with pytest.raises(RuntimeError, match="Query refused"):
        glean.Client("test", session=session).query("SELECT 1")
    assert session.get.call_count == 1


def test_stmo_polling_has_deadline(monkeypatch):
    clock = iter([0, 0, 0, 2])
    monkeypatch.setattr(glean.time, "monotonic", lambda: next(clock))
    session = session_with_source()
    session.post.return_value = response({"job": {"id": "job", "status": 1}})
    with pytest.raises(TimeoutError):
        glean.Client("test", session=session, timeout=1).query("SELECT 1")
    assert session.get.call_count == 1


def test_client_credentials_fallback_and_mutations_rejected(monkeypatch):
    monkeypatch.delenv("GLEAN_API_KEY", raising=False)
    monkeypatch.setenv("GLEAN_KEY", "fallback-secret")
    session = session_with_source()
    client = glean.Client(session=session)
    assert session.headers["Authorization"] == "Key fallback-secret"
    with pytest.raises(ValueError, match="read-only"):
        client.query("DELETE FROM anything")
    session.get.assert_not_called()


def test_refresh_validation_and_empty_historical_window():
    for day in (WEEK + dt.timedelta(days=1), dt.date(2025, 4, 27)):
        with pytest.raises(ValueError, match="completed supported Sunday"):
            collect(refresh_week=day)
    client = Mock()
    result = glean.collect({}, dt.date(2025, 4, 30), client=client)
    assert result == glean.empty_data()
    client.query.assert_not_called()
    assert copy.deepcopy(result) == result


def test_backfill_is_bounded_and_collects_newest_weeks_first():
    start = WEEK - dt.timedelta(days=21)
    client = FixtureClient()
    first = glean.collect({}, THROUGH, start=start, client=client, max_weeks=2)
    assert sorted(first["platforms"]["records"]) == ["2026-10-04", "2026-10-11"]
    assert first["coverage"]["pending"] == ["2026-09-20", "2026-09-27"]
    assert len(client.calls) == 6
    second = glean.collect(first, THROUGH, start=start, client=client, max_weeks=2)
    assert sorted(second["platforms"]["records"]) == [
        "2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11",
    ]
    assert second["coverage"]["pending"] == []


def test_unobserved_historical_sources_are_recorded_without_inventing_zeros():
    client = FixtureClient()

    def empty_rows(sql):
        if ".baseline`" in sql:
            return []
        if ".addons`" in sql:
            return [{"section": "summary", "key": "", "count": 0, "addon_count": 0,
                     "minustop10_count": 0, "reporting_clients": 0, "source_clients": 0}]
        return []

    client.query = empty_rows
    data = collect(client)
    coverage = data["coverage"]["weeks"][str(WEEK)]
    assert coverage["baseline"] == {"status": "unobserved"}
    assert coverage["addons"] == {"status": "unobserved", "source_clients": 0}
    assert not data["platforms"]["records"] and not data["addons"]["records"]
    repeat_client = Mock()
    assert glean.collect(data, THROUGH, start=WEEK, client=repeat_client) == data
    repeat_client.fields.assert_not_called()
    with pytest.raises(ValueError, match="no baseline observations"):
        glean.check_freshness(data, THROUGH)


def test_empty_source_refresh_retains_previously_observed_baseline_and_addons():
    existing = collect()
    client = FixtureClient()
    original = client.query

    def rows(sql):
        if ".baseline`" in sql:
            return []
        if ".addons`" in sql:
            return [{"section": "summary", "key": "", "count": 0, "addon_count": 0,
                     "minustop10_count": 0, "reporting_clients": 0}]
        return original(sql)

    client.query = rows
    errors = []
    data = glean.collect(existing, THROUGH, start=WEEK, refresh_week=WEEK, client=client,
                         on_error=lambda key, error: errors.append(key))
    assert data == existing
    assert set(errors) == {f"{WEEK}/baseline", f"{WEEK}/addons"}


@pytest.mark.parametrize("max_weeks", [0, -1, True, 1.5])
def test_backfill_limit_must_be_a_positive_integer(max_weeks):
    with pytest.raises(ValueError, match="max_weeks"):
        collect(max_weeks=max_weeks)


def test_free_form_metric_suppression_uses_reporters_not_measurement_totals():
    metric = "filelink_uploaded_size"
    rows = [
        {"section": "summary", "metric": metric, "key": "", "count": 200},
        {"section": "value", "metric": metric, "key": "rare-provider.invalid",
         "count": 1, "total": 10_000_000},
        {"section": "value", "metric": metric, "key": "below-floor.invalid",
         "count": 99, "total": 99},
        {"section": "value", "metric": metric, "key": "popular-provider",
         "count": 100, "total": 100},
        {"section": "channel", "metric": metric, "key": "custom-private-channel",
         "count": 200},
        {"section": "version", "metric": metric, "key": "private-build-label",
         "count": 200},
    ]
    record = glean.metric_records(rows, {metric})[metric]
    assert record["versions"] == {"__other__": 10_000_099, "popular-provider": 100}
    assert record["label_clients"] == {"popular-provider": 100}
    assert record["total"] == 10_000_199 and record["count"] == 200
    assert record["coverage"] == {"channels": {"other": 200}, "versions": {"other": 200}}
    assert "invalid" not in str(record) and "private" not in str(record)
    glean._validate_record(record)


def test_public_sanitizer_handles_old_partial_snapshots_without_inventing_populations():
    source = {"metrics": {METRIC: {"records": {str(WEEK): {
        "count": 200, "total": 20_001,
        "versions": {"imap": 1, "private-old-provider.invalid": 20_000},
    }}}}}
    original = copy.deepcopy(source)
    safe = glean.sanitize_public(source)
    record = safe["metrics"][METRIC]["records"][str(WEEK)]
    assert record["versions"] == {"imap": 1, "__other__": 20_000}
    assert "label_clients" not in record
    assert "private-old-provider" not in str(safe)
    assert source == original and source is not safe
    assert glean.sanitize_public(safe) == safe


def test_public_sanitizer_normalizes_channels_and_coarsens_version_populations():
    source = {"platforms": {"records": {str(WEEK): {
        "count": 1_006, "versions": {"Windows": 1_005, "custom-os.invalid": 1},
        "coverage": {
            "channels": {"ESR": 700, "release": 300, "custom-channel.invalid": 5,
                         "": 1},
            "versions": {"140.4.0esr": 600, "140.3.0": 100, "153.0b1": 300,
                         "999.0": 1, "private-build.invalid": 5},
        },
    }}}}
    # Empty raw channel strings are invalid data, not a named public category.
    source["platforms"]["records"][str(WEEK)]["coverage"]["channels"].pop("")
    source["platforms"]["records"][str(WEEK)]["coverage"]["channels"]["unknown"] = 1
    record = glean.sanitize_public(source)["platforms"]["records"][str(WEEK)]
    assert record["versions"] == {"Windows": 1_005, "__other__": 1}
    assert record["coverage"]["channels"] == {"esr": 700, "release": 300, "other": 6}
    assert record["coverage"]["versions"] == {"140": 700, "153": 300, "other": 6}
    assert "invalid" not in str(record) and "999" not in str(record)
    glean._validate_record(record, distribution=True)


def test_public_sanitizer_omits_rare_popular_addon_ids():
    source = {"addons": {"records": {str(WEEK): {
        "top10": {"private-addon.invalid": 99, "public-addon": 100},
    }}}}
    record = glean.sanitize_public(source)["addons"]["records"][str(WEEK)]
    assert record["top10"] == {"public-addon": 100}


def test_public_sanitizer_rejects_invented_label_reporter_population():
    source = {"metrics": {"filelink_uploaded_size": {"records": {str(WEEK): {
        "count": 1, "versions": {"private-provider.invalid": 100_000},
        "label_clients": {"private-provider.invalid": 100},
    }}}}}
    with pytest.raises(ValueError, match="exceeds reporting population"):
        glean.sanitize_public(source)


def test_no_network_collection_sanitizes_existing_snapshot_before_returning():
    source = collect()
    record = source["metrics"][METRIC]["records"][str(WEEK)]
    record["versions"]["private-old-label.invalid"] = record["versions"].pop("imap")
    record.pop("label_clients")
    record["coverage"]["channels"] = {"private-old-channel.invalid": record["count"]}
    client = Mock()
    safe = glean.collect(source, THROUGH, start=WEEK, client=client)
    assert "private-old" not in str(safe)
    assert safe["metrics"][METRIC]["records"][str(WEEK)]["total"] == record["total"]
    assert "private-old" in str(source)
    client.fields.assert_not_called()
    glean.validate(safe)


def test_adding_a_metric_definition_reopens_only_metric_queries(monkeypatch):
    source = collect()
    added = "new_metric"
    monkeypatch.setitem(glean_sql.METRICS, added, {
        **glean_sql.METRICS[METRIC], "label": "New metric",
        "field": "metrics.quantity.new_metric",
    })
    # Loading and validating an older metric set must remain supported.
    glean.validate(source)
    client = FixtureClient()
    safe = glean.collect(source, THROUGH, start=WEEK, client=client)
    assert client.calls == ["metrics"]
    assert safe["metrics"][added]["records"] == {}
    assert added in safe["coverage"]["weeks"][str(WEEK)]["metrics"]["unobserved"]
    assert source["metrics"][METRIC]["records"] == safe["metrics"][METRIC]["records"]
    assert added not in source["metrics"]


def test_missing_stored_definition_is_filled_and_reaudited():
    source = collect()
    source["metrics"].pop("mail_mails_read")
    glean.validate(source)
    client = FixtureClient()
    safe = glean.collect(source, THROUGH, start=WEEK, client=client)
    assert client.calls == ["metrics"]
    assert "mail_mails_read" in safe["metrics"]


def test_failed_schema_update_keeps_the_previous_audit_and_retries():
    source = collect()
    source["metrics"].pop("mail_mails_read")
    previous = copy.deepcopy(source["coverage"]["weeks"][str(WEEK)]["metrics"])
    failing = FixtureClient({"metrics"})
    failed = glean.collect(source, THROUGH, start=WEEK, client=failing,
                           on_error=lambda *_: None)
    coverage = failed["coverage"]["weeks"][str(WEEK)]["metrics"]
    assert coverage["observed"] == previous["observed"]
    assert coverage["pending_definitions"] == ["mail_mails_read"]
    assert failed["coverage"]["pending"] == [str(WEEK)]
    assert failed["metrics"][METRIC]["records"] == source["metrics"][METRIC]["records"]
    with pytest.raises(ValueError, match="definitions have not been refreshed"):
        glean.check_freshness(failed, THROUGH)
    retry = FixtureClient()
    refreshed = glean.collect(failed, THROUGH, start=WEEK, client=retry)
    assert retry.calls == ["metrics"]
    assert "pending_definitions" not in refreshed["coverage"]["weeks"][str(WEEK)]["metrics"]
    assert refreshed["coverage"]["pending"] == []


def test_retired_metric_history_survives_refresh(monkeypatch):
    source = collect()
    monkeypatch.delitem(glean_sql.METRICS, METRIC)
    client = FixtureClient()
    original_query = client.query
    client.query = lambda sql: [] if ".metrics`" in sql else original_query(sql)
    safe = glean.collect(source, THROUGH, start=WEEK, refresh_week=WEEK, client=client)
    assert safe["metrics"][METRIC]["retired"] is True
    assert safe["metrics"][METRIC]["records"] == source["metrics"][METRIC]["records"]
    assert METRIC not in safe["coverage"]["weeks"][str(WEEK)]["metrics"]["observed"]
    glean.validate(safe)


def test_invalid_retired_records_still_fail_validation(monkeypatch):
    source = collect()
    monkeypatch.delitem(glean_sql.METRICS, METRIC)
    source["metrics"][METRIC]["records"][str(WEEK)]["total"] = -1
    with pytest.raises(ValueError, match="Glean measured total"):
        glean.validate(source)


def test_week_boundary_waits_one_full_utc_day_for_ingestion():
    assert glean.latest_week(WEEK) == WEEK - dt.timedelta(days=7)
    assert glean.latest_week(THROUGH) == WEEK
    assert glean.latest_week(THROUGH + dt.timedelta(days=5)) == WEEK
    client = Mock()
    safe = glean.collect({}, WEEK, start=WEEK, client=client)
    assert safe == glean.empty_data()
    client.fields.assert_not_called()
    glean.check_freshness(safe, glean.START_DATE)
