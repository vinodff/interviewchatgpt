"""Durable database queue: python -m app.services.worker."""

import asyncio
import logging
import uuid
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select, update

from app.config import settings
from app.db import SessionLocal
from app.models import Source
from app.services.knowledge import LeaseLost, ingest_source

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 3
LEASE_SECONDS = 300
HEARTBEAT_SECONDS = 45


def _now() -> datetime:
    return datetime.now(UTC)


def _due(source: Source, now: datetime) -> bool:
    raw = (source.analysis or {}).get("_worker", {}).get("next_attempt_at")
    if not raw:
        return True
    try:
        due = datetime.fromisoformat(raw)
        if due.tzinfo is None:
            due = due.replace(tzinfo=UTC)
        return due <= now
    except (TypeError, ValueError):
        return True


async def claim_source() -> tuple[str, str] | None:
    now = _now()
    stale_before = now - timedelta(seconds=LEASE_SECONDS)
    async with SessionLocal() as db:
        # A dead process cannot strand work. Row locks skip work another process currently claims.
        stale = list(
            (
                await db.scalars(
                    select(Source)
                    .where(
                        Source.status == "processing",
                        or_(
                            Source.processing_started_at < stale_before,
                            Source.processing_started_at.is_(None),
                        ),
                    )
                    .with_for_update(skip_locked=True)
                    .limit(100)
                )
            ).all()
        )
        for source in stale:
            status = "queued" if source.attempts < MAX_ATTEMPTS else "failed"
            analysis = dict(source.analysis or {})
            analysis["_worker"] = {"next_attempt_at": now.isoformat(), "lease_token": None}
            await db.execute(
                update(Source)
                .where(
                    Source.id == source.id,
                    Source.status == "processing",
                    Source.processing_started_at == source.processing_started_at,
                )
                .values(
                    status=status,
                    error="Processing lease expired; retrying."
                    if status == "queued"
                    else "Processing failed after three attempts (worker lease expired).",
                    analysis=analysis,
                    processing_started_at=None,
                )
            )
        await db.commit()
    async with SessionLocal() as db:
        retry_at = Source.analysis["_worker"]["next_attempt_at"].as_string()
        queued = list(
            (
                await db.scalars(
                    select(Source)
                    .where(Source.status == "queued", or_(retry_at.is_(None), retry_at <= now.isoformat()))
                    .order_by(Source.created_at, Source.id)
                    .with_for_update(skip_locked=True)
                    .limit(100)
                )
            ).all()
        )
        for source in queued:
            if not _due(source, now):
                continue
            if source.attempts >= MAX_ATTEMPTS:
                await db.execute(
                    update(Source)
                    .where(
                        Source.id == source.id, Source.status == "queued", Source.attempts == source.attempts
                    )
                    .values(status="failed", error="Processing failed after three attempts.")
                )
                continue
            token = str(uuid.uuid4())
            analysis = dict(source.analysis or {})
            analysis["_worker"] = {"lease_token": token, "next_attempt_at": None}
            result = await db.execute(
                update(Source)
                .where(Source.id == source.id, Source.status == "queued", Source.attempts == source.attempts)
                .values(
                    status="processing",
                    attempts=source.attempts + 1,
                    processing_started_at=now,
                    error=None,
                    analysis=analysis,
                )
            )
            if result.rowcount == 1:
                await db.commit()
                return source.id, token
        await db.commit()
    return None


async def _heartbeat(source_id: str, token: str):
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        async with SessionLocal() as db:
            source = await db.scalar(select(Source).where(Source.id == source_id).with_for_update())
            if (
                source is None
                or source.status != "processing"
                or (source.analysis or {}).get("_worker", {}).get("lease_token") != token
            ):
                return
            await db.execute(
                update(Source)
                .where(
                    Source.id == source_id,
                    Source.status == "processing",
                    Source.processing_started_at == source.processing_started_at,
                )
                .values(processing_started_at=_now())
            )
            await db.commit()


async def mark_failure(source_id: str, token: str, error: Exception):
    async with SessionLocal() as db:
        source = await db.scalar(select(Source).where(Source.id == source_id).with_for_update())
        if (
            source is None
            or source.status != "processing"
            or (source.analysis or {}).get("_worker", {}).get("lease_token") != token
        ):
            return
        status = "queued" if source.attempts < MAX_ATTEMPTS else "failed"
        analysis = dict(source.analysis or {})
        analysis["_worker"] = {
            "lease_token": None,
            "next_attempt_at": (
                _now() + timedelta(seconds=15 * 2 ** max(0, source.attempts - 1))
            ).isoformat(),
        }
        # Provider errors can contain URLs or credentials. Only known safe messages reach the user.
        from app.services.extraction import ExtractionError
        from app.services.knowledge import IngestionError

        detail = (
            str(error)[:400]
            if isinstance(error, (ExtractionError, IngestionError))
            else "Source processing failed; check provider configuration, connectivity or access."
        )
        if status == "queued":
            detail += f" Retry scheduled ({source.attempts}/{MAX_ATTEMPTS} attempts)."
        result = await db.execute(
            update(Source)
            .where(
                Source.id == source_id,
                Source.status == "processing",
                Source.processing_started_at == source.processing_started_at,
            )
            .values(status=status, error=detail, processing_started_at=None, analysis=analysis)
        )
        if result.rowcount == 1:
            await db.commit()


async def process_one() -> bool:
    claim = await claim_source()
    if claim is None:
        return False
    source_id, token = claim
    heartbeat = asyncio.create_task(_heartbeat(source_id, token))
    try:
        await ingest_source(source_id)
    except LeaseLost:
        logger.info("Discarded ingestion after source lease changed: %s", source_id)
    except asyncio.CancelledError:
        # Preserve processing status. Another worker recovers the expired durable lease.
        raise
    except Exception as exc:
        logger.error("Source ingestion failed: %s (%s)", source_id, type(exc).__name__)
        await mark_failure(source_id, token, exc)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat
    return True


async def run_worker():
    logger.info("Knowledge worker started; polling the durable source queue.")
    while True:
        try:
            worked = await process_one()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.error(
                "Worker queue iteration failed (%s); retrying database connection.", type(error).__name__
            )
            worked = False
        if not worked:
            await asyncio.sleep(max(0.2, settings.worker_poll_seconds))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run_worker())
