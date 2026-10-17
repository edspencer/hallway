#!/bin/bash
# The no-admin experiments on a macos-latest runner. Every step runs as the runner user unless it says sudo, and every
# step that might wait on a GUI prompt runs under a timeout. Nothing here fails the job: it reports.
set -u
cd "$(dirname "$0")"
EXP=$PWD
T() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS has no timeout(1)
h() { echo; echo "################ $*"; }
UID_=$(id -u)
WORK=$(mktemp -d)

h "machine"
sw_vers; uname -a; id; echo "console owner: $(stat -f %Su /dev/console)"; who
launchctl print "gui/$UID_" >/dev/null 2>&1 && echo "gui/$UID_ domain: present" || echo "gui/$UID_ domain: absent"
brew list caddy >/dev/null 2>&1 || brew install -q caddy >/dev/null
caddy version
PY=$(command -v python3); echo "python3: $PY ($($PY --version))"

h "1a. node: unprivileged bind"
node bind.mjs 127.0.0.1:443 '[::1]:443' 0.0.0.0:443 '[::]:443' 127.0.0.1:80 '[::1]:80' 0.0.0.0:80 127.0.0.2:443 127.0.0.1:1023 127.0.0.1:1024

h "1b. caddy: unprivileged bind on 127.0.0.1:443 and 0.0.0.0:443"
for addr in 127.0.0.1 0.0.0.0; do
  printf '{\n admin off\n}\nhttp://:443 {\n bind %s\n respond "caddy on %s:443"\n}\n' $addr $addr > "$WORK/bind-$addr.Caddyfile"
  T 6 caddy run --adapter caddyfile --config "$WORK/bind-$addr.Caddyfile" > "$WORK/bind-$addr.log" 2>&1 &
  sleep 4
  echo "-- $addr: curl http://127.0.0.1:443 -> $(curl -s -m 2 http://127.0.0.1:443/ || echo 'no answer')"
  grep -vE '"level":"(debug)"' "$WORK/bind-$addr.log" | grep -iE "error|permission|listen|bind" | head -4
  wait
done

h "1c. IP_BOUND_IF lo0 on a wildcard listener, probed from another interface (feth pair)"
if sudo ifconfig feth0 create && sudo ifconfig feth1 create && sudo ifconfig feth0 peer feth1; then
  sudo ifconfig feth0 inet 10.99.0.1/24 up; sudo ifconfig feth1 up
  sudo arp -s 10.99.0.2 "$(ifconfig feth1 | awk '/ether/{print $2}')"
  VENV=$WORK/venv; $PY -m venv $VENV && $VENV/bin/pip install -q scapy 2>&1 | tail -1
  $PY boundif.py serve & SRV=$!; sleep 1
  sudo perl -e 'alarm shift; exec @ARGV' 30 $VENV/bin/python boundif.py probe
  echo "-- the same three from loopback:"
  for p in 8443 8444 8445; do nc -z -G 2 127.0.0.1 $p && echo "127.0.0.1:$p connects" || echo "127.0.0.1:$p refused"; done
  kill $SRV; sudo ifconfig feth1 destroy; sudo ifconfig feth0 destroy
else
  echo "feth unavailable"
fi

h "1d. launchd socket activation: a LaunchAgent (no sudo) asking for 127.0.0.1:443, [::1]:443 and 127.0.0.1:80"
PLIST=~/Library/LaunchAgents/hallway.exp.sock.plist
mkdir -p ~/Library/LaunchAgents
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>hallway.exp.sock</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$EXP/launchd_shim.py</string><string>serve</string><string>https4</string><string>https6</string><string>http4</string></array>
  <key>Sockets</key><dict>
    <key>https4</key><dict><key>SockNodeName</key><string>127.0.0.1</string><key>SockServiceName</key><string>443</string><key>SockFamily</key><string>IPv4</string></dict>
    <key>https6</key><dict><key>SockNodeName</key><string>::1</string><key>SockServiceName</key><string>443</string><key>SockFamily</key><string>IPv6</string></dict>
    <key>http4</key><dict><key>SockNodeName</key><string>127.0.0.1</string><key>SockServiceName</key><string>80</string><key>SockFamily</key><string>IPv4</string></dict>
  </dict>
  <key>StandardOutPath</key><string>$WORK/sock.out</string>
  <key>StandardErrorPath</key><string>$WORK/sock.out</string>
