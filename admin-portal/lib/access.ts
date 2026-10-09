/** Who may use the portal: an exact email in the allow list, or any email in the allowed domain. */
export function isAllowedEmail(email: string, domain: string | undefined, allowList: string | undefined): boolean {
  const normalized = email.trim().toLowerCase();
  const emails = (allowList || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.includes(normalized)) return true;
  return !!domain && normalized.endsWith('@' + domain.trim().toLowerCase());
}
