// Lightweight rule-based English lemmatizer.
// Purpose: a good-enough base form for deduplicating vocabulary entries and counting lookups.
// Gemini enrichment later returns the authoritative lemma and entries are merged if they differ.

const IRREGULAR = {
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have', does: 'do', did: 'do', done: 'do',
  went: 'go', gone: 'go', goes: 'go', made: 'make', said: 'say', took: 'take', taken: 'take',
  came: 'come', saw: 'see', seen: 'see', knew: 'know', known: 'know', got: 'get', gotten: 'get',
  gave: 'give', given: 'give', found: 'find', thought: 'think', told: 'tell', became: 'become',
  felt: 'feel', brought: 'bring', began: 'begin', begun: 'begin', kept: 'keep', held: 'hold',
  wrote: 'write', written: 'write', stood: 'stand', heard: 'hear', meant: 'mean', met: 'meet',
  ran: 'run', paid: 'pay', sat: 'sit', spoke: 'speak', spoken: 'speak', led: 'lead', grew: 'grow',
  grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall', sent: 'send', built: 'build',
  understood: 'understand', drew: 'draw', drawn: 'draw', broke: 'break', broken: 'break',
  spent: 'spend', rose: 'rise', risen: 'rise', drove: 'drive', driven: 'drive', bought: 'buy',
  wore: 'wear', worn: 'wear', chose: 'choose', chosen: 'choose', sought: 'seek', threw: 'throw',
  thrown: 'throw', caught: 'catch', dealt: 'deal', won: 'win', forgot: 'forget', forgotten: 'forget',
  laid: 'lay', fought: 'fight', struck: 'strike', flew: 'fly', flown: 'fly', sold: 'sell',
  taught: 'teach', shook: 'shake', shaken: 'shake', hid: 'hide', hidden: 'hide', bent: 'bend',
  bitten: 'bite', blew: 'blow', blown: 'blow', bred: 'breed', bled: 'bleed', crept: 'creep',
  dug: 'dig', dreamt: 'dream', fled: 'flee', froze: 'freeze', frozen: 'freeze', hung: 'hang',
  knelt: 'kneel', lent: 'lend', lit: 'light', rode: 'ride', ridden: 'ride', rang: 'ring',
  rung: 'ring', sang: 'sing', sung: 'sing', sank: 'sink', sunk: 'sink', slept: 'sleep',
  slid: 'slide', spun: 'spin', stole: 'steal', stolen: 'steal', stuck: 'stick', stung: 'sting',
  swore: 'swear', sworn: 'swear', swept: 'sweep', swam: 'swim', swum: 'swim', swung: 'swing',
  tore: 'tear', torn: 'tear', woke: 'wake', woken: 'wake', wept: 'weep', withdrew: 'withdraw',
  withdrawn: 'withdraw', arose: 'arise', arisen: 'arise', awoke: 'awake', shot: 'shoot',
  shone: 'shine', sped: 'speed', sprang: 'spring', sprung: 'spring', strove: 'strive', bore: 'bear',
  borne: 'bear', forbade: 'forbid', forbidden: 'forbid', forgave: 'forgive', forgiven: 'forgive',
  overcame: 'overcome', undertook: 'undertake', undertaken: 'undertake', upheld: 'uphold',
  clung: 'cling', leapt: 'leap', lain: 'lie', mistook: 'mistake', mistaken: 'mistake',
  overtook: 'overtake', overtaken: 'overtake', sewn: 'sew', shrank: 'shrink', shrunk: 'shrink',
  slain: 'slay', slew: 'slay', spat: 'spit', spilt: 'spill', spoilt: 'spoil', stank: 'stink',
  stunk: 'stink', strewn: 'strew', strode: 'stride', swollen: 'swell', trod: 'tread',
  trodden: 'tread', underwent: 'undergo', undergone: 'undergo', wrung: 'wring', foresaw: 'foresee',
  foreseen: 'foresee', overthrew: 'overthrow', overthrown: 'overthrow', withheld: 'withhold',
  withstood: 'withstand', outdid: 'outdo', outdone: 'outdo', beaten: 'beat', bidden: 'bid',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  geese: 'goose', wives: 'wife', knives: 'knife', halves: 'half', wolves: 'wolf', shelves: 'shelf',
  selves: 'self', thieves: 'thief', loaves: 'loaf', calves: 'calf', scarves: 'scarf', elves: 'elf',
  hooves: 'hoof', crises: 'crisis', analyses: 'analysis', theses: 'thesis', hypotheses: 'hypothesis',
  diagnoses: 'diagnosis', oases: 'oasis', emphases: 'emphasis', parentheses: 'parenthesis',
  synopses: 'synopsis', neuroses: 'neurosis', prognoses: 'prognosis', syntheses: 'synthesis',
  phenomena: 'phenomenon', criteria: 'criterion', indices: 'index', matrices: 'matrix',
  appendices: 'appendix', oxen: 'ox', quizzes: 'quiz', curricula: 'curriculum', stimuli: 'stimulus',
  alumni: 'alumnus', fungi: 'fungus', nuclei: 'nucleus', cacti: 'cactus', axes: 'axis',
  bases: 'base', ellipses: 'ellipse', leaves: 'leave', lives: 'live',
};

