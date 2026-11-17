import { auth } from '../middlewares/auth.mjs';
import { body, fail, includesId, route, sameId, search, subdocument, text } from '../http.mjs';
import { getGroup } from './groups.mjs';
import { getEvent, isOrganizer, requireParticipant, requirePublished } from './events.mjs';

export default class Discussions {
  constructor(app, models) {
    this.routes(app, models, '/groups/:groupId', async (req) => {
      const group = await getGroup(models.Group, req.params.groupId, req.userId);
      if (!includesId(group.members, req.userId)) fail(403, 'Membre du groupe requis');
      const manager = includesId(group.admins, req.userId);
      return { parent: group, manager, canPost: manager || group.allowMemberPosts };
    });

    this.routes(app, models, '/events/:eventId', async (req) => {
      const { event } = await getEvent(models, req.params.eventId, req.userId);
      requirePublished(event);
      requireParticipant(event, req.userId);
      return { parent: event, manager: isOrganizer(event, req.userId), canPost: true };
    });
  }

  routes(app, models, prefix, load) {
    const requireAuth = auth(models.User);
    const threads = `${prefix}/threads`;
    const threadPath = `${threads}/:threadId`;
    const messages = `${threadPath}/messages`;
    const messagePath = `${messages}/:messageId`;
    const eventCommentPath = `${messagePath}/comments`;

    const getThread = (parent, req) => subdocument(parent.threads, req.params.threadId, 'Fil');
    const getMessage = (parent, req) => subdocument(getThread(parent, req).messages, req.params.messageId, 'Message');
    const editAllowed = (item, req, manager) => {
      if (!manager && !sameId(item.author, req.userId)) fail(403, 'Auteur ou gestionnaire requis');
    };

    app.get(threads, requireAuth, route(async (req, res) => {
      const { parent } = await load(req);
      const threads = search(req, parent.threads, (thread) => thread.title);
      res.json(threads.map(({ _id, title, author, messages }) => ({ _id, title, author, messageCount: messages.length })));
    }));

    app.post(threads, requireAuth, route(async (req, res) => {
      const { parent, canPost } = await load(req);
      if (!canPost) fail(403, 'La publication par les membres est désactivée');
      const thread = parent.threads.create({ title: text(body(req).title, 'title'), author: req.userId });
      parent.threads.push(thread);
      await parent.save();
      res.status(201).json(thread);
    }));

    app.get(threadPath, requireAuth, route(async (req, res) => {
      const { parent } = await load(req);
      res.json(getThread(parent, req));
    }));

    app.patch(threadPath, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const thread = getThread(parent, req);
      editAllowed(thread, req, manager);
      thread.title = text(body(req).title, 'title');
      await parent.save();
      res.json(thread);
    }));

    app.delete(threadPath, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const thread = getThread(parent, req);
      editAllowed(thread, req, manager);
      if (parent.constructor.modelName === 'Group' && parent.threads.length <= 1) {
        fail(409, 'Le groupe doit conserver au moins un fil de discussion');
      }
      parent.threads.pull(thread._id);
      await parent.save();
      res.status(204).end();
    }));

    app.post(messages, requireAuth, route(async (req, res) => {
      const { parent, canPost } = await load(req);
      if (!canPost) fail(403, 'La publication par les membres est désactivée');
      const thread = getThread(parent, req);
      const message = thread.messages.create({ text: text(body(req).text, 'text', 4000), author: req.userId });
      thread.messages.push(message);
      await parent.save();
      res.status(201).json(message);
    }));

    app.patch(messagePath, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const message = getMessage(parent, req);
      editAllowed(message, req, manager);
      message.text = text(body(req).text, 'text', 4000);
      await parent.save();
      res.json(message);
    }));

    app.delete(messagePath, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const message = getMessage(parent, req);
      editAllowed(message, req, manager);
      getThread(parent, req).messages.pull(message._id);
      await parent.save();
      res.status(204).end();
    }));

    app.post(eventCommentPath, requireAuth, route(async (req, res) => {
      const { parent } = await load(req);
      const message = getMessage(parent, req);
      const comment = message.comments.create({ text: text(body(req).text, 'text', 2000), author: req.userId });
      message.comments.push(comment);
      await parent.save();
      res.status(201).json(comment);
    }));

    app.patch(`${eventCommentPath}/:commentId`, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const comment = subdocument(getMessage(parent, req).comments, req.params.commentId, 'Commentaire');
      editAllowed(comment, req, manager);
      comment.text = text(body(req).text, 'text', 2000);
      await parent.save();
      res.json(comment);
    }));

    app.delete(`${eventCommentPath}/:commentId`, requireAuth, route(async (req, res) => {
      const { parent, manager } = await load(req);
      const { comments } = getMessage(parent, req);
      const comment = subdocument(comments, req.params.commentId, 'Commentaire');
      editAllowed(comment, req, manager);
      comments.pull(comment._id);
      await parent.save();
      res.status(204).end();
    }));
  }
}
