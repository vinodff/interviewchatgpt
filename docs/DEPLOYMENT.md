# Deploy with Docker and HTTPS

Use a Linux VM or container host with Docker Compose, a public domain, and ports 80/443 reachable. A 4GB host is a reasonable initial allocation; measure and scale based on actual load. PostgreSQL, Redis, and file storage are private services, not public ports.

1. Copy `.env.example` to the root `.env`. Set the domain, HTTPS `PUBLIC_URL`, exact `ALLOWED_ORIGINS`, `COOKIE_SECURE=true`, URL-safe database/Redis passwords, backend Gemini key, and a persistent Fernet `ENCRYPTION_KEY`. Generate passwords with `secrets.token_hex(32)` and encryption key with `Fernet.generate_key()`. Store the encryption key separately from backups; losing it makes uploaded files unreadable.
2. Configure Stripe and optional SMTP/GitHub OAuth. Create one recurring Stripe price and set its ID. Configure billing portal cancellation and payment method updates in Stripe. Subscribe the signed webhook endpoint `https://DOMAIN/api/billing/webhook` to `checkout.session.completed` and `customer.subscription.created/updated/deleted`. Keep webhook secrets distinct from API secrets.
3. Point DNS at the host. Run `docker compose config` to validate settings, then `docker compose up --build -d`. The migration container must finish successfully before API/worker startup. Caddy obtains and renews TLS certificates.
4. Verify the HTTPS UI and `/api/health`. Run provider check from the authenticated app, ingest a labeled test document, and verify an authorized live audio session. Exercise Stripe test-mode subscription purchase, renewal, delinquency, cancellation, duplicate webhook delivery, and portal flows before changing to live-mode credentials.

The backend refuses production startup without PostgreSQL, Redis, HTTPS origins, secure cookies, encryption, and Gemini secrets. Images run application processes as non-root users. The backend health check uses an allowed internal Host header. Public requests pass through Caddy's actual body size cap and the application's streaming byte cap. WebSocket query tickets are excluded from Uvicorn access logs.

## Upgrade, backup, and recovery

- Back up PostgreSQL, the encrypted uploads volume, and the encryption key. Confirm a restore into a separate environment before relying on backups. Redis coordination is deliberately ephemeral; reconnect after Redis restarts may require session restart.
- Build from locked dependencies and apply `alembic upgrade head`. For changes after the initial release, add explicit migration revisions; do not modify historical schema definitions. Review destructive migrations before applying them to customer data.
- Roll back application images to the previous compatible build. Database rollback is safe only when the revision explicitly supports it; restore a backup for destructive incompatible changes.
- Run `docker compose logs --tail=100 backend worker` for operational errors. Logs omit document bodies, passwords, provider key values, and raw audio. Never enable verbose HTTP/WebSocket logging with query credentials in production.

Cloud-specific account provisioning, DNS access, and live Stripe configuration are external setup. This workspace includes deployment configuration; it has not been deployed to a public cloud account.
