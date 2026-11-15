import { promises } from './fs.ts';
export const { readdir, stat, readFile, writeFile, mkdir, rm, unlink, rename, access, appendFile, copyFile } = promises;
export default promises;
