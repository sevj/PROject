# Feuille de route

Six chantiers choisis, dans l'ordre. Cocher au fur et à mesure.

Choix par défaut : nouvelles entrées de menu (Ressources, Ports, Journal, Carte) regroupées sous « Outils » ; rien ne modifie un projet sans bouton explicite ; nouvelles migrations.

## 0. Socle commun
- [x] Table générique d'analyses en cache (résultats datés).

## 1. Ressources (entrée de menu + section dans l'onglet Docker)
- [x] `docker stats` CPU/mémoire toutes les 2 s tant que la page est ouverte.
- [x] Disque occupé : images, conteneurs, volumes, cache de build.
- [x] Boutons de nettoyage avec aperçu avant.
- [x] Les volumes ne sont jamais supprimés en masse : listés un par un, ceux des projets signalés, suppression avec confirmation explicite.

## 2. Ports (entrée de menu générale)
- [x] Ports publiés par Docker, ports déclarés dans compose (même projet arrêté), processus en écoute sur l'hôte (`ss`).
- [x] Détection des collisions, signalées en premier.

## 3. Onglet « Sécurité et dépendances » sur la fiche projet
- [x] npm / pnpm / yarn / composer : paquets obsolètes + audit. (cargo / go : pas faits, non installés ici ; yarn non testé sur un vrai projet.)
- [x] Compteurs dans la liste, bouton « Analyser » manuel, résultats datés en cache.
- [x] composer : sur la machine, sinon dans un conteneur du projet qui tourne et qui l'a (plugins et scripts désactivés).

## 4. Explorateur de bases + requêtes SQL
- [x] Tables / colonnes / lignes paginées, éditeur SQL, historique par projet.
- [x] Lecture seule garantie par la base (session READ ONLY) + contrôle du texte, limites 1000 lignes et 15 s.
- [x] MongoDB : collections + filtre JSON.
- Hors périmètre pour l'instant : écritures, comparaison de dumps.

## 5. Journal de travail automatique
- [x] Sessions déduites des commits git (écart ≤ 30 min, marge 15 min, configurable) et de l'activité de Claude Code.
- [x] Échantillonneur d'activité fichiers optionnel (désactivé par défaut), actif seulement quand l'app tourne.
- [x] Vue hebdomadaire projet × jour, estimations présentées comme telles.

## 6. Carte visuelle
- [x] React Flow, disposition en couches : projets / services / bases (flèches depends_on). Version simple, pour juger.

## Reste à faire hors chantiers
- Fait : `env-files.tsx` orphelin et clés `environment` / `noEnv` supprimés. La ligne « .env files » de `project-facts.tsx` est gardée : elle sert encore dans le panneau latéral de la liste.

## 7. Explorateur de bases : suite (retenu)
- [x] EXPLAIN visuel (PostgreSQL, MySQL, MariaDB ; SQLite avec son explorateur) : plan d'exécution en arbre avec coût, lignes estimées/réelles et nœuds lents mis en évidence (PostgreSQL `EXPLAIN (FORMAT JSON)`, MySQL/MariaDB `EXPLAIN FORMAT=JSON`, SQLite `EXPLAIN QUERY PLAN`). Lecture seule : pas d'`ANALYZE` sur une requête qui écrit.
- [x] SQLite : fichiers `.db`/`.sqlite` détectés dans le projet, ouverts en lecture seule.
- [x] Redis : clés paginées (`SCAN`), type et TTL, valeur affichée selon le type, commandes de lecture uniquement. (aucun champ de commande libre ; scripts de lecture fixes, non essayés sur un vrai Redis)
- [x] Schéma et relations entre tables : clés étrangères (PostgreSQL, MySQL/MariaDB, SQLite), diagramme des tables liées, navigation d'une clé étrangère vers la ligne qu'elle désigne. (SQLite testé sur de vrais fichiers, mais pas dans le navigateur ; MariaDB pas essayé)
- Écarté : comparaison de deux dumps.

## 8. Logs de conteneur
- [x] Bouton « Logs » sur chaque conteneur, même arrêté : 1000 dernières lignes puis la suite en direct, filtre, horodatage, stderr signalé. Rien n'est enregistré.

