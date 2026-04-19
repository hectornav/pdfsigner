const { PDFDocument, degrees } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

/**
 * Rotate specific pages in a PDF.
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {number[]} pageIndices - 0-based page indices to rotate
 * @param {number} angle - Rotation angle (90, 180, 270)
 * @returns {Promise<Buffer>}
 */
async function rotatePages(pdfBuffer, pageIndices, angle = 90) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  for (const idx of pageIndices) {
    if (idx >= 0 && idx < pages.length) {
      const page = pages[idx];
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees((currentRotation + angle) % 360));
    }
  }

  const resultBytes = await pdfDoc.save();
  return Buffer.from(resultBytes);
}

/**
 * Delete specific pages from a PDF.
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {number[]} pageIndices - 0-based page indices to remove (sorted desc internally)
 * @returns {Promise<Buffer>}
 */
async function deletePages(pdfBuffer, pageIndices) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();

  if (pageIndices.length >= totalPages) {
    throw new Error('No se pueden eliminar todas las páginas');
  }

  // Sort descending to avoid index shifting
  const sorted = [...pageIndices].sort((a, b) => b - a);
  for (const idx of sorted) {
    if (idx >= 0 && idx < totalPages) {
      pdfDoc.removePage(idx);
    }
  }

  const resultBytes = await pdfDoc.save();
  return Buffer.from(resultBytes);
}

/**
 * Extract specific pages into a new PDF (split).
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {number[]} pageIndices - 0-based page indices to extract
 * @returns {Promise<Buffer>}
 */
async function extractPages(pdfBuffer, pageIndices) {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const newDoc = await PDFDocument.create();

  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  const resultBytes = await newDoc.save();
  return Buffer.from(resultBytes);
}

/**
 * Split a PDF into individual page files.
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {string} outputDir - Directory to write individual pages
 * @param {string} baseName - Base filename for output files
 * @returns {Promise<string[]>} - Array of output file paths
 */
async function splitAllPages(pdfBuffer, outputDir, baseName = 'page') {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();
  const outputPaths = [];

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  for (let i = 0; i < totalPages; i++) {
    const newDoc = await PDFDocument.create();
    const [copiedPage] = await newDoc.copyPages(srcDoc, [i]);
    newDoc.addPage(copiedPage);

    const outputPath = path.join(outputDir, `${baseName}_${String(i + 1).padStart(3, '0')}.pdf`);
    const bytes = await newDoc.save();
    fs.writeFileSync(outputPath, Buffer.from(bytes));
    outputPaths.push(outputPath);
  }

  return outputPaths;
}

/**
 * Split PDF by page ranges.
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {Array<{start: number, end: number}>} ranges - Array of 0-based page ranges
 * @returns {Promise<Buffer[]>} - Array of PDF buffers
 */
async function splitByRanges(pdfBuffer, ranges) {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const results = [];

  for (const range of ranges) {
    const newDoc = await PDFDocument.create();
    const indices = [];
    for (let i = range.start; i <= range.end; i++) {
      indices.push(i);
    }
    const copiedPages = await newDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }
    const bytes = await newDoc.save();
    results.push(Buffer.from(bytes));
  }

  return results;
}

/**
 * Merge multiple PDFs into one.
 * @param {Buffer[]} pdfBuffers - Array of PDF buffers
 * @returns {Promise<Buffer>}
 */
async function mergePDFs(pdfBuffers) {
  const mergedDoc = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const srcDoc = await PDFDocument.load(buffer);
    const pageCount = srcDoc.getPageCount();
    const indices = Array.from({ length: pageCount }, (_, i) => i);
    const copiedPages = await mergedDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
      mergedDoc.addPage(page);
    }
  }

  const resultBytes = await mergedDoc.save();
  return Buffer.from(resultBytes);
}

/**
 * Reorder pages in a PDF.
 * @param {Buffer} pdfBuffer - Source PDF buffer
 * @param {number[]} newOrder - Array of 0-based page indices in desired order
 * @returns {Promise<Buffer>}
 */
async function reorderPages(pdfBuffer, newOrder) {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const newDoc = await PDFDocument.create();

  const copiedPages = await newDoc.copyPages(srcDoc, newOrder);
  for (const page of copiedPages) {
    newDoc.addPage(page);
  }

  const resultBytes = await newDoc.save();
  return Buffer.from(resultBytes);
}

/**
 * Get PDF metadata and info.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<Object>}
 */
async function getPDFInfo(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  return {
    pageCount: pdfDoc.getPageCount(),
    title: pdfDoc.getTitle() || '',
    author: pdfDoc.getAuthor() || '',
    subject: pdfDoc.getSubject() || '',
    creator: pdfDoc.getCreator() || '',
    producer: pdfDoc.getProducer() || '',
    creationDate: pdfDoc.getCreationDate()?.toISOString() || '',
    modificationDate: pdfDoc.getModificationDate()?.toISOString() || '',
    pages: pages.map((p, i) => ({
      index: i,
      width: p.getWidth(),
      height: p.getHeight(),
      rotation: p.getRotation().angle
    }))
  };
}

module.exports = {
  rotatePages,
  deletePages,
  extractPages,
  splitAllPages,
  splitByRanges,
  mergePDFs,
  reorderPages,
  getPDFInfo
};
