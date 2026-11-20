// Detecção heurística do TIPO DE SITE (M3.3 / SPEC §3).
//
// ATENÇÃO: isto é HEURÍSTICA, não veredito. O script soma pontos por sinais encontrados no que o visitante vê
// (texto visível e não-clone, links, formulários, tamanho da página, JSON-LD) e devolve um ranking com a
// confiança. Quem confirma ou ajusta o tipo é o modelo (SPEC §3), ou a pessoa via --tipo.
//
// Tipos: site-institucional, landing-page, blog, catalogo, loja, cardapio, agendamento, pagina-de-vendas,
//        portfolio, link-na-bio, area-de-membros.
//
// PESOS (pontos somados por tipo; o primeiro número é o máximo aproximado daquele sinal):
//  loja            : "adicionar ao carrinho" repetido 4 | 1x 2 | carrinho/sacola/finalizar compra 2 | preços em R$ 2 (1 se só um)
//                    | comprar 1 | frete/parcelamento 1 | JSON-LD Product/Offer com carrinho 2
//  cardapio        : palavra "cardápio" 3 | seções culinárias (entradas, pratos, sobremesas, bebidas...) 3 | horário de funcionamento/almoço/jantar 1,5
//                    | delivery/pedir/WhatsApp 1,5 | muitos preços sem carrinho 1,5 | JSON-LD Restaurant/Menu 3
//  agendamento     : agendar/agende/reservar/marcar 3 | "horários disponíveis"/escolha a data 2 | campos de data/hora no formulário 3
//                    | consulta/sessão/profissional/remarcar 1
//  pagina-de-vendas: MESMO CTA repetido 3+ vezes 4 (2 vezes 1,5) | página longa (altura >= 4500 px ou >= 800 palavras) 2
//                    | garantia 2 | FAQ 1,5 | depoimentos 1,5 | "de R$ x por R$ y" 2 | acesso imediato/bônus/vagas/oferta 1,5 | investimento 1
//                    | "o que você vai aprender"/"para quem é" 1
//  landing-page    : poucos links internos 2 | formulário com e-mail 3 | verbos de isca (baixe, receba, gratuito, guia...) 2
//                    | texto curto (40-500 palavras) 1,5 | página curta 1 | até 2 CTAs distintos 1
//  blog            : datas de publicação (3+) 3 | "leia mais"/"continuar lendo" 2 | publicado em/por autor 1,5 | categorias/tags 1
//                    | links /blog/, /post/, /artigo/ 3 | palavra "blog" 1,5 | JSON-LD Blog/BlogPosting 2
//  portfolio       : palavra "portfólio" 3 | projetos/cases/galeria/ver projeto 3 | 4+ imagens 1,5 | "sobre mim"/"vamos trabalhar juntos" 1,5
//                    | profissão criativa 1 | links /projetos/, /cases/ 2
//  catalogo        : palavra "catálogo" 3 | orçamento/consulte 2,5 | ver detalhes/referência/linha de produtos 2 | 4+ imagens sem carrinho 2
//                    | preços sem carrinho 1,5 | links /produtos/ 2 | (carrinho presente: -3)
//  link-na-bio     : pouco texto e 4+ links, maioria externos (<= 120 palavras) 4 (1 se for menu interno) | links majoritariamente externos 2 | redes sociais/WhatsApp 3
//                    | página curta 1 | no máx. 1 heading 1 | "links"/"bio" no título 1 | (texto longo: -3)
//  area-de-membros : campo de senha 3 | "área de membros/do aluno/minha conta" 3 | entrar/login/esqueci minha senha 2,5
//                    | aulas/módulos/progresso/certificado 2 | tela de login curta 1
//  site-institucional: menu com sobre/serviços/equipe/contato (4 itens: 4) | quem somos/missão/nossa história 2 | endereço/telefone 1
//                    | 5+ links internos 1,5 | páginas amostradas sobre/serviços/contato (até 3) | base 0,5
//
// CONFIANÇA: alta = 1º colocado com >= 3 pontos e pelo menos 1,6x o 2º; media = >= 3 pontos e >= 1,25x o 2º;
//            baixa = o resto (empate técnico ou poucos sinais). Calibre os limiares no teste de acerto (MT).
import { normalizarParaBusca } from './secoes-carregador.mjs';

