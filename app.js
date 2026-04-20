const fileInput = document.getElementById('fileInput');
const workspace = document.getElementById('workspace');
const results = document.getElementById('results');
const previewImage = document.getElementById('previewImage');
const livePreviewImage = document.getElementById('livePreviewImage');
const imageStats = document.getElementById('imageStats');
const swatches = document.getElementById('swatches');
const exportBtn = document.getElementById('exportBtn');
const toleranceInput = document.getElementById('toleranceInput');
const toleranceValue = document.getElementById('toleranceValue');
const halftoneToggle = document.getElementById('halftoneToggle');
const registrationToggle = document.getElementById('registrationToggle');
const exportLinks = document.getElementById('exportLinks');
const previewNotes = document.getElementById('previewNotes');
const selectionSummary = document.getElementById('selectionSummary');

const state = {
  imageData: null,
  width: 0,
  height: 0,
  colors: [],
  previewTimer: null,
  typingPlate: false,
  previewUrl: '',
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rgbToHex(rgb) { return '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''); }
function hexToRgb(hex) {
  const value = hex.replace('#', '').trim();
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}
function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function defaultPlateName(color, idx) {
  if (color.kind === 'white') return 'white';
  if (color.kind === 'black') return 'black';
  if (idx === 2) return 'green';
  if (idx === 3) return 'pink';
  return color.hex;
}
function schedulePreview(delay = 180) {
  if (!state.imageData || state.typingPlate) return;
  clearTimeout(state.previewTimer);
  state.previewTimer = setTimeout(runPreview, delay);
}
function buildMergeOptions(color, idx) {
  const options = ['<option value="">nearest kept plate</option>'];
  state.colors.forEach((target, targetIdx) => {
    if (targetIdx === idx) return;
    options.push(`<option value="${target.hex}" ${color.merge_into === target.hex ? 'selected' : ''}>${escapeHtml(target.name || target.hex)}</option>`);
  });
  return options.join('');
}

async function rasterizeSvgInBrowser(file) {
  const svgText = await file.text();
  const svgBlob = new Blob([svgText], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('SVG could not be loaded in the browser.'));
    });
    img.src = url;
    await loaded;
    const maxSize = 1200;
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return {
      width,
      height,
      imageData: ctx.getImageData(0, 0, width, height),
      previewUrl: canvas.toDataURL('image/png'),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadRasterFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Image could not be loaded.'));
    });
    img.src = url;
    await loaded;
    const maxSize = 1200;
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return {
      width,
      height,
      imageData: ctx.getImageData(0, 0, width, height),
      previewUrl: canvas.toDataURL('image/png'),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function detectColors(imageData) {
  const data = imageData.data;
  const totalPixels = imageData.width * imageData.height;
  let visibleCount = 0;
  let whiteCount = 0;
  let blackCount = 0;
  const buckets = new Map();

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= 10) continue;
    visibleCount += 1;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
    const min = Math.min(...rgb);
    const max = Math.max(...rgb);

    if (lum >= 245 && min >= 235) {
      whiteCount += 1;
      continue;
    }
    if (lum <= 35 && max <= 55) {
      blackCount += 1;
      continue;
    }

    const q = rgb.map(v => Math.round(v / 16) * 16);
    const key = q.join(',');
    const hit = buckets.get(key) || { sum: [0, 0, 0], count: 0 };
    hit.sum[0] += rgb[0];
    hit.sum[1] += rgb[1];
    hit.sum[2] += rgb[2];
    hit.count += 1;
    buckets.set(key, hit);
  }

  let colors = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => {
      const rgb = entry.sum.map(v => Math.round(v / entry.count));
      return {
        rgb,
        hex: rgbToHex(rgb),
        percentage: +(entry.count / Math.max(visibleCount, 1) * 100).toFixed(2),
        pixel_count: entry.count,
        kind: 'normal',
      };
    });

  const merged = [];
  for (const color of colors) {
    const existing = merged.find(m => colorDistance(m.rgb, color.rgb) <= 18);
    if (!existing) merged.push({ ...color });
    else {
      const total = existing.pixel_count + color.pixel_count;
      existing.rgb = existing.rgb.map((v, idx) => Math.round((v * existing.pixel_count + color.rgb[idx] * color.pixel_count) / total));
      existing.hex = rgbToHex(existing.rgb);
      existing.pixel_count = total;
      existing.percentage = +(existing.percentage + color.percentage).toFixed(2);
    }
  }

  const protectedColors = [];
  if (whiteCount) {
    protectedColors.push({ rgb: [255,255,255], hex: '#ffffff', percentage: +(whiteCount / Math.max(visibleCount,1) * 100).toFixed(2), pixel_count: whiteCount, kind: 'white', name: 'white' });
  }
  if (blackCount) {
    protectedColors.push({ rgb: [0,0,0], hex: '#000000', percentage: +(blackCount / Math.max(visibleCount,1) * 100).toFixed(2), pixel_count: blackCount, kind: 'black', name: 'black' });
  }

  return protectedColors.concat(merged.map((c, idx) => ({ ...c, name: c.name || defaultPlateName(c, idx) })));
}

