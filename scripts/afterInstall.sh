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

# Remove any local user .desktop overrides that may point to the dev version
# (these take priority over /usr/share/applications and cause launch failures)
for HOMEDIR in /home/*; do
  LOCAL_DESKTOP="$HOMEDIR/.local/share/applications/signpdf.desktop"
  if [ -f "$LOCAL_DESKTOP" ]; then
    # Only remove if it points somewhere other than /opt/SignPDF
    if grep -q "Exec=" "$LOCAL_DESKTOP" && ! grep -q "/opt/SignPDF/" "$LOCAL_DESKTOP"; then
      rm -f "$LOCAL_DESKTOP" 2>/dev/null
    fi
  fi
  # Update user desktop database
  if [ -d "$HOMEDIR/.local/share/applications" ]; then
    update-desktop-database "$HOMEDIR/.local/share/applications" 2>/dev/null || true
  fi
done

# Update desktop database
update-desktop-database /usr/share/applications 2>/dev/null || true
