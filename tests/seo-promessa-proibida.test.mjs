import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acharPromessaDePosicao, AVISO_POSICAO, TITULO_AVISO_POSICAO } from '../lib/avisos.mjs';
import { renderizarBlocoSeo } from '../lib/seo-relatorio.mjs';
import { esc } from '../lib/relatorio.mjs';
import { SELOS } from '../lib/achado.mjs';

const arquivo = (c) => readFileSync(new URL(`../${c}`, import.meta.url), 'utf8');

test('o teste falha de verdade: promessas de posição e de "topo do Google" são pegas', () => {
  for (const frase of [
    'Garantimos o primeiro lugar no Google.',
    'Seu site vai aparecer no topo do Google em 30 dias.',
    'Vamos colocar você na primeira página do Google com garantia de posição.',
    'Com esta correção você vai chegar ao topo do Google.',
    'Seu site vai ficar em 1º lugar.',
    'Garantia de ranking para sua empresa.',
    'Isto garante a posição 1.',
  ]) assert.ok(acharPromessaDePosicao(frase).length > 0, `deveria pegar: ${frase}`);
});

test('advertências que NEGAM a promessa não são pegas (o aviso do relatório precisa poder falar do assunto)', () => {
  for (const frase of ['Ninguém pode garantir o primeiro lugar no Google.', 'Não garantimos posição nenhuma.', 'O Google diz que ninguém garante o 1º lugar.']) assert.deepEqual(acharPromessaDePosicao(frase), [], frase);
});

test('o aviso fixo cita a fonte do Google e o art. 37 do CDC com a data, e não contém promessa', () => {
  assert.deepEqual(acharPromessaDePosicao(`${TITULO_AVISO_POSICAO}. ${AVISO_POSICAO}`), []);
  assert.match(AVISO_POSICAO, /Do you need an SEO\?/);
  assert.match(AVISO_POSICAO, /20\/11\/2026/);
  assert.match(AVISO_POSICAO, /Lei 8\.078\/1990, art\. 37/);
  assert.match(AVISO_POSICAO, /não é parecer jurídico/);
  assert.match(AVISO_POSICAO, /ninguém pode garantir o primeiro lugar/i);
});

test('o bloco do relatório (com nota, plano, termos e CSV) sai sem promessa e traz o aviso', () => {
  const seo = {
    ativo: true, nota: { nota: 72, nivel: 'Sólido', semDados: false, disparadas: 2, avaliadas: 30, topo: [{ regra_id: 'seo-h1-ausente', titulo: 'Página sem título principal (H1) visível', selo: 'opiniao', pontosPerdidos: 1.5, achado_id: 'ach-0001' }] },
    plano: [{ regra_id: 'seo-h1-ausente', titulo: 'Página sem título principal (H1) visível', impacto: 'medio', esforco: 'baixo', achado_id: 'ach-0001' }],
    termos: [{ caminho: '/', termo: 'Conserto de bicicletas', fonte: 'title' }],
    searchConsole: { disponivel: false, mensagem: 'Precisa do CSV do Search Console (exporte "Consultas" e "Páginas").' },
    aviso: { titulo: TITULO_AVISO_POSICAO, texto: AVISO_POSICAO },
  };
  const html = renderizarBlocoSeo(seo, { esc, SELOS });
  assert.match(html, /Subir no Google/);
  assert.match(html, /72/);
  assert.match(html, /Precisa do CSV do Search Console/);
  assert.match(html, /não verificável/);
  assert.match(html, new RegExp(TITULO_AVISO_POSICAO));
  assert.deepEqual(acharPromessaDePosicao(html.replace(/<[^>]+>/g, ' ')), []);
  // injetar uma promessa no texto do bloco faz o teste falhar (prova de que ele funciona)
  const sujo = renderizarBlocoSeo({ ...seo, plano: [{ ...seo.plano[0], titulo: 'Garantimos o primeiro lugar no Google' }] }, { esc, SELOS });
  assert.ok(acharPromessaDePosicao(sujo.replace(/<[^>]+>/g, ' ')).length > 0);
});

test('nenhum arquivo de texto da skill (regras, prompts, SKILL, README, docs do módulo) contém promessa de posição', () => {
  for (const f of ['regras/seo-google.json', 'SKILL.md', 'README.md', 'SPEC-SEO.md', 'PLAN-SEO.md', 'docs/limites-seo.md', 'lib/seo-relatorio.mjs', 'lib/seo-nota.mjs']) {
    let txt = '';
    try { txt = arquivo(f); } catch { continue; }
    // o SPEC/limites citam as frases proibidas entre aspas ao explicar o teste: tira o que está entre aspas
    txt = txt.replace(/"[^"\n]{0,120}"/g, ' ').replace(/«[^»\n]{0,120}»/g, ' ').replace(/`[^`\n]{0,160}`/g, ' ');
    assert.deepEqual(acharPromessaDePosicao(txt), [], f);
  }
});
