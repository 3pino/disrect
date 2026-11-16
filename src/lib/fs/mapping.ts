// 画面のパス（共有の部品の決まり: いちばん上からの相対・区切りは `/`・いちばん上は空文字）と、OS の絶対パスの対応。
//  - POSIX:   ''            ↔ /            'home/me'        ↔ /home/me
//  - Windows: ''            ↔ （ドライブの一覧。OS のパスは無い）
//             'C:'          ↔ C:\          'C:/Users/me'    ↔ C:\Users\me
//             '\\nas\share' ↔ \\nas\share  '\\nas\share/a'  ↔ \\nas\share\a（ネットワークの場所は、最初の 1 段にまとめる）

const DRIVE = /^[A-Za-z]:/;

/** OS のパスが Windows の書き方か */
export function isWindowsPath(abs: string): boolean {
  return DRIVE.test(abs) || abs.startsWith('\\\\');
}

/** 画面のパス → OS の絶対パス。Windows のいちばん上（ドライブの一覧）は OS のパスが無いので null */
export function toOs(path: string, windows: boolean): string | null {
  if (!windows) return '/' + path;
  if (path === '') return null;
  const [head, ...rest] = path.split('/');
  return rest.length === 0 ? head + '\\' : `${head}\\${rest.join('\\')}`;
}

/** OS の絶対パス → 画面のパス */
export function fromOs(abs: string): string {
  if (!isWindowsPath(abs)) return abs.split('/').filter((s) => s !== '').join('/');
  if (abs.startsWith('\\\\')) {
    // \\server\share までが、いちばん上の 1 段
    const parts = abs.slice(2).split(/[\\/]+/).filter((s) => s !== '');
    const head = '\\\\' + parts.slice(0, 2).join('\\');
    return [head, ...parts.slice(2)].join('/');
  }
  const parts = abs.slice(2).split(/[\\/]+/).filter((s) => s !== '');
  return [abs.slice(0, 2), ...parts].join('/');
}
