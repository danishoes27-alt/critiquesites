// JULGAMENTO: os únicos campos que o MODELO escreve. Tudo é validado antes de entrar no relatório:
// estrutura (schema), referências a achados existentes, números com respaldo e proibições (autoria por IA etc.).
import Ajv from 'ajv';
import { numerosSemRespaldo, montarCorpus } from './verificador.mjs';

const txt = (max = 700) => ({ type: 'string', minLength: 1, maxLength: max });
const ids = { type: 'array', items: { type: 'string' }, maxItems: 30 };

export const schemaJulgamento = {
  type: 'object',
  additionalProperties: false,
  required: ['versao', 'tom', 'resumo', 'pontos_fortes', 'pontos_fracos', 'criticas', 'plano'],
  properties: {
    versao: { const: 1 },
    tom: { enum: ['normal', 'sem-do'] },
    tipo_de_site_confirmado: { type: 'string' },
    resumo: txt(900),
    pontos_fortes: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['titulo', 'texto'], properties: { titulo: txt(100), texto: txt(500), achados: ids } } },
    pontos_fracos: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['titulo', 'texto'], properties: { titulo: txt(100), texto: txt(500), achados: ids } } },
    elogios: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: txt(400), achados: ids } } },
    criticas: { type: 'array', maxItems: 60, items: { type: 'object', additionalProperties: false, required: ['achado_id', 'texto'], properties: { achado_id: { type: 'string' }, texto: txt(600), refino_do_prompt: txt(400) } } },
    comparacoes: { type: 'array', maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['texto'], properties: { texto: txt(400) } } },
    plano: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['titulo', 'porque', 'esforco', 'impacto'], properties: { titulo: txt(120), porque: txt(400), esforco: { enum: ['baixo', 'medio', 'alto'] }, impacto: { enum: ['baixo', 'medio', 'alto'] }, achados: ids } } },
    heuristicas: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, required: ['regra_id', 'nota', 'motivo'], properties: { regra_id: { type: 'string' }, nota: { type: ['integer', 'null'], minimum: 0, maximum: 4 }, motivo: txt(300) } } },
    ajuste_tell: { type: 'object', additionalProperties: false, required: ['delta', 'motivo'], properties: { delta: { type: 'number', minimum: -10, maximum: 10 }, motivo: txt(300) } },
    teste_da_troca: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['frase', 'resposta', 'motivo'], properties: { frase: txt(400), resposta: { enum: ['generica', 'especifica', 'incerta'] }, motivo: txt(300) } } },
    perguntas_ao_dono: { type: 'array', maxItems: 8, items: txt(300) },
  },
};

const validar = new Ajv({ allErrors: true, strict: false }).compile(schemaJulgamento);

// Afirmar autoria por IA é proibido ("cara de IA" é só o nome da nota). Promessas de acerto idem.
const PROIBIDOS = [
  { re: /\b(foi|foram|parece ter sido|certamente|com certeza|provavelmente|claramente|obviamente)\s+(escrit|feit|gerad|cri|produzid)[oa]s?\s+(por|pel[ao])\s+(uma?\s+)?(ia|i\.a\.|inteligência artificial|chatgpt|gpt|claude|llm|robô)/i, motivo: 'afirma autoria por IA (proibido: só "genérico/batido")' },
  { re: /\b(escrit|feit|gerad|cri|produzid)[oa]s?\s+(por|pel[ao])\s+(uma?\s+)?(ia|i\.a\.|inteligência artificial|chatgpt|gpt|claude|llm)\b/i, motivo: 'afirma autoria por IA (proibido: só "genérico/batido")' },
  { re: /100\s*%\s*(de\s+)?(acerto|certeza|preciso|precisa|confiável)|nunca erra|sem margem de erro/i, motivo: 'promete 100% de acerto' },
  { re: /(?<![\p{L}])(é|são|está|estão)\s+ilegal(is)?(?![\p{L}])|viola a lei|crime(?![\p{L}])|processo certo/iu, motivo: 'afirma ilegalidade (a skill só avisa)' },
  { re: /\b(imbecil|idiota|burr[oa]|retardad[oa]|lixo humano|vergonha de pessoa)\b/i, motivo: 'ofensa a pessoa (o tom ácido é sobre o site, não sobre quem fez)' },
  { re: /\b(bloqueie|libere)\s+(o|os|as?)?\s*(gptbot|claudebot|rastreadores?|bots?\s+de\s+ia|google-extended)/i, motivo: 'manda bloquear/liberar rastreador de IA (a skill só informa)' },
];

