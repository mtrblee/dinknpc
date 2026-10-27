import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MAX_TOURNAMENT_TEAMS } from '../../domain/tournaments';
import { DEFAULT_TOURNAMENT_SCORING, tournamentScoringLabel } from '../../domain/tournamentScoring';
import type { SavedGroup } from '../../types/api';
import type { TournamentAction, TournamentScoring, TournamentStyle, TournamentTarget } from '../../types/tournaments';
import { Action, colors, ErrorMessage, Field, PlayerAvatar, PlayerChoiceGrid, PlayerName, styles } from './ui';

export function TournamentSetup({ group, busy, onCreate }: {
  group: SavedGroup; busy: boolean;   onCreate: (action: Extract<TournamentAction, { type: 'create' }>) => Promise<string | null>;
}) {
  const [style, setStyle] = useState<TournamentStyle>('fixed-round-robin');
  const [name, setName] = useState('');
  const [teams, setTeams] = useState<readonly (readonly string[])[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [rotatingPlayers, setRotatingPlayers] = useState<readonly string[]>([]);
  const [rotatingError, setRotatingError] = useState<string | null>(null);
  const [scoring, setScoring] = useState<TournamentScoring>(DEFAULT_TOURNAMENT_SCORING);
  const [rotatingTarget, setRotatingTarget] = useState<TournamentTarget>(11);
  const rotating = style === 'rotating-partner-round-robin';
  const used = new Set(teams.flat());
  const unavailable = teams.some((team) => team.some((id) => !group.players.some((player) => player.id === id && !player.isDeleted)));
  const rotatingUnavailable = rotatingPlayers.some((id) => !group.players.some((player) => player.id === id && !player.isDeleted));

  useEffect(() => {
    const remaining = selected.filter((id) => group.players.some((player) => player.id === id && !player.isDeleted));
    if (remaining.length === selected.length) return;
    setSelected(remaining);
    setSelectionError('A selected player was removed from the group. Choose a replacement.');
  }, [group.players, selected]);
  useEffect(() => {
    const remaining = rotatingPlayers.filter((id) => group.players.some((player) => player.id === id && !player.isDeleted));
    if (remaining.length === rotatingPlayers.length) return;
    setRotatingPlayers(remaining);
    setRotatingError('A selected player is no longer available. Choose a replacement.');
  }, [group.players, rotatingPlayers]);

  async function create() {
    setError(null);
    const message = await onCreate(rotating
      ? { type: 'create', style: 'rotating-partner-round-robin', name, players: rotatingPlayers,
        scoring: { ...DEFAULT_TOURNAMENT_SCORING, pool: rotatingTarget } }
      : { type: 'create', name, teams, scoring });
    setError(message);
    if (message === null) {
      setName(''); setTeams([]); setSelected([]); setRotatingPlayers([]); setRotatingError(null);
      setScoring(DEFAULT_TOURNAMENT_SCORING); setRotatingTarget(11);
    }
  }
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>Create tournament</Text>
      <View style={setup.formats}>
        {([
          { id: 'fixed-round-robin', label: 'Fixed teams', detail: 'Round robin + playoffs' },
          { id: 'rotating-partner-round-robin', label: 'Rotating partners', detail: 'Individual rankings' },
        ] as const).map((option) => (
          <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{ checked: style === option.id, disabled: busy }} disabled={busy}
            onPress={() => { setStyle(option.id); setError(null); }}
            style={({ pressed }) => [setup.format, style === option.id && setup.selected, (pressed || busy) && styles.dimmed]}>
            <Text style={setup.formatLabel}>{option.label}</Text>
            <Text style={setup.formatDetail}>{option.detail}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.body}>
        {rotating ? 'Choose exactly 4 or 8 players. Everyone partners with every other player once. Rank individuals by wins, then point differential; exact ties share a rank. No playoffs.'
          : 'Every fixed team plays every other team once. All teams advance to single elimination. Choose the scoring rules below.'}
      </Text>
      <Text style={styles.secondary}>No simulated wagers. Each played game counts toward group standings. Players, teams, and scoring rules lock at creation.</Text>
      <Field label="Tournament name" value={name} onChangeText={setName} editable={!busy} />
      <View style={styles.compactForm}>
        <Text accessibilityRole="header" style={styles.compactFormTitle}>Scoring rules</Text>
        <TargetChoice label={rotating ? 'Rotating games' : 'Round robin'} value={rotating ? rotatingTarget : scoring.pool}
          busy={busy} onChange={target => rotating ? setRotatingTarget(target) : setScoring(current => ({ ...current, pool: target }))} />
        {!rotating && <>
          <TargetChoice label="Playoffs" value={scoring.playoff} busy={busy}
            onChange={target => setScoring(current => ({ ...current, playoff: target }))} />
          <Text style={styles.compactFormTitle}>Championship</Text>
          <View style={setup.scoreChoices}>
            {(['single-11', 'single-15', 'best-of-3-11'] as const).map(championship => {
              const label = tournamentScoringLabel('championship', { ...scoring, championship });
              return <Pressable key={championship} accessibilityRole="radio" accessibilityLabel={`Championship: ${label}`}
                accessibilityState={{ checked: scoring.championship === championship, disabled: busy }} disabled={busy}
                onPress={() => setScoring(current => ({ ...current, championship }))}
                style={({ pressed }) => [setup.scoreChoice, scoring.championship === championship && setup.selected, (pressed || busy) && styles.dimmed]}>
                <Text style={setup.formatDetail}>{label}</Text>
              </Pressable>;
            })}
          </View>
        </>}
        <Text style={styles.scoreNote}>Every game is win by two, with no cap.{!rotating && ' Best-of-three is championship-only; stop when a team wins two games.'}</Text>
      </View>
      <Text style={styles.scoreNote}>Add guests in Group settings &gt; View players before choosing participants.</Text>
      {group.players.filter((player) => !player.isDeleted).length < 4 && <Text style={styles.body}>Add at least four active group players, registered or guests, to make two teams.</Text>}
      <View style={rotating ? styles.section : { display: 'none' }}>
        <Text style={styles.label}>Players ({rotatingPlayers.length}/8)</Text>
        <Text style={styles.scoreNote}>4 players: 3 rounds / 3 games. 8 players: 7 rounds / 14 games. Six players cannot form every partnership exactly once in doubles.</Text>
        <PlayerChoiceGrid group={group} context="Rotating tournament" selected={rotatingPlayers}
          isDisabled={(id) => busy || (!rotatingPlayers.includes(id) && rotatingPlayers.length >= 8)}
          onToggle={(id) => {
            setRotatingError(null);
            setRotatingPlayers(rotatingPlayers.includes(id) ? rotatingPlayers.filter((entry) => entry !== id) : [...rotatingPlayers, id]);
          }} />
        <ErrorMessage message={rotatingError} />
      </View>
      <View style={!rotating ? styles.section : { display: 'none' }}>
      <Text style={styles.label}>Fixed teams ({teams.length}/{MAX_TOURNAMENT_TEAMS})</Text>
      {teams.map((team, index) => (
        <View key={team.join('|')} style={styles.card}>
          <Text style={styles.label}>Team {index + 1}</Text>
          {team.map((id) => {
            const player = group.players.find((entry) => entry.id === id);
            return player ? (
              <View key={id} style={styles.playerRow}>
                <PlayerAvatar avatar={player.avatar} />
                <PlayerName group={group} player={player} />
              </View>
            ) : <Text key={id} style={styles.body}>Unavailable player: {id}</Text>;
          })}
          <Action title={`Remove Team ${index + 1}`} disabled={busy}
            onPress={() => setTeams(teams.filter((_, position) => position !== index))} />
        </View>
      ))}
      <Text style={styles.label}>Select two unused players</Text>
      <PlayerChoiceGrid group={group} context="New fixed team" selected={selected}
        isDisabled={(id) => busy || used.has(id) || teams.length === MAX_TOURNAMENT_TEAMS || (!selected.includes(id) && selected.length === 2)}
        onToggle={(id) => { setSelectionError(null); setSelected(selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id]); }} />
      <Action title="Add fixed team" disabled={busy || selected.length !== 2 || teams.length >= MAX_TOURNAMENT_TEAMS}
        onPress={() => { setTeams([...teams, selected]); setSelected([]); }} />
      <ErrorMessage message={selectionError} />
      <ErrorMessage message={unavailable ? 'A fixed team contains a removed player. Remove that team and choose replacements.' : null} />
      </View>
      <ErrorMessage message={error} />
      <Action title={busy ? 'Saving...' : rotating ? 'Create rotating tournament' : 'Create tournament and pool schedule'}
        disabled={busy || (rotating ? rotatingUnavailable || (rotatingPlayers.length !== 4 && rotatingPlayers.length !== 8)
          : unavailable || teams.length < 2 || selected.length > 0)} onPress={() => void create()} />
    </View>
  );
}

