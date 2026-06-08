// ============================================================
//  74-0 IPL — GAME STATE & UI
// ============================================================

const $ = id => document.getElementById(id);
const root = () => document.getElementById('root');

// ---- GAME STATE -----------------------------------------------
let G = {
  screen: 'home',
  teamId: null,
  xi: [],          // array of player IDs (11)
  battingOrder: [], // ordered player IDs
  bowlingPlan: {}, // { playerId: maxOvers }

  season: {
    opponents: [], // array of team IDs in fixture order (14 matches)
    results: [],   // { matchIndex, win, margin, innings }
    matchIndex: 0,
    points: {},    // { teamId: pts }
    nrr: {},
  },

  match: {
    opponentId: null,
    opponentXI: [],
    playerBatsFirst: null, // true/false
    innings: [null, null],
    phase: 'idle', // idle | toss | setup | live | inningsBreak | result
    liveInnings: null, // current innings being displayed
    // For step-by-step display:
    displayedOvers: 0,   // how many overs shown so far
    awaitingBowler: false,
    chosenBowler: null,
    aggression: 'normal', // conservative | normal | aggressive
    userBowlerPlan: {},   // { overNum: bowlerId } for user-chosen bowlers
    speed: 'normal',      // normal | fast
  },
};

// ---- HELPERS --------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(n) { return Math.floor(Math.random() * n); }

function aggressionMod(mode) {
  return { conservative: -20, normal: 0, aggressive: 25 }[mode] || 0;
}

function validateXI(xi) {
  const squad = getSquad(G.teamId);
  const players = xi.map(id => squad.find(p => p.id === id));
  const wkCount = players.filter(p => p && p.role === 'WK').length;
  const bowlerCount = players.filter(p => p && p.bowl).length;
  return { valid: wkCount >= 1 && bowlerCount >= 4, wkCount, bowlerCount };
}

function generateFixtures(teamId) {
  const others = TEAMS.map(t => t.id).filter(id => id !== teamId);
  // Home and away: 9 opponents × 2 = 18... but IPL does 14 matches
  // Use 14 matches: each opponent once, then 4 repeat home games
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  return shuffled.concat(shuffled.slice(0, 4)).slice(0, 14);
}

function buildSeasonTable() {
  const table = TEAMS.map(t => ({
    id: t.id, name: t.short, pts: G.season.points[t.id] || 0,
    played: 0, won: 0, lost: 0, nrr: 0
  }));
  for (const r of G.season.results) {
    const our = table.find(t => t.id === G.teamId);
    const opp = table.find(t => t.id === r.opponentId);
    if (our) { our.played++; if (r.win) { our.won++; our.pts += 2; } else { our.lost++; } }
    if (opp) { opp.played++; if (!r.win) { opp.won++; opp.pts += 2; } else { opp.lost++; } }
  }
  return table.sort((a, b) => b.pts - a.pts || b.nrr - a.nrr);
}

// ---- SCREEN RENDERERS ----------------------------------------

function render() {
  const el = root();
  switch (G.screen) {
    case 'home':          el.innerHTML = renderHome(); break;
    case 'teamSelect':    el.innerHTML = renderTeamSelect(); break;
    case 'squadSetup':    el.innerHTML = renderSquadSetup(); break;
    case 'season':        el.innerHTML = renderSeason(); break;
    case 'preMatch':      el.innerHTML = renderPreMatch(); break;
    case 'match':         el.innerHTML = renderMatch(); break;
    case 'postMatch':     el.innerHTML = renderPostMatch(); break;
    case 'seasonEnd':     el.innerHTML = renderSeasonEnd(); break;
  }
  attachHandlers();
}

// ---- HOME ----
function renderHome() {
  return `
  <div class="screen home-screen">
    <div class="home-ball-bg"></div>
    <div class="home-content">
      <div class="home-badge">IPL CHALLENGE</div>
      <h1 class="home-title">74-0</h1>
      <p class="home-sub">Go the entire IPL season <strong>undefeated</strong></p>
      <p class="home-desc">Pick your team. Select your best XI. Win all 14 league games and lift the trophy — without a single defeat.</p>
      <button class="btn btn-primary btn-xl" data-action="start">START SEASON</button>
    </div>
    <div class="home-stats-row">
      <div class="home-stat"><span>14</span><label>League Games</label></div>
      <div class="home-stat"><span>10</span><label>IPL Teams</label></div>
      <div class="home-stat"><span>T20</span><label>Format</label></div>
      <div class="home-stat"><span>0</span><label>Defeats Allowed</label></div>
    </div>
  </div>`;
}

