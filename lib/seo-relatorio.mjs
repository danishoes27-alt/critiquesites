// Bloco "Subir no Google" do relatório (HTML por template). TUDO que vem do site ou do CSV passa por esc().
// Nunca promete posição: o aviso fixo (lib/avisos.mjs) aparece sempre dentro do bloco.
export function renderizarBlocoSeo(seo, { esc, SELOS }) {
  if (!seo?.ativo) return '';
  const n = seo.nota;
  let h = '<h2>Subir no Google (nota de SEO)</h2>';
  if (!n || n.semDados) {
    h += '<div class="cartao"><p>Sem regras de SEO avaliadas nesta análise, então não há nota de SEO.</p></div>';
  } else {
    h += `<div class="cartao"><p><strong style="font-size:2rem">${esc(Math.round(n.nota))}</strong> / 100 · ${esc(n.nivel)} <span class="selo selo-opiniao">${esc(SELOS.opiniao)}</span></p>`;
    h += `<p class="suave">${esc(n.disparadas)} sinal(is) apontado(s) em ${esc(n.avaliadas)} regras de SEO avaliadas. A nota mede aderência a regras e recomendações documentadas; não mede posição real, tráfego nem concorrência.</p></div>`;
    if (n.topo?.length) {
      h += '<h3>O que mais tira pontos</h3><table><thead><tr><th>Achado</th><th>Selo</th><th>Pontos perdidos</th></tr></thead><tbody>';
      for (const t of n.topo) h += `<tr><td>${t.achado_id ? `<a href="#${esc(t.achado_id)}">${esc(t.titulo)}</a>` : esc(t.titulo)}</td><td>${esc(SELOS[t.selo] || t.selo)}</td><td>${esc(t.pontosPerdidos)}</td></tr>`;
      h += '</tbody></table>';
    }
  }
  if (seo.termos?.length) {
    h += '<h3>Palavra-chave que cada página parece querer ranquear</h3><table><thead><tr><th>Página</th><th>Termo (do title)</th></tr></thead><tbody>';
    for (const t of seo.termos.slice(0, 20)) h += `<tr><td><code>${esc(t.caminho)}</code></td><td>${esc(t.termo || 'não identificado')}</td></tr>`;
    h += `</tbody></table><p class="suave">Volume de busca, dificuldade e posição: <strong>não verificável</strong> sem dados reais (o CSV do Search Console ajuda). Selo: opinião/heurística.</p>`;
  }
  const sc = seo.searchConsole;
  h += '<h3>Search Console (CSV)</h3>';
  if (!sc?.disponivel) h += `<p>${esc(sc?.mensagem || 'Precisa do CSV do Search Console.')}</p>`;
  else {
    h += `<p class="suave">Arquivo lido só no seu computador (não foi enviado a lugar nenhum): ${sc.arquivos.map((a) => `${esc(a.arquivo)} (${esc(a.tipo)}, ${esc(a.linhas)} linhas)`).join('; ')}.</p>`;
    const tab = (titulo, linhas, colunas) => {
      if (!linhas?.length) return `<p><strong>${esc(titulo)}:</strong> nada encontrado com os limites usados.</p>`;
      let t = `<p><strong>${esc(titulo)}</strong></p><table><thead><tr>${colunas.map(([r]) => `<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>`;
      for (const l of linhas) t += `<tr>${colunas.map(([, k]) => `<td>${esc(l[k] ?? '—')}</td>`).join('')}</tr>`;
      return t + '</tbody></table>';
    };
    h += tab('Posição média entre 4 e 20 com muitas impressões', sc.posicao4a20, [['Alvo', 'alvo'], ['Impressões', 'impressoes'], ['Posição', 'posicao'], ['CTR %', 'ctr']]);
    h += tab('CTR abaixo do que o próprio site costuma ter na mesma posição', sc.ctrAbaixoDoTipicoDoSite, [['Alvo', 'alvo'], ['Impressões', 'impressoes'], ['Posição', 'posicao'], ['CTR %', 'ctr'], ['CTR típico do site %', 'ctrTipicoDoSite']]);
    h += tab('Consultas sem página própria (nenhuma página tem as palavras no title ou no H1)', sc.consultasSemPaginaPropria, [['Consulta', 'alvo'], ['Impressões', 'impressoes'], ['Posição', 'posicao']]);
    for (const a of sc.arquivos) for (const av of a.avisos || []) h += `<p class="suave">${esc(av)}</p>`;
  }
  if (seo.plano?.length) {
    h += '<h3>Como subir: por onde começar</h3><ol class="plano">';
    for (const p of seo.plano.slice(0, 10)) h += `<li><strong>${p.achado_id ? `<a href="#${esc(p.achado_id)}">${esc(p.titulo)}</a>` : esc(p.titulo)}</strong> <span class="etiqueta">impacto ${esc(p.impacto)} · esforço ${esc(p.esforco)}</span><br><span class="suave">O prompt de correção está dentro do achado.</span></li>`;
    h += '</ol>';
  }
  h += `<div class="aviso-nota"><strong>${esc(seo.aviso?.titulo || '')}.</strong> ${esc(seo.aviso?.texto || '')}</div>`;
  return h;
}
