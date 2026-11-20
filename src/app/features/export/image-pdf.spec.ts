import { pagesToPdf } from './image-pdf';

describe('a PDF of page pictures', () => {
  // The smallest JPEG there is would do; the writer only copies its bytes.
  const jpeg = `data:image/jpeg;base64,${btoa('\xff\xd8\xff\xd9')}`;

  it('has an A4 page for each picture, and a table of where each object is', () => {
    const bytes = pagesToPdf(
      [
        { jpeg, width: 1588, height: 2246 },
        { jpeg, width: 1588, height: 2246 },
      ],
      { widthMm: 210, heightMm: 297 },
    );
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // Each object starts where the cross-reference table says.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    const offsets = text.slice(xref).split('\n').filter((line) => / 00000 n $/.test(line)).map((line) => Number(line.slice(0, 10)));
    expect(offsets).toHaveLength(2 + 2 * 3);
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
  });
});
