# NEXUS CLOUD

NEXUS CLOUD es el panel de administración y NEXUS ENGINE es el agente local que ejecuta proyectos en el dispositivo de su propietario.

## Arquitectura actual (preview)
- Panel web privado: autenticación de administrador, sesiones SQLite, subida validada de ZIP y lista de proyectos.
- NEXUS ENGINE: servicio local para Android/Termux y otros sistemas con Node.js 20+.
- El motor escucha solo en `127.0.0.1`, requiere un token Bearer y permite instalar, iniciar, detener, consultar logs y eliminar proyectos Node.js.
- Los proyectos deben incluir `package.json` con un script `start`.

## Ejecutar el panel web
1. Requiere Node.js 20 o superior.
2. Ejecuta `npm install`.
3. Configura `SESSION_SECRET` (mínimo 32 caracteres aleatorios) y `ADMIN_PASSWORD` (mínimo 12 caracteres) como variables de entorno.
4. Ejecuta `npm start`.
5. Abre `http://localhost:3000`.

## Instalar NEXUS ENGINE en Termux
Desde la carpeta del repositorio en Termux:
```bash
bash engine/install-termux.sh
```
El instalador copia el motor a `$HOME/nexus-engine`, instala dependencias y prepara Termux:Boot. Después inicia el servicio local. El token se guarda en `~/.nexus-engine/engine.token`.

API local: `http://127.0.0.1:8787`. Todas las peticiones necesitan `Authorization: Bearer <token>`. No expongas este puerto a Internet ni compartas el token.

## Importante: estado del proyecto
Esta versión es una **preview local**, no un hosting cloud multiusuario terminado. El panel web todavía no está emparejado con NEXUS ENGINE; la conexión remota segura, cuentas multiusuario, aislamiento por contenedores/sandbox, límites de recursos y consola remota son fases pendientes. No se debe anunciar como hosting 24/7 listo para producción.

## Seguridad y disponibilidad
El motor ejecuta el código de los proyectos con los permisos del usuario del dispositivo. Instala únicamente archivos de confianza. No ejecutes proyectos desconocidos ni compartas tokens. Para ofrecerlo a otros usuarios habrá que implementar aislamiento real y emparejamiento autenticado antes de habilitar control remoto.

Android puede cerrar procesos por ahorro de batería, reinicios, temperatura o falta de recursos. Termux:Boot y wake lock ayudan, pero no garantizan disponibilidad permanente. El dispositivo necesita alimentación, conexión y recursos suficientes.
