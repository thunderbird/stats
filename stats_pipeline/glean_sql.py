"""Read-only, partition-bounded BigQuery queries for public Glean aggregates.

Identifiers and expressions come exclusively from this module. Dates are parsed
before interpolation, and client IDs never appear in a query's result columns.
"""

import datetime as dt

DATASET = "moz-fx-data-shared-prod.thunderbird_desktop"

# A gauge is a snapshot; an event counter is reset after submitting its ping.
# Gauge snapshots are selected independently for each client/metric. Counters
# sum all distinct ping documents, rather than discarding all but the last one.
METRICS = {
    "mail_account_count": {
        "label": "Accounts", "unit": "accounts", "kind": "gauge",
        "field": "metrics.labeled_string.mail_account_count",
        "description": "Accounts by type, using each reporting client's latest weekly snapshot.",
    },
    "mail_oauth2_provider_count": {
        "label": "OAuth accounts", "unit": "accounts", "kind": "gauge",
        "field": "metrics.labeled_string.mail_oauth2_provider_count",
        "description": "Incoming mail accounts using OAuth, by issuer, from each client's latest weekly snapshot.",
    },
    "addrbook_addressbook_count": {
        "label": "Address books", "unit": "address books", "kind": "gauge",
        "field": "metrics.labeled_string.addrbook_addressbook_count",
        "description": "Address books by type, using each client's latest weekly snapshot.",
    },
    "calendar_calendar_count": {
        "label": "Calendars", "unit": "calendars", "kind": "gauge",
        "field": "metrics.labeled_string.calendar_calendar_count",
        "description": "Calendars by type, using each client's latest weekly snapshot.",
    },
    "calendar_read_only_calendar_count": {
        "label": "Read-only calendars", "unit": "calendars", "kind": "gauge",
        "field": "metrics.labeled_string.calendar_read_only_calendar_count",
        "description": "Read-only calendars by type, using each client's latest weekly snapshot.",
    },
    "mail_successful_email_account_setup": {
        "label": "Successful account setup", "unit": "setups", "kind": "counter",
        "field": "metrics.labeled_counter.mail_successful_email_account_setup",
        "description": "Successful setups by configuration source, summed across distinct pings.",
    },
    "mail_failed_email_account_setup": {
        "label": "Failed account setup", "unit": "attempts", "kind": "counter",
        "field": "metrics.labeled_counter.mail_failed_email_account_setup",
        "description": "Failed setups by configuration source, summed across distinct pings.",
    },
    "mail_websearch_usage": {
        "label": "Web searches", "unit": "searches", "kind": "counter",
        "field": "metrics.labeled_counter.mail_websearch_usage",
        "description": "Web searches by engine, summed across distinct pings.",
    },
    "filelink_uploaded_size": {
        "label": "Filelink uploads", "unit": "bytes", "kind": "counter",
        "field": "metrics.labeled_counter.filelink_uploaded_size",
        "description": "Bytes uploaded by provider, summed across distinct pings.",
    },
    "mail_mails_read": {
        "label": "All messages read", "unit": "messages", "kind": "counter",
        "field": "metrics.counter.mail_mails_read",
        "description": "Message-read events, summed across distinct pings.",
    },
    "compose_mails_sent": {
        "label": "All messages sent", "unit": "messages", "kind": "counter",
        "field": "metrics.counter.compose_mails_sent",
        "description": "Messages sent, summed across distinct pings.",
    },
    "mail_mails_read_secure": {
        "label": "Secure messages read", "unit": "reads", "kind": "event",
        "table": "events", "field": "events", "event_name": "mails_read_secure",
        "description": "Newly read OpenPGP and S/MIME messages, grouped by signing and encryption.",
        "aggregation": "Counts secure-message read events from distinct event pings. "
                       "Each event belongs to one security category. This older probe counts "
                       "newly read messages; secure-message loads are a separate metric.",
    },
    "mail_secure_mail_loaded": {
        "label": "Secure messages loaded", "unit": "loads", "kind": "event",
        "table": "events", "field": "events", "event_name": "secure_mail_loaded",
        "description": "OpenPGP and S/MIME message loads, grouped by signing and encryption.",
        "aggregation": "Counts secure-message load events from distinct event pings, including "
                       "reopening previously read messages. Each event belongs to one security "
                       "category. These are loads, not distinct messages or sends.",
    },
}

