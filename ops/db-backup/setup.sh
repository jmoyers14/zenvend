#!/bin/bash
#
# Daily production database backups: a Cloud Run job runs mongodump against
# Atlas and writes the archive to GCS, on a Cloud Scheduler trigger.
#
# Run this LOCALLY, as project owner. It is idempotent: re-run it after changing
# anything below, or to ship a new backup image.
#
# What it creates:
#   1. A bucket whose daily/ prefix expires after $RETENTION_DAYS days.
#   2. Two service accounts: one the job runs as, one the scheduler starts it as.
#   3. The db-backup image and the $JOB Cloud Run job.
#   4. A daily Cloud Scheduler trigger.
#   5. One backup run, then two email alerts: a failed run, and no successful
#      run in 25 hours.
#
# Usage:
#   ./ops/db-backup/setup.sh
#   BACKUP_URI_SECRET=<other-secret> ./ops/db-backup/setup.sh
set -euo pipefail

export CLOUDSDK_CORE_DISABLE_PROMPTS=1

cd "$(dirname "$0")/../.."

# Mirrors deploy.sh — keep these in sync.
CONFIG="vendpire"
PROJECT="vendpire-128694"
ACCOUNT="jmoyers14@gmail.com"
REGION="us-central1"
REPO="vendpire"
REGISTRY="$REGION-docker.pkg.dev/$PROJECT/$REPO"

# The read-only db-backup Atlas user, not the app's read-write one.
BACKUP_URI_SECRET="${BACKUP_URI_SECRET:-zenvend-mongodb-backup-uri}"
DATABASE="zenvend"
BUCKET="${PROJECT}-db-backups"
RETENTION_DAYS=30
JOB="zenvend-db-backup"
SCHEDULE="0 3 * * *"
TIME_ZONE="America/Los_Angeles"
ALERT_EMAIL="${ALERT_EMAIL:-$ACCOUNT}"

RUNNER="db-backup"
RUNNER_SA="${RUNNER}@${PROJECT}.iam.gserviceaccount.com"
SCHEDULER="db-backup-scheduler"
SCHEDULER_SA="${SCHEDULER}@${PROJECT}.iam.gserviceaccount.com"
SCHEDULER_JOB="${JOB}-daily"
CHANNEL_NAME="zenvend backups email"
FAILED_POLICY_NAME="zenvend DB backup failed"
MISSING_POLICY_NAME="zenvend DB backup missing"

# ── Same guard as deploy.sh: never touch a work project ──────────────────────
echo "Activating gcloud configuration: $CONFIG"
gcloud config configurations activate "$CONFIG" >/dev/null
ACTIVE_ACCOUNT=$(gcloud config get-value account 2>/dev/null)
ACTIVE_PROJECT=$(gcloud config get-value project 2>/dev/null)
if [ "$ACTIVE_ACCOUNT" != "$ACCOUNT" ] || [ "$ACTIVE_PROJECT" != "$PROJECT" ]; then
  echo "ERROR: Active account/project does not match the personal target." >&2
  echo "  expected: $ACCOUNT / $PROJECT" >&2
  echo "  active:   $ACTIVE_ACCOUNT / $ACTIVE_PROJECT" >&2
  exit 1
fi
echo "Setting up database backups as $ACTIVE_ACCOUNT on $ACTIVE_PROJECT"

if ! gcloud secrets describe "$BACKUP_URI_SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "ERROR: secret $BACKUP_URI_SECRET does not exist in $PROJECT." >&2
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Same eventual-consistency workaround as setup-ci-auth.sh: a just-created
# service account can take a few seconds to become bindable.
retryBinding() {
  local description="$1"
  shift
  local attempt
  for attempt in 1 2 3 4 5 6; do
    if "$@" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$attempt" = "6" ]; then
      echo "ERROR: $description did not succeed after 6 attempts." >&2
      echo "Re-run this script — it is idempotent and will resume." >&2
      return 1
    fi
    echo "    not visible yet; retrying ($attempt/6)..."
    sleep 5
  done
}

