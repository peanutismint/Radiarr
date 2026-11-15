export const Readable = {
  fromWeb() { throw new Error('Streaming is not available in the demo.'); },
};
export class ReadableStream {}
export default { Readable };
