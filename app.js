const imageInput = document.getElementById('imageInput');
const ratioSelect = document.getElementById('ratioSelect');
const sizeSelect = document.getElementById('sizeSelect');
const fitModeSelect = document.getElementById('fitModeSelect');
const ditherToggle = document.getElementById('ditherToggle');
const ditherMethodSelect = document.getElementById('ditherMethodSelect');
const brightnessRange = document.getElementById('brightnessRange');
const contrastRange = document.getElementById('contrastRange');
const temperatureRange = document.getElementById('temperatureRange');
const downloadButton = document.getElementById('downloadButton');
const outputCanvas = document.getElementById('outputCanvas');
const outputCtx = outputCanvas.getContext('2d');

const SIZE_PRESETS = {
  '16:9': ['150x84', '100x56', '50x28', '30x18'],
  '4:3': ['150x114', '100x76', '50x38', '30x24'],
  '1:1': ['150x150', '100x100', '50x50', '30x30'],
  '3:4': ['114x150', '76x100', '38x50', '24x30'],
  '9:16': ['84x150', '56x100', '28x50', '18x30'],
};

const DEFAULT_PALETTE_HEX = [
  '#000000',
  '#404040',
  '#808080',
  '#bfbfbf',
  '#ffffff',
  '#bd3f49',
  '#de7474',
  '#982b3c',
  '#ea855d',
  '#da6335',
  '#715b5c',
  '#bcacad',
  '#e3d6d4',
  '#5f2b33',
  '#995d5b',
  '#be8484',
  '#eaada8',
  '#e5d5d4',
  '#6b372b',
  '#a56c57',
  '#cf957e',
  '#f2bca3',
  '#9e4428',
  '#e69f37',
  '#f3af50',
  '#a66e23',
  '#f5ce97',
  '#d2a673',
  '#ac7f52',
  '#714d27',
  '#f1e2cf',
  '#cabbaa',
  '#c4bea4',
  '#ede6c8',
  '#715f2f',
  '#a89453',
  '#cebe77',
  '#f6e69c',
  '#ad922b',
  '#f3d955',
  '#e8ca44',
  '#766f5b',
  '#aab83b',
  '#b7c74c',
  '#768327',
  '#d9dd9c',
  '#adb379',
  '#858e4d',
  '#545b24',
  '#e6e9ca',
  '#2e5039',
  '#588665',
  '#83ae8e',
  '#a9d7b1',
  '#306f46',
  '#63b67c',
  '#479e5e',
  '#bcc0a3',
  '#6e715c',
  '#c9decb',
  '#a1b5a6',
  '#57655c',
  '#39827d',
  '#4aa69d',
  '#276461',
  '#8fcac2',
  '#427771',
  '#67a199',
  '#6090a2',
  '#87b9c8',
  '#225370',
  '#4396b6',
  '#2e6e97',
  '#536462',
  '#9eb4b3',
  '#c6dfd8',
  '#1a4444',
  '#38687a',
  '#1b4456',
  '#c8dbde',
  '#a1b2b6',
  '#53646a',
  '#2559a1',
  '#447eba',
  '#193f7a',
  '#88a5c3',
  '#3b3275',
  '#7374b6',
  '#50499b',
  '#4f5664',
  '#9ca4ad',
  '#c2cad1',
  '#1b314d',
  '#637b9b',
  '#3b5778',
  '#a19ec5',
  '#76769c',
  '#535174',
  '#302d4e',
  '#c9cad3',
  '#a0a0ac',
  '#54555e',
  '#733d7d',
  '#9567a3',
  '#a03869',
  '#5e515f',
  '#a8a0a9',
  '#cec6cf',
  '#3e2843',
  '#664a6e',
  '#8c7190',
  '#ae9db3',
  '#5a2863',
  '#c16b8c',
  '#7b2653',
  '#d0a2b2',
  '#ab7a8b',
  '#835264',
  '#593046',
];

const DITHER_CONFIG = {
  minAlphaToProcess: 1,
  fsErrorScale: 1,
  fsWeights: [
    { x: 1, y: 0, weight: 7 / 16 },
    { x: -1, y: 1, weight: 3 / 16 },
    { x: 0, y: 1, weight: 5 / 16 },
    { x: 1, y: 1, weight: 1 / 16 },
  ],
  orderedMatrix: [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ],
  orderedStrength: 0.1,
};

function hexToRgb(hex) {
  const normalizedHex = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalizedHex)) {
    throw new Error(`無効な16進カラーコードです: ${hex}`);
  }

  return [
    Number.parseInt(normalizedHex.slice(0, 2), 16),
    Number.parseInt(normalizedHex.slice(2, 4), 16),
    Number.parseInt(normalizedHex.slice(4, 6), 16),
  ];
}

const DEFAULT_PALETTE = DEFAULT_PALETTE_HEX.map(hexToRgb);

