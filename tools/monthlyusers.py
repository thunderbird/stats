import datetime
import json
import settings
import tools
from pathlib import Path

start_date = datetime.date(2020, 12, 27)
adi_filename = Path(__file__).parent / '../docs/thunderbird_adi.json'
filename = Path(__file__).parent / '../docs/thunderbird_ami.json'
# Number of days to query between, SQL Between is inclusive so this is
# 30 days of actual data.
num_days = 29
# Number to put in the LIKE %version% part of the Athena query.
version = 8

def percent78(end_date, num_days, filename):
    """ Temporary function to determine the percentage of 78 users to divide the total by."""
    data = tools.parse_cached_json(filename)['json']
    start_date = end_date - datetime.timedelta(num_days)
    daterange = end_date - start_date
    percents = []

    for d in range(daterange.days):
        daystring = (start_date + datetime.timedelta(d)).strftime("%Y-%m-%d")
        total = 0
        for version, count in data[daystring]['versions'].items():
            major = version.split('.')[0]
            try:
                if int(major) == 78:
                    total += int(count)
            except ValueError:
                pass
        if total > 0:
            percent = (total * 1.0) / data[daystring]['count']
            percents.append(percent)
    return sum(percents) / float(len(percents))


cached = tools.parse_cached_json(filename)
dataloc = cached['json']

# One data point per week.
for daystring in tools.date_range(start_date, 7):
    if daystring not in dataloc:
        dataloc[daystring] = {}
        print(daystring)
        curdate = datetime.datetime.strptime(daystring, "%Y-%m-%d").date()
        q = tools.TotalUsers(curdate, version, num_days)
        d = {
            "start_date": (curdate - datetime.timedelta(num_days)).strftime("%Y-%m-%d"),
            "ami": q.query_totalusers().totalusers,
            "78": round(percent78(curdate, num_days, adi_filename), 3)
        }
        dataloc[daystring] = d
    with open(filename, 'w') as file:
        json.dump(cached['json'], file)
