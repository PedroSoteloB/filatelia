// src/core/screenshot.ts
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';

export interface ScreenshotOptions {
  outDir: string;
  fileBaseName: string;      // sin extensión
  width?: number;            // default 1280
  height?: number;           // default 720
  fullPage?: boolean;        // default true
}

/**
 * Renderiza HTML con Chromium headless y guarda un PNG.
 * Devuelve la ruta absoluta del PNG.
 */
export async function htmlToPng(
  html: string,
  opts: ScreenshotOptions
): Promise<string> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fullPage = opts.fullPage ?? true;

  await fs.ensureDir(opts.outDir);
  const outPath = path.join(opts.outDir, `${opts.fileBaseName}.png`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.screenshot({ path: outPath, fullPage });
    return outPath;
  } finally {
    await browser.close();
  }
}