export const TIPOS = ['site-institucional', 'landing-page', 'blog', 'catalogo', 'loja', 'cardapio', 'agendamento', 'pagina-de-vendas', 'portfolio', 'link-na-bio', 'area-de-membros'];
export const VERSAO = '1';

const caminhoDe = (url) => { try { const u = new URL(url); return u.pathname; } catch { return String(url); } };

// ---------- utilidades de texto ----------
const comecaCom = (termo) => new RegExp(`(?<![\\p{L}\\p{N}])${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}`, 'u');
const temTermo = (texto, termo) => comecaCom(termo).test(texto);
const termosPresentes = (texto, lista) => lista.filter((t) => temTermo(texto, t));
const contar = (texto, re) => (texto.match(re) || []).length;

const MESES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const REDES = ['instagram.com', 'wa.me', 'whatsapp.com', 'api.whatsapp', 'tiktok.com', 'youtube.com', 'youtu.be', 'facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'spotify.com', 't.me', 'pinterest.com', 'linktr.ee', 'kwai.com', 'threads.net'];

function tiposJsonLd(extr) {
  const tipos = new Set();
  const visitar = (o) => {
    if (Array.isArray(o)) return o.forEach(visitar);
    if (o && typeof o === 'object') {
      const t = o['@type'];
      for (const x of Array.isArray(t) ? t : (t ? [t] : [])) tipos.add(String(x));
      for (const v of Object.values(o)) if (v && typeof v === 'object') visitar(v);
    }
  };
  for (const s of extr.jsonld || []) { try { visitar(JSON.parse(s)); } catch { /* JSON-LD inválido: ignora */ } }
  for (const m of extr.microdata || []) tipos.add(String(m).split('/').pop());
  return tipos;
}

function coletar(ctx) {
  const paginas = (ctx.paginas || []).filter((p) => p?.final?.extr);
  if (!paginas.length) return null;
  const home = paginas.find((p) => { try { const u = new URL(p.url); return u.pathname === '/' && u.origin === ctx.site?.origem; } catch { return false; } }) || paginas[0];
  const extr = home.final.extr;
  const nos = (extr.nos || []).filter((n) => n.visivel && !n.clone);
  const textoBruto = nos.map((n) => n.texto).join(' ');
  const texto = normalizarParaBusca(textoBruto);
  const palavras = texto ? texto.split(' ').length : 0;
  const links = (extr.links || []).filter((l) => l.visivel && !l.clone);
  const internosNaoAncora = new Set();
  for (const p of paginas) {
    for (const l of (p.final.extr.links || [])) {
      if (!l.interno || !l.visivel || l.clone) continue;
      if (!l.hrefAttr || l.hrefAttr.startsWith('#') || /^(mailto|tel|javascript):/i.test(l.hrefAttr)) continue;
      try { const u = new URL(l.href); const c = u.pathname.replace(/\/index\.html?$/, '/'); if (c !== '/') internosNaoAncora.add(c.toLowerCase()); } catch { /* href estranho */ }
    }
  }
  const caminhosLinks = [...internosNaoAncora];
  const externos = links.filter((l) => !l.interno && /^https?:/i.test(l.href || ''));
  const imagens = (extr.imagens || []).filter((i) => i.visivel && !i.clone);
  const formularios = (extr.formularios || []).filter((f) => f.visivel !== false && !f.clone);
  const campos = formularios.flatMap((f) => f.campos || []);
  // CTAs: textos curtos de links e botões visíveis
  const rotulos = [
    ...links.map((l) => normalizarParaBusca(l.texto || l.ariaLabel || '')),
    ...nos.filter((n) => n.tag === 'button').map((n) => normalizarParaBusca(n.texto)),
  ].filter((t) => t && t.length <= 45 && t.split(' ').length <= 8);
  const contagemRotulos = new Map();
  for (const r of rotulos) contagemRotulos.set(r, (contagemRotulos.get(r) || 0) + 1);
  const ctaMaisRepetido = [...contagemRotulos.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const todosCaminhosAmostrados = paginas.map((p) => caminhoDe(p.url).toLowerCase());
  return {
    paginas, home, extr, texto, textoBruto, palavras, links, externos, imagens, formularios, campos,
    ctaMaisRepetido, ctasDistintos: new Set(rotulos).size, caminhosLinks, todosCaminhosAmostrados,
    altura: extr.alturaDocumento || 0, headings: (extr.headings || []).filter((h) => h.visivel && !h.clone),
    titulo: normalizarParaBusca(extr.titulo || ''), jsonld: tiposJsonLd(extr),
    rotulosDeLinks: links.map((l) => normalizarParaBusca(`${l.texto} ${l.ariaLabel || ''}`)),
    precos: contar(texto, /r\$\s?\d/g),
  };
}

// ---------- regras por tipo ----------
function pontuar(f) {
  const pontos = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  const sinais = [];
  const s = (tipo, sinal, p, evidencia) => { if (!p) return; pontos[tipo] += p; sinais.push({ tipo, sinal, pontos: p, evidencia }); };
  const T = f.texto;

  // --- loja ---
  const addCarrinho = contar(T, /adicionar (ao|a|na) (carrinho|sacola)|add to cart|comprar agora|colocar no carrinho/g);
  const carrinho = termosPresentes(T, ['carrinho', 'sacola', 'finalizar compra', 'checkout']);
  const temCarrinho = addCarrinho > 0 || carrinho.length > 0;
  if (addCarrinho >= 2) s('loja', 'botão de compra repetido', 4, `${addCarrinho}x "adicionar ao carrinho"/"comprar agora"`);
  else if (addCarrinho === 1) s('loja', 'botão de compra', 2, '1x "adicionar ao carrinho"/"comprar agora"');
  if (carrinho.length) s('loja', 'carrinho/sacola/checkout', 2, carrinho.join(', '));
  if (f.precos >= 2) s('loja', 'preços em R$', 2, `${f.precos} preços`); else if (f.precos === 1) s('loja', 'um preço em R$', 1, '1 preço');
  if (temTermo(T, 'comprar') && f.precos >= 1) s('loja', 'comprar', 1, '"comprar" com preço');
  const frete = termosPresentes(T, ['frete', 'parcele', 'parcelamento', 'sem juros']);
  if (frete.length) s('loja', 'frete/parcelamento', 1, frete.join(', '));
  if ((f.jsonld.has('Product') || f.jsonld.has('Offer')) && temCarrinho) s('loja', 'JSON-LD Product/Offer com carrinho', 2, 'JSON-LD');

  // --- cardápio ---
  if (temTermo(T, 'cardapio')) s('cardapio', 'palavra "cardápio"', 3, 'cardápio');
  const culin = termosPresentes(T, ['entradas', 'pratos principais', 'pratos', 'sobremesas', 'bebidas', 'porcoes', 'lanches', 'pizzas', 'massas', 'sucos', 'petiscos', 'drinks', 'saladas', 'acompanhamentos']);
  if (culin.length >= 3) s('cardapio', 'seções culinárias', 3, culin.join(', ')); else if (culin.length === 2) s('cardapio', 'seções culinárias', 1.5, culin.join(', '));
  const horario = termosPresentes(T, ['horario de funcionamento', 'funcionamos', 'almoco', 'jantar', 'aberto de', 'aberto das']);
  if (horario.length) s('cardapio', 'horário de funcionamento', 1.5, horario.join(', '));
  const pedir = termosPresentes(T, ['delivery', 'ifood', 'peca pelo whatsapp', 'faca seu pedido', 'faca o seu pedido', 'pedir', 'reserve sua mesa', 'retirada no balcao']);
  if (pedir.length) s('cardapio', 'delivery/pedido', 1.5, pedir.join(', '));
  if (f.precos >= 4 && !temCarrinho) s('cardapio', 'muitos preços sem carrinho', 1.5, `${f.precos} preços`);
  if (['Restaurant', 'Menu', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Bakery'].some((t) => f.jsonld.has(t))) s('cardapio', 'JSON-LD de restaurante/menu', 3, 'JSON-LD');

  // --- agendamento ---
  const agendar = termosPresentes(T, ['agende', 'agendar', 'agendamento', 'marcar horario', 'marque', 'reservar', 'reserve', 'marcar consulta']);
  if (agendar.length) s('agendamento', 'verbos de agendar/reservar', 3, agendar.join(', '));
  const dispo = termosPresentes(T, ['horarios disponiveis', 'horario disponivel', 'escolha a data', 'escolha o horario', 'escolha o dia', 'proximo horario', 'confirmacao do horario', 'confirmacao por whatsapp']);
  if (dispo.length) s('agendamento', 'horários disponíveis', 2, dispo.join(', '));
  const camposData = f.campos.filter((c) => ['date', 'time', 'datetime-local'].includes(String(c.tipo || '').toLowerCase()) || /^(data|hora|horario|dia)$/i.test(c.nome || ''));
  if (camposData.length) s('agendamento', 'campos de data/hora no formulário', 3, camposData.map((c) => c.nome || c.tipo).join(', '));
  const sessao = termosPresentes(T, ['consulta', 'sessao', 'profissional', 'remarcar', 'cancelamento']);
  if (sessao.length) s('agendamento', 'consulta/sessão/remarcar', 1, sessao.join(', '));

  // --- página de vendas ---
  const [ctaTexto, ctaQtd] = f.ctaMaisRepetido;
  if (ctaQtd >= 3 && ctaTexto) s('pagina-de-vendas', 'mesmo CTA repetido', 4, `"${ctaTexto}" x${ctaQtd}`);
  else if (ctaQtd === 2 && ctaTexto) s('pagina-de-vendas', 'CTA repetido 2x', 1.5, `"${ctaTexto}" x2`);
  if (f.altura >= 4500 || f.palavras >= 800) s('pagina-de-vendas', 'página longa', 2, `${f.altura}px, ${f.palavras} palavras`);
  else if (f.altura >= 3000) s('pagina-de-vendas', 'página média/longa', 1, `${f.altura}px`);
  if (temTermo(T, 'garantia')) s('pagina-de-vendas', 'garantia', 2, 'garantia');
  if (termosPresentes(T, ['perguntas frequentes', 'duvidas frequentes', 'faq']).length) s('pagina-de-vendas', 'FAQ', 1.5, 'perguntas frequentes');
  const depo = termosPresentes(T, ['depoimento', 'depoimentos', 'o que dizem', 'alunos', 'alunas', 'historias de sucesso', 'resultados reais']);
  if (depo.length) s('pagina-de-vendas', 'depoimentos', 1.5, depo.join(', '));
  if (/de r\$\s?[\d.,]+\s+(por|para)\s+(apenas\s+)?r\$\s?\d/.test(T)) s('pagina-de-vendas', '"de R$ x por R$ y"', 2, 'preço riscado');
  const urgencia = termosPresentes(T, ['acesso imediato', 'bonus', 'vagas', 'ultimas', 'oferta', 'so hoje', 'por tempo limitado']);
  if (urgencia.length >= 2) s('pagina-de-vendas', 'acesso imediato/bônus/vagas', 1.5, urgencia.join(', '));
  if (temTermo(T, 'investimento')) s('pagina-de-vendas', 'investimento', 1, 'investimento');
  const promessa = termosPresentes(T, ['o que voce vai aprender', 'para quem e', 'o que voce recebe', 'o que voce leva']);
  if (promessa.length) s('pagina-de-vendas', 'o que você vai aprender/para quem é', 1, promessa.join(', '));

  // --- landing page ---
  if (f.caminhosLinks.length <= 1) s('landing-page', 'quase nenhum link interno', 2, `${f.caminhosLinks.length} link(s) interno(s)`);
  const campoEmail = f.campos.some((c) => String(c.tipo || '').toLowerCase() === 'email' || /e-?mail/i.test(c.nome || ''));
  if (campoEmail) s('landing-page', 'formulário de captura (e-mail)', 3, 'campo de e-mail');
  const isca = termosPresentes(T, ['baixe', 'download', 'receba', 'cadastre', 'inscreva', 'ebook', 'e-book', 'livro digital', 'material gratuito', 'gratis', 'gratuito', 'guia', 'webinar', 'aula gratuita', 'lista de espera']);
  if (isca.length >= 2) s('landing-page', 'verbos de isca', 2, isca.join(', ')); else if (isca.length === 1) s('landing-page', 'verbo de isca', 1, isca[0]);
  if (f.palavras >= 40 && f.palavras <= 500) s('landing-page', 'texto curto', 1.5, `${f.palavras} palavras`);
  if (f.altura > 0 && f.altura < 3500) s('landing-page', 'página curta', 1, `${f.altura}px`);
  if (f.ctasDistintos >= 1 && f.ctasDistintos <= 2) s('landing-page', 'objetivo único (até 2 CTAs)', 1, `${f.ctasDistintos} CTA(s)`);

  // --- blog ---
  const datas = contar(T, new RegExp(`\\b\\d{1,2}\\s+de\\s+(${MESES})(\\s+de\\s+\\d{4})?\\b`, 'g')) + contar(T, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
  if (datas >= 3) s('blog', 'datas de publicação', 3, `${datas} datas`); else if (datas >= 1) s('blog', 'uma data', 1, `${datas} data`);
  const leia = contar(T, /leia mais|continuar lendo|ler mais|leia o post|ler artigo|leia o artigo/g);
  if (leia >= 2) s('blog', '"leia mais"', 2, `${leia}x`); else if (leia === 1) s('blog', '"leia mais"', 1, '1x');
  if (/(publicado|postado|escrito) (em|por)\b/.test(T)) s('blog', 'publicado em/por', 1.5, 'publicado em/por');
  if (termosPresentes(T, ['categoria', 'categorias', 'tags', 'arquivo']).length) s('blog', 'categorias/tags', 1, 'categorias/tags');
  const linksPosts = f.caminhosLinks.filter((c) => /\/(blog|posts?|artigos?|noticias|20\d\d)\//.test(c));
  if (linksPosts.length >= 2) s('blog', 'links de posts', 3, `${linksPosts.length} links (/blog/...)`);
  if (temTermo(f.titulo, 'blog') || f.rotulosDeLinks.some((r) => /^blog$/.test(r.trim()))) s('blog', 'palavra "blog"', 1.5, 'blog');
  if (['Blog', 'BlogPosting', 'Article', 'NewsArticle'].some((t) => f.jsonld.has(t))) s('blog', 'JSON-LD de blog/artigo', 2, 'JSON-LD');

  // --- portfólio ---
  if (termosPresentes(T + ' ' + f.titulo, ['portfolio', 'portifolio']).length) s('portfolio', 'palavra "portfólio"', 3, 'portfólio');
  const proj = termosPresentes(T, ['projetos selecionados', 'meus trabalhos', 'trabalhos selecionados', 'cases', 'case', 'galeria', 'projetos', 'ver projeto', 'ver case']);
  if (proj.length >= 2) s('portfolio', 'projetos/cases', 3, proj.join(', ')); else if (proj.length === 1) s('portfolio', 'projetos/cases', 1.5, proj[0]);
  if (f.imagens.length >= 4) s('portfolio', 'galeria de imagens', 1.5, `${f.imagens.length} imagens`);
  const eu = termosPresentes(T, ['sobre mim', 'vamos trabalhar', 'contrate', 'disponivel para']);
  if (eu.length) s('portfolio', 'sobre mim/vamos trabalhar juntos', 1.5, eu.join(', '));
  if (termosPresentes(T, ['designer', 'fotografo', 'fotografa', 'ilustrador', 'ilustradora', 'arquiteto', 'arquiteta', 'desenvolvedor', 'desenvolvedora', 'diretor de arte', 'freelancer']).length) s('portfolio', 'profissão criativa', 1, 'profissão criativa');
  const linksProj = f.caminhosLinks.filter((c) => /\/(projetos?|cases?|trabalhos?|portfolio)\//.test(c));
  if (linksProj.length >= 2) s('portfolio', 'links de projetos', 2, `${linksProj.length} links`);

  // --- catálogo ---
  if (temTermo(T + ' ' + f.titulo, 'catalogo')) s('catalogo', 'palavra "catálogo"', 3, 'catálogo');
  const orc = termosPresentes(T, ['orcamento', 'solicitar orcamento', 'consulte', 'sob consulta', 'cotacao', 'fale com a equipe', 'fale com um consultor']);
  if (orc.length) s('catalogo', 'orçamento/consulte', 2.5, orc.join(', '));
  const detalhes = termosPresentes(T, ['ver detalhes', 'detalhes do produto', 'saiba mais sobre o produto', 'referencia', 'ref.', 'codigo', 'modelo', 'linha de produtos', 'nossos produtos', 'produtos']);
  if (detalhes.length >= 2) s('catalogo', 'detalhes/referência/linha de produtos', 2, detalhes.join(', ')); else if (detalhes.length === 1) s('catalogo', 'detalhes/produtos', 1, detalhes[0]);
  if (f.imagens.length >= 4 && !temCarrinho) s('catalogo', 'galeria de imagens sem carrinho', 2, `${f.imagens.length} imagens`);
  if (f.precos >= 3 && !temCarrinho) s('catalogo', 'preços sem carrinho', 1.5, `${f.precos} preços`);
  const linksProd = f.caminhosLinks.filter((c) => /\/(produtos?|catalogo|itens?)\//.test(c));
  if (linksProd.length >= 3) s('catalogo', 'links de produtos', 2, `${linksProd.length} links`);
  if (temCarrinho) s('catalogo', 'há carrinho (é mais loja)', -3, 'carrinho');

  // --- link na bio ---
  // links de navegação interna (menu) não são "botões de bio": a pontuação cheia exige maioria de links externos.
  const maioriaExterna = f.links.length > 0 && f.externos.length / f.links.length >= 0.5;
  if (f.links.length >= 4 && f.palavras <= 120) s('link-na-bio', maioriaExterna ? 'muitos links externos e pouco texto' : 'muitos links e pouco texto (menu interno)', maioriaExterna ? 4 : 1, `${f.links.length} links, ${f.palavras} palavras`);
  else if (f.links.length >= 3 && f.palavras <= 150) s('link-na-bio', 'alguns links e pouco texto', maioriaExterna ? 2 : 0.5, `${f.links.length} links, ${f.palavras} palavras`);
  if (f.links.length >= 3 && f.externos.length / f.links.length >= 0.6) s('link-na-bio', 'links majoritariamente externos', 2, `${f.externos.length} de ${f.links.length}`);
  const redes = REDES.filter((d) => f.links.some((l) => (l.href || '').toLowerCase().includes(d)));
  if (redes.length >= 2) s('link-na-bio', 'redes sociais/WhatsApp', 3, redes.join(', ')); else if (redes.length === 1) s('link-na-bio', 'uma rede social', 1, redes[0]);
  if (f.altura > 0 && f.altura < 1800) s('link-na-bio', 'página curta', 1, `${f.altura}px`);
  if (f.headings.length <= 1) s('link-na-bio', 'no máximo 1 título', 1, `${f.headings.length} heading(s)`);
  if (temTermo(f.titulo, 'links') || temTermo(f.titulo, 'bio')) s('link-na-bio', 'título "links"/"bio"', 1, f.titulo);
  if (f.palavras > 300) s('link-na-bio', 'texto longo demais', -3, `${f.palavras} palavras`);

  // --- área de membros ---
  if (f.campos.some((c) => String(c.tipo || '').toLowerCase() === 'password')) s('area-de-membros', 'campo de senha', 3, 'input password');
  const areaMembros = termosPresentes(T + ' ' + f.titulo, ['area de membros', 'area do aluno', 'area do cliente', 'minha conta', 'meus cursos', 'portal do aluno', 'area restrita']);
  if (areaMembros.length) s('area-de-membros', 'área de membros/do aluno', 3, areaMembros.join(', '));
  const entrar = termosPresentes(T, ['entrar', 'login', 'acessar', 'faca login', 'esqueci minha senha', 'recuperar senha']);
  if (entrar.length >= 2) s('area-de-membros', 'entrar/login/senha', 2.5, entrar.join(', ')); else if (entrar.length === 1) s('area-de-membros', 'entrar/login', 1, entrar[0]);
  const aulas = termosPresentes(T, ['aulas', 'modulos', 'progresso', 'continuar assistindo', 'certificado', 'conteudo exclusivo', 'assinatura']);
  if (aulas.length >= 2) s('area-de-membros', 'aulas/módulos', 2, aulas.join(', ')); else if (aulas.length === 1) s('area-de-membros', 'aulas/módulos', 1, aulas[0]);
  if (f.campos.some((c) => String(c.tipo || '').toLowerCase() === 'password') && f.palavras <= 120) s('area-de-membros', 'tela de login curta', 1, `${f.palavras} palavras`);

  // --- institucional ---
  const menu = ['sobre', 'quem somos', 'servicos', 'produtos', 'equipe', 'contato', 'empresa', 'historia', 'clientes', 'solucoes', 'missao', 'institucional'];
  const noMenu = menu.filter((m) => f.rotulosDeLinks.some((r) => comecaCom(m).test(r)) || f.caminhosLinks.some((c) => c.includes(m.replace(' ', '-'))));
  if (noMenu.length >= 4) s('site-institucional', 'menu institucional', 4, noMenu.join(', '));
  else if (noMenu.length === 3) s('site-institucional', 'menu institucional', 3, noMenu.join(', '));
  else if (noMenu.length === 2) s('site-institucional', 'menu institucional', 1.5, noMenu.join(', '));
  const inst = termosPresentes(T, ['quem somos', 'nossa historia', 'missao', 'valores', 'nossa equipe', 'nossos servicos', 'nossos valores', 'fundada', 'desde']);
  const anos = /\bha \d+ anos\b/.test(T);
  if (inst.length + (anos ? 1 : 0) >= 2) s('site-institucional', 'quem somos/missão/história', 2, [...inst, ...(anos ? ['há N anos'] : [])].join(', '));
  else if (inst.length + (anos ? 1 : 0) === 1) s('site-institucional', 'quem somos/missão/história', 1, [...inst, ...(anos ? ['há N anos'] : [])].join(', '));
  if (/\(\d{2}\)\s?\d{4,5}[-\s]?\d{4}/.test(f.textoBruto) || termosPresentes(T, ['endereco', 'rua ', 'avenida ', 'cnpj']).length) s('site-institucional', 'endereço/telefone', 1, 'contato institucional');
  if (f.caminhosLinks.length >= 5) s('site-institucional', 'vários links internos', 1.5, `${f.caminhosLinks.length} caminhos`);
  const pg = ['sobre', 'servicos', 'contato', 'equipe'].filter((k) => f.todosCaminhosAmostrados.some((c) => c.includes(k)));
  if (pg.length) s('site-institucional', 'páginas amostradas institucionais', Math.min(3, pg.length), pg.join(', '));
  s('site-institucional', 'base', 0.5, 'qualquer site começa com 0,5');
  return { pontos, sinais };
}

export function detectarTipoDeSite(ctx) {
  const f = coletar(ctx);
  const zero = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  if (!f) return { tipo: null, confianca: 'baixa', pontos: zero, ranking: [], sinais: [], indisponivel: 'nenhuma página lida disponível', heuristica: true };
  const { pontos, sinais } = pontuar(f);
  const arred = Object.fromEntries(Object.entries(pontos).map(([k, v]) => [k, Math.round(Math.max(0, v) * 10) / 10]));
  const ranking = Object.entries(arred).map(([tipo, p]) => ({ tipo, pontos: p })).sort((a, b) => b.pontos - a.pontos || a.tipo.localeCompare(b.tipo));
  const [primeiro, segundo] = ranking;
  let confianca = 'baixa';
  if (primeiro.pontos >= 3) {
    const razao = segundo.pontos > 0 ? primeiro.pontos / segundo.pontos : Infinity;
    confianca = razao >= 1.6 ? 'alta' : (razao >= 1.25 ? 'media' : 'baixa');
  }
  return {
    tipo: primeiro.pontos > 0 ? primeiro.tipo : null,
    confianca,
    pontos: arred,
    ranking,
    sinais: sinais.filter((x) => x.tipo === primeiro.tipo || x.tipo === segundo.tipo).sort((a, b) => b.pontos - a.pontos),
    sinaisPorTipo: Object.fromEntries(TIPOS.map((t) => [t, sinais.filter((x) => x.tipo === t).length])),
    paginaAnalisada: caminhoDe(f.home.url),
    heuristica: true,
    nota: 'Heurística: soma de pontos por sinais. O modelo (ou --tipo) confirma ou ajusta; confiança baixa = empate técnico ou poucos sinais.',
  };
}
