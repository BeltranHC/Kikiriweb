# KikiriWeb

Gestión de estudiantes, tickets de pollada, entregas, anulaciones y cierre de caja con Next.js, React y Supabase.

## Instalación

Requiere Node.js 20.12 o superior.

1. Ejecuta `npm ci`.
2. Copia `.env.example` a `.env.local` y configura la URL y la clave pública de Supabase.
3. Ejecuta **todo `database.sql`** en el SQL Editor de Supabase. Sirve para una instalación nueva y para migrar la base existente; no borra estudiantes ni tickets.
4. Ejecuta `npm run dev` y abre http://localhost:3000.

## Migración de una instalación existente

Aplica `database.sql` antes de desplegar el código nuevo. La aplicación necesita las nuevas funciones SQL y las columnas `unit_price` y `movement_id`.

Antes de aplicarla, guarda un respaldo externo y prueba una copia de la base. La migración toma copias temporales de control, bloquea escrituras durante la comprobación y compara todos los campos originales antes de confirmar la transacción. Si detecta un cambio no previsto, cancela la migración completa. Las copias temporales se descartan al terminar y no sustituyen un respaldo recuperable. Las copias se crean explícitamente en `pg_temp`, activan RLS y revocan el acceso de `PUBLIC`, `anon`, `authenticated` y `service_role`. Las tablas principales también activan RLS inmediatamente después de su declaración. Si no puede obtener los bloqueos en 10 segundos, se cancela sin aplicar los cambios.

Conserva las políticas y el disparador existentes cuando son compatibles; ante una definición incompatible con el mismo nombre, se detiene para revisión. No cambia fechas, pagos ni asignaciones de tickets existentes: solo agrega su referencia al historial. Una entrega antigua sin fecha usa la fecha de creación únicamente para el nuevo movimiento; el ticket conserva su fecha original, incluso si es nula.

Supabase puede seguir mostrando una advertencia porque el archivo define la función de eliminación de estudiantes. La definición no ejecuta esa eliminación. Reemplaza el contenido anterior del editor y ejecuta el archivo completo, desde `BEGIN` hasta `COMMIT`, sin seleccionar bloques aislados ni agregar RLS automáticamente desde el diálogo del editor.

La migración activa RLS, elimina los permisos de escritura directa de las sesiones públicas y permite escribir solo mediante funciones autenticadas. Crea el historial de entregas existentes y registra cada entrega y anulación futura por separado. Las anulaciones anteriores que ya se borraron no se pueden reconstruir. El precio histórico inicial de los tickets existentes se considera S/15.

Los usuarios autenticados existentes operan como cajeros. Mantén desactivadas las altas públicas y el inicio de sesión anónimo en Supabase Auth si el sistema es de uso interno; las cuentas se crean desde administración. Esta versión no introduce roles de administrador separados.

## Comportamiento

- Los estudiantes se buscan y consultan con paginación.
- Entregas y anulaciones bloquean los tickets durante la transacción para evitar que dos cajeros sobrescriban la misma entrega.
- Las anulaciones requieren el identificador de la entrega original. Un ticket que fue anulado y vuelto a entregar no se puede anular desde una pantalla desactualizada.
- Los movimientos conservan el nombre del estudiante, números de ticket, precio y cajero. No se permite eliminar estudiantes o tickets que tengan historial.
- El cierre de caja y “Cobrado Hoy” incluyen las entregas que siguen activas en el día seleccionado, con límites de fecha de `America/Lima`. Las preventas no se vuelven a cobrar. Una anulación revierte la entrega; no registra un reembolso monetario independiente.
- El CSV separa efectivo y Yape, incluye el total y protege las celdas de texto frente a fórmulas de hojas de cálculo. `GET /api/export?date=AAAA-MM-DD` permite consultar otra fecha.

## Importación

Se aceptan comas o punto y coma, BOM, campos entre comillas, comillas escapadas y saltos de línea dentro de campos. La vista previa y el servidor usan el mismo lector y las mismas validaciones.

