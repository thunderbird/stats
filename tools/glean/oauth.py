from pathlib import Path
import api
import datetime
import json

filename = Path(__file__).parent / '../docs/oauth.json'


def parse_result(data):
    issuers = set()
    channels = set()
    versions = set()
    reasons = set()
    results = set()

    rows = data["query_result"]["data"]["rows"]
    for row in rows:
        issuers.add(row["issuer"])
        channels.add(row["channel"])
        versions.add(row["version"])
        reasons.add(row["reason"])
        results.add(row["result"])

    # print(issuers)
    # print(channels)
    # print(versions)
    # print(reasons)
    # print(results)

    output = {"total": {}}
    for issuer in issuers:
        output["issuer=" + issuer] = {}
        for channel in channels:
            output["issuer=" + issuer + "&channel=" + channel] = {}
        for version in versions:
            output["issuer=" + issuer + "&version=" + version] = {}
        for reason in reasons:
            output["issuer=" + issuer + "&reason=" + reason] = {}
        for result in results:
            output["issuer=" + issuer + "&result=" + result] = {}

    def get_date_key(timestamp):
        return datetime.datetime.fromisoformat(timestamp).isoformat()[0:10]

    def increment(bucket_key, date_key):
        count = output[bucket_key].get(date_key) or 0
        output[bucket_key][date_key] = count + 1

    for row in rows:
        date_key = get_date_key(row["event_timestamp"])
        increment("total", date_key)
        increment("issuer=" + row["issuer"], date_key)
        increment("issuer=" + row["issuer"] + "&channel=" + row["channel"], date_key)
        increment("issuer=" + row["issuer"] + "&version=" + row["version"], date_key)
        increment("issuer=" + row["issuer"] + "&reason=" + row["reason"], date_key)
        increment("issuer=" + row["issuer"] + "&result=" + row["result"], date_key)

    return output


if __name__ == "__main__":
    query_id = 104489
    params = {"days": 28}
    data = api.get_fresh_query_result(query_id, params)
    output = parse_result(data)

    with open(filename, "w") as output_file:
        json.dump(output, output_file, sort_keys=True)
