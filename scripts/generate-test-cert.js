#!/usr/bin/env node

/**
 * Generate a self-signed test certificate (.p12) for development purposes.
 * Usage: node scripts/generate-test-cert.js [output-path] [password]
 */

const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

const outputPath = process.argv[2] || path.join(__dirname, '..', 'test_certificate.p12');
const password = process.argv[3] || 'test1234';

console.log('🔐 Generando certificado de prueba...\n');

// Generate RSA key pair (2048 bits)
console.log('  → Generando par de claves RSA 2048-bit...');
const keys = forge.pki.rsa.generateKeyPair(2048);

// Create certificate
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));

// Validity: 1 year
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

const attrs = [
  { shortName: 'CN', value: 'SignPDF Test User' },
  { shortName: 'O', value: 'SignPDF Testing' },
  { shortName: 'OU', value: 'Development' },
  { shortName: 'C', value: 'ES' },
  { shortName: 'ST', value: 'Madrid' },
  { shortName: 'L', value: 'Madrid' },
  { name: 'emailAddress', value: 'test@signpdf.local' }
];

cert.setSubject(attrs);
cert.setIssuer(attrs);

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
  { name: 'subjectKeyIdentifier' }
]);

// Sign with SHA-256
console.log('  → Firmando certificado con SHA-256...');
cert.sign(keys.privateKey, forge.md.sha256.create());

// Create PKCS#12
console.log('  → Empaquetando como PKCS#12...');
const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
  algorithm: '3des'
});
const p12Der = forge.asn1.toDer(p12Asn1).getBytes();

// Write file
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.writeFileSync(outputPath, Buffer.from(p12Der, 'binary'));

console.log('\n✅ Certificado generado correctamente!');
console.log(`   📄 Archivo: ${outputPath}`);
console.log(`   🔑 Contraseña: ${password}`);
console.log(`   👤 CN: SignPDF Test User`);
console.log(`   📅 Válido hasta: ${cert.validity.notAfter.toLocaleDateString('es-ES')}`);
console.log('\n⚠️  NOTA: Este certificado es SOLO para pruebas.');
console.log('   Para firmas legalmente válidas, use un certificado de una');
console.log('   Autoridad Certificadora reconocida (FNMT, DNIe, DigiCert, etc.).\n');
