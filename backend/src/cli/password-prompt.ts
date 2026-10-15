import { StringDecoder } from 'node:string_decoder';

type PasswordInput = NodeJS.ReadStream & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

type PasswordOutput = Pick<NodeJS.WriteStream, 'write'>;

export function readHiddenPassword(input: PasswordInput = process.stdin, output: PasswordOutput = process.stdout): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive terminal so the password can be entered without echo.');
  }
  output.write('New admin password: ');
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const decoder = new StringDecoder('utf8');
    const cleanup = () => {
      input.setRawMode!(false);
      input.pause();
      input.off('data', onData);
      output.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const key of decoder.write(chunk)) {
        if (key === '\u0003') {
          cleanup();
          reject(new Error('Cancelled.'));
          return;
        }
        if (key === '\r' || key === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (key === '\u007f' || key === '\b') {
          value = Array.from(value).slice(0, -1).join('');
          output.write('\b \b');
          continue;
        }
        if (key !== '\u001b' && value.length + key.length <= 1024) {
          value += key;
          output.write('*'.repeat(Array.from(key).length));
        }
      }
    };
    input.on('data', onData);
  });
}
