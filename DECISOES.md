# DECISOES.md (v1)

Cada decisão: o que, motivo, alternativas.

## D-001 — Navegador do Playwright dentro da pasta
- Decisão: instalar Chromium com PLAYWRIGHT_BROWSERS_PATH=0 (fica em node_modules/playwright-core/.local-browsers).
- Motivo: limite duro proíbe instalar fora da pasta do projeto; o padrão do Playwright instala em %LOCALAPPDATA%.
- Alternativas: instalação padrão (descartada, fica fora da pasta).

## D-002 — Subagentes baratos (Haiku) para resumir repositórios
- Decisão: um subagente Haiku por repositório de referência, em paralelo, só leitura, sem executar código dos repos.
- Motivo: pedido do Berg (modelo barato); conteúdo clonado é tratado como dado.
- Alternativas: eu mesmo ler tudo (gasta contexto e dinheiro).

## D-003 — Não executar o binário do Impeccable
- Decisão: ler só os textos do Impeccable local; não rodar `impeccable detect`.
- Motivo: o launcher pode baixar um binário na primeira execução (instalação fora da pasta do projeto, proibida pelo CLAUDE.md). Não há pasta bin/ local.
- Alternativas: rodar o detector (descartada); escrever detectores próprios inspirados nas regras documentadas (adotada).

## D-004 — Regras redigidas por 6 subagentes Sonnet por grupo de categoria
- Decisão: um redator por grupo (visual A, visual B, texto/conteúdo/UX/clichês, a11y/perf/SEO/IA, lei/integridade/segurança, seções por tipo), todos validando com `scripts/validar-regras.mjs`.
- Motivo: qualidade e fonte exigem raciocínio; Haiku fica para leitura em lote. Paralelo reduz tempo.
- Alternativas: eu redigir tudo (gasta contexto); Haiku (risco de regra sem fonte).

## D-005 — Regras reescritas, nunca copiadas
- Decisão: toda regra é reescrita em PT-BR e guarda `fonte` e `origem_ids`; dados dos repos de origem (data/, paper/, textos do Reddit) não são reaproveitados.
- Motivo: licenças (MIT, CC-BY-4.0, Apache-2.0) e avisos de dados de terceiros sem licença clara nos repositórios ai-design-tells e unslop-ui.
- Alternativas: copiar listas literais (descartada).

## D-006 — Stack: Node ESM sem TypeScript
- Decisão: tudo em Node (.mjs), módulos em lib/, comandos em scripts/, testes com node:test.
- Motivo: Playwright, axe-core e Lighthouse já são Node; menos dependências e nada de build.
- Alternativas: TypeScript (build extra), Python (Lighthouse/axe são Node).

## D-007 — Tell Score com fórmula saturada, não "soma / peso total"
- Decisão: nota = 100·S/(S+C), S = Σ(peso×intensidade) dos tells disparados, C = 40 (ponto de partida). Nota 50 quando S = C.
- Motivo: com ~100 regras de tell no conjunto, dividir pelo peso total (como no SPEC §6.5 original e no ai-design-tells com 27 regras) achata a nota: até um site cheio de sinais ficaria perto de 20. A forma saturada mantém 0 = nenhum sinal, sobe rápido e nunca passa de 100.
- Alternativas: linear pelo peso total (descartada, diluição); contar regras (ignora peso). C será calibrado no teste de acerto (MT.5) e o valor final registrado aqui.

## D-008 — Detectores escritos por categoria, cobertura reportada
- Decisão: cada regra de script precisa de um detector em lib/deteccoes/<categoria>.mjs; regras sem detector aparecem em `cobertura.semDetector` e NÃO entram como "ok". O relatório informa a cobertura.
- Motivo: honestidade (nota é sinal, não veredito) e rastreabilidade.
- Alternativas: implementar só um subconjunto sem avisar (descartada).

## D-009 — Preços e cotação com fonte e data em config/custos.json
- Decisão: preços da página oficial da Anthropic (lida em 2026-11-18) e PTAX de venda de 2026-11-17 (R$ 5,7851, API Olinda do Banco Central). Coeficientes de tokens são iniciais e serão recalibrados na medição real.
- Motivo: CLAUDE.md pede reais, fonte e data. A PTAX de 18/11 ainda não estava publicada.

