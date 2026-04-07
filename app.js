const imageInput = document.getElementById('imageInput');
const ratioSelect = document.getElementById('ratioSelect');
const sizeSelect = document.getElementById('sizeSelect');
const fitModeSelect = document.getElementById('fitModeSelect');
const runButton = document.getElementById('runButton');
const downloadButton = document.getElementById('downloadButton');
const outputCanvas = document.getElementById('outputCanvas');
const outputCtx = outputCanvas.getContext('2d');

let sourceImage = null;

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

export function quantizeToPalette(canvas, palette = [
  [0, 0, 0],
  [255, 255, 255],
  [231, 76, 60],
  [52, 152, 219],
  [46, 204, 113],
  [241, 196, 15],
  [155, 89, 182],
  [230, 126, 34],
]) {
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const replacement = nearestColor([data[i], data[i + 1], data[i + 2]], palette);
    data[i] = replacement[0];
    data[i + 1] = replacement[1];
    data[i + 2] = replacement[2];
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

runButton.addEventListener('click', async () => {
  try {
    const file = imageInput.files?.[0];
    if (!file) {
      alert('先に画像をアップロードしてください。');
      return;
    }

    sourceImage = await loadImage(file);
    const selectedSize = parseSize(sizeSelect.value);
    const mode = fitModeSelect.value;

    if (!validateRatio(selectedSize, ratioSelect.value)) {
      alert('選択した比率と出力サイズが一致していません。比率に合うサイズを選んでください。');
      return;
    }

    const resizedCanvas = resizeToTarget(sourceImage, selectedSize.width, selectedSize.height, mode);
    const quantizedCanvas = quantizeToPalette(resizedCanvas);

    outputCanvas.width = quantizedCanvas.width;
    outputCanvas.height = quantizedCanvas.height;
    outputCtx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputCtx.drawImage(quantizedCanvas, 0, 0);

    downloadButton.disabled = false;
  } catch (error) {
    alert(error instanceof Error ? error.message : '画像処理中にエラーが発生しました。');
  }
});

downloadButton.addEventListener('click', () => {
  exportPng(outputCanvas, 'resized-quantized.png');
});
