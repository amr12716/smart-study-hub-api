/**
 * Smart Study Hub - demo API (Groups feature).
 * In-memory data: restarting the server resets everything to the seed data below.
 * Auth is a demo token ("Bearer demo-u1"); replace with real JWT auth later.
 * The "AI help" endpoint is a simple heuristic stand-in for the real RAG/LLM service.
 */
const express = require('express');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

// ------------------------------------------------------------------ helpers
const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
let seq = 100;
const nextId = (p) => `${p}${++seq}`;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genCode(prefix) {
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const code = `${prefix}-${s}`;
    if (!groups.some((g) => g.joinCode === code)) return code;
  }
}

// --------------------------------------------------------------- seed data
const users = {
  u1: { id: 'u1', name: 'Sara', role: 'Student' },
  u2: { id: 'u2', name: 'Mona', role: 'Student' },
  u3: { id: 'u3', name: 'Omar', role: 'Student' },
  u4: { id: 'u4', name: 'Dr. Hassan', role: 'Doctor' },
};

const courses = [
  { id: 'c1', code: 'CS301', name: 'Databases', short: 'DB' },
  { id: 'c2', code: 'CS305', name: 'Operating Systems', short: 'OS' },
  { id: 'c3', code: 'CS310', name: 'Algorithms', short: 'AL' },
];
const courseById = (id) => courses.find((c) => c.id === id);

// Course material used by the "suggested from the course" part of AI help.
const materials = {
  c1: [
    { title: 'Lecture 4 · p. 15', kw: ['normal', '2nf', '3nf', 'dependenc'] },
    { title: 'Lecture 4 · p. 18', kw: ['bcnf', 'candidate', 'key'] },
    { title: 'Lecture 5 · p. 3', kw: ['index', 'join', 'sql'] },
  ],
  c2: [
    { title: 'Lecture 2 · p. 7', kw: ['process', 'thread'] },
    { title: 'Lecture 3 · p. 12', kw: ['schedul', 'cpu'] },
  ],
  c3: [
    { title: 'Lecture 1 · p. 5', kw: ['big o', 'complexity'] },
    { title: 'Lecture 2 · p. 9', kw: ['sort', 'merge', 'quick'] },
  ],
};

const groups = [
  {
    id: 'g1', name: 'Normalization study group', kind: 'study', courseId: 'c1',
    description: '', ownerId: 'u1', memberIds: ['u1', 'u2', 'u3'], memberCount: null,
    joinCode: 'DB-7K2Q', createdAt: minutesAgo(300), lastRead: { u1: minutesAgo(45) },
    ai: {
      summary: 'The group agreed that 2NF comes before 3NF and that partial dependencies are removed in 2NF.',
      flashcards: [
        { question: 'Which normal form removes partial dependencies?', answer: '2NF' },
        { question: 'What must be true before a table can be in 3NF?', answer: 'It must already be in 2NF' },
      ],
    },
  },
  {
    id: 'g2', name: 'Databases · Section A', kind: 'course', courseId: 'c1',
    description: '', ownerId: null, memberIds: ['u1', 'u2', 'u3', 'u4'], memberCount: 214,
    joinCode: null, createdAt: minutesAgo(9000), lastRead: { u1: minutesAgo(60) }, ai: {},
  },
  {
    id: 'g3', name: 'Operating Systems · Section B', kind: 'course', courseId: 'c2',
    description: '', ownerId: null, memberIds: ['u1', 'u3', 'u4'], memberCount: 187,
    joinCode: null, createdAt: minutesAgo(9000), lastRead: { u1: minutesAgo(0) }, ai: {},
  },
];

const messages = [];
function seedMsg(groupId, senderId, text, ago, pinned = false) {
  messages.push({ id: nextId('m'), groupId, senderId, text, createdAt: minutesAgo(ago), pinned });
}
seedMsg('g1', 'u1', 'Does 3NF also remove partial dependencies?', 120);
seedMsg('g1', 'u2', 'Yes, a table must be in 2NF before it can be in 3NF.', 60);
seedMsg('g1', 'u3', 'Can someone explain BCNF?', 30);
seedMsg('g1', 'u2', 'I think it is a stricter 3NF but I am not sure.', 20);
seedMsg('g1', 'u3', 'What is the difference between a candidate key and a primary key?', 8);
seedMsg('g2', 'u4', 'Quiz 2 will cover lectures 3 to 5.', 300);
seedMsg('g2', 'u2', 'Is the quiz open book?', 40);
seedMsg('g2', 'u3', 'Is the assignment submitted on the portal?', 25);
seedMsg('g3', 'u3', 'Do we need to install Linux on our laptops?', 2880);

const reports = [];

