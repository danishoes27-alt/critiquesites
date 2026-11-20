// Detectores do módulo "Subir no Google" (regras/seo-google.json). Só afirmam o que os medidores mediram
// (seo, jsonld, seo-google). Regras de heurística dizem isso na mensagem. Nenhuma promete posição no Google.
import { registrarContagem } from '../verificador.mjs';
import { extrairNumeros } from '../util.mjs';

// Contagens que o verificador sabe RECALCULAR a partir do extrator.
registrarContagem('seo-meta-nome', (ex, c) => (ex.metas || []).filter((m) => (m.nome || '').toLowerCase() === c.nome).length);
registrarContagem('seo-jsonld-tipo', (ex, c) => (ex.jsonld || []).filter((s) => new RegExp(`"@type"\\s*:\\s*(?:\\[[^\\]]{0,200})?"(?:https?://schema\\.org/)?${String(c.tipo).replace(/[^A-Za-z]/g, "")}"`).test(s)).length);

const TIPOS_ARTIGO = /^(Article|BlogPosting|NewsArticle)$/;
const TIPOS_LOCAL = /(LocalBusiness|Restaurant|Store|Dentist|Physician|Salon|Clinic|Bakery|CafeOrCoffeeShop|FoodEstablishment|HealthAndBeautyBusiness|ProfessionalService|AutoRepair|Hotel|GymOrHealthClub|Pharmacy|LegalService|RealEstateAgent|TravelAgency|AccountingService|HomeAndConstructionBusiness|BarOrPub)$/;
const TIPOS_ORG = /^(Organization|Corporation|NGO|OnlineStore)$/;
const TIPOS_LOCAIS_DE_SITE = new Set(['cardapio', 'agendamento', 'site-institucional']);

const nada = () => ({ disparou: false, intensidade: 0, achados: [] });
const plural = (n, s, p) => (n === 1 ? s : p);
const lista = (xs, n = 5) => xs.slice(0, n).join(', ') + (xs.length > n ? ' e outras' : '');
const clamp = (x) => Math.max(0, Math.min(1, x));

function base(ctx, med) {
  const g = med['seo-google']?.dados;
  if (!g || !g.paginas?.length) return null;
  const s = med.seo?.dados?.paginas || [];
  const j = med.jsonld?.dados || null;
  const porUrl = (arr, url) => (arr || []).find((x) => x.url === url) || null;
  const paginas = g.paginas.map((p) => ({ ...p, seo: porUrl(s, p.url), jsonld: porUrl(j?.paginas, p.url) }));
  return { g, j, paginas, site: g.site, tipo: ctx.site?.tipoDeSite || null };
}
const tiposDe = (p) => [...new Set([...(p.jsonld?.final?.jsonld?.tipos || []), ...(p.jsonld?.cru?.jsonld?.tipos || [])])];
const tiposDoSite = (b) => [...new Set(b.paginas.flatMap(tiposDe))];
const propsDe = (p, tipo) => [...new Set([...(p.jsonld?.final?.jsonld?.propriedadesPorTipo?.[tipo]?.propriedades || []), ...(p.jsonld?.cru?.jsonld?.propriedadesPorTipo?.[tipo]?.propriedades || [])])];
const pagExtr = (ctx, url) => ctx.paginas.find((p) => p.url === url);

function localDetectado(b) {
  if (TIPOS_LOCAIS_DE_SITE.has(b.tipo)) return true;
  if (tiposDoSite(b).some((t) => TIPOS_LOCAL.test(t))) return true;
  const temTel = b.site.telefonesDistintos.length > 0;
  const temEnd = b.paginas.some((p) => p.local.enderecos.length > 0 || p.local.ceps.length > 0);
  return temTel && temEnd;
}
const pareceArtigo = (b, p) => (b.tipo === 'blog' && !p.ehHome) || tiposDe(p).some((t) => TIPOS_ARTIGO.test(t));

function achado(ctx, p, { mensagem, evidencias, citacoes = [], numeros = [] }) {
  return { pagina: p.caminho, mensagem, evidencias, citacoes, numeros_permitidos: numeros.map(String) };
}
const evid = (p, seletor, valor, contagem, trecho = '') => ({ pagina: p.caminho, versao: 'final', seletor, trecho, valor, contagem });
const citContagem = (p, fn, extra, esperado) => ({ tipo: 'contagem', versoes: ['final'], pagina: p.url, contagem: { fn, ...extra, esperado } });

