import { lemmatize } from '../extension/background/lemmatizer.js';

const cases = {
  // -ed
  sustained: 'sustain', hoped: 'hope', stopped: 'stop', played: 'play', moved: 'move', used: 'use',
  created: 'create', opened: 'open', visited: 'visit', developed: 'develop', happened: 'happen',
  provided: 'provide', decided: 'decide', included: 'include', produced: 'produce', required: 'require',
  changed: 'change', judged: 'judge', banged: 'bang', determined: 'determine', examined: 'examine',
  signed: 'sign', joined: 'join', called: 'call', travelled: 'travel', controlled: 'control',
  filled: 'fill', added: 'add', passed: 'pass', watched: 'watch', kicked: 'kick', boxed: 'box',
  showed: 'show', bathed: 'bathe', argued: 'argue', continued: 'continue', sized: 'size',
  focused: 'focus', caused: 'cause', promised: 'promise', licensed: 'license', processed: 'process',
  welcomed: 'welcome', limited: 'limit', united: 'unite', marketed: 'market', competed: 'compete',
  voted: 'vote', promoted: 'promote', piloted: 'pilot', located: 'locate', computed: 'compute',
  escaped: 'escape', baked: 'bake', looked: 'look', named: 'name', claimed: 'claim', assumed: 'assume',
  prepared: 'prepare', compared: 'compare', honored: 'honor', explored: 'explore', delivered: 'deliver',
  scheduled: 'schedule', reconciled: 'reconcile', pencilled: 'pencil', agreed: 'agree', needed: 'need',
  freed: 'free', succeeded: 'succeed', shed: 'shed', tried: 'try', died: 'die', studied: 'study',
  triggered: 'trigger', struggled: 'struggle', remained: 'remain', declined: 'decline',
  announced: 'announce', increased: 'increase', measured: 'measure', ensured: 'ensure',
  featured: 'feature', urged: 'urge', emerged: 'emerge', described: 'describe', invaded: 'invade',
  eroded: 'erode', curbed: 'curb', warned: 'warn', surged: 'surge', plunged: 'plunge', eased: 'ease',
  fueled: 'fuel', mentioned: 'mention', questioned: 'question', threatened: 'threaten',
  strengthened: 'strengthen', sued: 'sue', owed: 'owe', eyed: 'eye', suited: 'suit',
  recruited: 'recruit', treated: 'treat', heated: 'heat', repeated: 'repeat', defeated: 'defeat',
  // -ing
  running: 'run', sustaining: 'sustain', making: 'make', hoping: 'hope', hopping: 'hop', lying: 'lie',
  dying: 'die', studying: 'study', playing: 'play', seeing: 'see', going: 'go', doing: 'do',
  being: 'be', using: 'use', aging: 'age', agreeing: 'agree', skiing: 'ski', writing: 'write',
  beginning: 'begin', bringing: 'bring', thing: 'thing', nothing: 'nothing', morning: 'morning',
  building: 'build', meeting: 'meet', shopping: 'shop', wedding: 'wedding', spring: 'spring',
  swimming: 'swim', arguing: 'argue', canoeing: 'canoe', dyeing: 'dye', suing: 'sue',
  becoming: 'become', overcoming: 'overcome', welcoming: 'welcome', focusing: 'focus',
  // plurals / 3sg
  cities: 'city', movies: 'movie', lies: 'lie', series: 'series', species: 'species', heroes: 'hero',
  shoes: 'shoe', goes: 'go', does: 'do', boxes: 'box', taxes: 'tax', sizes: 'size', quizzes: 'quiz',
  buzzes: 'buzz', watches: 'watch', aches: 'ache', wishes: 'wish', focuses: 'focus', houses: 'house',
  uses: 'use', buses: 'bus', gases: 'gas', cases: 'case', glasses: 'glass', analyses: 'analysis',
  promises: 'promise', cheeses: 'cheese', loves: 'love', lives: 'live', leaves: 'leave',
  wolves: 'wolf', gives: 'give', names: 'name', employees: 'employee', issues: 'issue', dogs: 'dog',
  news: 'news', always: 'always', was: 'be', has: 'have', this: 'this', yes: 'yes', bus: 'bus',
  gas: 'gas', economics: 'economics', topics: 'topic', menus: 'menu', skis: 'ski', crises: 'crisis',
  leagues: 'league', values: 'value', tariffs: 'tariff', policies: 'policy', measures: 'measure',
  // irregular & possessive
  went: 'go', children: 'child', "company's": 'company', "Companies'": 'company', Went: 'go',
  // unchanged
  resilient: 'resilient', curb: 'curb', amid: 'amid', geopolitical: 'geopolitical', red: 'red',
  bed: 'bed', need: 'need', feed: 'feed', sing: 'sing', king: 'king', us: 'us', is: 'be',
  'well-known': 'well-known', focus: 'focus', bias: 'bias', tennis: 'tennis', basis: 'basis',
};

let fail = 0;
for (const [input, expected] of Object.entries(cases)) {
  const got = lemmatize(input);
  if (got !== expected) {
    fail++;
    console.log(`FAIL ${input} -> ${got} (expected ${expected})`);
  }
}
console.log(`${Object.keys(cases).length - fail}/${Object.keys(cases).length} passed`);
process.exit(fail ? 1 : 0);
