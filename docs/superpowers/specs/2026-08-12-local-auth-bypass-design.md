# Local Authentication Bypass Design

## Goal

Make `npm run dev` start a complete local Stackfolio development stack at
`http://127.0.0.1:5173` without requiring GitHub authentication. Preserve the
existing authentication and owner authorization behavior everywhere outside
this explicitly local development path.

## Selected Approach

Use the Vite development server as the local entry point and run its supporting
services from one development command:

1. Azurite provides local Azure Table Storage.
2. Azure Functions runs on port `3001`, matching the existing Vite `/api`
   proxy target.
3. Vite runs on port `5173` and serves the application.
4. The development command injects an explicit local-auth-bypass environment
   flag into the Functions process only.

The Static Web Apps emulator remains available through the Codex `Full App`
action on port `4280`. It continues to exercise the production-like route and
authentication behavior rather than inheriting the bypass.

## Alternatives Considered

### Separate anonymous Static Web Apps configuration

An additional SWA routing file could make all emulator routes anonymous. This
would preserve port `4280`, but it would duplicate production routing rules and
could silently drift from `public/staticwebapp.config.json`.

### Mock GitHub principal

The local stack could synthesize an `x-ms-client-principal` value. This offers
more protocol fidelity but adds a mock-identity layer when the requested result
is simply a local development bypass.

The selected Vite approach has the smallest configuration surface and directly
fixes the current `npm run dev` workflow.

## Authorization Boundary

The API will treat a request as locally authorized only when all of these
conditions are true:

- `STACKFOLIO_LOCAL_AUTH_BYPASS` is exactly `true`.
- The request URL host is a loopback host: `localhost`, `127.0.0.1`, or `::1`.
- The Azure Functions `WEBSITE_SITE_NAME` environment marker is absent.

Otherwise, the existing GitHub identity comparison against
`STACKFOLIO_ALLOWED_GITHUB_USER` remains mandatory. This includes remote URLs,
Azure deployments, missing or differently-cased bypass values, and local
commands that do not inject the bypass flag.

Both authorization sites use the same decision:

- `/api/session` reports `owner: true` for an eligible local request.
- Every protected API handler accepts the eligible local request without a
  principal and retains the existing `403` response for unauthorized requests.

## Development Command

The root package scripts will distinguish the full local workflow from the
frontend child process:

- `npm run dev` starts and supervises Azurite, Functions, and Vite.
- `npm run dev:frontend` starts only Vite and is used internally by the
  supervisor.

The supervisor will:

- Ensure `api/local.settings.json` exists by copying the tracked example when
  needed.
- Store Azurite data and logs below the already ignored `.azure/` directory.
- Inject the local bypass flag only into the child Functions process.
- Forward output from every child process.
- Stop all child processes when one exits unexpectedly or the user presses
  `Ctrl+C`, avoiding orphaned local services.
- Report a clear failure if the globally installed `func` command is missing.

The Codex `Frontend` action will continue to invoke `npm run dev`, which now
means the complete bypass-enabled local workflow. The `Full App` action remains
unchanged for production-like auth checks.

## Testing

Implementation follows test-driven development.

Authorization tests will prove:

- The bypass accepts an unauthenticated loopback request when explicitly
  enabled outside Azure.
- The bypass rejects public or malformed request URLs.
- The bypass rejects requests when the flag is absent or not exactly `true`.
- The bypass rejects requests when `WEBSITE_SITE_NAME` is present, even for a
  loopback URL and enabled flag.
- Existing allowed and disallowed GitHub identity behavior remains unchanged.

After unit tests pass, the complete quality gate is:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Runtime verification will start `npm run dev`, then confirm:

- `http://127.0.0.1:5173/api/healthz` returns HTTP 200.
- `http://127.0.0.1:5173/api/session` returns `{"owner":true}` without a
  principal.
- The root page renders the Stackfolio application instead of redirecting to
  login or access denied.
- A protected data endpoint succeeds through the Vite proxy and local storage.
- The browser has no relevant framework overlay or console error.

The production-like `Full App` flow will also be smoke-tested to confirm its
root route still redirects an unauthenticated request to `/login`.

## Non-Goals

- Removing or weakening Azure Static Web Apps authentication.
- Changing the authorized GitHub owner.
- Supporting remote-network bypasses, even on private LAN addresses.
- Adding a local identity picker or role simulator.
- Committing `api/local.settings.json`, storage data, logs, or generated build
  artifacts.
