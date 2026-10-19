// Headset view: one full-screen shader quad draws both eyes, the lens distortion, the effects and the text panel.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec2 uRes;            // drawing size in device pixels (W, H)
  uniform sampler2D uCam;
  uniform float uHasCam;
  uniform float uCamAspect;     // camera width / height

  // calibration
  uniform float uDistortion;
  uniform float uZoom;
  uniform float uIpd;
  uniform float uVertical;
  uniform float uEyeSize;
  uniform float uRoundness;
  uniform float uNoseWidth;
  uniform float uNoseHeight;
  uniform float uDivider;
  uniform float uTest;

  // effects (in m-space: radius 1 = eye edge)
  uniform vec2 uOffset;
  uniform float uRoll;          // radians
  uniform vec2 uBlur;

  // text panel ("screen mode" picture)
  uniform sampler2D uMsg;
  uniform float uMsgAlpha;
  uniform vec2 uMsgCenter;
  uniform vec2 uMsgHalf;

  // Centre square crop of the camera picture; s in -1..1 covers the square.
  vec3 cam(vec2 s) {
    vec2 sq = s * 0.5 + 0.5;
    vec2 uv = uCamAspect >= 1.0
      ? vec2(0.5 + (sq.x - 0.5) / uCamAspect, sq.y)
      : vec2(sq.x, 0.5 + (sq.y - 0.5) * uCamAspect);
    return texture2D(uCam, clamp(uv, 0.0, 1.0)).rgb;
  }

  float lineMask(float d, float w) {
    return 1.0 - smoothstep(w * 0.5, w, abs(d));
  }

  void main() {
    vec2 frag = gl_FragCoord.xy;
    float W = uRes.x;
    float H = uRes.y;

    // Which eye, and its centre
    float side = frag.x < W * 0.5 ? -1.0 : 1.0;
    vec2 centre = vec2(W * 0.5 + side * uIpd * W * 0.5, H * 0.5 + uVertical * H);
    float R = uEyeSize * H * 0.5;
    vec2 p = (frag - centre) / R;

    // Rounded square (roundness 1 = circle) as a signed distance; negative inside.
    float r = clamp(uRoundness, 0.0, 1.0);
    vec2 q = abs(p) - vec2(1.0 - r);
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    float eyeMask = 1.0 - smoothstep(-0.16, 0.0, d);   // soft vignette near the edge, black outside

    // Barrel distortion (Cardboard style): m = undistorted coordinate, radius 1 at the eye edge.
    float r2 = dot(p, p);
    float k1 = uDistortion;
    float k2 = uDistortion * 0.5;
    vec2 m = p * (1.0 + k1 * r2 + k2 * r2 * r2) / (1.0 + k1 + k2);

    // Camera with effects: shift + rotation, sampled at m / zoom.
    vec3 color = vec3(0.04, 0.06, 0.09);
    if (uHasCam > 0.5) {
      float c = cos(-uRoll);
      float s = sin(-uRoll);
      vec2 e = m - uOffset;
      vec2 sCam = vec2(c * e.x - s * e.y, s * e.x + c * e.y) / uZoom;
      if (dot(uBlur, uBlur) > 0.0) {
        // slight motion blur along the fast movement
        color = cam(sCam) * 0.5 + cam(sCam - uBlur * 0.5 / uZoom) * 0.3 + cam(sCam - uBlur / uZoom) * 0.2;
      } else {
        color = cam(sCam);
      }
    }

    // Calibration test pattern: grid every 0.2, red centre cross, amber ring at radius 1.
    if (uTest > 0.5) {
      color *= 0.3;
      vec2 g = m / 0.2;
      vec2 gd = (fract(g + 0.5) - 0.5) * 0.2;
      float grid = max(lineMask(gd.x, 0.012), lineMask(gd.y, 0.012));
      color = mix(color, vec3(0.85), grid * 0.8);
      float cross = max(lineMask(m.x, 0.025) * step(abs(m.y), 0.35), lineMask(m.y, 0.025) * step(abs(m.x), 0.35));
      color = mix(color, vec3(0.95, 0.15, 0.15), cross);
      float ring = lineMask(length(m) - 1.0, 0.03);
      color = mix(color, vec3(1.0, 0.7, 0.1), ring);
    }

    // Text panel, placed in m-space so it is distorted like the rest.
    if (uMsgAlpha > 0.0) {
      vec2 t = (m - uMsgCenter) / uMsgHalf;
      if (abs(t.x) <= 1.0 && abs(t.y) <= 1.0) {
        vec4 msg = texture2D(uMsg, t * 0.5 + 0.5);
        color = mix(color, msg.rgb, msg.a * uMsgAlpha);
      }
    }

    // Black centre divider
    float dividerMask = step(uDivider * W * 0.5, abs(frag.x - W * 0.5));

    // Nose cutout: half-ellipse at the bottom centre with a soft edge
    float noseMask = 1.0;
    if (uNoseWidth > 0.0 && uNoseHeight > 0.0) {
      vec2 n = vec2((frag.x - W * 0.5) / (uNoseWidth * W * 0.5), frag.y / (uNoseHeight * H));
      noseMask = smoothstep(0.9, 1.0, length(n));
    }

    gl_FragColor = vec4(color * eyeMask * dividerMask * noseMask, 1.0);
  }
