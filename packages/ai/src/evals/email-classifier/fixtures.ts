// E.5 eval fixtures. Real-shape emails per class; three per class covers
// the primary signal channels (sender, subject, snippet). Plan target is
// 30+ per class; this ships the scaffold so a follow-up slice can bulk
// author without touching wiring.

import type { EmailClass } from '@careeros/shared';

export interface EmailFixture {
  readonly id: string;
  readonly expectedClass: EmailClass;
  readonly from: string;
  readonly subject: string;
  readonly snippet: string;
  /** Confidence band the classifier output should land in. */
  readonly expectedConfidenceMin: number;
}

// Ordered by class - keeps the fixture file skimmable + makes it obvious
// where to add more per class.
export const EMAIL_FIXTURES: readonly EmailFixture[] = [
  // recruiter
  {
    id: 'recruiter-lever-outreach',
    expectedClass: 'recruiter',
    from: 'jane@lever.co',
    subject: 'Quick question about your background',
    snippet:
      'Hi, I came across your GitHub profile and would love to chat about a Senior Backend role at a Series B fintech. Do you have 15 minutes this week?',
    expectedConfidenceMin: 0.7,
  },
  {
    id: 'recruiter-cold-outreach',
    expectedClass: 'recruiter',
    from: 'james@third-party-recruit.co',
    subject: 'Exciting opening at a stealth-mode AI startup',
    snippet: 'Their team is 30 engineers, well-funded, and hiring aggressively.',
    expectedConfidenceMin: 0.7,
  },
  {
    id: 'recruiter-inbound-referral',
    expectedClass: 'recruiter',
    from: 'sourcing@myworkday.com',
    subject: 'Reaching out about an available position',
    snippet: 'One of our clients is looking for a Staff Engineer with your background.',
    expectedConfidenceMin: 0.7,
  },

  // interview_invite
  {
    id: 'interview-invite-scheduling',
    expectedClass: 'interview_invite',
    from: 'recruiting@stripe.com',
    subject: 'Interview scheduling - Backend Engineer at Stripe',
    snippet:
      'Congrats on advancing! Please pick a slot below for your first technical interview.',
    expectedConfidenceMin: 0.8,
  },
  {
    id: 'interview-invite-next-round',
    expectedClass: 'interview_invite',
    from: 'people@acme.co',
    subject: 'Next round - technical interview with the platform team',
    snippet: 'You have moved to round 3. Please book a slot with the team lead.',
    expectedConfidenceMin: 0.8,
  },
  {
    id: 'interview-invite-hr-round',
    expectedClass: 'interview_invite',
    from: 'jane@bigco.com',
    subject: 'Invite you to an interview for the Senior SWE role',
    snippet: 'Congrats on progressing! Please set up a time using the link below.',
    expectedConfidenceMin: 0.8,
  },

  // assessment
  {
    id: 'assessment-hackerrank',
    expectedClass: 'assessment',
    from: 'noreply@hackerrank.com',
    subject: 'Please complete your coding assessment for Bigco',
    snippet: 'You have 5 days to complete this 90-minute assessment.',
    expectedConfidenceMin: 0.8,
  },
  {
    id: 'assessment-karat-takehome',
    expectedClass: 'assessment',
    from: 'test@karat.com',
    subject: 'Take-home assessment for the Backend Engineer role',
    snippet: 'Attached is the take-home. Please submit within 72 hours.',
    expectedConfidenceMin: 0.8,
  },
  {
    id: 'assessment-codesignal',
    expectedClass: 'assessment',
    from: 'notifications@codesignal.com',
    subject: 'Your CodeSignal assessment invite',
    snippet: 'Complete the assessment before Friday.',
    expectedConfidenceMin: 0.8,
  },

  // rejection
  {
    id: 'rejection-unfortunately',
    expectedClass: 'rejection',
    from: 'talent-acquisition@bigco.com',
    subject: 'Update on your application - Unfortunately',
    snippet: 'After careful consideration, we have decided not to move forward.',
    expectedConfidenceMin: 0.85,
  },
  {
    id: 'rejection-decided-not-to',
    expectedClass: 'rejection',
    from: 'careers@acme.io',
    subject: 'Thank you but we decided not to move forward at this time',
    snippet: 'We appreciate your time interviewing with our team.',
    expectedConfidenceMin: 0.85,
  },
  {
    id: 'rejection-regret-to-inform',
    expectedClass: 'rejection',
    from: 'noreply@stripe.com',
    subject: 'We regret to inform you about your application',
    snippet: 'We had a highly competitive pool this cycle.',
    expectedConfidenceMin: 0.85,
  },

  // offer
  {
    id: 'offer-congratulations',
    expectedClass: 'offer',
    from: 'hr@bigco.com',
    subject: 'Congratulations - offer letter for Senior Engineer',
    snippet: 'Please find your offer package attached. We are excited to have you join us.',
    expectedConfidenceMin: 0.85,
  },
  {
    id: 'offer-pleased-to-offer',
    expectedClass: 'offer',
    from: 'people@startup.io',
    subject: 'We are pleased to offer you the Staff Engineer role',
    snippet: 'Please review the offer terms and let us know if you have questions.',
    expectedConfidenceMin: 0.85,
  },
  {
    id: 'offer-employment',
    expectedClass: 'offer',
    from: 'ta@stripe.com',
    subject: 'Offer of employment - Stripe Senior SWE',
    snippet: 'We are excited to extend this offer to you.',
    expectedConfidenceMin: 0.85,
  },

  // job_alert_linkedin
  {
    id: 'linkedin-alert-1',
    expectedClass: 'job_alert_linkedin',
    from: 'LinkedIn <jobs-noreply@linkedin.com>',
    subject: '5 new senior software engineer jobs',
    snippet: 'Bigco, Startup, Fintech, ...',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'linkedin-alert-2',
    expectedClass: 'job_alert_linkedin',
    from: 'jobalerts-noreply@linkedin.com',
    subject: 'Your job alert for backend engineer',
    snippet: 'New roles matching your saved search.',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'linkedin-alert-3',
    expectedClass: 'job_alert_linkedin',
    from: 'LinkedIn Job Alerts <jobs-noreply@linkedin.com>',
    subject: 'New jobs for you: staff engineer',
    snippet: 'Bigco, ...',
    expectedConfidenceMin: 0.95,
  },

  // job_alert_indeed
  {
    id: 'indeed-alert-1',
    expectedClass: 'job_alert_indeed',
    from: 'alert@indeed.com',
    subject: 'New jobs for you: senior swe',
    snippet: '15 new matches.',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'indeed-alert-2',
    expectedClass: 'job_alert_indeed',
    from: 'Indeed <alert@indeed.com>',
    subject: 'Backend engineer jobs near you',
    snippet: 'Sponsored + top matches.',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'indeed-alert-3',
    expectedClass: 'job_alert_indeed',
    from: 'noreply@indeed.com',
    subject: 'Weekly jobs digest',
    snippet: '7 new matches this week.',
    expectedConfidenceMin: 0.9,
  },

  // job_alert_naukri
  {
    id: 'naukri-alert-1',
    expectedClass: 'job_alert_naukri',
    from: 'Naukri.com <mailer@naukri.com>',
    subject: '10 matching jobs for you',
    snippet: 'Bigco India, ...',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'naukri-alert-2',
    expectedClass: 'job_alert_naukri',
    from: 'mailer@naukri.com',
    subject: 'Recommended jobs based on your profile',
    snippet: 'Backend, Node.js, 5-8 yrs experience.',
    expectedConfidenceMin: 0.95,
  },
  {
    id: 'naukri-alert-3',
    expectedClass: 'job_alert_naukri',
    from: 'jobalerts@naukri.com',
    subject: 'New job alert matches',
    snippet: 'Senior Software Engineer, Bengaluru.',
    expectedConfidenceMin: 0.9,
  },

  // other (fallback path)
  {
    id: 'other-newsletter',
    expectedClass: 'other',
    from: 'newsletter@substack.com',
    subject: 'This week in AI',
    snippet: 'Roundup of AI news.',
    expectedConfidenceMin: 0,
  },
  {
    id: 'other-personal',
    expectedClass: 'other',
    from: 'mom@personal.com',
    subject: 'Sunday lunch?',
    snippet: 'Are you free this Sunday?',
    expectedConfidenceMin: 0,
  },
  {
    id: 'other-billing',
    expectedClass: 'other',
    from: 'billing@service.com',
    subject: 'Your invoice for October',
    snippet: 'Attached is your monthly invoice.',
    expectedConfidenceMin: 0,
  },
];

/** Public counter so plan-sync + tests can assert coverage grows. */
export const FIXTURE_COUNT_PER_CLASS = 3;
