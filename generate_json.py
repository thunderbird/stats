import boto3
import csv
import datetime
import json
import os


start_date = datetime.date(2018, 8, 1)
s3_bucket = 'versioncheck-athena-results'
outfile_name = 'docs/thunderbird_adi.json'

main_dir = 'amo_stats'
file_dir = main_dir + '/update_counts_by_version'
apps_dir = main_dir + '/update_counts_by_app'
file_name = '000000_0'
theme_guid = '{972ce4c6-7e08-4474-a285-3208198ce6fd}'
tb_guid = '{3550f703-e582-4d05-9a08-453d09bdfdc6}'
sm_guid = '{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}'

def parse_cached_json():
    """Pull data from last JSON file if it exists, otherwise regenerate all data. """
    data = {}
    try:
        with open(outfile_name, 'r') as infile:
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
    data = infile.get()['Body'].read().splitlines(True)
    reader = csv.reader(data, delimiter='\t')
    return reader

def sm_versions():
    """Returns a set() of Seamonkey versions using the SM guid to filter them out of final data."""
    yesterday = (datetime.date.today() - datetime.timedelta(1)).strftime('%Y-%m-%d')
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

    sum = 0
    version_data = {}
    for row in reader:
        if row[1] == theme_guid and row[2] not in seamonkeys:
            if row[2] in version_data:
                version_data[row[2]] += int(row[3])
            else:
                version_data[row[2]] = int(row[3])
            sum += int(row[3])

    parsed_data = {'count': sum, 'versions': version_data}

    return parsed_data

data = parse_cached_json()
if data['start_date']:
    start_date = data['start_date']

daterange = datetime.date.today() - start_date

for d in range(daterange.days):
    daystring = (start_date + datetime.timedelta(d)).strftime("%Y-%m-%d")
    day_data = parse_s3_data(daystring)
    data['json'][daystring] = day_data
    print daystring

with open(outfile_name, 'w') as outfile:
    json.dump(data['json'], outfile)