// Words ending in "s" that are neither plurals nor 3rd-person verb forms.
const NOT_PLURAL = new Set([
  'news', 'lens', 'gas', 'means', 'series', 'species', 'alias', 'canvas', 'atlas', 'bias', 'chaos',
  'cosmos', 'kudos', 'pathos', 'ethos', 'plus', 'minus', 'always', 'perhaps', 'whereas', 'yes',
  'this', 'his', 'its', 'us', 'thus', 'less', 'unless', 'towards', 'afterwards', 'sometimes',
  'besides', 'christmas', 'pancreas', 'texas', 'kansas', 'arkansas', 'vegas', 'corps', 'chess',
  'measles', 'diabetes', 'rabies', 'herpes', 'shingles', 'mumps', 'mathematics', 'physics',
  'politics', 'economics', 'statistics', 'ethics', 'genetics', 'robotics', 'athletics',
  'aesthetics', 'linguistics', 'electronics', 'logistics', 'acoustics', 'dynamics', 'mechanics',
  'optics', 'semantics', 'analytics', 'gymnastics', 'phonetics', 'thermodynamics', 'aerobics',
  'ceramics', 'classics', 'ergonomics', 'forensics', 'hydraulics', 'informatics', 'italics',
  'kinetics', 'macroeconomics', 'microeconomics', 'metaphysics', 'obstetrics', 'pediatrics',
  'pragmatics', 'geopolitics', 'geriatrics', 'heuristics', 'hysterics', 'poetics', 'semiotics',
  'tectonics', 'jeans', 'pants', 'trousers', 'scissors', 'headquarters', 'premises', 'proceeds',
  'goods', 'thanks', 'congratulations', 'outskirts', 'belongings', 'clothes', 'whereabouts',
  'aids', 'paris', 'athens', 'wales', 'naples', 'brussels', 'debris', 'ourselves', 'themselves',
  'yourselves', 'amidst', 'versus', 'bonus', 'surroundings', 'savings', 'earnings', 'proceedings',
  'innings', 'leggings', 'furnishings', 'trappings', 'tidings', 'nowadays', 'upstairs',
  'downstairs', 'overseas', 'indoors', 'outdoors', 'backwards', 'forwards', 'inwards', 'outwards',
  'onwards', 'upwards', 'downwards', 'sideways', 'anyways', 'lest', 'has', 'was', 'is',
]);

