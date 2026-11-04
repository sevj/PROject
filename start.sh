#!/usr/bin/env bash
# Starts the app so that it also answers at http://project.dev.local:4300
# (add `127.0.0.1 project.dev.local` to /etc/hosts). It stays bound to 127.0.0.1.
cd "$(dirname "$0")" || exit 1
# The Node of .nvmrc, whatever the default of this shell is.
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" && nvm use >/dev/null
export PM_ALLOWED_HOSTS=project.dev.local
if command -v pnpm >/dev/null 2>&1; then
  exec pnpm dev
fi
exec npx --yes corepack@latest pnpm dev
