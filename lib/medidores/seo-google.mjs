// Medidor "seo-google" (módulo "Subir no Google"): só MEDIDAS, por página (DOM final; HTML cru como apoio).
// Reaproveita o que os medidores seo, jsonld, links e imagens já medem: aqui entra só o que faltava
// (viewport, Open Graph, termo-alvo, sinais de E-E-A-T e sinais de SEO local). O conteúdo do site é DADO.
//
// FORMATO DE `dados`:
// { paginas: [{ url, caminho, ehHome, viewport:{presente,conteudo,temWidth,zoomInicialBaixo},
//     og:{presentes[],faltando[]}, termo:{termo,palavras[],noH1,palavrasAusentesNoTexto[],palavrasDoTexto,fonte},
//     eeat:{autor,dataVisivel,linksExternos,palavras,pareceArtigo},
//     local:{telefones[],ceps[],enderecos[],telLinks,whatsappLinks,mapaIncorporado} }],
//   site: { linkSobre, telefonesDistintos[], cepsDistintos[], tiposJsonld[], tipoDeSite } }
export const id = 'seo-google';
export const VERSAO = '1';
const MAX_TEXTO = 200000;
const OG_OBRIGATORIAS = ['og:title', 'og:type', 'og:image', 'og:url'];

const PARADAS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre ao aos que se e ou mas como mais menos muito muita seu sua seus suas nosso nossa nossos nossas voce voces ele ela eles elas este esta estes estas esse essa esses essas isso isto aqui ali meu minha ser ter foi esta tem the and for you your').split(' '));

export const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const palavrasDe = (txt) => semAcento(txt).split(/[^a-z0-9]+/).filter(Boolean);
export const palavrasSignificativas = (txt) => palavrasDe(txt).filter((w) => w.length >= 3 && !PARADAS.has(w) && !/^\d+$/.test(w));

// Parte "principal" do título: antes de | – — · : (o resto costuma ser o nome do site).
export function termoDoTitulo(titulo) {
  const t = String(titulo || '').trim();
  const parte = t.split(/\s[|–—·:]\s|\s-\s/)[0] || t;
  return parte.trim();
}

const RE_TEL = /(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;
const RE_CEP = /\b\d{5}-\d{3}\b/g;
const RE_ENDERECO = /\b(?:rua|avenida|av\.|travessa|alameda|rodovia|estrada|pra[cç]a|largo)\s+[^\n,;]{2,60},?\s*(?:n[ºo°.]?\s*)?\d{1,5}\b/gi;
const RE_AUTOR = /^(?:por|escrito por|autor(?:a)?:?)\s+\p{Lu}[\p{L}'.-]+(?:\s+\p{Lu}[\p{L}'.-]+){0,3}/u;
const RE_DATA = /\b(?:publicado|atualizado|postado)\s+(?:em|:)?\s*\d{1,2}(?:[/.]\d{1,2}[/.]\d{2,4}|\s+de\s+[a-zç]+\s+de\s+\d{4})|\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}\b/i;
const RE_SOBRE = /\b(sobre|quem somos|nossa hist[óo]ria|nossa equipe|about)\b/i;
const RE_SOBRE_HREF = /\/(sobre|quem-somos|about|nossa-historia|equipe)/i;

const soDigitos = (s) => String(s).replace(/\D/g, '');
const unicos = (l) => [...new Set(l)].sort();
const ehVisivel = (x) => x && x.visivel === true && x.clone !== true;

function telefonesDo(texto) {
  const out = [];
  for (const m of texto.matchAll(RE_TEL)) {
    let d = soDigitos(m[0]);
    if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    if (d.length === 10 || d.length === 11) out.push(d);
  }
  return out;
}

