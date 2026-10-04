// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dialog, type DialogProps } from './Dialog';

// React needs this flag to treat `act` as the owner of the update queue.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(onClose: () => void = () => {}): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    // Cast: `Dialog` requires `children`, but React's createElement overload only
    // wants it on the props object; passing real children as extra args is the
    // lint-preferred form.
    root?.render(
      createElement(
        Dialog,
        { open: true, onClose, title: 'Confirm', testId: 'test-dialog' } as DialogProps,
        createElement('button', { key: 'child', type: 'button', 'data-testid': 'child' }, 'Child'),
        createElement('button', { key: 'footer', type: 'button', 'data-testid': 'footer' }, 'Footer'),
      ),
    );
  });
  return document.querySelector('[role="dialog"]') as HTMLElement;
}

function press(key: string, shiftKey = false): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

afterEach(() => {
  if (root) {
    const current = root;
    act(() => current.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('Dialog focus trap', () => {
  it('moves focus into the panel on open and queries its focusables in order', () => {
    const panel = mount();
    expect(document.activeElement).toBe(panel);
    const [first, , last] = Array.from(panel.querySelectorAll('button'));
    expect(first?.getAttribute('data-testid')).toBe('test-dialog-close');
    expect(last?.getAttribute('data-testid')).toBe('footer');
  });

  it('wraps Tab from the last focusable back to the first', () => {
    const panel = mount();
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button'));
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    last.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first focusable to the last', () => {
    const panel = mount();
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button'));
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    first.focus();
    press('Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('sends Tab from the panel itself to the first focusable, and Shift+Tab to the last', () => {
    const panel = mount();
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button'));
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;

    panel.focus();
    press('Tab');
    expect(document.activeElement).toBe(first);

    panel.focus();
    press('Tab', true);
    expect(document.activeElement).toBe(last);
  });

  it('still closes on Escape', () => {
    let closed = 0;
    mount(() => {
      closed += 1;
    });
    press('Escape');
    expect(closed).toBe(1);
  });

  it('restores focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    mount();
    const current = root as Root;
    act(() => current.unmount());
    root = null;
    expect(document.activeElement).toBe(trigger);
  });
});
