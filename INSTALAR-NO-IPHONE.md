# Instalar o Ornis no iPhone

## Antes de tudo: por que não existe um executável

O iPhone não instala programa fora da App Store, a menos que você tenha um Mac com Xcode e um
certificado de desenvolvedor. Não existe `.exe`, `.app` ou `.ipa` que você simplesmente abra e
instale. O caminho real é o app rodar no Safari e ser adicionado à Tela de Início — o iOS trata
isso como um aplicativo: ícone próprio, tela cheia, sem barra de navegador.

## Por que um HTML solto não basta

O Safari só libera **microfone** e **armazenamento local** em páginas servidas por `https://`
(ou `localhost`). Um arquivo aberto direto do app Arquivos roda em `file://`, que o Safari **não**
considera contexto seguro. Consequência prática:

| | Arquivo `ornis.html` aberto direto | Pelo endereço `https://` |
|---|---|---|
| Pokédex (58 espécies, fichas) | ✅ | ✅ |
| Identificação por foto | ✅ | ✅ |
| **Gravar e identificar canto** | ❌ bloqueado pelo Safari | ✅ |
| **Salvar registros na Pokédex** | ❌ bloqueado pelo Safari | ✅ |
| Instalar na Tela de Início | ⚠️ parcial | ✅ |
| Funcionar offline depois de instalado | ❌ | ✅ |

O arquivo único serve para dar uma olhada no app. Para usar de verdade, use o endereço.

---

## Opção 1 — recomendada: publicar e instalar (5 minutos, uma vez só)

O repositório já tem a publicação automática configurada. Falta só ligá-la:

1. Abra direto: **https://github.com/delfosaudiovisual-sys/App-birds/settings/pages**
2. Em **Source**, escolha **GitHub Actions**. (Não precisa salvar; a escolha já vale.)
3. Vá em **Actions → Publicar no GitHub Pages → Re-run all jobs**, ou faça qualquer push.
4. Ao terminar, o endereço será:

   ```
   https://delfosaudiovisual-sys.github.io/App-birds/
   ```

Agora, **no iPhone**:

5. Abra esse endereço **no Safari** (precisa ser o Safari; Chrome no iOS não instala na Tela de
   Início).
6. Toque no botão **Compartilhar** (o quadrado com a seta para cima).
7. Role e toque em **Adicionar à Tela de Início**.
8. Abra o Ornis pelo ícone que apareceu.
9. Toque em **Gravar** — o iOS vai pedir permissão de microfone. Aceite.

Pronto. A partir daí ele abre offline, sem sinal, e a análise do canto continua rodando dentro do
aparelho.

> O repositório é público, então o Pages é gratuito. Enquanto ele não estiver ligado, o build
> continua passando: o passo do Pages é tolerado e a publicação simplesmente não roda, em vez de
> reprovar a execução inteira.

## Opção 2 — o arquivo único `ornis.html`

Três lugares para pegá-lo, do mais fácil ao mais técnico:

- **Actions → última execução → Artifacts → `ornis-html`** (anexado a cada build, mesmo sem Pages)
- `https://delfosaudiovisual-sys.github.io/App-birds/ornis.html`, depois da publicação
- `npm run build:single` na sua máquina

São 588 KB, sem nenhuma dependência externa: todo o código, os estilos e os ícones estão dentro do
arquivo. Mande por AirDrop, e-mail ou iCloud Drive e abra no iPhone.

Ele mostra um aviso no topo quando percebe que está sem contexto seguro, para você não ficar
tentando gravar sem entender por que não funciona.

## Opção 3 — testar na sua rede, sem publicar nada

No computador, na mesma rede Wi-Fi do celular:

```bash
npm install
npm run build
npx vite preview --host
```

O Vite mostra um endereço de rede tipo `http://192.168.0.10:4173/`. Só que é `http`, não `https` —
e aí o microfone continua bloqueado. Para resolver, use um túnel https:

```bash
npx localtunnel --port 4173
```

Ele devolve um endereço `https://...` que funciona no iPhone com todos os recursos.

---

## Depois de instalar

**Faça backup de vez em quando.** O Safari apaga os dados de um site que passa **sete dias sem ser
aberto**. O app pede armazenamento persistente ao abrir, o que reduz bastante o risco, mas não é
garantia. Em **Ajustes → Dados → Salvar backup da pokedex** você baixa um arquivo com toda a
coleção, e **Restaurar de um backup** traz tudo de volta. O áudio original não entra no arquivo,
para ele não ficar grande demais.

**Marque as pistas de campo.** Informar onde você está e o tamanho aproximado da ave leva o acerto
de 25% para 42% no primeiro palpite. Em **Ajustes → Pistas de campo** você deixa o ambiente
pré-marcado para não repetir o toque a cada gravação.

**Grave com o celular apontado para a ave** e o mais perto que der. O app abre o microfone sem
cancelamento de ruído e sem ganho automático de propósito — esses filtros são feitos para voz
humana e destroem as notas curtas e agudas que distinguem uma espécie da outra.

## Se algo não funcionar

| Sintoma | Causa provável |
|---|---|
| Botão de gravar dá erro de contexto seguro | Está aberto por `file://` ou `http://`. Use `https://`. |
| Pediu permissão e você negou | Ajustes do iOS → Safari → Microfone; ou reinstale pela Tela de Início. |
| Pokédex vazia depois de um tempo | Dados apagados pelo Safari. Restaure o backup. |
| Fotos das aves não aparecem | Sem internet na primeira vez, ou desligado em Ajustes → Fotos das aves. A ilustração entra no lugar. |
| Não aparece "Adicionar à Tela de Início" | Você está no Chrome ou Firefox. No iOS isso só existe no Safari. |
