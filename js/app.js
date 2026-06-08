// ============================================================
//  74-0 IPL — GAME STATE & UI  (Draft Edition)
// ============================================================

let G = {
  screen: 'home',

  draft: {
    round: 0,         // 0–10, which pick we're on
    picks: [],        // [{ id, name, role, bat, bowl, rating, fromTeam, fromYear }]
    currentRoll: null,// { teamId, year, team, players }
  },

  // derived from draft.picks after 11 picks
  xi: [],       // player objects
  bowlingPlan: {},

  season: {
    opponents: [],
    results: [],
    matchIndex: 0,
  },

  match: {
    opponentId: null,
    opponentXI: [],
    playerBatsFirst: null,
    tossWinner: null,
    innings: [null, null],
    currentInnings: 0,
    phase: 'idle',
    liveInnings: null,
    displayedOvers: 0,
    aggression: 'normal',
    userBowlerPlan: {},
    bowlerOversUsed: {},
    lastBowlerId: null,
    bowlingPlan: {},
    speed: 'normal',
  },
};

// ---- HELPERS --------------------------------------------------
function aggressionMod(mode) {
  return { conservative: -20, normal: 0, aggressive: 25 }[mode] || 0;
}

function buildBowlingPlan(xi) {
  const plan = {};
  const bowlers = xi.filter(p => p.bowl).sort((a, b) => b.rating - a.rating);
  bowlers.forEach((p, i) => { plan[p.id] = i < 4 ? 4 : 2; });
  return plan;
}

function generateFixtures() {
  const oppIds = TEAMS.map(t => t.id).sort(() => Math.random() - 0.5);
  return oppIds.concat(oppIds.slice(0, 4)).slice(0, 14);
}

function buildSeasonTable() {
  const table = TEAMS.map(t => ({
    id: t.id, short: t.short, pts: 0, played: 0, won: 0, lost: 0
  }));
  // Our row
  const ourRow = { id: 'allstars', short: 'YOU', pts: 0, played: 0, won: 0, lost: 0 };

  for (const r of G.season.results) {
    const opp = table.find(t => t.id === r.opponentId);
    ourRow.played++;
    if (r.win) { ourRow.won++; ourRow.pts += 2; if (opp) opp.lost++; }
    else        { ourRow.lost++; if (opp) { opp.won++; opp.pts += 2; } }
    if (opp) opp.played++;
  }

  const all = [ourRow, ...table].sort((a, b) => b.pts - a.pts || b.won - a.won);
  return all;
}

function getBowlerName(id) {
  const p = G.xi.find(p => p.id === id) ||
    Object.values(SQUADS).flat().find(p => p.id === id) ||
    ALL_PLAYERS[id] || FILLER_PLAYERS[id];
  return p ? p.name.split(' ').pop() : id;
}

// ---- RENDER ---------------------------------------------------
function render() {
  document.getElementById('root').innerHTML = (() => {
    switch (G.screen) {
      case 'home':      return renderHome();
      case 'draft':     return renderDraft();
      case 'season':    return renderSeason();
      case 'preMatch':  return renderPreMatch();
      case 'match':     return renderMatch();
      case 'postMatch': return renderPostMatch();
      case 'seasonEnd': return renderSeasonEnd();
      default:          return '<p>Loading…</p>';
    }
  })();
  attachHandlers();
}

// ---- HOME -----------------------------------------------------
function renderHome() {
  return `
  <div class="screen home-screen">
    <div class="home-ball-bg"></div>
    <div class="home-content">
      <div class="home-badge">IPL CHALLENGE</div>
      <h1 class="home-title">74-0</h1>
      <p class="home-sub">Go the entire IPL season <strong>undefeated</strong></p>
      <p class="home-desc">
        Draft your XI from random IPL teams across different seasons.
        One player per roll. Build your squad. Win all 14 matches.
      </p>
      <button class="btn btn-primary btn-xl" data-action="startDraft">START DRAFT</button>
    </div>
    <div class="home-stats-row">
      <div class="home-stat"><span>11</span><label>Draft Picks</label></div>
      <div class="home-stat"><span>6</span><label>Seasons (2019–24)</label></div>
      <div class="home-stat"><span>14</span><label>Matches to Win</label></div>
      <div class="home-stat"><span>0</span><label>Defeats Allowed</label></div>
    </div>
  </div>`;
}

