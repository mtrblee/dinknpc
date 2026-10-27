begin;

drop function public.find_registered_player(uuid);

create function public.find_registered_player(p_player_id uuid)
returns table (id uuid, display_name text, avatar text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from auth.users caller
    where caller.id = auth.uid()
      and caller.email_confirmed_at is not null
      and caller.deleted_at is null
      and (caller.banned_until is null or caller.banned_until <= now())
  ) then
    raise exception 'A verified account is required.' using errcode = '42501';
  end if;

  if p_player_id is null then
    raise exception 'A player ID is required.' using errcode = '22023';
  end if;

  return query
    select candidate.id, btrim(candidate.raw_user_meta_data ->> 'display_name'),
      candidate.raw_user_meta_data ->> 'avatar'
    from auth.users candidate
    where candidate.id = p_player_id
      and candidate.email_confirmed_at is not null
      and candidate.deleted_at is null
      and (candidate.banned_until is null or candidate.banned_until <= now())
      and jsonb_typeof(candidate.raw_user_meta_data -> 'display_name') = 'string'
      and (candidate.raw_user_meta_data ->> 'display_name') ~ '[^[:space:]]';
end;
$$;

revoke all on function public.find_registered_player(uuid) from public, anon, authenticated;
grant execute on function public.find_registered_player(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