PRIVATE_DEFINITION_FIELDS = frozenset({"field", "table", "event_name"})
SECURITY_LABELS = frozenset(
    f"{technology} · {protection}"
    for technology in ("OpenPGP", "S/MIME")
    for protection in ("signed only", "encrypted only", "signed and encrypted")
) | {"Unknown security details"}
EVENT_FIELDS = frozenset({
    "events", "events.category", "events.name", "events.extra.key", "events.extra.value",
})

# Fixed product labels from OAuth2Providers.sys.mjs and OAuth2.sys.mjs. Keep
# unregistered/extension identifiers out of the public aggregate, even when
# their measurement count is high. Unknown details remain explicit.
OAUTH_ISSUERS = frozenset({
    "accounts.google.com", "o2.mail.ru", "oauth.yandex.com", "Seznam.cz",
    "login.yahoo.com", "login.aol.com", "login.microsoftonline.com",
    "www.fastmail.com", "comcast.net", "auth.tb.pro", "auth-stage.tb.pro",
    "test.test", "external.test", "net.thunderbird.test",
})
OAUTH_LABELS = {
    "issuer": OAUTH_ISSUERS | {"__other__", "Unknown"},
    "reason": frozenset({"no refresh token", "invalid grant", "refresh", "Unknown"}),
    "result": frozenset({
        "succeeded", "cancelled", "authorization failed", "connection failed",
        "invalid scope", "failed", "failed after retrying", "state mismatch",
        "User canceled reauthentication", "localhost listener init failed",
        "external browser launch failure", "application closed", "Unknown",
    }),
    "where": frozenset({
        "internal", "external", "external-localhost", "external-net-thunderbird", "Unknown",
    }),
    "channel": frozenset({"esr", "release", "beta", "nightly", "other"}),
}
OAUTH_DIMENSIONS = ("issuer", "channel", "version", "reason", "result", "where")


def public_definition(definition):
    return {key: value for key, value in definition.items()
            if key not in PRIVATE_DEFINITION_FIELDS}


def supported_metrics(fields):
    return {
        key for key, definition in METRICS.items()
        if all((definition.get("table", "metrics"), field) in fields for field in (
            EVENT_FIELDS if definition["kind"] == "event" else (definition["field"],)
        ))
    }


def bounds(day):
    """Return the inclusive Monday and exclusive Monday for a completed Sunday."""
    day = dt.date.fromisoformat(str(day))
    if day.weekday() != 6:
        raise ValueError("Glean weekly dates must be Sundays")
    return str(day - dt.timedelta(days=6)), str(day + dt.timedelta(days=1))


def predicate(day):
    start, stop = bounds(day)
    return f"""submission_timestamp >= TIMESTAMP('{start}')
      AND submission_timestamp < TIMESTAMP('{stop}')
      AND NOT COALESCE(is_bot_generated, FALSE)
      AND NULLIF(client_info.client_id, '') IS NOT NULL"""


def schema_query():
    return f"""SELECT table_name, field_path, data_type
FROM `{DATASET}.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name IN ('baseline', 'metrics', 'addons', 'events')
ORDER BY table_name, field_path"""


