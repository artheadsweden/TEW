#!/usr/bin/env python3
from __future__ import annotations

import argparse

from app import InviteCode, User, create_app, db


def cmd_create_invites(codes: list[str]) -> None:
    app = create_app()
    with app.app_context():
        added = 0
        for code in codes:
            code = code.strip()
            if not code:
                continue
            if db.session.get(InviteCode, code) is not None:
                continue
            db.session.add(InviteCode(code=code))
            added += 1
        db.session.commit()
        print(f"Added {added} invite code(s)")


def cmd_make_admin(email: str) -> None:
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email.strip().lower()).first()
        if user is None:
            raise SystemExit("No such user")
        user.is_admin = True
        db.session.commit()
        print(f"{user.email} is now admin")


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage beta reader site")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_inv = sub.add_parser("create-invites", help="Create one or more invite codes")
    p_inv.add_argument("codes", nargs="+", help="Invite code(s)")

    p_admin = sub.add_parser("make-admin", help="Promote an existing user to admin")
    p_admin.add_argument("email", help="User email")

    args = parser.parse_args()

    if args.cmd == "create-invites":
        cmd_create_invites(args.codes)
        return 0
    if args.cmd == "make-admin":
        cmd_make_admin(args.email)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
