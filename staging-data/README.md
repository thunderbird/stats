# Reviewed staging data

These aggregate datasets reproduce the stats rewrite preview on staging while
the production collector still uses the earlier schema:

- `glean.json`: sanitized weekly Glean aggregates collected for the rewrite.
- `release_history.json`: dated Thunderbird release and ESR metadata.
- `adi-channels-preview.json`: reviewed historical update-request channel counts.

Only the staging deployment supplies this directory through the static builder's
`--supplemental-data` option. The restored production snapshot remains the source
of daily totals and date coverage. Channel detail is layered onto dates already
present in that snapshot, with the original daily totals recorded separately.
The original snapshot files and S3 state are not modified.

These are fixed review datasets, not a replacement for scheduled collection.
Refresh or remove this supplement when the corresponding collector changes are
enabled on the production processing branch. Source definitions and collection
provenance are in `GLEAN_DATA_NOTES.md` and `CHANNEL_DATA_NOTES.md`.
