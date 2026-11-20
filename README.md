# critiquesites

Uma skill para o Claude Code que **critica um site inteiro** e explica tudo em português simples, para quem não é dev.

Ela lê o site (todas as páginas que couberem na amostra), mede o código com scripts e entrega:

- **Relatório completo** em HTML e PDF: pontos fortes, pontos fracos, nível, elogios, críticas, comparações e plano do que melhorar.
- **Tell Score** (cara de IA, de 0 a 100, **menor é melhor**), com as evidências que levaram à nota.
- **Card de nota** (PNG) para compartilhar.
- **Um prompt de correção pronto** em cada crítica, para colar no Claude Code.
- **Modo reanalisar**: mostra a evolução da nota entre duas análises ("de 61 para 34").
- **Modo "sem dó"**: o mesmo conteúdo, com tom ácido (sobre o site, nunca sobre quem fez).

> A nota é um **sinal, não um veredito**. Ela não promete 100% de acerto e pode errar. Veja [Limites](#limites-honestos).

## O que ela analisa

Conteúdo e código (HTML, CSS, JS) do site inteiro: visual genérico ("tells"), acessibilidade, performance, SEO, visibilidade em IA, texto, **lei brasileira** (CDC, LGPD, cookies, CNPJ, termos e privacidade), estrutura e as seções esperadas para cada tipo de site (loja, blog, landing page, cardápio, agendamento, página de vendas, portfólio, link na bio, área de membros, catálogo e site institucional).

- **Lei:** a skill **avisa e explica o risco**, nunca proíbe. Não é parecer jurídico. A decisão é sua.
- **IA e SEO:** o `llms.txt` só é informado (peso 0; o Google diz que não é necessário). Sobre rastreadores de IA no `robots.txt`, ela só mostra o que está liberado ou bloqueado e a diferença entre treino e busca. Nunca manda bloquear nem liberar.
- **Texto:** é avaliado como "genérico/batido" (teste da troca do nome da empresa pelo do concorrente). A skill **nunca afirma que algo foi escrito por IA**.

## Subir no Google (SEO)
Módulo opcional que dá uma **nota de SEO de 0 a 100**, separada do Tell Score, com achados por tipo de site, palavra-chave que cada página parece querer ranquear, sinais de confiança (E-E-A-T), SEO local e um plano "como subir" por impacto e esforço, com um prompt de correção por achado. Roda no modo completo ou com `--seo`. Com o CSV exportado do Search Console (`--csv`), lista oportunidades (posição média entre 4 e 20, CTR abaixo do típico do próprio site, consultas sem página própria); o arquivo é lido **só no seu computador**. A skill **nunca promete posição**: o próprio Google diz que ninguém garante o primeiro lugar, e prometer isso pode ser publicidade enganosa (CDC, art. 37). Limites em `docs/limites-seo.md`.

## Seus próprios critérios (camada local, opcional)
Quem tem método próprio pode pôr na pasta `local/` (que não vai para o repositório) as suas seções esperadas por tipo de site, regras extras e detectores. Se o arquivo de um tipo existir, ele vale mais que as seções públicas daquele tipo; se não existir ou estiver quebrado, a skill usa as públicas e avisa. Formato e limites em `docs/secoes-locais.md`.

## Como ela acerta (e como evita errar)

1. **Scripts medem, o modelo julga.** Os scripts leem 100% do código; o Claude lê só as evidências e os trechos em dúvida (isso também gasta pouco).
2. **3 versões de cada página:** HTML cru, DOM aos 250 ms e DOM final. Se um valor muda entre elas (um contador animado que começa em 0), isso vira um achado.
3. **Visível × oculto:** texto oculto e clones de carrossel (`aria-hidden`) não entram no julgamento.
4. **Selo em todo achado:** *fato verificado* (script), *regra documentada* (com fonte), *opinião/heurística* ou *não verificável*. O que não dá para provar no código nunca é afirmado.
5. **Verificador de citações:** antes do relatório sair, um script confere se cada número e trecho citado existe no código. Achado com número ou trecho inventado é descartado.
6. **Mesma entrada, mesma nota** na parte objetiva. Todo relatório leva data, hora e **hash** da versão analisada.
7. **O site analisado é dado, nunca instrução.** Texto no site tentando dar ordens ao modelo é ignorado e vira um achado de segurança. O site só roda dentro do navegador isolado do Playwright, com limite de tempo e bloqueio de rede interna.

## Instalação

Precisa de [Node.js](https://nodejs.org) 20 ou mais novo e do Claude Code.

```powershell
# 1. coloque a pasta onde o Claude Code procura skills
git clone <endereço-deste-repositório> "$env:USERPROFILE\.claude\skills\critiquesites"
cd "$env:USERPROFILE\.claude\skills\critiquesites"

# 2. instale as dependências e o navegador (tudo dentro da pasta da skill)
npm install
$env:PLAYWRIGHT_BROWSERS_PATH = "0"
npx playwright install chromium
```

O Chromium fica dentro de `node_modules`, nada é instalado fora da pasta.

## Como usar

No Claude Code, peça em linguagem normal:

- "Critique o site https://meusite.com.br"
- "Analise a pasta C:\sites\minha-loja no modo completo"
- "Critique esse código" (cole o HTML)
- "Reanalise o meusite.com.br e me mostre a evolução da nota"
- "Critique sem dó"

Antes de rodar, a skill mostra uma **estimativa de custo em R$** (com a cotação do dia e a fonte) e respeita um teto que você pode configurar (padrão R$ 2,00). Modos: **rápido** (padrão, até 8 páginas) e **completo** (até 30 páginas, mais Lighthouse e mais trechos para o modelo julgar). Custo medido com o Claude Sonnet 5.5 (cotação de 19/11/2026 do Banco Central, US$ 1 = R$ 5,8889): cerca de **R$ 0,53** no rápido (8 páginas) e de **R$ 0,76 a R$ 0,95** no completo (12 a 30 páginas). Os números exatos e como foram medidos estão em `config/custos.json` e em `docs/teste-de-acerto.md`.

Preço do modelo conferido em 20/11/2026 na [página oficial da Anthropic](https://platform.claude.com/docs/en/about-claude/pricing): Sonnet 5.5 a US$ 2 por milhão de tokens de entrada e US$ 10 de saída. A cotação é a última publicada pelo Banco Central (19/11/2026, a de 20/11 ainda não tinha saído). Se você usar outro modelo ou outra data, atualize `config/custos.json`.

O módulo de SEO soma cerca de R$ 0,01 (site bom) a R$ 0,07 (site com muitos problemas) por análise.

Entradas aceitas: **URL**, **pasta ou ZIP** do projeto (com `index.html` ou uma pasta `dist`/`build`) e **código colado**. Páginas atrás de login não são analisadas.

Os resultados ficam em `saidas/<site>/<data-hora-hash>/`: `relatorio.html`, `relatorio.pdf`, `card-retrato.png`, `card-paisagem.png` e `analise.json`.

### Linha de comando (opcional)
```powershell
node scripts/cli.mjs estimar https://exemplo.com.br
node scripts/cli.mjs analisar https://exemplo.com.br --completo
node scripts/cli.mjs finalizar "saidas\exemplo-com-br\20261118-1007-abcdef01"
```
A etapa de julgamento (escrever `julgamento.json`) é feita pelo Claude seguindo o `SKILL.md`.

## Regras, fontes e créditos

As regras ficam em arquivos de dados (`regras/*.json`), nunca dentro do texto da skill. Cada regra tem id, descrição, como detecta, peso, correção, fonte e nível de confiança. As regras foram **reescritas em português** a partir de documentação pública e de projetos abertos; os créditos e as licenças estão em [CREDITS.md](CREDITS.md). Os pesos são pontos de partida. No teste com 20 sites feitos por IA com um prompt genérico e 20 sites premiados (só números agregados em [docs/teste-de-acerto.md](docs/teste-de-acerto.md)), a nota objetiva separou razoavelmente os dois grupos (AUC 0,88), com sobreposição: serve como sinal, não como veredito de um site individual.

Para validar as regras: `node scripts/validar-regras.mjs regras` e `node scripts/validar-secoes.mjs`. Para rodar os testes: `npm test`.

## Fonte do Google e aviso de referência

- A regra `seg-fonte-google-servidores` avisa quando a página carrega fonte dos servidores do Google (fato verificado, com a URL exata) e explica à parte, como opinião, o possível efeito sobre a privacidade de quem visita. Não afirma ilegalidade. Veja [docs/limites-fonte-e-referencia.md](docs/limites-fonte-e-referencia.md).
- Todo relatório termina com o aviso "Referência não é cópia" (olhar e se inspirar é uma coisa; reproduzir o que é de outra pessoa depende de autorização), e os prompts de correção nunca mandam copiar um site.

## Limites honestos

- A skill lê as páginas **amostradas** (listadas no relatório), não o site inteiro de um site gigante.
- "Cara de IA" mede **visual e texto genéricos/padrão**, não autoria. Sites bem feitos podem parecer padrão, e sites gerados por IA com um bom prompt podem passar. O teste em [docs/teste-de-acerto.md](docs/teste-de-acerto.md) mostra os números reais, os falsos positivos e os falsos negativos.
- Achados com selo "opinião" são heurísticas. "Não verificável" quer dizer que o código não permite provar.
- Lighthouse varia entre execuções; por isso entra como faixa e média com as regras, não como valor exato.
- Avisos de lei explicam um risco e não substituem advogado.
- A estimativa de custo usa preços e cotação de `config/custos.json` (com data e fonte); atualize quando mudarem.

## Licença

MIT. Veja [LICENSE](LICENSE).
