import { Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import erveLogo from '../../../assets/erve-logo.png?inline';

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottom: '1 solid #999999',
  },
  content: { flexDirection: 'row', alignItems: 'center' },
  // ISS-043: the source artwork (apps/web/src/assets/erve-logo.png) is ~7.3:1
  // (1117x153px) wide, not the ~3:1 the previous 86x28 box assumed. `contain`
  // inside a mismatched box silently shrinks further to fit the narrower
  // dimension — the logo was rendering at an effective ~86x11.8pt, visibly
  // undersized next to the 14pt title. This box matches the real ratio
  // (160/22 ≈ 7.27) so `contain` fills it almost exactly on both axes.
  logo: { width: 160, height: 22, objectFit: 'contain', marginRight: 14 },
  heading: { flex: 1 },
  title: { fontSize: 14, fontWeight: 700, color: '#111111' },
  subtitle: { fontSize: 9, color: '#555555', marginTop: 2 },
});

export interface PdfHeaderProps {
  title: string;
  subtitle?: string;
}

/**
 * ERVE's existing artwork is embedded as a data URI at build time, so downloaded
 * PDFs remain self-contained and work offline. This fixed header has the same
 * 72pt top-page reservation in both portrait and landscape PdfDocument shells.
 */
export function PdfHeader({ title, subtitle }: PdfHeaderProps) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.content}>
        <Image src={erveLogo} style={styles.logo} />
        <View style={styles.heading}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
    </View>
  );
}
