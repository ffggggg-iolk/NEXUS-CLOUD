# NEXUS ENGINE (preview)

Motor local para ejecutar proyectos Node.js en el dispositivo de su propietario.

## Requisitos
- Node.js 20+
- Termux en Android (instalar desde F-Droid o GitHub oficial)
- Espacio y conexión disponibles

## Instalación manual
1. Copia esta carpeta a `$HOME/nexus-engine`.
2. Ejecuta `npm install`.
3. Ejecuta `npm start`.
4. La primera ejecución crea el token privado en `~/.nexus-engine/engine.token`.

La API escucha exclusivamente en `127.0.0.1:8787`. Todas las peticiones requieren `Authorization: Bearer <token>`.

## API local
- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects` (multipart: archive ZIP)
- `POST /api/projects/:id/start`
- `POST /api/projects/:id/stop`
- `GET /api/projects/:id/logs`
- `DELETE /api/projects/:id`

Un proyecto debe incluir `package.json` en la raíz y un script `start`.

## Seguridad y limitaciones
Este preview ejecuta código del proyecto con los permisos del usuario del dispositivo. Instala únicamente bots y código que conozcas y confíes. No expongas el puerto del motor a Internet, no compartas el token y no desactives el aislamiento del dispositivo. Para uso multiusuario y acceso remoto se necesita un agente emparejado, autenticación por dispositivo y un canal cifrado; todavía no está implementado. La API local no es un servicio cloud remoto.

Android puede detener procesos por ahorro de batería, reinicios o falta de recursos. Termux:Boot y wake lock ayudan, pero no garantizan disponibilidad 24/7.
