"""Curated deny-list of disposable / temp-mail domains.

We hand-maintain this because the public lists (e.g. disposable-email-domains
on PyPI) are 10k+ entries and the vast majority aren't .edu suffixes
anyway. Only entries that could plausibly be mistaken for a .edu address
or appear on generator services need to live here. Expand as fraud
patterns emerge.

Verification: ANY .edu domain ending in a disposable suffix fails; we also
reject common temp-mail providers that occasionally hand out .edu-looking
aliases via catch-all forwarders.
"""

# Tempmail/throwaway providers that have offered .edu-looking aliases or
# masquerade as student email services. Keep this tight — false positives
# here block real students.
DISPOSABLE_DOMAINS = frozenset({
    "mailinator.com",
    "10minutemail.com",
    "10minutemail.net",
    "guerrillamail.com",
    "guerrillamail.net",
    "guerrillamail.org",
    "sharklasers.com",
    "temp-mail.org",
    "tempmail.com",
    "tempmail.net",
    "throwawaymail.com",
    "yopmail.com",
    "dispostable.com",
    "getnada.com",
    "fakeinbox.com",
    "trashmail.com",
    "trashmail.net",
    "maildrop.cc",
    "mohmal.com",
    "mintemail.com",
    "mytemp.email",
    "spamgourmet.com",
    "emailondeck.com",
    "mail-temp.com",
    "mailnesia.com",
    "inboxkitten.com",
    "moakt.com",
    # Generic .edu catch-alls / re-sellers that auto-issue addresses:
    "edu.cheap",
    "studentmail.me",
    "student.edu",
})


def is_disposable(email: str) -> bool:
    """Return True if the email's domain is in the deny-list.

    Case-insensitive, strips whitespace. Does NOT validate the local part;
    caller is responsible for regex-checking that before calling us.
    """
    if not email or "@" not in email:
        return True
    domain = email.rsplit("@", 1)[-1].strip().lower()
    return domain in DISPOSABLE_DOMAINS
