# UltraDownloader

UltraDownloader is a self-hosted web application for analyzing supported media URLs, searching across configured media providers, managing authorized downloads, and organizing a personal media library.

> **Important:** Platform support is capability-specific. A platform appearing in search or URL analysis does not mean that downloading or playback is available. Use only content you own, have permission to access, or that the source explicitly makes available for the requested use. The application must not bypass DRM, paywalls, private-content controls, or provider restrictions.

## Technology

- **Frontend:** React 18, Vite 6, React Router, TanStack Query, Tailwind CSS, Framer Motion, HLS.js, Recharts.
- **Backend:** Node.js (ES modules), Express 4, MySQL via mysql2, JWT, bcryptjs, TOTP, Zod, Helmet, CORS and rate limiting.
- **Database:** MySQL 8-compatible schema; the supplied SQL scripts are under `backend/database/`.
- **Local development:** frontend on `http://localhost:5173`, API on `http://127.0.0.1:4000`.

## Repository layout

```text
backend/
  database/       SQL schema and reset/import scripts
  src/
    config/       environment configuration
    db/           database connection and persistence
    middleware/   request and security middleware
    routes/       public and administrator API routes
    security/     outbound URL and cryptographic controls
    services/     search, extraction, streaming and download services
frontend/
  src/            React application, pages, components and tests
  public/         static assets and PWA files
  package.json
  vite.config.js
.github/
  workflows/      continuous integration
docs/             operational documentation
```

## Requirements

- Node.js 20 or newer (use the same supported LTS release locally and in deployment).
- npm.
- MySQL 8.x or a compatible MySQL server.
- XAMPP is suitable for local Windows development, but production should use a dedicated database account rather than the XAMPP root account.
- Optional provider credentials are needed for credentialed search integrations.
- Optional media binaries may be required by particular extraction workflows; check the backend's runtime capability report.

## Windows setup (PowerShell)

### 1. Configure MySQL

1. Start MySQL in XAMPP or your MySQL service manager.
2. Create a database named `ultradownloader_db`.
3. Import `backend/database/ultradownloader_xampp.sql` using phpMyAdmin or the MySQL CLI.
4. Do not import `ultradownloader_reset_clean.sql` into a database containing data you need: it is a reset-oriented script.

Example using the MySQL CLI:

```powershell
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS ultradownloader_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql -u root -p ultradownloader_db < backend/database/ultradownloader_xampp.sql
```

### 2. Configure the backend

```powershell
cd backend
Copy-Item .env.example .env
```

Edit `backend/.env` and configure database access, origins, and unique secrets. Never use example or development secrets in production.

Generate independent random secrets with Node.js:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run the command separately for each JWT/ticket/hash secret. Generate a 32-byte hexadecimal vault key with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep `.env` private. Do not commit it or paste its contents into issues or chat.

Install dependencies, provision the first administrator, and start the API:

```powershell
npm ci
npm run admin:bootstrap
npm run dev
```

The bootstrap command creates the first administrator only when `admin_users` is empty. It prompts for a strong password and a separate 8–20 digit PIN without echoing either secret, generates a unique TOTP secret, and prints its authenticator provisioning URI once. Store the TOTP secret securely. It refuses to add another bootstrap super-admin if an administrator already exists.

New SQL imports no longer seed a shared/default administrator. If you are upgrading an older database that already contains the historical default administrator, rotate its password, PIN and TOTP secret before exposing the application; removing the seed from the SQL file does not modify existing database rows.

### 3. Configure the frontend

Open a second PowerShell terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

The Vite development server proxies `/api` to the backend. The backend must be running on the configured API origin.

## Tests and production build

Run commands from each package directory.

Backend:

```powershell
cd backend
npm ci
npm test
```

Frontend:

```powershell
cd frontend
npm ci
npm test
npm run build
```

The frontend production assets are written to `frontend/dist/`.

## Environment and provider configuration

- Backend environment variables are documented in `backend/.env.example`.
- Keep all API credentials on the server.
- A provider must be reported as configured/healthy only after its actual integration succeeds.
- Missing credentials, unavailable network access, provider quotas and region restrictions must be reported explicitly.
- Do not treat mocked tests as proof of live provider availability.

## Operational safety

- Back up the database before schema changes.
- Review migrations before applying them to a database containing user data.
- Never run reset scripts against a database you intend to preserve.
- Set production-only secrets before enabling production mode.
- Use HTTPS, secure cookies, least-privilege database credentials and restricted CORS origins in production.
- Keep downloaded files and vault material outside public static directories.
- Do not expose private media or user history across accounts.

## Current verification policy

A successful build or unit-test run does not by itself prove that MySQL durability, third-party provider access, media extraction, or deployment is working. Report each capability separately as:

- **Verified:** executed successfully in the target environment.
- **Implemented, not live-verified:** code exists, but real external integration was not exercised.
- **Blocked:** an external dependency, credential or environment is unavailable.
- **Not implemented:** the capability is absent.

See `docs/PRODUCTION_READINESS.md` for the verification checklist.
