-- A release line can be paid as input vouchers: the trustee ring-fences the money and
-- farmers redeem it at approved agro-dealers, who are paid on redemption.
--
-- On its own because PostgreSQL can't use a new enum value in the transaction
-- that adds it.
alter type public.payee_kind add value if not exists 'input_voucher';
