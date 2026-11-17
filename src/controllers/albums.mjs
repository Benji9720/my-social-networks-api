import { auth } from '../middlewares/auth.mjs';
import { body, fail, route, sameId, search, subdocument, text, webUrl } from '../http.mjs';
import { getEvent, isOrganizer, requireParticipant, requirePublished } from './events.mjs';

export default class Albums {
  constructor(app, models) {
    this.app = app;
    this.models = models;
    this.run();
  }

  run() {
    const { app, models } = this;
    const requireAuth = auth(models.User);
    const albums = '/events/:eventId/albums';
    const albumPath = `${albums}/:albumId`;
    const photos = `${albumPath}/photos`;
    const photoPath = `${photos}/:photoId`;
    const comments = `${photoPath}/comments`;
    const commentPath = `${comments}/:commentId`;

    const load = async (req) => {
      const { event } = await getEvent(models, req.params.eventId, req.userId);
      requirePublished(event);
      requireParticipant(event, req.userId);
      return event;
    };
    const getAlbum = (event, req) => subdocument(event.albums, req.params.albumId, 'Album');
    const getPhoto = (event, req) => subdocument(getAlbum(event, req).photos, req.params.photoId, 'Photo');
    const editAllowed = (event, item, req) => {
      if (!isOrganizer(event, req.userId) && !sameId(item.author, req.userId)) fail(403, 'Auteur ou organisateur requis');
    };

    app.get(albums, requireAuth, route(async (req, res) => {
      const event = await load(req);
      res.json(search(req, event.albums, (album) => album.title));
    }));

    app.post(albums, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const album = event.albums.create({ title: text(body(req).title, 'title'), author: req.userId });
      event.albums.push(album);
      await event.save();
      res.status(201).json(album);
    }));

    app.get(albumPath, requireAuth, route(async (req, res) => {
      res.json(getAlbum(await load(req), req));
    }));

    app.patch(albumPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const album = getAlbum(event, req);
      editAllowed(event, album, req);
      album.title = text(body(req).title, 'title');
      await event.save();
      res.json(album);
    }));

    app.delete(albumPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const album = getAlbum(event, req);
      editAllowed(event, album, req);
      event.albums.pull(album._id);
      await event.save();
      res.status(204).end();
    }));

    app.get(photos, requireAuth, route(async (req, res) => {
      res.json(search(req, getAlbum(await load(req), req).photos, (photo) => photo.title));
    }));

    app.get(photoPath, requireAuth, route(async (req, res) => {
      res.json(getPhoto(await load(req), req));
    }));

    app.post(photos, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const album = getAlbum(event, req);
      const input = body(req);
      const photo = album.photos.create({
        title: text(input.title, 'title'),
        url: webUrl(input.url, 'url'),
        author: req.userId
      });
      album.photos.push(photo);
      await event.save();
      res.status(201).json(photo);
    }));

    app.patch(photoPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const photo = getPhoto(event, req);
      editAllowed(event, photo, req);
      const input = body(req);
      if (input.title !== undefined) photo.title = text(input.title, 'title');
      if (input.url !== undefined) photo.url = webUrl(input.url, 'url');
      await event.save();
      res.json(photo);
    }));

    app.delete(photoPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const photo = getPhoto(event, req);
      editAllowed(event, photo, req);
      getAlbum(event, req).photos.pull(photo._id);
      await event.save();
      res.status(204).end();
    }));

    app.post(comments, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const photo = getPhoto(event, req);
      const comment = photo.comments.create({ text: text(body(req).text, 'text', 2000), author: req.userId });
      photo.comments.push(comment);
      await event.save();
      res.status(201).json(comment);
    }));

    app.patch(commentPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const comment = subdocument(getPhoto(event, req).comments, req.params.commentId, 'Commentaire');
      editAllowed(event, comment, req);
      comment.text = text(body(req).text, 'text', 2000);
      await event.save();
      res.json(comment);
    }));

    app.delete(commentPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const { comments } = getPhoto(event, req);
      const comment = subdocument(comments, req.params.commentId, 'Commentaire');
      editAllowed(event, comment, req);
      comments.pull(comment._id);
      await event.save();
      res.status(204).end();
    }));
  }
}
