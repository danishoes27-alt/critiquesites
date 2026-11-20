# Camada local de seções, regras e detectores (opcional)

A skill já vem com seções esperadas por tipo de site em `regras/secoes/` (fontes públicas). Se você tem o seu próprio método, pode pôr uma **camada local** na pasta `local/` do projeto. Ela é opcional, fica só no seu computador (`local/` está no `.gitignore`) e **nunca precisa existir**: sem ela, a skill usa as seções públicas.

## O que a pasta `local/` pode ter

```
local/
  secoes-por-tipo/<tipo>.json     seções esperadas de um tipo de site
  regras-<qualquer-nome>/*.json   regras extras (mesmo formato de regras/*.json)
  deteccoes-<qualquer-nome>/*.mjs detectores dessas regras (mesmo formato de lib/deteccoes/*.mjs)
```

Tudo é opcional e independente. Para usar outra pasta, defina a variável de ambiente `CRITIQUESITES_LOCAL` com o caminho; com o valor `off` a camada fica desligada. No comando de análise, `--sem-camada-local` ignora a pasta só naquela rodada.

## Precedência

1. Existe `local/secoes-por-tipo/<tipo>.json` e ele é válido: **vale mais** que o arquivo público daquele tipo (o público daquele tipo não é usado; os outros tipos não mudam).
2. Não existe, está quebrado (JSON inválido) ou não tem nenhuma seção válida: a skill usa o público e registra um **aviso** (`camada local ignorada: ...`). A análise nunca quebra por causa da camada local.
3. O nome do tipo vira nome de arquivo, então só vale `letras-minúsculas-números-e-hífens`. Um tipo que só existe na camada local (por exemplo `meu-tipo`) é aceito quando o arquivo existe, e você escolhe o tipo com `--tipo meu-tipo` (a detecção automática só conhece os tipos públicos).

## Formato de `secoes-por-tipo/<tipo>.json`

Uma lista de seções, ou um objeto `{ "meta": {...}, "secoes": [...] }`. O `meta` é livre (faixas de seções por página, textos de botão a evitar, expressões de "cara de IA"...) e fica disponível para os seus detectores. Cada seção segue o formato público (veja `regras/schema/secao.schema.json`):

| Campo | O que é |
|---|---|
| `id`, `nome`, `descricao` | identificação e o que o visitante espera ali |
| `obrigatoriedade` | `essencial`, `esperada` ou `opcional` |
| `peso` | de 0 a 10 |
| `deteccao` | `seletores`, `palavras`, `padroes_regex`, `onde` (`home`, `qualquer-pagina`, `pagina-propria`) e `detectavel_por_script` (`sim`, `nao`, `parcial`) |
| `fonte`, `confianca` | de onde veio a regra e quão segura ela é (`alta`, `media`, `baixa`) |

Campos opcionais que só a camada local usa: `pagina` (onde na jornada a seção fica), `ordem`, `cta` (texto do botão esperado) e `selo` (`fato`, `regra`, `opiniao` ou `nao-verificavel`).

Regra de honestidade: só use o selo `regra` (regra documentada) quando houver fonte oficial com endereço. Recomendação sua, sem fonte oficial, é `opiniao`.

## Regras e detectores locais

- A regra segue o esquema de `regras/schema/regra.schema.json`. Regra fora do esquema, ou com selo `regra` sem fonte `https`, é ignorada com aviso. Regra com o mesmo `id` de uma regra pública também é ignorada (a pública manda).
- O detector exporta `detectores`, um mapa `id da regra -> função` igual aos de `lib/deteccoes/`. Módulo que não carrega vira aviso.
- Todo achado local passa pelo verificador de citações como os públicos: o que não existe no código analisado é descartado.
- O carimbo do relatório mostra `+local.<hash>` na versão das regras quando a camada local entrou, e o hash muda se o conteúdo dela mudar.

## Teste

`tests/camada-local.test.mjs` usa um exemplo 100% fictício em `tests/fixtures/secoes-locais-exemplo/`. A suíte pública liga `CRITIQUESITES_LOCAL=off`, então ela é igual em qualquer máquina, com ou sem `local/`.
