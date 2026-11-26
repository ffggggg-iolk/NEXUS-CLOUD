# NEXUS CLOUD

Panel web para administrar proyectos y bots en entornos de hosting aislados.

## Estado
Primera estructura del proyecto. El panel inicial es una interfaz de administración; la ejecución real de procesos requiere configurar un worker aislado y un proveedor de hosting.

## Desarrollo
```bash
npm install
npm run dev
```

## Seguridad
- No subir tokens, contraseñas ni archivos .env.
- Ejecutar cada proyecto en un entorno aislado con límites de recursos.
- No exponer el socket de Docker ni permitir comandos arbitrarios desde el navegador.

## Próximas etapas
1. Panel web responsive.
2. Autenticación y almacenamiento persistente.
3. Worker aislado para ejecutar proyectos.
4. Logs, métricas y controles de procesos.
5. Integración con un proveedor de hosting.