// ---- TEAM SELECT ----
function renderTeamSelect() {
  const cards = TEAMS.map(t => `
    <div class="team-card" data-action="selectTeam" data-team="${t.id}"
         style="--tc:${t.primary};--ts:${t.secondary}">
      <div class="team-card-badge">${t.short}</div>
      <div class="team-card-name">${t.name}</div>
      <div class="team-card-venue">${t.venue}</div>
    </div>`).join('');

  return `
  <div class="screen">
    <div class="screen-header">
      <h2>Choose Your Team</h2>
      <p class="muted">Select the franchise you'll guide through an undefeated season</p>
    </div>
    <div class="teams-grid">${cards}</div>
  </div>`;
}

// ---- SQUAD SETUP ----
function renderSquadSetup() {
  const team = getTeam(G.teamId);
  const squad = getSquad(G.teamId);
  const val = validateXI(G.xi);

  const rows = squad.map(p => {
    const sel = G.xi.includes(p.id);
    const bowlStr = p.bowl ? `${p.bowl.econ} econ / ${p.bowl.wpm.toFixed(1)} wkt` : '—';
    return `
    <div class="player-row ${sel ? 'selected' : ''}" data-action="togglePlayer" data-pid="${p.id}">
      <div class="player-name">${p.name}</div>
      <div class="player-role role-${p.role}">${p.role}</div>
      <div class="player-bat">${p.bat.avg} avg / SR ${p.bat.sr}</div>
      <div class="player-bowl">${bowlStr}</div>
      <div class="player-rating">${p.rating}</div>
      <div class="player-tick">${sel ? '✓' : ''}</div>
    </div>`;
  }).join('');

  const warnings = [];
  if (val.wkCount < 1) warnings.push('Need at least 1 Wicket-Keeper');
  if (val.bowlerCount < 4) warnings.push('Need at least 4 bowlers (BOWL or AR with bowl stats)');

  return `
  <div class="screen">
    <div class="screen-header" style="border-color:${team.primary}">
      <div class="team-pill" style="background:${team.primary};color:${team.secondary}">${team.short}</div>
      <h2>${team.name}</h2>
      <p class="muted">Pick your best XI. Min. 1 WK, 4 bowlers.</p>
    </div>
    <div class="squad-meta">
      <span class="xi-counter ${val.valid ? 'ok' : 'bad'}">${G.xi.length} / 11 selected</span>
      ${warnings.map(w => `<span class="warning">${w}</span>`).join('')}
    </div>
    <div class="player-list">
      <div class="player-row header">
        <div>Name</div><div>Role</div><div>Batting</div><div>Bowling</div><div>OVR</div><div></div>
      </div>
      ${rows}
    </div>
    <div class="squad-actions">
      <button class="btn btn-outline" data-action="autoPickXI">Auto-Pick Best XI</button>
      <button class="btn btn-primary ${val.valid && G.xi.length === 11 ? '' : 'disabled'}"
              data-action="confirmXI" ${val.valid && G.xi.length === 11 ? '' : 'disabled'}>
        Confirm XI & Start Season
      </button>
    </div>
  </div>`;
}

