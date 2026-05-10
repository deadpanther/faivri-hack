"""Smoke coverage for the .edu validation + disposable-email guard.

Covers the cheap deterministic checks in app.routers.student and the
disposable deny-list. The OTP round-trip is integration-tested elsewhere
(Redis + Resend).
"""
import pytest
from fastapi import HTTPException

from app.routers.student import _EDU_PATTERN, _validate_edu, _mask_email
from app.services.disposable_emails import is_disposable


def test_edu_pattern_accepts_real_university_addresses():
    assert _EDU_PATTERN.match("jane@stanford.edu")
    assert _EDU_PATTERN.match("j.doe@berkeley.edu")
    assert _EDU_PATTERN.match("student-01@cs.mit.edu")
    # Int'l academic domains that appear on many pricing pages:
    assert _EDU_PATTERN.match("hello@ox.ac.uk")
    assert _EDU_PATTERN.match("jill@university.edu.au")


def test_edu_pattern_rejects_consumer_addresses():
    assert not _EDU_PATTERN.match("jane@gmail.com")
    assert not _EDU_PATTERN.match("jane@example.com")
    assert not _EDU_PATTERN.match("jane@edu.example.com")  # spoofy subdomain
    assert not _EDU_PATTERN.match("jane@edu")              # bare TLD
    assert not _EDU_PATTERN.match("@stanford.edu")         # empty local


def test_validate_edu_raises_on_consumer_domains():
    with pytest.raises(HTTPException) as excinfo:
        _validate_edu("jane@gmail.com")
    assert excinfo.value.status_code == 400


def test_validate_edu_raises_on_disposable_even_if_edu():
    # Hypothetical: a disposable provider offering fake .edu aliases.
    # The deny-list catches it before .edu regex thinks it's legit.
    with pytest.raises(HTTPException):
        _validate_edu("throwaway@student.edu")


def test_disposable_denylist_catches_common_tempmail():
    assert is_disposable("burner@mailinator.com")
    assert is_disposable("BURNER@MAILINATOR.COM")
    assert is_disposable("x@10minutemail.com")
    assert is_disposable("x@guerrillamail.com")
    assert is_disposable("")           # malformed → treated disposable
    assert is_disposable("no-at-sign") # malformed → treated disposable


def test_disposable_denylist_allows_real_domains():
    assert not is_disposable("real@stanford.edu")
    assert not is_disposable("real@gmail.com")


def test_mask_email_hides_middle_of_local_part():
    assert _mask_email("jane.doe@stanford.edu") == "j******e@stanford.edu"
    assert _mask_email("jd@stanford.edu") == "j*@stanford.edu"
