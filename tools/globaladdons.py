if __package__:
    from . import settings, tools
else:
    import settings
    import tools

import datetime
from pathlib import Path

start_date = datetime.date(2020, 11, 29)
filename = Path(__file__).parent / '../docs/addon_stats.json'
# Number of days to query between, SQL Between is inclusive so this is
# 7 days of actual data.
num_days = 6

def collect(dataloc, through, on_error=None):
    # One data point per week.
    for daystring in tools.date_range(start_date, 7, through + datetime.timedelta(days=1)):
        if daystring not in dataloc:
            try:
                print(daystring)
                curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
                q = tools.TotalAddonUsers(curdate, num_days, settings.legacy_telemetry_versions)
                dataloc[daystring] = {
                    "total": q.query_totalusers().totalusers,
                    "addon_count": q.addon_totalusers,
                    "minustop10_count": q.query_totalusers(10).addon_totalusers
                }
            except Exception as error:
                tools.record_failure(on_error, daystring, error)
    return dataloc


def main():
    from stats_pipeline.common import atomic_json, utc_today
    data = collect(tools.parse_cached_json(filename)["json"], utc_today() - datetime.timedelta(days=1))
    atomic_json(filename, data)


if __name__ == "__main__":
    main()