// ---- SEASON HUB ----
function renderSeason() {
  const team = getTeam(G.teamId);
  const { opponents, results, matchIndex } = G.season;
  const table = buildSeasonTable();
  const undefeated = results.every(r => r.win);
  const remaining = 14 - matchIndex;

  const fixtureRows = opponents.map((oppId, i) => {
    const opp = getTeam(oppId);
    const result = results.find(r => r.matchIndex === i);
    let statusCls = 'upcoming', statusTxt = 'VS';
    if (result) { statusCls = result.win ? 'won' : 'lost'; statusTxt = result.win ? 'WON' : 'LOST'; }
    const active = i === matchIndex && !result;
    return `
    <div class="fixture-row ${statusCls} ${active ? 'active' : ''}">
      <div class="fixture-num">Match ${i + 1}</div>
      <div class="fixture-opp">
        <span class="team-chip" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
        ${opp.name}
      </div>
      <div class="fixture-result">${result ? result.margin : ''}</div>
      <div class="fixture-status ${statusCls}">${statusTxt}</div>
    </div>`;
  }).join('');

  const tableRows = table.slice(0, 10).map((row, i) => {
    const isUs = row.id === G.teamId;
    return `
    <tr class="${isUs ? 'our-row' : ''}">
      <td>${i + 1}</td>
      <td><strong>${row.name}</strong></td>
      <td>${row.played}</td><td>${row.won}</td><td>${row.lost}</td>
      <td><strong>${row.pts}</strong></td>
    </tr>`;
  }).join('');

  return `
  <div class="screen season-screen">
    <div class="screen-header" style="border-color:${team.primary}">
      <div class="team-pill" style="background:${team.primary};color:${team.secondary}">${team.short}</div>
      <h2>${team.name}</h2>
      <div class="season-badges">
        ${undefeated && matchIndex > 0 ? '<span class="badge green">UNDEFEATED ✓</span>' : ''}
        <span class="badge">Match ${matchIndex + 1} / 14</span>
        <span class="badge">${remaining} remaining</span>
      </div>
    </div>
    <div class="season-layout">
      <div class="fixtures-col">
        <h3>Fixtures</h3>
        ${fixtureRows}
        ${matchIndex < 14 ? `
        <div class="next-match-bar">
          <button class="btn btn-primary btn-lg" data-action="goToPreMatch">
            ▶ Play Next Match vs ${getTeam(opponents[matchIndex]).name}
          </button>
        </div>` : '<div class="season-done-msg">All league matches complete!</div>'}
      </div>
      <div class="table-col">
        <h3>Points Table</h3>
        <table class="standings-table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

// ---- PRE-MATCH ----
function renderPreMatch() {
  const oppId = G.season.opponents[G.season.matchIndex];
  const opp = getTeam(oppId);
  const team = getTeam(G.teamId);
  const squad = getSquad(G.teamId);
  const xi = G.xi.map(id => squad.find(p => p.id === id));

  const playerList = xi.map(p => `
    <div class="pm-player">
      <span class="role-dot role-${p.role}"></span>
      <span>${p.name}</span>
      <span class="muted" style="margin-left:auto">${p.role}</span>
    </div>`).join('');

  return `
  <div class="screen">
    <div class="screen-header" style="border-color:${team.primary}">
      <h2>
        <span class="team-pill" style="background:${team.primary};color:${team.secondary}">${team.short}</span>
        vs
        <span class="team-pill" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
      </h2>
      <p class="muted">${opp.venue || opp.name}</p>
    </div>
    <div class="pm-layout">
      <div class="pm-xi-col">
        <h3>Your Playing XI</h3>
        <div class="pm-player-list">${playerList}</div>
        <button class="btn btn-outline btn-sm" data-action="changeXI" style="margin-top:12px">
          Change XI
        </button>
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
        <h3 style="margin-top:20px">Match Speed</h3>
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

// ---- MATCH SCREEN ----
function renderMatch() {
  const m = G.match;
  const team = getTeam(G.teamId);
  const opp = getTeam(m.opponentId);

  if (m.phase === 'toss') {
    const tossWinner = m.tossWinner;
    const winner = tossWinner === G.teamId ? team : opp;
    return `
    <div class="screen match-screen">
      <div class="toss-card">
        <div class="toss-coin">🪙</div>
        <h2>Toss Result</h2>
        <p><strong>${winner.name}</strong> won the toss</p>
        <p class="muted">${m.playerBatsFirst ? `${team.short} elected to bat` : `${team.short} elected to bowl`}</p>
        <button class="btn btn-primary" data-action="beginInnings">▶ Begin Match</button>
      </div>
    </div>`;
  }

  if (m.phase === 'inningsBreak') {
    const i1 = m.innings[0];
    return `
    <div class="screen match-screen">
      <div class="break-card">
        <h2>Innings Break</h2>
        <div class="break-score">${i1.runs} / ${i1.wickets}</div>
        <p class="muted">${G.match.playerBatsFirst ? team.short : opp.short} scored in ${i1.overs.length} overs</p>
        <p class="target-line">Target: <strong>${i1.runs + 1}</strong></p>
        <button class="btn btn-primary" data-action="beginSecondInnings">▶ Start 2nd Innings</button>
      </div>
    </div>`;
  }

  if (m.phase === 'awaitingBowler') {
    return renderBowlerSelect();
  }

  const live = m.liveInnings;
  if (!live) return `<div class="screen"><p>Loading...</p></div>`;

  const innings1 = m.innings[0];
  const innings2 = m.innings[1];
  const inningsNum = m.currentInnings;
  const target = inningsNum === 1 && innings1 ? innings1.runs + 1 : null;

  // Displayed overs
  const displayOvers = live.overs.slice(0, m.displayedOvers);
  const lastOver = displayOvers[displayOvers.length - 1];
  const runsDisplayed = displayOvers.reduce((s, o) => s + o.runsInOver, 0);
  const wicketsDisplayed = displayOvers.reduce((s, o) => s + o.balls.filter(b => b.wicket).length, 0);
  const ballsPlayed = displayOvers.reduce((s, o) => s + o.balls.filter(b => b.countsAsBall !== false).length, 0);

  // Current batsmen (approximate from overs displayed)
  const battingTeamXI = m.playerBatsFirst === (inningsNum === 0)
    ? G.xi.map(id => getSquad(G.teamId).find(p => p.id === id))
    : m.opponentXI;

  // Build per-player batting stats from displayed overs
  const batStats = {};
  battingTeamXI.forEach(p => { batStats[p.id] = { r: 0, b: 0, name: p.name }; });
  displayOvers.forEach(o => o.balls.forEach(b => {
    if (!b.wicket && batStats[b.batsmanId]) {
      batStats[b.batsmanId].r += (b.battingRuns !== undefined ? b.battingRuns : b.runs);
      if (b.countsAsBall !== false) batStats[b.batsmanId].b++;
    }
  }));

  // Last 6 balls
  const lastBalls = lastOver ? lastOver.balls.slice(-6) : [];
  const ballDisplays = lastBalls.map(b => {
    const cls = b.wicket ? 'ball-w' : b.runs === 6 ? 'ball-6' : b.runs === 4 ? 'ball-4' : 'ball-run';
    return `<span class="ball-pill ${cls}">${b.display}</span>`;
  }).join('');

  const lastComm = lastOver && lastOver.balls.length
    ? lastOver.balls[lastOver.balls.length - 1].commentary
    : 'Match in progress…';

  // NRR label
  const overs = `${Math.floor(ballsPlayed / 6)}.${ballsPlayed % 6}`;
  const rr = ballsPlayed ? (runsDisplayed / (ballsPlayed / 6)).toFixed(2) : '—';
  const rrr = target && ballsPlayed < 120
    ? (((target - runsDisplayed) / ((120 - ballsPlayed) / 6)).toFixed(2))
    : null;

  const battingTeamName = m.playerBatsFirst === (inningsNum === 0) ? team : opp;
  const bowlingTeamName = m.playerBatsFirst === (inningsNum === 0) ? opp : team;

  const canAdvance = m.displayedOvers < live.overs.length && m.phase === 'live';
  const isUserBowling = (inningsNum === 0 && !m.playerBatsFirst) || (inningsNum === 1 && m.playerBatsFirst);

  return `
  <div class="screen match-screen">
    <div class="match-header">
      <span class="team-chip" style="background:${team.primary};color:${team.secondary}">${team.short}</span>
      <span class="match-vs">vs</span>
      <span class="team-chip" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
      <span class="innings-badge">Innings ${inningsNum + 1}</span>
    </div>

    <div class="scoreboard">
      <div class="score-main">
        <div class="score-team">${battingTeamName.short}</div>
        <div class="score-runs">${runsDisplayed}<span class="score-wkts">/${wicketsDisplayed}</span></div>
        <div class="score-overs">(${overs} ov)</div>
      </div>
      ${target ? `<div class="target-box">Target: <strong>${target}</strong> ${rrr ? `| RRR: <strong>${rrr}</strong>` : ''}</div>` : ''}
      ${innings1 ? `<div class="innings1-score">${m.playerBatsFirst === (inningsNum === 0) ? opp.short : team.short}: ${innings1.runs}/${innings1.wickets} (${innings1.overs.length} ov)</div>` : ''}
      <div class="rr-line">CRR: ${rr}</div>
    </div>

    <div class="last-balls">
      <span class="muted" style="font-size:12px">Last over: </span>${ballDisplays || '<span class="muted">—</span>'}
    </div>

    <div class="commentary">${lastComm}</div>

    ${canAdvance ? `
    <div class="over-nav">
      ${isUserBowling && m.displayedOvers < live.overs.length - 1 ? `
        <div class="bowler-change-bar">
          Next over: ${live.overs[m.displayedOvers] ? getBowlerName(live.overs[m.displayedOvers].bowler) : ''}
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

function getBowlerName(bowlerId) {
  const allSquads = Object.values(SQUADS).flat();
  const p = allSquads.find(p => p.id === bowlerId);
  return p ? p.name.split(' ').pop() : bowlerId;
}

function renderBowlerSelect() {
  const m = G.match;
  const opp = getTeam(m.opponentId);
  const team = getTeam(G.teamId);
  const isUserBowling = (m.currentInnings === 0 && !m.playerBatsFirst) || (m.currentInnings === 1 && m.playerBatsFirst);

  if (!isUserBowling) {
    G.match.phase = 'live';
    return renderMatch();
  }

  const bowlers = G.xi.map(id => getSquad(G.teamId).find(p => p.id === id)).filter(p => p && p.bowl);
  const lastBowlerId = m.lastBowlerId;
  const used = m.bowlerOversUsed || {};

  const opts = bowlers.map(p => {
    const maxOv = G.match.bowlingPlan[p.id] || 4;
    const usedOv = used[p.id] || 0;
    const avail = usedOv < maxOv && p.id !== lastBowlerId;
    return `
    <button class="bowler-opt ${!avail ? 'unavail' : ''}" data-action="chooseBowler" data-bowler="${p.id}" ${!avail ? 'disabled' : ''}>
      <strong>${p.name}</strong>
      <span class="muted">${usedOv}/${maxOv} ov used • Econ ${p.bowl.econ} • ${p.bowl.wpm.toFixed(1)} wkt/m</span>
    </button>`;
  }).join('');

  return `
  <div class="screen match-screen">
    <div class="match-header">
      <span class="team-chip" style="background:${team.primary};color:${team.secondary}">${team.short}</span>
      <span>vs</span>
      <span class="team-chip" style="background:${opp.primary};color:${opp.secondary}">${opp.short}</span>
    </div>
    <div class="bowler-select-card">
      <h3>Choose Bowler for Over ${(m.displayedOvers || 0) + 1}</h3>
      <p class="muted">Pick who bowls the next over</p>
      <div class="bowler-opts">${opts}</div>
      <button class="btn btn-outline" data-action="cancelBowlerSelect" style="margin-top:12px">Auto-Select</button>
    </div>
  </div>`;
}

// ---- POST MATCH ----
function renderPostMatch() {
  const m = G.match;
  const team = getTeam(G.teamId);
  const opp = getTeam(m.opponentId);
  const result = G.season.results[G.season.results.length - 1];
  const win = result.win;

  const i1 = m.innings[0], i2 = m.innings[1];

  function scorecardTable(innings, title) {
    if (!innings) return '';
    const batRows = innings.batsmanStats.map(b => `
      <tr>
        <td>${b.player.name}</td>
        <td>${b.out ? 'out' : 'not out'}</td>
        <td>${b.runs}</td>
        <td>(${b.balls})</td>
        <td>${b.fours}</td>
        <td>${b.sixes}</td>
      </tr>`).join('');
    const bowlRows = innings.bowlerStats.map(b => `
      <tr>
        <td>${b.player.name}</td>
        <td>${b.overs}-0-${b.runs}-${b.wickets}</td>
      </tr>`).join('');
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
    <div class="result-header ${win ? 'result-win' : 'result-loss'}">
      <div class="result-badge">${win ? '🏆 WON' : '💀 LOST'}</div>
      <h2>${win ? result.margin : result.margin}</h2>
      <p>${team.short} vs ${opp.short}</p>
    </div>
    <div class="scorecard-body">
      ${scorecardTable(i1, `${m.playerBatsFirst ? team.short : opp.short} 1st innings`)}
      ${scorecardTable(i2, `${m.playerBatsFirst ? opp.short : team.short} 2nd innings`)}
    </div>
    <div class="post-actions">
      ${win ? `<button class="btn btn-primary btn-lg" data-action="continueSeasonAfterMatch">Continue Season →</button>`
             : `<button class="btn btn-danger btn-lg" data-action="gameOver">Season Over</button>`}
    </div>
  </div>`;
}

// ---- SEASON END ----
function renderSeasonEnd() {
  const allWon = G.season.results.every(r => r.win);
  const team = getTeam(G.teamId);
  return `
  <div class="screen season-end-screen">
    ${allWon ? `
    <div class="trophy-area">
      <div class="trophy-icon">🏆</div>
      <h1>UNDEFEATED CHAMPIONS</h1>
      <p class="muted">You went the entire IPL season without a single defeat.</p>
      <div class="team-pill big" style="background:${team.primary};color:${team.secondary}">${team.name}</div>
      <div class="season-record">14 Matches • 14 Wins • 0 Defeats</div>
    </div>` : `
    <div class="defeat-area">
      <div class="defeat-icon">💀</div>
      <h1>SEASON OVER</h1>
      <p class="muted">The dream of an undefeated season ends here.</p>
      <div class="season-record">${G.season.results.filter(r=>r.win).length} Wins • ${G.season.results.filter(r=>!r.win).length} Defeat(s)</div>
    </div>`}
    <button class="btn btn-primary btn-xl" data-action="playAgain" style="margin-top:32px">Play Again</button>
  </div>`;
}

// ---- EVENT HANDLERS -------------------------------------------
function attachHandlers() {
  document.querySelectorAll('[data-action]').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      handleAction(el.dataset.action, el.dataset);
    };
  });

  // Radio buttons for aggression & speed
  document.querySelectorAll('input[name="aggr"]').forEach(r => {
    r.onchange = () => { G.match.aggression = r.value; render(); };
  });
  document.querySelectorAll('input[name="speed"]').forEach(r => {
    r.onchange = () => { G.match.speed = r.value; render(); };
  });
}

