#!/bin/bash
# Fix chrome-sandbox permissions for Electron on Linux
SANDBOX="/opt/SignPDF/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi
