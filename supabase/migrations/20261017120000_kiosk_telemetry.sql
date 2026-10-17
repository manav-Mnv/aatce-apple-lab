-- Kiosk telemetry (backend API v3.1.0): lets the admin portal see what the kiosk is doing.
--
-- The kiosk calls `heartbeat` once a minute instead of `status`. It reports its
-- health (queue, faces loaded, problems) and the scan attempts since the last
-- heartbeat: recognised, not recognised (with the best score, so the match
-- threshold can be tuned) and failed liveness checks. Events are kept 30 days.

create table lab.kiosk_status (
  kiosk_id text primary key default 'main',
  last_seen timestamptz not null default now(),
  app_version text not null default '',
  queued int not null default 0,
  faces int not null default 0,
  embeddings_version int not null default 0,
  workshop_name text not null default '',
  match_threshold real,
  problem text not null default ''
);

create table lab.kiosk_events (
  id bigserial primary key,
  at timestamptz not null,
  kind text not null check (kind in ('recognized', 'unrecognized', 'liveness_failed', 'queued', 'error')),
  enrollment_no text,
  score real,
  detail text not null default ''
);
create index kiosk_events_at on lab.kiosk_events (at desc);

alter table lab.kiosk_status enable row level security;
alter table lab.kiosk_events enable row level security;

create function lab.a_heartbeat(b jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_inserted int := 0;
begin
  insert into lab.kiosk_status (kiosk_id, last_seen, app_version, queued, faces, embeddings_version,
                                workshop_name, match_threshold, problem)
  values ('main', now(), left(coalesce(b->>'app_version', ''), 40),
          greatest(0, coalesce((b->>'queued')::int, 0)), greatest(0, coalesce((b->>'faces')::int, 0)),
          greatest(0, coalesce((b->>'embeddings_version')::int, 0)), left(coalesce(b->>'workshop_name', ''), 80),
          (b->>'match_threshold')::real, left(coalesce(b->>'problem', ''), 300))
  on conflict (kiosk_id) do update set
    last_seen = excluded.last_seen, app_version = excluded.app_version, queued = excluded.queued,
    faces = excluded.faces, embeddings_version = excluded.embeddings_version,
    workshop_name = excluded.workshop_name, match_threshold = excluded.match_threshold, problem = excluded.problem;

  if jsonb_typeof(b->'events') = 'array' then
    insert into lab.kiosk_events (at, kind, enrollment_no, score, detail)
    select least(coalesce(lab.ts_or_null(e->>'at'), now()), now()), e->>'kind',
           lab.clean_no(e->>'enrollment_no'), (e->>'score')::real, left(coalesce(e->>'detail', ''), 200)
      from jsonb_array_elements(b->'events') with ordinality as x(e, i)
     where x.i <= 200
       and e->>'kind' in ('recognized', 'unrecognized', 'liveness_failed', 'queued', 'error')
       and lab.ts_or_null(e->>'at') > now() - interval '7 days';
    get diagnostics v_inserted = row_count;
  end if;

  delete from lab.kiosk_events where at < now() - interval '30 days';
  return lab.a_status() || jsonb_build_object('events_saved', v_inserted);
exception when invalid_text_representation or numeric_value_out_of_range then
  return lab.err('heartbeat fields must be numbers where expected', 'validation_error');
end $$;

create function lab.ts_or_null(p text) returns timestamptz
language plpgsql stable set search_path = '' as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end $$;

create function lab.kiosk_summary() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'last_seen', coalesce(lab.iso(s.last_seen), ''),
    'online', coalesce(s.last_seen > now() - interval '3 minutes', false),
    'app_version', coalesce(s.app_version, ''),
    'queued', coalesce(s.queued, 0),
    'faces', coalesce(s.faces, 0),
    'embeddings_version', coalesce(s.embeddings_version, 0),
    'workshop_name', coalesce(s.workshop_name, ''),
    'match_threshold', s.match_threshold,
    'problem', coalesce(s.problem, ''),
    'today', (select jsonb_build_object(
                'recognized', count(*) filter (where kind = 'recognized'),
                'unrecognized', count(*) filter (where kind = 'unrecognized'),
                'liveness_failed', count(*) filter (where kind = 'liveness_failed'))
              from lab.kiosk_events where lab.day(at) = lab.day(now())),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
                  'at', lab.iso(e.at), 'kind', e.kind, 'enrollment_no', coalesce(e.enrollment_no, ''),
                  'name', coalesce(st.name, fe.name, ''), 'score', e.score, 'detail', e.detail) order by e.at desc)
                from (select * from lab.kiosk_events order by at desc limit 50) e
                left join lab.students st on st.enrollment_no = e.enrollment_no
                left join lab.face_enrollments fe on fe.enrollment_no = e.enrollment_no), '[]'::jsonb))
  from (select 1) one left join lab.kiosk_status s on s.kiosk_id = 'main'
