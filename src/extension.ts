import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { mapToVss, validateVersion } from './mapping';
import { SourceSafeClient, VssError, ClientConfig, Operation } from './client';

const commands = ['getLatest', 'get', 'checkout', 'checkin', 'undoCheckout', 'history', 'compare', 'properties'] as const;
type Command = typeof commands[number];
interface Target { uri: vscode.Uri; directory: boolean; item: string; cwd: string; config: ClientConfig; secretKey: string; }

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('SourceSafe');
  context.subscriptions.push(output);
  const busy = new Set<string>();
  const temporaryDirectories = new Set<string>();
  // Diff documents need their temporary files until the extension host closes.
  context.subscriptions.push({ dispose: () => {
    for (const directory of temporaryDirectories) void fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  } });

  async function targetFor(argument?: vscode.Uri): Promise<Target> {
    if (process.platform !== 'win32') throw new Error('SourceSafe requer Windows e o ss.exe instalado no computador onde a extensão é executada.');
    if (!vscode.workspace.isTrusted) throw new Error('Confie no workspace antes de executar SourceSafe.');
    const uri = argument ?? vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') throw new Error('Selecione um arquivo ou diretório local.');
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.scheme !== 'file') throw new Error('Abra a pasta raiz do projeto e selecione um item dessa pasta.');
    const settings = vscode.workspace.getConfiguration('sourcesafe', uri);
    const config: ClientConfig = {
      executable: settings.get<string>('executablePath', '').trim(),
      database: settings.get<string>('databaseDirectory', '').trim(),
      username: settings.get<string>('username', '').trim(),
      encoding: settings.get<string>('outputEncoding', 'cp850').trim()
    };
    if (!path.isAbsolute(config.executable) || path.basename(config.executable).toLowerCase() !== 'ss.exe') {
      throw new Error('Configure sourcesafe.executablePath com o caminho completo do ss.exe.');
    }
    if (!path.isAbsolute(config.database)) throw new Error('Configure sourcesafe.databaseDirectory com um caminho absoluto.');
    if (!config.username || /[\r\n\x00]/.test(config.username)) throw new Error('Configure sourcesafe.username com um usuário válido.');
    try {
      if (!(await fs.stat(config.executable)).isFile()) throw new Error();
    } catch { throw new Error('ss.exe não encontrado ou inacessível no caminho configurado.'); }
    try {
      if (!(await fs.stat(path.join(config.database, 'srcsafe.ini'))).isFile()) throw new Error();
    } catch { throw new Error('Banco SourceSafe indisponível: srcsafe.ini não encontrado ou sem permissão de leitura.'); }
    const stat = await fs.stat(uri.fsPath).catch(() => { throw new Error('Item local inexistente ou sem permissão de acesso.'); });
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Selecione um arquivo ou diretório regular.');
    // Reject junctions/symlinks escaping the local workspace, without changing working folders.
    mapToVss(await fs.realpath(folder.uri.fsPath), await fs.realpath(uri.fsPath), '$/');
    const item = mapToVss(folder.uri.fsPath, uri.fsPath, settings.get<string>('projectRoot', ''));
    return { uri, directory: stat.isDirectory(), item, cwd: stat.isDirectory() ? uri.fsPath : path.dirname(uri.fsPath), config,
      secretKey: `sourcesafe:${encodeURIComponent((await fs.realpath(config.database)).toLowerCase())}:${encodeURIComponent(config.username.toLowerCase())}` };
  }
  async function authenticate(client: SourceSafeClient, target: Target, signal: AbortSignal): Promise<string | undefined> {
    let password = await context.secrets.get(target.secretKey);
    try {
      await client.run('Properties', target.item, target.cwd, password, {}, signal);
      return password;
    } catch (error) {
      if (!(error instanceof VssError) || error.kind !== 'authentication') throw error;
    }
    // Only authentication errors trigger password input; network/permissions errors do not.
    const value = await vscode.window.showInputBox({ title: 'Senha do SourceSafe', prompt: `Usuário ${target.config.username}. A senha será guardada no armazenamento seguro do editor.`, password: true, ignoreFocusOut: true });
    if (value === undefined || signal.aborted) throw new VssError('Operação cancelada.', 'cancelled');
    await client.run('Properties', target.item, target.cwd, value, {}, signal);
    await context.secrets.store(target.secretKey, value);
    return value;
  }
  async function confirm(message: string, action: string): Promise<boolean> {
    return await vscode.window.showWarningMessage(message, { modal: true }, action) === action;
  }
  async function saveOpenDocuments(target: Target): Promise<boolean> {
    for (const document of vscode.workspace.textDocuments) {
      if (!document.isDirty || document.uri.scheme !== 'file') continue;
      const relative = path.relative(target.uri.fsPath, document.uri.fsPath);
      const matches = target.directory ? (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) : document.uri.toString() === target.uri.toString();
      if (!matches) continue;
      const choice = await vscode.window.showWarningMessage('Há alterações não salvas no editor. Salve-as antes de continuar com o SourceSafe.', { modal: true }, 'Salvar');
      if (choice !== 'Salvar' || !await document.save()) return false;
    }
    return true;
  }
  async function perform(command: Command, target: Target, signal: AbortSignal): Promise<void> {
    const client = new SourceSafeClient(target.config, line => output.appendLine(line));
    const password = await authenticate(client, target, signal);
    const run = (operation: Operation, options: Parameters<SourceSafeClient['run']>[4] = {}) =>
      client.run(operation, target.item, target.cwd, password, options, signal);
    if (command === 'history' || command === 'properties') {
      await run(command === 'history' ? 'History' : 'Properties');
      output.show(true);
      return;
    }
    if (command === 'compare') {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sourcesafe-diff-'));
      temporaryDirectories.add(directory);
      try {
        await run('Get', { localDirectory: directory });
        const snapshot = path.join(directory, path.basename(target.uri.fsPath));
        if (!(await fs.stat(snapshot)).isFile()) throw new Error('O SourceSafe não gerou o arquivo esperado para comparação.');
        await fs.chmod(snapshot, 0o444);
        const left = vscode.Uri.file(snapshot);
        await vscode.commands.executeCommand('vscode.diff', left, target.uri, `SourceSafe: ${path.basename(snapshot)} (última versão ↔ local)`);
      } catch (error) {
        temporaryDirectories.delete(directory);
        await fs.rm(directory, { recursive: true, force: true });
        throw error;
      }
      return;
    }
    if (command === 'get' || command === 'getLatest') {
      let version: string | undefined;
      if (command === 'get') {
        const choice = await vscode.window.showQuickPick(['Última versão', 'Versão específica...'], { title: 'SourceSafe — Obter' });
        if (!choice) return;
        if (choice === 'Versão específica...') {
          const value = await vscode.window.showInputBox({ title: 'Versão SourceSafe', prompt: 'Número da versão do arquivo ou projeto (sem recursividade).', validateInput: input => {
            try { validateVersion(input); return undefined; } catch (error) { return (error as Error).message; }
          } });
          if (value === undefined) return;
          version = validateVersion(value);
        }
      }
      if (!await saveOpenDocuments(target)) return;
      if (!await confirm(`Obter ${target.item}${version ? ` na versão ${version}` : ' na última versão'}${command === 'getLatest' && target.directory ? ', incluindo subpastas' : ''}? Arquivos locais poderão ser substituídos e alterações locais perdidas. O SourceSafe decidirá o tratamento de arquivos em check-out.`, 'Obter e permitir substituição')) return;
      await run('Get', { localDirectory: target.cwd, recursive: command === 'getLatest' && target.directory, version, confirmed: true });
    } else if (command === 'checkout') {
      if (!await saveOpenDocuments(target)) return;
      if (!await confirm(`Fazer check-out exclusivo de ${target.item}? O SourceSafe poderá atualizar a cópia local. Alterações locais poderão ser perdidas.`, 'Fazer Check-Out')) return;
      // -E requests native VSS exclusive checkout; no fallback if unsupported.
      await client.verify('Checkout', target.cwd, ['E'], signal);
      await run('Checkout', { localDirectory: target.cwd });
    } else if (command === 'checkin') {
      if (!await saveOpenDocuments(target)) return;
      const comment = await vscode.window.showInputBox({ title: 'SourceSafe — Check-In', prompt: 'Comentário (opcional). Enter confirma o envio; Esc cancela.', validateInput: value => /[\r\n\x00]/.test(value) ? 'Use um comentário de uma linha.' : undefined });
      if (comment === undefined) return;
      await run('Checkin', { localDirectory: target.cwd, comment });
    } else if (command === 'undoCheckout') {
      if (!await saveOpenDocuments(target)) return;
      if (!await confirm(`Desfazer check-out de ${target.item}? As alterações locais poderão ser perdidas.`, 'Desfazer Check-Out')) return;
      await run('UndoCheckout', { localDirectory: target.cwd, confirmed: true });
    }
    void vscode.window.showInformationMessage('SourceSafe confirmou a conclusão da operação.');
  }

  for (const command of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(`sourcesafe.${command}`, async (argument?: vscode.Uri) => {
      let key: string | undefined;
      try {
        const target = await targetFor(argument);
        if (target.directory && ['checkout', 'checkin', 'undoCheckout', 'compare'].includes(command)) throw new Error('Este comando requer um arquivo.');
        key = target.config.database.toLowerCase();
        if (busy.has(key)) { key = undefined; throw new Error('Já existe uma operação SourceSafe neste banco. Aguarde sua conclusão.'); }
        busy.add(key);
        output.appendLine(`\n[${new Date().toISOString()}] ${command}: ${target.item}`);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'SourceSafe', cancellable: true }, async (_, token) => {
          const controller = new AbortController();
          const subscription = token.onCancellationRequested(() => controller.abort());
          if (token.isCancellationRequested) controller.abort();
          try { await perform(command, target, controller.signal); }
          finally { subscription.dispose(); }
        });
      } catch (error) {
        if (error instanceof VssError && error.kind === 'cancelled') {
          void vscode.window.showInformationMessage('SourceSafe cancelado. Se a execução já começou, confira o estado no SourceSafe antes de repetir.');
        } else {
          // Do not log unexpected exception text: it might contain sensitive process details.
          const message = error instanceof Error ? error.message : 'Falha desconhecida no SourceSafe.';
          const action = await vscode.window.showErrorMessage(message, 'Exibir saída SourceSafe');
          if (action) output.show(true);
        }
      } finally { if (key) busy.delete(key); }
    }));
  }
}
