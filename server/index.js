// Start the Ear & Balance server.
//   npm start            -> HTTPS on port 8443 (+ HTTP on 8080 that redirects to HTTPS), opens the host page
//   npm run dev          -> plain HTTP on port 8080 (only for testing on this laptop)
// Set EAR_NO_OPEN=1 to stop the browser opening by itself, EAR_HOST_IP=x.x.x.x to choose the address shown.
const http = require('http');
const https = require('https');
const path = require('path');
const { exec } = require('child_process');
const QRCode = require('qrcode');
const { createApp } = require('./app');
const { loadOrCreateCert } = require('./certs');
const { lanAddresses } = require('./network');
const { digitStatus } = require('./media');

const ROOT = path.join(__dirname, '..');
const dataDir = process.env.EAR_DATA_DIR || path.join(ROOT, 'data');
const mediaDir = process.env.EAR_MEDIA_DIR || path.join(ROOT, 'media');
const httpsPort = Number(process.env.HTTPS_PORT || 8443);
const httpPort = Number(process.env.HTTP_PORT || 8080);
const httpOnly = process.argv.includes('--http') || process.env.EAR_HTTP_ONLY === '1';

// Open a page in the laptop's normal browser.
function openBrowser(url) {
  if (process.env.EAR_NO_OPEN === '1') return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {}); // ignore errors – the address is printed anyway
}

async function printWelcome(protocol, port) {
  const addrs = lanAddresses();
  const best = addrs[0];
  const hostUrl = `${protocol}://localhost:${port}/ear/host`;
  console.log('\n==============================================');
  console.log(' Ear & Balance is running');
  console.log('==============================================');
  console.log(`\n Host page (this laptop): ${hostUrl}`);
  console.log(' It opens by itself. Click "Open visitor screen" there to show the visitor app on the monitor.');
  console.log(` Visitor screen (monitor): ${protocol}://localhost:${port}/ear\n`);
  if (best) {
    const vrUrl = `${protocol}://${best.ip}:${port}/vr`;
    console.log(` VR phone: scan this QR code, or type ${vrUrl}`);
    console.log(await QRCode.toString(vrUrl, { type: 'terminal', small: true }));
    if (addrs.length > 1) {
      console.log('\n If that does not open on the phone, try another address of this laptop:');
      for (const a of addrs.slice(1)) console.log(`   ${protocol}://${a.ip}:${port}/vr   (${a.name})`);
    }
  } else {
    console.log(' ! This laptop is not connected to any network. Connect it to the Wi-Fi and restart.');
  }
  console.log('\n Press Ctrl+C to stop.\n');
  openBrowser(hostUrl);
}

// Make any missing placeholder digits (espeak-ng) in the background.
async function makeMissingDigits(runGenerate) {
  const status = digitStatus(mediaDir);
  if (Object.values(status).every((s) => s.generatedCount === 10)) return;
  const r = await runGenerate(false);
  if (r.error === 'espeak-ng is not installed') {
    console.log(' ! Placeholder digits not made: espeak-ng is not installed (see README, "Digit audio").\n');
  } else if (r.made) {
    console.log(` Made ${r.made} placeholder digit recordings with espeak-ng.${r.failed && r.failed.length ? ' Problems: ' + r.failed.join('; ') : ''}\n`);
  }
}

async function main() {
  const protocol = httpOnly ? 'http' : 'https';
  const port = httpOnly ? httpPort : httpsPort;
  const { app, attach, runGenerate } = createApp({ dataDir, mediaDir, links: { protocol, port } });
  makeMissingDigits(runGenerate).catch((e) => console.error(e));

  if (httpOnly) {
    const server = http.createServer(app);
    attach(server);
    server.listen(httpPort, () => {
      console.log('\n(HTTP test mode: camera / microphone only work on this laptop)');
      printWelcome(protocol, port);
    });
    return;
  }

  const cert = await loadOrCreateCert(path.join(dataDir, 'certs'));
  if (cert.created) console.log('Created a new self-signed certificate in data/certs/');
  const server = https.createServer({ key: cert.key, cert: cert.cert }, app);
  attach(server);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\n! Port ${httpsPort} is busy – is the station already running in another window?\n`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(httpsPort, () => printWelcome(protocol, port));

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