// ------------------------------------------------------------- middleware
function auth(req, res, next) {
  const m = /^Bearer demo-(u\d+)$/.exec(req.headers.authorization || '');
  const user = m && users[m[1]];
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  req.user = user;
  next();
}

function loadGroup(req, res, next) {
  const g = groups.find((x) => x.id === req.params.id);
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (!g.memberIds.includes(req.user.id)) return res.status(403).json({ error: 'You are not a member of this group' });
  req.group = g;
  next();
}

const messagesOf = (gid) => messages.filter((m) => m.groupId === gid);
const memberCountOf = (g) => g.memberCount ?? g.memberIds.length;
const labelFor = (g) => (g.kind === 'course' ? 'Course' : 'Study');

function groupDto(g, user) {
  const msgs = messagesOf(g.id);
  const last = msgs[msgs.length - 1];
  const readAt = g.lastRead[user.id] || g.createdAt;
  const course = courseById(g.courseId);
  return {
    id: g.id,
    name: g.name,
    kind: g.kind,
    label: labelFor(g),
    courseId: g.courseId,
    courseCode: course ? course.code : '',
    description: g.description,
    memberCount: memberCountOf(g),
    isOwner: g.ownerId === user.id,
    unread: msgs.filter((m) => m.senderId !== user.id && m.createdAt > readAt).length,
    lastMessage: last
      ? { senderName: users[last.senderId].name, text: last.text, createdAt: last.createdAt }
      : null,
    lastActivity: last ? last.createdAt : g.createdAt,
  };
}

const messageDto = (m, user) => ({
  id: m.id,
  groupId: m.groupId,
  senderId: m.senderId,
  senderName: users[m.senderId].name,
  text: m.text,
  createdAt: m.createdAt,
  pinned: m.pinned,
  mine: m.senderId === user.id,
});

// ------------------------------------------------------------------ routes
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.post('/api/auth/demo-login', (req, res) => {
  const id = (req.body && req.body.userId) || 'u1';
  const user = users[id];
  if (!user || user.role !== 'Student') return res.status(400).json({ error: 'Unknown demo user' });
  res.json({ token: `demo-${user.id}`, user });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));
app.get('/api/courses', auth, (_req, res) => res.json({ courses }));

app.get('/api/groups', auth, (req, res) => {
  const list = groups
    .filter((g) => g.memberIds.includes(req.user.id))
    .map((g) => groupDto(g, req.user))
    .sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
  res.json({ groups: list });
});

app.post('/api/groups', auth, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  const course = courseById(req.body && req.body.courseId);
  const description = String((req.body && req.body.description) || '').trim().slice(0, 300);
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Group name must be 2 to 60 characters' });
  if (!course) return res.status(400).json({ error: 'Choose a course' });
  const g = {
    id: nextId('g'), name, kind: 'study', courseId: course.id, description,
    ownerId: req.user.id, memberIds: [req.user.id], memberCount: null,
    joinCode: genCode(course.short), createdAt: new Date().toISOString(),
    lastRead: {}, ai: {},
  };
  groups.push(g);
  res.status(201).json(groupDto(g, req.user));
});

app.post('/api/groups/join', auth, (req, res) => {
  const code = String((req.body && req.body.code) || '').trim().toUpperCase();
  const g = groups.find((x) => x.joinCode === code);
  if (!code || !g) return res.status(404).json({ error: 'No group found for this code' });
  if (!g.memberIds.includes(req.user.id)) g.memberIds.push(req.user.id);
  res.json(groupDto(g, req.user));
});

app.get('/api/groups/:id', auth, loadGroup, (req, res) => res.json(groupDto(req.group, req.user)));

// ---- messages
app.get('/api/groups/:id/messages', auth, loadGroup, (req, res) => {
  req.group.lastRead[req.user.id] = new Date().toISOString();
  res.json({ messages: messagesOf(req.group.id).map((m) => messageDto(m, req.user)) });
});

app.post('/api/groups/:id/messages', auth, loadGroup, (req, res) => {
  const text = String((req.body && req.body.text) || '').trim();
  if (!text) return res.status(400).json({ error: 'Message is empty' });
  if (text.length > 2000) return res.status(400).json({ error: 'Message is too long' });
  const m = { id: nextId('m'), groupId: req.group.id, senderId: req.user.id, text, createdAt: new Date().toISOString(), pinned: false };
  messages.push(m);
  req.group.lastRead[req.user.id] = m.createdAt;
  res.status(201).json(messageDto(m, req.user));
});

function loadMessage(req, res, next) {
  const m = messages.find((x) => x.id === req.params.mid && x.groupId === req.group.id);
  if (!m) return res.status(404).json({ error: 'Message not found' });
  req.msg = m;
  next();
}

