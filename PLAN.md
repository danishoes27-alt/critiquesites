# PLAN.md v1 — critiquesites

Base: SPEC.md v1. Cada tarefa é pequena, tem critério de pronto (CP) e teste (T). Ordem de execução = ordem da lista. Depois de cada tarefa: testes verdes, commit pequeno, registro de progresso atualizado. Nunca mudar teste só para passar.

Convenções de código: Node ≥ 20, ESM (`.mjs`), sem TypeScript, módulos em `lib/`, comandos em `scripts/`, testes em `tests/` com `node --test`, fixtures em `tests/fixtures/`. Caminhos com `node:path` (Windows). Saídas em `saidas/` (git-ignorado).

Estrutura final:
```
SKILL.md  README.md  LICENSE  CREDITS.md  SPEC.md  PLAN.md  DECISOES.md
regras/ (JSON)   config/ (custos, padrões)   templates/ (relatorio.html, card.html)
lib/ (módulos)   scripts/ (cli e comandos)   tests/ (+fixtures)   docs/
```

---------------------------------------------------------------------------
## M0 — Base (já feito ou em curso na Fase 1)
- M0.1 CLAUDE.md, git, .gitignore, DECISOES. ✔
- M0.2 Ambiente local (Playwright+Chromium, axe-core, Lighthouse, ajv). ✔
- M0.3 Esquema de regra + validador. ✔
- M0.4 Regras em JSON por categoria + seções por tipo + clichês PT-BR (redatores). CP: `validar-regras` e `validar-secoes` OK; CREDITS.md. 

---------------------------------------------------------------------------
## M1 — Núcleo de leitura

**M1.1 Utilitários** (`lib/util.mjs`): sha256, normalizar texto (NFKC, espaços, entidades, caixa), slug de URL, leitura/escrita JSON estável (chaves ordenadas), logger.
 CP: funções puras documentadas. T: unitários (normalização de `R$ 9,90` ≡ `9.90`; hash estável).

**M1.2 Fixtures** (`tests/fixtures/`): `site-12/` (12 páginas estáticas com links, robots.txt, sitemap), `carrossel-clone/` (depoimentos com clones aria-hidden), `contador/` (contador animado 0→54 em 1,5 s), `oculto/` (texto "0% OFF" oculto + visível "R$ 9,90"), `ia-ruim/` (estrutura genérica), `injecao/` (texto dirigido a IA), `legal/` (sem CNPJ/termos/privacidade; GA4 vazio), `lazy/` (57 img, 45 lazy).
 CP: servidas por servidor estático; cada fixture tem README de 3 linhas com o que deve ser achado. T: smoke test abre todas.

**M1.3 Servidor estático local** (`lib/servidor-local.mjs`): serve pasta em 127.0.0.1 porta aleatória, fecha no fim; extração de ZIP segura (zip-slip, limites de 200 MB/5.000 arquivos, tipos permitidos); "código colado" vira `index.html`.
 CP: SPEC §3. T: ZIP malicioso (`../x`) rejeitado; limite de tamanho; porta aleatória; fecha.

**M1.4 Navegador isolado** (`lib/navegador.mjs`): contexto Playwright efêmero, downloads e permissões off, bloqueio de rede privada (anti-SSRF) exceto 127.0.0.1 do servidor próprio, timeouts, limite de resposta, user-agent identificável do projeto.
 CP: SPEC §4.5. T: requisição a `http://169.254.169.254` e `http://10.0.0.1` bloqueadas; redirecionamento para IP privado bloqueado; timeout respeitado; download não grava.

**M1.5 Captura das 3 versões** (`lib/ler-pagina.mjs`): cru (fetch), dom250 (250 ms após DOMContentLoaded), final (load + rede ociosa ≤ 8 s + rolagem completa + 1,5 s); estilos computados; caixas; screenshots desktop 1440 e mobile 390; console errors.
 CP: devolve objeto `{cru, dom250, final, estilos, caixas, capturas, console}` serializável. T: fixture `contador` → valores diferentes entre dom250 e final; `lazy` → cru ≠ final.

