#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
pkg update -y
pkg install -y nodejs-lts git
mkdir -p "$HOME/nexus-engine"
cd "$HOME/nexus-engine"
if [ ! -f package.json ]; then
  echo "Clona NEXUS-CLOUD y copia la carpeta engine a $HOME/nexus-engine antes de ejecutar este instalador."
  exit 1
fi
npm install --omit=dev
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/nexus-engine.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd "$HOME/nexus-engine"
nohup npm start >> "$HOME/nexus-engine/engine.log" 2>&1 &
BOOT
chmod +x "$HOME/.termux/boot/nexus-engine.sh"
echo "Instalación preparada. Reinicia Termux o ejecuta: bash $HOME/.termux/boot/nexus-engine.sh"
