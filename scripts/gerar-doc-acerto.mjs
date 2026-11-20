#!/usr/bin/env node
// Gera docs/teste-de-acerto.md a partir de saidas/acerto/resultados-*.json (que ficam fora do repositório).
// O documento traz SÓ números agregados: nenhum nome de site de terceiros, nenhum rótulo "feito por IA" para terceiros.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarConfigCustos, estimarCusto, formatarReais } from '../lib/custo.mjs';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rodar = (script, args = []) => JSON.parse(execFileSync('node', [join(raiz, 'scripts', script), ...args], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }));
const bruto = rodar('teste-de-acerto.mjs', ['resumo', '--C', '40']); // escala antiga, para o "antes"
const cal = rodar('calibrar.mjs');
const cfg = carregarConfigCustos();
const f1 = (x) => (x === null || x === undefined ? '-' : (Math.round(x * 10) / 10).toString().replace('.', ','));
const f2 = (x) => (x === null || x === undefined ? '-' : (Math.round(x * 100) / 100).toString().replace('.', ','));
const pct = (x) => (x === null || x === undefined ? '-' : `${Math.round(x * 100)}%`);

const aucFinal = cal.somenteC.validacao.auc;
const aucGeral = cal.somenteC.geral.auc;
const leitura = aucFinal >= 0.95 ? 'A nota objetiva **separa bem** os dois grupos neste teste.'
  : aucFinal >= 0.8 ? 'A nota objetiva **separa razoavelmente** os dois grupos, mas **com sobreposição importante**: parte dos sites de cada grupo cai do lado errado. Serve como sinal de conjunto, **não como veredito de um site individual**.'
    : aucFinal >= 0.65 ? 'A nota objetiva **separa os dois grupos só em parte**: há muita sobreposição.'
      : '**A nota objetiva NÃO separa bem os dois grupos neste teste.** Não declaramos sucesso.';

const linhaGrupo = (nome, g) => `| ${nome} | ${g.validos} de ${g.n} | ${f1(g.mediana)} | ${f1(g.media)} | ${f1(g.min)} a ${f1(g.max)} |`;
const lim = (l) => (l ? `${f1(l.valor)} (sensibilidade ${pct(l.sensibilidade)}, especificidade ${pct(l.especificidade)}; falsos negativos ${l.falsosNegativos}, falsos positivos ${l.falsosPositivos})` : '-');
const linhaCal = (nome, r) => `| ${nome} | ${f2(r.auc)} | ${f1(r.medianaIA)} | ${f1(r.medianaBons)} | ${f1(r.diferencaDeMedianas)} | ${lim(r.limiar)} |`;

const rap = cfg.estimativa_tokens.medicoes;
const custoRapido = estimarCusto({ modo: 'rapido', paginas: 8 }, cfg);
const custoCompleto12 = estimarCusto({ modo: 'completo', paginas: 12 }, cfg);
const custoCompleto30 = estimarCusto({ modo: 'completo', paginas: 30 }, cfg);

