#!/bin/sh
# jellyfin-zapping installer — injects zapping.js into the Jellyfin web client.
#
#   sudo sh install.sh                 install (auto-detects the web folder)
#   sudo sh install.sh --web DIR       install into a specific jellyfin-web folder
#   sudo sh install.sh --uninstall     remove it and restore index.html
#
# On Debian/Ubuntu it also adds an apt hook, so the script is re-applied
# automatically after every jellyfin-web upgrade.
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
OPT=/opt/jellyfin-zapping
APPLY=/usr/local/bin/jellyfin-zapping-apply
HOOK=/etc/apt/apt.conf.d/99jellyfin-zapping
WEB=""
MODE=install

while [ $# -gt 0 ]; do
  case "$1" in
    --web) WEB="$2"; shift 2 ;;
    --uninstall) MODE=uninstall; shift ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done

if [ -z "$WEB" ]; then
  for d in /usr/share/jellyfin/web /usr/lib/jellyfin/bin/jellyfin-web /jellyfin/jellyfin-web; do
    [ -f "$d/index.html" ] && WEB="$d" && break
  done
fi
[ -n "$WEB" ] && [ -f "$WEB/index.html" ] || { echo "jellyfin-web folder not found: use --web DIR"; exit 1; }

if [ "$MODE" = uninstall ]; then
  sed -i 's#<script defer src="zapping.js?v=[0-9a-f]*"></script>##' "$WEB/index.html"
  rm -f "$WEB/zapping.js" "$APPLY" "$HOOK"
  rm -rf "$OPT"
  echo "removed from $WEB"
  exit 0
fi

mkdir -p "$OPT"
cp "$HERE/zapping.js" "$OPT/zapping.js"
echo "$WEB" > "$OPT/webdir"

cat > "$APPLY" <<'EOF'
#!/bin/sh
# Re-applies jellyfin-zapping to the Jellyfin web client (run after upgrades).
OPT=/opt/jellyfin-zapping
WEB=$(cat "$OPT/webdir" 2>/dev/null)
[ -f "$OPT/zapping.js" ] && [ -f "$WEB/index.html" ] || exit 0
cp "$OPT/zapping.js" "$WEB/zapping.js"
V=$(md5sum "$OPT/zapping.js" | cut -c1-8)
if grep -q 'zapping.js' "$WEB/index.html"; then
  sed -i "s#zapping.js?v=[0-9a-f]*#zapping.js?v=$V#" "$WEB/index.html"
else
  sed -i "s#</body>#<script defer src=\"zapping.js?v=$V\"></script></body>#" "$WEB/index.html"
fi
EOF
chmod 755 "$APPLY"

if [ -d /etc/apt/apt.conf.d ]; then
  cat > "$HOOK" <<EOF
// jellyfin-zapping: re-apply after jellyfin-web upgrades
DPkg::Post-Invoke { "$APPLY >/dev/null 2>&1 || true"; };
EOF
fi

"$APPLY"
echo "installed into $WEB — reload Jellyfin in the browser"
