FROM python:3.13.7-slim-bookworm
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY stats_pipeline /app/stats_pipeline
COPY tools /app/tools
RUN pip install --no-cache-dir uv==0.9.2 && uv sync --frozen --extra atn --no-dev
ENTRYPOINT ["/app/.venv/bin/tb-stats-atn"]
