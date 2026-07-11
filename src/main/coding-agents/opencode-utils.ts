import net from 'node:net';

export const parseOpenCodeVersion = (output: string): string | null =>
  output.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? null;

export const reserveLocalPort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Unable to allocate a local port for OpenCode.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

export const readOpenCodeSessionId = (properties: unknown): string | null => {
  if (!properties || typeof properties !== 'object') return null;
  if ('sessionID' in properties && typeof properties.sessionID === 'string') {
    return properties.sessionID;
  }
  if (
    'info' in properties &&
    properties.info &&
    typeof properties.info === 'object' &&
    'sessionID' in properties.info &&
    typeof properties.info.sessionID === 'string'
  ) {
    return properties.info.sessionID;
  }
  if (
    'part' in properties &&
    properties.part &&
    typeof properties.part === 'object' &&
    'sessionID' in properties.part &&
    typeof properties.part.sessionID === 'string'
  ) {
    return properties.part.sessionID;
  }
  return null;
};
