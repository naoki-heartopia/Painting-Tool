import {
  DITHER_CONFIG,
  applyColorAdjustmentsToData,
  quantizeWithoutDither,
  quantizeWithFloydSteinberg,
  quantizeWithOrderedDither,
} from './image-processing-core.js';

const imageInput = document.getElementById('imageInput');
const ratioSelect = document.getElementById('ratioSelect');
const sizeSelect = document.getElementById('sizeSelect');
const fitModeSelect = document.getElementById('fitModeSelect');
const ditherToggle = document.getElementById('ditherToggle');
const ditherMethodSelect = document.getElementById('ditherMethodSelect');
const brightnessRange = document.getElementById('brightnessRange');
const contrastRange = document.getElementById('contrastRange');
const temperatureRange = document.getElementById('temperatureRange');
const saturationRange = document.getElementById('saturationRange');
const whitePointRange = document.getElementById('whitePointRange');
const highlightsRange = document.getElementById('highlightsRange');
const shadowsRange = document.getElementById('shadowsRange');
const blackPointRange = document.getElementById('blackPointRange');
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
let renderRafId = null;
let renderPreviewFinalIdleTimer = null;
let processedBaseCanvas = null;
let processedBaseColorKey = '';
let processedBaseSourceImage = null;
let processedBaseBuildPromise = null;
let processedBaseBuildKey = '';
let colorTransformDirty = true;
const viewTransform = {
  cropX: 0.5,
  cropY: 0.5,
  panX: 0,
  panY: 0,
  zoom: 1,
};
const pointerState = {
  activePointers: new Map(),
  pinchStartDistance: 0,
  pinchStartZoom: 1,
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5.0;
const DOUBLE_TAP_THRESHOLD_MS = 300;
const SLIDER_RESET_FEEDBACK_DURATION_MS = 500;
const sliderLastPointerUpAt = new WeakMap();
const supportsWorkerPipeline = typeof Worker !== 'undefined'
  && typeof OffscreenCanvas !== 'undefined'
  && typeof createImageBitmap === 'function';
const imageWorker = supportsWorkerPipeline
  ? new Worker(new URL('./image-worker.js', import.meta.url), { type: 'module' })
  : null;
let workerRequestId = 0;
let renderGeneration = 0;
const workerPendingRequests = new Map();
let pendingFastRenderGeneration = 0;
let pendingFinalRenderGeneration = 0;


function createStaleRenderError() {
  const error = new Error('古いレンダー結果を破棄しました。');
  error.name = 'StaleRenderGenerationError';
  return error;
}

function rejectAndCleanupPendingWorkerRequests(reason = '新しいレンダー要求により以前の処理をキャンセルしました。') {
  for (const pending of workerPendingRequests.values()) {
    pending.reject(new Error(reason));
  }
  workerPendingRequests.clear();
}

function nextRenderGeneration(shouldCleanupPending = false) {
  renderGeneration += 1;
  if (shouldCleanupPending) {
    rejectAndCleanupPendingWorkerRequests();
  }
  return renderGeneration;
}

if (imageWorker) {
  imageWorker.addEventListener('message', (event) => {
    const { requestId, generation, bitmap, error } = event.data ?? {};
    const pending = workerPendingRequests.get(requestId);
    if (!pending) {
      if (bitmap?.close) {
        bitmap.close();
      }
      return;
    }

    workerPendingRequests.delete(requestId);

    const responseGeneration = Number.isFinite(generation) ? generation : pending.generation;
    if (responseGeneration !== renderGeneration) {
      bitmap?.close?.();
      pending.reject(createStaleRenderError());
      return;
    }

    if (error) {
      pending.reject(new Error(error));
      return;
    }

    pending.resolve(bitmap);
  });
  imageWorker.addEventListener('error', (event) => {
    const fallbackError = event?.message ?? 'ワーカーでの処理中にエラーが発生しました。';
    for (const pending of workerPendingRequests.values()) {
      pending.reject(new Error(fallbackError));
    }
    workerPendingRequests.clear();
  });
}

function getViewTransformState() {
  return {
    ratio: ratioSelect.value,
    size: sizeSelect.value,
    fitMode: fitModeSelect.value,
    cropX: viewTransform.cropX,
    cropY: viewTransform.cropY,
    panX: viewTransform.panX,
    panY: viewTransform.panY,
    zoom: viewTransform.zoom,
  };
}

function getColorTransformState() {
  return {
    brightness: Number(brightnessRange.value),
    contrast: Number(contrastRange.value),
    temperature: Number(temperatureRange.value),
    saturation: Number(saturationRange.value),
    whitePoint: Number(whitePointRange.value),
    highlights: Number(highlightsRange.value),
    shadows: Number(shadowsRange.value),
    blackPoint: Number(blackPointRange.value),
    dither: ditherToggle.checked,
    ditherMethod: ditherMethodSelect.value,
  };
}

function getColorTransformKey() {
  return JSON.stringify(getColorTransformState());
}

function invalidateProcessedBaseCanvas() {
  processedBaseCanvas = null;
  processedBaseColorKey = '';
  processedBaseSourceImage = null;
  processedBaseBuildPromise = null;
  processedBaseBuildKey = '';
  colorTransformDirty = true;
}

function markColorTransformDirty() {
  colorTransformDirty = true;
  rejectAndCleanupPendingWorkerRequests();
}

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeCropCoordinate(value) {
  const safeValue = Number.isFinite(value) ? value : 0.5;
  return clamp(safeValue, 0, 1);
}

function resolveFillSourceRect(image, targetWidth, targetHeight, transform = {}) {
  const scale = Math.max(targetWidth / image.width, targetHeight / image.height);
  const safeZoom = clamp(Number.isFinite(transform.zoom) ? transform.zoom : 1, MIN_ZOOM, MAX_ZOOM);
  const sourceWidth = targetWidth / scale / safeZoom;
  const sourceHeight = targetHeight / scale / safeZoom;
  const maxSourceX = Math.max(0, image.width - sourceWidth);
  const maxSourceY = Math.max(0, image.height - sourceHeight);

  const normalizedCropX = normalizeCropCoordinate(transform.cropX);
  const normalizedCropY = normalizeCropCoordinate(transform.cropY);
  const hasPanOffset = Number.isFinite(transform.panX) || Number.isFinite(transform.panY);

  const sourceX = hasPanOffset
    ? clamp((image.width - sourceWidth) / 2 + (transform.panX ?? 0), 0, maxSourceX)
    : clamp(normalizedCropX * maxSourceX, 0, maxSourceX);
  const sourceY = hasPanOffset
    ? clamp((image.height - sourceHeight) / 2 + (transform.panY ?? 0), 0, maxSourceY)
    : clamp(normalizedCropY * maxSourceY, 0, maxSourceY);

  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    maxSourceX,
    maxSourceY,
  };
}

