/**
 * `dense-tech` - tighter vertical rhythm, Courier for the summary/heading
 * accents, standard Helvetica for body. Fits more content on a page; targets
 * senior IC / backend / infra roles.
 *
 * ponytail: no separate mono-font install. React-PDF ships Courier as a
 * built-in - same font Word uses for `Courier New` fallback. Zero deps
 * added.
 */
import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { buildResumeDocument } from '../docx';
import type { ResumeDoc, Template } from '../types';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    lineHeight: 1.3,
    color: '#111',
  },
  header: { marginBottom: 12 },
  roleTarget: { fontSize: 15, fontWeight: 'bold', marginBottom: 3, fontFamily: 'Courier' },
  metaLine: { fontSize: 9.5, color: '#555' },
  section: { marginTop: 10 },
  sectionHeading: {
    fontSize: 10.5,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
    paddingBottom: 1,
    borderBottom: '0.5pt solid #999',
    fontFamily: 'Courier',
  },
  summary: { marginBottom: 3 },
  bullet: { flexDirection: 'row', marginBottom: 1.5 },
  bulletMark: { width: 10 },
  bulletText: { flex: 1 },
});

function DenseTechResume(doc: ResumeDoc): React.ReactElement {
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

export const denseTech: Template = {
  id: 'dense-tech',
  name: 'Dense Tech',
  description: 'Tighter spacing, monospaced accents on role + headings. Fits more content.',
  renderPdf: (doc) => DenseTechResume(doc),
  renderDocx: (doc) =>
    buildResumeDocument(doc, {
      bodyFont: 'Calibri',
      headingFont: 'Consolas',
      uppercaseHeadings: true,
      bulletSpacingAfter: 40,
      bodyHalfPt: 20,
    }),
};
