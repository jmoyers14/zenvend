# Deploying zenvend

Three Cloud Run services on the **personal** Google account, isolated from the
work account via a dedicated gcloud *configuration* (same pattern as landscape).

> **This is production:** `zenvend.app` (web) and `api.zenvend.app` (api),
> against the Clerk production instance (`clerk.zenvend.app`). The `vendpire-*`
> services are the pre-cutover stack on the Clerk dev instance, kept only as a
> rollback until they are deleted; see
> `docs/plans/2026-11-13-zenvend-rename-and-cutover.md`.

- `zenvend-api` — Bun tRPC server (port 8080), mapped to `api.zenvend.app`
- `zenvend-web` — React build served by nginx (port 8080), mapped to `zenvend.app`
- `zenvend-worker` — Clerk webhook ingestion + background jobs (port 8080)

Pinned at the top of `deploy.sh`:

```bash
CONFIG="vendpire"
PROJECT="vendpire-128694"
ACCOUNT="jmoyers14@gmail.com"
REGION="us-central1"
```

## One-time setup (already done)

- gcloud configuration `vendpire` pinned to the personal account + project
- Project `vendpire-128694` created, billing linked
- APIs enabled: Cloud Run, Artifact Registry, Secret Manager
- Cloud Tasks + IAM Credentials are enabled by `deploy.sh` itself, along with
  the three queues and the `cloud-tasks-invoker` service account the worker's
  `/tasks/*` callbacks authenticate as. All idempotent.
- Database backups: `ops/db-backup/setup.sh` (see Database backups below).

## First deploy

Create the four `zenvend-*` secrets first (see Secrets below). `deploy.sh`
creates a missing one only from the environment, never from a local `.env`,
which holds dev values. The publishable key is passed explicitly for the same
reason:

```sh
VITE_CLERK_PUBLISHABLE_KEY=pk_live_... ./deploy.sh
```

## After the first deploy

1. Map the domains: `zenvend.app` → `zenvend-web`, `api.zenvend.app` →
   `zenvend-api` (Cloud Run domain mappings), and add the DNS records they ask
   for. The api's CORS origin and the web bundle's api URL are the domains, so
   nothing works on `*.run.app`.
2. Sanity-check `<api-url>/system.version` and the version footer in the app —
   a commit mismatch means a half-landed deploy.
3. **Point Clerk at the worker.** Dashboard → Webhooks → add an endpoint at
   `<worker-url>/ingest/clerk` (the deploy prints it) and subscribe to:
   `user.created`, `user.updated`, `organization.created`,
   `organization.updated`, `organizationMembership.created`,
   `organizationMembership.updated`, `organizationMembership.deleted`.
   Put the `whsec_…` signing secret in `zenvend-clerk-webhook-signing-secret`,
   then redeploy the worker so a new instance reads it.
   Use "Send test event" and confirm a 2xx in Clerk's delivery log.
4. Confirm the chain end to end: `gcloud run services logs read zenvend-worker`
   should show the ingest line, then the Cloud Tasks callback on `/tasks/…`,
   then `job succeeded`. `curl -X POST <worker-url>/tasks/syncUser -d "{}"`
   must answer **403** — that proves the OIDC guard is closed.

## Continuous deployment

Deploys run from GitHub Actions on the tag `release-please` creates. The full
design, and why all three services ship together rather than only what changed,
is in `docs/plans/2026-10-06-cicd-pipeline.md`.

```
PR ──> ci.yml (lint · typecheck · test · e2e)
   ──> merge to main
   ──> release-please opens a standing release PR
   ──> you merge it  ──> tag vX.Y.Z  ──> deploy.yml  ──> ./deploy.sh
```

Merging the release PR is the only human decision point. `deploy.yml` then runs
this same `deploy.sh`, so there is exactly one deploy path to reason about.

### One-time CI setup

```sh
./scripts/setup-ci-auth.sh
```