```csv
nombre,codigo,dni,ticket_inicio,ticket_fin
Juan Pérez,2026-001,12345678,1,15
```

También se acepta `nombre,tickets`, con una lista como `"1;2;3"`. Se reconocen los encabezados `Nombres;Inicio;Fin`. Código y DNI son opcionales. El DNI, cuando se proporciona, debe tener ocho dígitos.

Límites: 2 MB, 1000 estudiantes, 2000 tickets por estudiante y 10 000 tickets por archivo. El archivo completo se importa en una transacción: si una fila falla, no se guarda ninguna. Volver a importar tickets existentes produce un conflicto y conserva los datos anteriores.

## Administración

Las credenciales se leen de `.env.local`. No se incluyen secretos ni contraseñas en los scripts ni se imprimen en consola.

Para crear una cuenta, configura `SUPABASE_SECRET_KEY`, `AUTH_USER_EMAIL` y `AUTH_USER_PASSWORD` y ejecuta `npm run create-user`. Se requiere una contraseña de al menos 12 caracteres. El comando anterior `node scripts/add_yesii.mjs` usa ahora esas mismas variables.

Para cargar un CSV con una cuenta existente, configura su correo y contraseña y ejecuta:

```sh
npm run seed -- semilla.csv
```

El seed valida el archivo y usa la misma importación transaccional. No elimina datos ni crea cuentas automáticamente.

Si había una clave secreta activa en versiones locales anteriores, rótala en Supabase y actualiza los servicios que la utilizan. Retirarla del archivo no revoca su acceso. La aplicación web solo necesita la clave pública.

## Comprobaciones

```sh
npm test
npm run lint
npm run build
npm audit
```

Las pruebas de SQL usan PostgreSQL en memoria mediante PGlite, sin conectarse a Supabase. Verifican RLS, permisos, transacciones, colisiones de tickets, entregas duplicadas, anulaciones, límites de fecha y migraciones repetidas. Las pruebas de API comprueban el rechazo de solicitudes sin sesión y la propagación de conflictos. La compilación verifica la integración con Next.js.


## Diseño y conservación de la búsqueda

La aplicación usa modo claro en todas las pantallas, con fuentes locales. El texto del buscador y la página de resultados se conservan por pestaña en `sessionStorage`, de forma independiente para Panel, Estudiantes y Movimientos. Cerrar sesión explícitamente limpia estas búsquedas.

El Panel consulta actualizaciones cada 30 segundos sin recargar la ventana. La actualización automática se pausa mientras hay un campo de texto activo, una selección de tickets, una operación de entrega o un diálogo abierto, y cuando la pestaña no está visible. “Actualizar” permite consultar datos manualmente sin perder la búsqueda o la selección. Las respuestas de búsquedas anteriores se descartan.

Una sesión vencida intenta renovarse una vez. Si necesita credenciales, muestra un acceso dentro de la pantalla y conserva la búsqueda y la selección; las API siguen exigiendo una sesión válida.

Para las pruebas de interacción, ejecuta `npm run build` y después `npm run test:ui`. Usan Chrome instalado (o el canal indicado con `PLAYWRIGHT_CHANNEL`), páginas compiladas y respuestas ficticias. No acceden a los datos ni a la autenticación real de Supabase. Las capturas de revisión se guardan en `artifacts/ui-preview`.


## Arranque en Windows y OneDrive

`npm run dev` y `npm run build` limpian primero la carpeta generada `.next`, usando el sistema de archivos de Node para evitar el error `EINVAL: invalid argument, readlink` al procesar archivos sincronizados por OneDrive. La limpieza se limita a `.next`; los archivos fuente y la base de datos se conservan. Detén el servidor antes de ejecutar otra compilación.

Las capturas y los resultados de Playwright se guardan en `artifacts/`, fuera de `.next` y excluidos de Git. Después de usar el modo de desarrollo, ejecuta `npm run build` antes de `npm run start` o `npm run test:ui`.
