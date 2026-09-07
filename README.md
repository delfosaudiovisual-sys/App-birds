# Ornis

Identificador de cantos de aves brasileiras para celular. Grave o canto, descubra a espécie,
veja **que tipo de vocalização** é aquela — território, corte, alarme, alimento ou contato —
e guarde tudo numa pokédex que fica no seu aparelho.

Também identifica por foto.

## O que ele faz

**Identificação por canto (offline).** A análise inteira roda no celular: FFT → espectrograma →
extração de características acústicas → comparação com a base de espécies. Uma gravação de 8 s é
analisada em poucas dezenas de milissegundos. Nada é enviado para nenhum servidor.

**Pistas de campo.** Duas perguntas que qualquer pessoa responde olhando para a ave — onde você está
e o tamanho dela — e o acerto quase dobra. Elas entram como peso, nunca como filtro: uma ave fora do
habitat esperado recua na lista, mas continua visível.

**Tipo de canto.** A partir da frequência, do tom, do ritmo e da melodia, o app estima a
probabilidade de cada função:

| Função | Assinatura acústica que o app procura |
|---|---|
| **Território** | frases longas, estereotipadas, repetidas em intervalo regular, tom relativamente puro |
| **Corte / atração de fêmeas** | repertório amplo, modulação rápida, trinados de banda larga, crescendo |
| **Alarme** | ou muito agudo e de banda estreita (difícil de localizar), ou áspero, curto e repetido (mobbing) |
| **Alimento** | repetição insistente e regular, som áspero, ciclo de emissão alto, monotonia |
| **Contato** | uma ou duas notas curtas, banda estreita, pouco repetidas |

Cada resultado vem com as **medidas que sustentam a leitura** (largura de banda, notas por segundo,
pureza tonal, estereotipia, repetição de frase) e com os avisos de quando a gravação é curta
ou ruidosa demais para concluir.

**Identificação por foto.** Isola o assunto do fundo, extrai a paleta de plumagem em CIELAB,
mede padrão (liso, barrado, listrado, mascarado), contraste e silhueta, e compara com o perfil
visual de cada espécie. Opcionalmente pode ser reforçada por um modelo de visão na nuvem.

**Pokédex com fotos reais.** 58 espécies brasileiras com ficha completa: aparência, comportamento,
habitat, alimentação, distribuição, descrição do canto e curiosidade. Espécies não descobertas
aparecem como silhueta. Cada registro guarda o espectrograma, as medidas acústicas, as
probabilidades por tipo de canto, o áudio original e a localização.

A imagem de cada espécie é resolvida em três degraus:

1. **Sua própria foto.** Quando você registra uma ave por foto, ela vira o retrato daquela espécie.
   Não depende de rede nem de licença de terceiros — e transforma a pokédex numa coleção de fato.
2. **Foto de referência da Wikimedia Commons**, buscada uma única vez por espécie e guardada no
   aparelho, exibida sempre com autor e licença. Depois da primeira busca funciona offline.
3. **Ilustração vetorial**, gerada a partir do perfil de cor da espécie. Nunca falha, nunca busca
   nada, e aparece de imediato enquanto o degrau 2 carrega — a tela nunca fica vazia esperando rede.

Fotos sem crédito de autoria e licença não são usadas: nesse caso fica a ilustração.

## Precisão: o número, e o que ele significa

O repositório traz uma **bancada de precisão** (`npm run bench`). Ela sintetiza vocalizações a partir
do perfil de cada espécie, degradadas como uma gravação de campo degrada — ruído, distância,
desafinação, andamento diferente, trecho cortado — e mede o acerto entre as 58 espécies.

| | top-1 | top-3 |
|---|---|---|
| Primeira versão | 8,3% | 20,3% |
| Atual, sem pistas de campo | **25,0%** | **46,9%** |
| Atual, com ambiente e tamanho informados | **42,4%** | **72,7%** |
| Acaso | 1,7% | 5,2% |

### O número que importa mais: cena de campo

A tabela acima usa uma espécie sozinha num arquivo limpo. Uma segunda bancada
(`scene.bench.ts`) monta o que de fato sai do bolso: silêncio antes e depois, ruído, e **outras
aves cantando junto**.

| Cenário | top-1 | top-3 |
|---|---|---|
| Só a ave, com pausa | 19,0% | 42,2% |
| Com 1 ave ao fundo | 5,2% | 14,7% |
| 2 aves ao fundo | 4,3% | 9,5% |
| Quintal cheio | 4,3% | 9,5% |

