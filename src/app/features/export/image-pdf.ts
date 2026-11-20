/**
 * A PDF of pictures of the pages (the web's imagePdf, as its Export Studio saves): no PDF library, a picture keeps the text
 * exactly as the app drew it (Khmer too, which PDF libraries can't shape). Each page holds one JPEG filling it.
 */

const POINTS_PER_MM = 72 / 25.4;

function bytesOf(dataUrl: string) {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface PagePicture {
  /** A JPEG data URL, `width` × `height` px. */
  jpeg: string;
  width: number;
  height: number;
}

/** The PDF's bytes: a page `widthMm` × `heightMm` for each picture, the picture filling it. */
export function pagesToPdf(pictures: readonly PagePicture[], paper: { widthMm: number; heightMm: number }): Uint8Array {
  const pageWidth = Number((paper.widthMm * POINTS_PER_MM).toFixed(2));
  const pageHeight = Number((paper.heightMm * POINTS_PER_MM).toFixed(2));
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (body: string | (string | Uint8Array)[]) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n`);
    for (const piece of Array.isArray(body) ? body : [body]) push(piece);
    push('\nendobj\n');
  };
  // 1 the catalogue, 2 the page tree, then three objects a page: the page, what it draws, its picture.
  const pageObject = (index: number) => 3 + index * 3;
  push('%PDF-1.4\n%âãÏÓ\n');
  object('<< /Type /Catalog /Pages 2 0 R >>');
  object(`<< /Type /Pages /Kids [${pictures.map((_, index) => `${pageObject(index)} 0 R`).join(' ')}] /Count ${pictures.length} >>`);
  pictures.forEach((picture, index) => {
    const first = pageObject(index);
    const content = `q ${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm /Im0 Do Q`;
    const image = bytesOf(picture.jpeg);
    object(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${first + 2} 0 R >> >> /Contents ${first + 1} 0 R >>`);
    object(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}\nendstream`);
    object([
      `<< /Type /XObject /Subtype /Image /Width ${picture.width} /Height ${picture.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`,
      image,
      '\nendstream',
    ]);
  });
  const xref = length;
  push(
    `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
