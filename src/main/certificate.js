const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

/**
 * Load and parse a PKCS#12 (.p12/.pfx) certificate.
 * 
 * @param {string} certPath - Path to the .p12/.pfx file
 * @param {string} password - Certificate password
 * @returns {Object} Certificate information
 */
function loadCertificate(certPath, password) {
  const certBuffer = fs.readFileSync(certPath);
  const p12Der = forge.util.decode64(certBuffer.toString('base64'));
  
  let p12Asn1;
  try {
    p12Asn1 = forge.asn1.fromDer(p12Der);
  } catch (err) {
    throw new Error('El archivo no es un certificado PKCS#12 válido');
  }

  let p12;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);
  } catch (err) {
    throw new Error('Contraseña incorrecta o certificado corrupto');
  }

  // Extract certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBagList = certBags[forge.pki.oids.certBag];
  
  if (!certBagList || certBagList.length === 0) {
    throw new Error('No se encontró ningún certificado en el archivo');
  }

  const cert = certBagList[0].cert;
  if (!cert) {
    throw new Error('No se pudo extraer el certificado');
  }

  // Extract key
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBagList = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag];
  const hasPrivateKey = keyBagList && keyBagList.length > 0;

  // Parse certificate details
  const subject = cert.subject;
  const issuer = cert.issuer;

  /**
   * Fix UTF-8 encoded strings from node-forge.
   * Forge returns cert fields as raw UTF-8 byte sequences in JS strings.
   */
  function fixForgeString(str) {
    if (!str) return '';
    try {
      const hasMultibyte = /[\xC0-\xDF][\x80-\xBF]|[\xE0-\xEF][\x80-\xBF]{2}/.test(str);
      if (hasMultibyte) {
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xFF;
        return new TextDecoder('utf-8').decode(bytes);
      }
      return str;
    } catch (e) { return str; }
  }

  const getAttr = (entity, shortName) => {
    const attr = entity.getField(shortName);
    return attr ? fixForgeString(attr.value) : '';
  };

  const now = new Date();
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const isValid = now >= notBefore && now <= notAfter;
  const daysUntilExpiry = Math.floor((notAfter - now) / (1000 * 60 * 60 * 24));

  // Check if self-signed
  const isSelfSigned = cert.subject.hash === cert.issuer.hash;

  // Get key usage
  const keyUsageExt = cert.getExtension('keyUsage');
  const extKeyUsageExt = cert.getExtension('extKeyUsage');
  
  let keyUsages = [];
  if (keyUsageExt) {
    if (keyUsageExt.digitalSignature) keyUsages.push('Firma Digital');
    if (keyUsageExt.nonRepudiation) keyUsages.push('No Repudio');
    if (keyUsageExt.keyEncipherment) keyUsages.push('Cifrado de Clave');
    if (keyUsageExt.dataEncipherment) keyUsages.push('Cifrado de Datos');
    if (keyUsageExt.keyCertSign) keyUsages.push('Firma de Certificados');
  }

  // Get serial number
  const serialNumber = cert.serialNumber ? 
    cert.serialNumber.match(/.{1,2}/g).join(':').toUpperCase() : 'N/A';

  // Get signature algorithm
  const sigAlg = cert.siginfo?.algorithmOid || 'N/A';
  const sigAlgNames = {
    '1.2.840.113549.1.1.11': 'SHA-256 con RSA',
    '1.2.840.113549.1.1.12': 'SHA-384 con RSA',
    '1.2.840.113549.1.1.13': 'SHA-512 con RSA',
    '1.2.840.113549.1.1.5': 'SHA-1 con RSA',
    '1.2.840.10045.4.3.2': 'ECDSA con SHA-256',
    '1.2.840.10045.4.3.3': 'ECDSA con SHA-384',
  };

  return {
    // Subject
    commonName: getAttr(subject, 'CN') || 'Desconocido',
    organization: getAttr(subject, 'O') || '',
    organizationalUnit: getAttr(subject, 'OU') || '',
    country: getAttr(subject, 'C') || '',
    state: getAttr(subject, 'ST') || '',
    locality: getAttr(subject, 'L') || '',
    email: getAttr(subject, 'E') || getAttr(subject, 'emailAddress') || '',
    
    // Issuer
    issuerName: getAttr(issuer, 'CN') || 'Desconocido',
    issuerOrg: getAttr(issuer, 'O') || '',
    issuerCountry: getAttr(issuer, 'C') || '',
    
    // Validity
    validFrom: notBefore.toISOString(),
    validTo: notAfter.toISOString(),
    validFromFormatted: formatDate(notBefore),
    validToFormatted: formatDate(notAfter),
    isValid,
    isExpired: now > notAfter,
    isNotYetValid: now < notBefore,
    daysUntilExpiry,
    
    // Technical
    serialNumber,
    signatureAlgorithm: sigAlgNames[sigAlg] || sigAlg,
    keyUsages,
    isSelfSigned,
    hasPrivateKey,
    
    // File info
    filePath: '',
    fileName: ''
  };
}

/**
 * Get a human-readable summary of certificate info.
 */
function getCertificateInfo(certInfo) {
  if (!certInfo) return null;
  return {
    ...certInfo,
    statusText: certInfo.isExpired ? 'Expirado' : 
                certInfo.isNotYetValid ? 'Aún no válido' : 
                certInfo.isSelfSigned ? 'Autofirmado (Pruebas)' : 'Válido',
    statusColor: certInfo.isExpired ? 'red' : 
                 certInfo.isNotYetValid ? 'orange' : 
                 certInfo.isSelfSigned ? 'yellow' : 'green',
    trustLevel: certInfo.isSelfSigned ? 'No confiable (certificado de prueba)' : 
                certInfo.isValid ? 'Confiable' : 'No confiable'
  };
}

/**
 * Generate a self-signed test certificate for development.
 * 
 * @param {string} outputPath - Where to save the .p12 file
 * @param {string} password - Password for the certificate
 */
function generateTestCertificate(outputPath, password = 'test1234') {
  // Generate RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
  
  // Valid for 1 year
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { shortName: 'CN', value: 'SignPDF Test Certificate' },
    { shortName: 'O', value: 'SignPDF Test' },
    { shortName: 'OU', value: 'Testing' },
    { shortName: 'C', value: 'ES' },
    { shortName: 'ST', value: 'Test State' },
    { shortName: 'L', value: 'Test City' }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Self-signed

  // Add extensions
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true
    },
    {
      name: 'extKeyUsage',
      emailProtection: true,
      clientAuth: true
    },
    {
      name: 'subjectKeyIdentifier'
    }
  ]);

  // Sign with SHA-256
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Create PKCS#12
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: '3des'
  });
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

  // Write to file
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, Buffer.from(p12Der, 'binary'));

  return outputPath;
}

function formatDate(date) {
  const options = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return date.toLocaleDateString('es-ES', options);
}

module.exports = { loadCertificate, getCertificateInfo, generateTestCertificate };
