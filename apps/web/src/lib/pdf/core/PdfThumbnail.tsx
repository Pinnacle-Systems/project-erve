import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: '#f2f2f2',
    borderRadius: 2,
  },
  inconsistent: {
    backgroundColor: '#fdf2e9',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#d98324',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  inconsistentText: {
    fontSize: 6,
    color: '#92400e',
    textAlign: 'center',
  },
});

export interface ResolvedPdfImage {
  dataUri: string;
}

/**
 * A resolved image (already fetched/resized to a data URI), an honest "no
 * image yet" placeholder, or an explicit "image unavailable" marker for a
 * genuine data inconsistency (e.g. a Job Order whose lines disagree on
 * Style — see resolveJobOrderPrimaryStyle). The two placeholder states are
 * deliberately distinct: `placeholder` means the Style simply has no
 * uploaded image; `inconsistent` means the identity itself couldn't be
 * resolved, and must never be confused with "no image" or silently render
 * as nothing.
 */
export type PdfImageSource = ResolvedPdfImage | { placeholder: true } | { inconsistent: true };

export interface PdfThumbnailProps {
  image: PdfImageSource | null | undefined;
  width: number;
  height: number;
}

/** Renders a pre-resolved image, a clean "no image" placeholder, or an explicit "unavailable" marker. Never throws — a missing/failed image is never fatal. */
export function PdfThumbnail({ image, width, height }: PdfThumbnailProps) {
  const box = { width, height };
  if (image && 'inconsistent' in image) {
    return (
      <View style={[styles.inconsistent, box]}>
        <Text style={styles.inconsistentText}>Image unavailable</Text>
      </View>
    );
  }
  if (!image || 'placeholder' in image) {
    return <View style={[styles.placeholder, box]} />;
  }
  return <Image src={image.dataUri} style={box} />;
}
