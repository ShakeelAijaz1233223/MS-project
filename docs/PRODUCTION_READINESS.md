# Production Readiness Checklist

This checklist separates code presence from verified runtime behavior. Mark an item **Verified** only when the command or workflow was actually executed and its evidence is available.

## 1. Repository and change safety

- [ ] Review the complete branch diff against `main`.
- [ ] Confirm no user data, credentials, generated media or local environment files are committed.
- [ ] Confirm no unrelated existing feature was removed.
- [ ] Confirm migrations are additive and have a reviewed rollback strategy.
- [ ] Confirm the working tree and release commit are recorded.

## 2. Automated validation

- [ ] Backend dependencies install with `npm ci`.
- [ ] Backend test suite passes.
- [ ] Frontend dependencies install with `npm ci`.
- [ ] Frontend test suite passes.
- [ ] Frontend production build succeeds.
- [ ] CI workflow passes on the proposed branch and pull request.
- [ ] No test was deleted or weakened solely to obtain a passing result.

## 3. MySQL durability

- [ ] Connect to a real MySQL instance using the intended deployment configuration.
- [ ] Apply migrations to a disposable clean database.
- [ ] Apply migrations to a copy of an existing database.
- [ ] Verify schema, indexes, constraints and migration idempotency.
- [ ] Create, read, update and delete disposable test records.
- [ ] Verify transaction rollback behavior.
- [ ] Restart the API and verify committed data persists.
- [ ] Disconnect MySQL and verify fail-closed behavior when durable persistence is required.
- [ ] Restore connectivity and verify recovery.
- [ ] Verify user-to-user data isolation.

A test that skips because MySQL is unavailable is **not** a passing durability test.

## 4. Provider integrations

For each provider, record the official API, required credentials, quota/permission limits, test date and a real response result.

- [ ] YouTube Innertube
- [ ] Internet Archive
- [ ] Wikimedia Commons
- [ ] Dailymotion API
- [ ] YouTube Data API v3
- [ ] Vimeo API
- [ ] Spotify Web API
- [ ] SoundCloud API

Mocks verify adapter logic only. They do not verify live credentials, current provider availability, quotas or terms.

## 5. Media workflows

- [ ] URL validation and platform recognition.
- [ ] Metadata extraction where supported.
- [ ] Capability-aware playback/download decisions.
- [ ] Download job creation and queue updates.
- [ ] Progress, cancellation and retry behavior.
- [ ] File integrity and storage isolation.
- [ ] Search/library/history persistence.
- [ ] HLS and range-request behavior where supported.
- [ ] Unsupported, restricted and DRM-protected sources fail safely.

Only test content that is owned, licensed, public-domain or otherwise authorized. Do not bypass DRM, paywalls or private access controls.

## 6. Security

- [ ] Unique production secrets are required and are not committed.
- [ ] No default administrator credentials remain active in production.
- [ ] Admin and user authorization are checked server-side.
- [ ] Session and cookie settings are production-safe.
- [ ] CORS is restricted to explicitly configured origins.
- [ ] SSRF and redirect protections are tested.
- [ ] File paths and download tickets are validated.
- [ ] SQL injection, XSS and CSRF controls are reviewed.
- [ ] Sensitive tokens and query parameters are redacted from logs.
- [ ] Rate limiting and audit logging are enabled.

## 7. Deployment and recovery

- [ ] Production environment variables are documented.
- [ ] HTTPS and reverse proxy configuration are reviewed.
- [ ] Database backup is created before deployment.
- [ ] Backup restore is tested on a separate database.
- [ ] Health checks report actual database and provider states.
- [ ] Graceful shutdown and restart are tested.
- [ ] Logs do not contain credentials or private media URLs.

## Release decision

Do not label the product **Production Ready** while a critical security issue, destructive migration risk, data-isolation defect, or required durable-persistence failure remains unresolved.

Publish a concise evidence report with exact test commands, totals, skipped tests, environment blockers and provider-by-provider status.