function getSelectedColors() {
  return state.colors.filter(c => c.enabled);
}

function resolveTargetMap() {
  const selected = getSelectedColors();
  const selectedLookup = new Map(selected.map((item, idx) => [item.hex.toLowerCase(), idx]));
  const selectedByKind = new Map(selected.map((item, idx) => [item.kind, idx]));
  const mapping = new Map();

  state.colors.forEach((color, idx) => {
    const ownHex = color.hex.toLowerCase();
    if (selectedLookup.has(ownHex)) {
      mapping.set(idx, selectedLookup.get(ownHex));
      return;
    }
    const mergeInto = (color.merge_into || '').toLowerCase();
    if (mergeInto && selectedLookup.has(mergeInto) && mergeInto !== ownHex) {
      mapping.set(idx, selectedLookup.get(mergeInto));
      return;
    }
    if ((color.kind === 'white' || color.kind === 'black') && selectedByKind.has(color.kind)) {
      mapping.set(idx, selectedByKind.get(color.kind));
      return;
    }
    let nearest = 0;
    let best = Infinity;
    selected.forEach((target, j) => {
      const d = colorDistance(color.rgb, target.rgb);
      if (d < best) {
        best = d;
        nearest = j;
      }
    });
    mapping.set(idx, nearest);
  });
  return { mapping, selected };
}

function detectPixelColorIndex(rgb) {
  const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const min = Math.min(...rgb);
  const max = Math.max(...rgb);
  if (state.colors.some(c => c.kind === 'white') && lum >= 245 && min >= 235) {
    return state.colors.findIndex(c => c.kind === 'white');
  }
  if (state.colors.some(c => c.kind === 'black') && lum <= 35 && max <= 55) {
    return state.colors.findIndex(c => c.kind === 'black');
  }
  let bestIdx = 0;
  let best = Infinity;
  state.colors.forEach((color, idx) => {
    const d = colorDistance(rgb, color.rgb);
    if (d < best) {
      best = d;
      bestIdx = idx;
    }
  });
  return bestIdx;
}

const BAYER_8 = [
  [0,48,12,60,3,51,15,63],
  [32,16,44,28,35,19,47,31],
  [8,56,4,52,11,59,7,55],
  [40,24,36,20,43,27,39,23],
  [2,50,14,62,1,49,13,61],
  [34,18,46,30,33,17,45,29],
  [10,58,6,54,9,57,5,53],
  [42,26,38,22,41,25,37,21],
];

