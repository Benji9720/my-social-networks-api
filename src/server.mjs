import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import config from './config.mjs';
import routes from './controllers/routes.mjs';
import userSchema from './models/user.mjs';
import groupSchema from './models/group.mjs';
import eventSchema from './models/event.mjs';
import { errors } from './http.mjs';

export default class Server {
  constructor() {
    this.app = express();
  }

  async dbConnect() {
    this.connect = mongoose.createConnection(config.mongoUri, { serverSelectionTimeoutMS: 8000 });
    await this.connect.asPromise();

    this.models = {
      User: this.connect.model('User', userSchema),
      Group: this.connect.model('Group', groupSchema),
      Event: this.connect.model('Event', eventSchema)
    };
    await Promise.all(Object.values(this.models).map((model) => model.init()));
  }

  middleware() {
    this.app.disable('x-powered-by');
    this.app.use(helmet());
    this.app.use(cors({
      origin: config.frontendOrigin,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));
    this.app.use(express.json({ limit: '32kb' }));
  }

  routes() {
    this.app.get('/health', (req, res) => res.json({ status: 'ok' }));
    for (const Controller of Object.values(routes)) {
      new Controller(this.app, this.models);
    }
    this.app.use((req, res) => res.status(404).json({ error: 'Route introuvable' }));
    this.app.use(errors);
  }

  async run() {
    if (!config.mongoUri) throw new Error('Renseigne MONGODB_URI dans .env');
    if (!/^[a-f0-9]{64}$/i.test(config.jwtSecret || '')) {
      throw new Error('Renseigne JWT_SECRET avec 64 caractères hexadécimaux');
    }
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error('PORT doit être compris entre 1 et 65535');
    }

    await this.dbConnect();
    this.middleware();
    this.routes();

    await new Promise((resolve, reject) => {
      this.httpServer = this.app.listen(config.port, '127.0.0.1', resolve);
      this.httpServer.once('error', reject);
    });

    console.log(`API prête sur http://localhost:${config.port}`);
  }

  async stop() {
    if (this.httpServer?.listening) {
      await new Promise((resolve) => this.httpServer.close(resolve));
    }
    await this.connect?.close();
  }
}
