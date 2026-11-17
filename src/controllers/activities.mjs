import { auth } from '../middlewares/auth.mjs';
import { body, date, fail, number, route, sameId, search, subdocument, text } from '../http.mjs';
import { getEvent, isOrganizer, requireParticipant, requirePublished } from './events.mjs';

function shoppingFields(input, current) {
  const name = text(input.name ?? current?.name, 'name');
  return {
    name,
    normalizedName: name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' '),
    quantity: number(input.quantity ?? current?.quantity, 'quantity', 1, 10000),
    arrivalAt: input.arrivalAt === undefined && current ? current.arrivalAt : date(input.arrivalAt, 'arrivalAt')
  };
}

function rideFields(input, current) {
  return {
    departurePlace: text(input.departurePlace ?? current?.departurePlace, 'departurePlace'),
    departureAt: input.departureAt === undefined && current ? current.departureAt : date(input.departureAt, 'departureAt'),
    priceCents: number(input.priceCents ?? current?.priceCents, 'priceCents', 0, 1000000),
    seats: number(input.seats ?? current?.seats, 'seats', 1, 8),
    maxDelayMinutes: number(input.maxDelayMinutes ?? current?.maxDelayMinutes, 'maxDelayMinutes', 0, 1440)
  };
}

export default class Activities {
  constructor(app, models) {
    this.app = app;
    this.models = models;

    this.routes('shopping-list', 'shoppingList', 'shoppingListEnabled', 'broughtBy', shoppingFields, (item) => item.name);
    this.routes('rides', 'rides', 'carpoolEnabled', 'driver', rideFields, (ride) => ride.departurePlace);
  }

  routes(resource, field, enabled, author, fields, searchField) {
    const { app, models } = this;
    const requireAuth = auth(models.User);
    const path = `/events/:eventId/${resource}`;
    const itemPath = `${path}/:itemId`;

    const load = async (req) => {
      const { event } = await getEvent(models, req.params.eventId, req.userId);
      requirePublished(event);
      requireParticipant(event, req.userId);
      if (!event[enabled]) fail(409, 'Cette fonctionnalité est désactivée');
      return event;
    };

    const getItem = (event, req) => subdocument(event[field], req.params.itemId, 'Élément');
    const editAllowed = (event, item, req) => {
      if (!sameId(item[author], req.userId) && !isOrganizer(event, req.userId)) {
        fail(403, 'Auteur ou organisateur requis');
      }
    };
    const checkUnique = (event, changes, current) => {
      if (field === 'shoppingList' && event[field].some((item) =>
        !sameId(item._id, current?._id) && item.normalizedName === changes.normalizedName
      )) {
        fail(409, 'Un élément de ce nom existe déjà pour cet événement');
      }
    };

    app.get(path, requireAuth, route(async (req, res) => {
      const event = await load(req);
      res.json(search(req, event[field], searchField));
    }));

    app.get(itemPath, requireAuth, route(async (req, res) => {
      res.json(getItem(await load(req), req));
    }));

    app.post(path, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const changes = fields(body(req));
      checkUnique(event, changes);
      const item = event[field].create({ ...changes, [author]: req.userId });
      event[field].push(item);
      await event.save();
      res.status(201).json(item);
    }));

    app.patch(itemPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const item = getItem(event, req);
      editAllowed(event, item, req);
      const changes = fields(body(req), item);
      checkUnique(event, changes, item);
      item.set(changes);
      await event.save();
      res.json(item);
    }));

    app.delete(itemPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const item = getItem(event, req);
      editAllowed(event, item, req);
      event[field].pull(item._id);
      await event.save();
      res.status(204).end();
    }));
  }
}
