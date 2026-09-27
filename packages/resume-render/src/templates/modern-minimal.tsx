/**
 * `modern-minimal` - generous whitespace, sans-serif everywhere, single accent
 * colour on the role target + section headings. Headings in title case, not
 * uppercase (per the plan). Still single column, still ATS-parseable.
 *
 * ponytail: Helvetica stays the sans-serif choice - react-pdf ships it, no
 * font file to bundle. The "accent colour" is a single hex, hardcoded to
 * `#2563eb`; add a knob when a user actually wants to pick.
 */
import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { buildResumeDocument } from '../docx';
import type { ResumeDoc, Template } from '../types';

const ACCENT = '#2563eb';

const styles = StyleSheet.create({
  page: {
    padding: 64,
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.55,
    color: '#111',
  },
  header: { marginBottom: 28 },
  roleTarget: { fontSize: 18, fontWeight: 'bold', marginBottom: 6, color: ACCENT },
  metaLine: { fontSize: 10.5, color: '#666' },
  section: { marginTop: 20 },
  sectionHeading: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.3,
    marginBottom: 8,
    color: ACCENT,
  },
  summary: { marginBottom: 6 },
  bullet: { flexDirection: 'row', marginBottom: 5 },
  bulletMark: { width: 14 },
  bulletText: { flex: 1 },
});

function ModernMinimalResume(doc: ResumeDoc): React.ReactElement {
  return (
    <Document title={`Resume - ${doc.roleTarget}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.roleTarget}>{doc.roleTarget}</Text>
          {doc.jobCompany && <Text style={styles.metaLine}>Tailored for {doc.jobCompany}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Summary</Text>
          <Text style={styles.summary}>{doc.content.summary}</Text>
        </View>

        {doc.content.sections.map((sec, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.sectionHeading}>{sec.heading}</Text>
            {sec.bullets.map((b, j) => (
              <View key={j} style={styles.bullet} wrap={false}>
                <Text style={styles.bulletMark}>-</Text>
                <Text style={styles.bulletText}>{b.text}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}

export const modernMinimal: Template = {
  id: 'modern-minimal',
  name: 'Modern Minimal',
  description: 'Airy sans-serif with a single accent colour. Title-case headings, no rules.',
  renderPdf: (doc) => ModernMinimalResume(doc),
  renderDocx: (doc) =>
    buildResumeDocument(doc, {
      bodyFont: 'Calibri',
      headingFont: 'Calibri',
      uppercaseHeadings: false,
      accentHex: '2563EB',
      bulletSpacingAfter: 120,
    }),
};
