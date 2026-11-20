// Medidor 'lei': FATOS que alimentam as regras de regras/lei-br.json.
// Princípio: o script MEDE presença/ausência de elementos no código/texto; NUNCA julga legalidade.
// Quem explica o risco é a regra/modelo depois. O conteúdo do site analisado é DADO.
//
// Texto visível = nós com visivel=true e clone=false (SPEC §4.3). Texto oculto vai SEPARADO em
// dados.ocultosRelevantes e nunca entra em nenhum fato "visível".
import { buscarSeguro } from '../rede-segura.mjs';
import { compararVersoes } from '../diff-versoes.mjs';
import { normalizarTexto, normalizarUrl, decodificarEntidades, sha256, removerBlocos, tirarTags, acharEmails } from '../util.mjs';
import { saidaMedidor } from '../contexto.mjs';

export const id = 'lei';
export const versao = '1';

const TIMEOUT_ALVO_MS = 8000;
const MAX_BYTES_ALVO = 1.5 * 1024 * 1024;
const MIN_CARACTERES_CORPO = 300; // lei-br.json: texto_visivel_minimo_caracteres
const LIMITE_LISTA = 50;

// ---------------------------------------------------------------- utilitários

const cortar = (t, n = 160) => { const s = String(t ?? ''); return s.length > n ? s.slice(0, n) + '…' : s; };
const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return String(url); } };
const janela = (texto, indice, tam, raio = 60) => cortar(texto.slice(Math.max(0, indice - raio), indice + tam + raio).trim(), tam + raio * 2 + 2);
const palavrasDe = (t) => (String(t).trim() ? String(t).trim().split(/\s+/).length : 0);
const unicos = (arr, chave) => { const v = new Set(); return arr.filter((x) => { const k = chave(x); if (v.has(k)) return false; v.add(k); return true; }); };

async function mapLimite(itens, limite, fn) {
  const saida = new Array(itens.length);
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; saida[k] = await fn(itens[k], k); }
  });
  await Promise.all(trabalhadores);
  return saida;
}

