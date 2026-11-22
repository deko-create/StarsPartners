#!/usr/bin/env bash

set -euo pipefail

agent_home="${JENKINS_MAC_AGENT_HOME:-/Users/denyskozyr/.jenkins-agent}"
java_bin="${JENKINS_MAC_AGENT_JAVA:-/opt/homebrew/opt/openjdk@21/bin/java}"
jenkins_url="${JENKINS_URL:-http://127.0.0.1:8080/}"
agent_name="${JENKINS_MAC_AGENT_NAME:-mac-vpn}"
secret_file="$agent_home/secret"
agent_jar="$agent_home/agent.jar"
work_dir="$agent_home/work"

if [[ ! -x "$java_bin" ]]; then
  echo "Java 21 was not found: $java_bin" >&2
  exit 1
fi

if [[ ! -s "$secret_file" ]]; then
  echo "Jenkins agent secret was not found: $secret_file" >&2
  exit 1
fi

if [[ ! -s "$agent_jar" ]]; then
  echo "Jenkins agent.jar was not found: $agent_jar" >&2
  exit 1
fi

mkdir -p "$work_dir"
agent_secret="$(tr -d '\r\n' < "$secret_file")"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

exec "$java_bin" -jar "$agent_jar" \
  -url "$jenkins_url" \
  -secret "$agent_secret" \
  -name "$agent_name" \
  -webSocket \
  -workDir "$work_dir"
