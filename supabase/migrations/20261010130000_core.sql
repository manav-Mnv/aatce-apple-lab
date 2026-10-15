-- AATCE Apple Lab — core database and API (backend API v3.0.0).
--
-- All data lives in the private schema `lab`, which the Supabase Data API does
-- not expose. The only public entry point is `public.api(jsonb)`: clients POST
-- the same JSON bodies as before ({ secret, action, ...params }) to
-- /rest/v1/rpc/api. The secret decides the role (kiosk / pipeline / admin),
-- and each role may call only its own actions. Secrets are stored as SHA-256
-- hashes; set them with lab.set_secret(role, secret) in the SQL editor.
--
-- Portable Postgres only (pgcrypto); Supabase-specific scheduling and email
-- are in the next migration, so these functions can be tested on plain Postgres.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists lab;
revoke all on schema lab from public;

-- ── Tables ──────────────────────────────────────────────────────────────────

create table lab.students (
  enrollment_no text primary key check (enrollment_no ~ '^[A-Za-z0-9_-]{1,32}$'),
  name text not null,
  email text not null default '',
  batch_tags text not null default '',
  created_at timestamptz not null default now()
);
comment on table lab.students is 'SCC roster (was Master_Students). Edit in the Table Editor or import a CSV.';

create table lab.face_enrollments (
  enrollment_no text primary key check (enrollment_no ~ '^[A-Za-z0-9_-]{1,32}$'),
  name text not null,
  email text not null,
  is_member boolean not null,
  consent_at timestamptz not null,
  photo_count int not null default 0,
  enrolled_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table lab.face_photos (
  id uuid primary key default gen_random_uuid(),
  enrollment_no text not null references lab.face_enrollments on delete cascade,
  data bytea not null,
  created_at timestamptz not null default now()
);
create index face_photos_enrollment on lab.face_photos (enrollment_no);

create table lab.sessions (
  session_id uuid primary key default gen_random_uuid(),
  enrollment_no text not null,
  entry_time timestamptz not null,
  exit_time timestamptz,
  duration_mins int,
  activity_form_status text not null default 'pending'
    check (activity_form_status in ('pending', 'completed', 'skipped')),
  activity_description text not null default '',
  email_sent text not null default 'no'
    check (email_sent in ('no', 'queued', 'sending', 'yes', 'failed')),
  email_request_id bigint,
  notes text not null default ''
);
create index sessions_enrollment_entry on lab.sessions (enrollment_no, entry_time desc);
create index sessions_entry on lab.sessions (entry_time);
create index sessions_email_queue on lab.sessions (email_sent) where email_sent in ('queued', 'sending');

create table lab.workshop_attendees (
  id uuid primary key default gen_random_uuid(),
  enrollment_no text not null,
  name text not null,
  email text not null default '',
  workshop_name text not null default 'General',
  date timestamptz not null
);
create index workshop_attendees_enrollment on lab.workshop_attendees (enrollment_no, date);

create table lab.embeddings (
  version int primary key check (version > 0),
  generated_at text not null,
  model_version text not null,
  entry_count int not null,
  data jsonb not null,
  published_at timestamptz not null default now()
);

create table lab.secrets (
  role text primary key check (role in ('kiosk', 'pipeline', 'admin')),
  secret_hash bytea not null unique
);

create table lab.settings (
  key text primary key check (key in ('sender_email', 'sender_name', 'portal_url')),
  value text not null
);
comment on table lab.settings is 'sender_email / sender_name (Brevo verified sender) and portal_url (for activity links).';

alter table lab.students enable row level security;
alter table lab.face_enrollments enable row level security;
alter table lab.face_photos enable row level security;
alter table lab.sessions enable row level security;
alter table lab.workshop_attendees enable row level security;
alter table lab.embeddings enable row level security;
alter table lab.secrets enable row level security;
alter table lab.settings enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────

create function lab.err(p_message text, p_code text) returns jsonb
language sql immutable as $$
  select jsonb_build_object('success', false, 'error', p_message, 'error_code', p_code)
$$;

create function lab.invalid_no() returns jsonb
language sql immutable as $$
  select lab.err('enrollment_no is required (letters, digits, "-" or "_", max 32)', 'validation_error')
$$;

-- ISO 8601 in lab time, e.g. 2026-10-05T09:00:00+05:30 ('' for null).
create function lab.iso(p timestamptz) returns text
language sql stable as $$
  select case when p is null then ''
    else to_char(p at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS') || '+05:30' end
$$;

-- Calendar day in lab time: "today" for sessions.
create function lab.day(p timestamptz) returns date
language sql stable as $$
  select (p at time zone 'Asia/Kolkata')::date
$$;

create function lab.clean_no(p text) returns text
language sql immutable as $$
  select case when btrim(coalesce(p, '')) ~ '^[A-Za-z0-9_-]{1,32}$' then btrim(p) end
$$;

-- "alice@uni.ac.in" → "al•••@uni.ac.in"
create function lab.mask_email(p text) returns text
language sql immutable as $$
  select case when position('@' in coalesce(p, '')) > 1
    then left(p, least(2, position('@' in p) - 1)) || '•••' || substr(p, position('@' in p))
    else '' end
$$;

create function lab.is_email(p text) returns boolean
language sql immutable as $$
  select coalesce(p, '') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$$;

create function lab.uuid_or_null(p text) returns uuid
language sql immutable as $$
  select case when coalesce(p, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end
$$;

create function lab.html_escape(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

create function lab.role_actions(p_role text) returns text[]
language sql immutable as $$
  select case p_role
    when 'kiosk' then array['status', 'lookup', 'enroll', 'upload_faces', 'scan', 'embeddings_version', 'embeddings_download']
    when 'pipeline' then array['status', 'embeddings_version', 'face_manifest', 'face_images', 'publish_embeddings']
    when 'admin' then array['status', 'embeddings_version', 'dashboard', 'occupancy', 'attendance_log', 'students',
                            'workshop_attendees', 'activity_get', 'activity_submit']
    else array[]::text[] end
$$;

-- Owner-only (run in the SQL editor): select lab.set_secret('kiosk', '<openssl rand -hex 32>');
create function lab.set_secret(p_role text, p_secret text) returns text
language plpgsql as $$
begin
  if length(coalesce(p_secret, '')) < 32 then
    raise exception 'Use at least 32 characters (openssl rand -hex 32)';
  end if;
  if exists (select 1 from lab.secrets
             where secret_hash = extensions.digest(p_secret, 'sha256') and role <> p_role) then
    raise exception 'Each role needs a different secret';
  end if;
  insert into lab.secrets (role, secret_hash) values (p_role, extensions.digest(p_secret, 'sha256'))
  on conflict (role) do update set secret_hash = excluded.secret_hash;
  return 'Saved the ' || p_role || ' secret';
end $$;

-- ── Any role ────────────────────────────────────────────────────────────────

create function lab.a_status() returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'status', 'online', 'timestamp', lab.iso(now()), 'version', '3.0.0')
$$;

create function lab.a_embeddings_version() returns jsonb
language sql stable as $$
  select coalesce(
    (select jsonb_build_object('success', true, 'version', version, 'generated_at', generated_at,
                               'model_version', model_version, 'entry_count', entry_count)
     from lab.embeddings order by version desc limit 1),
    jsonb_build_object('success', true, 'version', 0, 'generated_at', '', 'model_version', '', 'entry_count', 0))
$$;

-- ── Kiosk ───────────────────────────────────────────────────────────────────

create function lab.a_lookup(b jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_no text := lab.clean_no(b->>'enrollment_no');
  s lab.students;
  e lab.face_enrollments;
begin
  if v_no is null then return lab.invalid_no(); end if;
  select * into s from lab.students where enrollment_no = v_no;
  select * into e from lab.face_enrollments where enrollment_no = v_no;
  return jsonb_build_object(
    'success', true, 'enrollment_no', v_no,
    'is_member', s.enrollment_no is not null,
    'is_enrolled', e.enrollment_no is not null,
    'name', coalesce(s.name, e.name, ''),
    'email_hint', lab.mask_email(coalesce(s.email, e.email)),
    'photo_count', coalesce(e.photo_count, 0));
end $$;

create function lab.a_enroll(b jsonb) returns jsonb
language plpgsql as $$
declare
  v_no text := lab.clean_no(b->>'enrollment_no');
  s lab.students;
  v_name text;
  v_email text;
  v_new boolean;
  v_count int;
begin
  if v_no is null then return lab.invalid_no(); end if;
  if b->'consent' is distinct from 'true'::jsonb then
    return lab.err('Biometric consent is required to enroll', 'consent_required');
  end if;

  select * into s from lab.students where enrollment_no = v_no;
  if s.enrollment_no is not null then
    v_name := s.name;
    v_email := s.email;
  else
    v_name := btrim(coalesce(b->>'name', ''));
    v_email := btrim(coalesce(b->>'email', ''));
    if v_name = '' or length(v_name) > 100 or not lab.is_email(v_email) then
      return lab.err('name and a valid email are required for non-members', 'validation_error');
    end if;
  end if;

  insert into lab.face_enrollments as f (enrollment_no, name, email, is_member, consent_at)
  values (v_no, v_name, v_email, s.enrollment_no is not null, now())
  on conflict (enrollment_no) do update
    set name = excluded.name, email = excluded.email, is_member = excluded.is_member,
        consent_at = now(), updated_at = now()
  returning (xmax = 0), f.photo_count into v_new, v_count;

  return jsonb_build_object(
    'success', true, 'enrollment_no', v_no, 'name', v_name,
    'email_hint', lab.mask_email(v_email), 'is_member', s.enrollment_no is not null,
    'is_new', v_new, 'photo_count', v_count);
end $$;

-- Re-enrollment adds photos, never replaces them (FR-5).
create function lab.a_upload_faces(b jsonb) returns jsonb
language plpgsql as $$
declare
  v_no text := lab.clean_no(b->>'enrollment_no');
  v_images jsonb := b->'images';
  v_image jsonb;
  v_bytes bytea;
  v_blobs bytea[] := '{}';
  v_count int;
begin
  if v_no is null then return lab.invalid_no(); end if;
  if jsonb_typeof(v_images) is distinct from 'array' then
    return lab.err('images must be an array of 1–5 base64 JPEG strings', 'validation_error');
  end if;
  if jsonb_array_length(v_images) not between 1 and 5 then
    return lab.err('images must be an array of 1–5 base64 JPEG strings', 'validation_error');
  end if;
  if not exists (select 1 from lab.face_enrollments where enrollment_no = v_no) then
    return lab.err('Enroll with consent before uploading photos', 'not_enrolled');
  end if;

  for v_image in select value from jsonb_array_elements(v_images) loop
    v_bytes := null;
    if jsonb_typeof(v_image) = 'string' then
      begin
        v_bytes := decode(v_image #>> '{}', 'base64');
      exception when others then
        v_bytes := null;
      end;
    end if;
    if v_bytes is null or length(v_bytes) < 3 or length(v_bytes) > 204800 then
      return lab.err('images must be base64 JPEGs under 204800 bytes', 'validation_error');
    end if;
    if get_byte(v_bytes, 0) <> 255 or get_byte(v_bytes, 1) <> 216 then
      return lab.err('images must be base64 JPEGs under 204800 bytes', 'validation_error');
    end if;
    v_blobs := array_append(v_blobs, v_bytes);
  end loop;

  insert into lab.face_photos (enrollment_no, data) select v_no, unnest(v_blobs);
  update lab.face_enrollments
     set photo_count = photo_count + cardinality(v_blobs), updated_at = now()
   where enrollment_no = v_no
  returning photo_count into v_count;

  return jsonb_build_object('success', true, 'enrollment_no', v_no,
                            'saved', cardinality(v_blobs), 'photo_count', v_count);
end $$;

-- Enrolled non-members: one row per attendee per day (FR-12).
create function lab.workshop_scan(p_no text, p_workshop text, p_time timestamptz) returns jsonb
language plpgsql as $$
declare
  e lab.face_enrollments;
  v_logged boolean;
begin
  select * into e from lab.face_enrollments where enrollment_no = p_no;
  if e.enrollment_no is null then
    return lab.err('Enrollment number not found. Please enroll first.', 'not_enrolled');
  end if;
  v_logged := exists (select 1 from lab.workshop_attendees
                      where enrollment_no = p_no and lab.day(date) = lab.day(p_time));
  if not v_logged then
    insert into lab.workshop_attendees (enrollment_no, name, email, workshop_name, date)
    values (p_no, e.name, e.email, coalesce(nullif(btrim(p_workshop), ''), 'General'), p_time);
  end if;
  return jsonb_build_object('success', true, 'action', 'workshop_attendee', 'enrollment_no', p_no,
                            'name', e.name, 'already_logged', v_logged);
end $$;

-- Entry / exit (FR-7 to FR-12, FR-14). `scanned_at` = original time of a scan
-- replayed from the kiosk's offline queue; `method: "manual"` is noted for audit.
create function lab.a_scan(b jsonb) returns jsonb
language plpgsql as $$
declare
  v_no text := lab.clean_no(b->>'enrollment_no');
  v_raw text := b->>'scanned_at';
  v_manual boolean := (b->>'method') = 'manual';
  v_time timestamptz;
  s lab.students;
  v_last timestamptz;
  v_open lab.sessions;
  v_id uuid;
  v_minutes int;
  v_remaining int;
  v_queue boolean;
begin
  if v_no is null then return lab.invalid_no(); end if;

  if coalesce(v_raw, '') = '' then
    v_time := now();
  else
    begin
      v_time := v_raw::timestamptz;
    exception when others then
      v_time := null;
    end;
    if v_time is null or now() - v_time > interval '24 hours' or v_time - now() > interval '2 minutes' then
      return lab.err('scanned_at must be an ISO 8601 time within the last 24 hours', 'validation_error');
    end if;
    v_time := least(v_time, now());
  end if;

  -- Two scans of the same person at once must not both create a session.
  perform pg_advisory_xact_lock(hashtext('scan:' || v_no));

  select * into s from lab.students where enrollment_no = v_no;
  if s.enrollment_no is null then
    return lab.workshop_scan(v_no, b->>'workshop_name', v_time);
  end if;

  select max(greatest(entry_time, coalesce(exit_time, entry_time))) into v_last
    from lab.sessions where enrollment_no = v_no;
  if v_last is not null and v_time >= v_last and v_time - v_last < interval '2 minutes' then
    v_remaining := ceil(extract(epoch from (interval '2 minutes' - (v_time - v_last))));
    return lab.err('Cooldown active. Please wait ' || v_remaining || ' seconds.', 'cooldown')
           || jsonb_build_object('cooldown_remaining_seconds', v_remaining);
  end if;

  select * into v_open from lab.sessions
   where enrollment_no = v_no and exit_time is null
     and entry_time > v_time - interval '2 days' and lab.day(entry_time) = lab.day(v_time)
   order by entry_time desc limit 1;

  if v_open.session_id is null then
    insert into lab.sessions (enrollment_no, entry_time, notes)
    values (v_no, v_time, case when v_manual then 'manual entry' else '' end)
    returning session_id into v_id;
    return jsonb_build_object('success', true, 'action', 'entry', 'session_id', v_id,
                              'enrollment_no', v_no, 'name', s.name, 'entry_time', lab.iso(v_time));
  end if;

  v_minutes := round(extract(epoch from (v_time - v_open.entry_time)) / 60);
  v_queue := v_minutes >= 15 and lab.is_email(s.email);
  update lab.sessions
     set exit_time = v_time,
         duration_mins = v_minutes,
         email_sent = case when v_queue then 'queued' else email_sent end,
         activity_form_status = case when v_minutes < 15 then 'skipped' else activity_form_status end,
         notes = case when not v_manual then notes
                      when notes = '' then 'manual exit'
                      else notes || '; manual exit' end
   where session_id = v_open.session_id;

  return jsonb_build_object('success', true, 'action', 'exit', 'session_id', v_open.session_id,
                            'enrollment_no', v_no, 'name', s.name,
                            'entry_time', lab.iso(v_open.entry_time), 'exit_time', lab.iso(v_time),
                            'duration_mins', v_minutes, 'activity_email_sent', v_queue);
end $$;

create function lab.a_embeddings_download() returns jsonb
language plpgsql stable as $$
declare
  v_data jsonb;
begin
  select data into v_data from lab.embeddings order by version desc limit 1;
  if v_data is null then
    return lab.err('No embeddings have been published yet', 'not_found');
  end if;
  return jsonb_build_object('success', true, 'embeddings', v_data);
end $$;

-- ── Pipeline ────────────────────────────────────────────────────────────────

create function lab.a_face_manifest() returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'people',
           coalesce(jsonb_agg(t.person order by t.person->>'enrollment_no'), '[]'::jsonb))
  from (
    select jsonb_build_object(
             'enrollment_no', enrollment_no,
             'files', jsonb_agg(jsonb_build_object(
                        'id', id,
                        'name', to_char(created_at at time zone 'Asia/Kolkata', 'YYYYMMDD-HH24MISS') || '.jpg',
                        'size', length(data)) order by created_at)) as person
    from lab.face_photos group by enrollment_no
  ) t
$$;

create function lab.a_face_images(b jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_ids jsonb := b->'file_ids';
  v_id text;
  v_data bytea;
  v_out jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_ids) is distinct from 'array' then
    return lab.err('file_ids must be an array of 1–25 photo IDs', 'validation_error');
  end if;
  if jsonb_array_length(v_ids) not between 1 and 25 then
    return lab.err('file_ids must be an array of 1–25 photo IDs', 'validation_error');
  end if;
  for v_id in select value from jsonb_array_elements_text(v_ids) loop
    select data into v_data from lab.face_photos where id = lab.uuid_or_null(v_id);
    if v_data is null then return lab.err('File not found: ' || v_id, 'not_found'); end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'file_id', v_id, 'data', translate(encode(v_data, 'base64'), E'\n', '')));
    v_data := null;
  end loop;
  return jsonb_build_object('success', true, 'images', v_out);
end $$;

-- Returns the first schema problem, or null if the embeddings document is valid.
create function lab.embeddings_problem(e jsonb) returns text
language plpgsql immutable as $$
declare
  v_entry jsonb;
  v_vector jsonb;
  v_no text;
  v_seen text[] := '{}';
  v_i int := 0;
begin
  if jsonb_typeof(e) is distinct from 'object' then return 'embeddings must be an object'; end if;
  if jsonb_typeof(e->'version') is distinct from 'number' then return 'version must be a positive integer'; end if;
  if (e->>'version')::numeric < 1 or (e->>'version')::numeric <> trunc((e->>'version')::numeric) then
    return 'version must be a positive integer';
  end if;
  if jsonb_typeof(e->'generated_at') is distinct from 'string' or e->>'generated_at' = '' then
    return 'generated_at must be an ISO 8601 string';
  end if;
  if jsonb_typeof(e->'model_version') is distinct from 'string' or e->>'model_version' = '' then
    return 'model_version must be a non-empty string';
  end if;
  if jsonb_typeof(e->'entries') is distinct from 'array' then return 'entries must be an array'; end if;

  for v_entry in select value from jsonb_array_elements(e->'entries') loop
    v_no := case when jsonb_typeof(v_entry) = 'object' and jsonb_typeof(v_entry->'enrollment_no') = 'string'
                 then lab.clean_no(v_entry->>'enrollment_no') end;
    if v_no is null then return format('entries[%s].enrollment_no is invalid', v_i); end if;
    if v_no = any (v_seen) then return format('entries[%s] duplicates enrollment_no %s', v_i, v_no); end if;
    v_seen := array_append(v_seen, v_no);

    v_vector := v_entry->'embedding_vector';
    if jsonb_typeof(v_vector) is distinct from 'array' then
      return format('entries[%s].embedding_vector must have 512 numbers', v_i);
    end if;
    if jsonb_array_length(v_vector) <> 512 then
      return format('entries[%s].embedding_vector must have 512 numbers', v_i);
    end if;
    if exists (select 1 from jsonb_array_elements(v_vector) x where jsonb_typeof(x) <> 'number') then
      return format('entries[%s].embedding_vector has a non-numeric value', v_i);
    end if;
    v_i := v_i + 1;
  end loop;
  return null;
end $$;

create function lab.a_publish_embeddings(b jsonb) returns jsonb
language plpgsql as $$
declare
  e jsonb := b->'embeddings';
  v_problem text := lab.embeddings_problem(b->'embeddings');
  v_version int;
  v_current int;
begin
  if v_problem is not null then return lab.err(v_problem, 'validation_error'); end if;
  v_version := (e->>'version')::int;
  select coalesce(max(version), 0) into v_current from lab.embeddings;
  if v_version <= v_current then
    return lab.err('version must be greater than the current version ' || v_current, 'version_conflict');
  end if;
  insert into lab.embeddings (version, generated_at, model_version, entry_count, data)
  values (v_version, e->>'generated_at', e->>'model_version', jsonb_array_length(e->'entries'), e);
  delete from lab.embeddings where version < v_version - 2;  -- keep the last three for rollback
  return jsonb_build_object('success', true, 'version', v_version, 'entry_count', jsonb_array_length(e->'entries'));
end $$;

-- ── Admin ───────────────────────────────────────────────────────────────────

create function lab.session_json(s lab.sessions) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'session_id', s.session_id, 'enrollment_no', s.enrollment_no,
    'entry_time', lab.iso(s.entry_time), 'exit_time', lab.iso(s.exit_time),
    'duration_mins', coalesce(to_jsonb(s.duration_mins), '""'::jsonb),
    'activity_form_status', s.activity_form_status, 'activity_description', s.activity_description,
    'email_sent', s.email_sent, 'notes', s.notes)
$$;

create function lab.a_occupancy() returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'count', count(*), 'people', coalesce(jsonb_agg(
           jsonb_build_object('session_id', s.session_id, 'enrollment_no', s.enrollment_no,
                              'name', coalesce(st.name, ''), 'batch_tags', coalesce(st.batch_tags, ''),
                              'entry_time', lab.iso(s.entry_time)) order by s.entry_time), '[]'::jsonb))
  from lab.sessions s left join lab.students st using (enrollment_no)
  where s.exit_time is null and s.entry_time > now() - interval '1 day'
    and lab.day(s.entry_time) = lab.day(now())
