-- Activity emails (Brevo) and scheduled jobs — Supabase-specific (pg_cron, pg_net, Vault).
--
-- Exits ≥ 15 min and nightly-closed sessions are marked email_sent = 'queued'.
-- Every 5 minutes lab.send_queued_emails() posts them to Brevo's API through
-- pg_net and, on the next run, records 'yes' or 'failed' from the HTTP result.
-- Until the Brevo key (Vault secret 'brevo_api_key') and lab.settings rows
-- sender_email + portal_url exist, emails simply stay queued.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create function lab.activity_email_html(p_name text, p_link text, p_minutes int) returns text
language sql immutable as $$
  select '<div style="font-family:-apple-system,BlinkMacSystemFont,''Helvetica Neue'',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1d1d1f">'
    || '<p style="font-size:13px;color:#86868b;margin:0 0 24px">AATCE Apple Lab</p>'
    || '<h1 style="font-size:28px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px">Hi '
    || lab.html_escape(coalesce(nullif(split_part(coalesce(p_name, ''), ' ', 1), ''), 'there')) || '.</h1>'
    || '<p style="font-size:17px;line-height:1.5;margin:0 0 28px">'
    || case when p_minutes is null
         then 'You checked in to the Apple Lab but we didn''t see you check out.'
         else 'Thanks for spending ' || p_minutes || ' minutes in the Apple Lab today.' end
    || ' Take ten seconds to note what you worked on.</p>'
    || '<a href="' || lab.html_escape(p_link) || '" style="display:inline-block;background:#0071e3;color:#fff;'
    || 'text-decoration:none;font-size:17px;padding:12px 22px;border-radius:980px">Log my activity</a>'
    || '<p style="font-size:12px;color:#86868b;margin:32px 0 0">Swift Coding Club · Parul University</p></div>'
$$;

create function lab.send_queued_emails() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_sender text;
  v_sender_name text;
  v_portal text;
  v_request bigint;
  v_sent int := 0;
  r record;
begin
  -- Results of last run's requests.
  update lab.sessions s
     set email_sent = case when resp.status_code between 200 and 299 then 'yes' else 'failed' end,
         email_request_id = null
    from net._http_response resp
   where s.email_sent = 'sending' and s.email_request_id = resp.id;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'brevo_api_key';
  select value into v_sender from lab.settings where key = 'sender_email';
  select value into v_sender_name from lab.settings where key = 'sender_name';
  select rtrim(value, '/') into v_portal from lab.settings where key = 'portal_url';
  if v_key is null or v_sender is null or v_portal is null then
    return 0;
  end if;

  for r in
    select s.session_id, s.duration_mins, st.name, st.email
      from lab.sessions s join lab.students st using (enrollment_no)
     where s.email_sent = 'queued'
     order by s.entry_time
     limit 50
       for update of s skip locked
  loop
    select net.http_post(
             url := 'https://api.brevo.com/v3/smtp/email',
             headers := jsonb_build_object('api-key', v_key, 'Content-Type', 'application/json', 'Accept', 'application/json'),
             body := jsonb_build_object(
               'sender', jsonb_build_object('email', v_sender, 'name', coalesce(v_sender_name, 'AATCE Apple Lab')),
               'to', jsonb_build_array(jsonb_build_object('email', r.email, 'name', r.name)),
               'subject', 'What did you work on in the Apple Lab?',
               'htmlContent', lab.activity_email_html(r.name, v_portal || '/activity/' || r.session_id, r.duration_mins)))
      into v_request;
    update lab.sessions set email_sent = 'sending', email_request_id = v_request where session_id = r.session_id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

revoke all on function lab.send_queued_emails() from public;
revoke all on function lab.activity_email_html(text, text, int) from public;

select cron.schedule('aatce-send-activity-emails', '*/5 * * * *', 'select lab.send_queued_emails()');
select cron.schedule('aatce-close-stale-sessions', '30 19 * * *', 'select lab.close_stale_sessions()');  -- 01:00 IST