Run it locally as project owner. It creates the Workload Identity Federation
pool, provider, and `github-deployer` service account, applies the Artifact
Registry cleanup policy, and sets the two repo variables `deploy.yml` reads. It
is idempotent — re-run it after changing any role.

No service account key is ever created. GitHub mints a short-lived OIDC token
that GCP trades for ~1h credentials, and the provider's attribute condition pins
it to `jmoyers14/zenvend`, so no other repository can use it.

### GitHub secrets

Run `./scripts/set-github-secrets.sh`. It pipes what it can out of your local
`.env` files straight into `gh secret set` over stdin — values are never
printed, never passed as argv, never written to a temp file — and prompts for
the e2e test user, which lives in no local file.

It deliberately **skips** rather than sets empty for anything missing. An empty
GitHub secret is worse than an absent one: the workflow injects `""`, and
consuming code sees a present-but-blank variable. That is precisely what broke
the e2e job — `fixtures.ts` used `??`, which does not treat `""` as missing.

**Deploy secrets are scoped to the GitHub environment `production`**, not the
repository; e2e secrets stay repository-level. Repository secrets are inherited
by every environment, so a missing deploy override would silently ship the e2e
(dev) values. Scoped, it arrives as `""` and `deploy.sh` refuses to start.

The deploy publishable key never comes from `.env.local` (the dev key): pass it
as `DEPLOY_CLERK_PUBLISHABLE_KEY=pk_live_... ./scripts/set-github-secrets.sh`.

The e2e secrets stay repository-level because `ci.yml`'s e2e job declares no
`environment:`, and a job without one cannot read environment secrets at all.

| Secret | Used by | Scope | Sensitive? |
|---|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | deploy | env `production` | No — `pk_` is public |
| `POSTHOG_API_KEY`, `POSTHOG_HOST` | deploy | env `production` | No — write-only ingestion |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | deploy | env `production` | No |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | e2e — Clerk **dev** instance | repository | Yes, dev only |
| `E2E_CLERK_USER_EMAIL`, `E2E_CLERK_USER_PASSWORD` | e2e test user | repository | Yes, dev only |

No production secrets live in GitHub. The Atlas URI, the production Clerk `sk_`,
and the webhook signing secret stay in Secret Manager.

**On PostHog:** `deploy.sh` treats these as optional and ships without analytics
if they are missing. As of 2026-10-18 they are configured nowhere — not in
`packages/api/.env`, not in `packages/web/.env.local`, not on the deployed api
(whose env is ENVIRONMENT, WEB_URL, CLERK_SECRET_KEY, MONGODB_URI,
GOOGLE_MAPS_API_KEY), and no `phc_` key appears in the live web bundle. So there
is nothing for CI to lose here; analytics has simply never been wired. If you do
configure it, add it to BOTH the local `.env` and the GitHub secret, or laptop
and CI deploys will disagree.

### Remaining manual steps

- Branch-protect `main`, requiring the `check` and `e2e` status checks. A
  workflow file cannot do this; it is a repository setting.
- Actions settings → require approval for all external contributors. The repo is
  public, so anyone can open a PR.

### Deploying by hand

`deploy.sh` still works unchanged from your laptop — the CI branch only skips
the gcloud-configuration guard, which has no meaning on a runner. To re-deploy
an existing tag without a new release, use the `deploy` workflow's
`workflow_dispatch` with a `ref`.

## Adding a new configuration value

Which path depends on **when the value is needed**, not on how sensitive it is.
`zenvend-web` is static files served by nginx — there is no server process to
read an env var — so anything the browser needs must be compiled into the bundle
at build time, and therefore can never be secret.

### A. Backend secret (sensitive, read at runtime)

1. `deploy.sh` — add a `*_SECRET_NAME` constant alongside the others.
2. `deploy.sh` — `ensure_secret "$NEW_SECRET_NAME" NEW_ENV_VAR`. Creates it on
   first run and grants the runtime service account access. Idempotent after.