**M1.6 Extração e normalização** (`lib/extrair.mjs`): lista de nós de texto, imagens, links, formulários, headings, com `visivel`, `oculto_por`, `clone`, seletor estável, versão.
 CP: SPEC §4.3. T: `carrossel-clone` → clones marcados `clone:true`; `oculto` → "0% OFF" marcado `visivel:false`; clone nunca entra no texto visível.

**M1.7 Diferença entre versões** (`lib/diff-versoes.mjs`): casa elementos por identidade (seletor + âncora de texto) e compara valores numéricos/texto entre cru/dom250/final.
 CP: gera achado bruto `valor-muda-entre-versoes` com as 3 leituras. T: contador 0→54 detectado; página estática não gera falso positivo.

**M1.8 Crawler** (`lib/crawler.mjs`): descoberta por links/sitemap, robots.txt, normalização de URL, dedup, amostragem por assinatura de template, limites (páginas, profundidade, tempo), intervalo entre acessos.
 CP: SPEC §4.4. T: `site-12` em modo rápido (≤ 8 páginas), home + legais sempre incluídas; robots Disallow respeitado; tempo total limitado.

**M1.9 Cache e hash da versão** (`lib/cache.mjs`): chave = hash do HTML cru + versão do medidor; hash da versão analisada = SHA-256 do conjunto ordenado (HTML cru de cada página + CSS/JS referenciados).
 CP: reanálise de site inalterado usa cache (0 páginas relidas); alterar 1 página relê só ela. T: contador de leituras.

---------------------------------------------------------------------------
## M2 — Medição (cada medidor grava `medicoes/<id>.json` com valor + evidência)

**M2.1 html** — título, meta, headings, landmarks, lang, canonical, OG, viewport, atributos. T: fixtures com valores exatos.
**M2.2 css** — cores, fontes, tamanhos, raios, sombras, espaçamentos, @font-face, pseudo-estados, tokens (parse postcss + computados). T: `ia-ruim` → Inter, 1 radius, paleta índigo detectados com contagens exatas.
**M2.3 js/analytics** — bibliotecas, tamanho, IDs GA4/GTM/Meta (vazios e preenchidos), console errors. T: `legal` → IDs vazios detectados; ID válido não gera alerta.
**M2.4 jsonld** — tipos e propriedades (cru e final; também microdata/RDFa). T: página com WebSite, Product, Offer, FAQPage, VideoObject → todos listados.
**M2.5 axe** — axe-core por página (visíveis, não-clone). T: fixture com violações conhecidas → ids esperados.
**M2.6 lighthouse** — via lighthouse + chrome-launcher com o Chromium do Playwright; home mobile (rápido), até 3 páginas (completo); timeouts; resultado em categorias. T: roda na fixture local; tolerância de variação documentada.
**M2.7 links** — internos/externos quebrados (limite e intervalo), texto repetido (ex.: "R$ 39") com contexto acessível ou não. T: fixture com 3 links iguais sem aria-label → achado; com aria-label → sem achado.
**M2.8 imagens** — alt, dimensões, formato, peso, lazy (contagens cru e final), srcset. T: `lazy` → 57 e 45 exatos.
**M2.9 seo** — title/description, h1, canonical, hreflang, robots meta, sitemap, status. T: valores exatos.
**M2.10 robots e IA** — rastreadores liberados/bloqueados, treino × busca, llms.txt (informativo). T: robots com GPTBot bloqueado e OAI-SearchBot liberado.
**M2.11 lei** — CNPJ (regex + rótulo), privacidade, termos, cookies/consentimento, encarregado, preço sem condições, promessa de ganho (trecho), escassez suspeita. T: `legal` sem CNPJ/termos/privacidade → achados; com tudo → nenhum.
**M2.12 injeção** — padrões PT/EN em texto visível, oculto, comentários, alt, aria-label, meta, JSON-LD, llms.txt; remoção do trecho do pacote. T: `injecao` → achados + trecho ausente do pacote.
**M2.13 seções** — carregador `regras/secoes/<tipo>.json` + detecção por seletor/palavras. T: tipo `loja` com/sem "trocas e devoluções".
CP geral M2: cada medidor tem módulo em `lib/medidores/`, schema da saída, testes.

