# Glean Telemetry

A quick run-down:
 * api.py is for querying the sql.telemetry.mozilla.org API.
 * You'll set STMO_API_KEY to your (automation) user api key in order to query.
 * oauth.py is the entry point for the first set of glean telemetry probes. It writes to ../docs/oauth.json