// ---------------------------------------------------------------- B. técnico
function detH1Ausente({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const aval = b.paginas.filter((p) => p.seo?.final);
  if (!aval.length) return null;
  const sem = aval.filter((p) => p.seo.final.h1.visiveisNaoClone === 0);
  if (!sem.length) return nada();
  const msg = `${sem.length} de ${aval.length} ${plural(aval.length, 'página', 'páginas')} ${plural(sem.length, 'não tem', 'não têm')} um título principal (H1) visível: ${lista(sem.map((p) => p.caminho))}. Heurística: o Google diz que a ordem dos títulos não importa para a busca; um H1 claro ajuda quem lê e quem usa leitor de tela.`;
  return { disparou: true, intensidade: clamp(sem.length / aval.length), achados: [achado(ctx, sem[0], { mensagem: msg, evidencias: sem.slice(0, 10).map((p) => evid(p, 'h1', 'ausente', 0)), citacoes: [citContagem(sem[0], 'h1-visiveis', {}, 0)], numeros: [sem.length, aval.length] })] };
}

function detViewport({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const sem = b.paginas.filter((p) => !p.viewport.presente || !p.viewport.temWidth);
  if (!sem.length) return nada();
  const p0 = sem[0];
  const msg = `${sem.length} de ${b.paginas.length} ${plural(b.paginas.length, 'página', 'páginas')} ${plural(sem.length, 'não tem', 'não têm')} a meta viewport com largura definida (${lista(sem.map((p) => p.caminho))}). Sem ela, celulares mostram a página em largura de computador.`;
  const cit = p0.viewport.presente
    ? [{ tipo: 'trecho', valor: p0.viewport.conteudo, onde: 'html', versoes: ['final'], pagina: p0.url }].filter((c) => c.valor)
    : [citContagem(p0, 'seo-meta-nome', { nome: 'viewport' }, 0)];
  return { disparou: true, intensidade: clamp(sem.length / b.paginas.length), achados: [achado(ctx, p0, { mensagem: msg, evidencias: sem.slice(0, 10).map((p) => evid(p, 'meta[name=viewport]', p.viewport.presente ? 'sem width' : 'ausente', 0)), citacoes: cit, numeros: [sem.length, b.paginas.length] })] };
}

function detOpenGraph({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const sem = b.paginas.filter((p) => p.og.faltando.length > 0);
  if (!sem.length) return nada();
  const p0 = sem[0];
  const msg = `${sem.length} de ${b.paginas.length} ${plural(b.paginas.length, 'página', 'páginas')} ${plural(sem.length, 'está', 'estão')} sem alguma meta Open Graph obrigatória (por exemplo ${p0.caminho} sem ${p0.og.faltando.join(', ')}). Isso NÃO muda a posição no Google: muda a prévia do link ao compartilhar.`;
  return { disparou: true, intensidade: clamp(sem.length / b.paginas.length), achados: [achado(ctx, p0, { mensagem: msg, evidencias: sem.slice(0, 10).map((p) => evid(p, 'meta[property^=og:]', p.og.faltando.join(' '), p.og.faltando.length)), numeros: [sem.length, b.paginas.length] })] };
}

function precisaTipo(b, tipos) { return tipos.includes(b.tipo); }

function detProdutoAusente({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  if (!precisaTipo(b, ['loja', 'catalogo', 'pagina-de-vendas'])) return null;
  const tem = tiposDoSite(b).includes('Product') || (b.j.site?.final?.tipos || []).includes('Product') || (b.j.site?.cru?.tipos || []).includes('Product');
  if (tem) return nada();
  const p0 = b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: `Este parece um site de venda (${b.tipo}) e nenhuma página tem dados estruturados do tipo Product (JSON-LD, microdata ou RDFa). O Google não garante que apareça nada na busca por causa deles.`, evidencias: [evid(p0, 'script[type="application/ld+json"]', 'Product ausente', 0)], citacoes: [citContagem(p0, 'seo-jsonld-tipo', { tipo: 'Product' }, 0)] })] };
}

