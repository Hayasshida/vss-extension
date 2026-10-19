# SourceSafe para VS Code e Cursor

Extensão Windows que usa o `ss.exe` já instalado, com o banco, usuários,
permissões, histórico e bloqueios do Microsoft Visual SourceSafe existentes.
Não migra nem acessa diretamente os arquivos internos do banco.

## Instalação

Requisitos: Windows, VS Code 1.85+ ou Cursor compatível, SourceSafe instalado e
acesso ao banco pela conta Windows que executa o editor. Não funciona em um
extension host Linux, WSL, contêiner ou SSH Linux; abra o projeto no Windows.
O Node.js utilizado pela extensão é fornecido pelo próprio editor.

1. Em **Extensões**, abra o menu `…` e escolha **Instalar do VSIX...**.
2. Selecione `sourcesafe-context-1.0.0.vsix` e recarregue o editor se solicitado.
3. Abra a pasta raiz local do projeto e configure o SourceSafe nas configurações
   da pasta/workspace. A pasta deve corresponder à raiz VSS configurada.

Também é possível instalar com `code --install-extension sourcesafe-context-1.0.0.vsix`
ou `cursor --install-extension sourcesafe-context-1.0.0.vsix`.
Nenhuma conta ou publicação no Marketplace é necessária para instalar o VSIX.

## Configuração

Exemplo de `.vscode/settings.json` da pasta do projeto:

```json
{
  "sourcesafe.executablePath": "C:\\Program Files (x86)\\Microsoft Visual SourceSafe\\ss.exe",
  "sourcesafe.databaseDirectory": "\\\\servidor\\VSS",
  "sourcesafe.projectRoot": "$/RealizaERP",
  "sourcesafe.username": "seu.usuario"
}
```

As quatro configurações são obrigatórias; a raiz VSS não é presumida. Use `$/`
explicitamente somente para mapear a raiz inteira do banco.
O diretório do banco precisa conter `srcsafe.ini`. Use o caminho real da sua
instalação para `ss.exe`; a extensão não instala nem distribui o SourceSafe.
Em workspaces com múltiplas pastas, configure cada pasta nas respectivas
configurações: a URI do item determina qual configuração será utilizada.

O caminho local `C:\Projetos\RealizaERP\Regras\Cliente.vb`, dentro da pasta
aberta `C:\Projetos\RealizaERP`, corresponde automaticamente a
`$/RealizaERP/Regras/Cliente.vb`. Itens externos à pasta e links/junções que
escapam dela são rejeitados. Não se alteram Working Folders, `ss.ini`,
`srcsafe.ini` nem o projeto corrente do cliente SourceSafe.

A extensão envia `SSDIR` e `SSUSER` no ambiente exclusivo do processo filho.
Primeiro tenta a senha já guardada ou `SSPWD` herdada do editor, inclusive senha
vazia quando aplicável. Somente uma recusa reconhecida de autenticação abre o
campo de senha. A senha validada por uma consulta `Properties` é guardada no
`SecretStorage`, separada por banco e usuário. Nunca vai para argumentos de
processo, configurações, arquivos do projeto ou logs. Trocas de senha são
solicitadas após nova recusa; cancelar não executa a operação solicitada.
Uma recusa desconhecida/localizada é mostrada na saída, sem tentar operações
com credenciais diferentes automaticamente.

A configuração opcional `sourcesafe.outputEncoding` controla a codificação da
saída do `ss.exe` (padrão `cp850`; por exemplo `cp860` ou `cp1252`). Ajuste-a à
página de códigos da instalação se houver acentos incorretos. Para arquivos de
código legados, configure a codificação correta no editor; a comparação utiliza
a abertura normal de arquivos do VS Code/Cursor, com a opção nativa de
**Reabrir com Codificação** quando necessária.

## Uso

Clique com o botão direito em um item do Explorer, no texto do editor ou na aba
do arquivo e abra o submenu **SourceSafe**. As entradas aparecem nesta ordem:

| Comando | Operação |
| --- | --- |
| Obter Última Versão (Recursivo) | `Get`, com `-R` para diretórios. |
| Obter... | Escolha última versão ou versão numérica (`-V`), sem recursividade. |
| Fazer Check-Out para Edição... | `Checkout -E`, solicitando exclusividade ao próprio VSS. |
| Check-In... | `Checkin`, com comentário opcional. Esc cancela. |
| Desfazer Check-Out... | `UndoCheckout`, após confirmação de possível perda local. |
| Exibir Histórico | `History`, com resultado real no canal SourceSafe. |
| Comparar... | `Get` para diretório temporário e `vscode.diff` entre a cópia do banco e o arquivo local. |
| SourceSafe Propriedades... | `Properties`, com resultado real no canal SourceSafe. |

