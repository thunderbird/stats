import datetime
import json
import settings
import tools
from pathlib import Path

start_date = datetime.date(2020, 11, 29)
filename = Path(__file__).parent / '../docs/addon_stats.json'
# Number of days to query between, SQL Between is inclusive so this is
# 7 days of actual data.
num_days = 6
# Number to put in the LIKE %version% part of the Athena query.
version = 78

dataloc = tools.parse_cached_json(filename)['json']
# One data point per week.
for daystring in tools.date_range(start_date, 7):
    if daystring not in dataloc:
        dataloc[daystring] = {}
        print(daystring)
        curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
        q = tools.TotalAddonUsers(curdate, version, num_days)
        d = {
            "total": q.query_totalusers().totalusers,
            "addon_count": q.addon_totalusers,
            "minustop10_count": q.query_totalusers(10).addon_totalusers
        }
        dataloc[daystring] = d
    with open(filename, 'w') as file:
        json.dump(dataloc, file)
