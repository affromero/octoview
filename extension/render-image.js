// octoview scientific-image renderer, lazy-imported inline for .exr/.hdr/.tif(f).
// three.js's loaders PARSE the bytes on the main thread (WebKit safe) and share
// the same vendored bundle as the 3D renderer. HDR formats (EXR, Radiance HDR)
// carry linear float pixels beyond [0,1], so GitHub cannot show them meaningfully;
// octoview tone-maps them to a canvas with an exposure slider. TIFF is 8-bit RGBA.
import { THREE, EXRLoader, RGBELoader, TIFFLoader } from './vendor/three3d.esm.js';

// ponytail: renders at the image's native resolution (CSS-scaled to fit). Fine
// for typical previews; add stride-downsampling if multi-thousand-px HDRs appear.
export function renderImage(buf, mount, ext) {
  mount.textContent = '';
  mount.style.position = 'relative';
  try {
    if (ext === '.tif' || ext === '.tiff') {
      drawLDR(new TIFFLoader().parse(buf), mount);
    } else {
      const loader = ext === '.exr' ? new EXRLoader() : new RGBELoader();
      loader.type = THREE.FloatType;
      drawHDR(loader.parse(buf), mount, ext === '.exr' ? 'EXR' : 'Radiance HDR');
    }
  } catch (e) {
    const p = document.createElement('p');
    p.className = 'ov-msg';
    p.textContent = 'Image preview failed: ' + ((e && e.message) || e);
    mount.appendChild(p);
  }
}

function meta(mount, text) {
  const d = document.createElement('div');
  d.className = 'ov-arr-meta';
  d.textContent = text;
  mount.appendChild(d);
}

function drawLDR(tex, mount) {
  const { data, width, height } = tex;
  meta(mount, `${width} × ${height}  ·  TIFF  ·  8-bit`);
  const canvas = document.createElement('canvas');
  canvas.className = 'ov-arr-canvas';
  canvas.width = width;
  canvas.height = height;
  const img = new ImageData(new Uint8ClampedArray(data), width, height);
  canvas.getContext('2d').putImageData(img, 0, 0);
  canvas.style.width = Math.min(width, 900) + 'px';
  mount.appendChild(canvas);
}

function drawHDR(tex, mount, label) {
  const { data, width, height } = tex;
  // Gray-world auto exposure: aim average luminance at mid-gray. Ignore negative
  // and non-finite samples (valid in EXR) so the exposure stays finite.
  let sum = 0;
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 100000));
  let counted = 0;
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    const lum = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    if (isFinite(lum) && lum > 0) {
      sum += lum;
      counted++;
    }
  }
  const avg = counted ? sum / counted : 0.18;
  const autoEV = Math.log2(0.18 / (avg + 1e-6));

  meta(mount, `${width} × ${height}  ·  ${label}  ·  linear float`);

  const canvas = document.createElement('canvas');
  canvas.className = 'ov-arr-canvas';
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = Math.min(width, 900) + 'px';
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(width, height);

  const tonemap = (ev) => {
    const exposure = Math.pow(2, ev);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      for (let c = 0; c < 3; c++) {
        let v = data[o + c] * exposure;
        v = v > 0 && isFinite(v) ? v : 0; // clamp negatives / NaN before tone mapping
        v = v / (1 + v); // Reinhard
        out.data[o + c] = Math.pow(v, 1 / 2.2) * 255;
      }
      out.data[o + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  };
  tonemap(autoEV);
  mount.appendChild(canvas);

  // Exposure slider (matches the point-cloud sliders' spirit).
  const panel = document.createElement('label');
  panel.className = 'ov-img-panel';
  panel.append('Exposure');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = autoEV - 6;
  slider.max = autoEV + 6;
  slider.step = 0.1;
  slider.value = autoEV;
  slider.oninput = () => tonemap(parseFloat(slider.value));
  panel.appendChild(slider);
  mount.appendChild(panel);
}