let sourceImage = null;
let cachedFile = null;
let renderDebounceTimer = null;
const pointerState = {
  isPointerDown: false,
  pointerId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
};

export function loadImage(file) {
  if (!(file instanceof File)) {
    return Promise.reject(new Error('有効な画像ファイルを選択してください。'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像データの解析に失敗しました。'));
      img.onload = () => resolve(img);
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function resizeToTarget(image, targetWidth, targetHeight, mode = 'fit') {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const ctx = tempCanvas.getContext('2d');

  if (mode === 'stretch') {
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    return tempCanvas;
  }

  const scaleX = targetWidth / image.width;
  const scaleY = targetHeight / image.height;
  const scale = mode === 'fill' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  return tempCanvas;
}

function nearestColor(pixel, palette) {
  let nearest = palette[0];
  let minDist = Number.POSITIVE_INFINITY;

  for (const color of palette) {
    const dr = pixel[0] - color[0];
    const dg = pixel[1] - color[1];
    const db = pixel[2] - color[2];
    const distance = dr * dr + dg * dg + db * db;

    if (distance < minDist) {
      minDist = distance;
      nearest = color;
    }
  }

  return nearest;
}

function clampToByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function quantizeWithoutDither(data, palette, minAlphaToProcess) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < minAlphaToProcess) {
      continue;
    }

    const replacement = nearestColor([data[i], data[i + 1], data[i + 2]], palette);
    data[i] = replacement[0];
    data[i + 1] = replacement[1];
    data[i + 2] = replacement[2];
  }
}

function quantizeWithFloydSteinberg(data, width, height, palette, config) {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < config.minAlphaToProcess) {
        continue;
      }

      const oldR = data[index];
      const oldG = data[index + 1];
      const oldB = data[index + 2];
      const replacement = nearestColor([oldR, oldG, oldB], palette);

      data[index] = replacement[0];
      data[index + 1] = replacement[1];
      data[index + 2] = replacement[2];

      const errR = (oldR - replacement[0]) * config.fsErrorScale;
      const errG = (oldG - replacement[1]) * config.fsErrorScale;
      const errB = (oldB - replacement[2]) * config.fsErrorScale;

      for (const weightDef of config.fsWeights) {
        const nx = x + weightDef.x;
        const ny = y + weightDef.y;

        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }

        const nextIndex = (ny * width + nx) * 4;
        if (data[nextIndex + 3] < config.minAlphaToProcess) {
          continue;
        }

        data[nextIndex] = clampToByte(data[nextIndex] + errR * weightDef.weight);
        data[nextIndex + 1] = clampToByte(data[nextIndex + 1] + errG * weightDef.weight);
        data[nextIndex + 2] = clampToByte(data[nextIndex + 2] + errB * weightDef.weight);
      }
    }
  }
}

function quantizeWithOrderedDither(data, width, height, palette, config) {
  const matrix = config.orderedMatrix;
  const matrixSize = matrix.length;
  const matrixLevels = matrixSize * matrixSize;
  const strength = config.orderedStrength;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < config.minAlphaToProcess) {
        continue;
      }

      const threshold = (matrix[y % matrixSize][x % matrixSize] + 0.5) / matrixLevels - 0.5;
      const offset = threshold * 255 * strength;
      const adjustedPixel = [
        clampToByte(data[index] + offset),
        clampToByte(data[index + 1] + offset),
        clampToByte(data[index + 2] + offset),
      ];

      const replacement = nearestColor(adjustedPixel, palette);
      data[index] = replacement[0];
      data[index + 1] = replacement[1];
      data[index + 2] = replacement[2];
    }
  }
}