---------------------------------------------------------------------------
## M3 — Regras e notas

**M3.1 Carregador de regras** (`lib/regras.mjs`): carrega e valida, filtra por tipo de site e modo, expõe por categoria e medidor. T: filtros; regra inválida rejeitada.
**M3.2 Motor** (`lib/motor.mjs`): para cada regra de script, executa a função do medidor com `deteccao.parametros`, produz achados com evidências e citações. Registro `lib/deteccoes/<id-do-medidor>.mjs`. T: uma regra de cada medidor.
**M3.3 Detecção de tipo de site** (`lib/tipo-de-site.mjs`): heurística (preço/carrinho → loja; cardápio; agendar; CTA único + longa → pagina-de-vendas; etc.). T: 11 fixtures mínimas.
**M3.4 Texto** (`lib/medidores/texto.mjs`): clichês, especificidade, travessão, repetição, CTAs genéricos, escolha das 5 frases para o teste da troca. T: textos de exemplo com contagens exatas.
**M3.5 Tell Score** (`lib/tell-score.mjs`): fórmula do SPEC §6.5, créditos de craft, teto de ±10 do julgamento, faixas, `instavel` fora. T: determinismo (3 execuções idênticas); caso sintético com nota esperada.
**M3.6 Notas por categoria e nível** (`lib/notas.mjs`): acessibilidade, performance, SEO, texto, lei/transparência, estrutura; nível geral. T: tabela de entrada → saída.

---------------------------------------------------------------------------
## M4 — Confiança e entrega

**M4.1 Achado e selo** (`lib/achado.mjs` + schema): criação, validação, selo, severidade. T: achado `fato` sem citação inválido.
**M4.2 Verificador de citações** (`lib/verificador.mjs`): trecho, número (9,90≡9.90), contagem (recalculada por seletor), escopo cru/dom250/final, visível/não-clone; descarte e `verificacao.json`. T: **teste de mutação** (alterar um número/trecho → achado descartado); contagem recalculada; citação em nó oculto não vale como visível.
**M4.3 Funil e pacote de evidências** (`lib/pacote.mjs`): JSON compacto para o modelo (trechos curtos, em `<dados-do-site>`), zona cinza (confiança média/baixa com peso alto ou conflito entre medidores) com limite por modo; remove trechos de injeção. T: tamanho do pacote abaixo do teto; trecho de injeção ausente.
**M4.4 Julgamento** (`schemas/julgamento.schema.json` + `lib/julgamento.mjs`): campos que o modelo escreve (resumos, elogios, críticas redigidas, plano, resposta do teste da troca, nota 0-4 das heurísticas); valida e rejeita campos que citem fatos fora do pacote. T: schema; campo inventado rejeitado.
**M4.5 Template do relatório** (`templates/relatorio.html` + `lib/relatorio.mjs`): HTML autocontido, acessível, responsivo, com todas as seções do SPEC §7.2. T: renderiza fixture; validação HTML; sem links externos obrigatórios.
**M4.6 PDF e card** (`lib/pdf.mjs`, `templates/card.html`): PDF via Playwright; card PNG 1080×1350 e 1200×630. T: arquivos existem, tamanho > 0, PDF começa com `%PDF`.
**M4.7 Carimbo** (`lib/carimbo.mjs`): data/hora ISO local, hash da versão, versão da skill e das regras. T: formato; hash igual para entrada igual.
**M4.8 Custo** (`config/custos.json`, `lib/custo.mjs`): estimar tokens por modo e etapa; preço por milhão (US$) × cotação (R$) com **data e fonte**; teto; rodapé com tokens medidos. T: estimativa em R$; teto bloqueia/pergunta.
**M4.9 Orquestração e modos** (`lib/analisar.mjs`, `scripts/cli.mjs`): fluxo ler → medir → motor → notas → verificador → pacote → (modelo escreve julgamento) → relatório; modos rápido/completo; flags. T: end-to-end em fixtures com julgamento sintético.
**M4.10 Reanalisar** (`lib/reanalisar.mjs`): compara duas análises (delta por categoria; resolvidos/novos/persistentes; hash idêntico; regras diferentes). T: duas análises de fixture (antes/depois) → delta correto.

