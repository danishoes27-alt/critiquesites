# Limites: fonte do Google e aviso de referência (v1)

Dados conferidos em 2026-11-19 (ver `DECISOES.md`). Este documento diz o que a regra e o aviso fazem e o que **não** fazem.

## Regra `seg-fonte-google-servidores`

**O que faz**
- Procura, só por script (nunca pelo modelo), no HTML cru, no DOM final, no CSS inline e nos arquivos CSS do site: `<link>` (stylesheet, preconnect, preload, dns-prefetch), `@import` e `url()` de `@font-face` que apontem para `fonts.googleapis.com` ou `fonts.gstatic.com`.
- Mostra a **URL exata** e **onde** ela aparece. Se a fonte é servida do próprio domínio, não gera achado.
- Entrega **dois níveis** no mesmo achado:
  1. **Fato verificado:** "a página carrega fonte dos servidores do Google".
  2. **Interpretação (opinião/heurística):** "isso pode enviar o IP de quem visita ao Google". Aparece em campo próprio, com o selo de opinião.
- Gravidade baixa (P3). Não entra no Tell Score nem nas notas por área (a categoria `seguranca-conteudo` fica fora das duas contas; há teste que compara o Tell Score com e sem o achado).
- O prompt de correção manda baixar as fontes, guardar numa pasta do projeto, usar `@font-face` com `font-display: swap`, remover os links do Google e conferir que o visual não mudou, depois de **conferir a licença de cada fonte**.

**O que NÃO faz**
- **Não afirma ilegalidade.** Nunca diz que o site "viola a lei" ou "está ilegal". Só avisa, explica e deixa a decisão com a pessoa.
- **Não é parecer jurídico** e não substitui advogado.
- Não mede o que o navegador do visitante realmente envia (só lê o código do site) e não sabe se há consentimento, aviso ou outra base legal em outro lugar.
- Não vê fontes carregadas só por JavaScript que monta o endereço em tempo de execução, nem fontes de outros domínios do Google.
- Não decide a licença de cada fonte: pede para a pessoa conferir.

**Base citada, com os limites**
- **Decisão alemã:** Landgericht München I, sentença de 20/01/2022, processo 3 O 17493/20: 100 euros de indenização a um visitante cujo IP foi enviado ao Google por fontes carregadas dos servidores do Google, com base no GDPR (art. 82, item 1). Conferido na versão publicada em Bayern.Recht (gesetze-bayern.de), que traz tribunal, data, número do processo e valor. É **uma decisão de um tribunal estrangeiro**: não vale no Brasil e não é regra geral.
- **Brasil:** em 19/11/2026 **não foi encontrada decisão brasileira equivalente** (busca na web; pode existir uma que a busca não alcançou).
- **LGPD** (Lei 13.709/2018), art. 5º, inciso I: dado pessoal é "informação relacionada a pessoa natural identificada ou identificável". A skill cita só isso; se um endereço IP se enquadra depende do caso.
- **Licenças das fontes:** segundo o README do repositório oficial `google/fonts`, a maioria usa a SIL Open Font License 1.1, algumas a Apache 2.0, e a família Ubuntu a Ubuntu Font License 1.0; cada família traz o arquivo de licença. As páginas de FAQ do Google Fonts são montadas por JavaScript e não puderam ser lidas aqui, então o prompt remete ao README e ao arquivo de licença de cada fonte.

## Aviso "Referência não é cópia"

**O que faz**
- Um texto fixo e curto aparece no **fim de todo relatório** e dentro de **qualquer prompt de correção que cite referência ou inspiração**.
- Explica que olhar, medir e se inspirar é uma coisa e reproduzir o que é de outra pessoa depende de autorização de quem criou, citando dispositivos conferidos no texto oficial do Planalto: Lei 9.610/1998 (arts. 7º, 8º inciso I e 29), Lei 9.609/1998 (art. 2º e § 3º) e, para marca, Lei 9.279/1996 (art. 129).
- Um teste automático garante que nenhum prompt de correção manda **copiar, clonar ou reproduzir** um site específico (e falha de verdade quando se injeta uma frase assim). Medir uma referência e adaptar à marca da pessoa é permitido.

**O que NÃO faz**
- Não proíbe nada e não promete resultado: usa "em regra", diz "isto não é parecer jurídico" e "a decisão é sua".
- Não resolve casos concretos (obra derivada, uso permitido por exceção, licenças abertas, marca de terceiros): para isso, advogado.
- Não verifica se o site da pessoa copia alguém: a skill não compara sites entre si.
