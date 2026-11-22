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

// F is the standalone combat derivative. It is deliberately separate from
// standard and C; its rival AI/combat systems are gated by __SCALEBOUND_F__.
const f = html
  .replace('<head>', '<head>\n  <script>window.__SCALEBOUND_F__ = true;</script>')
  .replace(/<title>[^<]*<\/title>/, '<title>鳞界 2.6 F · SCALEBOUND</title>');
const fOut = path.join(root, 'scalebound-f.html');
fs.writeFileSync(fOut, f);
console.log(`F combat edition → ${fOut} (${(fs.statSync(fOut).size / 1024 / 1024).toFixed(2)} MB)`);

// China Edition: standard rules, eight native dragons, ink-wash presentation.
const cn = html
  .replace('<head>', '<head>\n  <script>window.__SCALEBOUND_CN__ = true;</script>')
  .replace(/<title>[^<]*<\/title>/, '<title>鳞界 · 山河龙谱 C5 · SCALEBOUND</title>');
let cnHtml = cn;
const fontPath = path.join(root, 'assets', 'MaShanZheng-Regular.ttf');
if (fs.existsSync(fontPath)) {
  const font64 = fs.readFileSync(fontPath).toString('base64');
  cnHtml = cnHtml.replace('</head>', `<style>@font-face{font-family:"MaShanZheng";src:url(data:font/ttf;base64,${font64}) format("truetype");font-weight:400;font-style:normal;font-display:swap;}</style></head>`);
} else {
  console.warn('Brush font missing; C edition will use system Songti.');
}
const cnOut = path.join(root, 'scalebound-cn.html');
fs.writeFileSync(cnOut, cnHtml);
console.log(`China edition → ${cnOut} (${(fs.statSync(cnOut).size / 1024 / 1024).toFixed(2)} MB)`);