$$;

create function lab.a_attendance_log(b jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'count', count(*),
           'entries', coalesce(jsonb_agg(lab.session_json(s) order by s.entry_time), '[]'::jsonb))
  from lab.sessions s
  where (coalesce(b->>'date', '') = '' or lab.day(s.entry_time)::text = b->>'date')
    and (coalesce(b->>'enrollment_no', '') = '' or s.enrollment_no = btrim(b->>'enrollment_no'))
$$;

create function lab.a_students(b jsonb) returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'count', count(*), 'students', coalesce(jsonb_agg(
           jsonb_build_object('enrollment_no', st.enrollment_no, 'name', st.name, 'email', st.email,
                              'batch_tags', st.batch_tags, 'face_enrolled', e.enrollment_no is not null,
                              'photo_count', coalesce(e.photo_count, 0), 'consent_at', lab.iso(e.consent_at))
           order by st.name), '[]'::jsonb))
  from lab.students st left join lab.face_enrollments e using (enrollment_no)
  where coalesce(b->>'batch', '') = ''
     or btrim(b->>'batch') = any (select btrim(x) from unnest(string_to_array(st.batch_tags, ',')) x)
$$;

create function lab.a_workshop_attendees() returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true, 'count', count(*), 'attendees', coalesce(jsonb_agg(
           jsonb_build_object('id', id, 'name', name, 'enrollment_no', enrollment_no, 'email', email,
                              'workshop_name', workshop_name, 'date', lab.iso(date)) order by date), '[]'::jsonb))
  from lab.workshop_attendees