function handleAction(action, data) {
  switch (action) {
    case 'start':         G.screen = 'teamSelect'; render(); break;
    case 'selectTeam':    selectTeam(data.team); break;
    case 'togglePlayer':  togglePlayer(data.pid); break;
    case 'autoPickXI':    autoPickXI(); break;
    case 'confirmXI':     confirmXI(); break;
    case 'changeXI':      G.screen = 'squadSetup'; render(); break;
    case 'goToPreMatch':  G.screen = 'preMatch'; render(); break;
    case 'backToSeason':  G.screen = 'season'; render(); break;
    case 'startMatch':    startMatch(); break;
    case 'beginInnings':  beginFirstInnings(); break;
    case 'advanceOver':   advanceOver(); break;
    case 'simulateAll':   simulateAll(); break;
    case 'inningsComplete': handleInningsComplete(); break;
    case 'beginSecondInnings': beginSecondInnings(); break;
    case 'openBowlerSelect': G.match.phase = 'awaitingBowler'; render(); break;
    case 'chooseBowler':  chooseBowler(data.bowler); break;
    case 'cancelBowlerSelect': G.match.phase = 'live'; render(); break;
    case 'continueSeasonAfterMatch': continueSeasonAfterMatch(); break;
    case 'gameOver':      G.screen = 'seasonEnd'; render(); break;
    case 'playAgain':     resetGame(); break;
  }
}

