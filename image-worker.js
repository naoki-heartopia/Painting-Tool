function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampToByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
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

function applyColorAdjustmentsToData(
  data,
  {
    brightness = 0,
    contrast = 0,
    temperature = 0,
    saturation = 0,
    whitePoint = 0,
    highlights = 0,
    shadows = 0,
    blackPoint = 0,
  } = {},
) {
  const brightnessOffset = (brightness / 100) * 255;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const temperatureOffset = (temperature / 100) * 64;
  const greenTemperatureOffset = temperatureOffset * 0.2;
  const saturationFactor = 1 + saturation / 100;
  const whitePointAmount = (whitePoint / 100) * 64;
  const highlightsAmount = (highlights / 100) * 80;
  const shadowsAmount = (shadows / 100) * 80;
  const blackPointAmount = (blackPoint / 100) * 64;

  for (let i = 0; i < data.length; i += 4) {
    const brightR = data[i] + brightnessOffset;
    const brightG = data[i + 1] + brightnessOffset;
    const brightB = data[i + 2] + brightnessOffset;

    const contrastedR = (brightR - 128) * contrastFactor + 128;
    const contrastedG = (brightG - 128) * contrastFactor + 128;
    const contrastedB = (brightB - 128) * contrastFactor + 128;

    let adjustedR = contrastedR + temperatureOffset;
    let adjustedG = contrastedG + greenTemperatureOffset;
    let adjustedB = contrastedB - temperatureOffset;

    const luma = 0.2126 * adjustedR + 0.7152 * adjustedG + 0.0722 * adjustedB;
    const highlightMask = clamp((luma - 128) / 127, 0, 1);
    const shadowMask = clamp((128 - luma) / 128, 0, 1);

    adjustedR += whitePointAmount * highlightMask;
    adjustedG += whitePointAmount * highlightMask;
    adjustedB += whitePointAmount * highlightMask;

    adjustedR += blackPointAmount * shadowMask;
    adjustedG += blackPointAmount * shadowMask;
    adjustedB += blackPointAmount * shadowMask;

    adjustedR += highlightsAmount * highlightMask;
    adjustedG += highlightsAmount * highlightMask;
    adjustedB += highlightsAmount * highlightMask;

    adjustedR += shadowsAmount * shadowMask;
    adjustedG += shadowsAmount * shadowMask;
    adjustedB += shadowsAmount * shadowMask;

    const tonalLuma = 0.2126 * adjustedR + 0.7152 * adjustedG + 0.0722 * adjustedB;
    adjustedR = tonalLuma + (adjustedR - tonalLuma) * saturationFactor;
    adjustedG = tonalLuma + (adjustedG - tonalLuma) * saturationFactor;
    adjustedB = tonalLuma + (adjustedB - tonalLuma) * saturationFactor;

    data[i] = clampToByte(adjustedR);
    data[i + 1] = clampToByte(adjustedG);
    data[i + 2] = clampToByte(adjustedB);
  }
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

function quantizeToPaletteData(data, width, height, palette, options, config) {
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
