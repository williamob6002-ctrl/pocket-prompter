/**
 * Offline school-project scaffolding. This module does not invent or rewrite
 * facts: it joins the writer's own notes with short spoken transitions.
 *
 * PROJECT_TYPES supplies form labels and field IDs. Pass string field values to
 * buildProjectDraft(typeId, values). Render all returned strings as plain text.
 * Empty fields are omitted; an entirely empty form returns an empty draft.
 * Partial forms are allowed for previews. Before creating a script, the UI must
 * check that every field marked required contains text after trimming.
 * getProjectGuidance(text, targetSeconds, wpm) gives estimates, not a grade.
 */

export const PROJECT_TYPES = Object.freeze([
  {
    id: 'explain', label: 'Explain a topic', description: 'Make an idea clear, one point at a time.',
    fields: [
      {id: 'topic', label: 'What is your topic?', placeholder: 'The subject of your talk', multiline: false, required: true},
      {id: 'opening', label: 'What should your audience understand?', placeholder: 'Start with the big idea, in your own words.', multiline: true, required: true},
      {id: 'point1', label: 'Your first point or example', placeholder: 'A fact you have checked, and what it means.', multiline: true},
      {id: 'point2', label: 'Another point or example', placeholder: 'What else helps explain your topic?', multiline: true},
      {id: 'ending', label: 'What should people remember?', placeholder: 'Finish with your most important idea.', multiline: true},
    ],
  },
  {
    id: 'science', label: 'Science experiment', description: 'Tell the story of your question, method and results.',
    fields: [
      {id: 'question', label: 'What were you finding out?', placeholder: 'The question your experiment explored.', multiline: true, required: true},
      {id: 'prediction', label: 'What did you predict?', placeholder: 'What you expected, and why. Leave blank if you did not make a prediction.', multiline: true},
      {id: 'method', label: 'What did you do?', placeholder: 'Your equipment and steps. Include what you kept the same.', multiline: true},
      {id: 'findings', label: 'What did you observe or measure?', placeholder: 'Your actual results. Include numbers only if you recorded them.', multiline: true, required: true},
      {id: 'conclusion', label: 'What can you conclude?', placeholder: 'What your results suggest, and anything you are still unsure about.', multiline: true},
    ],
  },
  {
    id: 'book', label: 'Book review', description: 'Share what you read and your own response to it.',
    fields: [
      {id: 'book', label: 'Book title and author', placeholder: 'The title, followed by “by” and the author’s name.', multiline: false, required: true},
      {id: 'summary', label: 'What is the book about?', placeholder: 'Introduce the story or subject without giving away the ending.', multiline: true, required: true},
      {id: 'highlight', label: 'What stood out to you?', placeholder: 'A character, moment or idea, and why it mattered to you.', multiline: true},
      {id: 'response', label: 'What did it make you think or feel?', placeholder: 'Your own reaction. There is no need to pretend you liked it.', multiline: true},
      {id: 'recommendation', label: 'Who might enjoy it, and why?', placeholder: 'Explain who you would recommend it to, or why you would not.', multiline: true},
    ],
  },
  {
    id: 'persuade', label: 'Make your case', description: 'Support a point of view with reasons and evidence.',
    fields: [
      {id: 'opinion', label: 'What is your point of view?', placeholder: 'Say clearly what you think should happen.', multiline: true, required: true},
      {id: 'reason1', label: 'Your first reason', placeholder: 'Why do you think this?', multiline: true, required: true},
      {id: 'example', label: 'An example or evidence', placeholder: 'Use something you know or have checked. Mention your source if helpful.', multiline: true},
      {id: 'reason2', label: 'Another reason', placeholder: 'Add a different reason, or respond to another point of view.', multiline: true},
      {id: 'ending', label: 'What should your audience do or remember?', placeholder: 'Bring your argument to a clear finish.', multiline: true},
    ],
  },
].map(type => Object.freeze({...type, fields: Object.freeze(type.fields.map(Object.freeze))})));

const MAX_FIELD_LENGTH = 50000;
const MAX_DRAFT_LENGTH = 200000;
const fallbackTitles = {explain: 'My topic talk', science: 'My science experiment', book: 'My book review', persuade: 'My point of view'};

function note(value) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new TypeError('Project notes must be text.');
  if (value.length > MAX_FIELD_LENGTH) throw new RangeError('One answer is too long. Keep each answer under 50,000 characters.');
  return value.replace(/\r\n?/gu, '\n').trim();
}