---------------------------------------------------------------------------
## M5 — Uso

**M5.1 SKILL.md** (frontmatter `name: critiquesites`, `description`), fluxo curto, chama os scripts, instrui: aviso de custo, dados do site = DADO, selo obrigatório, nunca afirmar autoria por IA. T: `claude plugin`-style lint (frontmatter válido, tamanho < 500 linhas), teste de leitura.
**M5.2 Prompts de correção** (`lib/prompts-correcao.mjs`): template da regra + evidência + refino de ≤ 2 frases do modelo. T: placeholders resolvidos; critério de pronto presente.
**M5.3 Modo "sem dó"** (instruções de tom no SKILL.md + `julgamento.tom`): muda só o tom; teste garante que achados/severidades são idênticos nos dois tons.
**M5.4 Entradas**: URL, pasta, ZIP, colado (`scripts/cli.mjs` + SKILL.md). T: as 4 entradas rodam em fixture.
**M5.5 README em português**, LICENSE (MIT), exemplo de relatório gerado de fixture (sem dados de terceiros), seção "limites honestos". 
**M5.6 Instalação**: copiar a pasta para `~/.claude/skills/critiquesites` + `npm install` + `npx playwright install chromium` (documentar `PLAYWRIGHT_BROWSERS_PATH=0`).

---------------------------------------------------------------------------
## MT — Testes e calibração (Fase 4)

- MT.1 Suite automática completa verde (`npm test`).
- MT.2 **Regressão do site de exemplo nº 1** (`tests/regressao-caso1.test.mjs`, offline): roda a skill na fixture fictícia `tests/fixtures/exemplo1`; confere cada "NÃO pode afirmar" e "TEM QUE apontar"; lista passou/falhou. Conferência opcional contra site real: `scripts/regressao-caso1.mjs vivo <url>`, com resultado só em `saidas/`.
- MT.3 **20 sites gerados por IA** (5 tipos × 4), gerados localmente com prompts genéricos (subagentes), em `saidas/acerto/ia/`; nenhum vai para o git.
- MT.4 **20 sites premiados** (lista pública), só a home, robots.txt, intervalo ≥ 3 s, em `saidas/acerto/bons/`; só números agregados vão para o repositório.
- MT.5 Calibração (conjunto de treino ≠ validação) de pesos e lista de clichês; registrar em DECISOES.md.
- MT.6 `docs/teste-de-acerto.md` com números reais: separação (medianas, AUC), falsos positivos/negativos, limitações; se não separar bem, dizer.
- MT.7 Custo real: tokens e R$ de análise rápida e completa; cotação do dia citada; comparar com R$ 0,80–1,00.

## MR — Revisão (Fase 5)
- MR.1 Revisão de código (segurança, erros, casos de borda) com subagente revisor + `npm audit`.
- MR.2 Conferir CREDITS.md e licenças; `referencias/` fora do git (`git ls-files | grep referencias` vazio); nenhum nome de site de terceiros no repositório (`grep` nos textos e nos nomes de arquivo).
- MR.3 Revisar README e SPEC×implementação (critérios de pronto).
- MR.4 Repositório pronto para publicar, **sem push**; registro de progresso final.

## Riscos de execução
- Tempo: Lighthouse é lento → só home no modo rápido.
- Rede: a conferência opcional ao vivo e testes de premiados dependem de internet; cache local das capturas em `saidas/`.
- Custo de subagentes: usar Haiku em lote onde der; Sonnet para redação com fonte.