`;

export class HeadsetRenderer {
  constructor(canvas) {
    // Colours must reach the screen unchanged.
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1); // full resolution, not capped
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.msgCanvas = document.createElement('canvas');
    this.msgCanvas.width = 1024;
    this.msgCanvas.height = 512;
    this.msgTexture = new THREE.CanvasTexture(this.msgCanvas);
    this.msgTexture.minFilter = THREE.LinearFilter;
    this.msgTexture.generateMipmaps = false;

    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uCam: { value: null },
      uHasCam: { value: 0 },
      uCamAspect: { value: 16 / 9 },
      uDistortion: { value: 0.25 },
      uZoom: { value: 1 },
      uIpd: { value: 0.5 },
      uVertical: { value: 0 },
      uEyeSize: { value: 0.92 },
      uRoundness: { value: 1 },
      uNoseWidth: { value: 0.12 },
      uNoseHeight: { value: 0.22 },
      uDivider: { value: 0.006 },
      uTest: { value: 0 },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uRoll: { value: 0 },
      uBlur: { value: new THREE.Vector2(0, 0) },
      uMsg: { value: this.msgTexture },
      uMsgAlpha: { value: 0 },
      uMsgCenter: { value: new THREE.Vector2(0, 0) },
      uMsgHalf: { value: new THREE.Vector2(0.56, 0.28) },
    };
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    this.pictureSize = 1.6;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.uniforms.uRes.value.copy(size);
  }

  // Camera picture as a texture (LinearFilter, no mipmaps). Pass null to show "no camera".
  setVideo(video) {
    if (this.videoTexture) this.videoTexture.dispose();
    this.videoTexture = null;
    if (video) {
      const tex = new THREE.VideoTexture(video);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      this.videoTexture = tex;
    }
    this.uniforms.uCam.value = this.videoTexture;
    this.uniforms.uHasCam.value = video ? 1 : 0;
  }

  setCalibration(cal, testPattern) {
    const u = this.uniforms;
    u.uDistortion.value = cal.distortion;
    u.uZoom.value = cal.zoom;
    u.uIpd.value = cal.ipd;
    u.uVertical.value = cal.vertical;
    u.uEyeSize.value = cal.eyeSize;
    u.uRoundness.value = cal.roundness;
    u.uNoseWidth.value = cal.noseWidth;
    u.uNoseHeight.value = cal.noseHeight;
    u.uDivider.value = cal.divider;
    u.uTest.value = testPattern ? 1 : 0;
    this.pictureSize = cal.pictureSize;
    this.updateMsgSize();
  }

  // Effects from effects.js (dx/dy = fraction of the eye view, roll in degrees) -> m-space.
  setEffects(fx, blurVec) {
    const u = this.uniforms;
    u.uOffset.value.set(fx.dx * 2, -fx.dy * 2);
    u.uRoll.value = (fx.roll * Math.PI) / 180;
    u.uBlur.value.set(blurVec ? blurVec.x : 0, blurVec ? blurVec.y : 0);
  }

  // Text panel ("picture in screen mode"). text = null hides it. position 'centre' or 'low'.
  setMessage(text, position, alpha, fontFamily) {
    this.uniforms.uMsgAlpha.value = text ? alpha : 0;
    this.uniforms.uMsgCenter.value.set(0, position === 'low' ? -0.45 : 0);
    if (!text || text === this.msgText) return;
    this.msgText = text;
    const c = this.msgCanvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(18, 35, 61, 0.85)';
    g.beginPath();
    g.roundRect(8, 8, c.width - 16, c.height - 16, 60);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 76;
    let lines;
    do {
      g.font = `700 ${size}px ${fontFamily}`;
      lines = wrap(g, text, c.width - 120);
      size -= 4;
    } while (lines.length * size * 1.3 > c.height - 80 && size > 30);
    const lh = (size + 4) * 1.3;
    lines.forEach((ln, i) => g.fillText(ln, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * lh));
    this.msgTexture.needsUpdate = true;
  }

  updateMsgSize() {
    const hw = 0.35 * this.pictureSize; // 1.6 -> half-width 0.56 of the eye radius
    this.uniforms.uMsgHalf.value.set(hw, hw / 2);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

function wrap(g, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}
