// The demo has no file system. These no-ops let server modules load; anything that truly needs
// files is blocked by the demo service worker before it is reached.
const notFound = (p?: unknown) => {
  const e = new Error(`ENOENT: not available in the demo: ${String(p ?? '')}`) as Error & { code: string };
  e.code = 'ENOENT';
  return e;
};
export const constants = { R_OK: 4, W_OK: 2, F_OK: 0, X_OK: 1 };
export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const accessSync = () => undefined;
export const writeFileSync = () => undefined;
export const appendFileSync = () => undefined;
export const unlinkSync = () => undefined;
export const rmSync = () => undefined;
export const renameSync = () => undefined;
export const readdirSync = () => [];
export const readFileSync = (p: unknown) => { throw notFound(p); };
export const statSync = (p: unknown) => { throw notFound(p); };
export const lstatSync = statSync;
export const createReadStream = (p: unknown) => { throw notFound(p); };
export const createWriteStream = (p: unknown) => { throw notFound(p); };
export const promises = {
  readdir: async () => [],
  stat: async (p: unknown) => { throw notFound(p); },
  readFile: async (p: unknown) => { throw notFound(p); },
  writeFile: async () => undefined,
  mkdir: async () => undefined,
  rm: async () => undefined,
  unlink: async () => undefined,
  rename: async () => undefined,
  access: async (p: unknown) => { throw notFound(p); },
  appendFile: async () => undefined,
  copyFile: async () => undefined,
};
const fs = {
  constants, existsSync, mkdirSync, accessSync, writeFileSync, appendFileSync, unlinkSync, rmSync,
  renameSync, readdirSync, readFileSync, statSync, lstatSync, createReadStream, createWriteStream, promises,
};
export default fs;
