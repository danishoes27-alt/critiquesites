// Monta o relatório HTML (autocontido) por TEMPLATE. O modelo só escreve os campos de julgamento.
// TUDO que vem do site analisado é conteúdo NÃO confiável: sempre passa por esc().
//
// dados = {
//   site:{ url, host, tipo, entrada },
//   carimbo:{ iso, hash, versaoSkill, versaoRegras, modo },
//   paginas:[{ url, motivo }],
//   notas:{ tell:{ nota, objetiva, faixa:{letra,rotulo}, ajusteModelo, contribuicoes[], regrasAvaliadas, regrasDisparadas, creditoDeCraft },
//           categorias:[{ id, rotulo, nota, detalhe }], geral:{ nota, nivel } },
//   achados:[ achados verificados ], descartados:[{ id, regra_id, motivo }],
//   julgamento:{ ...validado... }, cobertura:{...}, custo:{ tokensEntrada, tokensSaida, reais, cotacao }|null,
//   anterior: null | { carimbo, deltaTell, deltaCategorias[], resolvidos[], novos[], persistentes[], mensagem }
// }
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SELOS } from './achado.mjs';
import { formatarReais } from './custo.mjs';
import { limparRefino } from './prompts-correcao.mjs';
import { renderizarBlocoSeo } from './seo-relatorio.mjs';
import { AVISO_REFERENCIA, AVISO_REFERENCIA_PROMPT, TITULO_AVISO_REFERENCIA, mencionaReferencia } from './avisos.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const VERSAO_SKILL = '0.1.0';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl2p = (t) => String(t ?? '').split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
const dataBr = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }); } catch { return iso; } };

function barra(rotulo, nota, extra = '') {
  const n = Math.max(0, Math.min(100, Number(nota) || 0));
  return `<div class="barra"><div class="topo"><span>${esc(rotulo)}</span><strong>${esc(Math.round(n))}/100</strong></div><div class="trilho" role="img" aria-label="${esc(rotulo)}: ${esc(Math.round(n))} de 100"><div class="preench" style="width:${n}%"></div></div>${extra ? `<div class="etiqueta">${esc(extra)}</div>` : ''}</div>`;
}

function evidencias(evs) {
  if (!evs?.length) return '';
  const itens = evs.slice(0, 6).map((e) => {
    const partes = [];
    if (e.versao) partes.push(`<span class="etiqueta">${esc(e.versao)}${e.visivel === false ? ', oculto' : ''}</span>`);
    if (e.trecho) partes.push(`<code>${esc(String(e.trecho).slice(0, 220))}</code>`);
    if (e.valor !== undefined && e.valor !== '' && e.valor !== null) partes.push(`valor: <code>${esc(String(e.valor).slice(0, 120))}</code>`);
    if (typeof e.contagem === 'number') partes.push(`contagem: <strong>${esc(e.contagem)}</strong>`);
    if (e.seletor) partes.push(`<span class="etiqueta">${esc(String(e.seletor).slice(0, 100))}</span>`);
    return `<li>${partes.join(' ')}</li>`;
  }).join('');
  return `<ul class="evid">${itens}</ul>`;
}

function blocoCritica(a, textoModelo, refino, idx) {
  const selo = SELOS[a.selo] ? a.selo : 'nao-verificavel';
  const pid = `prompt-${idx}`;
  let prompt = (a.prompt_correcao || '') + (refino ? `\n\nAjuste: ${limparRefino(refino)}` : '');
  if (mencionaReferencia(prompt) && !prompt.includes(TITULO_AVISO_REFERENCIA)) prompt += `\n\n${AVISO_REFERENCIA_PROMPT}`;
  return `<article class="critica" id="${esc(a.id)}">
<p><span class="selo selo-${esc(selo)}">${esc(SELOS[selo])}</span><span class="sev sev-${esc(a.severidade)}">${esc(a.severidade)}</span><span class="etiqueta">${esc(a.pagina)} · regra ${esc(a.regra_id)}</span></p>
<h3>${esc(a.titulo || a.regra_id)}</h3>
<p>${esc(a.mensagem)}</p>
${a.interpretacao ? `<p><span class="selo selo-opiniao">${esc(SELOS.opiniao)}</span><strong>Interpretação:</strong> ${esc(a.interpretacao.texto)}</p>` : ''}
${textoModelo ? `<p>${esc(textoModelo)}</p>` : ''}
${evidencias(a.evidencias)}
${a.correcao ? `<p><strong>Como corrigir:</strong> ${esc(a.correcao)}</p>` : ''}
${prompt ? `<details><summary>Prompt de correção para colar no Claude Code (revise antes de colar)</summary><pre id="${pid}">${esc(prompt)}</pre><button type="button" class="copiar" data-alvo="${pid}">Copiar prompt</button></details>` : ''}
${a.fonte?.length ? `<p class="etiqueta">Fonte: ${a.fonte.map((f) => (f.url ? `<a href="${esc(f.url)}" rel="noopener noreferrer">${esc(f.nome)}</a>` : esc(f.nome))).join('; ')}</p>` : ''}
</article>`;
}

