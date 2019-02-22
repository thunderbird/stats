import boto3
import csv
import datetime
import json


theme_guid = '{972ce4c6-7e08-4474-a285-3208198ce6fd}'
s3_bucket = 'versioncheck-athena-results'
file_dir = 'amo_stats/update_counts_by_version'
file_name = '000000_0'
start_date = datetime.date(2019, 1, 1)
outfile_name = 'docs/thunderbird_adi.json'

def parse_s3_data(date):
    s3 = boto3.resource('s3')
    input_dir = '/'.join([file_dir, date, file_name])
    infile = s3.Object(s3_bucket, input_dir)
    data = infile.get()['Body'].read().splitlines(True)
    reader = csv.reader(data, delimiter='\t')

    sum = 0
    version_data = {}
    for row in reader:
        if row[1] == theme_guid:
            if row[2] in version_data:
                version_data[row[2]] += int(row[3])
            else:
                version_data[row[2]] = int(row[3])
            sum += int(row[3])

    parsed_data = {'count': sum, 'versions': version_data}

    return parsed_data


daterange = datetime.date.today() - start_date
data = {}

for d in range(daterange.days):
    daystring = (start_date + datetime.timedelta(d)).strftime("%Y-%m-%d")
    day_data = parse_s3_data(daystring)
    data[daystring] = day_data
    print daystring

with open(outfile_name, 'w') as outfile:
    json.dump(data, outfile)