**Basta uma ave ao fundo para o acerto cair de 19% para 5%.** Esse é o limite real do método de
perfis acústicos escritos à mão, e nenhum ajuste de fórmula o resolveu — média geométrica,
verossimilhança gaussiana e oito critérios de seleção de trecho foram medidos e descartados.

O app quebra a gravação em trechos e faixas de frequência e compara cada um separadamente. Um
terceiro banco (`selection.bench.ts`) mostra por que isso importa e onde ele para: **se o trecho
certo fosse sempre escolhido, o acerto seria 16,6% / 31,5%** — o dobro. Nenhum critério automático
chega perto disso. Por isso os trechos aparecem na tela para você escolher: quem ouviu a ave sabe
qual trecho é dela, e o app não sabe.

**O que a bancada mede:** se as espécies da base são distinguíveis entre si pelo motor, e se o
acerto sobrevive à degradação.

**O que ela não mede:** acerto em gravação real. Os sinais são sintetizados a partir dos mesmos
perfis que o identificador consulta, então há circularidade — um perfil errado passa despercebido.
Para acerto de campo só serve gravação real etiquetada. O valor da bancada é outro: transforma
"melhorei o algoritmo" em número verificável, e foi ela que expôs três defeitos concretos (janela de
análise mais longa que as notas do trinado, tonalidade saturada em zero, banda contaminada por
ruído) que nenhuma inspeção de código tinha pego.

### Por que não há BirdNET aqui

A pergunta óbvia é usar o BirdNET, o modelo de referência da área. Foi tentado e **não é possível no
navegador**, por um motivo verificado, não suposto:

O `BirdNET_6K_GLOBAL_MODEL.tflite` calcula o próprio espectrograma dentro do grafo, e essa camada usa
`FlexRFFT` — um operador do delegate *Select TF ops*. Carregá-lo exige `dlopen`, ou seja, ligação
dinâmica de biblioteca, que a build WebAssembly do TFLite não tem. O erro foi reproduzido:

```
Aborted(To use dlopen, you need enable dynamic linking)
```

As saídas também não existem: o BirdNET V2.4 é distribuído como SavedModel protobuf por um pacote
Python, não há build para navegador em nenhum pacote npm, e converter exigiria o conversor do
TensorFlow em Python. Rodar BirdNET exigiria um servidor — o que quebraria o funcionamento offline,
que é a razão de o app existir.

### O app aprende com as suas correções

Cada gravação que você confirma ou corrige é guardada como um **exemplar**: um vetor de 12 medidas
mais o desenho de altura. Identificações seguintes comparam também com esses exemplares.

Isso entra como **bônus limitado, nunca como substituto** da comparação com os perfis, e o limite
veio de medição: comparando gravações duas a duas, a semelhança entre a mesma espécie tem mediana
0,60 e entre espécies diferentes chega a 0,83. As distribuições se sobrepõem. Se o exemplar pudesse
decidir sozinho, uma espécie errada com semelhança alta sequestraria o resultado e o app pioraria
quanto mais fosse usado.

O banco de provas não consegue medir o ganho real desse recurso: o sintetizador sorteia valores
novos em toda a faixa do perfil a cada gravação, o que exagera a variação dentro da espécie. Uma ave
real canta de forma muito mais constante. O que o banco garante é o que importa — **usar o app não o
deixa pior**.

## Honestidade sobre a precisão

- **A espécie** é determinada por casamento de características acústicas contra perfis descritos
  espécie a espécie, incluindo alinhamento temporal (DTW) da sequência de alturas das notas. Não é
  uma rede neural treinada em milhares de gravações: vai bem com cantos estruturados e
  característicos (sabiá, bem-te-vi, joão-de-barro, pitiguari) e pior com trinados genéricos e
  agudos. O app diz quando o resultado é disputado e sempre mostra as 5 melhores hipóteses para você
  corrigir.
- **O tipo de canto** é uma inferência estrutural apoiada em bioacústica, não uma observação de
  comportamento. É uma hipótese sobre a função, não um fato sobre a intenção da ave. A confiança
  cai automaticamente quando há poucas notas ou o trecho é curto demais para medir repetição.
- **A foto** usa cor, padrão e silhueta. Funciona bem com aves de plumagem marcante e mal com
  aves pardas parecidas entre si.

Sua correção manual é gravada no registro, então a pokédex reflete o que você confirmou.

## Rodando

