export function promisify(fn: (...a: any[]) => any) {
  return (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      fn(...args, (err: unknown, stdout: unknown, stderr: unknown) =>
        err ? reject(err) : resolve({ stdout, stderr })
      );
    });
}
export default { promisify };
