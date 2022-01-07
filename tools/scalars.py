import datetime
import json
import settings
import tools
from pathlib import Path

start_date = datetime.date(2021, 1, 3)
filename = Path(__file__).parent / '../docs/telemetry.json'

cached = tools.parse_cached_json(filename)

def is_scalar_started(scalardate, curdate):
    """ returns True if there's no scalardate, or if the scalardate has been reached."""
    if not scalardate:
        return True
    else:
        pdate = datetime.datetime.strptime(scalardate, "%Y-%m-%d").date()
        if pdate < curdate:
            return True
        else:
            return False


for daystring in tools.date_range(start_date, 7):
    curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
    q = tools.AthenaQuery(curdate)
    for s in settings.keyedscalars:
        # Make sure we don't query scalars until their start dates.
        if is_scalar_started(s.get('start', None), curdate):
            dataloc = cached['json'].setdefault(s['key'], {})
            if daystring not in dataloc:
                dataloc[daystring] = {}
                print(s['key'], daystring)
                d = q.keyedscalar_users(s['key']).format_data(s.get('combine', None)).json()
                dataloc[daystring] = d
            with open(filename, 'w') as file:
                json.dump(cached['json'], file)
