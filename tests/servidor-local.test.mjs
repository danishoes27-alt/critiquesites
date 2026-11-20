import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { servirPasta, extrairZipSeguro, salvarCodigoColado } from '../lib/servidor-local.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('serve pasta em 127.0.0.1 com porta aleatória e fecha', async () => {
  const s = await servirPasta(join(fixtures, 'site-12'));
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const r = await fetch(s.url);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Casa Modelo/);
  const r404 = await fetch(s.url + 'nao-existe.html');
  assert.equal(r404.status, 404);
  const r2 = await fetch(s.url + 'sobre'); // resolve .html
  assert.equal(r2.status, 200);
  await s.fechar();
  await assert.rejects(fetch(s.url));
});

test('bloqueia path traversal', async () => {
  const s = await servirPasta(join(fixtures, 'site-12'));
  const r = await fetch(s.url + '..%2F..%2Fpackage.json');
  assert.ok([403, 404].includes(r.status));
  await s.fechar();
});

test('ZIP normal é extraído', () => {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('<h1>oi</h1>'));
  z.addFile('css/a.css', Buffer.from('body{}'));
  const arq = join(mkdtempSync(join(tmpdir(), 'cs-t-')), 'ok.zip');
  z.writeZip(arq);
  const dest = extrairZipSeguro(arq);
  assert.equal(readFileSync(join(dest, 'index.html'), 'utf8'), '<h1>oi</h1>');
  assert.ok(existsSync(join(dest, 'css', 'a.css')));
});

test('ZIP malicioso (zip-slip) é rejeitado', () => {
  const z = new AdmZip();
  z.addFile('index.html', Buffer.from('x'));
  const arq = join(mkdtempSync(join(tmpdir(), 'cs-t-')), 'mau.zip');
  z.writeZip(arq);
  // Reescreve o nome da entrada para ../fora.txt no próprio objeto antes de gravar
  const z2 = new AdmZip(arq);
  z2.getEntries()[0].entryName = '../fora.txt';
  const arq2 = join(mkdtempSync(join(tmpdir(), 'cs-t-')), 'mau2.zip');
  z2.writeZip(arq2);
  assert.throws(() => extrairZipSeguro(arq2), /perigoso|sair/);
});

test('ZIP com arquivos demais é rejeitado', () => {
  const z = new AdmZip();
  for (let i = 0; i < 6; i++) z.addFile(`a${i}.txt`, Buffer.from('x'));
  const arq = join(mkdtempSync(join(tmpdir(), 'cs-t-')), 'muitos.zip');
  z.writeZip(arq);
  assert.throws(() => extrairZipSeguro(arq, null, { bytes: 1e6, arquivos: 5, razaoMax: 200 }), /arquivos demais/);
});

test('ZIP grande demais é rejeitado', () => {
  const z = new AdmZip();
  z.addFile('grande.txt', Buffer.alloc(2000, 'a'));
  const arq = join(mkdtempSync(join(tmpdir(), 'cs-t-')), 'grande.zip');
  z.writeZip(arq);
  assert.throws(() => extrairZipSeguro(arq, null, { bytes: 1000, arquivos: 10, razaoMax: 1e9 }), /grande demais/);
});

test('código colado vira index.html', () => {
  const d = salvarCodigoColado('<h1>Oi</h1>');
  const html = readFileSync(join(d, 'index.html'), 'utf8');
  assert.match(html, /<h1>Oi<\/h1>/);
  assert.match(html, /<!doctype html>/i);
  const d2 = salvarCodigoColado('<!doctype html><html><body>ok</body></html>');
  assert.equal(readFileSync(join(d2, 'index.html'), 'utf8').startsWith('<!doctype html>'), true);
});
