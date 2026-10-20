// Finds the laptop's network addresses and guesses which one the tablet and phone can reach.
// Windows laptops often have extra "virtual" adapters (Hyper-V, WSL, VirtualBox, VMware, Docker, VPNs)
// whose addresses do not work from other devices, so those are listed last.
const os = require('os');

const VIRTUAL = /(vethernet|hyper-v|wsl|virtualbox|vbox|vmware|vmnet|docker|br-|veth|virbr|tailscale|zerotier|hamachi|vpn|tun|tap|utun|loopback|bluetooth)/i;
const WIFI = /(wi-?fi|wlan|wireless|wl)/i;

function score(ip, name) {
  let s = 0;
  if (ip.startsWith('192.168.')) s += 3;
  else if (ip.startsWith('10.')) s += 2;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 1;
  if (WIFI.test(name)) s += 2;
  if (VIRTUAL.test(name)) s -= 10;
  return s;
}

// [{ ip, name, likely }] best first. EAR_HOST_IP=1.2.3.4 forces the address shown first.
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      list.push({ ip: a.address, name, score: score(a.address, name) });
    }
  }
  const forced = process.env.EAR_HOST_IP;
  if (forced) {
    const i = list.findIndex((a) => a.ip === forced);
    if (i >= 0) list[i].score = 100;
    else list.push({ ip: forced, name: 'EAR_HOST_IP', score: 100 });
  }
  list.sort((a, b) => b.score - a.score);
  return list.map(({ ip, name, score: s }) => ({ ip, name, likely: s > -5 }));
}

module.exports = { lanAddresses, score };
