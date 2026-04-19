const forge = require('node-forge');
const { PDFDocument, PDFName, PDFHexString, PDFString, PDFArray, PDFDict, PDFNumber, rgb, StandardFonts } = require('pdf-lib');

/**
 * Fix UTF-8 encoded strings from node-forge.
 * Forge sometimes returns certificate fields as raw UTF-8 byte sequences
 * in JavaScript strings. This decodes them to proper Unicode.
 */
function fixForgeString(str) {
  if (!str) return '';
  try {
    // Check if the string contains raw UTF-8 bytes (chars > 127 in sequence)
    const hasMultibyte = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}/.test(str);
    if (hasMultibyte) {
      // Convert each char to its byte value, then decode as UTF-8
      const bytes = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        bytes[i] = str.charCodeAt(i) & 0xFF;
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return str;
  } catch (e) {
    return str;
  }
}

/**
 * Sanitize text for WinAnsi encoding (standard PDF fonts).
 * WinAnsi supports: ASCII (0x20-0x7E) + Latin-1 Supplement (0xA0-0xFF)
 * which includes: áéíóúñÁÉÍÓÚÑüÜ etc.
 */
function sanitizeWinAnsi(text) {
  if (!text) return '';
  // First fix potential UTF-8 encoding issues
  text = fixForgeString(text);
  return text
    .replace(/[\x00-\x1F]/g, '')     // Remove ASCII control chars
    .replace(/[\x80-\x9F]/g, '')     // Remove C1 control chars
    .replace(/[\u2018\u2019]/g, "'") // Smart quotes → '
    .replace(/[\u201C\u201D]/g, '"') // Smart double quotes → "
    .replace(/[\u2013]/g, '-')       // En dash
    .replace(/[\u2014]/g, '--')      // Em dash
    .replace(/[\u2026]/g, '...')     // Ellipsis
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ''); // Keep only WinAnsi-safe
}

/**
 * Sign a PDF with visible Adobe Acrobat-style signature.
 * Placement uses percentages (0-1) relative to page dimensions.
 */
