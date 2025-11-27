// src/core/pptxBuilder.ts
import PptxGenJS from 'pptxgenjs';
import fs from 'fs-extra';
import path from 'path';

export async function imagesToPptx(images: string[], outFile?: string) {
  await fs.ensureDir('downloads');
  const file = outFile ?? path.join('downloads', `slides-${Date.now()}.pptx`);

  const pptx = new PptxGenJS();

  // ✅ Opción A: layout estándar 16:9 reconocido por pptxgenjs
  pptx.layout = 'LAYOUT_16x9';

  // ✅ Opción B (alternativa): layout custom explícito
  // pptx.defineLayout({ name: 'CUSTOM_16x9', width: 13.33, height: 7.5 });
  // pptx.layout = 'CUSTOM_16x9';

  images.forEach((img) => {
    const slide = pptx.addSlide();
    // 16:9 = 13.33" x 7.5"
    slide.addImage({ path: img, x: 0, y: 0, w: 13.33, h: 7.5 });
  });

  await pptx.writeFile({ fileName: file });
  return file;
}