Check-out, check-in, desfazer check-out e comparação são exclusivos de arquivos.
Os outros comandos também aceitam pastas. Os menus aparecem apenas em recursos
`file://`. Comandos também estão disponíveis na paleta, na categoria SourceSafe.
Não há compartilhamento, atualização de status, comandos Git/SVN, monitoramento
nem check-out/check-in automáticos.

Get sempre pede confirmação antes de permitir substituições locais, inclusive
quando o arquivo parece não ter sido alterado. A confirmação de pasta abrange
seus itens e, no Get recursivo, todas as subpastas. Check-out também confirma a
possível atualização da cópia local. Documentos com alterações não salvas precisam
ser salvos antes de operações sobre a cópia local. Cancelar qualquer diálogo
impede a operação correspondente; consultas de validação podem já ter ocorrido.

A extensão usa `-GL` por operação para indicar o diretório local, sem persistir
Working Folders. Nenhum parâmetro remove ou contorna bloqueios de outro usuário.
Check-in só mostra conclusão após retorno de sucesso do `ss.exe`. Em falhas, a
extensão não apaga nem restaura o arquivo local e não repete a gravação.

Histórico, propriedades e diagnósticos ficam em **Exibir → Saída → SourceSafe**.
Texto informativo em stdout/stderr não é considerado erro apenas por existir:
o código de retorno e recusas reconhecidas de autenticação determinam falhas.
Permissões, arquivo inexistente, banco indisponível e bloqueios são informados
com os detalhes originais do executável na saída.

Cada banco aceita uma operação por vez nesta instância da extensão. Os prompts
do processo são desativados (`-I-`) e stdin é fechado; somente Get e UndoCheckout
explicitamente confirmados usam `-I-Y`. Não se respondem perguntas por terminal.
Há cancelamento, limite de 120 segundos por processo e limite de 16 MiB de saída.
Cancelar ou atingir um limite durante uma gravação não desfaz trabalho já
realizado pelo VSS: confira seu estado antes de repetir, especialmente em Get
recursivo. Operações de vários arquivos não são transações atômicas.

Comparar não executa Checkout, Checkin, UndoCheckout nem muda o original. A cópia
temporária recebe atributo somente leitura e fica disponível durante a sessão
para o editor nativo de diferenças. Ela é removida no encerramento normal da
extensão; uma interrupção abrupta pode deixar arquivos `sourcesafe-diff-*` no
diretório temporário do Windows, que podem ser removidos após fechar os diffs.

## Compatibilidade com a versão instalada

Antes de executar cada operação, a extensão consulta `ss.exe Help <operação>`
e confirma na saída a operação e seus parâmetros necessários:

- `-I`: modo não interativo (`-I-` ou `-I-Y`, após confirmação).
- `-GL`: destino/origem local temporário por operação.
- `-R`: Get recursivo de projetos.
- `-V`: versão numérica solicitada.
- `-C`: comentário do Checkin (`-C-` para comentário vazio).
- `-E`: Checkout exclusivo, sem fallback para checkout compartilhado.

A ajuda e o comando executados são registrados sem argumentos de senha.
Se a ajuda da versão instalada não mostrar um parâmetro necessário, a operação
é bloqueada explicitamente. Não se tenta um parâmetro de outra ferramenta, nem
se simula um resultado. Se a ajuda local usar formato diferente, capture sua
saída e valide essa versão antes de adaptar o reconhecimento. A compatibilidade
com `-I-Y`, as opções acima e o comportamento de Get sobre arquivos em check-out
precisam ser confirmados no ambiente real conforme o roteiro abaixo.

## Desenvolvimento e geração do VSIX

Requer Node.js 22 LTS ou superior e npm. Na raiz deste repositório:

```sh
npm ci
npm test
npm run package
```

`npm test` compila TypeScript e executa os testes Node. `npm run compile` compila
separadamente. `npm run package` gera `sourcesafe-context-1.0.0.vsix`, incluindo
as dependências de runtime. Instale esse arquivo no VS Code e no Cursor.