def baseline_query(day, *, source="baseline"):
    bounds(day)
    if source == "baseline":
        clients = rf"""  SELECT client_info.client_id AS client_id,
    COALESCE(NULLIF(client_info.os, ''), 'Unknown') AS platform,
    REGEXP_EXTRACT(client_info.os_version, r'^([0-9]+(?:\.[0-9]+){{0,3}})') AS os_version,
    SAFE_CAST(client_info.windows_build_number AS INT64) AS windows_build_number,
    COALESCE(NULLIF(client_info.locale, ''), 'Unknown') AS locale,
    COALESCE(NULLIF(client_info.app_channel, ''), 'Unknown') AS channel,
    COALESCE(NULLIF(client_info.app_display_version, ''), 'Unknown') AS version
  FROM `{DATASET}.baseline`
  WHERE {predicate(day)}
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY client_info.client_id ORDER BY submission_timestamp DESC, document_id DESC
  ) = 1"""
    elif source == "baseline_clients_last_seen":
        # Each row carries the daily modes from the client's most recent
        # reporting day. The seven-day mask limits this snapshot to the same
        # Monday-Sunday reporting population as the raw baseline query.
        clients = rf"""  SELECT
    CASE normalized_os WHEN 'Mac' THEN 'Darwin'
      ELSE COALESCE(NULLIF(normalized_os, ''), 'Unknown') END AS platform,
    REGEXP_EXTRACT(normalized_os_version, r'^([0-9]+(?:\.[0-9]+){{0,3}})') AS os_version,
    SAFE_CAST(windows_build_number AS INT64) AS windows_build_number,
    COALESCE(NULLIF(locale, ''), 'Unknown') AS locale,
    COALESCE(NULLIF(app_channel, ''), 'Unknown') AS channel,
    COALESCE(NULLIF(app_display_version, ''), 'Unknown') AS version
  FROM `{DATASET}.baseline_clients_last_seen`
  WHERE submission_date = DATE('{day}')
    AND days_since_seen < 7
    AND NULLIF(client_id, '') IS NOT NULL"""
    else:
        raise ValueError("Unknown Glean baseline source")
    return rf"""WITH clients AS (
{clients}
), classified AS (
  SELECT * EXCEPT(platform, channel),
    CASE WHEN LOWER(TRIM(channel)) IN ('esr', 'release', 'beta', 'nightly')
      THEN LOWER(TRIM(channel)) ELSE 'other' END AS channel,
    CASE WHEN platform IN ('Windows', 'Windows_NT', 'WINNT') THEN
      CASE WHEN REGEXP_EXTRACT(os_version, r'^[0-9]+\.[0-9]+') = '10.0' THEN
        CASE WHEN windows_build_number >= 22000 THEN 'Windows 11'
             WHEN windows_build_number > 0 THEN 'Windows 10'
             ELSE 'Windows_NT10.0' END
      WHEN os_version IS NOT NULL THEN
        CONCAT('Windows_NT', COALESCE(REGEXP_EXTRACT(os_version, r'^[0-9]+\.[0-9]+'), os_version))
      ELSE 'Windows_NT' END
    WHEN platform = 'Unknown' THEN 'Unknown'
    ELSE CONCAT(platform, ' ', COALESCE(os_version, 'Unknown')) END AS platform
  FROM clients
)
SELECT CASE WHEN GROUPING(c.channel) = 0 AND GROUPING(c.platform) = 0 THEN 'channel_platforms'
            WHEN GROUPING(c.channel) = 0 AND GROUPING(c.locale) = 0 THEN 'channel_locales'
            WHEN GROUPING(c.platform) = 0 THEN 'platforms'
            WHEN GROUPING(c.locale) = 0 THEN 'locales'
            WHEN GROUPING(c.channel) = 0 THEN 'channels'
            WHEN GROUPING(c.version) = 0 THEN 'versions'
            ELSE 'total' END AS section,
  CASE WHEN GROUPING(c.platform) = 0 THEN c.platform
       WHEN GROUPING(c.locale) = 0 THEN c.locale
       WHEN GROUPING(c.channel) = 0 THEN c.channel
       WHEN GROUPING(c.version) = 0 THEN c.version
       ELSE '' END AS key,
  IF(GROUPING(c.channel) = 0, c.channel, '') AS channel,
  COUNT(*) AS count
FROM classified AS c
GROUP BY GROUPING SETS ((), (c.platform), (c.locale), (c.channel), (c.version),
                        (c.channel, c.platform), (c.channel, c.locale))"""


