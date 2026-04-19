#!/bin/bash
# Fix chrome-sandbox permissions
SANDBOX="/opt/SignPDF/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null
  chmod 4755 "$SANDBOX" 2>/dev/null
fi

# Create wrapper that always works
WRAPPER="/usr/local/bin/signpdf-launch"
cat > "$WRAPPER" << 'SCRIPT'
#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
exec /opt/SignPDF/signpdf "$@"
SCRIPT
chmod +x "$WRAPPER"

# Also update the desktop file to use --no-sandbox
DESKTOP="/usr/share/applications/signpdf.desktop"
if [ -f "$DESKTOP" ]; then
  sed -i 's|Exec=/opt/SignPDF/signpdf|Exec=env ELECTRON_DISABLE_SANDBOX=1 /opt/SignPDF/signpdf|g' "$DESKTOP"
fi
