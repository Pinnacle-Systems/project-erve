/** Financial-document adapter: retain PNG/WebP alpha; no shared media behavior changes. */
export async function resizeInvoicePdfPng(blob: Blob, maxDimension: number): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth === 0 || image.naturalHeight === 0)
      throw new Error('Archived image dimensions unavailable');
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Invoice image conversion unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
