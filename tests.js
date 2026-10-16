'use strict';
// Запуск: node tests.js  (без зависимостей)
const C = require('./script.js');
let passed = 0, failed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { failed++; console.log('FAIL:', name, '-', e.message); } }
function eq(a, b, m) { if (a !== b) throw new Error((m || '') + ' expected ' + b + ' got ' + a); }
function truthy(v, m) { if (!v) throw new Error(m || 'falsy'); }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const K = (s, r) => ({ id: s + r, suit: s, rank: r });

function invariants(s) {
  const ids = [];
  s.deck.forEach((c) => ids.push(c.id)); s.hands.player.forEach((c) => ids.push(c.id)); s.hands.ai.forEach((c) => ids.push(c.id)); s.discard.forEach((c) => ids.push(c.id));
  s.table.forEach((p) => { ids.push(p.attack.id); if (p.defense) ids.push(p.defense.id); });
  eq(ids.length, 36, 'cards count'); eq(new Set(ids).size, 36, 'unique');
}
// Пустая партия для ручных сценариев
function mk(opts) {
  const s = C.newGame({ rng: mulberry(1), mode: opts.mode });
  const all = C.createDeck();
  const used = new Set();
  const take = (arr) => arr.map((x) => { used.add(x.id); return x; });
  s.hands.player = take(opts.player); s.hands.ai = take(opts.ai);
  s.table = (opts.table || []).map((p) => ({ attack: take([p[0]])[0], defense: p[1] ? take([p[1]])[0] : null }));
  s.trump = opts.trump; s.trumpCard = opts.trumpCard || K(opts.trump, 6);
  const rest = all.filter((c) => !used.has(c.id));
  const deckN = opts.deckN || 0;
  s.deck = rest.slice(0, deckN);
  s.discard = rest.slice(deckN);
  if (s.deck.length) { s.deck[0] = s.deck[0]; s.trumpCard = s.deck[0]; s.trump = s.trumpCard.suit; }
  s.attacker = opts.attacker || 'player'; s.turn = opts.turn || 'attacker'; s.taking = !!opts.taking;
  s.defStart = opts.defStart || s.hands[C.other(s.attacker)].length;
  s.known = { player: [], ai: [] }; s.over = false; s.winner = null;
  invariants(s);
  return s;
}