// "-us" words whose plural is "-uses" (focus -> focuses), as opposed to "-use" verbs (use -> uses).
const LATIN_US = new Set([
  'bus', 'plus', 'thus', 'minus', 'focus', 'virus', 'bonus', 'status', 'campus', 'census', 'corpus',
  'cactus', 'circus', 'genius', 'radius', 'syllabus', 'surplus', 'consensus', 'chorus', 'apparatus',
  'hiatus', 'impetus', 'nexus', 'fetus', 'octopus', 'walrus', 'citrus', 'discus', 'abacus',
  'stimulus', 'terminus', 'sinus', 'thesaurus', 'lotus', 'nucleus', 'calculus', 'exodus', 'fungus',
  'mucus', 'opus', 'papyrus', 'prospectus', 'rhombus', 'torus', 'tetanus', 'typhus', 'uterus',
  'callus', 'crocus', 'genus', 'litmus', 'lupus', 'humus', 'anus', 'asparagus', 'caucus', 'ruckus',
  'sarcophagus', 'platypus', 'hippopotamus', 'eucalyptus',
]);
// "-as"/"-os" nouns whose plural is "-es" (gas -> gases).
const AS_OS_NOUNS = new Set([
  'gas', 'bias', 'canvas', 'atlas', 'alias', 'christmas', 'pancreas', 'chaos', 'cosmos', 'kudos',
  'thermos', 'rhinoceros', 'pathos', 'ethos', 'logos', 'asbestos', 'lens', 'trellis', 'iris',
]);
// Plurals that just take "-s" after a vowel (menu -> menus, ski -> skis).
const VOWEL_PLURALS = new Set([
  'menus', 'emus', 'gnus', 'tutus', 'haikus', 'gurus', 'tofus', 'bayous', 'caribous', 'snafus',
  'hindus', 'zulus', 'kudzus', 'tabus', 'taboos', 'skis', 'taxis', 'bikinis', 'zucchinis', 'alibis',
  'safaris', 'saris', 'khakis', 'kiwis', 'chilis', 'wikis', 'sushis', 'martinis', 'salamis',
  'tsunamis', 'yetis', 'alkalis', 'graffitis',
]);
const OE_WORDS = new Set([
  'shoe', 'toe', 'foe', 'woe', 'hoe', 'canoe', 'oboe', 'aloe', 'floe', 'sloe', 'roe', 'doe', 'throe',
  'tiptoe', 'mistletoe', 'horseshoe', 'snowshoe',
]);
const CHE_WORDS = new Set([
  'ache', 'headache', 'toothache', 'backache', 'earache', 'stomachache', 'heartache', 'cache',
  'niche', 'cliche', 'quiche', 'creche', 'psyche', 'douche', 'avalanche', 'moustache', 'mustache',
  'panache', 'pastiche', 'cartouche', 'brioche', 'microfiche', 'gouache', 'attache',
]);
const IE_WORDS = new Set([
  'movie', 'cookie', 'rookie', 'zombie', 'hoodie', 'selfie', 'calorie', 'prairie', 'birdie',
  'goalie', 'bootie', 'genie', 'auntie', 'brownie', 'foodie', 'freebie', 'groupie', 'hippie',
  'junkie', 'newbie', 'pixie', 'smoothie', 'talkie', 'walkie', 'yuppie', 'eerie', 'reverie',
  'coterie', 'lingerie', 'menagerie', 'boogie', 'budgie', 'collie', 'dearie', 'doggie', 'kiddie',
  'laddie', 'lassie', 'sweetie', 'techie', 'veggie', 'wheelie', 'barbie', 'cutie', 'pinkie',
  'roomie', 'trekkie', 'prairie', 'bookie', 'caddie', 'indie', 'lorrie', 'oldie', 'quickie',
  'softie', 'toughie', 'yachtie', 'zombie',
]);

// Stems (after removing -ed/-ing) that do NOT take a silent e, overriding the default rules.
const NO_E = new Set([
  'limit', 'visit', 'edit', 'credit', 'profit', 'benefit', 'audit', 'deposit', 'inherit', 'merit',
  'prohibit', 'exhibit', 'inhibit', 'orbit', 'solicit', 'elicit', 'vomit', 'posit', 'exit', 'spirit',
  'discredit', 'revisit', 'summit', 'transit', 'accredit', 'reedit', 'pilot', 'ballot', 'pivot',
  'riot', 'parrot', 'combat', 'format', 'chat', 'bracket', 'target', 'market', 'budget', 'pocket',
  'rocket', 'ticket', 'interpret', 'carpet', 'blanket', 'trumpet', 'buffet', 'rivet', 'fidget',
  'ferret', 'closet', 'covet', 'racket', 'jacket', 'picket', 'socket', 'docket', 'junket', 'billet',
  'fillet', 'bucket', 'crochet', 'ricochet', 'orphan', 'cabin', 'gossip', 'worship', 'develop',
  'envelop', 'gallop', 'wallop', 'scallop', 'dollop', 'hiccup', 'focus', 'bias', 'canvas', 'bus',
  'gas', 'chorus', 'atlas', 'plus', 'alias', 'bonus', 'census', 'campus', 'circus', 'virus',
  'status', 'surplus', 'discus', 'trellis', 'iris', 'pencil', 'stencil', 'imperil', 'utensil',
  'peril', 'fossil', 'fuel', 'duel', 'gruel', 'cruel', 'murmur', 'sulphur', 'sulfur', 'sugar',
  'collar', 'bang', 'long', 'belong', 'hang', 'ring', 'wing', 'prong', 'twang', 'gang', 'clang',
  'throng', 'wrong', 'sing', 'ping', 'ding', 'bring', 'string', 'swing', 'sting', 'fling', 'sling',
  'cling', 'wring', 'spring', 'thing', 'king', 'boomerang', 'harangue', 'overhang', 'ramen',
  'bottom', 'blossom', 'accustom', 'ransom', 'fathom', 'custom', 'phantom', 'venom', 'random',
  'vacuum', 'album',
]);

