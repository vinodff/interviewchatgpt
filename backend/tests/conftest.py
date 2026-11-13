"""Keep the test suite hermetic.

Tests exercise the process-local coordination backend. A developer's ``.env`` may
point ``REDIS_URL`` at a real Redis, which makes rate-limit counters, leases, and
single-use tickets leak between test runs (registering the same fixture account
twice in five minutes returns 429). The environment is pinned before any app
module builds its settings so the suite behaves the same locally and in CI.
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./data/test-api.db")
os.environ["REDIS_URL"] = "memory://"
os.environ.pop("COORDINATION_BACKEND", None)
