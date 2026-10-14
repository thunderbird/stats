# ADI channel source audit

Audited 2026-10-13. The redesigned explorer uses the same update-request sources
as the existing ADI calculation. Channel classification is based on an explicitly
recorded update channel, never on the version number or its suffix.

## Source fields

The AUS source is `s3://aus-thunderbird-logs/EC3NSDIH119PP.*`. Application update
requests record their channel in the URL path:

```text
/update/6/Thunderbird/{version}/{build}/{target}/{locale}/{channel}/.../update.xml
```

The channel is field 9 of Athena's one-based `split_part(cs_uri, '/', ...)`; the
leading slash occupies field 1. The version remains field 5. The source template
is maintained in Mozilla's
[application.ini.in](https://github.com/mozilla/gecko-dev/blob/master/build/application.ini.in).
The same field positions apply to update protocol 3.

`stats_pipeline/aus_sql.py::channel_query` retains the existing `%update%` request
filter and adds channel as a grouping dimension. Unrecognized request layouts
still contribute to ADI and receive an unknown channel. The original three-column
`count_query` remains available for existing callers.

The ATN source is `s3://versioncheck-logs/E1PQMC7BGJOP5E.*`. Thunderbird's
[extension-update URL templates](https://github.com/mozilla/releases-comm-central/blob/master/mail/app/profile/all-thunderbird.js)
send application version, operating system, and locale, but do not send an
application channel. Sanitized inspection of actual October 11 requests confirmed
the same layout. Its contribution is therefore assigned to `unknown`; all
existing default-theme and SeaMonkey filtering remains in place. ATN artifacts,
their columns, and their consumers are unchanged.

## Normalization and accounting

`stats_pipeline/channels.py` recognizes `esr`, `release`, `beta`, and `nightly`,
case-insensitively. Explicit `daily` maps to `nightly`. The documented `-cck-…`
partner suffix is removed. Blank, default, test, and other custom channel values
remain unknown. Actual source samples include blank and `default` channels;
these are observed traffic, not missing synthetic records.

Each new ADI record contains full, unpruned `channels[channel][version]` counts and
`channel_coverage` with `total`, `classified`, and `unknown`. Every observation is
accounted for, including ATN and unusual AUS requests:

```text
sum(all channel/version counts) = classified + unknown = ADI count
```

The original `versions` field retains its existing merge behavior: an AUS version
bucket replaces an overlapping ATN version bucket, while `count` includes both.
Consequently, new graph groupings must use `channels` for a complete denominator,
not sum the legacy `versions` field. Existing callers with old three-column AUS
fixtures continue to work; historical records without channels remain valid.

## Three-month historical backfill

The current local enrichment contains **93 consecutive complete UTC days from
2026-07-12 through 2026-10-12**, covering three calendar months without gaps.
The final `.state/adi-channels-preview.json` is 1,508,234 bytes; its SHA256 is
`5632df51fea6321a90ef5e7a22c369d269c65a12601859e03d918c0f461ec363`.
`.state/adi-channels-preview.metadata.json` records every day's sources,
source fingerprints, archive body digests, same-day exclusion list, observation
accounting, and comparison with the authoritative `.state/thunderbird_adi.json`.

Collection processed 61,461 source objects (74,695,767,719 source bytes) in
996.2 seconds using 20 bounded worker processes. Every AUS day was streamed from
all objects in a complete, stable 24-hour source manifest. Ninety-one ATN days
used the established version/application aggregate archives; October 11 and 12
used complete raw ATN logs because their legacy archives were absent. All reads
were conditional on source ETags, and listings/archive metadata were checked
again before a source checkpoint was accepted. All archive rows passed the shared
acceptance rules; none were rejected.

The local reader `.state/backfill_channels_preview.py` now resumes per-source,
per-day aggregate checkpoints. It invalidates a cache if the source fingerprint
or reader version changes, and records unfinished object work without counting
it twice after a restart. Pending output is separate; the final enrichment is
written atomically only after the entire requested date range validates. AWS
access used the environment credentials loaded from `/home/ec2-user/secrets.sh`
and default boto3 clients; no SSO profile was required. No credentials, raw logs,
client IPs, cookies, or user agents were written to the source-count caches.
The job performed S3 List/Get/Head operations only.

Each day uses its own observed SeaMonkey exclusion versions. All 93 enriched
records pass `validate_record` and exact channel-total conservation. Reprocessed
ADI totals differ from the published snapshot by **-5 to +35 requests** across
this period; 11 days match exactly. These discrepancies are recorded rather than
forcing channels to a historical total. The authoritative daily ADI data remain
separate and unchanged, including the headline's seven-day moving average.

The October 12 raw ATN replay was independently checked against the production
ATN version/application artifacts: artifact SHA256 checks passed; both produced
85,057 default-theme observations, identical version counters, and 49 identical
SeaMonkey exclusion versions. Both current raw source fingerprints match the
production checkpoint fingerprints. The remaining **+5 ADI requests** on that
date have not been attributed. Details are in
`build/review/channel-backfill/latest-atn-parity.json`.

| UTC day | Observed ADI total | Classified | Unknown | Difference from published ADI |
| --- | ---: | ---: | ---: | ---: |
| 2026-07-12 | 4,827,709 | 4,594,518 | 233,191 | -5 |
| 2026-07-13 | 9,725,089 | 9,140,711 | 584,378 | -3 |
| 2026-08-12 | 8,256,512 | 7,608,065 | 648,447 | -2 |
| 2026-09-12 | 4,831,950 | 4,428,226 | 403,724 | +3 |
| 2026-10-05 | 10,183,956 | 9,467,929 | 716,027 | +16 |
| 2026-10-10 | 5,116,161 | 4,679,512 | 436,649 | +0 |
| 2026-10-11 | 4,784,030 | 4,405,728 | 378,302 | +0 |
| 2026-10-12 | 9,356,508 | 8,643,350 | 713,158 | +5 |

Seven focused local-reader tests passed for source-population semantics,
same-day SeaMonkey filtering, unchanged legacy version overlap, conditional
checkpoint reuse, resumption without double counting, changed-source rejection,
and archived row validation. Completion evidence is
`build/review/channel-backfill/completed-summary.json`.

## Initial seven-day preview backfill (superseded)

The initial local review dataset read complete UTC days from October 5 through
October 11, 2026, directly from S3. Every object's rows are processed; this is not a sample
or an extrapolation. Both source listings must include every UTC hour before a
day is accepted. Only aggregate counts are written to `.state`; source IPs,
cookies, user agents, and individual request records are not saved.

That initial aggregate was `.state/adi-channels-preview.json` (118,084 bytes).
The initial `.state/adi-channels-preview.metadata.json` recorded object counts and the
comparison with the existing `dist/thunderbird_adi.json`. Collection processed
11,155 source objects in 571 seconds. All seven records pass the integrated
`validate_record` checks, including exact channel-total reconciliation.

| UTC day | AUS objects | ATN objects | ADI total | Classified | Unknown | Difference from stored ADI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-10-05 | 648 | 936 | 10,183,955 | 9,467,929 | 716,026 | +15 |
| 2026-10-06 | 648 | 936 | 10,190,111 | 9,444,468 | 745,643 | +3 |
| 2026-10-07 | 648 | 936 | 10,102,631 | 9,357,699 | 744,932 | +7 |
| 2026-10-08 | 644 | 941 | 10,128,009 | 9,398,376 | 729,633 | +4 |
| 2026-10-09 | 643 | 959 | 9,328,298 | 8,621,076 | 707,222 | +5 |
| 2026-10-10 | 648 | 960 | 5,116,162 | 4,679,512 | 436,650 | +1 |
| 2026-10-11 | 648 | 960 | 4,784,030 | 4,405,728 | 378,302 | No stored day |

Those were complete source observations reprocessed on October 13, not copied
archived totals. The initial preview used October 11's observed SeaMonkey version list
for the batch, matching the pipeline's rule of taking that list from the latest
collected day. The archived dataset does not retain each original exclusion list
or source revision. The differences above are therefore reported explicitly;
they have not all been attributed to one cause. As a cross-check, October 10
reprocessing with October 10's own exclusion list exactly reproduces the stored
5,116,161 total. Existing stored ADI files were not rewritten by this audit.

## Retention and historical archives

The original audit observed AUS data back to 2019-08-30 and ATN raw logs back to
2026-07-13. Raw ATN retention moves forward; the July 12 and July 13 raw listings
were empty during this backfill. Complete historical ATN totals can still be
recovered from the established daily aggregate archives that the legacy ADI
collector already consumes:

```text
s3://versioncheck-athena-results/amo_stats/update_counts_by_version/{day}/000000_0
s3://versioncheck-athena-results/amo_stats/update_counts_by_app/{day}/000000_0
```

These files provide default-theme version counts and the same UTC day's
SeaMonkey application-version exclusion list. Every archive is checked with the
shared `stats_pipeline.artifacts.valid_row` date, column, and nonnegative-count
rules. Invalid rows are counted in provenance. Both files must be available;
where archives are absent, complete raw ATN logs are read instead. No missing
ATN contribution is inferred from an ADI residual or assigned a guessed channel.

The normal maintained path is `tb-stats collect --component daily`, which now
retains channel counts and re-collects recent records that lack channels. An
explicit `--start YYYY-MM-DD --through YYYY-MM-DD` selects a backfill range when
both required sources remain available. This pipeline performs the established
validation, snapshot, recovery, and ATN handoff steps.

For the initial seven-day preview only, a resumable local reader under ignored
`.state` used S3 list/get operations with twelve concurrent object streams. It made no source
changes, Athena table changes, or production snapshot/deployment updates. No
credentials are embedded in the reader or its output. It is not a second
maintained production collector.

## Verification

The focused suite passed 72 tests across `tests/test_channels.py`,
`tests/test_pipeline.py`, and `tests/test_collection_recovery.py`; Ruff passed for
the changed collector modules and the new tests. Coverage includes URL positions,
channel aliases, unknown values, tiny version populations, aggregation of the
same version across multiple channels, unchanged legacy overlap behavior,
SeaMonkey filtering, invalid input, and exact channel-total reconciliation.


## Channel backfill through January 2024

Completed 1016 consecutive UTC dates from 2024-01-01 through 2026-10-12. All records pass validation and exact channel conservation; the original 93 records and authoritative daily totals are unchanged. Historical channel names retain the actual request labels; ESR-era versions can appear under release in older sources. Replayed daily totals differ from published totals by -10 to 63 requests; those differences are retained in audit metadata. The static preview and download archive include the full history. Existing Python, JavaScript, and browser suites passed; January 2024 CSV counts match every collected channel exactly in both themes. Evidence is in `build/review/channel-backfill-2024/`, with source provenance in `.state/adi-channels-preview.metadata.json`. No production deployment was performed.
