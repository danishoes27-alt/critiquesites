// DETECTORES das regras de script/misto de regras/lei-br.json e regras/seguranca-conteudo.json.
//
// Princípios (SPEC §5, motor.mjs):
//  - o detector NUNCA opina além do medido; "lei-br" só AVISA (nada aqui conclui ilegalidade);
//  - retornar null = não avaliável (medidor ausente/com erro, ou precondição da regra não atendida, como "só avalia se há oferta");
//  - toda citação é verificável: os trechos/contagens passam por verificarCitacao() antes de sair (se não passar, é descartada);
//  - regras de AUSÊNCIA (sem CNPJ, sem privacidade...) citam algo que EXISTE (título/contagem de links das páginas inspecionadas)
//    e a mensagem lista as páginas inspecionadas; "ausente" só quando há páginas inspecionadas e as sondas deram resposta;
//  - texto OCULTO nunca vira afirmação aqui (medidor lei: dados.ocultosRelevantes não é usado por nenhum detector);
//  - mensagens sem números soltos: todo número que aparece vem de uma citação/evidência ou de numeros_permitidos (fato do medidor).
//
// Fontes de dados: medidor 'lei' (quase tudo de lei-br), 'js' (IDs de analytics, trackers), 'links' (href inválido) e 'injecao'.
// As regras seg-* de HTML/HTTPS/SRI/noopener/cabeçalhos citam o medidor 'html', mas esse medidor só mede metadados de <head>
// e headings; por isso estes detectores leem o `ctx` diretamente (HTML cru e final, extr.links/scripts/formularios, cabeçalhos
// HTTP e requisições observadas), com a mesma lógica documentada nas regras.
import { normalizarTexto, extrairNumeros, decodificarEntidades } from '../util.mjs';
import { montarCorpus, verificarCitacao } from '../verificador.mjs';

// ------------------------------------------------------------------------------------------------ utilitários
const TODAS_VERSOES = ['cru', 'dom250', 'final'];
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url ?? '/'); } };
const cortar = (t, n = 160) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; };
const semReticencias = (t) => String(t ?? '').replace(/^…+|…+$/g, '').trim();
const unicos = (arr, chave = (x) => x) => { const v = new Set(); return arr.filter((x) => { const k = chave(x); if (v.has(k)) return false; v.add(k); return true; }); };
const versoesValidas = (v, padrao = ['final']) => { const l = (Array.isArray(v) ? v : [v]).filter((x) => TODAS_VERSOES.includes(x)); return l.length ? l : padrao; };
const semDisparo = () => ({ disparou: false, intensidade: 0, achados: [] });
const comDisparo = (achados, intensidade = 1) => ({ disparou: true, intensidade: Math.max(0, Math.min(1, intensidade)), achados });
const fmt = (lista, max = 8) => {
  const l = unicos(lista);
  if (!l.length) return '(nenhuma)';
  return l.length > max ? `${l.slice(0, max).join(', ')} e mais ${l.length - max}` : l.join(', ');
};
const aspas = (t) => `"${String(t).replace(/"/g, "'")}"`;

function dadosDe(med, id) {
  const m = med?.[id];
  if (!m || m.erro || !m.dados) return null;
  return m.dados;
}

// ------------------------------------------------------------------------------------------------ citações verificáveis
const cacheCorpus = new WeakMap();
function corpusDe(ctx) {
  if (!ctx || !Array.isArray(ctx.paginas) || !ctx.paginas.length) return null; // sem páginas não há como verificar: repassa
  if (!cacheCorpus.has(ctx)) { try { cacheCorpus.set(ctx, montarCorpus(ctx)); } catch { cacheCorpus.set(ctx, null); } }
  return cacheCorpus.get(ctx);
}

// Primeira citação de trecho que o verificador aceita (tenta cada `onde`; depois as 3 versões).
function tentarTrecho(ctx, valor, ondes, versoes = ['final']) {
  const v = semReticencias(valor);
  if (!normalizarTexto(v)) return null;
  const corpus = corpusDe(ctx);
  for (const vs of [versoesValidas(versoes), TODAS_VERSOES]) {
    for (const onde of ondes) {
      const c = { tipo: 'trecho', valor: v, onde, versoes: vs };
      if (!corpus || verificarCitacao(c, corpus).ok) return c;
    }
  }
  return null;
}

// Âncoras: citações sobre algo que EXISTE nas páginas inspecionadas (título; ou contagem de links). Servem de base
// às regras de ausência, em que não há trecho a citar.
function ancoras(ctx, max = 4) {
  const corpus = corpusDe(ctx);
  const saida = [];
  for (const p of (ctx?.paginas || []).slice(0, max)) {
    const titulo = String(p.final?.extr?.titulo || '').trim();
    const t = titulo ? { tipo: 'trecho', valor: titulo, onde: 'html', versoes: ['final'] } : null;
    if (t && (!corpus || verificarCitacao(t, corpus).ok)) { saida.push(t); continue; }
    // sem título: o primeiro texto visível da página (cobre também os selos que exigem ao menos um trecho)
    const no1 = (p.final?.extr?.nos || []).find((n) => n.visivel && !n.clone && normalizarTexto(n.texto).length >= 8);
    const t2 = no1 ? { tipo: 'trecho', valor: no1.texto, onde: 'visivel', versoes: ['final'] } : null;
    if (t2 && (!corpus || verificarCitacao(t2, corpus).ok)) { saida.push(t2); continue; }
    const c = { tipo: 'contagem', contagem: { fn: 'links', esperado: (p.final?.extr?.links || []).length }, pagina: p.url, versoes: ['final'] };
    if (!corpus || verificarCitacao(c, corpus).ok) saida.push(c);
  }
  return saida;
}

// Filtra as citações pelo verificador; se nenhuma sobrar, usa as âncoras (assim o achado nunca sai sem base verificável).
function citar(ctx, lista, { ancorar = true } = {}) {
  const corpus = corpusDe(ctx);
  const vistos = new Set();
  const saida = [];
  for (const c of lista || []) {
    if (!c) continue;
    const k = JSON.stringify(c);
    if (vistos.has(k)) continue;
    vistos.add(k);
    if (!corpus || verificarCitacao(c, corpus).ok) saida.push(c);
  }
  if (!saida.length && ancorar) return ancoras(ctx);
  return saida;
}

function ev(e) {
  if (!e) return null;
  const o = {};
  for (const [k, v] of Object.entries(e)) if (v !== null && v !== undefined) o[k] = v;
  if (o.trecho !== undefined) o.trecho = cortar(o.trecho, 200);
  if (o.versao && !TODAS_VERSOES.includes(o.versao)) delete o.versao;
  return o;
}

function montar({ ctx, pagina = '/', mensagem, evidencias = [], citacoes = [], permitidos = [], ancorar = true, ...extra }) {
  // "e mais N" das listas truncadas (fmt) é contagem derivada da própria lista medida
  const doResumo = [...String(mensagem).matchAll(/ e mais (\d+)\b/g)].map((m) => m[1]);
  const nums = unicos([...permitidos.flatMap((t) => (typeof t === 'number' ? [t] : extrairNumeros(String(t)))), ...doResumo].map(String));
  return {
    pagina: pagina || '/',
    mensagem,
    evidencias: evidencias.map(ev).filter(Boolean),
    citacoes: citar(ctx, citacoes, { ancorar }),
    ...(nums.length ? { numeros_permitidos: nums } : {}),
    ...extra,
  };
}

// Texto visível e não-clone de uma página (nós do extrator, versão final).
function nosVisiveis(ctx, pagina) {
  const p = (ctx?.paginas || []).find((x) => caminhoDe(x.url) === pagina) || (ctx?.paginas || [])[0];
  return (p?.final?.extr?.nos || []).filter((n) => n.visivel && !n.clone);
}
// Melhor trecho VISÍVEL (um nó inteiro) contido em um texto solto: garante citação verificável.
// Prefere o que aparece mais cedo no texto (o rótulo vem logo depois do campo); empate: o mais longo.
function trechoVisivelContido(ctx, pagina, texto) {
  const alvo = normalizarTexto(texto);
  let melhor = null;
  for (const n of nosVisiveis(ctx, pagina)) {
    const t = normalizarTexto(n.texto);
    const i = t.length >= 4 ? alvo.indexOf(t) : -1;
    if (i < 0) continue;
    if (!melhor || i < melhor.i || (i === melhor.i && t.length > melhor.len)) melhor = { i, len: t.length, texto: n.texto };
  }
  return melhor ? melhor.texto : null;
}