async function signPDF(pdfBuffer, certBuffer, certPassword, options = {}) {
  const {
    reason = 'Firma digital',
    location = '',
    contactInfo = '',
    borderColor = '#B83030',
    name = 'Firmante',
    pageIndex = 0,
    leftPct = 0.05,
    topPct = 0.85,
    sigWPct = 0.40,
    sigHPct = 0.12
  } = options;
  
  // Convert hex color to rgb(0-1) for pdf-lib
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return rgb(
      parseInt(h.substring(0, 2), 16) / 255,
      parseInt(h.substring(2, 4), 16) / 255,
      parseInt(h.substring(4, 6), 16) / 255
    );
  }
  function hexToLightRgb(hex, mix = 0.65) {
    const h = hex.replace('#', '');
    return rgb(
      (parseInt(h.substring(0, 2), 16) / 255) * mix + (1 - mix),
      (parseInt(h.substring(2, 4), 16) / 255) * mix + (1 - mix),
      (parseInt(h.substring(4, 6), 16) / 255) * mix + (1 - mix)
    );
  }

  // Step 1: Parse the P12 certificate
  let certificate, privateKey, certChain;
  try {
    const p12Asn1 = forge.asn1.fromDer(certBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, certPassword);
    
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    const certBagList = certBags[forge.pki.oids.certBag];
    if (!certBagList || certBagList.length === 0) throw new Error('No se encontro certificado');
    certificate = certBagList[0].cert;
    certChain = certBagList.map(b => b.cert).filter(Boolean);
    
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
    if (!keyBagList || keyBagList.length === 0) throw new Error('No se encontro clave privada');
    privateKey = keyBagList[0].key;
  } catch (err) {
    if (err.message.includes('Invalid password') || err.message.includes('PKCS#12 MAC')) {
      throw new Error('Contrasena del certificado incorrecta');
    }
    throw new Error(`Error al leer el certificado: ${err.message}`);
  }

  // Step 2: Prepare PDF with visible signature
  const SIGNATURE_LENGTH = 16384;
  const rawSignerName = certificate.subject.getField('CN')?.value || name;
  const rawSignerOrg = certificate.subject.getField('O')?.value || '';
  const rawIssuer = certificate.issuer.getField('CN')?.value || certificate.issuer.getField('O')?.value || '';
  
  const signerName = sanitizeWinAnsi(rawSignerName);
  const signerOrg = sanitizeWinAnsi(rawSignerOrg);
  const issuerName = sanitizeWinAnsi(rawIssuer);
  const safeLocation = sanitizeWinAnsi(location);
  const safeReason = sanitizeWinAnsi(reason);
  const now = new Date();
  
  const pdfDoc = await PDFDocument.load(pdfBuffer, { 
    ignoreEncryption: true,
    updateMetadata: false
  });
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const pages = pdfDoc.getPages();
  const targetPage = pages[Math.min(pageIndex, pages.length - 1)];
  
  // Convert percentages to PDF coordinates
  const { width: pageW, height: pageH } = targetPage.getSize();
  const bw = Math.round(pageW * sigWPct);
  const bh = Math.round(pageH * sigHPct);
  const bx = Math.round(pageW * leftPct);
  const by = Math.round(pageH * (1 - topPct) - bh);
  
  // Helper: fit text to max width
  function fitText(text, f, maxSize, maxW) {
    let size = maxSize;
    while (size > 4) {
      if (f.widthOfTextAtSize(text, size) <= maxW) return { text, size };
      size -= 0.5;
    }
    let truncated = text;
    while (truncated.length > 3) {
      truncated = truncated.slice(0, -1);
      if (f.widthOfTextAtSize(truncated + '...', size) <= maxW) return { text: truncated + '...', size };
    }
    return { text: truncated, size };
  }
  
  // Helper: word-wrap text into multiple lines
  function wrapText(text, f, size, maxW) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (f.widthOfTextAtSize(test, size) <= maxW) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }
  
  // ── Professional Adobe-style Signature (fully responsive) ──
  const padX = bw * 0.08;  // generous horizontal padding
  const padY = bh * 0.10;  // generous vertical padding
  const innerW = bw - padX * 2;
  const borderW = Math.max(0.8, bh * 0.012);
  
  // Semi-transparent background with user-selected border color
  const sigBorderColor = hexToRgb(borderColor);
  const sigBorderLight = hexToLightRgb(borderColor, 0.35);
  
  targetPage.drawRectangle({
    x: bx, y: by, width: bw, height: bh,
    color: rgb(1, 1, 1),
    opacity: 0.75,
    borderColor: sigBorderColor,
    borderWidth: borderW
  });
  
  // Inner border line (professional double-border effect)
  const inset = borderW + bh * 0.025;
  targetPage.drawRectangle({
    x: bx + inset, y: by + inset,
    width: bw - inset * 2, height: bh - inset * 2,
    borderColor: sigBorderLight,
    borderWidth: Math.max(0.3, borderW * 0.4),
    opacity: 0
  });
  
  // Helper: draw centered text
  function drawCentered(text, f, size, yPos, color) {
    const fit = fitText(text, f, size, innerW);
    const tw = f.widthOfTextAtSize(fit.text, fit.size);
    targetPage.drawText(fit.text, {
      x: bx + (bw - tw) / 2,
      y: yPos,
      size: fit.size, font: f, color
    });
    return fit.size;
  }
  
  // Build content lines with proportional weights
  const lines = [];
  lines.push({ text: 'Firmado digitalmente por', font: fontOblique, weight: 0.13, color: rgb(0.35, 0.35, 0.35), sep: false });
  lines.push({ text: signerName, font: fontBold, weight: 0.24, color: rgb(0.05, 0.05, 0.05), sep: true }); // separator after
  
  // Date
  const isoDate = `${now.getFullYear()}.${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;
  const isoTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const tz = -(now.getTimezoneOffset());
  const tzH = String(Math.floor(Math.abs(tz)/60)).padStart(2,'0');
  const tzM = String(Math.abs(tz)%60).padStart(2,'0');
  const tzStr = `${tz >= 0 ? '+' : '-'}${tzH}'${tzM}'`;
  lines.push({ text: `Fecha: ${isoDate}  ${isoTime} ${tzStr}`, font: font, weight: 0.13, color: rgb(0.3, 0.3, 0.3), sep: false });
  
  if (safeReason && safeReason !== 'Firma digital') {
    lines.push({ text: `Motivo: ${safeReason}`, font: fontOblique, weight: 0.11, color: rgb(0.4, 0.4, 0.4), sep: false });
  }
  if (safeLocation) {
    lines.push({ text: `Lugar: ${safeLocation}`, font: font, weight: 0.11, color: rgb(0.4, 0.4, 0.4), sep: false });
  }
  
  // Calculate sizes proportional to box height
  const usableH = bh - padY * 2;
  const totalWeight = lines.reduce((s, l) => s + l.weight, 0);
  const gapH = usableH * 0.08;
  const sepSpace = gapH * 0.6; // extra space for separator line
  const textH = usableH - gapH * (lines.length - 1) - sepSpace;
  
  // Assign font sizes (capped at 28pt max)
  for (const l of lines) {
    l.size = Math.min(28, Math.max(4, (l.weight / totalWeight) * textH));
  }
  
  // Total block height
  const blockH = lines.reduce((s, l) => s + l.size, 0) + gapH * (lines.length - 1) + sepSpace;
  
  // Draw lines centered
  let curY = by + bh / 2 + blockH / 2 - lines[0].size * 0.15;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    drawCentered(l.text, l.font, l.size, curY, l.color);
    curY -= l.size + gapH;
    
    // Draw separator line after this line if flagged
    if (l.sep) {
      const sepY = curY + gapH * 0.4;
      const sepW = innerW * 0.6;
      targetPage.drawLine({
        start: { x: bx + (bw - sepW) / 2, y: sepY },
        end: { x: bx + (bw + sepW) / 2, y: sepY },
        thickness: Math.max(0.3, bh * 0.004),
        color: rgb(0.78, 0.78, 0.78)
      });
      curY -= sepSpace;
    }
  }




  // ── Signature Dictionary (cryptographic) ──
  const sigDict = pdfDoc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'ETSI.CAdES.detached',
    ByteRange: PDFArray.withContext(pdfDoc.context),
    Contents: PDFHexString.of('0'.repeat(SIGNATURE_LENGTH * 2)),
    Reason: PDFString.of(sanitizeWinAnsi(reason)),
    M: PDFString.of(toPdfDate(now)),
    ContactInfo: PDFString.of(sanitizeWinAnsi(contactInfo || '')),
    Name: PDFString.of(signerName),
    Location: PDFString.of(sanitizeWinAnsi(location || ''))
  });
  
  const sigDictRef = pdfDoc.context.register(sigDict);
  const pageRef = pdfDoc.context.getObjectRef(targetPage.node);
  
  // Widget rect is 1x1 to avoid overlaying our visual drawing
  // The visual signature is drawn directly on the page content above
  const widgetDict = pdfDoc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [bx, by, bx + 1, by + 1],
    V: sigDictRef,
    T: PDFString.of(`Signature_${Date.now()}`),
    F: 4,
    P: pageRef
  });
  
  const widgetRef = pdfDoc.context.register(widgetDict);
  
  const annots = targetPage.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    annots.push(widgetRef);
  } else {
    targetPage.node.set(PDFName.of('Annots'), pdfDoc.context.obj([widgetRef]));
  }
  
  const acroForm = pdfDoc.catalog.lookup(PDFName.of('AcroForm'));
  if (acroForm instanceof PDFDict) {
    const fields = acroForm.lookup(PDFName.of('Fields'));
    if (fields instanceof PDFArray) {
      fields.push(widgetRef);
    } else {
      acroForm.set(PDFName.of('Fields'), pdfDoc.context.obj([widgetRef]));
    }
    acroForm.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  } else {
    pdfDoc.catalog.set(PDFName.of('AcroForm'), pdfDoc.context.obj({
      SigFlags: 3,
      Fields: [widgetRef]
    }));
  }
  
  let pdfWithPlaceholder = Buffer.from(await pdfDoc.save({ useObjectStreams: false }));
  
  // Step 3: ByteRange and Contents
  const pdfStr = pdfWithPlaceholder.toString('latin1');
  const contentsMatch = pdfStr.lastIndexOf('/Contents <' + '0'.repeat(20));
  if (contentsMatch === -1) throw new Error('No se encontro el placeholder de firma');
  
  const contentsStart = pdfStr.indexOf('<', contentsMatch);
  const contentsEnd = pdfStr.indexOf('>', contentsStart) + 1;
  const contentsValueStart = contentsStart + 1;
  const contentsValueEnd = contentsEnd - 1;
  
  const byteRange = [0, contentsStart, contentsEnd, pdfWithPlaceholder.length - contentsEnd];
  
  const byteRangeStr = `/ByteRange [${byteRange[0]} ${byteRange[1]} ${byteRange[2]} ${byteRange[3]}]`;
  const byteRangePos = pdfStr.lastIndexOf('/ByteRange [');
  
  if (byteRangePos !== -1) {
    const byteRangeEndPos = pdfStr.indexOf(']', byteRangePos) + 1;
    const oldByteRange = pdfStr.substring(byteRangePos, byteRangeEndPos);
    const padding = ' '.repeat(Math.max(0, oldByteRange.length - byteRangeStr.length));
    pdfWithPlaceholder = Buffer.from(
      pdfStr.substring(0, byteRangePos) + byteRangeStr + padding + pdfStr.substring(byteRangeEndPos),
      'latin1'
    );
  }
  
  // Step 4: PKCS#7 Signature
  const dataToSign = Buffer.concat([
    pdfWithPlaceholder.slice(byteRange[0], byteRange[1]),
    pdfWithPlaceholder.slice(byteRange[2], byteRange[2] + byteRange[3])
  ]);
  
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(dataToSign.toString('binary'));
  p7.addCertificate(certificate);
  for (const cert of certChain) {
    if (cert !== certificate) p7.addCertificate(cert);
  }
  
  p7.addSigner({
    key: privateKey,
    certificate: certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: now }
    ]
  });
  
  p7.sign({ detached: true });
  
  const signatureBytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const signatureHex = Buffer.from(signatureBytes, 'binary').toString('hex');
  const paddedSignature = signatureHex.padEnd(SIGNATURE_LENGTH * 2, '0');
  
  // Step 5: Insert signature
  const finalPdf = Buffer.from(
    pdfWithPlaceholder.toString('latin1').substring(0, contentsValueStart) +
    paddedSignature +
    pdfWithPlaceholder.toString('latin1').substring(contentsValueEnd),
    'latin1'
  );
  
  return finalPdf;
}

/**
 * Add watermark text to all pages.
 */
async function addWatermark(pdfBuffer, options = {}) {
  const {
    text = 'BORRADOR',
    fontSize = 60,
    opacity = 0.15,
    angle = -45,
    color = { r: 0.5, g: 0.5, b: 0.5 }
  } = options;
  
  const safeText = sanitizeWinAnsi(text);
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();
  
  for (const page of pages) {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(safeText, fontSize);
    const cx = width / 2;
    const cy = height / 2;
    
    page.drawText(safeText, {
      x: cx - textWidth / 2,
      y: cy,
      size: fontSize,
      font: font,
      color: rgb(color.r, color.g, color.b),
      opacity: opacity,
      rotate: { type: 'degrees', angle: angle }
    });
  }
  
  return Buffer.from(await pdfDoc.save());
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth()+1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toPdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const hOff = pad(Math.floor(Math.abs(offset) / 60));
  const mOff = pad(Math.abs(offset) % 60);
  return `D:${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}${sign}${hOff}'${mOff}'`;
}

function checkSignatures(pdfBuffer) {
  const pdfStr = pdfBuffer.toString('latin1');
  const sigCount = (pdfStr.match(/\/Type\s*\/Sig/g) || []).length;
  const hasPAdES = pdfStr.includes('ETSI.CAdES.detached');
  const hasAdobe = pdfStr.includes('adbe.pkcs7.detached');
  return {
    hasSigs: sigCount > 0, count: sigCount,
    type: hasPAdES ? 'PAdES' : hasAdobe ? 'Adobe PKCS#7' : sigCount > 0 ? 'Desconocido' : 'Sin firma',
    pades: hasPAdES, adobe: hasAdobe
  };
}

module.exports = { signPDF, addWatermark, checkSignatures };