Para depurar no Windows, abra este repositório no editor e pressione **F5** na
configuração **Executar extensão SourceSafe**. Ela compila e abre o Extension
Development Host. Nesse novo editor abra a pasta local ligada ao VSS e configure
o banco. Não utilize este repositório de código como raiz do projeto VSS, a menos
que essa seja de fato a sua pasta de trabalho.

### Estrutura

- `src/extension.ts`: comandos, configurações por pasta, diálogos, SecretStorage,
  saída e diferenças nativas.
- `src/client.ts`: argumentos, ajuda instalada, execução segura, credenciais,
  cancelamento, códigos de retorno e decodificação da saída.
- `src/mapping.ts`: caminhos locais/VSS e validação de versões.
- `test/`: testes automatizados do mapeamento, manifesto, transporte e fluxos
  de interface com substitutos de teste. Não são testes de integração VSS.
- `.vscode/`: tarefas e configuração de depuração.

## Validação manual obrigatória no Windows

Use um projeto de teste do seu banco, com cópia de segurança das alterações
locais. Os testes automatizados não comprovam integração com SourceSafe nem
execução dentro dos editores. Execute o roteiro tanto no VS Code quanto no Cursor:

1. Instale o VSIX e confira a ordem das oito entradas em arquivos e pastas.
   Em pastas, não devem aparecer os quatro comandos exclusivos de arquivos.
   Em documentos `untitled:` e outros recursos não locais, não deve haver menu.
2. Configure uma pasta e depois duas pastas com raízes VSS distintas. Consulte
   Propriedades e Histórico de um arquivo, da raiz e de uma subpasta. Confira
   os caminhos e as informações contra o cliente SourceSafe existente.
3. Teste caminho inválido do executável, banco indisponível, item inexistente e
   usuário/senha incorretos. Depois informe a senha correta; reinicie o editor
   e confirme que ela não é pedida novamente. Não coloque senhas em settings.
4. Confira a saída real de `Help Get`, `Help Checkout`, `Help Checkin`,
   `Help UndoCheckout`, `Help History` e `Help Properties`. Confirme os parâmetros
   utilizados e o comportamento não interativo da versão instalada. Uma ajuda
   incompleta deve bloquear o comando, sem iniciar uma gravação.
5. Faça Get de um arquivo e de uma pasta: última versão recursiva deve incluir
   subpastas; Obter... não deve atualizar subpastas. Teste uma versão numérica
   conhecida de arquivo e de projeto. Modifique uma cópia local, cancele a
   confirmação e confirme que seus bytes não mudaram; depois confirme o Get e
   verifique o resultado. Teste também arquivo local gravável e em check-out.
6. Faça check-out exclusivo com o usuário A. Com B, tente check-out e verifique
   a recusa nativa sem liberação do bloqueio. Confirme a exclusividade também
   em um banco que permita múltiplos check-outs por padrão.
7. Edite, faça Check-In com comentário e confirme nova versão e comentário no
   Histórico. Teste falha por falta de permissão e arquivo não reservado:
   não deve haver mensagem de sucesso nem perda das alterações locais.
8. Edite um arquivo reservado e cancele Desfazer Check-Out: conteúdo e reserva
   devem continuar iguais. Depois confirme, verificando conteúdo e liberação
   no cliente VSS. Observe o tratamento de arquivos graváveis dessa versão.
9. Com um arquivo modificado e reservado, abra Comparar. Confira as duas versões
   no diff, o conteúdo original e a reserva antes/depois. A versão esquerda deve
   ser a última do banco e o Get deve apontar apenas ao temporário. Confira
   também a codificação de arquivos legados e o comportamento de arquivos binários
   no editor nativo. O suporte visual a binários depende do próprio editor.
10. Cancele seleção de versão, comentário, senha e confirmações. Teste saída de
    erro, indisponibilidade do compartilhamento e cancelamento de processo longo.
    Confira o estado real após qualquer interrupção de gravação antes de repetir.
    Verifique que Working Folders e arquivos de configuração do banco permanecem
    inalterados. Todas as alterações do banco devem decorrer apenas do `ss.exe`.

Nesta entrega, compilação, testes independentes e empacotamento são executáveis
em Linux; não há `ss.exe`, banco VSS ou interface Windows neste ambiente. O roteiro
acima não é declarado como aprovado sem execução no ambiente real.
