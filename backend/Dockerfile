FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY app ./app
COPY alembic.ini ./
COPY migrations ./migrations

FROM python:3.12-slim-bookworm
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
RUN mkdir -p /app/data/uploads && chown -R app:app /app/data
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8000
CMD ["python", "-m", "app.server"]