$$;

-- Everything the portal shows, in one call.
create function lab.a_dashboard() returns jsonb
language sql stable as $$
  select jsonb_build_object('success', true,
           'occupancy', lab.a_occupancy()->'people',
           'entries', lab.a_attendance_log('{}'::jsonb)->'entries',
           'students', lab.a_students('{}'::jsonb)->'students',
           'workshops', lab.a_workshop_attendees()->'attendees')
$$;

-- Activity form (FR-15): the portal's public /activity/<session_id> page calls
-- these server-side. The random session UUID is the credential for that one row.
create function lab.a_activity_get(b jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_id uuid := lab.uuid_or_null(b->>'session_id');
  s lab.sessions;
  v_name text;
begin
  select * into s from lab.sessions where session_id = v_id;
  if s.session_id is null then return jsonb_build_object('success', true, 'state', 'invalid'); end if;
  select name into v_name from lab.students where enrollment_no = s.enrollment_no;
  return jsonb_build_object('success', true,
    'state', case when s.activity_form_status = 'completed' then 'done' else 'form' end,
    'name', coalesce(v_name, ''), 'entry_time', lab.iso(s.entry_time),
    'duration_mins', coalesce(to_jsonb(s.duration_mins), '""'::jsonb));
end $$;

create function lab.a_activity_submit(b jsonb) returns jsonb
language plpgsql as $$
declare
  v_id uuid := lab.uuid_or_null(b->>'session_id');
  v_text text := btrim(coalesce(b->>'text', ''));
  v_rows int;
begin
  if v_text = '' then return lab.err('Please describe what you worked on.', 'validation_error'); end if;
  if length(v_text) > 1000 then return lab.err('Please keep it under 1000 characters.', 'validation_error'); end if;
  update lab.sessions set activity_description = v_text, activity_form_status = 'completed'
   where session_id = v_id and activity_form_status <> 'completed';
  get diagnostics v_rows = row_count;
  if v_rows = 1 then return jsonb_build_object('success', true, 'result', 'saved'); end if;
  if exists (select 1 from lab.sessions where session_id = v_id) then
    return jsonb_build_object('success', true, 'result', 'already_submitted');
  end if;
  return lab.err('This link is not valid.', 'not_found');
end $$;

-- ── Nightly: sessions from earlier days with no exit (FR-14) ────────────────

create function lab.close_stale_sessions() returns int
language plpgsql as $$
declare
  v_rows int;
begin
  update lab.sessions s
     set notes = case when s.notes = '' then 'no exit scan' else s.notes || '; no exit scan' end,
         email_sent = case
           when s.email_sent = 'no' and exists (select 1 from lab.students st
                                                where st.enrollment_no = s.enrollment_no and lab.is_email(st.email))
           then 'queued' else s.email_sent end
   where s.exit_time is null
     and lab.day(s.entry_time) < lab.day(now())
     and position('no exit scan' in s.notes) = 0;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- ── The API ─────────────────────────────────────────────────────────────────

create function public.api(jsonb) returns jsonb
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

revoke all on all functions in schema lab from public;
revoke all on function public.api(jsonb) from public;
grant execute on function public.api(jsonb) to anon, authenticated, service_role;