## D-010 — Seleção dos 20 sites "bons" do teste de acerto
- Decisão: os 20 "Sites of the Day" mais recentes de uma premiação pública de web design (lista pública consultada em 2026-11-18; a lista exata fica só em saidas/acerto/, fora do repositório), excluindo 3 domínios de staging (*.webflow.io). Só a página inicial, respeitando robots.txt e com intervalo de 3 s. A lista fica em saidas/acerto/ (fora do git); no repositório entram só números agregados.
- Motivo: regra objetiva (sem escolher "os que combinam"), evita cherry-picking.
- Limitação já conhecida: premiados são pesados em animação/WebGL e podem ter telas de carregamento; isso afeta medidores e é registrado em docs/teste-de-acerto.md.

## D-011 — 20 sites "de IA" gerados por subagentes com prompts genéricos
- Decisão: 5 tipos (landing-page, loja, site-institucional, blog, página de vendas) × 4 prompts curtos ("Crie uma landing page moderna e profissional para ..."), uma passada, HTML autocontido (sem CDN), sem skills de design.
- Motivo: simula pessoa leiga pedindo com um único prompt. Sem CDN/imagens externas para o teste ser determinístico (isso remove sinais como "Tailwind CDN" e favorece um pouco os sites de IA; registrado como limitação).
- Os arquivos ficam em saidas/acerto/ia (fora do git).

## D-012 — Revisão de segurança (subagente independente) e o que foi feito
- Corrigido: IPv6 com IPv4 embutido (mapeado em hexadecimal, compatível, NAT64, 6to4) agora é tratado como interno (BlockList + conversão); entrada local (pasta/ZIP/colado) NÃO libera mais a rede interna (só o servidor próprio em `permitidos`); prompts de correção sanitizam e marcam tudo que vem do site ([DADO DO SITE...]) e o refino do modelo também; o pacote do modelo sanitiza CTAs e URLs (sem query/userinfo), escapa `<` no JSON (o site não fecha `</dados-do-site>`), falha fechada sem sanitizador e o SKILL.md proíbe abrir arquivos crus; ReDoS removido (remoção de blocos/tags e e-mails em tempo linear; curingas do robots sem regex; varredura de links limitada); todo `page.evaluate` tem prazo (página hostil não trava); sem fallback `--no-sandbox` no Lighthouse; WebSocket e WebRTC bloqueados no navegador isolado; CSP mais estrita (`base-uri`, `form-action`); PDF e cards sem JavaScript; URL no relatório sem usuário/senha/query/hash; `$&`/`{{CORPO}}` no host não desfiguram mais o relatório; slug da CLI validado.
- Risco residual ACEITO e documentado: (1) DNS rebinding (checagem de DNS e conexão são duas resoluções; mitigação completa exige proxy local filtrante); (2) o Chromium do Lighthouse roda fora do roteamento (só a URL inicial é validada; redirecionamentos e sub-recursos do site analisado podem tocar a rede do usuário); (3) o cache em saidas/cache e as pastas temporárias de ZIP não são limpos automaticamente; (4) `script-src 'unsafe-inline'` no relatório HTML (só o botão de copiar; PDF e cards rodam sem JS). Para analisar sites desconhecidos, prefira uma máquina sem acesso a serviços internos sensíveis.
- Alternativas: proxy local filtrante para o Chromium e o Lighthouse (maior esforço, fica como melhoria).

## D-013 — Calibração: só a constante C foi adotada
- Decisão: C passou de 40 para 57,3 (o limiar do treino vira nota 45). Os multiplicadores por categoria (cor 1,5; tipografia 1,5; movimento 0,5) NÃO foram adotados.
- Motivo: no treino o AUC subiu de 0,90 para 1,00, mas na validação foi de 0,90 para 0,89: ajuste ao treino, sem ganho real. C só muda a escala da nota, não a ordem dos sites.
- Resultado do teste (40 sites, 20 IA + 20 premiados): AUC 0,88; medianas 46,1 (IA) × 31,5 (premiados); com o melhor limiar, 4 de 20 sites de IA e 3 de 20 premiados caem do lado errado. Veja docs/teste-de-acerto.md. A nota separa razoavelmente, com sobreposição: serve como sinal, não como veredito individual.

## D-014 — Âncora de citação para medições de estilo
- Decisão: achados de selo "opinião" sem citação de trecho (e "fato" sem citação) ganham como âncora o título da página (campo `citacao_de_ancora`). A medição em si continua nas evidências.
- Motivo: cores, sombras e raios computados não existem como texto no código; sem âncora, o verificador descartava achados válidos. Limite: a âncora só garante que a página existe e foi lida, não prova a medição.
- Alternativa: afrouxar o verificador (descartada, enfraquece a garantia).

