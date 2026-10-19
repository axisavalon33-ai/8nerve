// Rear camera for the VR phone: best size available, continuous focus / exposure / white balance, zoom 1.0.

const SIZE_ATTEMPTS = [
  { width: { ideal: 1920 }, height: { ideal: 1080 } },
  { width: { ideal: 1280 }, height: { ideal: 720 } },
  {}, // no size – let the phone choose
];

// Permission refused: retrying other sizes is pointless.
export function isPermissionError(err) {
  return !!err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
}

export async function openCamera() {
  let stream = null;
  let lastErr = null;
  for (const size of SIZE_ATTEMPTS) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, frameRate: { ideal: 30 }, ...size },
        audio: false,
      });
      break;
    } catch (err) {
      lastErr = err;
      if (isPermissionError(err)) throw err;
    }
  }
  if (!stream) throw lastErr || new Error('No camera');
  const track = stream.getVideoTracks()[0];

  // Picture smaller than 1280 wide: ask for Full HD at 30 fps, then at least 1280×720.
  if ((track.getSettings().width || 0) < 1280) {
    await tryConstraints(track, { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    if ((track.getSettings().width || 0) < 1280) {
      await tryConstraints(track, { width: { min: 1280 }, height: { min: 720 } });
    }
  }

  // Continuous auto focus / exposure / white balance where supported; zoom stays at 1.0.
  const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
  const advanced = [];
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode']) {
    if (Array.isArray(caps[key]) && caps[key].includes('continuous')) advanced.push({ [key]: 'continuous' });
  }
  if (caps.zoom && typeof caps.zoom.min === 'number') {
    advanced.push({ zoom: Math.min(caps.zoom.max, Math.max(caps.zoom.min, 1)) });
  }
  if (advanced.length) await tryConstraints(track, { advanced });

  const s = track.getSettings();
  return { stream, track, width: s.width || 0, height: s.height || 0 };
}

async function tryConstraints(track, constraints) {
  try {
    await track.applyConstraints(constraints);
    return true;
  } catch {
    return false;
  }
}
