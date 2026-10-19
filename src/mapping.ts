import * as path from 'node:path';

export function mapToVss(localRoot: string, localPath: string, projectRoot: string,
  paths: typeof path.win32 = path.win32): string {
  if (!/^\$\/(?:[^\x00-\x1f:*?"<>|\\]+)?$/.test(projectRoot)) {
    throw new Error('Raiz SourceSafe inválida; use $/Projeto.');
  }
  const root = projectRoot.replace(/\/+$/, '');
  if (root !== '$' && root.slice(2).split('/').some(s => s === '.' || s === '..' || s === '')) {
    throw new Error('Raiz SourceSafe contém segmentos inválidos.');
  }
  const relative = paths.relative(paths.resolve(localRoot), paths.resolve(localPath));
  if (relative === '..' || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative)) {
    throw new Error('O item não pertence à pasta aberta.');
  }
  if (/[\x00-\x1f*?]/.test(relative)) throw new Error('Caminho local inválido.');
  return relative ? `${root}/${relative.split(paths.sep).join('/')}` : (root === '$' ? '$/' : root);
}

export function validateVersion(value: string): string {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Informe um número inteiro de versão maior que zero.');
  }
  return value;
}