def metric_query(day, metric_ids=None):
    metric_ids = tuple((key for key, value in METRICS.items() if value["kind"] != "event")
                       if metric_ids is None else metric_ids)
    if not metric_ids or any(key not in METRICS or METRICS[key]["kind"] == "event"
                             for key in metric_ids):
        raise ValueError("Expected known Glean metric IDs")
    projections = []
    for key in metric_ids:
        definition = METRICS[key]
        field = definition["field"]
        if ".counter." in field:
            values = f"[STRUCT('all' AS key, {field} AS value)]"
        else:
            values = f"""ARRAY(SELECT AS STRUCT value.key AS key,
              SAFE_CAST(value.value AS INT64) AS value FROM UNNEST({field}) AS value)"""
        projections.append(
            f"STRUCT('{key}' AS metric, '{definition['kind']}' AS kind, {values} AS vals)"
        )
    fields = ",\n        ".join(projections)
    return f"""WITH documents AS (
  SELECT document_id, submission_timestamp, client_info.client_id AS client_id,
    COALESCE(NULLIF(client_info.app_channel, ''), 'Unknown') AS channel,
    COALESCE(NULLIF(client_info.app_display_version, ''), 'Unknown') AS version,
    [{fields}] AS observed
  FROM `{DATASET}.metrics`
  WHERE {predicate(day)}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY submission_timestamp DESC) = 1
), metric_pings AS (
  SELECT document_id, submission_timestamp, client_id, channel, version, metric, kind,
    ARRAY(SELECT AS STRUCT key, value FROM UNNEST(vals)
          WHERE value IS NOT NULL AND value >= 0 AND NULLIF(key, '') IS NOT NULL) AS vals
  FROM documents CROSS JOIN UNNEST(observed)
), present AS (
  SELECT * FROM metric_pings WHERE ARRAY_LENGTH(vals) > 0
), retained AS (
  SELECT * FROM present
  QUALIFY kind = 'counter' OR ROW_NUMBER() OVER (
    PARTITION BY metric, client_id ORDER BY submission_timestamp DESC, document_id DESC
  ) = 1
), classified AS (
  SELECT * EXCEPT(channel, version),
    FIRST_VALUE(channel) OVER reporting_client AS channel,
    FIRST_VALUE(version) OVER reporting_client AS version
  FROM retained
  WINDOW reporting_client AS (
    PARTITION BY metric, client_id ORDER BY submission_timestamp DESC, document_id DESC
  )
)
SELECT CASE WHEN GROUPING(entry.key) = 0 THEN 'value'
            WHEN GROUPING(channel) = 0 THEN 'channel'
            WHEN GROUPING(version) = 0 THEN 'version'
            ELSE 'summary' END AS section,
  metric,
  CASE WHEN GROUPING(entry.key) = 0 THEN entry.key
       WHEN GROUPING(channel) = 0 THEN channel
       WHEN GROUPING(version) = 0 THEN version
       ELSE '' END AS key,
  IF(GROUPING(entry.key) = 0, SUM(entry.value), NULL) AS total,
  COUNT(DISTINCT client_id) AS count
FROM classified CROSS JOIN UNNEST(vals) AS entry
GROUP BY GROUPING SETS ((metric), (metric, entry.key), (metric, channel), (metric, version))"""


