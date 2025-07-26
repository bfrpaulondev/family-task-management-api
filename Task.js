const mongoose = require('mongoose');

// Schema for comments on tasks.  Each comment stores the
// member's name, the comment text and when it was created.
const CommentSchema = new mongoose.Schema({
  member: { type: String, required: true },
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

/**
 * Task schema.  Each task belongs to a family and may be assigned to
 * a member.  Tasks can have a priority, due date, completion status
 * and a list of comments.  When a task is completed the completedAt
 * field is set to the timestamp of completion.
 */
const TaskSchema = new mongoose.Schema(
  {
    family: { type: mongoose.Schema.Types.ObjectId, ref: 'Family', required: true },
    title: { type: String, required: true },
    description: { type: String },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    assignedTo: { type: String },
    dueDate: { type: Date },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    comments: [CommentSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Task', TaskSchema);