// ---- DRAFT ----------------------------------------------------
function renderDraft() {
  const d = G.draft;
  const pickedIds = new Set(d.picks.map(p => p.id));
  const wkCount   = d.picks.filter(p => p.role === 'WK').length;
  const bowlCount = d.picks.filter(p => p.bowl).length;

  // Sidebar: picked players
  const pickedRows = d.picks.map((p, i) => `
    <div class="draft-pick-row">
      <span class="pick-num">${i + 1}</span>
      <span class="player-role role-${p.role}">${p.role}</span>
      <span class="pick-name">${p.name}</span>
      <span class="pick-from">${getTeam(p.fromTeam).short} '${String(p.fromYear).slice(2)}</span>
    </div>`).join('');

  const emptySlots = Array.from({ length: 11 - d.picks.length }, (_, i) => `
    <div class="draft-pick-row empty">
      <span class="pick-num">${d.picks.length + i + 1}</span>
      <span class="pick-empty">— empty —</span>
    </div>`).join('');

  const warnings = [];
  if (d.picks.length === 11) {
    if (wkCount === 0) warnings.push('⚠ No wicket-keeper — you\'ll still play but can\'t keep');
    if (bowlCount < 4) warnings.push('⚠ Fewer than 4 bowlers — AI will score big');
  }

  // Main panel: rolled team
  let mainPanel;
  if (!d.currentRoll) {
    mainPanel = `
      <div class="draft-roll-panel">
        <div class="draft-round-badge">PICK ${d.round + 1} OF 11</div>
        <div class="draft-roll-prompt">
          <div class="roll-dice">🎲</div>
          <h2>Roll for your next team</h2>
          <p class="muted">A random IPL team from a random season will appear</p>
          <button class="btn btn-primary btn-xl" data-action="rollTeam">ROLL</button>
        </div>
      </div>`;
  } else {
    const roll = d.currentRoll;
    const team = roll.team;
    const players = roll.players.filter(p => p && p.name);

    const cards = players.map(p => {
      const alreadyPicked = pickedIds.has(p.id);
      const bowlStr = p.bowl ? `${p.bowl.econ} econ` : '—';
      return `
      <div class="player-card ${alreadyPicked ? 'already-picked' : ''}"
           data-action="${alreadyPicked ? '' : 'draftPick'}" data-pid="${p.id}">
        <div class="pc-header">
          <span class="player-role role-${p.role}">${p.role}</span>
          <span class="pc-rating">${p.rating}</span>
        </div>
        <div class="pc-name">${p.name}</div>
        <div class="pc-stats">
          <span>SR ${p.bat.sr}</span>
          <span>${p.bat.avg} avg</span>
          <span>${bowlStr}</span>
        </div>
        ${alreadyPicked ? '<div class="pc-taken">Already drafted</div>' : ''}
      </div>`;
    }).join('');

    mainPanel = `
      <div class="draft-roll-panel">
        <div class="draft-round-badge">PICK ${d.round + 1} OF 11</div>
        <div class="rolled-team-header" style="border-color:${team.primary}">
          <span class="team-chip" style="background:${team.primary};color:${team.secondary}">${team.short}</span>
          <h2>${team.name}</h2>
          <span class="season-year-badge">${roll.year}</span>
          <button class="btn btn-outline btn-sm" data-action="rollTeam" style="margin-left:auto">🔄 Re-roll</button>
        </div>
        <p class="muted" style="margin-bottom:14px">Pick ONE player to add to your XI</p>
        <div class="player-cards-grid">${cards}</div>
      </div>`;
  }

  const canFinish = d.picks.length === 11;

  return `
  <div class="screen draft-screen">
    <div class="draft-layout">
      <div class="draft-main">
        ${mainPanel}
        ${canFinish ? `
        <div style="margin-top:20px;display:flex;flex-direction:column;gap:8px">
          ${warnings.map(w => `<div class="warning">${w}</div>`).join('')}
          <button class="btn btn-primary btn-lg" data-action="finishDraft">
            ✓ Lock in XI & Start Season
          </button>
        </div>` : ''}
      </div>
      <div class="draft-sidebar">
        <h3>Your XI (${d.picks.length}/11)</h3>
        <div class="draft-picks-list">
          ${pickedRows}
          ${emptySlots}
        </div>
        <div class="squad-hints">
          <span class="${wkCount > 0 ? 'hint-ok' : 'hint-bad'}">WK: ${wkCount}/1</span>
          <span class="${bowlCount >= 4 ? 'hint-ok' : 'hint-bad'}">Bowlers: ${bowlCount}/4</span>
        </div>
      </div>
    </div>
  </div>`;
}

