// ============================================================
//  MATCH SIMULATION ENGINE
// ============================================================

// Returns a ball outcome object:
// { runs, wicket, wide, noBall, display, commentary }
function simulateBall(batsman, bowler, overNum, aggressionMod) {
  const isWide = Math.random() < 0.04;
  const isNoBall = !isWide && Math.random() < 0.015;

  // Effective SR: batsman attack vs bowler defense + aggression
  let effSR = batsman.bat.sr + (bowler.bowl.econ - 8.0) * 12 + aggressionMod;
  effSR = Math.max(50, Math.min(220, effSR));

  // Wicket probability: sr / (avg * 100), adjusted by bowler & pitch
  const baseWktProb = batsman.bat.sr / (batsman.bat.avg * 100);
  const wpmMod = bowler.bowl.wpm / 1.5;
  const ppMod = overNum < 6 ? 0.80 : (overNum >= 16 ? 1.15 : 1.0);
  const aggrWktMod = 1 + aggressionMod / 200;
  let wicketProb = baseWktProb * wpmMod * ppMod * aggrWktMod;
  if (isWide || isNoBall) wicketProb = 0;

  const rand = Math.random();
  if (!isWide && !isNoBall && rand < wicketProb) {
    const modes = ['bowled', 'caught', 'lbw', 'caught behind', 'stumped', 'run out'];
    const wMode = modes[Math.floor(Math.random() * modes.length)];
    return { runs: 0, wicket: true, wide: false, noBall: false, display: 'W', commentary: dismissalCommentary(batsman, bowler, wMode) };
  }

  // Run scoring
  const runs = rollRuns(effSR, overNum, isWide || isNoBall);
  const extraRuns = (isWide || isNoBall) ? 1 : 0;
  const totalRuns = runs + extraRuns;
  const display = isWide ? `Wd+${runs||''}` : isNoBall ? `NB+${runs||''}` : String(runs || '·');

  return {
    runs: totalRuns,
    battingRuns: runs,
    wicket: false,
    wide: isWide,
    noBall: isNoBall,
    countsAsBall: !isWide && !isNoBall,
    display,
    commentary: runCommentary(batsman, bowler, runs, isWide, isNoBall, overNum)
  };
}

function rollRuns(sr, overNum, isExtra) {
  // death overs bonus
  const deathBoost = overNum >= 16 ? 1.15 : 1.0;
  const ppBoost = overNum < 6 ? 0.95 : 1.0;
  const eff = sr * deathBoost * ppBoost;

  // probability buckets calibrated to produce correct run rate
  const sixProb  = Math.max(0, 0.05 + (eff - 130) / 1000);
  const fourProb = Math.max(0, 0.09 + (eff - 130) / 700);
  const dotProb  = Math.max(0.15, 0.52 - (eff - 130) / 550);
  const rem = 1 - sixProb - fourProb - dotProb;
  const oneProb  = rem * 0.74;
  const twoProb  = rem * 0.19;
  const threeProb = rem * 0.07;

  const r = Math.random();
  if (r < dotProb) return 0;
  if (r < dotProb + oneProb) return 1;
  if (r < dotProb + oneProb + twoProb) return 2;
  if (r < dotProb + oneProb + twoProb + threeProb) return 3;
  if (r < dotProb + oneProb + twoProb + threeProb + fourProb) return 4;
  return 6;
}

