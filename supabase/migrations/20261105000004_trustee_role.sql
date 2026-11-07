-- The trustee's operations staff confirm money movements: deposits received,
-- payments executed, refunds made. The platform only issues instructions; the
-- trustee confirms what actually happened at the bank.
--
-- On its own because PostgreSQL can't use a new enum value in the transaction
-- that adds it.
alter type public.user_role add value if not exists 'trustee';
