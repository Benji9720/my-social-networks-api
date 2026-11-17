import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config.mjs';
import { route } from '../http.mjs';

const claims = { issuer: 'social-networks-tp', audience: 'social-networks-api' };

export function signToken(id) {
  return jwt.sign({ sub: String(id) }, config.jwtSecret, {
    ...claims,
    algorithm: 'HS256',
    expiresIn: '1h'
  });
}

export function unauthorized(res, message = 'Jeton manquant, invalide ou expiré') {
  return res.set('WWW-Authenticate', 'Bearer').status(401).json({ error: message });
}

export function auth(User, { optional = false } = {}) {
  return route(async (req, res, next) => {
    const header = req.get('Authorization');
    if (!header && optional) return next();

    const match = header?.match(/^Bearer\s+(\S+)$/i);
    if (!match) return unauthorized(res);

    let payload;
    try {
      payload = jwt.verify(match[1], config.jwtSecret, { ...claims, algorithms: ['HS256'] });
    } catch {
      return unauthorized(res);
    }

    if (!mongoose.isObjectIdOrHexString(payload?.sub) || !Number.isInteger(payload.exp)) {
      return unauthorized(res);
    }

    const user = await User.findOne({ _id: payload.sub, active: true }).select('_id');
    if (!user) return unauthorized(res);

    req.userId = user._id;
    return next();
  });
}
