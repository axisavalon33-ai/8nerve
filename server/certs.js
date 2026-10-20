// Creates (once) a self-signed HTTPS certificate for this laptop.
// Phones and tablets need HTTPS for the camera, microphone and motion sensors.
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const { lanAddresses } = require('./network');

async function loadOrCreateCert(certDir) {
  const keyFile = path.join(certDir, 'key.pem');
  const certFile = path.join(certDir, 'cert.pem');
  const metaFile = path.join(certDir, 'meta.json');
  const ips = lanAddresses().map((a) => a.ip);

  // Re-use the existing certificate if it already covers every current IP address.
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const covered = ips.every((ip) => meta.ips.includes(ip));
    const valid = new Date(meta.notAfter) > new Date(Date.now() + 7 * 864e5);
    if (covered && valid) {
      return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), created: false, ips };
    }
  } catch {
    /* create a new one */
  }

  const allIps = [...new Set([...ips, '127.0.0.1'])];
  const notBefore = new Date(Date.now() - 864e5);
  const notAfter = new Date(notBefore);
  notAfter.setFullYear(notAfter.getFullYear() + 3);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'ear-balance.local' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 2, value: 'ear-balance.local' },
          ...allIps.map((ip) => ({ type: 7, ip })),
        ],
      },
    ],
  });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private);
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(metaFile, JSON.stringify({ ips: allIps, notAfter: notAfter.toISOString() }, null, 2));
  return { key: pems.private, cert: pems.cert, created: true, ips };
}

module.exports = { loadOrCreateCert };
