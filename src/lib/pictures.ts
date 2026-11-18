/** Turns an uploaded picture (or the first page of a PDF) into a small PNG/JPEG for the clinic's pictures. */

async function pdfToCanvas(file: File, width: number): Promise<HTMLCanvasElement> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  await task.destroy();
  return canvas;
}

async function imageToCanvas(file: File, maxW: number, maxH: number, white: boolean): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxW / bmp.width, maxH / bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  const ctx = canvas.getContext("2d")!;
  if (white) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

/** Trims a PDF letterhead page down to the printed part at the top, so blank paper isn't kept. */
function cropToInk(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const px = ctx.getImageData(0, 0, width, height).data;
  let last = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 4) {
      const i = (y * width + x) * 4;
      if (px[i]! < 235 || px[i + 1]! < 235 || px[i + 2]! < 235) { last = y; break; }
    }
  }
  // A heading lives in the top part of the page; anything printed at the bottom (a footer) is dropped.
  const firstGap = (() => {
    let run = 0;
    for (let y = 0; y <= last; y++) {
      let ink = false;
      for (let x = 0; x < width; x += 4) { const i = (y * width + x) * 4; if (px[i]! < 235 || px[i + 1]! < 235 || px[i + 2]! < 235) { ink = true; break; } }
      run = ink ? 0 : run + 1;
      if (run > height * 0.12 && y > height * 0.05) return y - run;
    }
    return last;
  })();
  const h = Math.min(height, firstGap + Math.round(height * 0.01));
  if (h >= height - 2) return canvas;
  const out = document.createElement("canvas");
  out.width = width; out.height = Math.max(1, h);
  out.getContext("2d")!.drawImage(canvas, 0, 0);
  return out;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Couldn’t read that picture."))), type, q));

export type PictureKind = "logo" | "letterhead" | "signature";

export async function preparePicture(file: File, kind: PictureKind): Promise<Blob> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf && !/^image\//.test(file.type)) throw new Error("Choose a picture (PNG or JPG) or a PDF.");
  if (kind === "letterhead") {
    const c = isPdf ? cropToInk(await pdfToCanvas(file, 2000)) : await imageToCanvas(file, 2000, 1400, true);
    return toBlob(c, "image/jpeg", 0.88);
  }
  const c = isPdf ? cropToInk(await pdfToCanvas(file, 800)) : await imageToCanvas(file, kind === "logo" ? 400 : 800, kind === "logo" ? 400 : 300, false);
  return toBlob(c, "image/png");
}