// Stems (after removing -ed/-ing) that DO take a silent e, overriding the default rules.
const FORCE_E = new Set([
  'compete', 'complete', 'delete', 'deplete', 'secrete', 'excrete', 'obsolete', 'concrete',
  'replete', 'accrete', 'discrete', 'revere', 'adhere', 'cohere', 'persevere', 'interfere',
  'premiere', 'convene', 'intervene', 'contravene', 'reconvene', 'supervene', 'condone', 'postpone',
  'atone', 'telephone', 'dethrone', 'intone', 'enthrone', 'chaperone', 'profane', 'explore',
  'ignore', 'restore', 'adore', 'deplore', 'implore', 'underscore', 'outscore', 'impale', 'exhale',
  'inhale', 'regale', 'upscale', 'downscale', 'console', 'cajole', 'parole', 'condole', 'welcome',
  'become', 'overcome', 'bathe', 'breathe', 'loathe', 'soothe', 'seethe', 'writhe', 'clothe',
  'teethe', 'lathe', 'scathe', 'sheathe', 'wreathe', 'tithe', 'create', 'recreate', 'procreate',
  'escape', 'reshape', 'landscape', 'videotape', 'elope', 'telescope', 'unite', 'invite', 'excite',
  'ignite', 'recite', 'incite', 'cite', 'expedite', 'extradite', 'reunite', 'requite', 'license',
  'sense', 'cleanse', 'rinse', 'condense', 'dispense', 'incense', 'commence', 'fence', 'sentence',
  'reference', 'influence', 'experience', 'evidence', 'silence', 'sequence', 'convince', 'evince',
  'wince', 'mince', 'dance', 'glance', 'advance', 'enhance', 'finance', 'balance', 'announce',
  'pronounce', 'denounce', 'renounce', 'bounce', 'pounce', 'trounce', 'flounce', 'lapse',
  'collapse', 'elapse', 'relapse', 'eclipse', 'glimpse', 'browse', 'pulse', 'convulse', 'repulse',
  'nurse', 'curse', 'reverse', 'traverse', 'converse', 'disperse', 'immerse', 'submerse',
  'rehearse', 'coerce', 'pierce', 'force', 'enforce', 'reinforce', 'divorce', 'source', 'outsource',
  'endorse', 'parse', 'axe', 'owe', 'eye', 'sue', 'cue', 'rue', 'hue', 'due', 'tie', 'die', 'lie',
  'vie', 'free', 'agree', 'decree', 'guarantee', 'referee', 'puree', 'flee', 'see', 'pee', 'tee',
  'ski', 'taxi',
]);

// Words ending in -ing that are not -ing forms of a shorter verb.
const NOT_ING = new Set([
  'thing', 'nothing', 'something', 'anything', 'everything', 'during', 'morning', 'evening',
  'ceiling', 'sibling', 'darling', 'duckling', 'dumpling', 'herring', 'earring', 'pudding',
  'cunning', 'king', 'ring', 'sing', 'bring', 'spring', 'string', 'wing', 'swing', 'sting', 'cling',
  'fling', 'sling', 'ding', 'ping', 'zing', 'bling', 'wring', 'lightning', 'offspring',
  'thanksgiving', 'viking', 'awning', 'farthing', 'inkling', 'shilling', 'sterling', 'starling',
  'gosling', 'fledgling', 'underling', 'nestling', 'seedling', 'sapling', 'yearling', 'weakling',
  'foundling', 'changeling', 'hireling', 'stripling', 'suckling', 'quisling', 'bunting', 'gelding',
  'wellbeing', 'notwithstanding', 'boring', 'amazing', 'interesting', 'willing', 'unwilling',
  'outstanding', 'ongoing', 'forthcoming', 'upcoming', 'everlasting', 'longstanding', 'cunning',
  'during', 'wedding', 'evening', 'ceiling', 'stocking', 'dwelling', 'plumbing', 'mooring',
  'bedding', 'padding', 'shindig', 'ring', 'thing', 'doping',
]);