function sentence(value) {
  // Add punctuation without changing any of the writer's supplied words.
  return /[.!?…]["'”’)]*$/u.test(value) ? value : `${value}.`;
}

function section(transition, value) {
  return value ? `${transition}\n${sentence(value)}` : '';
}

/** @returns {{title: string, text: string}} */
export function buildProjectDraft(typeId, values = {}) {
  const type = PROJECT_TYPES.find(candidate => candidate.id === typeId);
  if (!type) throw new RangeError('Choose a project type.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new TypeError('Project answers must be an object.');
  const fields = Object.fromEntries(type.fields.map(field => [field.id, note(values[field.id])]));
  if (Object.values(fields).reduce((total, value) => total + value.length, 0) > MAX_DRAFT_LENGTH) {
    throw new RangeError('This draft is too long. Keep the combined answers under 200,000 characters.');
  }
  let paragraphs = [];
  let title = '';
  if (typeId === 'explain') {
    title = fields.topic;
    paragraphs = [
      fields.topic ? `Today, I’m going to talk about ${sentence(fields.topic)}` : '',
      section('Here is the main idea.', fields.opening),
      section('One important point is:', fields.point1),
      section(fields.point1 ? 'Another point to consider is:' : 'One important point is:', fields.point2),
      section('The main thing to remember is:', fields.ending),
    ];
  } else if (typeId === 'science') {
    title = fields.question;
    paragraphs = [
      section('My experiment started with this question:', fields.question),
      section('Before I started, this was my prediction.', fields.prediction),
      section('Here is what I did.', fields.method),
      section('Here is what I observed.', fields.findings),
      section('This is what I can conclude.', fields.conclusion),
    ];
  } else if (typeId === 'book') {
    title = fields.book;
    paragraphs = [
      fields.book ? `My book review is about ${sentence(fields.book)}` : '',
      section('Here is a little about the book.', fields.summary),
      section('This stood out to me.', fields.highlight),
      section('Here is my reaction.', fields.response),
      section('Would I recommend it?', fields.recommendation),
    ];
  } else {
    title = fields.opinion;
    paragraphs = [
      section('Here is my point of view.', fields.opinion),
      section('One reason is:', fields.reason1),
      section('Here is an example.', fields.example),
      section(fields.reason1 ? 'Another reason is:' : 'One reason is:', fields.reason2),
      section('The idea I’d like you to take away is:', fields.ending),
    ];
  }
  // Title shortening affects only the library label. The full note stays in text.
  title = title.replace(/\s+/gu, ' ').trim();
  if ([...title].length > 90) title = `${[...title].slice(0, 87).join('')}…`;
  return {title: title || fallbackTitles[typeId], text: paragraphs.filter(Boolean).join('\n\n')};
}

function countWords(text) { return (text.match(/\S+/gu) || []).length; }

/**
 * Timing assumes the supplied scrolling pace and does not measure delivery.
 * targetSeconds: 0 for no limit, or 1–3600; wpm: 40–300.
 * Tips are plain text and can contain a short excerpt of the user's own script.
 */
export function getProjectGuidance(text, targetSeconds = 120, wpm = 130) {
  if (typeof text !== 'string') throw new TypeError('The script must be text.');
  if (!Number.isFinite(targetSeconds) || targetSeconds < 0 || (targetSeconds > 0 && targetSeconds < 1) || targetSeconds > 3600) throw new RangeError('Choose no time limit, or a target between 1 second and 60 minutes.');
  if (!Number.isFinite(wpm) || wpm < 40 || wpm > 300) throw new RangeError('Choose a reading pace between 40 and 300 words per minute.');
  const plain = text.replace(/\*\*|==/gu, '').trim();
  const wordCount = countWords(plain);
  const estimatedSeconds = Math.ceil(wordCount / wpm * 60);
  const targetWords = targetSeconds ? Math.round(targetSeconds / 60 * wpm) : null;
  const differenceWords = targetWords === null ? null : wordCount - targetWords;
  const tips = [];
  if (!wordCount) {
    tips.push({kind: 'start', message: 'Add your own notes to create a draft. You can leave the optional questions blank.'});
  } else {
    const tolerance = Math.max(15, targetWords * 0.1);
    if (targetWords !== null && differenceWords > tolerance) {
      tips.push({kind: 'timing', message: `To get closer to your target at this pace, cut about ${differenceWords} words. Keep your clearest points and examples.`});
    } else if (targetWords !== null && differenceWords < -tolerance) {
      tips.push({kind: 'timing', message: `You have room for about ${-differenceWords} more words at this pace. Add a useful example if you need it; you do not have to fill the time.`});
    } else if (targetWords !== null) {
      tips.push({kind: 'timing', message: 'Your word count is close to the target at this pace. Rehearse aloud to check; pauses will change the timing.'});
    }
    const sentences = plain.split(/(?:[.!?]+["'”’)]*\s+|\n+)/u).map(value => value.trim()).filter(Boolean);
    const longSentence = sentences.find(value => countWords(value) > 30);
    if (longSentence) {
      const excerpt = [...longSentence].slice(0, 95).join('');
      tips.push({kind: 'clarity', message: `Try splitting this long sentence into two: “${excerpt}${[...longSentence].length > 95 ? '…' : ''}”`});
    } else {
      tips.push({kind: 'delivery', message: 'Read your draft aloud once. Change any phrase that does not sound like you.'});
    }
    tips.push({kind: 'rehearsal', message: 'Pause between ideas and look towards the camera. A practice take can help you choose a comfortable pace.'});
  }
  return {wordCount, estimatedSeconds, targetSeconds, wpm, targetWords, differenceWords, tips};
}
