# Propuestas de mejora · Ayora I

PWA multiproyecto para cumplimentar en campo el modelo oficial **RG-SPM-28 · Edición 09**, recoger la firma, incorporar fotografías, generar el PDF y mantener un histórico compartido y aislado por proyecto. Versión actual: **11.0.0**.

## Funcionamiento

- Autenticación mediante Supabase Auth.
- PDF generado sobre una copia byte a byte del modelo oficial. Se comprueba su SHA-256; si cambia o se corrompe, la generación se detiene.
- Borradores completos en IndexedDB: texto, fotografías comprimidas y firma.
- Cierre sin conexión: PDF y expediente se guardan primero en el móvil, dentro de una cola persistente.
- Sincronización automática al recuperar conexión, abrir o enfocar la aplicación y cada 60 segundos mientras está abierta.
- Número oficial asignado exclusivamente por PostgreSQL. Hasta sincronizar se muestra `PENDIENTE-…`.
- Histórico compartido y descarga posterior del PDF, desde la copia local o mediante enlace temporal al almacenamiento privado.
- Selector de proyecto para usuarios que pertenezcan a más de uno.
- Administrador general único, administradores de proyecto y usuarios ordinarios.
- Envío de expedientes limitado a los técnicos destinatarios configurados por cada proyecto; no existe un botón genérico para compartir el PDF.
- Botón independiente para compartir por WhatsApp únicamente el enlace de instalación de la aplicación.

## Garantías del cierre

El cierre utiliza un UUID creado en el dispositivo como clave idempotente. Así, un timeout o una respuesta perdida no duplica el expediente al reintentarlo:

1. Validar los datos y la plantilla oficial.
2. Generar y conservar el PDF en IndexedDB.
3. Crear el registro remoto como borrador.
4. Subir el PDF al bucket privado.
5. Marcar la propuesta como cerrada.

Si falla cualquier operación remota, la copia local permanece intacta y se reintenta. El indicador de conexión del navegador es solo orientativo: también se capturan los errores reales de red.

## Seguridad de Supabase

La clave publicable del cliente no es un secreto. La protección depende de RLS y los permisos de PostgreSQL. La configuración desplegada incluye:

- RLS activo en `profiles`, `proposals`, `catalog_items`, `proposal_photos` y `allowed_users`.
- Ningún permiso de tabla para el rol anónimo.
- Usuarios autenticados con lectura del histórico común; solo el propietario crea su propuesta y la modifica mientras es borrador. El administrador conserva las operaciones autorizadas.
- El perfil no puede modificarse desde el cliente, evitando elevar el rol.
- Bucket `proposal-pdfs` privado; lectura para integrantes autenticados y escritura solo en la carpeta del propio usuario.
- La firma no se replica en una columna independiente: queda dentro del PDF privado para reducir exposición.

Después de cualquier cambio de esquema deben repetirse la auditoría RLS y los asesores de seguridad de Supabase.

## Protección de datos

La aplicación aplica minimización, autenticación, almacenamiento privado y control de acceso, pero el cumplimiento RGPD/LOPDGDD **no puede resolverse solo con código**. Antes de ampliar el uso, Eiffage debe documentar y aprobar:

- finalidad y base jurídica;
- información a trabajadores y empresas;
- perfiles autorizados y revisión periódica de accesos;
- conservación, bloqueo y supresión de expedientes y copias locales;
- contratos, región y condiciones de los encargados del tratamiento;
- alojamiento corporativo frente a cuentas personales;
- procedimiento de derechos, incidentes y copias de seguridad;
- evaluación de impacto si el análisis interno determina que procede.

Esto no sustituye la aprobación jurídica y corporativa necesaria para un despliegue general.

## Modelo PDF

El parámetro admitido es `?pdf=rg-spm28-ed09`. Si se solicita otra versión, la aplicación lo advierte. Las coordenadas están calibradas para Edición 09 y la huella esperada es:

`13a9b8a765f7f00977eb32b1b1e87625f740982478a8d8c584f1080be67b8bf2`

Una nueva edición exige incorporar el nuevo original, recalibrar los campos, actualizar la huella y repetir la revisión visual de todas las páginas.

## Prueba local

Servir la carpeta con HTTP, por ejemplo `python -m http.server 8080`, y abrir `http://localhost:8080`. No se debe abrir `index.html` directamente como archivo.

Pruebas mínimas antes de publicar:

1. Crear y recuperar un borrador con fotografía y firma.
2. Cerrar dos propuestas sin conexión y comprobar que ambas quedan pendientes.
3. Recuperar cobertura y confirmar número oficial, histórico compartido y PDF remoto.
4. Descargar un PDF antiguo desde el histórico.
5. Renderizar una propuesta Eiffage y otra de contratista y revisar cada campo sobre el RG-SPM-28.
