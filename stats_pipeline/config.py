from dataclasses import dataclass
import os
import re


@dataclass(frozen=True)
class Config:
    bucket: str
    prefix: str = "prod"
    region: str = "us-west-2"
    workgroup: str = "thunderbird-stats"
    database: str = "stats_pipeline"
    telemetry_workgroup: str = "thunderbird-stats"
    telemetry_results: str = "s3://thunderbird-telemetry1/stats-pipeline-results/"
    late_days: int = 7

    def __post_init__(self):
        if not self.bucket or self.prefix not in {"prod", "shadow", "stage"}:
            raise ValueError("Set a state bucket and a prod, shadow or stage namespace")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", self.database):
            raise ValueError("Invalid Athena database")
        if not 1 <= self.late_days <= 90:
            raise ValueError("late_days must be 1..90")

    @classmethod
    def from_env(cls):
        return cls(bucket=os.environ["STATS_BUCKET"], prefix=os.getenv("STATS_PREFIX", "prod"),
                   region=os.getenv("STATS_REGION", "us-west-2"),
                   workgroup=os.getenv("STATS_WORKGROUP", "thunderbird-stats"),
                   telemetry_workgroup=os.getenv("STATS_TELEMETRY_WORKGROUP", "thunderbird-stats"),
                   telemetry_results=os.getenv("STATS_TELEMETRY_RESULTS", "s3://thunderbird-telemetry1/stats-pipeline-results/"),
                   late_days=int(os.getenv("STATS_LATE_DAYS", "7")))