// Base words whose final doubled consonant is part of the word (add -> added, not "ad").
const KEEP_DOUBLE = new Set([
  'add', 'egg', 'inn', 'ebb', 'err', 'purr', 'whirr', 'putt', 'butt', 'boycott', 'mitt', 'watt',
  'odd', 'buzz', 'fizz', 'jazz', 'fuzz', 'whizz', 'frizz',
]);

// British "-ll-" doubling: travelled -> travel, controlled -> control.
const BRITISH_LL = new Set([
  'control', 'travel', 'cancel', 'label', 'compel', 'expel', 'dispel', 'propel', 'repel', 'excel',
  'rebel', 'patrol', 'enrol', 'extol', 'fulfil', 'instil', 'distil', 'appal', 'marvel', 'model',
  'level', 'fuel', 'quarrel', 'signal', 'total', 'equal', 'rival', 'channel', 'counsel', 'pencil',
  'tunnel', 'funnel', 'panel', 'shovel', 'grovel', 'snivel', 'drivel', 'libel', 'dial', 'spiral',
  'initial', 'cavil', 'pedal', 'medal', 'petal', 'revel', 'jewel', 'bevel', 'duel', 'gravel',
  'chisel', 'swivel', 'snorkel', 'yodel', 'stencil', 'imperil', 'carol', 'gambol', 'symbol',
  'impel', 'annul', 'unravel', 'ravel', 'parcel', 'tinsel', 'kennel', 'tassel', 'trowel', 'towel',
  'bowel', 'vowel', 'cudgel', 'squirrel', 'barrel', 'sorrel', 'apparel', 'laurel', 'compel',
  'rebel', 'refuel', 'remodel', 'relabel', 'tunnel', 'shrivel', 'grovel', 'teasel', 'weasel',
]);

// Base words ending in "-eed" (need -> needed) versus "-ee" + d (agree -> agreed).
const EED_WORDS = new Set([
  'need', 'seed', 'feed', 'bleed', 'breed', 'speed', 'weed', 'deed', 'greed', 'creed', 'heed', 'reed',
  'steed', 'tweed', 'exceed', 'succeed', 'proceed', 'indeed', 'misdeed', 'nosebleed', 'birdseed',
  'linseed', 'rapeseed',
]);

// Two-letter stems after removing -ed/-ing.
const TWO_LETTER = {
  us: 'use', ag: 'age', ic: 'ice', ow: 'owe', ey: 'eye', ac: 'ace', ap: 'ape', ax: 'axe', su: 'sue',
  du: 'due', cu: 'cue', hu: 'hue', ru: 'rue', go: 'go', do: 'do', be: 'be', ko: 'ko', sk: 'ski',
  aw: 'awe', ir: 'ire', ok: 'ok', op: 'ope', ic: 'ice',
};

const VOWELS = 'aeiou';
const isVowel = (c) => VOWELS.includes(c);
const isConsonant = (c) => /[a-z]/.test(c) && !isVowel(c);

// Endings of polysyllabic c-v-c stems that normally do NOT take a silent e
// (open, offer, honor, level, signal, control, happen, market, bottom).
const NO_E_TAILS = new Set(['en', 'er', 'or', 'el', 'al', 'ol', 'on', 'et', 'om']);

function vowelClusters(word) {
  let n = 0;
  let inVowel = false;
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    const v = isVowel(c) || (c === 'y' && i > 0);
    if (v && !inVowel) n++;
    inVowel = v;
  }
  return n;
}

function endsWithCvc(stem) {
  if (stem.length < 3) return false;
  const a = stem[stem.length - 3];
  const b = stem[stem.length - 2];
  const c = stem[stem.length - 1];
  return isConsonant(a) && isVowel(b) && isConsonant(c) && !'wxy'.includes(c);
}