// ---- GAME ACTIONS ---------------------------------------------
function selectTeam(teamId) {
  G.teamId = teamId;
  G.xi = [];
  G.screen = 'squadSetup';
  render();
}

function togglePlayer(pid) {
  if (G.xi.includes(pid)) {
    G.xi = G.xi.filter(id => id !== pid);
  } else if (G.xi.length < 11) {
    G.xi.push(pid);
  }
  render();
}

function autoPickXI() {
  const squad = getSquad(G.teamId).sort((a, b) => b.rating - a.rating);
  const xi = [];
  // 1 WK
  const wk = squad.find(p => p.role === 'WK');
  if (wk) xi.push(wk.id);
  // 4 bowlers
  const bowlers = squad.filter(p => p.bowl && !xi.includes(p.id));
  bowlers.slice(0, 4).forEach(p => xi.push(p.id));
  // Fill rest
  for (const p of squad) {
    if (xi.length >= 11) break;
    if (!xi.includes(p.id)) xi.push(p.id);
  }
  G.xi = xi.slice(0, 11);
  render();
}

function confirmXI() {
  const val = validateXI(G.xi);
  if (!val.valid || G.xi.length !== 11) return;

  G.battingOrder = [...G.xi];

  // Default bowling plan: top 4 bowlers get 4 overs, others 2
  const squad = getSquad(G.teamId);
  const bowlers = G.xi.map(id => squad.find(p => p.id === id))
    .filter(p => p && p.bowl)
    .sort((a, b) => b.rating - a.rating);
  G.bowlingPlan = {};
  bowlers.forEach((p, i) => { G.bowlingPlan[p.id] = i < 4 ? 4 : 2; });

  // Build season fixtures
  G.season.opponents = generateFixtures(G.teamId);
  G.season.results = [];
  G.season.matchIndex = 0;
  G.season.points = {};
  TEAMS.forEach(t => { G.season.points[t.id] = 0; });

  G.screen = 'season';
  render();
}