// ------------------------------------------------------------------------------------------------ páginas inspecionadas
function rotasAusentes(d) {
  const s = new Set();
  for (const sec of [d.privacidade, d.termos]) for (const r of sec?.rotasComunsTestadas || []) if (!r.paginaExiste) s.add(caminhoDe(r.url));
  return s;
}
// Páginas efetivamente lidas (sem as rotas comuns que não existem).
function paginasLidas(d, urls) {
  const aus = rotasAusentes(d);
  return unicos((urls || d.paginasInspecionadas || []).map(caminhoDe)).filter((c) => !aus.has(c));
}
const paginaPrincipal = (d) => d.paginasAmostradas?.[0]?.pagina || '/';
const tituloDa = (ctx, pagina) => ((ctx?.paginas || []).find((x) => caminhoDe(x.url) === pagina) || (ctx?.paginas || [])[0])?.final?.extr?.titulo || '';

// Achado padrão das regras de AUSÊNCIA: lista as páginas lidas e cita algo que existe nelas.
function achadoAusencia(ctx, d, { texto, urls, extraCitacoes = [], extraEvidencias = [], rotas = null, ...extra }) {
  const lidas = paginasLidas(d, urls);
  const pagina = paginaPrincipal(d);
  let mensagem = `${texto} Páginas lidas: ${fmt(lidas)}.`;
  if (rotas && rotas.length) mensagem += ` Rotas comuns testadas sem página válida: ${fmt(rotas)}.`;
  return montar({
    ctx, pagina, mensagem,
    evidencias: [{ pagina, versao: 'final', trecho: tituloDa(ctx, pagina) || undefined, valor: lidas.join(', '), contagem: lidas.length }, ...extraEvidencias],
    citacoes: [...extraCitacoes, ...ancoras(ctx)],
    permitidos: [...lidas, ...(rotas || []), lidas.length],
    ...extra,
  });
}
const rotasSemPagina = (sec) => (sec?.rotasComunsTestadas || []).filter((r) => !r.paginaExiste).map((r) => caminhoDe(r.url));
// Se TODAS as sondas de rotas falharam sem resposta (rede), não dá para afirmar ausência.
const sondasSemResposta = (sec) => { const r = sec?.rotasComunsTestadas || []; return r.length > 0 && r.every((x) => x.status === null || x.status === undefined); };

// ------------------------------------------------------------------------------------------------ precondições
const temOferta = (d) => !!d.oferta?.temOferta;
const usaRastreador = (d, med) => !!d.cookies?.temRastreador || (dadosDe(med, 'js')?.tags || []).length > 0;
const coletaDados = (d) => (d.formularios?.coletamDadoPessoal || 0) > 0 || (d.contato?.emails || []).length > 0 || (d.contato?.telefones || []).length > 0;

// Melhor exemplo de oferta visível (preço fora de promessa > botão de compra > link de checkout).
function exemploOferta(d) {
  const prom = new Set((d.promessas?.itens || []).map((x) => `${x.pagina}|${x.seletor}`));
  const preco = (d.precos?.itens || []).find((x) => !prom.has(`${x.pagina}|${x.seletor}`));
  if (preco) return { pagina: preco.pagina, seletor: preco.seletor, trecho: preco.trecho, valor: preco.valor };
  const b = d.oferta?.botoesCompra?.[0] || d.oferta?.linksCheckout?.[0];
  return b ? { pagina: b.pagina, seletor: b.seletor, trecho: b.texto, valor: b.texto } : null;
}

// ================================================================================================ LEI-BR

const detectores = {};

// ---------------------------------------------------------------- CNPJ
detectores['lei-cnpj-ausente'] = ({ ctx, med, regra }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.cnpj) return null;
  if (!temOferta(d)) return null; // "só avalia se houver oferta"
  const c = d.cnpj;
  if (c.cnpjValidoPresente || c.razaoSocialRotuloPresente) return semDisparo();
  const invalido = (c.encontrados || []).find((x) => !x.valido || x.modelo);
  const rotuloCnpj = (c.rotulosEncontrados || []).find((r) => r.rotulo === 'cnpj');
  let texto = 'Não encontramos um CNPJ válido nem o rótulo "razão social" ou "nome empresarial" em texto visível.';
  const cit = [];
  if (invalido) { texto += ` Há um número no formato de CNPJ que não passou na conferência dos dígitos ou é número de exemplo: ${invalido.trecho}.`; cit.push(tentarTrecho(ctx, invalido.trecho, ['visivel', 'html'], [invalido.versao])); }
  else if (rotuloCnpj) { texto += ` O rótulo CNPJ aparece, mas sem um número válido ao lado: ${rotuloCnpj.trecho}.`; cit.push(tentarTrecho(ctx, rotuloCnpj.trecho, ['visivel', 'html'], [rotuloCnpj.versao])); }
  const of = exemploOferta(d);
  if (of?.trecho) cit.push(tentarTrecho(ctx, of.trecho, ['visivel'], ['final']));
  const tipo = ctx?.site?.tipoDeSite;
  const peso = regra?.deteccao?.parametros?.peso_por_tipo?.[tipo];
  const a = achadoAusencia(ctx, d, {
    texto: `${texto} A página tem oferta (preço ou botão de compra).`,
    urls: c.paginasInspecionadas,
    extraCitacoes: cit,
    extraEvidencias: of ? [{ pagina: of.pagina, versao: 'final', seletor: of.seletor, trecho: of.trecho, valor: 'oferta', visivel: true }] : [],
    ...(typeof peso === 'number' ? { peso_aplicado: peso } : {}),
  });
  return comDisparo([a]);
};

// ---------------------------------------------------------------- privacidade / termos (ausência)
function ausenciaLegal(tipo, rotuloHumano, { precondicao }) {
  return ({ ctx, med }) => {
    const d = dadosDe(med, 'lei');
    const sec = d?.[tipo];
    if (!d || !sec) return null;
    if (!precondicao(d, med)) return null;
    if (sondasSemResposta(sec)) return null; // sem resposta de rede: não dá para afirmar ausência
    if (!sec.ausente) return semDisparo(); // existe link ou rota válida (link quebrado vira lei-pagina-legal-quebrada)
    if (!(sec.paginasInspecionadas || d.paginasInspecionadas || []).length) return null;
    const a = achadoAusencia(ctx, d, {
      texto: `Não encontramos link nem página de ${rotuloHumano} nas páginas inspecionadas.`,
      urls: sec.paginasInspecionadas,
      rotas: rotasSemPagina(sec),
    });
    return comDisparo([a]);
  };
}
detectores['lei-politica-privacidade-ausente'] = ausenciaLegal('privacidade', 'política de privacidade', {
  precondicao: (d, med) => temOferta(d) || coletaDados(d) || usaRastreador(d, med),
});
detectores['lei-termos-de-uso-ausente'] = ausenciaLegal('termos', 'termos de uso', {
  precondicao: (d) => temOferta(d) || (d.formularios?.coletamDadoPessoal || 0) > 0,
});

// ---------------------------------------------------------------- promessa de ganho (misto)
const ONDE_PROMESSA = { h1: 'no título principal (h1)', h2: 'em um subtítulo (h2)', h3: 'em um subtítulo (h3)', button: 'em um botão', a: 'em um link', title: 'no título da aba (title)' };
detectores['lei-promessa-de-ganho'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.promessas) return null;
  const itens = d.promessas.itens || [];
  if (!itens.length) return semDisparo();
  const grupos = new Map();
  for (const it of itens) {
    const k = `${it.pagina}|${it.seletor}|${it.onde}`;
    if (!grupos.has(k)) grupos.set(k, { ...it, trechos: [] });
    grupos.get(k).trechos.push(it.trecho);
  }
  const achados = [];
  for (const g of [...grupos.values()].slice(0, 6)) {
    const ehMeta = String(g.onde).startsWith('meta:');
    const onde = ONDE_PROMESSA[g.onde] || (ehMeta ? `na meta tag ${g.onde.slice(5)}` : `em ${g.onde}`);
    const ondes = g.onde === 'title' || ehMeta ? ['html'] : ['visivel', 'html'];
    const trechos = unicos(g.trechos);
    const cit = [tentarTrecho(ctx, g.texto, ondes, [g.versao]), ...trechos.map((t) => tentarTrecho(ctx, t, ondes, [g.versao]))];
    achados.push(montar({
      ctx, pagina: g.pagina,
      mensagem: `Possível promessa de ganho ou resultado ${onde}: ${aspas(semReticencias(g.texto))}. Trechos que casaram com o padrão: ${trechos.map(aspas).join(', ')}. O Código de Defesa do Consumidor (art. 37) trata de publicidade que induz a erro; o analisador só localizou o trecho e não verifica se há ressalva, base ou exemplo ilustrativo por perto.`,
      evidencias: [{ pagina: g.pagina, versao: g.versao, seletor: g.seletor, trecho: g.texto, valor: trechos[0], visivel: !(g.onde === 'title' || ehMeta) ? true : undefined }],
      citacoes: cit,
    }));
  }
  return comDisparo(achados);
};

