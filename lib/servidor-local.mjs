// Servidor estático local (127.0.0.1, porta aleatória) + entrada por ZIP/código colado.
// Nada do site analisado é executado em Node: só é servido ao Chromium isolado.
import http from 'node:http';
import { createReadStream, statSync, existsSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, extname, sep, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.map': 'application/json',
};

export const LIMITES_ZIP = { bytes: 200 * 1024 * 1024, arquivos: 5000, razaoMax: 200 };

// Sobe um servidor estático somente em 127.0.0.1. Retorna { url, porta, fechar }.
export async function servirPasta(raiz) {
  const base = resolve(raiz);
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new Error(`Pasta não encontrada: ${raiz}`);
  const servidor = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes('\0')) throw new Error('nulo');
      let alvo = normalize(join(base, rel));
      if (alvo !== base && !alvo.startsWith(base + sep)) { res.writeHead(403); return res.end('proibido'); }
      if (existsSync(alvo) && statSync(alvo).isDirectory()) alvo = join(alvo, 'index.html');
      if (!existsSync(alvo) && !extname(alvo) && existsSync(alvo + '.html')) alvo += '.html';
      if (!existsSync(alvo) || !statSync(alvo).isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('não encontrado'); }
      res.writeHead(200, { 'content-type': MIME[extname(alvo).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      createReadStream(alvo).pipe(res);
    } catch {
      res.writeHead(400); res.end('requisição inválida');
    }
  });
  await new Promise((ok, erro) => { servidor.once('error', erro); servidor.listen(0, '127.0.0.1', ok); });
  const porta = servidor.address().port;
  return {
    url: `http://127.0.0.1:${porta}/`,
    porta,
    fechar: () => new Promise((ok) => { servidor.closeAllConnections?.(); servidor.close(() => ok()); }),
  };
}

// Extrai ZIP com proteção contra zip-slip, zip bomb e excesso de arquivos. Retorna a pasta de destino.
export function extrairZipSeguro(arquivoZip, destino = null, limites = LIMITES_ZIP) {
  const dest = resolve(destino || mkdtempSync(join(tmpdir(), 'critiquesites-zip-')));
  mkdirSync(dest, { recursive: true });
  const zip = new AdmZip(arquivoZip);
  const entradas = zip.getEntries();
  if (entradas.length > limites.arquivos) throw new Error(`ZIP com arquivos demais (${entradas.length} > ${limites.arquivos})`);
  let total = 0;
  for (const e of entradas) {
    const nome = e.entryName.replace(/\\/g, '/');
    if (nome.startsWith('/') || /^[a-zA-Z]:/.test(nome) || nome.split('/').includes('..')) throw new Error(`ZIP com caminho perigoso: ${nome}`);
    const alvo = resolve(dest, nome);
    if (alvo !== dest && !alvo.startsWith(dest + sep)) throw new Error(`ZIP tenta sair da pasta: ${nome}`);
    if (!e.isDirectory) {
      total += e.header.size;
      if (e.header.compressedSize > 0 && e.header.size / e.header.compressedSize > limites.razaoMax && e.header.size > 1024 * 1024) throw new Error(`ZIP suspeito (razão de compressão alta): ${nome}`);
    }
  }
  if (total > limites.bytes) throw new Error(`ZIP descompactado grande demais (${total} > ${limites.bytes} bytes)`);
  for (const e of entradas) {
    const alvo = resolve(dest, e.entryName.replace(/\\/g, '/'));
    if (e.isDirectory) { mkdirSync(alvo, { recursive: true }); continue; }
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, e.getData());
  }
  return dest;
}

// Código colado vira um index.html numa pasta temporária.
export function salvarCodigoColado(codigo, destino = null) {
  const dest = resolve(destino || mkdtempSync(join(tmpdir(), 'critiquesites-colado-')));
  mkdirSync(dest, { recursive: true });
  const html = /<\s*html[\s>]|<!doctype/i.test(codigo) ? codigo : `<!doctype html>\n<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Código colado</title></head>\n<body>\n${codigo}\n</body></html>\n`;
  writeFileSync(join(dest, 'index.html'), html, 'utf8');
  return dest;
}
