-- The "entries must balance" checks are deferred constraint triggers: they fire when the
-- transaction commits, after the security-definer RPC that posted the entry (record_funding,
-- confirm_disbursement, refund_cycle) has returned. Before PostgreSQL 18 a deferred trigger
-- runs as the session's role, i.e. the signed-in "authenticated" user, who has no access to
-- the private schema, so every ledger posting failed with "permission denied" (42501).
--
-- Running the checks as their owner fixes that on every PostgreSQL version. They only read
-- journal lines and raise an error when an entry doesn't balance, so this grants nothing.

alter function private.ledger_assert_balanced(uuid) security definer;
alter function private.ledger_check_entry_balanced() security definer;
alter function private.ledger_check_line_balanced() security definer;
