import datetime
import json
import os
import requests
import settings
import tools
from pathlib import Path

start_date = datetime.date(2020, 12, 27)
# Cutoff date for switching to Glean API
glean_cutoff_date = datetime.date(2025, 5, 4)
adi_filename = Path(__file__).parent / '../docs/thunderbird_adi.json'
filename = Path(__file__).parent / '../docs/thunderbird_ami.json'
uptake_140_filename = Path(__file__).parent / '../docs/140uptake.json'
uptake_128_filename = Path(__file__).parent / '../docs/128uptake.json'
# Number of days to query between, SQL Between is inclusive so this is
# 30 days of actual data.
num_days = 29

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

    try:
        print("Querying Glean API...")
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()

        # Build a dictionary of date -> MAU
        _glean_cache = {}
        for row in data['query_result']['data']['rows']:
            _glean_cache[row['received_day']] = row['mau']

        print(f"Retrieved {len(_glean_cache)} days of Glean data")
        return _glean_cache
    except Exception as e:
        print(f"Error querying Glean API: {e}")
        return {}


def get_glean_mau(date_string, glean_data):
    """Get MAU for a specific date from cached Glean data."""
    return glean_data.get(date_string)


def percent_represented(end_date):
    """Calculate the percentage of users that ARE represented in telemetry for a specific date.

    Automatically determines which telemetry system to use based on the date:
    - Before May 1st, 2025: Uses legacy telemetry (versions >= 78) from adi files
    - After May 1st, 2025: Uses Glean telemetry (versions >= 128) from uptake files
    """
    daystring = end_date.strftime("%Y-%m-%d")

    if end_date >= glean_cutoff_date:
        # Load uptake files for Glean-era data
        uptake_140 = tools.parse_cached_json(uptake_140_filename)['json']
        uptake_128 = tools.parse_cached_json(uptake_128_filename)['json']
        version_threshold = settings.first_glean_version

        # Try 140uptake first (for more recent dates), fall back to 128uptake
        data = uptake_140.get(daystring) or uptake_128.get(daystring)

        if data:
            total_count = data['count']
            version_below_threshold_count = 0

            for version, count in data['versions'].items():
                try:
                    # Handle special cases like "115", "102 and below", "128 and below"
                    if 'and below' in version.lower():
                        major = int(version.split()[0])
                        if major < version_threshold:
                            version_below_threshold_count += int(count)
                    else:
                        major = int(version.split('.')[0])
                        if major < version_threshold:
                            version_below_threshold_count += int(count)
                except (ValueError, IndexError):
                    pass

            if total_count > 0:
                return 1 - (version_below_threshold_count / total_count)
    else:
        # Load adi file for legacy telemetry data
        data = tools.parse_cached_json(adi_filename)['json']
        version_threshold = settings.first_version

        if daystring in data:
            total_count = data[daystring]['count']
            version_below_threshold_count = 0

            for version, count in data[daystring]['versions'].items():
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


cached = tools.parse_cached_json(filename)
dataloc = cached['json']

# Query Glean API once for all dates
glean_data = query_glean_data()

# One data point per week.
for daystring in tools.date_range(start_date, 7):
    if daystring not in dataloc:
        dataloc[daystring] = {}
        print(daystring)
        curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()

        # Check if we should use Glean API (after May 1st, 2025)
        if curdate >= glean_cutoff_date:
            # Get MAU data from cached Glean results
            mau = get_glean_mau(daystring, glean_data)

            if mau is not None:
                # Get the adjustment factor (percentage of users represented in telemetry)
                adjustment_factor = percent_represented(curdate)

                d = {
                    "start_date": (curdate - datetime.timedelta(num_days)).strftime("%Y-%m-%d"),
                    "ami": mau,
                    "78": round(adjustment_factor, 3)
                }
                print(f"  Glean MAU: {mau:,}, Adjustment: {adjustment_factor:.3f}")
            else:
                print(f"  Warning: No Glean data found for {daystring}")
                continue
        else:
            # Use legacy Athena query for dates before May 1st, 2025
            q = tools.TotalUsers(curdate, num_days)
            d = {
                "start_date": (curdate - datetime.timedelta(num_days)).strftime("%Y-%m-%d"),
                "ami": q.query_totalusers().totalusers,
                "78": round(percent_represented(curdate), 3)
            }

        dataloc[daystring] = d
    with open(filename, 'w') as file:
        json.dump(cached['json'], file)