// ---------------------------------------------------------------- IDs de analytics vazios/incompletos (medidor js)
const MOTIVO_ID = { vazio: 'vazio', placeholder: 'de exemplo (não é um ID real)', 'formato-invalido': 'incompleto ou fora do formato esperado', 'id-nao-numerico': 'fora do formato esperado (não é só número)' };
const FORMATO_REGRA = { ga4: /^G-[A-Z0-9]{10}$/, gtm: /^GTM-[A-Z0-9]{6,8}$/, 'meta-pixel': /^\d{10,20}$/ };
detectores['lei-analytics-id-vazio'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'js');
  if (!d || !Array.isArray(d.tags)) return null;
  const problemas = [];
  for (const t of d.tags) {
    if (t.vazio) { problemas.push({ t, problema: t.problema === 'placeholder' ? 'placeholder' : 'vazio' }); continue; }
    const fmtRegra = FORMATO_REGRA[t.tipo];
    if (fmtRegra && t.valido !== null && t.problema !== 'id-dinamico' && !fmtRegra.test(String(t.id))) problemas.push({ t, problema: t.problema && MOTIVO_ID[t.problema] ? t.problema : 'formato-invalido' });
  }
  if (!problemas.length) return semDisparo();
  const achados = problemas.slice(0, 20).map(({ t, problema }) => {
    const vistas = (t.vistas || []).slice(0, 3);
    const cit = vistas.map((v) => tentarTrecho(ctx, v.trecho, v.origem === 'inline' || v.origem === 'ativo' ? ['js', 'html'] : ['html', 'js'], v.origem === 'ativo' ? ['final'] : v.versoes));
    const trechos = unicos(vistas.map((v) => cortar(v.trecho, 120)));
    return montar({
      ctx, pagina: vistas.find((v) => v.pagina)?.pagina || '/',
      mensagem: `O código tem ${t.nome} com identificador ${MOTIVO_ID[problema]}: ${trechos.map(aspas).join(', ')}. Uma tag assim não mede nada e ainda carrega script. Troque pelo ID real da conta ou remova a tag.`,
      evidencias: vistas.map((v) => ({ pagina: v.pagina || '/', versao: versoesValidas(v.origem === 'ativo' ? ['final'] : v.versoes)[0], seletor: v.origem === 'src' ? 'script[src]' : v.origem, trecho: v.trecho, valor: `${t.tipo}:${t.id === '' ? '(vazio)' : t.id}` })),
      citacoes: cit,
    });
  });
  return comDisparo(achados);
};

// ---------------------------------------------------------------- cookies (misto)
detectores['lei-cookies-consentimento-ausente'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  const ck = d?.cookies;
  if (!ck) return null;
  if (!ck.temRastreador) return semDisparo();
  if (ck.temIndicioDeBannerOuGestao) return semDisparo();
  const js = dadosDe(med, 'js');
  // rastreador só em script não executável (ex.: text/plain até o consentimento) e sem requisição: não está carregando
  if (js && js.scriptsDeRastreamentoPresentes === false && !ck.rastreadorConfirmadoPorRequisicao) return semDisparo();
  const nomes = ck.nomesRastreadores || [];
  const cit = (ck.rastreadores || []).slice(0, 4).map((r) => {
    if (r.via === 'script-src') return tentarTrecho(ctx, r.dominio, ['html'], ['cru', 'final']);
    if (r.via === 'codigo') return tentarTrecho(ctx, r.dominio, ['js'], ['final']);
    return null; // requisição observada: não há como conferir no texto
  });
  const a = montar({
    ctx, pagina: paginaPrincipal(d),
    mensagem: `Foram detectados rastreadores (${fmt(nomes)}) e não encontramos banner nem ferramenta de consentimento de cookies no código lido. O analisador só informa a ausência do elemento; a conferência visual do rodapé é do modelo.`,
    evidencias: (ck.rastreadores || []).slice(0, 4).map((r) => ({ pagina: r.pagina || '/', versao: 'final', trecho: r.url, valor: r.nome })),
    citacoes: cit,
  });
  return comDisparo([a]);
};

detectores['lei-cookies-banner-sem-recusar'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  const b = d?.cookies?.banner;
  if (!b) return null;
  if (!b.detectado) return null; // sem banner, a regra não se aplica
  if (b.botoes.aceitar.length === 0 || b.botoes.recusar.length > 0 || b.botoes.gerenciar.length > 0) return semDisparo();
  const aceite = b.botoes.aceitar[0];
  const mencao = b.mencoes?.[0];
  const cit = [tentarTrecho(ctx, aceite.texto, ['visivel'], ['final']), mencao ? tentarTrecho(ctx, mencao.trecho, ['visivel'], ['final']) : null];
  const a = montar({
    ctx, pagina: aceite.pagina,
    mensagem: `Foi encontrado um banner de cookies com botão de aceite (${aspas(aceite.texto)}) e nenhum botão com texto de recusar, rejeitar ou gerenciar preferências. O modelo deve conferir se a opção de recusa está apenas escondida; o analisador só mede o texto dos botões.`,
    evidencias: [{ pagina: aceite.pagina, versao: 'final', seletor: aceite.seletor, trecho: aceite.texto, valor: 'aceitar', visivel: true }, ...(mencao ? [{ pagina: mencao.pagina, versao: 'final', seletor: mencao.seletor, trecho: mencao.trecho, valor: 'banner', visivel: true }] : [])],
    citacoes: cit,
  });
  return comDisparo([a]);
};

// ---------------------------------------------------------------- encarregado / canal do titular
detectores['lei-contato-encarregado'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.encarregado) return null;
  if (!(coletaDados(d) || usaRastreador(d, med))) return null;
  if (d.encarregado.presente) return semDisparo();
  const a = achadoAusencia(ctx, d, {
    texto: 'Não encontramos menção a encarregado de dados (DPO), canal do titular ou e-mail de privacidade nas páginas inspecionadas, e o site coleta dados ou usa rastreadores.',
    urls: d.encarregado.paginasInspecionadas,
  });
  return comDisparo([a]);
};

// ---------------------------------------------------------------- preço sem condições por perto (misto)
function temNotaDeRodape(ctx, pagina) { return nosVisiveis(ctx, pagina).some((n) => normalizarTexto(n.texto).startsWith('*')); }
detectores['lei-preco-condicoes-omitidas'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.precos) return null;
  const prom = new Set((d.promessas?.itens || []).map((x) => `${x.pagina}|${x.seletor}`));
  // preço dentro de frase já tratada como promessa de ganho (ex.: "+R$ 3.000 por mês") é reportado pela regra de promessa
  const consideraveis = (d.precos.itens || []).filter((x) => !prom.has(`${x.pagina}|${x.seletor}`));
  const candidatos = consideraveis.filter((x) => x.semCondicaoNoBloco || (x.asterisco && !temNotaDeRodape(ctx, x.pagina)));
  if (!(d.precos.itens || []).length) return null; // nenhum preço visível: nada a avaliar
  if (!candidatos.length) return semDisparo();
  const porPagina = new Map();
  for (const c of candidatos) { if (!porPagina.has(c.pagina)) porPagina.set(c.pagina, []); porPagina.get(c.pagina).push(c); }
  const achados = [];
  for (const [pagina, lista] of porPagina) {
    const valores = unicos(lista.map((x) => x.valor));
    const cit = [];
    for (const x of lista.slice(0, 6)) {
      cit.push(tentarTrecho(ctx, x.trecho, ['visivel'], [x.versao]));
      const num = String(x.valor).match(/\d[\d.,]*/)?.[0];
      if (num) cit.push({ tipo: 'numero', valor: num, onde: 'visivel', versoes: versoesValidas([x.versao]) });
    }
    const comAst = lista.some((x) => x.asterisco);
    achados.push(montar({
      ctx, pagina,
      mensagem: `Preço visível sem termo de condição por perto (como parcelamento, à vista, prazo, frete ou taxa): ${valores.join(', ')}.${comAst ? ' Há preço seguido de asterisco sem nota correspondente.' : ''} O analisador só olha o bloco ao redor; confira se as condições aparecem em outro ponto da página.`,
      evidencias: lista.slice(0, 6).map((x) => ({ pagina: x.pagina, versao: x.versao, seletor: x.seletor, trecho: x.trecho, valor: x.valor, visivel: true })),
      citacoes: cit,
      permitidos: [lista.length],
    }));
  }
  return comDisparo(achados, candidatos.length / Math.max(1, consideraveis.length));
};

