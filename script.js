'use strict';
/* =====================================================================
   DURAK AI — ядро игры: правила, состояние, ИИ, подсказки.
   Эта часть не использует DOM и тестируется в Node (см. tests.js).
   ===================================================================== */
const DurakCore = (function () {
  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'пики', H: 'червы', D: 'бубны', C: 'трефы' };
  const RANK_LABEL = { 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'В', 12: 'Д', 13: 'К', 14: 'Т' };
  const RANK_NAME = { 6: 'шестёрка', 7: 'семёрка', 8: 'восьмёрка', 9: 'девятка', 10: 'десятка', 11: 'валет', 12: 'дама', 13: 'король', 14: 'туз' };
  const HAND_SIZE = 6;

  const ok = (extra) => Object.assign({ ok: true }, extra || {});
  const no = (reason) => ({ ok: false, reason });
  const other = (w) => (w === 'player' ? 'ai' : 'player');
  const fmt = (c) => RANK_LABEL[c.rank] + SUIT_SYM[c.suit];
  const fromId = (id) => ({ id, suit: id[0], rank: parseInt(id.slice(1), 10) });
  const makeCard = (s, r) => ({ id: s + r, suit: s, rank: r });

  /* ---------- Колода ---------- */
  function createDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 6; r <= 14; r++) d.push(makeCard(s, r));
    return d;
  }
  function shuffle(a, rng) {
    rng = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- Создание партии ---------- */
  function newGame(opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const deck = opts.deckOrder ? opts.deckOrder.map(fromId) : shuffle(createDeck(), rng);
    const seedDeck = deck.map((c) => c.id);
    const hands = { player: [], ai: [] };
    for (let i = 0; i < HAND_SIZE; i++) { hands.player.push(deck.pop()); hands.ai.push(deck.pop()); }
    const trumpCard = deck[0]; // нижняя карта колоды, добирается последней
    const trump = trumpCard.suit;
    const low = (who) => {
      const r = hands[who].filter((c) => c.suit === trump).map((c) => c.rank);
      return r.length ? Math.min.apply(null, r) : null;
    };
    const lp = low('player'), la = low('ai');
    let attacker, startReason;
    if (opts.firstAttacker) { attacker = opts.firstAttacker; startReason = 'Первый ход сохранён из прошлой партии.'; }
    else if (lp !== null || la !== null) {
      attacker = (la === null || (lp !== null && lp < la)) ? 'player' : 'ai';
      startReason = 'Первым ходит обладатель младшего козыря (' + (attacker === 'player' ? 'ты' : 'ИИ') + ').';
    } else {
      attacker = rng() < 0.5 ? 'player' : 'ai';
      startReason = 'Ни у кого нет козырей — первого игрока определил жребий.';
    }
    const state = {
      version: 1,
      mode: opts.mode === 'perevodnoy' ? 'perevodnoy' : 'podkidnoy',
      deck, trumpCard, trump, hands,
      table: [], discard: [],
      attacker, turn: 'attacker', taking: false,
      defStart: hands[other(attacker)].length,
      over: false, winner: null, round: 1,
      known: { player: [], ai: [] },
      aiCommit: false,
      seedDeck, firstAttacker: attacker, startReason,
      meta: {}
    };
    return state;
  }

  /* ---------- Вспомогательные ---------- */
  const defender = (s) => other(s.attacker);
  const actor = (s) => (s.turn === 'attacker' ? s.attacker : other(s.attacker));
  const unbeatenCount = (s) => s.table.filter((p) => !p.defense).length;
  const attackLimit = (s) => Math.min(HAND_SIZE, s.defStart);
  function tableRanks(s) {
    const set = new Set();
    s.table.forEach((p) => { set.add(p.attack.rank); if (p.defense) set.add(p.defense.rank); });
    return set;
  }
  const findCard = (hand, id) => hand.find((c) => c.id === id) || null;

  function beats(att, def, trump) {
    if (def.suit === att.suit) return def.rank > att.rank;
    return def.suit === trump && att.suit !== trump;
  }
  function whyCannotBeat(att, card, trump) {
    if (att.suit === trump) return 'Козырь бьётся только более старшим козырем.';
    if (card.suit === att.suit) return 'Карта той же масти должна быть старше атакующей.';
    return 'Побить можно картой той же масти старшего достоинства или козырем.';
  }

  /* ---------- Проверки допустимости ---------- */
  function canAttack(s, who, card) {
    if (s.over) return no('Партия окончена.');
    if (who !== s.attacker) return no('Сейчас ты не атакуешь.');
    if (s.turn !== 'attacker') return no('Сначала соперник должен ответить на атаку.');
    if (!card || !findCard(s.hands[who], card.id)) return no('Этой карты нет в руке.');
    if (s.table.length === 0) return ok();
    if (!tableRanks(s).has(card.rank)) return no('Подкидывать можно только карты тех достоинств, которые уже лежат на столе.');
    const lim = attackLimit(s);
    if (s.table.length >= lim) return no('Лимит атаки исчерпан: не больше ' + lim + ' карт за раунд (и не больше, чем было у защитника).');
    if (!s.taking && unbeatenCount(s) + 1 > s.hands[defender(s)].length) return no('У защитника не хватит карт, чтобы отбиться от ещё одной карты.');
    return ok();
  }
  function canDefend(s, who, idx, card) {
    if (s.over) return no('Партия окончена.');
    if (who !== defender(s)) return no('Сейчас ты не защищаешься.');
    if (s.turn !== 'defender' || s.taking) return no('Сейчас нельзя отбиваться.');
    const pair = s.table[idx];
    if (!pair) return no('Нет такой карты на столе.');
    if (pair.defense) return no('Эта карта уже побита.');
    if (!card || !findCard(s.hands[who], card.id)) return no('Этой карты нет в руке.');
    if (!beats(pair.attack, card, s.trump)) return no(whyCannotBeat(pair.attack, card, s.trump));
    return ok();
  }
  function canTransfer(s, who, card) {
    if (s.mode !== 'perevodnoy') return no('Перевод включён только в режиме «Переводной дурак».');
    if (s.over || who !== defender(s) || s.turn !== 'defender' || s.taking) return no('Сейчас нельзя переводить.');
    if (!card || !findCard(s.hands[who], card.id)) return no('Этой карты нет в руке.');
    if (s.table.length === 0 || s.table.some((p) => p.defense)) return no('Переводить можно только пока ты не побил ни одной карты.');
    if (!s.table.every((p) => p.attack.rank === card.rank)) return no('Для перевода нужна карта того же достоинства, что и атакующие карты.');
    const n = s.table.length + 1;
    if (n > s.hands[s.attacker].length) return no('У соперника не хватит карт, чтобы отбиться после перевода.');
    if (n > HAND_SIZE) return no('Слишком много карт на столе для перевода.');
    return ok();
  }
  const legalAttackCards = (s, who) => s.hands[who].filter((c) => canAttack(s, who, c).ok);
  function legalDefensePairs(s, who) {
    const res = [];
    s.table.forEach((p, idx) => {
      if (p.defense) return;
      s.hands[who].forEach((c) => { if (canDefend(s, who, idx, c).ok) res.push({ idx, card: c }); });
    });
    return res;
  }
  const legalTransfers = (s, who) => s.hands[who].filter((c) => canTransfer(s, who, c).ok);

  function removeKnown(s, who, id) { s.known[who] = s.known[who].filter((x) => x !== id); }

  /* ---------- Действия ---------- */
  function doAttack(s, who, cardId) {
    const card = findCard(s.hands[who] || [], cardId);
    const chk = canAttack(s, who, card);
    if (!chk.ok) return chk;
    const first = s.table.length === 0;
    s.hands[who].splice(s.hands[who].indexOf(card), 1);
    s.table.push({ attack: card, defense: null });
    if (!s.taking) s.turn = 'defender';
    removeKnown(s, who, card.id);
    return ok({ ev: { who, type: first ? 'attack' : 'throwin', card } });
  }
  function doDefend(s, who, idx, cardId) {
    const card = findCard(s.hands[who] || [], cardId);
    const chk = canDefend(s, who, idx, card);
    if (!chk.ok) return chk;
    const pair = s.table[idx];
    s.hands[who].splice(s.hands[who].indexOf(card), 1);
    pair.defense = card;
    removeKnown(s, who, card.id);
    if (unbeatenCount(s) === 0) s.turn = 'attacker';
    return ok({ ev: { who, type: 'defend', idx, card, attackCard: pair.attack } });
  }
  function doTransfer(s, who, cardId) {
    const card = findCard(s.hands[who] || [], cardId);
    const chk = canTransfer(s, who, card);
    if (!chk.ok) return chk;
    s.hands[who].splice(s.hands[who].indexOf(card), 1);
    s.table.push({ attack: card, defense: null });
    removeKnown(s, who, card.id);
    // роли меняются: переводивший становится атакующей стороной, отбиваться должен его соперник
    s.attacker = who;
    s.defStart = s.hands[other(who)].length;
    s.turn = 'defender';
    s.aiCommit = false;
    return ok({ ev: { who, type: 'transfer', card } });
  }
  function doTake(s, who) {
    if (s.over || who !== defender(s) || s.turn !== 'defender' || s.taking) return no('Сейчас нельзя взять карты.');
    if (unbeatenCount(s) === 0) return no('Все карты уже побиты — брать нечего.');
    s.taking = true;
    s.turn = 'attacker';
    return ok({ ev: { who, type: 'take', count: s.table.length } });
  }
  function doPass(s, who) {
    if (s.over) return no('Партия окончена.');
    if (who !== s.attacker || s.turn !== 'attacker') return no('Сейчас не твой ход.');
    if (s.table.length === 0) return no('Сначала нужно сходить картой.');
    if (!s.taking && unbeatenCount(s) > 0) return no('Не все карты побиты.');
    const round = endRound(s, s.taking);
    return ok({ ev: { who, type: 'pass', round } });
  }

  function drawUp(s, who) {
    let n = 0;
    while (s.hands[who].length < HAND_SIZE && s.deck.length > 0) { s.hands[who].push(s.deck.pop()); n++; }
    return n;
  }

  function endRound(s, took) {
    const att = s.attacker, def = defender(s);
    const cards = [];
    s.table.forEach((p) => { cards.push(p.attack); if (p.defense) cards.push(p.defense); });
    if (took) {
      s.hands[def].push.apply(s.hands[def], cards);
      cards.forEach((c) => s.known[def].push(c.id));
    } else {
      s.discard.push.apply(s.discard, cards);
    }
    s.table = [];
    s.taking = false;
    const drawn = {};
    drawn[att] = drawUp(s, att);
    drawn[def] = drawUp(s, def);
    drawn.player = drawn.player || 0; drawn.ai = drawn.ai || 0;
    s.attacker = took ? att : def;
    s.turn = 'attacker';
    s.aiCommit = false;
    s.round++;
    ['player', 'ai'].forEach((w) => {
      const ids = new Set(s.hands[w].map((c) => c.id));
      s.known[w] = s.known[w].filter((id) => ids.has(id));
    });
    s.defStart = s.hands[other(s.attacker)].length;
    checkEnd(s);
    return { took, attacker: att, defender: def, cards: cards.length, drawn, next: s.attacker, over: s.over, winner: s.winner };
  }

  function checkEnd(s) {
    if (s.deck.length > 0) return false;
    const p = s.hands.player.length, a = s.hands.ai.length;
    if (p === 0 && a === 0) { s.over = true; s.winner = 'draw'; }
    else if (p === 0) { s.over = true; s.winner = 'player'; }
    else if (a === 0) { s.over = true; s.winner = 'ai'; }
    return s.over;
  }

  // Атакующему нечего подкинуть, а раунд ещё не закончен — его можно закрыть автоматически.
  function needsAutoEnd(s) {
    if (s.over || s.turn !== 'attacker' || s.table.length === 0) return false;
    if (!s.taking && unbeatenCount(s) > 0) return false;
    return legalAttackCards(s, s.attacker).length === 0;
  }

  /* ---------- Проверка целостности ---------- */
  function validateState(s) {
    try {
      if (!s || s.version !== 1 || !s.hands || !Array.isArray(s.deck) || !Array.isArray(s.table) || !Array.isArray(s.discard)) return false;
      const all = [];
      const addCard = (c) => { if (!c || !SUITS.includes(c.suit) || !(c.rank >= 6 && c.rank <= 14) || c.id !== c.suit + c.rank) throw new Error('bad card'); all.push(c.id); };
      s.deck.forEach(addCard); s.hands.player.forEach(addCard); s.hands.ai.forEach(addCard); s.discard.forEach(addCard);
      s.table.forEach((p) => { addCard(p.attack); if (p.defense) addCard(p.defense); });
      if (all.length !== 36 || new Set(all).size !== 36) return false;
      if (!SUITS.includes(s.trump) || !s.trumpCard || s.trumpCard.suit !== s.trump) return false;
      if (s.attacker !== 'player' && s.attacker !== 'ai') return false;
      if (s.turn !== 'attacker' && s.turn !== 'defender') return false;
      if (s.deck.length > 0 && s.deck[0].id !== s.trumpCard.id) return false;
      if (!s.known || !Array.isArray(s.known.player) || !Array.isArray(s.known.ai)) return false;
      return true;
    } catch (e) { return false; }
  }

  /* =====================================================================
     ИИ. Принимает только «наблюдение» (obs): свои карты, стол, сброс,
     размер руки и колоды соперника, а также карты, которые соперник
     публично взял со стола. Карты соперника из state.hands не читаются.
     ===================================================================== */
  const val = (c, t) => c.rank + (c.suit === t ? 20 : 0);
  const cost = (c, t) => (c.suit === t ? 15 + c.rank : c.rank - 5);

  function makeObs(s, who) {
    const opp = other(who);
    return {
      who,
      hand: s.hands[who].slice(),
      table: s.table.map((p) => ({ attack: p.attack, defense: p.defense })),
      trump: s.trump, trumpCard: s.trumpCard,
      deckCount: s.deck.length,
      oppCount: s.hands[opp].length,          // количество карт видно всем
      discard: s.discard.slice(),
      knownOpp: s.known[opp].map(fromId),     // только то, что соперник брал со стола открыто
      taking: s.taking, mode: s.mode, defStart: s.defStart
    };
  }

  function unseenPool(obs) {
    const seen = new Set(obs.hand.map((c) => c.id));
    obs.table.forEach((p) => { seen.add(p.attack.id); if (p.defense) seen.add(p.defense.id); });
    obs.discard.forEach((c) => seen.add(c.id));
    const known = new Set(obs.knownOpp.map((c) => c.id));
    const pool = [];
    createDeck().forEach((c) => {
      if (seen.has(c.id) || known.has(c.id)) return;
      if (obs.deckCount > 0 && c.id === obs.trumpCard.id) return; // козырь лежит в колоде
      pool.push(c);
    });
    return pool;
  }
  function pOppBeat(obs, c, pool) {
    if (obs.knownOpp.some((k) => beats(c, k, obs.trump))) return 1;
    const u = pool.length;
    if (!u) return 0;
    const b = pool.filter((x) => beats(c, x, obs.trump)).length;
    const k = Math.max(0, obs.oppCount - obs.knownOpp.length);
    return 1 - Math.pow(1 - b / u, k);
  }
  function weightedPick(items, weights, rng) {
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = rng() * sum;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  const countRank = (hand, rank) => hand.filter((x) => x.rank === rank).length;

  /* ---- Атака: первая карта раунда ---- */
  function aiLead(obs, legal, level, rng) {
    const t = obs.trump;
    if (level === 1) {
      if (rng() < 0.15) return { card: legal[Math.floor(rng() * legal.length)], why: 'простой ход: выбрана одна из подходящих карт без глубокого расчёта' };
      const w = legal.map((c) => (c.suit === t ? 0.15 : 1 / Math.pow(c.rank - 4, 1.3)));
      const c = weightedPick(legal, w, rng);
      return { card: c, why: c.suit === t ? 'на лёгком уровне я иногда трачу козыри не лучшим образом' : 'я чаще хожу картами меньшего достоинства' };
    }
    if (level === 2) {
      let best = null, bs = 1e9;
      legal.forEach((c) => {
        const s = cost(c, t) - 0.8 * (countRank(obs.hand, c.rank) - 1);
        if (s < bs) { bs = s; best = c; }
      });
      const pair = countRank(obs.hand, best.rank) > 1;
      return {
        card: best,
        why: best.suit === t
          ? 'других карт нет, пришлось сходить козырем'
          : 'это самая дешёвая карта без козыря, старшие карты остаются на потом' + (pair ? '; к тому же у меня есть ещё карта этого достоинства для подкидывания' : '')
      };
    }
    // Сложный уровень: оценка стоимости + вероятность, что соперник побьёт дёшево
    const pool = unseenPool(obs);
    let best = null, bs = 1e9, bp = 0;
    legal.forEach((c) => {
      let s = cost(c, t) - 1.2 * (countRank(obs.hand, c.rank) - 1);
      const p = pOppBeat(obs, c, pool);
      if (c.suit !== t && c.rank <= 10) s -= 4 * (1 - p);
      if (obs.deckCount === 0 && c.suit !== t) s -= 2 * (1 - p);
      if (s < bs) { bs = s; best = c; bp = p; }
    });
    let why;
    if (best.suit === t) why = 'остались только козыри, поэтому хожу самым младшим из них';
    else {
      why = 'карта дешёвая, не козырь, старшие карты и козыри остаются на потом';
      if (obs.knownOpp.length && bp === 0) why += '; среди известных мне карт соперника нет чем её побить';
      else if (bp < 0.5) why += '; по оценке вероятности побить её будет непросто';
      if (countRank(obs.hand, best.rank) > 1) why += '; у меня есть ещё такое же достоинство для подкидывания';
    }
    return { card: best, why };
  }

  /* ---- Атака: подкидывание ---- */
  function aiThrow(obs, legal, level, rng) {
    const t = obs.trump;
    if (!legal.length) return { card: null, why: 'у меня нет подходящих карт для подкидывания' };
    const nonTrump = legal.filter((c) => c.suit !== t).sort((a, b) => a.rank - b.rank);
    if (obs.taking) {
      if (!nonTrump.length) return { card: null, why: 'подкинуть можно только козыри, а их выгоднее приберечь' };
      if (level === 1 && rng() < 0.5) return { card: null, why: 'я решил не подкидывать — на лёгком уровне я играю проще' };
      return { card: nonTrump[0], why: 'соперник всё равно берёт карты, поэтому я отдаю ему ненужную мелкую карту' };
    }
    const pool = nonTrump.filter((c) => c.rank <= (level === 2 ? 10 : 12));
    if (!pool.length) return { card: null, why: 'добавлять без траты ценных карт нечего' };
    const c = pool[0];
    if (level === 1) {
      return rng() < 0.25 ? { card: c, why: 'решил подкинуть мелкую карту' } : { card: null, why: 'я решил не подкидывать' };
    }
    if (level === 2) {
      return rng() < 0.55 ? { card: c, why: 'подкинул мелкую карту, чтобы заставить соперника потратить ещё одну карту' } : { card: null, why: 'решил не подкидывать и закончить раунд' };
    }
    const p = pOppBeat(obs, c, unseenPool(obs));
    if (obs.deckCount === 0 || p <= 0.5) {
      return { card: c, why: obs.deckCount === 0 ? 'колода закончилась: подкидывая мелкие карты, я быстрее избавляюсь от них и перегружаю защитника' : 'подкидываю дешёвую карту, которую будет трудно побить без потерь' };
    }
    return { card: null, why: 'подкидывание, скорее всего, ничего не даст — лучше закончить раунд' };
  }

  function aiAttack(obs, legal, level, rng) {
    return obs.table.length === 0 ? aiLead(obs, legal, level, rng) : aiThrow(obs, legal, level, rng);
  }

  /* ---- Защита ---- */
  function findPlan(obs, unb, costFn) {
    const t = obs.trump;
    const used = new Set();
    const plan = [];
    const order = unb.slice().sort((a, b) => val(obs.table[b].attack, t) - val(obs.table[a].attack, t));
    for (const i of order) {
      const att = obs.table[i].attack;
      let best = null;
      for (const c of obs.hand) {
        if (used.has(c.id) || !beats(att, c, t)) continue;
        if (!best || costFn(c) < costFn(best)) best = c;
      }
      if (!best) return null;
      used.add(best.id);
      plan.push({ idx: i, card: best });
    }
    return plan.sort((a, b) => a.idx - b.idx);
  }

  function aiDefend(obs, level, rng, transfers, committed) {
    const t = obs.trump;
    const unb = [];
    obs.table.forEach((p, i) => { if (!p.defense) unb.push(i); });
    const noise = {};
    obs.hand.forEach((c) => { noise[c.id] = level === 1 ? rng() * 8 : 0; });
    const costFn = (c) => cost(c, t) + noise[c.id];
    const plan = findPlan(obs, unb, costFn);
    const planCost = plan ? plan.reduce((a, x) => a + cost(x.card, t), 0) : 0;

    // Перевод (только режим «Переводной дурак»)
    if (!committed && transfers && transfers.length) {
      const nt = transfers.filter((c) => c.suit !== t).sort((a, b) => a.rank - b.rank);
      if (nt.length) {
        let go = false;
        if (level === 1) go = rng() < 0.2;
        else if (level === 2) go = rng() < 0.7;
        else go = !plan || planCost > cost(nt[0], t);
        if (go) return { action: 'transfer', card: nt[0], why: 'у меня есть карта того же достоинства: перевожу атаку, теперь отбиваться должен ты' };
      }
    }
    if (!plan) return { action: 'take', why: 'побить все карты на столе у меня нечем' };
    const step = plan[0];
    const usesTrump = plan.some((x) => x.card.suit === t);
    const beat = (why) => ({ action: 'beat', idx: step.idx, card: step.card, why });
    const takeIt = (why) => ({ action: 'take', why });
    const baseWhy = step.card.suit === t
      ? 'для защиты нужен козырь'
      : 'побил самой младшей подходящей картой, чтобы сохранить старшие';
    if (committed) return beat(baseWhy);

    if (level === 1) {
      if (usesTrump && rng() < 0.4) return takeIt('я не стал тратить козырь — на лёгком уровне я играю не самым выгодным образом');
      return beat(baseWhy);
    }
    if (level === 2) {
      const trumps = plan.filter((x) => x.card.suit === t);
      const attTrumpless = unb.every((i) => obs.table[i].attack.suit !== t);
      if (trumps.length && attTrumpless && obs.deckCount > 2) {
        const maxT = Math.max.apply(null, trumps.map((x) => x.card.rank));
        const lowAtt = unb.every((i) => obs.table[i].attack.rank <= 9);
        if (maxT >= 12 || (lowAtt && obs.deckCount > 4)) return takeIt('чтобы побить, пришлось бы потратить ценный козырь, а карты на столе небольшие');
      }
      return beat(baseWhy);
    }
    // Сложный уровень: сравниваем «цену защиты» и «цену взятия»
    let tp = 6;
    obs.table.forEach((p) => {
      [p.attack, p.defense].forEach((c) => { if (c) tp += 3 + (c.rank - 6) * 0.5 + (c.suit === t ? 8 : 0); });
    });
    if (obs.deckCount === 0) tp += 40;
    if (planCost > tp) return takeIt('защита обошлась бы слишком дорого (козыри и старшие карты), а брать карты сейчас дешевле');
    if (obs.deckCount === 0 && usesTrump) return beat('колода закончилась, брать карты очень опасно, поэтому тратить козырь оправданно');
    return beat(baseWhy);
  }

  /* ---- Применение хода ИИ ---- */
  function aiStep(s, level, rng, who) {
    rng = rng || Math.random;
    who = who || 'ai';
    if (s.over || actor(s) !== who) return null;
    const obs = makeObs(s, who);
    if (s.turn === 'attacker') {
      const legal = legalAttackCards(s, who);
      const dec = aiAttack(obs, legal, level, rng);
      if (dec.card) {
        const r = doAttack(s, who, dec.card.id);
        return Object.assign({ why: dec.why, res: r }, r.ev || { who, type: 'error' });
      }
      const r = doPass(s, who);
      return Object.assign({ why: dec.why, res: r }, r.ev || { who, type: 'error' });
    }
    const dec = aiDefend(obs, level, rng, legalTransfers(s, who), s.aiCommit);
    let r;
    if (dec.action === 'transfer') r = doTransfer(s, who, dec.card.id);
    else if (dec.action === 'beat') { r = doDefend(s, who, dec.idx, dec.card.id); if (r.ok) s.aiCommit = true; }
    else r = doTake(s, who);
    return Object.assign({ why: dec.why, res: r }, r.ev || { who, type: 'error' });
  }

  /* ---------- Подсказки для игрока ---------- */
  function getHint(s, who) {
    if (s.over) return { text: 'Партия окончена.', ids: [] };
    if (actor(s) !== who) return { text: 'Сейчас ходит соперник. Подожди его хода: посмотри, что лежит на столе и какие твои карты могли бы это побить.', ids: [] };
    const obs = makeObs(s, who);
    const rng = Math.random;
    if (s.turn === 'attacker') {
      const legal = legalAttackCards(s, who);
      if (!legal.length) {
        return { text: s.taking ? 'Подкидывать больше нечего (или достигнут лимит). Нажми «Завершить ход» — соперник заберёт карты.' : 'Подкидывать нечего. Нажми «Бито».', ids: [], action: 'pass' };
      }
      const d = aiAttack(obs, legal, 3, rng);
      if (d.card) {
        const lead = s.table.length === 0 ? 'Сходи' : 'Можешь подкинуть';
        const tr = d.card.suit === s.trump ? ' Это козырь — тратить его стоит только когда других ходов нет.' : '';
        return { text: lead + ' картой ' + fmt(d.card) + ': ' + d.why + '.' + tr + ' Выбери её и нажми «' + (s.table.length === 0 ? 'Атаковать' : 'Подкинуть') + '».', ids: [d.card.id], action: 'attack' };
      }
      return { text: 'Лучше завершить ход: ' + d.why + '. Нажми «' + (s.taking ? 'Завершить ход' : 'Бито') + '».', ids: [], action: 'pass' };
    }
    const d = aiDefend(obs, 3, rng, legalTransfers(s, who), false);
    if (d.action === 'beat') {
      const att = s.table[d.idx].attack;
      return { text: 'Побей ' + fmt(att) + ' картой ' + fmt(d.card) + ': ' + d.why + '. Выбери её' + (s.table.filter((p) => !p.defense).length > 1 ? ', затем нажми на нужную атакующую карту на столе' : '') + ' и нажми «Отбить».', ids: [d.card.id], action: 'defend', target: d.idx };
    }
    if (d.action === 'transfer') {
      return { text: 'Можно перевести картой ' + fmt(d.card) + ': у неё то же достоинство, что и у атакующих карт. Выбери её и нажми «Перевести».', ids: [d.card.id], action: 'transfer' };
    }
    return { text: 'Лучше взять карты: ' + d.why + '. Нажми «Взять карты».', ids: [], action: 'take' };
  }

  return {
    SUITS, SUIT_SYM, SUIT_NAME, RANK_LABEL, RANK_NAME, HAND_SIZE,
    createDeck, shuffle, newGame, beats, whyCannotBeat, fmt, fromId, other, defender, actor,
    unbeatenCount, attackLimit, tableRanks, findCard,
    canAttack, canDefend, canTransfer, legalAttackCards, legalDefensePairs, legalTransfers,
    doAttack, doDefend, doTransfer, doTake, doPass, endRound, drawUp, checkEnd, needsAutoEnd,
    validateState, makeObs, aiAttack, aiDefend, aiStep, findPlan, getHint, cost, val, unseenPool, pOppBeat
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DurakCore;
if (typeof window !== 'undefined') window.DurakCore = DurakCore;

/* =====================================================================
   DURAK AI — интерфейс: экраны, отрисовка, помощник, звук, сохранение
   ===================================================================== */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  const C = DurakCore;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = C.fmt;

  /* ---------- Хранилище ---------- */
  const KEY_SET = 'durakai.settings.v1', KEY_STATS = 'durakai.stats.v1', KEY_GAME = 'durakai.game.v1';
  const DEF_SET = { theme: 'dark', sound: true, mode: 'podkidnoy', teach: true, autoHL: true, reduceMotion: false, difficulty: 2 };
  const DEF_STATS = { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, achievements: {} };
  function load(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v && typeof v === 'object' ? Object.assign({}, def, v) : Object.assign({}, def); }
    catch (e) { return Object.assign({}, def); }
  }
  function store(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* хранилище недоступно */ } }
  let settings = load(KEY_SET, DEF_SET);
  let stats = load(KEY_STATS, DEF_STATS);
  if (!stats.achievements || typeof stats.achievements !== 'object') stats.achievements = {};
  const saveSettings = () => store(KEY_SET, settings);
  const saveStats = () => store(KEY_STATS, stats);

  const ACH = [
    { id: 'first_win', ic: '🥇', t: 'Первая победа', d: 'Выиграй любую партию' },
    { id: 'hard_win', ic: '🏆', t: 'Победа на сложном уровне', d: 'Обыграй сложного ИИ' },
    { id: 'streak3', ic: '🔥', t: 'Серия из 3 побед', d: 'Выиграй три партии подряд' },
    { id: 'games10', ic: '🎴', t: 'Ветеран', d: 'Сыграй 10 партий' }
  ];
  const LEVELS = { 1: 'Лёгкий', 2: 'Средний', 3: 'Сложный' };

  /* ---------- Состояние интерфейса ---------- */
  let game = null;
  const ui = { selected: null, target: null, explain: false, showLegal: false, hint: [], log: [], lastAI: null,
    aiStatus: '', timer: null, gen: 0, paused: false, pending: false, lastSeed: null, chosenLevel: 2, modalClose: null };

  const reduce = () => settings.reduceMotion || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- Звук (Web Audio, без файлов) ---------- */
  const Sound = {
    ctx: null,
    unlock() {
      if (!this.ctx) { try { const A = window.AudioContext || window.webkitAudioContext; if (A) this.ctx = new A(); } catch (e) { this.ctx = null; } }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    tone(f, d, type, vol, when) {
      const c = this.ctx; if (!c) return;
      const t0 = c.currentTime + (when || 0);
      const o = c.createOscillator(), g = c.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + d + 0.02);
    },
    noise(d, vol, when, freq) {
      const c = this.ctx; if (!c) return;
      const t0 = c.currentTime + (when || 0);
      const len = Math.max(1, Math.floor(c.sampleRate * d));
      const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 2200;
      const g = c.createGain(); g.gain.value = vol || 0.2;
      src.connect(f); f.connect(g); g.connect(c.destination); src.start(t0);
    },
    play(name) {
      if (!settings.sound || !this.ctx) return;
      try {
        switch (name) {
          case 'deal': for (let i = 0; i < 5; i++) this.noise(0.05, 0.18, i * 0.08, 2600); break;
          case 'place': this.noise(0.07, 0.25, 0, 1800); this.tone(180, 0.06, 'triangle', 0.08); break;
          case 'defend': this.tone(520, 0.1, 'sine', 0.13); this.tone(780, 0.14, 'sine', 0.13, 0.09); break;
          case 'take': this.tone(300, 0.12, 'triangle', 0.14); this.tone(210, 0.2, 'triangle', 0.14, 0.1); break;
          case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.15, i * 0.14)); break;
          case 'lose': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.08, i * 0.18)); break;
          case 'error': this.tone(160, 0.12, 'square', 0.07); break;
        }
      } catch (e) { /* звук не критичен */ }
    }
  };
  document.addEventListener('pointerdown', () => Sound.unlock(), { passive: true });
  document.addEventListener('keydown', () => Sound.unlock());

  /* ---------- Утилиты ---------- */
  let toastT = null;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cardName = (c) => C.RANK_NAME[c.rank] + ' ' + (c.suit === 'S' ? 'пик' : c.suit === 'H' ? 'червей' : c.suit === 'D' ? 'бубен' : 'треф');
  const who2 = (w) => (w === 'player' ? 'Ты' : 'ИИ');
  function schedule(fn, ms) {
    const g = ui.gen;
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => { if (g !== ui.gen || ui.paused) return; fn(); }, reduce() ? Math.min(ms, 250) : ms);
  }

  /* ---------- Экраны ---------- */
  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
    if (id === 'screen-game') requestAnimationFrame(() => { layoutHand(); updateHandVar(); });
  }
  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
    const mt = document.querySelector('meta[name=theme-color]'); if (mt) mt.content = settings.theme === 'dark' ? '#0a1812' : '#eaf2ec';
    $('#m-theme').textContent = settings.theme === 'dark' ? '🌙' : '☀️';
    $('#m-sound').textContent = settings.sound ? '🔊' : '🔇';
    $$('.chip[data-mode]').forEach((c) => c.classList.toggle('on', c.dataset.mode === settings.mode));
    $('#menu-stats').textContent = stats.played ? 'Партий: ' + stats.played + ' · Побед: ' + stats.wins + ' · Лучшая серия: ' + stats.bestStreak : 'Сыграй первую партию!';
  }

  /* ---------- Модальные окна ---------- */
  function openModal(html, bind, onClose) {
    const m = $('#modal'), box = $('#modal-box');
    box.innerHTML = html; m.classList.remove('hidden'); ui.modalClose = onClose || null;
    if (bind) bind(box);
    const f = box.querySelector('button'); if (f) f.focus({ preventScroll: true });
  }
  function closeModal() {
    $('#modal').classList.add('hidden'); $('#modal-box').innerHTML = '';
    const cb = ui.modalClose; ui.modalClose = null; if (cb) cb();
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      let answered = false;
      const wasPaused = ui.paused;
      ui.paused = true; clearTimeout(ui.timer);
      const done = (v) => { if (answered) return; answered = true; ui.paused = wasPaused; resolve(v); };
      openModal('<h2>' + esc(title) + '</h2><p>' + esc(text) + '</p><div class="btns"><button class="btn primary" data-a="ok">' + esc(okLabel || 'Да') + '</button><button class="btn" data-a="no">Отмена</button></div>',
        (box) => { box.querySelector('[data-a=ok]').onclick = () => { done(true); closeModal(); }; box.querySelector('[data-a=no]').onclick = () => { closeModal(); }; },
        () => { done(false); if (game && !ui.paused && !wasPaused) tick(); });
    });
  }

  const RULES_HTML = '<h2>📖 Правила игры</h2><ol>' +
    '<li><b>Колода:</b> 36 карт (6…10, В, Д, К, Т). Каждому по 6 карт. Нижняя карта колоды открыта — её масть <b>козырная</b>.</li>' +
    '<li><b>Первый ход:</b> у кого младший козырь; если козырей нет — решает жребий.</li>' +
    '<li><b>Атака:</b> атакующий кладёт карту, защитник должен её побить или взять.</li>' +
    '<li><b>Как бить:</b> картой той же масти старше, либо козырем (если атакующая карта не козырь). Козырь бьётся только старшим козырем.</li>' +
    '<li><b>Подкидывание:</b> можно добавлять карты только тех достоинств, что уже лежат на столе. Всего не больше 6 карт и не больше, чем было у защитника в руке в начале раунда.</li>' +
    '<li><b>Бито:</b> если всё побито, а подкидывать нечего или не хочется — раунд заканчивается, карты уходят в сброс, роли меняются.</li>' +
    '<li><b>Взять:</b> если не можешь или не хочешь бить — бери все карты со стола. Ты пропускаешь атаку: соперник ходит снова.</li>' +
    '<li><b>Добор:</b> после раунда оба добирают до 6, пока есть колода. Первым добирает атакующий.</li>' +
    '<li><b>Конец:</b> когда колода пуста, кто первым остался без карт — выиграл. Последний с картами — «дурак». Если закончили оба — ничья.</li>' +
    '<li><b>Переводной:</b> пока защитник не побил ни одной карты, он может «перевести», добавив карту того же достоинства — отбиваться теперь должен соперник.</li></ol>' +
    '<div class="btns"><button class="btn primary" data-close>Понятно</button></div>';
  function showRules() { openModal(RULES_HTML, (b) => { b.querySelector('[data-close]').onclick = closeModal; }); }

  const LESSONS = [
    ['🃏 Твоя цель', 'Избавиться от всех карт раньше соперника. Кто остаётся с картами в конце — «дурак».'],
    ['⭐ Козырь', 'Козырная масть бьёт любую некозырную. Козырь можно побить только старшим козырем. Береги козыри!'],
    ['⚔ Атака', 'Выбери карту касанием и нажми «Атаковать». Лучше ходить младшими картами, не козырями.'],
    ['🛡 Защита', 'Выбери карту той же масти старше (или козырь) и нажми «Отбить». Если нечем или невыгодно — «Взять карты».'],
    ['➕ Подкидывание', 'Атакующий может добавлять карты тех же достоинств, что уже на столе, пока защитник не отбился или берёт.'],
    ['💡 Помощник', 'Кнопка «Подсказка» советует ход, «❔ Что это значит?» объясняет любой элемент, «Почему ИИ так походил?» раскрывает логику ИИ.']
  ];
  function showLessons() {
    let i = 0;
    openModal('<div id="lsn"></div>', (box) => {
      const draw = () => {
        const l = LESSONS[i];
        $('#lsn', box).innerHTML = '<h2>🎓 Обучение ' + (i + 1) + '/' + LESSONS.length + '</h2><h3>' + l[0] + '</h3><p>' + l[1] + '</p><div class="btns">' +
          (i > 0 ? '<button class="btn" data-p>← Назад</button>' : '') +
          (i < LESSONS.length - 1 ? '<button class="btn primary" data-n>Далее →</button>' : '<button class="btn primary" data-go>Начать обучающую партию</button>') + '</div>';
        const p = $('[data-p]', box), n = $('[data-n]', box), g = $('[data-go]', box);
        if (p) p.onclick = () => { i--; draw(); };
        if (n) n.onclick = () => { i++; draw(); };
        if (g) g.onclick = () => { closeModal(); settings.teach = true; settings.autoHL = true; saveSettings(); startGame(1, {}); };
      };
      draw();
    });
  }

  function showSettings() {
    const row = (id, label, hint, checked) => '<div class="set-row"><div>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</div><label class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span></span></label></div>';
    openModal('<h2>⚙ Настройки</h2>' +
      row('s-theme', 'Светлая тема', '', settings.theme === 'light') +
      row('s-sound', 'Звуковые эффекты', '', settings.sound) +
      row('s-teach', 'Обучать меня во время игры', 'Объяснения после ходов и предупреждения', settings.teach) +
      row('s-hl', 'Подсвечивать доступные ходы', 'Рекомендуется новичкам', settings.autoHL) +
      row('s-motion', 'Уменьшить анимации', 'Также учитывается системная настройка', settings.reduceMotion) +
      '<div class="set-row"><div>Режим игры<small>Применяется к следующей партии</small></div><div><button class="chip" data-mode="podkidnoy">Подкидной</button> <button class="chip" data-mode="perevodnoy">Переводной</button></div></div>' +
      '<div class="btns"><button class="btn danger small" id="s-reset">Сбросить статистику</button><button class="btn primary" data-close>Готово</button></div>',
      (box) => {
        const bind = (id, fn) => { $('#' + id, box).onchange = (e) => { fn(e.target.checked); saveSettings(); applyTheme(); renderAll(); }; };
        bind('s-theme', (v) => { settings.theme = v ? 'light' : 'dark'; });
        bind('s-sound', (v) => { settings.sound = v; });
        bind('s-teach', (v) => { settings.teach = v; });
        bind('s-hl', (v) => { settings.autoHL = v; });
        bind('s-motion', (v) => { settings.reduceMotion = v; });
        const chips = $$('.chip[data-mode]', box);
        const mark = () => chips.forEach((c) => c.classList.toggle('on', c.dataset.mode === settings.mode));
        chips.forEach((c) => { c.onclick = () => { settings.mode = c.dataset.mode; saveSettings(); applyTheme(); mark(); }; });
        mark();
        $('#s-reset', box).onclick = () => { if (window.confirm('Сбросить всю статистику и достижения?')) { stats = Object.assign({}, DEF_STATS, { achievements: {} }); saveStats(); applyTheme(); toast('Статистика сброшена'); } };
        $('[data-close]', box).onclick = closeModal;
      });
  }

  function showStats() {
    openModal('<h2>🏆 Статистика</h2><p>Партий: <b>' + stats.played + '</b> · Побед: <b>' + stats.wins + '</b> · Поражений: <b>' + stats.losses + '</b> · Ничьих: <b>' + stats.draws + '</b><br>Текущая серия: <b>' + stats.streak + '</b> · Рекорд серии: <b>' + stats.bestStreak + '</b></p><h3>Достижения</h3>' +
      ACH.map((a) => '<div class="ach' + (stats.achievements[a.id] ? '' : ' off') + '"><span style="font-size:1.6rem">' + a.ic + '</span><div><b>' + a.t + '</b><br><small>' + a.d + '</small></div></div>').join('') +
      '<div class="btns"><button class="btn primary" data-close>Закрыть</button></div>', (b) => { $('[data-close]', b).onclick = closeModal; });
  }

  /* ---------- Старт и сохранение ---------- */
  function startGame(level, opts) {
    opts = opts || {};
    ui.gen++; clearTimeout(ui.timer);
    game = C.newGame({ mode: opts.mode || settings.mode, deckOrder: opts.deckOrder, firstAttacker: opts.firstAttacker });
    game.meta = { difficulty: level };
    settings.difficulty = level; saveSettings();
    Object.assign(ui, { selected: null, target: null, explain: false, showLegal: false, hint: [], log: [], lastAI: null, aiStatus: '', paused: false });
    document.body.classList.remove('explain-on');
    addLog('Новая партия: ' + (game.mode === 'perevodnoy' ? 'переводной' : 'подкидной') + ' дурак, ИИ — ' + LEVELS[level].toLowerCase() + '. Козырь: ' + C.SUIT_SYM[game.trump] + '.');
    addLog(game.startReason);
    showScreen('screen-game');
    const wide = window.matchMedia('(min-width:860px)').matches;
    $('#screen-game').classList.toggle('helper-open', wide);
    say('Партия началась! Козырь — ' + C.SUIT_NAME[game.trump] + ' ' + C.SUIT_SYM[game.trump] + '. ' + game.startReason + (game.attacker === 'player' ? ' Выбери карту и нажми «Атаковать».' : ' ИИ ходит первым — постарайся отбиться.'), true);
    renderAll();
    Sound.play('deal');
    persist();
    tick();
  }
  function persist() {
    if (!game || game.over) { try { localStorage.removeItem(KEY_GAME); } catch (e) { /* ignore */ } return; }
    game.meta.log = ui.log.slice(-40);
    store(KEY_GAME, game);
  }
  function loadSaved() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY_GAME));
      if (s && !s.over && C.validateState(s) && s.meta && s.meta.difficulty >= 1 && s.meta.difficulty <= 3) return s;
    } catch (e) { /* повреждённое сохранение */ }
    try { localStorage.removeItem(KEY_GAME); } catch (e) { /* ignore */ }
    return null;
  }
  function restoreGame() {
    const s = loadSaved();
    if (!s) { toast('Сохранённая партия не найдена'); $('#m-continue').hidden = true; return; }
    ui.gen++; clearTimeout(ui.timer);
    game = s;
    Object.assign(ui, { selected: null, target: null, explain: false, showLegal: false, hint: [], log: (s.meta.log || []).slice(), lastAI: null, aiStatus: '', paused: false });
    showScreen('screen-game');
    const wide = window.matchMedia('(min-width:860px)').matches;
    $('#screen-game').classList.toggle('helper-open', wide);
    addLog('Партия восстановлена.');
    say('Партия восстановлена. Продолжаем!', true);
    renderAll(); tick();
  }

  /* ---------- Журнал и помощник ---------- */
  function addLog(text) { ui.log.push(text); if (ui.log.length > 60) ui.log.shift(); renderLog(); }
  function renderLog() {
    const ol = $('#log'); if (!ol) return;
    ol.innerHTML = ui.log.slice(-14).map((t) => '<li>' + esc(t) + '</li>').join('');
  }
  function say(text, force, open) {
    if (!force && !settings.teach) return;
    ui.assistant = text;
    const b = $('#bubble'); b.textContent = text; b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    $('#assist-mini').textContent = '🎓 ' + text;
    if (open && !window.matchMedia('(min-width:860px)').matches) $('#screen-game').classList.add('helper-open');
  }

  /* ---------- Тексты событий ---------- */
  function evText(ev) {
    const me = ev.who === 'player';
    switch (ev.type) {
      case 'attack': return (me ? 'Ты атакуешь: ' : 'ИИ атакует: ') + fmt(ev.card);
      case 'throwin': return (me ? 'Ты подкидываешь: ' : 'ИИ подкидывает: ') + fmt(ev.card);
      case 'defend': return (me ? 'Ты отбиваешь ' : 'ИИ отбивает ') + fmt(ev.attackCard) + ' картой ' + fmt(ev.card);
      case 'transfer': return (me ? 'Ты переводишь картой ' : 'ИИ переводит картой ') + fmt(ev.card);
      case 'take': return me ? 'Ты берёшь карты' : 'ИИ берёт карты';
      case 'pass': {
        const r = ev.round;
        if (!r) return 'Ход завершён';
        if (r.took) return (r.defender === 'player' ? 'Ты взял карты' : 'ИИ взял карты') + ' (' + r.cards + ')';
        return (r.defender === 'player' ? 'Ты отбился' : 'ИИ отбился') + ' — бито (' + r.cards + ' карт)';
      }
      default: return '';
    }
  }
  function whyText(ev) {
    const w = ev.why || '';
    switch (ev.type) {
      case 'attack': return 'Я сходил ' + fmt(ev.card) + ': ' + w + '.';
      case 'throwin': return 'Я подкинул ' + fmt(ev.card) + ': ' + w + '.';
      case 'defend': return 'Я побил ' + fmt(ev.attackCard) + ' картой ' + fmt(ev.card) + ': ' + w + '.';
      case 'transfer': return 'Я перевёл атаку картой ' + fmt(ev.card) + ': ' + w + '.';
      case 'take': return 'Я взял карты: ' + w + '.';
      default: return 'Я завершил ход: ' + w + '.';
    }
  }
  function roundReview(r) {
    const next = r.next === 'player' ? 'ты' : 'ИИ';
    if (r.took) {
      const who = r.defender === 'player' ? 'Ты взял' : 'ИИ взял';
      return 'Разбор раунда: ' + who + ' ' + r.cards + ' карт со стола. Взявший карты пропускает атаку — следующий ход снова за атакующим (' + next + '). Добор: ты +' + r.drawn.player + ', ИИ +' + r.drawn.ai + '.';
    }
    const who = r.defender === 'player' ? 'Ты отбился' : 'ИИ отбился';
    return 'Разбор раунда: ' + who + ', ' + r.cards + ' карт ушли в «бито». Теперь атакует ' + next + '. Добор: ты +' + r.drawn.player + ', ИИ +' + r.drawn.ai + '.';
  }

  function handleEvent(ev) {
    if (!ev) return;
    const t = evText(ev);
    if (t) addLog(t);
    if (ev.who === 'ai') {
      ui.lastAI = whyText(ev);
      ui.aiStatus = ev.type === 'attack' || ev.type === 'throwin' ? 'Атакует' : ev.type === 'defend' || ev.type === 'transfer' ? 'Защищается' : ev.type === 'take' ? 'Берёт карты' : 'Бито';
    }
    if (ev.type === 'attack' || ev.type === 'throwin' || ev.type === 'transfer') Sound.play('place');
    else if (ev.type === 'defend') Sound.play('defend');
    else if (ev.type === 'take') Sound.play('take');
    else if (ev.type === 'pass') Sound.play(ev.round && ev.round.took ? 'take' : 'defend');
    if (ev.who === 'ai' && t) say(t + '. Нажми «Почему ИИ так походил?», чтобы узнать причину.');
    if (ev.type === 'take' && ev.who === 'player') say('Ты берёшь карты. Теперь ИИ может подкинуть ещё карты, после чего ты получишь всё со стола.');
    if (ev.type === 'pass' && ev.round) {
      say(roundReview(ev.round));
      if (ev.round.over) addLog('Колода и карты закончились — партия окончена.');
    }
  }

  /* ---------- Основной цикл ---------- */
  function tick() {
    clearTimeout(ui.timer); ui.timer = null; ui.pending = false;
    if (!game) return;
    if (game.over) { renderAll(); finishGame(); return; }
    const act = C.actor(game);
    if (act === 'ai' && !ui.paused) { ui.pending = true; ui.aiStatus = 'Думает…'; }
    renderAll(); persist();
    if (ui.paused) return;
    if (act === 'player' && game.attacker === 'player' && C.needsAutoEnd(game)) {
      const msg = game.taking ? 'Подкидывать больше нечего — карты уходят сопернику.' : 'Подкидывать нечего — раунд завершается.';
      say(msg);
      schedule(() => { const r = C.doPass(game, 'player'); if (r.ok) { handleEvent(r.ev); } tick(); }, 800);
      return;
    }
    if (act === 'ai') schedule(aiTurn, 650 + Math.random() * 450);
  }
  function aiTurn() {
    const ev = C.aiStep(game, +game.meta.difficulty, Math.random, 'ai');
    if (!ev || !ev.res.ok) { console.warn('ИИ не смог сходить', ev); tick(); return; }
    ui.selected = null; ui.target = null; ui.hint = [];
    handleEvent(ev);
    tick();
  }

  /* ---------- Действия игрока ---------- */
  const myTurn = () => game && !game.over && !ui.paused && C.actor(game) === 'player';
  function reject(reason, cardId) {
    toast(reason); Sound.play('error');
    say(reason, true);
    if (cardId) { const el = $('#hand [data-cid="' + cardId + '"]'); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } }
  }
  function afterPlayer(r) {
    ui.selected = null; ui.target = null; ui.hint = [];
    handleEvent(r.ev);
    tick();
  }
  function selectedCard() { return ui.selected ? C.findCard(game.hands.player, ui.selected) : null; }

  function playerPrimary() {
    if (!game || ui.paused || game.over) return;
    if (!myTurn()) { toast('Сейчас ход соперника.'); return; }
    const card = selectedCard();
    if (!card) { reject('Сначала выбери карту, коснувшись её.'); return; }
    if (game.turn === 'attacker') {
      const chk = C.canAttack(game, 'player', card);
      if (!chk.ok) { reject(chk.reason, card.id); return; }
      const first = game.table.length === 0;
      const legal = C.legalAttackCards(game, 'player');
      const minCost = Math.min.apply(null, legal.map((c) => C.cost(c, game.trump)));
      const nonTrumpExists = legal.some((c) => c.suit !== game.trump);
      const r = C.doAttack(game, 'player', card.id);
      if (!r.ok) { reject(r.reason, card.id); return; }
      if (settings.teach) {
        if (card.suit === game.trump && nonTrumpExists) setTimeout(() => say('Осторожно: ты потратил козырь, хотя были карты без козыря. Козыри лучше беречь для защиты.'), 0);
        else if (C.cost(card, game.trump) === minCost && first) setTimeout(() => say('Хороший ход: ' + fmt(card) + ' — самая дешёвая из доступных карт, старшие остаются на потом.'), 0);
      }
      afterPlayer(r);
      if (settings.teach && !(card.suit === game.trump && nonTrumpExists) && !(C.cost(card, game.trump) === minCost && first)) say('Ты ' + (first ? 'атаковал' : 'подкинул') + ' ' + fmt(card) + '. Теперь ИИ должен побить её или взять карты.');
      return;
    }
    // защита
    const unb = [];
    game.table.forEach((p, i) => { if (!p.defense) unb.push(i); });
    let idx = ui.target;
    if (idx == null || !game.table[idx] || game.table[idx].defense || !C.beats(game.table[idx].attack, card, game.trump)) {
      idx = unb.find((i) => C.beats(game.table[i].attack, card, game.trump));
    }
    if (idx == null) {
      const chk = C.canDefend(game, 'player', unb[0], card);
      reject(chk.reason || 'Этой картой нельзя отбиться.', card.id); return;
    }
    doDefendAt(idx, card);
  }
  function doDefendAt(idx, card) {
    const att = game.table[idx].attack;
    const options = game.hands.player.filter((c) => C.beats(att, c, game.trump));
    const minC = Math.min.apply(null, options.map((c) => C.cost(c, game.trump)));
    const cheaper = options.filter((c) => C.cost(c, game.trump) === minC)[0];
    const r = C.doDefend(game, 'player', idx, card.id);
    if (!r.ok) { reject(r.reason, card.id); return; }
    afterPlayer(r);
    if (settings.teach) {
      if (C.cost(card, game.trump) === minC) say('Хороший ход: ты побил ' + fmt(att) + ' младшей из подходящих карт (' + fmt(card) + ').');
      else if (card.suit === game.trump && cheaper && cheaper.suit !== game.trump) say('Можно было побить ' + fmt(att) + ' картой ' + fmt(cheaper) + ' без траты козыря. Козыри полезны на потом.');
      else say('Побито: ' + fmt(att) + ' ← ' + fmt(card) + '. Можно было экономнее, но защита засчитана.');
    }
  }
  function playerTransfer() {
    if (!myTurn()) return;
    const card = selectedCard();
    if (!card) { reject('Выбери карту того же достоинства, что и атакующие карты.'); return; }
    const r = C.doTransfer(game, 'player', card.id);
    if (!r.ok) { reject(r.reason, card.id); return; }
    afterPlayer(r);
    say('Ты перевёл атаку: теперь ИИ должен отбиваться от ' + game.table.length + ' карт(ы).');
  }
  async function playerTake() {
    if (!myTurn()) return;
    if (!(game.turn === 'defender' && C.defender(game) === 'player')) { toast('Сейчас нельзя брать карты.'); return; }
    if (settings.teach) {
      const obs = C.makeObs(game, 'player');
      const unb = []; game.table.forEach((p, i) => { if (!p.defense) unb.push(i); });
      const plan = C.findPlan(obs, unb, (c) => C.cost(c, game.trump));
      if (plan && !plan.some((x) => x.card.suit === game.trump)) {
        const okTake = await confirmBox('Точно взять карты?', 'Ты можешь отбиться без козырей: ' + plan.map((x) => fmt(game.table[x.idx].attack) + ' ← ' + fmt(x.card)).join(', ') + '. Обычно это выгоднее, чем набирать карты.', 'Всё равно взять');
        if (!okTake) return;
        if (!myTurn()) return;
      }
    }
    const r = C.doTake(game, 'player');
    if (!r.ok) { reject(r.reason); return; }
    afterPlayer(r);
  }
  function playerEnd() {
    if (!myTurn()) { toast('Сейчас ход соперника.'); return; }
    if (game.turn !== 'attacker' || game.attacker !== 'player') { toast('Ты защищаешься: отбейся или возьми карты. Когда всё побито, раунд завершит атакующий.'); return; }
    const r = C.doPass(game, 'player');
    if (!r.ok) { reject(r.reason); return; }
    afterPlayer(r);
  }
  function onHandCard(id) {
    if (!game || ui.paused) return;
    ui.selected = ui.selected === id ? null : id;
    ui.target = null; ui.hint = [];
    const card = selectedCard();
    if (card && settings.teach) {
      if (myTurn() && game.turn === 'attacker') {
        const legal = C.legalAttackCards(game, 'player');
        if (!legal.some((c) => c.id === card.id)) say('Этой картой сейчас ходить нельзя: ' + C.canAttack(game, 'player', card).reason);
        else if (card.suit === game.trump && legal.some((c) => c.suit !== game.trump)) say('Это козырь. Лучше сначала ходить картами без козыря, а козыри беречь.');
      } else if (myTurn() && game.turn === 'defender') {
        const can = game.table.map((p, i) => (!p.defense && C.beats(p.attack, card, game.trump) ? fmt(p.attack) : null)).filter(Boolean);
        say(can.length ? fmt(card) + ' может побить: ' + can.join(', ') + '. Нажми «Отбить».' : fmt(card) + ' не бьёт ни одну из атакующих карт.');
      }
    }
    renderAll();
  }
  function onTablePair(idx) {
    const card = selectedCard();
    const p = game.table[idx];
    if (card && myTurn() && game.turn === 'defender' && p && !p.defense) {
      const chk = C.canDefend(game, 'player', idx, card);
      if (!chk.ok) { reject(chk.reason, card.id); return; }
      doDefendAt(idx, card);
    }
  }

  /* ---------- Подсказки и объяснения ---------- */
  function doHint() {
    if (!game) return;
    const h = C.getHint(game, 'player');
    ui.hint = h.ids || [];
    say(h.text, true, true);
    renderAll();
  }
  function legalExplanation() {
    if (!myTurn()) return 'Сейчас ход соперника — подсвечивать нечего.';
    const parts = [];
    if (game.turn === 'attacker') {
      const legal = C.legalAttackCards(game, 'player');
      if (!legal.length) return game.taking ? 'Подходящих карт для подкидывания нет — нажми «Завершить ход».' : 'Подходящих карт для подкидывания нет — нажми «Бито».';
      legal.forEach((c) => {
        parts.push(fmt(c) + (game.table.length === 0 ? ' — можно сходить любой картой' : ' — достоинство ' + C.RANK_LABEL[c.rank] + ' уже есть на столе'));
      });
      return 'Подсвечены карты, которыми можно ' + (game.table.length === 0 ? 'атаковать' : 'подкинуть') + ': ' + parts.join('; ') + '.';
    }
    const pairs = C.legalDefensePairs(game, 'player');
    const tr = C.legalTransfers(game, 'player');
    if (!pairs.length && !tr.length) return 'Подходящих карт нет: нечем отбиться. Нужно нажать «Взять карты».';
    pairs.forEach((p) => parts.push(fmt(p.card) + ' бьёт ' + fmt(game.table[p.idx].attack)));
    tr.forEach((c) => parts.push(fmt(c) + ' — можно перевести'));
    return 'Подсвечены карты для защиты: ' + parts.join('; ') + '.';
  }

  function explainKey(key) {
    const t = game ? game.trump : 'S';
    const sym = C.SUIT_SYM[t];
    const iAmAtt = game && game.attacker === 'player';
    let m;
    const k = key.split(':');
    switch (k[0]) {
      case 'trump': m = 'Это козырь (' + C.SUIT_NAME[t] + ' ' + sym + '). Козырная карта обычно бьёт любую некозырную карту независимо от её достоинства. Но козырь можно побить только более старшим козырем. Не трать его без необходимости! Открытая карта достанется тому, кто последним возьмёт из колоды.'; break;
      case 'deck': m = 'Это колода добора. После окончания раунда игроки добирают карты до шести, пока колода не закончится. Первым добирает атакующий, затем защитник. Осталось ' + (game ? game.deck.length : 0) + ' карт.'; break;
      case 'discard': m = 'Это «бито» — карты, ушедшие из игры. Их больше нельзя использовать, но можно запомнить: сложный ИИ следит за ними. Сейчас там ' + (game ? game.discard.length : 0) + ' карт.'; break;
      case 'ai-hand': m = 'Это карты ИИ, их не видно до конца партии. Ты знаешь только их количество (' + (game ? game.hands.ai.length : 0) + '). ИИ тоже не видит твои карты — он знает лишь те, что ты брал со стола.'; break;
      case 'ai-status': m = 'Здесь показано, что сейчас делает ИИ: «Думает…», «Атакует», «Защищается», «Берёт карты».'; break;
      case 'player-hand': m = 'Это твои карты. Коснись карты, чтобы выбрать её, затем нажми нужную кнопку справа/внизу. Козыри отмечены золотом и звёздочкой.'; break;
      case 'table': m = 'Это игровой стол. Слева — атакующие карты, поверх них ложатся карты защиты. Пустая рамка — место для карты защиты.'; break;
      case 'stage': m = 'Здесь описан текущий этап партии: кто ходит и что можно сделать сейчас.'; break;
      case 'btn-attack': m = iAmAtt || !game || game.turn === 'attacker'
        ? 'Кнопка «Атаковать/Подкинуть» кладёт выбранную карту на стол. Первой картой можно ходить любой; подкидывать — только достоинства, уже лежащие на столе, в пределах лимита.'
        : 'Когда ты защищаешься, эта кнопка называется «Отбить»: выбери карту той же масти старше атакующей или козырь и нажми её. Можно также коснуться атакующей карты на столе.'; break;
      case 'btn-transfer': m = 'Перевод: пока ты не побил ни одной карты, можно положить карту того же достоинства — атака «переходит» к сопернику. Работает только в переводном режиме.'; break;
      case 'btn-end': m = iAmAtt
        ? 'Эта кнопка завершает атаку («Бито»), когда всё побито и подкидывать не хочется. Если соперник берёт карты, она называется «Завершить ход».'
        : 'Эта кнопка завершает защиту, когда все атакующие карты побиты. Но в подкидном режиме решение «бито» принимает атакующий — после твоей защиты он подкинет ещё или завершит раунд.'; break;
      case 'btn-take': m = 'Если ты не можешь или не хочешь отбиваться, можно забрать карты со стола. После этого ты получишь их в руку и пропустишь свою атаку. В некоторых ситуациях это выгоднее, чем тратить сильные карты и козыри.'; break;
      case 'btn-hint': m = 'Подсказка анализирует твои реальные карты и стол и советует законный ход с объяснением.'; break;
      case 'btn-helper': m = 'Открывает панель помощника: подсказки, объяснения, журнал действий и краткие правила.'; break;
      case 'btn-pause': m = 'Пауза останавливает ИИ и открывает меню: продолжить, начать заново, настройки.'; break;
      case 'btn-explain': m = 'Нажми эту кнопку, затем коснись любой карты, кнопки или зоны стола — я объясню, что это.'; break;
      case 'hand': {
        const c = C.findCard(game.hands.player, k[1]); if (!c) { m = 'Это твоя карта.'; break; }
        m = cardName(c) + (c.suit === t ? ' — козырь. Бьёт любую некозырную карту, но её можно побить только старшим козырем; не трать без необходимости. ' : '. ');
        if (game.turn === 'attacker' && iAmAtt) m += game.table.length ? 'Её можно подкинуть, если такое достоинство уже лежит на столе.' : 'Ею можно атаковать; младшие карты без козыря — лучший выбор для атаки.';
        else if (game.turn === 'defender' && !iAmAtt) {
          const can = game.table.map((p) => (!p.defense && C.beats(p.attack, c, t) ? fmt(p.attack) : null)).filter(Boolean);
          m += can.length ? 'Сейчас ею можно побить: ' + can.join(', ') + '.' : 'Сейчас ею нельзя ничего побить.';
        } else m += 'Сейчас она не нужна — подожди своего хода.';
        break;
      }
      case 'att': {
        const p = game.table[+k[1]]; if (!p) { m = 'Это атакующая карта.'; break; }
        const mine = game.attacker === 'player';
        if (mine) m = 'Это твоя атакующая карта (' + fmt(p.attack) + '). Соперник должен побить её картой той же масти старше' + (p.attack.suit === t ? '' : ' или козырем') + ', иначе возьмёт карты.';
        else m = 'Эта карта атакует тебя (' + fmt(p.attack) + '). Чтобы отбиться, используй карту той же масти более высокого достоинства' + (p.attack.suit === t ? ' — козырь можно побить только старшим козырем.' : ' или козырь, если атакующая карта не является козырем.');
        break;
      }
      case 'def': {
        const p = game.table[+k[1]]; m = p && p.defense ? 'Это карта защиты: ' + fmt(p.defense) + ' побила ' + fmt(p.attack) + '. Побитые пары остаются на столе до конца раунда.' : 'Свободное место для карты защиты.'; break;
      }
      default: m = 'Это элемент игры. Коснись карты, кнопки, козыря или колоды, чтобы узнать подробности.';
    }
    say(m, true, true);
  }
  function keyFor(target) {
    const c = target.closest && target.closest('.card[data-cid]');
    if (c) {
      if (c.closest('#hand')) return 'hand:' + c.dataset.cid;
      if (c.closest('#table')) { const pair = c.closest('.pair'); return (c.classList.contains('def') ? 'def:' : 'att:') + (pair ? pair.dataset.idx : 0); }
      if (c.closest('#trump-slot')) return 'trump';
    }
    const pair = target.closest && target.closest('.pair');
    if (pair) return 'def:' + pair.dataset.idx;
    const d = target.closest && target.closest('[data-explain]');
    return d ? d.dataset.explain : null;
  }
  function setExplain(on) {
    ui.explain = on; document.body.classList.toggle('explain-on', on);
    $('#h-explain').classList.toggle('active-toggle', on);
    if (on) say('Режим объяснений включён: коснись карты, кнопки, колоды или козыря — и я расскажу, что это.', true, true);
  }

  /* ---------- Отрисовка ---------- */
  function cardEl(c, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    const red = c.suit === 'H' || c.suit === 'D';
    const isT = game && c.suit === game.trump;
    el.className = 'card ' + (red ? 'red' : 'black') + (isT ? ' trump' : '');
    if (!opts.noId) el.dataset.cid = c.id;
    const r = C.RANK_LABEL[c.rank], s = C.SUIT_SYM[c.suit];
    el.innerHTML = '<span class="face"><span class="idx tl"><b>' + r + '</b><i>' + s + '</i></span><span class="pip">' + s + '</span><span class="idx br"><b>' + r + '</b><i>' + s + '</i></span>' + (isT ? '<span class="tstar">★</span>' : '') + '</span>';
    el.setAttribute('aria-label', cardName(c) + (isT ? ', козырь' : ''));
    return el;
  }
  function backEl() { const el = document.createElement('div'); el.className = 'card back'; return el; }

  function snap() {
    const m = new Map();
    $$('#screen-game [data-cid]').forEach((e) => m.set(e.dataset.cid, e.getBoundingClientRect()));
    return m;
  }
  function flip(prev) {
    if (reduce() || !prev) return;
    const deckR = $('#deck').getBoundingClientRect(), aiR = $('#ai-hand').getBoundingClientRect();
    let n = 0;
    $$('#screen-game [data-cid]').forEach((e) => {
      const r = e.getBoundingClientRect(); if (!r.width) return;
      let from = prev.get(e.dataset.cid), delay = 0;
      if (!from) {
        if (e.closest('#table')) { from = { left: aiR.left + aiR.width / 2 - r.width / 2, top: aiR.top }; e.classList.add('reveal'); }
        else if (e.closest('#hand')) { from = { left: deckR.left, top: deckR.top }; delay = (n++) * 70; }
        else return;
      }
      const dx = from.left - r.left, dy = from.top - r.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      try { e.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }], { duration: 380, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }); } catch (err) { /* ignore */ }
    });
  }

  function sortedHand() {
    const t = game.trump;
    return game.hands.player.slice().sort((a, b) => ((a.suit === t) - (b.suit === t)) || (a.suit < b.suit ? -1 : a.suit > b.suit ? 1 : 0) || a.rank - b.rank);
  }
  function legalIds() {
    const ids = new Set();
    if (!myTurn()) return ids;
    if (game.turn === 'attacker') C.legalAttackCards(game, 'player').forEach((c) => ids.add(c.id));
    else { C.legalDefensePairs(game, 'player').forEach((p) => ids.add(p.card.id)); C.legalTransfers(game, 'player').forEach((c) => ids.add(c.id)); }
    return ids;
  }

  function layoutHand() {
    const handEl = $('#hand'); if (!handEl || !game) return;
    const cards = $$('.card', handEl);
    if (!cards.length) return;
    const rowsOld = $$('.hand-row', handEl);
    const list = rowsOld.length ? [].concat.apply([], rowsOld.map((r) => $$('.card', r))) : cards;
    handEl.innerHTML = '';
    const probe = list[0];
    const holder = document.createElement('div'); holder.className = 'hand-row'; holder.appendChild(probe); handEl.appendChild(holder);
    const cw = probe.offsetWidth || 60;
    const W = Math.max(handEl.clientWidth - 8, cw);
    const minStep = cw * 0.46;
    const maxPer = Math.max(1, Math.floor((W - cw) / minStep) + 1);
    const rowsN = Math.ceil(list.length / maxPer), per = Math.ceil(list.length / rowsN);
    handEl.innerHTML = '';
    for (let r = 0; r < rowsN; r++) {
      const row = document.createElement('div'); row.className = 'hand-row';
      const part = list.slice(r * per, (r + 1) * per);
      const step = part.length > 1 ? Math.min(cw + 6, (W - cw) / (part.length - 1)) : 0;
      part.forEach((c, i) => { c.style.marginLeft = i === 0 ? '0' : (step - cw) + 'px'; row.appendChild(c); });
      handEl.appendChild(row);
    }
  }
  function updateHandVar() {
    const pz = $('.player-zone'); if (pz) document.documentElement.style.setProperty('--hand-h', pz.offsetHeight + 'px');
  }

  function renderTop() {
    $('#ai-diff').textContent = LEVELS[game.meta.difficulty];
    $('#ai-count').textContent = game.hands.ai.length;
    const st = game.over ? 'Партия окончена' : (ui.pending ? 'Думает…' : (ui.aiStatus || (C.actor(game) === 'ai' ? 'Ходит…' : 'Ждёт твоего хода')));
    $('#ai-status').textContent = st;
    $('#ai-avatar').classList.toggle('think', ui.pending);
    const wrap = $('#ai-hand'); wrap.innerHTML = '';
    const n = game.hands.ai.length;
    const show = Math.min(n, 14);
    for (let i = 0; i < show; i++) {
      const el = game.over ? cardEl(game.hands.ai[i], { noId: true }) : backEl();
      if (i) el.style.marginLeft = 'calc(var(--cw) * -.55)';
      wrap.appendChild(el);
    }
    $('#p-count').textContent = game.hands.player.length;
  }
  function renderFelt() {
    const t = game.trump;
    $('#deck-count').textContent = game.deck.length;
    $('#deck-back').style.visibility = game.deck.length > 1 ? 'visible' : 'hidden';
    const slot = $('#trump-slot'); slot.innerHTML = '';
    if (game.deck.length > 0) slot.appendChild(cardEl(game.trumpCard, { noId: true }));
    const tb = $('#trump-badge'); $('#trump-sym').textContent = C.SUIT_SYM[t]; tb.classList.toggle('red', t === 'H' || t === 'D');
    $('#discard-count').textContent = game.discard.length;
    const table = $('#table'); table.innerHTML = '';
    table.classList.toggle('empty', game.table.length === 0);
    const sel = selectedCard();
    game.table.forEach((p, i) => {
      const pair = document.createElement('div'); pair.className = 'pair'; pair.dataset.idx = i;
      const a = cardEl(p.attack); a.classList.add('att'); pair.appendChild(a);
      if (p.defense) { const d = cardEl(p.defense); d.classList.add('def'); pair.appendChild(d); }
      else {
        const s = document.createElement('div'); s.className = 'slot'; pair.appendChild(s);
        if (sel && myTurn() && game.turn === 'defender' && C.beats(p.attack, sel, t)) pair.classList.add('target');
      }
      pair.onclick = (e) => { e.stopPropagation(); onTablePair(i); };
      table.appendChild(pair);
    });
    $('#stage').textContent = stageText();
  }
  function stageText() {
    if (game.over) return game.winner === 'player' ? 'Ты победил!' : game.winner === 'ai' ? 'ИИ победил' : 'Ничья';
    const act = C.actor(game), unb = C.unbeatenCount(game);
    if (ui.paused) return 'Пауза';
    if (act === 'player') {
      if (game.turn === 'attacker') {
        if (game.table.length === 0) return 'Твой ход: выбери карту и нажми «Атаковать»';
        if (game.taking) return 'ИИ берёт карты — можешь подкинуть ещё или завершить ход';
        return 'ИИ отбился. Подкинь карту или нажми «Бито»';
      }
      return 'Отбивайся: выбери карту → «Отбить», или «Взять карты» (осталось побить: ' + unb + ')';
    }
    if (game.turn === 'attacker') return game.table.length === 0 ? 'ИИ выбирает атаку…' : (game.taking ? 'Ты берёшь карты — ИИ решает, подкидывать ли' : 'Ты отбился — ИИ решает: подкинуть или «бито»');
    return 'ИИ защищается…';
  }
  function renderHand() {
    const handEl = $('#hand'); handEl.innerHTML = '';
    const legal = legalIds();
    const hl = settings.autoHL || ui.showLegal;
    sortedHand().forEach((c) => {
      const el = cardEl(c);
      if (ui.selected === c.id) el.classList.add('selected');
      if (hl && myTurn()) el.classList.add(legal.has(c.id) ? 'playable' : 'dim');
      if (ui.hint.indexOf(c.id) >= 0) el.classList.add('hint');
      el.onclick = (e) => { e.stopPropagation(); if (ui.explain) return; onHandCard(c.id); };
      handEl.appendChild(el);
    });
    layoutHand();
  }
  function renderControls() {
    const mine = myTurn();
    const A = $('#b-attack'), E = $('#b-end'), T = $('#b-take'), X = $('#b-transfer');
    const iAtt = game.attacker === 'player';
    const defTurn = game.turn === 'defender' && !iAtt;
    if (defTurn) { A.textContent = 'Отбить'; A.disabled = !mine; }
    else { A.textContent = game.table.length ? 'Подкинуть' : 'Атаковать'; A.disabled = !(mine && iAtt && game.turn === 'attacker'); }
    T.hidden = !(mine && defTurn && !game.taking && C.unbeatenCount(game) > 0);
    X.hidden = !(mine && defTurn && game.mode === 'perevodnoy' && game.table.length > 0 && game.table.every((p) => !p.defense));
    if (game.taking) { E.textContent = 'Завершить ход'; E.disabled = !(mine && iAtt && game.turn === 'attacker'); }
    else { E.textContent = 'Бито'; E.disabled = !(mine && iAtt && game.turn === 'attacker' && game.table.length > 0 && C.unbeatenCount(game) === 0); }
    $('#b-hint').disabled = !mine;
    $('#b-pause').disabled = !!game.over;
    $('#h-legal').classList.toggle('active-toggle', ui.showLegal);
  }
  function renderAll() {
    if (!game) return;
    const prev = snap();
    renderTop(); renderFelt(); renderHand(); renderControls(); renderLog();
    requestAnimationFrame(updateHandVar);
    flip(prev);
  }

  /* ---------- Конец партии ---------- */
  function finishGame() {
    if (game.statsDone) return;
    game.statsDone = true;
    try { localStorage.removeItem(KEY_GAME); } catch (e) { /* ignore */ }
    ui.lastSeed = { deckOrder: game.seedDeck.slice(), firstAttacker: game.firstAttacker, mode: game.mode, level: +game.meta.difficulty };
    const w = game.winner;
    stats.played++;
    if (w === 'player') { stats.wins++; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); }
    else if (w === 'ai') { stats.losses++; stats.streak = 0; }
    else stats.draws++;
    const newAch = [];
    const grant = (id) => { if (!stats.achievements[id]) { stats.achievements[id] = true; newAch.push(ACH.find((a) => a.id === id)); } };
    if (w === 'player') { grant('first_win'); if (+game.meta.difficulty === 3) grant('hard_win'); if (stats.streak >= 3) grant('streak3'); }
    if (stats.played >= 10) grant('games10');
    saveStats(); applyTheme();
    addLog(w === 'player' ? 'Ты выиграл партию!' : w === 'ai' ? 'ИИ выиграл партию.' : 'Ничья.');
    Sound.play(w === 'player' ? 'win' : w === 'ai' ? 'lose' : 'defend');
    setTimeout(() => showResult(w, newAch), reduce() ? 100 : 900);
  }
  function confetti() {
    if (reduce()) return;
    const em = ['🎉', '✨', '🃏', '⭐', '♠', '♥', '♦', '♣'];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement('span'); s.className = 'confetti'; s.textContent = em[i % em.length];
      s.style.left = Math.random() * 100 + 'vw'; s.style.animationDuration = 2 + Math.random() * 2.5 + 's'; s.style.animationDelay = Math.random() * 0.8 + 's';
      document.body.appendChild(s); setTimeout(() => s.remove(), 5500);
    }
  }
  function showResult(w, newAch) {
    const cls = w === 'player' ? 'win' : w === 'ai' ? 'lose' : '';
    const title = w === 'player' ? '🏆 Победа!' : w === 'ai' ? '😔 Поражение' : '🤝 Ничья';
    const sub = w === 'player' ? 'ИИ остался «дураком». Отличная игра!' : w === 'ai' ? 'Ты остался «дураком». Попробуй ещё — помощник поможет.' : 'Оба игрока закончили одновременно.';
    const left = game.hands.ai.length ? '<p style="text-align:center">Карты ИИ:</p><div class="ai-reveal" id="rv"></div>' : '';
    openModal('<div class="result ' + cls + '"><div class="result-title">' + title + '</div><p style="text-align:center">' + sub + '</p>' + left +
      (newAch.length ? '<h3>Новые достижения</h3>' + newAch.map((a) => '<div class="ach"><span style="font-size:1.6rem">' + a.ic + '</span><div><b>' + a.t + '</b><br><small>' + a.d + '</small></div></div>').join('') : '') +
      '<p style="text-align:center;color:var(--muted)">Побед: ' + stats.wins + ' из ' + stats.played + ' · Серия: ' + stats.streak + '</p></div>' +
      '<div class="btns"><button class="btn primary" id="r-again">Сыграть ещё</button><button class="btn" id="r-replay">Повторить партию</button><button class="btn" id="r-menu">В меню</button></div>',
      (box) => {
        const rv = $('#rv', box); if (rv) game.hands.ai.forEach((c) => rv.appendChild(cardEl(c, { noId: true })));
        $('#r-again', box).onclick = () => { closeModal(); startGame(ui.lastSeed.level, {}); };
        $('#r-replay', box).onclick = () => { closeModal(); startGame(ui.lastSeed.level, { deckOrder: ui.lastSeed.deckOrder, firstAttacker: ui.lastSeed.firstAttacker, mode: ui.lastSeed.mode }); };
        $('#r-menu', box).onclick = () => { closeModal(); goMenu(); };
      });
    if (w === 'player') confetti();
  }
  function goMenu() {
    ui.gen++; clearTimeout(ui.timer); ui.paused = false;
    showScreen('screen-menu');
    $('#m-continue').hidden = !loadSaved();
    applyTheme();
  }

  /* ---------- Пауза и новая игра ---------- */
  function openPause() {
    if (!game || game.over) return;
    ui.paused = true; clearTimeout(ui.timer); renderAll();
    openModal('<h2>⏸ Пауза</h2><div class="btns" style="flex-direction:column"><button class="btn primary" id="p-resume">▶ Продолжить</button><button class="btn" id="p-new">🔄 Новая партия</button><button class="btn" id="p-set">⚙ Настройки</button><button class="btn" id="p-rules">📖 Правила</button><button class="btn" id="p-menu">🏠 В меню</button></div>',
      (box) => {
        $('#p-resume', box).onclick = closeModal;
        $('#p-new', box).onclick = async () => { ui.paused = false; closeModal(); await newGameConfirm(); };
        $('#p-set', box).onclick = () => { showSettings(); ui.modalClose = () => openPause(); };
        $('#p-rules', box).onclick = () => { showRules(); ui.modalClose = () => openPause(); };
        $('#p-menu', box).onclick = () => { ui.paused = false; ui.modalClose = null; closeModal(); persist(); goMenu(); };
      },
      () => { ui.paused = false; renderAll(); tick(); });
  }
  async function newGameConfirm() {
    const ok = await confirmBox('Начать новую партию?', 'Текущая партия будет потеряна.', 'Новая партия');
    if (ok) startGame(+game.meta.difficulty, {});
    else if (game && !game.over) tick();
  }

  /* ---------- Привязка событий ---------- */
  function bind() {
    $('#m-theme').onclick = () => { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; saveSettings(); applyTheme(); };
    $('#m-sound').onclick = () => { settings.sound = !settings.sound; saveSettings(); applyTheme(); Sound.unlock(); Sound.play('place'); };
    $('#m-stats').onclick = showStats;
    $('#m-play').onclick = () => { ui.chosenLevel = settings.difficulty || 2; markLevel(); showScreen('screen-diff'); };
    $('#m-continue').onclick = restoreGame;
    $('#m-learn').onclick = showLessons;
    $('#m-rules').onclick = showRules;
    $('#m-settings').onclick = showSettings;
    $$('.chip[data-mode]').forEach((c) => { c.onclick = () => { settings.mode = c.dataset.mode; saveSettings(); applyTheme(); }; });
    $('#d-back').onclick = () => showScreen('screen-menu');
    $$('.diff-card').forEach((c) => { c.onclick = () => { ui.chosenLevel = +c.dataset.level; markLevel(); }; });
    $('#d-start').onclick = () => startGame(ui.chosenLevel, {});

    $('#b-attack').onclick = playerPrimary;
    $('#b-transfer').onclick = playerTransfer;
    $('#b-end').onclick = playerEnd;
    $('#b-take').onclick = playerTake;
    $('#b-hint').onclick = doHint;
    $('#b-helper').onclick = () => $('#screen-game').classList.toggle('helper-open');
    $('#b-pause').onclick = openPause;
    $('#h-close').onclick = () => $('#screen-game').classList.remove('helper-open');
    $('#assist-mini').onclick = () => $('#screen-game').classList.add('helper-open');
    $('#h-explain').onclick = () => setExplain(!ui.explain);
    $('#h-why').onclick = () => { say(ui.lastAI ? ui.lastAI : 'ИИ ещё не делал ходов в этой партии.', true, true); };
    $('#h-legal').onclick = () => {
      ui.showLegal = !ui.showLegal;
      renderAll();
      say(ui.showLegal ? legalExplanation() : 'Подсветка выключена' + (settings.autoHL ? ' вручную, но автоподсветка в настройках остаётся включённой.' : '.'), true, true);
    };
    $('#h-rules').onclick = showRules;
    $('#h-new').onclick = () => { if (game) newGameConfirm(); };

    // режим «Что это значит?»: перехватываем нажатия до обычных обработчиков
    $('#screen-game').addEventListener('click', (e) => {
      if (!ui.explain) return;
      if (e.target.closest('#h-explain')) return;
      if (e.target.closest('.helper')) return;
      const key = keyFor(e.target);
      if (!key) return;
      e.stopPropagation(); e.preventDefault();
      explainKey(key); setExplain(false);
    }, true);

    let rz = null;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (game) { layoutHand(); updateHandVar(); } }, 120); });
    window.addEventListener('orientationchange', () => setTimeout(() => { if (game) { layoutHand(); updateHandVar(); } }, 250));
    document.addEventListener('visibilitychange', () => { if (document.hidden && game && !game.over) persist(); });
  }
  function markLevel() {
    $$('.diff-card').forEach((c) => c.classList.toggle('sel', +c.dataset.level === ui.chosenLevel));
  }

  /* ---------- Инициализация ---------- */
  function init() {
    applyTheme(); bind();
    $('#m-continue').hidden = !loadSaved();
    // тестовый доступ для автоматических проверок
    window.__durak = { get game() { return game; }, ui, startGame, settings };
  }
  init();
})();