$$;

create or replace function lab.a_status() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('success', true, 'status', 'online', 'timestamp', lab.iso(now()), 'version', '3.1.0')
$$;

create or replace function lab.a_dashboard() returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('success', true,
           'occupancy', lab.a_occupancy()->'people',
           'entries', lab.a_attendance_log('{}'::jsonb)->'entries',
           'students', lab.a_students('{}'::jsonb)->'students',
           'workshops', lab.a_workshop_attendees()->'attendees',
           'kiosk', lab.kiosk_summary())
$$;

create or replace function lab.role_actions(p_role text) returns text[]
language sql immutable set search_path = '' as $$
  select case p_role
    when 'kiosk' then array['status', 'heartbeat', 'lookup', 'enroll', 'upload_faces', 'scan',
                            'embeddings_version', 'embeddings_download']
    when 'pipeline' then array['status', 'embeddings_version', 'face_manifest', 'face_images', 'publish_embeddings']
    when 'admin' then array['status', 'embeddings_version', 'dashboard', 'occupancy', 'attendance_log', 'students',
                            'workshop_attendees', 'activity_get', 'activity_submit']
    else array[]::text[] end
$$;

create or replace function public.api(jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  body jsonb := $1;
  v_role text;
  v_action text;
begin
  if body is null or jsonb_typeof(body) <> 'object' then
    return lab.err('JSON body must be an object', 'invalid_json');
  end if;
  if not exists (select 1 from lab.secrets) then
    return lab.err('Server misconfiguration: no secrets set', 'auth_misconfigured');
  end if;
  if jsonb_typeof(body->'secret') is distinct from 'string' or body->>'secret' = '' then
    return lab.err('Missing authentication: include "secret" in JSON body', 'auth_missing');
  end if;
  select role into v_role from lab.secrets where secret_hash = extensions.digest(body->>'secret', 'sha256');
  if v_role is null then
    return lab.err('Invalid authentication secret', 'auth_invalid');
  end if;

  v_action := coalesce(body->>'action', '');
  if not (v_action = any (lab.role_actions('kiosk') || lab.role_actions('pipeline') || lab.role_actions('admin'))) then
    return lab.err('Unknown action: ' || v_action, 'unknown_action');
  end if;
  if not (v_action = any (lab.role_actions(v_role))) then
    return lab.err('Action "' || v_action || '" is not allowed for this client', 'forbidden');
  end if;

  case v_action
    when 'status' then return lab.a_status();
    when 'heartbeat' then return lab.a_heartbeat(body);
    when 'lookup' then return lab.a_lookup(body);
    when 'enroll' then return lab.a_enroll(body);
    when 'upload_faces' then return lab.a_upload_faces(body);
    when 'scan' then return lab.a_scan(body);
    when 'embeddings_version' then return lab.a_embeddings_version();
    when 'embeddings_download' then return lab.a_embeddings_download();
    when 'face_manifest' then return lab.a_face_manifest();
    when 'face_images' then return lab.a_face_images(body);
    when 'publish_embeddings' then return lab.a_publish_embeddings(body);
    when 'dashboard' then return lab.a_dashboard();
    when 'occupancy' then return lab.a_occupancy();
    when 'attendance_log' then return lab.a_attendance_log(body);
    when 'students' then return lab.a_students(body);
    when 'workshop_attendees' then return lab.a_workshop_attendees();
    when 'activity_get' then return lab.a_activity_get(body);
    when 'activity_submit' then return lab.a_activity_submit(body);
  end case;
exception when others then
  return lab.err('Internal server error: ' || sqlerrm, 'server_error');
end $$;

revoke all on function lab.a_heartbeat(jsonb), lab.ts_or_null(text), lab.kiosk_summary() from public;