## D-015 — Resumo barato por página (Haiku) não foi implementado
- Decisão: o modo completo usa um pacote maior (teto 40 mil tokens) lido só pelo modelo de julgamento; não há etapa separada de resumo por página com modelo barato.
- Motivo: o pacote já é compacto (evidências, não páginas) e uma etapa a mais aumentaria a complexidade e o risco de injeção de prompt por mais um caminho. O custo medido já fica dentro da faixa pedida.

## D-016 — Ajuste v1: regra de fonte do Google e aviso "referência não é cópia" (2026-11-19)
- Decisão: nova regra `seg-fonte-google-servidores` (fato verificado + `interpretacao` em campo próprio, selo opinião; P3; categoria fora do Tell Score) e bloco fixo "Referência não é cópia" no fim do relatório e nos prompts que citam referência/inspiração; teste que proíbe ordem de copiar/clonar site. O campo `interpretacao` entrou no esquema do achado e é mostrado no relatório com o selo de opinião.
- Fatos conferidos em 2026-11-19 (e só o que foi confirmado foi citado):
  - Landgericht München I, sentença de 20/01/2022, processo 3 O 17493/20, 100 euros, GDPR art. 82, item 1: lido na página da decisão em Bayern.Recht (gesetze-bayern.de), que traz tribunal, data, processo e valor, e em fontes secundárias. Uma fonte secundária citou 19/01/2022; prevaleceu 20/01/2022 (a página da decisão e as demais).
  - LGPD (Lei 13.709/2018), art. 5º, inciso I: lido no texto do Planalto ("informação relacionada a pessoa natural identificada ou identificável").
  - Lei 9.610/1998 arts. 7º, 8º inciso I e 29; Lei 9.609/1998 art. 2º e § 3º; Lei 9.279/1996 arts. 122 e 129 (só o art. 129 é citado): lidos no texto do Planalto.
  - Licenças das fontes (OFL, Apache 2.0, Ubuntu Font License 1.0; licença no diretório de cada família): lido no README do repositório google/fonts.
- NÃO confirmado: decisão brasileira equivalente (busca na web não achou; o texto diz "não foi encontrada", não "não existe"); texto das páginas de FAQ e de licenciamento do Google Fonts (montadas por JavaScript, ilegíveis aqui); se a página Bayern.Recht é a base oficial (traz o marcador do portal do Estado da Baviera, mas reproduz referências de editora).
- Motivo da separação em dois níveis: o fato é medido; o efeito sobre privacidade é interpretação e jurisdição estrangeira. Nunca "viola" nem "ilegal".
- Também: custos do README recalculados com a cotação de 19/11/2026 (5,8889), mesmos tokens medidos; contagem de regras: 308.

## D-017 — Limpeza do material externo pago no repositório público (2026-11-19)
- Decisão: nenhum arquivo versionado cita o material externo pago. O material de seções por tipo do Berg fica só em pastas locais fora do git (`entrada/` e `local/`); uma pasta extra de entrada local também entrou no `.gitignore` por segurança. SPEC §6.3, §11.2, §13 e §14.3, e os documentos internos de trabalho reescritos. O nome do produto de exemplo do caso nº 1 nas fixtures, nos testes, no script e no doc de regressão foi trocado por "Catálogo", sempre fixture e expectativa juntas.
- Motivo: o material é pago e não pode aparecer, nem por menção, no repositório público. A troca de nome não muda nenhuma regra, peso ou lógica: a suíte seguiu em 562 testes passando sem ajustar nenhum teste além da troca do nome.
- Alternativas: (a) manter o nome só nos testes: descartada, a busca por menção precisa dar zero; (b) reescrever o histórico do git agora: não feito por ordem do Berg, os commits antigos ainda têm as menções e isso deve ser tratado antes de qualquer publicação.

## D-018 — Como publicar: repositório novo com commit inicial limpo (2026-11-19)
- Decisão (do Berg): o histórico do git atual NÃO será reescrito. Na hora de publicar, cria-se um repositório novo, só com os arquivos atuais e um commit inicial limpo. O repositório antigo (com o histórico completo) fica só na máquina do Berg e nunca é enviado a lugar nenhum.
- Motivo: os commits anteriores a D-017 ainda contêm menções ao material externo pago; um repositório novo resolve isso sem mexer no histórico local.
- Cuidados na hora: copiar só os arquivos versionados (nada de `entrada/`, `referencias/`, `saidas/`, `.env`), repetir a busca final por menções ao material pago nos arquivos copiados e rodar `npm test` antes do commit inicial.
- Alternativas descartadas: reescrever o histórico (arriscado e dispensado pelo Berg); publicar o repositório atual (exporia o histórico).