// ---- SEASON ---------------------------------------------------
function renderSeason() {
  const { opponents, results, matchIndex } = G.season;
  const table = buildSeasonTable();
  const undefeated = results.every(r => r.win) && results.length > 0;

  const fixtureRows = opponents.map((oppId, i) => {
    const opp = getTeam(oppId);
    const result = results.find(r => r.matchIndex === i);
    let statusCls = 'upcoming', statusTxt = 'VS';
    if (result) { statusCls = result.win ? 'won' : 'lost'; statusTxt = result.win ? 'WON' : 'LOST'; }
    const active = i === matchIndex && !result;
    return `
    <div class="fixture-row ${statusCls} ${active ? 'active' : ''}">
      <div class="fixture-num">M${i + 1}</div>
      <div class="fixture-opp">
        <span class="team-chip" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
        ${opp.name}
      </div>
      <div class="fixture-result">${result ? result.margin : ''}</div>
      <div class="fixture-status ${statusCls}">${statusTxt}</div>
    </div>`;
  }).join('');

  const tableRows = table.slice(0, 10).map((row, i) => {
    const isUs = row.id === 'allstars';
    return `
    <tr class="${isUs ? 'our-row' : ''}">
      <td>${i + 1}</td>
      <td><strong>${row.short}</strong></td>
      <td>${row.played}</td><td>${row.won}</td><td>${row.lost}</td>
      <td><strong>${row.pts}</strong></td>
    </tr>`;
  }).join('');

  const nextOpp = opponents[matchIndex] ? getTeam(opponents[matchIndex]) : null;

  return `
  <div class="screen season-screen">
    <div class="screen-header" style="border-color:#d29922">
      <div class="team-pill" style="background:#d29922;color:#000">YOUR ALL-STARS</div>
      <h2>IPL Season</h2>
      <div class="season-badges">
        ${undefeated ? '<span class="badge green">UNDEFEATED ✓</span>' : ''}
        <span class="badge">Match ${matchIndex + 1} / 14</span>
      </div>
    </div>
    <div class="season-layout">
      <div class="fixtures-col">
        <h3>Fixtures</h3>
        ${fixtureRows}
        ${matchIndex < 14 && nextOpp ? `
        <div class="next-match-bar">
          <button class="btn btn-primary btn-lg" data-action="goToPreMatch">
            ▶ Play Next: vs ${nextOpp.name}
          </button>
        </div>` : matchIndex >= 14 ? `
        <div class="next-match-bar">
          <button class="btn btn-primary btn-lg" data-action="goToSeasonEnd">See Final Result →</button>
        </div>` : ''}
      </div>
      <div class="table-col">
        <h3>Points Table</h3>
        <table class="standings-table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div style="margin-top:16px">
          <h3>Your XI</h3>
          ${G.xi.map(p => `
          <div class="pm-player">
            <span class="role-dot role-${p.role}"></span>
            <span>${p.name}</span>
            <span class="muted" style="margin-left:auto;font-size:.75rem">${getTeam(p.fromTeam).short} '${String(p.fromYear).slice(2)}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

// ---- PRE-MATCH ------------------------------------------------
function renderPreMatch() {
  const oppId = G.season.opponents[G.season.matchIndex];
  const opp = getTeam(oppId);

  return `
  <div class="screen">
    <div class="screen-header" style="border-color:${opp.primary}">
      <h2>
        <span class="team-pill" style="background:#d29922;color:#000">YOUR XI</span>
        vs
        <span class="team-pill" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
      </h2>
      <p class="muted">${opp.venue || opp.name}</p>
    </div>
    <div class="pm-layout">
      <div class="pm-xi-col">
        <h3>Your Playing XI</h3>
        <div class="pm-player-list">
          ${G.xi.map(p => `
          <div class="pm-player">
            <span class="role-dot role-${p.role}"></span>
            <span>${p.name}</span>
            <span class="muted" style="margin-left:auto">${p.role}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="pm-tactic-col">
        <h3>Aggression Mode</h3>
        <div class="aggression-select">
          ${['conservative','normal','aggressive'].map(a => `
            <label class="aggr-opt ${G.match.aggression === a ? 'active' : ''}">
              <input type="radio" name="aggr" value="${a}" ${G.match.aggression === a ? 'checked' : ''}>
              <strong>${a.charAt(0).toUpperCase()+a.slice(1)}</strong>
              <small>${a === 'conservative' ? 'SR -20, fewer risks' : a === 'aggressive' ? 'SR +25, higher risk' : 'Balanced play'}</small>
            </label>`).join('')}
        </div>
        <h3 style="margin-top:20px">Speed</h3>
        <div class="speed-select">
          ${['normal','fast'].map(s => `
            <label class="speed-opt ${G.match.speed === s ? 'active' : ''}">
              <input type="radio" name="speed" value="${s}" ${G.match.speed === s ? 'checked' : ''}>
              ${s === 'normal' ? '🐢 Normal' : '⚡ Fast'}
            </label>`).join('')}
        </div>
      </div>
    </div>
    <div class="pm-actions">
      <button class="btn btn-outline" data-action="backToSeason">← Back</button>
      <button class="btn btn-primary btn-lg" data-action="startMatch">🏏 Start Match</button>
    </div>
  </div>`;
}

// ---- MATCH SCREEN ---------------------------------------------
function renderMatch() {
  const m = G.match;

  if (m.phase === 'toss') {
    const oppTeam = getTeam(m.opponentId);
    return `
    <div class="screen match-screen">
      <div class="toss-card">
        <div class="toss-coin">🪙</div>
        <h2>Toss Result</h2>
        <p><strong>${m.tossWinner === 'allstars' ? 'Your team' : oppTeam.name}</strong> won the toss</p>
        <p class="muted">${m.playerBatsFirst ? 'Your XI elected to bat' : 'Your XI elected to bowl'}</p>
        <button class="btn btn-primary" data-action="beginInnings">▶ Begin Match</button>
      </div>
    </div>`;
  }

  if (m.phase === 'inningsBreak') {
    const i1 = m.innings[0];
    const oppTeam = getTeam(m.opponentId);
    return `
    <div class="screen match-screen">
      <div class="break-card">
        <h2>Innings Break</h2>
        <div class="break-score">${i1.runs} / ${i1.wickets}</div>
        <p class="muted">${m.playerBatsFirst ? 'Your XI' : oppTeam.short} scored in ${i1.overs.length} overs</p>
        <p class="target-line">Target: <strong>${i1.runs + 1}</strong></p>
        <button class="btn btn-primary" data-action="beginSecondInnings">▶ Start 2nd Innings</button>
      </div>
    </div>`;
  }

  if (m.phase === 'awaitingBowler') return renderBowlerSelect();

  const live = m.liveInnings;
  if (!live) return `<div class="screen"><p>Loading…</p></div>`;

  const oppTeam = getTeam(m.opponentId);
  const inningsNum = m.currentInnings;
  const i1 = m.innings[0];
  const target = inningsNum === 1 && i1 ? i1.runs + 1 : null;

  const displayOvers = live.overs.slice(0, m.displayedOvers);
  const lastOver = displayOvers[displayOvers.length - 1];
  const runsDisplayed = displayOvers.reduce((s, o) => s + o.runsInOver, 0);
  const wicketsDisplayed = displayOvers.reduce((s, o) => s + o.balls.filter(b => b.wicket).length, 0);
  const ballsPlayed = displayOvers.reduce((s, o) => s + o.balls.filter(b => b.countsAsBall !== false).length, 0);

  const battingIsPlayer = m.playerBatsFirst === (inningsNum === 0);
  const battingLabel = battingIsPlayer ? 'YOUR XI' : oppTeam.short;
  const overs = `${Math.floor(ballsPlayed / 6)}.${ballsPlayed % 6}`;
  const rr = ballsPlayed ? (runsDisplayed / (ballsPlayed / 6)).toFixed(2) : '—';
  const rrr = target && ballsPlayed < 120
    ? ((target - runsDisplayed) / ((120 - ballsPlayed) / 6)).toFixed(2)
    : null;

  const lastBalls = lastOver ? lastOver.balls.slice(-6) : [];
  const ballPills = lastBalls.map(b => {
    const cls = b.wicket ? 'ball-w' : b.runs >= 6 ? 'ball-6' : b.runs >= 4 ? 'ball-4' : 'ball-run';
    return `<span class="ball-pill ${cls}">${b.display}</span>`;
  }).join('');
  const lastComm = lastOver && lastOver.balls.length
    ? lastOver.balls[lastOver.balls.length - 1].commentary
    : 'Match in progress…';

  const isUserBowling = !battingIsPlayer;
  const canAdvance = m.displayedOvers < live.overs.length && m.phase === 'live';

  return `
  <div class="screen match-screen">
    <div class="match-header">
      <span class="team-chip" style="background:#d29922;color:#000">YOUR XI</span>
      <span class="match-vs">vs</span>
      <span class="team-chip" style="background:${oppTeam.primary};color:${oppTeam.secondary}">${oppTeam.short}</span>
      <span class="innings-badge">Innings ${inningsNum + 1}</span>
    </div>
    <div class="scoreboard">
      <div class="score-main">
        <div class="score-team">${battingLabel}</div>
        <div class="score-runs">${runsDisplayed}<span class="score-wkts">/${wicketsDisplayed}</span></div>
        <div class="score-overs">(${overs} ov)</div>
      </div>
      ${target ? `<div class="target-box">Target: <strong>${target}</strong>${rrr ? ` | RRR: <strong>${rrr}</strong>` : ''}</div>` : ''}
      ${i1 ? `<div class="innings1-score">${m.playerBatsFirst ? oppTeam.short : 'YOUR XI'}: ${i1.runs}/${i1.wickets} (${i1.overs.length} ov)</div>` : ''}
      <div class="rr-line">CRR: ${rr}</div>
    </div>
    <div class="last-balls">
      <span class="muted" style="font-size:12px">Last over: </span>${ballPills || '<span class="muted">—</span>'}
    </div>
    <div class="commentary">${lastComm}</div>
    ${canAdvance ? `
    <div class="over-nav">
      ${isUserBowling && m.displayedOvers < live.overs.length - 1 ? `
        <div class="bowler-change-bar">
          Next: ${live.overs[m.displayedOvers] ? getBowlerName(live.overs[m.displayedOvers].bowler) : ''}
          <button class="btn btn-outline btn-sm" data-action="openBowlerSelect">Change Bowler</button>
        </div>` : ''}
      <button class="btn btn-primary" data-action="advanceOver">
        ${G.match.speed === 'fast' ? 'Simulate All' : 'Next Over →'}
      </button>
      ${G.match.speed === 'normal' ? `<button class="btn btn-outline btn-sm" data-action="simulateAll">Skip to End</button>` : ''}
    </div>` : ''}
    ${m.phase === 'live' && m.displayedOvers >= live.overs.length ? `
    <div class="over-nav">
      <button class="btn btn-primary" data-action="inningsComplete">
        ${inningsNum === 0 ? 'Innings Break →' : 'See Result →'}
      </button>
    </div>` : ''}
    <div class="over-log">
      ${displayOvers.slice(-5).reverse().map(o => `
        <div class="over-row">
          <span class="over-num">Ov ${o.overNum + 1}</span>
          <span class="over-bowler">${getBowlerName(o.bowler)}</span>
          <span class="over-balls">${o.balls.map(b => `<span class="ball-mini ${b.wicket ? 'bm-w' : b.runs >= 6 ? 'bm-6' : b.runs >= 4 ? 'bm-4' : ''}">${b.display}</span>`).join('')}</span>
          <span class="over-runs">${o.runsInOver} runs</span>
        </div>`).join('')}
    </div>
  </div>`;
}

function renderBowlerSelect() {
  const m = G.match;
  const oppTeam = getTeam(m.opponentId);
  const bowlers = G.xi.filter(p => p.bowl);
  const used = m.bowlerOversUsed || {};
  const lastId = m.lastBowlerId;

  const opts = bowlers.map(p => {
    const maxOv = G.match.bowlingPlan[p.id] || 4;
    const usedOv = used[p.id] || 0;
    const avail = usedOv < maxOv && p.id !== lastId;
    return `
    <button class="bowler-opt ${!avail ? 'unavail' : ''}"
            data-action="chooseBowler" data-bowler="${p.id}" ${!avail ? 'disabled' : ''}>
      <strong>${p.name}</strong>
      <span class="muted">${usedOv}/${maxOv} ov • Econ ${p.bowl.econ} • ${p.bowl.wpm.toFixed(1)} wkt/m</span>
    </button>`;
  }).join('');

  return `
  <div class="screen match-screen">
    <div class="match-header">
      <span class="team-chip" style="background:#d29922;color:#000">YOUR XI</span>
      <span>vs</span>
      <span class="team-chip" style="background:${oppTeam.primary};color:${oppTeam.secondary}">${oppTeam.short}</span>
    </div>
    <div class="bowler-select-card">
      <h3>Choose Bowler — Over ${(m.displayedOvers || 0) + 1}</h3>
      <div class="bowler-opts">${opts}</div>
      <button class="btn btn-outline" data-action="cancelBowlerSelect" style="margin-top:12px">Auto-Select</button>
    </div>
  </div>`;
}

// ---- POST MATCH -----------------------------------------------
function renderPostMatch() {
  const m = G.match;
  const oppTeam = getTeam(m.opponentId);
  const result = G.season.results[G.season.results.length - 1];
  const i1 = m.innings[0], i2 = m.innings[1];

  function scorecardTable(innings, title) {
    if (!innings) return '';
    const batRows = innings.batsmanStats.map(b => `
      <tr><td>${b.player.name}</td><td>${b.out ? 'out' : 'not out'}</td>
          <td>${b.runs}</td><td>(${b.balls})</td><td>${b.fours}</td><td>${b.sixes}</td></tr>`).join('');
    const bowlRows = innings.bowlerStats.map(b => `
      <tr><td>${b.player.name}</td><td>${b.overs}-0-${b.runs}-${b.wickets}</td></tr>`).join('');
    return `
    <div class="scorecard-section">
      <h4>${title}: ${innings.runs}/${innings.wickets} (${innings.overs.length} ov)</h4>
      <table class="scorecard-table">
        <thead><tr><th>Batsman</th><th></th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
        <tbody>${batRows}</tbody>
      </table>
      <table class="scorecard-table" style="margin-top:8px">
        <thead><tr><th>Bowler</th><th>O-M-R-W</th></tr></thead>
        <tbody>${bowlRows}</tbody>
      </table>
    </div>`;
  }

  return `
  <div class="screen post-match-screen">
    <div class="result-header ${result.win ? 'result-win' : 'result-loss'}">
      <div class="result-badge">${result.win ? '🏆 WON' : '💀 LOST'}</div>
      <h2>${result.margin}</h2>
      <p>Your XI vs ${oppTeam.name}</p>
    </div>
    <div class="scorecard-body">
      ${scorecardTable(i1, `${m.playerBatsFirst ? 'Your XI' : oppTeam.short} 1st innings`)}
      ${scorecardTable(i2, `${m.playerBatsFirst ? oppTeam.short : 'Your XI'} 2nd innings`)}
    </div>
    <div class="post-actions">
      ${result.win
        ? `<button class="btn btn-primary btn-lg" data-action="continueSeasonAfterMatch">Continue Season →</button>`
        : `<button class="btn btn-danger btn-lg" data-action="goToSeasonEnd">Season Over</button>`}
    </div>
  </div>`;
}

// ---- SEASON END -----------------------------------------------
function renderSeasonEnd() {
  const allWon = G.season.results.every(r => r.win) && G.season.results.length === 14;
  const wins = G.season.results.filter(r => r.win).length;
  return `
  <div class="screen season-end-screen">
    ${allWon ? `
    <div class="trophy-area">
      <div class="trophy-icon">🏆</div>
      <h1>UNDEFEATED CHAMPIONS</h1>
      <p class="muted">Your drafted All-Stars went the entire IPL season without a single defeat.</p>
      <div class="team-pill big" style="background:#d29922;color:#000">YOUR ALL-STARS XI</div>
      <div class="season-record">14 Matches • 14 Wins • 0 Defeats</div>
    </div>` : `
    <div class="defeat-area">
      <div class="defeat-icon">💀</div>
      <h1>SEASON OVER</h1>
      <p class="muted">The undefeated dream ends here.</p>
      <div class="season-record">${wins} Wins • ${G.season.results.length - wins} Defeat(s)</div>
    </div>`}
    <button class="btn btn-primary btn-xl" data-action="playAgain" style="margin-top:32px">Play Again</button>
  </div>`;
}

// ---- EVENT HANDLERS -------------------------------------------
function attachHandlers() {
  document.querySelectorAll('[data-action]').forEach(el => {
    el.onclick = e => { e.stopPropagation(); handleAction(el.dataset.action, el.dataset); };
  });
  document.querySelectorAll('input[name="aggr"]').forEach(r => {
    r.onchange = () => { G.match.aggression = r.value; render(); };
  });
  document.querySelectorAll('input[name="speed"]').forEach(r => {
    r.onchange = () => { G.match.speed = r.value; render(); };
  });
}

function handleAction(action, data) {
  switch (action) {
    case 'startDraft':            startDraft(); break;
    case 'rollTeam':              rollTeam(); break;
    case 'draftPick':             draftPick(data.pid); break;
    case 'finishDraft':           finishDraft(); break;
    case 'goToPreMatch':          G.screen = 'preMatch'; render(); break;
    case 'backToSeason':          G.screen = 'season'; render(); break;
    case 'startMatch':            startMatch(); break;
    case 'beginInnings':          beginFirstInnings(); break;
    case 'advanceOver':           advanceOver(); break;
    case 'simulateAll':           simulateAll(); break;
    case 'inningsComplete':       handleInningsComplete(); break;
    case 'beginSecondInnings':    beginSecondInnings(); break;
    case 'openBowlerSelect':      G.match.phase = 'awaitingBowler'; render(); break;
    case 'chooseBowler':          chooseBowler(data.bowler); break;
    case 'cancelBowlerSelect':    G.match.phase = 'live'; render(); break;
    case 'continueSeasonAfterMatch': continueAfterMatch(); break;
    case 'goToSeasonEnd':         G.screen = 'seasonEnd'; render(); break;
    case 'playAgain':             resetGame(); break;
  }
}

// ---- DRAFT ACTIONS --------------------------------------------
function startDraft() {
  G.draft = { round: 0, picks: [], currentRoll: null };
  G.screen = 'draft';
  render();
}

function rollTeam() {
  G.draft.currentRoll = rollTeamSeason();
  render();
}

function draftPick(pid) {
  const roll = G.draft.currentRoll;
  if (!roll) return;
  const player = roll.players.find(p => p.id === pid);
  if (!player) return;
  if (G.draft.picks.find(p => p.id === pid)) return;
  if (G.draft.picks.length >= 11) return;

  G.draft.picks.push({
    ...player,
    fromTeam: roll.teamId,
    fromYear: roll.year,
  });
  G.draft.round++;
  G.draft.currentRoll = null;
  render();
}

function finishDraft() {
  if (G.draft.picks.length !== 11) return;
  G.xi = G.draft.picks;
  G.bowlingPlan = buildBowlingPlan(G.xi);
  G.season.opponents = generateFixtures();
  G.season.results = [];
  G.season.matchIndex = 0;
  G.screen = 'season';
  render();
}

// ---- MATCH ACTIONS --------------------------------------------
function startMatch() {
  const oppId = G.season.opponents[G.season.matchIndex];
  Object.assign(G.match, {
    opponentId: oppId,
    opponentXI: pickAIXI(oppId),
    bowlingPlan: { ...G.bowlingPlan },
    bowlerOversUsed: {},
    lastBowlerId: null,
    userBowlerPlan: {},
    innings: [null, null],
    currentInnings: 0,
    displayedOvers: 0,
    liveInnings: null,
    tossWinner: Math.random() < 0.5 ? 'allstars' : oppId,
  });
  G.match.playerBatsFirst = G.match.tossWinner === 'allstars';
  G.match.phase = 'toss';
  G.screen = 'match';
  render();
}

function beginFirstInnings() {
  G.match.currentInnings = 0;
  G.match.phase = 'live';
  simulateCurrentInnings();
}

function simulateCurrentInnings() {
  const m = G.match;
  const inningsNum = m.currentInnings;
  const playerBatting = m.playerBatsFirst === (inningsNum === 0);

  const battingXI = playerBatting ? G.xi : m.opponentXI;
  const bowlingXI = playerBatting ? m.opponentXI : G.xi;
  const target = inningsNum === 1 ? m.innings[0].runs + 1 : null;

  const aggrFn = {
    getAggression: () => playerBatting ? aggressionMod(m.aggression) : 0,
    getBowler: (overNum) => m.userBowlerPlan[overNum] || null,
  };

  const plan = playerBatting
    ? buildDefaultBowlingPlan(bowlingXI)
    : { ...m.bowlingPlan };

  const innings = simulateInnings(battingXI, bowlingXI, target, plan, aggrFn);
  m.innings[inningsNum] = innings;
  m.liveInnings = innings;
  m.displayedOvers = 0;
  render();
}

function advanceOver() {
  if (G.match.speed === 'fast') { simulateAll(); return; }
  const live = G.match.liveInnings;
  if (live) G.match.displayedOvers = Math.min(G.match.displayedOvers + 1, live.overs.length);
  render();
}

function simulateAll() {
  const live = G.match.liveInnings;
  if (live) G.match.displayedOvers = live.overs.length;
  render();
}

function handleInningsComplete() {
  if (G.match.currentInnings === 0) { G.match.phase = 'inningsBreak'; render(); }
  else finishMatch();
}

function beginSecondInnings() {
  G.match.currentInnings = 1;
  G.match.phase = 'live';
  G.match.bowlerOversUsed = {};
  G.match.lastBowlerId = null;
  simulateCurrentInnings();
}

function chooseBowler(bowlerId) {
  G.match.userBowlerPlan[G.match.displayedOvers] = bowlerId;
  G.match.phase = 'live';
  resimulateWithBowlerPlan();
}

function resimulateWithBowlerPlan() {
  const m = G.match;
  const inningsNum = m.currentInnings;
  const playerBatting = m.playerBatsFirst === (inningsNum === 0);

  const battingXI = playerBatting ? G.xi : m.opponentXI;
  const bowlingXI = playerBatting ? m.opponentXI : G.xi;
  const target = inningsNum === 1 ? m.innings[0].runs + 1 : null;

  const aggrFn = {
    getAggression: () => playerBatting ? aggressionMod(m.aggression) : 0,
    getBowler: (overNum) => m.userBowlerPlan[overNum] || null,
  };

  const plan = playerBatting ? buildDefaultBowlingPlan(bowlingXI) : { ...m.bowlingPlan };
  const innings = simulateInnings(battingXI, bowlingXI, target, plan, aggrFn);
  m.innings[inningsNum] = innings;
  m.liveInnings = innings;
  render();
}

function finishMatch() {
  const m = G.match;
  const i1 = m.innings[0], i2 = m.innings[1];
  const oppTeam = getTeam(m.opponentId);
  let win, margin;

  if (m.playerBatsFirst) {
    win = i2.runs <= i1.runs;
    margin = win
      ? `Your XI won by ${i1.runs - i2.runs} runs`
      : `${oppTeam.short} won by ${10 - i2.wickets} wickets`;
  } else {
    win = i2.runs > i1.runs;
    margin = win
      ? `Your XI won by ${10 - i2.wickets} wickets`
      : `${oppTeam.short} won by ${i1.runs - i2.runs} runs`;
  }

  G.season.results.push({ matchIndex: G.season.matchIndex, opponentId: m.opponentId, win, margin });
  G.season.matchIndex++;
  G.screen = 'postMatch';
  render();
}

function continueAfterMatch() {
  if (G.season.matchIndex >= 14) G.screen = 'seasonEnd';
  else G.screen = 'season';
  render();
}

function resetGame() {
  G = {
    screen: 'home',
    draft: { round: 0, picks: [], currentRoll: null },
    xi: [], bowlingPlan: {},
    season: { opponents: [], results: [], matchIndex: 0 },
    match: {
      opponentId: null, opponentXI: [], playerBatsFirst: null, tossWinner: null,
      innings: [null, null], currentInnings: 0, phase: 'idle',
      liveInnings: null, displayedOvers: 0, aggression: 'normal',
      userBowlerPlan: {}, bowlerOversUsed: {}, lastBowlerId: null,
      bowlingPlan: {}, speed: 'normal',
    },
  };
  render();
}

resetGame();
