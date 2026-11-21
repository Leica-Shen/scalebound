import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const dist = path.join(root, 'dist');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const readAsset = (url) => {
  const rel = url.replace(/^\.?\//, '').split('?')[0];
  return fs.readFileSync(path.join(dist, rel), 'utf8');
};
html = html.replace(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${readAsset(href)}\n</style>`);
html = html.replace(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g, (_, src) => {
  const js = readAsset(src).replace(/<\/script/gi, '<\\/script');
  return `<script type="module">\n${js}\n</script>`;
});
html = html.replace(/<link[^>]+rel="modulepreload"[^>]*>/g, '');
const out = path.join(root, 'scalebound.html');
fs.writeFileSync(out, html);
console.log(`Standalone game → ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);

// Beta preview is deliberately a separate artifact. Its experimental systems
// (auto-flight, rival dragon AI, combat) are gated by window.__SCALEBOUND_BETA__
// and marked BETA in the HUD, so stable players never receive them by accident.
const beta = html
  .replace('<head>', '<head>\n  <script>window.__SCALEBOUND_BETA__ = true;</script>')
  .replace(/<title>[^<]*<\/title>/, '<title>鳞界 2.1 Beta · SCALEBOUND</title>');
const betaOut = path.join(root, 'scalebound-beta.html');
fs.writeFileSync(betaOut, beta);
console.log(`Beta preview → ${betaOut} (${(fs.statSync(betaOut).size / 1024 / 1024).toFixed(2)} MB)`);
