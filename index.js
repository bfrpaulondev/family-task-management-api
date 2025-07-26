/*
 * Family Task Management API
 *
 * This Fastify server exposes a RESTful interface for managing
 * household chores.  Families can register and login, create
 * members, assign tasks with priorities, comment on them, mark
 * completion and keep track of scores.  Historical statistics and
 * overdue alerts are also provided.  API documentation is
 * automatically generated using Swagger and served at `/docs`.
 */

const fastify = require('fastify')({ logger: true });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Family = require('./models/Family');
const Task = require('./models/Task');
require('dotenv').config();

// Connect to MongoDB using the URI defined in the environment.
async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    fastify.log.info('Connected to MongoDB');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Register Swagger for API documentation.  The first plugin defines
// the specification and the second plugin serves the UI at /docs.
fastify.register(require('fastify-swagger'), {
  swagger: {
    info: {
      title: 'Family Task Management API',
      description: 'API for managing household tasks with authentication, prioritisation and gamification.',
      version: '1.0.0'
    },
    tags: [
      { name: 'families', description: 'Family registration and login' },
      { name: 'members', description: 'Family members' },
      { name: 'tasks', description: 'Task management' },
      { name: 'stats', description: 'Statistics and history' },
      { name: 'alerts', description: 'Overdue task alerts' }
    ],
    consumes: ['application/json'],
    produces: ['application/json']
  }
});

fastify.register(require('fastify-swagger-ui'), {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  },
  staticCSP: true
});

// Authentication hook.  Many routes require the requester to be
// authenticated with a valid JWT.  The token must be sent in the
// Authorization header in the form `Bearer <token>`.  If the token
// is valid the corresponding family document is attached to the
// request.
fastify.decorate('authenticate', async function (request, reply) {
  try {
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return reply.code(401).send({ error: 'No authorization header provided' });
    }
    const [, token] = authHeader.split(' ');
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const family = await Family.findById(decoded.familyId);
    if (!family) {
      return reply.code(401).send({ error: 'Family not found' });
    }
    request.family = family;
  } catch (err) {
    return reply.code(401).send({ error: 'Invalid or expired token' });
  }
});

/*
 * Routes for family registration and login
 */

// Register a new family.  The request body should include a
// `name`, `code` and `password`.  Optionally an array of members
// can be provided.  The password is hashed before storing.
fastify.post('/api/families/register', {
  schema: {
    tags: ['families'],
    body: {
      type: 'object',
      required: ['name', 'code', 'password'],
      properties: {
        name: { type: 'string' },
        code: { type: 'string' },
        password: { type: 'string' },
        members: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string' } }
          }
        }
      }
    },
    response: {
      201: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          code: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { name, code, password, members = [] } = request.body;
  // Ensure the code is unique
  const existing = await Family.findOne({ code });
  if (existing) {
    return reply.code(409).send({ error: 'Family code already exists' });
  }
  const family = new Family({ name, code, members });
  await family.setPassword(password);
  await family.save();
  return reply.code(201).send({ id: family._id, name: family.name, code: family.code });
});

// Login an existing family.  The body must include the family code and
// password.  A JSON web token is returned if the credentials are
// valid.  Clients should include this token in the Authorization
// header for all subsequent requests.
fastify.post('/api/families/login', {
  schema: {
    tags: ['families'],
    body: {
      type: 'object',
      required: ['code', 'password'],
      properties: {
        code: { type: 'string' },
        password: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          token: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { code, password } = request.body;
  const family = await Family.findOne({ code });
  if (!family) {
    return reply.code(401).send({ error: 'Invalid code or password' });
  }
  const valid = await family.verifyPassword(password);
  if (!valid) {
    return reply.code(401).send({ error: 'Invalid code or password' });
  }
  const token = jwt.sign({ familyId: family._id, code: family.code }, process.env.JWT_SECRET, { expiresIn: '7d' });
  return { token };
});

/*
 * Member endpoints
 */

// Create a new member for the authenticated family.
fastify.post('/api/members', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['members'],
    body: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } }
    },
    response: {
      201: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          score: { type: 'number' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { name } = request.body;
  const member = { name, score: 0 };
  request.family.members.push(member);
  await request.family.save();
  const savedMember = request.family.members[request.family.members.length - 1];
  return reply.code(201).send({ id: savedMember._id, name: savedMember.name, score: savedMember.score });
});

// List all members of the authenticated family.
fastify.get('/api/members', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['members'],
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            score: { type: 'number' }
          }
        }
      }
    }
  }
}, async (request) => {
  return request.family.members.map(m => ({ id: m._id, name: m.name, score: m.score }));
});

