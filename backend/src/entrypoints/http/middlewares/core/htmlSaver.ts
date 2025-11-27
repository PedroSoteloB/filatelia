// src/core/htmlSaver.ts
import fs from 'fs-extra';
import path from 'path';

/**
 * Guarda HTML como archivo .html y devuelve la ruta absoluta.
 */
export async function saveHtml(
  outDir: string,
  baseName: string,
  html: string
): Promise<string> {
  const content = typeof html === 'string' ? html : String(html ?? '');
  await fs.ensureDir(outDir);
  const filePath = path.join(outDir, baseName.endsWith('.html') ? baseName : `${baseName}.html`);
  await fs.writeFile(filePath, content, { encoding: 'utf8' });
  return filePath;
}