function detProdutoIncompleto({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  const ruins = b.paginas.filter((p) => tiposDe(p).includes('Product')).filter((p) => { const pr = propsDe(p, 'Product'); return !['offers', 'review', 'aggregateRating'].some((k) => pr.includes(k)); });
  if (!b.paginas.some((p) => tiposDe(p).includes('Product'))) return null;
  if (!ruins.length) return nada();
  const p0 = ruins[0];
  return { disparou: true, intensidade: clamp(ruins.length / b.paginas.length), achados: [achado(ctx, p0, { mensagem: `${ruins.length} ${plural(ruins.length, 'página tem', 'páginas têm')} Product sem offers, review nem aggregateRating (${lista(ruins.map((p) => p.caminho))}). Para o snippet de produto o Google pede name e pelo menos um desses três.`, evidencias: ruins.slice(0, 10).map((p) => evid(p, 'Product', propsDe(p, 'Product').join(', ') || 'sem propriedades', propsDe(p, 'Product').length)), numeros: [ruins.length] })] };
}

function detArtigoAusente({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  if (!precisaTipo(b, ['blog'])) return null;
  if (tiposDoSite(b).some((t) => TIPOS_ARTIGO.test(t))) return nada();
  const p0 = b.paginas.find((p) => !p.ehHome) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'O site é um blog e nenhuma página tem dados estruturados de Article, BlogPosting ou NewsArticle. O Google recomenda datePublished e dateModified iguais às datas visíveis.', evidencias: [evid(p0, 'script[type="application/ld+json"]', 'Article ausente', 0)], citacoes: [citContagem(p0, 'seo-jsonld-tipo', { tipo: 'BlogPosting' }, 0)] })] };
}

function detOrgAusente({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  if (!precisaTipo(b, ['site-institucional', 'cardapio', 'agendamento'])) return null;
  const t = tiposDoSite(b);
  if (t.some((x) => TIPOS_LOCAL.test(x) || TIPOS_ORG.test(x))) return nada();
  const p0 = b.paginas.find((p) => p.ehHome) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'Nenhuma página declara Organization nem um tipo de negócio local nos dados estruturados. Organization não tem propriedade obrigatória, mas o Google recomenda informar nome, url, logo e contato.', evidencias: [evid(p0, 'script[type="application/ld+json"]', 'Organization/LocalBusiness ausentes', 0)], citacoes: [citContagem(p0, 'seo-jsonld-tipo', { tipo: 'Organization' }, 0)] })] };
}

