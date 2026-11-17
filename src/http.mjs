import mongoose from 'mongoose';

export function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export const route = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    next(error);
  }
};

export const sameId = (first, second) =>
  first != null && second != null && String(first).toLowerCase() === String(second).toLowerCase();

export const includesId = (items, id) => items.some((item) => sameId(item, id));

export function objectId(value) {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) {
    fail(400, 'Identifiant MongoDB invalide');
  }
  return value.toLowerCase();
}

export function body(req) {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    fail(400, 'Le corps doit être un objet JSON');
  }
  return req.body;
}

export function text(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    fail(400, `${field} doit contenir entre 1 et ${max} caractères`);
  }
  return value.trim();
}

export function webUrl(value, field) {
  const address = text(value, field, 2000);
  let parsed;
  try {
    parsed = new URL(address);
  } catch {
    fail(400, `${field} doit être une URL HTTP(S)`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    fail(400, `${field} doit être une URL HTTP(S) sans identifiants`);
  }
  return address;
}

export function number(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(400, `${field} doit être un entier entre ${min} et ${max}`);
  }
  return value;
}

export function date(value, field) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(Date.parse(value))) {
    fail(400, `${field} doit être une date ISO 8601 avec fuseau horaire`);
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    fail(400, `${field} contient une date de calendrier invalide`);
  }
  return new Date(value);
}

export function choice(value, field, values) {
  if (!values.includes(value)) fail(400, `${field} doit valoir ${values.join(', ')}`);
  return value;
}

export function boolean(value, field) {
  if (typeof value !== 'boolean') fail(400, `${field} doit être un booléen`);
  return value;
}

export function search(req, items, select = (item) => item.name) {
  const query = req.query.q;
  if (query === undefined) return items;
  if (typeof query !== 'string' || query.length > 100) fail(400, 'q doit être une chaîne de 100 caractères maximum');
  const normalized = query.trim().toLowerCase();
  return items.filter((item) => select(item).toLowerCase().includes(normalized));
}

export function subdocument(items, id, label) {
  const result = items.id(objectId(id));
  if (!result) fail(404, `${label} introuvable`);
  return result;
}

export async function activeUsers(User, value, field) {
  if (!Array.isArray(value) || value.length > 250) fail(400, `${field} doit être un tableau de 250 identifiants maximum`);
  const ids = [...new Set(value.map(objectId))];
  const found = await User.countDocuments({ _id: { $in: ids }, active: true });
  if (found !== ids.length) fail(400, `${field} contient un utilisateur absent ou désactivé`);
  return ids;
}

export function errors(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error.code === 11000) {
    return res.status(409).json({ error: 'Cet email est déjà utilisé' });
  }

  if (error.name === 'VersionError') {
    return res.status(409).json({ error: 'La ressource vient de changer. Relis-la et réessaie.' });
  }

  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return res.status(400).json({ error: 'Données invalides' });
  }

  const parserErrors = {
    'entity.parse.failed': 'JSON mal formé',
    'entity.too.large': 'Corps de requête trop volumineux'
  };
  if (parserErrors[error.type]) {
    return res.status(error.status).json({ error: parserErrors[error.type] });
  }

  const status = error.status ?? error.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: error.expose === false ? 'Requête invalide' : error.message });
  }

  console.error('Erreur de requête :', error.name);
  return res.status(500).json({ error: 'Erreur interne' });
}