function medirPagina(p, ctx) {
  const bloco = p.final?.extr ? p.final : p.cru;
  const extr = bloco?.extr;
  if (!extr) return null;
  const html = String(p.final?.html || p.cru?.html || '').slice(0, MAX_TEXTO);
  const metas = extr.metas || [];
  const metaNome = (n) => metas.find((m) => (m.nome || '').toLowerCase() === n);
  const vp = metaNome('viewport');
  const conteudoVp = vp ? String(vp.conteudo || '') : '';
  const escala = /initial-scale\s*=\s*([\d.]+)/i.exec(conteudoVp);
  const viewport = { presente: !!vp, conteudo: conteudoVp.slice(0, 120), temWidth: /width\s*=/i.test(conteudoVp), zoomInicialBaixo: escala ? Number(escala[1]) < 1 : false };

  const ogPresentes = new Set(metas.filter((m) => m.propriedade && /^og:/i.test(m.propriedade) && String(m.conteudo || '').trim()).map((m) => m.propriedade.toLowerCase()));
  const og = { presentes: [...ogPresentes].sort(), faltando: OG_OBRIGATORIAS.filter((o) => !ogPresentes.has(o)) };

  const nos = (extr.nos || []).filter(ehVisivel);
  const textos = nos.map((n) => String(n.texto || ''));
  const textoVisivel = textos.join(' \n ').slice(0, MAX_TEXTO);
  const palavrasDoTexto = textoVisivel.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const setTexto = new Set(palavrasDe(textoVisivel));

  const h1 = (extr.headings || []).filter((h) => h.nivel === 1 && ehVisivel(h)).map((h) => h.texto);
  const tituloBase = termoDoTitulo(extr.titulo);
  const termo = tituloBase || h1[0] || '';
  const fonte = tituloBase ? 'title' : (h1[0] ? 'h1' : null);
  const palavras = palavrasSignificativas(termo);
  const setH1 = new Set(palavrasSignificativas(h1.join(' ')));
  const noH1 = h1.length ? palavras.some((w) => setH1.has(w)) : null;
  const ausentesNoTexto = palavras.filter((w) => !setTexto.has(w));

  const links = extr.links || [];
  const visiveis = links.filter(ehVisivel);
  const telLinks = visiveis.filter((l) => /^tel:/i.test(String(l.href || ''))).length;
  const whatsappLinks = visiveis.filter((l) => /(^https?:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\b)|^whatsapp:/i.test(String(l.href || ''))).length;
  const linksExternos = visiveis.filter((l) => l.interno === false && /^https?:/i.test(String(l.href || ''))).length;

  const autorMeta = !!(metaNome('author') && String(metaNome('author').conteudo || '').trim());
  const autorHtml = /\brel\s*=\s*["']?author\b|\bitemprop\s*=\s*["']?author\b/i.test(html);
  const autorTexto = textos.some((t) => RE_AUTOR.test(t.trim()));
  const dataHtml = /<time\b[^>]{0,200}\bdatetime\s*=|\bitemprop\s*=\s*["']?(?:datePublished|dateModified)\b/i.test(html);
  const dataTexto = RE_DATA.test(textoVisivel);

  const telefones = unicos(telefonesDo(textoVisivel));
  const ceps = unicos([...textoVisivel.matchAll(RE_CEP)].map((m) => m[0]));
  const enderecos = unicos([...textoVisivel.matchAll(RE_ENDERECO)].map((m) => semAcento(m[0]).replace(/\s+/g, ' ').trim()));
  const mapaIncorporado = /<iframe\b[^>]{0,400}\bsrc\s*=\s*["'][^"']{0,300}(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|openstreetmap\.org)/i.test(html);

  let caminho = '/';
  try { caminho = new URL(p.url).pathname || '/'; } catch { /* url estranha */ }
  return {
    url: p.url, caminho, ehHome: caminho === '/' || caminho === '/index.html',
    viewport, og,
    termo: { termo: termo.slice(0, 120), palavras, noH1, palavrasAusentesNoTexto: ausentesNoTexto, palavrasDoTexto, fonte },
    eeat: { autor: autorMeta || autorHtml || autorTexto, dataVisivel: dataHtml || dataTexto, linksExternos, palavras: palavrasDoTexto },
    local: { telefones, ceps, enderecos, telLinks, whatsappLinks, mapaIncorporado },
  };
}

export async function medir(ctx) {
  const ordenadas = [...(ctx.paginas || [])].sort((a, b) => String(a.url).localeCompare(String(b.url)));
  const paginas = ordenadas.map((p) => medirPagina(p, ctx)).filter(Boolean);
  const evidencias = [];
  let linkSobre = false;
  for (const p of ordenadas) {
    for (const l of (p.final?.extr?.links || p.cru?.extr?.links || [])) {
      if (!ehVisivel(l) || l.interno === false) continue;
      let cam = ''; try { cam = new URL(l.href).pathname; } catch { /* href estranho */ }
      if (RE_SOBRE.test(String(l.texto || '')) || RE_SOBRE_HREF.test(cam)) { linkSobre = true; break; }
    }
    if (linkSobre) break;
  }
  const site = {
    linkSobre,
    telefonesDistintos: unicos(paginas.flatMap((p) => p.local.telefones)),
    cepsDistintos: unicos(paginas.flatMap((p) => p.local.ceps)),
    tipoDeSite: ctx.site?.tipoDeSite || null,
  };
  for (const p of paginas) evidencias.push({ pagina: p.caminho, versao: 'final', seletor: 'head', trecho: p.termo.termo, valor: p.termo.fonte, contagem: 1, visivel: null });
  return { id, versao: VERSAO, dados: { paginas, site }, evidencias };
}