function camposDeTexto(j) {
  const campos = [['resumo', j.resumo]];
  (j.pontos_fortes || []).forEach((x, i) => { campos.push([`pontos_fortes[${i}].titulo`, x.titulo], [`pontos_fortes[${i}].texto`, x.texto]); });
  (j.pontos_fracos || []).forEach((x, i) => { campos.push([`pontos_fracos[${i}].titulo`, x.titulo], [`pontos_fracos[${i}].texto`, x.texto]); });
  (j.elogios || []).forEach((x, i) => campos.push([`elogios[${i}].texto`, x.texto]));
  (j.criticas || []).forEach((x, i) => { campos.push([`criticas[${i}].texto`, x.texto]); if (x.refino_do_prompt) campos.push([`criticas[${i}].refino_do_prompt`, x.refino_do_prompt]); });
  (j.comparacoes || []).forEach((x, i) => campos.push([`comparacoes[${i}].texto`, x.texto]));
  (j.plano || []).forEach((x, i) => campos.push([`plano[${i}].titulo`, x.titulo], [`plano[${i}].porque`, x.porque]));
  (j.heuristicas || []).forEach((x, i) => campos.push([`heuristicas[${i}].motivo`, x.motivo]));
  (j.teste_da_troca || []).forEach((x, i) => campos.push([`teste_da_troca[${i}].motivo`, x.motivo]));
  (j.perguntas_ao_dono || []).forEach((x, i) => campos.push([`perguntas_ao_dono[${i}]`, x]));
  if (j.ajuste_tell) campos.push(['ajuste_tell.motivo', j.ajuste_tell.motivo]);
  return campos;
}

// achadosVerificados: saída aprovada do verificador. numerosDoRelatorio: números legítimos de notas/contagens.
export function validarJulgamento(j, { achadosVerificados, ctx, numerosDoRelatorio = [], regrasHeuristica = null }) {
  const erros = [];
  if (!validar(j)) return { ok: false, erros: validar.errors.map((e) => `schema: ${e.instancePath || '/'} ${e.message}`) };
  const porId = new Map(achadosVerificados.map((a) => [a.id, a]));
  const corpus = ctx ? montarCorpus(ctx) : new Map();
  const refs = [];
  (j.pontos_fortes || []).concat(j.pontos_fracos || [], j.elogios || [], j.plano || []).forEach((x) => (x.achados || []).forEach((id) => refs.push(id)));
  (j.criticas || []).forEach((c) => refs.push(c.achado_id));
  for (const id of new Set(refs)) if (!porId.has(id)) erros.push(`referência a achado inexistente ou descartado: ${id}`);
  const vistos = new Set();
  for (const c of j.criticas || []) { if (vistos.has(c.achado_id)) erros.push(`crítica duplicada para ${c.achado_id}`); vistos.add(c.achado_id); }
  if (regrasHeuristica) for (const h of j.heuristicas || []) if (!regrasHeuristica.includes(h.regra_id)) erros.push(`heurística desconhecida: ${h.regra_id}`);
  const base = { citacoes: achadosVerificados.flatMap((a) => a.citacoes || []), evidencias: achadosVerificados.flatMap((a) => a.evidencias || []), numeros_permitidos: numerosDoRelatorio };
  for (const [campo, texto] of camposDeTexto(j)) {
    for (const p of PROIBIDOS) if (p.re.test(texto)) erros.push(`${campo}: ${p.motivo}`);
    const sem = numerosSemRespaldo({ ...base, mensagem: texto }, corpus);
    if (sem.length) erros.push(`${campo}: número(s) sem respaldo no código ou nas medições: ${sem.join(', ')}`);
  }
  return { ok: erros.length === 0, erros };
}