```bash
npm install
npm run dev      # servidor de desenvolvimento
npm test         # 47 testes do motor de DSP, de visão e de fotos (segundos)
npm run bench    # bancada de precisão da identificação por canto (minutos)
npm run build    # gera dist/ + service worker de precache
```

O microfone só é liberado pelo navegador em `https://` ou `localhost`. Para testar no celular na
rede local, sirva o `dist/` por HTTPS.

### Instalando no celular

O app é uma PWA: abra no navegador e use "Adicionar à tela de início". Depois disso ele abre
offline, sem sinal.

## Como funciona por dentro

```
microfone (cru, sem AGC/supressão de ruído)
   ↓
PCM  →  STFT (Hann, ~46 ms)  →  espectrograma 250 Hz – 12 kHz
   ↓
subtração de ruído por mediana espectral
   ↓
segmentação de notas por histerese de energia
   ↓
features: frequência de pico, banda, pureza tonal, harmonicidade, entropia,
          taxa de notas, irregularidade rítmica, índice de trinado,
          modulação de frequência, estereotipia, repertório,
          repetição de frase, ataque, tendência de amplitude, SNR
   ↓                                    ↓
espécie (features + DTW)  ──prior──→  tipo de canto (5 funções)
```

O microfone é aberto com `echoCancellation`, `noiseSuppression` e `autoGainControl` **desligados**:
esses filtros são feitos para voz humana e destroem exatamente as notas curtas e agudas que
distinguem uma espécie da outra.

### Estrutura

```
src/
├── data/
│   ├── species.ts           58 espécies: perfil acústico, visual e ficha
│   └── occurrence.ts        ambiente e classe de tamanho (pistas de campo)
├── engine/
│   ├── audio/               fft, spectrogram, features, songType, matcher, recorder, render
│   │   ├── testing/synth.ts sintetizador de vocalizações para a bancada
│   │   ├── precision.bench  mede acerto por condição de degradação
│   │   └── experiment.bench compara funções de pontuação sobre features em cache
│   ├── vision/              color (CIELAB), imageFeatures, photoMatcher, loadImage
│   ├── photos/              busca e cache das fotos de referência
│   ├── cloud/               identificação assistida opcional
│   ├── store/               IndexedDB, ajustes, captura de registro
│   └── analyze.ts           orquestra os pipelines
├── components/              ícones, ilustração procedural, imagem da espécie, UI
└── pages/                   Ouvir, Foto, Pokédex, Espécie, Ajustes
```

### Sobre a busca de fotos

A busca usa a Action API do MediaWiki (`prop=pageimages` na Wikipedia para achar a imagem principal
do artigo do nome científico, depois `prop=imageinfo&iiprop=extmetadata` no Commons para autor e
licença), com `origin=*` para CORS anônimo. Cai do português para o inglês quando o artigo não
existe.

⚠️ Os endpoints reais da Wikimedia estão bloqueados pela política de rede do ambiente onde este
código foi escrito, então a chamada ao serviço real **não foi exercitada** aqui. O que está coberto
por teste é tudo que pode quebrar do lado do app — montagem da URL, leitura das duas respostas,
extração de autor e licença, limpeza do HTML e cada caminho de falha — contra um servidor local que
replica o formato das respostas reais, e a cadeia completa (buscar → cachear → recarregar offline →
foto ainda lá) foi verificada num navegador de verdade. Vale conferir uma vez no aparelho que a
busca ao vivo funciona.

## Identificação assistida (opcional, desligada por padrão)

Em Ajustes é possível ligar um modelo de visão para reforçar a identificação por foto. Ele **nunca
substitui** a análise local: entra como um empurrão limitado no ranqueamento, e se falhar o
resultado local continua valendo.

⚠️ A chave da API fica guardada neste navegador e as chamadas saem direto do aparelho. Qualquer
extensão com acesso à página consegue lê-la, e o uso é cobrado na sua conta. Use uma chave
dedicada, com limite de gasto, e revogue-a se trocar de aparelho. A identificação por canto não
usa isso e continua funcionando offline.

## Ampliando a base de espécies

Adicione uma entrada em `src/data/species.ts`. O campo que mais afeta a identificação é
`acoustic`: as faixas de `peakHz`, `noteRate`, `noteDurationSec` e `tonality`, o `rhythm`, e o
`motif` — o contorno de altura normalizado 0–1 que o DTW alinha. `visual.palette` alimenta tanto o
identificador por foto quanto a ilustração da ficha.
