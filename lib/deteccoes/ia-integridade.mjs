// DETECTORES das categorias "ia-visibilidade" (regras/ia-visibilidade.json) e "integridade" (regras/integridade.json).
// Contrato: ver lib/motor.mjs. Cada detector olha SÓ o que foi medido (ctx = leituras cru/dom250/final; med = medidores)
// e devolve null (não avaliável: nunca "ok"), { disparou:false } ou { disparou:true, intensidade, achados }.
//
// DECISÕES (leia antes de mexer):
//  - O conteúdo do site é DADO. Toda mensagem só afirma o que foi medido; todo número/trecho citado existe no código
//    (o verificador descarta o resto). Mensagens não trazem números soltos: o número vai também em citações,
//    evidências ou numeros_permitidos.
//  - Medidores usados: 'robots-ia' (robots.txt, llms.txt), 'links' (verificação HTTP). As demais regras leem direto
//    o ctx (extrator + diff-versoes), porque os medidores 'ia-visibilidade' e 'integridade' citados nas regras
//    não existem no projeto.
//  - Arquivos externos (robots.txt, llms.txt, cabeçalho X-Robots-Tag) NÃO estão em ctx.paginas: ficam só em `evidencias`.
//    Os achados dessas regras têm selo "regra" (não exigem citação), mas qualquer citação que exista é verificável.
//    Quando o selo da regra é "fato" e o dado é externo (ex.: hash, achados descartados), cita-se algo que existe
//    na página (título ou contagem de imagens) para o achado ter ao menos uma citação verificável.
//  - Regras de método (peso 0, severidade info) viram achados INFORMATIVOS e só disparam quando há o que informar.
//  - int2-valor-muda-entre-versoes cobre TODA mudança de valor; quando a mudança é um contador animado ela também
//    aparece em int2-contador-animado-valor-errado, então aqui o achado correspondente sai com peso_aplicado 0
//    (informativo) para não contar a nota duas vezes.
//  - "Duas leituras seguidas" (int2-hash-versao-estavel, int2-conteudo-instavel-fora-da-nota e o instavel de
//    int2-valor-muda-entre-versoes) dependem de ctx.paginas[i].leitura2 = { cru:{hash,html?}, final:{extr} }.
//    lib/ler-pagina.mjs ainda lê só uma vez; sem leitura2 esses detectores devolvem null.
//  - int2-fato-sem-evidencia-descartado depende de ctx.verificacao.descartados (o verificador roda DEPOIS do motor);
//    sem isso devolve null.
//  - Limites conhecidos do extrator: o seletor de um nó pode começar em #id (perde os ancestrais), então "main" e
//    "área de login" são aproximados por tags no caminho do seletor; o extrator não registra elementos video/canvas.
import { CONTAGENS } from '../verificador.mjs';
import { compararVersoes } from '../diff-versoes.mjs';
import { extrairNumeros, normalizarTexto, normalizarUrl, paraNumero } from '../util.mjs';
import { podeRastrear } from '../robots.mjs';

