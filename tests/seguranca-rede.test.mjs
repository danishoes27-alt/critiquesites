import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ehEnderecoPrivado, urlPermitida, buscarSeguro } from '../lib/rede-segura.mjs';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';

const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

test('endereços privados', () => {
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '172.31.255.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '224.0.0.1'])
    assert.ok(ehEnderecoPrivado(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '1.1.1.1', '2606:4700:4700::1111'])
    assert.ok(!ehEnderecoPrivado(ip), ip);
});

test('urlPermitida bloqueia metadata, IPs internos, localhost e protocolos estranhos', async () => {
  for (const u of ['http://169.254.169.254/latest/meta-data', 'http://10.0.0.1/', 'http://localhost:3000/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://x.com/', 'http://metadata.google.internal/'])
    assert.equal((await urlPermitida(u)).ok, false, u);
  assert.equal((await urlPermitida('http://127.0.0.1:5000/', { permitidos: ['127.0.0.1:5000'] })).ok, true);
  assert.equal((await urlPermitida('http://127.0.0.1:5001/', { permitidos: ['127.0.0.1:5000'] })).ok, false);
  assert.equal((await urlPermitida('http://localhost:3000/', { permitirLocal: true })).ok, true);
});

test('buscarSeguro: redirecionamento para IP privado é bloqueado; limite de tamanho; timeout', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/' }); return res.end(); }
    if (req.url === '/grande') { res.writeHead(200); return res.end(Buffer.alloc(3000, 'a')); }
    if (req.url === '/lento') { return; } // nunca responde
    res.writeHead(200); res.end('ok');
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const hp = `127.0.0.1:${srv.address().port}`;
  const base = `http://${hp}`;
  await assert.rejects(buscarSeguro(base + '/redir', { permitidos: [hp] }), (e) => e.bloqueado === true);
  await assert.rejects(buscarSeguro(base + '/grande', { permitidos: [hp], maxBytes: 1000 }), (e) => e.grande === true);
  await assert.rejects(buscarSeguro(base + '/lento', { permitidos: [hp], timeoutMs: 300 }));
  const r = await buscarSeguro(base + '/', { permitidos: [hp] });
  assert.equal(r.texto(), 'ok');
  srv.closeAllConnections?.();
  srv.close();
});

test('navegador: carrega o servidor local permitido e bloqueia rede interna', async () => {
  const servidor = await servirPasta(fixtures + 'site-12');
  const nav = await abrirNavegador({ permitidos: [`127.0.0.1:${servidor.porta}`], timeoutMs: 8000 });
  try {
    const ctx = await nav.novoContexto();
    const pg = await ctx.newPage();
    await pg.goto(servidor.url);
    assert.match(await pg.title(), /Casa Modelo/);
    // tentativa de acessar metadata de nuvem e IP privado de dentro da página
    const res = await pg.evaluate(async () => {
      const alvos = ['http://169.254.169.254/latest/meta-data/', 'http://10.255.255.1/'];
      const out = [];
      for (const a of alvos) { try { await fetch(a, { mode: 'no-cors' }); out.push('abriu'); } catch { out.push('falhou'); } }
      return out;
    });
    assert.deepEqual(res, ['falhou', 'falhou']);
    assert.ok(nav.bloqueios.some((b) => b.url.includes('169.254.169.254')));
    // navegar direto para IP privado também falha
    await assert.rejects(pg.goto('http://10.255.255.1/'));
    // aba nova (a aba da navegação bloqueada fica numa página de erro); permissões negadas
    const pg2 = await ctx.newPage();
    await pg2.goto(servidor.url);
    const perm = await pg2.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state);
    assert.notEqual(perm, 'granted');
    await ctx.close();
  } finally {
    await nav.fechar();
    await servidor.fechar();
  }
});

test('SSRF: IPv6 que embute IPv4 (mapeado em hexadecimal, compatível, NAT64, 6to4) é tratado como interno', () => {
  for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:c0a8:1', '::ffff:a00:1', '::127.0.0.1', '::10.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'fec0::1', '[::ffff:7f00:1]', 'fe80::1%eth0'])
    assert.ok(ehEnderecoPrivado(ip), ip);
  for (const ip of ['::ffff:808:808', '::ffff:8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    assert.ok(!ehEnderecoPrivado(ip), ip);
});

test('SSRF: URL com IPv4 mapeado em hexadecimal é bloqueada por urlPermitida', async () => {
  assert.equal((await urlPermitida('http://[::ffff:7f00:1]:8080/')).ok, false);
  assert.equal((await urlPermitida('http://[::ffff:a9fe:a9fe]/latest/meta-data/')).ok, false);
});

test('entrada local não libera a rede interna: o Chromium só alcança o servidor próprio', async () => {
  const servidor = await servirPasta(fixtures + 'site-12');
  const nav = await abrirNavegador({ permitidos: [`127.0.0.1:${servidor.porta}`], permitirLocal: false, timeoutMs: 8000 });
  try {
    const ctx = await nav.novoContexto();
    const pg = await ctx.newPage();
    await pg.goto(servidor.url);
    const alvos = ['http://127.0.0.1:1/', 'http://192.168.0.1/', 'http://[::ffff:7f00:1]:80/'];
    const out = await pg.evaluate(async (l) => { const r = []; for (const a of l) { try { await fetch(a, { mode: 'no-cors' }); r.push('abriu'); } catch { r.push('falhou'); } } return r; }, alvos);
    assert.deepEqual(out, ['falhou', 'falhou', 'falhou']);
    assert.ok(nav.bloqueios.some((b) => b.url.includes('192.168.0.1')));
  } finally { await nav.fechar(); await servidor.fechar(); }
});

test('WebSocket do site é bloqueado no navegador isolado', async () => {
  const servidor = await servirPasta(fixtures + 'site-12');
  const nav = await abrirNavegador({ permitidos: [`127.0.0.1:${servidor.porta}`], timeoutMs: 8000 });
  try {
    const ctx = await nav.novoContexto();
    const pg = await ctx.newPage();
    await pg.goto(servidor.url);
    const r = await pg.evaluate(() => new Promise((ok) => { try { const w = new WebSocket('ws://127.0.0.1:9/x'); w.onopen = () => ok('abriu'); w.onerror = () => ok('erro'); w.onclose = () => ok('fechou'); setTimeout(() => ok('timeout'), 3000); } catch { ok('excecao'); } }));
    assert.notEqual(r, 'abriu');
  } finally { await nav.fechar(); await servidor.fechar(); }
});
