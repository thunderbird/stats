"""Recorded update channels, kept independent of version-name heuristics."""

import re
from urllib.parse import unquote


CHANNELS = ("esr", "release", "beta", "nightly")
UNKNOWN = "unknown"
# The leading slash is the first split_part field in Athena. Versions occupy
# field 5 and channels field 9 in the update/3 and update/6 protocols.
AUS_PATH = re.compile(r"^/update/[0-9]+/[^/]+/[^/]+/[^/]+/[^/]+/[^/]+/([^/]+)/")


def normalize_channel(value):
    """Normalize explicit channels; a version can never establish a channel."""
    value = unquote(value or "").strip().lower()
    # UpdateUtils appends partner IDs as '-cck-…' to the recorded channel.
    value = value.split("-cck-", 1)[0]
    if value == "daily":
        value = "nightly"
    return value if value in CHANNELS else UNKNOWN


def channel_from_aus_uri(uri):
    """Extract a channel only from a recognized AUS path layout."""
    match = AUS_PATH.match(uri)
    return normalize_channel(match[1] if match else None)


def add_channel(channels, channel, version, count):
    bucket = channels.setdefault(normalize_channel(channel), {})
    bucket[version] = bucket.get(version, 0) + count


def coverage(channels, total):
    """Require complete accounting, including observations without a channel."""
    observed = sum(sum(versions.values()) for versions in channels.values())
    if observed != total:
        raise ValueError(f"Channel counts {observed} do not match ADI count {total}")
    unknown = sum(channels.get(UNKNOWN, {}).values())
    return {"total": total, "classified": total - unknown, "unknown": unknown}


def aus_record(rows, day):
    """Aggregate channel-aware rows, accepting older three-column fixtures."""
    versions, channels, total = {}, {}, 0
    if not rows:
        raise ValueError(f"Invalid AUS aggregate for {day}")
    legacy = all(len(row) == 3 for row in rows)
    for row in rows:
        if len(row) not in (3, 4) or row[0] != day:
            raise ValueError(f"Invalid AUS aggregate for {day}")
        version, count = row[1], int(row[-1])
        if count < 0:
            raise ValueError(f"Invalid AUS aggregate for {day}")
        total += count
        # Preserve old fixture behavior for duplicate three-column rows. New
        # rows split a version across channels and must be added back together.
        versions[version] = count if legacy else versions.get(version, 0) + count
        add_channel(channels, row[2] if len(row) == 4 else None, version, count)
    return {
        "count": total,
        "versions": versions,
        "channels": channels,
        "channel_coverage": coverage(channels, total),
    }