t('deck 36 unique', () => { const d = C.createDeck(); eq(d.length, 36); eq(new Set(d.map((c) => c.id)).size, 36); });
t('deal 6/6, deck 24, trump bottom', () => { const s = C.newGame({ rng: mulberry(5) }); eq(s.hands.player.length, 6); eq(s.hands.ai.length, 6); eq(s.deck.length, 24); eq(s.deck[0].id, s.trumpCard.id); invariants(s); });
t('beats rules', () => {
  truthy(C.beats(K('C', 7), K('C', 9), 'S')); truthy(C.beats(K('H', 6), K('S', 6), 'S'));
  truthy(C.beats(K('S', 12), K('S', 13), 'D')); truthy(!C.beats(K('D', 14), K('C', 14), 'S'));
  truthy(C.beats(K('S', 9), K('S', 10), 'S')); truthy(!C.beats(K('S', 10), K('H', 14), 'S')); truthy(!C.beats(K('S', 10), K('S', 9), 'S'));
  truthy(!C.beats(K('H', 7), K('C', 9), 'S'));
});
t('lowest trump goes first', () => {
  for (let i = 1; i < 60; i++) {
    const s = C.newGame({ rng: mulberry(i) });
    const lo = (w) => Math.min.apply(null, s.hands[w].filter((c) => c.suit === s.trump).map((c) => c.rank).concat([99]));
    if (lo('player') < 99 || lo('ai') < 99) eq(s.attacker, lo('player') < lo('ai') ? 'player' : 'ai');
  }
});
t('attack validation: not in hand / rank / limit', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('H', 7), K('D', 8)], ai: [K('C', 6), K('C', 7), K('C', 8)], deckN: 5 });
  truthy(!C.doAttack(s, 'player', 'C6').ok, 'foreign card');
  truthy(C.doAttack(s, 'player', 'H6').ok);
  eq(s.turn, 'defender');
  truthy(!C.doAttack(s, 'player', 'H7').ok, 'not attacker turn');
});
t('throw-in only matching ranks and limit by defender hand', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('D', 6), K('H', 9), K('C', 6)], ai: [K('H', 7), K('H', 8)], deckN: 5, defStart: 2 });
  C.doAttack(s, 'player', 'H6'); C.doDefend(s, 'ai', 0, 'H7'); eq(s.turn, 'attacker');
  truthy(!C.canAttack(s, 'player', K('H', 9)).ok || !C.findCard(s.hands.player, 'H9'), 'rank 9 not on table');
  eq(C.canAttack(s, 'player', s.hands.player.find((c) => c.id === 'H9')).ok, false);
  truthy(C.doAttack(s, 'player', 'D6').ok, 'rank 6 ok');
  eq(s.table.length, 2);
  C.doDefend(s, 'ai', 1, 'H8');
  eq(C.canAttack(s, 'player', s.hands.player.find((c) => c.id === 'C6')).ok, false, 'limit 2');
});
t('cannot exceed unbeaten > defender hand', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('D', 6), K('C', 6)], ai: [K('H', 7), K('C', 8)], deckN: 5, defStart: 6 });
  C.doAttack(s, 'player', 'H6'); C.doDefend(s, 'ai', 0, 'H7'); // у ИИ осталась 1 карта
  truthy(C.doAttack(s, 'player', 'D6').ok);
  s.turn = 'attacker';
  eq(C.canAttack(s, 'player', s.hands.player.find((c) => c.id === 'C6')).ok, false, 'unbeaten would exceed hand');
});
t('defense validation', () => {
  const s = mk({ trump: 'S', player: [K('H', 9)], ai: [K('H', 7), K('D', 14), K('S', 6), K('H', 6)], deckN: 3, attacker: 'player' });
  C.doAttack(s, 'player', 'H9');
  truthy(!C.doDefend(s, 'ai', 0, 'H7').ok, 'lower same suit'); truthy(!C.doDefend(s, 'ai', 0, 'D14').ok, 'other suit non-trump');
  truthy(C.doDefend(s, 'ai', 0, 'S6').ok, 'trump');
  truthy(!C.doDefend(s, 'ai', 0, 'H6').ok, 'already beaten');
});
t('trump beaten only by higher trump', () => {
  const s = mk({ trump: 'S', player: [K('S', 9)], ai: [K('S', 7), K('S', 10), K('H', 14)], deckN: 3, attacker: 'player' });
  C.doAttack(s, 'player', 'S9');
  truthy(!C.doDefend(s, 'ai', 0, 'S7').ok); truthy(!C.doDefend(s, 'ai', 0, 'H14').ok); truthy(C.doDefend(s, 'ai', 0, 'S10').ok);
});
t('take: defender gets all cards, attacker stays attacker, draws', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('H', 7), K('H', 8), K('H', 9), K('H', 10), K('H', 11)], ai: [K('C', 6), K('C', 7), K('C', 8), K('C', 9), K('C', 10), K('C', 11)], deckN: 8, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); truthy(C.doTake(s, 'ai').ok); eq(s.turn, 'attacker');
  truthy(!C.doTake(s, 'ai').ok, 'cannot take twice');
  const r = C.doPass(s, 'player'); truthy(r.ok); truthy(r.ev.round.took);
  eq(s.hands.ai.length, 7); eq(s.hands.player.length, 6); eq(s.attacker, 'player'); eq(s.turn, 'attacker'); eq(s.table.length, 0);
  invariants(s);
});
t('defended round (valid)', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('H', 7), K('H', 8), K('H', 9), K('H', 10), K('H', 11)], ai: [K('H', 12), K('C', 7), K('C', 8), K('C', 9), K('C', 10), K('C', 14)], deckN: 1, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); truthy(C.doDefend(s, 'ai', 0, 'H12').ok);
  const r = C.doPass(s, 'player'); truthy(r.ok); eq(r.ev.round.took, false);
  eq(s.attacker, 'ai'); eq(s.discard.length >= 2, true); eq(s.deck.length, 0);
  eq(s.hands.player.length, 6, 'attacker drew the last card first'); eq(s.hands.ai.length, 5);
  invariants(s);
});
t('end: deck empty, attacker plays last card and defender beats -> draw', () => {
  const s = mk({ trump: 'S', player: [K('H', 6)], ai: [K('H', 7)], deckN: 0, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); C.doDefend(s, 'ai', 0, 'H7');
  truthy(C.needsAutoEnd(s)); const r = C.doPass(s, 'player'); truthy(r.ok);
  eq(s.over, true); eq(s.winner, 'draw');
});
t('end: attacker plays last card, defender takes -> attacker wins', () => {
  const s = mk({ trump: 'S', player: [K('H', 6)], ai: [K('C', 7), K('C', 8)], deckN: 0, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); C.doTake(s, 'ai'); truthy(C.needsAutoEnd(s)); C.doPass(s, 'player');
  eq(s.over, true); eq(s.winner, 'player');
});
t('end: defender beats with last card while attacker has cards -> defender wins', () => {
  const s = mk({ trump: 'S', player: [K('H', 6), K('C', 9)], ai: [K('H', 7)], deckN: 0, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); C.doDefend(s, 'ai', 0, 'H7');
  eq(C.legalAttackCards(s, 'player').length, 0, 'defender has no cards to attack');
  truthy(C.needsAutoEnd(s)); C.doPass(s, 'player');
  eq(s.over, true); eq(s.winner, 'ai');
});
t('no winner while deck is non-empty', () => {
  const s = mk({ trump: 'S', player: [K('H', 6)], ai: [K('H', 7), K('C', 8)], deckN: 4, attacker: 'player' });
  C.doAttack(s, 'player', 'H6'); C.doDefend(s, 'ai', 0, 'H7'); C.doPass(s, 'player');
  eq(s.over, false); eq(s.hands.player.length, 4);
});
t('transfer mode', () => {
  const s = mk({ mode: 'perevodnoy', trump: 'S', player: [K('H', 6), K('C', 9), K('C', 10), K('C', 11)], ai: [K('D', 6), K('C', 7), K('C', 8)], deckN: 5, attacker: 'player' });
  C.doAttack(s, 'player', 'H6');
  truthy(C.doTransfer(s, 'ai', 'D6').ok); eq(s.attacker, 'ai'); eq(C.defender(s), 'player'); eq(s.table.length, 2); eq(s.turn, 'defender');
  const s2 = mk({ mode: 'podkidnoy', trump: 'S', player: [K('H', 6), K('C', 9)], ai: [K('D', 6), K('C', 7)], deckN: 5, attacker: 'player' });
  C.doAttack(s2, 'player', 'H6'); truthy(!C.doTransfer(s2, 'ai', 'D6').ok, 'transfer disabled in podkidnoy');
});
t('validateState detects corruption', () => {
  const s = C.newGame({ rng: mulberry(3) });
  truthy(C.validateState(JSON.parse(JSON.stringify(s))));
  const bad = JSON.parse(JSON.stringify(s)); bad.hands.ai.push(bad.hands.player[0]); truthy(!C.validateState(bad));
  const bad2 = JSON.parse(JSON.stringify(s)); bad2.deck.pop(); truthy(!C.validateState(bad2));
});
t('AI obs does not contain hidden player cards', () => {
  const s = C.newGame({ rng: mulberry(9) });
  const obs = JSON.stringify(C.makeObs(s, 'ai'));
  s.hands.player.forEach((c) => { truthy(obs.indexOf('"id":"' + c.id + '"') < 0, 'leak ' + c.id); });
});
t('hints are always legal', () => {
  for (let seed = 1; seed < 40; seed++) {
    const rng = mulberry(seed); const s = C.newGame({ rng, mode: seed % 2 ? 'perevodnoy' : 'podkidnoy' });
    for (let step = 0; step < 400 && !s.over; step++) {
      const a = C.actor(s);
      if (a === 'player') {
        const h = C.getHint(s, 'player');
        if (h.ids.length) {
          const id = h.ids[0]; const card = C.findCard(s.hands.player, id); truthy(card, 'hint card in hand');
          if (h.action === 'attack') truthy(C.canAttack(s, 'player', card).ok, 'hint attack legal');
          if (h.action === 'defend') truthy(C.canDefend(s, 'player', h.target, card).ok, 'hint defend legal');
          if (h.action === 'transfer') truthy(C.canTransfer(s, 'player', card).ok, 'hint transfer legal');
        }
      }
      const ev = C.aiStep(s, 1 + (step % 3), rng, a);
      truthy(ev && ev.res.ok, 'ai action ok');
    }
  }
});
t('full AI vs AI simulations keep invariants and terminate', () => {
  const stats = { player: 0, ai: 0, draw: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry(seed * 7 + 1);
    const s = C.newGame({ rng, mode: seed % 3 === 0 ? 'perevodnoy' : 'podkidnoy' });
    const lv = { player: 1 + (seed % 3), ai: 1 + ((seed >> 2) % 3) };
    let steps = 0;
    while (!s.over) {
      const a = C.actor(s);
      const ev = C.aiStep(s, lv[a], rng, a);
      truthy(ev && ev.res.ok, 'illegal ai action seed ' + seed + ' ' + (ev && ev.res.reason));
      invariants(s);
      if (s.table.length > 6) throw new Error('table > 6');
      if (++steps > 5000) throw new Error('no termination seed ' + seed);
    }
    stats[s.winner]++;
    invariants(s);
  }
  console.log('   simulation results', JSON.stringify(stats));
});
t('difficulty differs: level 3 beats level 1 more often', () => {
  let w3 = 0, w1 = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rng = mulberry(seed * 13 + 5);
    const s = C.newGame({ rng });
    const lv = seed % 2 ? { player: 3, ai: 1 } : { player: 1, ai: 3 };
    while (!s.over) { const a = C.actor(s); C.aiStep(s, lv[a], rng, a); }
    if (s.winner !== 'draw') { const lvWin = lv[s.winner]; if (lvWin === 3) w3++; else w1++; }
  }
  console.log('   level3 wins', w3, 'level1 wins', w1);
  truthy(w3 > w1, 'hard should beat easy');
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
