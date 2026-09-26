import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT_TYPES, buildProjectDraft, getProjectGuidance} from '../project-builder.js';

test('each template keeps supplied facts in field order without inventing missing sections', () => {
  for (const type of PROJECT_TYPES) {
    const answers = Object.fromEntries(type.fields.map((field, index) => [field.id, `Own note ${index}: 42 cans, £0 raised so far.\nNo result has been confirmed.`]));
    const draft = buildProjectDraft(type.id, answers);
    let lastIndex = -1;
    for (const value of Object.values(answers)) {
      const index = draft.text.indexOf(value);
      assert.ok(index > lastIndex, `${type.id} preserves notes in order`);
      lastIndex = index;
    }
    assert.ok(!draft.text.includes('undefined'));
  }
  const science = buildProjectDraft('science', {findings: 'The three window plants were taller. Exact heights were not recorded.'});
  assert.equal(science.text, 'Here is what I observed.\nThe three window plants were taller. Exact heights were not recorded.');
  assert.ok(!science.text.includes('prediction'));
});

test('blank forms produce no script, and partial answers omit blank prompts', () => {
  for (const {id} of PROJECT_TYPES) assert.equal(buildProjectDraft(id, {}).text, '');
  for (const type of PROJECT_TYPES) {
    assert.ok(type.fields[0].required, 'The topic or title is required in the form');
    assert.ok(type.fields.slice(1).some(field => field.required), 'At least one answer beyond the topic is required');
  }
  assert.equal(buildProjectDraft('book', {book: '  ', highlight: '\n'}).text, '');
  const draft = buildProjectDraft('persuade', {reason2: 'Please bring clean, empty cans on Friday'});
  assert.equal(draft.text, 'One reason is:\nPlease bring clean, empty cans on Friday.');
  assert.ok(!draft.text.includes('Another'));
});

test('punctuation, Unicode, formatting and newlines survive, and long titles do not truncate script notes', () => {
  const topic = '🌱'.repeat(100);
  const draft = buildProjectDraft('explain', {topic, opening: 'One **checked** point.\r\n\r\nA second ==point==!'});
  assert.ok(draft.text.includes(topic));
  assert.ok(draft.text.includes('One **checked** point.\n\nA second ==point==!'));
  assert.ok([...draft.title].length <= 90);
  assert.ok(!draft.title.includes('\uFFFD'));
  assert.equal(buildProjectDraft('book', {summary: 'The character asked, “Why?”'}).text, 'Here is a little about the book.\nThe character asked, “Why?”');
});

test('invalid and excessive answers fail visibly rather than silently losing the writer’s notes', () => {
  assert.throws(() => buildProjectDraft('unknown', {}), /project type/);
  assert.throws(() => buildProjectDraft('science', null), /object/);
  assert.throws(() => buildProjectDraft('science', {findings: 42}), /text/);
  assert.throws(() => buildProjectDraft('science', {findings: 'x'.repeat(50001)}), /too long/);
  const answers = Object.fromEntries(PROJECT_TYPES[1].fields.map(({id}) => [id, 'x'.repeat(50000)]));
  assert.throws(() => buildProjectDraft('science', answers), /too long/);
});

test('guidance estimates actual entered words and flags meaningful timing or clarity issues', () => {
  const guidance = getProjectGuidance(('**hello** ==world==.\n').repeat(65), 60, 130);
  assert.equal(guidance.wordCount, 130);
  assert.equal(guidance.estimatedSeconds, 60);
  assert.equal(guidance.targetWords, 130);
  assert.equal(guidance.differenceWords, 0);
  assert.match(guidance.tips[0].message, /close to the target/);
  const long = getProjectGuidance('word '.repeat(160), 60, 130);
  assert.match(long.tips[0].message, /cut about 30 words/);
  assert.equal(long.tips[1].kind, 'clarity');
  assert.match(getProjectGuidance('Two words.', 120, 130).tips[0].message, /room for about 258/);
  assert.deepEqual(getProjectGuidance('').tips.map(tip => tip.kind), ['start']);
  const unlimited = getProjectGuidance('A short talk.', 0, 130);
  assert.equal(unlimited.targetWords, null);
  assert.equal(unlimited.differenceWords, null);
  assert.ok(unlimited.estimatedSeconds > 0);
  assert.ok(!unlimited.tips.some(tip => tip.kind === 'timing'));
  assert.deepEqual(unlimited.tips.map(tip => tip.kind), ['delivery', 'rehearsal']);
  for (const target of [NaN, Infinity, -1, 0.5, 3601]) assert.throws(() => getProjectGuidance('Hi', target), /target/);
  assert.throws(() => getProjectGuidance('Hi', 120, 0), /pace/);
});
