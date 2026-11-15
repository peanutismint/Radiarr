// Running programs (FFmpeg) is not possible in a browser.
const unavailable = () => { throw new Error('FFmpeg is not available in the demo.'); };
export const execFile = (...args: unknown[]) => {
  const cb = args.find((a) => typeof a === 'function') as ((e: Error) => void) | undefined;
  const err = new Error('FFmpeg is not available in the demo.');
  if (cb) queueMicrotask(() => cb(err));
  return { on() {}, kill() {} };
};
export const spawn = unavailable;
export const exec = execFile;
export default { execFile, spawn, exec };
