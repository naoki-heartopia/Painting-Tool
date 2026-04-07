import {
  applyColorAdjustmentsToData,
  quantizeWithoutDither,
  quantizeWithFloydSteinberg,
  quantizeWithOrderedDither,
  DITHER_CONFIG,
} from './image-processing-core.js';

function quantizeToPaletteData(data, width, height, palette, options, config = DITHER_CONFIG) {
  if (!options.dither) {
    quantizeWithoutDither(data, palette, config.minAlphaToProcess);
  } else if (options.ditherMethod === 'ordered') {
    quantizeWithOrderedDither(data, width, height, palette, config);
  } else {
    quantizeWithFloydSteinberg(data, width, height, palette, config);
  }
}

self.addEventListener('message', (event) => {
  const { requestId, bitmap, adjustments, palette, ditherConfig } = event.data ?? {};

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    applyColorAdjustmentsToData(data, adjustments);
    quantizeToPaletteData(data, width, height, palette, adjustments, ditherConfig);

    ctx.putImageData(imageData, 0, 0);
    const processedBitmap = canvas.transferToImageBitmap();

    self.postMessage({ requestId, bitmap: processedBitmap }, [processedBitmap]);
  } catch (error) {
    self.postMessage({ requestId, error: error instanceof Error ? error.message : 'ワーカーでの画像処理に失敗しました。' });
  }
});
