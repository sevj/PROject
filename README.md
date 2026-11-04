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
- **Lecture seule :** l'actualisation n'écrit rien dans les projets, et retirer un projet de la liste ne touche pas au disque. Seules les actions Docker, les commandes configurées et les actions des onglets Git et Env-Var agissent sur la machine.
- **Variables d'environnement :** l'onglet Env-Var compare `.env` à `.env.local` en ne changeant que la ligne de la variable. Les valeurs ne sont écrites que dans `.env.local` : `.env` ne reçoit qu'un nom sans valeur, à la demande. Chaque valeur enregistrée, retirée ou écrasée est gardée pour pouvoir y revenir : ces valeurs, secrets compris, sont **en clair** dans la base de l'application, et sont effacées quand le projet est retiré de la liste.
- **Actions git :** changer de branche et récupérer une branche distante (refusés tant que le dossier a des modifications), créer d'un coup les branches locales de toutes les branches distantes (sans basculer), `fetch --prune`, `pull --ff-only`, créer une branche, et supprimer des branches locales déjà fusionnées (avec `git branch -d`, jamais `-D`, et jamais les branches principales). Rien d'autre : ni commit, ni merge, ni reset, ni push. Les stashes sont seulement listés.
- **`.env` :** les valeurs sont lues à la demande, à la racine du projet, sans jamais être stockées ni journalisées.
- **Dump stash :** les dumps de bases de données (PostgreSQL, MySQL, MariaDB, MongoDB) sont lus dans les conteneurs Docker des projets et gardés dans `~/.local/share/project-manager/dumps/<projet>/`, à côté de la base (`PM_DUMPS_DIR` pour les mettre ailleurs). Jamais dans les projets. Ce sont de vraies données : fichiers et dossiers créés ne sont lisibles que par toi.
- **Accès local :** le serveur écoute sur `127.0.0.1`, et `src/proxy.ts` refuse les requêtes venant d'un autre site.

## Développement

```bash
pnpm test         # tests Vitest
pnpm typecheck
pnpm lint
pnpm db:generate  # migration après un changement de src/server/db/schema.ts
```

`better-sqlite3` reste fixé en 12.11.1, car les binaires 13.x plantent à l'ouverture d'une base sur Node 22.12.
