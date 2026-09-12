/**
 * Prints a generated PDF Blob via the browser's native PDF viewer — never the app's own HTML/CSS.
 * Loads the blob into a hidden iframe and calls the iframe's contentWindow.print(), which hands the
 * *real generated document* to the browser's print pipeline. Falls back to opening the blob in a new
 * tab (so the user can print from there) if the iframe path throws or is blocked.
 *
 * Cleanup is deliberately conservative: revoking the object URL too early can produce an intermittent
 * blank document if the PDF viewer hasn't finished consuming the blob yet, so we only revoke on
 * `afterprint` (or a timeout backstop), never synchronously after calling print().
 */
export function printPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);

  const openFallbackTab = () => {
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  let iframe: HTMLIFrameElement;
  try {
    iframe = document.createElement('iframe');
  } catch {
    openFallbackTab();
    return;
  }

  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    URL.revokeObjectURL(url);
    iframe.remove();
  };
  const backstop = setTimeout(cleanup, 60000);

  const fallbackToNewTab = () => {
    clearTimeout(backstop);
    settled = true; // don't let cleanup() revoke the URL we're about to reuse
    iframe.remove();
    openFallbackTab();
  };

  iframe.onload = () => {
    try {
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) throw new Error('iframe has no content window');
      contentWindow.addEventListener('afterprint', () => {
        clearTimeout(backstop);
        cleanup();
      });
      contentWindow.focus();
      contentWindow.print();
    } catch {
      fallbackToNewTab();
    }
  };
  iframe.onerror = fallbackToNewTab;

  document.body.appendChild(iframe);
  iframe.src = url;
}
