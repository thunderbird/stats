"""Append SUMO question counts from the public aaq-scraper exports.

Keep the legacy Pacific calendar days, including spam, without rewriting counts
already published. Each import reads one immutable upstream Git revision.
"""
import csv
import datetime as dt
import hashlib
import io
import logging
import re
from zoneinfo import ZoneInfo

from .common import dates, http_session

REPOSITORY = "thunderbird/aaq-scraper"
TIMEZONE = ZoneInfo("America/Los_Angeles")
START_DATE = dt.date(2020, 1, 1)


def latest_complete_day(now=None):
    now = now or dt.datetime.now(dt.UTC)
    return now.astimezone(TIMEZONE).date() - dt.timedelta(days=1)


def parse_timestamp(value):
    timestamp = dt.datetime.fromisoformat(value)
    if timestamp.tzinfo is None:
        raise ValueError("AAQ timestamp has no timezone")
    return timestamp.astimezone(dt.UTC)


def question_rows(body, day):
    # SUMO content fields can exceed csv's default 128 KiB limit.
    csv.field_size_limit(16 * 1024 * 1024)
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig"), newline=""), strict=True)
    if not {"id", "created", "product"} <= set(reader.fieldnames or []):
        raise ValueError(f"Invalid AAQ CSV header for {day}")
    for row in reader:
        if None in row or any(value is None for value in row.values()):
            raise ValueError(f"Incomplete AAQ CSV row for {day}")
        if not re.fullmatch(r"[1-9][0-9]*", row["id"]) or row["product"] != "thunderbird":
            raise ValueError(f"Invalid AAQ question for {day}")
        created = parse_timestamp(row["created"])
        if created.date() != day:
            raise ValueError(f"AAQ question {row['id']} is outside UTC day {day}")
        yield int(row["id"]), created


def collect(counts, through, *, session=None, now=None, source_info=None):
    """Fill missing complete Pacific days; errors leave the input untouched."""
    through = min(through, latest_complete_day(now))
    missing = [day for day in dates(START_DATE, through) if day.isoformat() not in counts]
    if not missing:
        return counts.copy()
    owned_session = session is None
    session = session or http_session()
    try:
        response = session.get(f"https://api.github.com/repos/{REPOSITORY}/commits/main",
                               timeout=60)
        response.raise_for_status()
        revision = response.json()["sha"]
        if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise ValueError("Invalid AAQ source revision")
        base = f"https://raw.githubusercontent.com/{REPOSITORY}/{revision}"
        response = session.get(f"{base}/.refresh-hwm", timeout=60)
        response.raise_for_status()
        watermark = parse_timestamp(response.text.strip())
        end = dt.datetime.combine(through + dt.timedelta(days=1), dt.time(), TIMEZONE)
        if watermark < end:
            raise ValueError(f"AAQ exports are not complete through Pacific day {through}: "
                             f"refresh watermark is {watermark.isoformat()}")

        # Pacific days straddle two UTC files, including across DST and year end.
        needed = sorted({utc_day for day in missing for utc_day in
                         (day, day + dt.timedelta(days=1))})
        totals = {day.isoformat(): 0 for day in missing}
        seen, files = set(), {}
        for index, day in enumerate(needed):
            path = f"{day.year}/questions-thunderbird-desktop-{day}.csv"
            response = session.get(f"{base}/{path}", timeout=60)
            response.raise_for_status()
            body = response.content
            for question_id, created in question_rows(body, day):
                if question_id in seen:
                    raise ValueError(f"Duplicate AAQ question ID {question_id}")
                seen.add(question_id)
                key = created.astimezone(TIMEZONE).date().isoformat()
                if key in totals:
                    totals[key] += 1
            files[path] = {"sha256": hashlib.sha256(body).hexdigest(), "size": len(body)}
            if (index + 1) % 25 == 0:
                logging.info("Validated %d/%d AAQ exports", index + 1, len(needed))
        result = counts | totals
        if source_info is not None:
            source_info.update(repository=REPOSITORY, revision=revision,
                               watermark=watermark.isoformat(), timezone=TIMEZONE.key,
                               files=files, added_days=len(totals))
        logging.info("Added %d SUMO days (%d questions), through %s, from AAQ %s",
                     len(totals), sum(totals.values()), through, revision)
        return result
    finally:
        if owned_session:
            session.close()
