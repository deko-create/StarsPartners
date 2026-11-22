#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command_name="${1:-status}"
agent_home="${JENKINS_MAC_AGENT_HOME:-/Users/denyskozyr/.jenkins-agent}"
launch_agents_dir="/Users/denyskozyr/Library/LaunchAgents"
plist_path="$launch_agents_dir/com.starspartners.jenkins-mac-vpn.plist"
label="com.starspartners.jenkins-mac-vpn"
uid="$(id -u)"
domain="gui/$uid"

write_plist() {
  mkdir -p "$launch_agents_dir" "$agent_home/logs" "$agent_home/work"
  /usr/bin/python3 - "$plist_path" "$project_root" "$agent_home" <<'PY'
import plistlib
import sys

plist_path, project_root, agent_home = sys.argv[1:]
payload = {
    'Label': 'com.starspartners.jenkins-mac-vpn',
    'ProgramArguments': [
        '/bin/bash',
        f'{project_root}/scripts/jenkins-macos-agent-launch.sh',
    ],
    'RunAtLoad': True,
    'KeepAlive': True,
    'ProcessType': 'Interactive',
    'WorkingDirectory': project_root,
    'StandardOutPath': f'{agent_home}/logs/stdout.log',
    'StandardErrorPath': f'{agent_home}/logs/stderr.log',
}
with open(plist_path, 'wb') as stream:
    plistlib.dump(payload, stream, sort_keys=False)
PY
}

start_agent() {
  launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "$domain" "$plist_path"
  launchctl kickstart -k "$domain/$label"
}

case "$command_name" in
  install)
    mkdir -p "$agent_home"
    docker cp \
      starspartners-jenkins:/var/jenkins_home/secrets/mac-vpn-agent-secret \
      "$agent_home/secret"
    chmod 600 "$agent_home/secret"
    curl --fail --silent --show-error \
      http://127.0.0.1:8080/jnlpJars/agent.jar \
      --output "$agent_home/agent.jar"
    chmod 600 "$agent_home/agent.jar"
    write_plist
    start_agent
    ;;
  start)
    test -f "$plist_path"
    start_agent
    ;;
  stop)
    launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
    ;;
  status)
    launchctl print "$domain/$label"
    ;;
  *)
    echo "Usage: $0 {install|start|stop|status}" >&2
    exit 2
    ;;
esac
