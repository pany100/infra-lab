# infra-lab

Laboratorio de infraestructura para experimentar con un stack típico de backend: API Node.js detrás de un reverse proxy, balanceo de lectura/escritura sobre PostgreSQL con réplicas, y Redis para rate limiting. Todo orquestado con Docker Compose.

## Arquitectura

```
        ┌─────────┐
client →│  nginx  │ (puerto 3000 → 80)
        └────┬────┘
             │ least_conn
             ▼
        ┌─────────┐
        │   api   │ x3 réplicas (Node.js / Express)
        └────┬────┘
       writes│   │reads
             │   ▼
             │  ┌──────────┐      ┌──────────────┐
             │  │ haproxy  │ ───▶ │ db-replica-1 │
             │  │  (tcp)   │ ───▶ │ db-replica-2 │
             │  └──────────┘ ───▶ │ db-replica-3 │
             ▼                    └──────────────┘
       ┌────────────┐                    ▲
       │ db-primary │ ── streaming repl ─┘
       └────────────┘

       ┌────────┐
       │ redis  │  ← rate limiting (login)
       └────────┘
```

## Componentes

- **nginx** (`nginx.conf`): reverse proxy en el puerto `3000` con upstream `least_conn` apuntando a las réplicas de la API.
- **api** (`server.js`, `Dockerfile`): API Express con 3 réplicas vía `deploy.replicas`. Usa dos pools de `pg`:
  - `primaryPool` para escrituras (`POST /usuarios`)
  - `replicaPool` para lecturas (`GET /usuarios`), apuntando a HAProxy
- **haproxy** (`haproxy/haproxy.cfg`): balanceador TCP en modo `roundrobin` sobre las tres réplicas de Postgres, con health checks. Expone stats en `:8404/stats`.
- **db-primary** (`postgres/primary/`): Postgres 16 configurado para replicación streaming, con `init-replication.sh` que crea el usuario de replicación al inicializar.
- **db-replica-{1,2,3}** (`postgres/replica/`): réplicas que corren `setup-replica.sh` antes de arrancar Postgres para hacer `pg_basebackup` desde el primary.
- **redis**: backend del rate limiter por IP.

## Endpoints

| Método | Ruta        | Descripción                                       |
|--------|-------------|---------------------------------------------------|
| GET    | `/health`   | Healthcheck. Devuelve el hostname de la réplica.  |
| GET    | `/usuarios` | Lee desde HAProxy → réplica.                      |
| POST   | `/usuarios` | Escribe en el primary. Body: `{ "nombre": "..." }`. |
| POST   | `/login`    | Login simulado, limitado a 5 req/min por IP.      |

Todas las respuestas incluyen el campo `replica` con el hostname del contenedor que atendió, para verificar el balanceo.

## Cómo correrlo

```bash
cp .env.example .env   # completar POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
docker compose up --build
```

Luego:

```bash
curl localhost:3000/health
curl localhost:3000/usuarios
curl -X POST localhost:3000/usuarios -H 'content-type: application/json' -d '{"nombre":"luis"}'
```

Stats de HAProxy: <http://localhost:8404/stats>.

## Puertos expuestos

| Servicio      | Host → Container |
|---------------|------------------|
| nginx         | 3000 → 80        |
| db-primary    | 5432 → 5432      |
| db-replica-1  | 5433 → 5432      |
| haproxy (pg)  | 5434 → 5432      |
| db-replica-2  | 5435 → 5432      |
| db-replica-3  | 5436 → 5432      |
| haproxy stats | 8404 → 8404      |
| redis         | 6379 → 6379      |

## Historial

- `915d8a7` — primer cut del lab: API, nginx, primary + 1 réplica.
- `e07adb0` — ajustes de nginx (upstream / proxy headers).
- `a465c00` — rate limit con Redis para `/login`.
- `9e191b4` — paso a 3 réplicas de Postgres + HAProxy delante.
- `0c81816` — fixes en la config de réplicas.
