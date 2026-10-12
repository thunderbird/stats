"""The producer and ATN consumer share the same row acceptance rules."""

import csv
import io
import logging


GROUPS = {"app": "app", "locale": "locale", "appos": "os", "status": "status", "version": "version"}
SEPARATORS = frozenset("\t\r\n\v\f\x1c\x1d\x1e\x85\u2028\u2029\x00")


def valid_row(row, day, columns, count_column=-2):
    if len(row) != columns or row[0] != day:
        return False
    if any(not isinstance(value, str) or SEPARATORS.intersection(value) for value in row):
        return False
    try:
        return int(row[count_column]) >= 0
    except ValueError:
        return False


def clean_rows(rows, day, columns, count_column=-2):
    accepted = [row for row in rows if valid_row(row, day, columns, count_column)]
    rejected = len(rows) - len(accepted)
    if rejected:
        logging.warning("Discarded %s malformed rows for %s (%s columns)", rejected, day, columns)
    if not accepted:
        raise ValueError(f"No usable log rows for {day} ({columns} columns)")
    return accepted


def tsv(rows):
    out = io.StringIO()
    csv.writer(
        out, delimiter="\t", quoting=csv.QUOTE_NONE, escapechar="!", lineterminator="\r\n"
    ).writerows(rows)
    return out.getvalue().encode()


def clean_artifact(body, day, columns):
    # Split only physical LF records. Unicode separators inside a field must
    # invalidate that row, not manufacture extra records. Never decode with
    # replacement: a broken UTF-8 row is discarded as a whole.
    rows = []
    rejected = 0
    for line in body.split(b"\n"):
        if not line:
            continue
        try:
            row = line.removesuffix(b"\r").decode("utf-8").split("\t")
        except UnicodeDecodeError:
            rejected += 1
            continue
        if valid_row(row, day, columns):
            rows.append(row)
        else:
            rejected += 1
    if rejected:
        logging.warning("Discarded %s malformed artifact rows for %s", rejected, day)
    if not rows:
        raise ValueError(f"No usable artifact rows for {day} ({columns} columns)")
    # These fields are already escaped by the legacy-compatible producer.
    # Re-running csv.writer would double-escape literal exclamation marks.
    return b"".join(("\t".join(row) + "\r\n").encode() for row in rows)