## 9. Améliorations de l'existant (retenu, review du 2026-11-05)
Dans l'ordre. Rien n'écrit dans un projet sans bouton explicite.
- [x] Git : commits non poussés, tous remotes confondus, et mention « aucun remote ». (compte aussi d'anciens commits de branches locales que le dépôt distant n'a plus)
- [x] Git : diff des fichiers modifiés et contenu des stashes, en lecture seule. (au plus 30 fichiers non suivis avec leur contenu)
- [x] Docker : bouton « Ouvrir le site » depuis Traefik et les ports publiés. (ports web usuels seulement, Traefik supposé sur 80 et 443)
- [x] Console Claude : sessions gardées côté serveur et rattachées après un rechargement. (consoles Docker inchangées ; perdues si le serveur redémarre, « Reprendre » rouvre la conversation)
- [x] Git : bouton explicite « Fetch tous les projets ».
- [x] Docker : boutons `build` et `pull` explicites. (avec confirmation, se terminent par `up -d` ; pas de bouton d'annulation)
- [x] Logs : logs de tout le projet fusionnés, et reprise après un redémarrage. (un conteneur recréé n'est repris qu'avec « Relire »)
- [x] Dumps : dump de sécurité proposé avant un chargement.
- [x] Sécurité : bouton « Analyser tous les projets ».
- [x] Structure : taille des dossiers. (à l'ouverture de chaque dossier, 60 s au plus)

## 10. Ajouts (retenu)
- [x] Page Claude globale : coût par projet, jour et modèle.
- [x] Nettoyage des projets : dossiers régénérables (`var/cache`, `var/log`, `node_modules`…), avec aperçu et confirmation. (dans Structure et Ressources ; seulement ignorés par git et sans fichier suivi, `var/` entier jamais)
- [x] Config Claude par projet : consignes lues et état (`CLAUDE.md`, `AGENTS.md`), boutons pour les faire générer ou relire par Claude, noms des hooks, skills et serveurs MCP.
- [x] MCP de l'app en lecture seule pour ses consoles Claude : projets, conteneurs, ports, analyses, structure des bases. (ni valeurs `.env`, ni lignes de base)
- [x] Serveurs distants : catalogue partagé (SSH, Kubernetes), environnements par projet avec adresses et accès, test de connexion sur demande. (mots de passe demandés, ou chiffrés si tu choisis de les mémoriser)
- [x] Serveurs distants : ouvrir une console SSH ou kubectl dans l'app, avec confirmation sur un environnement protégé. (se ferme avec la page, comme une console Docker ; un Deployment n'ouvre que sur un pod qui lui appartient)
- [x] VPN : OpenVPN par NetworkManager et NordLayer, connexion en un clic avec token éventuel, VPN requis par serveur. (jamais connecté tout seul)
- [x] VPN : GlobalProtect derrière une connexion Microsoft (gp-saml-gui, puis openconnect par un script root), split tunnel par réseaux.

## 11. Suite (retenu, liste du 2026-11-05)
Dans l'ordre proposé : du plus petit et du plus utile au quotidien vers ce qui demande un nouveau socle (token GitLab, format d'export).
- [x] Alias de commandes : liste éditable ligne par ligne (Réglages, et « Modifier » dans la box, sans quitter la console) affichée dans une box en haut à droite des consoles locales ; un clic lance la commande ; tapé seul sur une ligne puis Entrée, l'alias est remplacé par sa commande (pas après une flèche ou Tab, ni dans vim). Pour commencer : `sf:cc` → `php bin/console c:c`, `sf:amc` → `php bin/console asset-map:compile`.
- [x] VPN : expiration de session détectée (badge + bouton « Se reconnecter » ; la connexion Microsoft passe sans saisie tant que son cookie est valide). (GlobalProtect seulement : état « session terminée » quand openconnect s'arrête seul après avoir été connecté, message dans la barre du haut, « Ignorer » pour l'effacer)
- [x] Page Docker globale : tous les conteneurs lancés, tous projets confondus, avec arrêt unitaire, par projet, ou tout arrêter (avec confirmation). (onglet « Conteneurs » de Docker ; regroupés par projet, sinon par projet compose ; CPU et mémoire en direct ; « Ne garder que celui-ci » ; arrêtés masqués par défaut ; `docker stop`, jamais `down`)
- [x] Clés SSH : liste des clés de `~/.ssh` (type, empreinte, commentaire, protégée ou non) et affectation d'une clé à une connexion serveur (`IdentitiesOnly`, fini « Too many authentication failures »). (onglet « Clés SSH » de Serveurs ; aussi : présente dans l'agent, droits trop ouverts avec bouton `chmod 600`, copie de la clé publique ; reprendre une clé remet le serveur sur l'agent ; pas de création de clé)
- [x] Menu « Outils », générateurs : mot de passe, UUID, hash bcrypt, décodage de JWT. Tout dans le navigateur, rien n'est envoyé ni gardé. (UUID v4 et v7 ; bcrypt avec vérification d'un hash, par bcryptjs ; JWT lu sans vérifier la signature)
- [x] Menu « Outils », convertisseurs : timestamp ↔ date, base64, JSON formaté, cron expliqué en clair (avec ses prochaines exécutions).
- [x] Consoles en onglets : Docker (consoles de plusieurs conteneurs, logs d'un conteneur ou de tout le projet, bouton « Logs » dans chaque console) et serveurs distants (plusieurs SSH ou kubectl, confirmation gardée pour un environnement protégé).
- [x] Palette de commandes (Ctrl+K, validée) : fenêtre centrée, recherche floue sur projets, serveurs, environnements, bases, VPN et pages ; récents en premier ; Tab ou → pour les actions de l'élément (fiche, démarrer/arrêter Docker, console, alias, SSH, VPN requis, explorateur) ; préfixe `>` pour ne chercher que des actions ; tout au clavier. Une action qui écrit ou touche un environnement protégé garde sa confirmation. (aussi un bouton « Rechercher » dans l'en-tête ; conteneurs avec console, logs, base ; consoles distantes ; VPN connectés seulement sans mot de passe ni token à taper, sinon page VPN ; Ctrl+K reste au shell dans un terminal)
- [x] Versions et fin de support : PHP, Symfony, Drupal, Node et bases de chaque projet, comparées à endoflife.date (en cache, daté), tableau de tous les projets. (onglet « Versions » de Projets ; lu dans les images Docker, composer.lock, composer.json, .nvmrc et package.json ; dates d'endoflife.date gardées un jour en base, « Relire » pour forcer ; seuls les noms de produits sont envoyés)
- [x] Requêtes HTTP enregistrées par projet (Postman léger) : méthode, URL, en-têtes, corps, variables par environnement (local, recette, prod), historique des réponses. Secrets chiffrés comme les mots de passe des serveurs ; confirmation avant une requête qui écrit en prod. (onglet « HTTP » de la fiche ; Local + environnements du projet, {{baseUrl}} = première adresse de l'environnement ; envoi par le serveur, 30 s ; 10 réponses gardées, 512 Ko chacune)
- [x] Partage de configuration : export d'un projet (serveurs, environnements, VPN, alias, requêtes HTTP) en fichier, sans aucun secret, et import avec aperçu, pour l'onboarding d'un collègue. (boutons dans l'en-tête de la fiche ; rien d'existant n'est écrasé ; OpenVPN signalé, son .ovpn restant à ajouter ; serveur à clé exporté en agent) Fiche complète ajoutée le 2026-11-06 (nom, description, tags, statut, note) et « Importer un projet » sur la page Projets, dans un dossier déjà cloné. Multi-projets (sous-projets dans leurs sous-dossiers) et boutons sur la mini-fiche de la liste ajoutés le 2026-11-06.
- [ ] Onglet Git : qui travaille sur quoi, dernières branches et MR des autres sur le projet, depuis GitLab (demande un token : à poser avec « Merge requests et CI »).

## Écarté (review du 2026-11-05)
- Copier ou télécharger un résultat de requête.
- Commandes du projet en boutons : remplacées par les alias du chantier 11.

## Pas encore décidé (review du 2026-11-05)
- Merge requests et CI (GitLab d'abord) : demande un token et des appels réseau.
- Fiabilité et ménage : fait le 2026-11-06. `next build` passe et `next start` sert les pages (essayé sur une copie de la base) ; `pm.db` et ses fichiers WAL étaient déjà en `600`, le dossier en `700` ; README titré PROject ; menu « Outils » en place.

## Idées Git (à documenter, pas décidé de les faire)
Les actions Git restent volontairement limitées (voir README). À rediscuter avant tout développement :
- Diff, log, historique d'un fichier, blame.
- Commit, push, merge, rebase, actions sur les stashes.
- État des PR et de la CI (GitHub/GitLab) avec lien direct.
- Alertes : travail non poussé, branches obsolètes, dépôt sale depuis longtemps.
- Worktrees, submodules, tags et releases.

## Autres idées (liste du 2026-11-05, non retenues pour l'instant)
Erreurs Docker avec délai d'expiration, dépendances cargo/go/pip, comparaison `.env.example`/`.env`, budgets Claude.
