# Teste de acerto (v1)

Gerado por `scripts/gerar-doc-acerto.mjs`. Só números agregados: os sites de terceiros usados no teste ficam apenas na máquina local (`saidas/`, fora do repositório) e não são citados aqui.

## O que foi testado

Mede quanto a parte **objetiva** da nota (o Tell Score: menor é melhor) separa dois grupos de páginas iniciais:

- **Grupo "gerados por IA":** 20 sites criados localmente por subagentes do Claude com **um prompt curto e genérico** ("Crie uma landing page moderna e profissional para ..."), em uma única passada e sem direção de design. 5 tipos (landing page, loja, site institucional, blog, página de vendas) × 4 temas. Cada site é um HTML autocontido (sem bibliotecas nem fontes externas, para o teste ser determinístico).
- **Grupo "premiados":** 20 sites escolhidos por uma regra objetiva e sem seleção a dedo: os 20 "Sites of the Day" mais recentes de uma premiação pública de web design (lista consultada em 2026-11-18), excluindo domínios de staging. **Só a página inicial**, respeitando `robots.txt` e com intervalo de 3 s entre acessos.
- Modo rápido, sem Lighthouse, sem julgamento do modelo (só a parte objetiva, repetível).
- Treino e validação **separados** para a calibração: treino = os temas 1 e 2 de cada tipo (10 sites de IA) e os premiados 01 a 10; validação = temas 3 e 4 e os premiados 11 a 20. A calibração só mexe em 2 coisas: multiplicadores por categoria (grade 0,5 / 1 / 1,5) e a constante C da fórmula.

## Conclusão em uma frase

A nota objetiva **separa razoavelmente** os dois grupos, mas **com sobreposição importante**: parte dos sites de cada grupo cai do lado errado. Serve como sinal de conjunto, **não como veredito de um site individual**. AUC na validação (10 + 10 sites): **0,9**; nos 40 sites: **0,88** (1,00 = separação perfeita; 0,50 = sorteio).

## Resultado antes da calibração (C = 40, todos os multiplicadores = 1; notas na escala antiga)

| Grupo | Sites lidos | Mediana | Média | Faixa |
|---|---|---|---|---|
| Gerados por IA | 20 de 20 | 55,1 | 54,9 | 40,7 a 69 |
| Premiados | 20 de 20 | 39,8 | 36,9 | 4,8 a 56,8 |

Diferença de medianas: **15,3 pontos**. AUC (todos os sites): **0,88**. Melhor limiar: 49,9 (sensibilidade 80%, especificidade 85%; falsos negativos 4, falsos positivos 3).

## Calibração (treino × validação)

Foram testadas duas mudanças, escolhidas **só com o conjunto de treino**:

1. **Multiplicadores por categoria** (grade 0,5 / 1 / 1,5): escolhidos no treino visual-cor 1,5; visual-tipografia 1,5; visual-movimento 0,5. No treino o AUC foi de 0,9 para 1, mas na **validação** foi de 0,9 para 0,89. Sem ganho na validação, isso é sinal de ajuste ao treino: **os multiplicadores NÃO foram adotados** (todos ficam em 1).
2. **Constante C** da fórmula: o limiar do treino passa a valer nota 45 (fronteira entre as faixas C e D). **Adotado: C = 57,3** (antes 40). Isso muda só a escala da nota, não a ordem dos sites (o AUC não muda).

| Conjunto | AUC | Mediana IA | Mediana premiados | Diferença | Melhor limiar |
|---|---:|---:|---:|---:|---|
| Treino (C adotado) | 0,9 | 46,3 | 35,5 | 10,8 | 45 (sensibilidade 70%, especificidade 100%; falsos negativos 3, falsos positivos 0) |
| **Validação (C adotado)** | 0,9 | 44,3 | 25,2 | 19,1 | 41 (sensibilidade 80%, especificidade 90%; falsos negativos 2, falsos positivos 1) |
| Todos os 40 sites (C adotado) | 0,88 | 46,1 | 31,5 | 14,6 | 41 (sensibilidade 80%, especificidade 85%; falsos negativos 4, falsos positivos 3) |
| Validação com multiplicadores (não adotado) | 0,89 | 50,5 | 25,9 | 24,6 | 39,6 (sensibilidade 90%, especificidade 80%; falsos negativos 1, falsos positivos 2) |

A validação é o número que importa: o treino foi usado para escolher os parâmetros e tende a parecer melhor.