function shouldPrintPixel(x, y, pixelRgb, targetRgb, strength, halftoneEnabled, kind) {
  if (kind === 'white') return true;
  const dist = colorDistance(pixelRgb, targetRgb);
  const printThreshold = 34 + (100 - strength) * 0.16;
  if (!halftoneEnabled || kind === 'black') {
    return dist <= printThreshold;
  }
  const solidThreshold = 10 + (100 - strength) * 0.08;
  const fadeThreshold = 58 + (100 - strength) * 0.18;
  if (dist <= solidThreshold) return true;
  if (dist >= fadeThreshold) return false;
  const tone = clamp((dist - solidThreshold) / Math.max(fadeThreshold - solidThreshold, 1), 0, 1);
  const matrixThreshold = (BAYER_8[y % 8][x % 8] + 0.5) / 64;
  return matrixThreshold >= Math.min(0.98, tone * 1.08 + 0.04);
}

function addRegistrationMarks(ctx, width, height) {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  const marks = [
    [28, 28],
    [width - 28, 28],
    [28, height - 28],
    [width - 28, height - 28],
  ];
  for (const [x, y] of marks) {
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
    ctx.stroke();
  }
}

function buildPlates() {
  const imageData = state.imageData;
  const width = imageData.width;
  const height = imageData.height;
  const { selected, mapping } = resolveTargetMap();
  if (!selected.length) throw new Error('Pick at least one final plate.');

  const tolerance = Number(toleranceInput.value);
  const halftone = halftoneToggle.checked;
  const source = imageData.data;
  const plateData = selected.map(() => new Uint8ClampedArray(width * height));
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  const compositeCtx = compositeCanvas.getContext('2d');
  const compositeImage = compositeCtx.createImageData(width, height);
  const out = compositeImage.data;

  for (let i = 0, p = 0; i < source.length; i += 4, p += 1) {
    const x = p % width;
    const y = Math.floor(p / width);
    const alpha = source[i + 3];
    if (alpha <= 10) {
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255; out[i + 3] = 255;
      continue;
    }
    const rgb = [source[i], source[i + 1], source[i + 2]];
    const sourceIdx = detectPixelColorIndex(rgb);
    const targetIdx = mapping.get(sourceIdx);
    const target = selected[targetIdx];
    let printed = false;

    for (let j = 0; j < selected.length; j += 1) {
      if (j !== targetIdx) continue;
      const yes = shouldPrintPixel(x, y, rgb, target.rgb, tolerance, halftone, target.kind);
      if (yes) {
        plateData[j][p] = 1;
        printed = true;
      }
    }

    if (printed) {
      out[i] = target.rgb[0];
      out[i + 1] = target.rgb[1];
      out[i + 2] = target.rgb[2];
    } else {
      out[i] = 255; out[i + 1] = 255; out[i + 2] = 255;
    }
    out[i + 3] = 255;
  }

  compositeCtx.putImageData(compositeImage, 0, 0);
  if (registrationToggle.checked) addRegistrationMarks(compositeCtx, width, height);

  return { selected, plateData, compositeCanvas, width, height };
}

