# Ornis

Identificador de cantos de aves brasileiras para celular. Grave o canto, descubra a espécie,
veja **que tipo de vocalização** é aquela — território, corte, alarme, alimento ou contato —
e guarde tudo numa pokédex que fica no seu aparelho.

Também identifica por foto.

## O que ele faz

**Identificação por canto (offline).** A análise inteira roda no celular: FFT → espectrograma →
extração de características acústicas → comparação com a base de espécies. Uma gravação de 8 s é
analisada em poucas dezenas de milissegundos. Nada é enviado para nenhum servidor.

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

**Pokédex.** 58 espécies brasileiras com ficha completa: aparência, comportamento, habitat,
alimentação, distribuição, descrição do canto e curiosidade. Espécies não descobertas aparecem
como silhueta. Cada registro guarda o espectrograma, as medidas acústicas, as probabilidades por
tipo de canto, o áudio original e a localização.

## Honestidade sobre a precisão

- **A espécie** é determinada por casamento de características acústicas contra perfis descritos
  espécie a espécie, incluindo alinhamento temporal (DTW) do contorno melódico. Não é uma rede
  neural treinada em milhares de gravações: vai bem com cantos estruturados e característicos
  (sabiá, bem-te-vi, joão-de-barro, pitiguari) e pior com trinados genéricos e agudos. O app diz
  quando o resultado é disputado e sempre mostra as 5 melhores hipóteses para você corrigir.
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
npm test         # 36 testes do motor de DSP e de visão
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
├── data/species.ts          58 espécies: perfil acústico, visual e ficha
├── engine/
│   ├── audio/               fft, spectrogram, features, songType, matcher, recorder, render
│   ├── vision/              color (CIELAB), imageFeatures, photoMatcher, loadImage
│   ├── cloud/               identificação assistida opcional
│   ├── store/               IndexedDB, ajustes, captura de registro
│   └── analyze.ts           orquestra os pipelines
├── components/              ícones, ilustração procedural das aves, UI
└── pages/                   Ouvir, Foto, Pokédex, Espécie, Ajustes
```

As ilustrações das aves são **geradas em SVG** a partir do próprio perfil visual de cada espécie —
o app não baixa nem embute fotos, então funciona inteiro offline e sem depender de licença de
imagem de terceiros.

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
