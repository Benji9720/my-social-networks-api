import mongoose from 'mongoose';
import { commentSchema, threadSchema } from './discussion.mjs';

const { Schema } = mongoose;
const objectId = Schema.Types.ObjectId;
const userRef = { type: objectId, ref: 'User', required: true };

const photo = new Schema({
  title: { type: String, required: true },
  url: { type: String, required: true },
  author: userRef,
  comments: [commentSchema]
}, { timestamps: true });

const album = new Schema({
  title: { type: String, required: true },
  author: userRef,
  photos: [photo]
}, { timestamps: true });

const question = new Schema({
  title: { type: String, required: true },
  options: [String]
});

const poll = new Schema({
  title: { type: String, required: true },
  author: userRef,
  questions: [question],
  votes: [{
    _id: false,
    voter: userRef,
    answers: [{ _id: false, questionId: objectId, option: Number }]
  }]
}, { timestamps: true });

const ticketType = new Schema({
  name: { type: String, required: true },
  priceCents: { type: Number, required: true },
  quantity: { type: Number, required: true }
}, { timestamps: true });

const ticket = new Schema({
  ticketTypeId: { type: objectId, required: true },
  buyer: userRef,
  firstname: { type: String, required: true },
  lastname: { type: String, required: true },
  address: { type: String, required: true },
  priceCents: { type: Number, required: true },
  purchaseDate: { type: Date, default: Date.now }
});

const item = new Schema({
  name: { type: String, required: true },
  normalizedName: { type: String, required: true },
  quantity: { type: Number, required: true },
  arrivalAt: { type: Date, required: true },
  broughtBy: userRef
}, { timestamps: true });

const ride = new Schema({
  departurePlace: { type: String, required: true },
  departureAt: { type: Date, required: true },
  priceCents: { type: Number, required: true },
  seats: { type: Number, required: true },
  maxDelayMinutes: { type: Number, required: true },
  driver: userRef
}, { timestamps: true });

const eventSchema = new Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  startAt: { type: Date, required: true },
  endAt: { type: Date, required: true },
  location: { type: String, required: true },
  coverPhoto: { type: String, required: true },
  visibility: { type: String, enum: ['public', 'private'], required: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  groupId: { type: objectId, ref: 'Group', index: true },
  organizers: [{ type: objectId, ref: 'User' }],
  participants: [{ type: objectId, ref: 'User' }],
  invitedUsers: [{ type: objectId, ref: 'User' }],
  shoppingListEnabled: { type: Boolean, default: false },
  carpoolEnabled: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  threads: [threadSchema],
  albums: [album],
  polls: [poll],
  ticketTypes: [ticketType],
  tickets: [ticket],
  shoppingList: [item],
  rides: [ride]
}, { timestamps: true, optimisticConcurrency: true });

export default eventSchema;