function renderSwatches() {
  swatches.innerHTML = '';
  state.colors.forEach((color, idx) => {
    const row = document.createElement('div');
    row.className = 'swatch-row';
    row.innerHTML = `
      <div class="swatch-left">
        <input type="checkbox" ${color.enabled ? 'checked' : ''} />
        <span class="chip ${color.kind === 'white' ? 'chip-light' : ''}" style="background:${color.hex}"></span>
      </div>
      <div class="swatch-meta">
        <strong>${color.hex}</strong>
        <small>${color.percentage}% of artwork${color.kind !== 'normal' ? ` • ${color.kind} plate` : ''}</small>
      </div>
      <input class="plate-name" type="text" value="${escapeHtml(color.name || color.hex)}" aria-label="Plate name" />
      <select class="merge-target" aria-label="Merge target">${buildMergeOptions(color, idx)}</select>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
      state.colors[idx].enabled = e.target.checked;
      renderSwatches();
      schedulePreview();
    });
    const plateNameInput = row.querySelector('.plate-name');
    plateNameInput.addEventListener('focus', () => { state.typingPlate = true; });
    plateNameInput.addEventListener('input', (e) => { state.colors[idx].name = e.target.value; });
    plateNameInput.addEventListener('blur', (e) => {
      state.colors[idx].name = e.target.value.trim() || defaultPlateName(color, idx);
      state.typingPlate = false;
      renderSwatches();
    });
    row.querySelector('.merge-target').addEventListener('change', (e) => {
      state.colors[idx].merge_into = e.target.value;
      schedulePreview(80);
    });
    swatches.appendChild(row);
  });
}

function runPreview() {
  try {
    const { selected, compositeCanvas } = buildPlates();
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    compositeCanvas.toBlob((blob) => {
      if (!blob) return;
      state.previewUrl = URL.createObjectURL(blob);
      livePreviewImage.src = state.previewUrl;
    }, 'image/png');
    selectionSummary.textContent = `${selected.length} kept plate${selected.length === 1 ? '' : 's'}`;
    previewNotes.textContent = 'Flat fills stay solid. Unchecked colors are reassigned to the closest kept plate unless you pick a merge target.';
    exportBtn.disabled = false;
  } catch (err) {
    selectionSummary.textContent = 'Preview failed';
    previewNotes.textContent = err.message;
    exportBtn.disabled = true;
  }
}

toleranceInput.addEventListener('input', () => {
  toleranceValue.textContent = toleranceInput.value;
  schedulePreview();
});
halftoneToggle.addEventListener('change', () => schedulePreview(80));
registrationToggle.addEventListener('change', () => schedulePreview(80));

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Analyzing...';
  results.classList.add('hidden');
  try {
    const loaded = (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml')
      ? await rasterizeSvgInBrowser(file)
      : await loadRasterFile(file);
    state.imageData = loaded.imageData;
    state.width = loaded.width;
    state.height = loaded.height;
    state.colors = detectColors(loaded.imageData).map((c, idx) => ({
      ...c,
      enabled: true,
      merge_into: '',
      name: c.name || defaultPlateName(c, idx),
    }));
    previewImage.src = loaded.previewUrl;
    imageStats.textContent = `${loaded.width} × ${loaded.height}px`;
    renderSwatches();
    workspace.classList.remove('hidden');
    exportBtn.disabled = false;
    exportBtn.textContent = 'Export separations';
    schedulePreview(40);
  } catch (err) {
    exportBtn.textContent = 'Export separations';
    alert(err.message);
  }
});

exportBtn.addEventListener('click', async () => {
  try {
    const { selected, plateData, compositeCanvas, width, height } = buildPlates();
    const zip = new JSZip();
    for (let j = 0; j < selected.length; j += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      const img = ctx.createImageData(width, height);
      const out = img.data;
      const bits = plateData[j];
      for (let p = 0, i = 0; p < bits.length; p += 1, i += 4) {
        const v = bits[p] ? 0 : 255;
        out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (registrationToggle.checked) addRegistrationMarks(ctx, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const filename = `${String(j + 1).padStart(2, '0')}_${(selected[j].name || 'plate').toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${selected[j].hex.replace('#','')}.png`;
      zip.file(filename, blob);
    }
    const compositeBlob = await new Promise(resolve => compositeCanvas.toBlob(resolve, 'image/png'));
    zip.file('composite-preview.png', compositeBlob);
    zip.file('job-sheet.json', JSON.stringify({
      plates: selected.map((p) => ({ name: p.name, hex: p.hex, kind: p.kind })),
      tolerance: Number(toleranceInput.value),
      halftone: halftoneToggle.checked,
      registration_marks: registrationToggle.checked,
      width,
      height,
      notes: 'Black pixels are where ink prints. White is open screen. Unchecked colors are reassigned to the closest kept plate unless a merge target is chosen. Registration marks are included when enabled.'
    }, null, 2));
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const compositeUrl = URL.createObjectURL(compositeBlob);
    exportLinks.innerHTML = `
      <a class="primary" href="${zipUrl}" download="spotsep-separations.zip">Download ZIP of plates</a>
      <a href="${compositeUrl}" target="_blank" rel="noreferrer">Open final composite preview</a>
    `;
    results.classList.remove('hidden');
  } catch (err) {
    alert(err.message);
  }
});
