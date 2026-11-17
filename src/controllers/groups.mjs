import { auth } from '../middlewares/auth.mjs';
import { activeUsers, body, boolean, choice, fail, includesId, objectId, route, search, text, webUrl } from '../http.mjs';

function groupFields(input, current) {
  return {
    name: text(input.name ?? current?.name, 'name'),
    description: text(input.description ?? current?.description, 'description', 4000),
    icon: input.icon === undefined ? current?.icon : webUrl(input.icon, 'icon'),
    coverPhoto: input.coverPhoto === undefined ? current?.coverPhoto : webUrl(input.coverPhoto, 'coverPhoto'),
    visibility: choice(input.visibility ?? current?.visibility, 'visibility', ['public', 'private', 'secret']),
    allowMemberPosts: boolean(input.allowMemberPosts ?? current?.allowMemberPosts ?? false, 'allowMemberPosts'),
    allowMemberEvents: boolean(input.allowMemberEvents ?? current?.allowMemberEvents ?? false, 'allowMemberEvents')
  };
}

export function groupView(group, userId) {
  const data = {
    id: String(group._id),
    name: group.name,
    description: group.description,
    icon: group.icon,
    coverPhoto: group.coverPhoto,
    visibility: group.visibility,
    memberCount: group.members.length
  };

  if (includesId(group.members, userId)) {
    Object.assign(data, {
      members: group.members,
      admins: group.admins,
      allowMemberPosts: group.allowMemberPosts,
      allowMemberEvents: group.allowMemberEvents
    });
  }
  return data;
}

export async function getGroup(Group, id, userId) {
  const group = await Group.findOne({ _id: objectId(id), active: true });
  if (!group || (group.visibility === 'secret' && !includesId(group.members, userId))) {
    fail(404, 'Groupe introuvable');
  }
  return group;
}

export default class Groups {
  constructor(app, models) {
    this.app = app;
    this.models = models;
    this.run();
  }

  run() {
    const { app, models: { Group, User, Event } } = this;
    const requireAuth = auth(User);
    const optionalAuth = auth(User, { optional: true });

    app.post('/groups', requireAuth, route(async (req, res) => {
      const group = await Group.create({
        ...groupFields(body(req)),
        members: [req.userId],
        admins: [req.userId],
        threads: [{ title: 'Discussion générale', author: req.userId }]
      });
      res.status(201).json(groupView(group, req.userId));
    }));

    app.get('/groups', optionalAuth, route(async (req, res) => {
      const groups = await Group.find({
        active: true,
        $or: [{ visibility: { $ne: 'secret' } }, { members: req.userId || null }]
      }).select('-threads');

      res.json(search(req, groups).map((group) => groupView(group, req.userId)));
    }));

    app.get('/groups/:groupId', optionalAuth, route(async (req, res) => {
      const group = await getGroup(Group, req.params.groupId, req.userId);
      res.json(groupView(group, req.userId));
    }));

    app.patch('/groups/:groupId', requireAuth, route(async (req, res) => {
      const group = await getGroup(Group, req.params.groupId, req.userId);
      if (!includesId(group.admins, req.userId)) fail(403, 'Administrateur du groupe requis');

      const input = body(req);
      const fields = groupFields(input, group);
      if (
        group.visibility === 'public' && fields.visibility !== 'public' &&
        await Event.exists({ groupId: group._id, active: true, 'ticketTypes.0': { $exists: true } })
      ) {
        fail(409, 'Retire la billetterie des événements du groupe avant ce changement');
      }

      const members = input.members === undefined
        ? group.members
        : await activeUsers(User, input.members, 'members');
      const admins = input.admins === undefined
        ? group.admins
        : await activeUsers(User, input.admins, 'admins');

      if (!admins.length || !admins.every((id) => includesId(members, id))) {
        fail(400, 'Le groupe doit conserver au moins un administrateur, et chaque administrateur doit être membre');
      }

      group.set({ ...fields, members, admins });
      await group.save();
      res.json(groupView(group, req.userId));
    }));

    app.post('/groups/:groupId/join', requireAuth, route(async (req, res) => {
      const group = await getGroup(Group, req.params.groupId, req.userId);
      if (!includesId(group.members, req.userId)) {
        if (group.visibility !== 'public') fail(403, 'Un administrateur doit t’ajouter à ce groupe');
        group.members.push(req.userId);
        await group.save();
      }
      res.json(groupView(group, req.userId));
    }));

    app.delete('/groups/:groupId', requireAuth, route(async (req, res) => {
      const group = await getGroup(Group, req.params.groupId, req.userId);
      if (!includesId(group.admins, req.userId)) fail(403, 'Administrateur du groupe requis');
      group.active = false;
      await group.save();
      res.status(204).end();
    }));
  }
}
