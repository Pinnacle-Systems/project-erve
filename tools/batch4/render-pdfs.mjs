import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
const require = createRequire(resolve(import.meta.dirname, '../../apps/web/package.json'));
const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const { getDocument } = await import(pathToFileURL(pdfjsPath).href);
const canvasRequire = createRequire(pdfjsPath);
const { createCanvas } = canvasRequire('@napi-rs/canvas');
const directory = resolve(process.argv[2]);
for (const filename of (await readdir(directory)).filter((name) => name.endsWith('.pdf'))) {
  const task = getDocument({
    data: new Uint8Array(await readFile(join(directory, filename))),
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: resolve(dirname(pdfjsPath), '../../standard_fonts') + '/',
  });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      await writeFile(
        join(directory, `${filename.slice(0, -4)}-page-${n}.png`),
        canvas.toBuffer('image/png'),
      );
    }
    console.log(`${filename}: ${doc.numPages} pages rendered`);
  } finally {
    await task.destroy();
  }
}
