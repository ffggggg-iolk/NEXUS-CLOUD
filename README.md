# NEXUS CLOUD

Panel web privado para guardar y organizar proyectos ZIP desde el móvil.

## Funciones actuales
- Inicio de sesión de administrador con cookie HTTP-only y sesiones SQLite.
- Límite de intentos de inicio de sesión.
- Subida de ZIP de hasta 50 MB.
- Validación de rutas, enlaces simbólicos, cantidad de entradas y tamaño expandido para reducir riesgos de ZIP maliciosos.
- Registro persistente de proyectos en SQLite.
- Eliminación de proyectos y archivos guardados.
- Interfaz responsive.

## Ejecutar con Docker Compose
1. Copia `.env.example` a `.env`.
2. Genera un secreto con `openssl rand -base64 48` y colócalo en `SESSION_SECRET`.
3. Establece una contraseña única de al menos 12 caracteres en `ADMIN_PASSWORD`.
4. Ejecuta `docker compose up -d --build`.
5. Abre `http://localhost:3000`.

Los datos se guardan en el volumen Docker `nexus_data`. En un servidor remoto, usa HTTPS mediante un proxy inverso y configura `TRUST_PROXY=1` solo si el proxy es de confianza.

## Desarrollo local
Requiere Node.js 20 o superior:
```bash
npm install
cp .env.example .env
npm run dev
```

## Estado del worker
El panel guarda los ZIP y metadatos, pero **todavía no ejecuta los bots**. Para ello falta desplegar un worker separado que ejecute cada proyecto en contenedores aislados, con límites de CPU, RAM, disco y tiempo. No se expone el socket de Docker ni se aceptan comandos de terminal desde el panel.

## Hosting
La disponibilidad 24/7 depende de un proveedor y de su plan. Los planes gratuitos pueden suspender servicios o limitar recursos; no se garantiza funcionamiento permanente en un plan gratuito.