function startMatch() {
  const oppId = G.season.opponents[G.season.matchIndex];
  G.match.opponentId = oppId;
  G.match.opponentXI = pickAIXI(oppId);
  G.match.bowlingPlan = { ...G.bowlingPlan };
  G.match.bowlerOversUsed = {};
  G.match.lastBowlerId = null;
  G.match.userBowlerPlan = {};
  G.match.innings = [null, null];
  G.match.currentInnings = 0;
  G.match.displayedOvers = 0;
  G.match.liveInnings = null;

  // Toss
  const tossWinner = Math.random() < 0.5 ? G.teamId : oppId;
  G.match.tossWinner = tossWinner;
  // Toss winner bats first (simple: if we win toss, we bat first; else they do)
  G.match.playerBatsFirst = tossWinner === G.teamId;
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
  const squad = getSquad(G.teamId);

  const playerBatting = m.playerBatsFirst === (inningsNum === 0);
  const battingXI = playerBatting
    ? G.xi.map(id => squad.find(p => p.id === id))
    : m.opponentXI;
  const bowlingXI = playerBatting
    ? m.opponentXI
    : G.xi.map(id => squad.find(p => p.id === id));

  const target = inningsNum === 1 ? (m.innings[0].runs + 1) : null;

  // Aggression function
  const playerBowling = !playerBatting;
  const aggrFn = {
    getAggression: (overNum) => playerBatting ? aggressionMod(m.aggression) : aggressionMod('normal'),
    getBowler: null,
  };

  // Build bowling plan for this innings
  let bowlingPlan;
  if (playerBowling) {
    bowlingPlan = { ...m.bowlingPlan };
  } else {
    bowlingPlan = buildDefaultBowlingPlan(bowlingXI);
  }

  const innings = simulateInnings(battingXI, bowlingXI, target, bowlingPlan, aggrFn);
  m.innings[inningsNum] = innings;
  m.liveInnings = innings;
  m.displayedOvers = 0;
  m.bowlerOversUsed = {};
  render();
}

