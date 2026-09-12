/** Triggers a browser download of a generated PDF Blob under the given filename. */
export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser needs a moment to pick up the download before the object URL
  // is revoked — unlike print, there's no reliable "done consuming" event here.
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
