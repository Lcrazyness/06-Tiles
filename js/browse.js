// ============================================================================
// browse.js — level lists styled after Geometry Dash's browser: searchable,
// tabbed, difficulty-badged cards that open into a detail sheet with rating.
// ============================================================================

let currentBrowseTab = 'recent';
let levelDetailReturnTo = 'my-levels-menu';

function openMyLevels() {
  toggleMenu('my-levels-menu');
  renderMyLevels();
}

function renderMyLevels() {
  const container = document.getElementById('custom-levels-container');
  const levels = getCustomLevels();
  container.innerHTML = '';
  if (levels.length === 0) {
    container.innerHTML = '<div class="browse-empty">No levels yet — tap CREATE LEVEL on the main menu to make one.</div>';
    return;
  }
  levels.slice().reverse().forEach(level => container.appendChild(renderLevelCard(level, false)));
}

function openBrowseLevels(tab) {
  currentBrowseTab = tab;
  document.querySelectorAll('#browse-levels-menu .pill-tab').forEach(btn => {
    btn.classList.toggle('active', btn.id === 'tab-' + tab);
  });
  toggleMenu('browse-levels-menu');
  renderBrowseLevels();
}

function renderBrowseLevels() {
  const container = document.getElementById('community-levels-container');
  if (!container) return;
  let levels = getCommunityLevels().slice();
  const searchInput = document.getElementById('browse-search-input');
  const query = (searchInput && searchInput.value || '').trim().toLowerCase();
  if (query) {
    levels = levels.filter(l => l.name.toLowerCase().includes(query) || (l.author || '').toLowerCase().includes(query));
  }
  if (currentBrowseTab === 'recent') {
    levels.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } else if (currentBrowseTab === 'trending') {
    levels.sort((a, b) => (b.plays || 0) - (a.plays || 0));
  } else if (currentBrowseTab === 'rated') {
    levels.sort((a, b) => getAvgRating(b) - getAvgRating(a));
  } else if (currentBrowseTab === 'featured') {
    levels = levels.filter(l => getAvgRating(l) >= 4 || (l.plays || 0) >= 5);
    levels.sort((a, b) => getAvgRating(b) - getAvgRating(a));
  }
  container.innerHTML = '';
  if (levels.length === 0) {
    container.innerHTML = '<div class="browse-empty">Nothing here yet. Publish a level from the editor menu to see it in this list.</div>';
    return;
  }
  levels.forEach(level => container.appendChild(renderLevelCard(level, true)));
}

function renderLevelCard(level, fromCommunity) {
  const diff = estimateDifficulty(level);
  const avg = getAvgRating(level);
  const card = document.createElement('div');
  card.className = 'level-card';
  card.style.borderLeftColor = `var(--diff-${diff.toLowerCase()})`;
  card.innerHTML = `
    <div class="level-card-thumb">${fromCommunity ? '🌐' : '📁'}</div>
    <div class="level-card-body">
      <div class="level-card-title-row">
        <span class="level-card-title">${escapeHtml(level.name)}</span>
        <span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span>
      </div>
      <div class="level-card-author">by ${escapeHtml(level.author || 'You')}</div>
      <div class="level-card-stats">
        <span class="star">★ ${avg ? avg.toFixed(1) : '—'}</span>
        <span>▶ ${level.plays || 0}</span>
      </div>
    </div>`;
  card.onclick = () => openLevelDetail(level, fromCommunity);
  return card;
}

function openLevelDetail(level, fromCommunity) {
  levelDetailReturnTo = fromCommunity ? 'browse-levels-menu' : 'my-levels-menu';
  const diff = estimateDifficulty(level);
  const avg = getAvgRating(level);

  document.getElementById('level-detail-title').innerText = level.name;
  const body = document.getElementById('level-detail-body');
  body.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'level-detail-header';
  header.innerHTML = `
    <div class="level-card-thumb">${fromCommunity ? '🌐' : '📁'}</div>
    <div>
      <div class="level-card-title-row"><b style="font-size:16px;">${escapeHtml(level.name)}</b> <span class="diff-badge ${difficultyBadgeClass(diff)}">${diff}</span></div>
      <div class="level-card-author">by ${escapeHtml(level.author || 'You')} · ${(level.data || []).length} tiles</div>
    </div>`;
  body.appendChild(header);

  const statsRow = document.createElement('div');
  statsRow.className = 'level-card-stats';
  statsRow.style.justifyContent = 'center';
  statsRow.innerHTML = `<span class="star">★ ${avg ? avg.toFixed(1) : 'No ratings'}</span><span>▶ ${level.plays || 0} plays</span><span>❤️ ${level.lives || 3} lives</span>`;
  body.appendChild(statsRow);

  if (fromCommunity) {
    const rateWrap = document.createElement('div');
    rateWrap.className = 'level-detail-rate';
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('span');
      star.className = 'rate-star';
      star.textContent = '★';
      star.onmouseenter = () => Array.from(rateWrap.children).forEach((s, idx) => s.classList.toggle('hover', idx < i));
      star.onmouseleave = () => Array.from(rateWrap.children).forEach(s => s.classList.remove('hover'));
      star.onclick = () => {
        rateLevel(level.id, i, true);
        const updated = getCommunityLevels().find(l => l.id === level.id);
        if (updated) openLevelDetail(updated, true);
      };
      rateWrap.appendChild(star);
    }
    body.appendChild(rateWrap);
  }

  const playBtn = document.createElement('button');
  playBtn.className = 'nav-btn';
  playBtn.style.cssText = 'background:var(--play-blue); color:#fff;';
  playBtn.textContent = '▶ PLAY';
  playBtn.onclick = () => {
    registerPlay(level.id, fromCommunity);
    startGame(level.name, true, -1, level.data, level.effects || [], fromCommunity, level);
  };
  body.appendChild(playBtn);

  if (!fromCommunity) {
    const editBtn = document.createElement('button');
    editBtn.className = 'nav-btn secondary-btn';
    editBtn.textContent = '✎ EDIT';
    editBtn.onclick = () => startEditor(level);
    body.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'nav-btn';
    delBtn.style.cssText = 'background:var(--accent-danger); color:#fff;';
    delBtn.textContent = 'DELETE';
    delBtn.onclick = () => {
      if (!confirm('Delete "' + level.name + '"? This cannot be undone.')) return;
      const levels = getCustomLevels();
      const idx = levels.findIndex(l => l.id === level.id);
      if (idx !== -1) levels.splice(idx, 1);
      persistProfiles();
      closeLevelDetail();
    };
    body.appendChild(delBtn);
  }

  toggleMenu('level-detail-menu');
}

function closeLevelDetail() {
  toggleMenu(levelDetailReturnTo);
  if (levelDetailReturnTo === 'my-levels-menu') renderMyLevels(); else renderBrowseLevels();
}