function advanceOver() {
  const m = G.match;
  const live = m.liveInnings;
  if (!live) return;

  if (G.match.speed === 'fast') {
    simulateAll();
    return;
  }

  m.displayedOvers = Math.min(m.displayedOvers + 1, live.overs.length);
  render();
}

function simulateAll() {
  const m = G.match;
  const live = m.liveInnings;
  if (live) m.displayedOvers = live.overs.length;
  render();
}

function handleInningsComplete() {
  const m = G.match;
  if (m.currentInnings === 0) {
    m.phase = 'inningsBreak';
    render();
  } else {
    finishMatch();
  }
}

function beginSecondInnings() {
  G.match.currentInnings = 1;
  G.match.phase = 'live';
  G.match.bowlerOversUsed = {};
  G.match.lastBowlerId = null;
  simulateCurrentInnings();
}

function chooseBowler(bowlerId) {
  const m = G.match;
  m.lastBowlerId = m.liveInnings && m.liveInnings.overs[m.displayedOvers - 1]
    ? m.liveInnings.overs[m.displayedOvers - 1].bowler
    : null;

  // Re-simulate remaining innings with this bowler first
  m.userBowlerPlan[m.displayedOvers] = bowlerId;
  m.phase = 'live';

  // Re-simulate the innings from scratch with updated plan
  resimulateWithBowlerPlan();
}