// ---------------------------------------------------------------- C. palavras-chave
function detTermoH1({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const aval = b.paginas.filter((p) => p.termo.palavras.length >= 1 && p.termo.noH1 !== null);
  if (!aval.length) return null;
  const sem = aval.filter((p) => p.termo.noH1 === false);
  if (!sem.length) return nada();
  const p0 = sem[0];
  return { disparou: true, intensidade: clamp(sem.length / aval.length), achados: [achado(ctx, p0, { mensagem: `${sem.length} de ${aval.length} ${plural(aval.length, 'página', 'páginas')} têm um title cujo assunto ("${p0.termo.termo}", na página ${p0.caminho}) não aparece no H1. Pode ser proposital. Volume de busca e posição: não verificável sem dados do Search Console.`, evidencias: sem.slice(0, 10).map((p) => evid(p, 'title', p.termo.palavras.join(' '), p.termo.palavras.length, p.termo.termo)), numeros: [sem.length, aval.length] })] };
}

function detTermoTexto({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const aval = b.paginas.filter((p) => p.termo.palavras.length >= 1 && p.termo.palavrasDoTexto >= 50);
  if (!aval.length) return null;
  const sem = aval.filter((p) => p.termo.palavrasAusentesNoTexto.length > 0);
  if (!sem.length) return nada();
  const p0 = sem[0];
  return { disparou: true, intensidade: clamp(sem.length / aval.length), achados: [achado(ctx, p0, { mensagem: `${sem.length} de ${aval.length} ${plural(aval.length, 'página', 'páginas')} usam no title palavras que o texto visível não contém (na página ${p0.caminho}: ${p0.termo.palavrasAusentesNoTexto.join(', ')}). Heurística de intenção: o conteúdo pode não entregar o que o title promete.`, evidencias: sem.slice(0, 10).map((p) => evid(p, 'title', p.termo.palavrasAusentesNoTexto.join(' '), p.termo.palavrasAusentesNoTexto.length, p.termo.termo)), numeros: [sem.length, aval.length] })] };
}

// ---------------------------------------------------------------- D. E-E-A-T
function porArtigos(b, cond, texto, severidadeTexto) {
  const arts = b.paginas.filter((p) => pareceArtigo(b, p));
  if (!arts.length) return null;
  const sem = arts.filter((p) => cond(p));
  return { arts, sem };
}
function detAutor({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const r = porArtigos(b, (p) => !p.eeat.autor); if (!r) return null;
  if (!r.sem.length) return nada();
  const p0 = r.sem[0];
  return { disparou: true, intensidade: clamp(r.sem.length / r.arts.length), achados: [achado(ctx, p0, { mensagem: `${r.sem.length} de ${r.arts.length} ${plural(r.arts.length, 'página que parece artigo', 'páginas que parecem artigo')} não mostram quem escreveu (${lista(r.sem.map((p) => p.caminho))}). O Google orienta deixar claro quem criou o conteúdo. Sinal de confiança (E-E-A-T), avaliado por heurística.`, evidencias: r.sem.slice(0, 10).map((p) => evid(p, 'autor', 'não encontrado', 0)), numeros: [r.sem.length, r.arts.length] })] };
}
function detData({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const r = porArtigos(b, (p) => !p.eeat.dataVisivel); if (!r) return null;
  if (!r.sem.length) return nada();
  const p0 = r.sem[0];
  return { disparou: true, intensidade: clamp(r.sem.length / r.arts.length), achados: [achado(ctx, p0, { mensagem: `${r.sem.length} de ${r.arts.length} ${plural(r.arts.length, 'página que parece artigo', 'páginas que parecem artigo')} não mostram uma data visível (${lista(r.sem.map((p) => p.caminho))}). O Google recomenda uma data visível, como "Publicado" ou "Atualizado".`, evidencias: r.sem.slice(0, 10).map((p) => evid(p, 'time', 'não encontrada', 0)), numeros: [r.sem.length, r.arts.length] })] };
}
function detSobre({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  if (['link-na-bio', 'area-de-membros'].includes(b.tipo)) return null;
  if (b.site.linkSobre) return nada();
  const p0 = b.paginas.find((p) => p.ehHome) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'Não encontramos link visível para uma página "Sobre" ou "Quem somos". Heurística de confiança: mostrar quem está por trás do site ajuda quem visita. Não é exigência do Google.', evidencias: [evid(p0, 'a', 'link Sobre ausente', 0)] })] };
}
function detFontes({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  const minimo = 400;
  const r = porArtigos(b, (p) => p.eeat.palavras >= minimo && p.eeat.linksExternos === 0); if (!r) return null;
  if (!r.sem.length) return nada();
  const p0 = r.sem[0];
  return { disparou: true, intensidade: clamp(r.sem.length / r.arts.length), achados: [achado(ctx, p0, { mensagem: `${r.sem.length} ${plural(r.sem.length, 'artigo longo não cita', 'artigos longos não citam')} nenhuma fonte com link (${lista(r.sem.map((p) => p.caminho))}). Pode ser opinião pessoal e estar tudo certo; é só heurística.`, evidencias: r.sem.slice(0, 10).map((p) => evid(p, 'a[href^=http]', 'zero links externos', p.eeat.linksExternos)), numeros: [r.sem.length] })] };
}

// ---------------------------------------------------------------- E. local
function detLocalSemDados({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  if (!localDetectado(b)) return null;
  if (tiposDoSite(b).some((t) => TIPOS_LOCAL.test(t))) return nada();
  const p0 = b.paginas.find((p) => p.ehHome) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'O site parece de um negócio local (telefone e endereço visíveis), mas não declara LocalBusiness nos dados estruturados. O Google pede name e address e recomenda telephone, horário e geo. Não garante nenhum recurso.', evidencias: [evid(p0, 'script[type="application/ld+json"]', 'LocalBusiness ausente', 0)], citacoes: [citContagem(p0, 'seo-jsonld-tipo', { tipo: 'LocalBusiness' }, 0)] })] };
}
function detLocalIncompleto({ ctx, med }) {
  const b = base(ctx, med); if (!b || !b.j) return null;
  const locais = b.paginas.filter((p) => tiposDe(p).some((t) => TIPOS_LOCAL.test(t)));
  if (!locais.length) return null;
  const falta = (p) => { const t = tiposDe(p).filter((x) => TIPOS_LOCAL.test(x)); const props = [...new Set(t.flatMap((x) => propsDe(p, x)))]; return ['name', 'address'].filter((k) => !props.includes(k)); };
  const ruins = locais.map((p) => ({ p, f: falta(p) })).filter((x) => x.f.length);
  if (!ruins.length) return nada();
  const { p, f } = ruins[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p, { mensagem: `O dado estruturado de negócio local em ${p.caminho} está sem ${f.join(' e ')}, que o Google exige para LocalBusiness.`, evidencias: ruins.slice(0, 10).map((x) => evid(x.p, 'LocalBusiness', x.f.join(', '), x.f.length)) })] };
}
function detLocalDivergente({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  if (!localDetectado(b)) return null;
  const tel = b.site.telefonesDistintos, ceps = b.site.cepsDistintos;
  if (tel.length <= 1 && ceps.length <= 1) return nada();
  const p0 = b.paginas.find((p) => p.local.telefones.length || p.local.ceps.length) || b.paginas[0];
  const partes = [];
  if (tel.length > 1) partes.push(`${tel.length} telefones diferentes (${tel.join(', ')})`);
  if (ceps.length > 1) partes.push(`${ceps.length} CEPs diferentes (${ceps.join(', ')})`);
  const mensagem = `O site mostra ${partes.join(' e ')}. Pode ser legítimo (fixo e WhatsApp, duas unidades). Heurística de consistência: manter nome, endereço e telefone iguais no site e no Perfil da Empresa evita confusão.`;
  const numeros = extrairNumeros(mensagem).map(String);
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem, evidencias: [...tel.map((t) => evid(p0, 'texto', t, 1)), ...ceps.map((c) => evid(p0, 'texto', c, 1))].slice(0, 10), numeros })] };
}
function detTelSemLink({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  if (!localDetectado(b) || !b.site.telefonesDistintos.length) return null;
  if (b.paginas.some((p) => p.local.telLinks > 0 || p.local.whatsappLinks > 0)) return nada();
  const p0 = b.paginas.find((p) => p.local.telefones.length) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'O telefone aparece escrito, mas nenhuma página tem link tel: nem link de WhatsApp. No celular, um link tel: permite ligar com um toque. Heurística de facilidade de contato.', evidencias: [evid(p0, 'a[href^="tel:"]', 'ausente', 0)] })] };
}
function detSemMapa({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  if (!localDetectado(b)) return null;
  const temEnd = b.paginas.some((p) => p.local.enderecos.length || p.local.ceps.length);
  if (!temEnd) return null;
  if (b.paginas.some((p) => p.local.mapaIncorporado)) return nada();
  const p0 = b.paginas.find((p) => p.local.enderecos.length || p.local.ceps.length) || b.paginas[0];
  return { disparou: true, intensidade: 1, achados: [achado(ctx, p0, { mensagem: 'O site mostra endereço, mas nenhuma página incorpora um mapa (iframe do Google Maps ou do OpenStreetMap). Heurística de ajuda ao visitante; não é exigência do Google.', evidencias: [evid(p0, 'iframe', 'mapa ausente', 0)] })] };
}
function detPerfil({ ctx, med }) {
  const b = base(ctx, med); if (!b) return null;
  if (!localDetectado(b)) return null;
  const p0 = b.paginas.find((p) => p.ehHome) || b.paginas[0];
  return { disparou: true, intensidade: 0, achados: [achado(ctx, p0, { mensagem: 'A skill não acessa o Perfil da Empresa no Google (exige login). Segundo o Google, a posição local depende de relevância, distância e destaque, e informação completa e correta ajuda. Confira lá, à mão: nome, endereço, telefone, horário, categoria e fotos iguais ao site.', evidencias: [evid(p0, 'perfil-da-empresa', 'conferir manualmente', 0)] })] };
}

export const detectores = {
  'seo-h1-ausente': detH1Ausente,
  'seo-viewport-ausente': detViewport,
  'seo-open-graph-incompleto': detOpenGraph,
  'seo-produto-sem-dado-estruturado': detProdutoAusente,
  'seo-produto-sem-oferta-ou-avaliacao': detProdutoIncompleto,
  'seo-artigo-sem-dado-estruturado': detArtigoAusente,
  'seo-organizacao-ou-negocio-sem-dado-estruturado': detOrgAusente,
  'seo-termo-do-title-fora-do-h1': detTermoH1,
  'seo-termo-do-title-fora-do-texto': detTermoTexto,
  'seo-eeat-autor-ausente': detAutor,
  'seo-eeat-data-ausente': detData,
  'seo-eeat-pagina-sobre-ausente': detSobre,
  'seo-eeat-sem-fontes-citadas': detFontes,
  'seo-local-dados-estruturados-ausentes': detLocalSemDados,
  'seo-local-dados-estruturados-incompletos': detLocalIncompleto,
  'seo-local-telefone-ou-endereco-divergente': detLocalDivergente,
  'seo-local-telefone-sem-link': detTelSemLink,
  'seo-local-sem-mapa': detSemMapa,
  'seo-local-perfil-empresa-conferir': detPerfil,
};
void pagExtr;
