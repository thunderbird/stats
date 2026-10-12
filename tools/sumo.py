"""SUMO counts from aaq-scraper; standalone compatibility command."""
from pathlib import Path
from stats_pipeline.common import atomic_json
from stats_pipeline.sumo import collect, latest_complete_day
import json

filename = Path(__file__).parent / '../docs/sumo.json'


def main():
    with filename.open() as file:
        data = json.load(file)
    atomic_json(filename, collect(data, latest_complete_day()))


if __name__ == '__main__':
    main()
