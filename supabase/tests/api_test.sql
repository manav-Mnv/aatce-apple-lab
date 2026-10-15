-- Tests for public.api — run against any database with the core migration.
--
-- Everything happens inside one DO block that ends by raising an exception, so
-- ALL changes (test secrets, students, sessions…) are rolled back even on a live
-- project. Success = the error "TESTS PASSED: <n>". Any other error = a failure.
--
-- Times come from `scanned_at`, because now() is fixed inside a transaction.
-- Run it in the SQL editor, with psql, or via CI (.github/workflows/ci.yml).

do $test$
declare
  k constant text := 'test-kiosk-secret-000000000000000000000000';
  p constant text := 'test-pipeline-secret-000000000000000000000';
  a constant text := 'test-admin-secret-0000000000000000000000000';
  jpeg constant text := translate(encode('\xffd8ffe001020304ffd9'::bytea, 'base64'), E'\n', '');
  day_start timestamptz := (lab.day(now())::timestamp) at time zone 'Asia/Kolkata';
  base timestamptz;
  r jsonb;
  sid text;
  n int := 0;
  vec jsonb := (select jsonb_agg(0.01) from generate_series(1, 512));
begin
  -- Isolate: the test's own secrets and students only (rolled back at the end).
  delete from lab.secrets;
  r := public.api('{"secret":"x","action":"status"}');
  assert r->>'error_code' = 'auth_misconfigured', r::text; n := n + 1;

  perform lab.set_secret('kiosk', k);
  perform lab.set_secret('pipeline', p);
  perform lab.set_secret('admin', a);
  begin
    perform lab.set_secret('admin', k);
    assert false, 'reusing a secret must fail';
  exception when assert_failure then raise;
            when others then null;
  end;
  n := n + 1;

  insert into lab.students (enrollment_no, name, email, batch_tags) values
    ('T1', 'Alice Student', 'alice@x.edu', 'SCC/5-7'),
    ('T2', 'Bob Learner', 'bob@x.edu', 'SCC/5-7, SCC/3-5');

  -- ── Auth and routing ──
  assert public.api('{"action":"status"}')->>'error_code' = 'auth_missing'; n := n + 1;
  assert public.api('{"secret":"nope","action":"status"}')->>'error_code' = 'auth_invalid'; n := n + 1;
  assert public.api('[1,2]')->>'error_code' = 'invalid_json'; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'status'));
  assert r->>'version' = '3.0.0' and (r->>'success')::boolean, r::text; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'students'))->>'error_code' = 'forbidden'; n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'scan', 'enrollment_no', 'T1'))->>'error_code' = 'forbidden'; n := n + 1;
  assert public.api(jsonb_build_object('secret', a, 'action', 'enroll'))->>'error_code' = 'forbidden'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'drop_tables'))->>'error_code' = 'unknown_action'; n := n + 1;

  -- ── Lookup and enroll ──
  r := public.api(jsonb_build_object('secret', k, 'action', 'lookup', 'enrollment_no', ' T1 '));
  assert r->>'name' = 'Alice Student' and r->>'email_hint' = 'al•••@x.edu' and (r->>'is_member')::boolean
     and not (r->>'is_enrolled')::boolean, r::text; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'lookup', 'enrollment_no', '../etc'))->>'error_code' = 'validation_error'; n := n + 1;

  assert public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'T1'))->>'error_code' = 'consent_required'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'T1', 'consent', 'yes'))->>'error_code' = 'consent_required'; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'T1', 'consent', true, 'name', 'Ignored'));
  assert (r->>'is_new')::boolean and (r->>'is_member')::boolean and r->>'name' = 'Alice Student', r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'T1', 'consent', true));
  assert not (r->>'is_new')::boolean, r::text; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'W1', 'consent', true,
                                       'name', 'Guest', 'email', 'nope'))->>'error_code' = 'validation_error'; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'enroll', 'enrollment_no', 'W1', 'consent', true,
                                     'name', 'Guest User', 'email', 'guest@gmail.com'));
  assert not (r->>'is_member')::boolean and r->>'email_hint' = 'gu•••@gmail.com', r::text; n := n + 1;
  assert not exists (select 1 from lab.students where enrollment_no = 'W1'), 'roster must not change'; n := n + 1;

  -- ── Face photos ──
  assert public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T2',
                                       'images', jsonb_build_array(jpeg)))->>'error_code' = 'not_enrolled'; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T1',
                                     'images', jsonb_build_array(jpeg, jpeg, jpeg)));
  assert (r->>'saved')::int = 3 and (r->>'photo_count')::int = 3, r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T1', 'images', jsonb_build_array(jpeg)));
  assert (r->>'photo_count')::int = 4, r::text; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T1',
                                       'images', jsonb_build_array(encode('\x89504e47'::bytea, 'base64'))))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T1',
                                       'images', '["%%%"]'::jsonb))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'upload_faces', 'enrollment_no', 'T1',
                                       'images', '[]'::jsonb))->>'error_code' = 'validation_error'; n := n + 1;
  assert (select count(*) from lab.face_photos where enrollment_no = 'T1') = 4; n := n + 1;

  r := public.api(jsonb_build_object('secret', p, 'action', 'face_manifest'));
  assert jsonb_array_length(r->'people') = 1 and jsonb_array_length(r->'people'->0->'files') = 4, r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', p, 'action', 'face_images',
                                     'file_ids', jsonb_build_array(r->'people'->0->'files'->0->>'id')));
  assert r->'images'->0->>'data' = jpeg, r::text; n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'face_images', 'file_ids', '["nope"]'::jsonb))->>'error_code' = 'not_found'; n := n + 1;

  -- ── Scans (needs 100 minutes of today behind us; skipped just after midnight IST) ──
  if now() - day_start >= interval '100 minutes' then
    base := now() - interval '100 minutes';

    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1', 'scanned_at', lab.iso(base)));
    assert r->>'action' = 'entry' and r->>'name' = 'Alice Student', r::text; n := n + 1;
    sid := r->>'session_id';

    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1',
                                       'scanned_at', lab.iso(base + interval '30 seconds')));
    assert r->>'error_code' = 'cooldown' and (r->>'cooldown_remaining_seconds')::int = 90, r::text; n := n + 1;

    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1',
                                       'scanned_at', lab.iso(base + interval '90 minutes'), 'method', 'manual'));
    assert r->>'action' = 'exit' and (r->>'duration_mins')::int = 90 and (r->>'activity_email_sent')::boolean, r::text; n := n + 1;
    assert (select email_sent = 'queued' and notes = 'manual exit' from lab.sessions where session_id = sid::uuid); n := n + 1;

    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1',
                                       'scanned_at', lab.iso(base + interval '95 minutes')));
    assert r->>'action' = 'entry', r::text; n := n + 1;

    -- short session: no email, form skipped
    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T2', 'scanned_at', lab.iso(base)));
    r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T2',
                                       'scanned_at', lab.iso(base + interval '5 minutes')));
    assert r->>'action' = 'exit' and not (r->>'activity_email_sent')::boolean, r::text; n := n + 1;
    assert (select activity_form_status from lab.sessions where enrollment_no = 'T2' order by entry_time limit 1) = 'skipped'; n := n + 1;

    -- admin views
    r := public.api(jsonb_build_object('secret', a, 'action', 'occupancy'));
    assert (r->>'count')::int = 1 and r->'people'->0->>'name' = 'Alice Student', r::text; n := n + 1;
    r := public.api(jsonb_build_object('secret', a, 'action', 'dashboard'));
    assert jsonb_array_length(r->'entries') = 3 and jsonb_array_length(r->'students') = 2
       and jsonb_array_length(r->'occupancy') = 1, r::text; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'attendance_log', 'enrollment_no', 'T2'))->>'count' = '1'; n := n + 1;
    assert (public.api(jsonb_build_object('secret', a, 'action', 'attendance_log'))->'entries'->0->>'duration_mins') is not null; n := n + 1;

    -- activity form
    r := public.api(jsonb_build_object('secret', a, 'action', 'activity_get', 'session_id', sid));
    assert r->>'state' = 'form' and r->>'name' = 'Alice Student', r::text; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'activity_submit', 'session_id', sid, 'text', '  '))->>'error_code' = 'validation_error'; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'activity_submit', 'session_id', sid, 'text', repeat('x', 1001)))->>'error_code' = 'validation_error'; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'activity_submit', 'session_id', sid, 'text', ' Built a list '))->>'result' = 'saved'; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'activity_submit', 'session_id', sid, 'text', 'again'))->>'result' = 'already_submitted'; n := n + 1;
    assert public.api(jsonb_build_object('secret', a, 'action', 'activity_get', 'session_id', sid))->>'state' = 'done'; n := n + 1;
    assert (select activity_description from lab.sessions where session_id = sid::uuid) = 'Built a list'; n := n + 1;
  else
    raise notice 'Skipped scan tests: less than 100 minutes since midnight IST';
  end if;

  assert public.api(jsonb_build_object('secret', a, 'action', 'activity_get', 'session_id', 'nope'))->>'state' = 'invalid'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1', 'scanned_at', 'yesterday'))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1',
                                       'scanned_at', lab.iso(now() - interval '25 hours')))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'T1',
                                       'scanned_at', lab.iso(now() + interval '5 minutes')))->>'error_code' = 'validation_error'; n := n + 1;

  -- workshop attendees
  r := public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'W1', 'workshop_name', 'Swift Basics'));
  assert r->>'action' = 'workshop_attendee' and not (r->>'already_logged')::boolean, r::text; n := n + 1;
  assert (public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'W1'))->>'already_logged')::boolean; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'scan', 'enrollment_no', 'NOBODY'))->>'error_code' = 'not_enrolled'; n := n + 1;
  r := public.api(jsonb_build_object('secret', a, 'action', 'workshop_attendees'));
  assert r->'attendees'->0->>'workshop_name' = 'Swift Basics', r::text; n := n + 1;

  -- students view + batch filter
  r := public.api(jsonb_build_object('secret', a, 'action', 'students', 'batch', 'SCC/3-5'));
  assert (r->>'count')::int = 1 and r->'students'->0->>'enrollment_no' = 'T2', r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', a, 'action', 'students'));
  assert (select (s->>'face_enrolled')::boolean and (s->>'photo_count')::int = 4
          from jsonb_array_elements(r->'students') s where s->>'enrollment_no' = 'T1'), r::text; n := n + 1;

  -- nightly job: an open session from yesterday
  insert into lab.sessions (enrollment_no, entry_time) values ('T2', now() - interval '1 day 2 hours');
  assert lab.close_stale_sessions() >= 1; n := n + 1;
  assert lab.close_stale_sessions() = 0, 'idempotent'; n := n + 1;
  assert (select notes = 'no exit scan' and email_sent = 'queued' from lab.sessions
          where enrollment_no = 'T2' and exit_time is null and entry_time < now() - interval '1 day'); n := n + 1;

  -- embeddings
  assert (public.api(jsonb_build_object('secret', k, 'action', 'embeddings_version'))->>'version')::int = 0; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'embeddings_download'))->>'error_code' = 'not_found'; n := n + 1;
  assert public.api(jsonb_build_object('secret', k, 'action', 'publish_embeddings'))->>'error_code' = 'forbidden'; n := n + 1;
  r := public.api(jsonb_build_object('secret', p, 'action', 'publish_embeddings', 'embeddings', jsonb_build_object(
         'version', 1, 'generated_at', '2026-10-05T03:00:00+00:00', 'model_version', 'facenet-inceptionresnetv1-vggface2',
         'entries', jsonb_build_array(jsonb_build_object('enrollment_no', 'T1', 'embedding_vector', vec)))));
  assert (r->>'version')::int = 1 and (r->>'entry_count')::int = 1, r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'embeddings_version'));
  assert (r->>'version')::int = 1 and r->>'model_version' = 'facenet-inceptionresnetv1-vggface2', r::text; n := n + 1;
  r := public.api(jsonb_build_object('secret', k, 'action', 'embeddings_download'));
  assert jsonb_array_length(r->'embeddings'->'entries'->0->'embedding_vector') = 512, left(r::text, 200); n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'publish_embeddings', 'embeddings', jsonb_build_object(
           'version', 1, 'generated_at', 'x', 'model_version', 'm', 'entries', '[]'::jsonb)))->>'error_code' = 'version_conflict'; n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'publish_embeddings', 'embeddings', jsonb_build_object(
           'version', 2, 'generated_at', 'x', 'model_version', 'm',
           'entries', jsonb_build_array(jsonb_build_object('enrollment_no', 'T1', 'embedding_vector', '[0.1]'::jsonb)))))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'publish_embeddings', 'embeddings', jsonb_build_object(
           'version', 2, 'generated_at', 'x', 'model_version', 'm',
           'entries', jsonb_build_array(jsonb_build_object('enrollment_no', 'T1', 'embedding_vector', vec),
                                        jsonb_build_object('enrollment_no', 'T1', 'embedding_vector', vec)))))->>'error_code' = 'validation_error'; n := n + 1;
  assert public.api(jsonb_build_object('secret', p, 'action', 'publish_embeddings', 'embeddings', jsonb_build_object(
           'version', '2', 'generated_at', 'x', 'model_version', 'm', 'entries', '[]'::jsonb)))->>'error_code' = 'validation_error'; n := n + 1;

  raise exception 'TESTS PASSED: %', n;
end
$test$;
