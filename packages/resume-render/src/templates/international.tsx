/**
 * `international` — EU / non-North-America convention: A4 paper, single column,
 * Helvetica, a compact verified contact line under the role target. Uses the
 * SAME section/bullet structure as `classic` so it stays ATS-parseable; the only
 * regional differences are paper size and the contact/location header.
 *
 * ponytail: A4 + one header line, not a full Europass clone. The owner asked
 * for region-aware FORMAT, not a redesign; A4 is the honest regional signal and
 * the verified contact line is the one block EU readers expect up top.
 */
import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { buildResumeDocument } from '../docx';
import type { ResumeDoc, Template } from '../types';

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    lineHeight: 1.4,
    color: '#111',
  },
  header: { marginBottom: 18 },
  roleTarget: { fontSize: 16, fontWeight: 'bold', marginBottom: 4 },
  metaLine: { fontSize: 10, color: '#555' },
  contactLine: { fontSize: 10, color: '#555', marginTop: 2 },
  section: { marginTop: 14 },
  sectionHeading: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottom: '1pt solid #999',
  },
  summary: { marginBottom: 4 },
  bullet: { flexDirection: 'row', marginBottom: 3 },
  bulletMark: { width: 12 },
  bulletText: { flex: 1 },
});

function InternationalResume(doc: ResumeDoc): React.ReactElement {
  const contact = doc.contact;
  // Only render fields that exist; join with the conventional " · " separator.
  const contactParts = contact
    ? [contact.name, contact.location, contact.email].filter((v): v is string => Boolean(v))
    : [];

  return (
    <Document title={`Resume - ${doc.roleTarget}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.roleTarget}>{doc.roleTarget}</Text>
          {doc.jobCompany && <Text style={styles.metaLine}>Tailored for {doc.jobCompany}</Text>}
          {contact?.headline && <Text style={styles.contactLine}>{contact.headline}</Text>}
          {contactParts.length > 0 && (
            <Text style={styles.contactLine}>{contactParts.join(' · ')}</Text>
          )}
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

export const international: Template = {
  id: 'international',
  name: 'International (A4)',
  description: 'A4 single-column with a verified contact/location line. EU / international convention.',
  renderPdf: (doc) => InternationalResume(doc),
  renderDocx: (doc) =>
    buildResumeDocument(doc, {
      bodyFont: 'Calibri',
      headingFont: 'Calibri',
      uppercaseHeadings: true,
    }),
};