## Falsos positivos e falsos negativos (com o C adotado)

- Falsos negativos (site gerado por IA com nota baixa, abaixo do limiar): validação 2 de 10; nos 40 sites 4 de 20.
- Falsos positivos (site premiado com nota alta, acima do limiar): validação 1 de 10; nos 40 sites 3 de 20.
- O limiar é o que maximiza a acurácia balanceada **na própria amostra**; em sites novos, espere pior.

## Por tipo de site (grupo de IA, antes da calibração)

| Tipo | Sites | Mediana | Faixa |
|---|---:|---:|---|
| blog | 4 | 53,4 | 48,4 a 60 |
| institucional | 4 | 54,7 | 49,9 a 56,2 |
| landing-page | 4 | 64,3 | 62 a 69 |
| loja | 4 | 46,1 | 40,7 a 50,9 |
| vendas | 4 | 56,1 | 51,1 a 61,3 |

## Limitações (leia antes de confiar na nota)

1. O teste compara sites **genéricos gerados por IA com um prompt curto** contra sites **premiados por design**. Não mede toda a realidade: um site feito por IA com um bom briefing pode ter nota baixa, e um site feito por gente sem cuidado pode ter nota alta.
2. Sites premiados costumam ser pesados em animação, WebGL e telas de carregamento; isso pode distorcer medidores baseados em estilo e em texto visível (leitura da página inicial apenas). Sites que falharam na leitura entram como "erro" e ficam fora das médias (coluna "Sites lidos").
3. Os sites de IA não usam bibliotecas nem fontes externas (para ser determinístico), o que remove alguns sinais comuns (CDN de utilitários) e favorece um pouco esse grupo.
4. Tamanho pequeno (20 + 20 sites): as medianas têm incerteza grande; o AUC não tem intervalo de confiança aqui. Nenhum resultado deste teste deve ser lido como taxa de acerto "real".
5. Os pesos das regras vêm de fontes (ver `CREDITS.md`), mas os limiares de vários detectores são **iniciais**, marcados como "a calibrar" no código; a calibração acima mexe só em multiplicadores por categoria e na constante C.
6. A nota é um **sinal, não um veredito**. Nunca prometa 100% de acerto.

## Custo real (tokens e R$)

Medido em 2026-11-19 com o contador de contexto da própria sessão do Claude Code (antes e depois de cada etapa; a consulta do contador, 974 tokens, foi descontada). Modelo de julgamento: Claude Sonnet 5.5 (US$ 2 de entrada e US$ 10 de saída por milhão de tokens, página oficial de preços da Anthropic consultada em 2026-11-19). Cotação de 2026-11-19: US$ 1 = R$ 5,89 (Banco Central do Brasil, SGS serie 1).

| Etapa medida | Tokens |
|---|---:|
| Ler o `SKILL.md` | 4100 |
| Ler o pacote de evidências de um site real, 1 página, modo rápido (40623 caracteres) | 19100 |
| Escrever o `julgamento.json` (7171 caracteres) | 2400 (saída) |
| Pacote do modo completo, site local com 12 páginas (35551 caracteres) | ≈ 16700 |

Estimativa resultante (inclui ~3 mil tokens de saídas de ferramentas e ~2 mil de raciocínio na saída):

| Cenário | Entrada | Saída | Custo estimado |
|---|---:|---:|---:|
| Rápido, até 8 páginas | 23100 | 4400 | **R$ 0,53** |
| Completo, 12 páginas | 30700 | 6740 | **R$ 0,76** |
| Completo, 30 páginas (pacote no teto) | 45100 | 7100 | **R$ 0,95** |

Comparação com a sua estimativa (R$ 0,80 a R$ 1,00 por site médio no modo completo): o completo medido fica entre **R$ 0,76 e R$ 0,95**, ou seja, **dentro ou um pouco abaixo** da sua faixa; o rápido custa cerca de **R$ 0,53**.

Limites da medição: o raciocínio interno do modelo não aparece no contador (usamos ~2 mil tokens de margem); o modo completo foi medido só no tamanho do pacote (a saída foi estimada a partir do modo rápido); cache de leitura entre as rodadas do modelo foi ignorado (reduz um pouco o custo real); a conta pode mudar com preço e cotação (`config/custos.json`). A skill não consegue ler os tokens reais do modelo durante o uso normal; o rodapé do relatório mostra, portanto, uma **estimativa** com esses coeficientes.
