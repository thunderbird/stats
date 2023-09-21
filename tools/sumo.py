import datetime
import json
import requests
import time
import tools
from pathlib import Path

# First date we produced these stats.
start_date = datetime.date(2023, 6, 1)
filename = Path(__file__).parent / '../docs/sumo.json'
counts = tools.parse_cached_json(filename)
counts = counts['json']

daterange = datetime.date.today() - start_date

def query_sumo_api(day):
    url = 'https://support.mozilla.org/api/2/question/'
    tomorrow = day + datetime.timedelta(1)
    params = {'created__gt': day, 'created__lt': tomorrow, 'product':'thunderbird'}
    r = requests.get(url, params=params)
    time.sleep(2)
    return r.json()['count']

for d in range(daterange.days):
    day = start_date + datetime.timedelta(d)
    daystring = day.strftime("%Y-%m-%d")
    if daystring not in counts.keys():
        counts[daystring] = query_sumo_api(day)
        print(day)
    with open(filename, 'w') as file:
        json.dump(counts, file)