## D-019 — Exemplo nº 1 passou a ser fictício (2026-11-20)
- Decisão: referências a site real removidas; o exemplo nº 1 passou a ser fictício.

## D-020 — Módulo "Subir no Google": nota separada e regras em arquivo próprio (2026-11-20)
- Decisão: regras novas em `regras/seo-google.json` (categoria `seo-google`, ids `seo-`); a nota de SEO é calculada à parte (`lib/seo-nota.mjs`) com as regras `seo`, `seo-google` e uma lista fixa de regras de outras áreas reaproveitadas (config/seo-google.json). A nota geral, as notas por área e o Tell Score não mudam.
- Motivo: evita duplicar o que já existe e não quebra os 562 testes nem a calibração. Alternativa descartada: mover tudo para a área "seo" (mudaria a nota geral).

## D-021 — Onde o módulo entra (2026-11-20)
- Decisão: só no modo completo ou com pedido explícito (`--seo`). No modo rápido não carrega regras nem medidor de SEO novos (as 22 regras `seo-*` antigas continuam como sempre). O CSV só é lido com `--csv`.
- Motivo: custo baixo como requisito. Alternativa: rodar sempre (mais lento e mais caro por análise).

## D-022 — Sem curva externa de CTR (2026-11-20)
- Decisão: "CTR abaixo do esperado" = abaixo da mediana do próprio CSV na mesma faixa de posição (arredondada). Nenhuma tabela de CTR por posição de terceiros.
- Motivo: sem fonte oficial, qualquer curva seria inventada. Alternativa: usar estudos de mercado (descartada: sem fonte do Google).

## D-023 — Heurísticas sem fonte do Google (2026-11-20)
- Decisão: H1 (o Google diz que a ordem dos títulos não importa), Open Graph (não afeta posição), "sobre", fontes citadas, NAP entre páginas, mapa e `tel:` entram como opinião/heurística, confiança baixa ou média, peso baixo, com o texto dizendo isso. FAQPage NÃO é recomendado por SEO (recurso descontinuado pelo Google em 7/5/2026, conferido em 2026-11-20).
- Motivo: nenhuma afirmação sem fonte e sem nível de confiança.

## D-024 — Leitura do CSV (2026-11-20)
- Decisão: parser próprio, no máximo 5 MB e 50.000 linhas, separador (vírgula, ponto e vírgula ou tab) detectado, cabeçalhos em português e inglês, valores sempre tratados como texto/número (nunca avaliados), nada enviado à rede, arquivo nunca copiado para a pasta de análise.
- Motivo: segurança e simplicidade. Alternativa: biblioteca de CSV (dependência nova sem necessidade).

## D-025 — Ajustes do módulo "Subir no Google" durante a construção (2026-11-20)
- CTR "abaixo do esperado" (refina D-022): abaixo de **70% da mediana do próprio CSV** na mesma faixa inteira de posição, só com pelo menos 5 linhas na faixa e 100 impressões; abaixo da mediana pura marcaria metade das linhas por definição.
- Custo (D-021): módulo medido em 2026-11-20 e gravado em `config/custos.json` (`modulo_seo`): +1.981 tokens de entrada no pior caso (site com muitos problemas), +242 em site bom; saída extra estimada (~90 tokens por crítica nova). Custo extra: de R$ 0,01 a R$ 0,07 por análise (Sonnet 5.5, US$ 2 e US$ 10 por milhão de tokens, conferidos em 2026-11-20; cotação 5,8889 do Banco Central, último valor publicado em 19/11/2026). O estimador soma esse extra no modo completo ou com `--seo`.
- Regras de outras áreas que contam para SEO entram na nota por referência (lista em `config/seo-google.json`), sem duplicar regra.
- Fixtures de teste: `seo-ruim` e `seo-boa` (fictícias). O sitemap da `seo-boa` usa endereços de exemplo, o que faz a regra antiga `seo-paginas-sem-link-interno` apontar algo (confiança baixa): aceito, a nota continua acima de 96.
- Verificação do exemplo nº 1: a fixture fictícia já tinha 5 tipos de dados estruturados nomeados mais Offer, Question e Answer aninhados (8 tipos no total) e 45 de 57 imagens com lazy; não foi preciso criar cópia enriquecida.