function resimulateWithBowlerPlan() {
  const m = G.match;
  const inningsNum = m.currentInnings;
  const squad = getSquad(G.teamId);

  const playerBatting = m.playerBatsFirst === (inningsNum === 0);
  const battingXI = playerBatting
    ? G.xi.map(id => squad.find(p => p.id === id))
    : m.opponentXI;
  const bowlingXI = playerBatting
    ? m.opponentXI
    : G.xi.map(id => squad.find(p => p.id === id));

  const target = inningsNum === 1 ? (m.innings[0].runs + 1) : null;

  const aggrFn = {
    getAggression: (overNum) => playerBatting ? aggressionMod(m.aggression) : aggressionMod('normal'),
    getBowler: (overNum) => m.userBowlerPlan[overNum] || null,
  };

  const bowlingPlan = { ...m.bowlingPlan };
  const innings = simulateInnings(battingXI, bowlingXI, target, bowlingPlan, aggrFn);
  m.innings[inningsNum] = innings;
  m.liveInnings = innings;
  render();
}

function finishMatch() {
  const m = G.match;
  const i1 = m.innings[0], i2 = m.innings[1];
  const team = getTeam(G.teamId);
  const opp = getTeam(m.opponentId);

  let win, margin;
  if (i1 && i2) {
    if (m.playerBatsFirst) {
      // Player batted first
      if (i2.runs > i1.runs) { win = false; margin = `${opp.short} won by ${10 - i2.wickets} wickets`; }
      else { win = true; margin = `${team.short} won by ${i1.runs - i2.runs} runs`; }
    } else {
      // Opponent batted first
      if (i2.runs > i1.runs) { win = true; margin = `${team.short} won by ${10 - i2.wickets} wickets`; }
      else { win = false; margin = `${opp.short} won by ${i1.runs - i2.runs} runs`; }
    }
  } else {
    win = false; margin = 'Match incomplete';
  }

  const result = {
    matchIndex: G.season.matchIndex,
    opponentId: m.opponentId,
    win, margin,
    innings: [i1, i2],
  };
  G.season.results.push(result);
  G.season.matchIndex++;

  if (!win) {
    G.season.matchIndex = 14; // end season
  }

  G.screen = 'postMatch';
  render();
}

function continueSeasonAfterMatch() {
  if (G.season.matchIndex >= 14) {
    G.screen = 'seasonEnd';
  } else {
    G.screen = 'season';
  }
  render();
}

function resetGame() {
  G = {
    screen: 'home',
    teamId: null, xi: [], battingOrder: [], bowlingPlan: {},
    season: { opponents: [], results: [], matchIndex: 0, points: {}, nrr: {} },
    match: { opponentId: null, opponentXI: [], playerBatsFirst: null, innings: [null, null],
             phase: 'idle', liveInnings: null, displayedOvers: 0,
             awaitingBowler: false, chosenBowler: null, aggression: 'normal',
             userBowlerPlan: {}, speed: 'normal', bowlerOversUsed: {}, lastBowlerId: null,
             bowlingPlan: {}, tossWinner: null, currentInnings: 0 },
  };
  render();
}

// ---- INIT ---------------------------------------------------
resetGame();