</dict></plist>
EOF
DOMAIN="gui/$UID_"; launchctl print "$DOMAIN" >/dev/null 2>&1 || DOMAIN="user/$UID_"
echo "bootstrap into $DOMAIN: $(launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1; echo exit=$?)"
sleep 1
echo "-- listeners on 443/80 (sudo lsof, to see root's sockets):"
sudo lsof -nP -iTCP:443 -iTCP:80 -sTCP:LISTEN
for u in http://127.0.0.1:443/ 'http://[::1]:443/' http://127.0.0.1:80/; do echo "-- curl $u -> $(curl -s -m 5 "$u" || echo 'no answer')"; done
echo "-- reachable from another address? curl the runner's en0 address on 443:"
EN0=$(ipconfig getifaddr en0 || true); [ -n "$EN0" ] && (curl -s -m 3 "http://$EN0:443/" || echo "no answer on $EN0:443")
echo "-- agent output:"; cat "$WORK/sock.out"
launchctl print "$DOMAIN/hallway.exp.sock" | grep -iE 'state|sockets|pid|last exit' | head
launchctl bootout "$DOMAIN/hallway.exp.sock"; rm -f "$PLIST"

h "1e. Caddy itself on launchd's sockets: LaunchAgent -> shim -> caddy with listen fd/3, fd/4 (TLS) + fd/5 (http)"
mkdir -p "$WORK/caddy"
cat > "$WORK/caddy.json" <<EOF
{ "admin": {"disabled": true},
  "storage": {"module": "file_system", "root": "$WORK/caddy"},
  "apps": {
    "http": {"servers": {
      "tls": {"listen": ["fd/3", "fd/4"], "tls_connection_policies": [{}], "automatic_https": {"disable": true},
              "routes": [{"handle": [{"handler": "static_response", "body": "hello from caddy on launchd's 443, host {http.request.host}\n"}]}]},
      "plain": {"listen": ["fd/5"], "automatic_https": {"disable": true},
              "routes": [{"handle": [{"handler": "static_response", "status_code": 308, "headers": {"Location": ["https://{http.request.host}{http.request.uri}"]}}]}]}}},
    "tls": {"certificates": {"automate": ["hallway.localhost", "app.localhost"]},
            "automation": {"policies": [{"issuers": [{"module": "internal"}]}]}},
    "pki": {"certificate_authorities": {"local": {"name": "Hallway Local CA", "install_trust": false}}}}}
EOF
CADDY=$(command -v caddy)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>hallway.exp.sock</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$EXP/launchd_shim.py</string><string>exec</string><string>https4</string><string>https6</string><string>http4</string><string>--</string><string>$CADDY</string><string>run</string><string>--config</string><string>$WORK/caddy.json</string></array>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$WORK</string><key>XDG_DATA_HOME</key><string>$WORK/xdg</string><key>XDG_CONFIG_HOME</key><string>$WORK/xdg</string></dict>
  <key>Sockets</key><dict>
    <key>https4</key><dict><key>SockNodeName</key><string>127.0.0.1</string><key>SockServiceName</key><string>443</string><key>SockFamily</key><string>IPv4</string></dict>
    <key>https6</key><dict><key>SockNodeName</key><string>::1</string><key>SockServiceName</key><string>443</string><key>SockFamily</key><string>IPv6</string></dict>
    <key>http4</key><dict><key>SockNodeName</key><string>127.0.0.1</string><key>SockServiceName</key><string>80</string><key>SockFamily</key><string>IPv4</string></dict>
  </dict>
  <key>StandardOutPath</key><string>$WORK/caddy.out</string>
  <key>StandardErrorPath</key><string>$WORK/caddy.out</string>
</dict></plist>
EOF
echo "bootstrap: $(launchctl bootstrap "$DOMAIN" "$PLIST" 2>&1; echo exit=$?)"
for i in $(seq 1 20); do [ -f "$WORK/caddy/pki/authorities/local/root.crt" ] && break; sleep 0.5; done
ROOT="$WORK/caddy/pki/authorities/local/root.crt"
echo "-- curl --cacert root https://hallway.localhost/ (port 443, no redirect, no sudo):"
curl -sS -m 5 --cacert "$ROOT" https://hallway.localhost/ || true
curl -sS -m 5 --cacert "$ROOT" -g 'https://app.localhost/' --resolve 'app.localhost:443:[::1]' || true
echo "-- curl -I http://hallway.localhost/:"; curl -sS -m 5 -I http://hallway.localhost/ | head -3
echo "-- caddy output:"; grep -vE '"level":"debug"' "$WORK/caddy.out" | head -20

