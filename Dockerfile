# Development image: the sources are mounted, nothing is copied into it.
FROM node:22-alpine

# better-sqlite3 and node-pty are native modules; the app also calls docker, git and ss.
RUN apk add --no-cache python3 make g++ git iproute2 openssh-client bash
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

ENV XDG_DATA_HOME=/data \
    COREPACK_HOME=/home/node/.corepack \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && mkdir -p /srv/app/node_modules /srv/app/.next /data /home/node/.corepack \
    && chown -R node:node /srv/app /data /home/node

WORKDIR /srv/app
EXPOSE 4300