3. `deploy.sh` — append to `API_SECRETS` (or the worker's `--set-secrets`).
4. Code — a zod config slice modelled on
   `packages/platform/src/integrations/auth/clerkConfig.ts`, registered in the
   container.
5. `packages/api/.env` (or `packages/worker/.env`) for local dev.
6. First deploy only: `NEW_ENV_VAR="..." ./deploy.sh`. Afterwards plain
   `./deploy.sh` — the value lives in Secret Manager.

### B. Frontend value (build time, public by definition)

Seven places. Miss any and it fails silently.

1. `packages/web/Dockerfile` — `ARG VITE_FOO` + `ENV VITE_FOO=$VITE_FOO`,
   **above** `RUN bun run --cwd packages/web build`.
2. `deploy.sh` — read it env-first with a `.env.local` fallback, matching
   `CLERK_PUBLISHABLE_KEY`.
3. `deploy.sh` — `--build-arg VITE_FOO="$FOO"` on the web `docker build`.
4. `packages/web/src/vite-env.d.ts` — add the field to `ImportMetaEnv`.
5. `gh secret set VITE_FOO --repo jmoyers14/zenvend`.
6. `.github/workflows/deploy.yml` — add to the Deploy step's `env:` block.
7. `packages/web/.env.local` for local dev.

Step 6 is the one that gets forgotten: set locally, absent in CI, and the
deployed bundle quietly ships without it.

### C. Backend non-secret (runtime)

Add it to the service's `--set-env-vars`, add a zod slice, add it to the local
`.env`, redeploy.

Note the two styles already in `deploy.sh`: the API passes one comma-joined
string, the worker repeats the flag. Both work. What matters is `--set-env-vars`
**replaces** the whole env block while `--update-env-vars` merges — which is why
the `WORKER_URL` correction uses the latter.

### Why backend mistakes are cheaper than frontend ones

`parseConfig` exits the process on a schema violation, so a missing required
backend value kills the container at startup and Cloud Run refuses to serve the
revision. You find out at once.

A missing `VITE_*` is just `undefined` in the bundle — no error, no crash, the
feature silently does nothing. Prefer required zod fields on the backend, and
treat the frontend checklist above as the real safeguard.

## Rollback

Cloud Run retains revisions, so rolling back is traffic-shifting — no rebuild,
no new image:

```sh
gcloud run revisions list --service zenvend-api --region us-central1
gcloud run services update-traffic zenvend-api \
  --to-revisions=<prior-revision>=100 --region us-central1
```

**Roll back all three services together.** They ship as one version, so a
partial rollback recreates exactly the skew the single-version design exists to
avoid. Repeat for `zenvend-web` and `zenvend-worker`.

This works even after the Artifact Registry cleanup policy has pruned an old
image: revisions are retained independently of image tags.

Then confirm `<api-url>/system.version` and the app footer agree on the version
you rolled back to. A mismatch between services means the rollback is half-done.

## Secrets (Secret Manager)

| Secret Manager name | Contents |
|---|---|
| `zenvend-clerk-secret-key` | Clerk `sk_live_...` (production instance) |
| `zenvend-mongodb-uri` | Atlas connection string, database `zenvend` |
| `zenvend-mongodb-backup-uri` | Atlas connection string for the read-only `db-backup` user (backup job only) |
| `zenvend-google-maps-api-key` | Places key (optional — address autocomplete) |
| `zenvend-clerk-webhook-signing-secret` | Clerk `whsec_...` for the production instance's endpoint |

The unprefixed names (`clerk-secret-key`, `mongodb-uri`, …) belong to the old
`vendpire-*` stack. Never reuse them: an instance resolves `:latest` when it
starts, so writing a production value there would leak into the old stack at its
next cold start.

To rotate one: `gcloud secrets versions add <name> --data-file=-`, then
redeploy.

**When the value is actually read:** not at deploy time. `--set-secrets` only
records a *reference* (`CLERK_SECRET_KEY=zenvend-clerk-secret-key:latest`) on the
revision. Cloud Run resolves it at **instance startup**, via the runtime service
account — if retrieval fails the instance does not start. The deploy pipeline
never handles these values; `github-deployer` wires up the pointer and grants
access, and the runtime SA does the reading.

That means rotation has a window: instances already warm keep the old value until
they are replaced, and because services scale to zero a rotated `:latest` can get
picked up by the next cold start with no redeploy at all. Redeploy to make the
cutover deterministic rather than whenever an instance happens to recycle.

Google recommends pinning a version rather than `:latest` for environment-variable
secrets, for exactly this reason. All four here use `:latest` — a known gap, not
an oversight.

## The iOS support floor

Plain env vars on the **api** — not secrets. They decide which iOS builds are
still served. The app never learns these numbers; it reports its own
`CFBundleVersion` and obeys the verdict, which is what lets the floor move
without shipping an app. Mechanism: `docs/diagrams/forced-update.md`.

| Env var | Default | Effect |
|---|---|---|
| `IOS_MINIMUM_BUILD` | `0` | Builds below this get a non-dismissible update wall, and `426` on every write |
| `IOS_RECOMMENDED_BUILD` | `0` | Builds below this get a dismissible nudge |
| `IOS_UPDATE_URL` | App Store listing | Where the wall sends people — repoint at TestFlight without a release |

The numbers are App Store Connect build numbers, `YYDDDHHMM` in UTC (for
example `263291940`), as `ios:testflight` and `ios:install-production` stamp
them. Copy the value from App Store Connect rather than working it out.

**Both default to `0`, which supports every build.** Leave them unset and the
whole mechanism is inert. Raising either one is a deliberate act and takes only
an api redeploy.

### Raising the floor without stranding anyone

Never raise `IOS_MINIMUM_BUILD` first. The order exists because the users it
targets are exactly the ones who don't install updates.

1. Ship the new build (say, 50) to the App Store.
2. Set `IOS_RECOMMENDED_BUILD=50` and redeploy. Older builds now get a
   dismissible nudge — nobody is blocked.
3. **Watch the `stale_client.detected` count in PostHog fall.** Filter on the
   `build` property. This is the only thing that tells you how many users a
   bump would strand.
4. Once it's near zero, set `IOS_MINIMUM_BUILD=50` and redeploy. Stragglers get
   the wall.

No app release happens in steps 2–4. `IOS_UPDATE_URL` must point somewhere real
before step 4, or the wall has nowhere to send people.

Verify after a change — the endpoint is public, so this needs no token:

```sh
curl -G <api-url>/system.clientSupport \
  --data-urlencode 'input={"platform":"ios","build":42}'
# -> {"result":{"data":{"updateRequirement":"required","updateUrl":"..."}}}
```

To check the backstop, send the header at a normal route and expect **426**:

```sh
curl -i -X POST <api-url>/visits.create \
  -H 'x-zenvend-client: ios/42' -H 'content-type: application/json' -d '{}'
```

A build at or above the floor gets `401` there instead — it cleared the gate
and fell through to auth, which is the correct outcome.

## Database backups

Atlas is on the free M0 tier, which has no Atlas backups. These are the only
ones.

| | |
|---|---|
| What | `mongodump --gzip` of database `zenvend`, one archive per run |
| Where | `gs://vendpire-128694-db-backups/daily/zenvend-<UTC stamp>.archive.gz` |
| When | 03:00 America/Los_Angeles, daily (Cloud Scheduler `zenvend-db-backup-daily`) |
| Retention | 30 days; a lifecycle rule scoped to `daily/` deletes older ones |
| Runs as | Cloud Run job `zenvend-db-backup`, service account `db-backup` |
| Alerts | Email on a failed run, and on no successful run in 25 hours |

`ops/db-backup/setup.sh` creates all of it and is safe to re-run. Re-run
it after changing `ops/db-backup/`, the schedule, or the retention. It
connects as `db-backup`, an Atlas user with only `readAnyDatabase` (M0 has no
per-database roles), whose URI is in `zenvend-mongodb-backup-uri`. To point
the job at another secret, re-run with `BACKUP_URI_SECRET=<name>`, then remove
the `db-backup` service account's binding from the old secret.

The `db-backup` account can create objects in the bucket but not delete or
overwrite them, so a compromised job cannot erase the history. Only the
lifecycle rule deletes, and only under `daily/`; anything stored under another
prefix (for example `archive/`) is kept until you delete it.

`archive/` holds the retired pre-cutover `vendpire` database, which has had no
writes since 2026-11-14:

| Object | Form |
|---|---|
| `archive/vendpire-20261125T004706Z.archive.gz` | `mongodump` archive (13 collections, 258 documents); restore it like a daily one, with `--nsFrom 'vendpire.*'` |
| `archive/vendpire-db-20261115-075324-ejson.tar.gz` | The EJSON export taken just before the cutover |

### Run a backup by hand

```sh
gcloud run jobs execute zenvend-db-backup --region us-central1 --wait
gcloud storage ls gs://vendpire-128694-db-backups/daily/ | tail -3
```

The job's log lists every collection with its document count (`done dumping
zenvend.visits (28 documents)`). That is what a restore is checked against:

```sh
gcloud run jobs executions list --job zenvend-db-backup --region us-central1
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="zenvend-db-backup"' \
  --limit 50 --format 'value(textPayload)'
```

### Restore

**Always restore into a new, empty database first, never over production.**
Inspect it, then decide.

```sh
gcloud storage cp gs://vendpire-128694-db-backups/daily/zenvend-<stamp>.archive.gz .
mongorestore --uri mongodb://localhost:27017 \
  --archive=zenvend-<stamp>.archive.gz --gzip \
  --nsFrom 'zenvend.*' --nsTo 'zenvend_restore.*'
```

`mongorestore` must be 100.10 or newer to work with MongoDB 8.0 (`brew upgrade
mongodb-database-tools`). Or use the backup image, which pins 100.20.0:

```sh
docker run --rm -v "$PWD":/backup --entrypoint mongorestore \
  us-central1-docker.pkg.dev/vendpire-128694/vendpire/db-backup:latest \
  --uri mongodb://host.docker.internal:27017 \
  --archive=/backup/zenvend-<stamp>.archive.gz --gzip \
  --nsFrom 'zenvend.*' --nsTo 'zenvend_restore.*'
```

Check the restore: every collection's `countDocuments()` should match the
`done dumping` counts in that run's log.

**If production is lost:** restore into a new Atlas cluster (or a new database
on the existing one) using the same `--nsFrom`/`--nsTo` mapping. Check the
counts, then add a new version of `zenvend-mongodb-uri` pointing at it and
redeploy all three services. Writes made after the backup's timestamp are gone;
the stamp in the file name is when it was taken.

## Notes

- Images are tagged `:latest` *and* `:<git-sha>`; the deploy refuses nothing on
  a dirty tree but stamps `-dirty` so it's visible in the footer.
- PostHog keys are optional; the deploy prints whether analytics is wired.
- The e2e suite is not part of `deploy.sh` — `ci.yml` runs it on every PR
  instead. Run `bun run test:e2e` locally before a hand deploy that skipped CI.
- The worker image deliberately **runs from TypeScript source**, not a bundle:
  `@google-cloud/tasks` loads JSON config via a runtime `require` that
  `bun build` doesn't emit. That's why the worker has no `build` script.
- The worker is `--allow-unauthenticated` by necessity (Clerk's sender has no
  Google credential, and Cloud Run IAM can't gate one path). Its guards are
  in-app: the svix signature on `/ingest/clerk`, and an OIDC check on
  `/tasks/*`. Do not "tighten" this with IAM — it would break webhooks.
- `WORKER_URL` is both the OIDC audience the queue signs for and the base it
  posts to. On a true first deploy it's a placeholder, corrected immediately
  after with `--update-env-vars` (never `--set-env-vars`, which replaces the
  whole env block).
