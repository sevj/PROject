# Project Manager

Application locale pour visualiser et organiser les projets d'un dossier : état git, Docker, taille, documentation et variables d'environnement, avec un classement par tags, statut et notes.

## Lancer

```bash
pnpm install
pnpm dev
```

Puis ouvrir http://127.0.0.1:4300. Le premier chargement lance un scan ; ensuite, tout se rafraîchit à la demande.

## Données et sécurité

- **Base :** SQLite dans `~/.local/share/project-manager/pm.db`. `PM_DB_PATH` et `PM_ROOT` permettent de pointer ailleurs.
- **Sauvegarde :** le classement est saisi à la main et ne peut pas être recalculé. L'écran Organisation permet de l'exporter et de l'importer en JSON.
- **Projets abandonnés :** ils ne sont plus scannés du tout et n'apparaissent que dans la vue « Abandonnés », d'où on peut les restaurer.
- **Lecture seule :** le scan n'écrit rien dans les projets. Seules les actions Docker et les commandes configurées agissent sur la machine.
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
