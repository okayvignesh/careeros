# Postmortem - <short title>

Date: YYYY-MM-DD
Author: <name>
Severity: P1 | P2 | P3 | P4
Status: Open | Mitigated | Resolved

## Summary

One paragraph: what happened, who noticed, what was the impact, what
was the fix. Written so a reader with no context can skip the rest
and still get the story.

## Timeline

All times UTC. Timestamps from logs are authoritative; your memory
is not.

- `HH:MM` - first signal (metric spike, user report, test red, etc.)
- `HH:MM` - acknowledged (someone looked at it)
- `HH:MM` - triage decision made
- `HH:MM` - mitigation applied (describe)
- `HH:MM` - fix deployed
- `HH:MM` - verified back to normal
- `HH:MM` - all-clear

Total: `<impact window>` of degraded or down.

## Impact

- Services affected:
- Users affected (count or scope):
- Data loss: yes / no (describe)
- Monetary loss / cost spike:
- Downstream integrations affected:

## Root cause

Not "the bug" but the WHY under the bug. Keep asking "why" until
there is a structural answer, not a human one.

Example of a weak root cause: "a developer merged bad code."
Example of a good root cause: "the CI didn't run the integration
test for this module because the glob pattern missed the renamed
file, and no one noticed because the module tests are run less than
weekly."

## Trigger

What specifically fired the incident? A deploy, a cron run, external
event (e.g. a Google API change)?

## Detection

How did we find out? Alert fired? User reported? You happened to
glance at a dashboard? Note whether detection was adequate; a
60-minute silent degradation is a detection problem too.

## Response

What did the responder actually do? List the steps even if some
were wasted motion - the next person needs to know the dead-ends.

## Lessons

### What went well

- `<thing>` worked (e.g. "pause switch stopped the cost bleed in <1min").

### What went poorly

- `<thing>` was slow, missing, or wrong.

### Where we got lucky

- `<thing>` could easily have been worse (e.g. "the backup worked
  but we never actually tried a restore").

## Action items

| # | Action | Owner | Due |
|---|---|---|---|
| 1 | <concrete work item> | | |
| 2 | | | |

Each action item should be a concrete PR or ticket - not "think
about doing X". Verify every item has a tracking ref before closing
the postmortem.

## Supporting data

- Links to dashboards + relevant time windows.
- Links to the fix PR(s).
- Audit log excerpts (redact PII before pasting).
- Any screenshots, with filenames + ownership.

## Follow-up review date

Set a reminder for 2-4 weeks out to re-read this postmortem and
confirm the action items landed. Postmortems that no one revisits
are postmortem-shaped journal entries, not operational artifacts.
