import type { Group, GroupCurrency, Player } from '../types/groups.ts';
import type { SavedGroup } from '../types/api.ts';
import type { GroupAvatarId } from './groupAvatars.ts';
import { addPlayer, createGroup, validatePlayerId, ValidationError } from './groups.ts';

export function sortPlayersByRole(
  group: Pick<SavedGroup, 'ownerId' | 'adminIds'>, players: readonly Player[],
): Player[] {
  const admins = new Set(group.adminIds);
  const priority = (player: Player) => player.id === group.ownerId ? 0 : admins.has(player.id) ? 1 : 2;
  return [...players].sort((left, right) => priority(left) - priority(right));
}

export function createOwnedGroup(
  existing: readonly Pick<Group, 'name'>[], name: string, owner: Player,
  currency: GroupCurrency = 'none', avatar?: GroupAvatarId,
): Group {
  if (owner.isGuest || owner.isDeleted) throw new ValidationError('Only an active registered player can own a group.');
  return addPlayer(createGroup(existing, name, currency, avatar), owner);
}

export function changeGroupAdmin(
  group: Pick<SavedGroup, 'ownerId' | 'players' | 'adminIds'>, actorId: string, playerId: string, isAdmin: boolean,
): readonly string[] {
  const actor = validatePlayerId(actorId);
  const target = validatePlayerId(playerId);
  const member = group.players.find(player => player.id === actor);
  if (actor !== group.ownerId && (!group.adminIds.includes(actor) || !member || member.isGuest || member.isDeleted)) {
    throw new ValidationError('Only the owner or an admin can manage admin access.');
  }
  if (target === group.ownerId) throw new ValidationError('The owner cannot be promoted or demoted as an admin.');
  if (target === actor) throw new ValidationError('Ask the owner or another admin to change your admin access.');
  const player = group.players.find(player => player.id === target);
  if (!player || player.isGuest || player.isDeleted) throw new ValidationError('Choose an active registered group player.');
  if (typeof isAdmin !== 'boolean') throw new ValidationError('Choose whether the player is an admin.');
  const admins = new Set(group.adminIds);
  if (isAdmin) admins.add(target);
  else admins.delete(target);
  return group.players.filter(player => admins.has(player.id)).map(player => player.id);
}
