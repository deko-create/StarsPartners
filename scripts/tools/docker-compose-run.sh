#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
	docker compose "$@"
	exit 0
fi

if command -v docker-compose >/dev/null 2>&1; then
	docker-compose "$@"
	exit 0
fi

echo "Docker Compose is not available."
echo "Install Docker Compose plugin or docker-compose binary."
exit 1
