import { auth } from '../middlewares/auth.mjs';
import { body, fail, number, objectId, route, sameId, search, subdocument, text } from '../http.mjs';
import { getEvent, requireOrganizer, requireParticipant, requirePublished } from './events.mjs';

function questions(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    fail(400, 'Indique de 1 à 30 questions');
  }
  return input.map((question) => {
    if (!Array.isArray(question?.options) || question.options.length < 2 || question.options.length > 10) {
      fail(400, 'Chaque question doit avoir de 2 à 10 réponses possibles');
    }
    const options = question.options.map((option) => text(option, 'option'));
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      fail(400, 'Les réponses possibles doivent être distinctes');
    }
    return { title: text(question.title, 'title'), options };
  });
}

function pollView(poll, userId) {
  const myVote = poll.votes.find((vote) => sameId(vote.voter, userId));
  return {
    id: String(poll._id),
    title: poll.title,
    author: poll.author,
    voteCount: poll.votes.length,
    questions: poll.questions.map((question) => {
      const counts = question.options.map(() => 0);
      for (const vote of poll.votes) {
        const answer = vote.answers.find((entry) => sameId(entry.questionId, question._id));
        if (answer) counts[answer.option]++;
      }
      return { id: String(question._id), title: question.title, options: question.options, counts };
    }),
    myAnswers: myVote?.answers || []
  };
}

export default class Polls {
  constructor(app, models) {
    this.app = app;
    this.models = models;
    this.run();
  }

  run() {
    const { app, models } = this;
    const requireAuth = auth(models.User);
    const path = '/events/:eventId/polls';
    const itemPath = `${path}/:pollId`;
    const load = async (req) => {
      const { event } = await getEvent(models, req.params.eventId, req.userId);
      requirePublished(event);
      requireParticipant(event, req.userId);
      return event;
    };
    const getPoll = (event, req) => subdocument(event.polls, req.params.pollId, 'Sondage');

    app.get(path, requireAuth, route(async (req, res) => {
      const event = await load(req);
      res.json(search(req, event.polls, (poll) => poll.title).map((poll) => pollView(poll, req.userId)));
    }));

    app.post(path, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      const input = body(req);
      const poll = event.polls.create({
        title: text(input.title, 'title'),
        questions: questions(input.questions),
        author: req.userId
      });
      event.polls.push(poll);
      await event.save();
      res.status(201).json(pollView(poll, req.userId));
    }));

    app.get(itemPath, requireAuth, route(async (req, res) => {
      res.json(pollView(getPoll(await load(req), req), req.userId));
    }));

    app.patch(itemPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      const poll = getPoll(event, req);
      const input = body(req);
      if (input.questions !== undefined) {
        if (poll.votes.length) fail(409, 'Les questions sont figées après le premier vote');
        poll.questions = questions(input.questions);
      }
      if (input.title !== undefined) poll.title = text(input.title, 'title');
      await event.save();
      res.json(pollView(poll, req.userId));
    }));

    app.put(`${itemPath}/vote`, requireAuth, route(async (req, res) => {
      const event = await load(req);
      const poll = getPoll(event, req);
      const { answers } = body(req);
      if (!Array.isArray(answers) || answers.length !== poll.questions.length) {
        fail(400, 'Donne exactement une réponse par question');
      }
      const seen = new Set();
      const checked = answers.map((answer) => {
        const questionId = objectId(answer?.questionId);
        const question = subdocument(poll.questions, questionId, 'Question');
        if (seen.has(questionId)) fail(400, 'Une seule réponse par question');
        seen.add(questionId);
        return { questionId, option: number(answer.option, 'option', 0, question.options.length - 1) };
      });
      const previous = poll.votes.find((vote) => sameId(vote.voter, req.userId));
      if (previous) previous.answers = checked;
      else poll.votes.push({ voter: req.userId, answers: checked });
      await event.save();
      res.json(pollView(poll, req.userId));
    }));

    app.delete(itemPath, requireAuth, route(async (req, res) => {
      const event = await load(req);
      requireOrganizer(event, req.userId);
      event.polls.pull(getPoll(event, req)._id);
      await event.save();
      res.status(204).end();
    }));
  }
}
