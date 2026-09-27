// Canonical shape yielded by every parser. `snippet` is the parser's chosen
// summary excerpt (usually the JD blurb the alert mail shows above the fold);
// UI + downstream match code should never require it. `postedAt` is best-effort:
// alert mails render relative strings ("2 days ago") that we resolve against
// `receivedAt`; when unresolvable the parser leaves it null.
import { z } from 'zod';

export const EMAIL_SOURCES = ['linkedin', 'indeed', 'naukri'] as const;
export type EmailSource = (typeof EMAIL_SOURCES)[number];

export const EmailJobSchema = z.object({
  title: z.string().min(1).max(300),
  company: z.string().max(200).nullable(),
  location: z.string().max(200).nullable(),
  url: z.string().url(),
  snippet: z.string().max(2_000).nullable(),
  postedAt: z.date().nullable(),
});
export type EmailJob = z.infer<typeof EmailJobSchema>;

export const ParsedEmailSchema = z.object({
  source: z.enum(EMAIL_SOURCES),
  subject: z.string().max(1_000),
  from: z.string().max(500),
  receivedAt: z.date(),
  jobs: z.array(EmailJobSchema),
});
export type ParsedEmail = z.infer<typeof ParsedEmailSchema>;

export interface ParseInput {
  from: string;
  subject: string;
  html: string;
  receivedAt?: Date;
}