/*
 * Task endpoints
 */

// Create a new task for the authenticated family.
fastify.post('/api/tasks', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    body: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        dueDate: { type: 'string', format: 'date-time' },
        assignedTo: { type: 'string' }
      }
    },
    response: {
      201: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string' },
          assignedTo: { type: 'string' },
          dueDate: { type: 'string' },
          completed: { type: 'boolean' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { title, description, priority = 'medium', dueDate, assignedTo } = request.body;
  const task = new Task({
    family: request.family._id,
    title,
    description,
    priority,
    dueDate,
    assignedTo
  });
  await task.save();
  return reply.code(201).send({
    id: task._id,
    title: task.title,
    priority: task.priority,
    assignedTo: task.assignedTo,
    dueDate: task.dueDate,
    completed: task.completed
  });
});

// Retrieve all tasks for the authenticated family.  Optional query
// parameters allow filtering by completion status.
fastify.get('/api/tasks', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    querystring: {
      type: 'object',
      properties: {
        completed: { type: 'boolean' }
      }
    },
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            priority: { type: 'string' },
            assignedTo: { type: 'string' },
            dueDate: { type: 'string' },
            completed: { type: 'boolean' }
          }
        }
      }
    }
  }
}, async (request) => {
  const filter = { family: request.family._id };
  if (request.query.completed !== undefined) {
    filter.completed = request.query.completed;
  }
  const tasks = await Task.find(filter).lean();
  return tasks.map(t => ({
    id: t._id,
    title: t.title,
    priority: t.priority,
    assignedTo: t.assignedTo,
    dueDate: t.dueDate,
    completed: t.completed
  }));
});

// Update a task.  Only fields provided in the body are modified.
fastify.put('/api/tasks/:id', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    body: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        dueDate: { type: 'string', format: 'date-time' },
        assignedTo: { type: 'string' },
        completed: { type: 'boolean' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          priority: { type: 'string' },
          assignedTo: { type: 'string' },
          dueDate: { type: 'string' },
          completed: { type: 'boolean' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const update = request.body;
  const task = await Task.findOne({ _id: id, family: request.family._id });
  if (!task) {
    return reply.code(404).send({ error: 'Task not found' });
  }
  Object.assign(task, update);
  if (update.completed && !task.completedAt) {
    task.completedAt = new Date();
  }
  await task.save();
  return {
    id: task._id,
    title: task.title,
    priority: task.priority,
    assignedTo: task.assignedTo,
    dueDate: task.dueDate,
    completed: task.completed
  };
});

// Delete a task.
fastify.delete('/api/tasks/:id', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    response: {
      204: { type: 'null' }
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const result = await Task.deleteOne({ _id: id, family: request.family._id });
  if (result.deletedCount === 0) {
    return reply.code(404).send({ error: 'Task not found' });
  }
  return reply.code(204).send();
});

// Assign a task to a member.  The body should include the member name.
fastify.post('/api/tasks/:id/assign', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    body: {
      type: 'object',
      required: ['member'],
      properties: {
        member: { type: 'string' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          assignedTo: { type: 'string' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const { member } = request.body;
  const task = await Task.findOne({ _id: id, family: request.family._id });
  if (!task) {
    return reply.code(404).send({ error: 'Task not found' });
  }
  // Ensure member exists in family
  const exists = request.family.members.some(m => m.name === member);
  if (!exists) {
    return reply.code(404).send({ error: 'Member not found' });
  }
  task.assignedTo = member;
  await task.save();
  return { id: task._id, assignedTo: task.assignedTo };
});

// Mark a task as completed.  When completed, the assigned member
// gains a point.  If the task is already complete, no changes are
// made.  Optionally a date can be provided; otherwise now is used.
fastify.post('/api/tasks/:id/complete', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    body: {
      type: 'object',
      properties: {
        date: { type: 'string', format: 'date-time' }
      }
    },
    response: {
      200: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          completed: { type: 'boolean' },
          completedAt: { type: 'string' },
          memberScore: { type: 'number' }
        }
      }
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const { date } = request.body;
  const task = await Task.findOne({ _id: id, family: request.family._id });
  if (!task) {
    return reply.code(404).send({ error: 'Task not found' });
  }
  if (task.completed) {
    return { id: task._id, completed: true, completedAt: task.completedAt };
  }
  task.completed = true;
  task.completedAt = date ? new Date(date) : new Date();
  await task.save();
  let memberScore;
  if (task.assignedTo) {
    // find member and increment score
    const member = request.family.members.find(m => m.name === task.assignedTo);
    if (member) {
      member.score += 1;
      memberScore = member.score;
      await request.family.save();
    }
  }
  return {
    id: task._id,
    completed: task.completed,
    completedAt: task.completedAt,
    memberScore
  };
});

// Add a comment to a task.
fastify.post('/api/tasks/:id/comments', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['tasks'],
    params: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    body: {
      type: 'object',
      required: ['member', 'text'],
      properties: {
        member: { type: 'string' },
        text: { type: 'string' }
      }
    },
    response: {
      201: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          comments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                member: { type: 'string' },
                text: { type: 'string' },
                createdAt: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
}, async (request, reply) => {
  const { id } = request.params;
  const { member, text } = request.body;
  const task = await Task.findOne({ _id: id, family: request.family._id });
  if (!task) {
    return reply.code(404).send({ error: 'Task not found' });
  }
  task.comments.push({ member, text });
  await task.save();
  return reply.code(201).send({ id: task._id, comments: task.comments });
});

/*
 * Statistics and history
 */

// Get statistics per member.  This returns the number of tasks and
// completed tasks for each member along with their score.
fastify.get('/api/stats/members', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['stats'],
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            member: { type: 'string' },
            totalTasks: { type: 'number' },
            completedTasks: { type: 'number' },
            score: { type: 'number' }
          }
        }
      }
    }
  }
}, async (request) => {
  const tasks = await Task.find({ family: request.family._id }).lean();
  return request.family.members.map(m => {
    const memberTasks = tasks.filter(t => t.assignedTo === m.name);
    const completed = memberTasks.filter(t => t.completed);
    return {
      member: m.name,
      totalTasks: memberTasks.length,
      completedTasks: completed.length,
      score: m.score
    };
  });
});

