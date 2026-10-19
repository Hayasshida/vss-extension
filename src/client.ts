import { spawn } from 'node:child_process';
import * as iconv from 'iconv-lite';

export type Operation = 'Get' | 'Checkout' | 'Checkin' | 'UndoCheckout' | 'History' | 'Properties';
export interface ClientConfig { executable: string; database: string; username: string; encoding: string; }
export interface Execution { stdout: string; stderr: string; code: number; }
export class VssError extends Error {
  constructor(message: string, readonly kind: 'authentication' | 'execution' | 'cancelled' | 'compatibility' = 'execution') { super(message); }
}
export function isAuthenticationFailure(text: string): boolean {
  return /(?:invalid|incorrect|wrong|inv[aá]lid[ao]|incorret[ao]).{0,35}(?:password|senha|username|usu[aá]rio)|(?:password|senha|username|usu[aá]rio).{0,35}(?:invalid|incorrect|wrong|inv[aá]lid[ao]|incorret[ao])|user .* (?:not found|does not exist)|usu[aá]rio .* n[aã]o existe/i.test(text);
}
export function redact(text: string, password?: string): string {
  return password ? text.split(password).join('[senha omitida]') : text;
}
export function operationArgs(operation: Operation, item: string, options: { localDirectory?: string; recursive?: boolean; version?: string; comment?: string; confirmed?: boolean } = {}): string[] {
  const args = [operation, item, options.confirmed ? '-I-Y' : '-I-'];
  if (options.localDirectory) args.push(`-GL${options.localDirectory}`);
  if (operation === 'Checkout') args.push('-E');
  if (options.recursive) args.push('-R');
  if (options.version) {
    if (!/^[1-9]\d*$/.test(options.version)) throw new Error('Versão inválida.');
    args.push(`-V${options.version}`);
  }
  if (operation === 'Checkin') {
    if (/[\r\n\x00]/.test(options.comment || '')) throw new Error('Use um comentário de uma linha.');
    args.push(options.comment ? `-C${options.comment}` : '-C-');
  }
  return args;
}

export class SourceSafeClient {
  private help = new Map<string, string>();
  constructor(readonly config: ClientConfig, private readonly log: (text: string) => void) {
    if (!iconv.encodingExists(config.encoding)) throw new Error('Codificação de saída não suportada.');
  }
  async execute(args: string[], cwd: string, password?: string, signal?: AbortSignal, allowFailure = false): Promise<Execution> {
    if (signal?.aborted) throw new VssError('Operação cancelada.', 'cancelled');
    // Credentials travel only in the child environment, never in arguments or logs.
    const env: NodeJS.ProcessEnv = { ...process.env, SSDIR: this.config.database, SSUSER: this.config.username };
    if (password !== undefined) env.SSPWD = password;
    const secret = password ?? env.SSPWD;
    this.log(redact(`ss.exe ${args[0]} ${args[1]?.startsWith('$/') ? args[1] : ''}`, secret));
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
      child.stdin.end();
      const chunks: Buffer[] = [], errors: Buffer[] = [];
      let bytes = 0, reason = '';
      const stop = (message: string) => { reason = message; child.kill(); };
      const cancel = () => stop('Operação cancelada.');
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => stop('ss.exe excedeu 120 segundos. Verifique o banco; o resultado pode ser parcial.'), 120_000);
      const capture = (target: Buffer[]) => (data: Buffer) => {
        bytes += data.length;
        if (bytes > 16 * 1024 * 1024) stop('Saída do ss.exe excedeu o limite de 16 MiB.');
        else target.push(data);
      };
      child.stdout.on('data', capture(chunks)); child.stderr.on('data', capture(errors));
      const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); };
      child.on('error', error => { cleanup(); reject(new VssError(`Não foi possível executar ss.exe: ${redact(error.message, secret)}`)); });
      child.on('close', code => {
        cleanup();
        const stdout = redact(iconv.decode(Buffer.concat(chunks), this.config.encoding), secret);
        const stderr = redact(iconv.decode(Buffer.concat(errors), this.config.encoding), secret);
        const result = { stdout, stderr, code: code ?? -1 };
        this.log(stdout); if (stderr) this.log(stderr);
        if (reason) return reject(new VssError(reason, signal?.aborted ? 'cancelled' : 'execution'));
        if (!allowFailure && (result.code !== 0 || isAuthenticationFailure(stdout + stderr))) {
          const auth = isAuthenticationFailure(stdout + stderr);
          return reject(new VssError(auth ? 'Autenticação SourceSafe recusada.' : `SourceSafe retornou código ${result.code}. Consulte a saída SourceSafe para detalhes.`, auth ? 'authentication' : 'execution'));
        }
        resolve(result);
      });
    });
  }
  async verify(operation: Operation, cwd: string, switches: string[], signal?: AbortSignal): Promise<void> {
    let help = this.help.get(operation);
    if (!help) {
      const result = await this.execute(['Help', operation], cwd, undefined, signal, true);
      help = result.stdout + '\n' + result.stderr;
      if (result.code !== 0 || !new RegExp(`\\b${operation}\\b`, 'i').test(help)) {
        throw new VssError(`Não foi possível consultar a ajuda de ${operation}. Confirme a compatibilidade deste ss.exe.`, 'compatibility');
      }
      this.help.set(operation, help);
    }
    for (const flag of switches) {
      if (!new RegExp(`[-/](?:${flag}|${flag.toLowerCase()})(?=[^A-Z]|$)`).test(help)) {
        throw new VssError(`A ajuda instalada de ${operation} não confirma o parâmetro -${flag}. Operação bloqueada por segurança.`, 'compatibility');
      }
    }
  }
  async run(operation: Operation, item: string, cwd: string, password: string | undefined,
    options: Parameters<typeof operationArgs>[2] = {}, signal?: AbortSignal): Promise<Execution> {
    const flags = ['I'];
    if (options.localDirectory) flags.push('GL');
    if (options.recursive) flags.push('R');
    if (options.version) flags.push('V');
    if (operation === 'Checkin') flags.push('C');
    if (operation === 'Checkout') flags.push('E');
    await this.verify(operation, cwd, flags, signal);
    return this.execute(operationArgs(operation, item, options), cwd, password, signal);
  }
}
