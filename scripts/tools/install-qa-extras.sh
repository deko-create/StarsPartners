#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
	echo "Homebrew is required for qa extras installation."
	exit 1
fi

PROFILE="${1:-core}"

CORE_FORMULAE=(
	shellcheck
	actionlint
	hadolint
	yamllint
	openapi-generator
	semgrep
	trivy
	gitleaks
	syft
	grype
	osv-scanner
	snyk-cli
	docker-compose
	crane
	lychee
	markdownlint-cli2
	dive
	zizmor
	cosign
)

MOBILE_FORMULAE=(
	scrcpy
	websocat
)

PERFORMANCE_FORMULAE=(
	k6
	oha
)

DEV_FORMULAE=(
	fd
	bat
	git-delta
	fzf
	httpie
	hyperfine
	gron
	htop
	watchman
	watchexec
	just
)

FORMULAE=("${CORE_FORMULAE[@]}")
INSTALL_REGCTL=1
INSTALL_AUTOCANNON=0
case "${PROFILE}" in
core) ;;
mobile)
	FORMULAE=("${MOBILE_FORMULAE[@]}")
	INSTALL_REGCTL=0
	;;
performance)
	FORMULAE=("${PERFORMANCE_FORMULAE[@]}")
	INSTALL_REGCTL=0
	INSTALL_AUTOCANNON=1
	;;
dev)
	FORMULAE=("${DEV_FORMULAE[@]}")
	INSTALL_REGCTL=0
	;;
all)
	FORMULAE=(
		"${CORE_FORMULAE[@]}"
		"${MOBILE_FORMULAE[@]}"
		"${PERFORMANCE_FORMULAE[@]}"
		"${DEV_FORMULAE[@]}"
	)
	INSTALL_AUTOCANNON=1
	;;
*)
	echo "Unknown profile: ${PROFILE}. Use core, mobile, performance, dev, or all."
	exit 2
	;;
esac

echo "Installing QA tools profile '${PROFILE}' with Homebrew..."
for formula in "${FORMULAE[@]}"; do
	if brew list --versions "$formula" >/dev/null 2>&1; then
		echo "  - $formula already installed"
		continue
	fi
	echo "  - installing $formula"
	brew install "$formula"
done

if [ "${INSTALL_REGCTL}" -eq 1 ] && ! command -v regctl >/dev/null 2>&1; then
	if ! command -v go >/dev/null 2>&1; then
		echo "  - regctl skipped: Go is required for github.com/regclient/regclient/cmd/regctl"
	else
		echo "  - installing regctl via go install"
		go install github.com/regclient/regclient/cmd/regctl@latest
		REGCTL_BIN="$(go env GOPATH)/bin/regctl"
		if [ -x "${REGCTL_BIN}" ] && [ -d /opt/homebrew/bin ]; then
			ln -sf "${REGCTL_BIN}" /opt/homebrew/bin/regctl
		fi
	fi
elif [ "${INSTALL_REGCTL}" -eq 1 ]; then
	echo "  - regctl already installed"
fi

if [ "${INSTALL_AUTOCANNON}" -eq 1 ] && ! command -v autocannon >/dev/null 2>&1; then
	if ! command -v npm >/dev/null 2>&1; then
		echo "  - autocannon skipped: npm is required"
	else
		echo "  - installing autocannon globally"
		npm install -g autocannon@latest
	fi
elif [ "${INSTALL_AUTOCANNON}" -eq 1 ]; then
	echo "  - autocannon already installed"
fi

echo "QA extra tools installation completed."
