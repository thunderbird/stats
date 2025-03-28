import logging
import json
import os
import requests
import sys
import time

redash_url = "https://sql.telemetry.mozilla.org"

# Adapted from https://github.com/getredash/redash-toolbelt/blob/master/redash_toolbelt/examples/refresh_query.py


def poll_job(session, job):
    # TODO: add timeout
    while job["status"] not in (3, 4):
        response = session.get("{}/api/jobs/{}".format(redash_url, job["id"]))
        job = response.json()["job"]
        time.sleep(1)

    if job["status"] == 3:
        return job["query_result_id"]

    return None


def get_fresh_query_result(query_id, params):
    # Need to use a *user API key* here (and not a query API key).
    api_key = os.environ.get("STMO_API_KEY")
    if not api_key:
        print("Please set STMO_API_KEY.")
        sys.exit(1)

    logging.basicConfig()
    logging.getLogger().setLevel(logging.DEBUG)
    requests_log = logging.getLogger("urllib3")
    requests_log.setLevel(logging.DEBUG)
    requests_log.propagate = True

    session = requests.Session()
    session.headers.update({"Authorization": "Key {}".format(api_key)})

    payload = dict(max_age=3600, parameters=params)

    response = session.post(
        "{}/api/queries/{}/results".format(redash_url, query_id), data=json.dumps(payload)
    )

    if response.status_code != 200:
        raise Exception("Refresh failed.")

    data = response.json()
    if "query_result" in data:
        return data
    result_id = poll_job(session, data["job"])

    if result_id:
        response = session.get(
            "{}/api/queries/{}/results/{}.json".format(redash_url, query_id, result_id)
        )
        if response.status_code != 200:
            raise Exception("Failed getting results.")
    else:
        raise Exception("Query execution failed.")

    return response.json()
