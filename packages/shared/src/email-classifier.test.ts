import { describe, expect, it } from 'vitest';
import {
  EMAIL_CLASSES,
  EmailClassificationSchema,
  HEURISTIC_TRUST_THRESHOLD,
  classifyEmailHeuristic,
  truncateSnippetForLlm,
  type EmailClass,
} from './email-classifier';

/**
 * E.5 heuristic: precision-first. Every test below is a real-shape example
 * pulled from the classes the plan enumerates (phase-5:65-68). If a rule
 * fires it MUST return the right class with confidence >= the shared
 * trust threshold; if it does not fire it MUST return null so the LLM
 * stage takes over.
 */

interface Case {
  cls: EmailClass | null;
  from: string;
  subject: string;
  snippet?: string;
}

const HITS: Case[] = [
  // job_alert_* - the parsers already gate on these senders, so we get
  // "for free" precision from vendor domain matches.
  {
    cls: 'job_alert_linkedin',
    from: 'LinkedIn <jobs-noreply@linkedin.com>',
    subject: '5 new senior software engineer jobs',
  },
  {
    cls: 'job_alert_linkedin',
    from: 'jobalerts-noreply@linkedin.com',
    subject: 'Your job alert for backend engineer',
  },
  { cls: 'job_alert_indeed', from: 'alert@indeed.com', subject: 'New jobs for you' },
  {
    cls: 'job_alert_naukri',
    from: 'Naukri.com <mailer@naukri.com>',
    subject: '10 matching jobs',
  },

  // rejection
  {
    cls: 'rejection',
    from: 'recruiting@example.com',
    subject: 'Update on your application - unfortunately',
  },
  {
    cls: 'rejection',
    from: 'talent-acquisition@bigco.com',
    subject: 'We will not be proceeding with your candidacy',
  },
  {
    cls: 'rejection',
    from: 'careers@acme.io',
    subject: 'Thank you but we decided not to move forward',
  },

  // offer
  {
    cls: 'offer',
    from: 'hr@bigco.com',
    subject: 'Congratulations - offer letter for Senior Engineer',
  },
  {
    cls: 'offer',
    from: 'people@startup.io',
    subject: 'We are pleased to offer you the role',
  },

  // interview_invite
  {
    cls: 'interview_invite',
    from: 'recruiting@stripe.com',
    subject: 'Interview scheduling - Backend Engineer',
  },
  {
    cls: 'interview_invite',
    from: 'sarah@acme.co',
    subject: 'Next round - technical interview',
  },
  {
    cls: 'interview_invite',
    from: 'lever@acme.co',
    subject: 'Invite you to an interview',
  },

  // assessment
  {
    cls: 'assessment',
    from: 'noreply@hackerrank.com',
    subject: 'Please complete your coding assessment',
  },
  {
    cls: 'assessment',
    from: 'test@karat.com',
    subject: 'Take-home assessment for role',
  },

  // recruiter (subject cue path)
  {
    cls: 'recruiter',
    from: 'jenny@third-party-recruiter.com',
    subject: 'Exciting opening at a stealth-mode startup',
  },
  {
    cls: 'recruiter',
    from: 'recruiter@example.com',
    subject: 'Would love to chat about a senior role',
  },

  // recruiter (sender-domain path)
  {
    cls: 'recruiter',
    from: 'jane@lever.co',
    subject: 'Quick question',
  },
  {
    cls: 'recruiter',
    from: 'sourcing@myworkday.com',
    subject: 'Reaching out',
  },
];

const MISSES: Case[] = [
  { cls: null, from: 'friend@personal.com', subject: 'lunch tomorrow' },
  { cls: null, from: 'newsletter@substack.com', subject: 'Weekly digest' },
  { cls: null, from: 'billing@service.com', subject: 'Your invoice for October' },
  { cls: null, from: 'security@github.com', subject: 'Sign-in from new device' },
];

describe('classifyEmailHeuristic - positive cases', () => {
  for (const c of HITS) {
    it(`${c.cls}: "${c.subject}" from "${c.from}"`, () => {
      const res = classifyEmailHeuristic(c);
      expect(res).not.toBeNull();
      expect(res!.class).toBe(c.cls);
      expect(res!.confidence).toBeGreaterThanOrEqual(HEURISTIC_TRUST_THRESHOLD);
      // MUTATION-SMOKE: change confidence threshold to 0.99 in the rules
      // and everything except job_alert_* fails.
      const parsed = EmailClassificationSchema.safeParse(res);
      expect(parsed.success).toBe(true);
    });
  }
});

describe('classifyEmailHeuristic - negative cases', () => {
  for (const c of MISSES) {
    it(`null: "${c.subject}" from "${c.from}"`, () => {
      const res = classifyEmailHeuristic(c);
      expect(res).toBeNull();
    });
  }
});

describe('EMAIL_CLASSES constant', () => {
  it('has exactly the 9 classes the plan enumerates', () => {
    expect(EMAIL_CLASSES).toHaveLength(9);
    expect(EMAIL_CLASSES).toEqual([
      'recruiter',
      'interview_invite',
      'assessment',
      'rejection',
      'offer',
      'job_alert_linkedin',
      'job_alert_indeed',
      'job_alert_naukri',
      'other',
    ]);
    // MUTATION-SMOKE: drop or reorder any class and this fails; downstream
    // eval fixtures depend on both membership + order.
  });
});

describe('truncateSnippetForLlm', () => {
  it('collapses whitespace + trims', () => {
    expect(truncateSnippetForLlm('  hello\n\tworld  ')).toBe('hello world');
  });

  it('appends " ..." only when over the max', () => {
    const s = 'x'.repeat(900);
    const out = truncateSnippetForLlm(s, 100);
    expect(out.length).toBe(104);
    expect(out.endsWith(' ...')).toBe(true);
  });

  it('leaves short snippets untouched', () => {
    expect(truncateSnippetForLlm('short')).toBe('short');
  });
});

describe('rejection wins over offer (order sensitivity)', () => {
  it('classifies "unfortunately we cannot offer" as rejection', () => {
    const res = classifyEmailHeuristic({
      from: 'careers@bigco.com',
      subject: 'Unfortunately we cannot offer you the role',
    });
    expect(res).not.toBeNull();
    expect(res!.class).toBe('rejection');
    // MUTATION-SMOKE: move the offer rule above the rejection rule and
    // this fails - both patterns match, so order sets precedence.
  });
});
