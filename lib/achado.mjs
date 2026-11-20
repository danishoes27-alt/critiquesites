// Achado: unidade de crítica, sempre com selo, evidência e citações verificáveis.
import Ajv from 'ajv';

export const SELOS = {
  fato: 'Fato verificado (medido por script)',
  regra: 'Regra documentada (com fonte)',
  opiniao: 'Opinião / heurística',
  'nao-verificavel': 'Não verificável no código',
};
export const SEVERIDADES = ['P0', 'P1', 'P2', 'P3'];

export const schemaAchado = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'regra_id', 'selo', 'severidade', 'pagina', 'mensagem', 'evidencias', 'citacoes'],
  properties: {
    id: { type: 'string', minLength: 1 },
    regra_id: { type: 'string', minLength: 1 },
    categoria: { type: 'string' },
    titulo: { type: 'string' },
    selo: { type: 'string', enum: Object.keys(SELOS) },
    severidade: { type: 'string', enum: SEVERIDADES },
    pagina: { type: 'string' },
    mensagem: { type: 'string', minLength: 5 },
    evidencias: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pagina: { type: 'string' }, versao: { type: 'string', enum: ['cru', 'dom250', 'final'] }, seletor: { type: 'string' },
          trecho: { type: 'string' }, valor: {}, contagem: { type: 'number' }, visivel: { type: 'boolean' },
        },
      },
    },
    citacoes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tipo'],
        additionalProperties: false,
        properties: {
          tipo: { type: 'string', enum: ['trecho', 'numero', 'contagem'] }, valor: {}, versoes: { type: 'array', items: { type: 'string', enum: ['cru', 'dom250', 'final'] } },
          onde: { type: 'string', enum: ['visivel', 'html', 'css', 'js', 'jsonld', 'qualquer'] }, pagina: { type: 'string' },
          contagem: { type: 'object' },
        },
      },
    },
    peso_aplicado: { type: 'number' },
    correcao: { type: 'string' },
    prompt_correcao: { type: 'string' },
    fonte: { type: 'array' },
    numeros_permitidos: { type: 'array' },
    instavel: { type: 'boolean' },
    citacao_de_ancora: { type: 'boolean' },
    // Segundo nível do achado: a INTERPRETAÇÃO do fato (opinião/heurística), separada do fato verificado.
    interpretacao: { type: 'object', additionalProperties: false, required: ['selo', 'texto'], properties: { selo: { enum: ['opiniao'] }, texto: { type: 'string', minLength: 10 } } },
    verificado: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

const validar = new Ajv({ allErrors: true, strict: false }).compile(schemaAchado);

export function validarAchado(a) {
  const ok = validar(a);
  const erros = ok ? [] : validar.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
  if (ok && a.selo === 'fato' && a.citacoes.length === 0) erros.push('selo "fato" exige ao menos 1 citação');
  return { ok: erros.length === 0, erros };
}

let contador = 0;
export function novoId(prefixo = 'ach') {
  contador += 1;
  return `${prefixo}-${String(contador).padStart(4, '0')}`;
}
export function reiniciarIds() { contador = 0; }

// Cria um achado a partir de uma regra (dados do JSON) + o que o medidor encontrou.
export function criarAchado(regra, { pagina = '/', mensagem, evidencias = [], citacoes = [], severidade = null, peso_aplicado = null, instavel = false, numeros_permitidos = [], prompt_correcao = null, interpretacao = null }) {
  const sev = severidade || (SEVERIDADES.includes(regra.severidade) ? regra.severidade : ({ tell: 'P2', smell: 'P3', info: 'P3' }[regra.severidade] || 'P3'));
  return {
    id: novoId(),
    regra_id: regra.id,
    categoria: regra.categoria,
    titulo: regra.titulo,
    selo: regra.selo,
    severidade: sev,
    pagina,
    mensagem,
    evidencias,
    citacoes,
    peso_aplicado: peso_aplicado ?? regra.peso,
    correcao: regra.correcao,
    prompt_correcao: prompt_correcao || regra.prompt_correcao,
    fonte: regra.fonte,
    ...(numeros_permitidos.length ? { numeros_permitidos } : {}),
    ...(instavel ? { instavel: true } : {}),
    ...(interpretacao ? { interpretacao } : {}),
  };
}
