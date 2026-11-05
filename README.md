# Project Manager

Application locale pour visualiser et organiser les projets qu'on y ajoute : état git, Docker, taille, documentation et variables d'environnement, avec un classement par tags, statut et notes.

## Lancer

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://127.0.0.1:4300. Les projets s'ajoutent à la main (nom, description, répertoire), seuls ou en multi-projet avec un sous-répertoire par dépôt. Rien n'est découvert automatiquement, et leurs informations se rafraîchissent à la demande.

## Langues

L'interface est en anglais par défaut, et la langue se choisit dans Settings. Pour en ajouter une : copier `src/i18n/fr.ts`, le traduire, puis l'ajouter à `LANGUAGES` dans `src/i18n/index.ts`. TypeScript signale toute clé manquante.

## Données et sécurité

- **Base :** SQLite dans `~/.local/share/project-manager/pm.db`. `PM_DB_PATH` permet de pointer ailleurs.
- **Projets abandonnés :** ils ne sont plus lus du tout et n'apparaissent que dans la vue « Abandonnés », d'où on peut les restaurer.
- **Lecture seule :** l'actualisation n'écrit rien dans les projets, et retirer un projet de la liste ne touche pas au disque. Seules les actions Docker, les commandes configurées, le nettoyage et les actions des onglets Git et Env-Var agissent sur la machine.
- **Variables d'environnement :** l'onglet Env-Var compare `.env` à `.env.local` en ne changeant que la ligne de la variable. Les valeurs ne sont écrites que dans `.env.local` : `.env` ne reçoit qu'un nom sans valeur, à la demande. Chaque valeur enregistrée, retirée ou écrasée est gardée pour pouvoir y revenir : ces valeurs, secrets compris, sont **en clair** dans la base de l'application, et sont effacées quand le projet est retiré de la liste.
- **Actions git :** changer de branche et récupérer une branche distante (refusés tant que le dossier a des modifications), créer d'un coup les branches locales de toutes les branches distantes (sans basculer), `fetch --prune`, `pull --ff-only`, créer une branche, et supprimer des branches locales déjà fusionnées (avec `git branch -d`, jamais `-D`, et jamais les branches principales). Rien d'autre : ni commit, ni merge, ni reset, ni push. Les stashes sont seulement listés.
- **`.env` :** les valeurs sont lues à la demande, à la racine du projet, sans jamais être stockées ni journalisées.
- **Logs de conteneur :** le bouton « Logs » suit `docker logs`, d'un conteneur ou de tout le projet, tant que le panneau est ouvert et même après un redémarrage, sans rien enregistrer. Le conteneur doit appartenir au projet, et fermer le panneau arrête la lecture.
- **Build et pull :** ces boutons lancent `docker compose up -d --build`, ou `pull` puis `up -d`, après confirmation : les conteneurs dont l'image change sont remplacés, les volumes sont gardés. Jamais de `down`.
- **Nettoyage :** seuls des dossiers connus (`node_modules`, `vendor`, `var/cache`, `var/log`, `.next`…), ignorés par git et sans fichier suivi, sont proposés, et supprimés définitivement après confirmation. `var/` entier ne l'est jamais.
- **Fetch et analyse de tous les projets :** deux boutons de la liste, jamais automatiques. Le fetch contacte les dépôts distants de chaque projet, sans toucher aux branches locales.
- **Dump stash :** les dumps de bases de données (PostgreSQL, MySQL, MariaDB, MongoDB) sont lus dans les conteneurs Docker des projets et gardés dans `~/.local/share/project-manager/dumps/<projet>/`, à côté de la base (`PM_DUMPS_DIR` pour les mettre ailleurs). Jamais dans les projets. Ce sont de vraies données : fichiers et dossiers créés ne sont lisibles que par toi. Charger un dump propose d'abord d'en faire un de ce qui se trouve dans la base, et rien n'est chargé s'il échoue.
- **Consommation Claude Code :** les transcripts de `~/.claude/projects/` (ou de `CLAUDE_CONFIG_DIR`) sont lus au démarrage puis chaque minute, sans jamais y écrire. Seuls les chiffres de chaque appel sont gardés dans la base, jamais le contenu des échanges, et ils survivent à la purge des transcripts. Un appel va au projet le plus profond qui contient son dossier. Le coût est un équivalent au tarif API, avec la grille de `src/lib/claude-pricing.ts` à mettre à jour à la main ; il ne compte pas la majoration de `inference_geo: "us"`.
- **Console Claude :** le bouton « Ouvrir Claude » lance le vrai `claude` sur la machine, dans le dossier du projet, avec tes droits, ta configuration et ton mode de permissions par défaut : il peut modifier le projet comme dans un terminal. Rien de ce qui vient du navigateur n'est passé à la commande, sauf un identifiant de session déjà connu pour ce projet. Plusieurs sessions peuvent tourner en onglets. Claude appartient au serveur : fermer ou recharger la page ne l'arrête pas, et il continue ce qu'il faisait, consommation comprise. La page retrouve ses consoles au retour, avec les 4 derniers Mo de ce qu'elles ont affiché. Seuls « Terminer la session », l'arrêt du serveur ou 24 h sans aucune page connectée arrêtent Claude ; « Reprendre » rouvre alors la conversation. Chaque console reçoit un hook `SessionStart`, pour elle seule, qui lui permet de suivre sa conversation après un `/clear`.
- **Serveurs distants :** une connexion ne part que d'un clic. « Tester » ne lance rien d'autre que `true`, `test -d <dossier>` ou une lecture `kubectl`. « Console » ouvre un vrai `ssh` ou `kubectl exec`, avec confirmation sur un environnement protégé : ce qu'on y tape s'exécute, et le mot de passe non mémorisé se saisit dans le terminal, sans passer par l'app. Les clés et identifiants Kubernetes restent dans `~/.ssh` et `~/.kube` ; l'app ne garde que leur nom. Un mot de passe est demandé à chaque connexion, sauf si tu le renseignes dans le formulaire du serveur ou choisis de le mémoriser après un test : il est alors chiffré en AES-256-GCM avec une clé privée dans `~/.config/project-manager/secret.key`, hors du dossier de données. Une copie de la base seule ne le révèle pas, mais un programme lancé avec ton compte peut lire cette clé. Perdre ce fichier oblige seulement à ressaisir les mots de passe. Une clé d'hôte inconnue est refusée par « Tester », et c'est à toi d'y répondre dans une console : elle n'est jamais acceptée à ta place.
- **VPN :** ils ne se connectent et ne se coupent que sur un clic. Un fichier `.ovpn` devient un profil NetworkManager, sans `sudo` et visible dans les réglages réseau du système ; son mot de passe y est marqué « non enregistré » et reste chiffré dans l'app, avec la même clé que les serveurs. Un token n'est jamais gardé. Pour un serveur qui refuse NetworkManager, le mode « OpenVPN avec sudo » lance `openvpn` directement : tu ajoutes une fois une règle `sudoers` limitée à cette commande exacte et une copie du fichier appartenant à `root`, et l'app n'écrit jamais dans `/etc`. Un programme lancé avec ton compte pourrait démarrer ce VPN sans mot de passe, mais pas changer ce qu'il exécute.
- **MCP de l'app :** chaque console Claude de l'app reçoit, pour elle seule, un accès en lecture à ce que l'app sait des projets : conteneurs, adresses, ports, analyses, statut, tags et note, structure des bases, noms et adresses des environnements. Jamais de valeur d'environnement, de ligne de base ni d'accès à un serveur. Le jeton change à chaque démarrage du serveur et reste dans un fichier privé, supprimé avec la console.
- **Accès local :** le serveur écoute sur `127.0.0.1`, et `src/proxy.ts` refuse les requêtes venant d'un autre site.

