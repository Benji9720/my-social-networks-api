import config from '../config.mjs';
import { auth } from '../middlewares/auth.mjs';
import { activeUsers, body, boolean, choice, date, fail, includesId, objectId, route, search, text, webUrl } from '../http.mjs';
import { getGroup } from './groups.mjs';

export const isOrganizer = (event, userId) => includesId(event.organizers, userId);
export const isParticipant = (event, userId) => includesId(event.participants, userId);
export const requireOrganizer = (event, userId) => {
  if (!isOrganizer(event, userId)) fail(403, 'Organisateur de l’événement requis');
};
export const requireParticipant = (event, userId) => {
  if (!isParticipant(event, userId)) fail(403, 'Participation à l’événement requise');
};
export const requirePublished = (event) => {
  if (event.status !== 'published') fail(409, 'L’événement doit être publié');
};

function eventFields(input, current) {
  const startAt = input.startAt === undefined && current ? current.startAt : date(input.startAt, 'startAt');
  const endAt = input.endAt === undefined && current ? current.endAt : date(input.endAt, 'endAt');
  if (endAt <= startAt) fail(400, 'La fin doit être après le début');
  return {
    name: text(input.name ?? current?.name, 'name'),
    description: text(input.description ?? current?.description, 'description', 4000),
    startAt,
    endAt,
    location: text(input.location ?? current?.location, 'location'),
    coverPhoto: webUrl(input.coverPhoto ?? current?.coverPhoto, 'coverPhoto'),
    visibility: choice(input.visibility ?? current?.visibility, 'visibility', ['public', 'private']),
    shoppingListEnabled: boolean(input.shoppingListEnabled ?? current?.shoppingListEnabled ?? false, 'shoppingListEnabled'),
    carpoolEnabled: boolean(input.carpoolEnabled ?? current?.carpoolEnabled ?? false, 'carpoolEnabled')
  };
}

export function eventView(event, userId) {
  const view = {
    id: String(event._id),
    name: event.name,
    description: event.description,
    startAt: event.startAt,
    endAt: event.endAt,
    location: event.location,
    coverPhoto: event.coverPhoto,
    visibility: event.visibility,
    status: event.status,
    groupId: event.groupId,
    organizers: event.organizers,
    participantCount: event.participants.length,
    shoppingListEnabled: event.shoppingListEnabled,
    carpoolEnabled: event.carpoolEnabled,
    ticketingEnabled: event.ticketTypes.length > 0
  };
  if (isParticipant(event, userId) || isOrganizer(event, userId)) {
    view.participants = event.participants;
  }
  if (isOrganizer(event, userId)) view.invitedUsers = event.invitedUsers;
  return view;
}

function canReadEvent(event, group, userId) {
  if (event.groupId && !group) return false;
  const organizer = isOrganizer(event, userId);
  if (event.status === 'draft') return organizer;
  if (event.visibility === 'private') {
    return organizer || isParticipant(event, userId) || includesId(event.invitedUsers, userId);
  }
  return !group || group.visibility === 'public' || organizer ||
    isParticipant(event, userId) || includesId(event.invitedUsers, userId) ||
    includesId(group.members, userId);
}

export async function getEvent(models, id, userId) {
  const event = await models.Event.findOne({ _id: objectId(id), active: true });
  if (!event) fail(404, 'Événement introuvable');
  const group = event.groupId && await models.Group.findOne({ _id: event.groupId, active: true }).select('members visibility');
  if (!canReadEvent(event, group, userId)) fail(404, 'Événement introuvable');
  return { event, group };
}

export function checkTicketingEvent(event, group) {
  requirePublished(event);
  if (event.visibility !== 'public' || (group && group.visibility !== 'public')) {
    fail(409, 'La billetterie est réservée aux événements accessibles au public');
  }
}

export default class Events {
  constructor(app, models) {
    this.app = app;
    this.models = models;
    this.run();
  }

