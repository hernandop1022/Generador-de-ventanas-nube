# Generador de ventanas · prueba en la nube

Editor y PDF The Factory / The Factory + Pronova, con almacenamiento directo en Google Drive. Aplicación estática: no requiere servidor Python en el dispositivo.

## Activación

Publicar esta carpeta mediante GitHub Pages (rama principal, carpeta raíz). Configurar un cliente OAuth web para ese origen HTTPS, habilitar Drive API y completar `clientId` en `config.js`. Consultar `configuracion.html` para los pasos. El ID de cliente es público; NO subir secretos OAuth, tokens ni datos de clientes.

Estado inicial: cliente OAuth pendiente. No hay conexión real con Drive hasta completar la configuración y autorizarla desde el navegador. No subir `disenos.json`, respaldos ni la carpeta de revisión al repositorio.

## Datos y recuperación

- Alcance OAuth: `drive.file`. Los datos pertenecen a la cuenta conectada.
- Un JSON por proyecto y versión; no hay un archivo global que sobrescriba los demás proyectos.
- Guardado tras 2,5 segundos sin cambios y al salir del editor.
- Versiones inmutables con referencias a sus versiones anteriores. Una edición simultánea conserva ambas ramas y exige elegir antes de continuar.
- Verificación por lectura del contenido después de subir. Los reintentos usan IDs pregenerados para no duplicar el mismo envío.
- Borrador local de rescate por cuenta, exportable cuando una conexión falla. Es respaldo, no edición sin conexión garantizada.
- PDF y ZIP se descargan al dispositivo; no se suben automáticamente a Drive en esta etapa.
- No se elimina historial. Límite inicial de 5 MB de datos por proyecto. Los dibujos se guardan como parámetros, no como PNG.

## Prueba en dos dispositivos

1. Conectar la cuenta e importar un proyecto JSON de prueba.
2. Cambiar medida, descripción y marca; esperar confirmación de guardado.
3. Abrir el enlace desde otro dispositivo y la misma cuenta; comprobar esos cambios y generar el PDF.
4. Dejar ambos abiertos, editar el mismo proyecto y confirmar que el segundo dispositivo avisa del conflicto.
5. Descargar pendientes y actualizar; confirmar que no se pierden las dos versiones.

Las pruebas automatizadas usan un simulador de Drive. La autorización, cuotas y comportamiento de Google real deben validarse en esta prueba personal antes de sustituir la versión local. La adaptación táctil completa corresponde a la etapa 2.

## Fuentes técnicas

- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
- https://developers.google.com/workspace/drive/api/guides/search-files
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds

La aplicación usa PDF-lib y @pdf-lib/fontkit (MIT). Conserva los avisos incluidos en sus distribuciones. Las marcas y los recursos gráficos corresponden a sus propietarios.
