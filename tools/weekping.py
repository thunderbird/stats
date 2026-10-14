import datetime
import json
import pyathena
import settings
from pathlib import Path

start_date = datetime.date(2025, 2, 7)
end_date = datetime.date.today()
delta = 7
cursor = pyathena.connect(settings.s3bucket, settings.region).cursor(pyathena.cursor.DictCursor)

def datelist(start_date, end_date, days):
    """ Output list of date pairs to be used in the query.
         Takes start and end dates, and delta number of days as args.
    """
    dates = []
    while start_date <= end_date:
        dates.append((start_date, start_date+datetime.timedelta(days=(days-1))))
        start_date += datetime.timedelta(days)
    return dates

def datewhere(dtup):
    """ Given a date tuple return the segment of a query that contains the date qualifier. """
    if dtup[1]:
        return " AND date BETWEEN '{}' AND '{}'".format(dtup[0].strftime("%Y/%m/%d"), dtup[1].strftime("%Y/%m/%d"))
    else:
        return " AND date = '{}'".format(dtup[0].strftime("%Y/%m/%d"))


def runqueries(query, datelist):
    for dt in datelist:
        q = query + datewhere(dt)
        cursor.execute(q)
        datapoint = cursor.fetchall()[0]['count']
        print('{date}, {count}'.format(date=dt[0].strftime("%Y/%m/%d"), count=datapoint))

# Opt-out Pings
query = "SELECT count(DISTINCT clientid) as count FROM telemetry_data WHERE type='deletion-request'"
print("Opt-out Pings")
runqueries(query, datelist(start_date, end_date, delta))

# New Profile Pings
query = "SELECT count(DISTINCT clientid) as count FROM telemetry_data WHERE type='new-profile'"
print("New Profile Pings")
runqueries(query, datelist(start_date, end_date, delta))
