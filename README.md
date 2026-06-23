# Doodle Defense — Tower Defense Full-Stack

Una aplicación web de Tower Defense con una estética Neo-Minimalista Premium inspirada en herramientas profesionales de ilustración digital. El proyecto está diseñado bajo una arquitectura de microservicios contenerizada, desacoplando la lógica de renderizado en el cliente (Phaser 3) de la persistencia de puntuaciones globales (Node.js/Express).

## 🛠️ Stack Tecnológico

- **Frontend:** Phaser 3 (Canvas/WebGL), Vite, Vanilla JS (ES6 Modules).
- **Backend:** Node.js, Express.
- **Servidor de Producción & Proxy:** Nginx (Alpine).
- **Orquestación e Infraestructura:** Docker, Docker Compose, listo para despliegue automatizado en Coolify / VPS.

## 🏗️ Arquitectura y Decisiones de Ingeniería

### 1. Consolidación de Red mediante Proxy Inverso (Nginx)

Para producción, el contenedor de Frontend actúa como el único punto de entrada expuesto (:8080). Toda petición dirigida a `/api/*` es interceptada internamente por Nginx y redirigida al contenedor de Backend en el puerto 3000 dentro de la red privada de Docker. Esto elimina la necesidad de exponer puertos del backend al host y evita por completo problemas de CORS en producción.

### 2. Algoritmo de Oclusión de Rejilla por Proyección Lineal

A diferencia de los enfoques tradicionales basados en muestreo de puntos discretos a lo largo del camino (que causan falsos positivos en esquinas), se implementó un algoritmo de distancia perpendicular exacta de punto a segmento (`_pointToSegmentDistSq`). Las celdas se deshabilitan dinámicamente solo si su centro geométrico viola un umbral estricto de 17px respecto a los vectores ortogonales del camino, maximizando el área construible en curvas cerradas.

### 3. Persistencia Atómica en Sistemas de Archivos

El backend almacena el Leaderboard global en un JSON plano optimizado. Para prevenir la corrupción de datos por condiciones de carrera (race conditions) o apagados repentinos del contenedor, las escrituras se realizan de forma atómica: los datos se escriben primero en un archivo temporal intermedio y posteriormente se renombran (`fs.renameSync`) para reemplazar el archivo principal de forma segura.

### 4. Sincronización Inversa del Espacio de Tiempo

El sistema de fast-forward (1x / 2x) unifica tres subsistemas que manejan el tiempo de forma dispar en Phaser 3: los bucles de tiempo (`time.timeScale`), las animaciones interpoladas (`tweens.timeScale`) y el motor de física, el cual requiere una escala invertida (`physics.world.timeScale = 1 / N`) para mantener la consistencia matemática de los proyectiles a alta velocidad.

## 🚀 Características del Juego

- **Campaña por Niveles:** Caminos ortogonales generados por waypoints con decoraciones técnicas de precisión (corner ticks).
- **Sistema de Upgrades:** Evolución estratégica de torres (3 niveles) que escala el daño (+40%) y la cadencia con respuesta visual dinámica (halos de rango y overshoots elásticos).
- **UX Fluida:** Barra de herramientas inferior flotante con transiciones elásticas (Cubic.Out), indicadores de alcance traslúcidos en hover y feedback físico mediante sacudida de cámara (Screen Shake) al recibir daño.
- **Leaderboard Global Único:** Registro asíncronos por Fetch protegiendo la unicidad del Nickname (solo actualiza si el jugador supera su propio récord histórico) y ventana modal con renderizado escalonado (staggered cascade) para optimizar el draw de Phaser.

## 📦 Despliegue Local y Producción

### Requisitos

- Docker y Docker Compose instalados.

### Levantar el entorno completo

```bash
docker compose up --build
```

Una vez levantado el stack, el juego queda accesible en `http://localhost:8080`. El backend permanece aislado en la red interna de Docker y solo es accesible a través del proxy de Nginx montado en el contenedor de Frontend (`/api/*`).

### Persistencia de datos

El directorio `./server/data/` se monta como bind volume en `/app/data` dentro del contenedor de Backend. El archivo `leaderboard.json` allí almacenado sobrevive a reconstrucciones (`docker compose down && up --build`) y redeploys automáticos en Coolify.

### Desarrollo local (Vite Dev Server)

Para iterar sobre el frontend sin reconstruir la imagen Docker en cada cambio:

```bash
# Terminal 1 — backend
cd server && npm install && npm start

# Terminal 2 — frontend (HMR en :5173)
npm install && npm run dev
```

El servidor de desarrollo de Vite expone un proxy `/api → http://localhost:3000` definido en `vite.config.js`, replicando el comportamiento de Nginx en producción. Esto permite que el código del cliente use URLs relativas (`/api/leaderboard`) sin diferencias entre entornos.

### Build de producción aislado

```bash
npm run build         # genera el bundle estático en /dist
docker build -t tdpowa-frontend .
docker build -t tdpowa-backend ./server
```

## 📁 Estructura del Proyecto

```
.
├── docker-compose.yml          # Orquestación de los dos servicios
├── Dockerfile                  # Frontend (build Vite + Nginx Alpine)
├── nginx.conf                  # Configuración del proxy inverso /api → backend:3000
├── vite.config.js              # Proxy de desarrollo para paridad con producción
├── src/
│   ├── main.js                 # Bootstrap de Phaser
│   ├── scenes/                 # BootScene, MenuScene, GameScene
│   ├── components/             # Tower, Enemy (clases extendidas de Phaser)
│   ├── managers/               # TowerManager, WaveManager
│   ├── services/               # leaderboardApi.js (cliente fetch)
│   └── assets/                 # SVGs vectoriales (torres, balas, enemigos)
└── server/
    ├── Dockerfile              # Imagen Alpine ligera de Node 20
    ├── index.js                # Servidor Express + persistencia atómica
    ├── package.json
    └── data/                   # Volumen persistente (montado, no commiteado)
```

## 🔌 API del Backend

| Método | Endpoint           | Cuerpo                | Respuesta                                                              |
| ------ | ------------------ | --------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/api/health`      | —                     | `{ ok, ts }`                                                           |
| `GET`  | `/api/leaderboard` | —                     | `Array<{ nickname, score, updatedAt }>` (top 20 descendente)           |
| `POST` | `/api/leaderboard` | `{ nickname, score }` | `{ action, rank, top }` — `action` ∈ `created \| updated \| no_change` |

### Reglas de validación

- `nickname`: 1–14 caracteres, sin caracteres de control (U+0000–U+001F, U+007F), espacios internos colapsados, comparación case-insensitive.
- `score`: entero no negativo dentro del rango `[0, 10⁹]`.
- Unicidad: si el `nickname` ya existe en el JSON, solo se sobrescribe cuando el nuevo `score` supera estrictamente al previo (`>`, no `>=`).

## 🧱 Convenciones del Código

- **Vanilla ES6 Modules** — sin framework, sin transpilación de TypeScript. Vite resuelve los `import` directamente.
- **Sin estado global compartido** — las escenas (`BootScene`, `MenuScene`, `GameScene`) son independientes; el progreso del jugador se persiste en `localStorage` (récord local) o vía API (récord global).
- **Componentes como Containers** — cada `Tower` y `Enemy` extiende `Phaser.GameObjects.Container`, encapsulando sus gráficos, lógica de input y ciclo de vida.
- **Spam-lock de submisión** — el envío al leaderboard es idempotente por sesión de juego: una vez registrado, los siguientes triggers de fin de partida no reabren el prompt.

## 📜 Licencia

Código publicado con fines educativos y de portafolio.