function clampPanAxis(pan, imageSize, sourceSize) {
  const halfTravel = Math.max(0, (imageSize - sourceSize) / 2);
  return clamp(Number.isFinite(pan) ? pan : 0, -halfTravel, halfTravel);
}

function clampViewTransformForFill(image, targetWidth, targetHeight) {
  const sourceRect = resolveFillSourceRect(image, targetWidth, targetHeight, viewTransform);
  viewTransform.panX = clampPanAxis(viewTransform.panX, image.width, sourceRect.sourceWidth);
  viewTransform.panY = clampPanAxis(viewTransform.panY, image.height, sourceRect.sourceHeight);

  const maxSourceX = sourceRect.maxSourceX;
  const maxSourceY = sourceRect.maxSourceY;
  if (maxSourceX > 0) {
    viewTransform.cropX = normalizeCropCoordinate(
      (((image.width - sourceRect.sourceWidth) / 2) + viewTransform.panX) / maxSourceX,
    );
  }
  if (maxSourceY > 0) {
    viewTransform.cropY = normalizeCropCoordinate(
      (((image.height - sourceRect.sourceHeight) / 2) + viewTransform.panY) / maxSourceY,
    );
  }
}

export function resizeToTarget(image, targetWidth, targetHeight, mode = 'fit', transform = {}) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = targetWidth;
  tempCanvas.height = targetHeight;
  const ctx = tempCanvas.getContext('2d');

  if (mode === 'stretch') {
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    return tempCanvas;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  if (mode === 'fill') {
    const sourceRect = resolveFillSourceRect(image, targetWidth, targetHeight, transform);
    ctx.drawImage(
      image,
      sourceRect.sourceX,
      sourceRect.sourceY,
      sourceRect.sourceWidth,
      sourceRect.sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );
    return tempCanvas;
  }

  const scale = Math.min(targetWidth / image.width, targetHeight / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);

  return tempCanvas;
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

export function applyColorAdjustments(canvas, adjustments = {}) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  applyColorAdjustmentsToData(imageData.data, adjustments);

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

async function preparePreviewBaseCanvas() {
  try {
    const file = imageInput.files?.[0];
    if (!file) {
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      downloadButton.disabled = true;
      return null;
    }

    if (cachedFile !== file || !sourceImage) {
      sourceImage = await loadImage(file);
      cachedFile = file;
      invalidateProcessedBaseCanvas();
    }

    const selectedSize = parseSize(sizeSelect.value);
    const mode = fitModeSelect.value;

    if (!validateRatio(selectedSize, ratioSelect.value)) {
      outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
      downloadButton.disabled = true;
      return null;
    }

    return {
      selectedSize,
      mode,
      viewState: getViewTransformState(),
    };
  } catch (error) {
    alert(error instanceof Error ? error.message : '画像処理中にエラーが発生しました。');
    return null;
  }
}

function drawPreviewCanvas(canvas) {
  outputCanvas.width = canvas.width;
  outputCanvas.height = canvas.height;
  outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputCtx.drawImage(canvas, 0, 0);
}

function renderWithProcessedBaseCanvas(baseCanvas, targetWidth, targetHeight, mode, transform = {}) {
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = targetWidth;
  previewCanvas.height = targetHeight;
  const ctx = previewCanvas.getContext('2d');

  if (mode === 'stretch') {
    ctx.drawImage(baseCanvas, 0, 0, targetWidth, targetHeight);
    return previewCanvas;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  if (mode === 'fill') {
    const sourceRect = resolveFillSourceRect(baseCanvas, targetWidth, targetHeight, transform);
    ctx.drawImage(
      baseCanvas,
      sourceRect.sourceX,
      sourceRect.sourceY,
      sourceRect.sourceWidth,
      sourceRect.sourceHeight,
      0,
      0,
      targetWidth,
      targetHeight,
    );
    return previewCanvas;
  }

  const scale = Math.min(targetWidth / baseCanvas.width, targetHeight / baseCanvas.height);
  const drawWidth = baseCanvas.width * scale;
  const drawHeight = baseCanvas.height * scale;
  const offsetX = (targetWidth - drawWidth) / 2;
  const offsetY = (targetHeight - drawHeight) / 2;
  ctx.drawImage(baseCanvas, offsetX, offsetY, drawWidth, drawHeight);

  return previewCanvas;
}

async function ensureProcessedBaseCanvas(forceRebuild = false) {
  const buildBaseCanvasFromMainThread = () => {
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = sourceImage.width;
    fallbackCanvas.height = sourceImage.height;
    const fallbackCtx = fallbackCanvas.getContext('2d');
    fallbackCtx.drawImage(sourceImage, 0, 0);

    applyColorAdjustments(fallbackCanvas, getColorTransformState());
    quantizeToPalette(fallbackCanvas, undefined, getColorTransformState());
    return fallbackCanvas;
  };

  const buildBaseCanvasFromWorker = async () => {
    if (!imageWorker) {
      return buildBaseCanvasFromMainThread();
    }

    const sourceBitmap = await createImageBitmap(sourceImage);
    const requestId = ++workerRequestId;
    const requestGeneration = renderGeneration;

    const processedBitmap = await new Promise((resolve, reject) => {
      workerPendingRequests.set(requestId, { resolve, reject, generation: requestGeneration });
      imageWorker.postMessage(
        {
          requestId,
          generation: requestGeneration,
          bitmap: sourceBitmap,
          adjustments: getColorTransformState(),
          palette: DEFAULT_PALETTE,
          ditherConfig: DITHER_CONFIG,
        },
        [sourceBitmap],
      );
    });

    const workerCanvas = document.createElement('canvas');
    workerCanvas.width = processedBitmap.width;
    workerCanvas.height = processedBitmap.height;
    const workerCtx = workerCanvas.getContext('2d');
    workerCtx.drawImage(processedBitmap, 0, 0);
    processedBitmap.close?.();
    return workerCanvas;
  };

  if (!sourceImage) {
    return null;
  }

  const colorKey = getColorTransformKey();
  const shouldRebuild = forceRebuild
    || !processedBaseCanvas
    || processedBaseSourceImage !== sourceImage
    || processedBaseColorKey !== colorKey
    || colorTransformDirty;

  if (!shouldRebuild) {
    return processedBaseCanvas;
  }

  if (processedBaseBuildPromise && processedBaseBuildKey === colorKey && !forceRebuild) {
    return processedBaseBuildPromise;
  }

  processedBaseBuildKey = colorKey;
  const buildPromise = (async () => {
    let baseCanvas;
    try {
      baseCanvas = await buildBaseCanvasFromWorker();
    } catch (error) {
      if (error instanceof Error && error.name === 'StaleRenderGenerationError') {
        return null;
      }
      baseCanvas = buildBaseCanvasFromMainThread();
    }

    if (!baseCanvas) {
      return null;
    }

    processedBaseCanvas = baseCanvas;
    processedBaseSourceImage = sourceImage;
    processedBaseColorKey = colorKey;
    colorTransformDirty = false;
    return processedBaseCanvas;
  })();
  processedBaseBuildPromise = buildPromise;

  return buildPromise.finally(() => {
    if (processedBaseBuildPromise === buildPromise) {
      processedBaseBuildPromise = null;
      processedBaseBuildKey = '';
    }
  });
}

async function renderPreviewFast(generation) {
  const renderContext = await preparePreviewBaseCanvas();
  if (!renderContext) {
    return;
  }

  const baseCanvas = processedBaseCanvas ?? await ensureProcessedBaseCanvas(true);
  if (!baseCanvas) {
    return;
  }

  const previewCanvas = renderWithProcessedBaseCanvas(
    baseCanvas,
    renderContext.selectedSize.width,
    renderContext.selectedSize.height,
    renderContext.mode,
    renderContext.viewState,
  );
  if (generation === renderGeneration) {
    drawPreviewCanvas(previewCanvas);
  }
}

async function renderPreviewFinal(generation) {
  try {
    const renderContext = await preparePreviewBaseCanvas();
    if (!renderContext) {
      return;
    }

    const baseCanvas = await ensureProcessedBaseCanvas(colorTransformDirty);
    if (!baseCanvas) {
      return;
    }

    const previewCanvas = renderWithProcessedBaseCanvas(
      baseCanvas,
      renderContext.selectedSize.width,
      renderContext.selectedSize.height,
      renderContext.mode,
      renderContext.viewState,
    );
    if (generation === renderGeneration) {
      drawPreviewCanvas(previewCanvas);
      downloadButton.disabled = false;
    }
  } catch (error) {
    alert(error instanceof Error ? error.message : '画像処理中にエラーが発生しました。');
  }
}

function scheduleRenderPreview(generation) {
  pendingFastRenderGeneration = generation;
  if (renderRafId !== null) {
    return;
  }

  renderRafId = requestAnimationFrame(() => {
    renderRafId = null;
    renderPreviewFast(pendingFastRenderGeneration);
  });
}

function scheduleRenderPreviewFinal() {
  const generation = nextRenderGeneration();
  scheduleRenderPreview(generation);

  if (renderPreviewFinalIdleTimer) {
    clearTimeout(renderPreviewFinalIdleTimer);
  }

  pendingFinalRenderGeneration = generation;
  renderPreviewFinalIdleTimer = setTimeout(() => {
    renderPreviewFinalIdleTimer = null;
    renderPreviewFinal(pendingFinalRenderGeneration);
  }, 120);
}

const sliderInitialValueMap = new Map([
  [brightnessRange, brightnessRange.defaultValue],
  [contrastRange, contrastRange.defaultValue],
  [temperatureRange, temperatureRange.defaultValue],
  [saturationRange, saturationRange.defaultValue],
  [whitePointRange, whitePointRange.defaultValue],
  [highlightsRange, highlightsRange.defaultValue],
  [shadowsRange, shadowsRange.defaultValue],
  [blackPointRange, blackPointRange.defaultValue],
]);

function triggerSliderResetFeedback(slider) {
  const sliderLabel = slider.closest('label');
  if (!sliderLabel) {
    return;
  }

  sliderLabel.classList.remove('slider-reset-feedback');
  void sliderLabel.offsetWidth;
  sliderLabel.classList.add('slider-reset-feedback');

  setTimeout(() => {
    sliderLabel.classList.remove('slider-reset-feedback');
  }, SLIDER_RESET_FEEDBACK_DURATION_MS);
}

function resetSliderToInitialValue(slider) {
  const initialValue = sliderInitialValueMap.get(slider);
  if (typeof initialValue !== 'string') {
    return;
  }

  slider.value = initialValue;
  triggerSliderResetFeedback(slider);
  scheduleRenderPreviewFinal();
}

function onSliderPointerUp(event) {
  const slider = event.currentTarget;
  if (!(slider instanceof HTMLInputElement)) {
    return;
  }

  if (event.pointerType === 'mouse') {
    return;
  }

  const now = event.timeStamp;
  const lastPointerUpAt = sliderLastPointerUpAt.get(slider) ?? 0;
  sliderLastPointerUpAt.set(slider, now);

  if (now - lastPointerUpAt <= DOUBLE_TAP_THRESHOLD_MS) {
    resetSliderToInitialValue(slider);
  }
}

function initializeSliderResetHandlers() {
  for (const slider of sliderInitialValueMap.keys()) {
    slider.addEventListener('input', () => {
      markColorTransformDirty();
      scheduleRenderPreviewFinal();
    });
    slider.addEventListener('dblclick', () => resetSliderToInitialValue(slider));
    slider.addEventListener('pointerup', onSliderPointerUp);
  }
}

imageInput.addEventListener('change', () => {
  rejectAndCleanupPendingWorkerRequests();
  sourceImage = null;
  cachedFile = null;
  invalidateProcessedBaseCanvas();
  viewTransform.cropX = 0.5;
  viewTransform.cropY = 0.5;
  viewTransform.panX = 0;
  viewTransform.panY = 0;
  viewTransform.zoom = 1;
  scheduleRenderPreviewFinal();
});
ratioSelect.addEventListener('change', () => {
  rebuildSizeOptionsForRatio(ratioSelect.value);
  scheduleRenderPreviewFinal();
});
sizeSelect.addEventListener('change', scheduleRenderPreviewFinal);
fitModeSelect.addEventListener('change', scheduleRenderPreviewFinal);
ditherToggle.addEventListener('change', () => {
  markColorTransformDirty();
  scheduleRenderPreviewFinal();
});
ditherMethodSelect.addEventListener('change', () => {
  markColorTransformDirty();
  scheduleRenderPreviewFinal();
});
initializeSliderResetHandlers();

downloadButton.addEventListener('click', () => {
  exportPng(outputCanvas, 'resized-quantized.png');
});

function updatePointerStateFromEvent(event) {
  pointerState.activePointers.set(event.pointerId, { x: event.offsetX, y: event.offsetY });
}

function removePointerFromState(event) {
  pointerState.activePointers.delete(event.pointerId);
  if (pointerState.activePointers.size < 2) {
    pointerState.pinchStartDistance = 0;
    pointerState.pinchStartZoom = viewTransform.zoom;
  }
}

function getActivePointers() {
  return Array.from(pointerState.activePointers.values());
}

function getPointerDistance(firstPointer, secondPointer) {
  return Math.hypot(secondPointer.x - firstPointer.x, secondPointer.y - firstPointer.y);
}

function onCanvasPointerDown(event) {
  updatePointerStateFromEvent(event);
  outputCanvas.setPointerCapture(event.pointerId);

  if (pointerState.activePointers.size === 2) {
    const [firstPointer, secondPointer] = getActivePointers();
    pointerState.pinchStartDistance = getPointerDistance(firstPointer, secondPointer);
    pointerState.pinchStartZoom = viewTransform.zoom;
  }
}

function onCanvasPointerMove(event) {
  if (!pointerState.activePointers.has(event.pointerId)) {
    return;
  }

  const selectedSize = parseSize(sizeSelect.value);
  if (!sourceImage || fitModeSelect.value !== 'fill' || !validateRatio(selectedSize, ratioSelect.value)) {
    updatePointerStateFromEvent(event);
    return;
  }

  const previousPointer = pointerState.activePointers.get(event.pointerId);
  updatePointerStateFromEvent(event);
  const activePointers = getActivePointers();

  if (activePointers.length === 1 && previousPointer) {
    const sourceRect = resolveFillSourceRect(sourceImage, selectedSize.width, selectedSize.height, viewTransform);
    const deltaX = event.offsetX - previousPointer.x;
    const deltaY = event.offsetY - previousPointer.y;
    const outputToSourceScaleX = sourceRect.sourceWidth / selectedSize.width;
    const outputToSourceScaleY = sourceRect.sourceHeight / selectedSize.height;

    viewTransform.panX -= deltaX * outputToSourceScaleX;
    viewTransform.panY -= deltaY * outputToSourceScaleY;
    clampViewTransformForFill(sourceImage, selectedSize.width, selectedSize.height);
    scheduleRenderPreview();
    return;
  }

  if (activePointers.length >= 2) {
    const [firstPointer, secondPointer] = activePointers;
    const currentDistance = getPointerDistance(firstPointer, secondPointer);
    if (pointerState.pinchStartDistance <= 0) {
      pointerState.pinchStartDistance = currentDistance;
      pointerState.pinchStartZoom = viewTransform.zoom;
      return;
    }

    const distanceRatio = currentDistance / pointerState.pinchStartDistance;
    viewTransform.zoom = clamp(pointerState.pinchStartZoom * distanceRatio, MIN_ZOOM, MAX_ZOOM);
    clampViewTransformForFill(sourceImage, selectedSize.width, selectedSize.height);
    scheduleRenderPreview();
  }
}

function resetPointerState(event) {
  removePointerFromState(event);
  scheduleRenderPreviewFinal();
}

outputCanvas.addEventListener('pointerdown', onCanvasPointerDown);
outputCanvas.addEventListener('pointermove', onCanvasPointerMove);
outputCanvas.addEventListener('pointerup', resetPointerState);
outputCanvas.addEventListener('pointercancel', resetPointerState);

rebuildSizeOptionsForRatio(ratioSelect.value);