function TargetChoice({ label, value, busy, onChange }: {
  label: string; value: TournamentTarget; busy: boolean; onChange: (value: TournamentTarget) => void;
}) {
  return <View style={styles.stack}>
    <Text style={styles.compactFormTitle}>{label}</Text>
    <View style={setup.scoreChoices}>
      {([11, 15] as const).map(target => (
        <Pressable key={target} accessibilityRole="radio" accessibilityLabel={`${label}: 1 game to ${target}`}
          accessibilityState={{ checked: value === target, disabled: busy }} disabled={busy} onPress={() => onChange(target)}
          style={({ pressed }) => [setup.scoreChoice, value === target && setup.selected, (pressed || busy) && styles.dimmed]}>
          <Text style={setup.formatDetail}>1 game to {target}</Text>
        </Pressable>
      ))}
    </View>
  </View>;
}

const setup = StyleSheet.create({
  scoreChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  scoreChoice: { flexGrow: 1, flexBasis: 120, minHeight: 44, padding: 10, borderRadius: 10,
    borderWidth: 2, borderColor: colors.softBorder, justifyContent: 'center', backgroundColor: colors.surface },
  formats: { flexDirection: 'row', gap: 8 },
  format: { flex: 1, minWidth: 0, minHeight: 70, padding: 10, gap: 5, borderRadius: 12, borderWidth: 2,
    borderColor: colors.softBorder, backgroundColor: colors.surface, justifyContent: 'center' },
  selected: { borderColor: colors.primary, backgroundColor: colors.selected },
  formatLabel: { fontSize: 14, fontWeight: '700', color: colors.foreground },
  formatDetail: { fontSize: 11, color: colors.secondary },
});
