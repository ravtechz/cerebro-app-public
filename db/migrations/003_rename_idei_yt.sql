-- 003_rename_idei_yt.sql
--
-- Redenumeste categoria seed "Idei YT" in "Idei YouTube".
--
-- Motivul e masurat, nu estetic: pe setul de evaluare cu gemma3:4b, categoria
-- asta iesea 1 din 3, iar modelul nu facea legatura dintre "YT" si continut
-- YouTube. (Adaugarea unei descrieri in prompt NU a ajutat — deci problema e
-- numele in sine, nu contextul.)
--
-- Migratie de DATE, nu de schema: `create_user.py` a fost actualizat pentru
-- userii noi, dar randurile deja create pe VM trebuie atinse explicit.
--
-- Conditionata pe numele exact: daca un user si-a redenumit deja categoria
-- intre timp, alegerea lui nu e calcata.

UPDATE categories
   SET name = 'Idei YouTube'
 WHERE name = 'Idei YT';