function htmlParaTexto(html) {
  // processamento LINEAR (HTML não confiável; regex com [\s\S]*? é quadrática em entrada maliciosa)
  let h = removerBlocos(String(html), '<!--', '-->');
  for (const tag of ['script', 'style', 'noscript', 'template', 'svg', 'head']) h = removerBlocos(h, `<${tag}`, `</${tag}`);
  const t = tirarTags(h, ' ');
  return decodificarEntidades(t).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------- CNPJ

// Algoritmo oficial do dígito verificador do CNPJ (módulo 11).
export function cnpjValido(valor) {
  const d = String(valor ?? '').replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export const formatarCnpj = (d) => String(d).replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

const RE_CNPJ = /(?<![\d./-])\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g;
const CNPJ_MODELO = new Set(['00000000000000', '11111111111111', '12345678000190']);
const RE_ROTULO_CNPJ = /\bC\.?\s?N\.?\s?P\.?\s?J\b/i;
const RE_ROTULO_RAZAO = /raz[aã]o\s+social|nome\s+empresarial|denomina[cç][aã]o\s+social/i;
const RE_ROTULO_INSCRICAO = /inscri[cç][aã]o\s+(estadual|municipal)|inscri[cç][aã]o\s+n/i;

// ---------------------------------------------------------------- tabelas

const ALVOS = {
  privacidade: {
    texto: /(pol[ií]tica\s+de\s+privacidade|aviso\s+de\s+privacidade|privacidade|prote[cç][aã]o\s+de\s+dados|\blgpd\b|privacy)/i,
    href: /(privacidade|privacy|lgpd|protecao-de-dados|politica-privacidade)/i,
    rotas: ['/privacidade', '/politica-de-privacidade', '/politica-privacidade', '/privacy', '/privacy-policy', '/lgpd', '/protecao-de-dados'],
  },
  termos: {
    texto: /(termos(\s+(de|e)\s+(uso|condi[cç][oõ]es|servi[cç]o))?|condi[cç][oõ]es\s+(gerais|de\s+uso|de\s+venda)|terms(\s+of\s+(use|service))?)/i,
    href: /(termos|terms|condicoes|(^|[/-])tos([/.?#-]|$))/i,
    rotas: ['/termos', '/termos-de-uso', '/termos-e-condicoes', '/condicoes-de-uso', '/terms', '/terms-of-service'],
  },
  cookies: {
    texto: /cookies?/i,
    href: /cookie/i,
    rotas: [],
  },
};

const RASTREADORES_TERCEIROS = [
  { nome: 'Google Tag Manager', dominios: ['googletagmanager.com'] },
  { nome: 'Google Analytics', dominios: ['google-analytics.com', 'analytics.google.com'] },
  { nome: 'Meta Pixel', dominios: ['connect.facebook.net', 'facebook.com/tr'] },
  { nome: 'Hotjar', dominios: ['hotjar.com', 'hotjar.io'] },
  { nome: 'Microsoft Clarity', dominios: ['clarity.ms'] },
  { nome: 'TikTok Pixel', dominios: ['analytics.tiktok.com', 'business-api.tiktok.com'] },
  { nome: 'LinkedIn Insight', dominios: ['snap.licdn.com', 'px.ads.linkedin.com'] },
  { nome: 'Google Ads / DoubleClick', dominios: ['doubleclick.net', 'googleadservices.com'] },
  { nome: 'Segment', dominios: ['cdn.segment.com'] },
];

const PLATAFORMAS_CMP = [
  { nome: 'Cookiebot', padroes: ['cookiebot.com', 'cybotcookiebotdialog'] },
  { nome: 'OneTrust', padroes: ['onetrust.com', 'cdn.cookielaw.org', 'onetrust-banner-sdk', 'optanon'] },
  { nome: 'Usercentrics', padroes: ['usercentrics.eu', 'usercentrics.com'] },
  { nome: 'CookieYes', padroes: ['cookieyes.com', 'cky-consent'] },
  { nome: 'Iubenda', padroes: ['iubenda.com'] },
  { nome: 'Termly', padroes: ['termly.io'] },
  { nome: 'Klaro', padroes: ['klaro.js', 'klaro.min.js', 'kiprotect.com/klaro'] },
  { nome: 'Osano', padroes: ['osano.com'] },
  { nome: 'tarteaucitron', padroes: ['tarteaucitron'] },
  { nome: 'Complianz', padroes: ['complianz'] },
];

const APIS_CONSENTIMENTO = [/__tcfapi/, /gtag\(\s*['"]consent['"]/, /OptanonWrapper/, /Cookiebot\./];

const RE_BOTAO_ACEITAR = /\b(aceit(ar|o|e|amos)|concordo|permitir|entendi|accept|allow|agree)\b/i;
const RE_BOTAO_RECUSAR = /\b(recus(ar|o)|rejeit(ar|o)|negar|n[aã]o\s+aceito|apenas\s+(os\s+)?(essenciais|necess[aá]rios)|somente\s+(os\s+)?necess[aá]rios|decline|reject|deny)\b/i;
const RE_BOTAO_GERENCIAR = /(gerenciar|prefer[eê]ncias|personalizar|configurar|configura[cç][oõ]es|customize|manage|settings)/i;

const RE_PRECO = /R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g;
const CONDICOES = {
  parcelamento: /(\b\d{1,2}\s*x\b|parcel|sem\s+juros)/i,
  aVista: /(à\s*vista|\bvista\b|no\s+pix|\bpix\b|boleto)/i,
  prazoOferta: /(v[aá]lid[ao]|at[eé]\s+(o\s+dia|dia|\d{1,2}\/|hoje|amanh[aã])|termina|encerra|por\s+tempo\s+limitado|\bprazo\b|s[oó]\s+hoje)/i,
  frete: /(frete|entrega|envio)/i,
  taxas: /(\btaxas?\b|\bjuros\b|encargos|imposto|\biof\b)/i,
  garantia: /(garantia|arrependimento|\b7\s+dias|sete\s+dias|reembolso|devolu[cç])/i,
  restricoes: /(sujeito\s+a|restri[cç]|regulamento|condi[cç][oõ]es|consulte)/i,
};

const PADROES_PROMESSA = [
  { id: 'ganho-mais-rs', re: /\+\s*R\$\s*[\d.]+(?:,\d{2})?/gi },
  { id: 'ganhe-rs', re: /ganhe\s+(?:at[eé]\s+)?R\$/gi },
  { id: 'rs-por-periodo', re: /R\$\s*[\d.]+(?:,\d{2})?\s*(?:por|\/|ao)\s*(?:m[eê]s|dia|semana)/gi },
  { id: 'renda-extra', re: /renda\s+extra/gi },
  { id: 'fature', re: /\bfature\b|\bfaturar\b/gi },
  { id: 'garantido', re: /resultado\s+garantido|100%\s+garantid[oa]s?|garantid[oa]s?/gi },
  { id: 'sem-risco', re: /sem\s+risco/gi },
  { id: 'fique-rico', re: /fique\s+rico/gi },
  { id: 'lucre', re: /\blucre\b|\blucrar\b/gi },
];

const PADROES_ESCASSEZ = [
  { tipo: 'contador-regressivo', re: /(?<!\d)\d{1,3}\s*:\s*\d{2}\s*:\s*\d{2}(?:\s*:\s*\d{2})?(?!\d)/g },
  { tipo: 'contador-dias-horas', re: /\b\d{1,2}\s*(?:dias?|d)\s*[:,e]?\s*\d{1,2}\s*(?:horas?|h)\b/gi },
  { tipo: 'restam', re: /\b(?:restam|restantes|faltam|resta)\s+(?:apenas\s+|s[oó]\s+)?\d+/gi },
  { tipo: 'ultimas', re: /(?<![A-Za-zÀ-ÿ])[uú]ltim[ao]s?\s+(?:\d+\s+)?(?:vagas?|unidades?|pe[cç]as?|horas?|dias?)/gi },
  { tipo: 'so-hoje', re: /\bs[oó]\s+hoje\b|\bhoje\s+(?:apenas|somente)\b/gi },
  { tipo: 'prazo-limitado', re: /vagas\s+limitadas|estoque\s+limitado|oferta\s+(?:termina|encerra|acaba)|acaba\s+em|encerra\s+em|termina\s+em/gi },
];

const PADROES_ESCASSEZ_JS = [
  /Date\.now\(\)\s*\+/g,
  /new\s+Date\(\)\.getTime\(\)\s*\+/g,
  /new\s+Date\(\s*Date\.now\(\)\s*\+/g,
  /localStorage\.setItem\(\s*['"][^'"]*(?:fim|end|deadline|target|countdown|timer)[^'"]*['"]/gi,
];

const RE_RELEVANTE_OCULTO = /(%|\bOFF\b|oferta\s+(?:encerrada|esgotada|expirada)|esgotad[oa]|encerrad[oa]|expirad[oa]|promo[cç][aã]o|desconto|R\$\s?\d|vagas|[uú]ltim[ao]s|restam|indispon[ií]vel|gr[aá]tis|gratuito)/i;

const RE_COMPRA_BOTAO = /(comprar|assinar|contratar|garantir\s+(?:minha\s+)?vaga|adicionar\s+ao\s+carrinho|finalizar\s+compra|checkout|matricular|quero\s+(?:comprar|garantir|assinar|adquirir)|adquirir)/i;
const RE_COMPRA_HREF = /(checkout|comprar|\/cart|carrinho|pagamento|hotmart|kiwify|eduzz|monetizze|stripe|mercadopago|pagseguro)/i;

const GRUPOS_DIREITOS_TITULAR = {
  acesso: /acesso\s+aos\s+dados|confirma[cç][aã]o/i,
  correcao: /corre[cç][aã]o|corrigir/i,
  eliminacao: /elimina[cç][aã]o|exclus[aã]o|excluir/i,
  portabilidade: /portabilidade/i,
  revogacao: /revoga[cç][aã]o|revogar/i,
  art18: /art\.?\s*18|direitos\s+do\s+titular/i,
};
const GRUPOS_CONTEUDO_MINIMO = {
  finalidade: /finalidade|para\s+que\s+usamos|como\s+usamos/i,
  formaEDuracao: /por\s+quanto\s+tempo|prazo\s+de\s+armazenamento|reten[cç][aã]o|per[ií]odo/i,
  controlador: /controlador|respons[aá]vel\s+pelo\s+tratamento|raz[aã]o\s+social|cnpj/i,
  contato: /contato|e-mail|encarregado|dpo/i,
  compartilhamento: /compartilh|terceiros|operador|parceiros/i,
};

const RE_ENCARREGADO = /\b(encarregad[oa]|dpo|data\s+protection\s+officer|canal\s+do\s+titular|exercer\s+(?:os\s+)?seus\s+direitos|titulares?\s+(?:de|dos)\s+dados)\b/gi;
const RE_EMAIL_PRIVACIDADE = /\b(?:dpo|privacidade|lgpd|encarregado|protecao)[\w.-]*@[\w-]+(?:\.[\w-]+)+/gi;

const RE_TELEFONE = [
  /\(\s*\d{2}\s*\)\s*9?\s*\d{4}[\s.-]?\d{4}/g,
  /(?:\+55\s?)?\b\d{2}\s9?\d{4}[-\s]\d{4}\b/g,
  /\b0800[\s-]?\d{3}[\s-]?\d{4}\b/g,
];
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g;
const RE_CEP = /\b\d{5}-\d{3}\b/g;
const RE_LOGRADOURO = /(?:Rua|Av\.?|Avenida|Alameda|Travessa|Rodovia|Pra[cç]a)\s+[^,\n]{3,60},?\s*(?:n[ºo°]\s*)?\d+/gi;

const RE_TERMO_ARREPENDIMENTO = /(arrependimento|desist(?:ir|[eê]ncia)|\b7\s+dias|sete\s+dias|devolu[cç][aã]o|reembolso|garantia\s+(?:incondicional|de\s+7))/gi;
const RE_TERMO_ENTREGA = /\b(frete|entrega|prazo\s+de\s+entrega|envio|retirada|acesso\s+imediato|taxa\s+de\s+entrega)\b/gi;
const RE_TERMO_ATENDIMENTO = /(fale\s+conosco|atendimento|\bsac\b|suporte|contato)/i;

// ---------------------------------------------------------------- leitura do ctx

const ehVisivel = (n) => n.visivel && !n.clone;

// Nós de texto de uma página (final primeiro; nós que só existem no cru entram depois). filtro decide quais.
function coletarNos(p, filtro) {
  const pagina = caminhoDe(p.url);
  const vistos = new Set();
  const saida = [];
  for (const [ver, extr] of [['final', p.final?.extr], ['cru', p.cru?.extr]]) {
    for (const n of extr?.nos || []) {
      if (!filtro(n)) continue;
      const k = n.seletor; // a leitura final manda; o cru só entra se o elemento não existe no final
      if (vistos.has(k)) continue;
      vistos.add(k);
      saida.push({ pagina, url: p.url, versao: ver, seletor: n.seletor, tag: n.tag, texto: n.texto, ocultoPor: n.ocultoPor || '' });
    }
  }
  return saida;
}

function coletarLinks(p) {
  const pagina = caminhoDe(p.url);
  const vistos = new Set();
  const saida = [];
  for (const [ver, extr] of [['final', p.final?.extr], ['cru', p.cru?.extr]]) {
    for (const l of extr?.links || []) {
      if (l.clone) continue;
      const k = (l.hrefAttr ?? '') + '|' + l.texto;
      if (vistos.has(k)) continue;
      vistos.add(k);
      saida.push({ pagina, url: p.url, versao: ver, seletor: l.seletor, hrefAttr: l.hrefAttr, href: l.href, texto: l.texto || l.ariaLabel || l.title || '', visivel: !!l.visivel, contexto: l.contexto });
    }
  }
  return saida;
}

function valoresDeAtributos(html) {
  const vals = [];
  for (const m of String(html || '').matchAll(/\b(?:id|class|data-[\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) vals.push(m[1] ?? m[2] ?? '');
  return vals;
}

// ---------------------------------------------------------------- sondagem HTTP de páginas-alvo

async function sondar(url, ctx) {
  const opc = { timeoutMs: TIMEOUT_ALVO_MS, maxBytes: MAX_BYTES_ALVO, permitidos: ctx.rede?.permitidos || [], permitirLocal: !!ctx.rede?.permitirLocal };
  let head = null;
  let erroHead = null;
  try { head = await buscarSeguro(url, { ...opc, metodo: 'HEAD' }); } catch (e) { erroHead = e.message; }
  const precisaGet = !head || head.status === 200 || [403, 405, 501].includes(head.status);
  if (!precisaGet) return { url, urlFinal: head.url, status: head.status, tipoMime: String(head.cabecalhos['content-type'] || ''), texto: '', hashCorpo: null, erro: null, metodo: 'HEAD' };
  try {
    const r = await buscarSeguro(url, opc);
    return { url, urlFinal: r.url, status: r.status, tipoMime: String(r.cabecalhos['content-type'] || ''), texto: htmlParaTexto(r.texto()), tituloHtml: (r.texto().match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '', hashCorpo: sha256(r.corpo), erro: null, metodo: head ? 'HEAD+GET' : 'GET' };
  } catch (e) {
    return { url, urlFinal: null, status: head?.status ?? null, tipoMime: '', texto: '', hashCorpo: null, erro: e.message || erroHead, metodo: head ? 'HEAD+GET' : 'GET' };
  }
}

function descreverAlvo(s, { origem, tipoAlvo, hashHome, rotaDe }) {
  const pdf = /pdf/i.test(s.tipoMime);
  const caracteres = s.texto.length;
  const sinal404 = /(\b404\b|n[aã]o\s+encontrad|not\s+found|p[aá]gina\s+n[aã]o\s+existe)/i.test(cortar(s.texto, 300) + ' ' + (s.tituloHtml || ''));
  const igualAHome = !!(rotaDe && hashHome && s.hashCorpo && s.hashCorpo === hashHome);
  const alvo = {
    url: s.url, urlFinal: s.urlFinal, origem, status: s.status, metodo: s.metodo, tipoMime: s.tipoMime || null,
    caracteres: pdf ? null : caracteres, palavras: pdf ? null : palavrasDe(s.texto),
    corpoMinimoAtingido: pdf ? null : caracteres >= MIN_CARACTERES_CORPO,
    soft404: s.status === 200 && (sinal404 && caracteres < 600 || igualAHome),
    igualAHome, erro: s.erro,
  };
  alvo.paginaExiste = s.status === 200 && !alvo.soft404;
  const falhas = [];
  if (s.status !== 200) falhas.push('status_http != 200');
  if (alvo.soft404) falhas.push('soft-404');
  if (s.status === 200 && alvo.corpoMinimoAtingido === false) falhas.push('texto visível < 300 caracteres');
  alvo.falhas = falhas;
  if (tipoAlvo === 'privacidade' && alvo.paginaExiste && s.texto) {
    const presentes = (g) => Object.entries(g).filter(([, re]) => re.test(s.texto)).map(([k]) => k);
    alvo.direitosTitular = { gruposPresentes: presentes(GRUPOS_DIREITOS_TITULAR), total: Object.keys(GRUPOS_DIREITOS_TITULAR).length };
    alvo.conteudoMinimo = { gruposPresentes: presentes(GRUPOS_CONTEUDO_MINIMO), total: Object.keys(GRUPOS_CONTEUDO_MINIMO).length };
  }
  return alvo;
}

// ---------------------------------------------------------------- medidor

export async function medir(ctx) {
  const paginas = ctx.paginas || [];
  const evidencias = [];
  const ev = (pagina, versaoEv, seletor, trecho, valor = null, contagem = null, visivel = true) => {
    if (evidencias.length < 400) evidencias.push({ pagina, versao: versaoEv, seletor: seletor ?? null, trecho: cortar(trecho, 200), valor, contagem, visivel });
  };

  const visiveis = paginas.flatMap((p) => coletarNos(p, ehVisivel));
  const ocultos = paginas.flatMap((p) => coletarNos(p, (n) => !n.visivel && !n.clone));
  const todosLinks = paginas.flatMap(coletarLinks);
  const porPagina = new Map(paginas.map((p) => [p.url, visiveis.filter((n) => n.url === p.url)]));

  const paginasAmostradas = paginas.map((p) => ({ pagina: caminhoDe(p.url), url: p.url, status: p.cru?.status ?? null }));
  const paginasInspecionadas = new Set(paginas.map((p) => p.url));

  // ---------- (a) CNPJ ----------
  const candidatos = [];
  const rotulos = [];
  visiveis.forEach((n, i) => {
    const anterior = i > 0 && visiveis[i - 1].url === n.url ? visiveis[i - 1].texto.slice(-40) : '';
    for (const m of n.texto.matchAll(RE_CNPJ)) {
      const digitos = m[0].replace(/\D/g, '');
      const pontuado = /[./-]/.test(m[0]);
      const rotulo = RE_ROTULO_CNPJ.test(n.texto) || /C\.?\s?N\.?\s?P\.?\s?J\W*$/i.test(anterior);
      const valido = cnpjValido(digitos);
      if (!pontuado && !valido && !rotulo) continue;
      candidatos.push({ cnpj: formatarCnpj(digitos), digitos, pontuado, valido, modelo: CNPJ_MODELO.has(digitos), comRotulo: rotulo, pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.index, m[0].length) });
    }
    for (const [tipo, re] of [['cnpj', RE_ROTULO_CNPJ], ['razao-social', RE_ROTULO_RAZAO], ['inscricao', RE_ROTULO_INSCRICAO]]) {
      const m = n.texto.match(re);
      if (m) rotulos.push({ rotulo: tipo, pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.index, m[0].length) });
    }
  });
  const cnpjEncontrados = unicos(candidatos, (c) => c.digitos + '|' + c.pagina + '|' + c.seletor);
  const cnpjValidos = cnpjEncontrados.filter((c) => c.valido && !c.modelo);
  cnpjEncontrados.forEach((c) => ev(c.pagina, c.versao, c.seletor, c.trecho, c.valido ? 'cnpj-valido' : 'cnpj-invalido', null, true));
  const cnpj = {
    encontrados: cnpjEncontrados,
    validos: cnpjValidos.length,
    invalidos: cnpjEncontrados.filter((c) => !c.valido || c.modelo).length,
    cnpjValidoPresente: cnpjValidos.length > 0,
    rotulosEncontrados: unicos(rotulos, (r) => r.rotulo + '|' + r.pagina + '|' + r.seletor).slice(0, LIMITE_LISTA),
    razaoSocialRotuloPresente: rotulos.some((r) => r.rotulo === 'razao-social'),
    paginasInspecionadas: paginasAmostradas.map((p) => p.url),
  };

  // ---------- oferta (precondição de várias regras) ----------
  const botoesCompra = unicos(visiveis.filter((n) => (n.tag === 'button' || n.tag === 'a') && RE_COMPRA_BOTAO.test(n.texto)), (n) => n.pagina + n.seletor).slice(0, 10).map((n) => ({ pagina: n.pagina, seletor: n.seletor, texto: cortar(n.texto, 80) }));
  const linksCheckout = todosLinks.filter((l) => l.hrefAttr && RE_COMPRA_HREF.test(l.hrefAttr)).slice(0, 10).map((l) => ({ pagina: l.pagina, seletor: l.seletor, href: l.hrefAttr, texto: cortar(l.texto, 80) }));

  // ---------- (f) preços ----------
  const precos = [];
  let totalPrecos = 0;
  for (const p of paginas) {
    const nosP = porPagina.get(p.url) || [];
    const condPagina = Object.entries(CONDICOES).filter(([, re]) => nosP.some((n) => re.test(n.texto))).map(([k]) => k);
    nosP.forEach((n, i) => {
      for (const m of n.texto.matchAll(RE_PRECO)) {
        totalPrecos++;
        if (precos.length >= 80) continue;
        const partes = n.seletor.split('>');
        const prefixo = partes.slice(0, -1).join('>');
        const bloco = nosP.filter((o, j) => Math.abs(j - i) <= 8 && (o === n || (prefixo && o.seletor.startsWith(prefixo + '>'))));
        const textoBloco = bloco.map((o) => o.texto).join(' ');
        const cats = (texto) => Object.entries(CONDICOES).filter(([, re]) => re.test(texto)).map(([k]) => k);
        const depois = n.texto.slice(m.index + m[0].length);
        const item = {
          valor: m[0], tag: n.tag, trecho: janela(n.texto, m.index, m[0].length), pagina: n.pagina, seletor: n.seletor, versao: n.versao,
          asterisco: depois.trimStart().startsWith('*'),
          condicoes: { no: cats(n.texto.replace(m[0], ' ')), bloco: cats(textoBloco.replace(m[0], ' ')), pagina: condPagina },
        };
        item.semCondicaoNoBloco = item.condicoes.bloco.length === 0;
        item.semCondicaoNaPagina = condPagina.length === 0;
        precos.push(item);
        ev(n.pagina, n.versao, n.seletor, item.trecho, m[0], null, true);
      }
    });
  }
  const oferta = { temPreco: totalPrecos > 0, botoesCompra, linksCheckout, temOferta: totalPrecos > 0 || botoesCompra.length > 0 || linksCheckout.length > 0 };
  const precosDados = {
    total: totalPrecos, itens: precos,
    semCondicaoNoBloco: precos.filter((x) => x.semCondicaoNoBloco).length,
    semCondicaoNaPagina: precos.filter((x) => x.semCondicaoNaPagina).length,
    comAsterisco: precos.filter((x) => x.asterisco).length,
    valoresDistintos: [...new Set(precos.map((x) => x.valor))],
  };

  // ---------- (b) privacidade / termos / cookies (páginas-alvo) ----------
  const hashHome = paginas.find((p) => { try { return new URL(p.url).pathname === '/'; } catch { return false; } })?.cru?.hash || null;
  const sondaPorUrl = new Map(); // url normalizada -> promessa
  const textoPorUrlAlvo = new Map(); // para busca de encarregado / arrependimento
  const sampledPorUrl = new Map(paginas.map((p) => [normalizarUrl(p.url), p]));
  const rotasTestadas = [];

  async function resolverAlvo(url, origem, tipoAlvo, rotaDe) {
    const norm = normalizarUrl(url) || url;
    paginasInspecionadas.add(norm);
    const amostrada = sampledPorUrl.get(norm);
    if (amostrada) {
      const texto = (porPagina.get(amostrada.url) || []).map((n) => n.texto).join(' ');
      textoPorUrlAlvo.set(norm, texto);
      const a = descreverAlvo({ url, urlFinal: amostrada.cru?.urlFinal || url, status: amostrada.cru?.status ?? null, tipoMime: amostrada.cru?.tipoMime || '', texto, hashCorpo: amostrada.cru?.hash, erro: null, metodo: 'pagina-amostrada' }, { origem: 'pagina-amostrada', tipoAlvo, hashHome, rotaDe: false });
      return a;
    }
    if (!sondaPorUrl.has(norm)) sondaPorUrl.set(norm, sondar(url, ctx));
    const s = await sondaPorUrl.get(norm);
    textoPorUrlAlvo.set(norm, s.texto);
    return descreverAlvo(s, { origem, tipoAlvo, hashHome, rotaDe });
  }

  const dadosAlvo = {};
  for (const [tipo, def] of Object.entries(ALVOS)) {
    const achados = todosLinks.filter((l) => {
      if (!l.hrefAttr || /^(mailto|tel|sms|whatsapp):/i.test(l.hrefAttr)) return false;
      if (l.texto.length > 120) return false;
      return def.texto.test(l.texto) || def.href.test(l.hrefAttr);
    });
    // classifica o destino de cada link
    const links = unicos(achados, (l) => l.pagina + '|' + l.hrefAttr + '|' + l.texto).map((l) => {
      const hrefAttr = l.hrefAttr.trim();
      let destino = 'url';
      let alvoUrl = null;
      if (hrefAttr === '' || hrefAttr === '#' || /^javascript:/i.test(hrefAttr)) destino = 'sem-destino';
      else if (hrefAttr.startsWith('#')) destino = 'ancora-interna';
      else { alvoUrl = normalizarUrl(l.href || hrefAttr, l.url); if (!alvoUrl) destino = 'sem-destino'; else if (alvoUrl === normalizarUrl(l.url) && /#/.test(l.href || '')) destino = 'ancora-interna'; }
      return { texto: cortar(l.texto, 80), hrefAttr: l.hrefAttr, url: alvoUrl, destino, pagina: l.pagina, seletor: l.seletor, versao: l.versao, visivel: l.visivel };
    });
    links.forEach((l) => ev(l.pagina, l.versao, l.seletor, `${l.texto} -> ${l.hrefAttr}`, tipo, null, l.visivel));
    const urlsAlvo = [...new Set(links.filter((l) => l.destino === 'url').map((l) => l.url))];
    const alvos = await mapLimite(urlsAlvo, 4, (u) => resolverAlvo(u, 'link', tipo, false));
    // rotas comuns só se NENHUM link foi achado
    let rotas = [];
    if (links.length === 0 && def.rotas.length) {
      for (const r of def.rotas) {
        const u = new URL(r, ctx.site.origem).toString();
        const a = await resolverAlvo(u, 'rota-comum', tipo, true);
        rotasTestadas.push({ tipo, url: u, status: a.status, paginaExiste: a.paginaExiste });
        rotas.push({ url: u, status: a.status, paginaExiste: a.paginaExiste });
        if (a.paginaExiste) { alvos.push(a); break; }
      }
    }
    const paginaExiste = alvos.some((a) => a.paginaExiste);
    dadosAlvo[tipo] = {
      linkEncontrado: links.length > 0,
      links: links.slice(0, LIMITE_LISTA),
      alvos,
      rotasComunsTestadas: rotas,
      paginaExiste,
      ausente: links.length === 0 && !paginaExiste,
      linksSemDestino: links.filter((l) => l.destino === 'sem-destino').length,
    };
  }
  const privacidade = { ...dadosAlvo.privacidade, paginasInspecionadas: [...paginasInspecionadas] };
  const termos = { ...dadosAlvo.termos, paginasInspecionadas: [...paginasInspecionadas] };
  const politicaCookies = dadosAlvo.cookies;

  // ---------- (c) cookies / consentimento ----------
  const cookiesMencao = visiveis.filter((n) => n.tag !== 'a' && n.texto.length >= 25 && /cookies?/i.test(n.texto));
  const paginasComMencao = new Set(cookiesMencao.map((n) => n.url));
  const botoesBanner = { aceitar: [], recusar: [], gerenciar: [] };
  for (const n of visiveis) {
    if (!paginasComMencao.has(n.url) || (n.tag !== 'button' && n.tag !== 'a') || n.texto.length > 60) continue;
    const item = { texto: n.texto, pagina: n.pagina, seletor: n.seletor };
    if (RE_BOTAO_RECUSAR.test(n.texto)) botoesBanner.recusar.push(item);
    else if (RE_BOTAO_ACEITAR.test(n.texto)) botoesBanner.aceitar.push(item);
    else if (RE_BOTAO_GERENCIAR.test(n.texto)) botoesBanner.gerenciar.push(item);
  }
  const bannerDetectado = cookiesMencao.length > 0 && (botoesBanner.aceitar.length + botoesBanner.recusar.length + botoesBanner.gerenciar.length) > 0;
  cookiesMencao.slice(0, 3).forEach((n) => ev(n.pagina, n.versao, n.seletor, n.texto, 'mencao-cookies', null, true));

  const cmp = [];
  const rastreadores = [];
  const indiciosSeletor = [];
  const apisConsentimento = [];
  const codigos = []; // { origem, texto }
  for (const p of paginas) {
    const pagina = caminhoDe(p.url);
    const scriptsSrc = unicos([...(p.final?.extr?.scripts || []), ...(p.cru?.extr?.scripts || [])].filter((s) => s.src), (s) => s.src).map((s) => { try { return new URL(s.src, p.url).toString(); } catch { return s.src; } });
    const reqs = (p.requisicoes || []).map((r) => r.url);
    const atributos = [...valoresDeAtributos(p.final?.html), ...valoresDeAtributos(p.cru?.html)];
    for (const [via, urls] of [['script-src', scriptsSrc], ['requisicao', reqs]]) {
      for (const u of urls) {
        const baixa = u.toLowerCase();
        for (const r of RASTREADORES_TERCEIROS) {
          const dom = r.dominios.find((d) => baixa.includes(d));
          if (dom) rastreadores.push({ nome: r.nome, dominio: dom, via, url: cortar(u, 200), pagina });
        }
        for (const c of PLATAFORMAS_CMP) if (c.padroes.some((pd) => baixa.includes(pd))) cmp.push({ nome: c.nome, via, url: cortar(u, 200), pagina });
      }
    }
    for (const a of atributos) {
      const baixa = a.toLowerCase();
      for (const c of PLATAFORMAS_CMP) if (c.padroes.some((pd) => baixa.includes(pd))) cmp.push({ nome: c.nome, via: 'atributo-html', url: cortar(a, 120), pagina });
      if (/cookie|consent|lgpd/i.test(a) && !PLATAFORMAS_CMP.some((c) => c.padroes.some((pd) => baixa.includes(pd)))) indiciosSeletor.push({ valor: cortar(a, 120), pagina });
    }
    for (const s of [...(p.final?.extr?.scripts || []), ...(p.cru?.extr?.scripts || [])]) if (s.inline) codigos.push({ origem: `script inline em ${pagina}`, texto: s.inline });
  }
  for (const a of ctx.ativos || []) if (a.tipo === 'js' && a.texto) codigos.push({ origem: a.url, texto: a.texto });
  for (const c of codigos) {
    const baixa = c.texto.toLowerCase();
    for (const r of RASTREADORES_TERCEIROS) {
      const dom = r.dominios.find((d) => baixa.includes(d));
      if (dom) rastreadores.push({ nome: r.nome, dominio: dom, via: 'codigo', url: cortar(c.origem, 200), pagina: null });
    }
    for (const re of APIS_CONSENTIMENTO) { const m = c.texto.match(re); if (m) apisConsentimento.push({ api: m[0], origem: cortar(c.origem, 200) }); }
  }
  const rastreadoresUnicos = unicos(rastreadores, (r) => r.nome + '|' + r.via + '|' + r.url);
  const cmpUnicos = unicos(cmp, (c) => c.nome + '|' + c.via + '|' + c.url);
  rastreadoresUnicos.slice(0, 20).forEach((r) => ev(r.pagina || '(código)', 'final', null, r.url, r.nome, null, null));
  const cookies = {
    banner: { detectado: bannerDetectado, mencoes: cookiesMencao.slice(0, 5).map((n) => ({ pagina: n.pagina, seletor: n.seletor, trecho: cortar(n.texto, 200) })), botoes: botoesBanner, temBotaoAceitar: botoesBanner.aceitar.length > 0, temBotaoRecusar: botoesBanner.recusar.length > 0, temBotaoGerenciar: botoesBanner.gerenciar.length > 0 },
    plataformasCmp: cmpUnicos.slice(0, LIMITE_LISTA),
    nomesCmp: [...new Set(cmpUnicos.map((c) => c.nome))],
    indiciosSeletor: unicos(indiciosSeletor, (i) => i.valor).slice(0, 10),
    apisConsentimento: unicos(apisConsentimento, (a) => a.api + a.origem).slice(0, 10),
    rastreadores: rastreadoresUnicos.slice(0, LIMITE_LISTA),
    nomesRastreadores: [...new Set(rastreadoresUnicos.map((r) => r.nome))],
    rastreadorConfirmadoPorRequisicao: rastreadoresUnicos.some((r) => r.via === 'requisicao'),
    temRastreador: rastreadoresUnicos.length > 0,
    temIndicioDeBannerOuGestao: bannerDetectado || cmpUnicos.length > 0 || indiciosSeletor.length > 0 || apisConsentimento.length > 0,
    politicaDeCookies: { linkEncontrado: politicaCookies.linkEncontrado, links: politicaCookies.links.slice(0, 5) },
  };

  // ---------- (d) encarregado / DPO ----------
  const termosEnc = [];
  const emailsEnc = [];
  const varrerEnc = (texto, pagina, seletor, versaoEv, origem) => {
    for (const m of texto.matchAll(RE_ENCARREGADO)) termosEnc.push({ termo: m[0], pagina, seletor, versao: versaoEv, origem, trecho: janela(texto, m.index, m[0].length) });
    for (const m of texto.matchAll(RE_EMAIL_PRIVACIDADE)) emailsEnc.push({ email: m[0].toLowerCase(), pagina, seletor, versao: versaoEv, origem, trecho: janela(texto, m.index, m[0].length) });
  };
  for (const n of visiveis) varrerEnc(n.texto, n.pagina, n.seletor, n.versao, 'pagina-amostrada');
  for (const l of todosLinks) if (/^mailto:/i.test(l.hrefAttr || '')) varrerEnc(l.hrefAttr.replace(/^mailto:/i, ''), l.pagina, l.seletor, l.versao, 'mailto');
  for (const [u, t] of textoPorUrlAlvo) if (!sampledPorUrl.has(u)) varrerEnc(t, caminhoDe(u), null, null, 'pagina-alvo');
  const encarregado = {
    termos: unicos(termosEnc, (x) => x.termo.toLowerCase() + x.pagina + (x.seletor || '')).slice(0, LIMITE_LISTA),
    emails: unicos(emailsEnc, (x) => x.email).slice(0, LIMITE_LISTA),
    presente: termosEnc.length > 0 || emailsEnc.length > 0,
    paginasInspecionadas: [...paginasInspecionadas],
  };
  [...encarregado.termos, ...encarregado.emails].slice(0, 10).forEach((x) => ev(x.pagina, x.versao || 'final', x.seletor, x.trecho, x.termo || x.email, null, true));

  // ---------- (e) formulários que coletam dados pessoais ----------
  const formularios = [];
  const checkboxes = [];
  const RE_PRIV_FORM = /(privacidade|privacy|lgpd|prote[cç][aã]o\s+de\s+dados|termos)/i;
  for (const p of paginas) {
    const pagina = caminhoDe(p.url);
    let html = removerBlocos(String(p.final?.html || ''), '<!--', '-->');
    for (const tag of ['script', 'style', 'template']) html = removerBlocos(html, `<${tag}`, `</${tag}`);
    const regioes = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => ({ ini: m.index, fim: m.index + m[0].length, dentro: m[0] }));
    const forms = (p.final?.extr?.formularios || []);
    forms.forEach((f, k) => {
      if (!f.visivel || f.clone) return;
      const ehPessoal = (c) => {
        if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'search', 'password', 'file', 'image', 'reset'].includes((c.tipo || '').toLowerCase())) return false;
        if (c.tag !== 'input' && c.tag !== 'textarea' && c.tag !== 'select') return false;
        return ['email', 'tel'].includes((c.tipo || '').toLowerCase()) || /(e-?mail|\bname\b|nome|telefone|phone|fone|celular|whatsapp|cpf|cnpj|endere[cç]o|address)/i.test(`${c.nome || ''} ${c.placeholder || ''}`);
      };
      const pessoais = f.campos.filter(ehPessoal).map((c) => ({ tipo: c.tipo || c.tag, nome: c.nome }));
      const ignorado = f.campos.some((c) => (c.tipo || '').toLowerCase() === 'password') ? 'login' : f.campos.some((c) => (c.tipo || '').toLowerCase() === 'search') ? 'busca' : null;
      const reg = regioes.length === forms.length ? regioes[k] : null;
      let linkPriv = null;
      let local = null;
      if (reg) {
        const ao = html.slice(Math.max(0, reg.ini - 300), reg.fim + 400);
        for (const [onde, trecho] of [['dentro-do-form', reg.dentro], ['ao-redor', ao]]) {
          for (const m of trecho.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
            const t = htmlParaTexto(m[2]);
            if (RE_PRIV_FORM.test(m[1]) || RE_PRIV_FORM.test(t)) { linkPriv = { href: m[1], texto: cortar(t, 80) }; local = onde; break; }
          }
          if (linkPriv) break;
        }
      }
      const textoAoRedor = f.textoAoRedor || '';
      const mencionaNoTexto = RE_PRIV_FORM.test(textoAoRedor) || (reg ? RE_PRIV_FORM.test(htmlParaTexto(reg.dentro)) : false);
      const item = {
        pagina, seletor: f.seletor, action: f.action, metodo: f.metodo, camposPessoais: pessoais, coletaDadoPessoal: pessoais.length > 0, ignorado,
        linkPrivacidade: linkPriv, localDoLink: local, mencionaPrivacidadeNoTexto: mencionaNoTexto, temLinkOuAviso: !!linkPriv || mencionaNoTexto,
        formularioDeContato: f.campos.some((c) => c.tag === 'textarea'),
        textoAoRedor: cortar(textoAoRedor, 160),
        medidoPorHtml: !!reg,
      };
      formularios.push(item);
      if (item.coletaDadoPessoal) ev(pagina, 'final', f.seletor, `form com ${pessoais.map((c) => c.tipo + (c.nome ? ':' + c.nome : '')).join(', ')}`, item.temLinkOuAviso ? 'com-aviso' : 'sem-aviso', pessoais.length, true);
    });
    // checkboxes pré-marcados (HTML cru e final)
    for (const [ver, h] of [['cru', p.cru?.html], ['final', p.final?.html]]) {
      const hh = String(h || '');
      for (const m of hh.matchAll(/<input\b[^>]*>/gi)) {
        const tag = m[0];
        if (!/type\s*=\s*["']?checkbox/i.test(tag) || !/\schecked(?=[\s=>/])/i.test(tag)) continue;
        const attr = (nome) => (tag.match(new RegExp(`\\b${nome}\\s*=\\s*["']([^"']*)["']`, 'i')) || [])[1] || '';
        const depois = htmlParaTexto(hh.slice(m.index + tag.length, m.index + tag.length + 200)).slice(0, 100);
        const rotuloOuNome = `${attr('name')} ${attr('id')} ${attr('value')} ${attr('aria-label')} ${depois}`;
        checkboxes.push({ pagina, versao: ver, nome: attr('name') || null, id: attr('id') || null, textoAoLado: depois, consentimentoRelacionado: /(aceito|concordo|consent|newsletter|ofertas|marketing|receber|termos|privacidade|lgpd)/i.test(rotuloOuNome) });
      }
    }
  }
  const formulariosDados = {
    total: formularios.length,
    coletamDadoPessoal: formularios.filter((f) => f.coletaDadoPessoal && !f.ignorado).length,
    semLinkOuAviso: formularios.filter((f) => f.coletaDadoPessoal && !f.ignorado && !f.temLinkOuAviso).length,
    itens: formularios.slice(0, LIMITE_LISTA),
  };
  const checkboxesPreMarcados = unicos(checkboxes, (c) => c.pagina + c.nome + c.id + c.versao).slice(0, LIMITE_LISTA);

  // ---------- (g) promessas de ganho/resultado ----------
  const fontesPromessa = visiveis.filter((n) => ['h1', 'h2', 'h3', 'button', 'a'].includes(n.tag)).map((n) => ({ onde: n.tag, pagina: n.pagina, seletor: n.seletor, versao: n.versao, texto: n.texto }));
  for (const p of paginas) {
    const pagina = caminhoDe(p.url);
    const extr = p.final?.extr;
    if (extr?.titulo) fontesPromessa.push({ onde: 'title', pagina, seletor: 'head>title', versao: 'final', texto: extr.titulo });
    // O texto de um título/link inclui o dos filhos (ex.: <h1>… <span>+R$ 3.000</span></h1>): os nós de texto sozinhos perdem isso.
    for (const h of extr?.headings || []) if (h.visivel && !h.clone && h.nivel <= 3) fontesPromessa.push({ onde: `h${h.nivel}`, pagina, seletor: h.seletor, versao: 'final', texto: h.texto });
    for (const l of extr?.links || []) if (l.visivel && !l.clone && l.texto) fontesPromessa.push({ onde: 'a', pagina, seletor: l.seletor, versao: 'final', texto: l.texto });
    for (const m of extr?.metas || []) {
      const nome = (m.nome || m.propriedade || '').toLowerCase();
      if (m.conteudo && ['description', 'og:title', 'og:description', 'twitter:title', 'twitter:description'].includes(nome)) fontesPromessa.push({ onde: `meta:${nome}`, pagina, seletor: `meta[${m.nome ? 'name' : 'property'}="${nome}"]`, versao: 'final', texto: m.conteudo });
    }
  }
  const promessas = [];
  for (const f of fontesPromessa) {
    for (const pad of PADROES_PROMESSA) {
      for (const m of f.texto.matchAll(pad.re)) promessas.push({ padrao: pad.id, trecho: m[0], onde: f.onde, pagina: f.pagina, seletor: f.seletor, versao: f.versao, texto: cortar(f.texto, 200) });
    }
  }
  const promessasUnicas = unicos(promessas, (x) => x.padrao + '|' + x.trecho + '|' + x.pagina + '|' + x.seletor).slice(0, LIMITE_LISTA);
  promessasUnicas.forEach((x) => ev(x.pagina, x.versao, x.seletor, x.trecho, x.padrao, null, true));

  // ---------- (h) escassez / urgência ----------
  const diffsPorPagina = new Map();
  for (const p of paginas) {
    let d = [];
    try { d = compararVersoes({ cru: p.cru?.extr, dom250: p.dom250?.extr, final: p.final?.extr }); } catch { d = []; }
    diffsPorPagina.set(caminhoDe(p.url), d);
  }
  const escItens = [];
  for (const n of visiveis) {
    for (const pad of PADROES_ESCASSEZ) {
      for (const m of n.texto.matchAll(pad.re)) {
        const dif = (diffsPorPagina.get(n.pagina) || []).find((d) => d.seletor === n.seletor) || null;
        escItens.push({
          tipo: pad.tipo, trecho: m[0], texto: cortar(n.texto, 160), pagina: n.pagina, seletor: n.seletor, versao: n.versao,
          mudaEntreVersoes: dif ? { versoes: dif.versoes, leituras: dif.leituras, tendencia: dif.tendencia, contadorAnimado: dif.contadorAnimado } : null,
        });
      }
    }
  }
  const escUnicos = unicos(escItens, (x) => x.tipo + x.trecho + x.pagina + x.seletor).slice(0, LIMITE_LISTA);
  escUnicos.forEach((x) => ev(x.pagina, x.versao, x.seletor, x.trecho, x.tipo, null, true));
  const elementosContador = [];
  for (const p of paginas) {
    for (const a of [...valoresDeAtributos(p.final?.html), ...valoresDeAtributos(p.cru?.html)]) if (/countdown|timer|contador|cron[oô]metro/i.test(a)) elementosContador.push({ valor: cortar(a, 100), pagina: caminhoDe(p.url) });
  }
  const padroesJs = [];
  for (const c of codigos) for (const re of PADROES_ESCASSEZ_JS) for (const m of c.texto.matchAll(re)) padroesJs.push({ trecho: janela(c.texto, m.index, m[0].length, 40), origem: cortar(c.origem, 200) });
  const variacoesNumericas = [];
  for (const [pagina, ds] of diffsPorPagina) for (const d of ds) if (d.visivelNoFinal) variacoesNumericas.push({ pagina, seletor: d.seletor, versoes: d.versoes, leituras: d.leituras, tendencia: d.tendencia, contadorAnimado: d.contadorAnimado });
  const escassez = {
    itens: escUnicos,
    contadoresRegressivos: escUnicos.filter((x) => x.tipo === 'contador-regressivo' || x.tipo === 'contador-dias-horas').length,
    elementosContador: unicos(elementosContador, (e) => e.valor + e.pagina).slice(0, 10),
    padroesEmJs: unicos(padroesJs, (x) => x.trecho + x.origem).slice(0, 10),
    variacoesNumericas: variacoesNumericas.slice(0, 30),
    recargaNaoMedida: true,
  };

  // ---------- (i) texto oculto relevante (SEPARADO do visível) ----------
  const ocultosRelevantes = unicos(ocultos.filter((n) => RE_RELEVANTE_OCULTO.test(n.texto)), (n) => n.pagina + n.seletor + normalizarTexto(n.texto)).slice(0, LIMITE_LISTA).map((n) => ({ pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: cortar(n.texto, 200), ocultoPor: n.ocultoPor, visivel: false }));
  ocultosRelevantes.slice(0, 10).forEach((o) => ev(o.pagina, o.versao, o.seletor, o.trecho, 'oculto:' + o.ocultoPor, null, false));

  // ---------- termos em texto visível e nas páginas-alvo (arrependimento, frete) ----------
  const buscarTermos = (re) => {
    const out = [];
    for (const n of visiveis) for (const m of n.texto.matchAll(re)) out.push({ termo: m[0], pagina: n.pagina, seletor: n.seletor, versao: n.versao, origem: 'pagina-amostrada', trecho: janela(n.texto, m.index, m[0].length) });
    for (const [u, t] of textoPorUrlAlvo) if (!sampledPorUrl.has(u)) for (const m of t.matchAll(re)) out.push({ termo: m[0], pagina: caminhoDe(u), seletor: null, versao: null, origem: 'pagina-alvo', trecho: janela(t, m.index, m[0].length) });
    return unicos(out, (x) => x.termo.toLowerCase() + x.pagina + (x.seletor || '')).slice(0, 15);
  };
  const ocArrep = buscarTermos(RE_TERMO_ARREPENDIMENTO);
  const ocEntrega = buscarTermos(RE_TERMO_ENTREGA);

  // ---------- (j) contato / endereço ----------
  const telefones = [];
  const emails = [];
  const ceps = [];
  const logradouros = [];
  for (const n of visiveis) {
    const sem = n.texto.replace(RE_CNPJ, ' ');
    for (const re of RE_TELEFONE) for (const m of sem.matchAll(re)) telefones.push({ valor: m[0].trim(), pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.index, m[0].length) });
    for (const m of acharEmails(sem)) if (!/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(m.valor)) emails.push({ valor: m.valor.toLowerCase(), pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.indice, m.valor.length) });
    for (const m of n.texto.matchAll(RE_CEP)) ceps.push({ valor: m[0], pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.index, m[0].length) });
    for (const m of n.texto.matchAll(RE_LOGRADOURO)) logradouros.push({ valor: cortar(m[0], 100), pagina: n.pagina, seletor: n.seletor, versao: n.versao, trecho: janela(n.texto, m.index, m[0].length) });
  }
  const linksMailto = todosLinks.filter((l) => /^mailto:/i.test(l.hrefAttr || ''));
  const linksTel = todosLinks.filter((l) => /^tel:/i.test(l.hrefAttr || ''));
  const linksWhats = todosLinks.filter((l) => /(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|^whatsapp:)/i.test(l.hrefAttr || ''));
  const fmtLink = (l) => ({ href: l.hrefAttr, texto: cortar(l.texto, 60), pagina: l.pagina, seletor: l.seletor });
  const postais = [];
  const percorrer = (o, pagina) => {
    if (Array.isArray(o)) return o.forEach((x) => percorrer(x, pagina));
    if (o && typeof o === 'object') {
      const tipos = [].concat(o['@type'] || []);
      if (tipos.includes('PostalAddress')) postais.push({ pagina, streetAddress: o.streetAddress ?? null, postalCode: o.postalCode ?? null, addressLocality: o.addressLocality ?? null });
      Object.values(o).forEach((x) => percorrer(x, pagina));
    }
  };
  for (const p of paginas) for (const j of [...(p.final?.extr?.jsonld || []), ...(p.cru?.extr?.jsonld || [])]) { try { percorrer(JSON.parse(j), caminhoDe(p.url)); } catch { /* JSON-LD inválido: outro medidor */ } }
  const linksAtendimento = unicos(visiveis.filter((n) => n.tag === 'a' && RE_TERMO_ATENDIMENTO.test(n.texto) && n.texto.length <= 60), (n) => n.pagina + n.seletor).slice(0, 10).map((n) => ({ texto: n.texto, pagina: n.pagina, seletor: n.seletor }));
  const todosEmails = unicos([...emails, ...linksMailto.map((l) => ({ valor: l.hrefAttr.replace(/^mailto:/i, '').split('?')[0].toLowerCase(), pagina: l.pagina, seletor: l.seletor, versao: l.versao, trecho: l.hrefAttr }))], (e) => e.valor);
  const contato = {
    telefones: unicos(telefones, (t) => t.valor.replace(/\D/g, '')).slice(0, 10),
    linksTel: linksTel.slice(0, 10).map(fmtLink),
    emails: todosEmails.slice(0, 10),
    linksMailto: linksMailto.slice(0, 10).map(fmtLink),
    whatsapp: linksWhats.slice(0, 10).map(fmtLink),
    ceps: unicos(ceps, (c) => c.valor).slice(0, 10),
    logradouros: unicos(logradouros, (l) => l.valor).slice(0, 10),
    jsonLdPostalAddress: postais.slice(0, 5),
    formulariosDeContato: formularios.filter((f) => f.formularioDeContato).length,
    linksAtendimento,
    enderecoFisicoPresente: logradouros.length > 0 || ceps.length > 0 || postais.some((x) => x.streetAddress),
    canalDeAtendimentoPresente: telefones.length > 0 || linksTel.length > 0 || todosEmails.length > 0 || linksWhats.length > 0 || formularios.some((f) => f.formularioDeContato) || linksAtendimento.length > 0,
    paginasInspecionadas: paginasAmostradas.map((p) => p.url),
  };
  [...contato.telefones.slice(0, 2), ...contato.emails.slice(0, 2), ...contato.ceps.slice(0, 2), ...contato.logradouros.slice(0, 2)].forEach((x) => ev(x.pagina, x.versao, x.seletor, x.trecho, x.valor, null, true));

  const dados = {
    paginasAmostradas,
    paginasInspecionadas: [...paginasInspecionadas],
    oferta,
    cnpj,
    privacidade,
    termos,
    cookies,
    encarregado,
    formularios: formulariosDados,
    checkboxesPreMarcados,
    precos: precosDados,
    promessas: { itens: promessasUnicas, total: promessasUnicas.length },
    escassez,
    ocultosRelevantes,
    arrependimento: { mencionado: ocArrep.length > 0, ocorrencias: ocArrep, paginasInspecionadas: [...paginasInspecionadas] },
    prazoEntregaFrete: { mencionado: ocEntrega.length > 0, ocorrencias: ocEntrega },
    contato,
    rotasComunsTestadas: rotasTestadas,
    limitacoes: [
      'Só fatos de presença/ausência no código e no texto; nenhuma conclusão jurídica.',
      'Texto oculto (visivel=false) fica só em ocultosRelevantes e nunca entra nos demais fatos.',
      'Ausência só vale para as paginasInspecionadas.',
      'Escassez: não recarrega a página; só compara cru, dom250 e final (recargaNaoMedida).',
      'IDs de analytics vazios (lei-analytics-id-vazio) são medidos pelo medidor js, não por este.',
    ],
  };
  return saidaMedidor(id, dados, evidencias, versao);
}