// ---------------------------------------------------------------- escassez / contador (misto)
detectores['lei-escassez-oferta-falsa-suspeita'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  const e = d?.escassez;
  if (!e) return null;
  const estaticos = (e.itens || []).filter((x) => x.mudaEntreVersoes === null && /\d/.test(x.trecho));
  const temContexto = (e.itens || []).length > 0 || (e.elementosContador || []).length > 0;
  const js = temContexto ? (e.padroesEmJs || []) : [];
  if (!estaticos.length && !js.length) return semDisparo();
  const achados = [];
  for (const x of estaticos.slice(0, 5)) {
    achados.push(montar({
      ctx, pagina: x.pagina,
      mensagem: `O texto de escassez ou contagem ${aspas(x.trecho)} aparece igual em todas as leituras da página (código cru, depois de carregar e final). Pode ser um aviso fixo que parece um contador. O analisador não recarregou a página e não afirma que a oferta é falsa.`,
      evidencias: [{ pagina: x.pagina, versao: x.versao, seletor: x.seletor, trecho: x.texto, valor: x.trecho, visivel: true }],
      citacoes: [tentarTrecho(ctx, x.trecho, ['visivel'], [x.versao]), tentarTrecho(ctx, x.texto, ['visivel'], [x.versao])],
    }));
  }
  if (js.length) {
    const j = js[0];
    const casado = (String(j.trecho).match(/Date\.now\(\)\s*\+|new\s+Date\(\)\.getTime\(\)\s*\+|localStorage\.setItem\(\s*['"][^'"]*/i) || [])[0];
    achados.push(montar({
      ctx, pagina: paginaPrincipal(d),
      mensagem: `Há código que calcula um prazo a partir da hora da visita (${aspas(casado || 'Date.now() +')}) e a página tem elementos de contagem ou avisos de escassez. Isso pode fazer o contador recomeçar a cada visita. O analisador não recarregou a página para confirmar e não afirma que a oferta é falsa.`,
      evidencias: [{ pagina: paginaPrincipal(d), versao: 'final', trecho: j.trecho, valor: j.origem }],
      citacoes: [casado ? tentarTrecho(ctx, casado, ['js', 'html'], ['final']) : null],
    }));
  }
  return comDisparo(achados);
};

// ---------------------------------------------------------------- formulário sem link de privacidade
detectores['lei-formulario-sem-link-privacidade'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  const f = d?.formularios;
  if (!f) return null;
  const alvos = (f.itens || []).filter((x) => x.coletaDadoPessoal && !x.ignorado);
  if (!alvos.length) return semDisparo();
  const sem = alvos.filter((x) => !x.temLinkOuAviso);
  if (!sem.length) return semDisparo();
  const achados = sem.slice(0, 10).map((x) => {
    const filhos = nosVisiveis(ctx, x.pagina).filter((n) => String(n.seletor).startsWith(`${x.seletor}>`)).map((n) => n.texto);
    const maior = filhos.sort((a, b) => b.length - a.length)[0];
    const campos = unicos(x.camposPessoais.map((c) => c.tipo + (c.nome ? `:${c.nome}` : '')));
    return montar({
      ctx, pagina: x.pagina,
      mensagem: `O formulário em ${x.seletor} coleta dados pessoais (campos: ${campos.join(', ')}) e não há link nem aviso de privacidade dentro dele ou logo ao redor. Ficam de fora formulários de busca e de login.`,
      evidencias: [{ pagina: x.pagina, versao: 'final', seletor: x.seletor, trecho: x.textoAoRedor || undefined, valor: campos.join(', '), contagem: x.camposPessoais.length }],
      citacoes: [maior ? tentarTrecho(ctx, maior, ['visivel'], ['final']) : null, x.action ? tentarTrecho(ctx, x.action, ['html'], ['final']) : null],
    });
  });
  return comDisparo(achados, sem.length / alvos.length);
};

// ---------------------------------------------------------------- checkbox de consentimento pré-marcado
detectores['lei-checkbox-consentimento-pre-marcado'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !Array.isArray(d.checkboxesPreMarcados)) return null;
  const itens = d.checkboxesPreMarcados.filter((c) => c.consentimentoRelacionado);
  if (!itens.length) return semDisparo();
  const grupos = new Map();
  for (const c of itens) {
    const k = `${c.pagina}|${c.nome}|${c.id}`;
    if (!grupos.has(k)) grupos.set(k, { ...c, versoes: [] });
    grupos.get(k).versoes.push(c.versao);
  }
  const achados = [...grupos.values()].slice(0, 10).map((g) => {
    const rotulo = trechoVisivelContido(ctx, g.pagina, g.textoAoLado);
    return montar({
      ctx, pagina: g.pagina,
      mensagem: `Há uma caixa de seleção já marcada que parece ser de consentimento ou marketing${g.nome ? ` (nome: ${g.nome})` : ''}${rotulo ? `, ao lado do texto ${aspas(rotulo)}` : ''}. O analisador só mede que ela vem marcada no código; confira se isso se aplica ao seu caso.`,
      evidencias: [{ pagina: g.pagina, versao: g.versoes.includes('final') ? 'final' : g.versoes[0], trecho: rotulo || g.textoAoLado, valor: g.nome || g.id || 'checkbox', visivel: undefined }],
      citacoes: [rotulo ? tentarTrecho(ctx, rotulo, ['visivel'], ['final']) : null],
    });
  });
  return comDisparo(achados);
};

// ---------------------------------------------------------------- arrependimento, atendimento, endereço, entrega
detectores['lei-direito-arrependimento-ausente'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.arrependimento) return null;
  if (!(d.oferta?.temPreco && ((d.oferta.botoesCompra || []).length || (d.oferta.linksCheckout || []).length))) return null; // só avalia se há preço e compra
  if (d.arrependimento.mencionado) return semDisparo();
  const of = d.oferta.botoesCompra?.[0] || d.oferta.linksCheckout?.[0];
  const a = achadoAusencia(ctx, d, {
    texto: 'Não encontramos menção a arrependimento, desistência, devolução, reembolso ou prazo de 7 dias em texto visível, e há preço com opção de compra.',
    urls: d.arrependimento.paginasInspecionadas,
    extraCitacoes: [of?.texto ? tentarTrecho(ctx, of.texto, ['visivel'], ['final']) : null],
    extraEvidencias: of ? [{ pagina: of.pagina, versao: 'final', seletor: of.seletor, trecho: of.texto, valor: 'oferta', visivel: true }] : [],
    permitidos: ['7'],
  });
  return comDisparo([a]);
};

detectores['lei-atendimento-sac-ausente'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.contato) return null;
  if (!temOferta(d)) return null;
  if (d.contato.canalDeAtendimentoPresente) return semDisparo();
  const a = achadoAusencia(ctx, d, {
    texto: 'Não encontramos canal de atendimento (e-mail, telefone, WhatsApp, formulário de contato ou link de fale conosco/suporte) nas páginas inspecionadas, e o site tem oferta.',
    urls: d.contato.paginasInspecionadas,
  });
  return comDisparo([a]);
};

detectores['lei-endereco-fisico-ausente'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.contato) return null;
  if (!temOferta(d)) return null;
  if (d.contato.enderecoFisicoPresente) return semDisparo();
  const a = achadoAusencia(ctx, d, {
    texto: 'Não encontramos endereço físico (logradouro, CEP ou endereço postal nos dados estruturados) nas páginas inspecionadas, e o site tem oferta.',
    urls: d.contato.paginasInspecionadas,
  });
  return comDisparo([a]);
};

detectores['lei-prazo-entrega-frete-ausente'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  if (!d || !d.prazoEntregaFrete) return null;
  if (!temOferta(d)) return null;
  if (d.prazoEntregaFrete.mencionado) return semDisparo();
  const of = exemploOferta(d);
  const a = achadoAusencia(ctx, d, {
    texto: 'Não encontramos termos de frete, entrega, envio, retirada ou acesso em texto visível perto da oferta. O modelo confere se a informação está em outra página do fluxo de compra.',
    urls: d.paginasInspecionadas,
    extraCitacoes: [of?.trecho ? tentarTrecho(ctx, of.trecho, ['visivel'], ['final']) : null],
  });
  return comDisparo([a]);
};

