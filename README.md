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
- **Sauvegarde :** le classement est saisi à la main et ne peut pas être recalculé. L'écran Organisation permet de l'exporter et de l'importer en JSON.
- **Projets abandonnés :** ils ne sont plus lus du tout et n'apparaissent que dans la vue « Abandonnés », d'où on peut les restaurer.
- **Lecture seule :** l'actualisation n'écrit rien dans les projets, et retirer un projet de la liste ne touche pas au disque. Seules les actions Docker et les commandes configurées agissent sur la machine.
- **`.env` :** les valeurs sont lues à la demande, à la racine du projet, sans jamais être stockées ni journalisées.
- **Accès local :** le serveur écoute sur `127.0.0.1`, et `src/proxy.ts` refuse les requêtes venant d'un autre site.

## Développement

```bash
pnpm test         # tests Vitest
pnpm typecheck
pnpm lint
pnpm db:generate  # migration après un changement de src/server/db/schema.ts
```

`better-sqlite3` reste fixé en 12.11.1, car les binaires 13.x plantent à l'ouverture d'une base sur Node 22.12.
