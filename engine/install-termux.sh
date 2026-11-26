#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/nexus-engine"

pkg update -y
pkg install -y nodejs-lts
mkdir -p "$DEST"
cp -R "$SOURCE_DIR"/. "$DEST"/
cd "$DEST"
npm install --omit=dev

mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/nexus-engine.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
set -e
termux-wake-lock
cd "$HOME/nexus-engine"
mkdir -p "$HOME/.nexus-engine"
if [ -f "$HOME/.nexus-engine/engine.pid" ] && kill -0 "$(cat "$HOME/.nexus-engine/engine.pid")" 2>/dev/null; then
  echo "NEXUS ENGINE ya está activo."
else
  nohup npm start >> "$HOME/nexus-engine/engine.log" 2>&1 &
  echo $! > "$HOME/.nexus-engine/engine.pid"
fi
if [ -f "$HOME/.nexus-engine/link.pid" ] && kill -0 "$(cat "$HOME/.nexus-engine/link.pid")" 2>/dev/null; then
  echo "NEXUS LINK ya está activo."
else
  nohup npm run link >> "$HOME/nexus-engine/link.log" 2>&1 &
  echo $! > "$HOME/.nexus-engine/link.pid"
fi
BOOT
chmod +x "$HOME/.termux/boot/nexus-engine.sh"

echo
echo "NEXUS ENGINE actualizado."
echo "Agente NEXUS LINK instalado."
echo "Token privado del motor: $HOME/.nexus-engine/engine.token"
echo "Token privado del dispositivo: $HOME/.nexus-engine/device.token"
echo "API local: http://127.0.0.1:8787"
echo "No compartas los tokens ni expongas el puerto en Internet."
echo
bash "$HOME/.termux/boot/nexus-engine.sh"
