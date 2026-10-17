// Smoke test: node test.js   (starts the app on a random port, no extra deps)
const assert = require('assert');
const app = require('./server');

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, path, body, user = 'u1') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer demo-${user}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, json: await r.json() };
  };
  try {
    let r = await fetch(base + '/health');
    assert.equal(r.status, 200);

    r = await call('GET', '/groups', null, 'bad');
    assert.equal(r.status, 401);

    r = await call('GET', '/groups');
    assert.equal(r.status, 200);
    const [a, b, c] = r.json.groups;
    assert.deepEqual([a.name, b.name, c.name], ['Normalization study group', 'Databases · Section A', 'Operating Systems · Section B']);
    assert.deepEqual([a.unread, b.unread, c.unread], [3, 2, 0]);
    assert.equal(a.memberCount, 3);
    assert.equal(b.memberCount, 214);

    r = await call('GET', '/groups/g1/messages');
    assert.equal(r.json.messages.length, 5);
    r = await call('GET', '/groups');
    assert.equal(r.json.groups[0].unread, 0, 'opening chat marks it read');

    r = await call('POST', '/groups/g1/messages', { text: '  Thanks!  ' });
    assert.equal(r.status, 201);
    assert.equal(r.json.text, 'Thanks!');
    const mid = r.json.id;
    r = await call('POST', '/groups/g1/messages', { text: '   ' });
    assert.equal(r.status, 400);

    r = await call('POST', `/groups/g1/messages/${mid}/pin`);
    assert.equal(r.json.pinned, true);
    r = await call('POST', `/groups/g1/messages/${mid}/report`, null, 'u2');
    assert.equal(r.status, 200);
    r = await call('DELETE', `/groups/g1/messages/${mid}`, null, 'u2');
    assert.equal(r.status, 403, 'non-owner cannot delete others messages');
    r = await call('DELETE', `/groups/g1/messages/${mid}`);
    assert.equal(r.status, 200);

    r = await call('GET', '/groups/g1/ai-help');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.unanswered, [
      'Can someone explain BCNF?',
      'What is the difference between a candidate key and a primary key?',
    ]);
    assert.deepEqual(r.json.suggested, ['Lecture 4 · p. 15', 'Lecture 4 · p. 18']);
    assert.equal(r.json.flashcards.length, 2);

    r = await call('GET', '/groups/g1/members');
    assert.equal(r.json.joinCode, 'DB-7K2Q');
    assert.equal(r.json.isOwner, true);
    r = await call('DELETE', '/groups/g1/members/u3', null, 'u2');
    assert.equal(r.status, 403);
    r = await call('POST', '/groups/g1/code');
    assert.match(r.json.joinCode, /^DB-[A-Z0-9]{4}$/);

    r = await call('POST', '/groups', { name: 'OS revision', courseId: 'c2', description: 'x' });
    assert.equal(r.status, 201);
    const newId = r.json.id;
    r = await call('GET', `/groups/${newId}/members`);
    const code = r.json.joinCode;
    assert.match(code, /^OS-/);
    r = await call('POST', '/groups', { name: 'x', courseId: 'c2' });
    assert.equal(r.status, 400);
    r = await call('GET', `/groups/${newId}`, null, 'u2');
    assert.equal(r.status, 403);
    r = await call('POST', '/groups/join', { code: code.toLowerCase() }, 'u2');
    assert.equal(r.status, 200);
    r = await call('POST', '/groups/join', { code: 'NOPE-0000' }, 'u2');
    assert.equal(r.status, 404);
    r = await call('DELETE', `/groups/${newId}/members/u2`);
    assert.equal(r.status, 200);
    r = await call('POST', `/groups/${newId}/leave`);
    assert.equal(r.status, 200);

    r = await call('POST', '/groups/g2/leave');
    assert.equal(r.status, 400);
    r = await call('GET', '/courses');
    assert.equal(r.json.courses.length, 3);

    console.log('All API checks passed');
    server.close();
  } catch (e) {
    console.error('FAILED:', e);
    server.close();
    process.exit(1);
  }
});