ensureServiceAccount() {
  local account_id="$1" email="$2" display_name="$3"
  if gcloud iam service-accounts describe "$email" --project "$PROJECT" >/dev/null 2>&1; then
    echo "Service account $email already exists."
    return 0
  fi
  echo "Creating service account: $email"
  gcloud iam service-accounts create "$account_id" \
    --project "$PROJECT" --display-name "$display_name" >/dev/null
}

# ── APIs ─────────────────────────────────────────────────────────────────────
echo "Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  monitoring.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  --project "$PROJECT" --quiet >/dev/null

# ── Bucket ───────────────────────────────────────────────────────────────────
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  echo "Creating bucket: gs://$BUCKET"
  gcloud storage buckets create "gs://$BUCKET" \
    --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention >/dev/null
else
  echo "Bucket gs://$BUCKET already exists."
fi

# Scoped to daily/ so anything kept under another prefix (an archive/ of the
# old vendpire database, say) never expires.
cat > "$WORK_DIR/lifecycle.json" <<JSON
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": ${RETENTION_DAYS}, "matchesPrefix": ["daily/"] }
    }
  ]
}
JSON
echo "Applying lifecycle rule: delete daily/ after $RETENTION_DAYS days..."
gcloud storage buckets update "gs://$BUCKET" \
  --project "$PROJECT" --lifecycle-file "$WORK_DIR/lifecycle.json" >/dev/null

# ── Service accounts ─────────────────────────────────────────────────────────
ensureServiceAccount "$RUNNER" "$RUNNER_SA" "zenvend database backup job"
ensureServiceAccount "$SCHEDULER" "$SCHEDULER_SA" "zenvend database backup trigger"

# objectCreator, not objectAdmin: the job can add backups but never delete or
# overwrite one, so a compromised job cannot wipe the history.
echo "Granting $RUNNER_SA read on $BACKUP_URI_SECRET and create on the bucket..."
retryBinding "granting secret access" \
  gcloud secrets add-iam-policy-binding "$BACKUP_URI_SECRET" \
    --project "$PROJECT" \
    --member "serviceAccount:$RUNNER_SA" \
    --role roles/secretmanager.secretAccessor --quiet
retryBinding "granting bucket access" \
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
    --project "$PROJECT" \
    --member "serviceAccount:$RUNNER_SA" \
    --role roles/storage.objectCreator

# ── Image ────────────────────────────────────────────────────────────────────
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
if [ -n "$(git status --porcelain -- ops/db-backup 2>/dev/null)" ]; then
  GIT_SHA="$GIT_SHA-dirty"
fi
IMAGE="$REGISTRY/db-backup:$GIT_SHA"

echo "Building backup image: $IMAGE"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet >/dev/null
docker build --platform linux/amd64 \
  -t "$IMAGE" -t "$REGISTRY/db-backup:latest" \
  ops/db-backup
docker push "$IMAGE"
docker push "$REGISTRY/db-backup:latest"

# ── Cloud Run job ────────────────────────────────────────────────────────────
echo "Deploying Cloud Run job: $JOB"
gcloud run jobs deploy "$JOB" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$RUNNER_SA" \
  --set-secrets "MONGODB_URI=$BACKUP_URI_SECRET:latest" \
  --set-env-vars "BACKUP_BUCKET=$BUCKET,BACKUP_DATABASE=$DATABASE" \
  --tasks 1 --max-retries 1 --task-timeout 10m \
  --cpu 1 --memory 512Mi >/dev/null

retryBinding "granting the scheduler permission to start $JOB" \
  gcloud run jobs add-iam-policy-binding "$JOB" \
    --project "$PROJECT" --region "$REGION" \
    --member "serviceAccount:$SCHEDULER_SA" \
    --role roles/run.invoker

# ── Scheduler ────────────────────────────────────────────────────────────────
SCHEDULER_ARGS=(
  --project "$PROJECT" --location "$REGION"
  --schedule "$SCHEDULE" --time-zone "$TIME_ZONE"
  --uri "https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs/$JOB:run"
  --http-method POST
  --oauth-service-account-email "$SCHEDULER_SA"
)
if gcloud scheduler jobs describe "$SCHEDULER_JOB" \
    --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  echo "Updating scheduler job: $SCHEDULER_JOB ($SCHEDULE $TIME_ZONE)"
  gcloud scheduler jobs update http "$SCHEDULER_JOB" "${SCHEDULER_ARGS[@]}" >/dev/null
