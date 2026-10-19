// Start the Ear & Balance server.
//   npm start            -> HTTPS on port 8443 (+ HTTP on 8080 that redirects to HTTPS)
//   npm run dev          -> plain HTTP on port 8080 (only for testing on this laptop)
const http = require('http');
const https = require('https');
const path = require('path');
const { createApp } = require('./app');
const { loadOrCreateCert, lanAddresses } = require('./certs');

const ROOT = path.join(__dirname, '..');
const dataDir = process.env.EAR_DATA_DIR || path.join(ROOT, 'data');
const mediaDir = process.env.EAR_MEDIA_DIR || path.join(ROOT, 'media');
const httpsPort = Number(process.env.HTTPS_PORT || 8443);
const httpPort = Number(process.env.HTTP_PORT || 8080);
const httpOnly = process.argv.includes('--http') || process.env.EAR_HTTP_ONLY === '1';

async function main() {
  const { app, attach } = createApp({ dataDir, mediaDir });
  const ips = lanAddresses();

  if (httpOnly) {
    const server = http.createServer(app);
    attach(server);
    server.listen(httpPort, () => {
      console.log(`\nEar & Balance (HTTP test mode) running:`);
      console.log(`  http://localhost:${httpPort}/ear`);
      console.log(`  (camera / microphone only work on this laptop in HTTP mode)\n`);
    });
    return;
  }

  const cert = await loadOrCreateCert(path.join(dataDir, 'certs'));
  if (cert.created) console.log('Created a new self-signed certificate in data/certs/');
  const server = https.createServer({ key: cert.key, cert: cert.cert }, app);
  attach(server);
  server.listen(httpsPort, () => {
    console.log('\nEar & Balance is running. Open these addresses:');
    const hosts = ips.length ? ips : ['localhost'];
    for (const ip of hosts) {
      console.log(`  Tablet:   https://${ip}:${httpsPort}/ear`);
      console.log(`  VR phone: https://${ip}:${httpsPort}/vr`);
      console.log(`  Host:     https://${ip}:${httpsPort}/ear/host`);
      console.log(`  Record:   https://${ip}:${httpsPort}/ear/record\n`);
    }
    console.log('Press Ctrl+C to stop.\n');
  });

  // Small helper: http://<ip>:8080/... sends the browser to the HTTPS address.
  http
    .createServer((req, res) => {
      const host = (req.headers.host || 'localhost').replace(/:\d+$/, '');
      res.writeHead(302, { Location: `https://${host}:${httpsPort}${req.url}` });
      res.end();
    })
    .on('error', () => {})
    .listen(httpPort);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
