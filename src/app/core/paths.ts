/** The file name at the end of a path, on a Mac ("/Users/a/x.ukmac") or in Windows ("C:\\Users\\a\\x.ukmac"). */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
