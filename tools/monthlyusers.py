if __package__:
    from . import settings, tools
else:
    import settings
    import tools

import argparse
import datetime
import json
import os
import statistics
import tempfile
import requests
from pathlib import Path

start_date = datetime.date(2020, 12, 27)
# Cutoff date for switching to Glean API
glean_cutoff_date = datetime.date(2025, 5, 4)
adi_filename = Path(__file__).parent / '../docs/thunderbird_adi.json'
filename = Path(__file__).parent / '../docs/thunderbird_ami.json'
# Number of days to query between, SQL Between is inclusive so this is
# 30 days of actual data.
num_days = 29
# The Glean query counts clients seen during the last 28 days, including today.
glean_num_days = 28

# Glean API configuration
GLEAN_API_KEY = os.environ.get('GLEAN_API_KEY')
GLEAN_BASE_URL = "https://sql.telemetry.mozilla.org"
GLEAN_QUERY_ID = 107298

# Cache for Glean API results
_glean_cache = None

def query_glean_data():
    """Query Glean API once and return all MAU data."""
    global _glean_cache

    if _glean_cache is not None:
        return _glean_cache

    if not GLEAN_API_KEY:
        raise ValueError("GLEAN_API_KEY environment variable is not set")

    headers = {"Authorization": f"Key {GLEAN_API_KEY}"}
    url = f"{GLEAN_BASE_URL}/api/queries/{GLEAN_QUERY_ID}/results"

    print("Querying Glean API...")
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    rows = response.json()['query_result']['data']['rows']
    results = {}
    for row in rows:
        day = row['received_day']
        datetime.datetime.strptime(day, '%Y-%m-%d')
        mau = row['mau']
        if type(mau) is not int or mau <= 0 or day in results:
            raise ValueError(f"Invalid or duplicate Glean MAU for {day}")
        results[day] = mau
    if not results:
        raise ValueError("Glean API returned no MAU data")
    # Cache only complete, validated responses. API failures must stop publishing.
    _glean_cache = results
    print(f"Retrieved {len(_glean_cache)} days of Glean data")
    return _glean_cache


def get_glean_mau(date_string, glean_data):
    """Get MAU for a specific date from cached Glean data."""
    return glean_data.get(date_string)