## Développement

```bash
pnpm test         # tests Vitest
pnpm typecheck
pnpm lint
pnpm db:generate  # migration après un changement de src/server/db/schema.ts
```

Node 26 (voir `.nvmrc`) : `better-sqlite3` 13 plante à l'ouverture d'une base sur Node 22.12, il faut au moins une 22.22 ou plus récente.

## Start with a name

`./start.sh` runs the dev server so that it also answers at http://project.dev.local:4300.
Add `127.0.0.1 project.dev.local` to `/etc/hosts` first. The server stays bound to 127.0.0.1;
other names are accepted only when listed in `PM_ALLOWED_HOSTS` (comma-separated, exact names).

Behind the local Traefik (`~/Projects/adimeo_docker_local`), it answers at
https://project.dev.local, with the proxy's certificate. Its `conf/config.yml` routes that
name to `http://host.docker.internal:4300`, which Docker Desktop leads to the app on the
host's 127.0.0.1. Consoles still connect straight to 127.0.0.1, and Claude consoles reach
the app's MCP server there too, whatever name the page was opened by.

Without the proxy, `./start.sh --https` answers at https://project.dev.local:4300 instead. Over plain http, a
name other than localhost or 127.0.0.1 is not a secure context: the browser hides the
clipboard API and `crypto.randomUUID`. The certificate is made once by `mkcert` in `.certs/`
(git-ignored); run `mkcert -install` once so that the browser trusts it.
