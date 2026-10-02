// D.4 scaffold: copy renderer HTML into dist alongside the compiled JS.
// ponytail: 10 lines of fs.cp vs. a bundler. Add vite only when the renderer
// grows past one window.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'renderer');
const dst = join(here, '..', 'dist', 'renderer');

await mkdir(dst, { recursive: true });
await cp(src, dst, { recursive: true });
console.log(`copied renderer/ -> ${dst}`);
