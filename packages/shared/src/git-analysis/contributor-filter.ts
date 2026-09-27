// Filter a commit list down to the user's own contributions. Match against
// a supplied "known emails" set — never guess. Case-insensitive; also folds
// GitHub `<id>+<login>@users.noreply.github.com` noreply emails to the
// canonical form so a user's public commits (which surface as the noreply)
// match against the private primary email GitHub sometimes returns.

export interface CommitLike {
  sha: string;
  authorEmail: string | null;
  committerEmail: string | null;
}

export interface KnownEmails {
  /** Every email the user has told us about (from /user/emails on GitHub, or `email` on GitLab). */
  emails: string[];
  /** The GitHub login, when known. Used to match `<id>+<login>@users.noreply.github.com`. */
  githubLogin?: string;
}

/**
 * Normalise an email for comparison:
 *  - trim + lowercase
 *  - strip the numeric-id prefix + `+` from GitHub noreply emails
 *    (`12345+alice@users.noreply.github.com` → `alice@users.noreply.github.com`)
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  const trimmed = email.trim().toLowerCase();
  const noreplyMatch = trimmed.match(/^\d+\+([^@]+)@users\.noreply\.github\.com$/);
  if (noreplyMatch) return `${noreplyMatch[1]}@users.noreply.github.com`;
  return trimmed;
}

/**
 * Build the set of emails a commit's `authorEmail` / `committerEmail` will
 * be compared against. Includes the noreply form for the login when
 * `githubLogin` is set.
 */
export function buildKnownEmailSet(known: KnownEmails): Set<string> {
  const out = new Set<string>();
  for (const e of known.emails) {
    const n = normalizeEmail(e);
    if (n) out.add(n);
  }
  if (known.githubLogin) {
    out.add(`${known.githubLogin.toLowerCase()}@users.noreply.github.com`);
  }
  return out;
}

/**
 * Returns commits whose author OR committer email is in the known-set.
 * Matches the SEMANTICS the ticket asks for: filter down to the user's own
 * contributions. Never emits a commit whose author identity we don't own —
 * that's how we avoid crediting the user for merged upstream commits.
 */
export function filterOwnCommits<T extends CommitLike>(
  commits: T[],
  known: KnownEmails,
): T[] {
  const set = buildKnownEmailSet(known);
  if (set.size === 0) return []; // no known emails = nothing is ours
  return commits.filter((c) => {
    const a = normalizeEmail(c.authorEmail);
    const co = normalizeEmail(c.committerEmail);
    return (a && set.has(a)) || (co && set.has(co));
  });
}
