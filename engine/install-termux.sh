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
termux-wake-lock
cd "$HOME/nexus-engine"
nohup npm start >> "$HOME/nexus-engine/engine.log" 2>&1 &
BOOT
chmod +x "$HOME/.termux/boot/nexus-engine.sh"

echo
echo "NEXUS ENGINE instalado."
echo "Token privado: $HOME/.nexus-engine/engine.token"
echo "API local: http://127.0.0.1:8787"
echo "No compartas el token ni expongas el puerto en Internet."
echo
bash "$HOME/.termux/boot/nexus-engine.sh"
