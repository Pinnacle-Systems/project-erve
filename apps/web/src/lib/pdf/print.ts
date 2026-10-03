/**
 * Prints a generated PDF Blob via the browser's native PDF viewer — never the app's own HTML/CSS.
 * Loads the blob into an off-screen iframe and invokes the iframe's contentWindow.print(), which
 * hands the real generated document to the browser's print pipeline. Falls back to opening the blob
 * in a new tab if the iframe path throws or is blocked.
 *
 * Lifecycle guarantees (PDF-001):
 * 1. Off-screen layout: Configured with non-zero dimensions (not 0x0) so the browser's layout engine
 *    and embedded PDF plugin compute valid viewport dimensions and render the document pages.
 * 2. Lifecycle ordering: Handlers and iframe.src are assigned BEFORE appending to the DOM to prevent
 *    browsers (notably Chromium) from firing an initial synchronous onload for about:blank and opening
 *    a blank print dialog.
 * 3. Defensive about:blank guard: Any uninitialized navigation is ignored.
 * 4. Readiness stabilization: Two animation frames (with a bounded timer fallback) allow the PDF viewer
 *    plugin to finish document layout and paint attachment after the iframe DOM load event before print().
 * 5. Idempotent cleanup: Listens to afterprint on both contentWindow and window, ensuring blob URL
 *    revocation, listener detachment, and iframe removal occur at most once.
 * 6. Conservative backstop: A 60-second backstop timeout ensures cleanup if afterprint never fires.
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

  // Off-screen layout with non-zero dimensions to ensure layout and plugin rendering
  iframe.style.position = 'fixed';
  iframe.style.top = '-10000px';
  iframe.style.left = '-10000px';
  iframe.style.width = '1000px';
  iframe.style.height = '1000px';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    clearTimeout(backstop);
    window.removeEventListener('afterprint', cleanup);
    try {
      iframe.contentWindow?.removeEventListener('afterprint', cleanup);
    } catch {
      // Ignore cross-origin access issues during cleanup
    }
    URL.revokeObjectURL(url);
    iframe.remove();
  };
  const backstop = setTimeout(cleanup, 60000);

  const fallbackToNewTab = () => {
    clearTimeout(backstop);
    settled = true; // don't let cleanup() revoke the URL we're about to reuse
    window.removeEventListener('afterprint', cleanup);
    iframe.remove();
    openFallbackTab();
  };

  let printed = false;
  const doPrint = () => {
    if (printed || settled) return;
    printed = true;
    try {
      const contentWindow = iframe.contentWindow;
      if (!contentWindow) throw new Error('iframe has no content window');

      try {
        contentWindow.addEventListener('afterprint', cleanup, { once: true });
      } catch {
        // Cross-origin contentWindow guards
      }
      window.addEventListener('afterprint', cleanup, { once: true });

      contentWindow.focus();
      contentWindow.print();
    } catch {
      fallbackToNewTab();
    }
  };

  const schedulePrint = () => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          doPrint();
        });
      });
    } else {
      setTimeout(doPrint, 50);
    }
  };

  iframe.onload = () => {
    try {
      // Defensive check: ignore uninitialized about:blank navigation
      if (iframe.contentWindow?.location?.href === 'about:blank') {
        return;
      }
    } catch {
      // If reading location throws (e.g. cross-origin isolation for PDF viewer),
      // it has navigated to the PDF plugin, so proceed.
    }
    schedulePrint();
  };

  iframe.onerror = fallbackToNewTab;

  // Crucial: assign src before appending to DOM so the browser does not navigate to about:blank first
  iframe.src = url;
  document.body.appendChild(iframe);
}