// Simulate one full innings, returns structured innings data
// battingXI / bowlingXI: arrays of player objects
// target: null = first innings, number = run chase
// bowlingPlan: { playerID -> maxOvers } (user's plan or AI)
function simulateInnings(battingXI, bowlingXI, target, bowlingPlan, aggressionFn) {
  const balls = [];
  const batsmanStats = battingXI.map(p => ({ player: p, runs: 0, balls: 0, fours: 0, sixes: 0, out: false }));
  const bowlerStats  = bowlingXI.map(p => ({ player: p, overs: 0, balls: 0, runs: 0, wickets: 0 }));

  let wickets = 0;
  let runs = 0;
  let extras = 0;
  let activeBat = [0, 1]; // indexes into batsmanStats
  let overLog = [];

  const getBowlerStats = (id) => bowlerStats.find(b => b.player.id === id);

  // Build bowling rotation from plan
  const maxOvers = bowlingPlan || buildDefaultBowlingPlan(bowlingXI);

  let bowlerOversUsed = {};
  bowlingXI.forEach(p => { if (p.bowl) bowlerOversUsed[p.id] = 0; });

  function pickNextBowler(lastBowlerId) {
    // Eligible: has bowl stats, under max overs, not same as last bowler
    const eligible = bowlingXI.filter(p =>
      p.bowl &&
      (bowlerOversUsed[p.id] || 0) < (maxOvers[p.id] || 4) &&
      p.id !== lastBowlerId
    );
    if (!eligible.length) {
      // Force use anyone who can bowl
      const any = bowlingXI.filter(p => p.bowl && p.id !== lastBowlerId);
      if (!any.length) return bowlingXI.find(p => p.bowl);
      return any.sort((a, b) => b.rating - a.rating)[0];
    }
    // Pick highest rated available
    return eligible.sort((a, b) => b.rating - a.rating)[0];
  }

  let lastBowlerId = null;
  let currentBowler = null;

  for (let overNum = 0; overNum < 20; overNum++) {
    if (wickets >= 10) break;
    if (target !== null && runs >= target) break;

    // Caller can provide a bowler for this over (interactive mode)
    if (aggressionFn && aggressionFn.getBowler) {
      const chosen = aggressionFn.getBowler(overNum);
      currentBowler = bowlingXI.find(p => p.id === chosen) || pickNextBowler(lastBowlerId);
    } else {
      currentBowler = pickNextBowler(lastBowlerId);
    }

    const bowlerSt = getBowlerStats(currentBowler.id);
    const overBalls = [];
    let ballsInOver = 0;

    while (ballsInOver < 6) {
      if (wickets >= 10) break;
      if (target !== null && runs >= target) break;

      const striker = activeBat[0];
      const batSt = batsmanStats[striker];
      const aggMod = aggressionFn ? aggressionFn.getAggression(overNum) : 0;
      const ball = simulateBall(batSt.player, currentBowler, overNum, aggMod);

      ball.overNum = overNum;
      ball.ballInOver = ballsInOver;
      ball.strikerIdx = striker;
      ball.batsmanId = batSt.player.id;
      ball.bowlerId = currentBowler.id;
      balls.push(ball);
      overBalls.push(ball);

      if (ball.countsAsBall !== false) {
        batSt.balls++;
        ballsInOver++;
        bowlerSt.balls++;
      }

      if (ball.wicket) {
        batSt.out = true;
        wickets++;
        bowlerSt.wickets++;

        // Bring in next batsman
        const nextIdx = battingXI.findIndex((p, i) => i > activeBat[1] &&
          batsmanStats[i] && !batsmanStats[i].out);
        if (nextIdx !== -1 && nextIdx < battingXI.length) {
          activeBat[0] = nextIdx;
        }
      } else {
        batSt.runs += ball.battingRuns !== undefined ? ball.battingRuns : ball.runs;
        if (ball.battingRuns === 4 || ball.runs === 4) batSt.fours++;
        if (ball.battingRuns === 6 || ball.runs === 6) batSt.sixes++;
        runs += ball.runs;
        if (ball.wide || ball.noBall) extras += 1;
        bowlerSt.runs += ball.runs;

        // Rotate strike on odd runs
        const scoredRuns = ball.battingRuns !== undefined ? ball.battingRuns : ball.runs;
        if (scoredRuns % 2 === 1) activeBat.reverse();
      }

      // End of over rotate
      if (ballsInOver === 6) activeBat.reverse();
    }

    bowlerSt.overs++;
    bowlerOversUsed[currentBowler.id] = (bowlerOversUsed[currentBowler.id] || 0) + 1;
    lastBowlerId = currentBowler.id;
    overLog.push({ overNum, bowler: currentBowler.id, balls: overBalls, runsInOver: overBalls.reduce((s, b) => s + b.runs, 0) });
  }

  return {
    runs, wickets, extras,
    balls, overs: overLog,
    batsmanStats: batsmanStats.filter(b => b.balls > 0 || b.out),
    bowlerStats: bowlerStats.filter(b => b.balls > 0),
    completed: wickets >= 10 || (!target && balls.length >= 120) || (target && runs >= target),
  };
}

function buildDefaultBowlingPlan(bowlingXI) {
  const plan = {};
  const bowlers = bowlingXI.filter(p => p.bowl).sort((a, b) => b.rating - a.rating);
  bowlers.forEach((p, i) => { plan[p.id] = i < 4 ? 4 : 2; });
  return plan;
}

// Commentary generators
function dismissalCommentary(batsman, bowler, mode) {
  const excl = ['!', '!!', '!!!'][Math.floor(Math.random() * 3)];
  return `OUT${excl} ${batsman.name} ${mode} ${bowler.name}`;
}

function runCommentary(batsman, bowler, runs, wide, noBall, overNum) {
  if (wide) return `Wide ball from ${bowler.name}.`;
  if (noBall) return `No ball from ${bowler.name}!${runs ? ` ${batsman.name} hits ${runs}.` : ''}`;
  if (runs === 6) {
    const shots = ['launches it over long-on', 'muscled over midwicket', 'slog swept over deep square', 'drills it over extra cover'];
    return `SIX! ${batsman.name} ${shots[Math.floor(Math.random() * shots.length)]}!`;
  }
  if (runs === 4) {
    const shots = ['drives through covers', 'cuts past point', 'pulls to deep square', 'flicks to fine leg'];
    return `FOUR! ${batsman.name} ${shots[Math.floor(Math.random() * shots.length)]}.`;
  }
  if (runs === 3) return `Three runs for ${batsman.name}, good running!`;
  if (runs === 2) return `${batsman.name} pushes to mid-off, two runs.`;
  if (runs === 1) return `${batsman.name} nudges to leg, single.`;
  return `Dot ball. ${bowler.name} beats ${batsman.name} outside off.`;
}

// Compute NRR for standings
function computeNRR(results, teamId) {
  let runsScored = 0, oversFor = 0, runsConceded = 0, oversAgainst = 0;
  for (const r of results) {
    if (r.teamId === teamId) {
      runsScored += r.scored; oversFor += r.oversPlayed;
      runsConceded += r.conceded; oversAgainst += r.oversBowled;
    }
  }
  if (!oversFor || !oversAgainst) return 0;
  return (runsScored / oversFor) - (runsConceded / oversAgainst);
}
