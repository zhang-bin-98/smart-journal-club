import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export function pwaPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'smartjc-static-pwa',
    configResolved(value) { config = value; },
    async buildStart() {
      if (config.command !== 'build') return;
      for (const group of ['cmaps', 'standard_fonts', 'wasm']) {
        const directory = resolve(config.root, 'node_modules/pdfjs-dist', group);
        for (const name of await readdir(directory)) this.emitFile({ type: 'asset', fileName: `pdfjs/${group}/${name}`, source: await readFile(resolve(directory, name)) });
      }
    },
    configureServer(server) {
      const base = config.base === './' ? '/' : config.base;
      server.middlewares.use(`${base}pdfjs/`, (req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (!/^\/(cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+$/.test(path)) { next(); return; }
        void readFile(resolve(config.root, 'node_modules/pdfjs-dist', path.slice(1))).then(data => {
          res.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); res.end(data);
        }, () => next());
      });
    },
    async closeBundle() {
      if (config.command !== 'build') return;
      const directory = resolve(config.root, config.build.outDir);
      const entries = await readdir(directory, { recursive: true, withFileTypes: true });
      const files = entries.filter(entry => entry.isFile() && entry.name !== 'sw.js')
        .map(entry => relative(directory, resolve(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort();
      const template = await readFile(resolve(config.root, 'scripts/service-worker.js'), 'utf8');
      const hash = createHash('sha256').update(template);
      const integrity: Record<string, string> = {};
      for (const file of files) { const content = await readFile(resolve(directory, file)); hash.update(file); hash.update(content); integrity[file] = `sha256-${createHash('sha256').update(content).digest('base64')}`; }
      const source = template.replace('__SMARTJC_VERSION__', JSON.stringify(hash.digest('hex').slice(0, 16))).replace('__SMARTJC_FILES__', JSON.stringify(files)).replace('__SMARTJC_INTEGRITY__', JSON.stringify(integrity));
      await writeFile(resolve(directory, 'sw.js'), source);
    },
  };
}
