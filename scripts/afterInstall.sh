#!/bin/bash
# Fix chrome-sandbox permissions
SANDBOX="/opt/SignPDF/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null
  chmod 4755 "$SANDBOX" 2>/dev/null
fi

# Create wrapper script that sets the env var
cat > /opt/SignPDF/signpdf-wrapper << 'SCRIPT'
#!/bin/bash
export ELECTRON_DISABLE_SANDBOX=1
exec /opt/SignPDF/signpdf "$@"
SCRIPT
chmod +x /opt/SignPDF/signpdf-wrapper

# Patch .desktop file to use wrapper
DESKTOP="/usr/share/applications/signpdf.desktop"
if [ -f "$DESKTOP" ]; then
  sed -i 's|^Exec=.*|Exec=/opt/SignPDF/signpdf-wrapper %U|g' "$DESKTOP"
fi

# Update desktop database
update-desktop-database /usr/share/applications 2>/dev/null || true