else
  echo "Creating scheduler job: $SCHEDULER_JOB ($SCHEDULE $TIME_ZONE)"
  gcloud scheduler jobs create http "$SCHEDULER_JOB" "${SCHEDULER_ARGS[@]}" >/dev/null
fi

# ── First backup ─────────────────────────────────────────────────────────────
# Runs before the alerts exist: the missing-backup alert would fire the moment
# it is created if no successful run had ever been recorded.
echo "Running one backup now..."
gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait

# ── Alerts ───────────────────────────────────────────────────────────────────
CHANNEL=$(gcloud beta monitoring channels list --project "$PROJECT" \
  --filter "displayName=\"$CHANNEL_NAME\"" --format "value(name)" | head -1)
if [ -z "$CHANNEL" ]; then
  echo "Creating email notification channel for $ALERT_EMAIL"
  CHANNEL=$(gcloud beta monitoring channels create --project "$PROJECT" \
    --display-name "$CHANNEL_NAME" --type email \
    --channel-labels "email_address=$ALERT_EMAIL" --format "value(name)")
else
  echo "Notification channel already exists."
fi

applyPolicy() {
  local display_name="$1" policy_file="$2" existing
  existing=$(gcloud monitoring policies list --project "$PROJECT" \
    --filter "displayName=\"$display_name\"" --format "value(name)" | head -1)
  if [ -n "$existing" ]; then
    echo "Updating alert policy: $display_name"
    gcloud monitoring policies update "$existing" \
      --project "$PROJECT" --policy-from-file "$policy_file" >/dev/null
  else
    echo "Creating alert policy: $display_name"
    gcloud monitoring policies create \
      --project "$PROJECT" --policy-from-file "$policy_file" >/dev/null
  fi
}

RUNBOOK="See DEPLOY.md → Database backups. Executions: gcloud run jobs executions list --job $JOB --region $REGION"

cat > "$WORK_DIR/failed-policy.json" <<JSON
{
  "displayName": "$FAILED_POLICY_NAME",
  "documentation": { "content": "The $JOB Cloud Run job failed. $RUNBOOK", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "$JOB execution failed",
      "conditionThreshold": {
        "filter": "resource.type = \"cloud_run_job\" AND resource.labels.job_name = \"$JOB\" AND metric.type = \"run.googleapis.com/job/completed_execution_count\" AND metric.labels.result = \"failed\"",
        "aggregations": [
          { "alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 0,
        "duration": "0s",
        "trigger": { "count": 1 }
      }
    }
  ],
  "alertStrategy": { "autoClose": "86400s" },
  "notificationChannels": ["$CHANNEL"],
  "enabled": true
}
JSON

# Plain metric-absence conditions cap at 23.5 hours, which a daily job would
# trip every evening. PromQL reaches 25 hours, and the 30-minute duration
# absorbs the 25-hour gap on the night the clocks fall back.
cat > "$WORK_DIR/missing-policy.json" <<JSON
{
  "displayName": "$MISSING_POLICY_NAME",
  "documentation": { "content": "No successful $JOB run in 25 hours, so the scheduler may not be firing. $RUNBOOK", "mimeType": "text/markdown" },
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "no successful $JOB run in 25h",
      "conditionPrometheusQueryLanguage": {
        "query": "absent_over_time(run_googleapis_com:job_completed_execution_count{monitored_resource=\"cloud_run_job\",job_name=\"$JOB\",result=\"succeeded\"}[25h])",
        "duration": "1800s",
        "evaluationInterval": "300s"
      }
    }
  ],
  "notificationChannels": ["$CHANNEL"],
  "enabled": true
}
JSON

applyPolicy "$FAILED_POLICY_NAME" "$WORK_DIR/failed-policy.json"
applyPolicy "$MISSING_POLICY_NAME" "$WORK_DIR/missing-policy.json"

echo ""
echo "Done. Backups land in gs://$BUCKET/daily/ at $SCHEDULE ($TIME_ZONE),"
echo "and are deleted after $RETENTION_DAYS days. Latest:"
gcloud storage ls "gs://$BUCKET/daily/" --project "$PROJECT" | tail -1
