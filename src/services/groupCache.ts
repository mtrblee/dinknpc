import { summarizeGroup } from '../types/api.ts';
import type { GroupSummary, SavedGroup } from '../types/api.ts';
import type { Player } from '../types/groups.ts';
import { DataError, mergeSavedGroups } from './groupsApi.ts';

// One signed-in workspace only. Summaries never stand in for editable group details.
export class GroupCache {
  private sequence = 0;
  private lastList = -1;
  private summariesById = new Map<string, GroupSummary>();
  private details = new Map<string, SavedGroup>();
  private changes = new Map<string, number>();
  private departures = new Map<string, number>();
  private profiles = new Map<string, { player: Player; nameSequence: number; avatarSequence: number }>();
  private fullListLoaded = false;

  get summaries(): readonly GroupSummary[] { return [...this.summariesById.values()]; }
  get groups(): readonly SavedGroup[] {
    return this.summaries.flatMap((summary) => {
      const group = this.details.get(summary.id);
      return group ? [group] : [];
    });
  }
  get statsReady(): boolean {
    return this.fullListLoaded && this.summaries.every((summary) =>
      this.details.get(summary.id)?.revision === summary.revision);
  }
  beginLoad(): number { return ++this.sequence; }

  updatePlayerProfile(player: Player): void {
    if (player.isGuest || player.isDeleted || !player.id || !player.name.trim()) {
      throw new DataError('Only a confirmed registered player profile can update cached names and avatars.');
    }
    const sequence = ++this.sequence;
    this.profiles.set(player.id, { player, nameSequence: sequence, avatarSequence: sequence });
    for (const [id, summary] of this.summariesById) this.summariesById.set(id, this.withOwnerProfile(summary, 0));
    for (const [id, group] of this.details) this.details.set(id, this.withProfiles(group, 0));
  }

  private currentProfile(player: Player, started: number): Player {
    const saved = this.profiles.get(player.id);
    if (!saved || player.isGuest || player.isDeleted) return player;
    const name = started >= saved.nameSequence ? player.name : saved.player.name;
    const avatar = started >= saved.avatarSequence ? player.avatar : saved.player.avatar;
    const code = player.code ?? saved.player.code;
    this.profiles.set(player.id, {
      player: { ...saved.player, name, avatar, ...(code === undefined ? {} : { code }) },
      nameSequence: Math.max(started, saved.nameSequence),
      avatarSequence: Math.max(started, saved.avatarSequence),
    });
    return { ...player, name, avatar, ...(code === undefined ? {} : { code }) };
  }

  private withOwnerProfile<T extends GroupSummary | SavedGroup>(group: T, started: number): T {
    const saved = this.profiles.get(group.ownerId);
    if (!saved) return group;
    if (started < saved.nameSequence) return { ...group, ownerName: saved.player.name };
    // Summaries carry names, not avatars; they cannot advance avatar freshness.
    this.profiles.set(group.ownerId, {
      ...saved, player: { ...saved.player, name: group.ownerName }, nameSequence: started,
    });
    return group;
  }

  private withProfiles(group: SavedGroup, started: number): SavedGroup {
    return {
      ...this.withOwnerProfile(group, started),
      players: group.players.map((player) => this.currentProfile(player, started)),
    };
  }

  applySummaries(incoming: readonly GroupSummary[], started: number): boolean {
    if (started < this.lastList) return false;
    this.lastList = started;
    incoming = incoming.map((group) => this.withOwnerProfile(group, started));
    const incomingById = new Map(incoming.map((summary) => [summary.id, summary]));
    const changed = this.summaries.filter((summary) => {
      const incomingSummary = incomingById.get(summary.id);
      return (this.changes.get(summary.id) ?? 0) > started ||
        (incomingSummary !== undefined && incomingSummary.revision < summary.revision);
    });
    const merged = mergeSavedGroups(incoming, changed,
      [...this.departures].filter(([, sequence]) => sequence > started).map(([id]) => id));
    const next = new Map(merged.map((summary) => [summary.id, summary]));
    for (const id of this.summariesById.keys()) {
      if (!next.has(id)) this.remove(id);
    }
    for (const id of next.keys()) {
      if ((this.departures.get(id) ?? Infinity) <= started) this.departures.delete(id);
    }
    this.summariesById = next;
    return true;
  }

  applyGroups(incoming: readonly SavedGroup[], started: number): boolean {
    if (!this.applySummaries(incoming.map(summarizeGroup), started)) return false;
    for (const group of incoming) {
      const summary = this.summariesById.get(group.id);
      const previous = this.details.get(group.id);
      if (summary && summary.revision === group.revision && (!previous || previous.revision <= group.revision)) {
        this.details.set(group.id, this.withProfiles(group, started));
      }
    }
    this.fullListLoaded = true;
    return true;
  }

  acceptGroup(group: SavedGroup, started: number): boolean {
    const departed = this.departures.get(group.id);
    if (departed !== undefined && departed > started) return false;
    if (departed !== undefined) this.departures.delete(group.id);
    return this.save(group, started);
  }

  save(group: SavedGroup, started = 0): boolean {
    if (this.departures.has(group.id)) return false;
    const summary = this.summariesById.get(group.id);
    if (summary && summary.revision > group.revision) return this.details.get(group.id)?.revision === summary.revision;
    // Mutation callbacks have no load token; preserve confirmed profiles until a fresh read.
    group = this.withProfiles(group, started);
    this.changes.set(group.id, ++this.sequence);
    this.details.set(group.id, group);
    this.summariesById.set(group.id, summarizeGroup(group));
    return true;
  }

  remove(id: string): void {
    this.departures.set(id, ++this.sequence);
    this.changes.delete(id);
    this.summariesById.delete(id);
    this.details.delete(id);
  }
}