app.post('/api/groups/:id/messages/:mid/pin', auth, loadGroup, loadMessage, (req, res) => {
  req.msg.pinned = !req.msg.pinned;
  res.json({ pinned: req.msg.pinned });
});

app.delete('/api/groups/:id/messages/:mid', auth, loadGroup, loadMessage, (req, res) => {
  if (req.msg.senderId !== req.user.id && req.group.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own messages' });
  }
  messages.splice(messages.indexOf(req.msg), 1);
  res.json({ ok: true });
});

app.post('/api/groups/:id/messages/:mid/report', auth, loadGroup, loadMessage, (req, res) => {
  reports.push({ messageId: req.msg.id, reporterId: req.user.id, at: new Date().toISOString() });
  res.json({ ok: true });
});

// ---- members
app.get('/api/groups/:id/members', auth, loadGroup, (req, res) => {
  const g = req.group;
  res.json({
    memberCount: memberCountOf(g),
    joinCode: g.kind === 'study' ? g.joinCode : null,
    isOwner: g.ownerId === req.user.id,
    members: g.memberIds.map((id) => ({
      id,
      name: users[id].name,
      role: users[id].role,
      isOwner: g.ownerId === id,
      isMe: id === req.user.id,
    })),
  });
});

app.delete('/api/groups/:id/members/:uid', auth, loadGroup, (req, res) => {
  const g = req.group;
  if (g.kind !== 'study') return res.status(400).json({ error: 'Course groups are managed by enrollment' });
  if (g.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can remove members' });
  if (req.params.uid === req.user.id) return res.status(400).json({ error: 'Use "Leave group" instead' });
  if (!g.memberIds.includes(req.params.uid)) return res.status(404).json({ error: 'Member not found' });
  g.memberIds = g.memberIds.filter((id) => id !== req.params.uid);
  res.json({ ok: true });
});

app.post('/api/groups/:id/leave', auth, loadGroup, (req, res) => {
  const g = req.group;
  if (g.kind !== 'study') return res.status(400).json({ error: 'You cannot leave a course group' });
  g.memberIds = g.memberIds.filter((id) => id !== req.user.id);
  if (g.memberIds.length === 0) {
    groups.splice(groups.indexOf(g), 1);
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].groupId === g.id) messages.splice(i, 1);
  } else if (g.ownerId === req.user.id) {
    g.ownerId = g.memberIds[0];
  }
  res.json({ ok: true });
});

app.post('/api/groups/:id/code', auth, loadGroup, (req, res) => {
  const g = req.group;
  if (g.kind !== 'study') return res.status(400).json({ error: 'Course groups have no join code' });
  if (g.ownerId !== req.user.id) return res.status(403).json({ error: 'Only the owner can change the code' });
  g.joinCode = genCode(courseById(g.courseId).short);
  res.json({ joinCode: g.joinCode });
});

// ---- AI help (heuristic stand-in for the real RAG service)
const UNSURE = ['not sure', 'maybe', 'i think', 'perhaps', 'مش متأكد', 'ممكن', 'اعتقد', 'أعتقد'];
const isQuestion = (t) => /[?؟]\s*$/.test(t.trim());

app.get('/api/groups/:id/ai-help', auth, loadGroup, (req, res) => {
  const g = req.group;
  const msgs = messagesOf(g.id);

  const unanswered = [];
  msgs.forEach((m, i) => {
    if (!isQuestion(m.text)) return;
    const answered = msgs.slice(i + 1).some(
      (x) => x.senderId !== m.senderId && !isQuestion(x.text) && !UNSURE.some((w) => x.text.toLowerCase().includes(w)),
    );
    if (!answered) unanswered.push(m.text);
  });

  const all = msgs.map((m) => m.text.toLowerCase()).join(' ');
  const mats = materials[g.courseId] || [];
  let picks = mats.filter((m) => m.kw.some((k) => all.includes(k)));
  if (!picks.length) picks = mats.slice(0, 2);

  let summary = g.ai.summary;
  if (!summary) {
    summary = msgs.length
      ? `${msgs.length} messages from ${new Set(msgs.map((m) => m.senderId)).size} member(s). Latest: "${msgs[msgs.length - 1].text.slice(0, 80)}"`
      : 'No messages yet.';
  }

  res.json({
    summary,
    unanswered,
    suggested: picks.slice(0, 3).map((m) => m.title),
    flashcards: g.ai.flashcards || [],
    generatedBy: 'demo-heuristic',
  });
});

// ------------------------------------------------------------ error handling
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Study Hub API running on port ${PORT}`);
    console.log('Use one of these addresses in the phone app (same Wi-Fi):');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const n of nets[name]) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  http://${n.address}:${PORT}`);
      }
    }
    console.log('  Android emulator: http://10.0.2.2:' + PORT);
  });
}

module.exports = app;
