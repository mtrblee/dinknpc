begin;

do $$
declare
  caller_id uuid := 'eeeeeeee-eeee-4eee-8eee-000000000001';
  target_id uuid := 'eeeeeeee-eeee-4eee-8eee-000000000002';
  fixture_id uuid;
  found_name text;
  found_avatar text;
  fixture_number integer;
begin
  if exists (
    select 1 from auth.users
    where id::text like 'eeeeeeee-eeee-4eee-8eee-00000000000%'
  ) then
    raise exception 'Synthetic fixture IDs already exist. No test data was changed.';
  end if;
  if has_function_privilege('anon', 'public.find_registered_player(uuid)', 'execute') then
    raise exception 'Anonymous lookup must not be allowed.';
  end if;
  if not has_function_privilege('authenticated', 'public.find_registered_player(uuid)', 'execute') then
    raise exception 'Authenticated lookup must be allowed.';
  end if;

  for fixture_number in 1..8 loop
    fixture_id := ('eeeeeeee-eeee-4eee-8eee-' || lpad(fixture_number::text, 12, '0'))::uuid;
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, banned_until, deleted_at)
    values (
      fixture_id,
      'dinknpc-synthetic-' || fixture_number || '@example.test',
      case when fixture_number = 3 then null else now() end,
      case
        when fixture_number = 6 then '{}'::jsonb
        when fixture_number = 7 then '{"display_name":42}'::jsonb
        when fixture_number = 8 then '{"display_name":"   "}'::jsonb
        else '{"display_name":"Alex"}'::jsonb
      end,
      case when fixture_number = 4 then now() + interval '1 day' else null end,
      case when fixture_number = 5 then now() else null end
    );
  end loop;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', caller_id, 'role', 'authenticated')::text, true);
  select display_name into found_name from public.find_registered_player(target_id);
  if found_name is distinct from 'Alex' then
    raise exception 'A verified, named player must be returned.';
  end if;
  select avatar into found_avatar from public.find_registered_player(target_id);
  if found_avatar is not null then
    raise exception 'An unset avatar must remain absent so the application uses its default.';
  end if;
  update auth.users set raw_user_meta_data = raw_user_meta_data || '{"avatar":"fox"}'::jsonb where id = target_id;
  select avatar into found_avatar from public.find_registered_player(target_id);
  if found_avatar is distinct from 'fox' then
    raise exception 'The lookup must return the current selected avatar.';
  end if;
  if exists (select 1 from public.find_registered_player(target_id) p where to_jsonb(p) ? 'email') then
    raise exception 'The player lookup must never expose an email address.';
  end if;
  if (select count(*) from public.find_registered_player(caller_id)) <> 1 then
    raise exception 'Matching names must not hide distinct accounts or prevent adding yourself.';
  end if;
  if exists (select 1 from public.find_registered_player('eeeeeeee-eeee-4eee-8eee-000000000009')) then
    raise exception 'A missing account must not be returned.';
  end if;
  for fixture_number in 3..8 loop
    fixture_id := ('eeeeeeee-eeee-4eee-8eee-' || lpad(fixture_number::text, 12, '0'))::uuid;
    if exists (select 1 from public.find_registered_player(fixture_id)) then
      raise exception 'Ineligible fixture % was returned.', fixture_number;
    end if;
  end loop;
  begin
    perform public.find_registered_player(null);
    raise exception 'A missing input ID must be rejected.';
  exception when invalid_parameter_value then null;
  end;

  for fixture_number in 3..5 loop
    fixture_id := ('eeeeeeee-eeee-4eee-8eee-' || lpad(fixture_number::text, 12, '0'))::uuid;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', fixture_id, 'role', 'authenticated')::text, true);
    begin
      perform public.find_registered_player(target_id);
      raise exception 'An ineligible caller must not look up players.';
    exception when insufficient_privilege then null;
    end;
  end loop;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.find_registered_player(target_id);
    raise exception 'A missing caller must not look up players.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
