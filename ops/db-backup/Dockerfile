# The image behind the zenvend-db-backup Cloud Run job. Built and deployed by
# ops/db-backup/setup.sh; see DEPLOY.md → Database backups.
FROM debian:12-slim

# 100.10+ is needed for MongoDB 8.0. The checksum pins the exact bytes, so a
# re-uploaded .deb fails the build instead of shipping.
ARG TOOLS_VERSION=100.20.0
ARG TOOLS_SHA256=cd9a99eb9c8f327a07a1a5f0f1ea65ba36ce46db420c4f4afd745d2bcccd1b89

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL -o /tmp/tools.deb \
    "https://fastdl.mongodb.org/tools/db/mongodb-database-tools-debian12-x86_64-${TOOLS_VERSION}.deb" \
  && echo "${TOOLS_SHA256}  /tmp/tools.deb" | sha256sum -c - \
  && apt-get install -y --no-install-recommends /tmp/tools.deb \
  && rm /tmp/tools.deb \
  && rm -rf /var/lib/apt/lists/*

COPY backup.sh /usr/local/bin/backup.sh

USER nobody
ENTRYPOINT ["/usr/local/bin/backup.sh"]
