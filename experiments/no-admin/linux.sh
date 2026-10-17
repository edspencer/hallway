#!/bin/bash
# The no-admin experiments on ubuntu-latest. Reports; never fails the job.
set -u
cd "$(dirname "$0")"
h() { echo; echo "################ $*"; }

h "machine"
cat /etc/os-release | head -2; uname -r; id; systemctl --version | head -1

h "1. unprivileged low ports"
echo "net.ipv4.ip_unprivileged_port_start = $(sysctl -n net.ipv4.ip_unprivileged_port_start)"
grep -rs ip_unprivileged_port_start /etc/sysctl.conf /etc/sysctl.d /usr/lib/sysctl.d /run/sysctl.d || echo "(not set in any sysctl.d file: kernel default)"
node bind.mjs 127.0.0.1:443 '[::1]:443' 0.0.0.0:443 127.0.0.1:80 127.0.0.1:1023 127.0.0.1:1024

h "1b. a systemd *user* socket unit on 127.0.0.1:443"
sudo loginctl enable-linger "$USER"
for i in $(seq 1 20); do [ -S "/run/user/$(id -u)/bus" ] && break; sleep 0.5; done
export XDG_RUNTIME_DIR=/run/user/$(id -u) DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus
mkdir -p ~/.config/systemd/user
printf '[Socket]\nListenStream=127.0.0.1:443\nAccept=yes\n' > ~/.config/systemd/user/hwexp.socket
printf '[Service]\nExecStart=/bin/echo hello\nStandardInput=socket\n' > ~/.config/systemd/user/hwexp@.service
systemctl --user daemon-reload
systemctl --user start hwexp.socket; echo "start exit=$?"
systemctl --user status hwexp.socket --no-pager 2>&1 | head -8
journalctl --user -u hwexp.socket --no-pager 2>&1 | tail -3
systemctl --user stop hwexp.socket 2>/dev/null

h "3. secure context of plain-http origins (Playwright engines on Linux)"
npm i -s --no-save playwright@1 >/dev/null 2>&1 && npx -y playwright install --with-deps chromium firefox webkit >/dev/null 2>&1
CHANNELS=chrome node securectx.mjs
exit 0
