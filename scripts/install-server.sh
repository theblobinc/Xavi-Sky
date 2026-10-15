#!/usr/bin/env bash
set -euo pipefail
ROOT=${XAVI_SKY_ROOT:-/datastore3/xavi-sky}
CONCRETE_ROOT=${XAVI_CONCRETE_ROOT:-/var/www/xavi/live}
WEB_GROUP=${XAVI_SKY_WEB_GROUP:-www-data}
mkdir -p "$ROOT/data" "$ROOT/secrets" "$HOME/.config/systemd/user"
chmod 750 "$ROOT/secrets"
if [[ ! -s "$ROOT/secrets/federation.token" ]]; then
  umask 027
  openssl rand -hex 32 > "$ROOT/secrets/federation.token"
fi
chgrp "$WEB_GROUP" "$ROOT/secrets" "$ROOT/secrets/federation.token"
chmod 750 "$ROOT/secrets"
chmod 640 "$ROOT/secrets/federation.token"
chgrp -R "$WEB_GROUP" "$ROOT/data"
chmod 2770 "$ROOT/data"
find "$ROOT/data" -type d -exec chmod g+rwx {} +
find "$ROOT/data" -type f -exec chmod g+rw {} +
# Existing/default ACLs can silently override chmod group bits. Ensure the
# Concrete/PHP web group has effective write access to SQLite and future WAL files.
if command -v setfacl >/dev/null 2>&1; then
  setfacl -m g::rwx,d:g::rwx,d:o::--- "$ROOT/data"
  find "$ROOT/data" -type d -exec setfacl -m g::rwx {} +
  find "$ROOT/data" -type f -exec setfacl -m g::rw {} +
fi
rm -rf "$CONCRETE_ROOT/packages/xavi_sky"
cp -a "$ROOT/concretecms/xavi_sky" "$CONCRETE_ROOT/packages/xavi_sky"
if /usr/bin/php "$CONCRETE_ROOT/concrete/bin/concrete" c5:package:list 2>/dev/null | grep -q 'xavi_sky'; then
  /usr/bin/php "$CONCRETE_ROOT/concrete/bin/concrete" c5:package:update xavi_sky || true
else
  /usr/bin/php "$CONCRETE_ROOT/concrete/bin/concrete" c5:package:install xavi_sky
fi
cp "$ROOT/systemd/xavi-sky-worker.service" "$ROOT/systemd/xavi-sky-worker.timer" "$ROOT/systemd/xavi-sky-federation.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now xavi-sky-worker.timer xavi-sky-federation.service
printf 'Xavi-Sky installed. SPA: /xavi-sky\n'
