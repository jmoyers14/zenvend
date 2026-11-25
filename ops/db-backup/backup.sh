#!/bin/bash
#
# Dumps one database to a gzipped mongodump archive and uploads it to
# gs://$BACKUP_BUCKET/daily/. Runs as the zenvend-db-backup Cloud Run job.
#
# Env:
#   MONGODB_URI      injected from Secret Manager by the job, never logged
#   BACKUP_BUCKET    bucket name, without gs://
#   BACKUP_DATABASE  database to dump (default: zenvend)
set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is not set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
database="${BACKUP_DATABASE:-zenvend}"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
object_name="daily/${database}-${timestamp}.archive.gz"
archive_path=$(mktemp)
trap 'rm -f "$archive_path"' EXIT

# Dump to a file first so a failed dump never uploads a truncated archive.
# mongodump logs one "done dumping <ns> (N documents)" line per collection,
# which is what a restore is checked against.
echo "Dumping database $database..."
mongodump --uri="$MONGODB_URI" --db="$database" --archive="$archive_path" --gzip

archive_bytes=$(stat -c %s "$archive_path")
if [ "$archive_bytes" -eq 0 ]; then
  echo "ERROR: mongodump produced an empty archive." >&2
  exit 1
fi

# The job's service account has only storage.objectCreator, so this uploads
# with a metadata-server token instead of pulling gcloud into the image.
access_token=$(curl -fsS -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token" \
  | sed -E 's/.*"access_token":"([^"]+)".*/\1/')

encoded_name=${object_name//\//%2F}
echo "Uploading $archive_bytes bytes to gs://$BACKUP_BUCKET/$object_name..."
# ifGenerationMatch=0 refuses to replace an object that already exists.
curl -fsS -o /dev/null -X POST \
  -H "Authorization: Bearer $access_token" \
  -H "Content-Type: application/gzip" \
  --data-binary @"$archive_path" \
  "https://storage.googleapis.com/upload/storage/v1/b/${BACKUP_BUCKET}/o?uploadType=media&ifGenerationMatch=0&name=${encoded_name}"

echo "Backup complete: gs://$BACKUP_BUCKET/$object_name"