def percent_represented(end_date, adi_data=None):
    """Estimate telemetry coverage using the full ADI version distribution.

    From May 4, 2025, average the daily share on Glean-capable versions over
    Monday-Friday in the trailing 28 days. Each weekday has equal weight.
    Preserve the legacy calculation for earlier dates.
    """
    if adi_data is None:
        adi_data = tools.parse_cached_json(adi_filename)['json']
    daystring = end_date.strftime("%Y-%m-%d")

    if end_date >= glean_cutoff_date:
        shares = []
        for offset in range(glean_num_days):
            day = end_date - datetime.timedelta(days=offset)
            if day.weekday() >= 5:
                continue

            key = day.isoformat()
            data = adi_data.get(key)
            if not data or not data.get('versions') or data.get('count', 0) <= 0:
                raise ValueError(f"Missing or empty weekday ADI data for {key}")
            counts = list(data['versions'].values())
            if any(type(count) is not int or count < 0 for count in counts):
                raise ValueError(f"Invalid weekday ADI counts for {key}")
            # Totals may include an unclassified update request. They must
            # still cover all explicitly listed versions.
            if sum(counts) > data['count']:
                raise ValueError(f"Inconsistent weekday ADI total for {key}")

            below_glean = 0
            for version, count in data['versions'].items():
                try:
                    major = int(version.split('.')[0])
                except ValueError:
                    continue
                # Version 128 includes Glean. There is no upper version limit.
                if major < settings.first_glean_version:
                    below_glean += int(count)

            share = 1 - below_glean / data['count']
            if not 0 < share <= 1:
                raise ValueError(f"Invalid Glean coverage for {key}: {share}")
            shares.append(share)

        return statistics.mean(shares)
    else:
        version_threshold = settings.first_version

        if daystring in adi_data:
            total_count = adi_data[daystring]['count']
            version_below_threshold_count = 0

            for version, count in adi_data[daystring]['versions'].items():
                try:
                    major = int(version.split('.')[0])
                    if major < version_threshold:
                        version_below_threshold_count += int(count)
                except (ValueError, IndexError):
                    pass

            if version_below_threshold_count > 0:
                return 1 - (version_below_threshold_count / total_count)

    # If no data available, assume all users are represented
    return 1.0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Update weekly Thunderbird MAU.")
    parser.add_argument(
        '--recalculate', action='store_true',
        help='Recalculate cached Glean-era factors, preserving raw MAU counts.'
    )
    parser.add_argument('--input', type=Path, default=filename,
                        help='Existing MAU JSON to update.')
    parser.add_argument('--output', type=Path,
                        help='Write to a staging file instead of replacing the input.')
    parser.add_argument('--adi', type=Path, default=adi_filename,
                        help='Full daily ADI version distribution.')
    parser.add_argument('--through', type=datetime.date.fromisoformat,
                        help='Last completed UTC day to consider (inclusive).')
    args = parser.parse_args(argv)
    output = args.output or args.input
    # These are authoritative inputs. A missing/unreadable file must not be
    # treated as an empty cache and trigger an accidental historical rebuild.
    with args.input.open() as file:
        dataloc = json.load(file)
    with args.adi.open() as file:
        adi_data = json.load(file)
    for day, record in dataloc.items():
        datetime.datetime.strptime(day, '%Y-%m-%d')
        if (not isinstance(record, dict)
                or type(record.get('ami')) is not int or record['ami'] <= 0
                or not isinstance(record.get('78'), (int, float))
                or not 0 < record['78'] <= 1
                or not isinstance(record.get('start_date'), str)):
            raise ValueError(f"Invalid cached MAU record for {day}")
    glean_data = None
    recalculated = 0
    added = 0

    # One data point per week. Build the whole update before replacing the file.
    date_args = {} if args.through is None else {'end': args.through + datetime.timedelta(days=1)}
    for daystring in tools.date_range(start_date, 7, **date_args):
        curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
        if daystring in dataloc:
            if args.recalculate and curdate >= glean_cutoff_date:
                factor = round(percent_represented(curdate, adi_data), 3)
                if dataloc[daystring]['78'] != factor:
                    dataloc[daystring]['78'] = factor
                    recalculated += 1
            continue

        if curdate >= glean_cutoff_date:
            if glean_data is None:
                glean_data = query_glean_data()
            mau = get_glean_mau(daystring, glean_data)
            if mau is None:
                if glean_data and daystring <= max(glean_data):
                    raise ValueError(f"Missing historical Glean MAU for {daystring}")
                print(f"  Glean MAU is not available yet for {daystring}; retry next run")
                continue
            if type(mau) is not int or mau <= 0:
                raise ValueError(f"Invalid Glean MAU for {daystring}")

            adjustment_factor = percent_represented(curdate, adi_data)
            d = {
                "start_date": (curdate - datetime.timedelta(num_days)).strftime("%Y-%m-%d"),
                "ami": mau,
                "78": round(adjustment_factor, 3)
            }
            print(f"{daystring}: Glean MAU: {mau:,}, Adjustment: {adjustment_factor:.3f}")
        else:
            q = tools.TotalUsers(curdate, num_days)
            d = {
                "start_date": (curdate - datetime.timedelta(num_days)).strftime("%Y-%m-%d"),
                "ami": q.query_totalusers().totalusers,
                "78": round(percent_represented(curdate, adi_data), 3)
            }

        dataloc[daystring] = d
        added += 1

    if recalculated or added or output != args.input:
        mode = args.input.stat().st_mode & 0o777 if args.input.exists() else 0o644
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='w', dir=output.parent, prefix=f'.{output.name}.',
                suffix='.tmp', delete=False
            ) as file:
                temporary = Path(file.name)
                json.dump(dataloc, file)
                file.flush()
                os.fsync(file.fileno())
            temporary.chmod(mode)
            os.replace(temporary, output)
        finally:
            if temporary is not None:
                try:
                    temporary.unlink()
                except FileNotFoundError:
                    pass

    print(f"Recalculated {recalculated} factors; added {added} records.")


if __name__ == '__main__':
    main()
