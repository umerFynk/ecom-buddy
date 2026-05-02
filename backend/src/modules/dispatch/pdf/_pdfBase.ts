import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'pdfs');

export function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  return UPLOAD_DIR;
}

export interface PdfWriteResult {
  filePath: string;
  publicUrl: string;
  bytes: number;
}

/**
 * Run a PDFKit script and persist the result to disk under uploads/pdfs/.
 * Phase 10 swaps this for Cloudflare R2 upload + signed URLs.
 */
export async function writePdf(
  fileName: string,
  build: (doc: typeof PDFDocument.prototype) => void
): Promise<PdfWriteResult> {
  ensureUploadDir();
  const filePath = path.join(UPLOAD_DIR, fileName);

  return new Promise<PdfWriteResult>((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 36 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', () =>
      resolve({ filePath, publicUrl: `/uploads/pdfs/${fileName}`, bytes: fs.statSync(filePath).size })
    );
    stream.on('error', reject);
    doc.pipe(stream);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function header(doc: typeof PDFDocument.prototype, title: string, subtitle?: string) {
  doc.font('Helvetica-Bold').fontSize(18).text(title, { align: 'left' });
  if (subtitle) doc.font('Helvetica').fontSize(10).fillColor('#555').text(subtitle).fillColor('black');
  doc.moveDown(0.5);
  doc.strokeColor('#ddd').lineWidth(0.5).moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.5);
}

export function tableRow(
  doc: typeof PDFDocument.prototype,
  cells: Array<{ text: string; width: number; align?: 'left' | 'right' | 'center' }>,
  opts: { bold?: boolean; lineHeight?: number } = {}
) {
  const startY = doc.y;
  let x = doc.x;
  if (opts.bold) doc.font('Helvetica-Bold');
  else doc.font('Helvetica');
  doc.fontSize(9);
  for (const c of cells) {
    doc.text(c.text, x + 2, startY + 2, { width: c.width - 4, align: c.align ?? 'left' });
    x += c.width;
  }
  const lineHeight = opts.lineHeight ?? 18;
  doc.y = startY + lineHeight;
  doc.x = doc.page.margins.left;
}
