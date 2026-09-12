import { useCallback, useRef, useState } from 'react';
import { downloadPdfBlob } from './download.js';
import { printPdfBlob } from './print.js';

export interface UsePdfActionOptions {
  /** Builds the PDF Blob. Called fresh for both Download and Print, so each gets the same document. */
  generate: () => Promise<Blob>;
  /** Resolves the filename to download under (evaluated at download time, so it can depend on loaded data). */
  filename: () => string;
}

export interface UsePdfActionResult {
  isGenerating: boolean;
  error: string | null;
  handleDownload: () => Promise<void>;
  handlePrint: () => Promise<void>;
}

const GENERATION_FAILED_MESSAGE = 'PDF generation failed. Please try again.';

/** Shared loading/error/re-entrancy handling for a screen's Print/Download PDF actions. */
export function usePdfAction({ generate, filename }: UsePdfActionOptions): UsePdfActionResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGeneratingRef = useRef(false);

  const run = useCallback(
    async (after: (blob: Blob) => void) => {
      if (isGeneratingRef.current) return;
      isGeneratingRef.current = true;
      setIsGenerating(true);
      setError(null);
      try {
        const blob = await generate();
        after(blob);
      } catch {
        setError(GENERATION_FAILED_MESSAGE);
      } finally {
        isGeneratingRef.current = false;
        setIsGenerating(false);
      }
    },
    [generate],
  );

  const handleDownload = useCallback(
    () => run((blob) => downloadPdfBlob(blob, filename())),
    [run, filename],
  );
  const handlePrint = useCallback(() => run((blob) => printPdfBlob(blob)), [run]);

  return { isGenerating, error, handleDownload, handlePrint };
}
