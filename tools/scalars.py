import datetime
import json
import settings
import tools
from pathlib import Path

start_date = datetime.date(2021, 1, 3)
filename = Path(__file__).parent / '../docs/telemetry.json'

cached = tools.parse_cached_json(filename)

for daystring in tools.date_range(start_date, 7):
    curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
    q = tools.AthenaQuery(curdate)
    for s in settings.keyedscalars:
        dataloc = cached['json'].setdefault(s['key'], {})
        if daystring not in dataloc:
            dataloc[daystring] = {}
            print(s['key'], daystring)
            d = q.keyedscalar_users(s['key']).format_data(s.get('combine', None)).json()
            dataloc[daystring] = d
        with open(filename, 'w') as file:
            json.dump(cached['json'], file)