def event_query(day, metric_ids=None):
    """Count each secure-mail event once, with one mutually exclusive label.

    Deduplicate retried documents before unnesting events. Scalar extra lookups
    preserve events with absent flags without multiplying counts by extra keys.
    Read and load probes remain separate because their recording semantics differ.
    """
    metric_ids = tuple((key for key, value in METRICS.items() if value["kind"] == "event")
                       if metric_ids is None else metric_ids)
    if not metric_ids or any(key not in METRICS or METRICS[key]["kind"] != "event"
                             for key in metric_ids):
        raise ValueError("Expected known Glean event metric IDs")
    names = ", ".join(f"'{METRICS[key]['event_name']}'" for key in metric_ids)
    return f"""WITH documents AS (
  SELECT document_id, submission_timestamp, client_info.client_id AS client_id,
    COALESCE(NULLIF(client_info.app_channel, ''), 'Unknown') AS channel,
    COALESCE(NULLIF(client_info.app_display_version, ''), 'Unknown') AS version,
    events
  FROM `{DATASET}.events`
  WHERE {predicate(day)}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY submission_timestamp DESC) = 1
), secure_events AS (
  SELECT document_id, submission_timestamp, client_id, channel, version, event_index,
    CONCAT('mail_', event.name) AS metric,
    (SELECT value FROM UNNEST(event.extra) WHERE key = 'security' LIMIT 1) AS security,
    SAFE_CAST((SELECT value FROM UNNEST(event.extra) WHERE key = 'is_signed' LIMIT 1)
      AS BOOL) AS is_signed,
    SAFE_CAST((SELECT value FROM UNNEST(event.extra) WHERE key = 'is_encrypted' LIMIT 1)
      AS BOOL) AS is_encrypted
  FROM documents CROSS JOIN UNNEST(events) AS event WITH OFFSET AS event_index
  WHERE event.category = 'mail' AND event.name IN ({names})
), classified AS (
  SELECT * EXCEPT(channel, version),
    FIRST_VALUE(channel) OVER reporting_client AS channel,
    FIRST_VALUE(version) OVER reporting_client AS version,
    CASE WHEN LOWER(security) IN ('openpgp', 's/mime')
                   AND is_signed IS NOT NULL AND is_encrypted IS NOT NULL
                   AND (is_signed OR is_encrypted)
      THEN CONCAT(IF(LOWER(security) = 'openpgp', 'OpenPGP', 'S/MIME'), ' · ',
        CASE WHEN is_signed AND is_encrypted THEN 'signed and encrypted'
             WHEN is_signed THEN 'signed only' ELSE 'encrypted only' END)
      ELSE 'Unknown security details' END AS security_label
  FROM secure_events
  WINDOW reporting_client AS (
    PARTITION BY metric, client_id
    ORDER BY submission_timestamp DESC, document_id DESC, event_index DESC
  )
)
SELECT CASE WHEN GROUPING(security_label) = 0 THEN 'value'
            WHEN GROUPING(channel) = 0 THEN 'channel'
            WHEN GROUPING(version) = 0 THEN 'version'
            ELSE 'summary' END AS section,
  metric,
  CASE WHEN GROUPING(security_label) = 0 THEN security_label
       WHEN GROUPING(channel) = 0 THEN channel
       WHEN GROUPING(version) = 0 THEN version
       ELSE '' END AS key,
  IF(GROUPING(security_label) = 0, COUNT(*), NULL) AS total,
  COUNT(DISTINCT client_id) AS count
FROM classified
GROUP BY GROUPING SETS ((metric), (metric, security_label), (metric, channel), (metric, version))"""


def oauth_query(day):
    """Independent event marginals, never the Cartesian product of extras.

    A provider summary also supplies the global issuer marginal. Grouping each
    dimension independently keeps every event once per view, and count remains
    a distinct reporter population rather than the sum of dimension counts.
    """
    extras = ",\n    ".join(
        f"(SELECT value FROM UNNEST(event.extra) WHERE key = '{name}' LIMIT 1) AS {name}"
        for name in ("issuer", "reason", "result", "where")
    )
    # `where` is a SQL keyword; extract to a neutral alias and expose its public
    # dimension name in the aggregate rows only.
    extras = extras.replace(" AS where", " AS location")
    normalized = []
    for name in ("issuer", "reason", "result", "where"):
        column = "location" if name == "where" else name
        allowed = ", ".join("'" + value + "'" for value in sorted(OAUTH_LABELS[name]))
        fallback = "__other__" if name == "issuer" else "Unknown"
        normalized.append(
            f"CASE WHEN {column} IN ({allowed}) THEN {column} "
            f"ELSE '{fallback}' END AS {'provider' if name == 'issuer' else column}"
        )
    dimensions = ("channel", "version", "reason", "result", "location")
    section = " ".join(
        f"WHEN GROUPING({name}) = 0 THEN '{'where' if name == 'location' else name}'"
        for name in dimensions
    )
    key = " ".join(f"WHEN GROUPING({name}) = 0 THEN {name}" for name in dimensions)
    grouping_sets = ["()", "(provider)"]
    grouping_sets += [f"({name})" for name in dimensions]
    grouping_sets += [f"(provider, {name})" for name in dimensions]
    return f"""WITH documents AS (
  SELECT document_id, submission_timestamp, client_info.client_id AS client_id,
    LOWER(COALESCE(client_info.app_channel, '')) AS channel,
    client_info.app_display_version AS version, events
  FROM `{DATASET}.events`
  WHERE {predicate(day)}
  QUALIFY ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY submission_timestamp DESC) = 1
), oauth_events AS (
  SELECT client_id, channel, version,
    {extras}
  FROM documents CROSS JOIN UNNEST(events) AS event
  WHERE event.category = 'mail' AND event.name = 'oauth2_authentication'
), classified AS (
  SELECT client_id,
    IF(channel IN ('esr', 'release', 'beta', 'nightly'), channel, 'other') AS channel,
    COALESCE(REGEXP_EXTRACT(version, r'^([0-9]{{1,4}})(?:\\.[0-9]{{1,6}})*(?:(?:a|b)[0-9]{{1,4}}|esr)?$'), 'other') AS version,
    {', '.join(normalized)}
  FROM oauth_events
)
SELECT IF(GROUPING(provider) = 0, 'issuer', 'all') AS scope,
  IF(GROUPING(provider) = 0, provider, '') AS issuer,
  CASE {section} ELSE 'summary' END AS section,
  CASE {key} ELSE '' END AS key,
  COUNT(*) AS total, COUNT(DISTINCT client_id) AS count
FROM classified
GROUP BY GROUPING SETS ({', '.join(grouping_sets)})"""


