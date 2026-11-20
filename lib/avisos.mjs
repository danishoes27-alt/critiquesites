// Avisos fixos usados no relatório e nos prompts de correção. Texto do projeto, em palavras próprias.
// Dispositivos conferidos no texto oficial do Planalto em 2026-11-19 (ver DECISOES.md).

export const TITULO_AVISO_REFERENCIA = 'Referência não é cópia';

export const AVISO_REFERENCIA = [
  'Olhar, medir e se inspirar no site de outra pessoa é uma coisa; reproduzir o que é dela depende de autorização de quem criou.',
  'Em regra, a lei brasileira de direitos autorais (Lei 9.610/1998) protege obras como textos, imagens e programas de computador (art. 7º), e usar uma obra de qualquer modo exige permissão prévia e expressa do autor (art. 29). Ideias, métodos e sistemas, como tais, não são protegidos (art. 8º, inciso I): dá para aprender com a estrutura e o raciocínio de uma referência e criar o seu próprio.',
  'O programa de computador tem lei própria (Lei 9.609/1998, art. 2º), e a proteção existe sem precisar de registro (art. 2º, § 3º). Marca é outro assunto: o direito sobre ela nasce do registro válido no INPI (Lei 9.279/1996, art. 129).',
  'Isto não é parecer jurídico e a decisão é sua. Na dúvida, fale com um advogado.',
].join(' ');

// Versão para colar dentro de um prompt (uma linha, sem aspas nem crases).
export const AVISO_REFERENCIA_PROMPT = `${TITULO_AVISO_REFERENCIA}: ${AVISO_REFERENCIA}`;

// O prompt menciona referência ou inspiração em outro site?  ("preferência" não conta.)
export function mencionaReferencia(texto) {
  return /(?<![\p{L}])refer[êe]ncias?(?![\p{L}])|(?<![\p{L}])inspir(?:e|a|ar|ando|a[çc][ãa]o|ado|ada|ou)(?![\p{L}])/iu.test(String(texto ?? ''));
}

// Frases que mandam COPIAR, CLONAR ou REPRODUZIR um site/página/layout/design específico (ou deixá-lo "igual").
// Negações ("não copie o site de outra pessoa") não contam. Medir uma referência e adaptar à marca é permitido.
const VERBOS = '(?:cop(?:ie|iar|ia|iando)|clon(?:e|ar|ando)|reproduz(?:a|ir|indo)|replic(?:a|ar|ando)|repliqu(?:e)|duplic(?:a|ar|ando)|dupliqu(?:e)|imit(?:e|ar|ando)|pirate(?:ie|ar))';
const ALVOS = '(?:site|p[áa]gina|layout|design|visual|template|tema)';
const RE_COPIA = new RegExp(`\\b${VERBOS}\\b[^.\\n]{0,40}\\b${ALVOS}\\b`, 'giu');
const RE_IGUAL = /\b(?:igual|id[êe]ntic[oa]|c[óo]pia|r[ée]plica|clone)\s+(?:exat[oa]\s+)?(?:a[oà]|d[oa]|de)\s+(?:site|p[áa]gina|layout|design)\b/giu;
const RE_NEGACAO = /(?:\bn[ãa]o\b|\bnunca\b|\bevite\b|\bsem\b|\bproibid[oa]\b)[^.\n]{0,30}$/iu;

export function acharInstrucaoDeCopia(texto) {
  const t = String(texto ?? '');
  const achados = [];
  for (const re of [RE_COPIA, RE_IGUAL]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const antes = t.slice(Math.max(0, m.index - 35), m.index);
      if (RE_NEGACAO.test(antes)) continue;
      achados.push(t.slice(m.index, m.index + m[0].length + 20).replace(/\s+/g, ' '));
    }
  }
  return achados;
}

// ---------------------------------------------------------------------------------------------------------------
// Módulo "Subir no Google": aviso fixo sobre posição e teste de promessa proibida.
export const TITULO_AVISO_POSICAO = 'Ninguém garante o primeiro lugar no Google';
export const AVISO_POSICAO = [
  'A nota de SEO mede se o site segue regras e recomendações documentadas. Ela não mede a sua posição real, o seu tráfego nem a concorrência, e não prevê resultado.',
  'O próprio Google diz que ninguém pode garantir o primeiro lugar nos resultados (Google Search Central, "Do you need an SEO?", consultado em 20/11/2026).',
  'Quem vende garantia de resultado nas buscas pode estar fazendo publicidade enganosa: o Código de Defesa do Consumidor (Lei 8.078/1990, art. 37) proíbe a publicidade enganosa, inclusive a parcialmente falsa ou que induz a erro por omissão (texto conferido em planalto.gov.br em 20/11/2026).',
  'Isto não é parecer jurídico. A decisão é sua.',
].join(' ');

// Promessas que a skill nunca pode escrever. Cada padrão é linear (sem retrocesso perigoso).
// "Negações" como "ninguém garante o primeiro lugar" ficam de fora: só pega a promessa afirmativa.
const PROMESSAS = [
  /\b(?:garant(?:e|imos|ido|ida|ia|ir)|prometo|prometemos|promete|assegur(?:a|amos))\b[^.\n]{0,60}\b(?:topo|primeir[oa]|1[ºo°]|pagina 1|página 1|primeira p[áa]gina|posi[cç][aã]o)\b/i,
  /\bchegar(?:\s+\w+){0,3}\s+ao?\s+topo do google\b/i,
  /\b(?:topo|primeira p[áa]gina|primeiro lugar)\s+(?:do|no|de)\s+google\s+(?:garantid[oa]|assegurad[oa]|certo|certa)\b/i,
  /\b(?:vai|vamos|ir[áa]|iremos|voc[êe] vai)\s+(?:aparecer|ranquear|ficar|chegar|subir)[^.\n]{0,40}\b(?:primeir[oa]|1[ºo°]|topo)\b/i,
  /\b(?:seu site|sua p[áa]gina)\s+(?:vai|ir[áa])\s+(?:ficar|aparecer|estar)\s+(?:em\s+)?(?:primeir[oa]|1[ºo°]|no topo)/i,
  /\bgarantia de (?:posi[cç][aã]o|ranking|topo|1[ºo°] lugar|primeiro lugar)\b/i,
  /\b(?:#1|n[ºo°]\s*1|1[ºo°] lugar)\s+no google\s+(?:garantido|com certeza)\b/i,
];
// Frases de ADVERTÊNCIA (nunca prometem): trechos que contêm negação logo antes do verbo.
const NEGACAO = /\b(?:ningu[ée]m|nunca|n[ãa]o|sem)\b[^.\n]{0,40}$/i;
export function acharPromessaDePosicao(texto) {
  const t = String(texto || '').slice(0, 200000);
  const achados = [];
  for (const re of PROMESSAS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of t.matchAll(g)) {
      const antes = t.slice(Math.max(0, m.index - 60), m.index);
      if (NEGACAO.test(antes) || /\b(?:ningu[ée]m|n[ãa]o)\b/i.test(m[0])) continue;
      achados.push(m[0].slice(0, 120));
    }
  }
  return achados;
}
