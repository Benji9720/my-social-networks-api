import mongoose from 'mongoose';

const { Schema } = mongoose;
const userRef = { type: Schema.Types.ObjectId, ref: 'User', required: true };

export const commentSchema = new Schema({
  text: { type: String, required: true },
  author: userRef
}, { timestamps: true });

const messageSchema = new Schema({
  text: { type: String, required: true },
  author: userRef,
  comments: [commentSchema]
}, { timestamps: true });

export const threadSchema = new Schema({
  title: { type: String, required: true },
  author: userRef,
  messages: [messageSchema]
}, { timestamps: true });
