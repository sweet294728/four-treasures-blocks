(() => {
  const names = { d: 'D', k: 'K', e: 'E', c: 'C' };
  const board = document.getElementById('board'), overlay = document.getElementById('overlay');
  const pairsEl = document.getElementById('pairs'), timeEl = document.getElementById('time'), movesEl = document.getElementById('moves');
  const announcement = document.getElementById('announcement');
  const difficultyButtons = [...document.querySelectorAll('.difficulty-button')];
  const setupPanel = document.getElementById('setup-panel'), resultPanel = document.getElementById('result-panel');
  const levels = { 4: { pairs: 8, seconds: 60 }, 6: { pairs: 18, seconds: 60 }, 8: { pairs: 32, seconds: 60 } };
  let paused = false, pausedAt = 0;
  let size = 4, goldenNext = false, goldenMode = false, resultScore = 0, resultSize = 4, runId = 0, rankSaved = false, rankSubmitting = false, rankingOrigin = 'setup', rankRequest = 0;
  function level() { return levels[size]; }
  function bestKey() { return size === 4 ? 'dkec-memory-best' : 'dkec-memory-best-' + size; }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cards = [], open = [], matched = 0, moves = 0, startedAt = 0, timer = null, mismatch = null, dealTimer = null, finishTimer = null, running = false, dealing = false, soundOn = true, audio = null;
  function best() { try { return localStorage.getItem(bestKey()); } catch { return null; } }
  function showBest() { const value = best(); document.getElementById('best').textContent = value !== null ? `最佳紀錄：${value} 秒` : '完成遊戲後，就能留下最佳紀錄'; }
  function sound(notes) {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      notes.forEach(([frequency, offset, duration]) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + offset;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.075, start + .012); gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start + duration);
      });
    } catch { /* Sound is optional. */ }
  }
  // Original, gently looping chiptune; sound effects keep their own volume and toggle.
  let musicOn = true, musicTimer = null, musicBus = null, musicStep = 0, musicNext = 0, musicStarted = false;
  const tune = [659,784,880,784,659,587,523,587, 659,784,988,880,784,659,587,0, 523,659,784,659,587,523,494,523, 587,659,784,659,587,523,494,0];
  const bass = [131,131,196,196, 220,220,196,196, 175,175,131,131, 147,147,196,196];
  function stopMusic() {
    clearInterval(musicTimer); musicTimer = null;
    if (musicBus && audio) { try { musicBus.gain.cancelScheduledValues(audio.currentTime); musicBus.gain.setValueAtTime(0, audio.currentTime); } catch {} musicBus.disconnect(); musicBus = null; }
  }
  function musicNote(freq, at, duration, type, volume) {
    if (!freq || !musicBus) return;
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(volume, at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(musicBus); osc.start(at); osc.stop(at + duration);
  }
  function scheduleMusic() {
    if (!audio || !musicBus) return;
    if (musicNext < audio.currentTime - .2) musicNext = audio.currentTime + .03;
    while (musicNext < audio.currentTime + .18) {
      musicNote(tune[musicStep % tune.length], musicNext, .19, 'square', .23);
      if (musicStep % 2 === 0) musicNote(bass[(musicStep / 2) % bass.length], musicNext, .31, 'triangle', .28);
      musicStep++; musicNext += .25;
    }
  }
  function startMusic() {
    if (!musicOn || musicTimer || document.hidden) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
      musicBus = audio.createGain(); musicBus.gain.value = .075; musicBus.connect(audio.destination);
      musicStep = 0; musicNext = audio.currentTime + .03; scheduleMusic(); musicTimer = setInterval(scheduleMusic, 100);
    } catch { stopMusic(); }
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function makeBoard() {
    board.replaceChildren();
    cards.forEach((card, i) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'card';
      button.style.setProperty('--deal-delay', `${Math.round(i * 675 / Math.max(1, cards.length - 1))}ms`);
      button.innerHTML = `<span class="card-inner"><span class="card-back"><span class="pixel-emblem" aria-hidden="true"></span></span><span class="card-face"><img src="assets/coarse-pixel-${card.id}.png" alt=""></span></span>`;
      button.addEventListener('click', () => flip(i)); board.append(button); card.button = button;
    });
    updateCards();
  }
  function updateCards() {
    cards.forEach((card, i) => {
      const button = card.button; button.classList.toggle('revealed', card.up || card.done); button.classList.toggle('matched', card.done);
      button.disabled = (!running && !dealing) || card.done;
      button.setAttribute('aria-label', card.up || card.done ? `${names[card.id]} 角色${card.done ? '，已配對' : ''}` : `卡片 ${i + 1}，尚未翻開`);
    });
  }
  function pulse(el, className) { el.classList.remove(className); void el.offsetWidth; el.classList.add(className); }
  function burst(button) {
    if (reduceMotion.matches) return;
    const wrap = document.createElement('span'); wrap.className = 'burst'; wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 8; i++) { const p = document.createElement('i'); p.style.setProperty('--angle', `${i * 45}deg`); p.style.setProperty('--color', ['#e89570', '#91c9b7', '#f0cb72', '#abc9e7'][i % 4]); wrap.append(p); }
    button.append(wrap); setTimeout(() => wrap.remove(), 700);
  }
  function stats() { pairsEl.innerHTML = `${matched} <em>/ ${level().pairs}</em>`; movesEl.textContent = moves; }
  function finish(win) {
    if (!running) return;
    running = false; clearInterval(timer); clearTimeout(mismatch);
    const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); timeEl.innerHTML = `${elapsed} <em>秒</em>`;
    if (win && (best() === null || elapsed < Number(best()))) { try { localStorage.setItem(bestKey(), String(elapsed)); } catch {} }
    const extraMoves = Math.max(0, moves - level().pairs);
    const score = (level().pairs * 100 + Math.max(0, level().pairs * 100 - elapsed * 5 - extraMoves * 20)) * (goldenMode ? 5 : 1);
    resultScore = score; resultSize = size; rankSaved = false; rankSubmitting = false;
    document.getElementById('rank-name').value = goldenMode ? 'DKEC' : ''; document.getElementById('rank-name').readOnly = goldenMode;
    document.getElementById('rank-submit').disabled = false; document.getElementById('rank-submit').textContent = '登錄';
    document.getElementById('rank-message').textContent = goldenMode ? '黃金模式：分數 ×5' : '';
    document.getElementById('result-score').textContent = score;
    document.getElementById('result-details').textContent = size + ' × ' + size + '　・　' + elapsed + ' 秒　・　' + moves + ' 次翻牌';
    setupPanel.hidden = true; resultPanel.hidden = false;
    document.getElementById('modal-label').textContent = win ? 'WELL DONE!' : 'TIME IS UP';
    document.getElementById('modal-title').textContent = win ? '太厲害了！' : '時間到囉！';
    document.getElementById('modal-text').textContent = win ? `你用了 ${elapsed} 秒、翻牌 ${moves} 次，找到所有夥伴！` : `找到 ${matched} 組，再試一次吧！`;
    document.getElementById('start').innerHTML = '再玩一次 <span>→</span>'; showBest(); updateCards();
    announcement.textContent = win ? '恭喜完成遊戲！' : '時間到，遊戲結束。';
    sound(win ? [[523,0,.15],[659,.12,.15],[784,.24,.3]] : [[330,0,.2],[247,.15,.3]]);
    finishTimer = setTimeout(() => { overlay.hidden = false; pulse(overlay.querySelector('.modal'), 'modal-pop'); }, win && !reduceMotion.matches ? 650 : 0);
  }
  function tick() { const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000)); timeEl.innerHTML = `${elapsed} <em>秒</em>`; }
  function flip(i) {
    if (!running || open.length === 2 || cards[i].up || cards[i].done) return;

    cards[i].up = true; open.push(i); updateCards(); sound([[440,0,.1]]);
    if (open.length !== 2) return;
    moves++; stats(); const [a, b] = open;
    if (cards[a].id === cards[b].id) {
      cards[a].done = cards[b].done = true; open = []; matched++; stats(); updateCards();
      [a,b].forEach(index => { pulse(cards[index].button, 'celebrate'); burst(cards[index].button); });
      pulse(pairsEl, 'stat-pop'); sound([[660,0,.12],[880,.09,.2]]); announcement.textContent = `找到一組 ${names[cards[a].id]}！`;
      if (matched === level().pairs) finish(true);
    } else {
      [a,b].forEach(index => pulse(cards[index].button, 'wrong')); sound([[300,.06,.12],[240,.18,.16]]);
      mismatch = setTimeout(() => { cards[a].up = cards[b].up = false; open = []; updateCards(); }, 850);
    }
  }
  function start() {
    musicStarted = true; startMusic();
    goldenMode = goldenNext; goldenNext = false; runId++; document.getElementById('golden-badge').hidden = !goldenMode;
    clearInterval(timer); clearTimeout(mismatch); clearTimeout(dealTimer); clearTimeout(finishTimer);
    paused = false; document.getElementById('pause-panel').hidden = true; document.getElementById('ranking-panel').hidden = true;
    running = false; dealing = true; cards = shuffle(Array.from({length: level().pairs}, (_, i) => ['d','k','e','c'][i % 4]).flatMap(id => [{id,up:false,done:false},{id,up:false,done:false}]));
    open = []; matched = 0; moves = 0; overlay.hidden = true; stats(); timeEl.innerHTML = '0 <em>秒</em>';   board.style.setProperty('--columns', size); makeBoard();
    board.classList.remove('dealing'); void board.offsetWidth; board.classList.add('dealing'); sound([[392,0,.1],[523,.08,.15]]);
    announcement.textContent = '正在發牌';
    dealTimer = setTimeout(() => { dealing = false; running = true; board.classList.remove('dealing'); startedAt = Date.now(); updateCards(); announcement.textContent = '發牌完成，開始遊戲'; timer = setInterval(tick, 200); }, reduceMotion.matches ? 0 : 1125);
  }
  const musicButton = document.getElementById('music');
  musicButton.addEventListener('click', () => {
    musicOn = !musicOn; musicButton.textContent = musicOn ? '音樂：開 ♫' : '音樂：關';
    musicButton.setAttribute('aria-pressed', String(musicOn));
    if (musicOn) { musicStarted = true; startMusic(); } else stopMusic();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMusic(); else if (musicStarted) startMusic(); });
  const soundButton = document.getElementById('sound');
  soundButton.addEventListener('click', () => { soundOn = !soundOn; soundButton.textContent = soundOn ? '音效：開 ♪' : '音效：關'; soundButton.setAttribute('aria-pressed', String(soundOn)); if (soundOn) sound([[523,0,.12]]); });
  document.getElementById('start').addEventListener('click', start); document.getElementById('restart').addEventListener('click', start);
  document.getElementById('play-again').addEventListener('click', start);
  document.getElementById('choose-again').addEventListener('click', () => chooseDifficulty());
  function chooseDifficulty(nextSize = size) {
    clearInterval(timer); clearTimeout(mismatch); clearTimeout(dealTimer); clearTimeout(finishTimer);
    paused = false; document.getElementById('pause-panel').hidden = true; document.getElementById('golden-badge').hidden = true;
    size = nextSize; difficultyButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.size) === size))); running = false; dealing = false; open = []; matched = 0; moves = 0;
    cards = Array.from({length:size * size}, () => ({id:'d',up:false,done:false}));
    board.style.setProperty('--columns', size); board.classList.remove('dealing'); board.dataset.size = size;
    stats(); timeEl.innerHTML = '0 <em>秒</em>'; makeBoard();
    document.getElementById('modal-label').textContent = 'READY TO PLAY?';
    document.getElementById('modal-title').textContent = '準備好了嗎？';
    document.getElementById('modal-text').textContent = `找出 ${level().pairs} 組相同的四寶，挑戰最快時間！`;
    document.getElementById('start').innerHTML = '開始遊戲 <span>→</span>';
    setupPanel.hidden = false; resultPanel.hidden = true; document.getElementById('ranking-panel').hidden = true; overlay.hidden = false; document.getElementById('golden-hint').hidden = !goldenNext; showBest();
  }
  const rankingPanel = document.getElementById('ranking-panel'), rankStatus = document.getElementById('rank-status'), rankList = document.getElementById('rank-list');
  let rankSize = 4;
  function loadRanking() {
    const request = ++rankRequest; rankStatus.textContent = '排行榜讀取中…'; rankList.replaceChildren();
    document.querySelectorAll('[data-rank-size]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.rankSize) === rankSize)));
    window.MemoryLeaderboard.read().then(data => {
      if (request !== rankRequest) return;
      const rows = data.records.filter(r => String(r.difficulty) === String(rankSize)).slice(0, 20);
      rankStatus.textContent = rows.length ? '每個暱稱顯示最高分・前 20 名' : '目前還沒有成績，快來挑戰！';
      rows.forEach((r, i) => { const row = document.createElement('div'), name = document.createElement('span'), points = document.createElement('b'); row.className = 'rank-row'; name.textContent = `${i + 1}. ${r.name}${r.golden ? ' ✨' : ''}`; points.textContent = `${Number(r.score).toLocaleString()} 分`; row.append(name, points); rankList.append(row); });
    }).catch(err => { if (request === rankRequest) rankStatus.textContent = err.message || '排行榜讀取失敗。'; });
  }
  function openRanking(origin) { rankingOrigin = origin; rankSize = origin === 'result' ? resultSize : size; setupPanel.hidden = true; resultPanel.hidden = true; document.getElementById('pause-panel').hidden = true; rankingPanel.hidden = false; loadRanking(); }
  document.getElementById('setup-ranking').addEventListener('click', () => openRanking('setup'));
  document.getElementById('result-ranking').addEventListener('click', () => openRanking('result'));
  document.querySelectorAll('[data-rank-size]').forEach(b => b.addEventListener('click', () => { rankSize = Number(b.dataset.rankSize); loadRanking(); }));
  document.getElementById('rank-back').addEventListener('click', () => { rankRequest++; rankingPanel.hidden = true; setupPanel.hidden = rankingOrigin !== 'setup'; resultPanel.hidden = rankingOrigin !== 'result'; document.getElementById('pause-panel').hidden = rankingOrigin !== 'pause'; });
  const pausePanel = document.getElementById('pause-panel');
  function pauseGame() {
    if (!running || paused) return;
    paused = true; running = false; pausedAt = Date.now(); clearInterval(timer); clearTimeout(mismatch);
    if (open.length === 2) { open.forEach(i => { if (!cards[i].done) cards[i].up = false; }); open = []; }
    updateCards(); setupPanel.hidden = true; resultPanel.hidden = true; rankingPanel.hidden = true; pausePanel.hidden = false; overlay.hidden = false;
    announcement.textContent = '遊戲暫停';
  }
  function resumeGame() {
    if (!paused) return;
    startedAt += Date.now() - pausedAt; paused = false; running = true; pausePanel.hidden = true; overlay.hidden = true; updateCards(); tick(); timer = setInterval(tick, 200); announcement.textContent = '繼續遊戲';
  }
  document.getElementById('pause').addEventListener('click', pauseGame);
  document.getElementById('resume-game').addEventListener('click', resumeGame);
  document.getElementById('pause-restart').addEventListener('click', () => { goldenNext = goldenMode; start(); });
  document.getElementById('pause-choose').addEventListener('click', () => { goldenNext = goldenMode || goldenNext; chooseDifficulty(); });
  document.getElementById('pause-ranking').addEventListener('click', () => openRanking('pause'));
  document.getElementById('rank-form').addEventListener('submit', e => {
    e.preventDefault(); if (rankSaved || rankSubmitting) return;
    const message = document.getElementById('rank-message'), button = document.getElementById('rank-submit'); let name;
    try { name = window.MemoryLeaderboard.nickname(document.getElementById('rank-name').value); } catch (err) { message.textContent = err.message; return; }
    if (!goldenMode && name.toUpperCase() === 'DKEC') { goldenNext = true; message.textContent = '黃金模式已啟動，下一局分數 ×5！'; return; }
    rankSubmitting = true; button.disabled = true; message.textContent = '正在登錄排行榜…'; const thisRun = runId;
    window.MemoryLeaderboard.submit({nickname:goldenMode ? 'DKEC' : name,score:resultScore,difficulty:resultSize,golden:goldenMode}).then(() => { if (runId !== thisRun) return; rankSubmitting = false; rankSaved = true; button.textContent = '已登錄'; message.textContent = '成績已登錄排行榜！'; }).catch(err => { if (runId !== thisRun) return; rankSubmitting = false; button.disabled = false; message.textContent = err.message || '登錄失敗，請稍後再試。'; });
  });
  difficultyButtons.forEach(button => button.addEventListener('click', () => chooseDifficulty(Number(button.dataset.size)))); chooseDifficulty();
})();













