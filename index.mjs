import 'dotenv/config';
import Server from './src/server.mjs';

const server = new Server();

try {
  await server.run();
  const stop = async () => {
    try {
      await server.stop();
    } catch {
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
} catch (error) {

  const message = server.connect
    ? 'Vérifie MongoDB (URI, accès réseau, droits) et le port HTTP.'
    : error.message;
  console.error('Démarrage impossible :', message);
  await server.stop().catch(() => {});
  process.exitCode = 1;
}
