import type { Tournament, TournamentMatch } from '../../types/tournaments.ts';

export function playoffRoundTitle(round: number, lastRound: number): string {
  if (round === lastRound) return 'Championship';
  if (round === lastRound - 1) return 'Semifinals';
  if (round === lastRound - 2) return 'Quarterfinals';
  throw new Error('Unsupported playoff round.');
}

export function tournamentMatchTitle(tournament: Tournament, match: TournamentMatch): string {
  if (match.stage === 'pool') return `${tournament.style === 'rotating-partner-round-robin' ? 'Round' : 'Pool round'} ${match.round}`;
  const lastRound = Math.max(...tournament.playoffs.map((entry) => entry.round));
  const title = playoffRoundTitle(match.round, lastRound);
  const index = tournament.playoffs.filter((entry) => entry.round === match.round).findIndex((entry) => entry.id === match.id);
  if (index < 0) throw new Error('Playoff match is missing from the bracket.');
  return title === 'Championship' ? title : `${title.slice(0, -1)} ${index + 1}`;
}

export function playoffPlaceholder(tournament: Tournament, match: TournamentMatch, side: 'A' | 'B'): string {
  if (match.bye) return 'Bye';
  const id = side === 'A' ? match.fromA : match.fromB;
  const source = tournament.playoffs.find((entry) => entry.id === id);
  if (!source) throw new Error('Playoff feeder is missing.');
  return `Winner of ${tournamentMatchTitle(tournament, source)}`;
}

export function getPlayoffLayout(tournament: Tournament, fontScale: number) {
  if (!Number.isFinite(fontScale) || fontScale <= 0) throw new Error('Invalid bracket font scale.');
  const scale = Math.max(1, fontScale);
  const cardWidth = 260;
  const cardHeight = Math.ceil(180 * scale);
  const roundGap = 40;
  const rowGap = 16;
  const headingHeight = Math.ceil(44 * scale);
  const roundCount = Math.max(0, ...tournament.playoffs.map((match) => match.round));
  const rounds = Array.from({ length: roundCount }, (_, index) => ({
    round: index + 1, title: playoffRoundTitle(index + 1, roundCount), left: index * (cardWidth + roundGap),
  }));
  // Center each later-round card between its two feeder slots.
  const nodes = rounds.flatMap((round) => tournament.playoffs.filter((match) => match.round === round.round).map((match, index) => ({
    match, title: tournamentMatchTitle(tournament, match), left: round.left,
    top: headingHeight + ((index + 0.5) * 2 ** (round.round - 1) - 0.5) * (cardHeight + rowGap),
  })));
  const lines = nodes.flatMap((node) => [node.match.fromA, node.match.fromB].filter((id) => id !== null).flatMap((id) => {
    const source = nodes.find((entry) => entry.match.id === id);
    if (!source || source.match.round + 1 !== node.match.round) throw new Error('Invalid bracket connection.');
    const left = source.left + cardWidth;
    const sourceY = source.top + cardHeight / 2;
    const targetY = node.top + cardHeight / 2;
    return [
      { left, top: sourceY, width: roundGap / 2, height: 2 },
      { left: left + roundGap / 2, top: Math.min(sourceY, targetY), width: 2, height: Math.abs(targetY - sourceY) + 2 },
      { left: left + roundGap / 2, top: targetY, width: roundGap / 2, height: 2 },
    ];
  }));
  return {
    rounds, nodes, lines, cardWidth, cardHeight, headingHeight,
    width: roundCount ? roundCount * cardWidth + (roundCount - 1) * roundGap : 0,
    height: roundCount ? Math.max(...nodes.map((node) => node.top + cardHeight)) : 0,
  };
}
