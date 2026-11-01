FROM docker.io/library/caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY site/ /srv/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
