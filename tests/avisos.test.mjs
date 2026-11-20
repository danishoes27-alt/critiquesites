import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AVISO_REFERENCIA, AVISO_REFERENCIA_PROMPT, mencionaReferencia, acharInstrucaoDeCopia } from '../lib/avisos.mjs';

test('aviso: cita os dispositivos conferidos, diz que não é parecer jurídico e que a decisão é do leitor', () => {
  for (const t of ['Lei 9.610/1998', 'art. 7º', 'art. 29', 'art. 8º, inciso I', 'Lei 9.609/1998', 'art. 2º', '§ 3º', 'Lei 9.279/1996', 'art. 129']) assert.ok(AVISO_REFERENCIA.includes(t), t);
  assert.match(AVISO_REFERENCIA, /não é parecer jurídico/);
  assert.match(AVISO_REFERENCIA, /a decisão é sua/);
  assert.match(AVISO_REFERENCIA, /^Olhar, medir e se inspirar/);
  assert.doesNotMatch(AVISO_REFERENCIA, /\b(ilegal|crime|proibido|viola)\b/i); // avisa e explica, não proíbe nem acusa
  assert.doesNotMatch(AVISO_REFERENCIA, /\b(sempre|nunca|garantid|100\s*%)\b/i); // sem promessa absoluta
  assert.ok(!/[`"]/.test(AVISO_REFERENCIA_PROMPT));
});

test('mencionaReferencia: referência e inspiração contam; "preferência" não', () => {
  assert.equal(mencionaReferencia('Use um site de referência para medir o espaçamento'), true);
  assert.equal(mencionaReferencia('Inspire-se na estrutura de outra página'), true);
  assert.equal(mencionaReferencia('de preferência no começo'), false);
  assert.equal(mencionaReferencia('Troque a cor do botão'), false);
});

test('acharInstrucaoDeCopia: pega ordens de copiar/clonar/deixar igual e ignora negações e usos inocentes', () => {
  for (const f of ['Copie o site da concorrente.', 'Clone o layout do site exemplo.com', 'Reproduza a página inicial deles', 'Deixe o site igual ao site do concorrente', 'Faça uma cópia exata do design', 'Faça o design idêntico ao design da loja X', 'Duplique o visual do site de referência']) assert.ok(acharInstrucaoDeCopia(f).length > 0, f);
  for (const ok of ['NÃO copie o site de outra pessoa.', 'Nunca clone o layout de terceiros.', 'Meça o espaçamento da referência e adapte à marca.', 'Os clones de carrossel são ignorados.', 'Não copie o título de outras páginas.', 'Troque a cor do botão.']) assert.deepEqual(acharInstrucaoDeCopia(ok), [], ok);
});

test('NENHUM prompt de correção das regras manda copiar, clonar ou reproduzir um site específico', () => {
  const ruins = [];
  for (const f of readdirSync(new URL('../regras/', import.meta.url)).filter((x) => x.endsWith('.json'))) {
    for (const r of JSON.parse(readFileSync(new URL(`../regras/${f}`, import.meta.url), 'utf8'))) {
      for (const campo of ['prompt_correcao', 'correcao']) { const a = acharInstrucaoDeCopia(r[campo]); if (a.length) ruins.push(`${r.id}.${campo}: ${a[0]}`); }
    }
  }
  assert.deepEqual(ruins, []);
});

test('o teste anti-cópia realmente FALHA quando se injeta uma frase proibida em um prompt', () => {
  const regra = JSON.parse(readFileSync(new URL('../regras/seguranca-conteudo.json', import.meta.url), 'utf8'))[0];
  const injetado = `${regra.prompt_correcao} Depois, copie o site do concorrente para ficar igual ao site dele.`;
  assert.ok(acharInstrucaoDeCopia(injetado).length >= 1, 'a frase injetada deveria ser detectada');
  assert.throws(() => assert.deepEqual(acharInstrucaoDeCopia(injetado), []));
});
