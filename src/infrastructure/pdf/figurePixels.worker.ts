import { refineFigurePixels, type PixelInput } from '../../modules/paper/figurePixels';
self.onmessage = ({ data }: MessageEvent<PixelInput>) => {
  try {
    self.postMessage({ result: refineFigurePixels(data) });
  } catch {
    self.postMessage({ error: '局部像素分析失败，请重试此图。' });
  }
};
