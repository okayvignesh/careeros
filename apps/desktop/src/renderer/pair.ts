/**
 * D.4 scaffold: pair-window renderer. Reads the 6-digit code, hands it to
 * the main process over the preload bridge, flips the status line.
 *
 * ponytail: no framework. If this window ever grows past the pair + status
 * lines, extract to vite + a tiny component lib; today a 40-line file does it.
 */

interface CareerOsBridge {
  submitPairingCode(code: string): Promise<{ ok: true } | { ok: false; error: string }>;
}
declare global {
  interface Window {
    careeros: CareerOsBridge;
  }
}

const codeInput = document.getElementById('code') as HTMLInputElement;
const submitBtn = document.getElementById('submit') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = kind ? `status ${kind}` : 'status';
}

async function submit(): Promise<void> {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setStatus('Enter the 6-digit code shown in web settings.', 'err');
    return;
  }
  submitBtn.disabled = true;
  setStatus('Pairing...');
  const res = await window.careeros.submitPairingCode(code);
  submitBtn.disabled = false;
  if (res.ok) {
    setStatus('Paired. You can close this window.', 'ok');
  } else {
    setStatus(res.error, 'err');
  }
}

submitBtn.addEventListener('click', () => void submit());
codeInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') void submit();
});
codeInput.focus();

// Make this a module so the `declare global` block is allowed.
export {};