## D-026 — Limpeza de termos na lista de iscas digitais (2026-11-20)
- Decisão: saíram da lista de palavras que indicam "isca digital" (lib/tipo-de-site.mjs) as grafias de livro digital sem e com hífen; entraram "livro digital" e "material gratuito". As outras palavras da lista (baixe, download, receba, gratuito, guia...) continuam.
- Motivo: regra do Berg de limpeza de termos nos arquivos versionados. Efeito: páginas que só usam a grafia antiga como pista deixam de somar esse ponto; o tipo do site ainda é decidido pelas demais pistas (testes de tipo de site seguem verdes).

## D-027 — Grafias de mercado restauradas no detector de tipo de site (2026-11-20)
- Decisão: as grafias "ebook" e "e-book" voltam à lista de iscas digitais de `lib/tipo-de-site.mjs` (junto de "livro digital" e "material gratuito"). Termo de mercado reconhecido pelo detector de tipo de site; exceção aceita na busca final de termos.
- Motivo: a limpeza da D-026 tirou essas grafias por efeito colateral. São palavras comuns em páginas de venda e captura de infoproduto, e a skill precisa reconhecê-las. Revoga só essa parte da D-026.
- Prova: `tests/tipo-de-site-isca-ebook.test.mjs` gera uma página fictícia que só usa o termo (numa pasta temporária, para a palavra existir apenas no teste) e confere que a pontuação de landing page sobe 1 ponto em relação à mesma página com outra palavra.
- Alternativas: manter só as grafias novas (perde páginas reais); criar lista externa em JSON (mais complexidade sem ganho agora).

## D-028 — Camada local opcional de seções por tipo, com precedência sobre as públicas (2026-11-20)
- Decisão: o carregador de seções procura primeiro `local/secoes-por-tipo/<tipo>.json`; se existir e for válido, ele vale mais que o público daquele tipo; se não existir ou estiver quebrado, usa o público e registra aviso. A mesma camada pode trazer regras extras (`local/regras-*/`) e detectores (`local/deteccoes-*/`), validados pelo esquema público; selo de regra documentada só com fonte `https`. O carimbo do relatório inclui o hash da camada local. Documentação: `docs/secoes-locais.md`.
- Motivo: permitir que cada pessoa use o próprio método sem tocar no repositório público e sem que nada dele vá para o GitHub.
- Alternativas: substituir os JSONs públicos (perde as seções públicas e suja o repositório); só uma pasta de seções sem regras (não cobre detectores do método).

## D-029 — Suíte pública hermética e tipo só local (2026-11-20)
- Decisão 1: `npm test` pré-carrega `tests/ambiente-publico.mjs`, que liga `CRITIQUESITES_LOCAL=off`. A suíte pública dá o mesmo resultado em qualquer máquina, com ou sem `local/`. Testes do mecanismo passam pastas de exemplo explicitamente.
- Decisão 2: um tipo que só existe na camada local é aceito quando o arquivo existe e é escolhido com `--tipo`; a detecção automática continua com os 11 tipos públicos (um tipo sem seções públicas não teria o que checar para quem não tem a camada local).
- Alternativas: `cross-env` (nova dependência); detectar o 12º tipo no código público (cobraria seções públicas sem fonte aberta).

## D-030 — Perguntas de julgamento da camada local e custo medido (2026-11-20)
- Decisão 1: regras locais com detecção "julgamento" entram nos critérios do pacote (antes só as de UX entravam) e o modelo responde em `heuristicas` (nota 0 a 4 e motivo). O limite de respostas passou de 10 para 16 porque os critérios públicos já passam de 20.
- Decisão 2: o estimador de custo soma o extra medido da camada local (`camada_local` em `config/custos.json`) só quando ela está ativa. Medido em 3 sites fictícios, rápido e completo: de 548 a 1.145 tokens de pacote a mais e de R$ 0,02 a R$ 0,04 por análise (Sonnet 5.5, US$ 2 e US$ 10 por milhão de tokens; dólar a R$ 5,8889, último valor do Banco Central, de 19/11/2026; preços conferidos na página oficial em 20/11/2026). A saída extra é estimada, não medida.
- Alternativas: manter o limite de 10 (as perguntas locais competiriam com as de UX); deixar a camada local fora do estimador (aviso de custo subestimado).
