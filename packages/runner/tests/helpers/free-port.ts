import http from 'http';

/**
 * A free loopback port, picked by the OS. RunnerServer reads port 0 as "use 3001", so a test asks for a
 * real number first. Ask for several at once with Promise.all: each probe holds its port until all answer.
 */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}
