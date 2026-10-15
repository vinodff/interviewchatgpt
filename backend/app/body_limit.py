from fastapi import HTTPException

from app.config import settings


class BodyLimitMiddleware:
    """Bound actual ASGI bytes before multipart spooling, including chunked requests."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = settings.max_upload_bytes + 1024 * 1024 if scope.get("path") == "/api/sources/upload" else 1024 * 1024
        total = 0
        exceeded = False

        async def bounded_receive():
            nonlocal total, exceeded
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body", b""))
                if total > limit:
                    exceeded = True
                    raise HTTPException(413, "Request exceeds the allowed size")
            return message

        async def bounded_send(message):
            # Multipart parsers may translate the receive exception into 400. Preserve 413.
            if exceeded and message["type"] == "http.response.start":
                message = {**message, "status": 413, "headers": [(b"content-type", b"application/json"), (b"connection", b"close")]}
            elif exceeded and message["type"] == "http.response.body":
                message = {**message, "body": b'{"detail":"Request exceeds the allowed size"}', "more_body": False}
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)