const md = `# Teste de acerto (v1)

Gerado por \`scripts/gerar-doc-acerto.mjs\`. Só números agregados: os sites de terceiros usados no teste ficam apenas na máquina local (\`saidas/\`, fora do repositório) e não são citados aqui.

## O que foi testado

Mede quanto a parte **objetiva** da nota (o Tell Score: menor é melhor) separa dois grupos de páginas iniciais:

- **Grupo "gerados por IA":** ${bruto.ia.n} sites criados localmente por subagentes do Claude com **um prompt curto e genérico** ("Crie uma landing page moderna e profissional para ..."), em uma única passada e sem direção de design. 5 tipos (landing page, loja, site institucional, blog, página de vendas) × 4 temas. Cada site é um HTML autocontido (sem bibliotecas nem fontes externas, para o teste ser determinístico).
- **Grupo "premiados":** ${bruto.bons.n} sites escolhidos por uma regra objetiva e sem seleção a dedo: os 20 "Sites of the Day" mais recentes de uma premiação pública de web design (lista consultada em 2026-11-18), excluindo domínios de staging. **Só a página inicial**, respeitando \`robots.txt\` e com intervalo de 3 s entre acessos.
- Modo rápido, sem Lighthouse, sem julgamento do modelo (só a parte objetiva, repetível).
- Treino e validação **separados** para a calibração: treino = os temas 1 e 2 de cada tipo (10 sites de IA) e os premiados 01 a 10; validação = temas 3 e 4 e os premiados 11 a 20. A calibração só mexe em 2 coisas: multiplicadores por categoria (grade 0,5 / 1 / 1,5) e a constante C da fórmula.

## Conclusão em uma frase

${leitura} AUC na validação (10 + 10 sites): **${f2(aucFinal)}**; nos 40 sites: **${f2(aucGeral)}** (1,00 = separação perfeita; 0,50 = sorteio).

## Resultado antes da calibração (C = 40, todos os multiplicadores = 1; notas na escala antiga)

| Grupo | Sites lidos | Mediana | Média | Faixa |
|---|---|---|---|---|
${linhaGrupo('Gerados por IA', bruto.ia)}
${linhaGrupo('Premiados', bruto.bons)}

Diferença de medianas: **${f1(bruto.diferencaDeMedianas)} pontos**. AUC (todos os sites): **${f2(bruto.auc)}**. Melhor limiar: ${lim(bruto.melhorLimiar && { valor: bruto.melhorLimiar.limiar, sensibilidade: bruto.melhorLimiar.sensibilidade, especificidade: bruto.melhorLimiar.especificidade, falsosNegativos: bruto.melhorLimiar.fn, falsosPositivos: bruto.melhorLimiar.fp })}.

## Calibração (treino × validação)

Foram testadas duas mudanças, escolhidas **só com o conjunto de treino**:

1. **Multiplicadores por categoria** (grade 0,5 / 1 / 1,5): escolhidos no treino ${Object.entries(cal.multiplicadores).filter(([, v]) => v !== 1).map(([k, v]) => `${k} ${f1(v)}`).join('; ') || 'nenhum'}. No treino o AUC foi de ${f2(cal.antes.treino.auc)} para ${f2(cal.depois.treino.auc)}, mas na **validação** foi de ${f2(cal.antes.validacao.auc)} para ${f2(cal.depois.validacao.auc)}. Sem ganho na validação, isso é sinal de ajuste ao treino: **os multiplicadores NÃO foram adotados** (todos ficam em 1).
2. **Constante C** da fórmula: o limiar do treino passa a valer nota 45 (fronteira entre as faixas C e D). **Adotado: C = ${f1(cal.adotado.C)}** (antes 40). Isso muda só a escala da nota, não a ordem dos sites (o AUC não muda).

| Conjunto | AUC | Mediana IA | Mediana premiados | Diferença | Melhor limiar |
|---|---:|---:|---:|---:|---|
${linhaCal('Treino (C adotado)', cal.somenteC.treino)}
${linhaCal('**Validação (C adotado)**', cal.somenteC.validacao)}
${linhaCal('Todos os 40 sites (C adotado)', cal.somenteC.geral)}
${linhaCal('Validação com multiplicadores (não adotado)', cal.depois.validacao)}

A validação é o número que importa: o treino foi usado para escolher os parâmetros e tende a parecer melhor.

## Falsos positivos e falsos negativos (com o C adotado)

- Falsos negativos (site gerado por IA com nota baixa, abaixo do limiar): validação ${cal.somenteC.validacao.limiar ? cal.somenteC.validacao.limiar.falsosNegativos : '-'} de ${cal.tamanhos.validacaoIA}; nos 40 sites ${cal.somenteC.geral.limiar ? cal.somenteC.geral.limiar.falsosNegativos : '-'} de ${bruto.ia.validos}.
- Falsos positivos (site premiado com nota alta, acima do limiar): validação ${cal.somenteC.validacao.limiar ? cal.somenteC.validacao.limiar.falsosPositivos : '-'} de ${cal.tamanhos.validacaoBons}; nos 40 sites ${cal.somenteC.geral.limiar ? cal.somenteC.geral.limiar.falsosPositivos : '-'} de ${bruto.bons.validos}.
- O limiar é o que maximiza a acurácia balanceada **na própria amostra**; em sites novos, espere pior.

## Por tipo de site (grupo de IA, antes da calibração)

| Tipo | Sites | Mediana | Faixa |
|---|---:|---:|---|
${Object.entries(bruto.porTipo).map(([t, v]) => `| ${t} | ${v.n} | ${f1(v.mediana)} | ${f1(v.min)} a ${f1(v.max)} |`).join('\n')}

## Limitações (leia antes de confiar na nota)

1. O teste compara sites **genéricos gerados por IA com um prompt curto** contra sites **premiados por design**. Não mede toda a realidade: um site feito por IA com um bom briefing pode ter nota baixa, e um site feito por gente sem cuidado pode ter nota alta.
2. Sites premiados costumam ser pesados em animação, WebGL e telas de carregamento; isso pode distorcer medidores baseados em estilo e em texto visível (leitura da página inicial apenas). Sites que falharam na leitura entram como "erro" e ficam fora das médias (coluna "Sites lidos").
3. Os sites de IA não usam bibliotecas nem fontes externas (para ser determinístico), o que remove alguns sinais comuns (CDN de utilitários) e favorece um pouco esse grupo.
4. Tamanho pequeno (${bruto.ia.n} + ${bruto.bons.n} sites): as medianas têm incerteza grande; o AUC não tem intervalo de confiança aqui. Nenhum resultado deste teste deve ser lido como taxa de acerto "real".
5. Os pesos das regras vêm de fontes (ver \`CREDITS.md\`), mas os limiares de vários detectores são **iniciais**, marcados como "a calibrar" no código; a calibração acima mexe só em multiplicadores por categoria e na constante C.
6. A nota é um **sinal, não um veredito**. Nunca prometa 100% de acerto.

## Custo real (tokens e R$)

Medido em 2026-11-19 com o contador de contexto da própria sessão do Claude Code (antes e depois de cada etapa; a consulta do contador, 974 tokens, foi descontada). Modelo de julgamento: Claude Sonnet 5.5 (US$ 2 de entrada e US$ 10 de saída por milhão de tokens, página oficial de preços da Anthropic consultada em ${cfg.precos.consultado_em}). Cotação de ${cfg.cotacao.data_cotacao}: US$ 1 = ${formatarReais(cfg.cotacao.valor)} (${cfg.cotacao.fonte}).

| Etapa medida | Tokens |
|---|---:|
| Ler o \`SKILL.md\` | ${rap.skill_md_tokens} |
| Ler o pacote de evidências de um site real, 1 página, modo rápido (${rap.rapido_site_real_1_pagina.pacote_caracteres} caracteres) | ${rap.rapido_site_real_1_pagina.pacote_tokens} |
| Escrever o \`julgamento.json\` (${rap.rapido_site_real_1_pagina.julgamento_caracteres} caracteres) | ${rap.rapido_site_real_1_pagina.julgamento_tokens_saida} (saída) |
| Pacote do modo completo, site local com 12 páginas (${rap.completo_site_local_12_paginas.pacote_caracteres} caracteres) | ≈ ${rap.completo_site_local_12_paginas.pacote_tokens_aprox} |

Estimativa resultante (inclui ~3 mil tokens de saídas de ferramentas e ~2 mil de raciocínio na saída):

| Cenário | Entrada | Saída | Custo estimado |
|---|---:|---:|---:|
| Rápido, até 8 páginas | ${Math.round(custoRapido.linhas[0].entrada)} | ${Math.round(custoRapido.linhas[0].saida)} | **${formatarReais(custoRapido.reais)}** |
| Completo, 12 páginas | ${Math.round(custoCompleto12.linhas[0].entrada)} | ${Math.round(custoCompleto12.linhas[0].saida)} | **${formatarReais(custoCompleto12.reais)}** |
| Completo, 30 páginas (pacote no teto) | ${Math.round(custoCompleto30.linhas[0].entrada)} | ${Math.round(custoCompleto30.linhas[0].saida)} | **${formatarReais(custoCompleto30.reais)}** |

Comparação com a sua estimativa (R$ 0,80 a R$ 1,00 por site médio no modo completo): o completo medido fica entre **${formatarReais(custoCompleto12.reais)} e ${formatarReais(custoCompleto30.reais)}**, ou seja, **dentro ou um pouco abaixo** da sua faixa; o rápido custa cerca de **${formatarReais(custoRapido.reais)}**.

Limites da medição: o raciocínio interno do modelo não aparece no contador (usamos ~2 mil tokens de margem); o modo completo foi medido só no tamanho do pacote (a saída foi estimada a partir do modo rápido); cache de leitura entre as rodadas do modelo foi ignorado (reduz um pouco o custo real); a conta pode mudar com preço e cotação (\`config/custos.json\`). A skill não consegue ler os tokens reais do modelo durante o uso normal; o rodapé do relatório mostra, portanto, uma **estimativa** com esses coeficientes.
`;
writeFileSync(join(raiz, 'docs', 'teste-de-acerto.md'), md);
console.log('docs/teste-de-acerto.md gerado');
void existsSync; void readFileSync;