// ---------- utilitários ----------
const NOME_VERSAO = { cru: 'no HTML cru', dom250: 'aos 250 ms', final: 'na página final' };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const nada = () => ({ disparou: false, intensidade: 0, achados: [] });
const disparo = (achados, intensidade = 1) => (achados.length ? { disparou: true, intensidade: clamp01(intensidade), achados } : nada());
const extrDe = (p, v) => (p && p[v] && p[v].extr) || null;
const paginasCom = (ctx, versoes) => ((ctx && ctx.paginas) || []).filter((p) => versoes.every((v) => extrDe(p, v)));
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const semHash = (url) => { try { const u = new URL(url); u.hash = ''; return u.toString(); } catch { return String(url); } };
const hostDe = (url) => { try { return new URL(url).host; } catch { return null; } };
const cortar = (s, n = 100) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) : t; };
const fmtRazao = (r) => String(Math.round(r * 100) / 100).replace('.', ',');
const numerosDe = (...textos) => [...new Set(textos.flatMap((t) => extrairNumeros(t)).map(String))];
const palavras = (t) => String(t ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const ehVisivelNaoClone = (n) => n.visivel === true && n.clone !== true;
const tokens = (s) => String(s ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const pl = (n, singular, plural) => (n === 1 ? singular : plural);
const lista = (itens) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`);

// evidência sem campos vazios (o schema de achado não aceita null)
const ev = (o) => {
  const r = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === '') continue;
    r[k] = k === 'trecho' ? String(v).slice(0, 200) : v;
  }
  return r;
};
const citTrecho = (valor, { onde = 'visivel', versoes = ['final'], pagina } = {}) => ({ tipo: 'trecho', valor, onde, versoes, ...(pagina ? { pagina } : {}) });
const citNumero = (valor, { onde = 'visivel', versoes = ['final'], pagina } = {}) => ({ tipo: 'numero', valor, onde, versoes, ...(pagina ? { pagina } : {}) });
const citContagem = (fn, esperado, { versoes = ['final'], pagina, ...extra } = {}) => ({ tipo: 'contagem', contagem: { fn, esperado, ...extra }, versoes, ...(pagina ? { pagina } : {}) });
const contar = (fn, extr, extra = {}) => CONTAGENS[fn](extr, extra);

// citação que sempre existe na página: o título (no HTML) ou, sem título, a contagem de imagens
function citacaoBase(p) {
  const versao = extrDe(p, 'final') ? 'final' : 'cru';
  const extr = extrDe(p, versao);
  if (extr && extr.titulo) return citTrecho(extr.titulo, { onde: 'html', versoes: [versao], pagina: p.url });
  return citContagem('imagens', contar('imagens', extr), { versoes: [versao], pagina: p.url });
}

// caminho do seletor (ex.: "body>main>section>p:nth-of-type(2)")
const segs = (sel) => String(sel || '').split('>');
const tagDoSeg = (s) => (s.startsWith('#') ? null : s.replace(/:nth-of-type\(\d+\)$/, ''));
const dentroDe = (sel, tags) => segs(sel).some((s) => tags.includes(tagDoSeg(s)));

const dadosDoMedidor = (med, id) => { const m = med && med[id]; return m && !m.erro && m.dados ? m.dados : null; };

// ============================================================================================
// IA-VISIBILIDADE
// ============================================================================================

// ---------- robots.txt / llms.txt (medidor robots-ia) ----------
const AGENTES_PADRAO = {
  treino: [{ agente: 'GPTBot', empresa: 'OpenAI' }, { agente: 'ClaudeBot', empresa: 'Anthropic' }, { agente: 'Google-Extended', empresa: 'Google', observacao: 'é um token do robots.txt, não um rastreador separado; controla o uso no treino e na fundamentação do Gemini e não afeta o Google Search' }],
  busca: [{ agente: 'OAI-SearchBot', empresa: 'OpenAI' }, { agente: 'Claude-SearchBot', empresa: 'Anthropic' }, { agente: 'PerplexityBot', empresa: 'Perplexity', observacao: 'indexa para os resultados de busca e, segundo a empresa, não é usado para treinar modelos' }],
  consulta_pelo_usuario: [{ agente: 'ChatGPT-User', empresa: 'OpenAI', observacao: 'a OpenAI diz que regras do robots.txt podem não valer, porque a visita é pedida por uma pessoa' }, { agente: 'Claude-User', empresa: 'Anthropic' }, { agente: 'Perplexity-User', empresa: 'Perplexity', observacao: 'a empresa diz que em geral ignora o robots.txt por ser uma ação pedida por uma pessoa' }],
};
const TITULO_GRUPO = {
  treino: 'Treino (conteúdo usado para treinar modelos de IA)',
  busca: 'Busca (ajuda a achar páginas para mostrar em respostas de IA)',
  consulta_pelo_usuario: 'Consulta pedida por uma pessoa (a IA abre a página quando alguém pergunta)',
};

function estadoDoRastreador(r) {
  if (r.situacao === 'indeterminado') return 'situação indeterminada (o robots.txt respondeu com erro do servidor)';
  const restr = r.restricoes || { disallow: [], allow: [] };
  if (r.situacao === 'bloqueado') return r.parcial ? `barrado na raiz, com exceções liberadas (Allow: ${restr.allow.join(', ')})` : 'barrado por completo';
  if (r.parcial) return `barrado em partes (Disallow: ${restr.disallow.join(', ')})`;
  if (/sem robots\.txt/.test(r.grupo || '')) return 'sem robots.txt (permitido por padrão)';
  if (r.origemDoGrupo === 'especifico') return 'permitido de forma explícita';
  return 'sem regra própria (permitido por padrão)';
}

// ---------- JSON-LD / limites de trecho / estrutura ----------
function diretivasDe(conteudo) {
  const r = { nosnippet: false, maxSnippet: null };
  for (let parte of String(conteudo ?? '').toLowerCase().split(',')) {
    parte = parte.trim();
    const m = parte.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
    if (m && !/^(max-|unavailable_after|nosnippet|noindex|nofollow|none|noarchive|notranslate|noimageindex)/.test(m[1])) parte = m[2].trim(); // "googlebot: nosnippet"
    if (parte === 'nosnippet') r.nosnippet = true;
    const ms = parte.match(/^max-snippet\s*:\s*(-?\d+)$/);
    if (ms) r.maxSnippet = Number(ms[1]);
  }
  return r;
}

const limparHtml = (html) => String(html ?? '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
  .replace(/<style\b[\s\S]*?<\/style\s*>/gi, '')
  .replace(/<template\b[\s\S]*?<\/template\s*>/gi, '');
const contarTag = (html, tag) => (html.match(new RegExp(`<${tag}(?=[\\s>/])`, 'gi')) || []).length;
const contarDataNosnippet = (html) => (limparHtml(html).match(/<[a-z][^>]*\sdata-nosnippet(?=[\s=>/])/gi) || []).length;

// ---------- texto principal ----------
const SO_NUMERO_OU_PRECO = /^\s*(?:r\$|us\$|€|\$)?\s*[\d.,:\s%]+\s*(?:\/\s*\w+)?$/i;
function nosDoTextoPrincipal(extr) {
  // aproximação do "texto principal": visível, fora de nav/header/footer/aside, sem contadores e preços soltos
  return (extr.nos || []).filter(ehVisivelNaoClone)
    .filter((n) => !dentroDe(n.seletor, ['nav', 'header', 'footer', 'aside']))
    .filter((n) => /\p{L}/u.test(n.texto) && !SO_NUMERO_OU_PRECO.test(n.texto));
}
const ehBloco = (n) => ['h1', 'h2', 'h3', 'p'].includes(n.tag);

// citações "ocorrências visíveis" do mesmo texto no cru e no final: provam presença/ausência por versão
function citacoesDeBlocos(p, blocos, versoes) {
  const cit = [];
  for (const b of blocos.slice(0, 3)) {
    const texto = cortar(b.texto, 120);
    for (const v of versoes) cit.push(citContagem('ocorrencias-visiveis', contar('ocorrencias-visiveis', extrDe(p, v), { texto }), { versoes: [v], pagina: p.url, texto }));
  }
  return cit;
}

// ---------- links internos únicos ----------
function linksInternosUnicos(extr, p) {
  const hosts = new Set([hostDe(p.url), hostDe(extr.url && extr.url !== 'about:blank' ? extr.url : p.url), hostDe(p.final && p.final.extr && p.final.extr.url)].filter(Boolean));
  const mapa = new Map();
  for (const l of extr.links || []) {
    if (l.clone) continue;
    const ha = String(l.hrefAttr ?? '').trim();
    if (!ha || ha.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(ha)) continue;
    const u = normalizarUrl(ha, p.url); // não usa l.interno: no HTML cru o extrator lê sem base (about:blank)
    if (!u || !hosts.has(hostDe(u))) continue;
    if (!mapa.has(u)) mapa.set(u, ha);
  }
  return mapa; // url -> href como escrito
}

// ---------- robots.txt do Googlebot a partir do grupo curinga medido ----------
function grupoCuringa(d) {
  const r = d.robots;
  if (!r || !r.presente) return { estado: 'ausente' };
  const declarados = (r.agentesDeclarados || []).map((a) => String(a).toLowerCase()).filter(Boolean);
  if (declarados.some((a) => a !== '*' && 'googlebot'.includes(a))) return { estado: 'desconhecido' }; // há grupo próprio do Googlebot, não medido
  const rs = d.rastreadores || [];
  const curinga = rs.find((x) => x.origemDoGrupo === 'curinga');
  if (curinga) return { estado: 'ok', disallow: curinga.restricoes.disallow || [], allow: curinga.restricoes.allow || [] };
  if (rs.some((x) => /^sem regra/.test(x.grupo || ''))) return { estado: 'ok', disallow: [], allow: [] }; // não há grupo "*"
  return { estado: 'desconhecido' };
}
const robotsSintetico = (disallow, allow) => ({ grupos: [{ agentes: ['*'], regras: [...disallow.map((c) => ({ tipo: 'disallow', caminho: c })), ...allow.map((c) => ({ tipo: 'allow', caminho: c }))] }], sitemaps: [] });

// ============================================================================================
// INTEGRIDADE: valores (preço, desconto) e contêineres
// ============================================================================================
const RE_PRECO = /R\$\s?\d+(?:\.\d{3})*(?:,\d{1,2})?/gi;
const RE_PCT = /\d+(?:[.,]\d+)?\s?%/g;
const valoresDe = (texto, re, limpar) => [...String(texto ?? '').matchAll(re)].map((m) => paraNumero(limpar(m[0]))).filter(Number.isFinite);
const precosDe = (t) => valoresDe(t, RE_PRECO, (s) => s.replace(/R\$\s?/i, ''));
const pctsDe = (t) => valoresDe(t, RE_PCT, (s) => s.replace(/\s?%/, ''));
const RELATIVO = /\bh[áa]\s+\d+|\b\d+\s*(?:s|seg|segundos?|min|minutos?|h|horas?|dias?|semanas?|meses?|anos?)\s+atr[áa]s|\b\d{1,2}:\d{2}(?::\d{2})?\b|\bagora\b|\bhoje\b|\bontem\b/i;

// dois nós estão no "mesmo contêiner" se têm o mesmo pai, um pai é o avô do outro, ou são primos (mesmos avós, caminho com 3+ níveis)
function mesmoConteiner(a, b) {
  const pa = segs(a).slice(0, -1), pb = segs(b).slice(0, -1);
  if (!pa.length || !pb.length) return false;
  const ja = pa.join('>'), jb = pb.join('>');
  if (ja === jb) return true;
  if (pa.length === pb.length + 1 && ja.startsWith(jb + '>')) return true;
  if (pb.length === pa.length + 1 && jb.startsWith(ja + '>')) return true;
  return pa.length === pb.length && pa.length >= 3 && pa.slice(0, -1).join('>') === pb.slice(0, -1).join('>');
}

// último nó (não clone, com dígitos, até 60 caracteres) com o seletor: mesma regra de indexação do diff-versoes
function noDeLeitura(extr, seletor) {
  const nos = (extr && extr.nos) || [];
  for (let i = nos.length - 1; i >= 0; i--) {
    const n = nos[i];
    if (n.seletor === seletor && !n.clone && /\d/.test(n.texto) && n.texto.length <= 60) return n;
  }
  return null;
}

// diferenças de valor entre as versões de uma página (visíveis no final; horas/datas relativas ignoradas)
function diferencasDaPagina(p) {
  const l = { cru: extrDe(p, 'cru'), dom250: extrDe(p, 'dom250'), final: extrDe(p, 'final') };
  if (!l.final || !(l.cru || l.dom250)) return [];
  return compararVersoes(l).filter((d) => d.visivelNoFinal && !d.versoes.some((v) => RELATIVO.test(d.leituras[v])));
}
function ehContador(d) {
  const f = d.numeros.final;
  if (!f || f.length !== 1 || !(f[0] > 0)) return false;
  return ['cru', 'dom250'].some((v) => d.numeros[v] && d.numeros[v].length === 1 && d.numeros[v][0] < f[0]);
}
// "o final difere em duas leituras seguidas": compara com leitura2 (se existir)
function instavelNaLeitura2(p, seletor) {
  const e2 = p.leitura2 && p.leitura2.final && p.leitura2.final.extr;
  if (!e2) return false;
  const a = noDeLeitura(extrDe(p, 'final'), seletor), b = noDeLeitura(e2, seletor);
  return !!(a && b && normalizarTexto(a.texto) !== normalizarTexto(b.texto));
}
function citacoesDeLeituras(p, d) {
  const cit = [];
  for (const v of d.versoes) {
    const no = noDeLeitura(extrDe(p, v), d.seletor);
    // número desenhado por CSS (::after com attr(data-now)) existe no HTML como atributo, não como texto visível
    const onde = d.viaCss && d.viaCss.includes(v) ? 'html' : no && no.visivel ? 'visivel' : 'qualquer';
    cit.push(citTrecho(d.leituras[v], { onde, versoes: [v], pagina: p.url }));
    if (d.numeros[v].length === 1) cit.push(citNumero(d.numeros[v][0], { onde, versoes: [v], pagina: p.url }));
  }
  return cit;
}
function evidenciasDeLeituras(p, d) {
  return d.versoes.map((v) => {
    const no = noDeLeitura(extrDe(p, v), d.seletor);
    return ev({ pagina: caminhoDe(p.url), versao: v, seletor: d.seletor, trecho: d.leituras[v], valor: d.numeros[v].length === 1 ? d.numeros[v][0] : d.numeros[v].join(' | '), visivel: no ? !!no.visivel : undefined });
  });
}
// números que aparecem na mensagem sem vir do site: dígitos do seletor e os 250 ms da leitura rápida
const permitidosDaDiferenca = (d) => [...new Set([...numerosDe(d.seletor), ...(d.versoes.includes('dom250') ? ['250'] : [])])];
const partesDeLeituras = (d) => d.versoes.map((v) => `${NOME_VERSAO[v]} "${d.leituras[v]}"`);

// ============================================================================================
export const detectores = {
  // ---------------------------------------------------------------- ia-visibilidade
  'ia-llms-txt-informativo': ({ ctx, med, regra }) => {
    const d = dadosDoMedidor(med, 'robots-ia');
    if (!d || !d.llms) return null;
    if (!d.llms.presente) return nada();
    const l = d.llms;
    const fixo = (regra && regra.deteccao && regra.deteccao.parametros && regra.deteccao.parametros.texto_fixo) || 'O Google Search diz que llms.txt não é necessário e não ajuda nem prejudica; o arquivo pode servir a outros serviços.';
    return disparo([{
      pagina: ctx.site.urlInicial,
      mensagem: `O site tem um arquivo llms.txt na raiz (${l.linhas} linhas com texto, ${l.bytes} bytes). ${fixo} Aqui só registramos que ele existe: não dá nota e não pede mudança.`,
      evidencias: [ev({ pagina: '/llms.txt', versao: 'cru', trecho: l.tituloMarkdown, valor: `${l.bytes} bytes`, contagem: l.linhas })],
      citacoes: [], // arquivo externo: não existe em ctx.paginas; selo "regra"
    }], 0.1);
  },

  'ia-rastreadores-robots-informativo': ({ ctx, med, regra }) => {
    const d = dadosDoMedidor(med, 'robots-ia');
    if (!d || !Array.isArray(d.rastreadores)) return null;
    const robotsLido = d.robots && d.robots.presente;
    if (!robotsLido && !d.rastreadores.some((r) => r.situacao === 'indeterminado')) return nada(); // sem robots.txt não há o que informar
    const params = regra && regra.deteccao && regra.deteccao.parametros && regra.deteccao.parametros.agentes;
    const grupos = Object.entries(params || AGENTES_PADRAO);
    const partes = [];
    const evidencias = [];
    for (const [chave, itens] of grupos) {
      const linhas = [];
      for (const it of itens) {
        const r = d.rastreadores.find((x) => String(x.userAgent).toLowerCase() === String(it.agente).toLowerCase());
        if (!r) continue;
        const estado = estadoDoRastreador(r);
        linhas.push(`${it.agente} (${it.empresa}) ${estado}${it.observacao ? ` [${it.observacao}]` : ''}`);
        evidencias.push(ev({ pagina: '/robots.txt', versao: 'cru', trecho: `${it.agente}: ${estado}; ${r.grupo}`, valor: r.situacao }));
      }
      if (linhas.length) partes.push(`${TITULO_GRUPO[chave] || chave}: ${linhas.join('; ')}.`);
    }
    if (!partes.length) return nada();
    return disparo([{
      pagina: ctx.site.urlInicial,
      mensagem: `O que o robots.txt diz sobre os rastreadores de IA. ${partes.join(' ')} Aqui só informamos o que está escrito, separando treino de busca e consulta; a decisão sobre cada rastreador é sua.`,
      evidencias,
      citacoes: [], // robots.txt não está em ctx.paginas; selo "regra"
    }], 0.1);
  },

  'ia-conteudo-no-html-cru': ({ ctx, regra }) => {
    const paginas = paginasCom(ctx, ['cru', 'final']);
    if (!paginas.length) return null;
    const limiar = regra?.deteccao?.parametros?.alerta_se_razao_menor_que ?? 0.5;
    const achados = [];
    let pior = 0;
    for (const p of paginas) {
      const cru = extrDe(p, 'cru'), fin = extrDe(p, 'final');
      const nosFinal = nosDoTextoPrincipal(fin);
      const nosCru = nosDoTextoPrincipal(cru);
      const palavrasFinal = nosFinal.reduce((s, n) => s + palavras(n.texto), 0);
      const palavrasCru = nosCru.reduce((s, n) => s + palavras(n.texto), 0) + (cru.noscript || []).reduce((s, t) => s + palavras(t), 0); // noscript conta como presente no cru
      if (palavrasFinal === 0) continue;
      const razao = Math.min(1, palavrasCru / palavrasFinal);
      if (!(razao < limiar)) continue;
      const textosCru = new Set((cru.nos || []).filter(ehVisivelNaoClone).map((n) => normalizarTexto(n.texto)));
      const soNoFinal = nosFinal.filter((n) => !textosCru.has(normalizarTexto(n.texto)));
      const blocos = soNoFinal.filter(ehBloco);
      const amostra = (blocos.length ? blocos : soNoFinal).filter((n) => n.texto.length >= 8).sort((a, b) => (/^h/.test(b.tag) ? 1 : 0) - (/^h/.test(a.tag) ? 1 : 0)).slice(0, 3);
      const citacoes = citacoesDeBlocos(p, amostra, ['cru', 'final']);
      if (!citacoes.length) citacoes.push(citacaoBase(p));
      const cam = caminhoDe(p.url);
      pior = Math.max(pior, 1 - razao);
      achados.push({
        pagina: p.url,
        mensagem: `Só parte do texto principal está no HTML que o servidor envia. Palavras do texto principal: ${palavrasCru} no HTML cru e ${palavrasFinal} na página final (razão ${fmtRazao(razao)}). Títulos e parágrafos que só aparecem depois do JavaScript: ${blocos.length}. Rastreadores que não executam JavaScript podem não ver esse conteúdo; o Google executa JavaScript.`,
        evidencias: [
          ev({ pagina: cam, versao: 'cru', seletor: 'texto principal', valor: 'palavras no HTML cru', contagem: palavrasCru }),
          ev({ pagina: cam, versao: 'final', seletor: 'texto principal', valor: 'palavras na página final', contagem: palavrasFinal }),
          ev({ pagina: cam, seletor: 'texto principal', valor: `razão ${fmtRazao(razao)}` }),
          ev({ pagina: cam, versao: 'final', seletor: 'h1, h2, h3, p', valor: 'títulos e parágrafos só no final', contagem: blocos.length }),
          ...amostra.map((n) => ev({ pagina: cam, versao: 'final', seletor: n.seletor, trecho: n.texto, visivel: true })),
        ],
        citacoes,
        numeros_permitidos: numerosDe(...amostra.map((n) => n.texto)),
      });
    }
    return disparo(achados, pior);
  },

  'ia-links-internos-so-com-javascript': ({ ctx, regra }) => {
    const paginas = paginasCom(ctx, ['cru', 'final']);
    if (!paginas.length) return null;
    const par = regra?.deteccao?.parametros || {};
    const limiar = par.alerta_se_razao_menor_que ?? 0.5;
    const minimo = par.minimo_de_links_no_final ?? 5;
    const achados = [];
    let pior = 0;
    for (const p of paginas) {
      const uCru = linksInternosUnicos(extrDe(p, 'cru'), p), uFinal = linksInternosUnicos(extrDe(p, 'final'), p);
      if (uFinal.size < minimo) continue;
      const razao = uCru.size / uFinal.size;
      if (!(razao < limiar)) continue;
      const soNoFinal = [...uFinal.entries()].filter(([u]) => !uCru.has(u));
      const cam = caminhoDe(p.url);
      const citacoes = [
        citContagem('links', contar('links', extrDe(p, 'cru')), { versoes: ['cru'], pagina: p.url }),
        citContagem('links', contar('links', extrDe(p, 'final')), { versoes: ['final'], pagina: p.url }),
      ];
      if (soNoFinal.length) citacoes.push(citTrecho(soNoFinal[0][1], { onde: 'html', versoes: ['final'], pagina: p.url }));
      pior = Math.max(pior, 1 - razao);
      achados.push({
        pagina: p.url,
        mensagem: `Links internos únicos: ${uCru.size} no HTML cru e ${uFinal.size} na página final. O menu e os links entre páginas dependem do JavaScript para aparecer, e quem lê só o HTML cru não consegue seguir para as outras páginas.`,
        evidencias: [
          ev({ pagina: cam, versao: 'cru', seletor: 'a[href]', valor: 'links internos únicos', contagem: uCru.size }),
          ev({ pagina: cam, versao: 'final', seletor: 'a[href]', valor: 'links internos únicos', contagem: uFinal.size }),
          ...soNoFinal.slice(0, 3).map(([, ha]) => ev({ pagina: cam, versao: 'final', seletor: 'a[href]', trecho: ha, valor: 'só no final' })),
        ],
        citacoes,
        numeros_permitidos: numerosDe(...soNoFinal.slice(0, 3).map(([, ha]) => ha)),
      });
    }
    return disparo(achados, pior);
  },

  'ia-recursos-bloqueados-no-robots-txt': ({ ctx, med }) => {
    const d = dadosDoMedidor(med, 'robots-ia');
    if (!d || !d.robots) return null;
    const g = grupoCuringa(d);
    if (g.estado === 'desconhecido') return null; // sem como saber as regras do Googlebot a partir do que foi medido
    if (g.estado === 'ausente') return nada();
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const robots = robotsSintetico(g.disallow, g.allow);
    const jaRelatados = new Set();
    const achados = [];
    for (const p of paginas) {
      const hosts = new Set([hostDe(p.url), hostDe(extrDe(p, 'final').url)].filter(Boolean));
      const recursos = new Map(); // url -> { attr, versoes:Set }
      for (const v of ['cru', 'final']) {
        const e = extrDe(p, v);
        if (!e) continue;
        const brutos = [...(e.scripts || []).map((s) => s.src), ...(e.folhas || [])].filter(Boolean);
        for (const attr of brutos) {
          let u; try { u = new URL(attr, p.url); } catch { continue; }
          if (!/^https?:$/.test(u.protocol) || !hosts.has(u.host)) continue;
          if (!recursos.has(u.href)) recursos.set(u.href, { attr, caminho: u.pathname + u.search, versoes: new Set() });
          recursos.get(u.href).versoes.add(v);
        }
      }
      const barrados = [];
      for (const [href, r] of recursos) {
        if (jaRelatados.has(href) || podeRastrear(robots, 'Googlebot', r.caminho)) continue;
        const regraQueBarra = g.disallow.find((x) => !podeRastrear(robotsSintetico([x], []), 'Googlebot', r.caminho));
        jaRelatados.add(href);
        barrados.push({ ...r, href, regraQueBarra });
      }
      if (!barrados.length) continue;
      achados.push({
        pagina: p.url,
        mensagem: `O robots.txt impede o Googlebot de ler ${barrados.length} ${pl(barrados.length, 'arquivo que monta', 'arquivos que montam')} a página (scripts ou estilos do próprio site): ${lista(barrados.map((b) => b.caminho))}. Sem eles, o Google pode não conseguir exibir o conteúdo como você vê.`,
        evidencias: [
          ev({ pagina: '/robots.txt', versao: 'cru', valor: 'arquivos da página barrados para o Googlebot', contagem: barrados.length }),
          ...barrados.map((b) => ev({ pagina: '/robots.txt', versao: 'cru', trecho: b.regraQueBarra ? `Disallow: ${b.regraQueBarra}` : undefined, valor: b.caminho })),
        ],
        citacoes: barrados.map((b) => citTrecho(b.attr, { onde: 'html', versoes: [...b.versoes], pagina: p.url })),
        numeros_permitidos: numerosDe(...barrados.map((b) => b.caminho)),
      });
    }
    return disparo(achados, 1);
  },

  // misto: o script só lista candidatas; o modelo olha a captura de tela e julga.
  'ia-informacao-chave-so-em-imagem-ou-video': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const fin = extrDe(p, 'final');
      const nos = (fin.nos || []).filter(ehVisivelNaoClone);
      const candidatas = [];
      for (const img of fin.imagens || []) {
        if (!img.visivel || img.clone) continue;
        if (!(img.renderW >= 200 && img.renderW * img.renderH >= 40000)) continue; // "grande" (heurística nossa)
        const pai = segs(img.seletor).slice(0, -1).join('>');
        const aoRedor = pai ? nos.filter((n) => n.seletor.startsWith(pai + '>')) : [];
        const palavrasAoRedor = aoRedor.reduce((s, n) => s + palavras(n.texto), 0);
        const altDescritivo = img.alt !== null && palavras(img.alt) >= 3;
        if (palavrasAoRedor < 5 && !altDescritivo) candidatas.push({ img, palavrasAoRedor });
      }
      if (!candidatas.length) continue;
      const cam = caminhoDe(p.url);
      const lim = candidatas.slice(0, 12); // máximo para o modelo (parâmetro da regra)
      const comAlt = lim.find((c) => c.img.alt);
      achados.push({
        pagina: p.url,
        mensagem: `Para conferir: ${candidatas.length} ${pl(candidatas.length, 'imagem grande tem', 'imagens grandes têm')} quase nenhum texto por perto e nenhuma descrição (alt) que explique o conteúdo. Se houver preço, prazo, oferta ou promessa escrita dentro delas, essa informação não pode ser lida como texto. O script não lê texto dentro de imagens: esta é só a lista de candidatas para o modelo olhar na captura de tela.`,
        evidencias: [
          ev({ pagina: cam, versao: 'final', seletor: 'img', valor: 'imagens grandes sem texto por perto', contagem: candidatas.length }),
          ...lim.map((c) => ev({ pagina: cam, versao: 'final', seletor: c.img.seletor, trecho: c.img.alt || c.img.src, valor: `${c.img.renderW}x${c.img.renderH}`, contagem: c.palavrasAoRedor, visivel: true })),
        ],
        citacoes: [
          citContagem('imagens', contar('imagens', fin), { versoes: ['final'], pagina: p.url }),
          citTrecho(comAlt ? comAlt.img.alt : '<img', { onde: 'html', versoes: ['final'], pagina: p.url }),
        ],
        numeros_permitidos: numerosDe(...lim.map((c) => `${c.img.renderW} ${c.img.renderH}`)),
      });
    }
    return disparo(achados, 0.3);
  },

  'ia-limite-de-trechos-informativo': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['cru']).concat(paginasCom(ctx, ['final']).filter((p) => !extrDe(p, 'cru')));
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const cam = caminhoDe(p.url);
      const itens = [], evidencias = [], citacoes = [];
      const achou = new Map(); // descrição -> Set(versões)
      const marcar = (desc, v) => { if (!achou.has(desc)) achou.set(desc, new Set()); achou.get(desc).add(v); };
      for (const v of ['cru', 'final']) {
        const e = extrDe(p, v);
        if (!e) continue;
        for (const m of e.metas || []) {
          const nome = String(m.nome || '').toLowerCase();
          if (nome !== 'robots' && nome !== 'googlebot') continue;
          const dir = diretivasDe(m.conteudo);
          if (dir.nosnippet) marcar(`nosnippet no meta ${nome}`, v);
          if (dir.maxSnippet !== null) marcar(`max-snippet:${dir.maxSnippet}${dir.maxSnippet === 0 ? ' (zero: nenhum trecho)' : ''} no meta ${nome}`, v);
          if (dir.nosnippet || dir.maxSnippet !== null) {
            evidencias.push(ev({ pagina: cam, versao: v, seletor: `meta[name="${nome}"]`, trecho: m.conteudo, valor: dir.nosnippet ? 'nosnippet' : `max-snippet:${dir.maxSnippet}` }));
            citacoes.push(citTrecho(m.conteudo, { onde: 'html', versoes: [v], pagina: p.url }));
          }
        }
        const bloco = p[v];
        const n = contarDataNosnippet(bloco.html);
        if (n > 0) {
          marcar('data-nosnippet em trechos do texto', v);
          evidencias.push(ev({ pagina: cam, versao: v, seletor: '[data-nosnippet]', valor: 'elementos com data-nosnippet', contagem: n }));
          citacoes.push(citTrecho('data-nosnippet', { onde: 'html', versoes: [v], pagina: p.url }));
        }
      }
      const cab = String((p.cru && p.cru.cabecalhos && p.cru.cabecalhos['x-robots-tag']) || '');
      if (cab) {
        const dir = diretivasDe(cab);
        if (dir.nosnippet || dir.maxSnippet !== null) {
          marcar(`${dir.nosnippet ? 'nosnippet' : `max-snippet:${dir.maxSnippet}`} no cabeçalho X-Robots-Tag`, 'cru');
          evidencias.push(ev({ pagina: cam, versao: 'cru', seletor: 'X-Robots-Tag', trecho: cab, valor: dir.nosnippet ? 'nosnippet' : `max-snippet:${dir.maxSnippet}` })); // cabeçalho: só evidência
        }
      }
      for (const [desc, vs] of achou) itens.push(`${desc} (${[...vs].map((v) => NOME_VERSAO[v]).join(' e ')})`);
      if (!itens.length) continue;
      achados.push({
        pagina: p.url,
        mensagem: `Esta página usa controles de trecho do Google: ${lista(itens)}. Eles limitam quanto texto o Google pode mostrar, inclusive nos recursos de IA, e podem ser de propósito. Aqui só informamos o que foi encontrado; a decisão é sua.`,
        evidencias,
        citacoes,
      });
    }
    return disparo(achados, 0.1);
  },

  'ia-estrutura-semantica-fraca': ({ ctx, regra }) => {
    const paginas = paginasCom(ctx, ['cru']);
    if (!paginas.length) return null;
    const semanticos = regra?.deteccao?.parametros?.semanticos || ['main', 'nav', 'header', 'footer', 'article', 'section', 'h1', 'h2', 'h3', 'ul', 'ol', 'table', 'p'];
    const achados = [];
    for (const p of paginas) {
      const html = limparHtml(p.cru.html);
      const n = (tag) => contarTag(html, tag);
      const temRoleMain = /\srole\s*=\s*["']?main(?=["'\s>/])/i.test(html);
      const titulos = n('h1') + n('h2') + n('h3');
      const regioes = n('main') + n('article') + (temRoleMain ? 1 : 0);
      if (titulos > 0 || regioes > 0) continue;
      const totalSemanticos = semanticos.reduce((s, t) => s + n(t), 0);
      const divs = n('div'), spans = n('span');
      const cam = caminhoDe(p.url);
      const cru = extrDe(p, 'cru');
      const compara = divs + spans > 0 ? `, contra ${divs} div e ${spans} span` : '';
      achados.push({
        pagina: p.url,
        mensagem: `O HTML cru quase não tem estrutura: nenhum título (h1 a h3) e nenhuma região principal (main ou article)${compara}. Páginas feitas só de div são mais difíceis de ler por máquinas e por leitores de tela; o Google diz que HTML semântico é recomendado, não obrigatório.`,
        evidencias: [
          ev({ pagina: cam, versao: 'cru', seletor: semanticos.join(', '), valor: 'elementos semânticos no HTML cru', contagem: totalSemanticos }),
          ev({ pagina: cam, versao: 'cru', seletor: 'div', contagem: divs }),
          ev({ pagina: cam, versao: 'cru', seletor: 'span', contagem: spans }),
          ev({ pagina: cam, versao: 'cru', seletor: 'h1, h2, h3, main, article', contagem: 0 }),
        ],
        citacoes: [
          cru && cru.titulo ? citTrecho(cru.titulo, { onde: 'html', versoes: ['cru'], pagina: p.url }) : citTrecho('<body', { onde: 'html', versoes: ['cru'], pagina: p.url }),
          citContagem('h1-visiveis', contar('h1-visiveis', cru), { versoes: ['cru'], pagina: p.url }),
        ],
      });
    }
    return disparo(achados, 0.4);
  },

  // ---------------------------------------------------------------- integridade
  'int2-valor-muda-entre-versoes': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']).filter((p) => extrDe(p, 'cru') || extrDe(p, 'dom250'));
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      for (const d of diferencasDaPagina(p).slice(0, 20)) {
        const contador = ehContador(d);
        achados.push({
          pagina: p.url,
          mensagem: `O valor do item ${d.seletor} muda conforme o momento da leitura: ${partesDeLeituras(d).join('; ')}. Quem lê rápido, ou uma ferramenta, pode ver um valor que não é o definitivo.${contador ? ' Este caso também aparece como contador animado.' : ''}`,
          evidencias: evidenciasDeLeituras(p, d),
          citacoes: citacoesDeLeituras(p, d),
          instavel: instavelNaLeitura2(p, d.seletor),
          numeros_permitidos: permitidosDaDiferenca(d),
          ...(contador ? { peso_aplicado: 0 } : {}), // já contado por int2-contador-animado-valor-errado
        });
      }
    }
    return disparo(achados, 0.4 + 0.2 * achados.length);
  },

  'int2-contador-animado-valor-errado': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']).filter((p) => extrDe(p, 'cru') || extrDe(p, 'dom250'));
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      for (const d of diferencasDaPagina(p).filter(ehContador).slice(0, 20)) {
        const inicial = Math.min(...['cru', 'dom250'].filter((v) => d.numeros[v] && d.numeros[v].length === 1).map((v) => d.numeros[v][0]));
        achados.push({
          pagina: p.url,
          mensagem: `O contador ${d.seletor} começa em ${inicial} e só chega a ${d.numeros.final[0]} depois da animação (${partesDeLeituras(d).join('; ')}). ${d.viaCss && d.viaCss.length ? 'O HTML já traz o valor final, o que ajuda leitor de tela e busca, mas na tela o número é desenhado por CSS e começa baixo. ' : ''}Quem olha uma captura rápida ou uma pré-visualização pode ver o número errado.`,
          evidencias: evidenciasDeLeituras(p, d),
          citacoes: citacoesDeLeituras(p, d),
          instavel: instavelNaLeitura2(p, d.seletor),
          numeros_permitidos: permitidosDaDiferenca(d),
        });
      }
    }
    return disparo(achados, 0.4 + 0.2 * achados.length);
  },

  'int2-clone-carrossel-ignorado': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const fin = extrDe(p, 'final');
      const n = contar('nos-clone', fin);
      if (!n) continue;
      const versoes = ['cru', 'dom250', 'final'].filter((v) => extrDe(p, v) && contar('nos-clone', extrDe(p, v)) === n); // só versões com a mesma contagem
      const cam = caminhoDe(p.url);
      const exemplos = (fin.nos || []).filter((x) => x.clone).slice(0, 3);
      achados.push({
        pagina: p.url,
        mensagem: `Blocos de texto de carrossel ignorados: ${n} (cópias marcadas com aria-hidden ou com classe de clone, que repetem um item visível). Eles não entram nas contagens de conteúdo, de preço nem de repetição de texto.`,
        evidencias: [
          ev({ pagina: cam, versao: 'final', seletor: '[aria-hidden="true"], [class*="clone"]', valor: 'nós de texto marcados como clone', contagem: n }),
          ...exemplos.map((x) => ev({ pagina: cam, versao: 'final', seletor: x.seletor, trecho: x.texto, valor: 'clone', visivel: x.visivel })),
        ],
        citacoes: [citContagem('nos-clone', n, { versoes, pagina: p.url })],
      });
    }
    return disparo(achados, 0.1);
  },

  'int2-texto-oculto-nao-e-visivel': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const fin = extrDe(p, 'final');
      const n = contar('nos-ocultos', fin);
      if (!n) continue;
      const cam = caminhoDe(p.url);
      const ocultos = (fin.nos || []).filter((x) => !x.visivel && !x.clone);
      const porMotivo = new Map();
      for (const x of ocultos) porMotivo.set(x.ocultoPor || 'oculto', (porMotivo.get(x.ocultoPor || 'oculto') || 0) + 1);
      const citacoes = [citContagem('nos-ocultos', n, { versoes: ['final'], pagina: p.url })];
      if (ocultos.length) citacoes.push(citTrecho(cortar(ocultos[0].texto, 120), { onde: 'html', versoes: ['final'], pagina: p.url })); // existe no código, não é visível
      achados.push({
        pagina: p.url,
        mensagem: `Trechos de texto ocultos (por exemplo com display:none, atributo hidden ou fora da tela): ${n}. Eles foram deixados de fora de qualquer afirmação sobre preço, oferta ou conteúdo visível e só são discutidos se divergirem do que o visitante lê.`,
        evidencias: [
          ev({ pagina: cam, versao: 'final', seletor: 'nós de texto ocultos', valor: 'ocultos (não visíveis ao visitante)', contagem: n }),
          ...[...porMotivo].map(([motivo, c]) => ev({ pagina: cam, versao: 'final', valor: motivo, contagem: c, visivel: false })),
          ...ocultos.slice(0, 5).map((x) => ev({ pagina: cam, versao: 'final', seletor: x.seletor, trecho: x.texto, valor: x.ocultoPor, visivel: false })),
        ],
        citacoes,
      });
    }
    return disparo(achados, 0.1);
  },

  'int2-oculto-diverge-do-visivel': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const fin = extrDe(p, 'final');
      const visiveis = (fin.nos || []).filter(ehVisivelNaoClone);
      const ocultos = (fin.nos || []).filter((n) => !n.visivel && !n.clone);
      const porVisivel = new Map(); // seletor do visível -> { no, itens:[{no, tipo}] }
      for (const [tipo, extrair] of [['preço', precosDe], ['desconto', pctsDe]]) {
        for (const h of ocultos) {
          const vh = extrair(h.texto);
          if (!vh.length) continue;
          for (const v of visiveis) {
            const vv = extrair(v.texto);
            if (!vv.length || !mesmoConteiner(h.seletor, v.seletor)) continue;
            if (!vh.some((x) => !vv.includes(x))) continue; // o oculto só repete valores do visível
            if (!porVisivel.has(v.seletor)) porVisivel.set(v.seletor, { no: v, itens: [] });
            const g = porVisivel.get(v.seletor);
            if (!g.itens.some((i) => i.no === h)) g.itens.push({ no: h, tipo });
          }
        }
      }
      const cam = caminhoDe(p.url);
      for (const { no: v, itens } of porVisivel.values()) {
        const mostrados = itens.slice(0, 4);
        const textoV = cortar(v.texto, 100);
        const citacoes = [citTrecho(textoV, { onde: 'visivel', versoes: ['final'], pagina: p.url })];
        for (const i of mostrados) {
          citacoes.push(citTrecho(cortar(i.no.texto, 100), { onde: 'html', versoes: ['final'], pagina: p.url }));
          const valores = i.tipo === 'preço' ? precosDe(i.no.texto) : pctsDe(i.no.texto);
          const base = i.tipo === 'preço' ? precosDe(v.texto) : pctsDe(v.texto);
          const diferente = valores.find((x) => !base.includes(x));
          if (diferente !== undefined) citacoes.push(citNumero(diferente, { onde: 'html', versoes: ['final'], pagina: p.url }));
        }
        achados.push({
          pagina: p.url,
          mensagem: `Inconsistência a conferir: o valor visível "${textoV}" convive com texto oculto que mostra outro valor (${mostrados.map((i) => `"${cortar(i.no.texto, 100)}"`).join('; ')}). Pode ser sobra de uma versão antiga do código. Não estamos afirmando que algum dos valores esteja errado, e o texto oculto não é o que o visitante lê.`,
          evidencias: [
            ev({ pagina: cam, versao: 'final', seletor: v.seletor, trecho: v.texto, valor: 'valor visível', visivel: true }),
            ...mostrados.map((i) => ev({ pagina: cam, versao: 'final', seletor: i.no.seletor, trecho: i.no.texto, valor: `valor oculto (${i.no.ocultoPor || 'oculto'})`, visivel: false })),
          ],
          citacoes,
          numeros_permitidos: numerosDe(v.seletor, ...mostrados.map((i) => i.no.seletor)),
        });
      }
    }
    return disparo(achados, 0.5);
  },

  'int2-contagem-recalculada': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['cru', 'final']);
    if (!paginas.length) return null;
    const metricas = [
      ['imagens', 'imagens'],
      ['imagens-lazy', 'imagens com carregamento lazy'],
      ['links', 'links'],
      ['jsonld-blocos', 'blocos de JSON-LD (um tipo de dado estruturado)'],
    ];
    const achados = [];
    for (const p of paginas) {
      const cru = extrDe(p, 'cru'), fin = extrDe(p, 'final');
      const linhas = metricas.map(([fn, nome]) => ({ fn, nome, cru: contar(fn, cru), final: contar(fn, fin) }));
      const dif = linhas.filter((m) => m.cru !== m.final);
      if (!dif.length) continue;
      const cam = caminhoDe(p.url);
      achados.push({
        pagina: p.url,
        mensagem: `Contagens recalculadas nas duas versões da página: ${dif.map((m) => `${m.nome}: ${m.cru} no HTML cru e ${m.final} na página final`).join('; ')}. A diferença sugere que o JavaScript acrescenta ou remove esses elementos depois do carregamento; cada número citado nesta página é recontado nas duas versões e mostrado lado a lado.`,
        evidencias: [
          ...linhas.flatMap((m) => [
            ev({ pagina: cam, versao: 'cru', seletor: m.fn, valor: m.nome, contagem: m.cru }),
            ev({ pagina: cam, versao: 'final', seletor: m.fn, valor: m.nome, contagem: m.final }),
          ]),
          ev({ pagina: cam, versao: 'cru', seletor: '[itemtype], [typeof]', valor: 'microdata e RDFa no HTML cru', contagem: (cru.microdata || []).length + (cru.rdfa || []).length }),
          ev({ pagina: cam, versao: 'final', seletor: '[itemtype], [typeof]', valor: 'microdata e RDFa na página final', contagem: (fin.microdata || []).length + (fin.rdfa || []).length }),
        ],
        citacoes: dif.flatMap((m) => [
          citContagem(m.fn, m.cru, { versoes: ['cru'], pagina: p.url }),
          citContagem(m.fn, m.final, { versoes: ['final'], pagina: p.url }),
        ]),
      });
    }
    return disparo(achados, 0.2);
  },

  'int2-preco-divergente-entre-paginas': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['final']);
    if (!paginas.length) return null;
    const IGNORAR = /\b(?:de|era)\s+R\$|\d\s*x\b|\bem\s+\d+\s*x|parcel|\/\s*m[eê]s|por\s+m[eê]s|a\s+partir\s+de/i; // riscado ("de"), parcelamento, faixas
    const porItem = new Map(); // título normalizado -> [{ p, titulo, precos:Set, amostras:[{valor, texto}] }]
    for (const p of paginas) {
      let titulo = null, tituloNorm = null;
      const itens = new Map();
      for (const n of extrDe(p, 'final').nos || []) {
        if (!ehVisivelNaoClone(n)) continue;
        if (/^h[1-6]$/.test(n.tag)) { titulo = n.texto; tituloNorm = normalizarTexto(n.texto); continue; }
        if (!tituloNorm || tituloNorm.length < 3 || IGNORAR.test(n.texto)) continue;
        const precos = precosDe(n.texto);
        if (!precos.length) continue;
        if (!itens.has(tituloNorm)) itens.set(tituloNorm, { p, titulo, precos: new Set(), amostras: [] });
        const it = itens.get(tituloNorm);
        for (const v of precos) if (!it.precos.has(v)) { it.precos.add(v); it.amostras.push({ valor: v, texto: n.texto, seletor: n.seletor }); }
      }
      for (const [k, it] of itens) { if (!porItem.has(k)) porItem.set(k, []); porItem.get(k).push(it); }
    }
    const achados = [];
    for (const [, entradas] of porItem) {
      if (entradas.length < 2) continue;
      const base = entradas[0];
      const outro = entradas.slice(1).find((o) => ![...o.precos].every((x) => base.precos.has(x)) && ![...base.precos].every((x) => o.precos.has(x))); // conjuntos que não se contêm
      if (!outro) continue;
      const a = base.amostras[0], b = outro.amostras[0];
      const camA = caminhoDe(base.p.url), camB = caminhoDe(outro.p.url);
      achados.push({
        pagina: base.p.url,
        mensagem: `O item "${base.titulo}" aparece com preços diferentes entre páginas: "${cortar(a.texto, 80)}" em ${camA} e "${cortar(b.texto, 80)}" em ${camB}. Pode ser plano diferente ou erro de edição; vale conferir.`,
        evidencias: [
          ev({ pagina: camA, versao: 'final', seletor: a.seletor, trecho: a.texto, valor: a.valor, visivel: true }),
          ev({ pagina: camB, versao: 'final', seletor: b.seletor, trecho: b.texto, valor: b.valor, visivel: true }),
        ],
        citacoes: [
          citTrecho(cortar(a.texto, 80), { onde: 'visivel', versoes: ['final'], pagina: base.p.url }),
          citTrecho(cortar(b.texto, 80), { onde: 'visivel', versoes: ['final'], pagina: outro.p.url }),
          citNumero(a.valor, { onde: 'visivel', versoes: ['final'], pagina: base.p.url }),
          citNumero(b.valor, { onde: 'visivel', versoes: ['final'], pagina: outro.p.url }),
        ],
        numeros_permitidos: numerosDe(camA, camB),
      });
    }
    return disparo(achados, 0.6);
  },

  // Roda ANTES do verificador: só informa quando alguém injeta o resultado dele em ctx.verificacao.
  'int2-fato-sem-evidencia-descartado': ({ ctx }) => {
    const desc = ctx && ctx.verificacao && ctx.verificacao.descartados;
    if (!Array.isArray(desc)) return null;
    if (!desc.length) return nada();
    const p = paginasCom(ctx, ['cru'])[0] || paginasCom(ctx, ['final'])[0];
    if (!p) return null;
    return disparo([{
      pagina: p.url,
      mensagem: `Achados descartados por falta de evidência verificável: ${desc.length} (citação que não existe no código, ou achado de selo fato sem nenhuma citação). Eles não aparecem como críticas; os motivos ficam registrados no relatório.`,
      evidencias: [
        ev({ pagina: '/', valor: 'achados descartados pelo verificador', contagem: desc.length }),
        ...desc.slice(0, 5).map((x) => ev({ pagina: '/', trecho: `${x.regra_id || ''}: ${x.motivo || ''}`, valor: 'descartado' })),
      ],
      citacoes: [citacaoBase(p)], // o dado vem do verificador (externo à página); cita-se algo que existe na página
    }], 0.1);
  },

  'int2-link-interno-quebrado': ({ ctx, med }) => {
    const d = dadosDoMedidor(med, 'links');
    if (!d || !d.verificacao) return null;
    const v = d.verificacao;
    const problemas = [
      ...(v.quebrados || []).filter((q) => q.interno && (q.status === 404 || q.status === 410 || q.status >= 500)).map((q) => ({ ...q, laco: false })),
      ...(v.semResposta || []).filter((q) => q.interno && /redirec/i.test(q.motivo || '')).map((q) => ({ ...q, status: null, laco: true })),
    ];
    const achados = [];
    for (const q of problemas.slice(0, 15)) {
      let achou = null;
      for (const cam of q.paginas || []) {
        const p = (ctx.paginas || []).find((x) => caminhoDe(x.url) === cam);
        const fin = p && extrDe(p, 'final');
        const l = fin && (fin.links || []).find((x) => ehVisivelNaoClone(x) && semHash(x.href) === q.url);
        if (l) { achou = { p, l, fin }; break; }
      }
      if (!achou) continue; // sem link visível correspondente não há como citar
      const { p, l, fin } = achou;
      const destino = caminhoDe(q.url);
      const o = l.texto ? `"${l.texto}"` : '(link sem texto)';
      achados.push({
        pagina: p.url,
        mensagem: `O link interno ${o} leva a ${destino}, ${q.laco ? 'que entra em laço de redirecionamento' : `que responde com o erro ${q.status}`}. O visitante cai em uma página que não existe ou que falha.`,
        evidencias: [ev({ pagina: caminhoDe(p.url), versao: 'final', seletor: l.seletor, trecho: l.texto, valor: `${q.url} -> ${q.laco ? 'laço de redirecionamento' : q.status}`, contagem: q.links, visivel: true })],
        citacoes: [
          citTrecho(l.hrefAttr, { onde: 'html', versoes: ['final'], pagina: p.url }),
          citContagem('links-com-texto', contar('links-com-texto', fin, { texto: l.texto }), { versoes: ['final'], pagina: p.url, texto: l.texto }),
        ],
        numeros_permitidos: numerosDe(destino, q.url),
      });
    }
    return disparo(achados, 0.6);
  },

  'int2-canonical-divergente': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['cru']).concat(paginasCom(ctx, ['final']).filter((p) => !extrDe(p, 'cru')));
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const alvos = [normalizarUrl(p.url), normalizarUrl((extrDe(p, 'final') || {}).url || '')].filter(Boolean);
      let temQuery = false; try { temQuery = new URL(p.url).search !== ''; } catch { /* url estranha */ }
      const paginada = temQuery || /\/(?:page|pagina)\/\d+/i.test(p.url); // paginação e filtros: canonical diferente é esperado
      const achou = new Map(); // tipo -> { vs:Set, hrefs:Set }
      const marcar = (tipo, v, href) => { if (!achou.has(tipo)) achou.set(tipo, { vs: new Set(), hrefs: new Set() }); achou.get(tipo).vs.add(v); achou.get(tipo).hrefs.add(href); };
      const primeiros = {};
      for (const v of ['cru', 'final']) {
        const e = extrDe(p, v);
        if (!e) continue;
        const cans = (e.linksHead || []).filter((l) => tokens(l.rel).includes('canonical') && l.href !== null && l.href !== undefined)
          .map((l) => { const href = String(l.href).trim(); let abs = null; try { abs = new URL(href, p.url).toString(); } catch { /* href inválido */ } return { href, abs, norm: abs ? normalizarUrl(abs) : null }; });
        if (!cans.length) continue;
        primeiros[v] = cans[0];
        if (new Set(cans.map((c) => c.norm || c.href)).size > 1) marcar('mais de um canonical com valores diferentes', v, cans.map((c) => c.href).join(' | '));
        for (const c of cans) {
          if (!/^https?:\/\//i.test(c.href)) marcar('canonical em formato relativo', v, c.href);
          if (c.href.includes('#')) marcar('canonical com fragmento (#)', v, c.href);
          if (c.norm && !alvos.includes(c.norm) && !paginada) marcar('canonical aponta para outra página', v, c.href);
        }
      }
      if (primeiros.cru && primeiros.final && (primeiros.cru.norm || primeiros.cru.href) !== (primeiros.final.norm || primeiros.final.href)) {
        marcar('canonical diferente entre o HTML cru e a página final', 'final', `${primeiros.cru.href} -> ${primeiros.final.href}`);
      }
      if (!achou.size) continue;
      const cam = caminhoDe(p.url);
      const itens = [...achou].map(([tipo, x]) => `${tipo} (${[...x.hrefs].join('; ')})`);
      const evidencias = [], citacoes = [];
      for (const v of ['cru', 'final']) {
        if (!primeiros[v]) continue;
        evidencias.push(ev({ pagina: cam, versao: v, seletor: 'link[rel="canonical"]', trecho: primeiros[v].href, valor: primeiros[v].abs || primeiros[v].href }));
        citacoes.push(citTrecho(primeiros[v].href, { onde: 'html', versoes: [v], pagina: p.url }));
      }
      achados.push({
        pagina: p.url,
        mensagem: `O link canonical desta página tem pontos a conferir: ${itens.join('; ')}. Pode ser intencional ou resto de uma cópia; confira se o endereço indicado é o que você quer que os buscadores tratem como principal.`,
        evidencias,
        citacoes,
      });
    }
    return disparo(achados, 0.5);
  },

  'int2-conteudo-depende-de-js': ({ ctx }) => {
    const paginas = paginasCom(ctx, ['cru', 'final']);
    if (!paginas.length) return null;
    const LIMIAR = 0.3, MIN_CHARS = 500; // parâmetros da regra (heurística nossa)
    const achados = [];
    let pior = 0;
    const util = (extr) => (extr.nos || []).filter(ehVisivelNaoClone).filter((n) => !dentroDe(n.seletor, ['form'])); // formulário ~ área de login
    for (const p of paginas) {
      const nosCru = util(extrDe(p, 'cru')), nosFinal = util(extrDe(p, 'final'));
      const charsCru = nosCru.reduce((s, n) => s + n.texto.length, 0), charsFinal = nosFinal.reduce((s, n) => s + n.texto.length, 0);
      if (charsFinal <= MIN_CHARS) continue;
      const razao = charsCru / charsFinal;
      if (!(razao < LIMIAR)) continue;
      const textosCru = new Set(nosCru.map((n) => normalizarTexto(n.texto)));
      const ausentes = nosFinal.filter((n) => !textosCru.has(normalizarTexto(n.texto)));
      const amostra = ausentes.filter((n) => n.texto.length >= 15).slice(0, 2);
      const citacoes = citacoesDeBlocos(p, amostra, ['cru', 'final']);
      if (!citacoes.length) citacoes.push(citacaoBase(p));
      const cam = caminhoDe(p.url);
      pior = Math.max(pior, (LIMIAR - razao) / LIMIAR);
      achados.push({
        pagina: p.url,
        mensagem: `Quase todo o texto visível só aparece depois do JavaScript. Caracteres de texto visível: ${charsCru} no HTML cru e ${charsFinal} na página final (razão ${fmtRazao(razao)}). Quem não executa JavaScript (alguns robôs e pré-visualizações) vê a página quase vazia.`,
        evidencias: [
          ev({ pagina: cam, versao: 'cru', seletor: 'texto visível', valor: 'caracteres no HTML cru', contagem: charsCru }),
          ev({ pagina: cam, versao: 'final', seletor: 'texto visível', valor: 'caracteres na página final', contagem: charsFinal }),
          ev({ pagina: cam, seletor: 'texto visível', valor: `razão ${fmtRazao(razao)}` }),
          ...ausentes.slice(0, 5).map((n) => ev({ pagina: cam, versao: 'final', seletor: n.seletor, trecho: n.texto, valor: 'ausente do HTML cru', visivel: true })),
        ],
        citacoes,
        numeros_permitidos: numerosDe(...amostra.map((n) => n.texto)),
      });
    }
    return disparo(achados, pior);
  },

  // Depende de uma segunda leitura do HTML cru (ctx.paginas[i].leitura2); sem ela não há como saber.
  'int2-hash-versao-estavel': ({ ctx }) => {
    const paginas = (ctx.paginas || []).filter((p) => p.cru && p.cru.hash && p.leitura2 && p.leitura2.cru && p.leitura2.cru.hash);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      if (p.cru.hash === p.leitura2.cru.hash) continue;
      const cam = caminhoDe(p.url);
      const trechos = [];
      const h1 = p.cru.html, h2 = p.leitura2.cru.html;
      if (typeof h1 === 'string' && typeof h2 === 'string') {
        const linhas = (h) => h.replace(/></g, '>\n<').split('\n').map((l) => l.trim()).filter(Boolean);
        const a = linhas(h1), b = linhas(h2);
        const sa = new Set(a), sb = new Set(b);
        for (const l of a) if (!sb.has(l) && trechos.length < 5) trechos.push({ de: 'primeira leitura', l });
        for (const l of b) if (!sa.has(l) && trechos.length < 10) trechos.push({ de: 'segunda leitura', l });
      }
      achados.push({
        pagina: p.url,
        mensagem: 'O HTML cru desta página mudou entre duas leituras seguidas (o hash SHA-256 não é igual), sem nenhuma mudança feita por nós. A página fica marcada como instável e fora da nota; os trechos que variam estão nas evidências.',
        evidencias: [
          ev({ pagina: cam, versao: 'cru', valor: `primeira leitura: ${p.cru.hash}` }),
          ev({ pagina: cam, versao: 'cru', valor: `segunda leitura: ${p.leitura2.cru.hash}` }),
          ...trechos.map((t) => ev({ pagina: cam, versao: 'cru', trecho: t.l, valor: t.de })),
        ],
        citacoes: [citacaoBase(p)], // o hash vem de leitura externa à página; cita-se algo que existe nela
        instavel: true,
      });
    }
    return disparo(achados, 0.1);
  },

  // Depende de uma segunda leitura do DOM final (ctx.paginas[i].leitura2.final.extr).
  'int2-conteudo-instavel-fora-da-nota': ({ ctx }) => {
    const paginas = (ctx.paginas || []).filter((p) => extrDe(p, 'final') && p.leitura2 && p.leitura2.final && p.leitura2.final.extr);
    if (!paginas.length) return null;
    const achados = [];
    for (const p of paginas) {
      const a = extrDe(p, 'final'), b = p.leitura2.final.extr;
      const mapa2 = new Map();
      for (const n of b.nos || []) if (!n.clone) mapa2.set(n.seletor, n);
      const mudaram = [];
      for (const n of a.nos || []) {
        if (n.clone || !n.visivel) continue;
        const o = mapa2.get(n.seletor);
        if (o && normalizarTexto(o.texto) !== normalizarTexto(n.texto)) mudaram.push({ n, outro: o });
      }
      if (!mudaram.length) continue;
      const cam = caminhoDe(p.url);
      const mostrados = mudaram.slice(0, 10);
      achados.push({
        pagina: p.url,
        mensagem: `Elementos que mudam sozinhos entre duas leituras seguidas do DOM final: ${mudaram.length} (relógio, contagem regressiva, carrossel com horário ou anúncio, por exemplo). Eles ficam marcados como instáveis, fora da nota objetiva, mas aparecem aqui.`,
        evidencias: [
          ev({ pagina: cam, versao: 'final', valor: 'elementos que mudam entre duas leituras', contagem: mudaram.length }),
          ...mostrados.flatMap((m) => [
            ev({ pagina: cam, versao: 'final', seletor: m.n.seletor, trecho: m.n.texto, valor: 'primeira leitura', visivel: true }),
            ev({ pagina: cam, versao: 'final', seletor: m.n.seletor, trecho: m.outro.texto, valor: 'segunda leitura', visivel: !!m.outro.visivel }),
          ]),
        ],
        citacoes: mostrados.slice(0, 3).map((m) => citTrecho(cortar(m.n.texto, 100), { onde: 'visivel', versoes: ['final'], pagina: p.url })),
        instavel: true,
      });
    }
    return disparo(achados, 0.1);
  },
};
