import boto3
import csv
import datetime
import json
import os
from dateutil.relativedelta import relativedelta

start_date = datetime.date(2018, 8, 1)
# First day with data for 68.
start68 = datetime.date(2019,9,3)

today = datetime.date.today() # - datetime.timedelta(1)
yesterday = (today - datetime.timedelta(1)).strftime('%Y-%m-%d')

s3_bucket = 'versioncheck-athena-results'
outfile_name = 'docs/thunderbird_adi.json'
beta_outfile_name = 'docs/beta_nightly_adi.json'

main_dir = 'amo_stats'
dir68 = 'aus_stats'
file_dir = main_dir + '/update_counts_by_version'
apps_dir = main_dir + '/update_counts_by_app'
file_name = '000000_0'
theme_guid = '{972ce4c6-7e08-4474-a285-3208198ce6fd}'
tb_guid = '{3550f703-e582-4d05-9a08-453d09bdfdc6}'
sm_guid = '{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}'


def parse_cached_json(filename):
    """Pull data from last JSON file if it exists, otherwise regenerate all data. """
    data = {}
    try:
        with open(filename, 'r') as infile:
            data['json'] = json.load(infile)
            dates = list(data['json'].keys())
            dates = [datetime.datetime.strptime(d, "%Y-%m-%d").date() for d in dates]
            dates.sort(reverse=True)
            data['start_date'] = dates[0]
    except EnvironmentError:
        data['start_date'] = None
        data['json'] = {}
    return data


def make_reader(fdir, date):
    """Returns a csv reader object for a specific S3 path: fdir + date + file_name."""
    s3 = boto3.resource('s3')
    input_dir = '/'.join([fdir, date, file_name])
    infile = s3.Object(s3_bucket, input_dir)
    # Python 3 infile.get()['Body'].read().decode('utf-8').splitlines(True)
    data = infile.get()['Body'].read().splitlines(True)
    reader = csv.reader(data, delimiter='\t')
    return reader


def s3_json_read(date):
    s3 = boto3.resource('s3')
    filename = date + '.json'
    input_dir = '/'.join([dir68, filename])
    infile = s3.Object(s3_bucket, input_dir)
    try:
        data = infile.get()['Body'].read().splitlines(False)
    except s3.meta.client.exceptions.NoSuchKey:
        return {}
    else:
        return json.loads(data[0])


def sm_versions():
    """Returns a set() of Seamonkey versions using the SM guid to filter them out of final data."""
    reader = make_reader(apps_dir, yesterday)
    versions = set()
    for row in reader:
        if row[1] == theme_guid and row[2] == sm_guid:
            versions.add(row[3])
    return versions

seamonkeys = sm_versions()

def parse_s3_data(date):
    """Parses S3 stored data for a specific date and returns it ready to be exported. """
    reader = make_reader(file_dir, date)
    jsondata = s3_json_read(date)
    # SELECT application.version AS key, count(DISTINCT clientid) AS count
    # FROM telemetry_data
    # WHERE date BETWEEN '{date1}' AND '{date2}'
    # GROUP BY application.version
    sum = 0
    version_data = {}
    for row in reader:
        if row[1] == theme_guid and row[2] not in seamonkeys:
            if row[2] in version_data:
                version_data[row[2]] += int(row[3])
            else:
                version_data[row[2]] = int(row[3])
            sum += int(row[3])

    if jsondata:
        version_data.update(jsondata['versions'])
        sum += int(jsondata['count'])

    parsed_data = {'count': sum, 'versions': version_data}

    return parsed_data


def aggregate_versions(record, vmin, vmax):
    """ Aggregates versions in record by vmin and vmax. Versions equal to and below vmin will all
    be included in a single data point. """
    majors = {}
    total = 0

    for version, count in record['versions'].iteritems():
        major = version.split('.')[0]
        try:
            # Aggregate all versions below vmin into one data point.
            if int(major) <= vmin:
                majors[str(vmin)] = majors.get(str(vmin), 0) + int(count)
            # Don't aggregate vmax at all, allow minor versions to pass through.
            elif int(major) == vmax:
                majors[version] = count
            # Also aggregate versions above vmin that aren't vmax.
            else:
                majors[major] = majors.get(major, 0) + int(count)
        except ValueError:
            pass

    # Prune data points that have less than 1/1000th(0.1%) of users to clean up graph,
    # this is usually random old beta versions. Also adjust total accordingly so we
    # still sum to 100%. Never prune vmax.
    pruned = {}
    for version, count in majors.iteritems():
        major = int(version.split('.')[0])
        if major == vmax or (major <= vmax and count > int(record['count']/1000)):
            pruned[version] = count
            total += int(count)

    pruned[str(vmin) + ' and below'] = pruned.pop(str(vmin))

    aggregate = {}
    aggregate['count'] = total
    aggregate['versions'] = pruned
    return aggregate


def build_aggregate(jsondata, vmin, vmax, enddate):
    aggregate = {}
    startdate = enddate - relativedelta(months=18)
    outfile_name = "docs/{vmax}uptake.json".format(vmax=vmax)
    for key in jsondata.keys():
        keydate = datetime.datetime.strptime(key, "%Y-%m-%d").date()
        if  keydate < enddate and keydate > startdate:
            aggregate[key] = aggregate_versions(jsondata[key], vmin, vmax)
    with open(outfile_name, 'w') as outfile:
        json.dump(aggregate, outfile)


def build_beta_aggregate(jsondata, vrelease):
    aggregate = {}
    for key in jsondata.keys():
        keydate = datetime.datetime.strptime(key, "%Y-%m-%d").date()
        if keydate < start68:
            continue
        majors = {}
        total = 0
        for version, count in jsondata[key]['versions'].iteritems():
            major = version.split('.')[0]
            try:
                # Aggregate all versions below vmin into one data point.
                if int(major) > vrelease:
                    majors[version] = majors.get(version, 0) + int(count)
                elif 'a1' in version and int(major) > vrelease:
                    majors[version] = majors.get(version, 0) + int(count)
            except ValueError:
                pass
        for version, count in majors.iteritems():
            total += int(count)

        aggregate[key] = {}
        aggregate[key]['count'] = total
        aggregate[key]['versions'] = majors

    with open(beta_outfile_name, 'w') as outfile:
        json.dump(aggregate, outfile)


data = parse_cached_json(outfile_name)
if data['start_date']:
    start_date = data['start_date']

daterange = today - start_date

for d in range(daterange.days):
    daystring = (start_date + datetime.timedelta(d)).strftime("%Y-%m-%d")
    day_data = parse_s3_data(daystring)
    data['json'][daystring] = day_data
    print(daystring)

build_aggregate(data['json'], 78, 102, datetime.date(2024, 1, 2))
build_aggregate(data['json'], 68, 91, datetime.date(2023, 1, 2))
build_beta_aggregate(data['json'], 102)

with open(outfile_name, 'w') as outfile:
    json.dump(data['json'], outfile)


