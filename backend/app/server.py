"""Container API entrypoint; local no-login testing is never served publicly."""

import uvicorn

from app.config import settings


def server_config() -> uvicorn.Config:
    if settings.local_test_mode:
        raise RuntimeError("LOCAL_TEST_MODE is forbidden in containers. Use python -m scripts.run_local on the local computer")
    return uvicorn.Config("app.main:app", host="0.0.0.0", port=8000,
                          proxy_headers=True, forwarded_allow_ips="*",
                          access_log=False, log_level="warning")


if __name__ == "__main__":
    uvicorn.Server(server_config()).run()
