import mongoose from 'mongoose';
import { threadSchema } from './discussion.mjs';

const userId = { type: mongoose.Schema.Types.ObjectId, ref: 'User' };

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, required: true },
  icon: String,
  coverPhoto: String,
  visibility: { type: String, enum: ['public', 'private', 'secret'], required: true },
  allowMemberPosts: { type: Boolean, default: false },
  allowMemberEvents: { type: Boolean, default: false },
  members: [userId],
  admins: [userId],
  threads: [threadSchema],
  active: { type: Boolean, default: true }
}, { timestamps: true, optimisticConcurrency: true });

export default groupSchema;