export function renderizarCorpo(d) {
  const j = d.julgamento || {};
  const tell = d.notas?.tell;
  const geral = d.notas?.geral;
  const porAchado = new Map((j.criticas || []).map((c) => [c.achado_id, c]));
  const ordemSev = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const achadosOrdenados = [...(d.achados || [])].filter((a) => a.peso_aplicado !== 0).sort((a, b) => ordemSev[a.severidade] - ordemSev[b.severidade] || (b.peso_aplicado || 0) - (a.peso_aplicado || 0) || a.id.localeCompare(b.id));
  const informativos = (d.achados || []).filter((a) => a.peso_aplicado === 0);
  let h = '';

  h += `<header class="capa"><div><p class="suave">Relatório do critiquesites${j.tom === 'sem-do' ? ' · modo sem dó' : ''}</p><h1>${esc(d.site.host || d.site.url)}</h1><p class="suave">${esc(d.site.url)} · tipo: ${esc(j.tipo_de_site_confirmado || d.site.tipo || 'não definido')} · modo ${esc(d.carimbo.modo)}</p></div>`;
  h += `<div class="nota-grande" aria-label="Nota geral"><div class="num">${esc(Math.round(geral?.nota ?? 0))}</div><div class="rot">nota geral${geral?.provisoria ? ' (provisória)' : ''} · ${esc(geral?.nivel || '')}</div></div></header>`;
  h += `<div class="carimbo">Analisado em ${esc(dataBr(d.carimbo.iso))} · versão analisada (hash SHA-256): ${esc(d.carimbo.hash)} · skill ${esc(d.carimbo.versaoSkill)} · regras ${esc(d.carimbo.versaoRegras)}</div>`;
  h += `<div class="aviso-nota"><strong>A nota é um sinal, não um veredito.</strong> Ela resume o que os scripts mediram no código e nas páginas lidas. Não é garantia de resultado, nem de acerto, e pode errar. O que não dá para provar no código aparece como “não verificável”.</div>`;

  if (geral?.provisoria) h += `<div class="aviso-nota"><strong>Nota provisória.</strong> Só ${esc(geral.cobertura?.avaliadas ?? 0)} de ${esc(geral.cobertura?.regrasDeScript ?? 0)} regras de script puderam ser avaliadas nesta análise (cobertura baixa). A nota geral não deve ser lida como definitiva.</div>`;

  if (d.anterior) {
    const a = d.anterior;
    h += `<h2>Evolução desde a análise anterior</h2><div class="cartao"><p>${esc(a.mensagem || '')}</p>`;
    if (typeof a.deltaTell === 'number') h += `<p>Tell Score: de <strong>${esc(a.tellAntes)}</strong> para <strong>${esc(a.tellDepois)}</strong> (${a.deltaTell > 0 ? '+' : ''}${esc(a.deltaTell)}; menor é melhor).</p>`;
    if (typeof a.deltaSeo === 'number') h += `<p>Nota de SEO: de <strong>${esc(a.seoAntes)}</strong> para <strong>${esc(a.seoDepois)}</strong> (${a.deltaSeo > 0 ? '+' : ''}${esc(a.deltaSeo)}; maior é melhor).</p>`;
    if (a.resolvidos?.length || a.novos?.length || a.persistentes?.length) h += `<p>${esc(a.resolvidos?.length || 0)} resolvido(s), ${esc(a.novos?.length || 0)} novo(s), ${esc(a.persistentes?.length || 0)} que continua(m).</p>`;
    h += `</div>`;
  }

  h += `<h2>Resumo</h2>${nl2p(j.resumo || 'Sem resumo do modelo nesta análise (apenas medições dos scripts).')}`;

  h += `<h2>Notas por área</h2><div class="barras">`;
  for (const c of d.notas?.categorias || []) h += barra(c.rotulo, c.nota, c.detalhe);
  h += `</div>`;
  h += renderizarBlocoSeo(d.seoGoogle, { esc, SELOS });

  if (tell) {
    h += `<h2>Tell Score: cara de IA (menor é melhor)</h2><div class="cartao"><p><strong style="font-size:2rem">${esc(tell.nota)}</strong> / 100 · faixa ${esc(tell.faixa?.letra)}: ${esc(tell.faixa?.rotulo)}</p>`;
    h += `<p class="suave">${esc(tell.regrasDisparadas)} sinal(is) disparado(s) em ${esc(tell.regrasAvaliadas)} regras avaliadas. Parte objetiva: ${esc(tell.objetiva)}${tell.ajusteModelo?.aplicado ? `; ajuste do modelo ${tell.ajusteModelo.aplicado > 0 ? '+' : ''}${esc(tell.ajusteModelo.aplicado)} (opinião: ${esc(tell.ajusteModelo.motivo || '')})` : ''}.${tell.creditoDeCraft?.aplicado ? ' Crédito de craft aplicado: o site mostra escolhas deliberadas.' : ''}</p>`;
    h += `<p class="suave">“Cara de IA” descreve só o visual e o texto genéricos, padrão. Não afirma que algo foi feito por IA.</p>`;
    if (tell.contribuicoes?.length) {
      h += `<details open><summary>O que mais pesou</summary><table><thead><tr><th>Sinal</th><th>Peso</th><th>Intensidade</th><th>Pontos</th></tr></thead><tbody>`;
      for (const c of tell.contribuicoes.slice(0, 10)) h += `<tr><td>${esc(c.regra_id)}</td><td>${esc(c.peso)}</td><td>${esc(c.intensidade)}</td><td>${esc(Math.round(c.pontos * 10) / 10)}</td></tr>`;
      h += `</tbody></table></details>`;
    }
    h += `</div>`;
  }

  if (j.pontos_fortes?.length) { h += `<h2>Pontos fortes</h2><div class="cartoes">`; for (const p of j.pontos_fortes) h += `<div class="cartao"><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div>`; h += `</div>`; }
  if (j.pontos_fracos?.length) { h += `<h2>Pontos fracos</h2><div class="cartoes">`; for (const p of j.pontos_fracos) h += `<div class="cartao"><h3>${esc(p.titulo)}</h3><p>${esc(p.texto)}</p></div>`; h += `</div>`; }
  if (j.elogios?.length) { h += `<h2>Elogios</h2><ul>`; for (const e of j.elogios) h += `<li>${esc(e.texto)}</li>`; h += `</ul>`; }

  h += `<h2>Críticas (${achadosOrdenados.length})</h2>`;
  if (!achadosOrdenados.length) h += `<p>Nenhum achado verificado com peso nesta análise.</p>`;
  achadosOrdenados.forEach((a, i) => { const c = porAchado.get(a.id); h += blocoCritica(a, c?.texto, c?.refino_do_prompt, i); });

  if (informativos.length) {
    h += `<h2>Informativos (sem peso na nota)</h2><ul>`;
    for (const a of informativos) h += `<li><strong>${esc(a.titulo || a.regra_id)}:</strong> ${esc(a.mensagem)}</li>`;
    h += `</ul>`;
  }

  if (j.comparacoes?.length) { h += `<h2>Comparações</h2><ul>`; for (const c of j.comparacoes) h += `<li>${esc(c.texto)}</li>`; h += `</ul>`; }

  if (j.plano?.length) {
    h += `<h2>Plano do que melhorar</h2><ol class="plano">`;
    for (const p of j.plano) h += `<li><strong>${esc(p.titulo)}</strong> <span class="etiqueta">impacto ${esc(p.impacto)} · esforço ${esc(p.esforco)}</span><br>${esc(p.porque)}${p.achados?.length ? `<br><span class="etiqueta">Ver: ${p.achados.map((id) => `<a href="#${esc(id)}">${esc(id)}</a>`).join(', ')}</span>` : ''}</li>`;
    h += `</ol>`;
  }
  if (j.perguntas_ao_dono?.length) { h += `<h2>Perguntas para você</h2><ul>`; for (const q of j.perguntas_ao_dono) h += `<li>${esc(q)}</li>`; h += `</ul>`; }

  h += `<h2>Páginas analisadas (${(d.paginas || []).length})</h2><ul>`;
  for (const p of d.paginas || []) h += `<li><code>${esc(p.url)}</code> <span class="etiqueta">${esc(p.motivo || '')}</span></li>`;
  h += `</ul>`;

  h += `<h2>Limites desta análise</h2><ul>
<li>Os scripts leram o código (HTML cru, DOM com 250 ms e DOM final) das páginas listadas acima; o resto do site não foi lido.</li>
<li>Achados com selo “opinião” são heurísticas; “não verificável” significa que o código não permite provar.</li>
<li>Lei brasileira: os avisos explicam um risco e não são parecer jurídico. A decisão é sua.</li>
<li>Textos “genéricos/batidos” são julgamento de estilo; a skill nunca afirma que um texto foi escrito por IA.</li>
${d.cobertura ? `<li>Cobertura das regras: ${esc(d.cobertura.avaliadas)} de ${esc(d.cobertura.regrasDeScript)} regras de script avaliadas; ${esc((d.cobertura.semDetector || []).length)} ainda sem detector; ${esc(d.cobertura.perguntasAoModelo)} critérios de julgamento.</li>` : ''}
</ul>`;

  h += `<h2>Achados descartados pelo verificador (${(d.descartados || []).length})</h2>`;
  if (d.descartados?.length) {
    h += `<p class="suave">Antes de sair, um script confere se cada número e trecho citado existe no código. Estes não passaram e foram removidos do relatório.</p><ul>`;
    for (const x of d.descartados.slice(0, 30)) h += `<li><code>${esc(x.regra_id)}</code>: ${esc(x.motivo)}</li>`;
    h += `</ul>`;
  } else h += `<p class="suave">Nenhum. Todos os achados passaram na conferência de citações.</p>`;

  h += `<h2>${esc(TITULO_AVISO_REFERENCIA)}</h2><p>${esc(AVISO_REFERENCIA)}</p>`;

  h += `<footer class="rodape"><p>${d.custo ? `Tokens gastos pelo modelo: ${esc(d.custo.tokensEntrada)} de entrada e ${esc(d.custo.tokensSaida)} de saída · custo estimado ${esc(formatarReais(d.custo.reais))}${d.custo.cotacao ? ` (US$ 1 = ${esc(formatarReais(d.custo.cotacao.valor))}, ${esc(d.custo.cotacao.tipo)} de ${esc(d.custo.cotacao.data_cotacao)})` : ''}.` : 'Custo do modelo não informado.'}</p><p>Gerado pelo critiquesites ${esc(d.carimbo.versaoSkill)}. Selos: ${Object.values(SELOS).map(esc).join(' · ')}.</p></footer>`;
  return h;
}

export function renderizarRelatorio(d, { dirTemplates = join(raiz, 'templates') } = {}) {
  const tpl = readFileSync(join(dirTemplates, 'relatorio.html'), 'utf8');
  const css = readFileSync(join(dirTemplates, 'relatorio.css'), 'utf8');
  // Uma única passada: o que for inserido (título, corpo) nunca é re-escaneado em busca de {{...}}.
  const mapa = { TITULO: esc(`Relatório: ${d.site.host || d.site.url}`), VERSAO_SKILL: esc(d.carimbo.versaoSkill), CSS: css, CORPO: renderizarCorpo(d) };
  return tpl.replace(/\{\{(TITULO|VERSAO_SKILL|CSS|CORPO)\}\}/g, (_, k) => mapa[k]);
}