export function quantizeToPalette(
  canvas,
  palette = DEFAULT_PALETTE,
  options = {},
) {
  const { dither = false, ditherMethod = 'floyd-steinberg' } = options;

  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  if (!dither) {
    quantizeWithoutDither(data, palette, DITHER_CONFIG.minAlphaToProcess);
  } else if (ditherMethod === 'ordered') {
    quantizeWithOrderedDither(data, width, height, palette, DITHER_CONFIG);
  } else {
    quantizeWithFloydSteinberg(data, width, height, palette, DITHER_CONFIG);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function applyColorAdjustments(
  canvas,
  { brightness = 0, contrast = 0, temperature = 0 } = {},
) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  const brightnessOffset = (brightness / 100) * 255;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const temperatureOffset = (temperature / 100) * 64;
  const greenTemperatureOffset = temperatureOffset * 0.2;

  for (let i = 0; i < data.length; i += 4) {
    const brightR = data[i] + brightnessOffset;
    const brightG = data[i + 1] + brightnessOffset;
    const brightB = data[i + 2] + brightnessOffset;

    const contrastedR = (brightR - 128) * contrastFactor + 128;
    const contrastedG = (brightG - 128) * contrastFactor + 128;
    const contrastedB = (brightB - 128) * contrastFactor + 128;

    data[i] = clampToByte(contrastedR + temperatureOffset);
    data[i + 1] = clampToByte(contrastedG + greenTemperatureOffset);
    data[i + 2] = clampToByte(contrastedB - temperatureOffset);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function exportPng(canvas, filename = 'output.png') {
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = filename;
  link.click();
}

function parseSize(text) {
  const [width, height] = text.split('x').map(Number);
  return { width, height };
}

function validateRatio(size, ratioText) {
  const [rw, rh] = ratioText.split(':').map(Number);
  return Math.abs(size.width / size.height - rw / rh) < 0.01;
}

function formatSizeLabel(sizeText) {
  const { width, height } = parseSize(sizeText);
  return `${width} x ${height}`;
}

function rebuildSizeOptionsForRatio(ratio) {
  const allowedSizes = SIZE_PRESETS[ratio] ?? [];
  const previousValue = sizeSelect.value;
  sizeSelect.innerHTML = '';

  for (const sizeText of allowedSizes) {
    const option = document.createElement('option');
    option.value = sizeText;
    option.textContent = formatSizeLabel(sizeText);
    sizeSelect.append(option);
  }

  if (allowedSizes.includes(previousValue)) {
    sizeSelect.value = previousValue;
  } else if (allowedSizes.length > 0) {
    sizeSelect.value = allowedSizes[0];
  }
}

async function renderPreview() {
  try {
    const file = imageInput.files?.[0];
    if (!file) {
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      downloadButton.disabled = true;
      return;
    }

    if (cachedFile !== file || !sourceImage) {
      sourceImage = await loadImage(file);
      cachedFile = file;
    }

    const selectedSize = parseSize(sizeSelect.value);
    const mode = fitModeSelect.value;

    if (!validateRatio(selectedSize, ratioSelect.value)) {
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      downloadButton.disabled = true;
      return;
    }

    const resizedCanvas = resizeToTarget(sourceImage, selectedSize.width, selectedSize.height, mode);
    applyColorAdjustments(resizedCanvas, {
      brightness: Number(brightnessRange.value),
      contrast: Number(contrastRange.value),
      temperature: Number(temperatureRange.value),
    });

    const processedCanvas = quantizeToPalette(resizedCanvas, undefined, {
      dither: ditherToggle.checked,
      ditherMethod: ditherMethodSelect.value,
    });

    outputCanvas.width = processedCanvas.width;
    outputCanvas.height = processedCanvas.height;
    outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.drawImage(processedCanvas, 0, 0);

    downloadButton.disabled = false;
  } catch (error) {
    alert(error instanceof Error ? error.message : '画像処理中にエラーが発生しました。');
  }
}

function scheduleRenderPreview() {
  if (renderDebounceTimer) {
    clearTimeout(renderDebounceTimer);
  }

  renderDebounceTimer = setTimeout(() => {
    renderDebounceTimer = null;
    renderPreview();
  }, 100);
}

imageInput.addEventListener('change', () => {
  sourceImage = null;
  cachedFile = null;
  scheduleRenderPreview();
});
ratioSelect.addEventListener('change', () => {
  rebuildSizeOptionsForRatio(ratioSelect.value);
  scheduleRenderPreview();
});
sizeSelect.addEventListener('change', scheduleRenderPreview);
fitModeSelect.addEventListener('change', scheduleRenderPreview);
ditherToggle.addEventListener('change', scheduleRenderPreview);
ditherMethodSelect.addEventListener('change', scheduleRenderPreview);
brightnessRange.addEventListener('input', scheduleRenderPreview);
contrastRange.addEventListener('input', scheduleRenderPreview);
temperatureRange.addEventListener('input', scheduleRenderPreview);

downloadButton.addEventListener('click', () => {
  exportPng(outputCanvas, 'resized-quantized.png');
});

function updatePointerStateFromEvent(event) {
  pointerState.lastX = event.offsetX;
  pointerState.lastY = event.offsetY;
}

function onCanvasPointerDown(event) {
  pointerState.isPointerDown = true;
  pointerState.pointerId = event.pointerId;
  pointerState.startX = event.offsetX;
  pointerState.startY = event.offsetY;
  updatePointerStateFromEvent(event);
  outputCanvas.setPointerCapture(event.pointerId);
}

function onCanvasPointerMove(event) {
  if (!pointerState.isPointerDown || pointerState.pointerId !== event.pointerId) {
    return;
  }

  updatePointerStateFromEvent(event);
}

function resetPointerState(event) {
  if (pointerState.pointerId !== event.pointerId) {
    return;
  }

  pointerState.isPointerDown = false;
  pointerState.pointerId = null;
  updatePointerStateFromEvent(event);
}

outputCanvas.addEventListener('pointerdown', onCanvasPointerDown);
outputCanvas.addEventListener('pointermove', onCanvasPointerMove);
outputCanvas.addEventListener('pointerup', resetPointerState);
outputCanvas.addEventListener('pointercancel', resetPointerState);

rebuildSizeOptionsForRatio(ratioSelect.value);
