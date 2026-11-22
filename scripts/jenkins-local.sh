#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$project_root/docker/jenkins/docker-compose.yml"
command_name="${1:-status}"

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  if command -v colima >/dev/null 2>&1; then
    colima start --cpu 4 --memory 8
  fi

  docker info >/dev/null
}

configure_socket() {
  local context_name
  local endpoint
  local docker_gid
  context_name="$(docker context show)"

  if [[ "$context_name" == "colima" ]] && command -v colima >/dev/null 2>&1; then
    export JENKINS_DOCKER_SOCKET="/var/run/docker.sock"
    docker_gid="$(colima ssh -- stat -c '%g' /var/run/docker.sock)"
    export JENKINS_DOCKER_GID="$docker_gid"
    return
  fi

  endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
  export JENKINS_DOCKER_SOCKET="${endpoint#unix://}"

  if [[ ! -S "$JENKINS_DOCKER_SOCKET" ]]; then
    echo "Docker socket was not found: $JENKINS_DOCKER_SOCKET" >&2
    exit 1
  fi

  if stat -f '%g' "$JENKINS_DOCKER_SOCKET" >/dev/null 2>&1; then
    docker_gid="$(stat -f '%g' "$JENKINS_DOCKER_SOCKET")"
  else
    docker_gid="$(stat -c '%g' "$JENKINS_DOCKER_SOCKET")"
  fi
  export JENKINS_DOCKER_GID="$docker_gid"
}

compose() {
  docker compose --file "$compose_file" "${@:1}"
}

ensure_docker
configure_socket

case "$command_name" in
  start)
    compose up --detach --build
    echo "Jenkins is starting at http://localhost:8080"
    ;;
  stop)
    compose stop
    ;;
  restart)
    compose up --detach --build --force-recreate
    ;;
  status)
    compose ps
    ;;
  logs)
    compose logs --follow --tail=200 jenkins
    ;;
  password)
    docker exec starspartners-jenkins \
      cat /var/jenkins_home/secrets/initialAdminPassword
    ;;
  destroy)
    echo "Refusing to delete Jenkins data automatically." >&2
    echo "Run the explicit Docker Compose down --volumes command only after a backup." >&2
    exit 2
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|password}" >&2
    exit 2
    ;;
esac