// Restore the base form of a stem that had -ed / -ing removed. Returns null when unsure.
function restoreStem(stem) {
  if (stem.length < 2) return null;
  if (stem.length === 2) {
    if (TWO_LETTER[stem]) return TWO_LETTER[stem];
    return isVowel(stem[1]) ? stem : null;
  }
  if (NO_E.has(stem)) return stem;
  if (FORCE_E.has(stem + 'e')) return stem + 'e';

  const last = stem[stem.length - 1];
  const prev = stem[stem.length - 2];

  // Doubled final consonant: planned -> plan, running -> run.
  if (last === prev && isConsonant(last)) {
    if (KEEP_DOUBLE.has(stem)) return stem;
    if (last === 'l') return BRITISH_LL.has(stem.slice(0, -1)) ? stem.slice(0, -1) : stem;
    if ('sfz'.includes(last)) return stem;
    return stem.slice(0, -1);
  }

  if (last === 'u') return stem + 'e'; // argue, continue, value, rescue
  if ('ei'.includes(last)) return stem; // agree, ski, taxi
  if (last === 'l' && isConsonant(prev) && !'rlw'.includes(prev)) return stem + 'e'; // struggle, handle, settle
  if (stem.endsWith('uir')) return stem + 'e'; // require, acquire, inquire
  if ('cvz'.includes(last)) return stem + 'e';
  if (last === 'g') return stem + 'e';
  if (last === 's') return prev === 's' ? stem : stem + 'e';
  if (stem.endsWith('th') || stem.endsWith('sh') || stem.endsWith('ch') || stem.endsWith('ck') || stem.endsWith('ph')) return stem;
  if ('wxy'.includes(last)) return stem;

  if (endsWithCvc(stem)) {
    if (vowelClusters(stem) === 1) return stem + 'e'; // hope, move, name, vote
    return NO_E_TAILS.has(stem.slice(-2)) ? stem : stem + 'e'; // open / provide
  }
  return stem;
}

function stripPlural(word) {
  if (word.length <= 3) return word;
  if (NOT_PLURAL.has(word)) return word;
  if (VOWEL_PLURALS.has(word)) return word.slice(0, -1);
  if (word.endsWith('ss') || word.endsWith('us') || word.endsWith('is')) return word;

  if (word.endsWith('ies')) {
    if (word.length === 4) return word.slice(0, -1); // lies, ties
    const ie = word.slice(0, -1);
    return IE_WORDS.has(ie) ? ie : word.slice(0, -3) + 'y';
  }
  if (word.endsWith('oes')) {
    const oe = word.slice(0, -1);
    return OE_WORDS.has(oe) ? oe : word.slice(0, -2);
  }
  if (word.endsWith('sses') || word.endsWith('xes') || word.endsWith('zzes')) return word.slice(0, -2);
  if (word.endsWith('zes')) return word.slice(0, -1);
  if (word.endsWith('ches') || word.endsWith('shes')) {
    const e = word.slice(0, -1);
    return CHE_WORDS.has(e) ? e : word.slice(0, -2);
  }
  if (word.endsWith('ses')) {
    const stem = word.slice(0, -2); // focus / cas / hous
    if (LATIN_US.has(stem) || AS_OS_NOUNS.has(stem)) return stem;
    return word.slice(0, -1); // case, house, use
  }
  if (word.endsWith('ues') && !word.endsWith('gues') && !word.endsWith('ques')) return word.slice(0, -1);
  if (word.endsWith('ues')) return word.slice(0, -1); // leagues, cheques
  return word.slice(0, -1);
}

export function lemmatize(input) {
  if (!input) return '';
  let word = String(input).trim().toLowerCase().replace(/[’']s$/, '').replace(/[’']$/, '');
  if (!/^[a-z][a-z'-]*$/.test(word)) return word;
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (word.length <= 2) return word;

  if (word.endsWith('ing') && word.length > 4 && !NOT_ING.has(word)) {
    const stem = word.slice(0, -3);
    if (stem.length === 2 && stem.endsWith('y')) return stem[0] + 'ie'; // lying, dying, tying
    if (stem.endsWith('y')) return stem; // studying, playing
    const base = restoreStem(stem);
    if (base) return base;
  }

  if (word.endsWith('ed') && word.length > 3) {
    if (word.endsWith('ied')) return word.length === 4 ? word.slice(0, -1) : word.slice(0, -3) + 'y';
    if (word.endsWith('eed')) return EED_WORDS.has(word) ? word : word.slice(0, -1);
    const base = restoreStem(word.slice(0, -2));
    if (base) return base;
  }

  if (word.endsWith('s')) return stripPlural(word);
  return word;
}

export default lemmatize;