// Get a history of tasks grouped by week or month.  The period is
// specified via the `period` query parameter.  Defaults to week.
fastify.get('/api/stats/history', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['stats'],
    querystring: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month'], default: 'week' }
      }
    },
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            period: { type: 'string' },
            total: { type: 'number' },
            completed: { type: 'number' }
          }
        }
      }
    }
  }
}, async (request) => {
  const { period = 'week' } = request.query;
  const tasks = await Task.find({ family: request.family._id }).lean();
  const map = new Map();
  tasks.forEach(t => {
    const date = new Date(t.createdAt);
    let key;
    if (period === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else {
      // week of year
      const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
      const weekNumber = Math.ceil(((date - firstDayOfYear) / 86400000 + firstDayOfYear.getDay() + 1) / 7);
      key = `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
    }
    if (!map.has(key)) {
      map.set(key, { period: key, total: 0, completed: 0 });
    }
    const entry = map.get(key);
    entry.total += 1;
    if (t.completed) entry.completed += 1;
  });
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
});

/*
 * Alert endpoint
 */

// List overdue tasks (due date in the past and not completed).
fastify.get('/api/alerts/overdue', {
  preHandler: [fastify.authenticate],
  schema: {
    tags: ['alerts'],
    response: {
      200: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            assignedTo: { type: 'string' },
            dueDate: { type: 'string' }
          }
        }
      }
    }
  }
}, async (request) => {
  const now = new Date();
  const tasks = await Task.find({ family: request.family._id, completed: false, dueDate: { $lt: now } }).lean();
  return tasks.map(t => ({ id: t._id, title: t.title, assignedTo: t.assignedTo, dueDate: t.dueDate }));
});

// Start the server.  Ensure the database is connected first.
const start = async () => {
  await connectDatabase();
  try {
    await fastify.listen({ port: process.env.PORT || 3000, host: '0.0.0.0' });
    fastify.swagger(); // generate swagger specification at runtime
    fastify.log.info(`Server listening on port ${process.env.PORT || 3000}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();