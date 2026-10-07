# Cerebro

Aplicatie de notite in stil chat, care ruleaza pe serverul tau. Scrii o idee
ca intr-un chat, nota apare instant pe telefon, iar un LLM care ruleaza **local,
pe serverul tau** o pune singur in categoria potrivita: „Idei YouTube”, „Filme”,
„Todos” sau ce categorii iti faci tu.

- **Local-first**: telefonul tine totul intr-o baza SQLite si merge complet
  offline. Serverul face doar categorizarea si pastreaza o copie centrala.
- **Privat**: serverul e accesibil doar prin Tailscale (VPN WireGuard), fara
  niciun port deschis spre internet. LLM-ul (Ollama + `gemma3:4b`) ruleaza pe
  acelasi server, deci notele nu pleaca nicaieri.
- **Multi-user, la scara mica**: 2-5 oameni, fiecare cu cheia lui, categoriile
  lui si datele lui separate.
- **iOS** acum (Expo / React Native). Android e planificat.

---

## Cuprins

1. [Cum functioneaza](#1-cum-functioneaza)
2. [Ce iti trebuie](#2-ce-iti-trebuie)
3. [Masina virtuala](#3-masina-virtuala)
4. [Tailscale si firewall](#4-tailscale-si-firewall)
5. [PostgreSQL](#5-postgresql)
6. [Ollama si modelul](#6-ollama-si-modelul)
7. [Backend-ul](#7-backend-ul)
8. [Primul user si cheia API](#8-primul-user-si-cheia-api)
9. [Aplicatia pe iPhone](#9-aplicatia-pe-iphone)
10. [Conectarea aplicatiei la server](#10-conectarea-aplicatiei-la-server)
11. [Operare zilnica](#11-operare-zilnica)
12. [Dezvoltare locala](#12-dezvoltare-locala)
13. [Probleme frecvente](#13-probleme-frecvente)
14. [Securitate](#14-securitate)
15. [Fazele proiectului](#15-fazele-proiectului)
16. [Licenta](#16-licenta)

---

## 1. Cum functioneaza

```
iPhone (Expo app)                      VM pe server / NAS  (doar prin Tailscale)
┌──────────────────────┐               ┌───────────────────────────────────────┐
│ ChatBar -> SQLite    │   POST /sync  │ FastAPI  ──>  PostgreSQL 18           │
│ (sursa de adevar)    │ ────────────> │    │                                  │
│ sync worker          │ <──────────── │    └──> Ollama (gemma3:4b, local)     │
│ (event-driven)       │  categorie    │ cerebro-purge.timer (trash > 30 zile) │
└──────────────────────┘               └───────────────────────────────────────┘
```

1. Scrii o nota. Ea apare instant, cu statusul `pending`.
2. Worker-ul de sync o trimite la `POST /sync` cand ai retea: la nota noua, la
   revenirea in aplicatie, la revenirea retelei sau la pull-to-refresh.
3. Serverul cere LLM-ului sa aleaga o categorie **din lista ta**. Modelul nu
   inventeaza categorii. Daca nu e sigur (incredere sub 0.6), nota merge in
   `Inbox`.
4. Telefonul primeste categoria, iar nota devine `synced`.

Diagrama completa e in `arhitectura-cerebro-app.excalidraw`. O deschizi pe
[excalidraw.com](https://excalidraw.com) (meniu -> Open) sau cu extensia
Excalidraw din VS Code. `cerebro-mobile-mockup.html` e mockup-ul interactiv al
interfetei; il deschizi direct in browser.

**Structura repo-ului**

| Folder | Ce contine |
|---|---|
| `mobile/` | aplicatia Expo (React Native, TypeScript) |
| `backend/` | API-ul FastAPI, categorizatorul LLM, unitatile systemd, `deploy.sh` |
| `db/` | migratiile Postgres (`.sql` numerotate) si `migrate.sh` |
| `scripts/` | `create_user.py`, `status.sh`, `restart.sh` |

---

## 2. Ce iti trebuie

**Server**
- Un calculator sau NAS care poate rula o masina virtuala (Proxmox, hypervisorul
  NAS-ului, VirtualBox etc.). Merge si o masina Linux dedicata.
- Resurse pentru VM: **4 vCPU, 8 GB RAM, 40 GB disc**. Modelul `gemma3:4b`
  ocupa cam 3.5 GB in RAM. Pe CPU, fara GPU, o nota se categorizeaza in cateva
  secunde, ceea ce e suficient, fiindca totul se intampla in fundal.

**Pe Mac** (pentru build-ul iOS)
- macOS cu **Xcode** (ultima versiune) si Command Line Tools
- **CocoaPods**: `brew install cocoapods`
- **Node.js >= 20.19.4** (cerut de Expo SDK 57)
- Un **Apple ID** adaugat in Xcode. Unul gratuit merge, cu limitarile de la
  [pasul 9](#9-aplicatia-pe-iphone).

**Altele**
- Un cont [Tailscale](https://tailscale.com) (gratuit pentru uz personal)
- Un iPhone cu aplicatia Tailscale instalata

> In comenzile de mai jos, `user@cerebro-vm` e userul tau de SSH si VM-ul,
> iar `100.x.y.z` e IP-ul de Tailscale al VM-ului. Daca ai facut un fork,
> inlocuieste adresa repo-ului cu cea a fork-ului tau.

---

## 3. Masina virtuala

Creeaza un VM cu **Ubuntu Server 22.04 LTS**, versiunea pe care ruleaza
proiectul in productie. Ubuntu 24.04 ar trebui sa mearga la fel: backend-ul e
compatibil cu Python 3.10 pana la 3.13.

La instalare:
- creeaza un user normal cu `sudo`, de ex. `deploy` (nu lucra ca root);
- bifeaza **OpenSSH server**;
- un hostname usor de tinut minte, de ex. `cerebro-vm`.

Dupa primul boot, de pe Mac:

```bash
ssh-copy-id user@<ip-ul-din-LAN-al-VM-ului>     # autentificare cu cheie SSH
ssh user@<ip-ul-din-LAN-al-VM-ului>
```

Pe VM, sistemul la zi si pachetele de baza:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw fail2ban unattended-upgrades python3-venv
sudo dpkg-reconfigure -plow unattended-upgrades     # update-uri de securitate automate
```

Opreste login-ul SSH cu parola: in `/etc/ssh/sshd_config` pune
`PasswordAuthentication no`, apoi `sudo systemctl restart ssh`. Fa asta
**doar dupa** ce ai verificat ca intri cu cheia.

---

## 4. Tailscale si firewall

### Tailscale pe VM

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # deschide link-ul afisat si autentifica VM-ul
tailscale ip -4              # noteaza IP-ul 100.x.y.z
```

In [consola de admin Tailscale](https://login.tailscale.com/admin/machines),
la VM: **... -> Disable key expiry**. Altfel, dupa cateva luni VM-ul iese din
retea si sync-ul incepe sa dea erori fara un motiv evident.

Optional: activeaza **MagicDNS**, ca sa poti folosi `cerebro-vm` in loc de IP.

Instaleaza Tailscale si pe **Mac** si pe **iPhone**, logat in acelasi cont.

### Firewall: tot ce intra e blocat, mai putin Tailscale

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0
sudo ufw allow ssh           # temporar, ca sa nu-ti tai accesul din LAN
sudo ufw enable
```

Verifica de pe Mac ca intri prin Tailscale (`ssh user@100.x.y.z`), apoi scoate
regula temporara:

```bash
sudo ufw delete allow ssh
sudo ufw status              # asteptat: deny incoming + ALLOW IN on tailscale0
```

> Pastreaza la indemana consola VM-ului din hypervisor. Daca gresesti o regula
> de firewall, de acolo intri chiar si fara retea.

De acum incolo, Postgres si API-ul sunt accesibile doar din tailnet-ul tau,
fara port forwarding pe router.

---

## 5. PostgreSQL

Ubuntu 22.04 are in repo o versiune mai veche. Instalam **PostgreSQL 18** din
repo-ul oficial PGDG:

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-18
pg_lsclusters                # asteptat: 18  main  ...  online
```

Genereaza o parola si creeaza rolul si baza de date:

```bash
openssl rand -hex 24         # copiaz-o, iti trebuie la pasul 7
sudo -u postgres createuser cerebro --pwprompt     # lipesti parola de mai sus
sudo -u postgres createdb cerebro -O cerebro
```

> Foloseste o parola **hex**, ca cea de mai sus. Caractere ca `@`, `/`, `:` sau
> `$` strica `DATABASE_URL` si citirea fisierului `.env`.

Postgres asculta implicit doar pe `localhost`, si asa trebuie sa ramana. API-ul
ruleaza pe acelasi VM. **Nu deschide portul 5432** in firewall.

**Backup** (recomandat): un dump zilnic, pastrat 14 zile. Ca user `postgres`:

```bash
sudo -u postgres mkdir -p /var/lib/postgresql/backup
sudo -u postgres crontab -e
```

si adauga linia:

```
0 3 * * * pg_dump cerebro | gzip > /var/lib/postgresql/backup/cerebro-$(date +\%F).sql.gz && find /var/lib/postgresql/backup -name 'cerebro-*.sql.gz' -mtime +14 -delete
```

Ideal, directorul de backup e montat pe un share al NAS-ului, nu pe discul
VM-ului.

---

## 6. Ollama si modelul

```bash
curl -fsSL https://ollama.com/install.sh | sh     # instaleaza si serviciul systemd `ollama`
ollama pull gemma3:4b                             # ~3.3 GB
ollama run gemma3:4b "Raspunde cu un cuvant: salut"
systemctl is-active ollama                        # asteptat: active
```

Ollama asculta implicit doar pe `localhost:11434`, si asa e bine.

> **Alternativa: Anthropic (Claude).** Daca nu vrei sau nu poti rula un model
> local, backend-ul stie sa foloseasca si API-ul Anthropic. La pasul 7 pui in
> `.env`: `LLM_PROVIDER=anthropic`, `LLM_MODEL=claude-haiku-4-5` si
> `ANTHROPIC_API_KEY=...`. Atentie: in varianta asta, textul notelor pleaca la
> un serviciu extern.

---

## 7. Backend-ul

Toate comenzile de aici ruleaza pe VM.

### 7.1 Codul si userul de serviciu

API-ul ruleaza sub un user de sistem, `cerebro`, fara login, care detine doar
`/opt/cerebro`.

```bash
sudo git clone https://github.com/ravtechz/cerebro-app-public.git /opt/cerebro
sudo adduser --system --group --home /opt/cerebro --no-create-home cerebro
sudo chown -R cerebro:cerebro /opt/cerebro
```

### 7.2 Mediul Python

```bash
sudo -u cerebro python3 -m venv /opt/cerebro/venv
sudo -u cerebro /opt/cerebro/venv/bin/pip install --upgrade pip
sudo -u cerebro /opt/cerebro/venv/bin/pip install -r /opt/cerebro/backend/requirements.txt
```

### 7.3 Configurarea (`.env`)

```bash
sudo -u cerebro cp /opt/cerebro/backend/.env.example /opt/cerebro/backend/.env
sudo chmod 600 /opt/cerebro/backend/.env
sudo -u cerebro nano /opt/cerebro/backend/.env
```

Singurul lucru de completat e parola de la pasul 5, in `DATABASE_URL`:

```
DATABASE_URL=postgresql://cerebro:PAROLA_TA_HEX@localhost/cerebro
```

Restul are valori implicite potrivite pentru Ollama local. Le schimbi doar daca
ai un motiv:

| Variabila | Implicit | Ce face |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama` sau `anthropic` |
| `LLM_MODEL` | `gemma3:4b` | modelul folosit |
| `CONFIDENCE_THRESHOLD` | `0.6` | sub prag, nota merge in Inbox |
| `LLM_TIMEOUT_SECONDS` | `60` | la timeout, nota merge in Inbox |
| `OLLAMA_KEEP_ALIVE` | `30m` | tine modelul in RAM intre sync-uri |
| `TRASH_RETENTION_DAYS` | `30` | trebuie sa fie egal cu `TRASH_RETENTION_DAYS` din `mobile/src/types.ts` |

### 7.4 Schema bazei de date

```bash
sudo -u cerebro bash -c 'set -a; . /opt/cerebro/backend/.env; set +a; cd /opt/cerebro/db && ./migrate.sh'
```

Asteptat: `applying 001_init.sql` ... `done: 3 migration(s) applied`. Scriptul e
idempotent: la a doua rulare spune `database is up to date`.

### 7.5 Serviciile systemd

```bash
sudo cp /opt/cerebro/backend/deploy/cerebro-api.service   /etc/systemd/system/
sudo cp /opt/cerebro/backend/deploy/cerebro-purge.service /etc/systemd/system/
sudo cp /opt/cerebro/backend/deploy/cerebro-purge.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cerebro-api
sudo systemctl enable --now cerebro-purge.timer
```

- `cerebro-api` e API-ul (uvicorn pe portul 8000). Porneste la boot si se
  reporneste singur daca pica.
- `cerebro-purge.timer` sterge zilnic notele aflate in trash de mai mult de
  30 de zile.

### 7.6 Verificare

```bash
curl -s localhost:8000/health
# {"status":"ok","db":true}

journalctl -u cerebro-api -n 20 --no-pager
# cauta: cerebro-api up (categorizer=ollama model=gemma3:4b threshold=0.60)

systemctl list-timers cerebro-purge --no-pager                  # purge-ul e programat
sudo systemctl start cerebro-purge && journalctl -u cerebro-purge -n 5 --no-pager
# asteptat: purged 0 note(s) ... (0 e corect pe o instalare noua)
```

Apoi, de pe **telefon** (cu Tailscale pornit), deschide in Safari
`http://100.x.y.z:8000/health`. Daca vezi acelasi JSON, firewall-ul si
Tailscale sunt configurate corect.

---

## 8. Primul user si cheia API

Nu exista conturi sau parole. Fiecare user are **o cheie API**. Serverul tine
doar hash-ul ei (sha256), deci cheia in clar se afiseaza **o singura data**.

```bash
cd /opt/cerebro
sudo -u cerebro bash -c 'set -a; . backend/.env; set +a; venv/bin/python scripts/create_user.py --name alice'
```

```
user 'alice' created (id 1)
categories: Inbox, Idei YouTube, Filme, Todos

API KEY (shown once, paste it in Settings on the phone):
  ...
```

- Copiaz-o direct intr-un manager de parole. Daca o pierzi, nu poate fi
  recuperata: creezi alt user.
- `--minimal` creeaza userul doar cu `Inbox`. Restul categoriilor si le face
  fiecare din aplicatie.
- Un user per persoana. Fiecare vede doar notele si categoriile lui.

**Test end-to-end** (inlocuieste `CHEIA`):

```bash
curl -s -H "X-Api-Key: CHEIA" -H 'Content-Type: application/json' \
  -X POST localhost:8000/sync -d '{"notes":[{
    "uuid":"aaaaaaaa-0000-0000-0000-000000000001",
    "text":"de vazut Interstellar weekendul asta","category_id":null,"done":false,"deleted_at":null,
    "created_at":"2026-01-01T12:00:00Z","updated_at":"2026-01-01T12:00:00Z",
    "needs_categorization":true}]}'
```

In cateva secunde ar trebui sa primesti `category_id`-ul categoriei `Filme`.
Primul apel poate dura mai mult, pentru ca modelul se incarca in RAM.

---

## 9. Aplicatia pe iPhone

> **Expo Go nu merge cu proiectul asta.** Aplicatia Expo Go din App Store e in
> urma fata de SDK-ul folosit (Expo SDK 57). Pe telefon ai nevoie de un build
> propriu, facut din Xcode, cum e descris mai jos.

### 9.1 Pregatirea telefonului

1. Leaga iPhone-ul prin cablu de Mac si apasa **Trust** pe telefon.
2. Activeaza **Developer Mode**: *Settings -> Privacy & Security -> Developer
   Mode*. Telefonul cere un restart.
3. In Xcode: *Settings -> Accounts -> +* si adauga Apple ID-ul.

Dupa prima conectare prin cablu, de obicei poti instala si prin Wi-Fi.

### 9.2 Codul si dependintele

```bash
git clone https://github.com/ravtechz/cerebro-app-public.git cerebro
cd cerebro/mobile
npm install
```

### 9.3 Bundle ID-ul tau

Apple cere ca fiecare aplicatie sa aiba un identificator unic. In
`mobile/app.json` schimba `com.example.cerebro` (apare de doua ori: `ios` si
`android`) in ceva al tau, de ex. `com.numeletau.cerebro`.

### 9.4 Team ID-ul

Ai nevoie de Team ID-ul de 10 caractere al contului Apple. Dupa ce ai adaugat
Apple ID-ul in Xcode si ai facut macar un build (sau ai creat certificatul din
*Accounts -> Manage Certificates -> + -> Apple Development*):

```bash
security find-certificate -c "Apple Development" -p | openssl x509 -noout -subject
# ... OU=ABCDE12345 ...   <- asta e Team ID-ul
```

### 9.5 Build si instalare

```bash
npx expo prebuild -p ios                          # genereaza folderul ios/
EXPO_APPLE_TEAM_ID=ABCDE12345 ./install-device.sh
```

`install-device.sh` face build **Release**, semneaza aplicatia, o instaleaza pe
telefon si o deschide. Prima data dureaza cateva minute.

Daca scriptul spune *Installed. iOS will not open it until the certificate is
trusted*, e normal la primul build. Pe telefon:
*Settings -> General -> VPN & Device Management -> Apple Development: ... ->
Trust*, apoi deschizi Cerebro.

> **De ce Release si nu Debug?** Un build Debug nu contine codul JavaScript, ci
> il cere de la Mac (Metro) la fiecare pornire. Merge doar cat timp Mac-ul e
> pornit si in aceeasi retea. Release are totul inauntru si merge oriunde.

### 9.6 Limita de 7 zile (Apple ID gratuit)

Cu un Apple ID gratuit (Personal Team), semnatura expira dupa **7 zile**.
Aplicatia ramane instalata, dar nu mai porneste. Datele din ea nu se pierd.
Rezolvarea e sa rulezi din nou scriptul:

```bash
./install-device.sh --status                      # cand expira, ce e pe telefon
EXPO_APPLE_TEAM_ID=ABCDE12345 ./install-device.sh
```

Un cont Apple Developer platit (99$/an) prelungeste perioada la un an.

### 9.7 Fara iPhone: simulatorul

```bash
cd mobile
npm run ios        # build si pornire in iOS Simulator
```

---

## 10. Conectarea aplicatiei la server

1. Pe iPhone: Tailscale pornit, logat in acelasi cont ca VM-ul.
2. In Cerebro: deschide sidebar-ul si apasa pe rotita (Settings).
3. **api base url**: `http://100.x.y.z:8000` (sau `http://cerebro-vm:8000`
   daca ai MagicDNS).
4. **api key**: cheia de la pasul 8.
5. Apasa **Test connection**. Testul verifica si ca serverul raspunde, si ca
   cheia e acceptata.
6. Apasa **salveaza**.

Pana cand testul trece, aplicatia ruleaza pe un client local de proba (mock) si
nu trimite nimic la server. Dupa test, fiecare nota noua pleaca la server si se
intoarce cu categoria.

**Mai multi useri**: fiecare persoana primeste cheia ei (pasul 8), pe telefonul
ei. Telefonul trebuie sa vada VM-ul prin Tailscale: fie e in acelasi tailnet,
fie ii *share*-uiesti doar VM-ul din consola Tailscale (*Share...*), fara
acces la restul retelei tale.

---

## 11. Operare zilnica

Scripturile ruleaza **de pe Mac** si intra pe VM prin SSH. Userul de SSH are
nevoie de `sudo` **fara parola** pentru comenzile pe care le ruleaza scripturile.
Pe VM, `sudo visudo -f /etc/sudoers.d/cerebro` si adauga (inlocuieste `deploy`
cu userul tau):

```
deploy ALL=(cerebro) NOPASSWD: ALL
deploy ALL=(postgres) NOPASSWD: /usr/bin/psql
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart cerebro-api, /usr/bin/systemctl restart cerebro-api.service, /usr/bin/systemctl restart ollama.service, /usr/bin/systemctl restart postgresql@18-main.service
```

### Update la backend

`deploy.sh` intra pe VM, face `git pull` din repo-ul clonat la pasul 7,
instaleaza dependintele, ruleaza migratiile noi si reporneste API-ul. Apoi
asteapta ca `/health` sa fie verde.

```bash
cd backend
HOST=user@cerebro-vm ./deploy.sh
HOST=user@cerebro-vm ./deploy.sh --status         # stare + ultimele loguri
```

Daca o migratie esueaza, serviciul **nu** e repornit: ramane versiunea veche,
care merge.

### Stare si restart

```bash
export CEREBRO_HOST=user@cerebro-vm CEREBRO_API_URL=http://100.x.y.z:8000

./scripts/status.sh            # API, serviciu, VM, note per user, expirarea profilului iOS
./scripts/status.sh --brief    # o singura linie
./scripts/restart.sh           # reporneste doar cerebro-api
./scripts/restart.sh --all     # postgres -> ollama -> api, in ordine
./scripts/restart.sh --dry-run # arata ce ar face, fara sa schimbe nimic
```

### Update la aplicatie

Dupa `git pull` in `mobile/`: daca s-a schimbat versiunea din `app.json`, ruleaza
intai `npx expo prebuild -p ios`, apoi `./install-device.sh`. Prebuild-ul sterge
si regenereaza `ios/`, deci schimbarile facute de mana acolo se pierd. Nu edita
niciodata `ios/` direct.

---

## 12. Dezvoltare locala

### Backend

Testele au nevoie de un PostgreSQL real, pe care il pornesti in Docker:

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

docker run -d --name cerebro-test -p 55432:5432 \
  -e POSTGRES_USER=cerebro -e POSTGRES_PASSWORD=test -e POSTGRES_DB=cerebro postgres:18
TEST_DATABASE_URL=postgresql://cerebro:test@localhost:55432/cerebro .venv/bin/python -m pytest
```

LLM-ul e simulat in teste, deci nu ai nevoie de Ollama. Pentru un server local:
`.venv/bin/uvicorn app.main:app --reload` (port 8000), cu `DATABASE_URL` setat.

### Mobile

```bash
cd mobile
npm start              # Metro
npm run ios            # simulator
npm run typecheck      # TypeScript strict, trebuie sa ramana curat
npm run bundle         # prinde erori de import fara device
```

**In browser**: `npm run web`, apoi intr-un al doilea terminal
`npm run web:preview`, si deschizi **http://localhost:8082** (nu 8081).
SQLite-ul din browser are nevoie de headere speciale, pe care le adauga
proxy-ul de pe 8082.

`CLAUDE.md` contine detaliile de arhitectura si capcanele care nu se vad din
cod. E util daca lucrezi pe proiect cu [Claude Code](https://claude.com/claude-code).

---

## 13. Probleme frecvente

| Simptom | Cauza si rezolvarea |
|---|---|
| Aplicatia zice „retea indisponibila”, dar Safari deschide `/health` | iOS blocheaza HTTP simplu (ATS). In `app.json`, `NSAppTransportSecurity` trebuie sa contina **doar** `NSAllowsArbitraryLoads: true`, fara alte chei. Dupa ce il modifici: `npx expo prebuild -p ios` si build nou. |
| *Project is incompatible with this version of Expo Go* | Expo Go nu suporta SDK 57. Vezi [pasul 9](#9-aplicatia-pe-iphone). |
| Aplicatia nu mai porneste dupa o saptamana | A expirat profilul de 7 zile. Ruleaza din nou `install-device.sh`. |
| *No profiles for '...' were found* | Profil expirat sau inexistent. `install-device.sh` il regenereaza singur (`-allowProvisioningUpdates`). Nu folosi `expo run:ios --device`, care nu face asta. |
| `ApplicationVerificationFailed` la instalare | Unele framework-uri au ramas nesemnate. `install-device.sh` verifica semnatura inainte de instalare. Detalii in `CLAUDE.md`. |
| *No script URL provided* | E un build Debug, iar telefonul nu vede Mac-ul. Fa build Release (`install-device.sh`). |
| Versiunea din sidebar difera de cea din iOS | Ai schimbat versiunea fara `npx expo prebuild -p ios`. |
| `/health` raspunde `"db":false` | Postgres e oprit sau `DATABASE_URL` e gresit: `systemctl status postgresql@18-main` si verifica `.env`. |
| Toate notele ajung in Inbox | Ollama nu raspunde sau modelul lipseste: `systemctl status ollama`, `ollama list`, `journalctl -u cerebro-api -n 50`. |
| `cerebro-api` intra intr-o bucla de restart | `journalctl -u cerebro-api -n 50`. O eroare despre `postgresql.key` sau `/home` inseamna ca s-a pierdut linia `Environment=HOME=/opt/cerebro` din unitate. |
| `deploy.sh`: *a terminal is required to read the password* | Lipseste regula `sudoers` din [pasul 11](#11-operare-zilnica). |

---

## 14. Securitate

- **Nu expune portul 8000 pe internet.** Nu face port forwarding pe router.
  Accesul e doar prin Tailscale, iar `ufw` blocheaza restul.
- **HTTP simplu e acceptabil doar in tunel.** Traficul e criptat de WireGuard
  (Tailscale), nu de HTTPS. Daca vrei HTTPS real, foloseste `tailscale serve`.
- **Cheile API sunt secrete.** Serverul tine doar hash-ul lor. Una scursa
  inseamna acces la notele acelui user, deci il stergi si creezi altul.
- **Secretele stau doar in `backend/.env`** (`chmod 600`, ignorat de git):
  parola Postgres si, optional, cheia Anthropic. Nimic sensibil in cod sau in
  aplicatie.
- **Izolare intre useri**: fiecare query de pe server e filtrat pe user, iar
  testele verifica explicit ca userul A nu vede si nu modifica datele lui B.
- Serviciul ruleaza ca user de sistem fara login, cu `ProtectSystem=strict` si
  `ProtectHome=true`. Poate scrie doar in `/opt/cerebro`.

---

## 15. Fazele proiectului

Proiectul a fost construit pe faze. In comentariile din cod apar ca „Faza NN”.

| Faza | Ce | Stare |
|---|---|---|
| 01 | Aplicatia Expo, SQLite, worker-ul de sync | gata |
| 02 | VM, Tailscale, firewall | gata |
| 03 | Schema Postgres, migratii, provisioning de useri | gata |
| 04 | Backend FastAPI + categorizator LLM, deploy | gata |
| 05 | Integrarea aplicatiei cu serverul real | gata |
| 06 | Pagina web read-only + cautare semantica (pgvector) | viitor |
| 07 | Android din acelasi cod | viitor |

Contributiile sunt binevenite. Vezi `CONTRIBUTING.md`.

---

## 16. Licenta

**PolyForm Noncommercial 1.0.0** (vezi `LICENSE.md`): poti folosi, studia,
modifica si distribui codul **in scop necomercial**, adica pentru tine, familie,
prieteni, invatare sau proiecte hobby. Nu ai voie sa il vinzi si nici sa il
oferi ca serviciu platit.

Fontul Excalifont (`mobile/assets/fonts/`) are licenta lui, SIL Open Font
License 1.1, inclusa langa el.