  run() {
    const { app, models } = this;
    const { Event, Group, User } = models;
    const requireAuth = auth(User);
    const optionalAuth = auth(User, { optional: true });
    const current = (req) => getEvent(models, req.params.eventId, req.userId);

    app.post('/events', requireAuth, route(async (req, res) => {
      const input = body(req);
      const group = input.groupId === undefined ? null : await getGroup(Group, input.groupId, req.userId);
      if (group && !includesId(group.admins, req.userId) &&
          (!group.allowMemberEvents || !includesId(group.members, req.userId))) {
        fail(403, 'Création d’événement interdite dans ce groupe');
      }

      const event = await Event.create({
        ...eventFields(input),
        groupId: group?._id,
        organizers: [req.userId],
        participants: [req.userId],
        invitedUsers: group?.members || []
      });
      res.status(201).json(eventView(event, req.userId));
    }));

    app.get('/events', optionalAuth, route(async (req, res) => {
      const events = await Event.find({ active: true }).select('-albums -polls -tickets -threads -shoppingList -rides');
      const groups = await Group.find({
        active: true,
        _id: { $in: events.map((event) => event.groupId).filter(Boolean) }
      }).select('members visibility');
      const groupById = new Map(groups.map((group) => [String(group._id), group]));
      const visible = [];
      for (const event of events) {
        if (canReadEvent(event, groupById.get(String(event.groupId)), req.userId)) visible.push(event);
      }
      res.json(search(req, visible).map((event) => eventView(event, req.userId)));
    }));

    app.get('/events/:eventId', optionalAuth, route(async (req, res) => {
      const { event } = await current(req);
      res.json(eventView(event, req.userId));
    }));

    app.patch('/events/:eventId', requireAuth, route(async (req, res) => {
      const { event } = await current(req);
      requireOrganizer(event, req.userId);
      const fields = eventFields(body(req), event);
      if (event.ticketTypes.length && fields.visibility !== 'public') {
        fail(409, 'Retire la billetterie avant de rendre cet événement privé');
      }
      event.set(fields);
      await event.save();
      res.json(eventView(event, req.userId));
    }));

    app.patch('/events/:eventId/people', requireAuth, route(async (req, res) => {
      const { event, group } = await current(req);
      requireOrganizer(event, req.userId);
      const input = body(req);
      if (input.organizers !== undefined) {
        const organizers = await activeUsers(User, input.organizers, 'organizers');
        if (!organizers.length) fail(400, 'Au moins un organisateur est requis');
        if (group && !organizers.every((id) => includesId(group.members, id))) {
          fail(400, 'Un organisateur doit appartenir au groupe');
        }
        event.organizers = organizers;
        for (const id of organizers) {
          if (!includesId(event.participants, id)) event.participants.push(id);
        }
      }
      if (input.invitedUsers !== undefined) {
        const invited = await activeUsers(User, input.invitedUsers, 'invitedUsers');
        if (group && !invited.every((id) => includesId(group.members, id))) {
          fail(400, 'Les personnes invitées doivent appartenir au groupe');
        }
        event.invitedUsers = [...new Set([...(group?.members || []).map(String), ...invited])];
      }
      await event.save();
      res.json(eventView(event, req.userId));
    }));

    app.post('/events/:eventId/publish', requireAuth, route(async (req, res) => {
      const { event } = await current(req);
      requireOrganizer(event, req.userId);
      event.status = 'published';
      await event.save();
      res.json(eventView(event, req.userId));
    }));

    app.post('/events/:eventId/join', requireAuth, route(async (req, res) => {
      const { event, group } = await current(req);
      requirePublished(event);
      if (!isParticipant(event, req.userId)) {
        const invited = includesId(event.invitedUsers, req.userId);
        if ((event.visibility === 'private' && !invited) ||
            (group && group.visibility !== 'public' && !invited && !includesId(group.members, req.userId))) {
          fail(403, 'Invitation requise');
        }
        event.participants.push(req.userId);
        await event.save();
      }
      res.json(eventView(event, req.userId));
    }));

    app.get('/events/:eventId/share', requireAuth, route(async (req, res) => {
      const { event, group } = await current(req);
      requireOrganizer(event, req.userId);
      requirePublished(event);
      if (event.visibility !== 'public' || (group && group.visibility !== 'public')) {
        fail(403, 'Seul un événement accessible au public peut être partagé');
      }
      const url = `${config.publicBaseUrl}/events/${event._id}`;
      res.json({
        url,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
      });
    }));

    app.delete('/events/:eventId', requireAuth, route(async (req, res) => {
      const { event } = await current(req);
      requireOrganizer(event, req.userId);
      event.active = false;
      await event.save();
      res.status(204).end();
    }));
  }
}
