import bcrypt from 'bcryptjs';
import { auth, signToken, unauthorized } from '../middlewares/auth.mjs';
import { body, fail, objectId, route, sameId, search, text } from '../http.mjs';

function credentials(input, minimum = 1) {
  const email = text(input.email, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Email invalide');
  const { password } = input;
  if (typeof password !== 'string' || password.length < minimum || Buffer.byteLength(password) > 72) {
    fail(400, `Mot de passe : minimum ${minimum} caractères et maximum 72 octets`);
  }
  return { email, password };
}

function profile(user, own = false) {
  return {
    id: String(user._id),
    firstname: user.firstname,
    lastname: user.lastname,
    ...(own ? { email: user.email } : {})
  };
}

export default class Users {
  constructor(app, { User, Group, Event }) {
    this.User = User;
    this.Group = Group;
    this.Event = Event;
    this.app = app;
    this.auth = auth(User);
    this.run();
  }

  run() {
    const { app, User, Group, Event } = this;

    app.post('/users', route(async (req, res) => {
      const input = body(req);
      const { email, password } = credentials(input, 12);
      const firstname = text(input.firstname, 'firstname', 100);
      const lastname = text(input.lastname, 'lastname', 100);
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({ firstname, lastname, email, passwordHash });
      res.status(201).json(profile(user, true));
    }));

    app.post('/login', route(async (req, res) => {
      const { email, password } = credentials(body(req));
      const user = await User.findOne({ email, active: true }).select('+passwordHash');
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return unauthorized(res, 'Email ou mot de passe incorrect');
      }
      return res.set('Cache-Control', 'no-store').json({
        token: signToken(user._id),
        user: profile(user, true)
      });
    }));

    app.get('/users', this.auth, route(async (req, res) => {
      const users = await User.find({ active: true }).select('firstname lastname');
      res.json(search(req, users, (user) => `${user.firstname} ${user.lastname}`).map((user) => profile(user)));
    }));

    app.get('/users/:userId', this.auth, route(async (req, res) => {
      const user = await User.findOne({ _id: objectId(req.params.userId), active: true });
      if (!user) fail(404, 'Utilisateur introuvable');
      res.json(profile(user, sameId(user._id, req.userId)));
    }));

    app.patch('/users/:userId', this.auth, route(async (req, res) => {
      const id = objectId(req.params.userId);
      if (!sameId(id, req.userId)) fail(403, 'Seul le propriétaire peut modifier ce compte');

      const input = body(req);
      const changes = {};
      if (input.firstname !== undefined) changes.firstname = text(input.firstname, 'firstname', 100);
      if (input.lastname !== undefined) changes.lastname = text(input.lastname, 'lastname', 100);

      if (!Object.keys(changes).length) fail(400, 'Indique firstname ou lastname');
      const user = await User.findOneAndUpdate({ _id: id, active: true }, changes, { new: true });
      if (!user) fail(404, 'Utilisateur introuvable');
      res.json(profile(user, true));
    }));

    app.delete('/users/:userId', this.auth, route(async (req, res) => {
      const id = objectId(req.params.userId);
      if (!sameId(id, req.userId)) fail(403, 'Seul le propriétaire peut supprimer ce compte');

      const owned = await Promise.all([
        Group.exists({ active: true, admins: id }),
        Event.exists({ active: true, organizers: id })
      ]);
      if (owned.some(Boolean)) fail(409, 'Retire ton rôle de gestion ou supprime les groupes et événements concernés');

      await User.updateOne({ _id: id }, {
        $set: { active: false, firstname: 'Compte', lastname: 'supprimé' },
        $unset: { email: 1, passwordHash: 1 }
      });
      res.status(204).end();
    }));
  }
}
