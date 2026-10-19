#!/usr/bin/env bash
set -euo pipefail

TARGET_URL="${1:-${BASE_URL:-https://gt.bet/}}"
OUT_DIR="${ZAP_OUT_DIR:-artifacts/zap}"
mkdir -p "${OUT_DIR}"
OUT_DIR_ABS="$(cd "${OUT_DIR}" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
	echo "Docker CLI is not installed."
	echo "Install Docker Desktop (or docker+colima) and rerun."
	exit 1
fi

if ! docker info >/dev/null 2>&1; then
	echo "Docker daemon is not running/reachable."
	echo "Start Docker and rerun."
	exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="zap-baseline-${STAMP}.html"
ZAP_IMAGE="${ZAP_DOCKER_IMAGE:-ghcr.io/zaproxy/zaproxy:stable@sha256:c4da4c234258d444d9988fce9d034b00323724818daa4c91ca46f09aa04b46db}"

echo "Running ZAP baseline in Docker"
echo "Target: ${TARGET_URL}"
echo "Report: ${OUT_DIR_ABS}/${REPORT_FILE}"

docker run --rm \
	-v "${OUT_DIR_ABS}:/zap/wrk" \
	"${ZAP_IMAGE}" \
	zap.sh -cmd -quickurl "${TARGET_URL}" -quickout "/zap/wrk/${REPORT_FILE}"

echo "Done: ${OUT_DIR_ABS}/${REPORT_FILE}"
