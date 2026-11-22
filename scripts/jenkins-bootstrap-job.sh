#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container_name="starspartners-jenkins"
job_name="StarsPartners-QA"
job_dir="/var/jenkins_home/jobs/$job_name"
job_config="$project_root/docker/jenkins/job-config.xml"

if ! docker inspect "$container_name" >/dev/null 2>&1; then
  echo "Jenkins container is not running. Run: npm run jenkins:start" >&2
  exit 1
fi

docker exec "$container_name" mkdir -p "$job_dir"
docker cp "$job_config" "$container_name:$job_dir/config.xml"
docker exec "$container_name" chown -R jenkins:jenkins "$job_dir"
docker restart "$container_name" >/dev/null

echo "Created Jenkins job: $job_name"
echo "Open: http://localhost:8080/job/$job_name/"
