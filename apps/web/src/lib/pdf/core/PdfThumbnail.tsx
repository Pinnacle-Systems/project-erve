import { Image, StyleSheet, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#f2f2f2',
    borderRadius: 2,
  },
});

export interface ResolvedPdfImage {
  dataUri: string;
}

/** A resolved image (already fetched/resized to a data URI) or an explicit placeholder marker. */
export type PdfImageSource = ResolvedPdfImage | { placeholder: true };

export interface PdfThumbnailProps {
  image: PdfImageSource | null | undefined;
  width: number;
  height: number;
}

/** Renders a pre-resolved image or a clean placeholder box. Never throws — a missing/failed image is never fatal. */
export function PdfThumbnail({ image, width, height }: PdfThumbnailProps) {
  const box = { width, height };
  if (!image || 'placeholder' in image) {
    return <View style={[styles.placeholder, box]} />;
  }
  return <Image src={image.dataUri} style={box} />;
}
