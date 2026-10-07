-- 002_one_inbox_per_user.sql
--
-- Planul cere "exact una per user, nu se sterge" pentru Inbox. Pana acum era
-- doar o conventie respectata de scripts/create_user.py; aici devine o regula
-- pe care baza o impune singura.
--
-- Conteaza pentru Faza 04: fallback-ul categorizatorului cauta Inbox-ul userului
-- cu is_inbox = true si presupune ca gaseste exact unul.

CREATE UNIQUE INDEX idx_categories_one_inbox
  ON categories(user_id) WHERE is_inbox;