// ---------------------------------------------------------------- conteúdo da política de privacidade
const ROTULO_DIREITO = { acesso: 'acesso aos dados', correcao: 'correção', eliminacao: 'eliminação', portabilidade: 'portabilidade', revogacao: 'revogação do consentimento', art18: 'direitos do titular' };
const ROTULO_CONTEUDO = { finalidade: 'finalidade', formaEDuracao: 'forma e duração', controlador: 'controlador', contato: 'contato', compartilhamento: 'compartilhamento' };
function politicaFraca({ campo, rotulos, minimo, descricao }) {
  return ({ ctx, med }) => {
    const d = dadosDe(med, 'lei');
    if (!d || !d.privacidade) return null;
    const alvos = (d.privacidade.alvos || []).filter((a) => a.paginaExiste && a[campo]);
    if (!alvos.length) return null; // sem política: dispara lei-politica-privacidade-ausente
    const melhor = alvos.reduce((m, a) => (a[campo].gruposPresentes.length > m[campo].gruposPresentes.length ? a : m));
    const presentes = melhor[campo].gruposPresentes;
    if (presentes.length >= minimo) return semDisparo();
    const link = (d.privacidade.links || []).find((l) => l.url === melhor.url) || d.privacidade.links?.[0];
    const caminho = caminhoDe(melhor.urlFinal || melhor.url);
    const a = montar({
      ctx, pagina: link?.pagina || paginaPrincipal(d),
      mensagem: `A página de privacidade (${caminho}) ${descricao}: por palavras-chave, ${presentes.length ? `encontramos ${presentes.map((g) => rotulos[g] || g).join(', ')}` : 'não encontramos nenhum dos grupos de termos'}. É uma heurística de palavras; confira o texto da página.`,
      evidencias: [{ pagina: link?.pagina || paginaPrincipal(d), versao: link?.versao, seletor: link?.seletor, trecho: link?.texto, valor: `${presentes.length} de ${melhor[campo].total} grupos de termos`, contagem: presentes.length, visivel: link?.visivel }],
      citacoes: [link?.texto ? tentarTrecho(ctx, link.texto, link.visivel ? ['visivel', 'html'] : ['html'], [link.versao]) : null],
      permitidos: [caminho, melhor[campo].total, minimo],
    });
    return comDisparo([a], 1 - presentes.length / Math.max(1, melhor[campo].total));
  };
}
detectores['lei-politica-direitos-titular-ausentes'] = politicaFraca({ campo: 'direitosTitular', rotulos: ROTULO_DIREITO, minimo: 2, descricao: 'menciona poucos direitos do titular' });
detectores['lei-politica-conteudo-minimo-ausente'] = politicaFraca({ campo: 'conteudoMinimo', rotulos: ROTULO_CONTEUDO, minimo: 3, descricao: 'traz poucos dos itens básicos de uma política' });

// ---------------------------------------------------------------- link de privacidade/termos quebrado
const TIPO_LEGAL = { privacidade: 'política de privacidade', termos: 'termos de uso', cookies: 'política de cookies' };
const MOTIVO_FALHA = (alvo, f) => {
  if (f === 'status_http != 200') return `resposta HTTP ${alvo.status ?? 'sem resposta'}`;
  if (f === 'soft-404') return 'uma página que parece de erro ("não encontrada") mesmo com resposta 200';
  if (f.startsWith('texto visível')) return `texto visível curto (${alvo.caracteres ?? 0} caracteres, abaixo do mínimo de 300)`;
  return f;
};
detectores['lei-pagina-legal-quebrada'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'lei');
  const lk = dadosDe(med, 'links');
  if (!d && !lk) return null;
  const falhas = [];
  const chaves = new Set();
  const add = (f) => { const k = `${f.tipo}|${f.link.hrefAttr}|${f.motivos.join(';')}`; if (!chaves.has(k)) { chaves.add(k); falhas.push(f); } };
  if (d) {
    for (const tipo of ['privacidade', 'termos']) {
      const sec = d[tipo];
      if (!sec) continue;
      const porUrl = new Map((sec.alvos || []).filter((a) => a.origem !== 'rota-comum').map((a) => [a.url, a]));
      for (const l of sec.links || []) {
        if (l.destino === 'sem-destino') add({ tipo, link: l, motivos: ['o endereço do link é vazio, "#" ou javascript:'], alvo: null });
        else if (l.destino === 'url') { const a = porUrl.get(l.url); if (a && a.falhas?.length) add({ tipo, link: l, motivos: a.falhas.map((f) => MOTIVO_FALHA(a, f)), alvo: a }); }
      }
    }
    // política de cookies: só links que parecem a política (não botões "aceitar cookies")
    for (const l of d.cookies?.politicaDeCookies?.links || []) {
      if (l.destino === 'sem-destino' && (/pol[ií]tica|aviso|declara[cç][aã]o/i.test(l.texto) || /cookie/i.test(l.hrefAttr || '')) && !/aceit|accept|permit/i.test(l.texto)) add({ tipo: 'cookies', link: l, motivos: ['o endereço do link é vazio, "#" ou javascript:'], alvo: null });
    }
  }
  // complemento: href inválido (#, javascript:) apontado pelo medidor de links, para textos de privacidade/termos/cookies
  const jaVistos = new Set(falhas.map((f) => `${f.link.pagina}|${f.link.seletor}`));
  for (const h of lk?.hrefInvalidos || []) {
    if (!/(privacidade|privacy|lgpd|termos|terms|pol[ií]tica\s+de\s+cookies)/i.test(`${h.texto} ${h.hrefAttr}`) || jaVistos.has(`${h.pagina}|${h.seletor}`)) continue;
    const tipo = /cookies/i.test(h.texto) ? 'cookies' : /termos|terms/i.test(h.texto) ? 'termos' : 'privacidade';
    add({ tipo, link: { texto: h.texto, hrefAttr: h.hrefAttr, pagina: h.pagina, seletor: h.seletor, versao: 'final', visivel: true }, motivos: ['o endereço do link é vazio, "#" ou javascript:'], alvo: null });
  }
  if (!falhas.length) return semDisparo();
  const achados = falhas.slice(0, 10).map((f) => {
    const l = f.link;
    return montar({
      ctx, pagina: l.pagina,
      mensagem: `O link ${aspas(l.texto)} (${TIPO_LEGAL[f.tipo]}) leva a um destino com problema: ${f.motivos.join('; ')}.`,
      evidencias: [{ pagina: l.pagina, versao: l.versao, seletor: l.seletor, trecho: l.texto, valor: `${l.hrefAttr} -> ${f.alvo ? (f.alvo.status ?? 'sem resposta') : 'sem destino'}`, visivel: l.visivel }],
      citacoes: [tentarTrecho(ctx, l.texto, l.visivel === false ? ['html'] : ['visivel', 'html'], [l.versao])],
      permitidos: [f.alvo?.status, f.alvo?.caracteres, 300].filter((x) => x !== null && x !== undefined),
    });
  });
  return comDisparo(achados);
};

// ================================================================================================ SEGURANÇA DE CONTEÚDO

// ---------------------------------------------------------------- injeção de prompt (medidor injecao)
const ONDE_INJECAO = {
  'texto-visivel': { rotulo: 'no texto visível da página', onde: ['visivel', 'qualquer'] },
  'texto-oculto': { rotulo: 'em texto oculto (que não aparece para quem visita)', onde: ['html', 'qualquer'] },
  titulo: { rotulo: 'no título da página', onde: ['html', 'qualquer'] },
  'comentario-html': { rotulo: 'em um comentário do HTML', onde: ['html', 'qualquer'] },
  jsonld: { rotulo: 'nos dados estruturados (JSON-LD)', onde: ['jsonld', 'html', 'qualquer'] },
  noscript: { rotulo: 'no conteúdo de noscript', onde: ['html', 'qualquer'] },
  'llms.txt': { rotulo: 'no arquivo llms.txt', onde: [] },
};
function infoOndeInjecao(onde) {
  if (ONDE_INJECAO[onde]) return ONDE_INJECAO[onde];
  if (onde.startsWith('atributo-')) return { rotulo: `no atributo ${onde.slice(9)} de um elemento`, onde: ['html', 'qualquer'] };
  if (onde.startsWith('meta-')) return { rotulo: `na meta tag ${onde.slice(5)}`, onde: ['html', 'qualquer'] };
  return { rotulo: `em ${onde}`, onde: ['html', 'qualquer'] };
}
detectores['seg-injecao-de-prompt'] = ({ ctx, med }) => {
  const d = dadosDe(med, 'injecao');
  if (!d || !Array.isArray(d.achados)) return null;
  if (!d.achados.length) return semDisparo();
  const achados = d.achados.slice(0, 50).map((a) => {
    const info = infoOndeInjecao(a.onde);
    const cit = [tentarTrecho(ctx, a.trecho, info.onde, a.versoes)]; // llms.txt: sem onde verificável; cai nas âncoras
    // a mensagem NÃO repete o texto do site (conteúdo do site é dado, nunca instrução); o trecho fica só em evidências/citações
    return montar({
      ctx, pagina: a.pagina || '/',
      mensagem: `Há texto que parece dirigido a uma IA ou agente ${info.rotulo}. O analisador trata esse conteúdo como dado do site, nunca como instrução, e o retira do material enviado ao modelo.`,
      evidencias: [{ pagina: a.pagina, versao: versoesValidas(a.versoes, [])[0], seletor: a.seletor || undefined, trecho: a.trecho, valor: a.onde, contagem: a.ocorrencias, visivel: a.visivel }],
      citacoes: cit,
    });
  });
  return comDisparo(achados);
};

