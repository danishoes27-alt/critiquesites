import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { compararVersoes, conteudoSoComJs } from '../lib/diff-versoes.mjs';
import { abrirNavegador } from '../lib/navegador.mjs';
import { servirPasta } from '../lib/servidor-local.mjs';
import { lerPagina } from '../lib/ler-pagina.mjs';

const no = (seletor, texto, extra = {}) => ({ seletor, tag: 'span', texto, visivel: true, ocultoPor: '', ariaOculto: false, clone: false, ...extra });
const ex = (...nos) => ({ nos });

test('unit: contador 0 → 0 → 54 vira diferença com tendência crescente', () => {
  const d = compararVersoes({ cru: ex(no('#a', '0')), dom250: ex(no('#a', '0')), final: ex(no('#a', '54')) });
  assert.equal(d.length, 1);
  assert.equal(d[0].tendencia, 'crescente');
  assert.equal(d[0].contadorAnimado, true);
  assert.deepEqual(d[0].leituras, { cru: '0', dom250: '0', final: '54' });
});

test('unit: valores iguais não geram diferença; clones e textos sem número são ignorados', () => {
  const d = compararVersoes({ cru: ex(no('#a', 'R$ 9,90'), no('#b', 'oi')), dom250: ex(no('#a', 'R$ 9,90')), final: ex(no('#a', 'R$ 9,90'), no('#c', '5', { clone: true })) });
  assert.equal(d.length, 0);
});

test('unit: elemento ausente em uma versão não é tratado como mudança', () => {
  const d = compararVersoes({ cru: ex(), dom250: ex(no('#a', '10')), final: ex(no('#a', '10')) });
  assert.equal(d.length, 0);
});

test('unit: conteudoSoComJs mede texto que só existe no final', () => {
  const r = conteudoSoComJs({ cru: ex(no('#a', 'texto longo que existe no cru mesmo')), final: ex(no('#a', 'texto longo que existe no cru mesmo'), no('#b', 'texto longo que só aparece depois do JavaScript')) });
  assert.equal(r.soNoFinal, 1);
  assert.equal(r.totalFinal, 2);
});

let nav;
before(async () => { nav = await abrirNavegador({ timeoutMs: 15000 }); });
after(async () => { await nav.fechar(); });

async function lerFixture(pasta) {
  const fixtures = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const s = await servirPasta(fixtures + pasta);
  try { return await lerPagina(s.url, { nav, permitidos: [`127.0.0.1:${s.porta}`] }); } finally { await s.fechar(); }
}

test('integração: fixture contador gera 2 diferenças (sites e alunos); preço fixo não', async () => {
  const r = await lerFixture('contador');
  const d = compararVersoes({ cru: r.cru.extr, dom250: r.dom250.extr, final: r.final.extr });
  const seletores = d.map((x) => x.seletor).sort();
  assert.deepEqual(seletores, ['#alunos', '#sites']);
  assert.ok(d.every((x) => x.contadorAnimado && x.leituras.final !== '0'));
});

test('integração: páginas estáticas não geram falso positivo', async () => {
  for (const pasta of ['oculto', 'carrossel-clone', 'site-12']) {
    const r = await lerFixture(pasta);
    const d = compararVersoes({ cru: r.cru.extr, dom250: r.dom250.extr, final: r.final.extr });
    assert.equal(d.length, 0, pasta);
  }
});

test('integração: DOM reestruturado pelo JS (título em spans) — contadores casam por classe/data-*', async () => {
  const r = await lerFixture('contador-reestruturado');
  const d = compararVersoes({ cru: r.cru.extr, dom250: r.dom250.extr, final: r.final.extr });
  const por = (cls, alvo) => d.find((x) => x.classe.includes('cnt') && Object.values(x.leituras).some((t) => t.includes(alvo)));
  const mil = d.find((x) => /3\.?000/.test(x.leituras.final || ''));
  assert.ok(mil, 'contador de +R$ 3.000 foi detectado');
  assert.match(mil.leituras.cru, /3\.000/);
  assert.match(mil.leituras.dom250, /\+R\$ 0/);
  assert.equal(mil.contadorAnimado, true);
  assert.ok(d.find((x) => (x.leituras.final || '') === '54' && x.leituras.dom250 === '0'));
  assert.ok(d.length >= 3);
  void por;
});

test('integração: contador desenhado por CSS (::after com data-now, texto real = valor final) é detectado pelo valor EXIBIDO', async () => {
  const r = await lerFixture('contador-css');
  const d = compararVersoes({ cru: r.cru.extr, dom250: r.dom250.extr, final: r.final.extr });
  const mil = d.find((x) => /3\.?000/.test(x.leituras.final || ''));
  assert.ok(mil, 'contador +R$ 3.000 detectado');
  assert.match(mil.leituras.dom250, /\+R\$ 0/);
  assert.match(mil.leituras.final, /3\.000/);
  assert.match(mil.textoNoHtml.dom250, /3\.000/, 'o texto no HTML já tinha o valor final');
  assert.ok(mil.viaCss.includes('dom250'));
  assert.equal(mil.contadorAnimado, true);
  assert.ok(d.find((x) => x.leituras.dom250 === '0' && x.leituras.final === '54'));
});
