// Slash-command routing tests. Each command lands on the right handler and
// returns a valid Block Kit payload; unknown commands fall through to an
// ephemeral 'not found' rather than throwing.
import { describe, expect, it, vi } from 'vitest';
import {
  buildSlashRouter,
  dispatchSlash,
  SLASH_COMMANDS,
  type SlackSlashPayload,
  type SlashCommand,
} from './slack.slash-commands';

function payload(overrides: Partial<SlackSlashPayload>): SlackSlashPayload {
  return {
    command: '/quiz',
    text: '',
    user_id: 'U1',
    channel_id: 'C1',
    team_id: 'T1',
    ...overrides,
  };
}

describe('slash-command routing', () => {
  it('registers all seven documented commands', () => {
    const router = buildSlashRouter();
    for (const cmd of SLASH_COMMANDS) {
      expect(typeof router[cmd]).toBe('function');
    }
  });

  it('/quiz -> assessment prompt (mock handler observes call)', async () => {
    const mockQuiz = vi.fn((_p: SlackSlashPayload) => ({
      text: 'quiz mock',
      blocks: [{ type: 'section' as const, text: { type: 'mrkdwn' as const, text: 'x' } }],
    }));
    const router = buildSlashRouter({ '/quiz': mockQuiz });
    const msg = await dispatchSlash(payload({ command: '/quiz', text: 'graphs' }), router);
    expect(mockQuiz).toHaveBeenCalledOnce();
    expect(mockQuiz.mock.calls[0][0].text).toBe('graphs');
    expect(msg.text).toBe('quiz mock');
  });

  it('/quiz default handler embeds topic + defaults to general', async () => {
    const msg = await dispatchSlash(payload({ command: '/quiz', text: '' }));
    expect(JSON.stringify(msg)).toContain('general');
  });

  it('/jobs clamps arg to [1, 5]', async () => {
    const high = await dispatchSlash(payload({ command: '/jobs', text: '99' }));
    const low = await dispatchSlash(payload({ command: '/jobs', text: '0' }));
    const mid = await dispatchSlash(payload({ command: '/jobs', text: '3' }));
    expect(high.text).toContain('Top 5');
    expect(low.text).toContain('Top 1');
    expect(mid.text).toContain('Top 3');
  });

  it('/approve without id returns usage', async () => {
    const msg = await dispatchSlash(payload({ command: '/approve', text: '' }));
    expect(msg.text).toContain('Usage');
  });

  it('/approve with id renders approval block with embedded id', async () => {
    const msg = await dispatchSlash(payload({ command: '/approve', text: 'apr-1' }));
    expect(JSON.stringify(msg)).toContain('approval:approve:apr-1');
    expect(JSON.stringify(msg)).toContain('approval:reject:apr-1');
  });

  it('/pause and /resume return ephemeral confirmations', async () => {
    const p = await dispatchSlash(payload({ command: '/pause' }));
    const r = await dispatchSlash(payload({ command: '/resume' }));
    expect(p.text).toContain('paused');
    expect(r.text).toContain('resumed');
  });

  it('unknown command returns ephemeral not-found without throwing', async () => {
    const msg = await dispatchSlash(payload({ command: '/notacommand' as SlashCommand }));
    expect(msg.text).toContain('Unknown command');
  });
});
