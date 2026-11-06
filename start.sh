#!/usr/bin/env bash
# Starts the app so that it also answers at http://project.dev.local:4300
# (add `127.0.0.1 project.dev.local` to /etc/hosts). It stays bound to 127.0.0.1.
# With the local Traefik routing project.dev.local to host.docker.internal:4300 (see the
# README), it answers at https://project.dev.local too.
#
# ./start.sh --https answers at https://project.dev.local:4300 instead, with a certificate
# made once by mkcert in .certs/. The browser then gives the page what it keeps for secure
# pages (clipboard, crypto.randomUUID…), as it does for http://localhost.
cd "$(dirname "$0")" || exit 1
# The Node of .nvmrc, whatever the default of this shell is.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use >/dev/null
export PM_ALLOWED_HOSTS=project.dev.local
# Calls made by the app (APM, GitLab…) also trust the certificates of this machine, such as those
# of mkcert for the local sites (https://apm.dev.local), on top of Node's own.
export NODE_USE_SYSTEM_CA=1

args=()
if [ "$1" = "--https" ]; then
  if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert is needed for --https: sudo apt install mkcert libnss3-tools, then mkcert -install" >&2
    exit 1
  fi
  key=.certs/project.dev.local-key.pem
  cert=.certs/project.dev.local.pem
  if [ ! -s "$key" ] || [ ! -s "$cert" ]; then
    mkdir -p .certs && chmod 700 .certs
    mkcert -key-file "$key" -cert-file "$cert" project.dev.local localhost 127.0.0.1 ::1 || exit 1
  fi
  args=(--experimental-https --experimental-https-key "$key" --experimental-https-cert "$cert")
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm dev "${args[@]}"
fi
exec npx --yes corepack@latest pnpm dev "${args[@]}"