h "2. user-domain trust (no sudo)"
echo "-- authorization rights:"
for r in com.apple.trust-settings.user com.apple.trust-settings.admin; do echo "[$r]"; security authorizationdb read $r 2>/dev/null | plutil -convert json -o - - ; echo; done
echo | T 10 openssl s_client -connect 127.0.0.1:443 -servername hallway.localhost 2>/dev/null | openssl x509 > "$WORK/leaf.pem"
echo "-- before: verify-cert -> $(security verify-cert -c "$WORK/leaf.pem" -p ssl -s hallway.localhost 2>&1 | tail -1)"
echo "-- before: /usr/bin/curl https://hallway.localhost/ -> $(/usr/bin/curl -sS -m 5 https://hallway.localhost/ 2>&1 | head -1)"
security list-keychains -d user; security show-keychain-info ~/Library/Keychains/login.keychain-db 2>&1
echo "-- add-trusted-cert into the user domain (login keychain), 90 s limit:"
START=$(date +%s)
T 90 security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db "$ROOT"; echo "exit=$? after $(( $(date +%s) - START ))s"
echo "-- user trust settings now:"; security dump-trust-settings 2>&1 | head -12
echo "-- admin trust settings (should not list Hallway):"; security dump-trust-settings -d 2>&1 | grep -i hallway || echo "(no Hallway in admin domain)"
echo "-- after: verify-cert -> $(security verify-cert -c "$WORK/leaf.pem" -p ssl -s hallway.localhost 2>&1 | tail -1)"
echo "-- after: /usr/bin/curl https://hallway.localhost/ -> $(/usr/bin/curl -sS -m 5 https://hallway.localhost/ 2>&1 | head -1)"
echo "-- after: node --use-system-ca fetch -> $(node --use-system-ca -e 'fetch("https://hallway.localhost/").then(r=>r.text()).then(t=>console.log(t.trim()),e=>console.log("ERR",e.cause?.code||e.message))' 2>&1)"
echo "-- after: node (bundled CAs) fetch -> $(node -e 'fetch("https://hallway.localhost/").then(r=>r.text()).then(t=>console.log(t.trim()),e=>console.log("ERR",e.cause?.code||e.message))' 2>&1)"
echo "$ROOT" > "$WORK/root-path"; echo "ROOT=$ROOT" >> "$GITHUB_ENV"
echo "-- browsers against https://hallway.localhost/ with the user-domain trust:"
cd "$EXP" && npm i -s --no-save playwright@1 >/dev/null 2>&1 && npx -y playwright install webkit firefox >/dev/null 2>&1
node -e '
const { webkit, firefox, chromium } = require("playwright");
(async () => {
  for (const [n, t, o] of [["webkit", webkit, {}], ["chrome", chromium, { channel: "chrome" }], ["firefox", firefox, {}],
                           ["firefox+enterprise_roots", firefox, { firefoxUserPrefs: { "security.enterprise_roots.enabled": true } }]]) {
    try { const b = await t.launch(o); const p = await b.newPage();
      try { await p.goto("https://hallway.localhost/", { timeout: 10000 }); console.log(n, b.version(), "OK:", (await p.textContent("body")).trim()); }
      catch (e) { console.log(n, b.version(), "FAILED:", String(e).split("\n")[0].slice(0, 140)); }
      await b.close(); } catch (e) { console.log(n, "launch failed", String(e).split("\n")[0]); }
  }
})();'
echo "-- secure context (plain http) on macOS engines:"
CHANNELS=chrome PORT=4481 node securectx.mjs

h "2b. removing the user-domain trust (no sudo), 90 s limit"
START=$(date +%s)
T 90 security remove-trusted-cert "$ROOT"; echo "remove-trusted-cert exit=$? after $(( $(date +%s) - START ))s"
SHA=$(openssl x509 -in "$ROOT" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)
T 30 security delete-certificate -Z "$SHA" ~/Library/Keychains/login.keychain-db; echo "delete-certificate exit=$?"
echo "-- after removal: verify-cert -> $(security verify-cert -c "$WORK/leaf.pem" -p ssl -s hallway.localhost 2>&1 | tail -1)"
launchctl bootout "$DOMAIN/hallway.exp.sock"; rm -f "$PLIST"
exit 0