// ---------------------------------------------------------------- leitura direta do ctx (regras seg-* de HTML/HTTP)
const ehHostLocal = (host) => {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/:\d+$/, '');
  return h === 'localhost' || h === '::1' || h === '0.0.0.0' || /^127\./.test(h) || h.endsWith('.localhost') || h.endsWith('.test');
};
const urlDe = (s, base) => { try { return new URL(s, base); } catch { return null; } };
const urlFinalDe = (p) => p.final?.extr?.url || p.cru?.urlFinal || p.url;
const semWww = (h) => String(h).toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');

// Atributos de uma tag HTML (primeira ocorrência de cada nome).
function atributosDe(tag) {
  const o = {};
  for (const m of tag.matchAll(/([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const k = m[1].toLowerCase();
    if (!(k in o)) o[k] = decodificarEntidades(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return o;
}
// HTML sem comentários e sem o CORPO de <script> (mantém a tag de abertura).
function htmlParaVarredura(html) {
  return String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/(<script\b[^>]*>)[\s\S]*?(<\/script\s*>)/gi, '$1$2');
}

// ---------------------------------------------------------------- conteúdo misto (http dentro de https)
function recursosHttp(html, ehLocalUrl) {
  const achados = [];
  for (const m of htmlParaVarredura(html).matchAll(/<(script|link|img|iframe|embed|object|source|video|audio)\b[^>]*>/gi)) {
    const tag = m[1].toLowerCase();
    const at = atributosDe(m[0]);
    const candidatos = [];
    if (tag === 'link') {
      const rel = String(at.rel || '').toLowerCase().split(/\s+/);
      if (rel.includes('stylesheet')) candidatos.push([at.href, 'link stylesheet', 'ativo']);
      else if (rel.some((r) => ['icon', 'apple-touch-icon', 'mask-icon'].includes(r))) candidatos.push([at.href, 'link icon', 'passivo']);
      else if (rel.includes('preload') || rel.includes('modulepreload')) candidatos.push([at.href, 'link preload', ['script', 'style', 'font', 'fetch'].includes(String(at.as || '').toLowerCase()) ? 'ativo' : 'passivo']);
    } else if (tag === 'script' || tag === 'iframe' || tag === 'embed') candidatos.push([at.src, tag, 'ativo']);
    else if (tag === 'object') candidatos.push([at.data, tag, 'ativo']);
    else { candidatos.push([at.src, tag, 'passivo']); if (at.poster) candidatos.push([at.poster, `${tag} poster`, 'passivo']); }
    for (const [url, rotulo, classe] of candidatos) {
      if (url && /^http:\/\//i.test(url.trim()) && !ehLocalUrl(url.trim())) achados.push({ url: url.trim(), tag: rotulo, classe });
    }
  }
  return achados;
}
const CLASSE_REQUISICAO = { script: 'ativo', stylesheet: 'ativo', font: 'ativo', fetch: 'ativo', xhr: 'ativo', document: 'ativo', image: 'passivo', media: 'passivo' };
detectores['seg-mixed-content'] = ({ ctx }) => {
  const paginas = (ctx?.paginas || []).filter((p) => String(urlFinalDe(p)).startsWith('https://'));
  if (!paginas.length) return null; // só avalia páginas https
  const ehLocalUrl = (u) => { const x = urlDe(u); return !x || ehHostLocal(x.hostname); };
  const achados = [];
  for (const p of paginas) {
    const mapa = new Map();
    for (const [versao, html] of [['cru', p.cru?.html], ['final', p.final?.html]]) {
      for (const r of recursosHttp(html, ehLocalUrl)) {
        const k = `${r.tag}|${r.url}`;
        if (!mapa.has(k)) mapa.set(k, { ...r, versoes: [] });
        mapa.get(k).versoes.push(versao);
      }
    }
    for (const r of p.requisicoes || []) {
      if (!r.url || !/^http:\/\//i.test(r.url) || ehLocalUrl(r.url)) continue;
      const k = `requisição|${r.url}`;
      if (![...mapa.values()].some((x) => x.url === r.url)) mapa.set(k, { url: r.url, tag: `requisição (${r.tipo || 'rede'})`, classe: CLASSE_REQUISICAO[r.tipo] || 'passivo', versoes: ['final'], dinamico: true });
    }
    if (!mapa.size) continue;
    const lista = [...mapa.values()];
    const ativos = lista.filter((x) => x.classe === 'ativo');
    const passivos = lista.filter((x) => x.classe === 'passivo');
    const mostrar = [...ativos, ...passivos].slice(0, 5);
    const cit = mostrar.map((r) => (r.dinamico ? null : tentarTrecho(ctx, r.url, ['html'], r.versoes)));
    const pagina = caminhoDe(urlFinalDe(p));
    const partes = [];
    if (ativos.length) partes.push(`recursos ativos (scripts, estilos, quadros; o navegador costuma bloquear): ${ativos.slice(0, 5).map((r) => `${r.tag} ${r.url}`).join('; ')}`);
    if (passivos.length) partes.push(`recursos passivos (imagens, áudio, vídeo): ${passivos.slice(0, 5).map((r) => `${r.tag} ${r.url}`).join('; ')}`);
    achados.push(montar({
      ctx, pagina,
      mensagem: `A página abre em HTTPS, mas carrega ${lista.length} recurso(s) por http://. Encontrados: ${partes.join('. ')}.`,
      evidencias: mostrar.map((r) => ({ pagina, versao: r.versoes.includes('final') ? 'final' : r.versoes[0], seletor: r.tag, trecho: r.url, valor: r.classe })),
      citacoes: cit,
      permitidos: [lista.length, ativos.length, passivos.length],
    }));
  }
  if (!achados.length) return semDisparo();
  return comDisparo(achados, achados.length / paginas.length);
};

// ---------------------------------------------------------------- página sem HTTPS
detectores['seg-pagina-sem-https'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  if (!paginas.length) return null;
  const publicas = paginas.filter((p) => { const u = urlDe(urlFinalDe(p)); return u && !ehHostLocal(u.hostname); });
  if (!publicas.length) return null; // pasta/ZIP/colado servido em 127.0.0.1: não avalia
  const sem = publicas.filter((p) => urlDe(urlFinalDe(p))?.protocol === 'http:');
  if (!sem.length) return semDisparo();
  const achados = sem.slice(0, 10).map((p) => {
    const u = urlDe(urlFinalDe(p));
    const pagina = caminhoDe(u.href);
    const redirecionada = urlDe(p.url)?.protocol === 'http:' ? 'o endereço pedido era http:// e não foi redirecionado para https://' : 'o endereço final começa com http://';
    return montar({
      ctx, pagina,
      mensagem: `A página ${pagina} de ${u.host} foi servida sem HTTPS: ${redirecionada}.`,
      evidencias: [{ pagina, versao: 'final', trecho: tituloDa(ctx, pagina) || undefined, valor: 'http', visivel: undefined }],
      citacoes: [],
      permitidos: [u.host, pagina],
    });
  });
  return comDisparo(achados, sem.length / publicas.length);
};

// ---------------------------------------------------------------- formulário sem HTTPS
const CAMPO_ALERTA = (c) => ['password', 'email', 'tel'].includes(String(c.tipo || '').toLowerCase()) || /cpf/i.test(String(c.nome || ''));
detectores['seg-formulario-sem-https'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  if (!paginas.length) return null;
  const achados = [];
  let comCampoAlerta = 0;
  for (const p of paginas) {
    const base = urlFinalDe(p);
    const ub = urlDe(base);
    const paginaHttp = ub?.protocol === 'http:' && !ehHostLocal(ub.hostname);
    const caminho = caminhoDe(base);
    const forms = unicos([...(p.final?.extr?.formularios || []), ...(p.cru?.extr?.formularios || [])].filter((f) => !f.clone), (f) => `${f.seletor}|${f.action}`);
    for (const f of forms) {
      const campos = f.campos || [];
      const alerta = campos.filter(CAMPO_ALERTA);
      if (alerta.length) comCampoAlerta++;
      const motivos = [];
      const cit = [];
      // action explícito em http:// (action relativo em página http já é coberto pelo motivo da página)
      const alvo = f.action && /^http:\/\//i.test(f.action.trim()) ? urlDe(f.action.trim(), base) : null;
      if (alvo && !ehHostLocal(alvo.hostname)) { motivos.push(`o envio vai para um endereço http:// (${f.action})`); cit.push(tentarTrecho(ctx, f.action, ['html'], ['cru', 'final'])); }
      if (paginaHttp && alerta.length) motivos.push('a página abre sem HTTPS e o formulário pede e-mail, telefone, senha ou CPF');
      if (campos.some((c) => String(c.tipo || '').toLowerCase() === 'password') && f.metodo === 'get') motivos.push('há campo de senha e o formulário usa o método GET (os dados vão no endereço)');
      if (!motivos.length) continue;
      const textos = nosVisiveis(ctx, caminho).filter((n) => String(n.seletor).startsWith(`${f.seletor}>`)).map((n) => n.texto).sort((a, b) => b.length - a.length);
      if (textos[0]) cit.push(tentarTrecho(ctx, textos[0], ['visivel'], ['final']));
      achados.push(montar({
        ctx, pagina: caminho,
        mensagem: `Formulário ${f.seletor}: ${motivos.join('; ')}.`,
        evidencias: [{ pagina: caminho, versao: 'final', seletor: f.seletor, trecho: f.action || undefined, valor: `método ${f.metodo}; campos: ${unicos(campos.filter((c) => c.tag === 'input').map((c) => c.tipo || 'text')).join(', ')}`, contagem: campos.length }],
        citacoes: cit,
      }));
    }
  }
  if (!achados.length) return semDisparo();
  return comDisparo(achados.slice(0, 20), Math.min(1, achados.length / Math.max(1, comCampoAlerta)));
};

// ---------------------------------------------------------------- script/CSS de terceiro sem SRI
const IGNORAR_SRI = ['googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'connect.facebook.net', 'facebook.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'doubleclick.net', 'googlesyndication.com', 'hotjar.com', 'clarity.ms', 'snap.licdn.com', 'analytics.tiktok.com', 'cdn.segment.com', 'bat.bing.com'];
const VERSAO_FIXA = [/@v?\d+(?:\.\d+)+/, /\/v?\d+\.\d+(?:\.\d+)*\//, /[-.]v?\d+\.\d+\.\d+(?:\.min)?\.(?:js|css)(?:[?#]|$)/i];
const ehIgnoradoSri = (host) => IGNORAR_SRI.some((d) => host === d || host.endsWith(`.${d}`));
detectores['seg-script-terceiro-sem-sri'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  if (!paginas.length) return null;
  const achados = [];
  let totalTerceiros = 0;
  let totalSem = 0;
  for (const p of paginas) {
    const base = urlFinalDe(p);
    const hostPagina = urlDe(base)?.host || '';
    const recursos = new Map();
    const registrar = (attr, tag, integrity) => {
      if (!attr) return;
      const u = urlDe(attr, base);
      if (!u || !/^https?:$/.test(u.protocol) || semWww(u.host) === semWww(hostPagina) || ehIgnoradoSri(u.hostname.toLowerCase())) return;
      if (!VERSAO_FIXA.some((re) => re.test(u.href))) return; // só bibliotecas de versão fixa
      if (!recursos.has(u.href)) recursos.set(u.href, { href: u.href, attr, tag, integrity: !!integrity });
      else if (integrity) recursos.get(u.href).integrity = true;
    };
    for (const extr of [p.final?.extr, p.cru?.extr]) for (const s of extr?.scripts || []) registrar(s.src, 'script[src]', s.integrity);
    for (const html of [p.final?.html, p.cru?.html]) {
      for (const m of htmlParaVarredura(html).matchAll(/<link\b[^>]*>/gi)) {
        const at = atributosDe(m[0]);
        if (String(at.rel || '').toLowerCase().split(/\s+/).includes('stylesheet')) registrar(at.href, 'link[rel=stylesheet]', at.integrity);
      }
    }
    const lista = [...recursos.values()];
    totalTerceiros += lista.length;
    const sem = lista.filter((r) => !r.integrity);
    totalSem += sem.length;
    if (!sem.length) continue;
    const pagina = caminhoDe(base);
    const mostrar = sem.slice(0, 5);
    achados.push(montar({
      ctx, pagina,
      mensagem: `A página carrega ${sem.length} recurso(s) de outros endereços, com versão fixa, sem o atributo integrity: ${mostrar.map((r) => r.attr).join('; ')}. Rastreadores e fontes ficam de fora desta conferência.`,
      evidencias: mostrar.map((r) => ({ pagina, versao: 'final', seletor: r.tag, trecho: r.attr, valor: 'sem integrity' })),
      citacoes: mostrar.map((r) => tentarTrecho(ctx, r.attr, ['html'], ['cru', 'final'])),
      permitidos: [sem.length],
    }));
  }
  if (!achados.length) return semDisparo();
  return comDisparo(achados, totalSem / Math.max(1, totalTerceiros));
};

// ---------------------------------------------------------------- target=_blank sem noopener (informativo)
detectores['seg-link-blank-sem-noopener'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  if (!paginas.length) return null;
  const achados = [];
  let totalBlankExternos = 0;
  let totalSem = 0;
  for (const p of paginas) {
    const links = unicos([...(p.final?.extr?.links || []), ...(p.cru?.extr?.links || [])].filter((l) => !l.clone), (l) => `${l.hrefAttr}|${l.texto}`);
    const externos = links.filter((l) => String(l.target || '').toLowerCase() === '_blank' && /^https?:/i.test(l.href || '') && !l.interno);
    const sem = externos.filter((l) => !/\b(noopener|noreferrer)\b/i.test(l.rel || ''));
    totalBlankExternos += externos.length;
    totalSem += sem.length;
    if (!sem.length) continue;
    const pagina = caminhoDe(urlFinalDe(p));
    const mostrar = sem.slice(0, 5);
    achados.push(montar({
      ctx, pagina,
      mensagem: `A página tem ${sem.length} link(s) para outros sites que abrem em nova aba sem rel="noopener" nem "noreferrer": ${mostrar.map((l) => l.hrefAttr).join('; ')}. É só informativo: navegadores modernos já tratam essa situação como noopener, mas o código não declara.`,
      evidencias: mostrar.map((l) => ({ pagina, versao: 'final', seletor: l.seletor, trecho: l.hrefAttr, valor: l.rel ? `rel="${l.rel}"` : 'sem rel', visivel: l.visivel })),
      citacoes: mostrar.map((l) => tentarTrecho(ctx, l.hrefAttr, ['html'], ['cru', 'final'])),
      permitidos: [sem.length],
    }));
  }
  if (!achados.length) return semDisparo();
  return comDisparo(achados, totalSem / Math.max(1, totalBlankExternos));
};

// ---------------------------------------------------------------- cabeçalhos de segurança (informativo)
const CABECALHOS = ['Strict-Transport-Security', 'Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy'];
const SEIS_MESES_S = 15768000;
detectores['seg-cabecalhos-seguranca-info'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  const inicial = paginas.find((p) => urlDe(p.url)?.pathname === '/') || paginas[0];
  if (!inicial) return null;
  const u = urlDe(urlFinalDe(inicial));
  if (!u || ehHostLocal(u.hostname)) return null; // servidor temporário não define cabeçalhos
  const cab = inicial.cru?.cabecalhos || inicial.nav?.cabecalhos;
  if (!cab || typeof cab !== 'object') return null;
  const minusc = Object.fromEntries(Object.entries(cab).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const linhas = CABECALHOS.map((nome) => ({ nome, valor: minusc[nome.toLowerCase()] ?? null }));
  const ausentes = linhas.filter((l) => l.valor === null || l.valor.trim() === '');
  if (!ausentes.length) return semDisparo();
  const presentes = linhas.filter((l) => !ausentes.includes(l));
  const pagina = caminhoDe(urlFinalDe(inicial));
  const hsts = presentes.find((l) => l.nome === 'Strict-Transport-Security');
  const maxAge = hsts ? Number((hsts.valor.match(/max-age\s*=\s*(\d+)/i) || [])[1]) : NaN;
  const nota = Number.isFinite(maxAge) && maxAge < SEIS_MESES_S ? ' O max-age do Strict-Transport-Security está abaixo do referencial de 6 meses.' : '';
  const v = (l) => cortar(l.valor, 120);
  const a = montar({
    ctx, pagina,
    mensagem: `Cabeçalhos de segurança básicos na resposta da página inicial. Ausentes: ${ausentes.map((l) => l.nome).join(', ')}.${presentes.length ? ` Presentes: ${presentes.map((l) => `${l.nome} = ${v(l)}`).join('; ')}.` : ''}${nota} Informativo: não classifica o site como vulnerável.`,
    evidencias: linhas.map((l) => ({ pagina, versao: 'cru', seletor: `cabeçalho ${l.nome}`, trecho: l.nome, valor: l.valor === null ? 'ausente' : v(l) })),
    citacoes: [],
  });
  return comDisparo([a], ausentes.length / CABECALHOS.length);
};

// ---------------------------------------------------------------- fonte carregada dos servidores do Google
// Fato (script): <link>, @import ou url() de @font-face para fonts.googleapis.com / fonts.gstatic.com, no HTML cru, no DOM
// final, no CSS inline e nos arquivos CSS baixados. Interpretação (opinião): possível envio do IP do visitante ao Google,
// em campo próprio. Nunca diz que o site viola a lei. Fonte do próprio domínio: nenhum achado.
const RE_HOST_FONTE_GOOGLE = /(?:https?:)?\/\/fonts\.(?:googleapis|gstatic)\.com[^\s"'()<>]{0,400}/gi;
const RELS_FONTE = ['stylesheet', 'preconnect', 'preload', 'dns-prefetch', 'prefetch'];

// Varredura LINEAR de <link ...> (sem regex com retrocesso): só olha até 2000 caracteres a partir de cada "<link".
function tagsLink(html) {
  const t = String(html || '');
  const baixo = t.toLowerCase();
  const saida = [];
  let pos = 0;
  while (saida.length < 3000) {
    const i = baixo.indexOf('<link', pos);
    if (i < 0) break;
    pos = i + 5;
    if (!/[\s/>]/.test(baixo[i + 5] ?? '>')) continue;
    const janela = t.slice(i, i + 2000);
    const fim = janela.indexOf('>');
    saida.push(fim < 0 ? janela : janela.slice(0, fim + 1));
  }
  return saida;
}

function contextoCss(css, indice) {
  const antes = css.slice(Math.max(0, indice - 160), indice).toLowerCase();
  if (antes.includes('@import')) return '@import';
  if (antes.includes('url(')) return '@font-face (url)';
  return 'css';
}

function fontesGoogleNaPagina(p, ctx) {
  const urlBase = urlFinalDe(p);
  const achadas = new Map(); // chave -> ocorrência
  const registrar = (o) => { const k = `${o.versao}|${o.onde}|${o.url}`; if (!achadas.has(k) && achadas.size < 40) achadas.set(k, o); };
  const norm = (u) => { let x = String(u).trim(); if (x.startsWith('//')) x = 'https:' + x; return x; };
  // 1) <link> no HTML cru e no final
  for (const [versao, html] of [['cru', p.cru?.html], ['final', p.final?.html]]) {
    for (const tag of tagsLink(html)) {
      const at = atributosDe(tag);
      if (!at.href || !/fonts\.(googleapis|gstatic)\.com/i.test(at.href)) continue;
      const rels = String(at.rel || '').toLowerCase().split(/\s+/).filter(Boolean);
      const rel = rels.find((r) => RELS_FONTE.includes(r));
      if (!rel) continue;
      registrar({ versao, url: norm(at.href), onde: `link[rel=${rel}]`, seletor: `link[rel=${rel}]`, fonte: 'html' });
    }
  }
  // 2) CSS inline (<style>) do DOM final e do cru (@import e url() de @font-face)
  const inline = [...(p.final?.extr?.estilosInline || []), ...(p.cru?.extr?.estilosInline || [])];
  inline.forEach((css, idx) => {
    let m;
    RE_HOST_FONTE_GOOGLE.lastIndex = 0;
    while ((m = RE_HOST_FONTE_GOOGLE.exec(css))) registrar({ versao: 'final', url: norm(m[0]), onde: `${contextoCss(css, m.index)} em CSS inline`, seletor: `style[${idx}]`, fonte: 'css' });
  });
  // 3) arquivos CSS baixados (do mesmo site; fontes de terceiros não são varridas)
  for (const a of ctx?.ativos || []) {
    if (a.tipo !== 'css' || !a.texto) continue;
    let m;
    RE_HOST_FONTE_GOOGLE.lastIndex = 0;
    while ((m = RE_HOST_FONTE_GOOGLE.exec(a.texto))) {
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(a.url)) continue; // o próprio CSS do Google não é "arquivo do site"
      registrar({ versao: 'final', url: norm(m[0]), onde: `${contextoCss(a.texto, m.index)} no arquivo CSS ${caminhoDe(a.url)}`, seletor: caminhoDe(a.url), fonte: 'css' });
    }
  }
  return { base: urlBase, itens: [...achadas.values()] };
}

const INTERPRETACAO_FONTE_GOOGLE = 'Quando o navegador de quem visita busca a fonte no Google, o endereço IP dele chega aos servidores do Google. Em 20/01/2022, o Tribunal Regional de Munique (Landgericht München I, processo 3 O 17493/20) concedeu 100 euros de indenização a um visitante cujo IP foi enviado ao Google por fontes carregadas assim, com base no regulamento europeu de proteção de dados (GDPR, art. 82, item 1). É uma decisão alemã, de um único tribunal, e não vale no Brasil; em 19/11/2026 não foi encontrada decisão brasileira equivalente. A LGPD (Lei 13.709/2018, art. 5º, inciso I) define dado pessoal como informação relacionada a pessoa natural identificada ou identificável; se um endereço IP se enquadra nisso depende do caso. Esta é uma interpretação (opinião), não um fato do código, e não é parecer jurídico. A decisão é sua.';

detectores['seg-fonte-google-servidores'] = ({ ctx }) => {
  const paginas = ctx?.paginas || [];
  if (!paginas.length) return null;
  const todas = [];
  for (const p of paginas) {
    const { itens } = fontesGoogleNaPagina(p, ctx);
    if (itens.length) todas.push({ p, itens });
  }
  if (!todas.length) return semDisparo();
  const unicasUrls = unicos(todas.flatMap((x) => x.itens.map((i) => i.url)));
  const primeira = todas[0];
  const pagina = caminhoDe(urlFinalDe(primeira.p));
  const mostrar = [];
  for (const { p, itens } of todas) for (const it of itens) if (mostrar.length < 8) mostrar.push({ p, it });
  const nOcorrencias = todas.reduce((s, x) => s + x.itens.length, 0);
  const exemplo = primeira.itens[0];
  const mensagem = `A página carrega fonte dos servidores do Google (fonts.googleapis.com ou fonts.gstatic.com): ${nOcorrencias} ocorrência(s) em ${todas.length} página(s) lida(s). Exemplo: ${exemplo.url} (${exemplo.onde}).`;
  const evidencias = mostrar.map(({ p, it }) => ({ pagina: caminhoDe(urlFinalDe(p)), versao: it.versao, seletor: it.seletor, trecho: it.url, valor: it.onde }));
  const citacoes = [];
  for (const { p, it } of mostrar) {
    if (citacoes.length >= 4) break;
    const c = tentarTrecho(ctx, it.url, it.fonte === 'html' ? ['html'] : ['css', 'html'], [it.versao, 'final', 'cru']);
    if (c && !citacoes.some((x) => x.valor === c.valor)) citacoes.push({ ...c, pagina: p.url });
  }
  return comDisparo([montar({
    ctx, pagina, mensagem, evidencias, citacoes,
    permitidos: [nOcorrencias, todas.length, ...unicasUrls.slice(0, 8)],
    ancorar: true,
    interpretacao: { selo: 'opiniao', texto: INTERPRETACAO_FONTE_GOOGLE },
  })], 1);
};

export { detectores };
export const IDS_DETECTORES = Object.keys(detectores);
