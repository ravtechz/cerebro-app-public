# Cum contribui la Cerebro

Multumesc ca vrei sa ajuti! Contributiile sunt binevenite: bug-uri, idei,
documentatie, teme noi, cod.

## Inainte sa scrii cod

- **Bug sau idee?** Deschide intai un issue. Pentru o schimbare mai mare (o
  functionalitate noua, o modificare a contractului `/sync`, o dependinta noua)
  discutam in issue inainte de pull request, ca sa nu muncesti degeaba.
- Citeste `CLAUDE.md`. Contine principiile de arhitectura si capcanele
  care nu se vad din cod: local-first, regulile de sync, `INBOX_ID` vs `NULL`,
  sistemul de teme.

## Reguli de cod

- **Cod si comentarii in engleza; textele din UI in romana, fara diacritice**
  (ex. `"scrie o nota…"`).
- Mobile: TypeScript strict, fara `any`, componente sub ~200 de linii. Zero
  culori hardcodate in componente: totul trece prin `src/theme/`.
- Backend: SQL simplu cu `asyncpg`, fara ORM. **Orice query e scopat pe
  `user_id`**: un user nu are voie sa vada sau sa atinga datele altuia.
- Schimbari de schema: un fisier nou `db/migrations/NNN_ceva.sql`. Nu
  modifica niciodata o migratie care exista deja.
- Backend-ul trebuie sa ramana compatibil cu Python 3.10.
- Secretele stau doar in `.env`, niciodata in cod sau in app.

## Verificari inainte de pull request

```bash
# mobile/
npm run typecheck
npm run bundle

# backend/ (au nevoie de un Postgres real, vezi README -> Dezvoltare locala)
TEST_DATABASE_URL=postgresql://cerebro:test@localhost:55432/cerebro .venv/bin/python -m pytest
```

Toate trebuie sa treaca. Daca schimbi comportamentul backend-ului, adauga un
test. Daca schimbi UI-ul, pune in PR un screenshot sau o descriere a ce ai
verificat pe telefon sau in simulator.

## Licenta contributiilor

Cerebro e publicat sub **PolyForm Noncommercial 1.0.0** (vezi `LICENSE.md`):
oricine il poate folosi, modifica si distribui in scop necomercial.

Prin trimiterea unei contributii (pull request, patch sau cod pus intr-un
issue) confirmi ca:

1. contributia e munca ta, sau ai dreptul sa o trimiti; si
2. ii acorzi autorului proiectului (Razvan Vasile) o licenta perpetua,
   mondiala, neexclusiva, gratuita si irevocabila sa foloseasca, copieze,
   modifice, sublicentieze si distribuie contributia, **inclusiv in scop
   comercial si sub alte licente**.

Pentru toti ceilalti, contributia ta ramane disponibila sub aceeasi licenta
PolyForm Noncommercial ca restul proiectului. Pastrezi dreptul de autor
asupra a ceea ce ai scris.
