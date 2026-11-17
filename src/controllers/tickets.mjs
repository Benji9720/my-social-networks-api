import { auth } from '../middlewares/auth.mjs';
import { body, fail, number, route, sameId, search, subdocument, text } from '../http.mjs';
import { checkTicketingEvent, getEvent, isOrganizer, isParticipant, requireOrganizer } from './events.mjs';

function ticketTypeFields(input, current) {
  return {
    name: text(input.name ?? current?.name, 'name'),
    priceCents: number(input.priceCents ?? current?.priceCents, 'priceCents', 0, 100000000),
    quantity: number(input.quantity ?? current?.quantity, 'quantity', 1, 10000)
  };
}

const sold = (event, typeId) => event.tickets.filter((ticket) => sameId(ticket.ticketTypeId, typeId)).length;

const typeView = (event, type) => ({
  id: String(type._id),
  name: type.name,
  priceCents: type.priceCents,
  quantity: type.quantity,
  available: type.quantity - sold(event, type._id)
});

export default class Tickets {
  constructor(app, models) {
    this.app = app;
    this.models = models;
    this.run();
  }

  run() {
    const { app, models } = this;
    const requireAuth = auth(models.User);
    const types = '/events/:eventId/ticket-types';
    const typePath = `${types}/:typeId`;
    const tickets = '/events/:eventId/tickets';
    const ticketPath = `${tickets}/:ticketId`;

    const load = async (req) => {
      const { event, group } = await getEvent(models, req.params.eventId, req.userId);
      checkTicketingEvent(event, group);
      return event;
    };
    const ownedTickets = (event, req) => isOrganizer(event, req.userId)
      ? event.tickets
      : event.tickets.filter((ticket) => sameId(ticket.buyer, req.userId));

    app.get(types, route(async (req, res) => {
      const event = await load(req);
      res.json(search(req, event.ticketTypes).map((type) => typeView(event, type)));
    }));

    app.get(typePath, route(async (req, res) => {
      const event = await load(req);
      res.json(typeView(event, subdocument(event.ticketTypes, req.params.typeId, 'Type de billet')));
    }));

    app.post(types, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      const type = event.ticketTypes.create(ticketTypeFields(body(req)));
      event.ticketTypes.push(type);
      await event.save();
      res.status(201).json(typeView(event, type));
    }));

    app.patch(typePath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      const type = subdocument(event.ticketTypes, req.params.typeId, 'Type de billet');
      const fields = ticketTypeFields(body(req), type);
      if (fields.quantity < sold(event, type._id)) fail(409, 'Quantité inférieure au nombre de billets vendus');
      type.set(fields);
      await event.save();
      res.json(typeView(event, type));
    }));

    app.delete(typePath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      const type = subdocument(event.ticketTypes, req.params.typeId, 'Type de billet');
      if (sold(event, type._id)) fail(409, 'Des billets utilisent ce type');
      event.ticketTypes.pull(type._id);
      await event.save();
      res.status(204).end();
    }));

    app.post(tickets, requireAuth, route(async (req, res) => {
      const event = await load(req);
      if (isParticipant(event, req.userId)) fail(403, 'Cette billetterie est destinée aux personnes extérieures');
      if (event.tickets.some((ticket) => sameId(ticket.buyer, req.userId))) {
        fail(409, 'Un seul billet par personne et par événement');
      }

      const input = body(req);
      const type = subdocument(event.ticketTypes, input.ticketTypeId, 'Type de billet');
      if (sold(event, type._id) >= type.quantity) fail(409, 'Ce type de billet est épuisé');

      const ticket = event.tickets.create({
        ticketTypeId: type._id,
        buyer: req.userId,
        firstname: text(input.firstname, 'firstname', 100),
        lastname: text(input.lastname, 'lastname', 100),
        address: text(input.address, 'address', 500),
        priceCents: type.priceCents
      });
      event.tickets.push(ticket);
      await event.save();
      res.status(201).json(ticket);
    }));

    app.get(tickets, requireAuth, route(async (req, res) => {
      const event = await load(req);
      res.json(search(req, ownedTickets(event, req), (ticket) => `${ticket.firstname} ${ticket.lastname}`));
    }));

    const getTicket = (event, req) => {
      const ticket = subdocument(event.tickets, req.params.ticketId, 'Billet');
      if (!isOrganizer(event, req.userId) && !sameId(ticket.buyer, req.userId)) {
        fail(404, 'Billet introuvable');
      }
      return ticket;
    };

    app.get(ticketPath, requireAuth, route(async (req, res) => {
      res.json(getTicket(await load(req), req));
    }));

    app.patch(ticketPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const ticket = getTicket(event, req);
      const input = body(req);

      if (input.firstname !== undefined) ticket.firstname = text(input.firstname, 'firstname', 100);
      if (input.lastname !== undefined) ticket.lastname = text(input.lastname, 'lastname', 100);
      if (input.address !== undefined) ticket.address = text(input.address, 'address', 500);
      await event.save();
      res.json(ticket);
    }));

    app.delete(ticketPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      event.tickets.pull(getTicket(event, req)._id);
      await event.save();
      res.status(204).end();
    }));
  }
}
