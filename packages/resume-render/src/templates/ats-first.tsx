/**
 * ATS-first template — the safest possible layout for automated resume
 * parsers. Single column, standard font (Helvetica), plain-text section
 * headings, no images, no colored text, no fancy glyphs. Every export from
 * this template should survive `pdf-parse` extraction unchanged.
 *
 * ponytail: one template today. `classic` / `modern-minimal` / `dense-tech`
 * variants land when the user actually picks between them; adding them now
 * would ship unused code.
 */
import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontFamily: 'Helvetica',
    fontSize: 10.5,
    lineHeight: 1.4,
    color: '#111',
  },
  header: {
    marginBottom: 18,
  },
  roleTarget: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  metaLine: {
    fontSize: 10,
    color: '#555',
  },
  section: {
    marginTop: 14,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    paddingBottom: 2,
    borderBottom: '1pt solid #999',
  },
  summary: {
    marginBottom: 4,
  },
  bullet: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  bulletMark: {
    width: 12,
  },
  bulletText: {
    flex: 1,
  },
  paragraph: {
    marginBottom: 8,
  },
  letterHeader: {
    marginBottom: 12,
  },
});

export interface ResumePdfProps {
  roleTarget: string;
  jobCompany: string | null;
  content: {
    summary: string;
    sections: Array<{
      heading: string;
      bullets: Array<{ text: string }>;
    }>;
  };
}

export function AtsFirstResume({ roleTarget, jobCompany, content }: ResumePdfProps): React.ReactElement {
  return (
    <Document title={`Resume - ${roleTarget}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.roleTarget}>{roleTarget}</Text>
          {jobCompany && <Text style={styles.metaLine}>Tailored for {jobCompany}</Text>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Summary</Text>
          <Text style={styles.summary}>{content.summary}</Text>
        </View>

        {content.sections.map((sec, i) => (
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

export interface CoverLetterPdfProps {
  roleTarget: string;
  jobCompany: string | null;
  content: {
    greeting: string;
    paragraphs: Array<{ text: string }>;
    closing: string;
  };
}

export function AtsFirstCoverLetter({ roleTarget, jobCompany, content }: CoverLetterPdfProps): React.ReactElement {
  return (
    <Document title={`Cover letter - ${roleTarget}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.letterHeader}>
          <Text style={styles.roleTarget}>Cover letter</Text>
          {jobCompany && (
            <Text style={styles.metaLine}>
              For {roleTarget} at {jobCompany}
            </Text>
          )}
        </View>

        <Text style={styles.paragraph}>{content.greeting}</Text>
        {content.paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p.text}
          </Text>
        ))}
        <Text style={styles.paragraph}>{content.closing}</Text>
      </Page>
    </Document>
  );
}