def addons_query(day):
    # This measures the addons-ping population. The legacy modules-ping
    # denominator is intentionally not reused, since collection differs.
    return f"""WITH source_pings AS (
  SELECT document_id, submission_timestamp, client_info.client_id AS client_id,
    COALESCE(NULLIF(client_info.app_channel, ''), 'Unknown') AS channel,
    COALESCE(NULLIF(client_info.app_display_version, ''), 'Unknown') AS version,
    metrics.object.addons_active_addons AS addons
  FROM `{DATASET}.addons`
  WHERE {predicate(day)}
), clients AS (
  SELECT * FROM source_pings
  WHERE JSON_TYPE(addons) = 'array'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY client_id ORDER BY submission_timestamp DESC, document_id DESC
  ) = 1
), classified AS (
  SELECT *, ARRAY(
    SELECT DISTINCT JSON_VALUE(addon, '$.id')
    FROM UNNEST(JSON_QUERY_ARRAY(addons)) AS addon
    WHERE JSON_VALUE(addon, '$.addonType') = 'extension'
      AND COALESCE(SAFE_CAST(JSON_VALUE(addon, '$.isSystem') AS BOOL), FALSE) = FALSE
      AND COALESCE(SAFE_CAST(JSON_VALUE(addon, '$.isBuiltin') AS BOOL), FALSE) = FALSE
      AND NULLIF(JSON_VALUE(addon, '$.id'), '') IS NOT NULL
      AND JSON_VALUE(addon, '$.id') NOT IN (
        'wetransfer@extensions.thunderbird.net', 'search.mozilla.org')
  ) AS extensions
  FROM clients
), popular AS (
  SELECT addon, COUNT(*) AS count FROM classified CROSS JOIN UNNEST(extensions) AS addon
  GROUP BY addon ORDER BY count DESC, addon LIMIT 10
)
SELECT 'summary' AS section, '' AS key, COUNT(*) AS count,
  COUNTIF(ARRAY_LENGTH(extensions) > 0) AS addon_count,
  COUNTIF(ARRAY_LENGTH(ARRAY(SELECT addon FROM UNNEST(extensions) AS addon
    WHERE addon NOT IN UNNEST(excluded_addons))) > 0) AS minustop10_count,
  COUNT(*) AS reporting_clients,
  (SELECT COUNT(DISTINCT client_id) FROM source_pings) AS source_clients
FROM classified CROSS JOIN (SELECT ARRAY_AGG(addon) AS excluded_addons FROM popular)
UNION ALL SELECT 'channel', channel, COUNT(*), NULL, NULL, NULL, NULL
  FROM classified GROUP BY channel
UNION ALL SELECT 'version', version, COUNT(*), NULL, NULL, NULL, NULL
  FROM classified GROUP BY version
UNION ALL SELECT 'popular', addon, count, NULL, NULL, NULL, NULL FROM popular"""
